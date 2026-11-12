-- El MCP ve y busca TODOS los documentos de la web, y suma pendientes y proveedores.
--
-- «Fijate que el MCP ande bien con TODAS las funciones de la web.» Probando las
-- 34 herramientas aparecieron estos huecos:
--   · ver_documento no encontraba notas de entrega (RT…) ni facturas de
--     proveedor, y de un pedido a proveedor o una recepción devolvía sólo el
--     número —sin proveedor, fecha, estado ni importes—.
--   · buscar_documentos sólo conocía cotización, pedido y remito: no había
--     forma de listar facturas, pedidos a proveedor, recepciones ni facturas
--     de proveedor.
--   · No había cómo preguntar lo pendiente de entregar / de recibir (las
--     pantallas de la Fase 238) ni buscar un proveedor.

-- ── 1. ver_documento: los siete tipos, con cabecera completa ─────────────────
create or replace function public.asistente_ver_documento(p_company uuid, p_numero text)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_num text := upper(btrim(coalesce(p_numero, '')));
  v_id uuid; v_tipo text; v_cadena jsonb; v_cab jsonb; v_lin jsonb;
begin
  if v_num = '' then return jsonb_build_object('error', 'Falta el número del documento.'); end if;

  select id, tipo into v_id, v_tipo from (
    select id, 'cotizacion' as tipo, upper(number) as n from sales_quotes   where company_id = p_company
    union all select id, 'pedido',            upper(number) from sales_orders      where company_id = p_company
    union all select id, 'entrega',           upper(number) from deliveries        where company_id = p_company
    union all select id, 'factura',           upper(number) from sales_invoices    where company_id = p_company
    union all select id, 'pedido_compra',     upper(number) from purchase_orders   where company_id = p_company
    union all select id, 'recepcion',         upper(number) from goods_receipts    where company_id = p_company
    union all select id, 'factura_proveedor', upper(number) from supplier_invoices where company_id = p_company
    -- La factura de proveedor también por SU número (el impreso en el papel).
    union all select id, 'factura_proveedor', upper(supplier_number) from supplier_invoices
               where company_id = p_company and supplier_number is not null
  ) t where n = v_num limit 1;

  -- Fase 243: «STEL COV00748» encuentra la cotización cargada con esa referencia.
  if v_id is null then
    select q.id, 'cotizacion' into v_id, v_tipo from sales_quotes q
     where q.company_id = p_company and q.external_ref = app.normalizar_referencia(p_numero) limit 1;
  end if;

  if v_id is null then
    return jsonb_build_object('error',
      'No existe ningún documento con el número «' || p_numero || '». Buscalo con buscar_documentos.');
  end if;

  if v_tipo = 'cotizacion' then
    select jsonb_build_object('numero', q.number, 'fecha', q.quote_date, 'estado', q.status,
             'moneda', q.currency_code, 'neto', q.subtotal, 'total', q.total, 'titulo', q.title,
             'referencia_externa', q.external_ref,
             'cliente', (select coalesce(c.trade_name, c.legal_name) from customers c where c.id = q.customer_id))
      into v_cab from sales_quotes q where q.id = v_id;
    select jsonb_agg(jsonb_build_object('sku', l.sku_snapshot, 'producto', l.name_snapshot,
             'cantidad', l.quantity, 'precio_unitario', l.unit_price, 'descuento', l.discount_pct) order by l.line_no)
      into v_lin from sales_quote_lines l where l.quote_id = v_id;

  elsif v_tipo = 'pedido' then
    select jsonb_build_object('numero', o.number, 'fecha', o.order_date, 'estado', o.commercial_status,
             'entrega', o.fulfillment_status, 'facturacion', o.invoicing_status,
             'moneda', o.currency_code, 'total', o.total,
             'cliente', (select coalesce(c.trade_name, c.legal_name) from customers c where c.id = o.customer_id))
      into v_cab from sales_orders o where o.id = v_id;
    select jsonb_agg(jsonb_build_object('sku', l.sku_snapshot, 'producto', l.name_snapshot,
             'cantidad', l.quantity_ordered, 'precio_unitario', l.unit_price) order by l.line_no)
      into v_lin from sales_order_lines l where l.order_id = v_id;

  elsif v_tipo = 'entrega' then
    select jsonb_build_object('numero', d.number, 'fecha', d.delivery_date, 'estado', d.status,
             'transporte', d.carrier, 'seguimiento', d.tracking, 'moneda', d.currency_code, 'total', d.total,
             'pedido', (select o.number from sales_orders o where o.id = d.order_id),
             'cliente', (select coalesce(c.trade_name, c.legal_name) from customers c where c.id = d.customer_id))
      into v_cab from deliveries d where d.id = v_id;
    select jsonb_agg(jsonb_build_object('sku', l.sku_snapshot, 'producto', l.name_snapshot,
             'cantidad', l.quantity) order by l.line_no nulls last, l.created_at)
      into v_lin from delivery_lines l where l.delivery_id = v_id;

  elsif v_tipo = 'factura' then
    select jsonb_build_object('numero', f.number, 'fecha', f.invoice_date, 'vencimiento', f.due_date,
             'estado', f.status, 'numero_fiscal', f.external_number,
             'moneda', f.currency_code, 'neto', f.subtotal, 'total', f.total,
             'pedido', (select o.number from sales_orders o where o.id = f.order_id),
             'cliente', (select coalesce(c.trade_name, c.legal_name) from customers c where c.id = f.customer_id))
      into v_cab from sales_invoices f where f.id = v_id;
    select jsonb_agg(jsonb_build_object('sku', l.sku_snapshot, 'producto', l.name_snapshot,
             'cantidad', l.quantity, 'precio_unitario', l.unit_price) order by l.created_at)
      into v_lin from sales_invoice_lines l where l.invoice_id = v_id;

  elsif v_tipo = 'pedido_compra' then
    select jsonb_build_object('numero', p.number, 'fecha', p.order_date, 'estado', p.status,
             'recepcion', p.receipt_status, 'llegada_estimada', p.expected_date,
             'condicion_pago', p.payment_terms, 'moneda', p.currency_code, 'neto', p.subtotal, 'total', p.total,
             'proveedor', (select coalesce(s.trade_name, s.legal_name) from suppliers s where s.id = p.supplier_id),
             'notas', p.notes)
      into v_cab from purchase_orders p where p.id = v_id;
    select jsonb_agg(jsonb_build_object('sku', l.sku_snapshot, 'producto', l.name_snapshot,
             'cantidad', l.quantity, 'para_venta', l.quantity_for_sale, 'precio_unitario', l.unit_price,
             'recibido', coalesce((select sum(gl.quantity) from goods_receipt_lines gl
                                     join goods_receipts g on g.id = gl.goods_receipt_id
                                    where gl.purchase_order_line_id = l.id and g.status = 'confirmed'), 0))
             order by l.line_no)
      into v_lin from purchase_order_lines l where l.purchase_order_id = v_id;

  elsif v_tipo = 'recepcion' then
    select jsonb_build_object('numero', g.number, 'fecha', g.receipt_date, 'estado', g.status,
             'remito_proveedor', g.supplier_document,
             'pedido_compra', (select p.number from purchase_orders p where p.id = g.purchase_order_id),
             'proveedor', (select coalesce(s.trade_name, s.legal_name) from suppliers s where s.id = g.supplier_id),
             'deposito', (select w.name from warehouses w where w.id = g.warehouse_id))
      into v_cab from goods_receipts g where g.id = v_id;
    select jsonb_agg(jsonb_build_object('sku', l.sku_snapshot, 'producto', l.name_snapshot,
             'cantidad', l.quantity) order by l.created_at)
      into v_lin from goods_receipt_lines l where l.goods_receipt_id = v_id;

  else -- factura_proveedor
    select jsonb_build_object('numero', f.number, 'numero_proveedor', f.supplier_number,
             'fecha', f.invoice_date, 'vencimiento', f.due_date, 'estado', f.status,
             'condicion_pago', f.payment_terms, 'moneda', f.currency_code, 'neto', f.subtotal, 'total', f.total,
             'proveedor', (select coalesce(s.trade_name, s.legal_name) from suppliers s where s.id = f.supplier_id))
      into v_cab from supplier_invoices f where f.id = v_id;
    select jsonb_agg(jsonb_build_object('sku', l.sku_snapshot, 'producto', l.description_snapshot,
             'cantidad', l.quantity, 'precio_unitario', l.unit_price, 'descuento', l.discount_pct,
             'total', l.line_total) order by l.line_no)
      into v_lin from supplier_invoice_lines l where l.supplier_invoice_id = v_id;
  end if;

  -- La cadena (cotización → pedido → entrega → factura) es de Ventas.
  if v_tipo in ('cotizacion', 'pedido', 'entrega', 'factura') then
    begin
      v_cadena := public.cadena_de_documento(v_tipo, v_id);
    exception when others then v_cadena := null;
    end;
  end if;

  return jsonb_build_object('tipo', v_tipo, 'numero', coalesce(v_cab ->> 'numero', v_num),
    'cabecera', v_cab, 'lineas', coalesce(v_lin, '[]'::jsonb), 'cadena', v_cadena);
