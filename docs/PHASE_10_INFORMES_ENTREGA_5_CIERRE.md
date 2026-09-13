# Fase 10 · Informes — Entrega 5: cierre del módulo

Estado: **propuesta de cierre**, pendiente de revisión. No agrega familias de
informes. Cierra lo entregado en las Entregas 1–4 contra el legacy, con
evidencia medida el **2026-09-13** (hora de Argentina) sobre la base real.

| entrega | contenido | commits (en `main`) |
|---|---|---|
| 1 | Actividad comercial por moneda | `344e5fb`, `811898a` |
| 2 | Pipeline, conversión, cumplimiento, ticket promedio | `3275700`, `9bc9640` |
| 3 | Rankings de clientes y productos, CSV | `2ec8130`, `adfe8ef` |
| 4 | Stock físico, movimientos, kardex | `3914c6b`, `07db289` |
| 5 | Cierre: esta auditoría, suite de cierre, 1 bug de UI | (commit local, sin push) |

Fuente legacy: `app.js` del respaldo, 45.345 líneas, sha256 `82f3454bfd336fa0…`
(el mismo de la Entrega 0).

Estados de la matriz:

- **MIGRADO**: la misma cifra, con la misma definición.
- **MIGRATED_WITH_CORRECTED_MODEL**: la pregunta del legacy tiene respuesta,
  con la regla corregida.
- **REEMPLAZADO**: la necesidad la cubre otra pantalla del ERP.
- **NOT_MIGRATED_BY_DESIGN**: no se copia porque la regla del legacy era
  incorrecta o porque no es un informe.
- **BLOCKED_BY_MISSING_DATA**: no hay datos en el ERP nuevo para calcularlo.

---

## A · Cobertura legacy

### De un vistazo (`renderInformeVistazo`, l. 26245)

| legacy | qué hacía | estado | hoy |
|---|---|---|---|
| Cotizado este mes | Σ `_soloUSD` de cotizaciones del mes (sin moneda = USD, ARS = 0) | MIGRATED_WITH_CORRECTED_MODEL | Comercial › **Cotizado**: por moneda, SIN MONEDA aparte, mes por `quote_date`, mes en curso contra los mismos días |
| Vendido este mes | Σ `_soloUSD` de **todas** las NE del mes | MIGRATED_WITH_CORRECTED_MODEL | **Vendido (entregado)**: sólo remitos confirmados, por moneda |
| Comprado este mes | Σ pedidos a proveedor | BLOCKED_BY_MISSING_DATA | `purchase_orders` = 0 |
| Por cobrar | NE no «facturadas», rotulado «facturas» | BLOCKED_BY_MISSING_DATA | `sales_invoices` = 0, `payments` = 0; la regla «remito = factura» no se copia |
| Actividad últimos 6 meses | conteos apilados por `new Date(fecha)` | MIGRATED_WITH_CORRECTED_MODEL | **Últimos 12 meses** por documento y moneda, mes del string de la fecha (sin corrimiento del día 1) |

### Ventas (`renderInformeVentas`, l. 26309)

| legacy | qué hacía | estado | hoy |
|---|---|---|---|
| Cotizaciones / Pedidos / NE totales | conteo histórico sin período | REEMPLAZADO | conteos por mes y 12 meses en Comercial; totales en los listados de Ventas |
| Monto facturado total | Σ USD de **remitos**, acumulado | NOT_MIGRATED_BY_DESIGN | rótulo falso (no hay facturas); lo entregado se ve en Vendido (entregado) 12 meses por moneda |
| Cotizaciones por mes (12 m, USD) | `_soloUSD` | MIGRATED_WITH_CORRECTED_MODEL | serie de 12 meses por moneda |
| Top 10 productos | por **unidades cotizadas**, por SKU, sin outliers | MIGRATED_WITH_CORRECTED_MODEL | Rankings › Productos: fuente cotizado/pedido/entregado, cantidad o importe por moneda, GRAMPA visible y marcado |
| Top 10 clientes | Σ cotizado USD **por nombre** | MIGRATED_WITH_CORRECTED_MODEL | Rankings › Clientes por `customer_id`, fuente y moneda explícitas |
| Exportar CSV | cotizaciones con columna «Total USD» para cualquier moneda | NOT_MIGRATED_BY_DESIGN | CSV de actividad, pipeline y ranking con columna **Moneda** |

### Compras (`renderInformeCompras`, l. 26367)

| legacy | estado | por qué |
|---|---|---|
| Pedidos a proveedor, notas de proveedor, monto comprado, proveedores activos | BLOCKED_BY_MISSING_DATA | `purchase_orders` 0, `goods_receipts` 0, `supplier_invoices` 0 |
| Pedidos a proveedor por mes, top 10 proveedores | BLOCKED_BY_MISSING_DATA | ídem |
| Exportar CSV («Total USD») | BLOCKED_BY_MISSING_DATA | ídem; cuando haya datos, no se copia el rótulo USD |

### Stock (`renderInformeStock`, l. 26404)

