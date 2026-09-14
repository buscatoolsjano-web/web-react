-- ===========================================================================
-- FASE 12 · CONFIGURACIÓN — ENTREGA 2 · empresa, logo y numeración (sólo lectura)
-- ===========================================================================
--
-- Migraciones (en este orden):
--   fase12_configuracion_entrega2_empresa_numeracion   primera versión
--   fase12_configuracion_entrega2_correcciones         versión DEFINITIVA de las
--     funciones: array_append (el `||` con literal fallaba), conflicto_version sin
--     errcode especial y diagnóstico con `number_outlier` en vez de `needs_review`.
-- Este archivo refleja el estado final.
--
-- 1. `company_audit`: COMPANY_UPDATED / COMPANY_LOGO_UPDATED / COMPANY_LOGO_REMOVED
--    con actor, empresa, NOMBRES de los campos cambiados y fecha. Sin valores,
--    sin imágenes.
-- 2. `companies` deja de aceptar UPDATE directo de authenticated: la policy
--    `companies_update` dejaba a un admin cambiar por REST `slug`, `is_active`
--    y `default_currency`. Se edita sólo con `config_empresa_actualizar`
--    (lista blanca + concurrencia optimista por `updated_at`) y el logo sólo
--    desde la Edge Function `config-empresa-logo`.
-- 3. `document_sequences`: se revocan los privilegios de tabla de anon y
--    authenticated (la RLS ya lo negaba todo: defensa en profundidad).
--    `next_document_number` (SECURITY DEFINER) no cambia. NO se toca ningún
--    valor de secuencia.
-- 4. Bucket privado `empresa-logos` (2 MB, PNG/JPEG/WEBP). Lectura: miembros
--    activos de la empresa (para URL firmada). Escritura: sólo service_role,
--    desde la Edge Function, que valida bytes, tamaño, rol y versión.
-- 5. `config_numeracion_diagnostico`: lectura de cada secuencia contra los
--    documentos existentes. No escribe, no genera números.
-- ===========================================================================

