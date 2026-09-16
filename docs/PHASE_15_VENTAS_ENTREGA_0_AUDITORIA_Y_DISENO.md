# FASE 15 · VENTAS — ENTREGA 0: AUDITORÍA Y DISEÑO

> Sólo análisis y propuesta. **No se modificó código, ni base, ni STEL, ni el cutover.**
> Ventas productiva sigue bloqueada por autoridad STEL (rollback del 2026-09-16 15:03 UTC);
> nada de este documento depende de eso ni lo toca. 2026-09-16.

---

## A. Estado actual

### El hallazgo que cambia el plan

La base **ya tiene casi todo** lo que el rediseño necesita. Lo que falta no es modelo: es
pantalla, y en algunos casos importación.

| Lo que parecía faltar | Realidad |
|---|---|
| Contacto del documento | `contact_id` existe en cotizaciones, pedidos y remitos, y hay **87 contactos** cargados. **0 documentos lo usan.** |
| Adjuntos | Tabla `attachments` genérica (`entity_type` + `entity_id`) y panel funcionando en las tres pantallas. **0 archivos subidos.** |
| Trazabilidad | `sales_audit` con `action`, `from_status`, `to_status`, `diff`, `actor_id`. **Nadie la lee**: el servicio es sólo de escritura. Hay **2 eventos** en total. |
| Descripción comercial separada del producto | `description_snapshot` existe y está **poblada en 908 de 1032 líneas (88 %)** de cotización. La grilla de edición no la deja tocar. |
| Vendedor | `salesperson_id` existe en cotizaciones y pedidos. **Siempre NULL.** |

Es decir: **la mayor parte de los "gaps" son de UI, no de schema.** Eso abarata mucho la fase.

### Volumen y estados reales (script `fase15-ventas-auditoria.mjs`)

| | Documentos | Importados | Del ERP | Líneas (prom / máx) | Estados presentes |
|---|---|---|---|---|---|
| Cotización | 306 | 305 | 1 | 3,4 / 33 | accepted 162 · sent 143 · draft 1 |
| Pedido | 172 | 171 | 1 | 3,5 / 29 | confirmed 171 · draft 1 |
| Remito | 193 | 193 | 0 | 3,3 / 29 | delivered 193 |

Monedas conviviendo: USD, ARS y EUR en cotizaciones. **Los totales nunca se suman entre monedas.**

Los pedidos tienen además tres estados que la UI no muestra: cumplimiento (**145 entregados, 27
pendientes**), facturación (**172 sin facturar**) y cobro (**172 sin cobrar**). Los dos últimos son
uniformes porque todavía no hay facturas ni cobros cargados.

Todas las líneas son `item`: **no hay un solo capítulo ni servicio en datos reales**, aunque el
modelo y el editor los soportan.

### Campos que existen y están siempre vacíos

Un campo así no se puede mostrar: no hay de dónde sacar el dato. Hay que decidir si se llena o se
retira del diseño.

| Documento | Cabecera siempre vacía | Línea siempre vacía |
|---|---|---|
| Cotización | `contact_id`, `salesperson_id`, `valid_until`, `notes`, `approved_by`, `approved_at` | `brand_snapshot`, `list_price_snapshot`, `kit_components_snapshot`, `notes` |
| Pedido | `contact_id`, `salesperson_id`, `po_id`, `exchange_rate`, `cost_center`, `shipping_address_id`, `billing_address_id`, `notes` | `quote_line_id`, `po_line_id`, `customer_product_code`, `customer_description`, `list_price_snapshot`, `notes` |
| Remito | `shipping_address_id`, `contact_id`, `carrier`, `tracking`, `notes`, `created_by`, `updated_by`, `exchange_rate` | ninguna |

Dos consecuencias concretas:

- **La UI de pedido muestra hoy «Contacto» y siempre dice «Sin registrar»** — un campo decorativo.
- `quote_line_id` vacío significa que **no hay trazabilidad línea a línea** entre cotización y
  pedido, ni siquiera en el pedido que emitió el ERP. Sólo hay vínculo a nivel documento.

---

## B. STEL — qué mirar y qué no

Auditado por la API de sólo lectura sobre documentos reales (COTI02558, PDV01321, RT0000001433).
**No se entró a la interfaz web de STEL**: no hay sesión disponible y no corresponde manejar
credenciales ajenas. Lo que sigue sale del modelo de datos que la API expone y de cómo el ERP
legacy —que copia a STEL— presenta ese modelo.

### Campos de cabecera que devuelve STEL

