-- Fase 128 · Ocultar desde Visibilidad no sacaba nada de la web pública.
-- Aplicado con apply_migration el 2026-10-23.
--
-- El gestor de visibilidad (fase 116) oculta poniendo products.public_slug=null
-- —y la deduplicación de APEX hace lo mismo—. PERO las vistas y la RPC del
-- catálogo público NO filtraban por public_slug: su WHERE era sólo
-- `deleted_at is null and status='active'` (más empresa pública, marca activa y
-- categoría publica por los JOINs). Resultado: un producto oculto seguía
-- apareciendo en la lista (con enlace roto, slug null), en el grid de categorías
-- y en las facetas. La ficha individual sí quedaba inaccesible (se busca por
-- slug, y null no tiene URL), por eso el bug no saltaba al abrir un producto.
--
-- Se agrega `public_slug is not null` a las dos vistas publicables y a la RPC de
-- categorías. Ver [[catalogo-publico-mecanica]].

-- ── Vista completa (la usa la ficha / relacionados) ──
create or replace view app.catalogo_publicable as
 SELECT p.id, p.company_id, p.sku, p.name, p.model_code, p.series, p.product_type,
    p.description, app.atributos_publicos(p.attributes) AS attributes,
    p.origin_country, p.weight_g, p.is_kit, p.public_slug, p.created_at,
    b.name AS marca, c.name AS categoria,
    COALESCE(c.slug_publico, c.slug) AS categoria_slug,
    i.storage_path AS imagen_path, i.source_url AS imagen_url, i.alt_text AS imagen_alt
   FROM products p
     JOIN companies c0 ON c0.id = p.company_id AND c0.catalogo_publico
     JOIN brands b ON b.id = p.brand_id AND b.is_active
     JOIN product_categories c ON c.id = p.category_id AND c.publica
     LEFT JOIN LATERAL ( SELECT pi.storage_path, pi.source_url, pi.alt_text
           FROM product_images pi WHERE pi.product_id = p.id
          ORDER BY pi.is_primary DESC NULLS LAST, pi."position", pi.created_at LIMIT 1) i ON true
  WHERE p.deleted_at IS NULL AND p.status = 'active'::text
    AND p.public_slug IS NOT NULL;

-- ── Vista flaca (la usan listar y facetas) ──
create or replace view app.catalogo_publicable_flaco as
 SELECT p.id, p.company_id, p.sku, p.name, p.model_code, p.series, p.product_type,
    p.public_slug, p.attributes, b.name AS marca, c.name AS categoria,
    COALESCE(c.slug_publico, c.slug) AS categoria_slug
   FROM products p
     JOIN companies c0 ON c0.id = p.company_id AND c0.catalogo_publico
     JOIN brands b ON b.id = p.brand_id AND b.is_active
     JOIN product_categories c ON c.id = p.category_id AND c.publica
  WHERE p.deleted_at IS NULL AND p.status = 'active'::text
    AND p.public_slug IS NOT NULL;

-- ── Grid de categorías (consulta las tablas base directo) ──
create or replace function public.catalogo_publico_categorias()
 returns jsonb language sql stable security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'slug', slug, 'nombre', nombre, 'productos', n) order by n desc), '[]'::jsonb)
    from (
      select coalesce(c.slug_publico, c.slug) as slug, c.name as nombre, count(*) as n
        from public.products p
        join public.companies c0         on c0.id = p.company_id and c0.catalogo_publico
        join public.brands b             on b.id = p.brand_id and b.is_active
        join public.product_categories c on c.id = p.category_id and c.publica
       where p.deleted_at is null and p.status = 'active'
         and p.public_slug is not null
       group by 1, 2
    ) t
$function$;
