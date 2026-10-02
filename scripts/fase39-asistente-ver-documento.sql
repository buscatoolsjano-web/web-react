-- Fase 39 · `asistente_ver_documento`: estaba rota y no devolvía lo que prometía
--
-- CÓMO APARECIÓ
--
-- Probando si el asistente deriva bien entre agentes. A «¿a cuánto le
-- cotizamos a Mirgor y nos queda stock?» contestó que no podía ver el detalle
-- de productos, después de llamar a `ver_documento` SEIS veces. Era cierto: la
-- herramienta fallaba en todas.
--
-- DOS BUGS, NO UNO
--
-- 1. Reventaba siempre. Resolvía el número contra `purchase_orders.order_number`
--    y `goods_receipts.receipt_number`, dos columnas que no existen: las dos
--    tablas usan `number`. Como el UNION se evalúa entero, el error saltaba
--    para CUALQUIER documento, también una cotización.
--
--    El ejecutor traduce los errores de Postgres a «La consulta falló, probá de
--    otra forma» para no filtrarle nombres de tablas al modelo. Correcto en
--    general, pero acá convirtió un bug duro en algo que el agente leía como
--    «probá de nuevo» — y por eso reintentaba hasta quedarse sin vueltas.
--
-- 2. Aunque no reventara, no servía. Devolvía `{tipo, numero, cadena}`: ni la
--    cabecera ni las líneas, que es justo lo que su descripción promete y lo
--    único que se le pide cuando alguien nombra una cotización.
--
-- Ahora devuelve cabecera (cliente, fecha, estado, moneda, total) y líneas
-- (SKU, producto, cantidad, precio) para los cinco tipos. Los documentos de
-- compra llevan cabecera mínima a propósito: sus columnas no se verificaron
-- una por una y no se inventan.
--
-- Sigue siendo SECURITY INVOKER: la RLS decide qué documentos se ven.
--
-- Verificado sobre COTI02553: cliente «Grupo Mirgor S.A.», USD 6.655, estado
-- `sent`, una línea PRO00009 × 2 a USD 2.750. El asistente la lee y la informa.

create or replace function public.asistente_ver_documento(p_company uuid, p_numero text)
 returns jsonb language plpgsql stable
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_num text := upper(btrim(coalesce(p_numero, '')));
  v_id uuid; v_tipo text; v_cadena jsonb; v_cab jsonb; v_lin jsonb;
begin
  if v_num = '' then return jsonb_build_object('error', 'Falta el número del documento.'); end if;

  select id, tipo into v_id, v_tipo from (
    select id, 'cotizacion' as tipo, upper(number) as n from sales_quotes   where company_id = p_company
    union all select id, 'pedido',        upper(number) from sales_orders    where company_id = p_company
    union all select id, 'factura',       upper(number) from sales_invoices  where company_id = p_company
    union all select id, 'pedido_compra', upper(number) from purchase_orders where company_id = p_company
    union all select id, 'recepcion',     upper(number) from goods_receipts  where company_id = p_company
  ) t where n = v_num limit 1;

  if v_id is null then
    return jsonb_build_object('error',
      'No existe ningún documento con el número «' || p_numero || '».');
  end if;

  if v_tipo = 'cotizacion' then
    select jsonb_build_object('numero', q.number, 'fecha', q.quote_date, 'estado', q.status,
             'moneda', q.currency_code, 'total', q.total,
             'cliente', (select coalesce(c.trade_name, c.legal_name) from customers c where c.id = q.customer_id))
      into v_cab from sales_quotes q where q.id = v_id;
    select jsonb_agg(jsonb_build_object('sku', l.sku_snapshot, 'producto', l.name_snapshot,
             'cantidad', l.quantity, 'precio_unitario', l.unit_price) order by l.line_no)
      into v_lin from sales_quote_lines l where l.quote_id = v_id;

  elsif v_tipo = 'pedido' then
    select jsonb_build_object('numero', o.number, 'fecha', o.order_date, 'estado', o.commercial_status,
             'moneda', o.currency_code, 'total', o.total,
             'cliente', (select coalesce(c.trade_name, c.legal_name) from customers c where c.id = o.customer_id))
      into v_cab from sales_orders o where o.id = v_id;
    select jsonb_agg(jsonb_build_object('sku', l.sku_snapshot, 'producto', l.name_snapshot,
             'cantidad', l.quantity_ordered, 'precio_unitario', l.unit_price) order by l.line_no)
      into v_lin from sales_order_lines l where l.order_id = v_id;

  elsif v_tipo = 'factura' then
    select jsonb_build_object('numero', f.number, 'fecha', f.invoice_date, 'estado', f.status,
             'moneda', f.currency_code, 'total', f.total,
             'cliente', (select coalesce(c.trade_name, c.legal_name) from customers c where c.id = f.customer_id))
      into v_cab from sales_invoices f where f.id = v_id;
    select jsonb_agg(jsonb_build_object('sku', l.sku_snapshot, 'producto', l.name_snapshot,
             'cantidad', l.quantity, 'precio_unitario', l.unit_price) order by l.created_at)
      into v_lin from sales_invoice_lines l where l.invoice_id = v_id;

  elsif v_tipo = 'pedido_compra' then
    select jsonb_build_object('numero', p.number) into v_cab from purchase_orders p where p.id = v_id;
    select jsonb_agg(jsonb_build_object('sku', l.sku_snapshot, 'producto', l.name_snapshot,
             'cantidad', l.quantity, 'precio_unitario', l.unit_price) order by l.line_no)
      into v_lin from purchase_order_lines l where l.purchase_order_id = v_id;

  else
    select jsonb_build_object('numero', g.number) into v_cab from goods_receipts g where g.id = v_id;
    select jsonb_agg(jsonb_build_object('sku', l.sku_snapshot, 'producto', l.name_snapshot,
             'cantidad', l.quantity) order by l.created_at)
      into v_lin from goods_receipt_lines l where l.goods_receipt_id = v_id;
  end if;

  begin
    v_cadena := public.cadena_de_documento(v_tipo, v_id);
  exception when others then v_cadena := null;
  end;

  return jsonb_build_object('tipo', v_tipo, 'numero', v_num,
    'cabecera', v_cab, 'lineas', coalesce(v_lin, '[]'::jsonb), 'cadena', v_cadena);
end $function$;
