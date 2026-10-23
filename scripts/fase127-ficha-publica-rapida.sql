-- Fase 127 · La ficha pública de producto tardaba 10,8 s y el rol anónimo la
-- cortaba con 500 (57014 statement timeout) → el sitio mostraba «No pudimos
-- cargar el producto. Probá de nuevo en un rato». Aplicado el 2026-10-23.
--
-- Como `postgres` (sin ese timeout) la función respondía, no se veía el problema
-- midiendo con execute_sql. El 500 sólo aparece por HTTP como anon.
--
-- Dos causas, las dos arregladas acá:
--
--  1. El lateral de imagen de la vista `app.catalogo_publicable` leía ~211
--     buffers POR PRODUCTO, porque el único índice con product_id lideraba con
--     company_id (idx_product_images_producto = company_id, product_id, position)
--     y el lateral filtra sólo por product_id. Sobre miles de candidatos eran
--     segundos. Se agrega un índice que lidera con product_id y cubre el orden
--     de la imagen.
--
--  2. Los «relacionados» filtraban `r2.series is not distinct from v.series`:
--     cuando el producto NO tiene serie (series = null), eso matchea TODOS los
--     productos sin serie (~8.600), que la vista materializa con imagen antes de
--     limitar a 8. Se corrige: la serie sólo relaciona si NO es nula; si no,
--     se relaciona por categoría.
--
-- Medido vía HTTP anon: 10.800 ms → ~400 ms (sin serie) / ~800 ms (categoría
-- grande como Repuestos). Ver [[catalogo-publico-mecanica]].

-- ── Causa 1: índice para el lateral de imagen ──
create index if not exists idx_product_images_por_producto
  on public.product_images (product_id, is_primary desc, position, created_at);
analyze public.product_images;

-- ── Causa 2: relacionados que no escanean todo el catálogo sin serie ──
create or replace function public.catalogo_publico_producto(p_slug text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v record;
begin
  select * into v
    from app.catalogo_publicable t
   where t.public_slug = btrim(coalesce(p_slug, ''))
   limit 1;

  if not found then return jsonb_build_object('encontrado', false); end if;

  return jsonb_build_object(
    'encontrado', true,
    'producto', jsonb_build_object(
      'slug', v.public_slug, 'sku', v.sku, 'nombre', v.name,
      'modelo', v.model_code, 'serie', v.series, 'tipo', v.product_type,
      'descripcion', v.description, 'atributos', v.attributes,
      'origen', v.origin_country, 'pesoG', v.weight_g, 'esKit', v.is_kit,
      'marca', v.marca, 'categoria', v.categoria, 'categoriaSlug', v.categoria_slug,
      'imagen', v.imagen_path, 'imagenUrl', v.imagen_url, 'imagenAlt', v.imagen_alt),
    'relacionados', coalesce((
      select jsonb_agg(jsonb_build_object(
               'slug', r.public_slug, 'sku', r.sku, 'nombre', r.name,
               'marca', r.marca, 'categoriaSlug', r.categoria_slug,
               'imagen', r.imagen_path, 'imagenUrl', r.imagen_url)
               order by r.name)
        from (select * from app.catalogo_publicable r2
               where r2.id <> v.id
                 and ((v.series is not null and r2.series = v.series)
                      or r2.categoria_slug = v.categoria_slug)
               order by (v.series is not null and r2.series = v.series) desc, r2.name
               limit 8) r), '[]'::jsonb));
end $function$;