`id` · `full-reference` · `reference` · `date` · `creation-date` · `utc-last-modification-date` ·
`account-id` · **`agent-id`** · `creator-id` · `document-state-id` · `serial-number-id` ·
`parent-document-id` · `parent-document-path` · `title` · `currency-code` · `currency-rate` ·
`discount-percentage` · `discount-total-amount` · `subtotal-amount` · `tax-total-amount` ·
`total-amount` · **`tax-breakdown`** · `primary-tax-enabled` · `secondary-tax-enabled` ·
`income-tax-enabled` · `income-tax-percentage` · **`payment-option-id`** · `validity-date` ·
`deleted` · `comentarios` · `external-id`

### Campos de línea

`id` · `order` · **`line-type`** · `deleted` · `item-id` · `item-path` · `item-reference` ·
`item-name` · **`item-description`** · `item-deleted` · `units` · `item-base-price` ·
`discount-percentage` · `total-amount` · `primary-tax-percentage` · `secondary-tax-percentage` ·
`income-tax-enabled` · `parent-document-id` · `warehouse-id`

**Dato central: los tres documentos de STEL tienen exactamente la misma forma.** No hay un solo
campo exclusivo de pedido ni de remito. Eso valida la idea de una estructura única para los tres.

Y dos ausencias que importan: **STEL no tiene contacto a nivel documento** (sólo `account-id`) y
**tampoco tarifa** (la tarifa vive en el cliente, `rate-id`, como se midió en Fase 14 E4). Así que
el contacto y la tarifa del formulario legacy **no vienen de STEL**: son del legacy.

### Patrones de STEL

| Patrón | Veredicto | Por qué |
|---|---|---|
| Acciones arriba, siempre visibles | **KEEP IDEA** | Es exactamente lo que falta hoy: nuestras acciones están en el flujo, después de los avisos |
| Misma estructura en los tres documentos | **KEEP IDEA** | Se aprende una vez. STEL lo sostiene incluso en el modelo de datos |
| Tabs abajo (Más información · Adjuntos · Firma · Relacionados) | **ADAPT** | La idea sirve; los nombres y el reparto no. «Más información» es un cajón de sastre |
| Líneas muy visibles, con mucha densidad | **KEEP IDEA** | Es el centro del documento y hoy compite con secciones que importan menos |
| Totales al final de las líneas | **KEEP IDEA** | Con una corrección: separados por moneda |
| Cabecera en dos columnas | **ADAPT** | Sirve en ≥1024; en mobile va apilado |
| Estados propios de STEL («Pendiente», «Cerrada») | **DO NOT COPY** | Nuestro modelo tiene estados distintos y más finos (cumplimiento aparte). Ya están traducidos en `lib/estados.ts` |
| Tab «Firma» | **DO NOT COPY** por ahora | Ver § E.4 |
| `tax-breakdown` por alícuota | **ADAPT** | Útil de mostrar; hoy sólo guardamos el total de impuesto |

---

## C. Legacy — `buscatoolsjano-web.github.io/Buscatools`

Auditado en el navegador. Es una demo pública: el catálogo tiene 21.772 productos reales, pero
**Ventas está vacía** (0 cotizaciones) y el resto está detrás de login. Lo que sí se pudo observar
es la **estructura**, que es la referencia funcional que pidió el usuario.

### Formulario de cotización del legacy

Cabecera en dos columnas (el `!` marca obligatorio):

`!Referencia` · `!Cliente` · **`Contacto`** · **`Forma de pago`** · **`Cuenta bancaria`** ·
`!Fecha` · `Estado` · `Título` · `!Creado por` · **`!Agente`** · **`Tarifa`** · `Moneda / T.C.` ·
`% Dto.`

Líneas: `Referencia` · `Nombre` · **`Descripción`** · `Precio base (USD)` · `Uds.` · `% Dto.` ·
`Subtotal (USD)` · `% Impues.` — con acciones por fila: reordenar (⠿), abrir (↗), eliminar (🗑), más (⋯).

Debajo: `Añadir productos o servicios +` · `Nueva línea` · **`Nuevo capítulo`**.

Totales: **`📦 Uds.` · `Total base` · `IVA` · `Total`** — con las unidades incluidas.

Tabs: **Más información · Adjuntos · Firma · Relacionados**.

Acciones: `✓ Crear cotización` · `✕ Cancelar` · `👁 Vista previa`.

### Listado del legacy

Barra: `+ Nuevo` · **`📄 Importar OC`** (con «Seleccionar PDF») · `Más ▾` · `Últimos 6 meses ▾` ·
`Filtrar ▾` · `Limpiar filtros`.
Tabla: `REFERENCIA · CLIENTE · TÍTULO · ESTADO · FECHA · IMPORTE`, ordenable por columna, con filas
por página configurables (10…500) y filtro de estado inline.
Vacío accionable: «Sin cotizaciones aún. Apretá + Nuevo o cargá productos desde el Catálogo.»

