-- ===========================================================================
-- FASE 10 · INFORMES — ENTREGA 2 · pipeline, conversión y cumplimiento
-- ===========================================================================
--
-- Migración: fase10_informes_entrega2_pipeline
--
-- Sin tablas, columnas, vistas, índices ni cambios de RLS. Una función de
-- lectura, aparte de informe_actividad_comercial (Entrega 1): esa sigue
-- siendo la fuente de «entregado» y del ticket promedio (sum(total)/count
-- sobre el MISMO conjunto de documentos), así la regla no se duplica.
--
-- Reglas:
--   · sólo admin y employee (igual que Entrega 1), validado antes de leer;
--   · SECURITY INVOKER: la RLS de cada tabla sigue aplicando;
--   · COTIZACIONES ABIERTAS (hoy): status in ('sent','accepted') y SIN pedido
--     confirmado enlazado. 'accepted' sola no es conversión (el legacy lo
--     creía); rejected/expired/draft no son abiertas. Por antigüedad desde la
--     fecha del documento: hasta 30 días, 31–90, más de 90 (nada vence en los
--     datos: valid_until está vacío en las 288 históricas);
--   · CONVERSIÓN por cohorte: cotizaciones con fecha del documento en el tramo
--     (actual / anterior / 12 meses), status <> 'draft' (incluye rechazadas y
--     vencidas), que tienen AL MENOS UN pedido CONFIRMADO con quote_id a ellas.
--     Por moneda de la cotización, y una fila 'TODAS' sólo con cantidades.
--     Estado de HOY: una cotización de agosto convertida en septiembre cuenta
--     como convertida al mirar agosto;
--   · CUMPLIMIENTO de pedidos confirmados, contra entregas reales
--     (status in ('shipped','delivered')), con la regla de Stage 2.5
--     (src/modules/ventas/lib/pendientes.ts):
--       no_consta_entrega        sin entregas enlazadas y el cliente tiene un
--                                remito sin pedido → NO se afirma 0 entregado
--       detalle_no_reconstruido  alguna línea de sus entregas sin order_line_id
--       sin_entrega              sin entregas y sin remitos sueltos del cliente
--       completo                 cada línea con entregado >= pedido, sin exceso
--       sobreentregado           ninguna línea pendiente y alguna con exceso
--       parcial                  alguna línea pendiente y algo entregado
--       sin_lineas               pedido sin líneas (no chapter)
--     Cohorte por fecha del pedido (actual / anterior / 12 meses) y 'todos';
--   · PEDIDOS PENDIENTES (hoy): categorías sin_entrega y parcial. Importe
--     pendiente = Σ max(pedido − entregado, 0) × unit_price × (1 − dto línea)
--     × (1 − dto cabecera): precio del pedido, NETO de impuestos, por moneda
--     del pedido. Los no determinables no tienen importe;
--   · INCONSISTENCIAS: conversiones con moneda distinta entre cotización y
--     pedido, y conversiones desde un borrador (quedan fuera del denominador).
--
-- Filas (seccion · periodo · categoria · moneda):
--   rango_actual / rango_anterior / rango_12m     desde, hasta
--   cotizaciones_abiertas · hoy · antigüedad · moneda   documentos, importe, aceptadas
--   conversion · tramo · — · moneda|TODAS               documentos = elegibles,
--        importe = cotizado elegible, convertidas, importe_convertido,
--        abiertas (sent/accepted sin pedido), aceptadas
--   cumplimiento · tramo|todos · categoría · —          documentos
--   pedidos_pendientes · todos · categoría · moneda     documentos, importe pendiente
--   inconsistencias · todos · tipo · —                  documentos (siempre presente)
-- ===========================================================================

