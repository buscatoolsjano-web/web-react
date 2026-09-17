-- ---------------------------------------------------------------------------
-- FASE 15 · VENTAS — Entrega 4: el pedido al nivel de la cotización
-- ---------------------------------------------------------------------------
--
-- Tres escrituras del navegador pasan al servidor, en una transacción cada una:
--
--   · `guardar_pedido`  — editar cabecera y líneas (gemela de `guardar_cotizacion`)
--   · `crear_pedido`    — alta manual (gemela de `crear_cotizacion`)
--   · `convertir_cotizacion_en_pedido` — la conversión, que hasta ahora era
--     leer la cotización, insertar el pedido, insertar las líneas y volver a
--     escribir desde el navegador.
--
-- Y una columna: `sales_orders.price_list_id`. El pedido no sabía con qué
-- tarifa se había vendido; la cotización sí desde E2.
--
-- REGLA DE LA CONVERSIÓN: el pedido hereda el SNAPSHOT COMERCIAL APROBADO.
-- Se copian los precios, descuentos e impuestos de la cotización tal como
-- quedaron. NO se vuelve a consultar la lista de precios: si la tarifa cambió
-- después de cotizar, el pedido derivado no se entera. La tarifa se copia como
-- dato (`price_list_id`), no como fuente de precios.
--
-- Invariantes existentes que NO se tocan (las siguen imponiendo los triggers):
-- un pedido cancelado no se modifica, un pedido con entregas no cambia sus
-- líneas, los totales los calcula el servidor, la autoridad de numeración la
-- exige `next_document_number`, y el stock y las reservas sólo se mueven al
-- confirmar una ENTREGA.


-- ---------------------------------------------------------------------------
-- 1 · La tarifa del pedido
-- ---------------------------------------------------------------------------
-- Nullable y sin backfill: de los pedidos históricos no sabemos con qué lista
-- se vendieron, y completarlo con la lista por defecto sería inventarlo.

alter table sales_orders
  add column if not exists price_list_id uuid references price_lists(id);

comment on column sales_orders.price_list_id is
  'Tarifa con la que se vendió. Se copia de la cotización al convertir; no recalcula precios.';

create index if not exists idx_orders_tarifa on sales_orders (company_id, price_list_id)
  where price_list_id is not null;


-- ---------------------------------------------------------------------------
-- 2 · Validaciones comunes
-- ---------------------------------------------------------------------------
-- Las mismas reglas de negocio de la cotización, en un solo lugar, para que el
-- pedido no se separe con el tiempo. Devuelve la moneda de la tarifa para que
-- quien llame no la vuelva a leer.

create or replace function app.validar_cabecera_venta(
  p_company   uuid,
  p_customer  uuid,
  p_contact   uuid,
  p_vendedor  uuid,
  p_lista     uuid,
  p_moneda    text
) returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_lista_moneda text;
begin
  if p_customer is null then
    raise exception 'CLIENTE_REQUERIDO' using errcode = '22023';
  end if;
  if p_moneda is null then
    raise exception 'DOCUMENT_CURRENCY_REQUIRED' using errcode = '22023';
  end if;

  if not exists (select 1 from customers c
                  where c.id = p_customer and c.company_id = p_company and c.deleted_at is null) then
    raise exception 'CLIENTE_INVALIDO' using errcode = '42501';
  end if;

  -- El contacto tiene que ser del cliente elegido: que el desplegable haya
  -- mostrado los correctos no alcanza, el cliente puede mandar otro.
  if p_contact is not null
     and not exists (select 1 from customer_contacts cc
                      where cc.id = p_contact and cc.customer_id = p_customer and cc.company_id = p_company) then
    raise exception 'CONTACTO_DE_OTRO_CLIENTE' using errcode = '42501';
  end if;

  if p_vendedor is not null
     and not exists (select 1 from company_memberships cm
                      where cm.user_id = p_vendedor and cm.company_id = p_company and cm.status = 'active') then
    raise exception 'VENDEDOR_INVALIDO' using errcode = '42501';
  end if;

  if p_lista is not null then
    select pl.currency_code into v_lista_moneda
      from price_lists pl where pl.id = p_lista and pl.company_id = p_company;
    if v_lista_moneda is null then
      raise exception 'TARIFA_INVALIDA' using errcode = '42501';
    end if;
    if v_lista_moneda is distinct from p_moneda then
      raise exception 'TARIFA_OTRA_MONEDA' using errcode = '42501',
        detail = format('la lista esta en %s y el documento en %s', v_lista_moneda, p_moneda);
    end if;
  end if;
