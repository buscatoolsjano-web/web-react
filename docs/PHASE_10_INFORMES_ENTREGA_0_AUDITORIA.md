# Fase 10 · Informes — Entrega 0: auditoría del legacy

**Esta entrega no programó, no creó tablas, vistas, RPC ni índices, no tocó
RLS, no modificó el legacy y no escribió ningún dato.** Todo sale de lectura
estática del bundle, de los respaldos read-only que ya existían y de `SELECT`
sobre el ERP nuevo. El script que reproduce las mediciones es
`scripts/fase10-informes-auditoria.mjs` (sólo lectura).

Fecha: **2026-09-13**.

| fuente | huella |
|---|---|
| `app.js` legacy | 5.333.682 bytes · 45.345 líneas · sha256 `82f3454bfd336fa0…` |
| `erp_store` legacy (respaldo 2026-09-09) | 30 claves · sha256 `c396002891e35e06…` |
| `localStorage` de Compras (respaldo 2026-09-10) | 2 claves exportadas, 3 medidas ausentes |
| `productos-data.json` (snapshot local 2026-09-07) | 15.870.983 bytes · 21.772 productos · sha256 `b3e2bd56c556df69…` |
| auditoría de Chrome del origen legacy (2026-09-09) | 55 claves en el origen |
| ERP nuevo | Supabase `uaxcfufvapzulqvynanp`, lectura con `SELECT` |

Las fórmulas del legacy se **replicaron tal cual** en el script, incluida la zona
horaria del navegador (UTC−3), y se corrieron contra los datos reales. Los
números de esta auditoría son esos, no estimaciones.

> Nombres de clientes: sólo como conteos o hash. Números de documento: se citan
> cuando identifican un problema de datos (no son datos personales).

---

## Resumen

**Informes legacy es una sección chica de 6 pantallas de cálculo en el
navegador, sobre `localStorage`, que mide mal casi todo lo que muestra con
dinero.** No tiene filtros de fecha, ni de cliente, ni de moneda; no pagina
nada; y los dos únicos exportes CSV rotulan «Total USD» una columna que mezcla
pesos, dólares y euros.

Los KPIs más ricos del legacy **no están en Informes** sino en el Dashboard
ejecutivo, el panel de widgets de Inicio y Estadísticas (sólo ADMIN): vendido
por vendedor, tendencias, clientes por rubro, aging. Se auditaron también,
porque cualquier «Informes» nuevo los va a reemplazar.

### Los hallazgos que cambian el plan

| # | hallazgo | medido |
|---|---|---|
| 1 | **«Vendido este mes» muestra USD 12.996.570** en septiembre. Son 15 notas de entrega **sin moneda** importadas de STEL Order el 3–8/9, varias de 2,3 millones cada una —claramente pesos—, que `_soloUSD()` cuenta como dólares | 15 NE · 12.996.570,72 |
| 2 | La misma regla infla «Por cobrar» (**USD 13.018.493**), «Monto facturado total» (**USD 13.350.174**) y «Vendido acumulado». Hay **32** documentos sin moneda en total, y **siguen con `currency_code = NULL` en el ERP nuevo** (decisión R4 de Ventas: `needs_review`) | 6 cot · 11 ped · 15 NE |
| 3 | **Zona horaria:** toda fecha es `YYYY-MM-DD`; el navegador la lee como medianoche UTC y en Argentina cae el día anterior. **Los documentos del día 1 se cuentan en el mes anterior** | 20 documentos · 6 meses de cotizaciones y 7 de NE con montos distintos |
| 4 | **«Facturado» y «Por cobrar» salen de notas de entrega**, no de facturas. `erp_facturas` existe vacía; el ERP nuevo tiene **0 facturas y 0 cobros**, y el estado `facturada` de las 140 NE legacy **no se migró** | 0 facturas |
| 5 | **No hay costo en el ERP nuevo.** `pu` del legacy era el costo (el precio de venta es `pu × 3`); se migró sólo el precio de venta derivado. **Margen: imposible sin inventarlo** | 0 columnas de costo |
| 6 | **No hay vendedor en el histórico**: `salesperson_id` y `created_by` vacíos en los 636 documentos migrados. En el legacy, `creadoPor` existe en 21 de 288 cotizaciones | 0 / 636 |
| 7 | **El stock de Informes es distinto en cada navegador**: catálogo estático + `erp_stock_deltas`, que **no se sincroniza**. El KPI «Sin stock» cuenta 21.394 productos (el catálogo entero) y el gráfico «Stock crítico» muestra 20 productos con stock ≤ 0 mientras el KPI de al lado cuenta los 160 con 1 a 5 | 0 de 20 coinciden |
| 8 | **Un outlier domina «Top productos»**: `GRAMPA.80-4T` con cantidad **1.585.000 a precio 0** (y 13.500 a 0) en tres documentos; está igual en el ERP nuevo | 1.598.526 u. cotizadas |

### En una línea

Lo migrable con confianza hoy es **actividad comercial por moneda** (cotizado,
pedido y entregado por mes, conteos, conversión real por vínculo, pendientes,
rankings por cliente y producto) y **stock físico** (existencias, reservas y
movimientos). **No** hay datos para margen, cobranzas, vendedor, rubro,
clientes nuevos, stock crítico ni compras.

---

## A · Mapa legacy

