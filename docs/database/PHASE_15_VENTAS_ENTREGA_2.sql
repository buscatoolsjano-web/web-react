-- ---------------------------------------------------------------------------
-- FASE 15 · VENTAS — Entrega 2: guardado atómico de la cotización
-- ---------------------------------------------------------------------------
--
-- Dos cosas:
--
--   1. `sales_quotes.price_list_id` — la tarifa con la que se cotizó. Es el
--      único gap de schema que E0 marcó con prioridad alta.
--   2. `public.guardar_cotizacion` — cabecera, líneas y auditoría en UNA
--      transacción, con control de concurrencia y el diff real de lo que
--      cambió.
--
-- Lo que NO hace: tocar autoridad de numeración, secuencias, STEL, stock,
-- precios de catálogo, pedidos ni remitos. Ninguna policy se modifica y
-- ninguna regla de editabilidad se amplía.


-- ---------------------------------------------------------------------------
-- 1 · La tarifa del documento
-- ---------------------------------------------------------------------------
-- Hasta ahora la lista de precios vivía sólo en el cliente
-- (`customers.default_price_list_id`), que es un dato ACTUAL: no dice con qué
-- lista se cotizó en su momento. Por eso E0 y E1 se negaron a mostrar una
-- tarifa en el documento — habría sido atribuirle una que quizá no se usó.
--
-- Nullable y sin backfill. En los 306 documentos históricos queda NULL, que se
-- lee «sin tarifa registrada». Rellenarlos por intuición sería inventar.
--
-- NO se agrega a `sales_orders` ni a `deliveries`: hoy no los editaría nadie y
-- serían dos columnas siempre vacías, que es justo la deuda que E0 documentó.
-- El precio de cada línea ya viaja como snapshot al convertir, así que lo que
-- se pierde es la metadata de qué lista se usó, no plata. Queda anotado para
-- la entrega que haga Pedido.

alter table sales_quotes
  add column if not exists price_list_id uuid references price_lists(id);

comment on column sales_quotes.price_list_id is
  'Lista de precios con la que se cotizo. NULL = sin tarifa registrada (historico). Solo SUGIERE precio: el unit_price de cada linea es el que vale.';


-- ---------------------------------------------------------------------------
-- 2 · Guardado atómico
-- ---------------------------------------------------------------------------
-- El problema que resuelve: hasta E1 cada campo se escribía solo al perder el
-- foco. Eso hacía imposible un «Descartar» honesto —lo escrito ya estaba— y
-- dejaba el documento a medio guardar si algo fallaba en el medio.
--
-- Ahora entra TODO junto: cabecera, líneas y el evento de auditoría. Si algo
-- falla, no queda nada.
--
-- Concurrencia optimista sobre `updated_at`: el navegador manda el valor que
-- leyó al entrar en edición, y si alguien guardó en el medio la función corta
-- con CONFLICTO_DE_EDICION en vez de pisarlo. No hay merge automático.
--
-- `p_lineas` es el ESTADO DESEADO completo, no un diff: el servidor compara
-- contra lo que hay y decide qué agregar, qué actualizar y qué borrar. Así el
-- cliente no puede pedir «borrá la línea X» de una cotización que no es suya.

