-- Catálogo compartido con distribuidores (2026-11-27) — Fase 2.
--
-- Un distribuidor es una empresa propia (Fase 1). Esto le comparte EN VIVO el
-- catálogo de otra empresa (Buscatools), sin copiarlo: copiar 21.861 productos
-- por distribuidor son ~90 MB cada uno, y la base está en 359 de 500 MB.
--
-- Lo compartido se lee SÓLO por funciones que devuelven campos seguros (SKU,
-- nombre, marca, categoría, fotos, ficha y SU precio): nunca el costo, las otras
-- listas de precios ni el stock. La tabla products NO se abre por RLS a otra
-- empresa, así que el resto de la app del distribuidor sigue sin ver nada.
--
-- El precio del distribuidor: si el compartido apunta a una lista con precio
-- para ese producto, ése; si no, el PVP de la empresa dueña (fórmula o lista
-- por defecto) menos `descuento_pct`.

create table if not exists public.catalog_shares (
  id uuid primary key default gen_random_uuid(),
  owner_company_id uuid not null references public.companies(id) on delete cascade,
  distributor_company_id uuid not null references public.companies(id) on delete cascade,
  price_list_id uuid references public.price_lists(id) on delete set null,
  descuento_pct numeric(5, 2) not null default 0 check (descuento_pct >= 0 and descuento_pct < 100),
  brand_ids uuid[],
  category_ids uuid[],
  is_active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_shares_distinta check (owner_company_id <> distributor_company_id),
  -- Un distribuidor recibe el catálogo de UN proveedor (por ahora).
  constraint catalog_shares_un_proveedor unique (distributor_company_id)
);

comment on table public.catalog_shares is
  'Catálogo que una empresa comparte con un distribuidor. Se lee sólo por catalogo_compartido_* (campos seguros, sin costos).';

create index if not exists catalog_shares_owner_idx on public.catalog_shares (owner_company_id);

alter table public.catalog_shares enable row level security;

drop policy if exists catalog_shares_select on public.catalog_shares;
create policy catalog_shares_select on public.catalog_shares
  for select to authenticated
  using (owner_company_id = any (app.current_internal_company_ids()));

-- ¿Este producto está compartido con esta empresa? (lo usan las cotizaciones)
create or replace function app.producto_compartido(p_product uuid, p_company uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1
      from catalog_shares s
      join products p on p.id = p_product and p.company_id = s.owner_company_id
      left join brands b on b.id = p.brand_id
      left join product_categories c on c.id = p.category_id
     where s.distributor_company_id = p_company
       and s.is_active
       and p.deleted_at is null and p.status = 'active'
       and coalesce(b.is_active, true) and coalesce(c.is_active, true)
       and (s.brand_ids is null or p.brand_id = any (s.brand_ids))
       and (s.category_ids is null or p.category_id = any (s.category_ids))
  )
$$;

-- El precio del distribuidor para unos productos del dueño.
create or replace function app.precios_compartidos(p_share uuid, p_ids uuid[])
 returns table (product_id uuid, precio numeric)
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $$
  with s as (select * from catalog_shares where id = p_share),
  lista_def as (
    select l.id from price_lists l, s where l.company_id = s.owner_company_id and l.is_default limit 1
  )
  select i.id,
         coalesce(
           (select pp.amount from product_prices pp, s
             where s.price_list_id is not null and pp.price_list_id = s.price_list_id and pp.product_id = i.id
               and (pp.valid_from is null or pp.valid_from <= current_date)
               and (pp.valid_to is null or pp.valid_to >= current_date)
             order by pp.valid_from desc nulls last limit 1),
           round(
             coalesce(
               (select pv.pvp from product_pvp pv, s where pv.company_id = s.owner_company_id and pv.product_id = i.id limit 1),
               (select pp.amount from product_prices pp, lista_def ld
                 where pp.price_list_id = ld.id and pp.product_id = i.id
                   and (pp.valid_from is null or pp.valid_from <= current_date)
                   and (pp.valid_to is null or pp.valid_to >= current_date)
                 order by pp.valid_from desc nulls last limit 1)
             ) * (1 - (select descuento_pct from s) / 100), 2)
         )
    from unnest(p_ids) as i(id)
$$;

-- El listado del distribuidor: búsqueda, filtros y una página, en UN viaje.
create or replace function public.catalogo_compartido_listar(
  p_company uuid,
  p_query text default null,
  p_categoria uuid default null,
  p_marca uuid default null,
  p_pagina integer default 1,
  p_por_pagina integer default 24
)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  s catalog_shares;
  v_moneda text;
  v_patrones text[];
  v_lim int := least(greatest(coalesce(p_por_pagina, 24), 1), 100);
  v_off int;
  v_res jsonb;