end $function$;

-- ── 2. buscar_documentos: facturas y los tres de Compras ─────────────────────
-- Cotización, pedido y remito siguen por `informe_documentos`, igual que
-- antes. Los otros cuatro van por una consulta propia con los mismos filtros:
-- período, estado, cliente o proveedor (en `cliente`), moneda y orden.
create or replace function app.asistente_buscar_otros(
  p_company uuid, p_tipo text, p_desde date, p_hasta date, p_estado text, p_quien text,
  p_limite integer, p_orden text, p_moneda text)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'app', 'pg_temp'
as $function$
declare
  v_ter uuid; v_filas jsonb; v_total bigint; v_imp numeric;
  v_estado text := nullif(lower(btrim(coalesce(p_estado, ''))), '');
begin
  if p_quien is not null then
    v_ter := case when p_tipo = 'factura' then app.cliente_por_texto(p_company, p_quien)
                  else app.proveedor_por_texto(p_company, p_quien) end;
    if v_ter is null then
      return jsonb_build_object('error', case when p_tipo = 'factura'
        then 'No encontré al cliente «' || p_quien || '». Buscalo con buscar_cliente.'
        else 'No encontré al proveedor «' || p_quien || '». Buscalo con buscar_proveedor.' end);
    end if;
  end if;

  with d as (
    select 'factura' tipo, f.number numero, f.invoice_date fecha, f.status estado, f.currency_code moneda, f.total importe,
           (select coalesce(c.trade_name, c.legal_name) from customers c where c.id = f.customer_id) contraparte,
           f.customer_id ter, f.external_number extra
      from sales_invoices f where p_tipo = 'factura' and f.company_id = p_company
    union all
    select 'pedido_compra', p.number, p.order_date, p.status || '/' || coalesce(p.receipt_status, 'pending'), p.currency_code, p.total,
           (select coalesce(s.trade_name, s.legal_name) from suppliers s where s.id = p.supplier_id), p.supplier_id,
           p.expected_date::text
      from purchase_orders p where p_tipo = 'pedido_compra' and p.company_id = p_company
    union all
    select 'recepcion', g.number, g.receipt_date, g.status, null, null,
           (select coalesce(s.trade_name, s.legal_name) from suppliers s where s.id = g.supplier_id), g.supplier_id,
           (select p.number from purchase_orders p where p.id = g.purchase_order_id)
      from goods_receipts g where p_tipo = 'recepcion' and g.company_id = p_company
    union all
    select 'factura_proveedor', f.number, f.invoice_date, f.status, f.currency_code, f.total,
           (select coalesce(s.trade_name, s.legal_name) from suppliers s where s.id = f.supplier_id), f.supplier_id,
           f.supplier_number
      from supplier_invoices f where p_tipo = 'factura_proveedor' and f.company_id = p_company
  ), filtrado as (
    select d.*, count(*) over () total_filas, sum(importe) over () total_importe,
           row_number() over (order by case when p_orden = 'importe' then importe end desc nulls last,
                                       fecha desc nulls last, numero desc) rn
      from d
     where fecha between p_desde and p_hasta
       and (v_ter is null or ter = v_ter)
       and (p_moneda is null or moneda = p_moneda)
       and (v_estado is null or estado ilike v_estado || '%' or estado ilike '%/' || v_estado)
  )
  select jsonb_agg(jsonb_build_object('tipo', tipo, 'numero', numero, 'fecha', fecha,
           case when p_tipo = 'factura' then 'cliente' else 'proveedor' end, contraparte,
           'estado', estado, 'moneda', moneda, 'importe', importe,
           case p_tipo when 'factura' then 'numero_fiscal' when 'pedido_compra' then 'llegada_estimada'
                       when 'recepcion' then 'pedido_compra' else 'numero_proveedor' end, extra) order by rn),
         max(total_filas), max(total_importe)
    into v_filas, v_total, v_imp
    from filtrado where rn <= p_limite;

  if v_filas is null then
    return jsonb_build_object('resultados', 0, 'periodo', p_desde || ' a ' || p_hasta,
      'nota', 'No hay documentos de ese tipo en ese período' || case when p_quien is not null then ' para «' || p_quien || '»' else '' end || '.');
  end if;
  return jsonb_build_object('resultados', jsonb_array_length(v_filas), 'hay_en_total', v_total,
    'periodo', p_desde || ' a ' || p_hasta,
    'importe_total_del_periodo', case when p_moneda is not null then v_imp end,
    'nota', case when v_total > jsonb_array_length(v_filas)
                 then 'Hay ' || v_total || '; te muestro ' || jsonb_array_length(v_filas) || '.' end,
    'documentos', v_filas);
