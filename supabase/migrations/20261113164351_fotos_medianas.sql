-- La foto GRANDE también optimizada: versión mediana WebP de 1200 px.
--
-- «Es importante que estén todas bien comprimidas para que la web cargue
-- mucho más rápido.» Las miniaturas (400 px, `thumb_url`) ya cubren listados y
-- tarjetas, pero la ficha del producto y la galería seguían bajando el
-- ORIGINAL: hasta 2,5 MB, y 984 fotos desde sitios de terceros (apexbits,
-- buscatool.com). `scripts/miniaturas-fotos.mjs` arma ahora también una
-- mediana de 1200 px en `catalogo-publico/medianas/<md5(source_url)>.webp`
-- (muestra: propias 312 KB → 38 KB, buscatool 36 → 18, apexbits 46 → 28) y la
-- guarda en `medium_url`. Las de terceros quedan así COPIADAS en el bucket.
--
-- 1. La columna `medium_url`.
-- 2. El trigger que reusa versiones existentes ahora completa las dos.
-- 3. La web usa la mediana: la ficha (vista `catalogo_publicable`), el listado
--    (`imagenUrl`, la grande de respaldo) y la portada de las categorías pasa
--    a la miniatura (se ve de 48 px).
--
-- El original no se toca ni se borra: `source_url` sigue siendo la identidad
-- de la foto (no repetirla en un producto, el nombre de sus versiones).

alter table public.product_images add column if not exists medium_url text;

comment on column public.product_images.medium_url is
  'Versión mediana WebP (1200 px) en catalogo-publico/medianas/<md5(source_url)>.webp. La arma scripts/miniaturas-fotos.mjs; null = todavía no, se usa source_url.';

-- ── 2. El trigger: las dos versiones, si ya existen ─────────────────────────
create or replace function app.miniatura_existente()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_md5 text;
  v_base text := 'https://jiudqbusyknubonpedde.supabase.co/storage/v1/object/public/catalogo-publico/';
begin
  if new.source_url is null then
    return new;
  end if;
  v_md5 := md5(new.source_url);
  if coalesce(new.thumb_url, '') not like '%/miniaturas/%' and coalesce(new.thumb_url, '') not like '%.mini.webp'
     and exists (select 1 from storage.objects o where o.bucket_id = 'catalogo-publico'
                    and o.name = 'miniaturas/' || v_md5 || '.webp') then
    new.thumb_url := v_base || 'miniaturas/' || v_md5 || '.webp';
  end if;
  if new.medium_url is null
     and exists (select 1 from storage.objects o where o.bucket_id = 'catalogo-publico'
                    and o.name = 'medianas/' || v_md5 || '.webp') then
    new.medium_url := v_base || 'medianas/' || v_md5 || '.webp';
  end if;
  return new;
end $function$;

-- ── 3a. La ficha pública: la mediana si la hay ───────────────────────────────
create or replace view app.catalogo_publicable as
 SELECT p.id,
    p.company_id,
    p.sku,
    p.name,
    p.model_code,
    p.series,
    p.product_type,
    p.description,
    app.atributos_publicos(p.attributes) AS attributes,
    p.origin_country,
    p.weight_g,
    p.is_kit,
    p.public_slug,
    p.created_at,
    b.name AS marca,
    c.name AS categoria,
    COALESCE(c.slug_publico, c.slug) AS categoria_slug,
    i.storage_path AS imagen_path,
    COALESCE(i.medium_url, i.source_url) AS imagen_url,
    i.alt_text AS imagen_alt
   FROM ((((products p
     JOIN companies c0 ON (((c0.id = p.company_id) AND c0.catalogo_publico)))
     JOIN brands b ON (((b.id = p.brand_id) AND b.is_active)))
     JOIN product_categories c ON (((c.id = p.category_id) AND c.publica)))
     LEFT JOIN LATERAL ( SELECT pi.storage_path,
            pi.source_url,
            pi.medium_url,
            pi.alt_text
           FROM product_images pi
          WHERE (pi.product_id = p.id)
          ORDER BY pi.is_primary DESC NULLS LAST, pi."position", pi.created_at
         LIMIT 1) i ON (true))
  WHERE ((p.deleted_at IS NULL) AND (p.status = 'active'::text) AND (p.public_slug IS NOT NULL));

-- ── 3b. El listado: la grande de respaldo también es la mediana ─────────────
do $$
declare
  v_def text := pg_get_functiondef('public.catalogo_publico_listar(text,text,text,integer,integer,text,text,jsonb,text,jsonb)'::regprocedure);
  v_nueva text;
begin
  v_nueva := replace(v_def,
    'select pi.storage_path, pi.source_url, pi.thumb_url, pi.alt_text',
    'select pi.storage_path, pi.source_url, pi.thumb_url, pi.medium_url, pi.alt_text');
  v_nueva := replace(v_nueva,
    '''imagenUrl'', i.source_url,',
    '''imagenUrl'', coalesce(i.medium_url, i.source_url),');
  if v_nueva = v_def or position('pi.medium_url' in v_nueva) = 0
     or position('coalesce(i.medium_url, i.source_url)' in v_nueva) = 0 then
    raise exception 'catalogo_publico_listar cambió: no calzaron los reemplazos';
  end if;
  execute v_nueva;
end $$;

-- ── 3c. La portada de las categorías: se ve chica, va la miniatura ──────────
do $$
declare
  v_def text := pg_get_functiondef('public.catalogo_publico_categorias()'::regprocedure);
  v_nueva text;
begin
  v_nueva := replace(v_def,
    'pp.category_id, pi.source_url',
    'pp.category_id, pi.source_url, pi.thumb_url');
  v_nueva := replace(v_nueva,
    'coalesce(cats.portada_url, port.source_url)',
    'coalesce(cats.portada_url, port.thumb_url, port.source_url)');
  if v_nueva = v_def or position('port.thumb_url' in v_nueva) = 0 or position('pi.thumb_url' in v_nueva) = 0 then
    raise exception 'catalogo_publico_categorias cambió: no calzaron los reemplazos';
  end if;
  execute v_nueva;
end $$;
