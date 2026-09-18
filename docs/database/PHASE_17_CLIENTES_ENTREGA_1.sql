-- ---------------------------------------------------------------------------
-- FASE 17 · CLIENTES — Entrega 1: edición segura
-- ---------------------------------------------------------------------------
--
-- La ficha del cliente ya se editaba con borrador y «Guardar cambios» —no hay
-- guardado al perder el foco—, pero el guardado en sí era un `update` suelto
-- desde el navegador: sin control de concurrencia (gana el último que
-- escribe), sin validación de las FK comerciales y sin dejar rastro de qué
-- cambió. Esta entrega lo lleva al mismo estándar que Ventas E2–E6:
--
--   · `guardar_cliente` — una transacción, con la fila bloqueada, whitelist
--     explícita, testigo de concurrencia y auditoría del ANTES y el DESPUÉS
--     de los campos que realmente cambiaron;
--   · dos triggers de auditoría para los dos hechos que NO pasan por esa RPC:
--     el alta y la baja/reactivación.
--
-- Lo que NO cambia: RLS, el soft delete, la cola de revisión, los contactos y
-- las direcciones (eso es E3) y la integración con Ventas (E2).
--
-- Una sutileza que el diseño respeta en vez de pelear: el trigger
-- `app.asignar_vendedor_cliente` ya impide que un vendedor se reasigne un
-- cliente (en UPDATE le devuelve el valor viejo). Como la RPC es SECURITY
-- DEFINER pero `auth.uid()` sigue siendo el del usuario, ese trigger sigue
-- valiendo. En vez de dejar que la reasignación se ignore en silencio, la RPC
-- la RECHAZA con `VENDEDOR_NO_EDITABLE`: el usuario tiene que enterarse.

-- ---------------------------------------------------------------------------
-- 1 · Guardar un cliente, entero y de una vez
-- ---------------------------------------------------------------------------
-- `p_datos` lleva SÓLO las claves de la whitelist. Cualquier otra —`id`,
-- `company_id`, `created_at`, `updated_at`, `created_by`, `imported_at`,
-- `legacy_*`, `needs_review`, `review_reason`, `deleted_at`, `status`— corta
-- con CAMPO_NO_EDITABLE. No se filtran en silencio: se rechaza la llamada.
--
-- Los campos se resuelven uno por uno y con su tipo (texto, arreglo, uuid) en
-- vez de armar SQL dinámico: son trece y no cambian seguido, y así no hay
-- interpolación de identificadores en ningún lado.

