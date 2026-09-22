# Fase 21 · Dashboard + Informes · E0 — Auditoría

**Medido el 22/09/2026 sobre producción (`uaxcfufvapzulqvynanp`), sólo lectura.**
0 cambios de base · 0 documentos tocados · 0 escrituras en STEL.

---

## 1 · Qué hay hoy

### CURRENT_DASHBOARD

`/` → `DashboardPage`. Se bifurca por rol (`vistaPara`), y el menú **no lo
restringe**: cualquier rol autenticado llega.

| rol | vista | qué ve |
|---|---|---|
| admin · employee | `operativa` | 2 alertas + 4 tarjetas + «Emitido este mes» + accesos |
| salesperson | `ventas` | 2 tarjetas propias + sus 5 cotizaciones pendientes + accesos |
| technician · customer · distributor · supplier | `accesos` | sólo accesos rápidos |

La vista operativa se arma con **6 consultas, todas en paralelo, 82 ms hasta la
última**, y ninguna es nueva: reusa las RPC de Informes con la misma
`queryKey`, así que entrar a Informes después no vuelve a pedirlas.

| fuente | para qué |
|---|---|
| `informe_pipeline_comercial` | cotizaciones abiertas · pedidos por entregar |
| `informe_actividad_comercial` | emitido del mes · documentos que requieren atención |
| `maintenance_orders` (listado, `estado=open`) | órdenes de servicio abiertas |
| `email_accounts` + `listar_bandeja_email` | emails pendientes |
| `autoridad_numeracion_empresa` | el aviso de que STEL numera |

Lo que ya hace bien y **no hay que romper**: importes siempre por moneda sin
total general; «empresa sin actividad» en vez de cuatro ceros; error y reintento
por tarjeta; el aviso de revisión cuenta `requires_attention_now` y no la foto
de la migración.

Lo que le falta: **comparación con el período anterior** (no hay ni una flecha),
**evolución** (ningún gráfico), **actividad reciente**, y el «Emitido este mes»
es una lista de texto sin jerarquía —los tres tipos pesan lo mismo—.

### CURRENT_REPORTS

`/informes`, dos pestañas en `?vista=`: **Comercial** y **Stock**. `?mes=YYYY-MM`
compartido. Sólo admin y employee, y no sólo en el menú: las RPC devuelven
`sin_permiso` a cualquier otro rol.

Comercial ya tiene: KPIs por tipo y moneda con variación, serie mensual,
rankings con paginación y CSV, etapas del pipeline, conversión, cumplimiento y
ticket promedio. **Y ya compara ventanas equivalentes**: en pantalla dice
«1–22 sep 2026 contra 1–22 ago 2026». El §19 del pedido ya está resuelto.

Stock: resumen, tabla de stock actual, movimientos y kardex. La pantalla ya
avisa «Sin valorización, costo ni stock crítico», que es la verdad.

**Rendimiento medido**

| pantalla | requests | tiempos |
|---|---|---|
| Dashboard (frío) | 6 | todas lanzadas en 82 ms |
| Informes comercial (frío) | 5 (2 de sesión) | 242 · 304 · 354 ms |
| Informes comercial (viniendo del Dashboard) | **1** | 368 ms — el resto sale de caché |
| Informes stock | 4 | 620 · **2.644** · 820 · 556 ms |

`informe_stock_catalogo` con **2,6 s** es lo más lento del módulo y el único
candidato real de optimización. Todo lo demás agrega en el servidor: ningún
listado grande baja al navegador.

---

## 2 · LEGACY_FEATURE_MATRIX

Del inventario medido en la Fase 10 · E0 (`renderDashboardEjecutivo` 4214,
`renderDashboard` 5110, `WIDGET_DEFS` 4961, `renderEstadisticas` 5563).

