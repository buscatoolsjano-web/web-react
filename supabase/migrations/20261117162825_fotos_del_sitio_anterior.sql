-- Fotos del sitio anterior (buscatool.com) para los productos que no tienen
-- ninguna.
--
-- El sitio anterior (WooCommerce) tiene 4.020 productos, todos con foto, con
-- casi el mismo esquema de SKU que el ERP (SP.S2952C, AP.15812). La API
-- pública de la tienda se leyó desde la base con pg_net (las respuestas están
-- en net._http_response) y acá se cruzan con los productos SIN foto, por:
--   1. SKU idéntico;
--   2. misma marca (prefijo) + misma referencia después del punto;
--   3. misma marca + referencia igual al modelo del producto.
-- TOHNICHI es «TH.» allá y «TC.» acá.
--
-- La foto queda como `source_url` externa, igual que las 2.306 que ya venían
-- de buscatool.com: el workflow de miniaturas genera la miniatura y la mediana.
--
-- Todo cruce queda en app.fotos_sitio_anterior, para revisarlo o deshacerlo:
--   delete from product_images i using app.fotos_sitio_anterior f
--   where i.product_id = f.product_id and i.source_url = f.foto;

create table if not exists app.fotos_sitio_anterior (
  product_id uuid primary key,
  company_id uuid not null,
  foto text not null,
  sku_anterior text not null,
  via text not null,
  cargado_en timestamptz not null default now()
);

with resp as (
  select content::jsonb c from net._http_response
  where status_code = 200 and content ~ '^\s*\['
),
viejo as (
  select distinct on (x->>'id') upper(btrim(x->>'sku')) sku, x->'images'->0->>'src' foto
  from resp, jsonb_array_elements(c) x
  where coalesce(x->>'sku', '') <> ''
    and x->'images'->0->>'src' like 'https://www.buscatool.com/wp-content/uploads/%'
),
v as (
  select sku, foto,
         case split_part(sku, '.', 1) when 'TH' then 'TC' else split_part(sku, '.', 1) end pref,
         substr(sku, strpos(sku, '.') + 1) resto
  from viejo
),
sin_foto as materialized (
  select p.id, p.company_id, upper(p.sku) sku, upper(p.model_code) modelo,
         upper(substr(p.sku, strpos(p.sku, '.') + 1)) resto,
         upper(coalesce(b.sku_prefix, '')) pref
  from public.products p
  left join public.brands b on b.id = p.brand_id
  where p.deleted_at is null
    and not exists (select 1 from public.product_images i where i.product_id = p.id)
),
c as (
  select s.id, s.company_id, v.foto, v.sku sku_anterior, 'sku' via, 1 prioridad
  from sin_foto s join v on v.sku = s.sku
  union all
  select s.id, s.company_id, v.foto, v.sku, 'marca+referencia', 2
  from sin_foto s join v on v.pref = s.pref and v.resto = s.resto
  union all
  select s.id, s.company_id, v.foto, v.sku, 'marca+modelo', 3
  from sin_foto s join v on v.pref = s.pref and v.resto = s.modelo
)
insert into app.fotos_sitio_anterior (product_id, company_id, foto, sku_anterior, via)
select distinct on (id) id, company_id, foto, sku_anterior, via
from c
order by id, prioridad
on conflict (product_id) do nothing;

insert into public.product_images (company_id, product_id, source_url, kind, position, is_primary, alt_text)
select f.company_id, f.product_id, f.foto, 'product_image', 0, true, p.name
from app.fotos_sitio_anterior f
join public.products p on p.id = f.product_id
where not exists (select 1 from public.product_images i where i.product_id = f.product_id);