end $function$;

revoke execute on function app.asistente_buscar_otros(uuid, text, date, date, text, text, integer, text, text) from public, anon;
grant execute on function app.asistente_buscar_otros(uuid, text, date, date, text, text, integer, text, text) to authenticated, service_role;

create or replace function public.asistente_buscar_documentos(p_company uuid, p_tipo text, p_desde text DEFAULT NULL::text, p_hasta text DEFAULT NULL::text, p_estado text DEFAULT NULL::text, p_cliente text DEFAULT NULL::text, p_limite integer DEFAULT 20, p_orden text DEFAULT 'fecha'::text, p_moneda text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_lim   integer := least(greatest(coalesce(p_limite, 20), 1), 40);
  v_tipo  text;
  v_otro  text;
  v_desde date; v_hasta date;
  v_pide  text := nullif(btrim(coalesce(p_cliente,'')),'');
  v_cli   uuid;
  v_mon   text := nullif(btrim(upper(coalesce(p_moneda,''))),'');
  v_orden text := case when lower(btrim(coalesce(p_orden,''))) = 'importe' then 'importe' else 'fecha' end;
  /*
   * SIEMPRE se trae el conjunto y después se ordena acá. En las dos puntas.
   *
   * Pedirle `limite` filas a `informe_documentos` y reordenar esas es ordenar
   * la página que eligió otro. Con `importe` daba un ranking de una muestra
   * —se perdía la cotización más grande—, y con `fecha` rompía el desempate:
   * pidiendo 3 cotizaciones de Mirgor devolvía COTI02553, 02552 y 02551, sin
   * la 02555 ni la 02554, que son las dos últimas y comparten la misma fecha.
   * El orden de acá sólo vale si abarca todo lo que el filtro deja pasar.
   */
  v_tope  integer := 2000;
  v_filas jsonb; v_total bigint; v_imp numeric;
begin
  v_tipo := case lower(btrim(coalesce(p_tipo, '')))
              when 'cotizacion'  then 'cotizaciones' when 'cotizaciones' then 'cotizaciones'
              when 'pedido'      then 'pedidos'      when 'pedidos'      then 'pedidos'
              when 'remito'      then 'entregas'     when 'entrega'      then 'entregas'
              when 'entregas'    then 'entregas'     when 'nota de entrega' then 'entregas'
              else null end;
  v_otro := case lower(btrim(coalesce(p_tipo, '')))
              when 'factura' then 'factura' when 'facturas' then 'factura'
              when 'pedido_compra' then 'pedido_compra' when 'pedido a proveedor' then 'pedido_compra'
              when 'compra' then 'pedido_compra' when 'compras' then 'pedido_compra'
              when 'recepcion' then 'recepcion' when 'nota de entrega de proveedor' then 'recepcion'
              when 'factura_proveedor' then 'factura_proveedor' when 'factura de proveedor' then 'factura_proveedor'
              else null end;
  if v_tipo is null and v_otro is null then
    return jsonb_build_object('error',
      'No conozco el tipo «' || coalesce(p_tipo,'') || '». Los que hay son: cotizacion, pedido, remito, '
      || 'factura, pedido_compra, recepcion, factura_proveedor.');
  end if;

  if v_orden = 'importe' and v_mon is null then
    return jsonb_build_object('error',
      'Para ordenar por importe hace falta la moneda: acá se opera en USD, ARS y EUR ' ||
      'y un ranking que las mezcla no significa nada. Volvé a llamarme con moneda.');
  end if;

  begin
    v_desde := coalesce(nullif(btrim(coalesce(p_desde,'')),'')::date, current_date - 30);
    v_hasta := coalesce(nullif(btrim(coalesce(p_hasta,'')),'')::date, current_date);
  exception when others then
    return jsonb_build_object('error', 'Las fechas van en formato AAAA-MM-DD.');
  end;

  if v_otro is not null then
    return app.asistente_buscar_otros(p_company, v_otro, v_desde, v_hasta, p_estado, v_pide, v_lim, v_orden, v_mon);
  end if;

  if v_pide is not null then
    v_cli := app.cliente_por_texto(p_company, v_pide);
    if v_cli is null then
      return jsonb_build_object('error',
        'No encontré al cliente «' || v_pide || '». Buscalo con buscar_cliente.');
    end if;
  end if;

  begin
    with d as (
      select * from public.informe_documentos(p_company, v_desde, v_hasta, v_tipo, v_mon,
               nullif(btrim(coalesce(p_estado,'')),''), null, null, v_cli, v_tope, 0)
    ), ordenado as (
      select d.*, row_number() over (
               order by case when v_orden = 'importe' then d.importe end desc nulls last,
                        case when v_orden = 'importe' then null::date else d.fecha end desc nulls last,
                        d.numero desc) as rn
        from d
    )
    select jsonb_agg(jsonb_build_object(
             'tipo', tipo, 'numero', numero, 'fecha', fecha, 'cliente', cliente,
             'estado', estado, 'moneda', moneda, 'importe', importe,
             'en_revision', en_revision) order by rn),
           max(total_filas), max(total_importe)
      into v_filas, v_total, v_imp
      from ordenado where rn <= v_lim;
  exception
    when insufficient_privilege then
      return jsonb_build_object('error', 'Tu rol no puede ver estos documentos.');
    when others then
      return jsonb_build_object('error', 'No pude buscar con esos filtros. Probá sin el estado.');
  end;

  if v_filas is null then
    return jsonb_build_object('resultados', 0, 'periodo', v_desde || ' a ' || v_hasta,
      'nota', 'No hay ' || v_tipo || ' en ese período'
              || case when v_pide is not null then ' para ese cliente' else '' end || '.');
  end if;

  return jsonb_build_object(
    'resultados', jsonb_array_length(v_filas), 'hay_en_total', v_total,
    'ordenado_por', v_orden, 'moneda', v_mon,
    'periodo', v_desde || ' a ' || v_hasta, 'importe_total_del_periodo', v_imp,
    'nota', case
      when v_total > v_tope
        then 'Hay ' || v_total || ' y el orden cubre los ' || v_tope || ' primeros: puede faltar alguno.'
      when v_total > jsonb_array_length(v_filas)
        then 'Hay ' || v_total || '; te muestro los ' || jsonb_array_length(v_filas)
             || case when v_orden = 'importe' then ' de mayor importe.' else ' más recientes.' end
      end,
    'documentos', v_filas);
end $function$;

-- ── 3. Lo pendiente de entregar o de recibir (las pantallas de la Fase 238) ──
create or replace function public.asistente_pendientes(p_company uuid, p_cual text, p_texto text default null, p_limite integer default 20)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'app', 'pg_temp'
as $function$
declare
  v_cual text := lower(btrim(coalesce(p_cual, '')));
  v_lim integer := least(greatest(coalesce(p_limite, 20), 1), 50);
  v_q text := nullif(lower(btrim(coalesce(p_texto, ''))), '');
  v_todo jsonb; v_filas jsonb; v_n integer;
begin
  if v_cual in ('entregar', 'entrega', 'ventas', 'venta') then
    v_todo := public.pendiente_de_entregar(p_company, null);
  elsif v_cual in ('recibir', 'recepcion', 'compras', 'compra') then
    v_todo := public.pendiente_de_recibir(p_company, null);
  else
    return jsonb_build_object('error', 'Decime qué pendiente: «entregar» (lo vendido que falta entregar) o «recibir» (lo pedido a proveedores que no llegó).');
  end if;

  select count(*), jsonb_agg(x) filter (where rn <= v_lim)
    into v_n, v_filas
    from (select x, row_number() over () rn
            from jsonb_array_elements(coalesce(v_todo, '[]'::jsonb)) x
           where v_q is null or lower(coalesce(x->>'sku', '') || ' ' || coalesce(x->>'nombre', '')) like '%' || v_q || '%') t;

  return jsonb_build_object(
    'pendiente_de', case when v_cual in ('entregar', 'entrega', 'ventas', 'venta') then 'entregar' else 'recibir' end,
    'productos', v_n,
    'nota', case when v_n = 0 then 'No hay nada pendiente' || case when v_q is not null then ' con «' || p_texto || '»' else '' end || '.'
                 when v_n > v_lim then 'Hay ' || v_n || ' productos; te muestro ' || v_lim || '. Acotá con texto.' end,
    'detalle', coalesce(v_filas, '[]'::jsonb));
end $function$;

-- ── 4. Buscar un proveedor ───────────────────────────────────────────────────
create or replace function public.asistente_buscar_proveedor(p_company uuid, p_texto text)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'app', 'pg_temp'
as $function$
declare
  v_q text := btrim(coalesce(p_texto, ''));
  v_filas jsonb;
begin
  if v_q = '' then return jsonb_build_object('error', 'Falta el texto a buscar.'); end if;
  select jsonb_agg(jsonb_build_object(
           'proveedor', coalesce(s.trade_name, s.legal_name), 'razon_social', s.legal_name,
           'referencia', s.legacy_ref, 'cuit', s.tax_id, 'email', s.email, 'telefono', s.phone,
           'moneda', s.default_currency, 'condicion_pago', s.payment_terms,
           'pedidos_abiertos', (select count(*) from purchase_orders p
                                 where p.supplier_id = s.id and p.status in ('draft', 'confirmed')
                                   and coalesce(p.receipt_status, 'pending') <> 'received')))
    into v_filas
    from (select s.* from suppliers s
           where s.company_id = p_company and s.deleted_at is null
             and (s.legal_name ilike '%' || v_q || '%' or s.trade_name ilike '%' || v_q || '%'
                  or s.tax_id ilike '%' || v_q || '%' or s.legacy_ref ilike v_q)
           order by s.legal_name limit 15) s;
  if v_filas is null then
    return jsonb_build_object('resultados', 0, 'nota', 'No encontré ningún proveedor con «' || v_q || '».');
  end if;
  return jsonb_build_object('resultados', jsonb_array_length(v_filas), 'proveedores', v_filas);
end $function$;

grant execute on function
  public.asistente_pendientes(uuid, text, text, integer),
  public.asistente_buscar_proveedor(uuid, text)
to authenticated, service_role;
revoke execute on function
  public.asistente_pendientes(uuid, text, text, integer),
  public.asistente_buscar_proveedor(uuid, text)
from anon, public;