| función del legacy | veredicto | por qué |
|---|---|---|
| Ticker cotizado / vendido / unidades con comparación | **IMPROVE** | la idea sirve; la fórmula no: «1 año» nunca tenía comparación, «1 mes» comparaba mes parcial contra mes completo y `prev=0` mostraba +100 % |
| Top clientes del mes | **IMPROVE** | sumaba cotizado con `_soloUSD`, que además contaba como USD lo que no tenía moneda |
| Stock bajo (`0 < sv ≤ 5`) | **DROP** | hoy no existe stock mínimo en la base y **ningún** producto está en 0; el umbral 5 era inventado |
| Clientes nuevos del mes | **OBSOLETE** | ninguno de los 988 clientes del legacy tenía fecha de alta: el widget siempre daba ~0 |
| Embudo (leads / hot) | **DROP** | `0` hardcodeado, no hay CRM |
| Por cobrar · aging · cash flow | **UNAVAILABLE** | `erp_facturas` vacía y `erp_recibos` ausente; no hay facturación en el ERP nuevo |
| Cotizado/vendido por vendedor | **DROP** | `creadoPor` en 21/288 cotizaciones; hoy son **0 de 307** |
| Clientes por rubro | **KEEP (en Informes)** | el rubro existe en `customers`; el legacy lo cruzaba por nombre en texto |
| Vendido 6 meses por cliente | **IMPROVE** | la evolución sirve; el filtro por nombre y el `localStorage` por widget no |
| Accesos rápidos / widgets configurables | **KEEP** | ya están, y salen del mismo menú filtrado por rol |
| «Vendido» con dos significados según la pantalla | **DROP** | en el ERP nuevo «vendido» es lo entregado, y está escrito en pantalla |

---

## 3 · PRODUCTION_BASELINE (medido hoy)

| tabla | valor | vs. lo esperado |
|---|---|---|
| customers (activos) | 1.010 | = |
| products (activos) | 21.828 | = |
| sales_quotes | 307 | = |
| sales_orders | 173 | = |
| deliveries | 194 | = |
| maintenance_assets | 358 | = |
| maintenance_orders | **0** | = |
| maintenance_service_history | 200 | = |
| equipos con historial | 132 | = |
| stock_movements | 381 | = |
| stock_reservations | 0 | = |
| stock_balances | 379 | — |
| sales_audit | **8** | dato nuevo y decisivo |

---

## 4 · METRICS_AUDITED — la matriz

`D` = Dashboard · `I` = Informes · roles: A=admin, E=employee, S=salesperson.