| Patrón | Veredicto | Por qué |
|---|---|---|
| Cabecera de dos columnas con obligatorios marcados | **KEEP IDEA** | Denso y legible; el `!` es más claro que un asterisco perdido |
| Contacto y Tarifa en el documento | **ADAPT** | El modelo ya tiene `contact_id`; la tarifa **no existe** en nuestros documentos (§ E.2) |
| Unidades en el bloque de totales | **KEEP IDEA** | Barato y muy útil para revisar de un vistazo |
| Botón «Nuevo capítulo» | **KEEP IDEA** | Ya está implementado en nuestro editor; nunca se usó en datos |
| Descripción editable por línea | **KEEP IDEA** | El dato existe y está poblado; la grilla no lo expone (§ E.1) |
| «Importar OC» desde PDF | **FUTURE** | Flujo valioso y concreto, fuera del alcance de Fase 15 |
| «Cuenta bancaria» en el documento | **DO NOT COPY** por ahora | No existe en el modelo y nadie lo pidió |
| Filas por página hasta 500 | **DO NOT COPY** | Nuestro listado pagina del lado del servidor; 500 filas en mobile es una trampa |
| Estados «Pendiente/Cerrada/Rechazada» | **DO NOT COPY** | Son los de STEL; los nuestros ya están traducidos |

---

## D. React hoy

### Rutas (`src/app/routes.tsx`)

`/ventas/cotizaciones` · `/nueva` · `/:id` — `/ventas/pedidos` · `/nuevo` · `/:id` —
`/ventas/entregas` · `/:id`.
**No hay** ruta de edición, ni alta de remito (se generan desde el pedido), ni tablero de Ventas.

### Estructura del detalle

Las tres páginas comparten esqueleto: `PageHeader` → `AvisosHistoricos` → `AvisoAutoridadStel` →
`Alert` de error → `ActionBar` → secciones apiladas (`DocSection`) → modales.

**No hay pestañas en Ventas.** El componente `Tabs` existe y lo usan clientes, compras,
mantenimiento e informes; Ventas es el único módulo que quedó con scroll vertical de secciones.

| Elemento actual | Veredicto |
|---|---|
| `PageHeader` con número, chips, cliente · fecha · título y total | **KEEP** — ya es casi el header propuesto |
| `ActionBar` con slots primary/secondary/danger/note | **KEEP** + **MOVE** (hoy va después de los avisos; debe ir arriba y quedarse a la vista) |
| Secciones apiladas «Datos del…», «Líneas», «Adjuntos», «Relacionados» | **REDESIGN** → pestañas |
| «Entregas» y «Stock» del pedido | **MOVE** → pestaña Líneas (Entregas) e Información (Stock) |
| `AvisosHistoricos` + badge «Migrado» | **MERGE** → un solo indicador de origen (§ 25 del pedido) |
| `AvisoAutoridadStel` | **KEEP** — es el motivo visible del bloqueo, y sigue siendo necesario |
| `TablaLineas` (lectura) con cards por CSS en mobile | **KEEP** |
| `EditorLineas` (edición) | **REDESIGN** — no se convierte en cards: queda scroll horizontal de 46rem |
| Edición campo a campo al `onBlur` | **REDESIGN** — ver § L |
| `PanelAdjuntos` | **KEEP** + **MOVE** a pestaña |
| `PanelRelacionados` (5 secciones fijas) | **KEEP** + **MOVE** a pestaña |
| `services/auditoria.ts` (sólo escritura) | **REDESIGN** — falta la lectura |
| `ListadoDocumentos` con su propio patrón responsive | **MERGE** → `ResponsiveTable`, que ya existe |

### Lo que ya está bien y no hay que tocar

`lib/estados.ts` (tabla única de estados y tonos), `lib/totales.ts` (previsualización, con el
servidor como autoridad), `lib/autoridad.ts` (`MENSAJES_WORKFLOW`, `motivoBloqueo`),
`lib/permisos.ts` (`escribeVentas` = admin/employee), `useAutoridadNumeracion`.

---

## E. Gaps

### E.1 · Gaps de UI (el dato existe, la pantalla no lo usa) — los más baratos