| legacy | qué hacía | estado | hoy |
|---|---|---|---|
| Productos totales | `PRODUCTOS.length` | MIGRADO | «de 21.772 del catálogo» en Stock › Productos |
| Valor stock (al precio venta) | `pu × sr` | NOT_MIGRATED_BY_DESIGN | valorizar con el precio disponible es incorrecto; sin costo (bloqueado) |
| Sin stock | `sr ≤ 0` sobre el **catálogo entero** (21.394) | MIGRATED_WITH_CORRECTED_MODEL | **En cero** sobre saldos existentes (0) + **Sin movimientos registrados** aparte (21.393), que no es «stock 0» |
| Stock crítico (≤ 5) y su lista | umbral fijo | NOT_MIGRATED_BY_DESIGN | sin mínimo por producto; ver E |
| Top 10 por valor de stock | `pu × sr` | NOT_MIGRATED_BY_DESIGN | ídem valorización |
| Kardex (últimos 100, filtro SKU, saldo SV/SR) | movimientos locales de `erp_stock_deltas`, no sincronizados | MIGRATED_WITH_CORRECTED_MODEL | Movimientos del mes paginados con filtros; kardex por producto **y depósito**, saldo mostrado sólo si Σ movimientos = saldo actual |
| Kardex › columna Usuario | usuario local | BLOCKED_BY_MISSING_DATA | `created_by` en 3 de 381 movimientos (los 3 de prueba); los 378 migrados no tienen usuario |

### Evolución (`renderInformeEvolucion`, l. 26502)

| legacy | qué hacía | estado | hoy |
|---|---|---|---|
| Cotizado vs «Facturado» 12 m USD | «facturado» = remitos | MIGRATED_WITH_CORRECTED_MODEL | serie de cotizado, pedidos y entregado por moneda; sin rótulo «facturado» |
| Tasa de conversión | `estado cerrada ∥ convertidaA` / **todas** (borradores incluidos) | MIGRATED_WITH_CORRECTED_MODEL | por `quote_id` con pedido confirmado, siempre «N de N» (hoy 132 de 288) |
| Cotizaciones / vendido acumulado USD | acumulado sin período | REEMPLAZADO | series de 12 meses y comparación de meses, por moneda |
| Pedidos acumulados | conteo | REEMPLAZADO | conteos por mes; listado de Pedidos |

### Archivos adjuntos (`renderBibliotecaArchivos`, l. 26556)

| legacy | estado | por qué |
|---|---|---|
| Biblioteca de adjuntos | NOT_MIGRATED_BY_DESIGN | no es un informe (decisión V8 de la Entrega 0); los adjuntos viven en cada documento; `attachments` = 0 |

### Dashboard ejecutivo (`renderDashboardEjecutivo`, l. 4214)

| legacy | estado | hoy / por qué |
|---|---|---|
| Cobrado este mes | BLOCKED_BY_MISSING_DATA | `payments` 0 (y el legacy sumaba recibos sin moneda) |
| Por cobrar, Aging, Distribución pendiente de cobro | BLOCKED_BY_MISSING_DATA | `sales_invoices` 0 |
| Facturado 6 meses | BLOCKED_BY_MISSING_DATA | sin facturas |
| Facturado por empresa | BLOCKED_BY_MISSING_DATA | sin facturas; además sumaba monedas entre empresas (no se copia) |
| Leads HOT | NOT_MIGRATED_BY_DESIGN | placeholder en 0; no hay leads |
| Pipeline abierto | MIGRATED_WITH_CORRECTED_MODEL | Pipeline: cotizaciones abiertas y pedidos pendientes, por moneda y antigüedad |
| Top 5 clientes del mes | MIGRATED_WITH_CORRECTED_MODEL | sumaba cotizado con comentario «facturado»; hoy Rankings › Clientes, período mes y fuente elegida |
| Flujo de ventas (embudo) | NOT_MIGRATED_BY_DESIGN | leads = 0 fijo; el Pipeline dice explícitamente «No es un embudo» |

### Inicio (`renderDashboard`, l. 5110)

| widget | estado | hoy / por qué |
|---|---|---|
| Cotizaciones / Pedidos / Notas del mes | MIGRADO | conteos del mes en Comercial |
| Vendido — últimos 6 meses | MIGRATED_WITH_CORRECTED_MODEL | el legacy usaba **pedidos**; hoy Vendido = entregado y los pedidos van aparte |
| Tickers Cotizado / Vendido | MIGRATED_WITH_CORRECTED_MODEL | comparaba un mes parcial con uno completo; hoy mismos días del mes anterior, «sin base» si no hay |
| Ticker Unidades vendidas | MIGRATED_WITH_CORRECTED_MODEL | Rankings › Productos › entregado › cantidad, con atípicos marcados |
| Top clientes / Top productos | MIGRATED_WITH_CORRECTED_MODEL | Rankings |
| Cotizaciones por estado | REEMPLAZADO | Ventas › Cotizaciones con filtro de estado; abiertas en Pipeline |
| Total Productos / Total Clientes | REEMPLAZADO | listados de Catálogo y Clientes |
| Ticker Clientes nuevos | BLOCKED_BY_MISSING_DATA | no hay fecha de alta histórica: los 1.014 clientes tienen `created_at` entre 2026-09-08 y 2026-09-13 (importación) |
| Stock bajo (`0 < sv ≤ 5`) | NOT_MIGRATED_BY_DESIGN | umbral fijo, sin mínimo por producto |
| Cotizado / Vendido por vendedor | BLOCKED_BY_MISSING_DATA | `salesperson_id` en 0 cotizaciones y 0 pedidos |
| Bienvenida, Saludo y mis pendientes, Acciones rápidas, Empezar algo nuevo, Actividad reciente, Cotizaciones recientes, Pedidos en curso, Solicitudes de cotización, Tus próximas reuniones, Pendientes, Tu actividad | NOT_MIGRATED_BY_DESIGN (como informe) | son widgets operativos del Inicio, no informes; el Dashboard de React sigue siendo la pantalla de verificación de la Fase 1 (FUTURE_FEATURE fuera de Informes) |