| qué | dónde (`app.js`) |
|---|---|
| menú de Informes (6 entradas) | `SECTIONS.informes`, **240** |
| despacho | `renderInformes()`, **26188** — `_chkTeam()` + subsección |
| helpers | `getMonthSeries` 26199 · `renderKpiCards` 26220 · `renderBarChart` 26230 |
| De un vistazo | `renderInformeVistazo`, **26248** |
| Ventas | `renderInformeVentas`, **26317** |
| Compras | `renderInformeCompras`, **26367** |
| Stock + kardex | `renderInformeStock`, **26404** |
| Evolución | `renderInformeEvolucion`, **26502** |
| Archivos adjuntos | `renderBibliotecaArchivos`, **26556** |
| exportes CSV y filtro de kardex | `wireInformes`, **26759** |
| moneda | `_soloUSD`, **4104** (usado en 32 lugares) |
| CSV genérico | `downloadCSV`, **24215** |
| stock efectivo | `getEffectiveStock` **21952** · `loadKardex` 21969 · `appendKardex` 21971 |
| adjuntos | `loadAttachmentsStore`, **24730** (`erp_attachments`, sin prefijo de empresa) |
| empresa | `_ekey` **349** · `_todasEmpresasCollect` **367** · `_dashLoad` **4060** |
| acceso | `_chkTeam` **1640** · `getPermsFor` **1007** · `TEAM_USERS` **1694** |
| sincronización | `SUPA_SYNC_KEYS` **1183** · poll cada 30 s (**1309**) |
| catálogo | `productos-data.json` por XHR **síncrono**, línea **5** |

**Pantallas vecinas con KPIs** (fuera del menú de Informes):

| pantalla | dónde | acceso |
|---|---|---|
| Inicio → Dashboard ejecutivo | `renderDashboardEjecutivo` **4214** | equipo con permiso `ventas` |
| Inicio → Dashboard (widgets) / Inicio | `renderDashboard` **5110**, `WIDGET_DEFS` **4961** | equipo |
| Estadísticas | `renderEstadisticas` **5563** | **sólo ADMIN** |
| Finanzas → Aging / Cash flow | `renderFinanzasAging` **28434** · `renderFinanzasCash` **28474** | equipo |
| CRM → Informes | `renderCRMInformes` **28259** | **código muerto**: no se llama desde ningún lado |
| «snapshot de negocio» para la IA | ~9400–9520 | interno, no es pantalla |

## B · Pantallas

| pantalla | menú | función | estado | datos | acciones |
|---|---|---|---|---|---|
| De un vistazo | Informes › De un vistazo (default) | `renderInformeVistazo` | **REAL, con bugs** | cot, ped, NE, PC | ninguna |
| Ventas | Informes › Ventas | `renderInformeVentas` | **REAL, con bugs** | cot, ped, NE | CSV |
| Compras | Informes › Compras | `renderInformeCompras` | **REAL sobre datos casi vacíos** | PC (1), NEP (ausente) | CSV |
| Stock | Informes › Stock | `renderInformeStock` | **REAL, con bugs** | catálogo + deltas + kardex | filtro SKU del kardex |
| Evolución | Informes › Evolución | `renderInformeEvolucion` | **REAL, con bugs** | cot, ped, NE | ninguna |
| Archivos adjuntos | Informes › 📎 Archivos adjuntos | `renderBibliotecaArchivos` | **REAL**, pero no es un informe | `erp_attachments` (local) | buscar, tipo, orden, ver, descargar, ir al documento |

No hay placeholders dentro de Informes: las seis entradas tienen
implementación. El placeholder está en el Dashboard ejecutivo (leads «0 · sin
CRM», hardcodeado) y CRM › Informes nunca se muestra.

No hay informes de clientes, productos (más allá del top), márgenes, dormidos,
rotación, cobertura, vendedor (fuera de Estadísticas), mantenimiento, emails ni
WhatsApp. **No se inventan acá.**

## C · Datos

### Fuentes legacy de Informes

| clave | la usa | sincroniza con `erp_store` | estado medido |
|---|---|---|---|
| `erp_cotizaciones` | Vistazo, Ventas, Evolución, CSV, dashboards | sí | **EXISTS** — 288 |
| `erp_pedidos` | Vistazo, Ventas, Evolución, dashboards | sí | **EXISTS** — 166 |
| `erp_notas_entrega` | Vistazo, Ventas, Evolución | sí | **EXISTS** — 182 |
| `erp_pedidos_compra` | Vistazo, Compras, CSV, Cash flow | **no** | **EXISTS en un navegador** — 1 registro |
| `erp_notas_proveedor` | Compras | **no** | **MISSING** en el origen |
| `erp_kardex` | Stock | sí | **EXISTS** — 22 movimientos (30/7–28/8) |
| `erp_stock_deltas` | Stock, dashboard | **no** | **LOCAL ONLY** — no medible; cada navegador tiene el suyo |
| `erp_producto_overrides` | Stock (sr/sv/pu/stock_min) | sí | **MISSING** — no está en `erp_store` |
| `productos-data.json` | Stock | — | **EMBEDDED** — archivo estático de 15,9 MB |
| `erp_attachments` | Archivos adjuntos | **no**, y **sin prefijo de empresa** | **LOCAL ONLY** |
| `erp_facturas` | Dashboard ejecutivo, Finanzas | **no** | **EXISTS VACÍA** |
| `erp_recibos`, `erp_notas_credito`, `erp_facturas_prov` | Dashboard, Finanzas | **no** | **MISSING** |
| `buscatools_clientes_extra` | Estadísticas (rubro) | sí | **EXISTS** |

**Consecuencia:** los informes de Compras, Stock y Archivos, y los KPIs de
cobranza, **muestran números distintos en cada computadora**. Sólo cotizaciones,
pedidos, NE y kardex son compartidos.

