# Fase 7 · Mantenimiento — Entrega 3: cotización, repuestos y consumo

Estado: **CERRADA Y VERIFICADA EN PRODUCCIÓN**. Los cuatro gaps de integridad
que midió la auditoría previa están cerrados, y la ficha de la orden tiene sus
dos pestañas nuevas.

| | |
|---|---|
| Commits | `5825577` entrega · `a98aa68` tres correcciones de la verificación |
| CI | dos corridas, 13/13 pasos + deploy |
| Producción | `https://app.buscatools.com` — circuito completo ejercido con sesión real |

**Fuera de alcance y no empezado**: torque operativo, cierre final desde la UI,
`revoke insert on stock_movements` y WhatsApp.

| | |
|---|---|
| Auditoría previa | [`PHASE_7_MANTENIMIENTO_ENTREGA_3_AUDITORIA.md`](PHASE_7_MANTENIMIENTO_ENTREGA_3_AUDITORIA.md) |
| Migraciones | cuatro · SQL canónico en [`database/PHASE_7_MAINTENANCE.sql`](database/PHASE_7_MAINTENANCE.sql) |
| Suite | [`scripts/fase7-mantenimiento-entrega3-tests.mjs`](../scripts/fase7-mantenimiento-entrega3-tests.mjs) |
| Fixtures | [`scripts/fase7-mantenimiento-entrega2-fixtures.mjs`](../scripts/fase7-mantenimiento-entrega2-fixtures.mjs) |

---

## A · Los gaps corregidos

| # | gap medido en la auditoría | cómo quedó |
|---|---|---|
| **O1** | un writer de la empresa A podía escribir en una orden de la B y reescribirle el total | `app.coherencia_empresa_mant()` en las **cuatro** tablas hijas: `child.company_id` tiene que ser el de su orden |
| **O2** | producto, depósito o punto de revisión de otra empresa entraban sin que nada los mirara | `app.coherencia_refs_mant()` valida cada referencia contra la empresa de la fila, y el depósito además tiene que estar activo |
| **O3** | las seis transiciones de `quote_status` pasaban por un UPDATE suelto; desaprobar no dejaba rastro | máquina de estados + dos RPC con marcador de transacción |
| **O4** | `authenticated` puede insertar en `stock_movements` a mano | **NO se tocó**, por decisión tuya: afecta a Ventas y Compras, que están cerradas. Queda anotado abajo como prioridad de seguridad |

### O1, en una frase

La RLS miraba `company_id` **de la fila**, que es el del usuario. Nadie lo
comparaba con el de la orden. Ahora sí, y es la misma lección del fix de las
policies tautológicas: **una fila hija no se autoriza por su propio
`company_id`**.

## B · El schema

Cuatro migraciones, ninguna con datos que migrar (las seis tablas tenían 0
filas).

```
fase7_entrega3_monedas_cotizacion_y_costo
fase7_entrega3_coherencia_empresa_y_referencias
fase7_entrega3_maquina_de_estados_de_la_cotizacion
fase7_entrega3_la_cotizacion_nace_pendiente
```

| cambio | qué |
|---|---|
| `maintenance_orders.quote_currency` → **`quote_currency_code`** | trece columnas de moneda en la base se llaman así; ésta era la única `*_currency` de documento. La FK a `currencies(code)` ya existía y viajó con la columna |
| **`maintenance_order_parts.unit_cost_currency_code`** | `text` → `currencies(code)`, nullable |
| **`chk_mop_costo_moneda`** | `unit_cost_snapshot is null or unit_cost_currency_code is not null` |
| 8 triggers nuevos | coherencia de empresa (×4), referencias (×3), moneda de la cotización (×1) |
| 1 trigger nuevo en `maintenance_orders` | la máquina de estados de la cotización |
| 1 trigger nuevo en `maintenance_order_parts` | `part_added` / `part_removed` |
| 2 RPC nuevas | `aprobar_cotizacion_mantenimiento`, `rechazar_cotizacion_mantenimiento` |
| 1 función reemplazada | `app.auditar_orden_mantenimiento()`, para que el evento de cotización lleve total, moneda, por y motivo |

