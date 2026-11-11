-- Fase 244: el MCP del ERP hace TODO lo que se hace desde las pantallas.
--
-- Cada herramienta es una función `asistente_*` SECURITY INVOKER (la RLS de
-- quien pregunta sigue mandando) que recibe NÚMEROS, SKU y NOMBRES —nunca un
-- uuid— y llama a la MISMA función que usa la pantalla: guardar_cotizacion,
-- convertir_cotizacion_en_pedido, crear_remito_desde_pedido, confirmar_entrega,
-- crear_factura_desde_pedido, crear_cliente, guardar_cliente,
-- confirmar_recepcion, registrar_factura_proveedor, erp_cargar_datos_comerciales.
-- Lo que la pantalla hace directo contra las tablas (pedido de compra,
-- recepción, factura de proveedor, estados, ajuste de stock) se hace igual acá,
-- con los mismos triggers de guarda detrás.
--
-- Los errores vuelven como {"error": "..."} en castellano y NADA queda a medias:
-- cada función atrapa la excepción, y el bloque que falló se deshace entero.

-- ── Los errores, en castellano ───────────────────────────────────────────────
create or replace function app.asistente_error(p_msg text)
returns text language sql immutable set search_path = pg_catalog as $$
  select case
    when p_msg ~ 'external_numbering_authority|numeración.*STEL|EMISION' then
      'La numeración de ese tipo de documento en esta empresa la lleva STEL: no se puede emitir desde el ERP. Hacelo en STEL.'
    when p_msg ~ 'CONFLICTO_DE_EDICION' then 'Alguien lo modificó recién. Volvé a intentarlo.'
    when p_msg ~ 'ESTADO_NO_EDITABLE|COTIZACION_CERRADA|cerrada' then 'Ese documento está cerrado (aceptado o rechazado) y no se modifica.'
    when p_msg ~ 'SIN_PERMISO|insufficient_privilege|row-level security|42501' then 'Tu rol no puede hacer eso en esta empresa.'
    when p_msg ~ 'PEDIDO_YA_EXISTE' then 'Esa cotización ya tiene un pedido.'
    when p_msg ~ 'COTIZACION_RECHAZADA' then 'Una cotización rechazada no se convierte en pedido.'
    when p_msg ~ 'PEDIDO_NO_CONFIRMADO' then 'El pedido tiene que estar confirmado para entregarlo: confirmalo con cambiar_estado.'
    when p_msg ~ 'PEDIDO_CANCELADO' then 'El pedido está cancelado.'
    when p_msg ~ 'PEDIDO_TOTALMENTE_ENTREGADO' then 'Ese pedido ya está entregado completo.'
    when p_msg ~ 'SOBREENTREGA' then 'Se quiso entregar más de lo pendiente.'
    when p_msg ~ 'ya tiene factura' then 'Ese pedido ya tiene factura.'
    when p_msg ~ 'CLIENTE_DUPLICADO' then 'Ya existe un cliente con esos datos (mismo CUIT o razón social). Buscalo con buscar_cliente.'
    when p_msg ~ 'CUIT_INVALIDO' then 'El CUIT no es válido (son 11 dígitos).'
    when p_msg ~ 'PAIS_INVALIDO' then 'El país va en dos letras: AR, ES, UY…'
    when p_msg ~ 'MONEDA_INVALIDA' then 'Esa moneda no existe en el ERP.'
    when p_msg ~ 'producto_de_stel' then 'Ese producto lo maneja STEL: su precio y su costo se cambian en STEL, si no la sincronización los pisa.'
    when p_msg ~ 'SIN_SERIE' then 'La empresa no tiene una serie de numeración para ese documento.'
    when p_msg ~ 'SIN_DEPOSITO' then 'La empresa no tiene depósito.'
    else 'No se pudo: ' || left(p_msg, 200)
  end
$$;

-- ── Un documento por su número (o por su referencia externa) ─────────────────
create or replace function app.asistente_documento(p_company uuid, p_numero text)
returns table (tipo text, id uuid, numero text)
language sql stable set search_path = public, app, pg_temp as $$
  with n as (select upper(btrim(coalesce(p_numero, ''))) as v)
  select t.tipo, t.id, t.numero from (
    select 'cotizacion' as tipo, q.id, q.number as numero, 1 as o from sales_quotes q, n
     where q.company_id = p_company and (upper(q.number) = n.v or q.external_ref = app.normalizar_referencia(p_numero))
    union all select 'pedido', o.id, o.number, 2 from sales_orders o, n where o.company_id = p_company and upper(o.number) = n.v
    union all select 'entrega', d.id, d.number, 3 from deliveries d, n where d.company_id = p_company and upper(d.number) = n.v
    union all select 'factura', f.id, f.number, 4 from sales_invoices f, n where f.company_id = p_company and upper(f.number) = n.v
    union all select 'pedido_compra', p.id, p.number, 5 from purchase_orders p, n where p.company_id = p_company and upper(p.number) = n.v
    union all select 'recepcion', g.id, g.number, 6 from goods_receipts g, n where g.company_id = p_company and upper(g.number) = n.v
    union all select 'factura_proveedor', s.id, s.number, 7 from supplier_invoices s, n where s.company_id = p_company and upper(s.number) = n.v
  ) t order by t.o limit 1
$$;

-- ── Un producto por SKU (rápido) o por texto sin dudas ───────────────────────
create or replace function app.asistente_producto(p_company uuid, p_texto text)
returns table (id uuid, sku text, nombre text, lista numeric)
language plpgsql stable set search_path = public, app, extensions, pg_temp as $$
declare v uuid; b jsonb; p jsonb;
begin
  v := app.producto_por_sku_exacto(p_company, p_texto);
  if v is null and btrim(coalesce(p_texto, '')) <> '' then
    b := public.asistente_buscar_productos(p_company, p_texto, 3);
    p := b -> 'productos' -> 0;
    if p is not null and ((p ->> 'encontrado_por') in ('sku', 'codigo', 'modelo') or (b ->> 'coinciden_del_todo')::int >= 1) then
      select pr.id into v from products pr where pr.company_id = p_company and pr.deleted_at is null and pr.sku = p ->> 'sku' limit 1;
    end if;
  end if;
  if v is null then return; end if;
  return query select pr.id, pr.sku, pr.name, (select importe from app.precio_de_lista(p_company, pr.id))
                 from products pr where pr.id = v;
end $$;

-- ── Un proveedor por nombre o referencia ─────────────────────────────────────
create or replace function app.proveedor_por_texto(p_company uuid, p_texto text)
returns uuid language plpgsql stable set search_path = public, pg_temp as $$
declare t text := upper(btrim(coalesce(p_texto, ''))); v uuid; n int;
begin
  if t = '' then return null; end if;
  select s.id into v from suppliers s
   where s.company_id = p_company and s.deleted_at is null
     and (upper(s.legal_name) = t or upper(coalesce(s.trade_name, '')) = t or upper(coalesce(s.legacy_ref, '')) = t)
   limit 1;
  if v is not null then return v; end if;
  select count(*), min(s.id::text)::uuid into n, v from suppliers s
   where s.company_id = p_company and s.deleted_at is null
     and (s.legal_name ilike '%' || btrim(p_texto) || '%' or coalesce(s.trade_name, '') ilike '%' || btrim(p_texto) || '%');
  return case when n = 1 then v else null end;
