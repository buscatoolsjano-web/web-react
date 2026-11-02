-- Fase 223 · Quitar el atributo «sufijos» del sistema de atributos.
--
-- «Lo de los sufijos de puntas y tubos, sácalos. Eso no va más: no tiene que
--  estar en los atributos ni para cuando creo un nuevo producto.»
--
-- `sufijos` era un `product_attribute_definitions` en las DOS empresas
-- (Buscatools y Torquetools). Ya no es filtrable desde la Fase 135, así que no
-- estaba en los filtros del catálogo, pero SÍ seguía apareciendo en el alta
-- —guiada y formulario—, porque el alta ofrece todos los atributos de la
-- categoría, filtrables o no. Vínculos que tenía:
--   Buscatools  → «Balanceadores», «Puntas y tubos»
--   Torquetools → «Herramientas»
--
-- Se borra la DEFINICIÓN, sus OPCIONES y sus vínculos con categorías. NO se
-- toca `products.attributes`: 6.611 productos conservan su valor `sufijos` en el
-- jsonb (es dato, y borrarlo sería destructivo e irreversible). Reversible:
-- recrear la definición y re-vincularla devuelve el atributo.
begin;

delete from product_attribute_options o
using product_attribute_definitions d
where o.definition_id = d.id and d.key = 'sufijos';

delete from product_attribute_categories pac
using product_attribute_definitions d
where pac.attribute_definition_id = d.id and d.key = 'sufijos';

delete from product_attribute_definitions d
where d.key = 'sufijos';

commit;
