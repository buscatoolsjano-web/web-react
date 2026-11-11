-- Fase 238 (corrección): `least(NULL, x)` en Postgres devuelve `x` (ignora
-- los nulos), así que una línea de compra SIN vínculo a una venta se contaba
-- entera como «para venta». Se pasa por `coalesce(…, 0)` antes del `least`.
create or replace function public.pendiente_de_recibir(p_company uuid, p_desde date default null)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with lineas as (
    select pl.id, pl.product_id, pl.sku_snapshot, pl.name_snapshot,
           po.id as pedido_id, po.number, po.order_date, po.expected_date, s.legal_name as proveedor,
           pl.quantity as pedido, least(coalesce(pl.quantity_for_sale, 0), pl.quantity) as para_venta,
           coalesce(qd.number, qq.number) as venta,
           coalesce((select sum(gl.quantity)
                       from goods_receipt_lines gl
                       join goods_receipts g on g.id = gl.goods_receipt_id
                      where gl.purchase_order_line_id = pl.id and g.status = 'confirmed'), 0) as recibido
      from purchase_order_lines pl
      join purchase_orders po on po.id = pl.purchase_order_id
      left join suppliers s on s.id = po.supplier_id
      left join sales_order_lines sol on sol.id = pl.sales_order_line_id
      left join sales_orders qd on qd.id = sol.order_id
      left join sales_quote_lines sql_ on sql_.id = pl.sales_quote_line_id
      left join sales_quotes qq on qq.id = sql_.quote_id
     where po.company_id = p_company
       and po.status = 'confirmed'
       and coalesce(po.receipt_status, 'pending') <> 'received'
       and (p_desde is null or po.order_date >= p_desde)
       and pl.line_type <> 'chapter'
       and pl.product_id is not null
  ),
  vivos as (
    select l.*, greatest(l.pedido - l.recibido, 0) as pendiente,
           greatest(l.para_venta - l.recibido, 0) as pendiente_para_venta
      from lineas l
     where l.pedido - l.recibido > 0
  )
  select coalesce(jsonb_agg(x order by (x->>'atrasado')::boolean desc, x->>'proxima_llegada' nulls last), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'producto_id', v.product_id, 'sku', min(v.sku_snapshot), 'nombre', min(v.name_snapshot),
               'pedido', sum(v.pedido), 'recibido', sum(v.recibido), 'pendiente', sum(v.pendiente),
               'para_ventas', sum(least(v.pendiente_para_venta, v.pendiente)),
               'para_stock', sum(v.pendiente - least(v.pendiente_para_venta, v.pendiente)),
               'proxima_llegada', min(v.expected_date),
               'atrasado', coalesce(bool_or(v.expected_date < current_date), false),
               'documentos', jsonb_agg(jsonb_build_object(
                 'pedido_id', v.pedido_id, 'numero', v.number, 'fecha', v.order_date,
                 'proveedor', v.proveedor, 'llegada_estimada', v.expected_date,
                 'pedido', v.pedido, 'recibido', v.recibido, 'pendiente', v.pendiente,
                 'para_venta', least(v.pendiente_para_venta, v.pendiente), 'venta', v.venta)
                 order by v.expected_date nulls last, v.number)) as x
        from vivos v
       group by v.product_id
    ) t;
$$;

create or replace function public.pendiente_de_entregar(p_company uuid, p_desde date default null)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with lineas as (
    select ol.id, ol.product_id, ol.sku_snapshot, ol.name_snapshot, ol.quote_line_id,
           o.id as pedido_id, o.number, o.order_date, c.legal_name as cliente,
           ol.quantity_ordered as pedido,
           coalesce((select sum(dl.quantity)
                       from delivery_lines dl
                       join deliveries d on d.id = dl.delivery_id
                      where dl.order_line_id = ol.id and d.status in ('shipped', 'delivered')), 0) as entregado
      from sales_order_lines ol
      join sales_orders o on o.id = ol.order_id
      left join customers c on c.id = o.customer_id
     where o.company_id = p_company
       and o.commercial_status = 'confirmed'
       and coalesce(o.fulfillment_status, 'pending') <> 'delivered'
       and (p_desde is null or o.order_date >= p_desde)
       and coalesce(ol.line_type, 'item') <> 'chapter'
       and ol.product_id is not null
  ),
  pendientes as (
    select l.*, greatest(l.pedido - l.entregado, 0) as pendiente,
           -- Lo pedido a proveedores para esta línea (directo o por la
           -- cotización de origen) que todavía no llegó.
           coalesce((select sum(greatest(least(coalesce(pl.quantity_for_sale, 0), pl.quantity)
                          - coalesce((select sum(gl.quantity)
                                        from goods_receipt_lines gl
                                        join goods_receipts g on g.id = gl.goods_receipt_id
                                       where gl.purchase_order_line_id = pl.id and g.status = 'confirmed'), 0), 0))
                       from purchase_order_lines pl
                       join purchase_orders po on po.id = pl.purchase_order_id
                      where po.status <> 'cancelled'
                        and (pl.sales_order_line_id = l.id
                             or (l.quote_line_id is not null and pl.sales_quote_line_id = l.quote_line_id))), 0) as en_camino
      from lineas l
  ),
  vivos as (select * from pendientes where pendiente > 0),
  stock as (
    select b.product_id, greatest(sum(b.on_hand - b.reserved), 0) as disponible
      from stock_balances b
     where b.company_id = p_company and b.product_id in (select product_id from vivos)
     group by b.product_id
  ),
  por_producto as (
    select v.product_id,
           min(v.sku_snapshot) as sku, min(v.name_snapshot) as nombre,
           sum(v.pedido) as pedido, sum(v.entregado) as entregado, sum(v.pendiente) as pendiente,
           least(sum(v.en_camino), sum(v.pendiente)) as en_camino,
           jsonb_agg(jsonb_build_object(
             'pedido_id', v.pedido_id, 'numero', v.number, 'fecha', v.order_date, 'cliente', v.cliente,
             'pedido', v.pedido, 'entregado', v.entregado, 'pendiente', v.pendiente,
             'en_camino', least(v.en_camino, v.pendiente)) order by v.order_date, v.number) as documentos
      from vivos v
     group by v.product_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'producto_id', p.product_id, 'sku', p.sku, 'nombre', p.nombre,
           'pedido', p.pedido, 'entregado', p.entregado, 'pendiente', p.pendiente,
           'stock', coalesce(s.disponible, 0), 'en_camino', p.en_camino,
           'falta_pedir', greatest(p.pendiente - coalesce(s.disponible, 0) - p.en_camino, 0),
           'documentos', p.documentos)
         order by greatest(p.pendiente - coalesce(s.disponible, 0) - p.en_camino, 0) desc, p.pendiente desc), '[]'::jsonb)
    from por_producto p
    left join stock s on s.product_id = p.product_id;
$$;
