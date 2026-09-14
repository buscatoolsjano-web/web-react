# Fase 12 · Configuración — Entrega 3: listas de precios, marcas, categorías y atributos

Configuración suma cuatro secciones: **Listas de precios** y **Atributos** (sólo
lectura), **Marcas** y **Categorías** (el admin las administra con reglas
estrictas). El ERP **no** pasa a ser maestro de productos ni de precios: esa
decisión (U-B-2) sigue abierta y esta entrega no la toma por omisión.

Fecha: 2026-09-14 · Proyecto `uaxcfufvapzulqvynanp` · Migración
`fase12_config_e3_maestros` (estado final en
[`docs/database/PHASE_12_CONFIGURACION_ENTREGA_3.sql`](database/PHASE_12_CONFIGURACION_ENTREGA_3.sql)).

---

## A. Ownership (autoridad por entidad)

| Entidad | Clase | Autoridad | ¿Escribible desde React? | Evidencia |
|---|---|---|---|---|
| **Productos** | A · master en STEL (y legacy) | STEL | **NO** (no se tocó) | 12.592 de 21.772 productos del JSON legacy traen `_importOrigen = "STEL Order API (products)"` (PHASE_3_5 §campos no migrados); el resto viene de enriquecimientos legacy (catálogo APEX). Importados con `scripts/import-catalog.mjs`. U-B-2 abierta. |
| **Listas de precios** | E · no determinado | sin decidir (U-B-2) | **NO** | El legacy **no tenía listas** (E0 §H). «Lista base» = `pu × 3` materializado en la migración (Fase 3.5, opción 2, 12.254 precios). «Distribuidores» y «Especial Cliente Demo» son datos de prueba de la Fase 3 (E0 U-NB-6). Nadie decidió quién es el maestro del precio. |
| **Precios** (`product_prices`) | E · no determinado | sin decidir (U-B-2) | **NO** | Ídem. «Falta UI» no se tomó como autorización. |
| **Marcas** | D · catálogo auxiliar | ERP, **con la ingesta emparejando por nombre** | **Parcial**: crear, desactivar/reactivar, eliminar sin uso. **No renombrar** | Los nombres vienen del catálogo STEL/legacy. `import-catalog.mjs` hace `upsert` por `(company_id, name)`: renombrar una marca haría que una reimportación cree otra con el nombre viejo y le reasigne los productos. `is_active` es sólo del ERP (filtro del Catálogo). |
| **Categorías** | B · taxonomía del ERP | ERP | **Sí**: crear, renombrar (slug fijo), eliminar sin uso | Las 8 categorías de Buscatools las definió la Fase 3.5 (mapeo `CATEGORIA_SLUG` en el importador). La ingesta usa el **slug**, no el nombre: renombrar no rompe nada. |
| **Atributos** | B · estructura del ERP | ERP | **NO** (explícitamente fuera) | 26 definiciones + 70 vínculos con categorías; los valores viven en `products.attributes` (9.031 productos) y el trigger `validate_product_attributes` exige que cada clave esté definida. Cambiar clave/tipo o borrar = migrar productos → rediseño de producto (criterio de freno §50). |

## B. Listas de precios

**Schema real:** `price_lists (id, company_id, name, currency_code FK currencies, is_default, valid_from, valid_to, created_at)`, único `(company_id, name)` y único parcial «una predeterminada por empresa»; `product_prices (id, company_id, price_list_id FK cascade, product_id FK cascade, amount ≥ 0, valid_from NOT NULL, valid_to, created_at)`, único `(price_list_id, product_id, valid_from)`, `CHECK valid_to ≥ valid_from`. `customers.default_price_list_id` asocia clientes.

**Datos medidos:**

| empresa | lista | moneda | predet. | precios | productos distintos | en 0 | vigencia de precios | clientes |
|---|---|---|---|---:|---:|---:|---|---|
| Buscatools | Lista base | USD | sí | 12.254 | 12.254 | 0 | desde 2026-01-01, sin fin | 1 |
| Buscatools | Distribuidores | USD | no | 124 | 124 | 0 | desde 2026-09-08, sin fin | 1 |
| Buscatools | Especial Cliente Demo | USD | no | 124 | 124 | 0 | desde 2026-09-08, sin fin | 1 |
| Torquetools | Lista base | USD | sí | 3 | 3 | 0 | desde 2026-09-08, sin fin | 0 |

