-- Las categorías del catálogo (con conteo y portada), precalculadas.
--
-- `catalogo_publico_categorias` contaba los productos de cada rubro y buscaba
-- la foto de portada entre ~25.000 imágenes EN CADA VISITA. Medido como anon:
-- 3,1 s la primera vez en cada conexión —más que el corte de 3 s de anon: fue
-- el error 500 más frecuente del sitio hoy— y 158 ms después. La usan la web
-- y la guía del catálogo del ERP (sus tiles).
--
-- El resultado cambia poco, así que se guarda: el cron de calentamiento (cada
-- 15 min) lo recalcula y la función lo devuelve tal cual. Si todavía no hay
-- nada guardado, lo calcula en el momento. Un rubro o una portada nuevos
-- aparecen en 15 minutos como mucho.

create table if not exists app.catalogo_categorias_cache (
  id        boolean primary key default true check (id),
  datos     jsonb not null,
  calculado timestamptz not null default now()
);
revoke all on app.catalogo_categorias_cache from public, anon, authenticated;

-- El cálculo de siempre, sin cambios, con otro nombre.
create or replace function app.calcular_categorias_publicas()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public', 'extensions', 'pg_temp'
 set jit to 'off'
as $function$
  with cats as (
    select c.id as cat_id,
           coalesce(c.slug_publico, c.slug) as slug,
           c.name as nombre,
           c.portada_url,
           count(*) as n
      from public.products p
      join public.companies c0         on c0.id = p.company_id and c0.catalogo_publico
      join public.brands b             on b.id = p.brand_id and b.is_active
      join public.product_categories c on c.id = p.category_id and c.publica
     where p.deleted_at is null and p.status = 'active'
       and p.public_slug is not null
     group by c.id, 2, 3, c.portada_url
  ),
  port as (
    select distinct on (pp.category_id)
           pp.category_id, pi.source_url, pi.thumb_url
      from public.products pp
      join public.product_images pi    on pi.product_id = pp.id and pi.source_url is not null
      join public.companies c0         on c0.id = pp.company_id and c0.catalogo_publico
      join public.product_categories c on c.id = pp.category_id and c.publica
     where pp.public_slug is not null and pp.status = 'active' and pp.deleted_at is null
     order by pp.category_id,
              (c.portada_product_id is not null and pp.id = c.portada_product_id) desc,
              pi.is_primary desc nulls last, pi.position nulls last, pi.created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'slug', cats.slug, 'nombre', cats.nombre, 'productos', cats.n,
           'portadaUrl', coalesce(cats.portada_url, port.thumb_url, port.source_url)) order by cats.n desc), '[]'::jsonb)
    from cats
    left join port on port.category_id = cats.cat_id
$function$;
revoke all on function app.calcular_categorias_publicas() from public, anon, authenticated;

create or replace function app.refrescar_categorias_publicas()
 returns void
 language sql
 security definer
 set search_path to 'public', 'pg_temp'
as $$
  insert into app.catalogo_categorias_cache (id, datos, calculado)
  values (true, app.calcular_categorias_publicas(), now())
  on conflict (id) do update set datos = excluded.datos, calculado = excluded.calculado;
$$;
revoke all on function app.refrescar_categorias_publicas() from public, anon, authenticated;

-- Lo que llama la web y el ERP: lo guardado, o el cálculo si no hay.
create or replace function public.catalogo_publico_categorias()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public', 'extensions', 'pg_temp'
 set jit to 'off'
as $function$
  select coalesce((select datos from app.catalogo_categorias_cache where id), app.calcular_categorias_publicas())
$function$;

create or replace function app.calentar_catalogo_publico()
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
begin
  if not exists (select 1 from app.facetas_publicas_cache where clave = '' and calculado > now() - interval '60 minutes') then
    perform app.refrescar_facetas_publicas();
  end if;

  perform app.refrescar_categorias_publicas();
  perform catalogo_publico_facetas(null,null,null,null,null,null,null);
  perform catalogo_publico_listar(null,null,null,1,100,null,null,null,null);

  perform * from search_products('bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c'::uuid, null, 50, 0, null, null, null, null, null, null, true, null);
  perform * from search_products('492a0ee9-220f-4dc8-9eaa-ec914ea10907'::uuid, null, 50, 0, null, null, null, null, null, null, true, null);
end $function$;

select app.refrescar_categorias_publicas();