end;
$$;

revoke execute on function app.validar_cabecera_venta(uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
grant  execute on function app.validar_cabecera_venta(uuid, uuid, uuid, uuid, uuid, text) to service_role;

-- Una línea de venta, validada con códigos entendibles antes de que hable el CHECK.
create or replace function app.validar_linea_venta(p_company uuid, p_l jsonb)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce((p_l->>'quantity')::numeric, 0) = 0 then
    raise exception 'CANTIDAD_INVALIDA' using errcode = '22023';
  end if;
  if coalesce((p_l->>'discount_pct')::numeric, 0) < 0
     or coalesce((p_l->>'discount_pct')::numeric, 0) > 100 then
    raise exception 'DESCUENTO_INVALIDO' using errcode = '22023';
  end if;
  if coalesce((p_l->>'unit_price')::numeric, 0) < 0 then
    raise exception 'PRECIO_INVALIDO' using errcode = '22023';
  end if;
  if nullif(p_l->>'product_id', '') is not null
     and not exists (select 1 from products p
                      where p.id = (p_l->>'product_id')::uuid and p.company_id = p_company) then
    raise exception 'PRODUCTO_INVALIDO' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function app.validar_linea_venta(uuid, jsonb) from public, anon, authenticated;
grant  execute on function app.validar_linea_venta(uuid, jsonb) to service_role;


-- ---------------------------------------------------------------------------
-- 3 · Guardar un pedido — cabecera y líneas en UNA transacción
-- ---------------------------------------------------------------------------
-- Gemela de `guardar_cotizacion`: mismo contrato, mismos códigos de error y el
-- mismo control de concurrencia (`for update` + `updated_at`).
--
-- El estado editable es el del pedido: borrador y confirmado SIN entregas. Un
-- pedido cancelado, o con entregas, lo frena el trigger igual; acá se contesta
-- con un código entendible antes de llegar ahí.

create or replace function public.guardar_pedido(
  p_order     uuid,
  p_esperado  timestamptz,
  p_cabecera  jsonb,
  p_lineas    jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  k_permitidos constant text[] := array[
    'customer_id', 'contact_id', 'order_date', 'title', 'salesperson_id',
    'payment_terms', 'currency_code', 'price_list_id', 'notes',
    'exchange_rate', 'discount_pct', 'perception_pct'
  ];

  v_o         sales_orders%rowtype;
  v_rol       text;
  v_campo     text;
  v_cambios   jsonb := '{}'::jsonb;
  v_lineas    jsonb := '[]'::jsonb;
  v_antes     jsonb;
  v_despues   jsonb;
  v_entregas  int;

  v_customer  uuid;
  v_contact   uuid;
  v_moneda    text;
  v_lista     uuid;
  v_vendedor  uuid;

  v_l         jsonb;
  v_id        uuid;
  v_n         int := 0;
  v_vieja     sales_order_lines%rowtype;
  v_ids       uuid[] := '{}';
  v_cambio_l  jsonb;
  v_updated   timestamptz;
begin
  -- ── 1 · El documento y quién lo toca ────────────────────────────────────
  select * into v_o from sales_orders where id = p_order for update;
  if not found then
    raise exception 'PEDIDO_INEXISTENTE' using errcode = '42704';
  end if;

  select cm.role into v_rol
    from company_memberships cm
   where cm.user_id = auth.uid() and cm.company_id = v_o.company_id and cm.status = 'active'
   limit 1;
  if v_rol is null or v_rol not in ('admin', 'employee') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  -- ── 2 · Estado ──────────────────────────────────────────────────────────
  if v_o.commercial_status = 'cancelled' then
    raise exception 'ESTADO_NO_EDITABLE' using errcode = '42501', detail = 'el pedido está cancelado';
  end if;
  select count(*) into v_entregas from deliveries where order_id = p_order;
  if v_entregas > 0 then
    raise exception 'PEDIDO_CON_ENTREGAS' using errcode = '42501',
      detail = format('el pedido tiene %s entrega(s)', v_entregas);
  end if;

  -- ── 3 · Concurrencia ────────────────────────────────────────────────────
  -- Sin errcode 40001 a propósito: PostgREST reintenta los de serialización y
  -- un conflicto de edición no se arregla reintentando.
  if p_esperado is null or v_o.updated_at is distinct from p_esperado then
    raise exception 'CONFLICTO_DE_EDICION';
  end if;

  -- ── 4 · Payload cerrado ─────────────────────────────────────────────────
  if p_cabecera is null or jsonb_typeof(p_cabecera) <> 'object' then
    raise exception 'CABECERA_INVALIDA' using errcode = '22023';
  end if;
  for v_campo in select jsonb_object_keys(p_cabecera) loop
    if not (v_campo = any (k_permitidos)) then
      raise exception 'CAMPO_NO_PERMITIDO' using errcode = '42501', detail = v_campo;
    end if;
  end loop;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' then
    raise exception 'LINEAS_INVALIDAS' using errcode = '22023';
  end if;

  v_customer := coalesce((p_cabecera->>'customer_id')::uuid, v_o.customer_id);
  v_contact  := case when p_cabecera ? 'contact_id' then nullif(p_cabecera->>'contact_id', '')::uuid else v_o.contact_id end;
  v_moneda   := coalesce(p_cabecera->>'currency_code', v_o.currency_code);
  v_lista    := case when p_cabecera ? 'price_list_id' then nullif(p_cabecera->>'price_list_id', '')::uuid else v_o.price_list_id end;
  v_vendedor := case when p_cabecera ? 'salesperson_id' then nullif(p_cabecera->>'salesperson_id', '')::uuid else v_o.salesperson_id end;

  perform app.validar_cabecera_venta(v_o.company_id, v_customer, v_contact, v_vendedor, v_lista, v_moneda);

  -- ── 5 · Cabecera ────────────────────────────────────────────────────────
  v_antes := to_jsonb(v_o);

  update sales_orders o set
    customer_id    = v_customer,
    contact_id     = v_contact,
    order_date     = coalesce((p_cabecera->>'order_date')::date, o.order_date),
    title          = case when p_cabecera ? 'title' then p_cabecera->>'title' else o.title end,
    salesperson_id = v_vendedor,
    payment_terms  = case when p_cabecera ? 'payment_terms' then p_cabecera->>'payment_terms' else o.payment_terms end,
    currency_code  = v_moneda,
    price_list_id  = v_lista,
    notes          = case when p_cabecera ? 'notes' then p_cabecera->>'notes' else o.notes end,
    exchange_rate  = case when p_cabecera ? 'exchange_rate' then (p_cabecera->>'exchange_rate')::numeric else o.exchange_rate end,
    discount_pct   = case when p_cabecera ? 'discount_pct' then (p_cabecera->>'discount_pct')::numeric else o.discount_pct end,
    perception_pct = case when p_cabecera ? 'perception_pct' then (p_cabecera->>'perception_pct')::numeric else o.perception_pct end,
    updated_by     = auth.uid()
  where o.id = p_order
  returning * into v_o;

  v_despues := to_jsonb(v_o);

  foreach v_campo in array k_permitidos loop
    if (v_antes -> v_campo) is distinct from (v_despues -> v_campo) then
      v_cambios := v_cambios || jsonb_build_object(
        v_campo, jsonb_build_object('from', v_antes -> v_campo, 'to', v_despues -> v_campo));
    end if;
  end loop;

  -- ── 6 · Líneas ──────────────────────────────────────────────────────────
  -- `sales_order_lines` tiene único (order_id, line_no) —las de la cotización
  -- no—, así que primero se corren los números viejos fuera del rango y
  -- después se reasignan 1..n en el orden recibido. Sin esto, mover una línea
  -- o insertar en el medio choca con una fila que todavía no se borró.
  update sales_order_lines set line_no = line_no + 1000 where order_id = p_order;

  for v_l in select * from jsonb_array_elements(p_lineas) loop
    v_id := nullif(v_l->>'id', '')::uuid;
    v_n := v_n + 1;
    perform app.validar_linea_venta(v_o.company_id, v_l);

    if v_id is null then
      insert into sales_order_lines (
        company_id, order_id, line_no, line_type, product_id,
        sku_snapshot, name_snapshot, description_snapshot,
        quantity_ordered, unit_price, discount_pct, tax_treatment, tax_rate_snapshot
      ) values (
        v_o.company_id, p_order, v_n,
        coalesce(v_l->>'line_type', 'item'),
        nullif(v_l->>'product_id', '')::uuid,
        nullif(v_l->>'sku_snapshot', ''), nullif(v_l->>'name_snapshot', ''),
        nullif(v_l->>'description_snapshot', ''),
        (v_l->>'quantity')::numeric, coalesce((v_l->>'unit_price')::numeric, 0),
        coalesce((v_l->>'discount_pct')::numeric, 0),
        coalesce(v_l->>'tax_treatment', 'vat_21'),
        coalesce((v_l->>'tax_rate_snapshot')::numeric, 0)
      ) returning id into v_id;

      v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
        'accion', 'agregada', 'linea', v_n,
        'producto', coalesce(nullif(v_l->>'sku_snapshot', ''), nullif(v_l->>'name_snapshot', ''), 's/d'),
        'cantidad', (v_l->>'quantity')::numeric,
        'precio', coalesce((v_l->>'unit_price')::numeric, 0)));
    else
      select * into v_vieja from sales_order_lines where id = v_id and order_id = p_order;
      if not found then
        raise exception 'LINEA_AJENA' using errcode = '42501';
      end if;

      update sales_order_lines l set
        line_no              = v_n,
        line_type            = coalesce(v_l->>'line_type', l.line_type),
        product_id           = nullif(v_l->>'product_id', '')::uuid,
        sku_snapshot         = nullif(v_l->>'sku_snapshot', ''),
        name_snapshot        = nullif(v_l->>'name_snapshot', ''),
        description_snapshot = nullif(v_l->>'description_snapshot', ''),
        quantity_ordered     = (v_l->>'quantity')::numeric,
        unit_price           = coalesce((v_l->>'unit_price')::numeric, 0),
        discount_pct         = coalesce((v_l->>'discount_pct')::numeric, 0),
        tax_treatment        = coalesce(v_l->>'tax_treatment', l.tax_treatment),
        tax_rate_snapshot    = coalesce((v_l->>'tax_rate_snapshot')::numeric, l.tax_rate_snapshot)
      where l.id = v_id;

      v_cambio_l := '{}'::jsonb;
      if v_vieja.quantity_ordered is distinct from (v_l->>'quantity')::numeric then
        v_cambio_l := v_cambio_l || jsonb_build_object('quantity',
          jsonb_build_object('from', v_vieja.quantity_ordered, 'to', (v_l->>'quantity')::numeric));
      end if;
      if v_vieja.unit_price is distinct from coalesce((v_l->>'unit_price')::numeric, 0) then
        v_cambio_l := v_cambio_l || jsonb_build_object('unit_price',
          jsonb_build_object('from', v_vieja.unit_price, 'to', coalesce((v_l->>'unit_price')::numeric, 0)));
      end if;
      if v_vieja.discount_pct is distinct from coalesce((v_l->>'discount_pct')::numeric, 0) then
        v_cambio_l := v_cambio_l || jsonb_build_object('discount_pct',
          jsonb_build_object('from', v_vieja.discount_pct, 'to', coalesce((v_l->>'discount_pct')::numeric, 0)));
      end if;
      if v_vieja.description_snapshot is distinct from nullif(v_l->>'description_snapshot', '') then
        v_cambio_l := v_cambio_l || jsonb_build_object('description_snapshot',
          jsonb_build_object('from', v_vieja.description_snapshot, 'to', nullif(v_l->>'description_snapshot', '')));
      end if;
      if v_vieja.tax_treatment is distinct from coalesce(v_l->>'tax_treatment', v_vieja.tax_treatment) then
        v_cambio_l := v_cambio_l || jsonb_build_object('tax_treatment',
          jsonb_build_object('from', v_vieja.tax_treatment, 'to', v_l->>'tax_treatment'));
      end if;

      if v_cambio_l <> '{}'::jsonb then
        v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
          'accion', 'modificada', 'linea', v_n,
          'producto', coalesce(v_vieja.sku_snapshot, v_vieja.name_snapshot, 's/d'),
          'cambios', v_cambio_l));
      end if;
    end if;

    v_ids := v_ids || v_id;
  end loop;

  for v_vieja in select * from sales_order_lines where order_id = p_order and not (id = any (v_ids)) loop
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
      'accion', 'eliminada', 'linea', v_vieja.line_no - 1000,
      'producto', coalesce(v_vieja.sku_snapshot, v_vieja.name_snapshot, 's/d'),
      'cantidad', v_vieja.quantity_ordered, 'precio', v_vieja.unit_price));
  end loop;
  delete from sales_order_lines where order_id = p_order and not (id = any (v_ids));

  -- ── 7 · Auditoría ───────────────────────────────────────────────────────
  if v_cambios <> '{}'::jsonb or v_lineas <> '[]'::jsonb then
    perform registrar_evento_venta(
      'sales_order', p_order, 'updated_sensitive_fields', null, null,
      case when v_lineas = '[]'::jsonb then v_cambios
           else v_cambios || jsonb_build_object('lineas', v_lineas) end);
  end if;

  select updated_at into v_updated from sales_orders where id = p_order;

  return jsonb_build_object(
    'ok', true,
    'updated_at', v_updated,
    'cambios_cabecera', (select count(*) from jsonb_object_keys(v_cambios)),
    'lineas_tocadas', jsonb_array_length(v_lineas)
  );
