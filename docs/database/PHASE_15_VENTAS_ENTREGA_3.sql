-- ---------------------------------------------------------------------------
-- FASE 15 · VENTAS — Entrega 3: alta de cotización en UNA transacción
-- ---------------------------------------------------------------------------
--
-- Hasta E2 el alta la armaba el navegador en tres pasos: pedir número, insertar
-- la cabecera, insertar las líneas y registrar la auditoría. Cuatro viajes: si
-- el segundo fallaba quedaba un número consumido; si fallaba el tercero, una
-- cotización sin líneas; y el contacto, el vendedor y la tarifa no los validaba
-- nadie (el alta ni siquiera los ofrecía).
--
-- `crear_cotizacion` hace todo eso del lado del servidor y en una sola
-- transacción: o queda la cotización completa con su número, sus líneas, sus
-- totales y su evento de auditoría, o no queda nada. Si algo falla, el número
-- tampoco se consume: el UPDATE de `document_sequences` vuelve atrás con el
-- resto.
--
-- Las reglas de negocio son EXACTAMENTE las de `guardar_cotizacion` (E2), con
-- los mismos códigos de error: CLIENTE_INVALIDO, CONTACTO_DE_OTRO_CLIENTE,
-- VENDEDOR_INVALIDO, TARIFA_INVALIDA, TARIFA_OTRA_MONEDA, CANTIDAD_INVALIDA,
-- DESCUENTO_INVALIDO, PRECIO_INVALIDO, PRODUCTO_INVALIDO, CAMPO_NO_PERMITIDO.
-- La suite de E3 corre los mismos casos contra las DOS funciones para que no se
-- separen con el tiempo.
--
-- Lo que NO hace: elegir la moneda (no hay default), saltear la autoridad de
-- numeración (la exige `next_document_number` y el trigger del INSERT), tocar
-- totales (los calcula el trigger de siempre) ni aceptar campos de sistema.

