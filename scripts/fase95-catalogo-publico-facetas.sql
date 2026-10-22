-- Fase 95 · El catálogo público filtraba mal. Dos bugs:
--   1. `catalogo_publico_listar` recibía p_atributos pero NO lo usaba: elegir
--      encastre/medida/largo no filtraba nada.
--   2. `catalogo_publico_facetas` sólo miraba la categoría, así que los conteos
--      eran los de TODA la categoría (medida 25mm decía 764 con el total en 695).
--
-- Arreglo: listar aplica los atributos; facetas toma todos los filtros y calcula
-- cada faceta con los demás MENOS la suya (dependiente, como catalog_facets del
-- ERP), y ordena las opciones por número, MÉTRICAS antes que imperiales.
--
-- El catálogo público es SÓLO Buscatools (la vista exige companies.catalogo_publico);
-- Torquetools no se publica.

-- ── 1 · listar: aplicar p_atributos ──────────────────────────────────────────
create or replace function public.catalogo_publico_listar(
  p_categoria text default null, p_marca text default null, p_texto text default null,
  p_pagina integer default 1, p_por_pagina integer default 24, p_serie text default null,
  p_tipo text default null, p_atributos jsonb default null, p_modelo text default null)
 returns jsonb language plpgsql stable security definer
 set search_path to 'public','extensions','pg_temp'
as $function$
declare
  v_por    integer := least(greatest(coalesce(p_por_pagina, 24), 1), 100);
  v_pagina integer := greatest(coalesce(p_pagina, 1), 1);
  v_q      text    := nullif(btrim(coalesce(p_texto, '')), '');
  v_modelo text    := nullif(btrim(coalesce(p_modelo, '')), '');
  v_palabras text[];
  v_total  bigint;
  v_filas  jsonb;
begin
  if v_q is not null then
    select array_agg(w) into v_palabras
      from unnest(regexp_split_to_array(lower(extensions.unaccent(v_q)), '[^a-z0-9./]+')) as w
     where w <> '';
  end if;

  with filtrados as (
    select v.*
      from app.catalogo_publicable_flaco v
     where (p_categoria is null or v.categoria_slug = p_categoria)
       and (p_marca is null or app.slugificar(v.marca) = p_marca)
       and (p_serie is null or v.series = p_serie)
       and (p_tipo is null or v.product_type = p_tipo)
       -- Atributos (Fase 95): cada par tiene que coincidir, por texto exacto.
       and (p_atributos is null
            or not exists (select 1 from jsonb_each_text(p_atributos) f
                            where coalesce(v.attributes ->> f.key, '') <> f.value))
       and (v_modelo is null
            or lower(extensions.unaccent(coalesce(v.model_code, '')))
               like '%' || lower(extensions.unaccent(v_modelo)) || '%')
       and (v_palabras is null
            or not exists (select 1 from unnest(v_palabras) w
                            where lower(extensions.unaccent(
                                    v.name || ' ' || v.sku || ' ' || coalesce(v.marca, '') || ' ' ||
                                    coalesce(v.series, '') || ' ' || coalesce(v.product_type, '') || ' ' ||
                                    coalesce(v.categoria, ''))) not like '%' || w || '%'))
  ), pagina as (
    select * from filtrados order by name limit v_por offset (v_pagina - 1) * v_por
  )
  select (select count(*) from filtrados),
         (select jsonb_agg(jsonb_build_object(
                   'slug', f.public_slug, 'sku', f.sku, 'nombre', f.name, 'modelo', f.model_code,
                   'marca', f.marca, 'categoria', f.categoria, 'categoriaSlug', f.categoria_slug,
                   'serie', f.series, 'tipo', f.product_type,
                   'atributos', app.atributos_publicos(f.attributes),
                   'imagen', i.storage_path, 'imagenUrl', i.source_url, 'imagenAlt', i.alt_text) order by f.name)
            from pagina f
            left join lateral (
              select pi.storage_path, pi.source_url, pi.alt_text from public.product_images pi
               where pi.product_id = f.id
               order by pi.is_primary desc nulls last, pi.position nulls last, pi.created_at limit 1
            ) i on true)
    into v_total, v_filas;

  return jsonb_build_object('total', coalesce(v_total, 0), 'pagina', v_pagina,
                            'porPagina', v_por, 'productos', coalesce(v_filas, '[]'::jsonb));
end $function$;

-- ── 2 · facetas: dependientes + ordenadas (métrico primero) ──────────────────
-- Cambia la firma → drop explícito antes del create (si no, queda sobrecargada).
drop function if exists public.catalogo_publico_facetas(text);

create or replace function public.catalogo_publico_facetas(
  p_categoria text default null, p_marca text default null, p_serie text default null,
  p_tipo text default null, p_atributos jsonb default null, p_texto text default null,
  p_modelo text default null)
 returns jsonb language plpgsql stable security definer
 set search_path to 'public','extensions','pg_temp'