end $$;

-- ── 1. Editar una cotización ─────────────────────────────────────────────────
create or replace function public.asistente_editar_cotizacion(
  p_company uuid, p_numero text, p_productos jsonb default null, p_modo text default 'actualizar',
  p_titulo text default null, p_notas text default null, p_condicion_pago text default null,
  p_validez date default null, p_descuento_general numeric default null)
returns jsonb language plpgsql
set search_path to 'public', 'app', 'extensions', 'pg_temp'
as $function$
declare
  v_doc record; v_q sales_quotes%rowtype; v_modo text := lower(btrim(coalesce(p_modo, 'actualizar')));
  v_lineas jsonb; v_item jsonb; v_prod record; v_precio numeric; v_faltan jsonb := '[]'::jsonb;
  v_i int; v_pos int; v_cab jsonb := '{}'::jsonb; v_final jsonb := '[]'::jsonb; v_res jsonb; v_x jsonb; v_n int := 0;
begin
  select * into v_doc from app.asistente_documento(p_company, p_numero);
  if v_doc.id is null or v_doc.tipo <> 'cotizacion' then
    return jsonb_build_object('error', 'No encontré la cotización «' || coalesce(p_numero, '') || '».');
  end if;
  select * into v_q from sales_quotes where id = v_doc.id;
  if v_q.status not in ('draft', 'sent') then
    return jsonb_build_object('error', 'La cotización ' || v_q.number || ' está cerrada (' || v_q.status || ') y no se modifica.');
  end if;
  if v_modo not in ('actualizar', 'agregar', 'reemplazar', 'quitar') then
    return jsonb_build_object('error', 'modo tiene que ser actualizar, agregar, reemplazar o quitar.');
  end if;

  -- Las líneas de hoy, con su id: guardar_cotizacion conserva las que vienen
  -- con id y borra las que no.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'line_type', l.line_type, 'product_id', l.product_id,
           'sku_snapshot', l.sku_snapshot, 'name_snapshot', l.name_snapshot,
           'description_snapshot', l.description_snapshot, 'quantity', l.quantity,
           'unit_price', l.unit_price, 'discount_pct', l.discount_pct,
           'tax_treatment', l.tax_treatment, 'tax_rate_snapshot', l.tax_rate_snapshot) order by l.line_no), '[]'::jsonb)
    into v_lineas from sales_quote_lines l where l.quote_id = v_q.id;
  if v_modo = 'reemplazar' then v_lineas := '[]'::jsonb; end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_productos, '[]'::jsonb)) loop
    -- La línea que ya está con ese SKU (para actualizar o quitar).
    v_pos := null;
    select (o - 1) into v_pos from jsonb_array_elements(v_lineas) with ordinality e(x, o)
     where upper(coalesce(x ->> 'sku_snapshot', '')) = upper(btrim(coalesce(v_item ->> 'producto', ''))) limit 1;

    if v_modo = 'quitar' then
      if v_pos is null then
        v_faltan := v_faltan || to_jsonb(v_item ->> 'producto');
      else
        v_lineas := v_lineas - v_pos;
      end if;
      continue;
    end if;

    if v_modo = 'actualizar' and v_pos is not null then
      v_x := v_lineas -> v_pos;
      if v_item ? 'cantidad' then v_x := jsonb_set(v_x, '{quantity}', to_jsonb((v_item ->> 'cantidad')::numeric)); end if;
      if v_item ? 'precio_unitario' then v_x := jsonb_set(v_x, '{unit_price}', to_jsonb((v_item ->> 'precio_unitario')::numeric)); end if;
      if v_item ? 'descuento' then v_x := jsonb_set(v_x, '{discount_pct}', to_jsonb((v_item ->> 'descuento')::numeric)); end if;
      v_lineas := jsonb_set(v_lineas, array[v_pos::text], v_x);
      continue;
    end if;

    -- Renglón nuevo.
    select * into v_prod from app.asistente_producto(p_company, v_item ->> 'producto');
    if v_prod.id is null then
      v_faltan := v_faltan || to_jsonb(v_item ->> 'producto');
      continue;
    end if;
    v_precio := nullif(v_item ->> 'precio_unitario', '')::numeric;
    if v_precio is null then
      select ultimo_precio into v_precio from public.ultimo_precio_cliente(v_q.customer_id, v_prod.id) limit 1;
      v_precio := coalesce(v_precio, v_prod.lista, 0);
    end if;
    v_lineas := v_lineas || jsonb_build_object(
      'line_type', 'item', 'product_id', v_prod.id, 'sku_snapshot', v_prod.sku, 'name_snapshot', v_prod.nombre,
      'quantity', coalesce(nullif(v_item ->> 'cantidad', '')::numeric, 1), 'unit_price', v_precio,
      'discount_pct', coalesce(nullif(v_item ->> 'descuento', '')::numeric, 0),
      'tax_treatment', 'vat_21', 'tax_rate_snapshot', 21);
  end loop;

  if jsonb_array_length(v_faltan) > 0 then
    return jsonb_build_object('error', 'No cambié nada: hay renglones que no encontré.', 'no_encontrados', v_faltan,
      'nota', case when v_modo = 'quitar' then 'Esos SKU no están en la cotización.'
                   else 'Pedí el SKU exacto, o crealo con crear_producto si no existe.' end);
  end if;
  if jsonb_array_length(v_lineas) = 0 then
    return jsonb_build_object('error', 'La cotización quedaría sin renglones. No cambié nada.');
  end if;

  -- line_no 1..n. Antes se corren las de hoy lejos, porque (quote_id, line_no)
  -- es único y guardar_cotizacion las actualiza de a una.
  update sales_quote_lines set line_no = line_no + 100000 where quote_id = v_q.id;
  for v_x in select value from jsonb_array_elements(v_lineas) loop
    v_n := v_n + 1;
    v_final := v_final || (v_x || jsonb_build_object('line_no', v_n));
  end loop;

  if p_titulo is not null then v_cab := v_cab || jsonb_build_object('title', p_titulo); end if;
  if p_notas is not null then v_cab := v_cab || jsonb_build_object('notes', p_notas); end if;
  if p_condicion_pago is not null then v_cab := v_cab || jsonb_build_object('payment_terms', p_condicion_pago); end if;
  if p_validez is not null then v_cab := v_cab || jsonb_build_object('valid_until', p_validez); end if;
  if p_descuento_general is not null then v_cab := v_cab || jsonb_build_object('discount_pct', p_descuento_general); end if;

  v_res := public.guardar_cotizacion(v_q.id, (select updated_at from sales_quotes where id = v_q.id), v_cab, v_final);
  select * into v_q from sales_quotes where id = v_q.id;
  return jsonb_build_object('editada', true, 'numero', v_q.number, 'renglones', v_n,
    'neto', v_q.subtotal, 'total', v_q.total, 'moneda', v_q.currency_code,
    'nota', 'Guardada. «neto» sin IVA, «total» con IVA. Revisala con ver_documento.');
