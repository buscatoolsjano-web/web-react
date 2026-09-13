-- ===========================================================================
-- FASE 10 · INFORMES — ENTREGA 3 · rankings de clientes y productos
-- ===========================================================================
--
-- Migraciones (en este orden):
--   fase10_informes_entrega3_rankings         primera versión
--   fase10_informes_entrega3_rankings_orden   DEFINITIVA: min() de los snapshots
--                                             con collation "C" (la base es
--                                             en_US.UTF-8; así la etiqueta de una
--                                             línea sin producto es determinista)
--
-- Sin tablas, columnas, vistas, índices ni cambios de RLS. Una función de
-- lectura, aparte de informe_actividad_comercial (E1) e
-- informe_pipeline_comercial (E2). Qué documento entra es la MISMA regla de
-- la Entrega 1 (repetida en el WHERE: no hay un helper SQL común y crear uno
-- obligaría a reescribir las funciones ya cerradas):
--   cotizado  = sales_quotes.status <> 'draft'
--   pedido    = sales_orders.commercial_status = 'confirmed'
--   entregado = deliveries.status in ('shipped','delivered')
--
-- Parámetros:
--   p_dimension  'clientes' | 'productos'
--   p_fuente     'entregado' | 'pedido' | 'cotizado'
--   p_medida     'importe' | 'cantidad'
--                  clientes → sólo importe (total del documento)
--                  productos × entregado → sólo cantidad: las 600 líneas de
--                  remito históricas no tienen precio (sin_importe)
--   p_periodo    'mes'  = el tramo del mes elegido (1 → hoy en el mes en curso)
--                '12m'  = los 12 meses que terminan en el mes elegido
--   p_moneda     obligatoria con importe ('ARS', 'USD', 'EUR', 'SIN MONEDA');
--                prohibida con cantidad (lo físico no depende de la moneda)
--   p_limite     1..500 (Top N en pantalla = 10; el CSV pagina de a 500)
--   p_desplazamiento  >= 0
--
-- Importe:
--   clientes   Σ total guardado del documento (con impuestos), por moneda
--   productos  Σ línea histórica: cantidad × unit_price × (1 − dto línea)
--              × (1 − dto cabecera) × (1 + IVA de la línea). Con impuestos,
--              como los documentos de Informes. Precio 0 → importe 0.
--              No tiene por qué coincidir con el total del documento: el
--              histórico no siempre cierra (medido en la entrega).
--
-- Identidad:
--   clientes   customer_id (nunca el nombre). Etiqueta = nombre comercial o
--              razón social ACTUAL. Un documento sin customer_id iría a
--              «SIN CLIENTE VINCULADO» (hoy 0).
--   productos  product_id cuando existe (etiqueta y SKU actuales del
--              catálogo). Línea sin product_id → agrupada por su SKU snapshot
--              EXACTO, vinculado = false; nunca por parecido.
--   Un cliente o producto dado de baja sigue en el ranking (activo = false).
--   admin y employee ven los productos borrados (products_write es ALL para
--   quien escribe), así que la etiqueta es la del catálogo; si alguna vez la
--   RLS lo ocultara, sale del snapshot de la línea. Sin vínculo (sin
--   customer_id / product_id): activo = null.
--
-- Dato atípico (por línea): cantidad >= 1000 e importe 0. Umbral medido: la
-- mayor cantidad CON precio es 480 (pedidos) / 300 (cotizaciones); las 6 líneas
-- >= 1000 tienen precio 0. En remitos, el precio es el del remito o, si no
-- tiene, el de la línea de pedido enlazada. Se cuenta por fila, no se excluye.
--
-- Orden estable: medida desc, documentos desc, etiqueta asc (collation "C"),
-- clave asc. total_filas = filas del ranking completo (para paginar).
-- ===========================================================================