| Gap | Evidencia |
|---|---|
| Descripción de línea no editable | `description_snapshot` poblada en 908/1032 líneas; `EditorLineas` no tiene control para ella |
| Trazabilidad invisible | `sales_audit` existe con `diff`; no hay lectura, ni hook, ni componente |
| Valor anterior perdido | Los cambios de cabecera se registran con `from: null` (`CotizacionDetallePage`) — el timeline no podrá decir «de X a Y» |
| Sin pestañas | Todo es scroll; las líneas —lo importante— compiten con adjuntos y relacionados |
| `EditorLineas` inusable en mobile | Scroll horizontal de 46rem |
| Estados de facturación y cobro ocultos | El pedido tiene cuatro estados en el modelo; la UI muestra dos |
| Adjuntos sin clasificar | La constante `CLASES` existe sin uso; borrar no pide confirmación |
| Campos decorativos | «Contacto» se muestra siempre vacío en pedido y remito |

### E.2 · Gaps de modelo (falta la columna)

| Campo | STEL | Legacy | React | ¿Hace falta? | ¿Migración? | Prioridad |
|---|---|---|---|---|---|---|
| **Tarifa / lista de precios del documento** | no (está en el cliente) | sí | **no** | Sí, si se quiere cotizar con listas distintas | Sí: `price_list_id` en los 3 | **Alta** |
| **Desglose de impuesto por alícuota** | sí (`tax-breakdown`) | parcial | no (sólo `tax_amount`) | Deseable para imprimir | Calculable sin migrar | Media |
| Cuenta bancaria | no | sí | no | Sin pedido explícito | Sí | Baja |
| Firma | sí (tab) | sí (tab) | no | Sin necesidad demostrada | Sí | Baja |
| `line_no` en líneas de remito | sí (`order`) | — | **no** | Sí, para ordenar igual que los otros | Sí | Media |
| `line_type` en líneas de remito | sí | — | **no** | Sólo si el remito acepta capítulos | Sí | Baja |
| `description_snapshot` en líneas de remito | sí | — | **no** | Sí, para que el remito imprima igual | Sí | Media |

**El remito es el hermano pobre**: sus líneas no tienen `line_no`, `line_type`, `description_snapshot`
ni `notes`. La «misma estructura en los tres documentos» tiene ahí un límite real de modelo.

### E.3 · Gaps de datos (la columna existe y está vacía)

`contact_id` (87 contactos disponibles, 0 usados) · `salesperson_id` · `valid_until` ·
`payment_terms` (1 de 306) · `exchange_rate` en pedidos y remitos · `carrier` y `tracking` ·
direcciones de envío y facturación · `quote_line_id`.

La importación desde STEL no los trajo porque **STEL no los tiene a nivel documento** (contacto,
tarifa) o porque no se mapearon (agente, forma de pago). No es un defecto de la reconciliación:
es una decisión pendiente sobre si esos datos se cargan a mano de acá en más.

### E.4 · Firma

| Fuente | ¿La tiene? |
|---|---|
| STEL | Sí, pestaña propia |
| Legacy | Sí, pestaña propia (vacía en la demo) |
| React | No existe modelo |
| Uso real observado | Ninguno |

**Veredicto: `NOT_BY_DESIGN` por ahora.** No se agrega sólo porque STEL la tenga. Si aparece la
necesidad real (conformidad de entrega firmada por el cliente), el lugar natural es el remito, y
entonces se evalúa como `FUTURE` con su propio modelo.

---

## F. Arquitectura propuesta

Una sola estructura para los tres documentos:

```
┌──────────────────────────────────────────────────────────────────────┐
│ ← Cotizaciones                                                        │
│                                                                       │
│ COTI02558   [Cerrada] [Migrada de STEL]              ARS 624.345,48  │
│ Consulta MercadoLibre · 16/09/2026                            Total   │
│ 2026 09 16 VENTA MERCADO LIBRE VARIOS                                 │
├──────────────────────────────────────────────────────────────────────┤
│ [Generar pedido]  Editar  Ver / Imprimir  Enviar   Más ▾              │
│ Emisión desde el ERP bloqueada: STEL numera las cotizaciones.         │
├──────────────────────────────────────────────────────────────────────┤
│ Líneas │ Información │ Adjuntos │ Relacionados │ Trazabilidad         │
└──────────────────────────────────────────────────────────────────────┘
```

Tres bloques fijos —**identidad, acciones, pestañas**— y debajo el contenido de la pestaña. Lo que
cambia entre documentos es el workflow, los campos propios y qué pestañas traen datos; **la
estructura no cambia**.

Por qué pestañas y no el scroll actual: hoy las líneas —lo único que se mira siempre— quedan
después de la cabecera y compiten con adjuntos, relacionados, entregas y stock. Con pestañas, abrir
un documento muestra **las líneas de entrada**, y lo secundario está a un clic sin perder el header.

---

## G. Cotización

**Acción principal:** `Generar pedido` (o `Marcar como enviada` en borrador).