exception when others then
  return jsonb_build_object('error', app.asistente_error(sqlerrm));
end $function$;

-- ── 2. Cambiar el estado de un documento ─────────────────────────────────────
create or replace function public.asistente_cambiar_estado(p_company uuid, p_numero text, p_estado text)
returns jsonb language plpgsql
set search_path to 'public', 'app', 'pg_temp'
as $function$
declare v_doc record; v_e text := lower(btrim(coalesce(p_estado, ''))); v_desde text; v_hasta text; v_ok int;
begin
  select * into v_doc from app.asistente_documento(p_company, p_numero);
  if v_doc.id is null then return jsonb_build_object('error', 'No encontré el documento «' || coalesce(p_numero, '') || '».'); end if;

  if v_doc.tipo = 'cotizacion' then
    v_hasta := case when v_e in ('pendiente', 'enviada', 'sent', 'abierta') then 'sent'
                    when v_e in ('aceptada', 'aprobada', 'ganada', 'accepted') then 'accepted'
                    when v_e in ('rechazada', 'perdida', 'cancelada', 'rejected') then 'rejected' end;
    if v_hasta is null then return jsonb_build_object('error', 'Para una cotización: pendiente, aceptada o rechazada.'); end if;
    select status into v_desde from sales_quotes where id = v_doc.id;
    if v_desde = v_hasta then return jsonb_build_object('sin_cambios', true, 'numero', v_doc.numero, 'estado', v_hasta); end if;
    update sales_quotes set status = v_hasta where id = v_doc.id;
    perform public.registrar_evento_venta('sales_quote', v_doc.id,
      case v_hasta when 'sent' then 'sent' when 'accepted' then 'approved' else 'rejected' end, v_desde, v_hasta, null);

  elsif v_doc.tipo = 'pedido' then
    v_hasta := case when v_e in ('confirmado', 'confirmar', 'confirmed') then 'confirmed'
                    when v_e in ('cancelado', 'cancelar', 'cancelled') then 'cancelled' end;
    if v_hasta is null then return jsonb_build_object('error', 'Para un pedido de venta: confirmado o cancelado.'); end if;
    select commercial_status into v_desde from sales_orders where id = v_doc.id;
    if v_desde = v_hasta then return jsonb_build_object('sin_cambios', true, 'numero', v_doc.numero, 'estado', v_hasta); end if;
    update sales_orders set commercial_status = v_hasta where id = v_doc.id;
    perform public.registrar_evento_venta('sales_order', v_doc.id,
      case v_hasta when 'cancelled' then 'cancelled' else 'approved' end, v_desde, v_hasta, null);

  elsif v_doc.tipo = 'pedido_compra' then
    v_hasta := case when v_e in ('confirmado', 'confirmar', 'enviado', 'confirmed') then 'confirmed'
                    when v_e in ('cancelado', 'cancelar', 'cancelled') then 'cancelled' end;
    if v_hasta is null then return jsonb_build_object('error', 'Para un pedido a proveedor: confirmado o cancelado.'); end if;
    select status into v_desde from purchase_orders where id = v_doc.id;
    update purchase_orders set status = v_hasta
     where id = v_doc.id and status = any (case v_hasta when 'confirmed' then array['draft'] else array['draft', 'confirmed'] end);
    get diagnostics v_ok = row_count;
    if v_ok = 0 then
      return jsonb_build_object('error', 'El pedido ' || v_doc.numero || ' está ' || v_desde || ' y no puede pasar a ' || v_hasta || '.');
    end if;
  else
    return jsonb_build_object('error', 'A ese tipo de documento (' || v_doc.tipo || ') no se le cambia el estado desde acá.');
  end if;

  return jsonb_build_object('cambiado', true, 'numero', v_doc.numero, 'tipo', v_doc.tipo, 'desde', v_desde, 'hasta', v_hasta);
exception when others then
  return jsonb_build_object('error', app.asistente_error(sqlerrm));
end $function$;

-- ── 3. Convertir una cotización en pedido ────────────────────────────────────
create or replace function public.asistente_convertir_a_pedido(p_company uuid, p_numero text, p_confirmar boolean default true)
returns jsonb language plpgsql
set search_path to 'public', 'app', 'pg_temp'
as $function$
declare v_doc record; v_r jsonb; v_estado text;
begin
  select * into v_doc from app.asistente_documento(p_company, p_numero);
  if v_doc.id is null or v_doc.tipo <> 'cotizacion' then
    return jsonb_build_object('error', 'No encontré la cotización «' || coalesce(p_numero, '') || '».');
  end if;
  v_r := public.convertir_cotizacion_en_pedido(v_doc.id, null);
  select commercial_status into v_estado from sales_orders where id = (v_r ->> 'id')::uuid;
  -- Nace en borrador; para entregarlo tiene que estar confirmado (Fase 244).
  if p_confirmar and v_estado = 'draft' then
    update sales_orders set commercial_status = 'confirmed' where id = (v_r ->> 'id')::uuid;
    perform public.registrar_evento_venta('sales_order', (v_r ->> 'id')::uuid, 'approved', 'draft', 'confirmed', null);
    v_estado := 'confirmed';
  end if;
  return jsonb_build_object('creado', true, 'pedido', v_r ->> 'number', 'cotizacion', v_doc.numero,
    'estado', v_estado, 'total', (v_r ->> 'total')::numeric, 'renglones', v_r -> 'lineas',
    'nota', case when v_estado = 'confirmed' then 'Pedido creado y confirmado. Para entregarlo: crear_entrega.'
                 else 'Pedido creado en borrador: confirmalo con cambiar_estado antes de entregarlo.' end);
exception when others then
  return jsonb_build_object('error', app.asistente_error(sqlerrm));
end $function$;

-- ── 4. Entregar (nota de entrega / remito) ───────────────────────────────────
create or replace function public.asistente_crear_entrega(
  p_company uuid, p_numero_pedido text, p_productos jsonb default null, p_confirmar boolean default false)
