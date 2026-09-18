-- ============================================================================
-- Fase 17 · Clientes · Entrega 5 — Alta atómica, duplicados y cola de revisión
--
-- Proyecto: uaxcfufvapzulqvynanp. Aplicado el 2026-09-18.
--
-- 0 tablas nuevas, 0 columnas nuevas. Un índice nuevo (el del teléfono), dos
-- funciones nuevas y una endurecida.
--
-- Lo que NO hace, y es deliberado: **fusionar clientes**. Un merge real toca
-- documentos, contactos, direcciones, adjuntos, precios, auditoría e identidad
-- importada. Media fusión es peor que ninguna, así que E5 no la implementa ni
-- la insinúa con un botón.
-- ============================================================================

begin;

-- ── 1 · Buscar clientes parecidos ──────────────────────────────────────────
-- Los índices que esto necesita YA existían —`uq_customers_cuit_norm`, los GIN
-- `idx_customers_emails` y `idx_customers_domains`, y los trigram
-- `idx_customers_legal_trgm` / `idx_customers_trade_trgm`—. El único que
-- faltaba es el del teléfono.
create index if not exists idx_customers_phone_norm
  on customers (company_id, regexp_replace(phone, '\D', '', 'g'))
  where phone is not null and deleted_at is null;

-- `security invoker`: hereda `customers_select`. Un vendedor no puede descubrir
-- clientes que no ve preguntando por un email.
--
-- El umbral del parecido de nombre está MEDIDO contra el maestro real, no
-- elegido a ojo. Con `similarity` sola a 0.45, «Metalúrgica ABC» vs
-- «Metalurgica A.B.C.» (0.417) no aparecía, y «Mirgor SA» vs «Grupo Mirgor
-- S.A.» (0.421) tampoco. Se usan las dos métricas de pg_trgm porque miden
-- cosas distintas:
--
--   · `similarity`      — los dos nombres son el mismo, escrito distinto.
--   · `word_similarity` — lo escrito está DENTRO del nombre existente
--                         («Whirlpool» → «WHIRLPOOL ARGENTINA S.A.», 1.000).
--
-- Con `similarity >= 0.4 or word_similarity >= 0.7`, seis nombres de prueba
-- contra los 1.010 clientes devuelven entre 1 y 5 candidatos cada uno: es una
-- señal, no ruido. El guard de 4 caracteres deja afuera «SA», que contra
-- cualquier razón social da 0.333 de word_similarity.
create or replace function public.clientes_similares(
  p_company uuid,
  p_nombre text default null,
  p_cuit text default null,
  p_email text default null,
  p_telefono text default null,
  p_excluir uuid default null,
  p_limite int default 10
) returns table (
  id uuid, legal_name text, trade_name text, tax_id text, legacy_ref text,
  emails text[], phone text, deleted_at timestamptz, needs_review boolean,
  motivo text, fuerza text, parecido real
) language sql stable security invoker set search_path = public, pg_temp, extensions as $$
  with entrada as (
    select nullif(btrim(coalesce(p_nombre, '')), '') as nombre,
           nullif(regexp_replace(coalesce(p_cuit, ''), '\D', '', 'g'), '') as cuit,
           nullif(btrim(lower(coalesce(p_email, ''))), '') as email,
           nullif(regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g'), '') as tel
  ), candidatos as (
    -- FUERTE: el mismo CUIT. Son once dígitos iguales: no es un parecido.
    select c.*, 'CUIT'::text as motivo, 'fuerte'::text as fuerza, 1.0::real as parecido
      from customers c, entrada e
     where c.company_id = p_company and c.id is distinct from p_excluir
       and e.cuit is not null and length(e.cuit) = 11
       and regexp_replace(coalesce(c.tax_id, ''), '\D', '', 'g') = e.cuit

    union all
    -- MEDIA: el mismo email exacto, en el array de emails del cliente.
    select c.*, 'EMAIL', 'media', 1.0
      from customers c, entrada e
     where c.company_id = p_company and c.id is distinct from p_excluir
       and e.email is not null and c.emails @> array[e.email]

    union all
    -- MEDIA: el mismo teléfono, comparado por sus dígitos.
    select c.*, 'TELEFONO', 'media', 1.0
      from customers c, entrada e
     where c.company_id = p_company and c.id is distinct from p_excluir
       and e.tel is not null and length(e.tel) >= 6
       and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = e.tel

    union all
    -- DÉBIL: el nombre se parece. `%` y `<%` son los operadores que usan los
    -- índices GIN trigram; el umbral fino se aplica después.
    select c.*, 'NOMBRE', 'debil',
           greatest(similarity(c.legal_name, e.nombre),
                    similarity(coalesce(c.trade_name, ''), e.nombre),
                    word_similarity(e.nombre, c.legal_name),
                    word_similarity(e.nombre, coalesce(c.trade_name, '')))
      from customers c, entrada e
     where c.company_id = p_company and c.id is distinct from p_excluir
       and e.nombre is not null and length(e.nombre) >= 4
       and (c.legal_name % e.nombre or c.trade_name % e.nombre
            or e.nombre <% c.legal_name or e.nombre <% coalesce(c.trade_name, ''))
       and (
         greatest(similarity(c.legal_name, e.nombre),
                  similarity(coalesce(c.trade_name, ''), e.nombre)) >= 0.4
         or greatest(word_similarity(e.nombre, c.legal_name),
                     word_similarity(e.nombre, coalesce(c.trade_name, ''))) >= 0.7
       )
  ), mejor as (
    -- Un cliente que coincide por CUIT y por nombre es UN candidato, con el
    -- motivo más fuerte. Mostrarlo dos veces sería contarlo dos veces.
    select distinct on (id) *
      from candidatos
     order by id, case fuerza when 'fuerte' then 1 when 'media' then 2 else 3 end, parecido desc
  )
  select m.id, m.legal_name, m.trade_name, m.tax_id, m.legacy_ref,
         m.emails, m.phone, m.deleted_at, m.needs_review,
         m.motivo, m.fuerza, m.parecido
    from mejor m
   order by case m.fuerza when 'fuerte' then 1 when 'media' then 2 else 3 end,
            m.parecido desc, m.legal_name
   limit greatest(p_limite, 1);
$$;

revoke execute on function public.clientes_similares(uuid, text, text, text, text, uuid, int) from public, anon;
grant execute on function public.clientes_similares(uuid, text, text, text, text, uuid, int) to authenticated;

-- ── 2 · El alta, en UNA transacción ────────────────────────────────────────
-- Antes eran dos viajes desde el navegador: pedir la referencia CLI con
-- `next_document_number` y después insertar. Si el insert fallaba, **el número
-- quedaba consumido** y se perdía. Acá la numeración corre dentro de la misma
-- transacción: si algo falla, el contador vuelve atrás y no queda ningún hueco.
--
-- El contacto y la dirección son OPCIONALES y van en la misma transacción: o
-- entra el cliente con lo que se cargó, o no entra nada.
create or replace function public.crear_cliente(
  p_company uuid,
  p_datos jsonb,
  p_contacto jsonb default null,
  p_direccion jsonb default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k_cliente constant text[] := array[
    'legal_name', 'trade_name', 'tax_id', 'emails', 'email_domains', 'industry',
    'phone', 'customer_type', 'payment_terms', 'default_currency', 'notes',
    'salesperson_id', 'default_price_list_id'
  ];
  k_contacto constant text[] := array['full_name', 'role', 'email', 'phone', 'fax', 'notes'];
  k_direccion constant text[] := array[
    'kind', 'street', 'city', 'state', 'postal_code', 'country_code', 'notes'
  ];
  v_rol text; v_clave text; v_ref text; v_id uuid;
  v_contacto_id uuid; v_direccion_id uuid;
  n_legal text; n_tax text; n_type text; n_currency text;
  n_emails text[]; n_domains text[]; n_seller uuid; n_list uuid;
  v_digitos text; v_ok int;
  c_nombre text; d_tipo text; d_calle text; d_pais text;
  v_diff jsonb;
begin
  -- Permiso: los mismos roles que `customers_insert`.
  v_rol := app."current_role"(p_company);
  if v_rol is null or v_rol not in ('admin', 'employee', 'salesperson') then
    raise exception 'SIN_PERMISO';
  end if;

  -- Whitelist. `company_id`, `legacy_ref`, `needs_review`, `imported_at`,
  -- `legacy_source`, `status`… los pone el servidor o el importador: no se
  -- aceptan ni «por si acaso».
  for v_clave in select jsonb_object_keys(coalesce(p_datos, '{}'::jsonb)) loop
    if not (v_clave = any (k_cliente)) then
      raise exception 'CAMPO_NO_EDITABLE' using detail = v_clave;
    end if;
  end loop;
  for v_clave in select jsonb_object_keys(coalesce(p_contacto, '{}'::jsonb)) loop
    if not (v_clave = any (k_contacto)) then
      raise exception 'CAMPO_NO_EDITABLE' using detail = 'contacto.' || v_clave;
    end if;
  end loop;
  for v_clave in select jsonb_object_keys(coalesce(p_direccion, '{}'::jsonb)) loop
    if not (v_clave = any (k_direccion)) then
      raise exception 'CAMPO_NO_EDITABLE' using detail = 'direccion.' || v_clave;
    end if;
  end loop;

  n_legal := nullif(btrim(coalesce(p_datos->>'legal_name', '')), '');
  if n_legal is null then
    raise exception 'RAZON_SOCIAL_REQUERIDA';
  end if;

  n_type := coalesce(nullif(btrim(coalesce(p_datos->>'customer_type', '')), ''), 'business');
  if n_type not in ('business', 'individual') then
    raise exception 'TIPO_INVALIDO';
  end if;

  n_tax := nullif(btrim(coalesce(p_datos->>'tax_id', '')), '');
  v_digitos := regexp_replace(coalesce(n_tax, ''), '\D', '', 'g');
  -- El CUIT NO es obligatorio (decisión de E1). Si se informa, son 11 dígitos.
  if n_tax is not null and length(v_digitos) <> 11 then
    raise exception 'CUIT_INVALIDO';
  end if;

  n_currency := nullif(btrim(coalesce(p_datos->>'default_currency', '')), '');
  if n_currency is not null then
    select count(*) into v_ok from currencies where code = n_currency;
    if v_ok = 0 then raise exception 'MONEDA_INVALIDA'; end if;
  end if;

  n_seller := nullif(p_datos->>'salesperson_id', '')::uuid;
  if n_seller is not null then
    select count(*) into v_ok from company_memberships
     where company_id = p_company and user_id = n_seller and status = 'active'
       and role in ('admin', 'employee', 'salesperson');
    if v_ok = 0 then raise exception 'VENDEDOR_INVALIDO'; end if;
  end if;

  n_list := nullif(p_datos->>'default_price_list_id', '')::uuid;
  if n_list is not null then
    select count(*) into v_ok from price_lists
     where id = n_list and company_id = p_company;
    if v_ok = 0 then raise exception 'TARIFA_INVALIDA'; end if;
  end if;

  select coalesce(array_agg(distinct lower(btrim(e))) filter (where btrim(e) <> ''), '{}')
    into n_emails
    from jsonb_array_elements_text(coalesce(p_datos->'emails', '[]'::jsonb)) e;
  select coalesce(array_agg(distinct lower(btrim(d))) filter (where btrim(d) <> ''), '{}')
    into n_domains
    from jsonb_array_elements_text(coalesce(p_datos->'email_domains', '[]'::jsonb)) d;

  -- La referencia CLI, con el mismo mecanismo que numera todo lo demás. Va
  -- DENTRO de la transacción: si algo falla después, el contador vuelve atrás.
  v_ref := next_document_number(p_company, 'customer');

  begin
    insert into customers (
      company_id, legacy_ref, legal_name, trade_name, tax_id, emails,
      email_domains, industry, phone, customer_type, payment_terms,
      default_currency, notes, salesperson_id, default_price_list_id,
      status, created_by
    ) values (
      p_company, v_ref, n_legal,
      nullif(btrim(coalesce(p_datos->>'trade_name', '')), ''),
      n_tax, n_emails, n_domains,
      nullif(btrim(coalesce(p_datos->>'industry', '')), ''),
      nullif(btrim(coalesce(p_datos->>'phone', '')), ''),
      n_type,
      nullif(btrim(coalesce(p_datos->>'payment_terms', '')), ''),
      n_currency,
      nullif(btrim(coalesce(p_datos->>'notes', '')), ''),
      n_seller, n_list, 'active', auth.uid()
    ) returning id into v_id;
  exception when unique_violation then
    -- El índice único del CUIT normalizado. Es la última palabra: dos altas
    -- simultáneas con el mismo CUIT llegan hasta acá y una pierde.
    if sqlerrm like '%cuit_norm%' or sqlerrm like '%taxid%' then
      raise exception 'CLIENTE_DUPLICADO'
        using detail = 'Ya hay un cliente con ese CUIT en esta empresa.';
    end if;
    raise;
  end;

  -- El primer contacto. Nace principal porque es el primero: no hay otro al
  -- que pisarle la marca. Esta regla vale SÓLO acá; a los clientes que ya
  -- existen no se les marca ninguno solo (E3).
  if p_contacto is not null then
    c_nombre := nullif(btrim(coalesce(p_contacto->>'full_name', '')), '');
    if c_nombre is null then
      raise exception 'NOMBRE_REQUERIDO';
    end if;
    insert into customer_contacts (
      company_id, customer_id, full_name, role, email, phone, fax, notes,
      is_default, active
    ) values (
      p_company, v_id, c_nombre,
      nullif(btrim(coalesce(p_contacto->>'role', '')), ''),
      nullif(btrim(lower(coalesce(p_contacto->>'email', ''))), ''),
      nullif(btrim(coalesce(p_contacto->>'phone', '')), ''),
      nullif(btrim(coalesce(p_contacto->>'fax', '')), ''),
      nullif(btrim(coalesce(p_contacto->>'notes', '')), ''),
      true, true
    ) returning id into v_contacto_id;
  end if;

  -- La primera dirección, principal de su tipo por la misma razón.
  if p_direccion is not null then
    d_tipo := nullif(btrim(coalesce(p_direccion->>'kind', '')), '');
    if d_tipo is null or d_tipo not in ('billing', 'shipping', 'both', 'other') then
      raise exception 'TIPO_INVALIDO';
    end if;
    d_calle := nullif(btrim(coalesce(p_direccion->>'street', '')), '');
    if d_calle is null then
      raise exception 'CALLE_REQUERIDA';
    end if;
    d_pais := nullif(btrim(upper(coalesce(p_direccion->>'country_code', ''))), '');
    if d_pais is not null and length(d_pais) <> 2 then
      raise exception 'PAIS_INVALIDO' using detail = 'Son dos letras: AR, UY, BR…';
    end if;
    insert into customer_addresses (
      company_id, customer_id, kind, street, city, state, postal_code,
      country_code, notes, is_default, active
    ) values (
      p_company, v_id, d_tipo, d_calle,
      nullif(btrim(coalesce(p_direccion->>'city', '')), ''),
      nullif(btrim(coalesce(p_direccion->>'state', '')), ''),
      nullif(btrim(coalesce(p_direccion->>'postal_code', '')), ''),
      d_pais,
      nullif(btrim(coalesce(p_direccion->>'notes', '')), ''),
      true, true
    ) returning id into v_direccion_id;
  end if;

  -- Auditoría: UN evento. El alta es un solo acto, aunque escriba en tres
  -- tablas. El trigger de E1 ya registró `created`; acá se completa ESE evento
  -- con lo que se creó junto, en vez de agregar dos más que dirían lo mismo
  -- con menos contexto.
  v_diff := jsonb_strip_nulls(jsonb_build_object(
    'referencia', v_ref,
    'contacto', c_nombre,
    'direccion', d_calle,
    'tipo_direccion', d_tipo
  ));
  update sales_audit
     set diff = coalesce(diff, '{}'::jsonb) || v_diff
   where entity_type = 'customer' and entity_id = v_id and action = 'created';

  return jsonb_build_object(
    'id', v_id,
    'referencia', v_ref,
    'contacto_id', v_contacto_id,
    'direccion_id', v_direccion_id
  );
end $$;

revoke execute on function public.crear_cliente(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.crear_cliente(uuid, jsonb, jsonb, jsonb) to authenticated;

-- ── 3 · Resolver una revisión deja rastro ──────────────────────────────────
-- La función ya validaba rol y empresa, y su lógica de motivos está bien: se
-- conserva. Lo que le faltaba es lo que pide el negocio —**qué motivo se dio
-- por revisado, quién y cuándo**— y el contrato de `sin_cambios` del resto del
-- módulo. Sin auditoría, la cola es una lista que se vacía sin explicación.
--
-- Lo que NO hace, a propósito: tocar la identidad de un cliente importado.
-- `legacy_ref`, `legacy_source` e `imported_at` quedan como están.
create or replace function public.resolver_revision_cliente(
  p_customer uuid,
  p_motivos text[] default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid;
  v_reason  text;
  v_rol     text;
  v_quedan  text[] := '{}';
  v_resueltos text[] := '{}';
  m         text;
begin
  select company_id, review_reason into v_company, v_reason
    from customers where id = p_customer;
  if not found then
    raise exception 'El cliente no existe' using errcode = 'no_data_found';
  end if;

  v_rol := app."current_role"(v_company);
  if v_rol is null or v_rol not in ('admin', 'employee') then
    raise exception 'No tenés permiso para resolver la revisión de este cliente'
      using errcode = 'insufficient_privilege';
  end if;

  -- Sin motivos, se dan por revisados todos. Con la lista, sólo ésos.
  foreach m in array string_to_array(coalesce(v_reason, ''), ' | ') loop
    m := btrim(m);
    if m = '' then continue; end if;
    if p_motivos is not null and not (m = any (p_motivos)) then
      v_quedan := v_quedan || m;
    else
      v_resueltos := v_resueltos || m;
    end if;
  end loop;

  if array_length(v_resueltos, 1) is null then
    return jsonb_build_object(
      'customer_id', p_customer,
      'motivos_restantes', to_jsonb(coalesce(v_quedan, '{}'::text[])),
      'resueltos', to_jsonb('{}'::text[]),
      'sin_cambios', true
    );
  end if;

  perform set_config('app.resolucion_explicita', p_customer::text, true);
  update customers
     set review_reason = nullif(array_to_string(v_quedan, ' | '), '')
   where id = p_customer;
  perform set_config('app.resolucion_explicita', '', true);

  -- El motivo se conserva acá aunque se borre de la ficha: para eso está la
  -- auditoría.
  insert into sales_audit (company_id, entity_type, entity_id, action, diff, actor_id)
  values (v_company, 'customer', p_customer, 'review_resolved',
          jsonb_build_object(
            'resueltos', to_jsonb(v_resueltos),
            'restantes', to_jsonb(coalesce(v_quedan, '{}'::text[]))
          ),
          auth.uid());

  return jsonb_build_object(
    'customer_id', p_customer,
    'motivos_restantes', to_jsonb(coalesce(v_quedan, '{}'::text[])),
    'resueltos', to_jsonb(v_resueltos),
    'sin_cambios', false
  );
end $$;

revoke execute on function public.resolver_revision_cliente(uuid, text[]) from public, anon;
grant execute on function public.resolver_revision_cliente(uuid, text[]) to authenticated;

commit;

-- ============================================================================
-- ROLLBACK
--
-- El alta vuelve a ser dos pasos desde el navegador —con su hueco de
-- referencia— y el aviso de duplicados desaparece. Los clientes creados con la
-- RPC quedan: son clientes normales, con su contacto y su dirección.
-- ============================================================================
-- begin;
--
-- drop function if exists public.crear_cliente(uuid, jsonb, jsonb, jsonb);
-- drop function if exists public.clientes_similares(uuid, text, text, text, text, uuid, int);
-- drop index if exists idx_customers_phone_norm;
--
-- -- `resolver_revision_cliente` vuelve a su versión de E0: misma lógica, sin
-- -- auditoría y sin el contrato de `sin_cambios`. Los eventos `review_resolved`
-- -- que ya se escribieron quedan: son historia, no esquema.
--
-- commit;
