-- Fase 110 · Clonar el catálogo de Buscatools en Torquetools (reconciliación).
--
-- Pedido: Torquetools tiene que tener la misma base de productos que Buscatools,
-- pero INDEPENDIENTE (filas propias, otra company_id; un producto nuevo en una
-- no aparece en la otra), SIN precios ni histórico de Buscatools. Los precios en
-- EUR que Torquetools ya tenía se conservan, matcheando por SKU.
--
-- Decisión (confirmada con el usuario): en vez de borrar los 14.476 de
-- Torquetools y reclonar, se RECONCILIA — 100% aditivo, sin borrados (borrar
-- rompería el histórico: 1.763 productos están en documentos). Los ~6.269
-- productos propios de Torquetools (SKU que no existe en Buscatools) se dejan.
--
-- Empresas: Buscatools = bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c
--           Torquetools = 492a0ee9-220f-4dc8-9eaa-ec914ea10907
-- Ejecutado el 2026-10-22 vía execute_sql (service role).
--
-- Resultado: Torquetools 14.476 → 28.078 productos; 11.318 precios EUR intactos;
-- 0 SKU de Buscatools faltantes; 16.142 imágenes copiadas. Sin kits (Buscatools
-- no tiene). Triggers que cubren la operación: trg_products_misma_empresa (marca
-- y categoría deben ser de Torquetools → el mapeo es obligatorio),
-- trg_products_validate_attrs (claves por empresa, ya estaban todas),
-- products_slug_publico (autogenera public_slug; se esquiva dando uno explícito
-- porque el autogenerador colisiona en un insert masivo y hay unique
-- products_public_slug_uq por empresa).

-- A · Marcas: clonar a Torquetools las de Buscatools que falten (mapeo por nombre).
insert into brands (company_id, name, sku_prefix, is_active)
select '492a0ee9-220f-4dc8-9eaa-ec914ea10907', b.name, b.sku_prefix, true
from brands b
where b.company_id='bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c'
  and not exists (select 1 from brands t where t.company_id='492a0ee9-220f-4dc8-9eaa-ec914ea10907' and upper(t.name)=upper(b.name));

-- B · Categorías: clonar las que falten (mapeo por slug). slug_publico en null
-- porque es unique GLOBAL y el catálogo público de Torquetools está apagado.
insert into product_categories (company_id, name, slug, slug_publico, publica, is_active, position, needs_review)
select '492a0ee9-220f-4dc8-9eaa-ec914ea10907', c.name, c.slug, null, c.publica, c.is_active, c.position, coalesce(c.needs_review,false)
from product_categories c
where c.company_id='bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c'
  and not exists (select 1 from product_categories t where t.company_id='492a0ee9-220f-4dc8-9eaa-ec914ea10907' and t.slug=c.slug);

-- D.1 · Actualizar los que matchean por SKU (8.207), conservando precio/stock/status.
update products t set
  name=b.name, model_code=b.model_code, series=b.series, product_type=b.product_type,
  attributes=b.attributes, description=b.description, description_long=b.description_long,
  is_kit=b.is_kit, needs_review=b.needs_review, origin_country=b.origin_country,
  ncm_code=b.ncm_code, weight_g=b.weight_g, volume_cm3=b.volume_cm3,
  brand_id=tb.id, category_id=tc.id
from products b
  left join brands bb on bb.id=b.brand_id
  left join brands tb on tb.company_id='492a0ee9-220f-4dc8-9eaa-ec914ea10907' and upper(tb.name)=upper(bb.name)
  join product_categories bc on bc.id=b.category_id
  join product_categories tc on tc.company_id='492a0ee9-220f-4dc8-9eaa-ec914ea10907' and tc.slug=bc.slug
where b.company_id='bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c' and b.deleted_at is null
  and t.company_id='492a0ee9-220f-4dc8-9eaa-ec914ea10907' and t.deleted_at is null and t.sku=b.sku;

-- D.2 · Insertar los de Buscatools que faltan (13.602): fila nueva, sin precio,
-- sin external_*, public_slug explícito y único (público apagado).
insert into products (company_id, sku, name, model_code, series, product_type, attributes,
  description, description_long, is_kit, needs_review, origin_country, ncm_code, weight_g, volume_cm3,
  brand_id, category_id, status, public_slug)
select '492a0ee9-220f-4dc8-9eaa-ec914ea10907', b.sku, b.name, b.model_code, b.series, b.product_type, b.attributes,
  b.description, b.description_long, b.is_kit, b.needs_review, b.origin_country, b.ncm_code, b.weight_g, b.volume_cm3,
  tb.id, tc.id, b.status,
  left(app.slugificar(b.name), 50) || '-cl' || (row_number() over (order by b.id))::text
from products b
  left join brands bb on bb.id=b.brand_id
  left join brands tb on tb.company_id='492a0ee9-220f-4dc8-9eaa-ec914ea10907' and upper(tb.name)=upper(bb.name)
  join product_categories bc on bc.id=b.category_id
  join product_categories tc on tc.company_id='492a0ee9-220f-4dc8-9eaa-ec914ea10907' and tc.slug=bc.slug
where b.company_id='bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c' and b.deleted_at is null
  and not exists (select 1 from products t where t.company_id='492a0ee9-220f-4dc8-9eaa-ec914ea10907' and t.deleted_at is null and t.sku=b.sku);

-- E · Imágenes: copiar las de Buscatools a los productos de Torquetools que
-- matcheen por SKU (mismas URLs; company_id = Torquetools).
insert into product_images (company_id, product_id, source_url, storage_path, thumb_url, kind, position, is_primary, alt_text, checked_at, http_status, bytes)
select '492a0ee9-220f-4dc8-9eaa-ec914ea10907', tp.id, i.source_url, i.storage_path, i.thumb_url, i.kind, i.position, i.is_primary, i.alt_text, i.checked_at, i.http_status, i.bytes
from product_images i
  join products bp on bp.id=i.product_id and bp.company_id='bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c' and bp.deleted_at is null
  join products tp on tp.company_id='492a0ee9-220f-4dc8-9eaa-ec914ea10907' and tp.deleted_at is null and tp.sku=bp.sku;