returns jsonb language plpgsql
set search_path to 'public', 'app', 'pg_temp'
as $function$
declare v_doc record; v_lineas jsonb := '[]'::jsonb; v_item jsonb; v_ol uuid; v_falta jsonb := '[]'::jsonb; v_r jsonb; v_c jsonb;
begin
  select * into v_doc from app.asistente_documento(p_company, p_numero_pedido);
  if v_doc.id is null or v_doc.tipo <> 'pedido' then
    return jsonb_build_object('error', 'No encontré el pedido de venta «' || coalesce(p_numero_pedido, '') || '».');
  end if;

  if p_productos is null or jsonb_array_length(p_productos) = 0 then
    -- Todo lo pendiente.
    select coalesce(jsonb_agg(jsonb_build_object('order_line_id', p.order_line_id, 'quantity', p.pendiente)), '[]'::jsonb)
      into v_lineas from app.pendiente_de_pedido(v_doc.id, null) p where p.pendiente > 0;
  else
    for v_item in select value from jsonb_array_elements(p_productos) loop
      select p.order_line_id into v_ol
        from app.pendiente_de_pedido(v_doc.id, null) p join sales_order_lines l on l.id = p.order_line_id
       where upper(coalesce(l.sku_snapshot, '')) = upper(btrim(coalesce(v_item ->> 'producto', ''))) and p.pendiente > 0
       limit 1;
      if v_ol is null then v_falta := v_falta || to_jsonb(v_item ->> 'producto'); continue; end if;
      v_lineas := v_lineas || jsonb_build_object('order_line_id', v_ol, 'quantity', coalesce(nullif(v_item ->> 'cantidad', '')::numeric, 0));
    end loop;
    if jsonb_array_length(v_falta) > 0 then
      return jsonb_build_object('error', 'Esos productos no tienen nada pendiente de entregar en el pedido.', 'productos', v_falta);
    end if;
  end if;
  if jsonb_array_length(v_lineas) = 0 then
    return jsonb_build_object('error', 'El pedido ' || v_doc.numero || ' no tiene nada pendiente de entregar.');
  end if;

  v_r := public.crear_remito_desde_pedido(v_doc.id, v_lineas, null, null, null);
  if p_confirmar then v_c := public.confirmar_entrega((v_r ->> 'id')::uuid); end if;
  return jsonb_build_object('creada', true, 'entrega', v_r ->> 'number', 'pedido', v_doc.numero,
    'renglones', v_r -> 'lineas', 'confirmada', p_confirmar,
    'nota', case when p_confirmar then 'Entrega confirmada: ya descontó el stock.'
                 else 'Entrega creada en borrador: NO descontó stock. Se confirma con confirmar=true o desde el ERP.' end);
exception when others then
  return jsonb_build_object('error', app.asistente_error(sqlerrm));
end $function$;

-- ── 5. Facturar un pedido ────────────────────────────────────────────────────
create or replace function public.asistente_crear_factura(p_company uuid, p_numero_pedido text, p_fecha date default null)
returns jsonb language plpgsql
set search_path to 'public', 'app', 'pg_temp'
as $function$
declare v_doc record; v_r jsonb; v_f record;
begin
  select * into v_doc from app.asistente_documento(p_company, p_numero_pedido);
  if v_doc.id is null or v_doc.tipo <> 'pedido' then
    return jsonb_build_object('error', 'No encontré el pedido de venta «' || coalesce(p_numero_pedido, '') || '».');
  end if;
  v_r := public.crear_factura_desde_pedido(v_doc.id, p_fecha, null);
  select number, subtotal, total, currency_code into v_f from sales_invoices where id = (v_r ->> 'id')::uuid;
  return jsonb_build_object('creada', true, 'factura', v_f.number, 'pedido', v_doc.numero,
    'neto', v_f.subtotal, 'total', v_f.total, 'moneda', v_f.currency_code,
    'nota', 'Factura creada en borrador con número interno: el número fiscal lo da AFIP al emitirla.');
exception when others then
  return jsonb_build_object('error', app.asistente_error(sqlerrm));
end $function$;

-- ── 6. Crear un cliente ──────────────────────────────────────────────────────
create or replace function public.asistente_crear_cliente(
  p_company uuid, p_razon_social text, p_nombre_comercial text default null, p_cuit text default null,
  p_email text default null, p_telefono text default null, p_condicion_pago text default null, p_moneda text default null,
  p_contacto_nombre text default null, p_contacto_email text default null, p_contacto_telefono text default null,
  p_contacto_cargo text default null, p_calle text default null, p_ciudad text default null, p_provincia text default null,
  p_codigo_postal text default null, p_pais text default null)
returns jsonb language plpgsql
set search_path to 'public', 'app', 'pg_temp'
as $function$
declare v_datos jsonb; v_cont jsonb := null; v_dir jsonb := null; v_r jsonb; v_pais text;
begin
  v_datos := jsonb_strip_nulls(jsonb_build_object(
    'legal_name', p_razon_social, 'trade_name', p_nombre_comercial, 'tax_id', p_cuit,
    'emails', case when nullif(btrim(coalesce(p_email, '')), '') is not null then jsonb_build_array(lower(btrim(p_email))) end,
    'phone', p_telefono, 'payment_terms', p_condicion_pago, 'default_currency', upper(nullif(btrim(coalesce(p_moneda, '')), ''))));
  if nullif(btrim(coalesce(p_contacto_nombre, '')), '') is not null then
    v_cont := jsonb_strip_nulls(jsonb_build_object('full_name', p_contacto_nombre, 'email', p_contacto_email,
      'phone', p_contacto_telefono, 'role', p_contacto_cargo));
  end if;
  if nullif(btrim(coalesce(p_calle, '')), '') is not null then
    -- El país por defecto, el de la empresa: EUR → España.
    v_pais := upper(coalesce(nullif(btrim(coalesce(p_pais, '')), ''),
      case (select currency_code from price_lists where company_id = p_company and is_default limit 1) when 'EUR' then 'ES' else 'AR' end));
    v_dir := jsonb_strip_nulls(jsonb_build_object('kind', 'both', 'street', p_calle, 'city', p_ciudad, 'state', p_provincia,
      'postal_code', p_codigo_postal, 'country_code', v_pais));
  end if;
  v_r := public.crear_cliente(p_company, v_datos, v_cont, v_dir);
  return jsonb_build_object('creado', true, 'cliente', p_razon_social, 'referencia', v_r ->> 'referencia',
    'nota', 'Cliente creado. Ya se le puede cotizar por su nombre.');
exception when others then
  return jsonb_build_object('error', app.asistente_error(sqlerrm));
end $function$;

-- ── 7. Editar un cliente ─────────────────────────────────────────────────────
create or replace function public.asistente_editar_cliente(
  p_company uuid, p_cliente text, p_razon_social text default null, p_nombre_comercial text default null,
  p_cuit text default null, p_email text default null, p_telefono text default null,
  p_condicion_pago text default null, p_moneda text default null, p_notas text default null)
returns jsonb language plpgsql
set search_path to 'public', 'app', 'pg_temp'
as $function$
declare v_id uuid; v_c customers%rowtype; v_datos jsonb; v_r jsonb;
begin
  v_id := app.cliente_por_texto(p_company, p_cliente);
  if v_id is null then return jsonb_build_object('error', 'No encontré al cliente «' || coalesce(p_cliente, '') || '». Buscalo con buscar_cliente.'); end if;
  select * into v_c from customers where id = v_id;
  v_datos := jsonb_strip_nulls(jsonb_build_object(
    'legal_name', p_razon_social, 'trade_name', p_nombre_comercial, 'tax_id', p_cuit,
    'emails', case when nullif(btrim(coalesce(p_email, '')), '') is not null
                   then to_jsonb(array(select distinct e from unnest(coalesce(v_c.emails, '{}'::text[]) || lower(btrim(p_email))) e)) end,
    'phone', p_telefono, 'payment_terms', p_condicion_pago,
    'default_currency', upper(nullif(btrim(coalesce(p_moneda, '')), '')), 'notes', p_notas));
  if v_datos = '{}'::jsonb then return jsonb_build_object('error', 'No me dijiste qué cambiar.'); end if;
  v_r := public.guardar_cliente(v_id, v_c.updated_at, v_datos);
  return jsonb_build_object('editado', true, 'cliente', coalesce(p_razon_social, v_c.legal_name),
    'campos', v_r -> 'campos', 'sin_cambios', v_r -> 'sin_cambios');