### Estadísticas ADMIN (`renderEstadisticas`, l. 5563) y vecinos

| legacy | estado | por qué |
|---|---|---|
| Vendido / cotizado por vendedor, clientes por vendedor | BLOCKED_BY_MISSING_DATA | `salesperson_id` 0 / 0; `creadoPor` del legacy en 21/288 y 20/166 |
| Clientes por rubro | BLOCKED_BY_MISSING_DATA | `customers.industry` en 1 de 1.014 |
| Finanzas › Aging y Cash flow (l. 28434, 28474) | BLOCKED_BY_MISSING_DATA | sin facturas ni cobros; además mezclaban monedas con rótulo USD |
| CRM › Informes (l. 28259) | NOT_MIGRATED_BY_DESIGN | código muerto |

### Resumen de la matriz

| estado | ítems |
|---|---:|
| MIGRADO | 2 |
| MIGRATED_WITH_CORRECTED_MODEL | 16 |
| REEMPLAZADO | 5 |
| NOT_MIGRATED_BY_DESIGN | 11 |
| BLOCKED_BY_MISSING_DATA | 15 |
| **total** | **49** |

(Cada fila de las tablas es un ítem; el grupo de 11 widgets operativos del
Inicio cuenta como uno.)

---

## B · Migrado y migrado con modelo corregido

Todo en `#/informes` (admin y employee), dos pestañas:

**Comercial** (`?mes=AAAA-MM`)

- Vendido (entregado), Pedidos confirmados y Cotizado del mes contra el
  anterior, por moneda, con SIN MONEDA aparte y aviso de documentos en
  revisión.
- Últimos 12 meses por documento y moneda.
- Pipeline: cotizaciones abiertas y pedidos pendientes, por moneda y
  antigüedad.
- Conversión cotización → pedido por `quote_id`.
- Cumplimiento de pedidos (con y sin evidencia).
- Ticket promedio por moneda.
- Rankings de clientes y productos.
- CSV de actividad, pipeline y ranking.

**Stock** (`?vista=stock&mes=AAAA-MM`)

- Resumen de saldos: con stock, en cero, negativo, disponible negativo,
  con reservas.
- Por depósito.
- Productos: con saldo, con movimientos, sin movimientos registrados.
- Antigüedad del último movimiento.
- Movimientos del mes por tipo y origen.
- Tabla de stock por producto y depósito, paginada con búsqueda y filtros,
  con CSV.
- Movimientos del mes paginados con filtros, con CSV.
- Kardex por producto.

## C · Reemplazado

Conteos históricos (listados de Ventas y totales por período), cotizaciones
por estado (filtro de estado en Ventas), totales de productos y clientes
(listados), acumulados de Evolución (series de 12 meses por moneda).

## D · No migrado por diseño

| ítem | razón | tipo |
|---|---|---|
| Archivos adjuntos como informe | no es un informe; los adjuntos viven en el documento | NOT_MIGRATED_BY_DESIGN |
| Reglas de dinero del legacy: `_soloUSD` (sin moneda = USD, ARS = 0), «Total USD» en CSV, «facturado»/«por cobrar» desde remitos, «Todas las empresas» sumando monedas, conversión por estado | incorrectas | NOT_MIGRATED_BY_DESIGN |
| Stock crítico ≤ 5 y Stock bajo del Inicio | umbral fijo sin mínimo por producto | NOT_MIGRATED_BY_DESIGN (el mínimo es MISSING_DATA) |
| Valorización de stock por precio disponible y Top 10 por valor | el precio de venta no es costo | NOT_MIGRATED_BY_DESIGN (el costo es MISSING_DATA) |
| Embudo con leads = 0 y Leads HOT | placeholder | NOT_MIGRATED_BY_DESIGN |
| Monto facturado total (remitos) | rótulo falso, acumulado sin período | NOT_MIGRATED_BY_DESIGN |
| Widgets operativos del Inicio | no son informes | NOT_MIGRATED_BY_DESIGN / FUTURE_FEATURE (Dashboard) |
| CRM › Informes | código muerto | NOT_MIGRATED_BY_DESIGN |

