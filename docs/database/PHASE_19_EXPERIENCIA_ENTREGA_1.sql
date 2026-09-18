-- ============================================================================
-- Fase 19 · Experiencia comercial · Entrega 1 — Cliente 360
--
-- Proyecto: uaxcfufvapzulqvynanp.
--
-- 0 tablas nuevas, 0 columnas nuevas, 0 índices nuevos. **Una** función nueva
-- de sólo lectura.
--
-- Qué resuelve: la ficha rápida necesita identidad + KPIs + doce meses +
-- últimos documentos + productos recientes de un cliente. Hoy eso son cinco
-- llamadas (`resumen_cliente`, `totales_por_moneda_cliente`,
-- `actividad_mensual_cliente`, `documentos_del_cliente`,
-- `productos_del_cliente`), cada una con su propio viaje y su propio recorrido
-- de las tres tablas de Ventas. Al cambiar de cliente en una lista, eso son
-- cinco carreras en vuelo por cada fila que se toca.
--
-- `security invoker` a propósito, igual que las cinco que reemplaza: hereda
-- `customers_select` y las policies de Ventas. Un vendedor que no ve al cliente
-- no obtiene sus números aunque conozca el uuid; no hace falta un
-- `security definer` con comprobaciones a mano, que es justo donde se cuelan
-- los agujeros.
--
-- Lo que NO hace, y es deliberado:
--   · no suma monedas. Cada KPI viene desagregado por `currency_code` y la
--     pantalla los muestra separados;
--   · no inventa «facturado»: no hay módulo de facturación, así que no hay
--     ninguna clave de facturación en el JSON;
--   · no devuelve el historial entero: doce meses de serie, cinco documentos
--     recientes y seis productos. Lo demás vive en la ficha completa.
-- ============================================================================

begin;