**Una puerta que encontré al implementar y no estaba en la lista.** La máquina
de estados sólo cubría el UPDATE, así que una orden podía **nacer** con
`quote_status = 'approved'`: una aprobación que nunca se auditó, y además una
cotización aprobada con cero líneas que después el cierre rechaza. Se agregó la
cuarta migración: **una orden nace con la cotización pendiente**.

## C · `quote_currency_code`

La regla que decidiste, implementada tal cual:

* una orden **puede existir sin moneda** mientras no tenga nada valorizado;
* al aparecer la **primera línea con importe** (`unit_price > 0`), la moneda es
  obligatoria — lo impone `app.moneda_cotizacion_mant()`;
* una línea **sin cargo** entra igual sin moneda: un diagnóstico bonificado es
  un caso real;
* **no se puede quitar** la moneda si ya hay líneas con importe;
* con la cotización `approved` o `rejected`, **la moneda queda congelada**;
* cambiar la moneda **no convierte ningún importe**. No hay tipo de cambio en
  la base y no se inventó uno: los números siguen siendo los que cargó la
  persona. La pantalla lo dice.

## D · `unit_cost_currency_code`

`NO asumir USD`, tal como pediste. Y la razón está medida en la auditoría:

| fuente candidata de costo | qué hay |
|---|---|
| columna de costo en `products` | **no existe** |
| `price_lists` / `product_prices` | 4 listas, 12.505 precios — **todas de VENTA**, todas USD |
| último precio pagado a proveedor | **0 pedidos confirmados, 0 recepciones, 0 facturas** |
| `stock_movements` | **no tiene columna de costo** |

Por eso: **carga manual o `NULL`**, nunca autocompletado. Y si hay costo, hay
moneda. El panel lo explica en pantalla, para que nadie lo tome por un olvido.

**La separación se mantiene fuerte**: `maintenance_quote_lines.unit_price` es
lo que se le **cobra** al cliente; `maintenance_order_parts.unit_cost_snapshot`
es lo que **costó**. Pueden tener distinto importe y distinta moneda, y nada
los sincroniza. Probado.

## E · La máquina de estados

```
pending ──aprobar_cotizacion_mantenimiento()──▶ approved   (terminal)
pending ──rechazar_cotizacion_mantenimiento()─▶ rejected   (terminal)
```

Todo lo demás lo rechaza el servidor. Medido, las seis transiciones:

| | antes | ahora |
|---|---|---|
| `pending → approved` | UPDATE suelto | **sólo por la RPC** |
| `pending → rejected` | UPDATE suelto | **sólo por la RPC** |
| `approved → pending` | **permitido y sin auditar** | **rechazado** `23001` |
| `approved → rejected` | permitido | **rechazado** `23001` |
| `rejected → pending` | **permitido y sin auditar** | **rechazado** `23001` |
| `rejected → approved` | permitido | **rechazado** `23001` |
| nacer aprobada | permitido | **rechazado** `23001` |

La puerta es la misma de `cerrar_orden_mantenimiento()` y de
`confirmar_consumo_mantenimiento()`: un marcador local de transacción. **Por un
UPDATE no se pasa, así que la auditoría no se puede saltear.**

Dos reglas de la RPC de aprobar:

* **exige al menos una línea**. La regla ya existía —el cierre rechaza una
  cotización aprobada y vacía— y se adelantó al momento de aprobar, para que no
  se pueda llegar al cierre con una orden imposible de cerrar;
* **exige moneda**.

Rechazar **no** exige líneas: que el cliente no haya querido presupuesto
también es información.

## F · La UI de la cotización

Pestaña **Cotización** en la ficha de la orden, con el contador de líneas.

Mientras está pendiente: elegir moneda, agregar línea libre o con producto del
catálogo, cantidad, precio, descripción, editar, borrar y reordenar con ↑↓.
Después de resolverla, **sólo lectura**, y dice quién la aprobó.

| decisión | por qué |
|---|---|
| el subtotal de la línea se muestra como **«Vista previa: el total lo calcula el servidor»** | porque es exactamente eso. `line_total` y `quote_total` los pisa un trigger |
| reordenar usa una posición libre intermedia | `line_no` es único por orden: intercambiar de frente choca con el índice |
| aprobar pide confirmación con el importe en el botón | «Confirmar: aprobar por ARS 151.500,00». Es definitivo |
| el aviso de «elegí la moneda» aparece sólo si falta | y aclara que las líneas sin cargo se pueden cargar igual |