create or replace function public.guardar_cotizacion(
  p_quote     uuid,
  p_esperado  timestamptz,
  p_cabecera  jsonb,
  p_lineas    jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  -- Los ÚNICOS campos de cabecera que se aceptan. Cualquier otro que venga en
  -- el payload es motivo de rechazo: sin esto, un cliente podría mandar
  -- company_id, number, status, imported_at o external_id.
  k_permitidos constant text[] := array[
    'customer_id', 'contact_id', 'quote_date', 'title', 'salesperson_id',
    'payment_terms', 'currency_code', 'price_list_id', 'notes',
    'valid_until', 'exchange_rate', 'discount_pct', 'perception_pct'
  ];

  v_q        sales_quotes%rowtype;
  v_rol      text;
  v_campo    text;
  v_cambios  jsonb := '{}'::jsonb;
  v_lineas   jsonb := '[]'::jsonb;
  v_antes    jsonb;
  v_despues  jsonb;

  v_customer      uuid;
  v_contact       uuid;
  v_moneda        text;
  v_lista         uuid;
  v_vendedor      uuid;
  v_lista_moneda  text;

  v_l         jsonb;
  v_id        uuid;
  v_vieja     sales_quote_lines%rowtype;
  v_ids       uuid[] := '{}';
  v_cambio_l  jsonb;
  v_borradas  int := 0;
  v_updated   timestamptz;
begin
  -- ── 1 · El documento y quién lo toca ────────────────────────────────────
  -- `for update`: la lectura del snapshot BLOQUEA la fila, y eso es lo que
  -- hace real el control de concurrencia. Sin el lock, dos guardados
  -- simultáneos leen el mismo `updated_at`, los dos pasan el control y los dos
  -- escriben: el último gana y quedan dos eventos de auditoría. Un doble clic
  -- alcanzaba para reproducirlo, y así lo encontró la suite.
  -- Serializa sólo los guardados de ESTA cotización.
  select * into v_q from sales_quotes where id = p_quote for update;
  if not found then
    raise exception 'COTIZACION_INEXISTENTE' using errcode = '42704';
  end if;

  select cm.role into v_rol
    from company_memberships cm
   where cm.user_id = auth.uid()
     and cm.company_id = v_q.company_id
     and cm.status = 'active'
   limit 1;
  -- El mismo conjunto que `quotes_write` y que `escribeVentas` en el frontend.
  if v_rol is null or v_rol not in ('admin', 'employee') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  -- ── 2 · Estado ──────────────────────────────────────────────────────────
  -- La misma matriz que `editabilidad()`: borrador y enviada. No se amplía.
  if v_q.status not in ('draft', 'sent') then
    raise exception 'ESTADO_NO_EDITABLE' using errcode = '42501';
  end if;

  -- ── 3 · Concurrencia ────────────────────────────────────────────────────
  -- SIN errcode, o sea P0001. NO puede ser 40001 (serialization_failure):
  -- ese código le dice a la capa de arriba que el fallo es transitorio y que
  -- conviene REINTENTAR, y PostgREST le hace caso. Medido: 125 segundos
  -- colgado antes de devolver «upstream request timeout», en vez de un error
  -- inmediato. Un conflicto de edición es permanente: el snapshot quedó viejo
  -- y ningún reintento lo arregla.
  if p_esperado is null or v_q.updated_at is distinct from p_esperado then
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

  -- Lo que no viene en el payload no se toca: se conserva lo que ya estaba.
  v_customer := coalesce((p_cabecera->>'customer_id')::uuid, v_q.customer_id);
  v_contact  := case when p_cabecera ? 'contact_id'
                     then (p_cabecera->>'contact_id')::uuid else v_q.contact_id end;
  v_moneda   := coalesce(p_cabecera->>'currency_code', v_q.currency_code);
  v_lista    := case when p_cabecera ? 'price_list_id'
                     then (p_cabecera->>'price_list_id')::uuid else v_q.price_list_id end;
  v_vendedor := case when p_cabecera ? 'salesperson_id'
                     then (p_cabecera->>'salesperson_id')::uuid else v_q.salesperson_id end;

  -- ── 5 · Validaciones de negocio ─────────────────────────────────────────
  -- Cliente de la empresa y vivo.
  if not exists (select 1 from customers c
                  where c.id = v_customer and c.company_id = v_q.company_id and c.deleted_at is null) then
    raise exception 'CLIENTE_INVALIDO' using errcode = '42501';
  end if;

  -- El contacto TIENE que ser del cliente elegido. No alcanza con que el
  -- desplegable haya mostrado los correctos: el cliente puede mandar otro.
  if v_contact is not null
     and not exists (select 1 from customer_contacts cc
                      where cc.id = v_contact
                        and cc.customer_id = v_customer
                        and cc.company_id = v_q.company_id) then
    raise exception 'CONTACTO_DE_OTRO_CLIENTE' using errcode = '42501';
  end if;

  -- El vendedor tiene que ser alguien de ESTA empresa, activo.
  if v_vendedor is not null
     and not exists (select 1 from company_memberships cm
                      where cm.user_id = v_vendedor
                        and cm.company_id = v_q.company_id
                        and cm.status = 'active') then
    raise exception 'VENDEDOR_INVALIDO' using errcode = '42501';
  end if;

  -- La tarifa: de la empresa y en la MISMA moneda que el documento. No hay
  -- conversión automática; cotizar en pesos con una lista en dólares sería
  -- inventar un tipo de cambio.
  if v_lista is not null then
    select pl.currency_code into v_lista_moneda
      from price_lists pl where pl.id = v_lista and pl.company_id = v_q.company_id;
    if v_lista_moneda is null then
      raise exception 'TARIFA_INVALIDA' using errcode = '42501';
    end if;
    if v_lista_moneda is distinct from v_moneda then
      raise exception 'TARIFA_OTRA_MONEDA' using errcode = '42501',
        detail = format('la lista esta en %s y el documento en %s', v_lista_moneda, v_moneda);
    end if;
  end if;

  -- ── 6 · Cabecera ────────────────────────────────────────────────────────
  v_antes := to_jsonb(v_q);

  update sales_quotes q set
    customer_id    = v_customer,
    contact_id     = v_contact,
    quote_date     = coalesce((p_cabecera->>'quote_date')::date, q.quote_date),
    title          = case when p_cabecera ? 'title' then p_cabecera->>'title' else q.title end,
    salesperson_id = v_vendedor,
    payment_terms  = case when p_cabecera ? 'payment_terms' then p_cabecera->>'payment_terms' else q.payment_terms end,
    currency_code  = v_moneda,
    price_list_id  = v_lista,
    notes          = case when p_cabecera ? 'notes' then p_cabecera->>'notes' else q.notes end,
    valid_until    = case when p_cabecera ? 'valid_until' then (p_cabecera->>'valid_until')::date else q.valid_until end,
    exchange_rate  = case when p_cabecera ? 'exchange_rate' then (p_cabecera->>'exchange_rate')::numeric else q.exchange_rate end,
    discount_pct   = case when p_cabecera ? 'discount_pct' then (p_cabecera->>'discount_pct')::numeric else q.discount_pct end,
    perception_pct = case when p_cabecera ? 'perception_pct' then (p_cabecera->>'perception_pct')::numeric else q.perception_pct end,
    updated_by     = auth.uid()
  where q.id = p_quote
  returning * into v_q;

  v_despues := to_jsonb(v_q);

  -- El diff de la cabecera: sólo lo que cambió de verdad. Los totales y las
  -- marcas de tiempo quedan afuera — los mueve el servidor, no la persona.
  foreach v_campo in array k_permitidos loop
    if (v_antes -> v_campo) is distinct from (v_despues -> v_campo) then
      v_cambios := v_cambios || jsonb_build_object(
        v_campo, jsonb_build_object('from', v_antes -> v_campo, 'to', v_despues -> v_campo));
    end if;
  end loop;

  -- ── 7 · Líneas ──────────────────────────────────────────────────────────
  for v_l in select * from jsonb_array_elements(p_lineas) loop
    v_id := nullif(v_l->>'id', '')::uuid;

    -- Validaciones que no delega al CHECK, para dar un código entendible.
    if (v_l->>'quantity')::numeric = 0 then
      raise exception 'CANTIDAD_INVALIDA' using errcode = '22023';
    end if;
    if coalesce((v_l->>'discount_pct')::numeric, 0) < 0
       or coalesce((v_l->>'discount_pct')::numeric, 0) > 100 then
      raise exception 'DESCUENTO_INVALIDO' using errcode = '22023';
    end if;
    if coalesce((v_l->>'unit_price')::numeric, 0) < 0 then
      raise exception 'PRECIO_INVALIDO' using errcode = '22023';
    end if;
    -- Un producto de otra empresa no entra, aunque el id sea válido.
    if v_l->>'product_id' is not null
       and not exists (select 1 from products p
                        where p.id = (v_l->>'product_id')::uuid and p.company_id = v_q.company_id) then
      raise exception 'PRODUCTO_INVALIDO' using errcode = '42501';
    end if;

    if v_id is null then
      insert into sales_quote_lines (
        company_id, quote_id, line_no, line_type, product_id,
        sku_snapshot, name_snapshot, description_snapshot,
        quantity, unit_price, discount_pct, tax_treatment, tax_rate_snapshot
      ) values (
        v_q.company_id, p_quote, (v_l->>'line_no')::int,
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
        'accion', 'agregada', 'linea', (v_l->>'line_no')::int,
        'producto', coalesce(nullif(v_l->>'sku_snapshot',''), nullif(v_l->>'name_snapshot',''), 's/d'),
        'cantidad', (v_l->>'quantity')::numeric,
        'precio', coalesce((v_l->>'unit_price')::numeric, 0)));
    else
      -- La línea tiene que ser de ESTA cotización. Si no, no existe para nosotros.
      select * into v_vieja from sales_quote_lines
       where id = v_id and quote_id = p_quote;
      if not found then
        raise exception 'LINEA_AJENA' using errcode = '42501';
      end if;

      update sales_quote_lines l set
        line_no              = (v_l->>'line_no')::int,
        line_type            = coalesce(v_l->>'line_type', l.line_type),
        product_id           = nullif(v_l->>'product_id', '')::uuid,
        sku_snapshot         = nullif(v_l->>'sku_snapshot', ''),
        name_snapshot        = nullif(v_l->>'name_snapshot', ''),
        description_snapshot = nullif(v_l->>'description_snapshot', ''),
        quantity             = (v_l->>'quantity')::numeric,
        unit_price           = coalesce((v_l->>'unit_price')::numeric, 0),
        discount_pct         = coalesce((v_l->>'discount_pct')::numeric, 0),
        tax_treatment        = coalesce(v_l->>'tax_treatment', l.tax_treatment),
        tax_rate_snapshot    = coalesce((v_l->>'tax_rate_snapshot')::numeric, l.tax_rate_snapshot)
      where l.id = v_id;

      -- Qué cambió de la línea, campo por campo y en castellano.
      v_cambio_l := '{}'::jsonb;
      if v_vieja.quantity is distinct from (v_l->>'quantity')::numeric then
        v_cambio_l := v_cambio_l || jsonb_build_object('quantity',
          jsonb_build_object('from', v_vieja.quantity, 'to', (v_l->>'quantity')::numeric));
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
          'accion', 'modificada', 'linea', (v_l->>'line_no')::int,
          'producto', coalesce(v_vieja.sku_snapshot, v_vieja.name_snapshot, 's/d'),
          'cambios', v_cambio_l));
      end if;
    end if;

    v_ids := v_ids || v_id;
  end loop;

  -- Lo que ya no está en el estado deseado, se borra. Se anota antes.
  for v_vieja in select * from sales_quote_lines
                  where quote_id = p_quote and not (id = any (v_ids)) loop
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
      'accion', 'eliminada', 'linea', v_vieja.line_no,
      'producto', coalesce(v_vieja.sku_snapshot, v_vieja.name_snapshot, 's/d'),
      'cantidad', v_vieja.quantity, 'precio', v_vieja.unit_price));
    v_borradas := v_borradas + 1;
  end loop;
  delete from sales_quote_lines where quote_id = p_quote and not (id = any (v_ids));

  -- ── 8 · Auditoría ───────────────────────────────────────────────────────
  -- Sólo si cambió algo. Un «Guardar» sin cambios no ensucia el historial.
  if v_cambios <> '{}'::jsonb or v_lineas <> '[]'::jsonb then
    perform registrar_evento_venta(
      'sales_quote', p_quote, 'updated_sensitive_fields', null, null,
      case when v_lineas = '[]'::jsonb then v_cambios
           else v_cambios || jsonb_build_object('lineas', v_lineas) end);
  end if;

  -- El `updated_at` final: el trigger de totales lo vuelve a mover cuando
  -- cambian las líneas, así que se relee al cierre y el cliente se queda con
  -- ese valor para su próxima edición.
  select updated_at into v_updated from sales_quotes where id = p_quote;

  return jsonb_build_object(
    'ok', true,
    'updated_at', v_updated,
    'cambios_cabecera', (select count(*) from jsonb_object_keys(v_cambios)),
    'lineas_tocadas', jsonb_array_length(v_lineas)
  );
end;
$$;

-- Los default privileges del proyecto le dan EXECUTE a anon y authenticated
-- sobre toda función nueva de `public`, y son grants explícitos por rol: un
-- `revoke from public` NO los saca. Hay que nombrarlos. (Fase 16 E1.)
revoke execute on function public.guardar_cotizacion(uuid, timestamptz, jsonb, jsonb) from public, anon;
grant  execute on function public.guardar_cotizacion(uuid, timestamptz, jsonb, jsonb) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- drop function if exists public.guardar_cotizacion(uuid, timestamptz, jsonb, jsonb);
-- alter table sales_quotes drop column if exists price_list_id;
--
-- Ninguna policy la llama, así que borrarla no deja la RLS rota. La columna es
-- nullable y sin backfill: soltarla no pierde ningún dato histórico.
