# Fase 10 · Informes — Entrega 4: stock físico, movimientos y kardex

Fecha: **2026-09-13**. Base: Supabase `uaxcfufvapzulqvynanp`.

Nueva pestaña **Stock** en `/informes` (`?vista=stock`; la ruta no cambia y
«Comercial» sigue igual): stock actual por producto y depósito, reservado y
disponible, negativos, productos sin movimientos, movimientos del mes y kardex
por producto, con CSV de stock y de movimientos.

SQL: [`docs/database/PHASE_10_INFORMES_ENTREGA_4.sql`](database/PHASE_10_INFORMES_ENTREGA_4.sql) ·
pruebas de base: `scripts/fase10-informes-entrega4-tests.mjs` ·
antecedentes: [0](PHASE_10_INFORMES_ENTREGA_0_AUDITORIA.md) · [1](PHASE_10_INFORMES_ENTREGA_1.md) · [2](PHASE_10_INFORMES_ENTREGA_2.md) · [3](PHASE_10_INFORMES_ENTREGA_3.md).

**Sin tablas, columnas, vistas, índices ni cambios de RLS. Ninguna función
escribe stock. Ventas, Compras y Mantenimiento no se tocaron.** Cinco funciones
de lectura (migraciones `fase10_informes_entrega4_stock`,
`…_stock_rendimiento` y `…_stock_lecturas`, la definitiva).

> **NO STOCK VALUATION · NO CRITICAL STOCK · NO REORDER POINT · NO MARGIN · NO COST**
> hasta que existan datos aprobados. La pantalla no muestra ninguna de esas cifras.

---

## A · Fuentes

| tabla | qué se usa | medido |
|---|---|---|
| `stock_balances` | `on_hand`, `reserved` por `(product_id, warehouse_id)`; sin columna de disponible (se deriva) | **379** filas, sólo Buscatools, todas con `on_hand` > 0, `reserved` = 0 |
| `stock_movements` | append-only; `quantity <> 0` por CHECK (no hay movimientos neutros); `movement_type` con CHECK de 9 valores | **381**: 378 `opening_balance/migration` (8–9/9) + 3 `test` (+100 apertura, −30 venta, −5 ajuste en SP.S23-BH6, etapa 1). Los 381 con `source_id` null |
| `stock_reservations` | `quantity > 0`; las inserta admin/employee/salesperson; sólo `confirmar_entrega` las consume (`source_type = 'sales_order'`) | **0** filas |
| `warehouses` | depósitos reales por empresa | Buscatools `PRIN · Depósito principal`; Torquetools `PRIN` sin saldos |
| `products` | SKU, nombre, `status`, `deleted_at` | Buscatools 21.772, todos activos, 0 borrados |

Triggers existentes (no se tocaron): `app.apply_stock_movement` (AFTER INSERT
en movimientos → suma a `on_hand`) y `app.apply_stock_reservation` (INSERT /
UPDATE / DELETE en reservas → `reserved`). Quien genera movimientos:
`confirmar_entrega` (`sale_delivery`, origen `delivery`), `confirmar_recepcion`
(`purchase_receipt`, `goods_receipt`), `confirmar_consumo_mantenimiento`
(`service_consumption`, `maintenance_order`). Legacy (`erp_stock_deltas`,
`erp_kardex`): **no se usa**.

## B · Stock actual

- **Saldo** = `stock_balances.on_hand` por producto **y depósito**. Nunca una sola cifra sin desglose: la tabla es por depósito y el resumen tiene fila por depósito además del total.
- **Estado**: `con_stock` (> 0) · `cero` (= 0) · `negativo` (< 0).
- Tabla server-side: búsqueda por SKU o nombre (**literal**: `%` y `_` del usuario no son comodines), depósito, estado (con stock, cero, negativo, disponible negativo, con reservas), paginación de a 50, orden SKU → depósito.
- Producto **sin fila de saldo ≠ saldo 0**: no aparece en la tabla (nunca tuvo stock); un saldo con `on_hand = 0` sí aparece como «En cero».
- Productos discontinuados o borrados siguen con su saldo y marca «Inactivo».