-- 1 · Bitácora de empresa ------------------------------------------------------
create table public.company_audit (
  id             bigint generated always as identity primary key,
  company_id     uuid not null references public.companies(id) on delete cascade,
  action         text not null check (action in ('COMPANY_UPDATED', 'COMPANY_LOGO_UPDATED', 'COMPANY_LOGO_REMOVED')),
  changed_fields text[] not null,
  actor_id       uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index idx_company_audit_empresa on public.company_audit (company_id, created_at desc);
alter table public.company_audit enable row level security;
create policy company_audit_select on public.company_audit
  for select to authenticated using (app.is_admin(company_id));
revoke all on public.company_audit from anon, authenticated;
grant select on public.company_audit to authenticated;

-- 2 · companies sin escritura directa ------------------------------------------
drop policy if exists companies_update on public.companies;
revoke all on public.companies from anon;
revoke insert, update, delete, truncate, references, trigger on public.companies from authenticated;

-- 3 · document_sequences sin privilegios de tabla para el cliente -------------
revoke all on public.document_sequences from anon, authenticated;

-- 4 · Bucket de logos ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('empresa-logos', 'empresa-logos', false, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- Sólo lectura, para miembros activos de la empresa dueña de la carpeta. Sin
-- policies de INSERT/UPDATE/DELETE: con la RLS de storage eso es denegar.
create policy empresa_logos_select on storage.objects
  for select to authenticated
  using (bucket_id = 'empresa-logos'
         and (storage.foldername(name))[1] in (select unnest(app.current_company_ids())::text));

-- 5 · RPC de empresa ---------------------------------------------------------
create or replace function public.config_empresa_obtener(p_company uuid)
returns table (
  id               uuid,
  slug             text,
  name             text,
  legal_name       text,
  tax_id           text,
  address          text,
  phone            text,
  email            text,
  website          text,
  brand_color      text,
  default_currency text,
  is_active        boolean,
  logo_path        text,
  updated_at       timestamptz,
  puede_editar     boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol text := app.current_role(p_company);
begin
  if p_company is null or v_rol is null or v_rol not in ('admin', 'employee') then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;
  return query
  select c.id, c.slug, c.name, c.legal_name, c.tax_id, c.address, c.phone, c.email, c.website,
         c.brand_color, c.default_currency, c.is_active, c.logo_path, c.updated_at, v_rol = 'admin'
    from companies c where c.id = p_company;
end
$$;

-- Normaliza un valor del JSON: string recortado, '' → null; cualquier otro tipo
-- que no sea string o null es inválido.
create or replace function app.config_texto(p_datos jsonb, p_campo text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_tipo text := jsonb_typeof(p_datos -> p_campo);
begin
  if v_tipo = 'null' then
    return null;
  elsif v_tipo <> 'string' then
    raise exception 'datos_invalidos:%', p_campo using errcode = 'invalid_parameter_value';
  end if;
  return nullif(btrim(p_datos ->> p_campo), '');
end
$$;
revoke all on function app.config_texto(jsonb, text) from public, anon, authenticated;

create or replace function public.config_empresa_actualizar(p_company uuid, p_esperado timestamptz, p_datos jsonb)
returns table (updated_at timestamptz, campos text[])
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_permitidos constant text[] := array['name', 'legal_name', 'tax_id', 'address', 'phone', 'email', 'website', 'brand_color'];
  v_c         companies%rowtype;
  v_extra     text;
  v_campos    text[] := '{}';
  v_name      text;
  v_legal     text;
  v_tax       text;
  v_address   text;
  v_phone     text;
  v_email     text;
  v_website   text;
  v_color     text;
begin
  if p_company is null or not coalesce(app.is_admin(p_company), false) then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'datos_invalidos' using errcode = 'invalid_parameter_value';
  end if;
  select k into v_extra from jsonb_object_keys(p_datos) k where k <> all (v_permitidos) limit 1;
  if v_extra is not null then
    raise exception 'campos_no_permitidos:%', v_extra using errcode = 'invalid_parameter_value';
  end if;
  if p_esperado is null then
    raise exception 'conflicto_version';
  end if;

  select * into v_c from companies c where c.id = p_company for update;
  if v_c.updated_at <> p_esperado then
    raise exception 'conflicto_version';
  end if;

  -- Sólo se validan los campos que llegan: un dato histórico que no cumpla una
  -- regla nueva no bloquea la edición de los demás.
  v_name := v_c.name; v_legal := v_c.legal_name; v_tax := v_c.tax_id; v_address := v_c.address;
  v_phone := v_c.phone; v_email := v_c.email; v_website := v_c.website; v_color := v_c.brand_color;

  if p_datos ? 'name' then
    v_name := app.config_texto(p_datos, 'name');
    if v_name is null or length(v_name) > 120 then raise exception 'datos_invalidos:name' using errcode = 'invalid_parameter_value'; end if;
  end if;
  if p_datos ? 'legal_name' then
    v_legal := app.config_texto(p_datos, 'legal_name');
    if length(v_legal) > 200 then raise exception 'datos_invalidos:legal_name' using errcode = 'invalid_parameter_value'; end if;
  end if;
  if p_datos ? 'tax_id' then
    v_tax := app.config_texto(p_datos, 'tax_id');
    if v_tax is not null and v_tax !~ '^[A-Za-z0-9][A-Za-z0-9./ -]{1,29}$' then
      raise exception 'datos_invalidos:tax_id' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  if p_datos ? 'address' then
    v_address := app.config_texto(p_datos, 'address');
    if length(v_address) > 300 then raise exception 'datos_invalidos:address' using errcode = 'invalid_parameter_value'; end if;
  end if;
  if p_datos ? 'phone' then
    v_phone := app.config_texto(p_datos, 'phone');
    if v_phone is not null and v_phone !~ '^[0-9+() ./-]{4,50}$' then
      raise exception 'datos_invalidos:phone' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  if p_datos ? 'email' then
    v_email := lower(app.config_texto(p_datos, 'email'));
    if v_email is not null and (length(v_email) > 254 or v_email !~ '^[a-z0-9._%+''-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$') then
      raise exception 'datos_invalidos:email' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  if p_datos ? 'website' then
    v_website := app.config_texto(p_datos, 'website');
    if v_website is not null and (length(v_website) > 200 or v_website !~* '^(https?://)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(/[^\s]*)?$') then
      raise exception 'datos_invalidos:website' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  if p_datos ? 'brand_color' then
    v_color := upper(app.config_texto(p_datos, 'brand_color'));
    if v_color is not null and v_color !~ '^#[0-9A-F]{6}$' then
      raise exception 'datos_invalidos:brand_color' using errcode = 'invalid_parameter_value';
    end if;
  end if;

  if v_name    is distinct from v_c.name        then v_campos := array_append(v_campos, 'name'); end if;
  if v_legal   is distinct from v_c.legal_name  then v_campos := array_append(v_campos, 'legal_name'); end if;
  if v_tax     is distinct from v_c.tax_id      then v_campos := array_append(v_campos, 'tax_id'); end if;
  if v_address is distinct from v_c.address     then v_campos := array_append(v_campos, 'address'); end if;
  if v_phone   is distinct from v_c.phone       then v_campos := array_append(v_campos, 'phone'); end if;
  if v_email   is distinct from v_c.email       then v_campos := array_append(v_campos, 'email'); end if;
  if v_website is distinct from v_c.website     then v_campos := array_append(v_campos, 'website'); end if;
  if v_color   is distinct from v_c.brand_color then v_campos := array_append(v_campos, 'brand_color'); end if;

  if cardinality(v_campos) = 0 then
    return query select v_c.updated_at, v_campos;
    return;
  end if;

  update companies c
     set name = v_name, legal_name = v_legal, tax_id = v_tax, address = v_address,
         phone = v_phone, email = v_email, website = v_website, brand_color = v_color
   where c.id = p_company;

  insert into company_audit (company_id, action, changed_fields, actor_id)
  values (p_company, 'COMPANY_UPDATED', v_campos, auth.uid());

  return query select c.updated_at, v_campos from companies c where c.id = p_company;
end
$$;

revoke all on function public.config_empresa_obtener(uuid) from public, anon;
revoke all on function public.config_empresa_actualizar(uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.config_empresa_obtener(uuid) to authenticated;
grant execute on function public.config_empresa_actualizar(uuid, timestamptz, jsonb) to authenticated;

-- 6 · Logo: sólo service_role (Edge Function config-empresa-logo) -----------------
create or replace function public.config_empresa_logo_precheck(p_actor uuid, p_company uuid, p_esperado timestamptz)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_c companies%rowtype;
begin
  if p_actor is null or p_company is null or not app.es_admin_activo(p_actor, p_company) then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;
  select * into v_c from companies c where c.id = p_company;
  if p_esperado is null or v_c.updated_at <> p_esperado then
    raise exception 'conflicto_version';
  end if;
  return v_c.logo_path;
end
$$;

create or replace function public.config_empresa_logo_registrar(p_actor uuid, p_company uuid, p_esperado timestamptz, p_path text)
returns table (updated_at timestamptz, logo_anterior text, logo_path text)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_c companies%rowtype;
begin
  if p_actor is null or p_company is null or not app.es_admin_activo(p_actor, p_company) then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;
  if p_path is not null and p_path !~ ('^' || p_company::text || '/logo-[0-9]{13}\.(png|jpg|webp)$') then
    raise exception 'ruta_invalida' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_c from companies c where c.id = p_company for update;
  if p_esperado is null or v_c.updated_at <> p_esperado then
    raise exception 'conflicto_version';
  end if;

  update companies c set logo_path = p_path where c.id = p_company;
  insert into company_audit (company_id, action, changed_fields, actor_id)
  values (p_company, case when p_path is null then 'COMPANY_LOGO_REMOVED' else 'COMPANY_LOGO_UPDATED' end,
          array['logo_path'], p_actor);

  return query select c.updated_at, v_c.logo_path, c.logo_path from companies c where c.id = p_company;
end
$$;

revoke all on function public.config_empresa_logo_precheck(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.config_empresa_logo_registrar(uuid, uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.config_empresa_logo_precheck(uuid, uuid, timestamptz) to service_role;
grant execute on function public.config_empresa_logo_registrar(uuid, uuid, timestamptz, text) to service_role;

-- 7 · Numeración: diagnóstico de sólo lectura ------------------------------------
-- «Atípico» = number_outlier del import (cotizaciones, pedidos, remitos): números
-- mal tipeados en el legacy (p. ej. PDV11292). No cuentan para el estado, pero
-- se informan. `needs_review` NO se usa: marca problemas que no son de numeración.
-- Autoridad = ESTADO OPERATIVO al 2026-09-14 (no hay columna que lo registre):
-- STEL Order numera cotizaciones, pedidos y remitos de Buscatools; el resto lo
-- numera el ERP. Cambiarlo es una decisión de cutover, no un dato editable.
drop function if exists public.config_numeracion_diagnostico(uuid);
create or replace function public.config_numeracion_diagnostico(p_company uuid)
returns table (
  doc_type                 text,
  series_code              text,
  prefix                   text,
  padding                  integer,
  is_default               boolean,
  next_number              bigint,
  proximo                  text,
  documentos               bigint,
  con_patron               bigint,
  fuera_patron             bigint,
  max_numero               bigint,
  max_numero_sin_atipicos  bigint,
  atipicos_por_encima      bigint,
  estado                   text,
  autoridad                text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol  text := app.current_role(p_company);
  v_slug text;
begin
  if p_company is null or v_rol is null or v_rol not in ('admin', 'employee') then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;
  select c.slug into v_slug from companies c where c.id = p_company;

  return query
  with docs as (
    select 'quote'::text t, q.number n, coalesce(q.number_outlier, false) r from sales_quotes q where q.company_id = p_company
    union all select 'sales_order', o.number, coalesce(o.number_outlier, false) from sales_orders o where o.company_id = p_company
    union all select 'delivery', d.number, coalesce(d.number_outlier, false) from deliveries d where d.company_id = p_company
    union all select 'customer', cu.legacy_ref, false from customers cu where cu.company_id = p_company
    union all select 'supplier', su.legacy_ref, false from suppliers su where su.company_id = p_company
    union all select 'purchase_order', po.number, false from purchase_orders po where po.company_id = p_company
    union all select 'goods_receipt', gr.number, false from goods_receipts gr where gr.company_id = p_company
    union all select 'supplier_invoice', si.number, false from supplier_invoices si where si.company_id = p_company
    union all select 'maintenance_asset', ma.reference, false from maintenance_assets ma where ma.company_id = p_company
    union all select 'maintenance_order', mo.number, false from maintenance_orders mo where mo.company_id = p_company
  ),
  medida as (
    select s.doc_type, s.series_code, s.prefix, s.padding, s.is_default, s.next_number,
           (select count(*) from docs d where d.t = s.doc_type) as documentos,
           (select count(*) from docs d where d.t = s.doc_type and d.n ~ ('^' || s.prefix || '[0-9]{1,18}$')) as con_patron,
           (select count(*) from docs d where d.t = s.doc_type and d.n is not null and d.n !~ ('^' || s.prefix || '[0-9]{1,18}$')) as fuera_patron,
           (select max(substring(d.n from length(s.prefix) + 1)::bigint) from docs d
             where d.t = s.doc_type and d.n ~ ('^' || s.prefix || '[0-9]{1,18}$')) as max_numero,
           (select max(substring(d.n from length(s.prefix) + 1)::bigint) from docs d
             where d.t = s.doc_type and not d.r and d.n ~ ('^' || s.prefix || '[0-9]{1,18}$')) as max_confiable,
           (select count(*) from docs d where d.t = s.doc_type and d.r and d.n ~ ('^' || s.prefix || '[0-9]{1,18}$')
               and substring(d.n from length(s.prefix) + 1)::bigint >= s.next_number) as atipicos_encima,
           s.doc_type in ('quote', 'sales_order', 'delivery', 'customer', 'supplier', 'purchase_order',
                          'goods_receipt', 'supplier_invoice', 'maintenance_asset', 'maintenance_order') as mapeado
      from document_sequences s
     where s.company_id = p_company
  )
  select m.doc_type, m.series_code, m.prefix, m.padding, m.is_default, m.next_number,
         m.prefix || lpad(m.next_number::text, m.padding, '0'),
         m.documentos, m.con_patron, m.fuera_patron, m.max_numero, m.max_confiable, m.atipicos_encima,
         case
           when not m.mapeado then 'UNKNOWN'
           when m.max_confiable is null then 'SIN_DOCUMENTOS'
           when m.next_number <= m.max_confiable then 'BEHIND'
           when m.next_number = m.max_confiable + 1 then 'OK'
           else 'AHEAD'
         end,
         case when v_slug = 'buscatools' and m.doc_type in ('quote', 'sales_order', 'delivery') then 'STEL' else 'ERP' end
    from medida m
   order by m.doc_type, m.series_code;
end
$$;

revoke all on function public.config_numeracion_diagnostico(uuid) from public, anon;
grant execute on function public.config_numeracion_diagnostico(uuid) to authenticated;