end;
$$;

revoke execute on function public.guardar_pedido(uuid, timestamptz, jsonb, jsonb) from public, anon;
grant  execute on function public.guardar_pedido(uuid, timestamptz, jsonb, jsonb) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 4 · Crear un pedido manual
-- ---------------------------------------------------------------------------

create or replace function public.crear_pedido(
  p_company   uuid,
  p_cabecera  jsonb,
  p_lineas    jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  k_permitidos constant text[] := array[
    'customer_id', 'contact_id', 'order_date', 'title', 'salesperson_id',
    'payment_terms', 'currency_code', 'price_list_id', 'notes',
    'exchange_rate', 'discount_pct', 'perception_pct'
  ];

  v_rol      text;
  v_campo    text;
  v_customer uuid;
  v_contact  uuid;
  v_moneda   text;
  v_lista    uuid;
  v_vendedor uuid;
  v_fecha    date;
  v_serie    text;
  v_numero   text;
  v_o        sales_orders%rowtype;
  v_l        jsonb;
  v_n        int := 0;
  v_lineas   jsonb := '[]'::jsonb;
begin
  if p_company is null then
    raise exception 'EMPRESA_REQUERIDA' using errcode = '22023';
  end if;
  select cm.role into v_rol
    from company_memberships cm
   where cm.user_id = auth.uid() and cm.company_id = p_company and cm.status = 'active'
   limit 1;
  if v_rol is null or v_rol not in ('admin', 'employee') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  if p_cabecera is null or jsonb_typeof(p_cabecera) <> 'object' then
    raise exception 'CABECERA_INVALIDA' using errcode = '22023';
  end if;
  for v_campo in select jsonb_object_keys(p_cabecera) loop
    if not (v_campo = any (k_permitidos)) then
      raise exception 'CAMPO_NO_PERMITIDO' using errcode = '42501', detail = v_campo;
    end if;
  end loop;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' then
    raise exception 'LINEAS_INVALIDAS' using errcode = '22023';
  end if;

  v_customer := nullif(p_cabecera->>'customer_id', '')::uuid;
  v_contact  := nullif(p_cabecera->>'contact_id', '')::uuid;
  v_moneda   := nullif(p_cabecera->>'currency_code', '');
  v_lista    := nullif(p_cabecera->>'price_list_id', '')::uuid;
  v_vendedor := nullif(p_cabecera->>'salesperson_id', '')::uuid;
  v_fecha    := coalesce(nullif(p_cabecera->>'order_date', '')::date,
                         (now() at time zone 'America/Argentina/Buenos_Aires')::date);

  perform app.validar_cabecera_venta(p_company, v_customer, v_contact, v_vendedor, v_lista, v_moneda);

  select ds.series_code into v_serie
    from document_sequences ds
   where ds.company_id = p_company and ds.doc_type = 'sales_order' and ds.is_default;
  if v_serie is null then
    raise exception 'SIN_SERIE' using errcode = '42704';
  end if;
  -- Valida permiso de numeración y AUTORIDAD (STEL → external_numbering_authority).
  v_numero := next_document_number(p_company, 'sales_order', '');

  insert into sales_orders (
    company_id, number, series_code, commercial_status, origin,
    customer_id, contact_id, salesperson_id, price_list_id,
    order_date, title, currency_code, exchange_rate,
    payment_terms, notes, discount_pct, perception_pct, created_by, updated_by
  ) values (
    p_company, v_numero, v_serie, 'draft', 'manual',
    v_customer, v_contact, v_vendedor, v_lista,
    v_fecha, nullif(btrim(coalesce(p_cabecera->>'title', '')), ''), v_moneda,
    nullif(p_cabecera->>'exchange_rate', '')::numeric,
    nullif(btrim(coalesce(p_cabecera->>'payment_terms', '')), ''),
    nullif(btrim(coalesce(p_cabecera->>'notes', '')), ''),
    coalesce(nullif(p_cabecera->>'discount_pct', '')::numeric, 0),
    coalesce(nullif(p_cabecera->>'perception_pct', '')::numeric, 0),
    auth.uid(), auth.uid()
  ) returning * into v_o;

  for v_l in select * from jsonb_array_elements(p_lineas) loop
    v_n := v_n + 1;
    perform app.validar_linea_venta(p_company, v_l);

    insert into sales_order_lines (
      company_id, order_id, line_no, line_type, product_id,
      sku_snapshot, name_snapshot, description_snapshot,
      quantity_ordered, unit_price, list_price_snapshot, discount_pct,
      tax_treatment, tax_rate_snapshot
    ) values (
      p_company, v_o.id, v_n,
      coalesce(v_l->>'line_type', 'item'),
      nullif(v_l->>'product_id', '')::uuid,
      nullif(v_l->>'sku_snapshot', ''), nullif(v_l->>'name_snapshot', ''),
      nullif(v_l->>'description_snapshot', ''),
      (v_l->>'quantity')::numeric,
      coalesce((v_l->>'unit_price')::numeric, 0),
      nullif(v_l->>'list_price_snapshot', '')::numeric,
      coalesce((v_l->>'discount_pct')::numeric, 0),
      coalesce(v_l->>'tax_treatment', 'vat_21'),
      coalesce((v_l->>'tax_rate_snapshot')::numeric, 0)
    );

    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
      'accion', 'agregada', 'linea', v_n,
      'producto', coalesce(nullif(v_l->>'sku_snapshot', ''), nullif(v_l->>'name_snapshot', ''), 's/d'),
      'cantidad', (v_l->>'quantity')::numeric,
      'precio', coalesce((v_l->>'unit_price')::numeric, 0)));
  end loop;

  select * into v_o from sales_orders where id = v_o.id;

  perform registrar_evento_venta(
    'sales_order', v_o.id, 'created', null, v_o.commercial_status,
    jsonb_build_object(
      'numero', v_o.number, 'origen', v_o.origin,
      'customer_id', v_o.customer_id, 'contact_id', v_o.contact_id,
      'salesperson_id', v_o.salesperson_id, 'price_list_id', v_o.price_list_id,
      'order_date', v_o.order_date, 'title', v_o.title,
      'currency_code', v_o.currency_code, 'exchange_rate', v_o.exchange_rate,
      'payment_terms', v_o.payment_terms, 'discount_pct', v_o.discount_pct,
      'perception_pct', v_o.perception_pct,
      'lineas', v_lineas, 'total', v_o.total));

  return jsonb_build_object(
    'id', v_o.id, 'number', v_o.number, 'total', v_o.total,
    'updated_at', v_o.updated_at, 'lineas', v_n);
