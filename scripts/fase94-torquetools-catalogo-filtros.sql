-- Fase 94 · Filtros del catálogo de Torquetools (misma lógica que Buscatools).
--
-- Torquetools no tenía atributos cargados, así que sus facetas (encastre,
-- medida, largo…) salían vacías. En vez de parsear nombres —frágil—, se copian
-- los `attributes` YA CURADOS de Buscatools por SKU: 4.573 de 14.476 matchean
-- (el subconjunto de marcas que Buscatools también tiene como registros
-- propios). El resto (multimarca) queda sin atributos: no hay de dónde sacarlos.
--
-- SEPARACIÓN DE EMPRESAS: todo va acotado al company_id de Torquetools. Se LEE
-- de Buscatools pero sólo se ESCRIBE sobre filas de Torquetools. Las dos
-- empresas no se pisan.
--
--   Torquetools = 492a0ee9-220f-4dc8-9eaa-ec914ea10907

-- 1 · Definiciones de atributo PROPIAS de Torquetools. El trigger
--     trg_products_validate_attrs rechaza cualquier clave no declarada POR
--     EMPRESA, así que las definiciones van primero.
insert into product_attribute_definitions
  (company_id, key, label, data_type, unit, applies_to_category_id, is_filterable, position, is_enumerated, show_in_sheet, range_group, range_role, range_label)
select '492a0ee9-220f-4dc8-9eaa-ec914ea10907'::uuid, key, label, data_type, unit, null, is_filterable, position, is_enumerated, show_in_sheet, range_group, range_role, range_label
from product_attribute_definitions
where company_id = (select id from companies where slug = 'buscatools')
  and not exists (
    select 1 from product_attribute_definitions d2
    where d2.company_id = '492a0ee9-220f-4dc8-9eaa-ec914ea10907'
      and d2.key = product_attribute_definitions.key);

-- 2 · Copiar los attributes de Buscatools a Torquetools por SKU, SÓLO sobre
--     productos de Torquetools que todavía no los tienen (idempotente).
with b as (
  select upper(trim(sku)) as sku, attributes
    from products
   where company_id = (select id from companies where slug = 'buscatools')
     and attributes <> '{}'::jsonb
)
update products t
   set attributes = b.attributes
  from b
 where t.company_id = '492a0ee9-220f-4dc8-9eaa-ec914ea10907'
   and upper(trim(t.sku)) = b.sku
   and (t.attributes is null or t.attributes = '{}'::jsonb);

-- 3 · product_attribute_categories (qué atributos ofrece el alta por categoría).
--     La facetas NO lo usa, pero el formulario de alta sí.
insert into product_attribute_categories (company_id, attribute_definition_id, category_id)
select '492a0ee9-220f-4dc8-9eaa-ec914ea10907'::uuid, d.id, c.id
from product_attribute_definitions d
cross join product_categories c
where d.company_id = '492a0ee9-220f-4dc8-9eaa-ec914ea10907'
  and c.company_id = '492a0ee9-220f-4dc8-9eaa-ec914ea10907'
  and exists (select 1 from products p
               where p.company_id = '492a0ee9-220f-4dc8-9eaa-ec914ea10907'
                 and p.attributes ? d.key)
  and not exists (select 1 from product_attribute_categories pac
                   where pac.company_id = '492a0ee9-220f-4dc8-9eaa-ec914ea10907'
                     and pac.attribute_definition_id = d.id
                     and pac.category_id = c.id);