## E · Bloqueado por datos (re-medido 2026-09-13, sólo lectura)

| dato | medición | bloquea |
|---|---|---|
| costo | `products` no tiene costo; sólo `maintenance_order_parts.unit_cost_snapshot` (0 filas) | margen, rentabilidad, valorización |
| stock mínimo / punto de pedido | sin columna en `products` ni en saldos | stock crítico, reposición |
| facturas | `sales_invoices` 0 | facturado, por cobrar, aging, facturado por empresa |
| cobros | `payments` 0 | cobrado, cash flow |
| vendedor | `salesperson_id` en 0 / 288 cotizaciones y 0 / 166 pedidos | informes por vendedor |
| rubro | `industry` en 1 / 1.014 clientes | clientes por rubro |
| alta de clientes | `created_at` = fecha de importación (2026-09-08 a 2026-09-13) | clientes nuevos |
| usuario del movimiento | `created_by` en 3 / 381 | columna Usuario del kardex |
| compras | `purchase_orders` 0, `goods_receipts` 0, `supplier_invoices` 0 | informe de Compras |
| mantenimiento | `maintenance_orders` 0, `maintenance_assets` 0 | informes de Mantenimiento |
| adjuntos | `attachments` 0 | (no es informe) |

Lista explícita de lo que queda **fuera** de Informes:

| fuera de alcance | razón |
|---|---|
| compras (serie, proveedores, comprado del mes) | MISSING_DATA |
| mantenimiento | MISSING_DATA |
| margen / rentabilidad / valorización de stock | MISSING_DATA (costo) + NOT_MIGRATED_BY_DESIGN (precio ≠ costo) |
| AR/AP: facturado, por cobrar, aging, cobrado, cash flow | MISSING_DATA |
| vendedores | MISSING_DATA |
| rubros | MISSING_DATA |
| leads / embudo | NOT_MIGRATED_BY_DESIGN |
| stock crítico / punto de pedido | MISSING_DATA (mínimo) + NOT_MIGRATED_BY_DESIGN (umbral fijo) |
| clientes nuevos / dormidos | MISSING_DATA (histórico); FUTURE_FEATURE desde ahora |
| widgets del Inicio y dashboard ejecutivo real | FUTURE_FEATURE (fuera de Informes) |
| biblioteca de adjuntos | NOT_MIGRATED_BY_DESIGN |

---

## F · Reglas finales (verificadas en código, pantalla y suites)

| regla | evidencia |
|---|---|
| **Vendido = entregado**: remitos `shipped`/`delivered`. Pedidos confirmados y Cotizado son tarjetas propias | cierre §3: serie de entregas ARS = remitos crudos (29 · 36.816.390,42) |
| **Cotizado** incluye rechazadas y vencidas; no borradores | «Cómo se calcula»; E1 |
| **Nunca se mezclan monedas**: sin total general, sin «Total USD», sin conversión | cierre §3: 0 filas sin moneda en actividad; ranking por importe sin moneda → `parametro_invalido`; §6: 0 «Total USD» en los 3 CSV |
| **SIN MONEDA** es su propia moneda, visible | septiembre: 15 remitos · 12.996.570,72 SIN MONEDA; «19 remitos en revisión · 15 sin moneda» |
| **Fechas**: mes por `document_date` (string), día 1 en su mes, hora de Argentina para «hoy», mes en curso contra los mismos días | E1 §rangos; en pantalla «1–13 sep 2026 contra 1–13 ago 2026» |
| **Pipeline**: estado de hoy, rotulado «No es un embudo» | texto en pantalla (también en mes pasado: «lo entregado es de enero 2019») |
| **Conversión** por `quote_id` con pedido confirmado, siempre «N de N»; «aceptada» no alcanza | cierre §3: 132 / 288 = crudos (134 aceptadas ≠ 132 con pedido) |
| **Cumplimiento**: los sin evidencia (21 no consta + 14 no reconstruido) fuera del porcentaje | cierre §3: 166 pedidos cubiertos; porcentaje sobre categorías determinables (código) |
| **Rankings**: por `customer_id` / producto; importe exige moneda; empates por documentos y nombre (`collate "C"`); **GRAMPA.80-4T visible y marcado** «Dato atípico · revisar» | E3 §7: puesto 1 por cantidad entregada, 2 líneas atípicas, no excluido |
| **Stock**: sin saldo ≠ cero; sin movimientos ≠ sin stock; stock negativo ≠ disponible negativo | cierre §3/§5: en cero 0 sobre 379 saldos; 21.393 «Sin movimientos registrados»; negativo 0 y disponible negativo 0 contados por separado |
| **Sin valorización, costo, margen, stock crítico ni punto de pedido** | cierre §4: 0 columnas en las 8 respuestas; la UI sólo los nombra para negarlos |
| **Los 3 movimientos de prueba** (51 `opening_balance` +100, 52 `sale_delivery` −30, 53 `adjustment` −5; SP.S23-BH6, `source_type = test`, «prueba etapa 1», 2026-09-08) **no se borran ni se ocultan** | cierre §5; en pantalla «Prueba (sin documento origen)»; kardex 100 → 70 → 65 verificado |