- Listas: sin fechas propias (`valid_from/valid_to` nulos); la vigencia está en cada precio.
- **Coherencia:** 0 precios cruzados de empresa, 0 de productos de otra empresa o dados de baja, 0 duplicados lista+producto (+fecha).
- **Un producto en varias listas:** sí (124). **Una lista con varias monedas:** no, la moneda es de la lista.
- **Prioridad / fallback:** no existe en el modelo. Ventas sugiere el precio de la lista **predeterminada** sólo si la moneda coincide con el documento (`productosParaLinea.ts`); no se inventó otra regla.
- 9.518 productos de Buscatools no tienen precio en la lista base (`pu` 0 o anómalo en la migración).
- Rango de importes 0,06 … 617.765,91 (4 decimales). Precio 0 es válido (`amount ≥ 0`) y se muestra.

**UI (sólo lectura):** listado (moneda, predeterminada, precios, vigentes, en 0, vigencia, clientes) → detalle con clientes asociados (hasta 50 + total) y precios **paginados en el servidor** (50 por página, búsqueda por SKU/nombre con comodines literales, filtro de vigencia vigente/futura/vencida). No se bajan los 12.254 precios. Sin filtros en el listado de listas: son 3 por empresa.

## C. Marcas

**Schema real:** `brands (id, company_id, name, logo_path, is_active, created_at)`, único `(company_id, name)` (distingue mayúsculas). **Por empresa**, no globales. Referencias: `products.brand_id` y `maintenance_assets.brand_id` (sin cascade).

**Datos:** 26 (Buscatools 25, Torquetools 1), todas activas, 0 duplicados por mayúsculas/espacios, 0 con espacios de más. 5.456 productos de Buscatools sin marca. Las más usadas: SPEEDRILL 4.928, APEX 3.807, FIAM 3.374, TOHNICHI 2.736. **Hallazgo:** 8 marcas de 2 letras (BR, GE, KI, MI, NA, RR, SI, TO) con 2–4 productos cada una: parecen restos del import. **No se tocaron** (§L).

**Operaciones (admin):**

| Acción | Regla | Impacto máximo |
|---|---|---|
| Crear | nombre normalizado (trim + espacios colapsados), 1–80, sin duplicado por mayúsculas/espacios en la empresa; serializado por empresa (dos altas iguales a la vez → una sola) | 0 productos |
| Desactivar / reactivar | idempotente; informa cuántos productos la usan | la marca deja de aparecer en el filtro del Catálogo; los productos (hasta 4.928) la siguen referenciando; documentos intactos |
| Eliminar | **sólo si 0 productos (incluidos dados de baja) y 0 equipos**; si no, `en_uso:<productos>:<equipos>` | 0 |
| Renombrar | **no disponible** (§A) | — |

## D. Categorías

**Schema real:** `product_categories (id, company_id, parent_id, name, slug, position, needs_review, created_at)`, único `(company_id, slug)`. **Por empresa.** Sin `is_active`. Referencias: `products.category_id` (NOT NULL), `product_attribute_categories` (cascade), `product_attribute_definitions.applies_to_category_id`, `parent_id`.

**Datos:** 9 (Buscatools 8 + Torquetools 1), 0 con padre (sin jerarquía en uso), 0 duplicados. «Otros» tiene 12.588 productos y `needs_review`; «Puntas y tubos» 8.623.

**Operaciones (admin):** crear (slug generado sin acentos, único con sufijo `-2`, posición al final), renombrar (sólo `name`, con conflicto de versión si otro lo cambió, el slug no cambia), eliminar **sólo si 0 productos, 0 atributos vinculados y 0 subcategorías** (`en_uso:<p>:<a>:<h>`). No hay desactivar: la tabla no tiene `is_active` (§N).