create or replace function public.informe_pipeline_comercial(p_company uuid, p_mes date default null)
returns table (
  seccion            text,
  periodo            text,
  desde              date,
  hasta              date,
  categoria          text,
  moneda             text,
  documentos         bigint,
  importe            numeric,
  convertidas        bigint,
  importe_convertido numeric,
  abiertas           bigint,
  aceptadas          bigint
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_hoy        date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_mes_hoy    date := date_trunc('month', (now() at time zone 'America/Argentina/Buenos_Aires'))::date;
  v_mes        date;
  v_serie_ini  date;
  v_act_hasta  date;
  v_ant_ini    date;
  v_ant_hasta  date;
begin
  if p_company is null or app.current_role(p_company) is null
     or app.current_role(p_company) not in ('admin', 'employee') then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;

  v_mes := date_trunc('month', coalesce(p_mes, v_hoy))::date;
  if v_mes > v_mes_hoy then
    raise exception 'mes_futuro' using errcode = 'invalid_parameter_value';
  end if;

  v_serie_ini := (v_mes - interval '11 months')::date;
  v_ant_ini   := (v_mes - interval '1 month')::date;
  if v_mes = v_mes_hoy then
    v_act_hasta := v_hoy;
    v_ant_hasta := least(v_ant_ini + (v_hoy - v_mes), (v_mes - 1));
  else
    v_act_hasta := ((v_mes + interval '1 month')::date - 1);
    v_ant_hasta := (v_mes - 1);
  end if;

  return query
  with
  tramos as (
    select 'actual'::text as p, v_mes as d, v_act_hasta as h
    union all select 'anterior', v_ant_ini, v_ant_hasta
    union all select '12m', v_serie_ini, v_act_hasta
  ),
  -- ── cotizaciones ────────────────────────────────────────────────────────
  pedidos_conf as (
    select o.quote_id, coalesce(o.currency_code, 'SIN MONEDA') as mon
      from sales_orders o
     where o.company_id = p_company and o.commercial_status = 'confirmed' and o.quote_id is not null
  ),
  cot as (
    select q.id, q.quote_date, q.status, q.total,
           coalesce(q.currency_code, 'SIN MONEDA') as mon,
           exists (select 1 from pedidos_conf pc where pc.quote_id = q.id) as conv,
           exists (select 1 from pedidos_conf pc where pc.quote_id = q.id
                     and pc.mon <> coalesce(q.currency_code, 'SIN MONEDA')) as mon_dist
      from sales_quotes q
     where q.company_id = p_company
  ),
  -- ── pedidos contra entregas reales ──────────────────────────────────────
  ped as (
    select o.id, o.order_date, o.customer_id, o.discount_pct,
           coalesce(o.currency_code, 'SIN MONEDA') as mon
      from sales_orders o
     where o.company_id = p_company and o.commercial_status = 'confirmed'
  ),
  ent as (
    select d.id, d.order_id, d.customer_id
      from deliveries d
     where d.company_id = p_company and d.status in ('shipped', 'delivered')
  ),
  entregado as (
    select dl.order_line_id, sum(dl.quantity) as e
      from delivery_lines dl join ent on ent.id = dl.delivery_id
     where dl.company_id = p_company and dl.order_line_id is not null
     group by dl.order_line_id
  ),
  lin as (
    select l.order_id, l.quantity_ordered as q, coalesce(x.e, 0) as e, l.unit_price, l.discount_pct
      from sales_order_lines l left join entregado x on x.order_line_id = l.id
     where l.company_id = p_company and l.line_type <> 'chapter'
  ),
  resumen as (
    select order_id, bool_or(e > q) as exceso, bool_or(e < q) as falta, bool_or(e > 0) as algo
      from lin group by order_id
  ),
  con_entrega as (select distinct order_id from ent where order_id is not null),
  sin_enlazar as (
    select distinct ent.order_id
      from delivery_lines dl join ent on ent.id = dl.delivery_id
     where dl.company_id = p_company and ent.order_id is not null and dl.order_line_id is null
  ),
  huerfanos as (select distinct customer_id from ent where order_id is null),
  clas as (
    select p.id, p.order_date, p.mon, p.discount_pct,
           case
             when ce.order_id is null and h.customer_id is not null then 'no_consta_entrega'
             when se.order_id is not null then 'detalle_no_reconstruido'
             when r.order_id is null then 'sin_lineas'
             when not r.algo then 'sin_entrega'
             when not r.falta and r.exceso then 'sobreentregado'
             when not r.falta then 'completo'
             else 'parcial'
           end as cat
      from ped p
      left join con_entrega ce on ce.order_id = p.id
      left join huerfanos h on h.customer_id = p.customer_id
      left join sin_enlazar se on se.order_id = p.id
      left join resumen r on r.order_id = p.id
  ),
  pendiente as (
    select c.id, c.mon, c.cat,
           sum(greatest(l.q - l.e, 0) * l.unit_price * (1 - coalesce(l.discount_pct, 0) / 100))
             * (1 - coalesce(c.discount_pct, 0) / 100) as imp
      from clas c join lin l on l.order_id = c.id
     where c.cat in ('sin_entrega', 'parcial')
     group by c.id, c.mon, c.cat, c.discount_pct
  )
  select 'rango_actual'::text, 'actual'::text, v_mes, v_act_hasta, null::text, null::text,
         0::bigint, null::numeric, null::bigint, null::numeric, null::bigint, null::bigint
  union all select 'rango_anterior', 'anterior', v_ant_ini, v_ant_hasta, null, null, 0, null, null, null, null, null
  union all select 'rango_12m', '12m', v_serie_ini, v_act_hasta, null, null, 0, null, null, null, null, null

  -- cotizaciones abiertas, hoy, por antigüedad y moneda
  union all
  select 'cotizaciones_abiertas', 'hoy', null, null,
         case when v_hoy - c.quote_date <= 30 then 'hasta_30'
              when v_hoy - c.quote_date <= 90 then '31_90'
              else 'mas_90' end,
         c.mon, count(*), coalesce(sum(c.total), 0), null, null, null,
         count(*) filter (where c.status = 'accepted')
    from cot c
   where c.status in ('sent', 'accepted') and not c.conv
   group by 5, 6

  -- conversión por cohorte y moneda de la cotización
  union all
  select 'conversion', t.p, t.d, t.h, null, c.mon,
         count(*), coalesce(sum(c.total), 0),
         count(*) filter (where c.conv), coalesce(sum(c.total) filter (where c.conv), 0),
         count(*) filter (where not c.conv and c.status in ('sent', 'accepted')),
         count(*) filter (where c.status = 'accepted')
    from cot c join tramos t on c.quote_date between t.d and t.h
   where c.status <> 'draft'
   group by t.p, t.d, t.h, c.mon
  -- ...y sólo cantidades, todas las monedas (una fila por tramo, aunque sea 0)
  union all
  select 'conversion', t.p, t.d, t.h, null, 'TODAS',
         count(c.id), null,
         count(c.id) filter (where c.conv), null,
         count(c.id) filter (where not c.conv and c.status in ('sent', 'accepted')),
         count(c.id) filter (where c.status = 'accepted')
    from tramos t left join cot c on c.quote_date between t.d and t.h and c.status <> 'draft'
   group by t.p, t.d, t.h

  -- inconsistencias (siempre una fila por tipo)
  union all
  select 'inconsistencias', 'todos', null, null, 'moneda_distinta', null,
         count(*) filter (where c.conv and c.mon_dist), null, null, null, null, null
    from cot c
  union all
  select 'inconsistencias', 'todos', null, null, 'convertida_desde_borrador', null,
         count(*) filter (where c.conv and c.status = 'draft'), null, null, null, null, null
    from cot c

  -- cumplimiento por cohorte de pedido
  union all
  select 'cumplimiento', t.p, t.d, t.h, c.cat, null, count(*), null, null, null, null, null
    from clas c join tramos t on c.order_date between t.d and t.h
   group by t.p, t.d, t.h, c.cat
  union all
  select 'cumplimiento', 'todos', null, null, c.cat, null, count(*), null, null, null, null, null
    from clas c
   group by c.cat

  -- pedidos pendientes de completar, hoy, con importe pendiente neto
  union all
  select 'pedidos_pendientes', 'todos', null, null, p.cat, p.mon,
         count(*), round(coalesce(sum(p.imp), 0), 4), null, null, null, null
    from pendiente p
   group by p.cat, p.mon;
end
$$;

revoke all on function public.informe_pipeline_comercial(uuid, date) from public, anon;
grant execute on function public.informe_pipeline_comercial(uuid, date) to authenticated;
