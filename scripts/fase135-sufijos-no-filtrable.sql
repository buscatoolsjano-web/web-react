-- Fase 135 · «El sufijo de Puntas: que esté en la descripción, no como filtro.»
--
-- El `sufijos` es un dato de catálogo (la terminación del código de la punta),
-- no una característica por la que la gente quiera filtrar. Estaba marcado
-- `is_filterable = true`, así que aparecía como faceta/columna de filtro. Se
-- apaga en las dos empresas. El valor NO se borra: sigue en `products.attributes`
-- y por lo tanto disponible para mostrarlo en la ficha/descripción del producto.
--
-- Reversible: volver a poner `is_filterable = true` lo trae de vuelta como filtro.
update product_attribute_definitions
set is_filterable = false
where key = 'sufijos';
