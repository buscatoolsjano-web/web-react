-- Fase 29 · E7 — La base de las facturas de venta.
--
-- `sales_invoices` y `sales_invoice_lines` existían desde la migración de
-- datos, vacías y sin forma de crear una: no había serie, ni autoridad de
-- numeración, ni función de emisión. Esto pone las tres cosas.
--
-- CÓMO CONVIVE CON TANGO FACTURA
--
-- El número fiscal lo da AFIP a través de Tango, no el ERP. Así que lo que
-- emite esta función es una factura en estado `draft` con un número INTERNO
-- (FAC-BTS00001): sirve para trabajar y para tener la cadena completa, y no
-- pretende ser el comprobante fiscal.
--
-- Ojo con dos cosas cuando se enchufe la API:
--
--  1 · `chk_invoice_numero_externo` exige que, si hay `external_number`, sea
--      IGUAL a `number`. O sea, el esquema asume que el número del sistema
--      externo ES el número del documento —así entró la migración de STEL—.
--      Al sincronizar con Tango hay que pisar `number` con el de Tango, o
--      relajar ese CHECK. No se puede guardar los dos distintos.
--
--  2 · `sales_invoices_external_source_check` sólo admite 'stel', 'web' e
--      'import'. Para marcar el origen Tango hay que ampliarlo.
--
-- Las dos quedan anotadas a propósito y NO se tocan acá: cambiarlas antes de
-- saber qué devuelve la API sería adivinar.
--
-- Idempotente: se puede correr dos veces.

-- ── 1 · La serie ───────────────────────────────────────────────────────────
insert into document_sequences (company_id, doc_type, series_code, prefix, padding, next_number, is_default, is_selectable)
select c.id, 'sales_invoice', 'FAC-BTS', 'FAC-BTS', 5, 1, true, true
  from companies c
 where not exists (
   select 1 from document_sequences s
    where s.company_id = c.id and s.doc_type = 'sales_invoice' and s.series_code = 'FAC-BTS');

-- ── 2 · Quién numera: el ERP, como el resto de Ventas desde la Fase 28 E13 ──
insert into document_numbering_authority (company_id, doc_type, authority, reason)
select c.id, 'sales_invoice', 'ERP', 'La factura nace en el ERP y después se replica a Tango'
  from companies c
 where not exists (
   select 1 from document_numbering_authority a
    where a.company_id = c.id and a.doc_type = 'sales_invoice');

-- ── 3 · La emisión ─────────────────────────────────────────────────────────
create or replace function public.crear_factura_desde_pedido(
  p_order uuid,
  p_fecha date default null,
  p_serie text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company  uuid;
  v_customer uuid;
  v_moneda   text;
  v_tc       numeric;
  v_numero   text;
  v_id       uuid;
  v_subtotal numeric := 0;
  v_impuesto numeric := 0;
begin
  select o.company_id, o.customer_id, o.currency_code, o.exchange_rate
    into v_company, v_customer, v_moneda, v_tc
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

  v_numero := next_document_number(v_company, 'sales_invoice', coalesce(p_serie, ''));

  insert into sales_invoices (
    company_id, number, customer_id, order_id, invoice_date,
    currency_code, exchange_rate, subtotal, tax_amount, total,
    status, external_source, created_by
  ) values (
    v_company, v_numero, v_customer, p_order, coalesce(p_fecha, current_date),
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
  --
  -- Verificado contra PDV01168 sin escribir: da 131,30 / 27,57 / 158,87,
  -- idéntico a lo que tiene el pedido.
  select coalesce(sum(round(x.neto, 2)), 0),
         coalesce(sum(round(x.neto * x.tasa / 100, 2)), 0)
    into v_subtotal, v_impuesto
    from (select l.quantity * l.unit_price * (1 - coalesce(l.discount_pct, 0) / 100) as neto,
                 coalesce(l.tax_rate_snapshot, 0) as tasa
            from sales_invoice_lines l where l.invoice_id = v_id) x;

  update sales_invoices
     set subtotal = v_subtotal, tax_amount = v_impuesto, total = v_subtotal + v_impuesto
   where id = v_id;

  return jsonb_build_object('id', v_id, 'numero', v_numero);
end $$;

grant execute on function public.crear_factura_desde_pedido(uuid, date, text) to authenticated;