end;
$$;

revoke execute on function public.crear_pedido(uuid, jsonb, jsonb) from public, anon;
grant  execute on function public.crear_pedido(uuid, jsonb, jsonb) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 5 · Cotización → pedido, en una transacción
-- ---------------------------------------------------------------------------
-- El pedido hereda el snapshot comercial de la cotización TAL CUAL: precios,
-- descuentos, impuestos, descripciones y la tarifa como dato. No se consulta
-- ninguna lista de precios.
--
-- Idempotencia: la cotización se bloquea (`for update`) y existe el índice
-- único `uq_sales_orders_quote (company_id, quote_id)`. Dos clics simultáneos
-- dejan UN pedido; el segundo recibe `PEDIDO_YA_EXISTE`.
--
-- El estado de la cotización NO se toca: hoy tampoco lo tocaba la conversión
-- del navegador, y cambiarlo sería una regla de negocio nueva.

create or replace function public.convertir_cotizacion_en_pedido(
  p_quote    uuid,
  p_esperado timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_q       sales_quotes%rowtype;
  v_rol     text;
  v_serie   text;
  v_numero  text;
  v_o       sales_orders%rowtype;
  v_n       int := 0;
  v_lineas  jsonb := '[]'::jsonb;
  v_l       record;
begin
  select * into v_q from sales_quotes where id = p_quote for update;
  if not found then
    raise exception 'COTIZACION_INEXISTENTE' using errcode = '42704';
  end if;

  select cm.role into v_rol
    from company_memberships cm
   where cm.user_id = auth.uid() and cm.company_id = v_q.company_id and cm.status = 'active'
   limit 1;
  if v_rol is null or v_rol not in ('admin', 'employee') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  -- Opcional: si quien convierte vio una versión de la cotización, se exige
  -- que siga siendo esa. Sin testigo, se convierte lo que haya.
  if p_esperado is not null and v_q.updated_at is distinct from p_esperado then
    raise exception 'CONFLICTO_DE_EDICION';
  end if;

  if v_q.status = 'rejected' then
    raise exception 'COTIZACION_RECHAZADA' using errcode = '42501';
  end if;

  if exists (select 1 from sales_orders o where o.company_id = v_q.company_id and o.quote_id = p_quote) then
    raise exception 'PEDIDO_YA_EXISTE' using errcode = '23505';
  end if;

  select ds.series_code into v_serie
    from document_sequences ds
   where ds.company_id = v_q.company_id and ds.doc_type = 'sales_order' and ds.is_default;
  if v_serie is null then
    raise exception 'SIN_SERIE' using errcode = '42704';
  end if;
  v_numero := next_document_number(v_q.company_id, 'sales_order', '');

  insert into sales_orders (
    company_id, number, series_code, commercial_status, origin, quote_id,
    customer_id, contact_id, salesperson_id, price_list_id,
    order_date, title, currency_code, exchange_rate,
    payment_terms, notes, discount_pct, perception_pct, created_by, updated_by
  ) values (
    v_q.company_id, v_numero, v_serie, 'draft', 'quote', p_quote,
    v_q.customer_id, v_q.contact_id, v_q.salesperson_id, v_q.price_list_id,
    (now() at time zone 'America/Argentina/Buenos_Aires')::date,
    v_q.title, v_q.currency_code, v_q.exchange_rate,
    v_q.payment_terms, v_q.notes, v_q.discount_pct, v_q.perception_pct,
    auth.uid(), auth.uid()
  ) returning * into v_o;

  -- Las líneas, con sus precios APROBADOS. `quote_line_id` deja el rastro de
  -- qué línea de la cotización originó cada una.
  for v_l in select * from sales_quote_lines where quote_id = p_quote order by line_no, id loop
    v_n := v_n + 1;
    insert into sales_order_lines (
      company_id, order_id, line_no, line_type, product_id, quote_line_id,
      sku_snapshot, name_snapshot, description_snapshot,
      quantity_ordered, unit_price, list_price_snapshot, discount_pct,
      tax_treatment, tax_rate_snapshot, kit_components_snapshot, notes
    ) values (
      v_q.company_id, v_o.id, v_n, v_l.line_type, v_l.product_id, v_l.id,
      v_l.sku_snapshot, v_l.name_snapshot, v_l.description_snapshot,
      v_l.quantity, v_l.unit_price, v_l.list_price_snapshot, v_l.discount_pct,
      v_l.tax_treatment, v_l.tax_rate_snapshot, v_l.kit_components_snapshot, v_l.notes
    );
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
      'accion', 'copiada', 'linea', v_n,
      'producto', coalesce(v_l.sku_snapshot, v_l.name_snapshot, 's/d'),
      'cantidad', v_l.quantity, 'precio', v_l.unit_price));
  end loop;

  select * into v_o from sales_orders where id = v_o.id;

  perform registrar_evento_venta(
    'sales_order', v_o.id, 'created', null, v_o.commercial_status,
    jsonb_build_object(
      'numero', v_o.number, 'origen', 'quote',
      'cotizacion', v_q.number,
      'customer_id', v_o.customer_id, 'contact_id', v_o.contact_id,
      'salesperson_id', v_o.salesperson_id, 'price_list_id', v_o.price_list_id,
      'currency_code', v_o.currency_code, 'payment_terms', v_o.payment_terms,
      'discount_pct', v_o.discount_pct, 'perception_pct', v_o.perception_pct,
      'lineas', v_lineas, 'total', v_o.total));

  return jsonb_build_object(
    'id', v_o.id, 'number', v_o.number, 'total', v_o.total,
    'lineas', v_n, 'cotizacion', v_q.number);
end;
$$;

revoke execute on function public.convertir_cotizacion_en_pedido(uuid, timestamptz) from public, anon;
grant  execute on function public.convertir_cotizacion_en_pedido(uuid, timestamptz) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- drop function if exists public.convertir_cotizacion_en_pedido(uuid, timestamptz);
-- drop function if exists public.crear_pedido(uuid, jsonb, jsonb);
-- drop function if exists public.guardar_pedido(uuid, timestamptz, jsonb, jsonb);
-- drop function if exists app.validar_linea_venta(uuid, jsonb);
-- drop function if exists app.validar_cabecera_venta(uuid, uuid, uuid, uuid, uuid, text);
-- drop index if exists idx_orders_tarifa;
-- alter table sales_orders drop column if exists price_list_id;
--
-- La columna es nullable y sin backfill: soltarla no pierde ningún dato
-- histórico. El frontend de E4 llama a las tres funciones: revertir la base
-- exige volver a desplegar el frontend anterior.