## G · La UI de repuestos

Pestaña **Repuestos**, con el contador.

Buscar producto server-side, cantidad, depósito (preseleccionado el
`is_default`), costo opcional y moneda del costo — que se habilita **sólo si
hay costo**. Muestra, por línea, **stock actual → stock después**.

La proyección agrupa por **producto y depósito** y resta todas las líneas
pendientes de ese par: dos líneas del mismo repuesto se descuentan las dos.

El texto de la pantalla dice, con todas las letras, que el costo no se completa
solo y por qué, y que **agregar un repuesto no mueve stock**.

## H · Consumo y stock

Botón **Confirmar consumo** con confirmación en dos pasos. Usa
`confirmar_consumo_mantenimiento()`.

Probado **por la UI, no sólo por la suite**: dos repuestos, 3 y 1 unidades,
partiendo de saldo 0.

```
movimientos creados   2 · service_consumption · -3 y -1
source_type/source_id maintenance_order / la orden
saldos                -3 y -1
eventos de auditoría  1 (consumption_confirmed, «2 repuestos»)
```

Cuando la proyección da negativo, el panel muestra un aviso ámbar **y deja
confirmar igual**: la reparación ya ocurrió y no registrarla haría que el
sistema mienta sobre una herramienta que ya tiene el repuesto puesto.

Después del consumo, las líneas quedan «Consumido el …», sin botón de quitar.

## I · RLS

Sin cambios de policy: las que puso la entrega 1 ya eran correctas. Lo que
cambió es que ahora **además** se valida la coherencia con el documento padre.

| identidad | filas | por id | por `parent_id` | escritura | RPC de cotización |
|---|---|---|---|---|---|
| admin | ve las suyas | ve | ve | permitida | permitida |
| employee | = admin | | | permitida | permitida |
| salesperson | 0 | — | — | **rechazada** | rechazada |
| technician | 0 | — | — | rechazada | rechazada |
| customer | **0** | **0** | **0** | **`42501`** | **`42501`** |
| distributor | **0** | **0** | **0** | **`42501`** | **`42501`** |
| anon | **0** | — | — | **`42501`** | **`42501`** |

Y el **fast-path**: un externo llamando `rechazar_cotizacion_mantenimiento()`
sobre una orden **ya rechazada** recibe «Sin permiso», no el `{ya_estaba: true}`
que le confirmaría que existe. Las dos RPC nuevas verifican el permiso **antes**
del atajo idempotente, igual que las de Compras después del bug que apareció ahí.

## J · Mobile

Medido en el navegador con datos reales y sesión, en las dos pestañas nuevas:

| ancho | puntero | scroll horizontal global | controles < 44 px | campos < 16 px |
|---|---|---|---|---|
| **390** | grueso | **no** | **0** | **0** |
| **430** | grueso | **no** | **0** | **0** |
| **767** | grueso | **no** | **0** | **0** |
| **768** | fino | **no** | enlace de tabla a 18 px | 0 |
| **1440** | fino | **no** | ídem | 0 |

A 768 con puntero fino la tabla de líneas (640 px mínimo) scrollea **dentro de
su propia caja**; el documento no scrollea en ningún ancho. En mobile las dos
pestañas usan tarjetas, no tabla.

### Probado por la UI, no sólo medido

| flujo | resultado |
|---|---|
| elegir moneda USD | el subtotal pasó a mostrarse «USD 240,00» |
| agregar una línea | total **USD 240,00**, calculado por el servidor |
| aprobar con nombre | «La aprobó Sra. Gutiérrez, compras», panel en sólo lectura |
| confirmar consumo | 2 movimientos, saldos −3 y −1, 1 evento |
| historial | los eventos nuevos, legibles |

## K · Bugs

**Uno del producto, encontrado al implementar:**

* **Una orden podía nacer con la cotización aprobada**, salteando la máquina de
  estados y la auditoría. Cerrado con la cuarta migración, y probado.

**Uno de la UI, encontrado en la revisión:**

* El historial mostraba **«Cotización aprobada · pending → approved»**: el
  detalle repetía la etiqueta y encima sin traducir. Ahora muestra lo que la
  etiqueta no dice — **«ARS 151.500,00 · por Sra. Gutiérrez, compras»**—, y lo
  mismo para el consumo («2 repuestos») y los repuestos («4134200 × 3»).

