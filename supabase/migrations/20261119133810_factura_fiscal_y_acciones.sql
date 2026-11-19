-- Factura de venta: datos fiscales del cliente y lo que se puede hacer con ella.
--
-- 1. La condición frente al IVA del cliente (no existía): sin ella no se sabe
--    si corresponde factura A o B.
-- 2. `crear_factura_desde_pedido` ahora exige condición de IVA y CUIT (salvo
--    consumidor final y exterior), pone el vencimiento según la forma de pago
--    («30 DIAS F/F» → +30 días; «Contado» → el mismo día) y marca el pedido
--    como facturado.
-- 3. Acciones sobre la factura: anular un borrador (libera el pedido), marcarla
--    emitida con el número que dio Tango/AFIP y marcarla cobrada.

alter table public.customers
  add column if not exists tax_condition text;

alter table public.customers
  drop constraint if exists customers_tax_condition_check;
alter table public.customers
  add constraint customers_tax_condition_check check (
    tax_condition is null or tax_condition = any (array[
      'responsable_inscripto', 'monotributo', 'exento', 'consumidor_final', 'no_responsable', 'exterior'
    ])
  );

comment on column public.customers.tax_condition is
  'Condición frente al IVA: responsable_inscripto | monotributo | exento | consumidor_final | no_responsable | exterior. Decide factura A o B.';

-- Días de la forma de pago («30 DIAS F/F con ECHEQ» → 30; «Contado» → 0).
create or replace function app.dias_de_forma_de_pago(p text)
returns integer
language sql
immutable
as $$
  select case
    when p is null then null
    when p ~* 'contado' then 0
    else (regexp_match(p, '(\d+)\s*D[IÍ]AS', 'i'))[1]::integer
  end
$$;