exception when others then
  return jsonb_build_object('error', app.asistente_error(sqlerrm));
end $function$;

-- ── 8. Pedido a proveedor ────────────────────────────────────────────────────
create or replace function public.asistente_crear_pedido_compra(
  p_company uuid, p_proveedor text, p_productos jsonb, p_moneda text default null,
  p_fecha_estimada date default null, p_condicion_pago text default null, p_notas text default null,
  p_para_venta text default null)
returns jsonb language plpgsql
set search_path to 'public', 'app', 'extensions', 'pg_temp'
as $function$
declare
  v_sup suppliers%rowtype; v_moneda text; v_serie text; v_numero text; v_id uuid; v_item jsonb; v_prod record;
  v_faltan jsonb := '[]'::jsonb; v_n int := 0; v_venta record; v_venta_id uuid; v_venta_tipo text; v_venta_num text; v_vl uuid; v_vcant numeric; v_cant numeric; v_sin_precio int := 0;
  v_tot record;
begin
  if app."current_role"(p_company) not in ('admin', 'employee') then
    return jsonb_build_object('error', 'Tu rol no crea pedidos a proveedor.');
  end if;
  select * into v_sup from suppliers where id = app.proveedor_por_texto(p_company, p_proveedor);
  if v_sup.id is null then
    return jsonb_build_object('error', 'No encontré al proveedor «' || coalesce(p_proveedor, '') || '» (o hay más de uno parecido). Pedí el nombre exacto.');
  end if;
  if p_productos is null or jsonb_array_length(p_productos) = 0 then
    return jsonb_build_object('error', 'Falta qué pedir.');
  end if;
  if p_para_venta is not null then
    select * into v_venta from app.asistente_documento(p_company, p_para_venta);
    if v_venta.id is null or v_venta.tipo not in ('cotizacion', 'pedido') then
      return jsonb_build_object('error', 'No encontré la venta «' || p_para_venta || '» (cotización o pedido).');
    end if;
    v_venta_id := v_venta.id; v_venta_tipo := v_venta.tipo; v_venta_num := v_venta.numero;
  end if;

  -- Todos los productos, antes de crear nada.
  for v_item in select value from jsonb_array_elements(p_productos) loop
    if not exists (select 1 from app.asistente_producto(p_company, v_item ->> 'producto')) then
      v_faltan := v_faltan || to_jsonb(v_item ->> 'producto');
    end if;
  end loop;
  if jsonb_array_length(v_faltan) > 0 then
    return jsonb_build_object('error', 'No creé nada: hay productos que no encontré.', 'no_encontrados', v_faltan);
  end if;

  v_moneda := upper(coalesce(nullif(btrim(coalesce(p_moneda, '')), ''), v_sup.default_currency,
    (select currency_code from price_lists where company_id = p_company and is_default limit 1)));
  select series_code into v_serie from document_sequences where company_id = p_company and doc_type = 'purchase_order' and is_default;
  v_serie := coalesce(v_serie, 'PC');
  v_numero := public.next_document_number(p_company, 'purchase_order', v_serie);

  insert into purchase_orders (company_id, number, series_code, status, supplier_id, currency_code, order_date,
                               expected_date, payment_terms, notes)
  values (p_company, v_numero, v_serie, 'draft', v_sup.id, v_moneda, current_date, p_fecha_estimada,
          coalesce(p_condicion_pago, v_sup.payment_terms),
          coalesce(p_notas, case when v_venta_num is not null then 'Para ' || v_venta_num end))
  returning id into v_id;

  for v_item in select value from jsonb_array_elements(p_productos) loop
    select * into v_prod from app.asistente_producto(p_company, v_item ->> 'producto');
    v_n := v_n + 1;
    v_cant := coalesce(nullif(v_item ->> 'cantidad', '')::numeric, 1);
    if nullif(v_item ->> 'precio_unitario', '') is null then v_sin_precio := v_sin_precio + 1; end if;
    -- El vínculo con la venta: la línea del mismo producto.
    v_vl := null; v_vcant := null;
    if v_venta_id is not null then
      if v_venta_tipo = 'cotizacion' then
        select l.id, l.quantity into v_vl, v_vcant from sales_quote_lines l where l.quote_id = v_venta_id and l.product_id = v_prod.id limit 1;
      else
        select l.id, l.quantity_ordered into v_vl, v_vcant from sales_order_lines l where l.order_id = v_venta_id and l.product_id = v_prod.id limit 1;
      end if;
    end if;
    insert into purchase_order_lines (company_id, purchase_order_id, line_no, line_type, product_id, sku_snapshot,
      name_snapshot, quantity, unit_price, discount_pct, tax_treatment, tax_rate_snapshot,
      sales_quote_line_id, sales_order_line_id, quantity_for_sale)
    values (p_company, v_id, v_n, 'product', v_prod.id, v_prod.sku, v_prod.nombre, v_cant,
      nullif(v_item ->> 'precio_unitario', '')::numeric, coalesce(nullif(v_item ->> 'descuento', '')::numeric, 0),
      'vat_21', null,
      case when v_venta_tipo = 'cotizacion' then v_vl end, case when v_venta_tipo = 'pedido' then v_vl end,
      case when v_vl is not null then least(v_cant, v_vcant) end);
  end loop;

  select subtotal, total into v_tot from purchase_orders where id = v_id;
  return jsonb_build_object('creado', true, 'pedido_compra', v_numero, 'proveedor', v_sup.legal_name, 'moneda', v_moneda,
    'renglones', v_n, 'neto', v_tot.subtotal, 'total', v_tot.total, 'estado', 'draft', 'para_venta', v_venta_num,
    'nota', 'Pedido a proveedor creado en borrador.'
      || case when v_sin_precio > 0 then ' ' || v_sin_precio || ' renglón(es) quedaron SIN PRECIO.' else '' end
      || ' Para mandarlo: cambiar_estado a confirmado.');
exception when others then
  return jsonb_build_object('error', app.asistente_error(sqlerrm));
end $function$;

-- ── 9. Recepción de mercadería ───────────────────────────────────────────────
create or replace function public.asistente_registrar_recepcion(
  p_company uuid, p_numero_pedido text, p_productos jsonb default null,
  p_remito_proveedor text default null, p_confirmar boolean default true)
