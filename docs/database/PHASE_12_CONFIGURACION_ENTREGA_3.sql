-- =============================================================================
-- Fase 12 · Configuración · Entrega 3 — Listas de precios, marcas, categorías y
-- atributos.
--
-- Autoridad (ver docs/PHASE_12_CONFIGURACION_ENTREGA_3_LISTAS_MAESTROS.md §A):
--   · productos ............ STEL / legacy → no se tocan
--   · listas y precios ..... NO DETERMINADO (U-B-2) → sólo lectura
--   · atributos ............ estructura del ERP atada a products.attributes → sólo lectura
--   · marcas ............... catálogo auxiliar: crear, activar/desactivar, borrar si no se usa
--                            (NO renombrar: la ingesta empareja por nombre)
--   · categorías ........... taxonomía del ERP: crear, renombrar (el slug no cambia),
--                            borrar si no se usa
--
-- Qué NO hace: no modifica filas de productos, precios, listas, atributos,
-- marcas ni categorías existentes; no toca secuencias ni la autoridad de E2.5.
--
-- Aplicada como migración `fase12_config_e3_maestros`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Escritura directa cerrada
--
-- Hasta ahora un admin podía escribir por REST marcas, categorías, atributos y
-- listas con cualquier columna, y admin + employee los precios. Ninguna
-- pantalla lo usaba. Desde esta entrega: marcas y categorías sólo por las RPC
-- de abajo (lista blanca + bitácora); listas, precios y atributos no se
-- escriben desde la app. La importación (service role) no cambia.
-- -----------------------------------------------------------------------------
drop policy if exists brands_write on public.brands;
drop policy if exists categories_write on public.product_categories;
drop policy if exists attrdefs_write on public.product_attribute_definitions;
drop policy if exists pac_write on public.product_attribute_categories;
drop policy if exists pricelists_write on public.price_lists;
drop policy if exists prices_write on public.product_prices;

revoke insert, update, delete, truncate, references, trigger
  on public.brands, public.product_categories, public.product_attribute_definitions,
     public.product_attribute_categories, public.price_lists, public.product_prices
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Bitácora de administración del catálogo
--
-- Mismo patrón que company_audit (E2): acción cerrada, nombres de campos, actor.
-- entity_name guarda el nombre al momento del hecho (la fila puede borrarse).
-- No se registra ninguna lectura.
-- -----------------------------------------------------------------------------
create table public.catalog_audit (
  id             bigint generated always as identity primary key,
  company_id     uuid        not null references public.companies (id) on delete cascade,
  entity_type    text        not null check (entity_type in ('brand', 'category')),
  entity_id      uuid        not null,
  entity_name    text        not null,
  action         text        not null check (action in (
                   'BRAND_CREATED', 'BRAND_DISABLED', 'BRAND_ENABLED', 'BRAND_DELETED',
                   'CATEGORY_CREATED', 'CATEGORY_UPDATED', 'CATEGORY_DELETED')),
  changed_fields text[]      not null default '{}',
  actor_id       uuid                 references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);

create index idx_catalog_audit_company on public.catalog_audit (company_id, created_at desc);

alter table public.catalog_audit enable row level security;
revoke all on public.catalog_audit from public, anon, authenticated;
grant select on public.catalog_audit to authenticated;
create policy catalog_audit_select on public.catalog_audit
  for select to authenticated using (app.is_admin(company_id));

-- -----------------------------------------------------------------------------
-- 3. Helpers
-- -----------------------------------------------------------------------------

