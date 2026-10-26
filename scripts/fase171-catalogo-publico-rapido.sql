-- Fase 171 · El catálogo público carga en ~0,15 s en vez de ~2,4 s
--
-- SÍNTOMA: entrar a la web como cliente tardaba ~5 s en mostrar los productos.
--
-- DIAGNÓSTICO (medido con EXPLAIN ANALYZE contra São Paulo):
--   catalogo_publico_listar(porPagina=>100)  → 2432 ms
--   catalogo_publico_listar(porPagina=>12)   →   97 ms
--   count(*) de catalogo_publicable_flaco     →   31 ms
--   página de 100 con la lateral de imagen    →   49 ms
--   atributos_publicos sobre 100 filas        →  167 ms
-- Ni el conteo, ni la imagen, ni los atributos explicaban los 2,4 s. La causa
-- era el CTE `filtrados`: lo referencian DOS veces (el count(*) y la página),
-- así que Postgres lo MATERIALIZABA —las ~17.000 filas anchas de la vista, con
-- su jsonb de atributos—. Marcarlo `not materialized` lo inlinea: cada
-- referencia escanea la vista directo (un count + un top-N heapsort de 100).
--
-- RESULTADO: 2432 ms → ~142 ms, con el MISMO resultado (total y filas idénticos).
-- El único cambio respecto de la versión anterior es `filtrados as not
-- materialized`. Ya aplicado en producción (jiudqbusyknubonpedde) por la
-- migración `catalogo_publico_listar_cte_not_materialized`; queda acá para el
-- registro del repo.

CREATE OR REPLACE FUNCTION public.catalogo_publico_listar(p_categoria text DEFAULT NULL::text, p_marca text DEFAULT NULL::text, p_texto text DEFAULT NULL::text, p_pagina integer DEFAULT 1, p_por_pagina integer DEFAULT 24, p_serie text DEFAULT NULL::text, p_tipo text DEFAULT NULL::text, p_atributos jsonb DEFAULT NULL::jsonb, p_modelo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_por    integer := least(greatest(coalesce(p_por_pagina, 24), 1), 100);
  v_pagina integer := greatest(coalesce(p_pagina, 1), 1);
  v_q      text    := nullif(btrim(coalesce(p_texto, '')), '');
  v_modelo text    := nullif(btrim(coalesce(p_modelo, '')), '');
  v_palabras text[];
  v_total  bigint;
  v_filas  jsonb;
  -- La portada: sin ningún filtro puesto. Ahí —y sólo ahí— se prioriza Speedrill.
  v_sin_filtro boolean := (p_categoria is null and p_marca is null and p_serie is null
                           and p_tipo is null and p_atributos is null
                           and nullif(btrim(coalesce(p_texto,'')),'') is null
                           and nullif(btrim(coalesce(p_modelo,'')),'') is null);
begin
  if v_q is not null then
    select array_agg(w) into v_palabras
      from unnest(regexp_split_to_array(lower(extensions.unaccent(v_q)), '[^a-z0-9./]+')) as w
     where w <> '';
  end if;

  -- `not materialized`: referenciar `filtrados` dos veces (el count y la página)
  -- hacía que Postgres materializara las ~17.000 filas anchas de la vista; así
  -- se inlinea y cada referencia escanea la vista directo (~140 ms en vez de
  -- ~2,4 s). El resultado es idéntico.
  with filtrados as not materialized (
    select v.*
      from app.catalogo_publicable_flaco v
     where (p_categoria is null or v.categoria_slug = p_categoria)
       and (p_marca is null or app.slugificar(v.marca) = p_marca)
       and (p_serie is null or v.series = p_serie)
       and (p_tipo is null or v.product_type = p_tipo)
       and (p_atributos is null
            or not exists (
                 select 1 from jsonb_each_text(p_atributos) f
                  where coalesce(v.attributes ->> f.key, '') <> f.value))
       and (v_modelo is null
            or lower(extensions.unaccent(coalesce(v.model_code, '')))
               like '%' || lower(extensions.unaccent(v_modelo)) || '%')
       and (v_palabras is null
            or not exists (
                 select 1 from unnest(v_palabras) w
                  where lower(extensions.unaccent(
                          v.name || ' ' || v.sku || ' ' || coalesce(v.marca, '') || ' ' ||
                          coalesce(v.series, '') || ' ' || coalesce(v.product_type, '') || ' ' ||
                          coalesce(v.categoria, ''))) not like '%' || w || '%'))
  ), pagina as (
    select *,
           case when v_sin_filtro and marca = 'SPEEDRILL' and categoria_slug = 'puntas-y-tubos'
                then 0 else 1 end as prioridad
      from filtrados
     order by prioridad, name
     limit v_por offset (v_pagina - 1) * v_por
  )
  select (select count(*) from filtrados),
         (select jsonb_agg(jsonb_build_object(
                   'slug', f.public_slug, 'sku', f.sku, 'nombre', f.name,
                   'modelo', f.model_code,
                   'marca', f.marca, 'categoria', f.categoria,
                   'categoriaSlug', f.categoria_slug,
                   'serie', f.series, 'tipo', f.product_type,
                   'atributos', app.atributos_publicos(f.attributes),
                   'imagen', i.storage_path, 'imagenUrl', i.source_url,
                   'imagenAlt', i.alt_text) order by f.prioridad, f.name)
            from pagina f
            left join lateral (
              select pi.storage_path, pi.source_url, pi.alt_text
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