### El ERP nuevo

| tabla | filas | nota para informes |
|---|---:|---|
| `sales_quotes` / líneas | 288 / 992 | 86 líneas sin `product_id` (usar `sku_snapshot`) |
| `sales_orders` / líneas | 166 / 593 | 38 líneas sin `product_id`; **132 con `quote_id`** |
| `deliveries` / líneas | 182 / 600 | 62 líneas sin `product_id`; **`unit_price` NULL en las 600**; 140 con `order_id` |
| `sales_invoices`, `payments` | **0** | — |
| `customers` | 1.010 | **34** con pedido o entrega; `industry` en **1**; `salesperson_id` en **1**; 950 importados |
| `products` | 21.775 | sin columna de costo ni de mínimo; 5.456 sin marca |
| `price_lists` / `product_prices` | 4 / 12.505 | todas en USD; «Lista base» = `pu × 3` del legacy |
| `stock_balances` | 379 | sólo Buscatools, `on_hand` > 0, 0 reservas |
| `stock_movements` | 381 | 379 `opening_balance` (8–9/9) + 2 de prueba |
| `suppliers` | 142 | — |
| `purchase_orders`, `goods_receipts`, `supplier_invoices` | **0** | — |
| `maintenance_orders`, `maintenance_assets` | **0** | — |
| `email_threads` / `email_events` | 210 / 2 | — |
| `attachments` | **0** | — |

Todos los documentos de venta son de **Buscatools**. Torquetools tiene
empresa, depósito y una lista con 3 precios, sin documentos.

**Paridad legacy ↔ nuevo, por número:** 288/288, 166/166 y 182/182 documentos
encontrados; **0** con moneda distinta y **0** con total distinto. Los 32 sin
moneda son los mismos en los dos lados.

## D · Métricas — fórmula real

### De un vistazo (`renderInformeVistazo`)

«Este mes» = `new Date(fecha).getMonth()/getFullYear()` iguales a hoy, **en la
zona del navegador** (ver F2).

| KPI | fórmula legacy | valor legacy al 13/9 | problema |
|---|---|---:|---|
| Cotizado este mes | Σ `_soloUSD(cot)` del mes | USD 87.728,20 · 13 cot | con el mes bien tomado: **90.086,76 · 14** |
| Vendido este mes | Σ `_soloUSD(NE)` del mes | **USD 12.996.570,72** · 17 NE | 15 NE sin moneda en pesos contadas como USD; «vendido» = remitido |
| Comprado este mes | Σ `_soloUSD(PC)` del mes | USD 0 · 0 | la clave no sincroniza |
| Por cobrar | Σ `_soloUSD(NE)` con `estado ≠ 'facturada'` | **USD 13.018.493,50** | no son facturas: son 42 NE; el subtítulo dice «42 facturas» |
| Actividad 6 meses | conteo de cot/ped/NE por mes | ver F2 | el subtítulo dice «documentos creados» pero usa la **fecha del documento** |

### Ventas (`renderInformeVentas`)

| KPI / gráfico | fórmula | valor | problema |
|---|---|---:|---|
| Cotizaciones totales | `cots.length` | 288 | sin período |
| Pedidos confirmados | `peds.length` | 166 | incluye 26 `pendiente` |
| Notas de entrega | `nes.length` | 182 | — |
| Monto facturado total | Σ `_soloUSD(NE)` | **USD 13.350.173,93** | ver hallazgo 2; no son facturas |
| Cotizaciones por mes (12) | Σ `_soloUSD` por mes | — | cuenta todos los docs pero suma sólo USD; zona horaria |
| Top 10 productos | Σ `qty` de **todas** las cotizaciones (cualquier estado) | #1 `GRAMPA.80-4T` 1.598.526 u. | cotizado ≠ vendido; outlier; unidades de productos y servicios mezcladas |
| Top 10 clientes | Σ `_soloUSD(cot)` por **nombre en texto** | 57 nombres | cotizado, no vendido; sin ARS |

### Compras (`renderInformeCompras`)

`pcs.length` (1), `nps.length` (0), Σ `_soloUSD(PC)` (0: el único PC no tiene
total), «proveedores activos» = nombres distintos en PC (1). Serie y top 10 por
mes/proveedor con la misma lógica. **Sobre datos locales y casi vacíos.**

### Stock (`renderInformeStock`)

| KPI / gráfico | fórmula | valor (snapshot) | problema |
|---|---|---:|---|
| Productos totales | `PRODUCTOS.length` | 21.772 | catálogo entero |
| Valor stock «al precio venta» | Σ `pu × sr` | USD 709.844,38 | **`pu` es el costo** (`precioVentaProd` = `pu × 3`): está valorizado al costo con otra etiqueta |
| Sin stock | `sr ≤ 0` | **21.394** | 3.700 productos ni siquiera tienen `sr`; no informa nada |
| Stock crítico (≤5) | `0 < sr ≤ 5` | 160 | umbral fijo |
| gráfico «Stock crítico» | `sr ≤ 5`, orden ascendente, 20 | sr = −15, −4, −3, −2, −2 y quince 0 | **0 de los 20 están en 1–5**: contradice al KPI |
| Top 10 por valor | `pu × sr` | máx. USD 76.140 | valorizado al costo |
| Kardex | últimos 100 de `erp_kardex`, filtro por SKU exacto | 22 movimientos, 5 SKUs | sólo lo cargado en el legacy |

### Evolución (`renderInformeEvolucion`)