begin
  if not (p_company = any (app.current_company_ids())) then
    raise exception 'sin_permiso' using errcode = '42501';
  end if;
  v_off := (greatest(coalesce(p_pagina, 1), 1) - 1) * v_lim;

  select * into s from catalog_shares where distributor_company_id = p_company and is_active;
  if not found then
    return jsonb_build_object('proveedor', null, 'moneda', null, 'total', 0,
      'productos', '[]'::jsonb, 'categorias', '[]'::jsonb, 'marcas', '[]'::jsonb);
  end if;

  select currency_code into v_moneda from price_lists where company_id = s.owner_company_id and is_default limit 1;

  if p_query is not null and btrim(p_query) <> '' then
    select array_agg('%' || t || '%') into v_patrones
      from unnest(regexp_split_to_array(lower(extensions.unaccent(btrim(p_query))), '\s+')) t
     where t <> '';
  end if;

  with base as (
    select p.id, p.sku, p.name, p.model_code, p.brand_id, p.category_id,
           b.name as marca, c.name as categoria
      from products p
      left join brands b on b.id = p.brand_id
      left join product_categories c on c.id = p.category_id
     where p.company_id = s.owner_company_id
       and p.deleted_at is null and p.status = 'active'
       and coalesce(b.is_active, true) and coalesce(c.is_active, true)
       and (s.brand_ids is null or p.brand_id = any (s.brand_ids))
       and (s.category_ids is null or p.category_id = any (s.category_ids))
       and (v_patrones is null or p.texto_busqueda like all (v_patrones))
  ),
  filtrado as (
    select * from base
     where (p_categoria is null or category_id = p_categoria)
       and (p_marca is null or brand_id = p_marca)
  ),
  pagina as (
    select * from filtrado order by name, sku limit v_lim offset v_off
  ),
  precios as (
    select * from app.precios_compartidos(s.id, (select coalesce(array_agg(id), '{}') from pagina))
  )
  select jsonb_build_object(
    'proveedor', (select name from companies where id = s.owner_company_id),
    'moneda', v_moneda,
    'total', (select count(*) from filtrado),
    'productos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pg.id, 'sku', pg.sku, 'nombre', pg.name, 'modelo', pg.model_code,
               'marca', case when pg.brand_id is null then null else jsonb_build_object('id', pg.brand_id, 'nombre', pg.marca) end,
               'categoria', case when pg.category_id is null then null else jsonb_build_object('id', pg.category_id, 'nombre', pg.categoria) end,
               'imagen', (select coalesce(i.thumb_url, i.medium_url, i.source_url) from product_images i
                           where i.product_id = pg.id order by i.is_primary desc, i.position limit 1),
               'precio', pr.precio
             ) order by pg.name, pg.sku)
        from pagina pg left join precios pr on pr.product_id = pg.id), '[]'::jsonb),
    'categorias', coalesce((
      select jsonb_agg(jsonb_build_object('id', category_id, 'nombre', categoria, 'cantidad', n) order by categoria)
        from (select category_id, categoria, count(*) n from base
               where category_id is not null and (p_marca is null or brand_id = p_marca)
               group by 1, 2) x), '[]'::jsonb),
    'marcas', coalesce((
      select jsonb_agg(jsonb_build_object('id', brand_id, 'nombre', marca, 'cantidad', n) order by marca)
        from (select brand_id, marca, count(*) n from base
               where brand_id is not null and (p_categoria is null or category_id = p_categoria)
               group by 1, 2) x), '[]'::jsonb)
  ) into v_res;

  return v_res;
end
$$;

revoke all on function public.catalogo_compartido_listar(uuid, text, uuid, uuid, integer, integer) from public, anon;
grant execute on function public.catalogo_compartido_listar(uuid, text, uuid, uuid, integer, integer) to authenticated;

