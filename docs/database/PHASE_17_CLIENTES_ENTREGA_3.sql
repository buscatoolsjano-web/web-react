-- ============================================================================
-- Fase 17 · Clientes · Entrega 3 — Contactos, direcciones y la dirección de
-- entrega del pedido
--
-- Proyecto: uaxcfufvapzulqvynanp. Aplicado el 2026-09-18 en cinco migraciones:
--
--   phase17_clientes_entrega_3_activo_y_permisos
--   phase17_clientes_entrega_3_guardar_contacto
--   phase17_clientes_entrega_3_guardar_direccion
--   phase17_clientes_entrega_3_direccion_en_pedido
--   phase17_clientes_entrega_3_guardar_pedido_direccion
--   phase17_clientes_entrega_3_domicilio_activo
--
-- Qué resuelve, en una línea: la agenda del cliente pasó de ser un dato de la
-- ficha a ser parte del documento. El contacto principal sugiere el contacto de
-- la cotización y del pedido; la dirección de entrega se elige en el pedido y
-- el remito la congela. Y como ahora hay documentos que las nombran, ni un
-- contacto ni una dirección se borran si figuran en uno: se desactivan.
--
-- NADA de esto toca datos existentes. Sin backfill: los 87 contactos
-- productivos quedan activos (el default de la columna) y sin ninguno marcado
-- como principal, que es como estaban. `customer_addresses` sigue vacía.
-- ============================================================================

begin;

-- ── 1 · `active`: desactivar en vez de borrar ───────────────────────────────
-- Un contacto que figura en una cotización de 2023 no se puede borrar sin
-- dejar el documento apuntando a una fila que no existe. Y tampoco se puede
-- seguir ofreciendo en los documentos nuevos. `active` es exactamente esa
-- distinción, y por eso el default es `true`: lo que ya estaba, sigue.
alter table customer_contacts  add column if not exists active boolean not null default true;
alter table customer_addresses add column if not exists active boolean not null default true;

-- Los índices únicos del principal se rehacen: un contacto desactivado no
-- puede ser el principal —sería ofrecer a alguien que ya no atiende—, así que
-- sale del índice.
drop index if exists uq_customer_contact_default;
create unique index uq_customer_contact_default
  on customer_contacts (customer_id)
  where is_default and active;

drop index if exists uq_customer_addr_default;
create unique index uq_customer_addr_default
  on customer_addresses (customer_id, kind)
  where is_default and active;

-- ── 2 · Quién administra la agenda de un cliente ────────────────────────────
-- Decisión de negocio de E1 (punto 3): el vendedor que puede editar un cliente
-- administra sus contactos y direcciones. Hasta ahora las policies usaban
-- `app.current_writer_company_ids()`, que es admin y employee: el vendedor
-- podía cambiarle la razón social al cliente pero no cargarle un teléfono.
create or replace function app.puede_administrar_cliente(p_customer uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from customers c
     where c.id = p_customer
       and (
         app."current_role"(c.company_id) in ('admin', 'employee')
         or (app."current_role"(c.company_id) = 'salesperson' and c.salesperson_id = auth.uid())
       )
  );
$$;

revoke execute on function app.puede_administrar_cliente(uuid) from public, anon;

drop policy if exists contacts_write on customer_contacts;
create policy contacts_write on customer_contacts
  for all to authenticated
  using (app.puede_administrar_cliente(customer_id))
  with check (app.puede_administrar_cliente(customer_id));

drop policy if exists addresses_write on customer_addresses;
create policy addresses_write on customer_addresses
  for all to authenticated
  using (app.puede_administrar_cliente(customer_id))
  with check (app.puede_administrar_cliente(customer_id));