returns jsonb language plpgsql
set search_path to 'public', 'app', 'pg_temp'
as $function$
declare v_doc record; v_po purchase_orders%rowtype; v_dep uuid; v_serie text; v_numero text; v_id uuid;
        v_item jsonb; v_p record; v_n int := 0; v_falta jsonb := '[]'::jsonb; v_c jsonb;
begin
  select * into v_doc from app.asistente_documento(p_company, p_numero_pedido);
  if v_doc.id is null or v_doc.tipo <> 'pedido_compra' then
    return jsonb_build_object('error', 'No encontré el pedido a proveedor «' || coalesce(p_numero_pedido, '') || '».');
  end if;
  select * into v_po from purchase_orders where id = v_doc.id;
  if v_po.status <> 'confirmed' then
    return jsonb_build_object('error', 'El pedido ' || v_po.number || ' está ' || v_po.status || ': para recibir tiene que estar confirmado.');
  end if;
  select id into v_dep from warehouses where company_id = p_company and coalesce(is_active, true)
   order by is_default desc, created_at limit 1;
  select series_code into v_serie from document_sequences where company_id = p_company and doc_type = 'goods_receipt' and is_default;
  v_numero := public.next_document_number(p_company, 'goods_receipt', coalesce(v_serie, 'NTEP'));

  insert into goods_receipts (company_id, supplier_id, purchase_order_id, warehouse_id, number, status, receipt_date, supplier_document)
  values (p_company, v_po.supplier_id, v_po.id, v_dep, v_numero, 'draft', current_date, nullif(btrim(coalesce(p_remito_proveedor, '')), ''))
  returning id into v_id;

  if p_productos is null or jsonb_array_length(p_productos) = 0 then
    for v_p in select * from public.pendiente_de_pedido(v_po.id, null) where pendiente > 0 loop
      v_n := v_n + 1;
      insert into goods_receipt_lines (company_id, goods_receipt_id, purchase_order_line_id, product_id, sku_snapshot, name_snapshot, quantity)
      values (p_company, v_id, v_p.purchase_order_line_id, v_p.product_id, v_p.sku, v_p.descripcion, v_p.pendiente);
    end loop;
  else
    for v_item in select value from jsonb_array_elements(p_productos) loop
      select * into v_p from public.pendiente_de_pedido(v_po.id, null)
       where upper(coalesce(sku, '')) = upper(btrim(coalesce(v_item ->> 'producto', ''))) and pendiente > 0 limit 1;
      if v_p.purchase_order_line_id is null then v_falta := v_falta || to_jsonb(v_item ->> 'producto'); continue; end if;
      v_n := v_n + 1;
      insert into goods_receipt_lines (company_id, goods_receipt_id, purchase_order_line_id, product_id, sku_snapshot, name_snapshot, quantity)
      values (p_company, v_id, v_p.purchase_order_line_id, v_p.product_id, v_p.sku, v_p.descripcion,
              least(coalesce(nullif(v_item ->> 'cantidad', '')::numeric, v_p.pendiente), v_p.pendiente));
    end loop;
    if jsonb_array_length(v_falta) > 0 then
      raise exception 'NADA_PENDIENTE: %', v_falta::text;
    end if;
  end if;
  if v_n = 0 then raise exception 'NADA_PENDIENTE'; end if;

  if p_confirmar then v_c := public.confirmar_recepcion(v_id); end if;
  return jsonb_build_object('creada', true, 'recepcion', v_numero, 'pedido_compra', v_po.number, 'renglones', v_n,
    'confirmada', p_confirmar,
    'nota', case when p_confirmar then 'Recepción confirmada: el stock ya entró.'
                 else 'Recepción en borrador: el stock entra al confirmarla.' end);
exception when others then
  return jsonb_build_object('error', case when sqlerrm ~ 'NADA_PENDIENTE'
    then 'No hay nada pendiente de recibir para eso en el pedido ' || coalesce(v_doc.numero, '') || '.'
    else app.asistente_error(sqlerrm) end);
end $function$;

-- ── 10. Factura de proveedor ─────────────────────────────────────────────────
create or replace function public.asistente_registrar_factura_proveedor(
  p_company uuid, p_numero_pedido text, p_numero_proveedor text, p_fecha date default null,
  p_vencimiento date default null, p_registrar boolean default false)
returns jsonb language plpgsql
set search_path to 'public', 'app', 'pg_temp'
as $function$
declare v_doc record; v_po purchase_orders%rowtype; v_serie text; v_numero text; v_id uuid; v_p record; v_n int := 0;
        v_pl purchase_order_lines%rowtype; v_r jsonb; v_f record;
begin
  select * into v_doc from app.asistente_documento(p_company, p_numero_pedido);
  if v_doc.id is null or v_doc.tipo <> 'pedido_compra' then
    return jsonb_build_object('error', 'No encontré el pedido a proveedor «' || coalesce(p_numero_pedido, '') || '».');
  end if;
  if nullif(btrim(coalesce(p_numero_proveedor, '')), '') is null then
    return jsonb_build_object('error', 'Falta el número de la factura del proveedor.');
  end if;
  select * into v_po from purchase_orders where id = v_doc.id;
  if not exists (select 1 from public.pendiente_de_facturar(p_company, null, v_po.supplier_id, null)
                  where purchase_order_id = v_po.id and pendiente > 0) then
    return jsonb_build_object('error', 'No hay nada recibido sin facturar en el pedido ' || v_po.number || '. Primero registrá la recepción.');
  end if;

  select series_code into v_serie from document_sequences where company_id = p_company and doc_type = 'supplier_invoice' and is_default;
  v_serie := coalesce(v_serie, 'FP');
  v_numero := public.next_document_number(p_company, 'supplier_invoice', v_serie);
  insert into supplier_invoices (company_id, number, series_code, status, supplier_id, supplier_number, currency_code,
                                 exchange_rate, invoice_date, due_date, payment_terms)
  values (p_company, v_numero, v_serie, 'draft', v_po.supplier_id, btrim(p_numero_proveedor), v_po.currency_code,
          v_po.exchange_rate, coalesce(p_fecha, current_date), p_vencimiento, v_po.payment_terms)
  returning id into v_id;

  for v_p in select * from public.pendiente_de_facturar(p_company, null, v_po.supplier_id, null)
              where purchase_order_id = v_po.id and pendiente > 0 loop
    select * into v_pl from purchase_order_lines where id = v_p.purchase_order_line_id;
    v_n := v_n + 1;
    insert into supplier_invoice_lines (company_id, supplier_invoice_id, line_no, line_type, goods_receipt_line_id,
      purchase_order_line_id, product_id, sku_snapshot, description_snapshot, quantity, unit_price, discount_pct,
      tax_treatment, tax_rate_snapshot)
    values (p_company, v_id, v_n, 'product', v_p.goods_receipt_line_id, v_p.purchase_order_line_id, v_p.product_id,
      v_p.sku, v_p.descripcion, v_p.pendiente, coalesce(v_p.precio_pedido, 0), coalesce(v_pl.discount_pct, 0),
      coalesce(v_p.tratamiento_pedido, 'vat_21'), v_pl.tax_rate_snapshot);
  end loop;

  if p_registrar then v_r := public.registrar_factura_proveedor(v_id); end if;
  select subtotal, total into v_f from supplier_invoices where id = v_id;
  return jsonb_build_object('creada', true, 'factura_proveedor', v_numero, 'numero_proveedor', btrim(p_numero_proveedor),
    'pedido_compra', v_po.number, 'renglones', v_n, 'neto', v_f.subtotal, 'total', v_f.total, 'moneda', v_po.currency_code,
    'registrada', p_registrar,
    'nota', case when p_registrar then 'Factura de proveedor registrada.'
                 else 'Factura de proveedor en borrador, con los precios del pedido: revisalos contra la factura real y registrala.' end);