Campos propios: `valid_until` (Válida hasta), `discount_pct`, `perception_pct`, `approved_by/at`.

| Campo | STEL | Legacy | React | Fuente real | Editable | Estado en que edita | Permiso |
|---|---|---|---|---|---|---|---|
| Número | `full-reference` | Referencia | `number` | server | **no** | — | — |
| Serie | `serial-number-id` | — | `series_code` | server | no | — | — |
| Estado | `document-state-id` | Estado | `status` | server | vía acciones | — | admin/employee |
| Fecha | `date` | Fecha | `quote_date` | ✔ | sí | draft, sent | admin/employee |
| Cliente | `account-id` | Cliente | `customer_id` | ✔ | sí | draft, sent | admin/employee |
| **Contacto** | ✘ | Contacto | `contact_id` | **vacío** | sí (propuesto) | draft, sent | admin/employee |
| Título | `title` | Título | `title` | ✔ | sí | draft, sent | admin/employee |
| **Vendedor** | `agent-id` | Agente | `salesperson_id` | **vacío** | sí (propuesto) | draft, sent | admin/employee |
| **Forma de pago** | `payment-option-id` | Forma de pago | `payment_terms` | casi vacío | sí | draft, sent | admin/employee |
| Moneda | `currency-code` | Moneda | `currency_code` | ✔ | **no en detalle** | sólo en alta | — |
| Tipo de cambio | `currency-rate` | T.C. | `exchange_rate` | parcial | sí | draft, sent | admin/employee |
| **Tarifa** | ✘ | Tarifa | **no existe** | — | — | — | § E.2 |
| Válida hasta | `validity-date` | — | `valid_until` | **vacío** | sí | draft, sent | admin/employee |
| % Dto. global | `discount-percentage` | % Dto. | `discount_pct` | ✔ | sí | draft, sent | admin/employee |
| % Percepción | `income-tax-percentage` | — | `perception_pct` | ✔ | sí | draft, sent | admin/employee |
| Observaciones | — | — | `notes` | **vacío** | sí | draft, sent | admin/employee |
| Origen | `external-id` | — | `imported_at`/`legacy_source` | ✔ | no | — | — |
| Creado por | `creator-id` | Creado por | `created_by` | ✔ | no | — | — |
| Timestamps | sí | — | `created_at`/`updated_at` | ✔ | no | — | — |

**Regla que no se toca:** editar una cotización ya enviada registra los cambios de precio
(`audita: true`); una cotización `accepted`/`rejected`/`expired` no se edita.

---

## H. Pedido

**Acción principal:** `Confirmar pedido` (draft) → `Generar nota de entrega` (confirmed).

Diferencias con la cotización:
- Dos chips de estado: comercial (`commercial_status`) + cumplimiento (`fulfillment_status`).
- Campos propios: `quote_id`, `origin`, `po_id`, `cost_center`, direcciones, y los estados de
  facturación y cobro **que hoy no se muestran**.
- No tiene `valid_until` (el formulario lo manda igual y el mapeo lo ignora — **corregir**).
- La pestaña Líneas suma el panel de **Entregas** (pedido / entregado / pendiente por línea).
- **No se edita si ya tiene entregas.** Esa regla se mantiene tal cual.

---

## I. Remito

**Acción principal:** `Confirmar y despachar` (única, y sólo en borrador).

Diferencias:
- **Nunca editable** hoy, y así queda: despachar mueve stock y cancelar un remito despachado está
  bloqueado en la base (`DELIVERY_ALREADY_DISPATCHED`).
- No tiene vendedor, forma de pago, descuento global ni percepción.
- Tiene `carrier`, `tracking`, `shipping_address_id` — los tres vacíos: candidatos a mostrarse en
  Información **sólo si se decide cargarlos**.
- Sus líneas no tienen `line_no` ni `description_snapshot`: la pestaña Líneas del remito va a verse
  más pobre que las otras dos hasta que se resuelva § E.2.
- No tiene alta propia: se generan desde el pedido.

---

## J. Pestañas

| Pestaña | Cotización | Pedido | Remito | Fuente | ¿Hay datos? | Gap |
|---|---|---|---|---|---|---|
| **Líneas** | ✔ | ✔ + Entregas | ✔ | `*_lines` | Sí (1032 / 600 / 631) | Remito sin `line_no` ni descripción |
| **Información** | ✔ | ✔ + Stock | ✔ | cabecera | Parcial | Muchos campos vacíos (§ E.3) |
| **Adjuntos** | ✔ | ✔ | ✔ | `attachments` | **0 archivos** | Sin clasificación ni drag&drop |
| **Relacionados** | ✔ | ✔ | ✔ | `relacionados.ts` | Sí docs; facturas y cobros vacíos | Facturas/cobros no navegables |
| **Trazabilidad** | ✔ | ✔ | ✔ | `sales_audit` | **2 eventos** | **No hay lectura** + `from: null` |