| métrica | fuente | confiabilidad | período | moneda | rol | acción | D | I |
|---|---|---|---|---|---|---|---|---|
| Cotizado | `sales_quotes.total` por `quote_date` | **CONFIABLE** | mes / 12 m | ARS·USD·EUR | A·E | → cotizaciones del mes | ✅ | ✅ |
| Pedido | `sales_orders.total` por `order_date` | **CONFIABLE** | mes / 12 m | ARS·USD | A·E | → pedidos del mes | ✅ | ✅ |
| Entregado | `deliveries.total` por `delivery_date` | **CONFIABLE** | mes / 12 m | ARS·USD | A·E | → remitos del mes | ✅ | ✅ |
| Cotizaciones abiertas | pipeline (sent/accepted sin pedido) | **CONFIABLE** | estado actual | por moneda | A·E | → `?estado=sent` | ✅ | ✅ |
| Pedidos por entregar | `fulfillment_status='pending'` | **CONFIABLE** | estado actual | por moneda | A·E | → pedidos pendientes | ✅ | ✅ |
| Documentos que requieren atención | `revision_de_documentos.requires_attention_now` | **CONFIABLE** | mes / total | — | A·E | → informe | ✅ | ✅ |
| Documentos no verificables | `unverifiable_reasons` | **CONFIABLE** | total | — | A·E | informativo | ❌ | ✅ |
| Órdenes de mantenimiento abiertas | `maintenance_orders` | **CONFIABLE** (hoy 0) | actual | — | A·E | → órdenes | ✅ | ❌ |
| Historial STEL | `maintenance_service_history` | **HISTÓRICA** | cerrada | ARS·USD (compartida) | A·E | → equipo | ⚠️ | ✅ |
| Parque de equipos | `maintenance_assets` | **CONFIABLE** | actual | — | A·E | → equipos | ⚠️ | ✅ |
| Emails pendientes | `listar_bandeja_email` | **CONFIABLE** | actual | — | con cuenta | → bandeja | ✅ | ❌ |
| Productos con saldo | `stock_balances` | **CONFIABLE CON LIMITACIÓN** | actual | — | A·E | → stock | ⚠️ | ✅ |
| Stock crítico / bajo | — | **NO DISPONIBLE** | — | — | — | — | ❌ | ❌ |
| Consumo histórico de stock | `stock_movements` | **NO CONFIABLE** | — | — | — | — | ❌ | ❌ |
| Conversión cotización→pedido | `sales_orders.quote_id` | **CONFIABLE CON LIMITACIÓN** (88 %) | mes | por moneda | A·E | → documentos | ⚠️ | ✅ |
| Cumplimiento pedido→remito | `deliveries.order_id` | **CONFIABLE CON LIMITACIÓN** (81 %) | mes | por moneda | A·E | → documentos | ⚠️ | ✅ |
| Avance por línea de pedido | `delivery_lines.order_line_id` | **NO CONFIABLE** (77 %) | — | — | — | — | ❌ | ❌ |
| Ranking de clientes | rankings RPC | **CONFIABLE** | mes / 12 m | una por vez | A·E | → ficha 360 | ❌ | ✅ |
| Ranking de productos | rankings RPC | **CONFIABLE** | mes / 12 m | una por vez | A·E | → modal producto | ❌ | ✅ |
| Por vendedor | `salesperson_id` | **NO DISPONIBLE** (0 de 480) | — | — | — | — | ❌ | ❌ |
| Actividad reciente (auditoría) | `sales_audit` | **CONFIABLE CON LIMITACIÓN** (8 filas) | desde 16/09 | — | A·E | → documento | ⚠️ | ❌ |
| Actividad reciente (`created_at`) | documentos | **NO CONFIABLE** | — | — | — | — | ❌ | ❌ |
| Facturación · cobranzas · margen | — | **NO DISPONIBLE** | — | — | — | — | ❌ | ❌ |
| Clientes dormidos | — | **NO DISPONIBLE** (falta definición comercial) | — | — | — | — | ❌ | ❌ |

**RELIABLE_METRICS** = 12 · **LIMITED_METRICS** = 6 · **UNRELIABLE_METRICS** = 3
· **UNAVAILABLE_METRICS** = 5

---

## 5 · Los números de hoy

**CURRENCIES_FOUND** = ARS, USD, EUR (EUR sólo en cotizaciones).
**0 documentos sin moneda** en los tres tipos: la rama «sin moneda» del
Dashboard ya no tiene sujeto, aunque conviene dejarla por si vuelve a pasar.

**MONTH_CURRENT** = 2026-09 (al día 22) · **MONTH_PREVIOUS** = 2026-08.

| | ARS | USD |
|---|---|---|
| **Cotizado** sep | 3.501.735,15 · 3 docs | 90.714,16 · 29 docs |
| **Cotizado** ago | 13.533.661,05 · 12 docs | 116.514,72 · 27 docs |
| **Pedido** sep | 1.072.863,82 · 3 docs | 25.386,38 · 20 docs |
| **Pedido** ago | 3.387.984,27 · 4 docs | 25.518,32 · 15 docs |
| **Entregado** sep | 13.994.541,33 · 13 docs | 57.522,11 · 17 docs |
| **Entregado** ago | 3.387.984,27 · 4 docs | 31.301,32 · 16 docs |

Septiembre está **incompleto** (22 de 30 días): el Dashboard tiene que comparar
ventana contra ventana equivalente, como ya hace Informes, o decirlo.

| | |
|---|---|
| OPEN_QUOTES | **154** (sent o accepted sin pedido) · `sent` 143 · `accepted` 162 · `draft` 2 |
| PENDING_ORDERS | **28** (`fulfillment_status='pending'`; `delivered` 145) |
| DOCUMENTS_REQUIRING_ATTENTION_NOW | **219** en total · **45** del mes en curso |
| UNVERIFIABLE_DOCUMENTS | **20** |
| (contexto) marcados por la migración | 241 · resueltos desde entonces 126 · filas en la vista 674 |
| CURRENT_MAINTENANCE_ORDERS | **0** |
| MAINTENANCE_ASSETS | **358** |
| HISTORICAL_MAINTENANCE_SERVICES | **200** |
| ASSETS_WITH_HISTORY | **132** |