exception when others then
  return jsonb_build_object('error', app.asistente_error(sqlerrm));
end $function$;

-- ── 11. Precio, costo o nombre de un producto ────────────────────────────────
create or replace function public.asistente_actualizar_producto(
  p_company uuid, p_sku text, p_precio_lista numeric default null, p_costo numeric default null,
  p_moneda_costo text default null, p_nombre text default null)
returns jsonb language plpgsql
set search_path to 'public', 'app', 'pg_temp'
as $function$
declare v_id uuid; v_p products%rowtype; v_r jsonb;
begin
  v_id := app.producto_por_sku_exacto(p_company, p_sku);
  if v_id is null then return jsonb_build_object('error', 'No existe el SKU «' || coalesce(p_sku, '') || '» en esta empresa.'); end if;
  if p_precio_lista is null and p_costo is null and p_nombre is null then
    return jsonb_build_object('error', 'No me dijiste qué cambiar (precio_lista, costo o nombre).');
  end if;
  if p_precio_lista is not null or p_costo is not null then
    v_r := public.erp_cargar_datos_comerciales(p_company, v_id, p_costo, upper(nullif(btrim(coalesce(p_moneda_costo, '')), '')), p_precio_lista, null);
  end if;
  if nullif(btrim(coalesce(p_nombre, '')), '') is not null then
    update products set name = btrim(p_nombre), updated_at = now() where id = v_id;
  end if;
  select * into v_p from products where id = v_id;
  return jsonb_build_object('actualizado', true, 'sku', v_p.sku, 'nombre', v_p.name,
    'precio_lista', (select importe from app.precio_de_lista(p_company, v_id)),
    'costo', v_p.cost_amount, 'moneda_costo', v_p.cost_currency);
exception when others then
  return jsonb_build_object('error', app.asistente_error(sqlerrm));
end $function$;

-- ── 12. Ajuste de stock ──────────────────────────────────────────────────────
create or replace function public.asistente_ajustar_stock(
  p_company uuid, p_sku text, p_motivo text, p_stock_final numeric default null, p_diferencia numeric default null)
returns jsonb language plpgsql
set search_path to 'public', 'app', 'pg_temp'
as $function$
declare v_id uuid; v_sku text; v_antes numeric; v_dif numeric; v_dep uuid;
begin
  v_id := app.producto_por_sku_exacto(p_company, p_sku);
  if v_id is null then return jsonb_build_object('error', 'No existe el SKU «' || coalesce(p_sku, '') || '» en esta empresa.'); end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then
    return jsonb_build_object('error', 'Falta el motivo del ajuste (queda en el historial del producto).');
  end if;
  if (p_stock_final is null) = (p_diferencia is null) then
    return jsonb_build_object('error', 'Decime stock_final (cuántos tiene que haber) o diferencia (+/-), uno de los dos.');
  end if;
  select sku into v_sku from products where id = v_id;
  select coalesce(en_mano, 0) into v_antes from app.stock_de(v_id);
  v_antes := coalesce(v_antes, 0);
  v_dif := coalesce(p_diferencia, p_stock_final - v_antes);
  if v_dif = 0 then return jsonb_build_object('sin_cambios', true, 'sku', v_sku, 'stock', v_antes); end if;
  select id into v_dep from warehouses where company_id = p_company and coalesce(is_active, true)
   order by is_default desc, created_at limit 1;
  insert into stock_movements (company_id, product_id, warehouse_id, movement_type, quantity, notes)
  values (p_company, v_id, v_dep, 'adjustment', v_dif, 'Ajuste (asistente): ' || btrim(p_motivo));
  return jsonb_build_object('ajustado', true, 'sku', v_sku, 'antes', v_antes, 'diferencia', v_dif,
    'despues', (select coalesce(en_mano, 0) from app.stock_de(v_id)));
exception when others then
  return jsonb_build_object('error', app.asistente_error(sqlerrm));
end $function$;

-- ── 13. Enviar un documento por mail (lo prepara; lo manda el ejecutor) ──────
-- La base no sale a internet: arma el correo —desde la cuenta de Gmail de la
-- empresa, con el documento en el cuerpo— y el ejecutor de la Edge Function
-- lo manda por la API de correo, con la sesión de quien pregunta.
create or replace function public.asistente_preparar_envio(
  p_company uuid, p_numero text, p_para text default null, p_asunto text default null, p_mensaje text default null)
returns jsonb language plpgsql stable
set search_path to 'public', 'app', 'pg_temp'
as $function$
declare
  v_doc record; v_cab record; v_para text[]; v_cuenta record; v_lin text; v_texto text; v_asunto text; v_titulo text;