## E. Atributos

Existen como maestros configurables en tablas, no como columnas rígidas:

- **atributo** = `product_attribute_definitions (key, label, data_type text|number|boolean, unit, is_filterable, position, applies_to_category_id)` — 26 en Buscatools, 0 en Torquetools;
- **valor** = no hay tabla de valores: son libres dentro de `products.attributes` (jsonb);
- **asignación producto↔atributo** = la clave dentro del jsonb (9.031 productos con atributos), validada por trigger; **atributo↔categoría** = `product_attribute_categories` (70, derivadas de los productos reales).

Hallazgo previo (Fase 3.5): 3 claves con tipo declarado distinto del real (`rpm`, `catalogo_pagina`, `sufijos`). No se corrige acá.

**UI: sólo lectura** (etiqueta, clave, tipo/unidad, filtrable, categorías, productos que la usan). Un editor genérico queda fuera: requiere diseño de producto.

## F. Escribible vs sólo lectura

| Sección | Admin | Employee | Otros roles |
|---|---|---|---|
| Listas de precios (listado y detalle) | lee | lee | sin acceso |
| Marcas | crea, desactiva/reactiva, elimina sin uso | lee | sin acceso |
| Categorías | crea, renombra, elimina sin uso | lee | sin acceso |
| Atributos | lee | lee | sin acceso |

Cada pantalla de sólo lectura lo dice con su motivo (no hay botones deshabilitados sin explicación): listas → «Sólo lectura: los precios no se administran desde el ERP todavía» + por qué; atributos → estructura de productos; employee en marcas/categorías → «Sólo un administrador puede…». En marcas, «Eliminar» sólo aparece si no se usa y el texto explica que una marca con productos se desactiva.

## G. Permisos y seguridad

- **Escritura directa cerrada:** se eliminaron las políticas `brands_write`, `categories_write`, `attrdefs_write`, `pac_write`, `pricelists_write`, `prices_write` y se revocó INSERT/UPDATE/DELETE a `anon`/`authenticated` en las 6 tablas. Antes un admin podía escribir cualquier columna por REST y admin + employee los precios. La lectura (SELECT + RLS) no cambió: Catálogo, Ventas, Clientes y Compras siguen leyendo igual. La importación (service role) no cambia.
- **RPC `config_*`** (SECURITY DEFINER, `search_path` fijo, EXECUTE sólo `authenticated`): lectura admin/employee de la empresa; escritura sólo admin de la empresa; ids de otra empresa → `no_encontrado`; empresa ajena → `sin_permiso`.
- **Lista blanca:** `p_datos` sólo acepta `name`; cualquier otra clave (`company_id`, `created_at`, `updated_at`, `slug`, `role`, `status`, `is_active`, `id`, `logo_path`, …) → `campos_no_permitidos`; tipos no texto, vacío, > 80, JSON no objeto → `datos_invalidos`. Fail closed.
- **No existe ninguna función de escritura** para listas, precios ni atributos.
- **Advisors:** 0 ERROR nuevos (el único ERROR, la vista `product_availability`, es preexistente). WARN «SECURITY DEFINER ejecutable por authenticated» pasa de 29 a 41: las 12 RPC nuevas, con guarda de rol adentro, mismo patrón que E1/E2. `catalog_audit` tiene política, no aparece en INFO.

## H. Auditoría

`catalog_audit (company_id, entity_type brand|category, entity_id, entity_name, action, changed_fields, actor_id, created_at)`, mismo patrón que `company_audit`: acciones `BRAND_CREATED`, `BRAND_DISABLED`, `BRAND_ENABLED`, `BRAND_DELETED`, `CATEGORY_CREATED`, `CATEGORY_UPDATED`, `CATEGORY_DELETED`. Guarda el nombre (sirve si la fila se borró). Lectura: admin de la empresa. Nadie escribe directo. **No registra lecturas** ni cambios nulos (renombrar al mismo nombre, desactivar lo inactivo). `PRICE_LIST_*` / `PRICE_ITEM_CHANGED` no existen: no hay escritura de precios. Bitácora real: 0 filas (todo lo probado fue en fixtures).