| KPI | fórmula | valor | problema |
|---|---|---:|---|
| Tasa de conversión | cot con `estado = 'cerrada'` **o** `convertidaA` / total | **47 %** (134/288) | «cerrada» ≠ convertida (1 cerrada sin `convertidaA`); el ERP nuevo tiene el vínculo real: 132 pedidos con `quote_id` |
| Cotizaciones acumuladas | Σ `_soloUSD(cot)` | USD 1.443.400,26 | incluye 80.668,25 sin moneda |
| Vendido acumulado | Σ `_soloUSD(NE)` | USD 13.350.173,93 | hallazgo 2 |
| Cotizado vs «Facturado» (12 m) | series de cot y NE | — | «facturado» = remitido |

### Archivos adjuntos (`renderBibliotecaArchivos`)

Aplana `erp_attachments` (dataURL en `localStorage`): total de archivos, tamaño,
filtros por tipo/búsqueda/orden en memoria. **No es un informe**: es un
explorador de adjuntos de documentos.

### Pantallas vecinas

| widget | fórmula | problema |
|---|---|---|
| Ticker cotizado / vendido / unidades | suma de los últimos N meses de una serie de 12 vs los N anteriores | «vendido» = **pedidos** (en Informes era NE); el período «1 año» **nunca** tiene comparación (la serie mide 12 y la anterior queda vacía); «1 mes» compara el mes en curso **parcial** con el anterior completo; `prev = 0` muestra +100 % |
| Ticker clientes nuevos | clientes por `created` | **ninguno** de los 988 clientes embebidos tiene `created`: siempre ~0 |
| Stock bajo | `0 < sv ≤ 5`, 6 primeros | usa **sv**; Informes usa **sr** |
| Top clientes (Inicio) / Top 5 del mes (ejecutivo) | Σ `_soloUSD(cot)` | el comentario dice «por monto facturado»; suma cotizado |
| Vendido/Cotizado por vendedor, clientes por vendedor | por `creadoPor` | `creadoPor` en 21/288 cot y 20/166 ped |
| Clientes por rubro | `buscatools_clientes_extra[nombre].rubro` | por nombre en texto |
| Cobrado este mes | Σ `recibo.monto` | **sin moneda**; recibos ausentes |
| Por cobrar / aging (ejecutivo) | facturas no pagadas − NC − recibos | `erp_facturas` vacía → 0 |
| Aging / Cash flow (Finanzas) | Σ `f.total` por bucket | **sin `_soloUSD`**: mezcla monedas con rótulo USD; sobre claves vacías o ausentes |
| Embudo | leads y hot = **0 hardcodeado** | placeholder |
| «Rentabilidad» del editor | venta − `pu × qty` | coherente con `pu` = costo, pero ese costo no existe en el ERP nuevo |
| Snapshot para la IA | «margen estimado» = facturado − comprado del año | no es margen |

## E · Filtros

| reporte | fecha | cliente | proveedor | producto | moneda | estado | empresa | dónde |
|---|---|---|---|---|---|---|---|---|
| De un vistazo | **no** (mes actual fijo) | no | no | no | **no** (sólo USD) | no | implícita | memoria |
| Ventas | **no** (12 m fijos / todo) | no | — | no | **no** | no | implícita | memoria |
| Compras | **no** | — | no | no | **no** | no | implícita | memoria |
| Stock | — | — | — | **SKU exacto** (sólo kardex) | — | — | implícita | `state` en memoria |
| Evolución | **no** | no | — | no | **no** | no | implícita | memoria |
| Archivos | no | no | — | no | — | — | **ninguna** | `state` en memoria |
| Estadísticas | mes / 3 m / todo | — | — | — | no | — | consolidable | `localStorage` por widget |
| Dashboard «vendido 6 m» | no | por nombre | — | — | no | — | consolidable | `localStorage` por widget |

Nada va a la URL. Ningún filtro corre en servidor: todo se carga entero y se
filtra en el navegador.

## F · Monedas y fechas

### F1 · Monedas

`_soloUSD(d)`: si `moneda` existe y no es USD → 0; **si no tiene moneda → cuenta
como USD**. Nunca convierte, ignora `tc`, no usa moneda de línea.

| | USD | ARS | EUR | sin moneda |
|---|---:|---:|---:|---:|
| cotizaciones | 233 · 1.362.732,01 | 48 · 60.162.220,22 | 1 · 6.711,81 | **6 · 80.668,25** |
| pedidos | 128 · 339.049,48 | 27 · 35.947.084,07 | — | **11 · 88.331,57** |
| notas de entrega | 138 · 353.603,21 | 29 · 36.816.390,42 | — | **15 · 12.996.570,72** |

- **Excluido en silencio:** 49 cotizaciones (60,2 M ARS + 6,7 k EUR), 27 pedidos
  y 29 NE en pesos no aparecen en ningún KPI. No hay un «total en ARS» en ningún
  lado.
- **Contado mal:** los 32 sin moneda son de la API de STEL Order (3–8/9). El
  comentario de `_soloUSD` menciona otros números (COTI02536/37, PDV01308–10,
  RT-ML…): el problema que describe **siguió ocurriendo con documentos nuevos**
  y la función no lo cubre.
- **CSV de ventas:** columna «Total USD» con las 288 cotizaciones; **49 no son
  USD**; la columna suma 61.612.332,30 cuando lo realmente USD es 1.362.732,01.
  No exporta la moneda.
- **Tipo de cambio:** `tc` en 2 de 288 cotizaciones. En el ERP nuevo,
  `exchange_rate` es NULL en 286/288, 166/166 y 182/182. **No hay base para
  convertir.**