create or replace function public.guardar_cliente(
  p_customer uuid,
  p_esperado timestamptz,
  p_datos    jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k_permitidos constant text[] := array[
    'legal_name', 'trade_name', 'tax_id', 'emails', 'email_domains', 'industry',
    'phone', 'customer_type', 'payment_terms', 'default_currency', 'notes',
    'salesperson_id', 'default_price_list_id'
  ];
  v customers%rowtype;
  v_rol text; v_clave text; v_diff jsonb := '{}'::jsonb; v_nuevo timestamptz;
  n_legal text; n_trade text; n_tax text; n_industry text; n_phone text;
  n_type text; n_terms text; n_currency text; n_notes text;
  n_emails text[]; n_domains text[]; n_seller uuid; n_list uuid;
  v_digitos text; v_ok int;
begin
  select * into v from customers where id = p_customer for update;
  if v.id is null then
    raise exception 'CLIENTE_INEXISTENTE';
  end if;

  -- ── Permiso: el mismo de la policy `customers_update`, comprobado acá
  --    porque SECURITY DEFINER saltea RLS.
  v_rol := app."current_role"(v.company_id);
  if v_rol is null or v_rol not in ('admin', 'employee', 'salesperson') then
    raise exception 'SIN_PERMISO';
  end if;
  if v_rol = 'salesperson' and v.salesperson_id is distinct from auth.uid() then
    raise exception 'SIN_PERMISO';
  end if;

  if v.deleted_at is not null then
    raise exception 'CLIENTE_DADO_DE_BAJA';
  end if;

  -- ── Concurrencia. Sin errcode 40001: con ése PostgREST reintenta solo y el
  --    usuario ve un timeout en vez del aviso.
  if v.updated_at is distinct from p_esperado then
    raise exception 'CONFLICTO_DE_EDICION';
  end if;

  for v_clave in select jsonb_object_keys(coalesce(p_datos, '{}'::jsonb)) loop
    if not (v_clave = any (k_permitidos)) then
      raise exception 'CAMPO_NO_EDITABLE' using detail = v_clave;
    end if;
  end loop;

  -- ── Valores nuevos: lo que viene, o lo que ya estaba.
  n_legal    := case when p_datos ? 'legal_name'    then nullif(btrim(p_datos->>'legal_name'), '')    else v.legal_name end;
  n_trade    := case when p_datos ? 'trade_name'    then nullif(btrim(p_datos->>'trade_name'), '')    else v.trade_name end;
  n_tax      := case when p_datos ? 'tax_id'        then nullif(btrim(p_datos->>'tax_id'), '')        else v.tax_id end;
  n_industry := case when p_datos ? 'industry'      then nullif(btrim(p_datos->>'industry'), '')      else v.industry end;
  n_phone    := case when p_datos ? 'phone'         then nullif(btrim(p_datos->>'phone'), '')         else v.phone end;
  n_type     := case when p_datos ? 'customer_type' then coalesce(nullif(btrim(p_datos->>'customer_type'), ''), v.customer_type) else v.customer_type end;
  n_terms    := case when p_datos ? 'payment_terms' then nullif(btrim(p_datos->>'payment_terms'), '') else v.payment_terms end;
  n_currency := case when p_datos ? 'default_currency' then nullif(btrim(p_datos->>'default_currency'), '') else v.default_currency end;
  n_notes    := case when p_datos ? 'notes'         then nullif(btrim(p_datos->>'notes'), '')         else v.notes end;
  n_seller   := case when p_datos ? 'salesperson_id' then nullif(p_datos->>'salesperson_id', '')::uuid else v.salesperson_id end;
  n_list     := case when p_datos ? 'default_price_list_id' then nullif(p_datos->>'default_price_list_id', '')::uuid else v.default_price_list_id end;

  -- Los arreglos llegan como arreglo JSON. Se normalizan acá también —minúscula,
  -- sin espacios, sin vacíos, sin repetidos— porque el servidor no puede
  -- confiar en que el navegador lo haya hecho.
  if p_datos ? 'emails' then
    select coalesce(array_agg(distinct x), '{}')
      into n_emails
      from (select nullif(btrim(lower(e)), '') x
              from jsonb_array_elements_text(p_datos->'emails') e) s
     where x is not null;
  else
    n_emails := v.emails;
  end if;

  if p_datos ? 'email_domains' then
    select coalesce(array_agg(distinct x), '{}')
      into n_domains
      from (select nullif(btrim(lower(d)), '') x
              from jsonb_array_elements_text(p_datos->'email_domains') d) s
     where x is not null;
  else
    n_domains := v.email_domains;
  end if;

  -- ── Validaciones
  if n_legal is null then
    raise exception 'RAZON_SOCIAL_REQUERIDA';
  end if;
  if n_type not in ('business', 'individual') then
    raise exception 'TIPO_INVALIDO';
  end if;

  -- El CUIT no es obligatorio: hay clientes del exterior y 445 importados sin
  -- él. Se valida SÓLO si cambió, para no bloquear la edición de otro campo en
  -- un cliente viejo cuyo CUIT tiene un formato raro.
  if n_tax is distinct from v.tax_id and n_tax is not null then
    v_digitos := regexp_replace(n_tax, '\D', '', 'g');
    if length(v_digitos) <> 11 then
      raise exception 'CUIT_INVALIDO' using detail = 'Un CUIT tiene 11 dígitos.';
    end if;
  end if;

  if n_currency is not null then
    select count(*) into v_ok from currencies where code = n_currency;
    if v_ok = 0 then
      raise exception 'MONEDA_INVALIDA';
    end if;
  end if;

  if n_list is not null then
    select count(*) into v_ok from price_lists
     where id = n_list and company_id = v.company_id;
    if v_ok = 0 then
      raise exception 'TARIFA_INVALIDA';
    end if;
  end if;

  if n_seller is distinct from v.salesperson_id then
    -- El vendedor no se reasigna a sí mismo. El trigger ya lo impide en
    -- silencio; acá se dice.
    if v_rol = 'salesperson' then
      raise exception 'VENDEDOR_NO_EDITABLE';
    end if;
    if n_seller is not null then
      select count(*) into v_ok from company_memberships
       where user_id = n_seller and company_id = v.company_id
         and status = 'active' and role in ('admin', 'employee', 'salesperson');
      if v_ok = 0 then
        raise exception 'VENDEDOR_INVALIDO';
      end if;
    end if;
  end if;

  -- ── Qué cambió de verdad
  v_diff := app.diff_cliente(v, n_legal, n_trade, n_tax, n_industry, n_phone,
                             n_type, n_terms, n_currency, n_notes, n_emails,
                             n_domains, n_seller, n_list);

  if v_diff = '{}'::jsonb then
    -- Guardar sin cambios no es un error, pero tampoco es un cambio: no se
    -- toca `updated_at` ni se inventa un evento de auditoría.
    return jsonb_build_object('id', v.id, 'actualizado_en', v.updated_at,
                              'campos', 0, 'sin_cambios', true);
  end if;

  update customers
     set legal_name = n_legal, trade_name = n_trade, tax_id = n_tax,
         industry = n_industry, phone = n_phone, customer_type = n_type,
         payment_terms = n_terms, default_currency = n_currency, notes = n_notes,
         emails = n_emails, email_domains = n_domains,
         salesperson_id = n_seller, default_price_list_id = n_list
   where id = p_customer
  returning updated_at into v_nuevo;

  insert into sales_audit (company_id, entity_type, entity_id, action, diff, actor_id)
  values (v.company_id, 'customer', v.id, 'updated', v_diff, auth.uid());

  return jsonb_build_object('id', v.id, 'actualizado_en', v_nuevo,
                            'campos', (select count(*) from jsonb_object_keys(v_diff)),
                            'sin_cambios', false);
end $$;

revoke execute on function public.guardar_cliente(uuid, timestamptz, jsonb) from public, anon;
grant  execute on function public.guardar_cliente(uuid, timestamptz, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2 · El diff, aparte
-- ---------------------------------------------------------------------------
-- Sólo los campos que cambiaron, con su valor anterior y el nuevo. Nada de
-- volcar la fila entera: la auditoría tiene que poder leerse.

create or replace function app.diff_cliente(
  v customers, n_legal text, n_trade text, n_tax text, n_industry text,
  n_phone text, n_type text, n_terms text, n_currency text, n_notes text,
  n_emails text[], n_domains text[], n_seller uuid, n_list uuid
) returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $$
declare d jsonb := '{}'::jsonb;
begin
  if n_legal    is distinct from v.legal_name    then d := d || jsonb_build_object('legal_name',    jsonb_build_object('from', v.legal_name,    'to', n_legal)); end if;
  if n_trade    is distinct from v.trade_name    then d := d || jsonb_build_object('trade_name',    jsonb_build_object('from', v.trade_name,    'to', n_trade)); end if;
  if n_tax      is distinct from v.tax_id        then d := d || jsonb_build_object('tax_id',        jsonb_build_object('from', v.tax_id,        'to', n_tax)); end if;
  if n_industry is distinct from v.industry      then d := d || jsonb_build_object('industry',      jsonb_build_object('from', v.industry,      'to', n_industry)); end if;
  if n_phone    is distinct from v.phone         then d := d || jsonb_build_object('phone',         jsonb_build_object('from', v.phone,         'to', n_phone)); end if;
  if n_type     is distinct from v.customer_type then d := d || jsonb_build_object('customer_type', jsonb_build_object('from', v.customer_type, 'to', n_type)); end if;
  if n_terms    is distinct from v.payment_terms then d := d || jsonb_build_object('payment_terms', jsonb_build_object('from', v.payment_terms, 'to', n_terms)); end if;
  if n_currency is distinct from v.default_currency then d := d || jsonb_build_object('default_currency', jsonb_build_object('from', v.default_currency, 'to', n_currency)); end if;
  if n_notes    is distinct from v.notes         then d := d || jsonb_build_object('notes',         jsonb_build_object('from', v.notes,         'to', n_notes)); end if;
  if n_emails   is distinct from v.emails        then d := d || jsonb_build_object('emails',        jsonb_build_object('from', to_jsonb(v.emails),        'to', to_jsonb(n_emails))); end if;
  if n_domains  is distinct from v.email_domains then d := d || jsonb_build_object('email_domains', jsonb_build_object('from', to_jsonb(v.email_domains), 'to', to_jsonb(n_domains))); end if;
  if n_seller   is distinct from v.salesperson_id then d := d || jsonb_build_object('salesperson_id', jsonb_build_object('from', v.salesperson_id, 'to', n_seller)); end if;
  if n_list     is distinct from v.default_price_list_id then d := d || jsonb_build_object('default_price_list_id', jsonb_build_object('from', v.default_price_list_id, 'to', n_list)); end if;
  return d;
end $$;

revoke execute on function app.diff_cliente(customers, text, text, text, text, text, text, text, text, text, text[], text[], uuid, uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- 3 · Los dos hechos que no pasan por la RPC
-- ---------------------------------------------------------------------------
-- El alta y la baja/reactivación siguen siendo escrituras directas (E1 no las
-- reescribe). Para que la trazabilidad no quede a medias, se auditan con
-- triggers. Ambos se saltean cuando no hay usuario —importaciones,
-- migraciones y reconciliación de STEL corren con la clave de servicio—:
-- auditar una migración como si fuera una persona sería mentir.

create or replace function app.auditar_alta_cliente()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  insert into sales_audit (company_id, entity_type, entity_id, action, to_status, diff, actor_id)
  values (new.company_id, 'customer', new.id, 'created', new.status,
          jsonb_build_object('referencia', new.legacy_ref, 'razon_social', new.legal_name),
          auth.uid());
  return new;
end $$;

drop trigger if exists trg_90_auditar_alta_cliente on customers;
create trigger trg_90_auditar_alta_cliente
  after insert on customers
  for each row execute function app.auditar_alta_cliente();

create or replace function app.auditar_estado_cliente()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_accion text;
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.deleted_at is not distinct from old.deleted_at
     and new.status is not distinct from old.status then
    return new;
  end if;
  v_accion := case when new.deleted_at is not null and old.deleted_at is null then 'deactivated'
                   when new.deleted_at is null and old.deleted_at is not null then 'reactivated'
                   else 'status_changed' end;

  insert into sales_audit (company_id, entity_type, entity_id, action,
                           from_status, to_status, diff, actor_id)
  values (new.company_id, 'customer', new.id, v_accion, old.status, new.status,
          jsonb_build_object('deleted_at', jsonb_build_object(
            'from', old.deleted_at, 'to', new.deleted_at)), auth.uid());
  return new;
end $$;

drop trigger if exists trg_91_auditar_estado_cliente on customers;
create trigger trg_91_auditar_estado_cliente
  after update on customers
  for each row execute function app.auditar_estado_cliente();


-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- Nada de esto borra datos: las funciones y los triggers son nuevos y los
-- eventos de auditoría se agregan. Volver atrás deja la edición del cliente
-- como estaba: un `update` desde el navegador, sin testigo y sin rastro.
--
-- drop trigger if exists trg_91_auditar_estado_cliente on customers;
-- drop function if exists app.auditar_estado_cliente();
-- drop trigger if exists trg_90_auditar_alta_cliente on customers;
-- drop function if exists app.auditar_alta_cliente();
-- drop function if exists public.guardar_cliente(uuid, timestamptz, jsonb);
-- drop function if exists app.diff_cliente(customers, text, text, text, text, text, text, text, text, text, text[], text[], uuid, uuid);
-- delete from sales_audit where entity_type = 'customer';   -- sólo si se quiere limpiar el rastro