## I. Performance

Medido con `EXPLAIN ANALYZE` sobre Buscatools real (21.775 productos, 12.254 precios en la lista base):

| Consulta | Tiempo | Plan |
|---|---:|---|
| marcas con uso | 5 ms | index only scan `idx_products_brand` |
| categorías con conteos | 6 ms (156 ms con caché fría) | index only scan `idx_products_category` |
| listas con conteos | 6 ms (299 ms con caché fría) | seq scan de 12.502 precios + agregado |
| atributos con productos que los usan | 83 ms | seq scan + `jsonb_object_keys` sobre 9.031 filas |
| precios de la lista base, página 1 | 86 ms | hash join + window count + top-N |
| precios, última página (offset 12.200) | 67 ms | ídem |
| precios con búsqueda «tohnichi» | 61 ms | `idx_products_name_trgm` / `idx_products_sku_trgm` existentes |

Tiempos en caliente; la primera consulta con caché fría fue la más lenta (299 ms), igualmente por debajo de 500 ms y no sostenida. **No se agregó ningún índice.** Única tabla nueva con índice: `catalog_audit (company_id, created_at desc)` para su lectura por empresa.

## J. Mobile y accesibilidad

Revisión en navegador con el fixture `scripts/fase12-configuracion-entrega3-ui-fixture.mjs` (magic link de un solo uso, sin contraseñas; limpiado), en **390 · 430 · 768 · 1440**: Listas, detalle (121 precios), Marcas, Categorías, Atributos y Numeración → sin desborde horizontal, todos los botones/inputs/selects ≥ 44 px, inputs y selects a 16 px, tabla en escritorio y cards en mobile. Probado de punta a punta: alta con duplicado detectado, alta válida, desactivar con impacto, renombrar categoría, eliminar sin uso, paginación 1–50 / 51–100 / 101–121, búsqueda y filtro de vigencia, empresa vacía (0 listas, 0 marcas, 0 categorías, 0 atributos) y lista sin precios, sin errores. Diálogos con `role=dialog`, `aria-modal`, foco inicial en el campo, Escape; errores asociados con `aria-describedby`/`aria-invalid`; estados con texto (Activa/Inactiva, Vigente/Futura/Vencida, En revisión), no sólo color; paginador con `aria-live`.

## K. Pruebas

| Suite / comando | Resultado |
|---|---|
| `scripts/fase12-configuracion-entrega3-tests.mjs` (nueva) | **70/70** |
| Config E1 (sin `--con-envios`) | 85/85 |
| Config E2 | 71/71 |
| Config E2.5 | 46/46 |
| `regresion-rls-roles.mjs` (RLS del catálogo con JWT reales) | 71 PASS · 0 fallos |
| `npm run lint` · `typecheck` · `build` | verdes |
| `npm test` · `npm run test:isolated` | 64 archivos · 744 tests cada uno |

La suite E3 cubre: lectura y escritura por rol (admin, employee, salesperson, technician, customer, distributor, anon, admin de otra empresa), REST directo en las 6 tablas, inyección de campos y tipos, normalización y duplicados (incluida concurrencia), desactivar/eliminar usadas, slug y conflicto de versión, ids y empresas cruzadas, atributos, paginación/vigencia/búsqueda con `%` y `_`, **invariante histórico** (cambiar el precio maestro, desactivar la marca y renombrar la categoría dejan la cotización idéntica: líneas, snapshots y totales), bitácora sin ruido, y **datos reales idénticos** (productos, marcas, categorías, atributos, vínculos, listas, precios, totales y líneas de cotizaciones/pedidos/remitos, secuencias, clientes con lista).

Frontend: `lib/maestros.test.ts` (16: normalización, duplicados, filtros, borrado, mensajes, vigencia, moneda, precio 0, paginación), `DialogoNombre.test.tsx` (5: error de duplicado asociado, vacío, normalización, sin cambios, error del servidor) y `MaestrosPages.test.tsx` (8: admin vs employee, impacto al desactivar, filtros, mobile en cards, listas sólo lectura, paginación server-side, lista de otra empresa).