- **Decisión vigente** (`PHASE_4_SALES_FINAL.md` §R3/R4): los reportes
  **distinguen ARS / USD / SIN TC y no convierten**; los 32 sin moneda van con
  `needs_review`. Informes nuevo tiene que respetarla.

### F2 · Fechas

| | legacy | ERP nuevo |
|---|---|---|
| campo | `fecha` `YYYY-MM-DD` en 636/636 | `quote_date` / `order_date` / `delivery_date` (`date`), 0 nulos |
| `created` / `created_at` | presente | **distinto de la fecha del documento en 636/636** (importación) → **nunca** usar `created_at` para períodos |
| períodos | mes calendario actual; últimos 6 o 12 meses calendario; en Estadísticas mes / 3 m / todo | — |
| zona horaria | `new Date('2026-09-01')` = UTC → 31/8 21:00 en Argentina | `date` sin hora: no hay corrimiento si se agrupa por el string |

**Corrimiento medido** (legacy vs mes del string):

| | docs del día 1 | corridos de mes | meses con monto distinto |
|---|---:|---:|---|
| cotizaciones | 5 | 5 | mar, abr (sólo conteo), jun, jul, ago, sep |
| pedidos | 9 | 9 | sólo conteos en el Vistazo: may 19→17, jul 16→19, ago 22→18, sep 13→17 |
| notas de entrega | 6 | 6 | mar a sep (mayo: +22.703 USD; junio: −18.790 USD) |

Ejemplo: en septiembre el legacy muestra 13 cotizaciones y USD 87.728; son 14 y
USD 90.087.

## G · Ventas

| reporte | clasificación |
|---|---|
| cotizado / pedido / entregado por mes, conteo y monto por moneda | **REAL** en el legacy (roto por moneda y zona horaria) → **POSSIBLE** hoy |
| ticket promedio | **NO EXISTE** en el legacy → posible por moneda |
| ranking de clientes | **REAL** (cotizado, por nombre) → posible por `customer_id` y moneda |
| ranking de productos | **REAL** (unidades cotizadas) → posible por `sku_snapshot`/`product_id`, con el outlier señalado |
| conversión cot → pedido | **BROKEN** (por estado) → posible por `sales_orders.quote_id` (132) |
| cumplimiento pedido → entrega | **NO EXISTE** → posible: `fulfillment_status` (140 delivered / 26 pending) y `deliveries.order_id` |
| pendientes (cot abiertas, pedidos sin entregar) | **PARCIAL** (pipeline del ejecutivo) → posible: 154 cot `sent`, 26 pedidos `pending` |
| facturado / por cobrar / aging / cobrado | **BROKEN** → **NOT POSSIBLE WITH CURRENT DATA** (0 facturas, 0 cobros, estado `facturada` no migrado) |
| dormidos | **NO EXISTE** en el legacy (0 apariciones) |
| YoY / MoM | **BROKEN** (ver D) → MoM posible; YoY sólo desde enero 2026 (el histórico empieza el 5/1/2026) |
| vendedor | **PLACEHOLDER de hecho** (21/288) → **NOT POSSIBLE** para el histórico |

## H · Clientes

| métrica | legacy | ERP nuevo |
|---|---|---|
| identificación en informes | **nombre en texto** (`c.cliente`) | `customer_id` en 636/636 documentos |
| colisiones de nombre | 0 en cot, 1 grupo en pedidos | no aplica |
| activos / con compras | no existe | **34** clientes con pedido o entrega |
| nuevos | ticker siempre ~0 (sin `created`) | **NOT POSSIBLE** para el histórico: 950 importados con fecha de importación; posible desde ahora (60 creados en el ERP nuevo) |
| dormidos | no existe | posible con una regla que **no está definida** (ver V) |
| ranking | cotizado por nombre | posible por moneda |
| última compra / recurrencia / frecuencia | no existe | posible desde `order_date` / `delivery_date` |
| rubro | torta por nombre | **NOT POSSIBLE**: `industry` en 1 de 1.010 |
| vendedor | por `creadoPor` | **NOT POSSIBLE**: `salesperson_id` en 1 cliente y 0 documentos |
| país | no existe | `customers` no tiene país |
| contactos | no existe en informes | 87 contactos; no hay métrica pedida |

## I · Productos

| métrica | legacy | ERP nuevo |
|---|---|---|
| ventas por producto | top 10 **cotizado** | posible desde líneas de pedido (precio y cantidad); **las líneas de entrega no tienen precio** |
| margen | no existe en Informes | **NOT POSSIBLE** (sección Z) |
| rotación | no existe | posible sólo en unidades y sólo desde el 8/9 (movimientos reales = 2) |
| stock | catálogo + deltas | `stock_balances` |
| crítico | ≤ 5 fijo | **sin parámetro** (sección J) |
| top / bottom | top 10 por unidades | posible; bottom sin sentido con 21.775 productos y 34 clientes activos |
| sin movimiento | no existe | trivial y no informativo hoy (casi todo) |
| categorías / marcas | no | posible (5.456 sin marca) |
| equivalencias / kits | no | `is_kit` en 0 productos |

Depende del array global `PRODUCTOS` (catálogo estático de 15,9 MB) sólo para
stock; los rankings de ventas usan los ítems de los documentos.

## J · Stock

- **Fuente legacy:** `productos-data.json` (`sr` real / `sv` virtual) +
  `erp_stock_deltas` (**no sincroniza**) + `erp_producto_overrides` (sincroniza,
  **no está en el servidor**). `erp_kardex` es un **log**, no la fuente: guarda el
  saldo de cada movimiento visto desde el navegador que lo escribió.