-- ── 3 · Guardar un contacto, en UNA transacción ─────────────────────────────
-- Antes el navegador hacía dos escrituras: bajar el principal anterior y
-- después guardar. Entre las dos, el cliente podía quedar sin ningún principal
-- —si la segunda fallaba— o con dos, si dos personas marcaban a la vez.
--
-- `p_contacto` nulo es un alta. `p_esperado` es el `updated_at` que se leyó al
-- abrir el formulario: si alguien guardó en el medio, corta con
-- `CONFLICTO_DE_EDICION` **sin errcode 40001**, porque PostgREST reintenta los
-- 40001 y el conflicto no se resuelve reintentando.
create or replace function public.guardar_contacto(
  p_customer uuid,
  p_contacto uuid,
  p_esperado timestamptz,
  p_datos jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k_permitidos constant text[] := array[
    'full_name', 'role', 'email', 'phone', 'fax', 'notes', 'is_default', 'active'
  ];
  v_company uuid; v_clave text; v_id uuid; v_nuevo timestamptz;
  v_actual customer_contacts%rowtype;
  n_nombre text; n_rol text; n_email text; n_tel text; n_fax text; n_notas text;
  n_principal boolean; n_activo boolean;
  v_diff jsonb := '{}'::jsonb; v_accion text;
begin
  select company_id into v_company from customers where id = p_customer;
  if v_company is null then
    raise exception 'CLIENTE_INEXISTENTE';
  end if;
  if not app.puede_administrar_cliente(p_customer) then
    raise exception 'SIN_PERMISO';
  end if;

  -- Whitelist: lo que no está, no se edita. `company_id` y `customer_id` no
  -- son editables ni «por si acaso».
  for v_clave in select jsonb_object_keys(coalesce(p_datos, '{}'::jsonb)) loop
    if not (v_clave = any (k_permitidos)) then
      raise exception 'CAMPO_NO_EDITABLE' using detail = v_clave;
    end if;
  end loop;

  if p_contacto is not null then
    select * into v_actual from customer_contacts
     where id = p_contacto and customer_id = p_customer for update;
    if v_actual.id is null then
      raise exception 'CONTACTO_DE_OTRO_CLIENTE';
    end if;
    if p_esperado is not null and v_actual.updated_at is distinct from p_esperado then
      raise exception 'CONFLICTO_DE_EDICION';
    end if;
  end if;

  n_nombre    := case when p_datos ? 'full_name' then nullif(btrim(p_datos->>'full_name'), '') else v_actual.full_name end;
  n_rol       := case when p_datos ? 'role'      then nullif(btrim(p_datos->>'role'), '')      else v_actual.role end;
  n_email     := case when p_datos ? 'email'     then nullif(btrim(lower(p_datos->>'email')), '') else v_actual.email end;
  n_tel       := case when p_datos ? 'phone'     then nullif(btrim(p_datos->>'phone'), '')     else v_actual.phone end;
  n_fax       := case when p_datos ? 'fax'       then nullif(btrim(p_datos->>'fax'), '')       else v_actual.fax end;
  n_notas     := case when p_datos ? 'notes'     then nullif(btrim(p_datos->>'notes'), '')     else v_actual.notes end;
  n_principal := case when p_datos ? 'is_default' then (p_datos->>'is_default')::boolean else coalesce(v_actual.is_default, false) end;
  n_activo    := case when p_datos ? 'active'     then (p_datos->>'active')::boolean     else coalesce(v_actual.active, true) end;

  if n_nombre is null then
    raise exception 'NOMBRE_REQUERIDO';
  end if;
  -- Un contacto desactivado no puede ser el principal: sería ofrecer a alguien
  -- que ya no atiende.
  if not n_activo then
    n_principal := false;
  end if;

  if p_contacto is null then
    if n_principal then
      update customer_contacts set is_default = false
       where customer_id = p_customer and is_default;
    end if;
    insert into customer_contacts (company_id, customer_id, full_name, role, email,
                                   phone, fax, notes, is_default, active)
    values (v_company, p_customer, n_nombre, n_rol, n_email, n_tel, n_fax, n_notas,
            n_principal, n_activo)
    returning id, updated_at into v_id, v_nuevo;
    v_accion := 'contact_added';
    v_diff := jsonb_build_object('contacto', n_nombre, 'principal', n_principal);
  else
    if n_nombre    is distinct from v_actual.full_name  then v_diff := v_diff || jsonb_build_object('full_name',  jsonb_build_object('from', v_actual.full_name, 'to', n_nombre)); end if;
    if n_rol       is distinct from v_actual.role       then v_diff := v_diff || jsonb_build_object('role',       jsonb_build_object('from', v_actual.role, 'to', n_rol)); end if;
    if n_email     is distinct from v_actual.email      then v_diff := v_diff || jsonb_build_object('email',      jsonb_build_object('from', v_actual.email, 'to', n_email)); end if;
    if n_tel       is distinct from v_actual.phone      then v_diff := v_diff || jsonb_build_object('phone',      jsonb_build_object('from', v_actual.phone, 'to', n_tel)); end if;
    if n_fax       is distinct from v_actual.fax        then v_diff := v_diff || jsonb_build_object('fax',        jsonb_build_object('from', v_actual.fax, 'to', n_fax)); end if;
    if n_notas     is distinct from v_actual.notes      then v_diff := v_diff || jsonb_build_object('notes',      jsonb_build_object('from', v_actual.notes, 'to', n_notas)); end if;
    if n_principal is distinct from v_actual.is_default then v_diff := v_diff || jsonb_build_object('is_default', jsonb_build_object('from', v_actual.is_default, 'to', n_principal)); end if;
    if n_activo    is distinct from v_actual.active     then v_diff := v_diff || jsonb_build_object('active',     jsonb_build_object('from', v_actual.active, 'to', n_activo)); end if;

    -- Guardar sin cambios no es un cambio: no mueve `updated_at` ni audita.
    if v_diff = '{}'::jsonb then
      return jsonb_build_object('id', v_actual.id, 'actualizado_en', v_actual.updated_at,
                                'campos', 0, 'sin_cambios', true);
    end if;

    if n_principal and not coalesce(v_actual.is_default, false) then
      update customer_contacts set is_default = false
       where customer_id = p_customer and is_default and id <> p_contacto;
    end if;

    update customer_contacts
       set full_name = n_nombre, role = n_rol, email = n_email, phone = n_tel,
           fax = n_fax, notes = n_notas, is_default = n_principal, active = n_activo,
           updated_by = auth.uid()
     where id = p_contacto
    returning id, updated_at into v_id, v_nuevo;
    v_accion := 'contact_updated';
  end if;

  -- La auditoría va contra el CLIENTE, no contra el contacto: quien lee la
  -- historia de un cliente quiere ver también qué pasó con su agenda.
  insert into sales_audit (company_id, entity_type, entity_id, action, diff, actor_id)
  values (v_company, 'customer', p_customer, v_accion,
          v_diff || jsonb_build_object('contacto_id', v_id), auth.uid());

  return jsonb_build_object('id', v_id, 'actualizado_en', v_nuevo,
                            'campos', (select count(*) from jsonb_object_keys(v_diff)),
                            'sin_cambios', false);
end $$;

revoke execute on function public.guardar_contacto(uuid, uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.guardar_contacto(uuid, uuid, timestamptz, jsonb) to authenticated;

-- ── 4 · Borrar un contacto, sólo si nadie lo nombra ─────────────────────────
create or replace function public.borrar_contacto(p_contacto uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_company uuid; v_customer uuid; v_nombre text; v_usos int;
begin
  select company_id, customer_id, full_name into v_company, v_customer, v_nombre
    from customer_contacts where id = p_contacto;
  if v_company is null then
    raise exception 'CONTACTO_INEXISTENTE';
  end if;
  if not app.puede_administrar_cliente(v_customer) then
    raise exception 'SIN_PERMISO';
  end if;

  -- Las seis tablas que hoy apuntan a un contacto. WhatsApp y email están
  -- incluidos a propósito: no se tocan, pero borrar el contacto les rompería
  -- el hilo.
  select (select count(*) from sales_quotes  where contact_id = p_contacto)
       + (select count(*) from sales_orders  where contact_id = p_contacto)
       + (select count(*) from deliveries    where contact_id = p_contacto)
       + (select count(*) from customer_purchase_orders where contact_id = p_contacto)
       + (select count(*) from whatsapp_conversations where customer_contact_id = p_contacto)
       + (select count(*) from email_thread_state where customer_contact_id = p_contacto)
    into v_usos;

  if v_usos > 0 then
    raise exception 'CONTACTO_REFERENCIADO'
      using detail = format('%s figura en %s documento(s): se desactiva, no se borra.', v_nombre, v_usos);
  end if;

  delete from customer_contacts where id = p_contacto;

  insert into sales_audit (company_id, entity_type, entity_id, action, diff, actor_id)
  values (v_company, 'customer', v_customer, 'contact_removed',
          jsonb_build_object('contacto', v_nombre), auth.uid());

  return jsonb_build_object('borrado', true);
end $$;

revoke execute on function public.borrar_contacto(uuid) from public, anon;
grant execute on function public.borrar_contacto(uuid) to authenticated;

-- ── 5 · Guardar una dirección ──────────────────────────────────────────────
-- Igual que el contacto, con dos diferencias: la principal es **por tipo**
-- —una de entrega y una de facturación pueden ser las dos principales— y hay
-- validaciones propias (tipo, calle, país de dos letras).
create or replace function public.guardar_direccion(
  p_customer uuid,
  p_direccion uuid,
  p_esperado timestamptz,
  p_datos jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k_permitidos constant text[] := array[
    'kind', 'street', 'city', 'state', 'postal_code', 'country_code', 'notes',
    'is_default', 'active'
  ];
  v_company uuid; v_clave text; v_id uuid; v_nuevo timestamptz;
  v_actual customer_addresses%rowtype;
  n_tipo text; n_calle text; n_ciudad text; n_prov text; n_cp text; n_pais text;
  n_notas text; n_principal boolean; n_activo boolean;
  v_diff jsonb := '{}'::jsonb; v_accion text;
begin
  select company_id into v_company from customers where id = p_customer;
  if v_company is null then
    raise exception 'CLIENTE_INEXISTENTE';
  end if;
  if not app.puede_administrar_cliente(p_customer) then
    raise exception 'SIN_PERMISO';
  end if;

  for v_clave in select jsonb_object_keys(coalesce(p_datos, '{}'::jsonb)) loop
    if not (v_clave = any (k_permitidos)) then
      raise exception 'CAMPO_NO_EDITABLE' using detail = v_clave;
    end if;
  end loop;

  if p_direccion is not null then
    select * into v_actual from customer_addresses
     where id = p_direccion and customer_id = p_customer for update;
    if v_actual.id is null then
      raise exception 'DIRECCION_DE_OTRO_CLIENTE';
    end if;
    if p_esperado is not null and v_actual.updated_at is distinct from p_esperado then
      raise exception 'CONFLICTO_DE_EDICION';
    end if;
  end if;

  n_tipo      := case when p_datos ? 'kind'         then nullif(btrim(p_datos->>'kind'), '')         else v_actual.kind end;
  n_calle     := case when p_datos ? 'street'       then nullif(btrim(p_datos->>'street'), '')       else v_actual.street end;
  n_ciudad    := case when p_datos ? 'city'         then nullif(btrim(p_datos->>'city'), '')         else v_actual.city end;
  n_prov      := case when p_datos ? 'state'        then nullif(btrim(p_datos->>'state'), '')        else v_actual.state end;
  n_cp        := case when p_datos ? 'postal_code'  then nullif(btrim(p_datos->>'postal_code'), '')  else v_actual.postal_code end;
  n_pais      := case when p_datos ? 'country_code' then nullif(btrim(upper(p_datos->>'country_code')), '') else v_actual.country_code end;
  n_notas     := case when p_datos ? 'notes'        then nullif(btrim(p_datos->>'notes'), '')        else v_actual.notes end;
  n_principal := case when p_datos ? 'is_default'   then (p_datos->>'is_default')::boolean else coalesce(v_actual.is_default, false) end;
  n_activo    := case when p_datos ? 'active'       then (p_datos->>'active')::boolean     else coalesce(v_actual.active, true) end;

  if n_tipo is null or n_tipo not in ('billing', 'shipping', 'both', 'other') then
    raise exception 'TIPO_INVALIDO';
  end if;
  if n_calle is null then
    raise exception 'CALLE_REQUERIDA';
  end if;
  if n_pais is not null and length(n_pais) <> 2 then
    raise exception 'PAIS_INVALIDO' using detail = 'Son dos letras: AR, UY, BR…';
  end if;
  if not n_activo then
    n_principal := false;
  end if;

  if p_direccion is null then
    if n_principal then
      update customer_addresses set is_default = false
       where customer_id = p_customer and kind = n_tipo and is_default;
    end if;
    insert into customer_addresses (company_id, customer_id, kind, street, city, state,
                                    postal_code, country_code, notes, is_default, active)
    values (v_company, p_customer, n_tipo, n_calle, n_ciudad, n_prov, n_cp, n_pais,
            n_notas, n_principal, n_activo)
    returning id, updated_at into v_id, v_nuevo;
    v_accion := 'address_added';
    v_diff := jsonb_build_object('direccion', n_calle, 'tipo', n_tipo, 'principal', n_principal);
  else
    if n_tipo      is distinct from v_actual.kind         then v_diff := v_diff || jsonb_build_object('kind',         jsonb_build_object('from', v_actual.kind, 'to', n_tipo)); end if;
    if n_calle     is distinct from v_actual.street       then v_diff := v_diff || jsonb_build_object('street',       jsonb_build_object('from', v_actual.street, 'to', n_calle)); end if;
    if n_ciudad    is distinct from v_actual.city         then v_diff := v_diff || jsonb_build_object('city',         jsonb_build_object('from', v_actual.city, 'to', n_ciudad)); end if;
    if n_prov      is distinct from v_actual.state        then v_diff := v_diff || jsonb_build_object('state',        jsonb_build_object('from', v_actual.state, 'to', n_prov)); end if;
    if n_cp        is distinct from v_actual.postal_code  then v_diff := v_diff || jsonb_build_object('postal_code',  jsonb_build_object('from', v_actual.postal_code, 'to', n_cp)); end if;
    if n_pais      is distinct from v_actual.country_code then v_diff := v_diff || jsonb_build_object('country_code', jsonb_build_object('from', v_actual.country_code, 'to', n_pais)); end if;
    if n_notas     is distinct from v_actual.notes        then v_diff := v_diff || jsonb_build_object('notes',        jsonb_build_object('from', v_actual.notes, 'to', n_notas)); end if;
    if n_principal is distinct from v_actual.is_default   then v_diff := v_diff || jsonb_build_object('is_default',   jsonb_build_object('from', v_actual.is_default, 'to', n_principal)); end if;
    if n_activo    is distinct from v_actual.active       then v_diff := v_diff || jsonb_build_object('active',       jsonb_build_object('from', v_actual.active, 'to', n_activo)); end if;

    if v_diff = '{}'::jsonb then
      return jsonb_build_object('id', v_actual.id, 'actualizado_en', v_actual.updated_at,
                                'campos', 0, 'sin_cambios', true);
    end if;

    -- Cambiarle el tipo a una principal la hace principal del tipo nuevo: hay
    -- que bajar a la que estaba ahí.
    if n_principal and (not coalesce(v_actual.is_default, false) or n_tipo is distinct from v_actual.kind) then
      update customer_addresses set is_default = false
       where customer_id = p_customer and kind = n_tipo and is_default and id <> p_direccion;
    end if;

    update customer_addresses
       set kind = n_tipo, street = n_calle, city = n_ciudad, state = n_prov,
           postal_code = n_cp, country_code = n_pais, notes = n_notas,
           is_default = n_principal, active = n_activo, updated_by = auth.uid()
     where id = p_direccion
    returning id, updated_at into v_id, v_nuevo;
    v_accion := 'address_updated';
  end if;

  insert into sales_audit (company_id, entity_type, entity_id, action, diff, actor_id)
  values (v_company, 'customer', p_customer, v_accion,
          v_diff || jsonb_build_object('direccion_id', v_id), auth.uid());

  return jsonb_build_object('id', v_id, 'actualizado_en', v_nuevo,
                            'campos', (select count(*) from jsonb_object_keys(v_diff)),
                            'sin_cambios', false);
end $$;

revoke execute on function public.guardar_direccion(uuid, uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.guardar_direccion(uuid, uuid, timestamptz, jsonb) to authenticated;

-- ── 6 · Borrar una dirección, sólo si ningún documento la nombra ────────────
create or replace function public.borrar_direccion(p_direccion uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_company uuid; v_customer uuid; v_calle text; v_usos int;
begin
  select company_id, customer_id, street into v_company, v_customer, v_calle
    from customer_addresses where id = p_direccion;
  if v_company is null then
    raise exception 'DIRECCION_INEXISTENTE';
  end if;
  if not app.puede_administrar_cliente(v_customer) then
    raise exception 'SIN_PERMISO';
  end if;

  select (select count(*) from sales_orders where shipping_address_id = p_direccion or billing_address_id = p_direccion)
       + (select count(*) from deliveries   where shipping_address_id = p_direccion)
       + (select count(*) from customer_purchase_orders where shipping_address_id = p_direccion)
    into v_usos;

  if v_usos > 0 then
    raise exception 'DIRECCION_REFERENCIADA'
      using detail = format('%s figura en %s documento(s): se desactiva, no se borra.', v_calle, v_usos);
  end if;

  delete from customer_addresses where id = p_direccion;

  insert into sales_audit (company_id, entity_type, entity_id, action, diff, actor_id)
  values (v_company, 'customer', v_customer, 'address_removed',
          jsonb_build_object('direccion', v_calle), auth.uid());

  return jsonb_build_object('borrado', true);
end $$;

revoke execute on function public.borrar_direccion(uuid) from public, anon;
grant execute on function public.borrar_direccion(uuid) to authenticated;

-- ── 7 · La dirección de entrega del pedido ──────────────────────────────────
-- La columna `sales_orders.shipping_address_id` ya existía desde Stage 3 y
-- estaba en NULL en los 172 pedidos: nunca hubo UI que la escribiera. Lo que
-- falta es validarla, porque una FK sola deja mandar la mercadería al domicilio
-- de otro cliente.
create or replace function app.validar_direccion_envio(
  p_company uuid, p_customer uuid, p_direccion uuid
) returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_ok int;
begin
  if p_direccion is null then
    return;  -- Sin elegir: el remito usará la principal al emitirse.
  end if;
  select count(*) into v_ok from customer_addresses
   where id = p_direccion and company_id = p_company and customer_id = p_customer
     and active and kind in ('shipping', 'both');
  if v_ok = 0 then
    raise exception 'DIRECCION_INVALIDA' using errcode = '42501',
      detail = 'La dirección de entrega tiene que ser una dirección activa de este cliente.';
  end if;
end $$;

revoke execute on function app.validar_direccion_envio(uuid, uuid, uuid) from public, anon;

-- `crear_pedido` y `guardar_pedido` se parchean sobre su propia definición, con
-- anclas: si una no aparece —porque otra entrega cambió esa línea— la migración
-- falla en vez de dejar la función a medio arreglar. Cada bloque agrega cuatro
-- cosas: `shipping_address_id` a la whitelist, la variable `v_direccion`, la
-- validación, y la columna en el INSERT/UPDATE.
do $patch$
declare v_def text; v_nuevo text;
begin
  v_def := pg_get_functiondef('public.crear_pedido(uuid, jsonb, jsonb)'::regprocedure);
  if position('shipping_address_id' in v_def) > 0 then
    raise notice 'crear_pedido ya estaba parcheada';
    return;
  end if;

  v_nuevo := replace(v_def,
    E'    ''exchange_rate'', ''discount_pct'', ''perception_pct''\n  ];',
    E'    ''exchange_rate'', ''discount_pct'', ''perception_pct'', ''shipping_address_id''\n  ];');
  if v_nuevo = v_def then raise exception 'ancla 1 (whitelist) no encontrada en crear_pedido'; end if;
  v_def := v_nuevo;

  v_nuevo := replace(v_def, E'  v_vendedor  uuid;\n', E'  v_vendedor  uuid;\n  v_direccion uuid;\n');
  if v_nuevo = v_def then raise exception 'ancla 2 (declaración) no encontrada en crear_pedido'; end if;
  v_def := v_nuevo;

  v_nuevo := replace(v_def,
    E'  perform app.validar_cabecera_venta(',
    E'  v_direccion := nullif(p_cabecera->>''shipping_address_id'', '''')::uuid;\n  perform app.validar_direccion_envio(p_company, v_customer, v_direccion);\n\n  perform app.validar_cabecera_venta(');
  if v_nuevo = v_def then raise exception 'ancla 3 (validación) no encontrada en crear_pedido'; end if;
  v_def := v_nuevo;

  v_nuevo := replace(v_def,
    E'    payment_terms, notes, discount_pct, perception_pct,\n',
    E'    payment_terms, notes, discount_pct, perception_pct, shipping_address_id,\n');
  if v_nuevo = v_def then raise exception 'ancla 4 (columnas del insert) no encontrada en crear_pedido'; end if;
  v_def := v_nuevo;

  v_nuevo := replace(v_def,
    E'    coalesce(nullif(p_cabecera->>''perception_pct'', '''')::numeric, 0),\n',
    E'    coalesce(nullif(p_cabecera->>''perception_pct'', '''')::numeric, 0),\n    v_direccion,\n');
  if v_nuevo = v_def then raise exception 'ancla 5 (valores del insert) no encontrada en crear_pedido'; end if;

  execute v_nuevo;
end $patch$;

do $patch$
declare v_def text; v_nuevo text;
begin
  v_def := pg_get_functiondef('public.guardar_pedido(uuid, timestamptz, jsonb, jsonb)'::regprocedure);
  if position('shipping_address_id' in v_def) > 0 then
    raise notice 'guardar_pedido ya estaba parcheada';
    return;
  end if;

  v_nuevo := replace(v_def,
    E'    ''exchange_rate'', ''discount_pct'', ''perception_pct''\n  ];',
    E'    ''exchange_rate'', ''discount_pct'', ''perception_pct'', ''shipping_address_id''\n  ];');
  if v_nuevo = v_def then raise exception 'ancla 1 (whitelist) no encontrada en guardar_pedido'; end if;
  v_def := v_nuevo;

  v_nuevo := replace(v_def, E'  v_vendedor  uuid;\n', E'  v_vendedor  uuid;\n  v_direccion uuid;\n');
  if v_nuevo = v_def then raise exception 'ancla 2 (declaración) no encontrada en guardar_pedido'; end if;
  v_def := v_nuevo;

  -- Acá el valor se resuelve como el resto de la cabecera: si la clave no vino,
  -- se conserva lo que el pedido ya tenía. Mandarla en null es **quitarla**.
  v_nuevo := replace(v_def,
    E'  perform app.validar_cabecera_venta(',
    E'  v_direccion := case when p_cabecera ? ''shipping_address_id''\n                      then nullif(p_cabecera->>''shipping_address_id'', '''')::uuid\n                      else v_o.shipping_address_id end;\n  perform app.validar_direccion_envio(v_o.company_id, v_customer, v_direccion);\n\n  perform app.validar_cabecera_venta(');
  if v_nuevo = v_def then raise exception 'ancla 3 (validación) no encontrada en guardar_pedido'; end if;
  v_def := v_nuevo;

  v_nuevo := replace(v_def, E'    price_list_id  = v_lista,\n',
    E'    price_list_id  = v_lista,\n    shipping_address_id = v_direccion,\n');
  if v_nuevo = v_def then raise exception 'ancla 4 (update) no encontrada en guardar_pedido'; end if;

  execute v_nuevo;
end $patch$;

-- ── 8 · El remito no cae en una dirección dada de baja ──────────────────────
-- `app.domicilio_para_remito` es de E6 y congela el domicilio al emitir. Ahora
-- que las direcciones se pueden desactivar, el remito sin dirección explícita
-- tampoco puede caer en una que el cliente dio de baja.
create or replace function app.domicilio_para_remito(p_company uuid, p_order uuid, p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_id uuid; v jsonb;
begin
  if p_order is not null then
    select shipping_address_id into v_id from sales_orders where id = p_order;
  end if;

  if v_id is null then
    select id into v_id
      from customer_addresses
     where company_id = p_company and customer_id = p_customer
       and active and kind in ('shipping', 'both')
     order by is_default desc, created_at
     limit 1;
  end if;

  if v_id is null then
    return null;
  end if;

  select jsonb_strip_nulls(jsonb_build_object(
           'street', street, 'city', city, 'state', state,
           'postal_code', postal_code, 'country_code', country_code,
           'notes', notes, 'address_id', id))
    into v
    from customer_addresses
   where id = v_id and company_id = p_company;

  return v;
end $$;

commit;

-- ============================================================================
-- ROLLBACK
--
-- Devuelve el esquema al estado previo a E3. Lo único que no vuelve solo es el
-- dato: si alguien desactivó un contacto, al borrar la columna `active` ese
-- contacto vuelve a ofrecerse. Es el precio de sacar la columna, y por eso el
-- rollback lo dice en vez de esconderlo.
-- ============================================================================
-- begin;
--
-- drop function if exists public.guardar_contacto(uuid, uuid, timestamptz, jsonb);
-- drop function if exists public.borrar_contacto(uuid);
-- drop function if exists public.guardar_direccion(uuid, uuid, timestamptz, jsonb);
-- drop function if exists public.borrar_direccion(uuid);
--
-- -- `crear_pedido` y `guardar_pedido`: el camino inverso del parche.
-- do $r$
-- declare v_def text;
-- begin
--   v_def := pg_get_functiondef('public.crear_pedido(uuid, jsonb, jsonb)'::regprocedure);
--   v_def := replace(v_def, ', ''shipping_address_id''', '');
--   v_def := replace(v_def, E'  v_direccion uuid;\n', '');
--   v_def := replace(v_def, E'  v_direccion := nullif(p_cabecera->>''shipping_address_id'', '''')::uuid;\n  perform app.validar_direccion_envio(p_company, v_customer, v_direccion);\n\n', '');
--   v_def := replace(v_def, 'perception_pct, shipping_address_id,', 'perception_pct,');
--   v_def := replace(v_def, E'    v_direccion,\n', '');
--   execute v_def;
-- end $r$;
--
-- -- El domicilio del remito, sin el filtro por `active`.
-- create or replace function app.domicilio_para_remito(p_company uuid, p_order uuid, p_customer uuid)
-- returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
-- -- … la versión de E6: `and kind in ('shipping','both')` sin `active and`.
-- $$;
--
-- -- Las policies vuelven a admin y employee.
-- drop policy if exists contacts_write on customer_contacts;
-- create policy contacts_write on customer_contacts for all to authenticated
--   using (company_id = any (app.current_writer_company_ids()))
--   with check (company_id = any (app.current_writer_company_ids()));
-- drop policy if exists addresses_write on customer_addresses;
-- create policy addresses_write on customer_addresses for all to authenticated
--   using (company_id = any (app.current_writer_company_ids()))
--   with check (company_id = any (app.current_writer_company_ids()));
--
-- drop function if exists app.puede_administrar_cliente(uuid);
-- drop function if exists app.validar_direccion_envio(uuid, uuid, uuid);
--
-- -- Los índices únicos, sin `active`.
-- drop index if exists uq_customer_contact_default;
-- create unique index uq_customer_contact_default on customer_contacts (customer_id) where is_default;
-- drop index if exists uq_customer_addr_default;
-- create unique index uq_customer_addr_default on customer_addresses (customer_id, kind) where is_default;
--
-- alter table customer_contacts  drop column if exists active;
-- alter table customer_addresses drop column if exists active;
--
-- commit;