**KPIs (sobre saldos existentes, no sobre el catálogo):**

| | Buscatools hoy |
|---|---:|
| saldos producto·depósito | 379 |
| con stock | **379** |
| en cero | **0** |
| stock negativo | **0** |
| disponible negativo | **0** |
| con reservas | **0** |

## C · Reservado y disponible

- **Disponible** = `on_hand − reserved`, derivado en la consulta (no se guarda).
- **Stock negativo** (`on_hand` < 0) y **disponible negativo** (`on_hand − reserved` < 0) son **problemas distintos** y se cuentan y filtran por separado. Un saldo negativo también es disponible negativo; un saldo positivo con reservas de más, sólo disponible negativo.
- Una reserva sobre un producto sin movimientos crea un saldo con `on_hand = 0` y `reserved > 0`: aparece «En cero · Disponible negativo».
- Informes **muestra, no corrige**. No hay botón de ajuste.

## D · Depósitos

- Se leen de `warehouses` de la empresa; nada hardcodeado (`PRIN`, «principal», «Buscatools»).
- El selector de depósito aparece sólo si la empresa tiene más de uno; la tabla siempre muestra el código.
- Un depósito inactivo se marca «Inactivo».

## E · Negativos

- Hoy: **0 negativos, 0 disponibles negativos** (confirmado por la suite contra las filas crudas).
- Mantenimiento puede dejar negativo por diseño (`service_consumption`): si aparece, se ve en la tarjeta «Stock negativo · revisar», en el filtro y en el CSV. Nunca sólo por color: la etiqueta dice «Stock negativo» / «Disponible negativo».

## F · Sin movimiento

**Medido antes de elegir umbrales:**

| días desde el último movimiento | productos |
|---|---:|
| 0–30 | **379** |
| 31–90 | 0 |
| 91–180 | 0 |
| 181–365 | 0 |
| más de 365 | 0 |
| **Sin movimientos registrados** | **21.393** de 21.772 |

Todo el historial del ERP nuevo empieza el 8–9/9 (aperturas), así que hoy la
distribución no permite ningún umbral de «sin rotación»: **se muestra la
distribución y el conteo**, sin rótulos «obsoleto», «dormido» ni «stock muerto».

Además: con saldo registrado 379 · con movimientos 379 · movidos y hoy en cero 0.
El conteo del catálogo (21.393 sin movimientos, 21.393 sin saldo) sale de una
función aparte (ver L).

## G · Movimientos

- **Mes** = el `?mes=` de Informes: tramo del mes elegido (1 → hoy en el mes en curso), por `created_at` **en hora de Argentina** (la suite prueba que 23:30 del último día del mes anterior no cuenta y 00:30 del día 1 sí).
- **Entrada / salida por el SIGNO de `quantity`**, nunca por `movement_type`.
- **No se suman unidades de productos distintos**: el resumen cuenta movimientos, entradas, salidas, productos, depósitos y movimientos sin documento origen.
- Por tipo y por origen: conteos con los valores reales.
- Lista server-side paginada (50), más reciente primero (`created_at desc, id desc`), filtros por tipo, sentido y depósito.
- Origen: tipo en castellano + número del documento cuando `source_id` apunta a un remito, recepción u orden de servicio (con **enlace a su pantalla real**); si `source_id` es null: «**Sin documento origen**». `migration` → «Migración del legacy», `test` → «Prueba».

**Septiembre 2026 (1–13):** 381 movimientos · 379 entradas · 2 salidas · 379
productos · 1 depósito · 381 sin documento origen. Por tipo: saldo inicial 379,
ajuste 1, entrega de venta 1. Por origen: migración 378, prueba 3.

Etiquetas de `movement_type` (del CHECK real): saldo inicial, recepción de
compra, entrega de venta, ajuste, transferencia entrante / saliente,
devolución recibida / enviada, consumo en servicio técnico. Un valor nuevo que
no esté en la lista se muestra tal cual.

## H · Kardex