Terminología en pantalla (barrido de las dos pestañas con sesión real):
«Cotizado», «Pedidos confirmados», «Vendido (entregado)», «SIN MONEDA»,
«Sin evidencia · no determinable», «Sin movimientos registrados», «Disponible
negativo», «Dato atípico · revisar». 0 apariciones de `NaN`, `undefined`,
`null`, `Infinity`, `[object`, «1 pedidos»/«0 pedido» (y equivalentes), ni
valores de estado en inglés.

---

## G · Seguridad

| control | resultado |
|---|---|
| Objetos | 8 funciones `public.informe_*`, todas `SECURITY INVOKER`, `STABLE`, `search_path = public, pg_temp` |
| Permisos de ejecución | `anon` NO, `PUBLIC` NO, `authenticated` sí (catálogo `has_function_privilege` + `aclexplode`) |
| Validación de rol | las 8 validan `app.current_role(p_company)` ∈ {admin, employee} → `sin_permiso` |
| JWT real, 8 RPC × 9 identidades | admin y employee leen; salesperson, technician, customer, distributor, admin de otra empresa, anon y empresa nula rechazados (cierre §2: 8/8 PASS) |
| Escrituras | 0 `insert/update/delete/merge/truncate` en el cuerpo de las 8 (`prosrc`); 0 `.insert/.update/.upsert/.delete` ni lecturas `.from(` en `src/modules/informes` |
| DEFINER nuevos | **0** |
| API expuesta | OpenAPI de PostgREST: exactamente las 8 `/rpc/informe_*`; 0 tablas o vistas con «inform» |
| Menú y ruta | `/informes` privada, menú con `ROLES_INFORMES = ['admin', 'employee']` |

**Advisors de seguridad (2026-09-13):**

- **Nuevos por Informes: 0.** Ningún hallazgo menciona `informe_*`.
- **Preexistentes:**
  - 22 funciones DEFINER ejecutables por `authenticated` (Mantenimiento,
    Emails, WhatsApp, Compras, Ventas, `next_document_number`);
  - la vista `product_availability` SECURITY DEFINER;
  - 5 tablas con RLS sin policies (`app.email_api_secretos`,
    `document_sequences`, `email_send_requests`, `email_sync_log`,
    `whatsapp_webhook_events`);
  - leaked password protection deshabilitada.

**Advisors de performance:**

- 160 FK sin índice, 5 `auth_rls_initplan`, 27 índices sin uso y 36 policies
  permisivas múltiples.
- 0 mencionan Informes. Informes no creó tablas, índices ni policies, así que
  todos son preexistentes.

## H · Performance final (sesión real, navegador, con red)

Cada RPC: 1 llamada de calentamiento + 12 medidas.

| RPC | mediana | p90 | máx |
|---|---:|---:|---:|
| actividad | 204 ms | 206 | 208 |
| pipeline | 228 ms | 401 | 419 |
| ranking (clientes, 12 m, USD, 10) | 241 ms | 287 | 350 |
| stock resumen | 444 ms | 460 | 650 |
| stock catálogo | 484 ms | 548 | 551 |
| stock actual (50) | 383 ms | 437 | 518 |
| movimientos (50) | 305 ms | 391 | 459 |
| kardex (50) | 263 ms | 300 | 367 |

- La primera ronda de actividad tuvo un pico aislado de 2.009 ms. Repetida,
  dio 204 ms de mediana y 208 ms de máximo: fue la red, no la base.
- Carga de Comercial (servidor de desarrollo):
  - desde recarga en frío, los 3 RPC terminan a los 2,76 s;
  - con módulos cacheados, a los 912 ms.
- Cambio de pestaña a Stock, hasta la tabla renderizada: 1.251 ms.
- No se optimizaron arranques en frío.

**Deuda de RLS (sin cambios en esta entrega):**

- El costo del stock crece con las filas leídas bajo RLS, a ~0,2–0,35 ms por
  fila. Cada fila evalúa `app.is_internal(company_id)`, SQL DEFINER no
  inlineable (ver `docs/performance/RLS_COUNT_ANALISIS.md`).
- Sin RLS, el cuerpo del resumen corre en 8 ms.
- **Criterio para intervenir**: la corrección de fondo (helpers de RLS
  inlineables, que cambia RLS y es transversal) se hace cuando se cumpla
  cualquiera de estas condiciones:
  - la mediana con sesión real de `informe_stock_resumen` o
    `informe_movimientos_stock` supere **1 s** en dos mediciones de días
    distintos;
  - `stock_movements` de una empresa supere **5.000 filas en un mes**;
  - un RPC de Informes registre un `statement timeout` (8 s de
    `authenticated`).
- Hoy hay 381 movimientos y medianas de 305–484 ms.

## I · CSV (descargas reales en el navegador)

Descargas interceptadas en la app (blob real), con sesión:

