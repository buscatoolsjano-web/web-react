-- Índices que faltaban (2026-11-27). Relevamiento con pg_stat_statements y
-- pg_stat_user_tables: products se recorría entera 109.000 veces (5.000 millones
-- de filas leídas) y delivery_lines 30.000. Sólo agrega índices.
-- Medido como authenticated: página del catálogo 2.972 → 215 ms; historial de
-- un producto 430 → 83 ms; cotizaciones de un cliente 36 → 7 ms.

-- Recorrer el catálogo de una empresa paginando por id (sync STEL, exportar,
-- prerender del catálogo público): 1.880 llamadas a 132 ms.
create index if not exists products_company_id_id_idx on public.products (company_id, id);

-- Líneas de documentos por producto: historial comercial, último precio del
-- cliente, «En camino», emparejar OCs.
create index if not exists sales_quote_lines_product_idx on public.sales_quote_lines (product_id) where product_id is not null;
create index if not exists sales_order_lines_product_idx on public.sales_order_lines (product_id) where product_id is not null;
create index if not exists delivery_lines_product_idx on public.delivery_lines (product_id) where product_id is not null;
create index if not exists sales_invoice_lines_product_idx on public.sales_invoice_lines (product_id) where product_id is not null;
create index if not exists purchase_order_lines_product_idx on public.purchase_order_lines (product_id) where product_id is not null;
create index if not exists goods_receipt_lines_product_idx on public.goods_receipt_lines (product_id) where product_id is not null;
create index if not exists supplier_invoice_lines_product_idx on public.supplier_invoice_lines (product_id) where product_id is not null;

-- La cadena pedido → remito → factura, buscada sin empresa (triggers y RPC de
-- pendientes): delivery_lines se recorría entera por order_line_id.
create index if not exists delivery_lines_order_line_idx on public.delivery_lines (order_line_id) where order_line_id is not null;
create index if not exists sales_order_lines_quote_line_idx on public.sales_order_lines (quote_line_id) where quote_line_id is not null;
create index if not exists sales_invoice_lines_invoice_idx on public.sales_invoice_lines (invoice_id);
create index if not exists sales_invoice_lines_order_line_idx on public.sales_invoice_lines (order_line_id) where order_line_id is not null;
create index if not exists sales_invoice_lines_delivery_line_idx on public.sales_invoice_lines (delivery_line_id) where delivery_line_id is not null;

-- Cotizaciones de un cliente / de un contacto (ficha del cliente, filtros).
create index if not exists sales_quotes_customer_idx on public.sales_quotes (customer_id);
create index if not exists sales_quotes_contact_idx on public.sales_quotes (contact_id) where contact_id is not null;

-- Equivalencias buscadas desde el producto equivalente.
create index if not exists product_equivalences_equivalent_idx on public.product_equivalences (equivalent_product_id);

analyze public.products, public.sales_quote_lines, public.sales_order_lines, public.delivery_lines,
        public.sales_invoice_lines, public.purchase_order_lines, public.goods_receipt_lines,
        public.supplier_invoice_lines, public.sales_quotes, public.product_equivalences;