- Producto obligatorio: se elige con «Kardex» en la tabla de stock o buscándolo entre los productos con saldo. Un producto sin movimientos no tiene kardex.
- Depósito opcional; orden más recientes / más antiguos; paginado de a 50.
- **Saldo después de cada movimiento** = Σ `quantity` por depósito en orden `(created_at, id)` (el `id` resuelve los movimientos del mismo instante, p. ej. los 3 de prueba).
- **Sólo se muestra si está verificado**: la suma total del depósito tiene que coincidir con `stock_balances.on_hand`. Si no, el saldo va «—» con «no verificable» y un aviso. La suite lo prueba desalineando a propósito un saldo de fixture.
- `inicia_con_apertura` indica si el primer movimiento es un saldo inicial.

**Opening balance:** 379 aperturas (378 de migración + 1 de prueba), **una
por cada par producto·depósito con movimientos, y siempre el primer
movimiento** (0 pares sin apertura, 0 aperturas que no sean primeras). Con eso,
el saldo histórico se reconstruye completo **desde el 8–9/9**; lo anterior
vivía en el legacy.

Kardex real SP.S23-BH6: saldo inicial +100 → 100 · entrega de venta −30 → 70 ·
ajuste −5 → **65** = saldo actual, verificado.

## I · Paridad

| control | Buscatools |
|---|---|
| Σ `stock_movements.quantity` = `on_hand`, por par | **379 / 379**, 0 desfasados |
| movimientos sin fila de saldo (huérfanos) | **0** |
| saldos sin movimientos | **0** |
| Σ reservas = `reserved`, por par | **379 / 379** (0 reservas) |
| saldo / movimiento / producto / depósito de otra empresa | **0** |
| kardex de 40 productos reales = regla en JS | **40 / 40**, saldo verificado en todos |

No se corrigió nada.

## J · CSV

Mismo patrón que la Entrega 3: **consulta y paginación en el servidor** (de a
500, con los filtros activos) y **generación del archivo en el navegador**
(`lib/csvStock.ts`). `;`, CRLF, UTF-8 con BOM, fechas ISO, protección contra
inyección de fórmulas en todo texto. **Sin moneda ni valor.**

| archivo | columnas |
|---|---|
| `informe-stock[-estado][-depósito][-busqueda]-AAAA-MM-DD.csv` | SKU · Producto · Deposito · En stock · Reservado · Disponible · Estado stock · Estado producto · Ultimo movimiento |
| `informe-movimientos-stock-AAAA-MM[-tipo][-sentido][-depósito].csv` | Fecha · SKU · Producto · Deposito · Tipo · Sentido · Cantidad (con signo real) · Origen · Referencia |

Verificado con descargas reales: 379 filas de stock; 2 salidas del mes con
`-5` y `-30` y «Prueba (sin documento origen)»; BOM presente.

## K · Seguridad

| control | resultado |
|---|---|
| rol | las cinco funciones validan `app.current_role(p_company) in ('admin','employee')` antes de leer (la RLS de stock deja leer a todo interno) |
| `SECURITY INVOKER` | sí en las cinco; la RLS de cada tabla aplica |
| multiempresa | todo filtrado por `company_id = p_company`, también los joins a productos, depósitos y documentos de origen |
| grants | `revoke all from public, anon` · `grant execute to authenticated`; ACL medida `postgres`, `authenticated`, `service_role`; `search_path = public, pg_temp`; `STABLE` |
| parámetros | lista blanca de estado, tipo y sentido; límite 1..500; búsqueda ≤ 100; mes futuro rechazado |
| advisors (security) | ninguna de las cinco funciones aparece; los hallazgos son previos |
| JWT reales | admin y employee leen; salesperson, technician, customer, distributor, admin ajeno, anon y empresa nula rechazados, en las cinco |

## L · Performance

Latencia con red (Buscatools, 5–9 llamadas, mediana):