- **Negativos:** 5 productos con `sr` < 0 en el snapshot; el ERP nuevo abrió
  sólo `on_hand` > 0 (379) y tiene 0 negativos.
- **Reservas / disponible:** el legacy no tiene; el nuevo tiene `reserved`
  (0 hoy) y `stock_reservations` (0).
- **Stock crítico:** el legacy tiene `stock_min` por SKU **dentro de los
  overrides** (editor de precios, líneas 14987 y 15023), pero **Informes no lo
  usa**: usa ≤ 5 fijo. El ERP nuevo **no tiene mínimo**. No se inventa.
- **Valorización:** sólo posible al costo, y **no hay costo** (ver Z).
- **Cobertura / rotación:** no existen; sin histórico de consumo (2 movimientos
  reales) no hay con qué calcularlas.

## K · Compras

Informes › Compras suma pedidos a proveedor **de un solo navegador**: 1 registro
exportado, sin total; notas de proveedor ausentes. En el ERP nuevo hay 142
proveedores y **0** pedidos, recepciones y facturas. **No hay nada que
informar hoy.** ETA, gastos y condiciones no existen en el informe legacy.

## L · Mantenimiento, emails, WhatsApp

- **Mantenimiento:** Informes no incluye nada. El módulo nuevo tiene 0 órdenes.
- **Emails:** el Dashboard ejecutivo embebe la lista de mails (`gmailRender`), sin
  métricas. El nuevo tiene 210 hilos y 2 eventos.
- **WhatsApp / actividad comercial:** no aparece en Informes. **No se inventa.**

## M · Exportaciones

| export | dónde | columnas | respeta filtros | problemas |
|---|---|---|---|---|
| CSV ventas | `inf-export-ventas` 26760 | Referencia, Cliente, Título, Estado, Fecha, **Total USD** | **no hay filtros**: exporta las 288 cotizaciones (no pedidos ni NE, aunque la pantalla se llama «Ventas») | 49 filas no-USD bajo «Total USD»; sin moneda; sin BOM (Excel en Windows rompe los acentos); separador `,` |
| CSV compras | `inf-export-compras` 26769 | Referencia, Proveedor, Título, Estado, Fecha, Total USD | no | mismos problemas; datos locales |
| Descargar adjunto | Archivos | el archivo (dataURL) | — | — |

No hay Excel, PDF, impresión ni copiar en Informes.

## N · Bugs — reales y medidos

| # | bug | evidencia |
|---|---|---|
| 1 | Documentos **sin moneda contados como USD** | 32 docs; «Vendido este mes» = USD 12.996.570,72 |
| 2 | Documentos **en ARS/EUR excluidos en silencio** de todo KPI | 49 cot, 27 ped, 29 NE |
| 3 | **Zona horaria**: el día 1 cae en el mes anterior | 20 docs; 13 series mensuales con diferencias |
| 4 | **«Facturado» / «Por cobrar» calculados sobre notas de entrega**; el subtítulo dice «facturas» | 42 NE rotuladas «facturas» |
| 5 | **CSV «Total USD»** mezcla monedas y no exporta la moneda | suma 61,6 M vs 1,36 M reales |
| 6 | Valor de stock **«al precio venta» calculado al costo** (`pu`) | `precioVentaProd` = `pu × 3` |
| 7 | Gráfico **«Stock crítico» contradice al KPI** | 0 de 20 en el rango 1–5 |
| 8 | **«Sin stock» cuenta el catálogo entero** | 21.394 |
| 9 | **Conversión por estado** en vez de por vínculo | 47 %; 1 «cerrada» sin conversión |
| 10 | **Top productos por unidades cotizadas**, sin tratar outliers | GRAMPA.80-4T 1.585.000 u. a precio 0 |
| 11 | **Stock distinto por navegador** (`erp_stock_deltas` no sincroniza) | código de `SUPA_SYNC_KEYS` |
| 12 | **Adjuntos sin empresa** (`erp_attachments` sin `_ekey`): mezcla empresas | `loadAttachmentsStore` |
| 13 | **«Ir al documento» desde Archivos abre el primero** si no encuentra la referencia (`list[idx >= 0 ? idx : 0]`) **y pisa el borrador en edición** (`saveBorrador`) | 26677–26698 |
| 14 | **Vista «Todas las empresas»**: Informes usa `_ekey` (no `_dashLoad`) y muestra **sólo Buscatools** sin avisarlo | `_ekey` devuelve la clave base para `TODAS` |
| 15 | Ticker **«1 año» nunca compara** y **«1 mes» compara un mes parcial** con uno completo; `prev = 0` → +100 % | `_dashTickerCard` |
| 16 | Ticker **clientes nuevos siempre ~0** | 0/988 con `created` |
| 17 | **«Vendido» significa cosas distintas** según la pantalla: NE en Informes, pedidos en Inicio/Estadísticas | — |
| 18 | **Aging y Cash flow suman `total` sin moneda** con rótulo USD | `renderFinanzasAging`/`Cash` |
| 19 | «Top 5 clientes del mes» dice «por monto facturado» y suma **cotizado** | comentario en 4277 |
| 20 | Subtítulo «documentos creados» sobre la **fecha del documento** | Vistazo |

Sin división por cero: todas las divisiones están guardadas. No se encontró
`NaN` visible con los datos actuales.

## O · Performance

