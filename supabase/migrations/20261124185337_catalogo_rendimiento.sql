-- Rendimiento del catálogo (ERP y sitio público).
--
-- 1 · Memoria de orden para las funciones del catálogo. Con el `work_mem` de la
--     instancia (2 MB) el orden de ~20.000 productos se derramaba a disco
--     (medido: `temp written=462` en `search_products` sin filtro). 16 MB sólo
--     dentro de estas funciones: el resto de la base sigue igual.
--
-- 2 · `catalogo_publico_exportar`: el catálogo público entero en tandas
--     grandes, para el prerender del deploy. El prerender recorría el catálogo
--     con `catalogo_publico_listar` de a 48 —426 llamadas, cada una ordenando
--     TODO para saltear las anteriores con OFFSET—: ~1 minuto de base por
--     deploy, que saturaba la instancia y ponía lento al ERP; con carga, la
--     página 406 superó el timeout y tiró el deploy. Mismo contenido y mismo
--     orden que el listado sin filtro, de a hasta 2.000.

alter function public.search_products(uuid, text, integer, integer, uuid, uuid, jsonb, text[], jsonb, text, boolean, text[])
  set work_mem = '16MB';
alter function public.catalog_facets(uuid, text, uuid, uuid, text[], jsonb, jsonb, boolean, text[], boolean)
  set work_mem = '16MB';
alter function public.catalogo_publico_listar(text, text, text, integer, integer, text, text, jsonb, text, jsonb)
  set work_mem = '16MB';

create or replace function public.catalogo_publico_exportar(p_pagina integer default 1, p_por_pagina integer default 1000)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'extensions', 'pg_temp'
 set jit to 'off'
 set work_mem to '32MB'
as $function$
declare
  v_por    integer := least(greatest(coalesce(p_por_pagina, 1000), 1), 2000);
  v_pagina integer := greatest(coalesce(p_pagina, 1), 1);
  v_total  bigint;
  v_filas  jsonb;
begin
  with todos as materialized (
    select v.*,
           case when v.marca = 'SPEEDRILL' and v.categoria_slug = 'puntas-y-tubos' then 0 else 1 end as prioridad
      from app.catalogo_publicable_flaco v
  ), pagina as (
    select * from todos
     order by prioridad, name, id
     limit v_por offset (v_pagina - 1) * v_por
  )
  select (select count(*) from todos),
         (select jsonb_agg(jsonb_build_object(
                   'slug', f.public_slug, 'sku', f.sku, 'nombre', f.name,
                   'modelo', f.model_code,
                   'marca', f.marca, 'categoria', f.categoria,
                   'categoriaSlug', f.categoria_slug,
                   'serie', f.series, 'tipo', f.product_type,
                   'atributos', app.atributos_publicos(f.attributes),
                   'imagen', i.storage_path, 'imagenUrl', coalesce(i.medium_url, i.source_url), 'imagenMini', i.thumb_url,
                   'imagenAlt', i.alt_text) order by f.prioridad, f.name, f.id)
            from pagina f
            left join lateral (
              select pi.storage_path, pi.source_url, pi.thumb_url, pi.medium_url, pi.alt_text
                from public.product_images pi
               where pi.product_id = f.id
               order by pi.is_primary desc nulls last, pi.position nulls last, pi.created_at
               limit 1
            ) i on true)
    into v_total, v_filas;

  return jsonb_build_object(
    'total', coalesce(v_total, 0),
    'pagina', v_pagina,
    'porPagina', v_por,
    'productos', coalesce(v_filas, '[]'::jsonb));
end $function$;

revoke all on function public.catalogo_publico_exportar(integer, integer) from public;
grant execute on function public.catalogo_publico_exportar(integer, integer) to anon, authenticated;

-- 3 · El calentamiento (cron 9, cada 15 min) recalculaba las facetas públicas
--     si tenían más de 10 minutos: como corre cada 15, las recalculaba SIEMPRE
--     (3,3 s cada vez). Era el mayor consumo de toda la base (≈18 h de CPU en
--     un mes). Con 60 minutos se recalculan una de cada cuatro corridas; los
--     conteos del sitio quedan como mucho una hora atrasados.
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

  perform catalogo_publico_categorias();
  perform catalogo_publico_facetas(null,null,null,null,null,null,null);
  perform catalogo_publico_listar(null,null,null,1,100,null,null,null,null);

  perform * from search_products('bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c'::uuid, null, 50, 0, null, null, null, null, null, null, true, null);
  perform * from search_products('492a0ee9-220f-4dc8-9eaa-ec914ea10907'::uuid, null, 50, 0, null, null, null, null, null, null, true, null);
end $function$;