La pestaña por defecto es siempre **Líneas**. Una pestaña sin datos se muestra igual, con su vacío
explicado — no se esconde, porque desaparecer y aparecer confunde más que un «Sin archivos adjuntos».

---

## K. Matriz de acciones

`AUT` = depende de la autoridad de numeración. Hoy, con autoridad STEL, todas las marcadas están
deshabilitadas con el motivo a la vista.

| Documento | Acción | Rol | Estado | AUT | Visible | Habilitada | Ubicación |
|---|---|---|---|---|---|---|---|
| Cotización | **Generar pedido** | admin/employee | ≠ rejected | sí (`sales_order`) | sí | si no tiene pedido y autoridad ERP | **PRIMARY** |
| Cotización | Marcar como enviada | admin/employee | draft | sí (`quote`) | sí | autoridad ERP | PRIMARY si draft |
| Cotización | Marcar aceptada | admin/employee | sent | sí | sí | autoridad ERP | SECONDARY |
| Cotización | Marcar rechazada | admin/employee | sent | no | sí | sí | MORE ▾ |
| Cotización | Editar | admin/employee | draft, sent | no | sí | según `editabilidad()` | SECONDARY |
| Cotización | Duplicar | admin/employee | cualquiera | sí (`quote`) | sí | autoridad ERP | MORE ▾ |
| Cotización | Cancelar | admin/employee | no cerrada | no | sí | sí | DANGER (MORE ▾) |
| Cotización | Eliminar | admin/employee | no histórico | no | sí | sí | DANGER (MORE ▾) |
| Pedido | **Generar nota de entrega** | admin/employee | confirmed | sí (`delivery`) | sí | autoridad ERP | **PRIMARY** |
| Pedido | **Confirmar pedido** | admin/employee | draft | sí (`sales_order`) | sí | autoridad ERP | **PRIMARY** si draft |
| Pedido | Editar | admin/employee | draft, confirmed | no | sí | **no si tiene entregas** | SECONDARY |
| Pedido | Duplicar / Cancelar / Eliminar | admin/employee | — | parcial | sí | — | MORE ▾ / DANGER |
| Remito | **Confirmar y despachar** | admin/employee | draft | sí (`delivery`) | sí | autoridad ERP | **PRIMARY** |
| Remito | Editar | — | — | — | **no existe** | — | — |
| Remito | Duplicar | — | — | — | **no existe** | — | — |
| Remito | Cancelar / Eliminar | admin/employee | no despachado | no | sí | sí | DANGER (MORE ▾) |
| Los tres | Ver / Imprimir | cualquiera | cualquiera | no | sí | sí | SECONDARY |
| Los tres | **Enviar** | admin/employee | — | no | **propuesta** | — | SECONDARY (§ 21) |
| Los tres | Exportar CSV | cualquiera | — | no | hoy sólo en listado | sí | MORE ▾ |

Clasificación pedida: `PRIMARY` = la acción del workflow · `SECONDARY` = Editar, Ver/Imprimir,
Enviar · `MORE_MENU` = Duplicar, Exportar, Marcar rechazada · `DANGER` = Cancelar, Eliminar (dentro
de Más, con confirmación) · `BLOCKED_BY_AUTHORITY` = todas las de emisión cuando manda STEL, con
`motivoBloqueo()` visible y enlazado por `aria-describedby` · `BLOCKED_BY_STATE` = las que dependen
del estado · `BLOCKED_BY_ROLE` = todo lo de escritura para vendedor/técnico/cliente.

**Regla:** la acción primaria nunca se esconde en «Más». Si está bloqueada, se ve deshabilitada
**con el motivo escrito**, nunca en un tooltip.

---

## L. Modo edición

Hoy: `Editar` es un toggle que convierte las secciones en formulario y **guarda campo por campo al
`onBlur`**. No hay Guardar ni Descartar: lo que se escribe, se guardó.

Propuesto (§ 7 del pedido):

```
VIEW MODE    → [Generar pedido]  Editar  Ver / Imprimir  Enviar  Más ▾
EDIT MODE    → [Guardar cambios]  Descartar          (3 campos modificados)
```

- Misma pantalla, sin modal.
- Los campos habilitados se vuelven controles; los demás siguen en texto.
- La barra cambia de contenido, no de lugar.
- Salir con cambios sin guardar pide confirmación.

**Esto es un cambio de comportamiento real, no cosmético.** Implica un borrador en memoria y un
guardado por lote. Dos consecuencias a decidir (§ Q):

