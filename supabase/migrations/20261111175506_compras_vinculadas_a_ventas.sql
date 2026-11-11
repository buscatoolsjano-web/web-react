-- Fase 237: compras vinculadas a ventas.
--
-- «Quiero generar desde una cotización un pedido a proveedor para comprar lo
-- que esté pendiente, relacionarlo y ver cuándo va a llegar. Compras se tiene
-- que sumar a la trazabilidad de todo el circuito.» Y: «a veces se compra de
-- más para ya tener: que se entienda QUÉ es lo pendiente y QUÉ se compra para
-- stock».
--
-- El vínculo vive EN la línea del pedido de compra (y no en una tabla aparte)
-- porque `guardarLineas` reemplaza las líneas al editar: viaja con ellas.
--   · sales_quote_line_id / sales_order_line_id: a qué línea de venta cubre.
--   · quantity_for_sale: cuánto de esta línea es PARA ESA VENTA. El resto
--     (quantity − quantity_for_sale) es para stock.
-- Si la cotización después pasa a pedido, el pedido de venta encuentra la
-- compra por `sales_order_lines.quote_line_id`: el vínculo no se rehace.

alter table public.purchase_order_lines
  add column if not exists sales_quote_line_id uuid
    references public.sales_quote_lines(id) on delete set null,
  add column if not exists sales_order_line_id uuid
    references public.sales_order_lines(id) on delete set null,
  add column if not exists quantity_for_sale numeric;

alter table public.purchase_order_lines
  drop constraint if exists purchase_order_lines_quantity_for_sale_check;
alter table public.purchase_order_lines
  add constraint purchase_order_lines_quantity_for_sale_check check (
    quantity_for_sale is null
    or (
      quantity_for_sale >= 0
      and quantity_for_sale <= quantity
      and (sales_quote_line_id is not null or sales_order_line_id is not null)
    )
  );

create index if not exists purchase_order_lines_sales_quote_line_idx
  on public.purchase_order_lines (sales_quote_line_id) where sales_quote_line_id is not null;
create index if not exists purchase_order_lines_sales_order_line_idx
  on public.purchase_order_lines (sales_order_line_id) where sales_order_line_id is not null;

comment on column public.purchase_order_lines.quantity_for_sale is
  'Cuánto de esta línea es para la venta vinculada; el resto es para stock (Fase 237).';

-- El abastecimiento de una venta: por cada línea, cuánto se vendió, cuánto ya
-- se pidió a proveedores PARA ESTA VENTA, el stock disponible, lo que falta, y
-- las compras con su estado y llegada estimada.
--
-- SECURITY INVOKER: corre con la RLS de quien pregunta (sólo ve su empresa).
create or replace function public.abastecimiento_de_venta(p_tipo text, p_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with lineas_venta as (
    select ql.id, ql.line_no, ql.product_id, ql.sku_snapshot, ql.name_snapshot,
           ql.quantity as vendido, ql.company_id,
           array[ql.id] as ids_cotizacion, array[]::uuid[] as ids_pedido
      from sales_quote_lines ql
     where p_tipo = 'cotizacion' and ql.quote_id = p_id
       and coalesce(ql.line_type, 'item') <> 'chapter'
    union all
    select ol.id, ol.line_no, ol.product_id, ol.sku_snapshot, ol.name_snapshot,
           ol.quantity_ordered, ol.company_id,
           case when ol.quote_line_id is null then array[]::uuid[] else array[ol.quote_line_id] end,
           array[ol.id]
      from sales_order_lines ol
     where p_tipo = 'pedido' and ol.order_id = p_id
       and coalesce(ol.line_type, 'item') <> 'chapter'
  ),
  compras as (
    select lv.id as linea_venta_id,
           po.id as pedido_id, po.number, po.status, po.receipt_status, po.expected_date,
           pl.quantity, coalesce(pl.quantity_for_sale, 0) as para_venta,
           coalesce((select sum(gl.quantity)
                       from goods_receipt_lines gl
                       join goods_receipts g on g.id = gl.goods_receipt_id
                      where gl.purchase_order_line_id = pl.id and g.status = 'confirmed'), 0) as recibido
      from lineas_venta lv
      join purchase_order_lines pl
        on pl.sales_quote_line_id = any (lv.ids_cotizacion)
        or pl.sales_order_line_id = any (lv.ids_pedido)
      join purchase_orders po on po.id = pl.purchase_order_id
     where po.status <> 'cancelled'
  ),
  stock as (
    select b.product_id, sum(b.on_hand - b.reserved) as disponible
      from stock_balances b
     where b.product_id in (select product_id from lineas_venta where product_id is not null)
       and b.company_id in (select company_id from lineas_venta)
     group by b.product_id
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'linea_id', lv.id,
      'linea_no', lv.line_no,
      'producto_id', lv.product_id,
      'sku', lv.sku_snapshot,
      'nombre', lv.name_snapshot,
      'vendido', lv.vendido,
      'pedido_para_venta', coalesce((select sum(c.para_venta) from compras c where c.linea_venta_id = lv.id), 0),
      'stock_disponible', greatest(coalesce(s.disponible, 0), 0),
      'compras', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'pedido_id', c.pedido_id, 'numero', c.number, 'estado', c.status,
                 'estado_recepcion', c.receipt_status, 'llegada_estimada', c.expected_date,
                 'cantidad', c.quantity, 'para_venta', c.para_venta, 'recibido', c.recibido)
               order by c.expected_date nulls last, c.number)
          from compras c where c.linea_venta_id = lv.id), '[]'::jsonb)
    ) order by lv.line_no), '[]'::jsonb)
  from lineas_venta lv
  left join stock s on s.product_id = lv.product_id;
$$;

grant execute on function public.abastecimiento_de_venta(text, uuid) to authenticated;