| | legacy | ERP nuevo (referencia) |
|---|---|---|
| carga de datos de Informes | `localStorage`, sin requests propios | a definir: agregación en servidor |
| sincronización | `GET erp_store?select=key,value` **completo cada 30 s** (~1,3 MB por pedido, con la app abierta en cualquier sección) | Realtime/queries puntuales (patrón de Emails/Ventas) |
| catálogo | `productos-data.json`, **15,9 MB por XHR síncrono** al abrir la app | `products` paginado |
| cálculo | todo en el hilo principal, en cada render | — |
| paginación | ninguna; kardex top 100 en memoria | server-side |
| tamaño hoy | 636 documentos · 2.185 líneas | igual; crece |

Informes en sí no genera egress propio; el costo es del modelo de datos del
legacy (bajar todo, siempre). Con 636 documentos cualquier cosa es rápida; el
riesgo del ERP nuevo es repetir el patrón «traer todas las líneas y sumar en el
navegador» cuando los documentos crezcan.

## P · Permisos

**Legacy — sólo frontend:**

- Informes: `_chkTeam()` → usuario en `TEAM_USERS` (ADMIN, JANO, JUAN, FACUNDO,
  NORBERTO, BRIAN) con token de sesión; `getPermsFor` da `informes: true` a todo
  el equipo salvo que ADMIN lo quite. **Los datos ya están en el navegador de
  cualquiera que tenga la app**: el permiso sólo esconde la pantalla.
- Estadísticas (comparativa por vendedor): **sólo ADMIN**, hardcodeado.
- Dashboard ejecutivo: equipo con permiso de Ventas.

**ERP nuevo — lo que la RLS ya permite:**

| dato | admin | employee | salesperson | technician | customer / distributor |
|---|---|---|---|---|---|
| cotizaciones, pedidos, entregas | todas de la empresa | todas | **todas** | **todas** | sólo las propias |
| clientes | todos | todos | **sólo los asignados** (hoy: 1) | no | el propio |
| stock | sí | sí | sí | sí | no |
| compras | sí | sí | no | no | no |
| mantenimiento | sí | sí | no | no | no |

Un vendedor vería montos de toda la empresa pero clientes vacíos. **Quién ve
Informes es una decisión** (V1).

## Q · Mapeo al ERP nuevo

| métrica legacy | fuente nueva | fórmula nueva | moneda | clasificación |
|---|---|---|---|---|
| Cotizado del mes / serie | `sales_quotes` | Σ `total` por `quote_date` (mes del string) | **por `currency_code`**, SIN MONEDA aparte | **B** |
| «Vendido» (NE) | `deliveries` | Σ `total` por `delivery_date` | por moneda | **B** |
| «Vendido» (pedidos, dashboards) | `sales_orders` | Σ `total` por `order_date` | por moneda | **B** |
| Conteos de cot / ped / NE | ídem | `count` | — | **A** |
| Comprado del mes | `purchase_orders` | Σ `total` por `order_date` | por moneda | **C** (0 filas) |
| Por cobrar / facturado / aging / cobrado | `sales_invoices`, `payments` | — | — | **C + D** |
| Top productos | `sales_order_lines` (+ `sku_snapshot`) | Σ cantidad y Σ importe por moneda | por moneda | **B + D** (outlier) |
| Top clientes | `sales_orders` / `deliveries` + `customers` | Σ por `customer_id` | por moneda | **B** |
| Tasa de conversión | `sales_orders.quote_id` | cot con pedido / cot | — | **B + D** |
| Stock actual | `stock_balances` | `on_hand`, `reserved`, disponible | — | **B** |
| Valor de stock | — | — | — | **C + D** (sin costo) |
| Sin stock / crítico | `stock_balances` | — | — | **C + D** (sin mínimo) |
| Kardex | `stock_movements` | movimientos por producto y fecha | — | **B** |
| Archivos adjuntos | `attachments` | — | — | **F / no es informe** |
| Vendido por vendedor | `salesperson_id` | — | — | **C** |
| Clientes por rubro | `customers.industry` | — | — | **C** |
| Clientes nuevos | `customers.created_at` | — | — | **C** (histórico) / **G** (desde ahora) |
| Pipeline abierto | `sales_quotes.status = sent`, `sales_orders.fulfillment_status = pending` | conteo + Σ por moneda | por moneda | **B** |
| Embudo con leads | — | — | — | **E** |
| CRM › Informes | — | — | — | **F** (código muerto) |
| Cumplimiento, ticket promedio, última compra | pedidos / entregas | — | por moneda | **G** |

Clasificación: A migrable 1:1 · B con mejor modelo · C datos insuficientes · D
bug legacy · E placeholder · F no usado · G funcionalidad nueva.

## R · Migrable / no migrable

**Migrar (con el modelo nuevo):**

- actividad comercial mensual **por moneda**: cotizado, pedido, entregado —
  conteo y monto—, con SIN MONEDA visible como su propia columna;
- pendientes: cotizaciones abiertas y pedidos sin entregar;
- conversión cotización → pedido **por vínculo**;
- rankings de clientes y productos **por moneda**, por `customer_id`;
- stock físico: existencias, reservas, disponible;
- movimientos de stock (kardex) con filtros;
- exportación CSV con moneda y los filtros aplicados.

**NO copiar:**

- `_soloUSD` en cualquiera de sus dos mitades: ni excluir ARS en silencio, ni
  contar lo sin moneda como USD;