1. Hoy **«Descartar» no es posible** porque ya se escribió. Con el cambio, sí.
2. La auditoría de campos sensibles (`unit_price`, `quantity`, `discount_pct`, `perception_pct`)
   hoy se dispara al blur. Con guardado por lote pasa a dispararse al guardar, **y recién ahí se
   puede registrar el valor anterior de verdad** — que hoy se pierde (`from: null`).

---

## M. Responsive

### Desktop 1440 / 1280

Cabecera a dos columnas en Información. Líneas a tabla completa. Totales al final de las líneas,
alineados a la derecha, con las unidades arriba.

### Tablet 1024 y 768

| Columna | 1024 | 768 |
|---|---|---|
| # | oculta | oculta |
| Referencia | visible | visible |
| Descripción | visible | **pasa al subtítulo de la card** |
| Cant. · Precio · Subtotal | visibles | visibles |
| % Dto. | visible | **al detalle de la card** |
| Impuesto | oculta (va al detalle) | al detalle |

A 768 las líneas ya son cards, igual que en mobile: intentar sostener la tabla a ese ancho es lo
que hoy produce el scroll horizontal del editor.

### Mobile 390 / 430

```
┌────────────────────────────┐
│ ← Cotizaciones             │
│ COTI02558                  │
│ [Cerrada] [Migrada]        │
│ Consulta MercadoLibre      │
│ 16/09/2026                 │
│ ARS 624.345,48       Total │
├────────────────────────────┤
│ [ Generar pedido ]         │
│ Editar   Ver / Imprimir ⋯  │
├────────────────────────────┤
│ Líneas │ Info │ Adj │ ⋯    │
├────────────────────────────┤
│ ┌────────────────────────┐ │
│ │ PRO10022               │ │
│ │ CANDADO DE BLOQUEO     │ │
│ │ LOTO VERDE UCU0120DB   │ │
│ │ 4 × ARS 14.999,00      │ │
│ │ Dto. —      IVA 21 %   │ │
│ │ Subtotal ARS 59.996,00 │ │
│ └────────────────────────┘ │
│ …                          │
├────────────────────────────┤
│ Unidades            22,00  │
│ Subtotal      ARS 515.988  │
│ IVA 21 %   ARS 108.357,48  │
│ TOTAL      ARS 624.345,48  │
└────────────────────────────┘
```

En edición, cada card se expande con controles de 44 px y tipografía de 16 px (ya resuelto en
`EditorLineas.module.css`; falta el paso a cards).

---

## N. Accesibilidad

- Pestañas con `role="tablist"` / `tab` / `tabpanel`, flechas ←→ para moverse, Home/End a los
  extremos, y la pestaña activa reflejada en la URL (`?tab=lineas`) para poder compartir el enlace.
- El motivo de bloqueo es **texto real** enlazado con `aria-describedby` desde el botón
  deshabilitado — es lo que ya hace `ActionBar` y se conserva.
- Estados nunca sólo por color: el chip lleva la palabra («Cerrada», «Sin entregar»).
- Líneas: `<table>` con `<caption>` en desktop; `<ul>`/`<li>` con encabezado por card en mobile.
- Foco visible en toda la barra; Escape cierra diálogos; Enter confirma en selectores.
- Sin trampas de teclado en el buscador de productos ni en el de clientes.
- Contraste AA en chips, totales y estados deshabilitados.

---

## O. Componentes propuestos

| Componente | Qué hace | Base actual |
|---|---|---|
| `DocumentHeader` | Volver, número, chips, origen, cliente · fecha · título, total | `PageHeader` (ya casi es esto) |
| `DocumentActions` | Barra con primary/secondary/más/peligro y motivo | `ActionBar` + `useAccionesDocumento` |
| `DocumentTabs` | Tablist accesible con estado en URL y carga diferida | `components/ui/Tabs` (ya existe, lo usan otros módulos) |
| `DocumentLines` | Tabla en desktop, cards en mobile, lectura y edición | `TablaLineas` + `EditorLineas` (unificar) |
| `DocumentTotals` | Unidades, subtotal, descuento, IVA, percepción, total, **por moneda** | `Totals` + `lib/totales.ts` |
| `DocumentInfo` | Cabecera en dos columnas; lectura y edición | `MetaList` + `CabeceraCotizacion` |
| `DocumentAttachments` | Subir, listar, abrir, borrar | `PanelAdjuntos` (**KEEP**) |
| `RelatedDocuments` | Cadena cotización → pedido → remito → factura → cobro | `PanelRelacionados` (**KEEP**, mejorar la cadena visual) |
| `DocumentTimeline` | Eventos legibles por persona | **nuevo** — falta la lectura de `sales_audit` |
| `CustomerContactPicker` | Cliente + contacto de ese cliente | `BuscadorCliente` + contactos (**nuevo**) |