**Tres míos, en scripts:**

* La suite comparaba `'200.0000'` contra el `200` que devuelve jsonb.
* La limpieza borraba las empresas **antes** que la auditoría, que tiene FK a
  `companies`: la empresa de prueba quedaba viva.
* El `limpiar` de las fixtures **no contemplaba el consumo**: no borraba los
  movimientos de stock ni recalculaba saldos. Se detectó al verificar
  invariantes, se corrigió, y ahora además barre movimientos de servicio
  huérfanos de corridas anteriores.

## L · Regresión

| | |
|---|---|
| Suites de base | **21 / 21**, 0 FAIL |
| Unitarios | **527 / 527** (los mismos con `test:isolated`) |
| `tsc --noEmit` · `eslint` · `build` | limpios |

La suite de la entrega 1 hubo que **actualizarla**, no arreglarla: aprobaba y
rechazaba con UPDATE directo y creaba una orden ya rechazada. Las tres cosas
ahora las rechaza el servidor por diseño, así que pasó a usar las RPC.

### Invariantes al terminar

| | esperado | medido |
|---|---|---|
| equipos · órdenes · líneas · repuestos | 0 / 0 / 0 / 0 | **0 / 0 / 0 / 0** |
| mediciones · checks · auditoría | 0 / 0 / 0 | **0 / 0 / 0** |
| puntos de revisión | 16 | **16** |
| empresas · clientes · proveedores | 2 / 1010 / 142 | **2 / 1010 / 142** |
| stock_movements · stock_balances | 381 / 379 | **381 / 379** |
| saldos con deriva contra sus movimientos | 0 | **0** |
| delivery_lines · quote_lines · order_lines | 600 / 992 / 593 | **600 / 992 / 593** |
| product_images | 8859 | **8859** |
| **productos Buscatools** | **21.772** | **21.772** |

Las cuatro secuencias de mantenimiento en 1.

## M · Los 14 tests de integridad

| # | caso | resultado |
|---|---|---|
| I1 | orden empresa A + quote_line empresa B | **RECHAZADO** `23514` |
| I2 | orden empresa A + part empresa B | **RECHAZADO** `23514` |
| I3 | part con producto de otra empresa | **RECHAZADO** `23514` |
| I4 | part con depósito de otra empresa | **RECHAZADO** `23514` |
| I5 | `pending → approved` | **PASS** + auditado una vez, con total y moneda |
| I6 | `pending → rejected` | **PASS** + auditado una vez, con el motivo |
| I7 | `approved → pending` | **RECHAZADO** `23001` |
| I8 | `approved → rejected` | **RECHAZADO** (UPDATE y RPC) |
| I9 | `rejected → pending` | **RECHAZADO** `23001` |
| I10 | `rejected → approved` | **RECHAZADO** (UPDATE y RPC) |
| I11 | línea valorizada sin moneda | **RECHAZADO** `23514` |
| I12 | línea valorizada con moneda | **PASS** |
| I13 | costo informado sin moneda de costo | **RECHAZADO** `23514` |
| I14 | costo NULL + moneda NULL | **PASS** |

Más: medición y revisión de otra empresa rechazadas, punto de revisión de otra
empresa rechazado, `line_total` y `quote_total` manipulados recalculados,
`line_no` duplicado, quitar la moneda con importes cargados, aprobar sin
líneas, cerrar con la cotización pendiente, `part_added` / `part_removed`,
editar un borrador sin generar eventos, agregar sin mover stock, aprobar sin
mover stock, consumo con saldo negativo, idempotencia, **concurrencia real con
dos conexiones**, atomicidad, `consumed_at` a mano, borrar y editar un consumido,
RLS de seis identidades y el fast-path.

## N · Verificación final en producción

Hecha sobre `https://app.buscatools.com` con sesión real y fixtures temporales,
ejerciendo la UI —no consultando la base y dando por hecho que la pantalla la
refleja—.