create or replace function public.crear_factura_desde_pedido(p_order uuid, p_fecha date default null, p_serie text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_company  uuid;
  v_customer uuid;
  v_moneda   text;
  v_tc       numeric;
  v_terminos text;
  v_numero   text;
  v_id       uuid;
  v_fecha    date := coalesce(p_fecha, current_date);
  v_subtotal numeric := 0;
  v_impuesto numeric := 0;
  v_cond     text;
  v_cuit     text;
  v_nombre   text;
begin
  select o.company_id, o.customer_id, o.currency_code, o.exchange_rate, o.payment_terms
    into v_company, v_customer, v_moneda, v_tc, v_terminos
    from sales_orders o
   where o.id = p_order;

  if v_company is null then
    raise exception 'No existe ese pedido' using errcode = 'no_data_found';
  end if;

  -- La misma puerta que el resto de las escrituras de Ventas.
  if not (v_company = any (app.current_writer_company_ids())) then
    raise exception 'No podés facturar en esta empresa' using errcode = 'insufficient_privilege';
  end if;

  -- Un pedido, una factura. Facturar dos veces el mismo pedido es el error
  -- que más caro sale, así que se corta acá y no en la pantalla.
  if exists (select 1 from sales_invoices f where f.order_id = p_order) then
    raise exception 'Ese pedido ya tiene factura' using errcode = 'unique_violation';
  end if;

  -- Los datos fiscales del cliente: sin condición de IVA no se sabe si es A
  -- o B, y sin CUIT no se puede emitir (salvo consumidor final o exterior).
  select c.tax_condition, nullif(btrim(c.tax_id), ''), c.legal_name
    into v_cond, v_cuit, v_nombre
    from customers c where c.id = v_customer;

  if v_cond is null then
    raise exception 'datos_fiscales: % no tiene cargada la condición frente al IVA', v_nombre
      using errcode = 'check_violation', hint = 'cliente:' || v_customer;
  end if;
  if v_cuit is null and v_cond not in ('consumidor_final', 'exterior') then
    raise exception 'datos_fiscales: % no tiene CUIT', v_nombre
      using errcode = 'check_violation', hint = 'cliente:' || v_customer;
  end if;

  v_numero := next_document_number(v_company, 'sales_invoice', coalesce(p_serie, ''));

  insert into sales_invoices (
    company_id, number, customer_id, order_id, invoice_date, due_date,
    currency_code, exchange_rate, subtotal, tax_amount, total,
    status, external_source, created_by
  ) values (
    v_company, v_numero, v_customer, p_order, v_fecha,
    v_fecha + app.dias_de_forma_de_pago(v_terminos),
    v_moneda, v_tc, 0, 0, 0,
    'draft', 'web', auth.uid()
  ) returning id into v_id;

  -- Las líneas salen del pedido, con su snapshot: la factura tiene que poder
  -- leerse dentro de diez años aunque el producto ya no exista.
  insert into sales_invoice_lines (
    company_id, invoice_id, order_line_id, product_id,
    sku_snapshot, name_snapshot, quantity, unit_price,
    discount_pct, tax_treatment, tax_rate_snapshot
  )
  select v_company, v_id, l.id, l.product_id,
         l.sku_snapshot, l.name_snapshot, l.quantity_ordered, l.unit_price,
         coalesce(l.discount_pct, 0), coalesce(l.tax_treatment, 'vat_21'),
         coalesce(l.tax_rate_snapshot, 0)
    from sales_order_lines l
   where l.order_id = p_order
     and l.line_type <> 'chapter'
     and l.quantity_ordered > 0;

  -- Totales con la MISMA cuenta que el resto de los documentos: neto con
  -- descuento de línea, y el impuesto sobre ese neto.
  select coalesce(sum(round(x.neto, 2)), 0),
         coalesce(sum(round(x.neto * x.tasa / 100, 2)), 0)
    into v_subtotal, v_impuesto
    from (select l.quantity * l.unit_price * (1 - coalesce(l.discount_pct, 0) / 100) as neto,
                 coalesce(l.tax_rate_snapshot, 0) as tasa
            from sales_invoice_lines l where l.invoice_id = v_id) x;

  update sales_invoices
     set subtotal = v_subtotal, tax_amount = v_impuesto, total = v_subtotal + v_impuesto
   where id = v_id;

  -- El pedido queda facturado (antes seguía en «not_invoiced»).
  update sales_orders set invoicing_status = 'invoiced', updated_at = now(), updated_by = auth.uid()
   where id = p_order;

  return jsonb_build_object('id', v_id, 'numero', v_numero);
end $function$;

-- Anular un BORRADOR: no es un comprobante fiscal todavía, así que se borra y
-- el pedido vuelve a quedar para facturar. Una emitida no se anula acá: lleva
-- nota de crédito en AFIP.
create or replace function public.factura_venta_anular_borrador(p_invoice uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  f record;
begin
  select * into f from sales_invoices where id = p_invoice for update;
  if not found then
    raise exception 'No existe esa factura' using errcode = 'no_data_found';
  end if;
  if not (f.company_id = any (app.current_writer_company_ids())) then
    raise exception 'No podés modificar facturas en esta empresa' using errcode = 'insufficient_privilege';
  end if;
  if f.status <> 'draft' then
    raise exception 'Sólo se anula un borrador; una factura emitida se anula con nota de crédito'
      using errcode = 'check_violation';
  end if;

  delete from sales_invoice_lines where invoice_id = p_invoice;
  delete from sales_invoices where id = p_invoice;
  if f.order_id is not null then
    update sales_orders set invoicing_status = 'not_invoiced', updated_at = now(), updated_by = auth.uid()
     where id = f.order_id;
  end if;
  return jsonb_build_object('pedido_id', f.order_id, 'numero', f.number);
end $$;

-- Marcar emitida con el número fiscal que dio Tango/AFIP. Hasta que la API
-- esté enchufada, es la forma de cerrar la factura en el ERP. El número
-- interno queda en `original_number`.
create or replace function public.factura_venta_marcar_emitida(p_invoice uuid, p_numero_fiscal text, p_fecha date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  f record;
  v_num text := nullif(btrim(p_numero_fiscal), '');
begin
  select * into f from sales_invoices where id = p_invoice for update;
  if not found then
    raise exception 'No existe esa factura' using errcode = 'no_data_found';
  end if;
  if not (f.company_id = any (app.current_writer_company_ids())) then
    raise exception 'No podés modificar facturas en esta empresa' using errcode = 'insufficient_privilege';
  end if;
  if f.status <> 'draft' then
    raise exception 'La factura ya no está en borrador' using errcode = 'check_violation';
  end if;
  if v_num is null then
    raise exception 'Falta el número fiscal' using errcode = 'check_violation';
  end if;
  if exists (select 1 from sales_invoices x where x.company_id = f.company_id and x.number = v_num and x.id <> f.id) then
    raise exception 'Ya hay otra factura con el número %', v_num using errcode = 'unique_violation';
  end if;

  update sales_invoices
     set status = 'issued',
         original_number = coalesce(original_number, number),
         number = v_num,
         external_number = v_num,
         external_status = 'manual',
         invoice_date = coalesce(p_fecha, invoice_date),
         updated_at = now(),
         updated_by = auth.uid()
   where id = p_invoice;
  return jsonb_build_object('id', p_invoice, 'numero', v_num);
end $$;

-- Marcar cobrada (y el pedido como pagado).
create or replace function public.factura_venta_marcar_cobrada(p_invoice uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  f record;
begin
  select * into f from sales_invoices where id = p_invoice for update;
  if not found then
    raise exception 'No existe esa factura' using errcode = 'no_data_found';
  end if;
  if not (f.company_id = any (app.current_writer_company_ids())) then
    raise exception 'No podés modificar facturas en esta empresa' using errcode = 'insufficient_privilege';
  end if;
  if f.status <> 'issued' then
    raise exception 'Sólo se cobra una factura emitida' using errcode = 'check_violation';
  end if;

  update sales_invoices set status = 'paid', updated_at = now(), updated_by = auth.uid() where id = p_invoice;
  if f.order_id is not null then
    update sales_orders set payment_status = 'paid', updated_at = now(), updated_by = auth.uid() where id = f.order_id;
  end if;
  return jsonb_build_object('id', p_invoice);
end $$;

revoke all on function public.factura_venta_anular_borrador(uuid) from public, anon;
revoke all on function public.factura_venta_marcar_emitida(uuid, text, date) from public, anon;
revoke all on function public.factura_venta_marcar_cobrada(uuid) from public, anon;
grant execute on function public.factura_venta_anular_borrador(uuid) to authenticated;
grant execute on function public.factura_venta_marcar_emitida(uuid, text, date) to authenticated;
grant execute on function public.factura_venta_marcar_cobrada(uuid) to authenticated;
grant execute on function app.dias_de_forma_de_pago(text) to authenticated;