Ninguno se crea en esta entrega.

---

## P. Plan de implementación

Ajustado respecto del sugerido: **la trazabilidad se adelanta**, porque el arreglo de `from: null`
conviene hacerlo junto con el guardado por lote, no después.

| Entrega | Qué | Por qué en ese orden |
|---|---|---|
| **E1** | Shell documental: `DocumentHeader` + `DocumentActions` arriba + `DocumentTabs`, con el contenido actual redistribuido. Cotización en modo lectura | Es puro reacomodo: sin tocar servicios ni cálculo, y ya se gana la estructura |
| **E2** | Modo edición por lote (Guardar/Descartar) + `DocumentLines` unificada con cards en mobile y descripción editable | El cambio de comportamiento más delicado, aislado |
| **E3** | Trazabilidad: lectura de `sales_audit`, timeline legible, y registro del valor anterior | Va pegado a E2: el `from` correcto sale del borrador |
| **E4** | Pedido sobre el mismo shell (Entregas y Stock dentro de pestañas) | Repite estructura ya probada |
| **E5** | Remito + decisión sobre `line_no`/`description_snapshot` en sus líneas | Necesita la decisión de § E.2 |
| **E6** | Adjuntos (clases, drag&drop, confirmación) y Relacionados (cadena visual) | Mejoras sobre algo que ya funciona |
| **E7** | Imprimir y Enviar | Enviar necesita decisión de negocio (§ Q) |

Ninguna entrega cambia cálculo, estados, permisos ni reglas de negocio sin aprobación aparte.

---

## Q. Decisiones que necesito de tu lado

### Negocio

1. **Contacto en documentos.** Hay 87 contactos cargados y ningún documento los usa. ¿Se empieza a
   elegir contacto al crear? Si no, saco el campo de la pantalla en vez de mostrarlo siempre vacío.
2. **Vendedor.** `salesperson_id` está vacío en los 478 documentos. ¿Se carga de acá en más, se
   completa retroactivamente, o se retira?
3. **Tarifa por documento.** El legacy la tiene, nosotros no, y STEL la guarda en el cliente. Es la
   única migración de modelo con prioridad alta. ¿La necesitás?
4. **Forma de pago.** Texto libre hoy (1 de 306 documentos). ¿Catálogo como en STEL, o se deja libre?
5. **Enviar por mail.** ¿Confirmás que se diseña ahora y se implementa en E7? Queda fuera del
   alcance de esta fase salvo que lo pidas.

### Producto

6. **Guardado por lote.** Cambia el comportamiento actual: hoy no existe «Descartar». ¿Confirmás?
7. **Firma.** Mi recomendación es no incorporarla (`NOT_BY_DESIGN`). ¿De acuerdo?
8. **Capítulos en líneas.** Están implementados y nunca se usaron. ¿Se mantienen visibles?

### Modelo

9. **Líneas de remito.** Les faltan `line_no`, `line_type` y `description_snapshot`. Sin eso el
   remito no puede verse ni imprimirse igual que los otros dos. ¿Se migra?
10. **Estados de facturación y cobro del pedido.** Existen en el modelo y están ocultos. ¿Se
    muestran, sabiendo que hoy no hay facturas ni cobros cargados?

---

## Deudas, separadas

**UX debt** — sin pestañas · acciones no visibles de entrada · `EditorLineas` con scroll
horizontal en mobile · adjuntos sin clasificar ni confirmación al borrar · listado con patrón
responsive propio en vez de `ResponsiveTable` · avisos de migración duplicados (banner + badge).

**Missing data** — contacto, vendedor, validez, forma de pago, tipo de cambio en pedidos y remitos,
transportista y seguimiento, direcciones, `quote_line_id`.

**Missing schema** — tarifa del documento · `line_no`, `line_type` y `description_snapshot` en
líneas de remito · desglose de impuesto por alícuota · firma · cuenta bancaria.

**Business decision** — las diez preguntas de § Q.

**Backend limitation** — el valor anterior se pierde (`from: null`) · `sales_audit` no tiene
lectura · facturas y cobros no tienen pantalla · la reserva de stock es informativa, no reserva.

---

## Archivos de esta entrega

- `docs/PHASE_15_VENTAS_ENTREGA_0_AUDITORIA_Y_DISENO.md` (este documento)
- `scripts/fase15-ventas-auditoria.mjs` — auditoría de sólo lectura: uso real de columnas, estados
  presentes, campos fantasma y tablas que alimentarían las pestañas
