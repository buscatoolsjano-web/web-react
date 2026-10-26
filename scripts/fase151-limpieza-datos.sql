-- Fase 151 · Limpieza de datos (aplicada con execute_sql, no es migración de código).
-- Se deja como registro de QUÉ se tocó y con qué resguardos.

-- ── 1 · Apex: soft-delete de duplicados malformados ────────────────────────
-- De 44 Apex ocultos (public_slug=null), se borraron (soft, reversible) sólo los
-- que tenían un gemelo CANÓNICO visible (mismo model_code) y no estaban usados en
-- ningún documento: 13 productos, incluido AP.05707 (el 1106 con foto de bit).
-- Los 31 restantes quedan: 2 usados en documentos, 29 sin gemelo (borrarlos
-- perdería el producto). Reversible: set deleted_at=null.

-- ── 2 · Medidas de puntas, estandarizadas ──────────────────────────────────
-- Dentro de product_type Phillips: toda medida de la forma #?(PH)?[0-4](mm)? pasa
-- a PH<n> (#2, 2, PH2 → PH2; #3, 3, #3mm, PH3 → PH3; etc.). ~230 productos.
-- Dentro de product_type Pozidrive: igual pero a PZ<n>. 121 productos.
-- NO se tocó nada fuera de esos dos product_type: el atributo `medida` mezcla
-- Phillips/Pozidriv con milímetros, y «2» en una llave es 2 mm, no PH2.
--   update products set attributes = jsonb_set(attributes,'{medida}',
--     to_jsonb('PH'||substring(attributes->>'medida' from '[0-4]')))
--   where product_type='Phillips' and attributes->>'medida' ~* '^#?(ph)?[0-4](mm)?$' ...

-- ── 3 · Referencias al formato prefijo.modelo ──────────────────────────────
-- Buscatools, 249 referencias corregidas a UPPER(sku_prefix)||'.'||model_code,
-- SÓLO el subconjunto SEGURO: marca con prefijo real (no Genérico), model_code
-- limpio (sin espacios/basura, <=40, no `.REP.`), y cuyo derivado NO choca con
-- ningún producto (borrado o no — la clave única los cuenta). De 404 candidatas,
-- 148 chocaban con un existente y 84 entre sí: ésas NO se tocaron (romperían la
-- clave única o pisarían un código bueno). Torquetools no se tocó: su SKU es la
-- llave del match con el clon de Buscatools.