create or replace function public.informe_rankings_comerciales(
  p_company        uuid,
  p_mes            date    default null,
  p_dimension      text    default 'clientes',
  p_fuente         text    default 'entregado',
  p_medida         text    default 'importe',
  p_periodo        text    default 'mes',
  p_moneda         text    default null,
  p_limite         integer default 10,
  p_desplazamiento integer default 0
)
returns table (
  posicion          bigint,
  total_filas       bigint,
  clave             text,
  cliente_id        uuid,
  producto_id       uuid,
  etiqueta          text,
  codigo            text,
  moneda            text,
  importe           numeric,
  cantidad          numeric,
  documentos        bigint,
  lineas_atipicas   bigint,
  cantidad_atipica  numeric,
  vinculado         boolean,
  activo            boolean,
  desde             date,
  hasta             date
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  c_umbral_atipico constant numeric := 1000;
  v_hoy        date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_mes_hoy    date := date_trunc('month', (now() at time zone 'America/Argentina/Buenos_Aires'))::date;
  v_mes        date;
  v_desde      date;
  v_hasta      date;
begin
  if p_company is null or app.current_role(p_company) is null
     or app.current_role(p_company) not in ('admin', 'employee') then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;

  if p_dimension is null or p_dimension not in ('clientes', 'productos')
     or p_fuente is null or p_fuente not in ('entregado', 'pedido', 'cotizado')
     or p_medida is null or p_medida not in ('importe', 'cantidad')
     or p_periodo is null or p_periodo not in ('mes', '12m')
     or p_limite is null or p_limite < 1 or p_limite > 500
     or p_desplazamiento is null or p_desplazamiento < 0
     or (p_dimension = 'clientes' and p_medida <> 'importe')
     or (p_medida = 'importe' and p_moneda is null)
     or (p_medida = 'cantidad' and p_moneda is not null) then
    raise exception 'parametro_invalido' using errcode = 'invalid_parameter_value';
  end if;

  if p_dimension = 'productos' and p_fuente = 'entregado' and p_medida = 'importe' then
    raise exception 'sin_importe' using errcode = 'invalid_parameter_value';
  end if;

  v_mes := date_trunc('month', coalesce(p_mes, v_hoy))::date;
  if v_mes > v_mes_hoy then
    raise exception 'mes_futuro' using errcode = 'invalid_parameter_value';
  end if;

  v_hasta := case when v_mes = v_mes_hoy then v_hoy else ((v_mes + interval '1 month')::date - 1) end;
  v_desde := case when p_periodo = 'mes' then v_mes else (v_mes - interval '11 months')::date end;

  -- ── clientes ────────────────────────────────────────────────────────────
  if p_dimension = 'clientes' then
    return query
    with docs as (
      select q.customer_id as cli, q.total as tot, coalesce(q.currency_code, 'SIN MONEDA') as mon
        from sales_quotes q
       where p_fuente = 'cotizado' and q.company_id = p_company and q.status <> 'draft'
         and q.quote_date between v_desde and v_hasta
      union all
      select o.customer_id, o.total, coalesce(o.currency_code, 'SIN MONEDA')
        from sales_orders o
       where p_fuente = 'pedido' and o.company_id = p_company and o.commercial_status = 'confirmed'
         and o.order_date between v_desde and v_hasta
      union all
      select d.customer_id, d.total, coalesce(d.currency_code, 'SIN MONEDA')
        from deliveries d
       where p_fuente = 'entregado' and d.company_id = p_company and d.status in ('shipped', 'delivered')
         and d.delivery_date between v_desde and v_hasta
    ),
    agg as (
      select x.cli, count(*) as docs, round(coalesce(sum(x.tot), 0), 4) as imp
        from docs x where x.mon = p_moneda group by x.cli
    ),
    eti as (
      select a.cli, a.docs, a.imp,
             case when a.cli is null then 'SIN CLIENTE VINCULADO'
                  else coalesce(nullif(trim(c.trade_name), ''), nullif(trim(c.legal_name), ''), 'Cliente no visible') end as eti,
             case when a.cli is null then null else coalesce(c.deleted_at is null and c.status = 'active', false) end as act,
             coalesce('cliente:' || a.cli::text, 'cliente:sin-vinculo') as cla
        from agg a left join customers c on c.id = a.cli and c.company_id = p_company
    ),
    ord as (
      select e.*,
             row_number() over (order by e.imp desc, e.docs desc, e.eti collate "C" asc, e.cla collate "C" asc) as pos,
             count(*) over () as tot_filas
        from eti e
    )
    select o.pos, o.tot_filas, o.cla, o.cli, null::uuid, o.eti, null::text, p_moneda, o.imp, null::numeric,
           o.docs, null::bigint, null::numeric, o.cli is not null, o.act, v_desde, v_hasta
      from ord o
     order by o.pos
     limit p_limite offset p_desplazamiento;
    return;
  end if;

  -- ── productos ───────────────────────────────────────────────────────────
  return query
  with lin as (
    select 'q:' || h.id::text as doc, l.product_id as pid, l.sku_snapshot as sku, l.name_snapshot as nom,
           coalesce(h.currency_code, 'SIN MONEDA') as mon, l.quantity as q,
           l.quantity * l.unit_price * (1 - l.discount_pct / 100) * (1 - coalesce(h.discount_pct, 0) / 100)
             * (1 + l.tax_rate_snapshot / 100) as imp,
           (l.quantity >= c_umbral_atipico and l.unit_price = 0) as atip
      from sales_quote_lines l join sales_quotes h on h.id = l.quote_id
     where p_fuente = 'cotizado' and l.company_id = p_company and h.company_id = p_company
       and h.status <> 'draft' and h.quote_date between v_desde and v_hasta and l.line_type <> 'chapter'
    union all
    select 'o:' || h.id::text, l.product_id, l.sku_snapshot, l.name_snapshot,
           coalesce(h.currency_code, 'SIN MONEDA'), l.quantity_ordered,
           l.quantity_ordered * l.unit_price * (1 - l.discount_pct / 100) * (1 - coalesce(h.discount_pct, 0) / 100)
             * (1 + l.tax_rate_snapshot / 100),
           (l.quantity_ordered >= c_umbral_atipico and l.unit_price = 0)
      from sales_order_lines l join sales_orders h on h.id = l.order_id
     where p_fuente = 'pedido' and l.company_id = p_company and h.company_id = p_company
       and h.commercial_status = 'confirmed' and h.order_date between v_desde and v_hasta and l.line_type <> 'chapter'
    union all
    select 'd:' || h.id::text, dl.product_id, dl.sku_snapshot, dl.name_snapshot,
           coalesce(h.currency_code, 'SIN MONEDA'), dl.quantity,
           null::numeric,
           (dl.quantity >= c_umbral_atipico and coalesce(dl.unit_price, ol.unit_price) = 0)
      from delivery_lines dl
      join deliveries h on h.id = dl.delivery_id
      left join sales_order_lines ol on ol.id = dl.order_line_id
     where p_fuente = 'entregado' and dl.company_id = p_company and h.company_id = p_company
       and h.status in ('shipped', 'delivered') and h.delivery_date between v_desde and v_hasta
  ),
  agg as (
    select x.pid,
           case when x.pid is null then x.sku end as sku_sin,
           count(distinct x.doc) as docs,
           sum(x.q) as cant,
           case when p_medida = 'importe' then round(coalesce(sum(x.imp), 0), 4) end as imp,
           count(*) filter (where x.atip) as latip,
           coalesce(sum(x.q) filter (where x.atip), 0) as catip,
           min(x.nom collate "C") as nom_snap,
           min(x.sku collate "C") as sku_snap
      from lin x
     where p_medida = 'cantidad' or x.mon = p_moneda
     group by x.pid, case when x.pid is null then x.sku end
  ),
  eti as (
    select a.*,
           coalesce(p.name, a.nom_snap, a.sku_snap, 'Línea sin producto ni SKU') as eti,
           coalesce(p.sku, a.sku_snap) as cod,
           case when a.pid is null then null else coalesce(p.deleted_at is null and p.status = 'active', false) end as act,
           coalesce('producto:' || a.pid::text, 'sku:' || a.sku_sin, 'sin-sku') as cla
      from agg a left join products p on p.id = a.pid and p.company_id = p_company
  ),
  ord as (
    select e.*,
           row_number() over (
             order by (case when p_medida = 'importe' then e.imp else e.cant end) desc,
                      e.docs desc, e.eti collate "C" asc, e.cla collate "C" asc) as pos,
           count(*) over () as tot_filas
      from eti e
  )
  select o.pos, o.tot_filas, o.cla, null::uuid, o.pid, o.eti, o.cod,
         case when p_medida = 'importe' then p_moneda end,
         o.imp, o.cant, o.docs, o.latip, o.catip, o.pid is not null, o.act, v_desde, v_hasta
    from ord o
   order by o.pos
   limit p_limite offset p_desplazamiento;
end
$$;

revoke all on function public.informe_rankings_comerciales(uuid, date, text, text, text, text, text, integer, integer) from public, anon;
grant execute on function public.informe_rankings_comerciales(uuid, date, text, text, text, text, text, integer, integer) to authenticated;