| archivo | filas | BOM | CRLF | `;` | Moneda | resultado |
|---|---:|:-:|:-:|:-:|---|---|
| `informe-actividad-2026-08.csv` | 61 | sí | sí | sí | ARS, USD, EUR | sin «Total USD»; 0 fórmulas |
| `informe-pipeline-conversion-cumplimiento-2026-08.csv` | 44 | sí | sí | sí | ARS, USD, SIN MONEDA, EUR, TODAS (sólo cantidades), no aplica | sin «Total USD» |
| `informe-clientes-entregado-ARS-mes-2026-08.csv` | 2 | sí | sí | sí | ARS | = botón «2 filas» |
| `informe-productos-entregado-cantidad-12m-2026-08.csv` | 393 | sí | sí | sí | no aplica | = botón «393 filas»; GRAMPA fila 1 con 2 líneas atípicas / 1.598.500 |
| `informe-stock-2026-09-13.csv` | 379 | sí | sí | sí | (sin moneda ni valor) | acentos intactos |
| `informe-movimientos-stock-2026-09.csv` → con filtro `salida` → `informe-movimientos-stock-2026-09-salida.csv` | 381 → **2** | sí | sí | sí | — | filtro respetado: −30 y −5 con signo, «Prueba (sin documento origen)» |

- Agosto no trae SIN MONEDA en la actividad, y es correcto: los 32 documentos
  sin moneda (6 cotizaciones, 11 pedidos, 15 remitos) son de 2026-09.
- La suite de cierre (§6) lo verifica sobre las filas del mes en curso con la
  biblioteca de la app:
  - SIN MONEDA escrito, nunca vacío;
  - `texto('=cmd')` → `'=cmd`;
  - 0 celdas con `=`, `+`, `@` o `-` no numérico sin proteger.
- Los CSV de Ventas, Compras, Clientes y Mantenimiento **no se tocaron**
  (deuda N).

## J · Mobile

Con sesión real, las dos pestañas en cada ancho:

| ancho | Comercial | Stock |
|---|---|---|
| 390 (táctil, `pointer: coarse`) | `scrollWidth` 390 = ancho; 0 controles < 44 px; 0 campos < 16 px; 0 desbordes | ídem |
| 430 (táctil) | 430 = 430; 0 / 0 / 0 | ídem |
| 768 | 753 = 753 (barra de scroll); 0 desbordes | ídem |
| 1440 | 1425 = 1425; 0 desbordes; 0 scroll interno inesperado; captura sin degradación | ídem |

**Accesibilidad** (escaneo en ambas pestañas):

- 0 controles sin nombre accesible. Los 50 botones «Kardex» tienen
  `aria-label` «Ver kardex de SKU».
- 14 tablas, todas con caption y `th` con `scope`.
- Pestaña activa con `aria-current="page"`.
- Filtros de ranking con `aria-pressed`.
- Errores con `role="alert"`.
- Encabezados en orden (h1 → h2 → h3).

**Estados vacíos y de error** (verificados en pantalla):

| caso | resultado |
|---|---|
| mes sin datos (`?mes=2019-01`) | «Sin documentos en enero 2019 ni en diciembre 2018», «Sin remitos en los últimos 12 meses»; en Stock los saldos siguen y los movimientos del mes quedan vacíos |
| mes futuro (`?mes=2026-10`, `?vista=stock&mes=2026-12`) | «Ese mes todavía no empezó.», sin «Reintentar» |
| `?mes=basura` | se ignora y muestra el mes en curso |
| error 500 / timeout de servidor (57014 simulado) | «No se pudo leer el informe. Probá de nuevo en un momento.» con «Reintentar»; al reintentar con red sana, carga |
| red caída (`Failed to fetch` simulado) en Stock | ídem |

**El 400 en consola del mes futuro: no es un bug.**

- Con consola limpia, `?mes=2026-10` hace **exactamente 1 llamada** a
  `informe_actividad_comercial` y 1 a `informe_pipeline_comercial`, y
  `?vista=stock&mes=2026-12` hace 1 a `informe_stock_resumen`.
- Las 3 responden HTTP 400 con `code 22023`, `message mes_futuro`. Sin
  reintentos: el hook no reintenta errores conocidos.
- El «Failed to load resource: 400» lo escribe Chrome por cualquier respuesta
  4xx; la app no hace `console.error`.
- El servidor es la autoridad del «hoy» argentino. Un bloqueo en el cliente
  dependería del reloj del navegador, así que se deja así, documentado.

## K · Bugs

| # | bug | severidad | estado |
|---|---|---|---|
| 1 | Con error del RPC (500, timeout, red o mes futuro), el subtítulo de «Informes · Actividad comercial» quedaba en «**Cargando…**» para siempre, al lado de la alerta de error | baja (texto contradictorio) | **corregido** en `InformesPage.tsx`: «Cargando…» sólo mientras carga; con error no se muestra subtítulo. Verificado en pantalla con mes futuro, 57014 simulado, «Reintentar» y carga normal |
| 2 | Las suites E1–E3 contaban las fixtures `zz-*` de la propia corrida como «documentos nuevos», así que los controles fijos del histórico se salteaban siempre | tests | **corregido**: `historicosCongelados` cuenta sólo empresas reales; los controles fijos (15 SIN MONEDA de septiembre, [126, 5, 21, 14], GRAMPA sólo marcado) vuelven a correr |
| 3 | E1–E3 dependían de conteos vivos (288/166/182 totales, 593/600/992 líneas) | tests | **corregido**: fijos sólo los importados congelados (`imported_at`); lo vivo queda como INFO; GRAMPA contra la regla en JS |