**STOCK_METRICS_AVAILABLE** — poco, y conviene decirlo:

- 379 productos con saldo, **todos mayores a cero**: no hay «sin stock» ni negativos;
- 21.449 productos del catálogo **no tienen fila de saldo**, que no es lo mismo que tener cero;
- movimientos: 379 saldos iniciales + 1 ajuste + 1 salida por remito. **Dos movimientos reales**;
- **no existe stock mínimo** en ninguna tabla → «stock crítico» sería inventado;
- 2 depósitos activos.

**QUOTE_ORDER_LINK_COVERAGE** = 153 de 173 pedidos tienen `quote_id` → **88,4 %**
(20 pedidos sin cotización de origen).
**ORDER_DELIVERY_LINK_COVERAGE** = 157 de 194 remitos tienen `order_id` → **80,9 %**
(37 sin pedido; 11 cuelgan de una cotización).
A nivel línea: 485 de 632 líneas de remito tienen `order_line_id` → **76,7 %**.

**SALESPERSON_DATA_COVERAGE** = **0 de 307 cotizaciones y 0 de 173 pedidos.**
Sin filtro ni ranking por vendedor. Sigue igual que en la Fase 10.

**RECENT_ACTIVITY_SOURCE** — el hallazgo incómodo:

- `sales_audit` tiene **8 filas**, todas del piloto del ERP (16–21/09);
- 305 de 307 cotizaciones, 171 de 173 pedidos y 193 de 194 remitos son migrados:
  su `created_at` es **la hora en que corrió la importación**, no un evento.

Un timeline con `created_at` mostraría 669 documentos «creados» el mismo día.
La única fuente honesta para «actividad reciente» es **la fecha del documento**
(`quote_date` / `order_date` / `delivery_date`), con granularidad de día y sin
hora. `maintenance_audit` (358 filas) también es la importación.

---

## 6 · RLS_MODEL

- Las 9 RPC de informes son **`security invoker`**. Ninguna es definer. No hay
  que crear ninguna nueva para el Dashboard: las que hay ya respetan al rol.
- Informes: admin y employee, en el menú **y** en el servidor (`sin_permiso`).
- Dashboard: sin restricción de menú; se bifurca por rol y cada bloque usa las
  fuentes que ese rol ya puede leer.
- Falta por probar en E5 con sesión real: `salesperson`, `customer`,
  `distributor` y `anon` contra el Dashboard.

---

## 7 · PROPOSED_DASHBOARD_INFORMATION_ARCHITECTURE

Cinco bloques, en este orden, y nada más.

**A · Cabecera** — «Inicio · Buscatools» + el período en curso («Septiembre
2026, al día 22») y un selector de **Este mes / Mes anterior / Últimos 12
meses**. Las RPC ya aceptan `p_mes`; «últimos 12 meses» ya lo devuelve la serie
de actividad. `?mes=` a la URL, igual que Informes.

**B · Situación del mes** — un protagonista y dos secundarios, no tres iguales:

```
COTIZADO · 1–22 septiembre
USD 90.714      ↓ 22,1 % vs 1–22 agosto
ARS 3.501.735   ↓ 74,1 % vs 1–22 agosto

Pedido    USD 25.386 · ARS 1.072.864
Entregado USD 57.522 · ARS 13.994.541
```

Comparación **de ventana equivalente** (día 22 contra día 22), nunca mes parcial
contra mes completo. Sin base de comparación → «Sin base de comparación», nunca
+100 % ni ∞. Flecha + texto además del color.

**C · Atención hoy** — lo que hay que ir a resolver, con el número, el porqué y
el link **ya filtrado**:

| | |
|---|---|
| 154 | Cotizaciones abiertas → `/ventas/cotizaciones?estado=sent` |
| 28 | Pedidos por entregar → `/ventas/pedidos?entrega=pending` |
| 45 | Documentos del mes que requieren atención → `/informes` |
| N | Emails pendientes → `/emails?estado=pendiente` |

