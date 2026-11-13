-- Productos destacados para la portada del sitio público.
--
-- La portada nueva muestra «Algunos productos del catálogo». Pedirle a cada
-- categoría su primera página no sirve: el catálogo ordena por nombre y en
-- atornilladores, EPP, repuestos y dinamométricas los primeros 24 no tienen
-- foto. Esto elige, de cada categoría, productos CON foto, rota la selección
-- una vez por día y la guarda en la misma copia que los filtros
-- (`app.facetas_publicas_cache`, clave '__destacados'), que la tarea de cada
-- 3 minutos refresca cada 10.

create or replace function app.calcular_destacados_publicos()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'app', 'pg_temp'
as $function$
  with cats as (
    select v.categoria_slug, count(*) as n
      from app.catalogo_publicable v
     group by v.categoria_slug
  ), con_foto as (
    select v.*, i.thumb_url,
           -- Rota todos los días, pero estable dentro del día.
           row_number() over (partition by v.categoria_slug
                              order by md5(v.id::text || current_date::text)) as rn
      from app.catalogo_publicable v
      cross join lateral (
        select pi.thumb_url from product_images pi
         where pi.product_id = v.id
         order by pi.is_primary desc nulls last, pi.position, pi.created_at
         limit 1) i
     where v.imagen_url is not null
  ), elegidos as (
    select f.*, c.n
      from con_foto f join cats c on c.categoria_slug = f.categoria_slug
     where f.rn <= 2
     order by c.n desc, f.categoria_slug, f.rn
     limit 12
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'slug', e.public_slug, 'sku', e.sku, 'nombre', e.name, 'modelo', e.model_code,
           'marca', e.marca, 'categoria', e.categoria, 'categoriaSlug', e.categoria_slug,
           'serie', e.series, 'tipo', e.product_type, 'atributos', e.attributes,
           'imagen', e.imagen_path, 'imagenUrl', e.imagen_url, 'imagenMini', e.thumb_url,
           'imagenAlt', e.imagen_alt)
         order by e.n desc, e.categoria_slug, e.rn), '[]'::jsonb)
    from elegidos e;
$function$;

revoke execute on function app.calcular_destacados_publicos() from public, anon, authenticated;

-- La puerta pública: la copia guardada, o el cálculo si falta o es vieja.
create or replace function public.catalogo_publico_destacados()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'app', 'pg_temp'
as $function$
declare
  v jsonb;
begin
  select c.valor into v from app.facetas_publicas_cache c
   where c.clave = '__destacados' and c.calculado > now() - interval '30 minutes';
  return coalesce(v, app.calcular_destacados_publicos());
end $function$;

grant execute on function public.catalogo_publico_destacados() to anon, authenticated, service_role;

-- El refresco de la copia suma los destacados.
create or replace function app.refrescar_facetas_publicas()
returns integer
language plpgsql
security definer
set search_path to 'public', 'app', 'pg_temp'
as $function$
declare
  v_slug text; v_n integer := 0;
begin
  insert into app.facetas_publicas_cache (clave, valor, calculado)
  values ('', app.catalogo_publico_facetas_calcular(null, null, null, null, null, null, null, null), now())
  on conflict (clave) do update set valor = excluded.valor, calculado = excluded.calculado;
  v_n := 1;
  for v_slug in
    select distinct coalesce(c.slug_publico, c.slug) from product_categories c where c.publica
  loop
    insert into app.facetas_publicas_cache (clave, valor, calculado)
    values (v_slug, app.catalogo_publico_facetas_calcular(v_slug, null, null, null, null, null, null, null), now())
    on conflict (clave) do update set valor = excluded.valor, calculado = excluded.calculado;
    v_n := v_n + 1;
  end loop;
  insert into app.facetas_publicas_cache (clave, valor, calculado)
  values ('__destacados', app.calcular_destacados_publicos(), now())
  on conflict (clave) do update set valor = excluded.valor, calculado = excluded.calculado;
  -- Una categoría que dejó de ser pública no se sigue sirviendo.
  delete from app.facetas_publicas_cache f
   where f.clave <> '' and f.clave not like '\_\_%' and not exists (
     select 1 from product_categories c where c.publica and coalesce(c.slug_publico, c.slug) = f.clave);
  return v_n;
end $function$;

select app.refrescar_facetas_publicas();