| función | 1ª versión | final |
|---|---:|---:|
| `informe_stock_resumen` | 601 ms | **~470–500 ms** |
| `informe_stock_catalogo` (aparte) | — | **~500 ms**, cacheada 30 min |
| `informe_stock_actual` (50 filas) | 601 ms | **~350–390 ms** |
| `informe_stock_actual` (500, CSV) | 709 ms | ~640 ms (una corrida 1,5 s) |
| `informe_movimientos_stock` (50) | 298 ms | **~285–295 ms** |
| `informe_movimientos_stock` (500, CSV) | 547 ms | ~550 ms |
| `informe_kardex_producto` | 184 ms | **~185–205 ms** (piso) |
| piso de red (Informes E1) | | ~190 ms |

Navegador: búsqueda en la tabla 385–679 ms en pantalla; CSV de movimientos 417
ms; CSV de stock (379 filas) 1,5 s.

**EXPLAIN / causa, medida:** el cuerpo del resumen **sin RLS** corre en
**8 ms** (`Execution Time: 8.093 ms`, 24 buffers). El resto es la RLS: cada
fila leída de `stock_balances`, `stock_movements`, `warehouses` y `products`
evalúa `app.is_internal(company_id)` (SQL `SECURITY DEFINER`, que consulta
`company_memberships` y no se inlinea; ver
`docs/performance/RLS_COUNT_ANALISIS.md`). No es un problema de índices:
**0 índices nuevos**. Cambios aplicados, sin tocar RLS ni pasar a DEFINER:

1. el conteo del catálogo (21.772 productos) sale del resumen a `informe_stock_catalogo`, pedida en paralelo y cacheada;
2. productos por id con `LATERAL` en vez de join (el planner barría `products`);
3. una sola lectura de `stock_movements` en el resumen (antes dos) y depósitos leídos una vez, no uno por saldo.

**Riesgo abierto:** el costo crece con las filas leídas (~0,2–0,35 ms por fila
bajo RLS). Con miles de movimientos por mes, el resumen y los movimientos
superarán el segundo. La corrección de fondo es la de `RLS_COUNT_ANALISIS.md`
(helpers de RLS inlineables), que cambia RLS y **queda fuera de esta entrega**.

## M · Mobile y accesibilidad

| ancho | resultado |
|---|---|
| 390 (táctil) | sin desborde global; 0 controles < 44 px; 0 campos < 16 px; tablas de stock, movimientos y kardex en tarjetas |
| 430 (táctil) | ídem |
| 768 | sin desborde ni scroll interno; tablas en tarjetas (container query) |
| 1440 | tablas completas, sin scroll interno |

- Pestañas con `aria-current="page"` (conservan `?mes`).
- Tablas con `caption` y `th scope`; búsquedas en `form role="search"`.
- Estados en texto («Stock negativo», «Disponible negativo», «Inactivo»).
- Paginador con `aria-live`; botones de exportar con `aria-label`.
- Cambiar de mes no desmonta la vista: filtros y producto del kardex se conservan.

## N · Bugs

### Datos (no se corrigen)

1. **3 movimientos de prueba en producción** (`source_type = 'test'`, «prueba etapa 1», 8/9) sobre SP.S23-BH6: +100, −30, −5 → saldo 65. Son filas reales de la base; Informes los muestra como «Prueba». La Entrega 0 los había contado como «379 aperturas + 2 de prueba»: son 378 aperturas de migración, 1 apertura de prueba y 2 movimientos de prueba.
2. **Los 381 movimientos no tienen documento origen** (`source_id` null): las aperturas de migración y las pruebas no tienen documento.
3. El histórico de ventas (182 remitos migrados) **no generó movimientos**: el stock del ERP arranca en las aperturas del 8–9/9.

### Producto nuevo (Entrega 4) — encontrados y corregidos antes del commit

1. **Resumen y stock actual > 500 ms** → catálogo aparte, joins por id y una sola lectura por tabla (L).
2. **Al cambiar de mes se desmontaba la vista** y se perdían los filtros → `keepPreviousData` en el resumen.
3. **El kardex decía «empieza con el saldo inicial migrado»** para una apertura de prueba → «el primer movimiento es un saldo inicial».
4. **El título de movimientos decía «septiembre 2026»** para el tramo parcial → «1–13 sep 2026».