Descartados tras medir:

- «· 0» y «1 pedidos» del barrido eran «0 de 14 · 0 %» y «11 pedidos».
- «Actualizando…» permanente: artefacto de una simulación de promesa colgada.
  Con recarga limpia no ocurre.

## L · Regresión

En serie, nunca en paralelo, después de todos los cambios:

| suite | resultado |
|---|---|
| `fase10-informes-entrega1-tests.mjs` | 30 PASS · 0 FAIL |
| `fase10-informes-entrega2-tests.mjs` | 44 PASS · 0 FAIL |
| `fase10-informes-entrega3-tests.mjs` (`--experimental-strip-types`) | 61 PASS · 0 FAIL |
| `fase10-informes-entrega4-tests.mjs` | 77 PASS · 0 FAIL |
| **`fase10-informes-cierre-tests.mjs`** (nueva, `--experimental-strip-types`) | 39 PASS · 0 FAIL |
| **total** | **251 PASS · 0 FAIL** |

La suite de cierre cubre:

1. **Inventario**: 8 RPC exactas con sus parámetros, 0 tablas o vistas
   «inform», ruta, menú y pestañas.
2. **Permisos**: 8 RPC × 9 identidades.
3. **Reglas del legacy no copiadas**, con paridad calculada:
   - SIN MONEDA ≠ USD;
   - vendido = entregado;
   - conversión por `quote_id`;
   - TODAS sin importes;
   - dinero siempre con moneda;
   - cumplimiento total y porcentaje sólo con evidencia;
   - ranking por importe sin moneda rechazado;
   - «en cero» ≠ catálogo.
4. **Sin valuación ni crítico**: columnas de las respuestas y texto de la UI.
5. **Stock**:
   - Σ movimientos = `on_hand`;
   - Σ reservas = `reserved`;
   - resumen = filas;
   - movimientos 51–53 presentes.
6. **CSV** con la biblioteca real sobre filas reales.
7. **Sin escrituras**:
   - código sin DML;
   - huella de ventas y stock de las empresas reales igual antes y después
     de las 8 RPC;
   - histórico 288 / 166 / 182 congelado.

No depende de números vivos: todo lo fijo es histórico importado.

Estáticos:

- `npm run lint` 0 problemas.
- `npm run typecheck` 0 errores.
- `npm test` 56 archivos · 663 tests.
- `npm run test:isolated` 56 · 663.
- `npm run build` 0 warnings.

Regresión general de rutas con sesión:

- Dashboard, Catálogo, Cotizaciones, Pedidos, Notas de entrega, Clientes,
  Proveedores, Pedidos de compra, Notas de entrada, Facturas de proveedor,
  Equipos, Órdenes de servicio, Emails, Informes (Comercial y Stock): todas
  renderizan su h1 sin error.
- Una ruta inexistente muestra 404.

Navegación E2E con sesión:

- menú → Informes;
- pestañas Comercial ↔ Stock (`?vista=stock`), atrás y adelante;
- `?mes`;
- enlace de revisión → `#/ventas/entregas?revision=1&desde=2026-09-01&hasta=2026-09-13` (Notas de entrega) y vuelta;
- drilldown del ranking → ficha de cliente (`#/clientes/<id>`) y vuelta;
- enlaces de productos → `#/catalogo/<SKU>`;
- botón Kardex → sección con el producto, «Saldo actual: PRIN 2», origen
  «Migración del legacy · sin documento origen»;
- paginadores («Anterior» deshabilitado en la página 1).
- La selección del ranking vuelve al valor inicial al volver de otra
  pantalla: limitación documentada (N), no bloqueante.

**Producción** (verificado 2026-09-13):

- `app.buscatools.com` sirve `assets/index-B2tRhJ4k.js` e
  `InformesPage-3cz6bgzq.js`. Son **idénticos por nombre de hash** a la
  compilación local de `07db289` (HEAD sin cambios de esta entrega).
- El chunk contiene las 8 RPC, «Ese mes todavía no empezó.», «No es un
  embudo» y «Sin movimientos registrados».
- El fix del subtítulo **no está desplegado**: produce
  `InformesPage-DkzBL1GA.js` y no hay push.
- La revisión visual con sesión se hizo en local (dev server, misma base).
  En producción sólo se verificó el bundle.

## M · Objetos de base de datos

