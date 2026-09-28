-- Fase 29 · E3 — Huella determinística por tabla (READ ONLY).
--
-- Validar una migración por count(*) no alcanza: una tabla puede tener la
-- misma cantidad de filas y contenido distinto. Esto suma un hash POR FILA,
-- así que el resultado no depende del orden de lectura ni del plan de
-- consulta: Ohio y São Paulo tienen que dar exactamente lo mismo.
--
-- La zona horaria y la precisión de floats se fijan a mano porque el texto de
-- un timestamptz cambia con el TimeZone de la sesión: sin esto, dos bases
-- idénticas darían huellas distintas y parecería que la migración falló.
--
-- No escribe nada. Se corre igual en el origen y en el destino, y se comparan
-- las dos salidas.

set local timezone to 'UTC';
set local extra_float_digits to 0;

select 'products' as tabla, count(*)::bigint as filas,
       coalesce(md5(sum(('x'||substr(md5(x.*::text),1,8))::bit(32)::bigint)::text), 'vacia') as huella
  from public.products x
union all
select 'customers' as tabla, count(*)::bigint as filas,
       coalesce(md5(sum(('x'||substr(md5(x.*::text),1,8))::bit(32)::bigint)::text), 'vacia') as huella
  from public.customers x
union all
select 'sales_quotes' as tabla, count(*)::bigint as filas,
       coalesce(md5(sum(('x'||substr(md5(x.*::text),1,8))::bit(32)::bigint)::text), 'vacia') as huella
  from public.sales_quotes x
union all
select 'sales_quote_lines' as tabla, count(*)::bigint as filas,
       coalesce(md5(sum(('x'||substr(md5(x.*::text),1,8))::bit(32)::bigint)::text), 'vacia') as huella
  from public.sales_quote_lines x
union all
select 'sales_orders' as tabla, count(*)::bigint as filas,
       coalesce(md5(sum(('x'||substr(md5(x.*::text),1,8))::bit(32)::bigint)::text), 'vacia') as huella
  from public.sales_orders x
union all
select 'sales_order_lines' as tabla, count(*)::bigint as filas,
       coalesce(md5(sum(('x'||substr(md5(x.*::text),1,8))::bit(32)::bigint)::text), 'vacia') as huella
  from public.sales_order_lines x
union all
select 'deliveries' as tabla, count(*)::bigint as filas,
       coalesce(md5(sum(('x'||substr(md5(x.*::text),1,8))::bit(32)::bigint)::text), 'vacia') as huella
  from public.deliveries x
union all
select 'delivery_lines' as tabla, count(*)::bigint as filas,
       coalesce(md5(sum(('x'||substr(md5(x.*::text),1,8))::bit(32)::bigint)::text), 'vacia') as huella
  from public.delivery_lines x
union all
select 'stock_movements' as tabla, count(*)::bigint as filas,
       coalesce(md5(sum(('x'||substr(md5(x.*::text),1,8))::bit(32)::bigint)::text), 'vacia') as huella
  from public.stock_movements x
union all
select 'stock_balances' as tabla, count(*)::bigint as filas,
       coalesce(md5(sum(('x'||substr(md5(x.*::text),1,8))::bit(32)::bigint)::text), 'vacia') as huella
  from public.stock_balances x
union all
select 'product_prices' as tabla, count(*)::bigint as filas,
       coalesce(md5(sum(('x'||substr(md5(x.*::text),1,8))::bit(32)::bigint)::text), 'vacia') as huella
  from public.product_prices x
union all
select 'product_images' as tabla, count(*)::bigint as filas,
       coalesce(md5(sum(('x'||substr(md5(x.*::text),1,8))::bit(32)::bigint)::text), 'vacia') as huella
  from public.product_images x
union all
select 'product_equivalences' as tabla, count(*)::bigint as filas,
       coalesce(md5(sum(('x'||substr(md5(x.*::text),1,8))::bit(32)::bigint)::text), 'vacia') as huella
  from public.product_equivalences x
union all
select 'brands' as tabla, count(*)::bigint as filas,
       coalesce(md5(sum(('x'||substr(md5(x.*::text),1,8))::bit(32)::bigint)::text), 'vacia') as huella
  from public.brands x
union all
select 'product_categories' as tabla, count(*)::bigint as filas,
       coalesce(md5(sum(('x'||substr(md5(x.*::text),1,8))::bit(32)::bigint)::text), 'vacia') as huella
  from public.product_categories x
union all
select 'product_attribute_definitions' as tabla, count(*)::bigint as filas,
       coalesce(md5(sum(('x'||substr(md5(x.*::text),1,8))::bit(32)::bigint)::text), 'vacia') as huella
  from public.product_attribute_definitions x
union all
select 'customer_contacts' as tabla, count(*)::bigint as filas,
       coalesce(md5(sum(('x'||substr(md5(x.*::text),1,8))::bit(32)::bigint)::text), 'vacia') as huella
  from public.customer_contacts x
union all
select 'customer_addresses' as tabla, count(*)::bigint as filas,
       coalesce(md5(sum(('x'||substr(md5(x.*::text),1,8))::bit(32)::bigint)::text), 'vacia') as huella
  from public.customer_addresses x
union all
select 'company_memberships' as tabla, count(*)::bigint as filas,
       coalesce(md5(sum(('x'||substr(md5(x.*::text),1,8))::bit(32)::bigint)::text), 'vacia') as huella
  from public.company_memberships x
union all
select 'profiles' as tabla, count(*)::bigint as filas,
       coalesce(md5(sum(('x'||substr(md5(x.*::text),1,8))::bit(32)::bigint)::text), 'vacia') as huella
  from public.profiles x
union all
select 'price_lists' as tabla, count(*)::bigint as filas,
       coalesce(md5(sum(('x'||substr(md5(x.*::text),1,8))::bit(32)::bigint)::text), 'vacia') as huella
  from public.price_lists x
union all
select 'document_sequences' as tabla, count(*)::bigint as filas,
       coalesce(md5(sum(('x'||substr(md5(x.*::text),1,8))::bit(32)::bigint)::text), 'vacia') as huella
  from public.document_sequences x
union all
select 'email_threads' as tabla, count(*)::bigint as filas,
       coalesce(md5(sum(('x'||substr(md5(x.*::text),1,8))::bit(32)::bigint)::text), 'vacia') as huella
  from public.email_threads x
union all
select 'email_thread_state' as tabla, count(*)::bigint as filas,
       coalesce(md5(sum(('x'||substr(md5(x.*::text),1,8))::bit(32)::bigint)::text), 'vacia') as huella
  from public.email_thread_state x
union all
select 'email_labels' as tabla, count(*)::bigint as filas,
       coalesce(md5(sum(('x'||substr(md5(x.*::text),1,8))::bit(32)::bigint)::text), 'vacia') as huella
  from public.email_labels x
union all
select 'chat_mensajes' as tabla, count(*)::bigint as filas,
       coalesce(md5(sum(('x'||substr(md5(x.*::text),1,8))::bit(32)::bigint)::text), 'vacia') as huella
  from public.chat_mensajes x
union all
select 'whatsapp_messages' as tabla, count(*)::bigint as filas,
       coalesce(md5(sum(('x'||substr(md5(x.*::text),1,8))::bit(32)::bigint)::text), 'vacia') as huella
  from public.whatsapp_messages x
union all
select 'warehouses' as tabla, count(*)::bigint as filas,
       coalesce(md5(sum(('x'||substr(md5(x.*::text),1,8))::bit(32)::bigint)::text), 'vacia') as huella
  from public.warehouses x
order by tabla;