**Invariante de datos reales** (antes/después de toda la entrega, medido en la base): productos `21775 · 7cc091e3…`, marcas `26 · e20ae7ef…`, categorías `9 · 1c1b052f…`, atributos `26 · cdbbd06a…`, vínculos 70, listas `4 · 622ca8d3…`, precios `12505 · f1d43ce0…`, líneas de cotización `992 · ade64071…`, de pedido `593 · 2b5bdfe8…`, de remito `600 · a0ab994b…`, totales de cotizaciones/pedidos/remitos, secuencias `1c54eb30…`: **idénticos**.

## L. Bugs y hallazgos (no corregidos)

1. **Marcas de 2 letras** (BR, GE, KI, MI, NA, RR, SI, TO; 2–4 productos cada una): probables restos de la importación. Se pueden desactivar desde la pantalla; unificarlas requiere reasignar productos (fase de Catálogo).
2. **Tipos de atributo inconsistentes** (`rpm`, `catalogo_pagina`, `sufijos`): ya reportado en Fase 3.5.
3. **«Otros»** concentra 12.588 productos con `needs_review`: recategorización pendiente (Catálogo).
4. **Datos de prueba en producción:** «Especial Cliente Demo», «Distribuidores» y la lista de Torquetools (E0 U-NB-6), sin cambios.
5. **`products_write`** sigue permitiendo a admin y employee escribir productos por REST (ninguna pantalla lo usa). Fuera de alcance (no tocar productos); queda para la fase de Catálogo.

## M. Limitaciones

- Precios y listas: sólo lectura hasta U-B-2. Tampoco hay export CSV (no era obligatorio).
- Marcas: no se renombran; el logo (`logo_path`) no se administra.
- Categorías: sin desactivar, sin jerarquía editable, sin reordenar.
- Atributos: sin editor.
- La normalización de duplicados ignora mayúsculas y espacios, **no acentos** («Dinamométrica» ≠ «Dinamometrica»).
- La RPC de clientes de una lista muestra hasta 50 (con total).

## N. Decisiones pendientes

1. **U-B-2 · Maestro de precios y productos** (STEL o ERP). Si es ERP: diseñar edición de precios (admin, RPC con lista blanca, `PRICE_ITEM_CHANGED`, vigencias sin pisar históricos). Si es STEL: ingesta de precios.
2. **U-NB-2 · ¿employee puede cambiar precios?** Hoy nadie puede desde la app (se cerró la escritura directa que lo permitía).
3. **Renombrar marcas:** requiere que la ingesta empareje por id/código externo en vez de nombre.
4. **Desactivar categorías:** agregar `is_active` a `product_categories` (cambio mínimo) y que Catálogo lo respete.
5. **Limpieza de marcas de 2 letras y datos de prueba** (U-NB-6).
6. **Atributos:** si se quiere un editor, definir migración de `products.attributes` y corregir tipos.

**Archivos**

- Base: `docs/database/PHASE_12_CONFIGURACION_ENTREGA_3.sql`.
- Configuración: `lib/maestros.ts` (+test), `services/maestros.ts`, `hooks/useMaestros.ts`, `components/DialogoNombre.tsx` (+test), `pages/ListasPreciosPage.tsx`, `pages/ListaPreciosDetallePage.tsx`, `pages/MarcasPage.tsx`, `pages/CategoriasPage.tsx`, `pages/AtributosPage.tsx`, `pages/MaestrosPages.test.tsx`, `lib/permisos.ts`, `lib/usuarios.test.ts`, `components/ConfiguracionShell.tsx`, `components/Configuracion.module.css`.
- App: `src/app/routes.tsx`, `src/types/database.types.ts`.
- Scripts: `scripts/fase12-configuracion-entrega3-tests.mjs`, `scripts/fase12-configuracion-entrega3-ui-fixture.mjs`.

No se tocó: productos reales, STEL, secuencias, autoridad E2.5, usuarios reales, Empresa, Emails, WhatsApp, Informes, legacy, Make, diseño global.