| objeto | cantidad |
|---|---:|
| funciones `public.informe_*` (sólo lectura, INVOKER, STABLE) | **8** |
| migraciones de Fase 10 | **8**: `fase10_informes_entrega1_actividad`, `…entrega1_actividad_rangos`, `…entrega2_pipeline`, `…entrega3_rankings`, `…entrega3_rankings_orden`, `…entrega4_stock`, `…entrega4_stock_rendimiento`, `…entrega4_stock_lecturas` (última de la base: `20260913212423 fase10_informes_entrega4_stock_lecturas`) |
| tablas, vistas, índices, secuencias con «inform» | 0 |
| policies | 0 |
| triggers | 0 |
| funciones «inform» fuera de `public` | 0 |
| funciones DEFINER | 0 |
| INSERT / UPDATE / DELETE hechos por Informes | 0 |

Las 8 migraciones sólo contienen `create or replace function` y
`revoke`/`grant`. Esta entrega **no aplica migraciones**.

## N · Deudas técnicas

| deuda | detalle | dónde se resuelve |
|---|---|---|
| Performance de RLS en stock | ~0,2–0,35 ms por fila bajo `app.is_internal`; criterio en H | cambio transversal de RLS (`RLS_COUNT_ANALISIS.md`) |
| Selección del ranking fuera de la URL | dimensión, fuente, medida, período y moneda se pierden al salir de la pantalla | mejora futura de Informes |
| Inyección de fórmulas en CSV de otros módulos | `celda()` de `ventas`, `compras`, `clientes` y `mantenimiento` (`lib/csv.ts`) sólo escapa comillas y separadores: un valor que empieza con `=`, `+`, `-` o `@` sale sin proteger | backlog de esos módulos (no tocados) |
| 3 movimientos de prueba | ids 51, 52, 53 en SP.S23-BH6 (+100, −30, −5, `source_type = test`) | decisión de negocio; Informes los muestra rotulados, no los borra ni oculta |
| Histórico sin moneda | 32 documentos de 2026-09 (6 cot · 11 ped · 15 remitos; remitos 12.996.570,72) | revisión manual en Ventas (`needs_review`) |
| Totales históricos que no cierran con sus líneas | 36 cotizaciones y 31 pedidos (con IVA) | revisión de datos; Informes usa el total guardado para documentos y las líneas para productos |
| Outlier GRAMPA.80-4T | 1.598.500 u. en 2 líneas a precio 0 | corrección del dato o decisión; hoy visible y marcado |
| Usuario de los movimientos | `created_by` en 3 de 381 | desde ahora con uso real |
| Timeout de red en el cliente | un fetch colgado queda en «Leyendo el informe…» (supabase-js sin timeout de cliente, igual en toda la app); el timeout de servidor sí llega como error | transversal |
| `MIGRATION_STATUS.md` desactualizado | no refleja la Fase 10 | actualización transversal (no en esta entrega) |

## O · Invariantes (lo que no puede cambiar sin decisión)

1. Informes sólo lee: 8 RPC INVOKER STABLE, sin DML, sin DEFINER, sin
   `anon` ni `PUBLIC`.
2. Sólo admin y employee de la propia empresa.
3. Nunca un total entre monedas; SIN MONEDA visible; ranking por importe
   exige moneda.
4. Vendido = entregado; pedidos y cotizado aparte.
5. Mes por la fecha del documento, «hoy» de Argentina decidido por el
   servidor.
6. Conversión por `quote_id`, siempre «N de N».
7. Sin evidencia fuera del porcentaje de cumplimiento.
8. Atípicos marcados, nunca excluidos.
9. Stock sobre saldos existentes; «Sin movimientos registrados» no es
   «stock 0»; negativo y disponible negativo por separado.
10. Sin valorización, costo, margen, stock crítico ni punto de pedido hasta
    que existan los datos y la decisión.
11. CSV con BOM, `;`, CRLF, columna Moneda, fórmulas neutralizadas, filtros
    aplicados, generado en el navegador a partir de lecturas paginadas del
    servidor.
12. Los tests fijan sólo el histórico importado; lo vivo se verifica por
    paridad calculada.

## P · Criterio de cierre

Informes se puede declarar **CLOSED / MIGRADO A REACT** si el revisor
acepta:

- [x] cada pantalla y widget del legacy tiene estado (A), sin ítems «pendiente»;
- [x] lo no migrado tiene razón (D, E) y lo bloqueado tiene medición;
- [x] 0 objetos de base nuevos en esta entrega; 8 funciones de sólo lectura en total; 0 DEFINER; 0 advisors nuevos;
- [x] permisos probados con JWT real para todos los roles en las 8 RPC;
- [x] reglas finales (F) verificadas por suite y en pantalla;
- [x] CSV reales de los 6 tipos verificados;
- [x] mobile 390/430/768/1440 y desktop sin degradación;
- [x] estados vacío, error y mes futuro verificados; el 400 documentado;
- [x] bugs reales corregidos (K), sin tocar Ventas, Clientes, Compras, Mantenimiento, Emails ni WhatsApp;
- [x] regresión E1–E4 + cierre en serie, lint, typecheck, tests, aislados y build en verde;
- [x] deudas (N) registradas con dueño;
- [ ] **revisión del usuario** y decisión de push del commit de cierre.
