-- Fase 113 · Histórico comercial de un producto: las cotizaciones, pedidos y
-- notas de entrega donde aparece, con la cantidad y el precio de cada una.
-- SECURITY INVOKER (función SQL común): corre con la RLS de quien pregunta, así
-- que sólo devuelve documentos de sus empresas. El `order by` va por posición
-- porque en un UNION no se puede ordenar por el nombre de la columna de salida.
-- Aplicada con apply_migration el 2026-10-22.
create or replace function public.producto_historial_documentos(p_product uuid)
returns table (
  tipo text, doc_id uuid, numero text, fecha date, cliente text,
  moneda text, cantidad numeric, precio_unitario numeric, estado text
)
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select 'cotizacion'::text, q.id, q.number, q.quote_date, c.legal_name,
         q.currency_code, l.quantity, l.unit_price, q.status
    from sales_quote_lines l
    join sales_quotes q on q.id = l.quote_id
    left join customers c on c.id = q.customer_id
   where l.product_id = p_product and l.line_type = 'item'
  union all
  select 'pedido'::text, o.id, o.number, o.order_date, c.legal_name,
         o.currency_code, l.quantity_ordered, l.unit_price, o.commercial_status
    from sales_order_lines l
    join sales_orders o on o.id = l.order_id
    left join customers c on c.id = o.customer_id
   where l.product_id = p_product and l.line_type = 'item'
  union all
  select 'entrega'::text, d.id, d.number, d.delivery_date, c.legal_name,
         d.currency_code, l.quantity, l.unit_price, d.status
    from delivery_lines l
    join deliveries d on d.id = l.delivery_id
    left join customers c on c.id = d.customer_id
   where l.product_id = p_product
  order by 4 desc nulls last, 3 desc;
$$;
grant execute on function public.producto_historial_documentos(uuid) to authenticated;