create or replace function public.crear_cotizacion(
  p_company   uuid,
  p_cabecera  jsonb,
  p_lineas    jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  -- Los ÚNICOS campos de cabecera que se aceptan: los mismos que E2. Todo lo
  -- demás —company_id, number, series_code, status, created_by, external_id,
  -- imported_at, subtotal, tax_amount, total— lo pone el servidor.
  k_permitidos constant text[] := array[
    'customer_id', 'contact_id', 'quote_date', 'title', 'salesperson_id',
    'payment_terms', 'currency_code', 'price_list_id', 'notes',
    'valid_until', 'exchange_rate', 'discount_pct', 'perception_pct'
  ];

  v_rol           text;
  v_campo         text;
  v_customer      uuid;
  v_contact       uuid;
  v_moneda        text;
  v_lista         uuid;
  v_vendedor      uuid;
  v_lista_moneda  text;
  v_fecha         date;
  v_serie         text;
  v_numero        text;
  v_q             sales_quotes%rowtype;
  v_l             jsonb;
  v_n             int := 0;
  v_lineas        jsonb := '[]'::jsonb;
begin
  -- ── 1 · Quién crea ──────────────────────────────────────────────────────
  if p_company is null then
    raise exception 'EMPRESA_REQUERIDA' using errcode = '22023';
  end if;
  select cm.role into v_rol
    from company_memberships cm
   where cm.user_id = auth.uid()
     and cm.company_id = p_company
     and cm.status = 'active'
   limit 1;
  -- El mismo conjunto que `quotes_write`, `next_document_number` y
  -- `escribeVentas` en el frontend.
  if v_rol is null or v_rol not in ('admin', 'employee') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  -- ── 2 · Payload cerrado ─────────────────────────────────────────────────
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
  -- Fase 14 E3: la moneda se elige, no se hereda de un default invisible.
  if v_moneda is null then
    raise exception 'DOCUMENT_CURRENCY_REQUIRED' using errcode = '22023';
  end if;
  if v_customer is null then
    raise exception 'CLIENTE_REQUERIDO' using errcode = '22023';
  end if;
  -- La fecha del documento es un DÍA, y el día es el de Argentina: a las 22 h
  -- de Buenos Aires `current_date` en UTC ya es mañana.
  v_fecha := coalesce(nullif(p_cabecera->>'quote_date', '')::date,
                      (now() at time zone 'America/Argentina/Buenos_Aires')::date);

  -- ── 3 · Validaciones de negocio (las mismas que E2) ─────────────────────
  if not exists (select 1 from customers c
                  where c.id = v_customer and c.company_id = p_company and c.deleted_at is null) then
    raise exception 'CLIENTE_INVALIDO' using errcode = '42501';
  end if;

  if v_contact is not null
     and not exists (select 1 from customer_contacts cc
                      where cc.id = v_contact
                        and cc.customer_id = v_customer
                        and cc.company_id = p_company) then
    raise exception 'CONTACTO_DE_OTRO_CLIENTE' using errcode = '42501';
  end if;

  if v_vendedor is not null
     and not exists (select 1 from company_memberships cm
                      where cm.user_id = v_vendedor
                        and cm.company_id = p_company
                        and cm.status = 'active') then
    raise exception 'VENDEDOR_INVALIDO' using errcode = '42501';
  end if;

  if v_lista is not null then
    select pl.currency_code into v_lista_moneda
      from price_lists pl where pl.id = v_lista and pl.company_id = p_company;
    if v_lista_moneda is null then
      raise exception 'TARIFA_INVALIDA' using errcode = '42501';
    end if;
    if v_lista_moneda is distinct from v_moneda then
      raise exception 'TARIFA_OTRA_MONEDA' using errcode = '42501',
        detail = format('la lista esta en %s y el documento en %s', v_lista_moneda, v_moneda);
    end if;
  end if;

  -- ── 4 · Número ──────────────────────────────────────────────────────────
  -- La serie por defecto de la empresa; no se acepta una serie del cliente.
  select ds.series_code into v_serie
    from document_sequences ds
   where ds.company_id = p_company and ds.doc_type = 'quote' and ds.is_default;
  if v_serie is null then
    raise exception 'SIN_SERIE' using errcode = '42704';
  end if;
  -- `next_document_number` valida permiso de numeración y, sobre todo, la
  -- AUTORIDAD: si la serie la numera STEL, levanta `external_numbering_authority`
  -- y no se consume nada. El trigger del INSERT lo vuelve a exigir.
  v_numero := next_document_number(p_company, 'quote', '');

  -- ── 5 · Cabecera ────────────────────────────────────────────────────────
  insert into sales_quotes (
    company_id, number, series_code, status,
    customer_id, contact_id, salesperson_id, price_list_id,
    quote_date, valid_until, title, currency_code, exchange_rate,
    payment_terms, notes, discount_pct, perception_pct, created_by, updated_by
  ) values (
    p_company, v_numero, v_serie, 'draft',
    v_customer, v_contact, v_vendedor, v_lista,
    v_fecha, nullif(p_cabecera->>'valid_until', '')::date,
    nullif(btrim(coalesce(p_cabecera->>'title', '')), ''), v_moneda,
    nullif(p_cabecera->>'exchange_rate', '')::numeric,
    nullif(btrim(coalesce(p_cabecera->>'payment_terms', '')), ''),
    nullif(btrim(coalesce(p_cabecera->>'notes', '')), ''),
    coalesce(nullif(p_cabecera->>'discount_pct', '')::numeric, 0),
    coalesce(nullif(p_cabecera->>'perception_pct', '')::numeric, 0),
    auth.uid(), auth.uid()
  ) returning * into v_q;

  -- ── 6 · Líneas ──────────────────────────────────────────────────────────
  -- El orden lo pone el servidor: 1..n en el orden recibido. Un `line_no`
  -- mandado por el cliente podría repetirse o dejar huecos.
  for v_l in select * from jsonb_array_elements(p_lineas) loop
    v_n := v_n + 1;

    if coalesce((v_l->>'quantity')::numeric, 0) = 0 then
      raise exception 'CANTIDAD_INVALIDA' using errcode = '22023';
    end if;
    if coalesce((v_l->>'discount_pct')::numeric, 0) < 0
       or coalesce((v_l->>'discount_pct')::numeric, 0) > 100 then
      raise exception 'DESCUENTO_INVALIDO' using errcode = '22023';
    end if;
    if coalesce((v_l->>'unit_price')::numeric, 0) < 0 then
      raise exception 'PRECIO_INVALIDO' using errcode = '22023';
    end if;
    if nullif(v_l->>'product_id', '') is not null
       and not exists (select 1 from products p
                        where p.id = (v_l->>'product_id')::uuid and p.company_id = p_company) then
      raise exception 'PRODUCTO_INVALIDO' using errcode = '42501';
    end if;

    insert into sales_quote_lines (
      company_id, quote_id, line_no, line_type, product_id,
      sku_snapshot, name_snapshot, description_snapshot, brand_snapshot,
      quantity, unit_price, list_price_snapshot, discount_pct,
      tax_treatment, tax_rate_snapshot
    ) values (
      p_company, v_q.id, v_n,
      coalesce(v_l->>'line_type', 'item'),
      nullif(v_l->>'product_id', '')::uuid,
      nullif(v_l->>'sku_snapshot', ''), nullif(v_l->>'name_snapshot', ''),
      nullif(v_l->>'description_snapshot', ''), nullif(v_l->>'brand_snapshot', ''),
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

  -- Los totales los dejó el trigger de las líneas: se releen, no se calculan.
  select * into v_q from sales_quotes where id = v_q.id;

  -- ── 7 · Auditoría ───────────────────────────────────────────────────────
  perform registrar_evento_venta(
    'sales_quote', v_q.id, 'created', null, v_q.status,
    jsonb_build_object(
      'numero', v_q.number,
      'customer_id', v_q.customer_id,
      'contact_id', v_q.contact_id,
      'salesperson_id', v_q.salesperson_id,
      'price_list_id', v_q.price_list_id,
      'quote_date', v_q.quote_date,
      'valid_until', v_q.valid_until,
      'title', v_q.title,
      'currency_code', v_q.currency_code,
      'exchange_rate', v_q.exchange_rate,
      'payment_terms', v_q.payment_terms,
      'discount_pct', v_q.discount_pct,
      'perception_pct', v_q.perception_pct,
      'lineas', v_lineas,
      'total', v_q.total));

  return jsonb_build_object(
    'id', v_q.id,
    'number', v_q.number,
    'total', v_q.total,
    'updated_at', v_q.updated_at,
    'lineas', v_n
  );
end;
$$;

-- Los default privileges del proyecto le dan EXECUTE a anon y authenticated
-- sobre toda función nueva de `public`, y son grants explícitos por rol: un
-- `revoke from public` NO los saca. Hay que nombrarlos.
revoke execute on function public.crear_cotizacion(uuid, jsonb, jsonb) from public, anon;
grant  execute on function public.crear_cotizacion(uuid, jsonb, jsonb) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- drop function if exists public.crear_cotizacion(uuid, jsonb, jsonb);
--
-- No hay cambios de schema: ni columnas, ni tablas, ni policies, ni triggers.
-- Soltar la función deja el alta como estaba en E2 (el frontend anterior
-- insertaba desde el cliente), así que revertir la base exige volver a
-- desplegar el frontend anterior.