Mantenimiento entra sólo si hay algo: hoy son 0 órdenes y poner un cero al lado
de cuatro números que sí piden trabajo es ruido. Si es 0 → no se muestra la
tarjeta.

**D · Evolución** — **un solo gráfico**: 12 meses, una métrica por vez
(chips Cotizado / Pedido / Entregado), **una moneda por vez**, escala visible,
tooltip con importe y cantidad de documentos, y «Ver los números» como tabla
alternativa. Mismo criterio que el gráfico de Cliente 360.

**E · Actividad reciente** — «Últimos documentos», por **fecha de documento**,
mezclando los tres tipos, con número, cliente e importe, y click al documento.
Sin hora, porque la hora no existe. Título honesto: no es un feed en vivo.

**F · Accesos** — los de hoy, sin cambios.

**Fuera del Dashboard, a propósito:** rankings, conversión, cumplimiento, ticket
promedio, stock y el historial de mantenimiento. Todo eso es Informes.

**Funnel**: con 88 % y 81 % de enlace documental **se puede** dibujar, pero
sobre los documentos enlazados y diciéndolo («153 de 173 pedidos vienen de una
cotización»). Propuesta: **no** ponerlo en el Dashboard —ya está en Informes con
más contexto— y dejar en la home las tres métricas independientes.

## 8 · PROPOSED_REPORTS_INFORMATION_ARCHITECTURE

Informes ya está cerca. Lo que falta es profundidad y drill-down.

1. **Comercial** (existe) — sumar: filtro por **cliente** y por **estado**, y
   que el rango elegido viaje en la URL. Sin vendedor (0 datos).
2. **Rankings** (existe) — sumar: click en cliente → `PanelLateralCliente`;
   click en producto → `ModalProducto`. Sin salir de la pantalla.
3. **Drill-down** (nuevo) — cada número importante abre la lista que lo forma:
   «USD 90.714 cotizados» → las 29 cotizaciones que lo componen.
4. **Stock** (existe) — sin cambios de alcance; optimizar
   `informe_stock_catalogo` (2,6 s).
5. **Mantenimiento** (nuevo, chico) — parque, equipos con historial y servicios
   históricos, separados del trabajo actual.
6. **Export** — ya respeta filtros y ya escapa `= + - @`. Sin deuda.

---

## 9 · PROPOSED_E1_E6_PLAN

| entrega | qué | toca base |
|---|---|---|
| **E1** | Comparación de ventana equivalente + serie de 12 meses **reusando** las RPC actuales. Sólo si algo falta: una RPC nueva, `security invoker`. | probablemente no |
| **E2** | Dashboard: bloques A–D, sin actividad reciente | no |
| **E3** | Actividad reciente por fecha de documento + drill-down desde el Dashboard | no |
| **E4** | Informes: filtros de cliente/estado en URL, click a ficha 360 y a modal de producto | no |
| **E5** | Responsive 375→1920, accesibilidad, tema claro/oscuro, RLS por rol con sesión real, rendimiento (incluye `informe_stock_catalogo`) | no |
| **E6** | Cierre, batería, producción | no |

E1 puede desaparecer si la comparación entra en E2 sin RPC nueva. Se decide con
el primer prototipo.

---

## 10 · Versión nueva del frontend (§36) — sólo propuesta

La deuda existe y está medida: tras el deploy de F20, la pestaña abierta seguía
usando `Listado-JUzWqVKi.css` y la clase `_accion_1w0lo_57`; la versión nueva
recién apareció con recarga limpia.

Propuesta, **para otra fase**: el build escribe un `version.json` con el hash
del commit; la app lo consulta cada N minutos y al volver el foco; si cambió,
muestra una barra discreta «Hay una versión nueva · Actualizar». Nunca recarga
sola, y el botón se desactiva si hay un formulario con cambios sin guardar. No
se mezcla con Dashboard.

---

## 11 · Cierre de E0

```
DB_CHANGES_APPLIED = 0
PROD_DATA_CHANGED  = 0
STEL_WRITES        = 0
RT-ERP00001        = draft (sin tocar)
```

Nada implementado: esta entrega es medición y propuesta.