-- ── Cliente 360, en una sola llamada ───────────────────────────────────────
--
-- Devuelve `null` —no una estructura vacía— cuando el cliente no existe o el
-- actor no puede verlo: el `join` contra `c` no encuentra fila y el `select`
-- final no devuelve ninguna. La pantalla distingue «no hay datos» de «no
-- podés ver este cliente» por eso.
create or replace function public.resumen_cliente_360(
  p_customer uuid,
  p_meses int default 12
) returns jsonb
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
with c as (
  select * from customers where id = p_customer
),
ventana as (
  select date_trunc('month', current_date)::date as mes_actual,
         (date_trunc('month', current_date) - interval '1 month')::date as mes_anterior,
         (date_trunc('month', current_date)
          - ((greatest(1, least(coalesce(p_meses, 12), 36)) - 1) || ' months')::interval)::date as desde
),
-- Las tres tablas de Ventas, una sola vez, con un vocabulario común. Todo lo
-- que sigue sale de acá: la serie, los KPIs, los recientes y los abiertos.
docs as (
  select 'cotizacion'::text as tipo, q.id, q.number as numero, q.quote_date as fecha,
         q.status as estado, null::text as entrega, q.currency_code as moneda, q.total
    from sales_quotes q join c on c.id = q.customer_id
  union all
  select 'pedido', o.id, o.number, o.order_date,
         o.commercial_status, o.fulfillment_status, o.currency_code, o.total
    from sales_orders o join c on c.id = o.customer_id
  union all
  select 'entrega', d.id, d.number, d.delivery_date,
         d.status, null, d.currency_code, d.total
    from deliveries d join c on c.id = d.customer_id
),
-- Un documento cancelado no es actividad. Los rechazados y vencidos SÍ quedan:
-- cotizar y perder es trabajo hecho, y borrarlo del gráfico da la impresión de
-- que no pasó nada ese mes.
vivos as (
  select * from docs where estado is distinct from 'cancelled'
),
serie as (
  select date_trunc('month', v.fecha)::date as mes, v.tipo, v.moneda,
         count(*) as documentos, sum(coalesce(v.total, 0)) as importe
    from vivos v, ventana w
   where v.fecha is not null and v.fecha >= w.desde
   group by 1, 2, 3
),
kpis as (
  -- Vendido = pedidos CONFIRMADOS. No cotizaciones, que no son ventas, y no
  -- facturas, que en este ERP todavía no existen.
  select 'vendido_mes' as clave, moneda, count(*) as documentos, sum(coalesce(total, 0)) as importe
    from vivos, ventana
   where tipo = 'pedido' and estado = 'confirmed' and fecha >= ventana.mes_actual
   group by moneda
  union all
  select 'vendido_mes_anterior', moneda, count(*), sum(coalesce(total, 0))
    from vivos, ventana
   where tipo = 'pedido' and estado = 'confirmed'
     and fecha >= ventana.mes_anterior and fecha < ventana.mes_actual
   group by moneda
  union all
  select 'cotizado_mes', moneda, count(*), sum(coalesce(total, 0))
    from vivos, ventana
   where tipo = 'cotizacion' and fecha >= ventana.mes_actual
   group by moneda
  union all
  select 'cotizado_mes_anterior', moneda, count(*), sum(coalesce(total, 0))
    from vivos, ventana
   where tipo = 'cotizacion'
     and fecha >= ventana.mes_anterior and fecha < ventana.mes_actual
   group by moneda
  union all
  -- Abierta = todavía puede pasar algo con ella. `accepted`, `rejected` y
  -- `expired` ya se resolvieron.
  select 'cotizaciones_abiertas', moneda, count(*), sum(coalesce(total, 0))
    from vivos
   where tipo = 'cotizacion' and estado in ('draft', 'sent')
   group by moneda
  union all
  -- Pendiente de entrega = confirmado y todavía no entregado del todo.
  select 'pedidos_por_entregar', moneda, count(*), sum(coalesce(total, 0))
    from vivos
   where tipo = 'pedido' and estado = 'confirmed'
     and coalesce(entrega, 'pending') <> 'delivered'
   group by moneda
),
-- El último de cada tipo. `distinct on` y no tres subconsultas: un solo
-- recorrido de `docs`, que ya está materializado.
recientes as (
  select distinct on (tipo) tipo, id, numero, fecha, estado, entrega, moneda, total
    from docs
   where fecha is not null
   order by tipo, fecha desc, numero desc
),
-- Qué compra este cliente. Se toma de las líneas de cotizaciones y pedidos
-- —que es donde está el precio que se le hizo— y se queda con la más reciente
-- de cada producto. El producto se identifica por `product_id` y, si la línea
-- no lo resolvió, por su SKU: si no, las líneas sin producto desaparecen.
lineas as (
  select coalesce(l.product_id::text, 'sku:' || coalesce(l.sku_snapshot, '?')) as clave,
         l.product_id, coalesce(l.sku_snapshot, p.sku) as sku,
         coalesce(l.name_snapshot, p.name) as nombre,
         'cotizacion'::text as origen,
         q.quote_date as fecha, l.quantity as cantidad, l.unit_price as precio,
         q.currency_code as moneda
    from sales_quotes q
    join c on c.id = q.customer_id
    join sales_quote_lines l on l.quote_id = q.id
    left join products p on p.id = l.product_id
   where coalesce(l.line_type, 'item') <> 'chapter'
     and q.status is distinct from 'cancelled'
  union all
  select coalesce(l.product_id::text, 'sku:' || coalesce(l.sku_snapshot, '?')),
         l.product_id, coalesce(l.sku_snapshot, p.sku),
         coalesce(l.name_snapshot, p.name),
         'pedido',
         o.order_date, l.quantity_ordered, l.unit_price, o.currency_code
    from sales_orders o
    join c on c.id = o.customer_id
    join sales_order_lines l on l.order_id = o.id
    left join products p on p.id = l.product_id
   where coalesce(l.line_type, 'item') <> 'chapter'
     and o.commercial_status is distinct from 'cancelled'
),
-- El desempate NO es arbitrario y esto importa: cotizar y pedir el mismo día
-- es lo normal —se cotiza y el cliente confirma—, y en ese empate gana el
-- PEDIDO. El precio que se cerró vale más que el que se ofreció.
productos as (
  select distinct on (clave) clave, product_id, sku, nombre, origen, fecha, cantidad, precio, moneda
    from lineas
   where fecha is not null
   order by clave, fecha desc, (origen = 'pedido') desc, precio desc nulls last
),
-- El contacto principal. `is_default` es la marca; si nadie la puso, no se
-- inventa uno: mostrar un contacto cualquiera como «principal» es peor que no
-- mostrar ninguno.
contacto as (
  select cc.id, cc.full_name, cc.role, cc.email, cc.phone
    from customer_contacts cc join c on c.id = cc.customer_id
   where cc.is_default and coalesce(cc.active, true)
   order by cc.updated_at desc nulls last
   limit 1
)
select jsonb_build_object(
  'cliente', jsonb_build_object(
    'id', c.id,
    'referencia', c.legacy_ref,
    'razon_social', c.legal_name,
    'nombre_comercial', c.trade_name,
    'cuit', c.tax_id,
    'rubro', c.industry,
    'tipo', c.customer_type,
    'estado', c.status,
    'dado_de_baja', c.deleted_at is not null,
    'necesita_revision', c.needs_review,
    'motivos_revision', c.review_reason,
    'emails', coalesce(c.emails, '{}'),
    'telefono', c.phone,
    'importado', c.imported_at is not null
  ),
  'comercial', jsonb_build_object(
    'vendedor_id', c.salesperson_id,
    'vendedor', (select pr.full_name from profiles pr where pr.id = c.salesperson_id),
    'moneda', c.default_currency,
    'condicion_pago', c.payment_terms,
    'tarifa_id', c.default_price_list_id,
    'tarifa', (select pl.name from price_lists pl where pl.id = c.default_price_list_id),
    'contacto', (select to_jsonb(x) from contacto x)
  ),
  'kpis', jsonb_build_object(
    'mes', (select mes_actual from ventana),
    'mes_anterior', (select mes_anterior from ventana),
    'valores', coalesce((
      select jsonb_agg(jsonb_build_object(
               'clave', k.clave, 'moneda', k.moneda,
               'documentos', k.documentos, 'importe', k.importe)
             order by k.clave, k.importe desc)
        from kpis k), '[]'::jsonb)
  ),
  'meses', coalesce((
    select jsonb_agg(jsonb_build_object(
             'mes', s.mes, 'tipo', s.tipo, 'moneda', s.moneda,
             'documentos', s.documentos, 'importe', s.importe)
           order by s.mes, s.tipo, s.moneda)
      from serie s), '[]'::jsonb),
  'recientes', coalesce((
    select jsonb_agg(jsonb_build_object(
             'tipo', r.tipo, 'id', r.id, 'numero', r.numero, 'fecha', r.fecha,
             'estado', r.estado, 'entrega', r.entrega, 'moneda', r.moneda, 'total', r.total)
           order by r.fecha desc)
      from recientes r), '[]'::jsonb),
  'productos', coalesce((
    select jsonb_agg(jsonb_build_object(
             'product_id', t.product_id, 'sku', t.sku, 'nombre', t.nombre,
             'origen', t.origen, 'fecha', t.fecha, 'cantidad', t.cantidad,
             'precio', t.precio, 'moneda', t.moneda)
           order by t.fecha desc, t.sku)
      from (select * from productos order by fecha desc, sku limit 6) t), '[]'::jsonb),
  'totales', jsonb_build_object(
    'cotizaciones', (select count(*) from docs where tipo = 'cotizacion'),
    'pedidos', (select count(*) from docs where tipo = 'pedido'),
    'entregas', (select count(*) from docs where tipo = 'entrega'),
    'ultima_actividad', (select max(fecha) from docs),
    'documentos_12m', (select count(*) from docs
                        where fecha >= current_date - interval '12 months')
  )
) from c;
$function$;

comment on function public.resumen_cliente_360(uuid, int) is
  'Ficha rápida del cliente en una sola llamada: identidad, comercial, KPIs por moneda, serie mensual, últimos documentos y productos recientes. security invoker: hereda customers_select.';

-- `anon` no: la ficha rápida es de la aplicación, no de la web pública.
revoke execute on function public.resumen_cliente_360(uuid, int) from public, anon;
grant execute on function public.resumen_cliente_360(uuid, int) to authenticated;

commit;

-- ============================================================================
-- ROLLBACK
--
-- Sin riesgo: la función es de sólo lectura y nada más la llama.
--
-- begin;
--   drop function if exists public.resumen_cliente_360(uuid, int);
-- commit;
-- ============================================================================
