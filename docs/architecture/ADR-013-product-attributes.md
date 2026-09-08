# ADR-013 — Atributos de producto: columnas vs JSONB

**Estado:** Propuesta · **Fecha:** 2026-09-08 · **Fase:** 2

## Contexto

El catálogo real tiene **21.772 productos y 55 campos distintos**, con una
distribución muy desigual. Llenado medido (valor no vacío):

| Franja | Cantidad | Campos |
|---|---|---|
| **>80%** | 11 | `sku`, `base`, `nombre`, `cat`, `s`, `peso_g`, `volumen_cm3`, `desc`, `descl` (99,7%), `sr`/`sv` (83%) |
| **50-80%** | 3 | `pu` 76,9% · `marca` 74,9% · `_importOrigen` 57,8% |
| **10-50%** | 11 | `tipo` 42,2 · `serie` 41,7 · `origen` 40,5 · `encastre` 38,7 · `largo` 35,7 · `imgs` 34,6 · `ncm` 24,5 · `medida` 21,8 · `sufijos` 15,2 · `_apex*` 16,3 |
| **<10%** | 30 | `sim_sp` 7,8 · `modelo` 2,4 · `min_kg`/`max_kg`/`carcasa` 1,7 · `costo` 1,1 · `rpm` 0,3 · `voltaje` 0,2 · … |

Los dos extremos son malos: 55 columnas dejarían 30 casi siempre vacías;
todo en JSONB haría imposible filtrar e indexar bien.

## Decisión

**Híbrido**, con la línea trazada por **uso**, no sólo por porcentaje.

**Columnas reales (15):** `sku`, `name`, `model_code`, `brand_id`,
`category_id`, `product_type`, `series`, `description`,
`description_long`, `origin_country`, `ncm_code`, `weight_g`,
`volume_cm3`, `status`, `search_vector`.

Dos excepciones deliberadas a la regla del 50%:

- `product_type` (42%) y `series` (42%) **suben a columna** porque son los
  filtros principales del catálogo en la UI.
- `ncm_code` (24%) y `origin_country` (40%) también, porque los consume el
  módulo de Importación.

**`attributes jsonb`** para la cola larga: `encastre`, `largo`, `medida`,
`sufijos`, `min_kg`, `max_kg`, `carcasa`, `rpm`, `torq_min`, `torq_max`,
`voltaje`, `alimentacion`, `ergonomia`…

**Y esto es lo que impide que el JSONB se degrade:**

```
product_attribute_definitions (key, label, data_type, unit,
                               applies_to_category_id, is_filterable)
```

Toda clave usada tiene que estar declarada. Así se sabe qué significa cada
atributo, se construye la UI de filtros sin hardcodear, y se puede
promover una clave a columna cuando crezca.

**A tabla propia:** `sim_sp`/`sim_tc`/`sim_cp`/`sim_ir` →
`product_equivalences`. Son equivalencias con SKUs de la competencia: una
funcionalidad, no un atributo.

**Descartados:** `s` (→ `search_vector`), `_importOrigen`, `_apexPageCatalog`,
`_apexFamilyTitle`, `_apexEnriquecido` — metadatos del proceso de
importación, no datos de negocio.

## Alternativas

| Alternativa | Por qué no |
|---|---|
| 55 columnas | 30 casi siempre nulas; cada atributo nuevo es una migración |
| Todo en JSONB | Sin integridad, sin tipos, filtros lentos, y "JSONB como excusa para no modelar" |
| EAV (`product_attribute_values`) | Un join por atributo; una consulta con 5 filtros se vuelve inmanejable con 21.772 productos |

## Ventajas

- Los campos que se filtran son columnas indexadas.
- Un atributo nuevo específico de una marca no requiere migración.
- El índice GIN sobre `attributes` permite filtrar por atributo igual.
- El registro de definiciones documenta el catálogo y alimenta la UI.

## Desventajas

- Dos lugares donde puede vivir un dato: hay que saber cuál mirar.
- Consultar JSONB es más verboso (`attributes->>'encastre'`).
- Sin tipado fuerte dentro del JSONB (lo mitiga `data_type`).

## Riesgo

Que `attributes` se convierta en un vertedero.

**Mitigación:** `CHECK` que valide que toda clave esté declarada + revisión
periódica: si una clave supera el 50% de llenado, se promueve a columna.

## Impacto futuro

**Alto.** `products` es la tabla más consultada del sistema. Mover un campo
de JSONB a columna es una migración simple; el camino inverso también. Lo
caro sería equivocarse en los 15 campos indexados.

## Datos adicionales que condicionan el diseño

- **5.456 productos (25%) no tienen marca** → `brand_id` es nullable.
- **12.588 productos (58%) caen en la categoría `otros`** → la taxonomía
  hay que rehacerla antes de migrar. Es una decisión de negocio.
- **0 SKUs duplicados** → `sku` es una clave natural confiable.
