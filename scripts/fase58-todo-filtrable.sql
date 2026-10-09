-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Fase 58 · E5 — Que todo se pueda filtrar                                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- EL PEDIDO. «Necesito que estén todos los atributos filtrables, que todo se
-- pueda filtrar».
--
-- 13 de los 26 atributos no eran filtrables. Y la división ya estaba hecha:
-- `show_in_sheet` es la columna con la que la Fase 43 sacó de la ficha lo que
-- NO es una característica del producto sino contabilidad de la importación.
--
--   show_in_sheet = true   características reales. SIETE no eran filtrables:
--                          sufijos (3.306 productos), longitud_raw (366),
--                          alimentacion (91), peso_kg (69),
--                          dim_balanceador (34), peso_embalado_kg (16),
--                          dim_caja (12).
--   show_in_sheet = false  catalogo_id («speedrill»), catalogo_pagina (la hoja
--                          del PDF escaneado), modelo, marca_disp (repite la
--                          columna Marca de la tabla), categoria_full, codigo.
--
-- ASÍ QUE LA REGLA QUEDA: SE FILTRA LO QUE SE MUESTRA. Todo lo que la ficha
-- lista como característica se puede filtrar. Los seis del import siguen
-- afuera: un filtro «Página de catálogo: 37» o un «Marca (display)» al lado del
-- filtro de Marca de verdad serían justo la clase de información de más que
-- hace que no se entienda cuál es el dato que importa.
--
-- La regla además se mantiene sola: un atributo nuevo que se muestre en la
-- ficha nace filtrable, y el bloque de verificación de abajo falla si alguna
-- vez las dos columnas se separan.
--
-- NO HAY QUE TOCAR NINGUNA FUNCIÓN. `catalog_facets` ya mira `is_filterable`, y
-- `search_products` no lo mira: filtra por las claves que se le pasen. Alcanza
-- con el flag.
--
-- EFECTO MEDIDO, filtros de atributos por categoría después del cambio:
--   Balanceadores 11 · Atornilladores 9 · Accesorios 7 · Remachadoras 7
--   Llaves de impacto 6 · Llaves dinamométricas 5 · Puntas y tubos 4 · Otros 4
--
-- Y ninguno desborda: en Puntas y tubos, `sufijos` tiene 7 valores distintos
-- (`medida`, con 234, ya era filtrable desde antes).

begin;

update public.product_attribute_definitions
   set is_filterable = true
 where show_in_sheet and not is_filterable;

commit;

-- ── Verificación: que las dos columnas digan lo mismo ──────────────────────

do $$
declare v_falta text; v_de_mas text;
begin
  select string_agg(key, ', ' order by key) into v_falta
  from public.product_attribute_definitions
  where show_in_sheet and not is_filterable;

  if v_falta is not null then
    raise exception 'Quedaron características sin poder filtrar: %', v_falta;
  end if;

  select string_agg(key, ', ' order by key) into v_de_mas
  from public.product_attribute_definitions
  where not show_in_sheet and is_filterable;

  if v_de_mas is not null then
    raise exception 'Residuo del import quedó filtrable: %', v_de_mas;
  end if;

  raise notice 'OK · se filtra exactamente lo que se muestra.';
end $$;

-- ── Lo que ESTO NO ARREGLA, y hay que mirar aparte ─────────────────────────
--
-- Al medir los filtros por categoría quedaron a la vista dos problemas de
-- DATOS, no de configuración, que no se tocan acá porque arreglarlos es decidir
-- qué producto lleva qué atributo:
--
--   · `dim_balanceador` («Dimensiones», de un balanceador) aparece en
--     Atornilladores y en Remachadoras. `product_attribute_categories` se
--     deriva de los productos reales, así que esto significa que hay
--     atornilladores y remachadoras con ese atributo cargado. Es un error de
--     carga en los productos.
--   · Llaves dinamométricas no tiene NINGÚN atributo de torque, que es
--     justamente lo que define a una llave dinamométrica. Sus 2 productos no
--     tienen `torq_min` ni `torq_max` cargados.