-- La ficha de un producto compartido: fotos, descripción, características y precio.
create or replace function public.catalogo_compartido_producto(p_company uuid, p_product uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $$
declare
  s catalog_shares;
  p products;
begin
  if not (p_company = any (app.current_company_ids())) then
    raise exception 'sin_permiso' using errcode = '42501';
  end if;
  if not app.producto_compartido(p_product, p_company) then
    return null;
  end if;
  select * into s from catalog_shares where distributor_company_id = p_company and is_active;
  select * into p from products where id = p_product;

  return jsonb_build_object(
    'id', p.id, 'sku', p.sku, 'nombre', p.name, 'modelo', p.model_code,
    'descripcion', p.description, 'descripcionLarga', p.description_long,
    'marca', (select jsonb_build_object('id', b.id, 'nombre', b.name) from brands b where b.id = p.brand_id),
    'categoria', (select jsonb_build_object('id', c.id, 'nombre', c.name) from product_categories c where c.id = p.category_id),
    'imagenes', coalesce((select jsonb_agg(coalesce(i.medium_url, i.source_url, i.thumb_url) order by i.is_primary desc, i.position)
                            from product_images i where i.product_id = p.id), '[]'::jsonb),
    'atributos', coalesce((
      select jsonb_agg(jsonb_build_object('etiqueta', coalesce(d.label, a.key), 'valor', a.value #>> '{}', 'unidad', d.unit)
                       order by d.position nulls last, a.key)
        from jsonb_each(coalesce(p.attributes, '{}'::jsonb)) a
        left join product_attribute_definitions d on d.company_id = p.company_id and d.key = a.key
       where a.value is not null and a.value <> 'null'::jsonb and (a.value #>> '{}') <> ''), '[]'::jsonb),
    'precio', (select precio from app.precios_compartidos(s.id, array[p.id])),
    'moneda', (select currency_code from price_lists where company_id = s.owner_company_id and is_default limit 1),
    'proveedor', (select name from companies where id = s.owner_company_id)
  );
end
$$;

revoke all on function public.catalogo_compartido_producto(uuid, uuid) from public, anon;
grant execute on function public.catalogo_compartido_producto(uuid, uuid) to authenticated;

-- Compartir (o cambiar, o pausar) el catálogo con un distribuidor: sólo un
-- administrador general.
create or replace function public.config_compartir_catalogo(
  p_owner uuid,
  p_distribuidor uuid,
  p_descuento numeric,
  p_price_list uuid,
  p_marcas uuid[],
  p_categorias uuid[],
  p_activo boolean
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'app', 'pg_temp'
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'sesion_invalida'; end if;
  if not app.is_general_admin() then raise exception 'sin_permiso'; end if;
  if p_owner is null or p_distribuidor is null or p_owner = p_distribuidor then raise exception 'empresas_invalidas'; end if;
  if not exists (select 1 from companies where id = p_owner) or not exists (select 1 from companies where id = p_distribuidor) then
    raise exception 'empresas_invalidas';
  end if;
  if coalesce(p_descuento, 0) < 0 or coalesce(p_descuento, 0) >= 100 then raise exception 'descuento_invalido'; end if;
  if p_price_list is not null and not exists (select 1 from price_lists where id = p_price_list and company_id = p_owner) then
    raise exception 'lista_invalida';
  end if;

  insert into catalog_shares (owner_company_id, distributor_company_id, price_list_id, descuento_pct, brand_ids, category_ids, is_active)
  values (p_owner, p_distribuidor, p_price_list, coalesce(p_descuento, 0),
          nullif(p_marcas, '{}'), nullif(p_categorias, '{}'), coalesce(p_activo, true))
  on conflict (distributor_company_id) do update
     set owner_company_id = excluded.owner_company_id,
         price_list_id = excluded.price_list_id,
         descuento_pct = excluded.descuento_pct,
         brand_ids = excluded.brand_ids,
         category_ids = excluded.category_ids,
         is_active = excluded.is_active,
         updated_at = now()
  returning id into v_id;
  return v_id;
end
$$;

revoke all on function public.config_compartir_catalogo(uuid, uuid, numeric, uuid, uuid[], uuid[], boolean) from public, anon;
grant execute on function public.config_compartir_catalogo(uuid, uuid, numeric, uuid, uuid[], uuid[], boolean) to authenticated;

-- Las cotizaciones del distribuidor aceptan productos compartidos con él.
do $$
declare v_def text; v_nueva text;
begin
  v_def := pg_get_functiondef('public.crear_cotizacion'::regproc);
  v_nueva := replace(v_def,
    'where p.id = (v_l->>''product_id'')::uuid and p.company_id = p_company) then',
    'where p.id = (v_l->>''product_id'')::uuid and (p.company_id = p_company or app.producto_compartido(p.id, p_company))) then');
  if v_nueva = v_def then raise exception 'crear_cotizacion: el parche no entró'; end if;
  execute v_nueva;

  v_def := pg_get_functiondef('public.guardar_cotizacion'::regproc);
  v_nueva := replace(v_def,
    'where p.id = (v_l->>''product_id'')::uuid and p.company_id = v_q.company_id) then',
    'where p.id = (v_l->>''product_id'')::uuid and (p.company_id = v_q.company_id or app.producto_compartido(p.id, v_q.company_id))) then');
  if v_nueva = v_def then raise exception 'guardar_cotizacion: el parche no entró'; end if;
  execute v_nueva;
end
$$;