begin
  select * into v_doc from app.asistente_documento(p_company, p_numero);
  if v_doc.id is null or v_doc.tipo not in ('cotizacion', 'pedido', 'factura', 'pedido_compra') then
    return jsonb_build_object('error', 'Se puede enviar una cotización, un pedido, una factura o un pedido a proveedor. No encontré «' || coalesce(p_numero, '') || '».');
  end if;

  if v_doc.tipo = 'cotizacion' then
    select q.number, q.currency_code mon, q.subtotal neto, q.tax_amount iva, q.total, c.legal_name dest, c.emails mails
      into v_cab from sales_quotes q join customers c on c.id = q.customer_id where q.id = v_doc.id;
    select string_agg(format('- %s — %s: %s x %s%s = %s', coalesce(l.sku_snapshot, ''), coalesce(l.name_snapshot, ''),
             trim_scale(l.quantity), trim_scale(l.unit_price),
             case when coalesce(l.discount_pct, 0) > 0 then ' (-' || trim_scale(l.discount_pct) || '%)' else '' end,
             round(l.quantity * l.unit_price * (1 - coalesce(l.discount_pct, 0) / 100), 2)), E'\n' order by l.line_no)
      into v_lin from sales_quote_lines l where l.quote_id = v_doc.id and l.line_type <> 'chapter';
    v_titulo := 'Cotización';
  elsif v_doc.tipo = 'pedido' then
    select o.number, o.currency_code mon, o.subtotal neto, o.tax_amount iva, o.total, c.legal_name dest, c.emails mails
      into v_cab from sales_orders o join customers c on c.id = o.customer_id where o.id = v_doc.id;
    select string_agg(format('- %s — %s: %s x %s = %s', coalesce(l.sku_snapshot, ''), coalesce(l.name_snapshot, ''),
             trim_scale(l.quantity_ordered), trim_scale(l.unit_price),
             round(l.quantity_ordered * l.unit_price * (1 - coalesce(l.discount_pct, 0) / 100), 2)), E'\n' order by l.line_no)
      into v_lin from sales_order_lines l where l.order_id = v_doc.id and l.line_type <> 'chapter';
    v_titulo := 'Pedido';
  elsif v_doc.tipo = 'factura' then
    select f.number, f.currency_code mon, f.subtotal neto, f.tax_amount iva, f.total, c.legal_name dest, c.emails mails
      into v_cab from sales_invoices f join customers c on c.id = f.customer_id where f.id = v_doc.id;
    select string_agg(format('- %s — %s: %s x %s', coalesce(l.sku_snapshot, ''), coalesce(l.name_snapshot, ''),
             trim_scale(l.quantity), trim_scale(l.unit_price)), E'\n' order by l.created_at)
      into v_lin from sales_invoice_lines l where l.invoice_id = v_doc.id;
    v_titulo := 'Factura';
  else
    select p.number, p.currency_code mon, p.subtotal neto, p.tax_amount iva, p.total, s.legal_name dest,
           case when s.email is not null then array[s.email] end mails
      into v_cab from purchase_orders p join suppliers s on s.id = p.supplier_id where p.id = v_doc.id;
    select string_agg(format('- %s — %s: %s%s', coalesce(l.sku_snapshot, ''), coalesce(l.name_snapshot, ''), trim_scale(l.quantity),
             case when l.unit_price is not null then ' x ' || trim_scale(l.unit_price) else '' end), E'\n' order by l.line_no)
      into v_lin from purchase_order_lines l where l.purchase_order_id = v_doc.id and l.line_type <> 'chapter';
    v_titulo := 'Pedido de compra';
  end if;

  v_para := array(select lower(btrim(x)) from unnest(string_to_array(coalesce(nullif(btrim(coalesce(p_para, '')), ''),
                    array_to_string(coalesce(v_cab.mails, '{}'::text[]), ',')), ',')) x where btrim(x) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
  if coalesce(array_length(v_para, 1), 0) = 0 then
    return jsonb_build_object('error', 'No tengo a quién mandarlo: ' || v_cab.dest || ' no tiene correo cargado. Pasame el destinatario en «para».');
  end if;

  select a.id, a.email_address into v_cuenta from email_accounts a where a.company_id = p_company and a.active order by a.created_at limit 1;
  if v_cuenta.id is null then
    return jsonb_build_object('error', 'Esta empresa no tiene una cuenta de correo conectada en el ERP (Emails).');
  end if;

  v_asunto := coalesce(nullif(btrim(coalesce(p_asunto, '')), ''), v_titulo || ' ' || v_cab.number);
  v_texto := coalesce(nullif(btrim(coalesce(p_mensaje, '')), '') || E'\n\n', 'Hola, te enviamos el detalle.' || E'\n\n')
    || v_titulo || ' ' || v_cab.number || ' — ' || v_cab.dest || E'\n\n'
    || coalesce(v_lin, '') || E'\n\n'
    || 'Neto: ' || coalesce(v_cab.neto::text, '-') || ' ' || coalesce(v_cab.mon, '') || E'\n'
    || 'Impuestos: ' || coalesce(v_cab.iva::text, '-') || ' ' || coalesce(v_cab.mon, '') || E'\n'
    || 'Total: ' || coalesce(v_cab.total::text, '-') || ' ' || coalesce(v_cab.mon, '') || E'\n';

  return jsonb_build_object(
    'documento', v_cab.number, 'tipo', v_doc.tipo, 'desde', v_cuenta.email_address,
    'envio', jsonb_build_object('account_id', v_cuenta.id, 'para', to_jsonb(v_para), 'asunto', v_asunto, 'texto', v_texto,
      -- El mismo pedido repetido el mismo día no manda dos correos.
      'client_request_id', md5(v_doc.id::text || array_to_string(v_para, ',') || v_asunto || current_date::text)));
exception when others then
  return jsonb_build_object('error', app.asistente_error(sqlerrm));
end $function$;

-- ── crear_cotizacion: el estado REAL ─────────────────────────────────────────
-- El ERP no guarda borradores: `app.cotizacion_sale_de_borrador` pasa toda
-- cotización a `sent` («Pendiente»: abierta y editable, NO enviada a nadie).
-- La respuesta decía «draft» a mano; ahora dice lo que quedó.
do $$
declare d text := pg_get_functiondef('public.asistente_crear_cotizacion(uuid,text,jsonb,text,text,text)'::regprocedure);
begin
  d := replace(d, $x$'estado',   'draft',$x$, $x$'estado',   (select status from public.sales_quotes where id = (v_res ->> 'id')::uuid),$x$);
  d := replace(d, $x$'Creada en BORRADOR. $x$, $x$'Creada como Pendiente (abierta y editable; no se envió a nadie). $x$);
  execute d;
end $$;

grant execute on function
  public.asistente_editar_cotizacion(uuid, text, jsonb, text, text, text, text, date, numeric),
  public.asistente_cambiar_estado(uuid, text, text),
  public.asistente_convertir_a_pedido(uuid, text, boolean),
  public.asistente_crear_entrega(uuid, text, jsonb, boolean),
  public.asistente_crear_factura(uuid, text, date),
  public.asistente_crear_cliente(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text),
  public.asistente_editar_cliente(uuid, text, text, text, text, text, text, text, text, text),
  public.asistente_crear_pedido_compra(uuid, text, jsonb, text, date, text, text, text),
  public.asistente_registrar_recepcion(uuid, text, jsonb, text, boolean),
  public.asistente_registrar_factura_proveedor(uuid, text, text, date, date, boolean),
  public.asistente_actualizar_producto(uuid, text, numeric, numeric, text, text),
  public.asistente_ajustar_stock(uuid, text, text, numeric, numeric),
  public.asistente_preparar_envio(uuid, text, text, text, text)
to authenticated, service_role;

revoke execute on function
  public.asistente_editar_cotizacion(uuid, text, jsonb, text, text, text, text, date, numeric),
  public.asistente_cambiar_estado(uuid, text, text),
  public.asistente_convertir_a_pedido(uuid, text, boolean),
  public.asistente_crear_entrega(uuid, text, jsonb, boolean),
  public.asistente_crear_factura(uuid, text, date),
  public.asistente_crear_cliente(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text),
  public.asistente_editar_cliente(uuid, text, text, text, text, text, text, text, text, text),
  public.asistente_crear_pedido_compra(uuid, text, jsonb, text, date, text, text, text),
  public.asistente_registrar_recepcion(uuid, text, jsonb, text, boolean),
  public.asistente_registrar_factura_proveedor(uuid, text, text, date, date, boolean),
  public.asistente_actualizar_producto(uuid, text, numeric, numeric, text, text),
  public.asistente_ajustar_stock(uuid, text, text, numeric, numeric),
  public.asistente_preparar_envio(uuid, text, text, text, text)
from anon, public;