-- trim + espacios internos colapsados. No cambia mayúsculas ni acentos.
create or replace function app.catalogo_nombre(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$ select nullif(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'), '') $$;

-- Slug para categorías nuevas (las existentes no se tocan).
create or replace function app.catalogo_slug(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(nullif(btrim(regexp_replace(
           lower(translate(coalesce(p, ''), 'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑáàäâéèëêíìïîóòöôúùüûñ',
                                            'AAAAEEEEIIIIOOOOUUUUNaaaaeeeeiiiioooouuuun')),
           '[^a-z0-9]+', '-', 'g'), '-'), ''), 'categoria')
$$;

-- Lista blanca de claves de un objeto JSON.
create or replace function app.catalogo_exigir_campos(p_datos jsonb, p_permitidos text[])
returns void
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare v_extra text;
begin
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'datos_invalidos' using errcode = 'invalid_parameter_value';
  end if;
  select k into v_extra from jsonb_object_keys(p_datos) k where k <> all (p_permitidos) limit 1;
  if v_extra is not null then
    raise exception 'campos_no_permitidos:%', v_extra using errcode = 'invalid_parameter_value';
  end if;
end $$;

create or replace function app.catalogo_exigir_lector(p_company uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_rol text := app.current_role(p_company);
begin
  if p_company is null or v_rol is null or v_rol not in ('admin', 'employee') then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;
  return v_rol;
end $$;

create or replace function app.catalogo_exigir_admin(p_company uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_company is null or not coalesce(app.is_admin(p_company), false) then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;
end $$;

revoke all on function app.catalogo_nombre(text), app.catalogo_slug(text),
  app.catalogo_exigir_campos(jsonb, text[]), app.catalogo_exigir_lector(uuid),
  app.catalogo_exigir_admin(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Marcas
-- -----------------------------------------------------------------------------
create or replace function public.config_marcas_listar(p_company uuid)
returns table (id uuid, name text, is_active boolean, created_at timestamptz,
               productos bigint, equipos bigint, puede_editar boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_rol text := app.catalogo_exigir_lector(p_company);
begin
  return query
  with usos as (
    select p.brand_id, count(*) n from products p
     where p.company_id = p_company and p.brand_id is not null group by p.brand_id
  ), eq as (
    select m.brand_id, count(*) n from maintenance_assets m
     where m.company_id = p_company and m.brand_id is not null group by m.brand_id
  )
  select b.id, b.name, b.is_active, b.created_at,
         coalesce(u.n, 0), coalesce(e.n, 0), v_rol = 'admin'
    from brands b
    left join usos u on u.brand_id = b.id
    left join eq e on e.brand_id = b.id
   where b.company_id = p_company
   order by lower(b.name);
end $$;

create or replace function public.config_marca_crear(p_company uuid, p_datos jsonb)
returns table (id uuid, name text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_name text; v_id uuid;
begin
  perform app.catalogo_exigir_admin(p_company);
  perform app.catalogo_exigir_campos(p_datos, array['name']);
  if not (p_datos ? 'name') then
    raise exception 'datos_invalidos:name' using errcode = 'invalid_parameter_value';
  end if;
  v_name := app.catalogo_nombre(app.config_texto(p_datos, 'name'));
  if v_name is null or length(v_name) > 80 then
    raise exception 'datos_invalidos:name' using errcode = 'invalid_parameter_value';
  end if;

  -- Serializa las altas de marcas de la empresa: dos altas iguales a la vez no
  -- pasan las dos el chequeo de duplicado.
  perform pg_advisory_xact_lock(hashtextextended('catalogo:marca:' || p_company::text, 0));
  if exists (select 1 from brands b where b.company_id = p_company
               and lower(app.catalogo_nombre(b.name)) = lower(v_name)) then
    raise exception 'nombre_duplicado';
  end if;

  insert into brands (company_id, name) values (p_company, v_name) returning brands.id into v_id;
  insert into catalog_audit (company_id, entity_type, entity_id, entity_name, action, changed_fields, actor_id)
  values (p_company, 'brand', v_id, v_name, 'BRAND_CREATED', array['name'], auth.uid());

  return query select v_id, v_name;
end $$;

create or replace function public.config_marca_estado(p_company uuid, p_marca uuid, p_activa boolean)
returns table (is_active boolean, cambiado boolean, productos bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_b brands%rowtype; v_n bigint;
begin
  perform app.catalogo_exigir_admin(p_company);
  if p_marca is null or p_activa is null then
    raise exception 'datos_invalidos' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_b from brands b where b.id = p_marca and b.company_id = p_company for update;
  if not found then
    raise exception 'no_encontrado' using errcode = 'no_data_found';
  end if;
  select count(*) into v_n from products p where p.brand_id = p_marca;

  if v_b.is_active = p_activa then
    return query select v_b.is_active, false, v_n;
    return;
  end if;

  update brands b set is_active = p_activa where b.id = p_marca;
  insert into catalog_audit (company_id, entity_type, entity_id, entity_name, action, changed_fields, actor_id)
  values (p_company, 'brand', p_marca, v_b.name,
          case when p_activa then 'BRAND_ENABLED' else 'BRAND_DISABLED' end,
          array['is_active'], auth.uid());
  return query select p_activa, true, v_n;
end $$;

create or replace function public.config_marca_eliminar(p_company uuid, p_marca uuid)
returns table (eliminada boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_b brands%rowtype; v_prod bigint; v_eq bigint;
begin
  perform app.catalogo_exigir_admin(p_company);
  if p_marca is null then
    raise exception 'datos_invalidos' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_b from brands b where b.id = p_marca and b.company_id = p_company for update;
  if not found then
    raise exception 'no_encontrado' using errcode = 'no_data_found';
  end if;
  -- Todas las referencias, incluidos productos dados de baja: una marca con
  -- historia no se borra, se desactiva.
  select count(*) into v_prod from products p where p.brand_id = p_marca;
  select count(*) into v_eq from maintenance_assets m where m.brand_id = p_marca;
  if v_prod > 0 or v_eq > 0 then
    raise exception 'en_uso:%:%', v_prod, v_eq;
  end if;

  delete from brands b where b.id = p_marca;
  insert into catalog_audit (company_id, entity_type, entity_id, entity_name, action, changed_fields, actor_id)
  values (p_company, 'brand', p_marca, v_b.name, 'BRAND_DELETED', '{}', auth.uid());
  return query select true;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Categorías
-- -----------------------------------------------------------------------------
create or replace function public.config_categorias_listar(p_company uuid)
returns table (id uuid, name text, slug text, "position" smallint, needs_review boolean,
               parent_id uuid, productos bigint, atributos bigint, subcategorias bigint,
               puede_editar boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_rol text := app.catalogo_exigir_lector(p_company);
begin
  return query
  with usos as (
    select p.category_id, count(*) n from products p where p.company_id = p_company group by p.category_id
  ), attrs as (
    select x.category_id, count(*) n from product_attribute_categories x where x.company_id = p_company group by x.category_id
  )
  select c.id, c.name, c.slug, c.position, c.needs_review, c.parent_id,
         coalesce(u.n, 0), coalesce(a.n, 0),
         (select count(*) from product_categories h where h.parent_id = c.id),
         v_rol = 'admin'
    from product_categories c
    left join usos u on u.category_id = c.id
    left join attrs a on a.category_id = c.id
   where c.company_id = p_company
   order by c.position, lower(c.name);
end $$;

create or replace function public.config_categoria_crear(p_company uuid, p_datos jsonb)
returns table (id uuid, name text, slug text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_name text; v_base text; v_slug text; v_i int := 1; v_id uuid; v_pos smallint;
begin
  perform app.catalogo_exigir_admin(p_company);
  perform app.catalogo_exigir_campos(p_datos, array['name']);
  if not (p_datos ? 'name') then
    raise exception 'datos_invalidos:name' using errcode = 'invalid_parameter_value';
  end if;
  v_name := app.catalogo_nombre(app.config_texto(p_datos, 'name'));
  if v_name is null or length(v_name) > 80 then
    raise exception 'datos_invalidos:name' using errcode = 'invalid_parameter_value';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('catalogo:categoria:' || p_company::text, 0));
  if exists (select 1 from product_categories c where c.company_id = p_company
               and lower(app.catalogo_nombre(c.name)) = lower(v_name)) then
    raise exception 'nombre_duplicado';
  end if;

  v_base := left(app.catalogo_slug(v_name), 60);
  v_slug := v_base;
  while exists (select 1 from product_categories c where c.company_id = p_company and c.slug = v_slug) loop
    v_i := v_i + 1;
    v_slug := v_base || '-' || v_i;
  end loop;

  select coalesce(max(c.position), 0) + 1 into v_pos from product_categories c where c.company_id = p_company;

  insert into product_categories (company_id, name, slug, position)
  values (p_company, v_name, v_slug, v_pos)
  returning product_categories.id into v_id;

  insert into catalog_audit (company_id, entity_type, entity_id, entity_name, action, changed_fields, actor_id)
  values (p_company, 'category', v_id, v_name, 'CATEGORY_CREATED', array['name', 'slug'], auth.uid());

  return query select v_id, v_name, v_slug;
end $$;

-- Renombrar: sólo `name`. El slug es la clave de la importación y no cambia.
-- p_esperado = nombre que se leyó: si otro admin lo cambió antes, conflicto.
create or replace function public.config_categoria_renombrar(p_company uuid, p_categoria uuid, p_esperado text, p_datos jsonb)
returns table (name text, cambiado boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_c product_categories%rowtype; v_name text;
begin
  perform app.catalogo_exigir_admin(p_company);
  perform app.catalogo_exigir_campos(p_datos, array['name']);
  if p_categoria is null or not (p_datos ? 'name') then
    raise exception 'datos_invalidos:name' using errcode = 'invalid_parameter_value';
  end if;
  v_name := app.catalogo_nombre(app.config_texto(p_datos, 'name'));
  if v_name is null or length(v_name) > 80 then
    raise exception 'datos_invalidos:name' using errcode = 'invalid_parameter_value';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('catalogo:categoria:' || p_company::text, 0));
  select * into v_c from product_categories c where c.id = p_categoria and c.company_id = p_company for update;
  if not found then
    raise exception 'no_encontrado' using errcode = 'no_data_found';
  end if;
  if p_esperado is null or v_c.name is distinct from p_esperado then
    raise exception 'conflicto_version';
  end if;
  if v_name = v_c.name then
    return query select v_c.name, false;
    return;
  end if;
  if exists (select 1 from product_categories c where c.company_id = p_company and c.id <> p_categoria
               and lower(app.catalogo_nombre(c.name)) = lower(v_name)) then
    raise exception 'nombre_duplicado';
  end if;

  update product_categories c set name = v_name where c.id = p_categoria;
  insert into catalog_audit (company_id, entity_type, entity_id, entity_name, action, changed_fields, actor_id)
  values (p_company, 'category', p_categoria, v_name, 'CATEGORY_UPDATED', array['name'], auth.uid());
  return query select v_name, true;
end $$;

create or replace function public.config_categoria_eliminar(p_company uuid, p_categoria uuid)
returns table (eliminada boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_c product_categories%rowtype; v_prod bigint; v_attr bigint; v_hijas bigint;
begin
  perform app.catalogo_exigir_admin(p_company);
  if p_categoria is null then
    raise exception 'datos_invalidos' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_c from product_categories c where c.id = p_categoria and c.company_id = p_company for update;
  if not found then
    raise exception 'no_encontrado' using errcode = 'no_data_found';
  end if;
  select count(*) into v_prod from products p where p.category_id = p_categoria;
  select count(*) into v_attr from (
    select 1 from product_attribute_categories x where x.category_id = p_categoria
    union all
    select 1 from product_attribute_definitions d where d.applies_to_category_id = p_categoria
  ) z;
  select count(*) into v_hijas from product_categories h where h.parent_id = p_categoria;
  if v_prod > 0 or v_attr > 0 or v_hijas > 0 then
    raise exception 'en_uso:%:%:%', v_prod, v_attr, v_hijas;
  end if;

  delete from product_categories c where c.id = p_categoria;
  insert into catalog_audit (company_id, entity_type, entity_id, entity_name, action, changed_fields, actor_id)
  values (p_company, 'category', p_categoria, v_c.name, 'CATEGORY_DELETED', '{}', auth.uid());
  return query select true;
end $$;

-- -----------------------------------------------------------------------------
-- 6. Atributos (sólo lectura)
-- -----------------------------------------------------------------------------
create or replace function public.config_atributos_listar(p_company uuid)
returns table (key text, label text, data_type text, unit text, is_filterable boolean,
               "position" smallint, categorias text[], productos bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform app.catalogo_exigir_lector(p_company);
  return query
  with usos as (
    select k, count(*) n
      from products p, jsonb_object_keys(p.attributes) k
     where p.company_id = p_company and p.attributes <> '{}'::jsonb
     group by k
  )
  select d.key, d.label, d.data_type, d.unit, d.is_filterable, d.position,
         coalesce((select array_agg(c.name order by c.position, c.name)
                     from product_attribute_categories x
                     join product_categories c on c.id = x.category_id
                    where x.attribute_definition_id = d.id), '{}'),
         coalesce(u.n, 0)
    from product_attribute_definitions d
    left join usos u on u.k = d.key
   where d.company_id = p_company
   order by d.position, d.key;
end $$;

-- -----------------------------------------------------------------------------
-- 7. Listas de precios (sólo lectura)
-- -----------------------------------------------------------------------------
create or replace function public.config_listas_precios_listar(p_company uuid)
returns table (id uuid, name text, currency_code text, is_default boolean, valid_from date, valid_to date,
               created_at timestamptz, items bigint, items_vigentes bigint, precios_cero bigint,
               vigencia_desde date, vigencia_hasta date, clientes bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform app.catalogo_exigir_lector(p_company);
  return query
  with it as (
    select pp.price_list_id,
           count(*) n,
           count(*) filter (where pp.valid_from <= current_date and (pp.valid_to is null or pp.valid_to >= current_date)) vig,
           count(*) filter (where pp.amount = 0) cero,
           min(pp.valid_from) desde,
           case when bool_or(pp.valid_to is null) then null else max(pp.valid_to) end hasta
      from product_prices pp where pp.company_id = p_company group by pp.price_list_id
  ), cli as (
    select c.default_price_list_id, count(*) n from customers c
     where c.company_id = p_company and c.default_price_list_id is not null group by c.default_price_list_id
  )
  select l.id, l.name, l.currency_code, l.is_default, l.valid_from, l.valid_to, l.created_at,
         coalesce(it.n, 0), coalesce(it.vig, 0), coalesce(it.cero, 0), it.desde, it.hasta, coalesce(cli.n, 0)
    from price_lists l
    left join it on it.price_list_id = l.id
    left join cli on cli.default_price_list_id = l.id
   where l.company_id = p_company
   order by l.is_default desc, lower(l.name);
end $$;

create or replace function public.config_lista_precios_clientes(p_company uuid, p_lista uuid)
returns table (id uuid, legal_name text, total bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform app.catalogo_exigir_lector(p_company);
  if not exists (select 1 from price_lists l where l.id = p_lista and l.company_id = p_company) then
    raise exception 'no_encontrado' using errcode = 'no_data_found';
  end if;
  return query
  select c.id, c.legal_name, count(*) over ()
    from customers c
   where c.company_id = p_company and c.default_price_list_id = p_lista
   order by lower(c.legal_name)
   limit 50;
end $$;

create or replace function public.config_lista_precios_items(
  p_company uuid, p_lista uuid, p_busqueda text default null, p_vigencia text default 'todas',
  p_limite int default 50, p_desplazamiento int default 0)
returns table (price_id uuid, product_id uuid, sku text, name text, marca text, amount numeric,
               valid_from date, valid_to date, vigencia text, producto_estado text, total bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_q text;
begin
  perform app.catalogo_exigir_lector(p_company);
  if p_limite is null or p_limite < 1 or p_limite > 100
     or p_desplazamiento is null or p_desplazamiento < 0 or p_desplazamiento > 1000000
     or coalesce(p_vigencia, '') not in ('todas', 'vigente', 'futura', 'vencida')
     or length(coalesce(p_busqueda, '')) > 100 then
    raise exception 'datos_invalidos' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from price_lists l where l.id = p_lista and l.company_id = p_company) then
    raise exception 'no_encontrado' using errcode = 'no_data_found';
  end if;

  v_q := app.catalogo_nombre(p_busqueda);
  if v_q is not null then
    v_q := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  with base as (
    select pp.id, pp.product_id, p.sku, p.name, b.name marca, pp.amount, pp.valid_from, pp.valid_to,
           case when pp.valid_from > current_date then 'futura'
                when pp.valid_to is not null and pp.valid_to < current_date then 'vencida'
                else 'vigente' end vig,
           case when p.deleted_at is not null then 'baja' else p.status end estado
      from product_prices pp
      join products p on p.id = pp.product_id
      left join brands b on b.id = p.brand_id
     where pp.price_list_id = p_lista and pp.company_id = p_company
       and (v_q is null or p.sku ilike v_q or p.name ilike v_q)
  )
  select base.id, base.product_id, base.sku, base.name, base.marca, base.amount, base.valid_from,
         base.valid_to, base.vig, base.estado, count(*) over ()
    from base
   where p_vigencia = 'todas' or base.vig = p_vigencia
   order by base.sku, base.valid_from desc
   limit p_limite offset p_desplazamiento;
end $$;

-- -----------------------------------------------------------------------------
-- 8. Permisos de ejecución: sólo authenticated (la RPC valida el rol)
-- -----------------------------------------------------------------------------
revoke all on function
  public.config_marcas_listar(uuid), public.config_marca_crear(uuid, jsonb),
  public.config_marca_estado(uuid, uuid, boolean), public.config_marca_eliminar(uuid, uuid),
  public.config_categorias_listar(uuid), public.config_categoria_crear(uuid, jsonb),
  public.config_categoria_renombrar(uuid, uuid, text, jsonb), public.config_categoria_eliminar(uuid, uuid),
  public.config_atributos_listar(uuid), public.config_listas_precios_listar(uuid),
  public.config_lista_precios_clientes(uuid, uuid),
  public.config_lista_precios_items(uuid, uuid, text, text, int, int)
  from public, anon;

grant execute on function
  public.config_marcas_listar(uuid), public.config_marca_crear(uuid, jsonb),
  public.config_marca_estado(uuid, uuid, boolean), public.config_marca_eliminar(uuid, uuid),
  public.config_categorias_listar(uuid), public.config_categoria_crear(uuid, jsonb),
  public.config_categoria_renombrar(uuid, uuid, text, jsonb), public.config_categoria_eliminar(uuid, uuid),
  public.config_atributos_listar(uuid), public.config_listas_precios_listar(uuid),
  public.config_lista_precios_clientes(uuid, uuid),
  public.config_lista_precios_items(uuid, uuid, text, text, int, int)
  to authenticated;
