-- Fase 116 · Gestor de visibilidad del sitio público. Lo que se muestra en la
-- web se controla por products.public_slug (no nulo = visible). Estas RPCs dan
-- el resumen por categoría y aplican el cambio en masa, server-side. SECURITY
-- DEFINER con chequeo de membresía interna. Aplicadas con apply_migration el
-- 2026-10-23.

create or replace function public.web_visibilidad_categorias(p_company uuid)
returns table (category_id uuid, nombre text, total bigint, visibles bigint)
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not exists (select 1 from company_memberships m
                 where m.company_id = p_company and m.user_id = auth.uid() and m.status = 'active') then
    raise exception 'sin_acceso';
  end if;
  return query
    select p.category_id, c.name, count(*)::bigint,
           count(*) filter (where p.public_slug is not null)::bigint
      from products p
      join product_categories c on c.id = p.category_id
     where p.company_id = p_company and p.status = 'active' and p.deleted_at is null
     group by p.category_id, c.name
     order by c.name;
end $$;
grant execute on function public.web_visibilidad_categorias(uuid) to authenticated;

create or replace function public.web_visibilidad_aplicar(
  p_company uuid, p_visible boolean, p_category uuid default null, p_product uuid default null)
returns bigint
language plpgsql security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare n bigint;
begin
  if not exists (select 1 from company_memberships m
                 where m.company_id = p_company and m.user_id = auth.uid() and m.status = 'active'
                   and m.role in ('admin','employee')) then
    raise exception 'sin_acceso';
  end if;
  if p_product is null and p_category is null then
    raise exception 'sin_alcance';
  end if;

  if not p_visible then
    update products set public_slug = null
     where company_id = p_company and status = 'active' and deleted_at is null and public_slug is not null
       and (p_product is not null and id = p_product or p_product is null and category_id = p_category);
    get diagnostics n = row_count;
  else
    with objetivo as (
      select id, name, sku, row_number() over (order by id) rn
        from products
       where company_id = p_company and status = 'active' and deleted_at is null and public_slug is null
         and (p_product is not null and id = p_product or p_product is null and category_id = p_category)
    )
    update products p set
      public_slug = left(app.slugificar(o.name), 50) || '-' || app.slugificar(o.sku) || '-' || o.rn::text
    from objetivo o where o.id = p.id;
    get diagnostics n = row_count;
  end if;
  return n;
end $$;
grant execute on function public.web_visibilidad_aplicar(uuid, boolean, uuid, uuid) to authenticated;