- «facturado» y «por cobrar» a partir de remitos;
- top de productos por **unidades cotizadas** sin tratar outliers;
- «Sin stock» sobre el catálogo entero, y el umbral ≤ 5 fijo;
- valorizar stock con cualquier precio disponible;
- conversión por estado;
- la biblioteca de adjuntos como «informe»;
- CSV sin moneda rotulado USD;
- tickers que comparan un mes parcial, o un año sin serie anterior;
- el embudo con leads en 0 y CRM › Informes;
- sumas «Todas las empresas» mezclando monedas.

## S · Gaps — lo que falta para lo que el legacy prometía

| reporte | falta | cómo se resolvería (no ahora) |
|---|---|---|
| margen / rentabilidad | **costo** | costo desde compras reales, o columna de costo con su RLS (decisión de negocio) |
| valor de stock | costo | ídem |
| stock crítico | **mínimo por producto** | parámetro por producto/depósito |
| facturado / por cobrar / aging / cobrado | **facturas y cobros** | módulo de facturación (hoy fuera del ERP) |
| vendedor | `salesperson_id` histórico | sólo desde ahora; el histórico no tiene fuente (backlog) |
| rubro | `industry` | carga manual (1/1.010 hoy) |
| clientes nuevos | fecha de alta real | sólo desde ahora |
| conversión a ARS/USD | tipo de cambio | decisión R3: no se convierte |
| compras | pedidos, recepciones, facturas | uso del módulo de Compras |
| mantenimiento | órdenes | uso del módulo |
| los 32 sin moneda | moneda | revisión manual (`needs_review`) |

## T · Riesgos

1. **Reemplazar un número inflado por uno correcto va a parecer una caída.** El
   legacy muestra USD 13 M «vendidos» en septiembre; el nuevo mostrará USD y ARS
   por separado. Hay que decirlo antes de publicar.
2. **Informar sobre datos vacíos** (compras, mantenimiento, facturas) da pantallas
   con ceros que parecen errores.
3. **Egress:** agregar líneas en el navegador escala mal. Con 2.185 líneas no se
   nota; la agregación tiene que ir al servidor.
4. **RLS de vendedor:** montos de toda la empresa sin nombres de clientes.
5. **El outlier de GRAMPA** distorsiona cualquier ranking por unidades.
6. **`created_at` ≠ fecha del documento** en todo el histórico.
7. **Datos del legacy locales:** lo que no sincronizaba (stock deltas, compras,
   adjuntos) no es comparable ni migrable desde el servidor.

## U · Plan por entregas

Ordenado por valor, confiabilidad del dato y riesgo, sobre lo que **ya existe**.

| entrega | contenido | por qué en este orden |
|---|---|---|
| **1 · Actividad comercial** | Cotizado / pedido / entregado por mes (12 meses) y mes actual vs anterior, **por moneda** con SIN MONEDA aparte; conteos; aviso de documentos `needs_review`. Agregación en servidor respetando RLS (a proponer y aprobar en esa entrega). Rol y período según V1/V2 | los datos más confiables (636 docs, paridad 0 deltas); reemplaza lo que más miente hoy |
| **2 · Pipeline y conversión** | Cotizaciones abiertas y pedidos pendientes con montos por moneda; conversión por `quote_id`; cumplimiento por `fulfillment_status`; ticket promedio por moneda | mismas tablas, lógica nueva y verificable |
| **3 · Rankings** | Top clientes y productos por moneda y período, con `customer_id`; outliers señalados, no escondidos; CSV con moneda y filtros | depende de 1–2 y del criterio de outliers (V4) |
| **4 · Stock** | Existencias, reservado, disponible por depósito; movimientos (kardex) con filtros por producto y fecha. **Sin** valorización ni crítico hasta V3/V5 | datos confiables pero con poco movimiento real |
| **5 · Cierre** | Mobile, exportes, performance medida, red team de RLS por rol, docs | — |

**Fuera del plan hasta que haya datos o decisión:** compras, mantenimiento,
facturación / cobranzas / aging, margen, vendedor, rubro, clientes nuevos,
dormidos. Cuando existan, entran como entregas propias.

## V · Decisiones

### BLOCKING — para empezar la Entrega 1

1. **¿Quién ve Informes?** Evidencia: en el legacy, todo el equipo (incluidos
   vendedores) veía Informes, pero la comparación por vendedor era **sólo
   ADMIN**. En el ERP nuevo un `salesperson` ve montos de toda la empresa y sólo
   sus clientes. ¿Admin y employee, o también salesperson (y con qué alcance)?
2. **¿Qué es «vendido»?** El legacy usa remitos en Informes y pedidos en el
   resto. ¿El número principal es **pedido confirmado** o **entregado**? (Se
   pueden mostrar los dos rotulados; lo que se decide es cuál encabeza.)

### NON-BLOCKING — se pueden decidir más adelante

3. **Stock crítico:** ¿se quiere un mínimo por producto (dato nuevo) o no hay
   informe de crítico? Mientras tanto, no se muestra.
4. **Outliers de cantidad** (GRAMPA.80-4T, 1.585.000 u. a precio 0): ¿se corrige
   el dato, se excluye de rankings por unidades, o se muestra marcado?
5. **Costo y margen:** ¿se va a registrar costo (desde Compras u otra fuente)?
   Sin eso, no hay margen ni valorización.
6. **Los 32 documentos sin moneda (13,2 M):** ¿alguien los revisa y les asigna
   moneda antes de publicar Informes? Mientras tanto, columna propia.
7. **Facturación y cobranzas:** ¿van a existir en el ERP? Hasta entonces, sin
   «por cobrar» ni aging.
8. **Archivos adjuntos:** no se migra como informe; los adjuntos viven en cada
   documento. Confirmar.