| qué | resultado |
|---|---|
| pestañas Cotización y Repuestos | renderizan con su contador |
| línea libre · con producto · sin cargo · valorizada | las cuatro |
| reordenar ↑↓ | cambia el orden, el total no se mueve |
| editar | 12.000 → 15.500 y el total pasó de 151.500 a **155.000** |
| agregar y borrar | 155.000 → 162.800 → **155.000** |
| **total de la UI vs. servidor** | **ARS 155.000 = suma exacta de las 4 líneas** |
| total sin moneda | muestra `0,00` **sin prefijo**, y avisa que falta elegirla |
| línea sin cargo sin moneda | **entra**, como dice la regla |
| línea con importe sin moneda | **rechazada por el servidor**, con su mensaje |
| aprobar | «Confirmar: aprobar por USD 240,00», después sólo lectura y «La aprobó …» |
| rechazada (OS00002) | sin Aprobar, sin Rechazar, sin agregar línea, sin selector de moneda |
| depósito | preseleccionado el `is_default`; la lista sólo tiene el de la empresa |
| costo ↔ moneda | la moneda arranca deshabilitada y se habilita al cargar costo |
| **el selector no ofrece ningún precio** | verificado: los únicos «EUR» del panel son nombres de producto |
| elegir producto | **no pisa el costo cargado** ni completa moneda |
| tres costos conviviendo | ARS 41.200 · sin cargar · USD 1.250 |
| consumo | aviso de negativo, dos pasos, 3 líneas, **3 movimientos, saldos −3/−1/−1, 1 solo evento** |
| idempotencia visual | tras recargar y tras atrás/adelante: 3 consumidos, **el botón no reaparece** |
| historial | legible, sin tecnicismos, sin eventos duplicados |

### Mobile en producción

Las cuatro secciones —ficha, Cotización, Repuestos, historial— en los cinco
anchos, midiendo `scrollWidth` contra `clientWidth`:

| ancho | puntero | scroll horizontal global | controles < 44 px | campos < 16 px |
|---|---|---|---|---|
| **390** | grueso | **no** | **0** | **0** |
| **430** | grueso | **no** | **0** | **0** |
| **767** | grueso | **no** | **0** | **0** |
| **768** | fino | **no** | ↑↓/Editar a 32 px, enlace a 18 px | 0 |
| **1440** | fino | **no** | ídem | 0 |

A 768 con puntero fino la tabla de líneas scrollea **dentro de su propia caja**;
el documento no scrollea en ningún ancho. Los 32 px de ↑↓ son la densidad de
escritorio: con puntero grueso pasan a 44, y a 767 la lista de controles chicos
está vacía.

### Tres cosas que encontró la verificación

| # | clase | qué | estado |
|---|---|---|---|
| 1 | **BUG UX** | si el servidor rechazaba una línea o un repuesto, **el formulario se limpiaba igual** y se perdía lo escrito. Se ve entero cargando una línea con importe antes de elegir la moneda — justo el caso en que uno se entera de la regla | **corregido**: las tres acciones devuelven la promesa de la mutación y el formulario se limpia sólo si la base aceptó. Reverificado en producción: el error se muestra, lo tipeado queda, y al elegir moneda entra sin volver a escribir |
| 2 | **BUG VISUAL** | el pie del selector de productos decía «El producto es opcional…», cierto para un equipo y **falso para un repuesto**, donde el formulario lo marca con asterisco | **corregido**: es una prop y cada panel dice lo suyo; los dos aclaran que elegir un producto no trae ningún precio |
| 3 | **MEJORA UX** | el historial de una cotización rechazada que nunca se valorizó mostraba «0,00» sin moneda | **corregido**: muestra sólo el motivo |

Ninguna de las tres tocó la base.

## O · Lo que NO se hizo

| | |
|---|---|
| **O4 · `revoke insert on stock_movements`** | **SECURITY PRIORITY — HIGH**, por decisión tuya fuera de esta entrega: toca Ventas y Compras, que están cerradas. Antes de tocarlo hay que auditar qué flujos dependen hoy del INSERT directo |
| **P8 · consumo por línea** | la RPC recibe la orden y consume **todas** las pendientes. Cambiar la firma a `p_parts uuid[]` es una decisión abierta |
| Torque operativo | `maintenance_measurements` y `capacidad_torque()` existen; sin UI |
| Cierre final desde la pantalla | `cerrar_orden_mantenimiento()` existe y valida doce cosas; el panel no lo ofrece |
| WhatsApp | no se tocó |

La ficha lo dice en pantalla, en su propio bloque.

---

# PHASE 7 — MANTENIMIENTO · ENTREGA 3 = CLOSED