### Otras fases (se reporta, no se toca)

1. Ventas (`services/stock.ts`, panel de stock del documento) muestra disponible **acotado a 0** («nunca negativo»); Informes muestra el valor real, negativo incluido. No es un error de datos, pero las dos pantallas pueden mostrar cifras distintas cuando haya reservas de más.

### Errores propios (tests, scripts, edición)

1. Al editar el SQL con `String.replace`, `$$` se convirtió en `$` en la función del catálogo → detectado y corregido antes de aplicar (10 delimitadores verificados).
2. `lib/csv.ts` pasó a importar código de `./stock`, lo que rompía la suite de la Entrega 3 (Node no resuelve imports sin extensión) → CSV de stock movidos a `lib/csvStock.ts`.
3. Esperados contados a mano mal en la suite (con stock 6, no 5; aperturas del mes 3; entradas/salidas 6/5) → corregidos antes de la primera corrida.
4. Warnings de fast refresh por exportar funciones desde componentes → `lib/vista.ts` y `hooks/useMesInformes.ts`.

## Tests

| suite | resultado |
|---|---|
| `scripts/fase10-informes-entrega4-tests.mjs` | **77 PASS · 0 fallos** |
| Entregas 1, 2 y 3 (regresión) | 0 fallos cada una |
| `npm run lint` · `npm run typecheck` | 0 errores, 0 warnings |
| `npm test` · `npm run test:isolated` | 56 archivos · **663** tests cada uno |
| `npm run build` | OK · `InformesPage` 82,07 kB JS (19,67 kB gzip) + 13,77 kB CSS |

Suite de base: las 5 funciones × 8 identidades + empresa nula; 11 rechazos de
parámetros; stock (filas y orden contra la regla, positivo en dos depósitos,
cero, negativo, disponible negativo, reserva sin movimientos, discontinuado,
nunca movido, empresa ajena, 5 filtros de estado, depósito, búsqueda literal y
por nombre, paginación); resumen del mes y del mes anterior contra la regla
(45 y 37 cifras), límites del mes en hora argentina, catálogo; movimientos
(filas, orden y 5 filtros); kardex (5 casos contra la regla, saldo final =
actual, mismo instante por id, saldo no verificable, negativo sin apertura,
vacíos, paginación); Buscatools (paridad total, resumen, 379 filas de stock,
movimientos del mes, kardex SP.S23-BH6 y de 40 productos); base intacta con
huella de movimientos, saldos y reservas de Buscatools y Torquetools.

Unitarios nuevos (13, `lib/stock.test.ts`): resumen (total, depósito, tramos,
tipos), catálogo, estados y disponible negativo, cantidades con signo, saldo
verificado, etiquetas de tipo y origen, enlaces sólo con ruta real, «Sin
documento origen», CSV de stock y de movimientos (fórmulas, negativos, sin
moneda), BOM, nombres de archivo, pestaña.

No se corrieron suites de Ventas, Compras, Mantenimiento ni O4: no se tocó
ningún objeto compartido (funciones, triggers, RLS o tablas de stock).

## O · Limitaciones

1. **NO STOCK VALUATION · NO CRITICAL STOCK · NO REORDER POINT · NO MARGIN · NO COST.**
2. Performance bajo RLS por fila (L): aceptable con el volumen actual, no con miles de movimientos por mes sin la mejora de RLS pendiente.
3. Kardex e historial desde el 8–9/9; lo anterior no está en el ERP.
4. La selección de filtros y el producto del kardex no van en la URL (sí `?vista` y `?mes`).
5. Sin CSV de kardex; sin filtro «desde/hasta» libre (el mes de Informes alcanza para los movimientos; el kardex es completo y paginado).
6. Sin unidad de medida en productos: las cantidades se muestran tal cual.
7. Compras no tiene documentos productivos: no hay sección de compras; `purchase_receipt` ya tiene etiqueta y enlace para cuando existan.
8. `MIGRATION_STATUS.md` no se actualizó.