as $function$
declare
  v_q text := nullif(btrim(coalesce(p_texto,'')),'');
  v_modelo text := nullif(btrim(coalesce(p_modelo,'')),'');
  v_palabras text[];
  v_res jsonb;
begin
  if v_q is not null then
    select array_agg(w) into v_palabras
      from unnest(regexp_split_to_array(lower(extensions.unaccent(v_q)),'[^a-z0-9./]+')) as w
     where w <> '';
  end if;

  with base as (
    select v.*,
      (p_marca is null or app.slugificar(v.marca) = p_marca) as ok_marca,
      (p_serie is null or v.series = p_serie)                as ok_serie,
      (p_tipo  is null or v.product_type = p_tipo)           as ok_tipo,
      (p_atributos is null or not exists (select 1 from jsonb_each_text(p_atributos) f
          where coalesce(v.attributes ->> f.key,'') <> f.value)) as ok_attrs,
      (v_modelo is null or lower(extensions.unaccent(coalesce(v.model_code,'')))
          like '%'||lower(extensions.unaccent(v_modelo))||'%')     as ok_modelo,
      (v_palabras is null or not exists (select 1 from unnest(v_palabras) w
          where lower(extensions.unaccent(
                  v.name||' '||v.sku||' '||coalesce(v.marca,'')||' '||
                  coalesce(v.series,'')||' '||coalesce(v.product_type,'')||' '||
                  coalesce(v.categoria,''))) not like '%'||w||'%')) as ok_texto
      from app.catalogo_publicable_flaco v
     where (p_categoria is null or v.categoria_slug = p_categoria)
  ),
  valores as (
    select e.key, e.value, count(*) as n
      from base b, lateral jsonb_each_text(coalesce(b.attributes,'{}'::jsonb)) e
     where b.ok_marca and b.ok_serie and b.ok_tipo and b.ok_modelo and b.ok_texto
       and e.key = any (app.claves_de_atributo_publicas())
       and e.value is not null and e.value <> ''
       and (p_atributos is null or not exists (select 1 from jsonb_each_text(p_atributos) f
             where f.key <> e.key and coalesce(b.attributes ->> f.key,'') <> f.value))
     group by 1,2
  ),
  defs as (
    -- Una definición por clave (Buscatools y Torquetools comparten las mismas).
    select distinct on (key) key, label, unit, position
      from public.product_attribute_definitions where is_filterable order by key, position
  )
  select jsonb_build_object(
    'total', (select count(*) from base b
               where b.ok_marca and b.ok_serie and b.ok_tipo and b.ok_attrs and b.ok_modelo and b.ok_texto),
    'marcas', coalesce((
      select jsonb_agg(jsonb_build_object('slug', app.slugificar(nombre),'nombre',nombre,'cuantos',n) order by n desc, nombre)
        from (select marca as nombre, count(*) as n from base b
               where b.ok_serie and b.ok_tipo and b.ok_attrs and b.ok_modelo and b.ok_texto and marca is not null group by 1) m), '[]'::jsonb),
    'categorias', coalesce((
      select jsonb_agg(jsonb_build_object('slug',slug,'nombre',nombre,'cuantos',n) order by n desc, nombre)
        from (select categoria_slug as slug, categoria as nombre, count(*) as n from base b
               where b.ok_marca and b.ok_serie and b.ok_tipo and b.ok_attrs and b.ok_modelo and b.ok_texto group by 1,2) c), '[]'::jsonb),
    'series', coalesce((
      select jsonb_agg(jsonb_build_object('nombre',nombre,'cuantos',n) order by n desc, nombre)
        from (select series as nombre, count(*) as n from base b
               where b.ok_marca and b.ok_tipo and b.ok_attrs and b.ok_modelo and b.ok_texto
                 and series is not null and series <> '' group by 1) s), '[]'::jsonb),
    'tipos', coalesce((
      select jsonb_agg(jsonb_build_object('nombre',nombre,'cuantos',n) order by n desc, nombre)
        from (select product_type as nombre, count(*) as n from base b
               where b.ok_marca and b.ok_serie and b.ok_attrs and b.ok_modelo and b.ok_texto
                 and product_type is not null and product_type <> '' group by 1) t), '[]'::jsonb),
    'atributos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', d.key, 'label', d.label, 'unidad', d.unit,
               'cubiertos', (select sum(v.n) from valores v where v.key = d.key),
               'opciones', coalesce((
                 select jsonb_agg(jsonb_build_object('valor', v.value, 'cuantos', v.n)
                        -- Métricas (número pelado) antes que imperiales (" o /), cada bloque por número.
                        order by (v.value ~ '["/]')::int,
                                 nullif(substring(v.value from '[0-9]+\.?[0-9]*'),'')::numeric nulls last,
                                 v.value)
                   from (select * from valores v2 where v2.key = d.key order by v2.n desc limit 60) v), '[]'::jsonb))
             order by d.position, d.key)
        from defs d where exists (select 1 from valores v where v.key = d.key)), '[]'::jsonb))
  into v_res;
  return v_res;
end $function$;
