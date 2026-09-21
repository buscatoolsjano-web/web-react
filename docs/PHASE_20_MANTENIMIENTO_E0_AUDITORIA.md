# Fase 20 · E0 — Mantenimiento: qué hay, qué había, y de dónde salen los activos

Fecha: 2026-09-21. Proyectos: `uaxcfufvapzulqvynanp` (React) · `hnyngsejohkmlaccpkux` (web anterior).
Scripts: [`fase20-e0-stel-activos.mjs`](../scripts/fase20-e0-stel-activos.mjs) ·
[`fase20-e0-stel-servicio.mjs`](../scripts/fase20-e0-stel-servicio.mjs).

> **Sólo lectura, en los tres lados.** STEL: únicamente GET (17 llamadas). React: únicamente
> SELECT. Web anterior: únicamente SELECT sobre `erp_store`. **0 escrituras, 0 importaciones,
> 0 cambios de esquema.**

---

## 1 · Mantenimiento en React, hoy

`CURRENT_ASSET_MODEL` — `maintenance_assets`, 25 columnas, RLS activa, 3 triggers,
único por `(company_id, reference)`, índice por `(company_id, serial_normalized)`.

| | |
|---|---|
| identidad | `reference` (texto, obligatorio, único por empresa) · `id` uuid |
| equipo | `serial_number` + `serial_normalized` (lo normaliza la base) · `identifier` · `asset_type` |
| modelo | **no hay tabla de modelos**: `brand_id` → `brands`, más `brand_text` y `model_text` libres, más `product_id` → `products` si el equipo es un producto del catálogo |
| dueño | `owner_customer_id` → `customers` (puede ser nulo) |
| procedencia | `delivery_serial_id` → `delivery_serials` (**0 filas**) |
| garantía | `warranty_start` / `warranty_end` + CHECK de coherencia · `under_contract` |
| ubicación | `city`, `state` |
| baja | `deleted_at` / `deleted_by` (baja lógica) |
| **lo que NO tiene** | `external_source`, `external_id`, `imported_at`, `last_synced_at` |

`CURRENT_SERVICE_MODEL` — `maintenance_orders`, 48 columnas, con **tres ejes de estado
independientes**: `status` (open/closed/cancelled), `stage` (diagnosis → quotation → repair →
torque → closing) y `quote_status` (pending/approved/rejected). Alrededor:
`maintenance_quote_lines`, `maintenance_order_parts`, `maintenance_order_checks`,
`maintenance_check_points`, `maintenance_measurements` (torque), `maintenance_audit`.

`CURRENT_UI` — siete rutas, todas server-side y paginadas:

| ruta | qué hay |
|---|---|
| `/mantenimiento/activos` | listado: Referencia · Nº de serie · Modelo · Dueño · Alta · órdenes · Estado. Buscador por referencia/serie/identificador, filtros por cliente/producto/tipo/estado, orden y paginación en la URL. **Sin dashboard, sin KPIs, sin chips, sin ficha rápida, sin CTA de servicio en la fila.** |
| `/mantenimiento/activos/nuevo` · `/:id` | alta y ficha completa del equipo |
| `/mantenimiento/ordenes` + `/nueva` + `/:id` | la orden con sus cinco etapas: `PanelEtapas`, `PanelCotizacion`, `PanelRepuestos`, `PanelTorque`, `PanelChecks`, `PanelCierre`, `PanelAdjuntos`, `PanelHistorial` |
| `/mantenimiento/puntos` | los puntos de revisión (configuración) |

`CURRENT_DATA_COUNTS` — **el módulo está vacío**, y se confirmó tabla por tabla:

| tabla | filas |
|---|---|
| `maintenance_assets` | **0** |
| `maintenance_orders` | **0** |
| `maintenance_order_parts` · `quote_lines` · `order_checks` · `measurements` · `audit` | **0** |
| `maintenance_check_points` | **16** (catálogo de revisión, cargado) |
| `delivery_serials` | **0** |

`CURRENT_GAPS`

1. **No hay datos.** La pantalla está bien construida y no tiene nada que mostrar.
2. **No hay dashboard.** El legacy abría en un panel con cuatro números y la lista abajo; React abre en una tabla.
3. **No hay ficha rápida** del activo (sí la tiene Clientes desde E7).
4. **No hay CTA «Servicio»** en la fila: para abrir una orden hay que ir a otra pantalla.
5. **No hay procedencia**: si mañana se importa de STEL, no hay dónde decir que vino de STEL.
6. **No hay modelos como entidad**: `model_text` libre. Con 102 variantes de texto para ~60 modelos reales, un listado por modelo saldría sucio.
7. **El rol `technician` no existe en la práctica**: la RLS usa `admin` + `employee` para leer y escribir (misma lista), y hay **0 membresías** con rol técnico. Está documentado como decisión, no es un descuido.

---

## 2 · La web anterior (`erp_store`)

El módulo de Mantenimiento de la web propia guardaba todo en `localStorage`, sincronizado contra
la tabla `erp_store` del proyecto legacy con las claves `mant_activos`, `mant_fichas`,
`mant_historico`, `mant_clientes`, `mant_marcas`, `mant_repuestos`, `mant_lotes`, `mant_manuales`.

**Lo que hay ahí dentro, medido:** `mant_activos` = **1 activo de prueba** (`ACT00001`,
identificador «Prueba», serie 123456, 6 servicios contados a mano), `mant_fichas` = **0**,
`mant_historico` = **3**, `mant_marcas` = **0**. Es un piloto, no una base productiva.

Su modelo de activo era: `id` · `tipo` · `marca` · `modelo` · `serie` · `ciudad` ·
`clienteNombre` (**texto libre, no un id**) · `identificador` · `serviciosCount` ·
`ultimoServicio`.

### `LEGACY_FEATURE_MATRIX`

| LEGACY_FEATURE | REACT_CURRENT | DECISIÓN |
|---|---|---|
| Dashboard con 4 KPIs (Activos · Modelos · Clientes · Servicios) | no existe | **IMPROVE** — se replica, con los números derivados de datos reales |
| Buscador (ref, cliente, modelo, serie) | buscador por ref/serie/identificador | **IMPROVE** — agregar cliente y modelo |
| Chips: Todos · Con servicio · Mis fichas · uno por modelo | filtros en desplegables | **IMPROVE** — chips sí; «uno por modelo» sólo si el texto se normaliza (102 variantes hoy) |
| Fila de activo: REF · identificador+modelo · cliente+ciudad · serie+últ. svc · nº de servicios · estado · técnico · botón «Servicio →» | tabla sin CTA ni contador visible de servicios | **IMPROVE** — es la fila que se quiere |
| Estados de la fila: OK · EN SERVICIO · COTIZ. PENDIENTE · EN ESPERA | `status` + `stage` + `quote_status` | **KEEP** — los tres primeros se derivan de lo que ya hay; **EN ESPERA no existe** (ver abajo) |
| Ficha de servicio en 5 pasos: Diagnóstico → Cotización → Reparación → Torque → Cierre | **igual**, `stage` con los mismos cinco valores | **KEEP** — React ya es fiel al circuito |
| Pausar / reanudar ficha + vista «Fichas pausadas» | no existe | **UNKNOWN** — requiere una columna o un estado nuevo; se decide con Juan |
| Historial + detalle de histórico | `PanelHistorial` + `maintenance_audit` | **KEEP** |
| Repuestos y despiece | `PanelRepuestos` + `maintenance_order_parts` | **KEEP** |
| Torque (mediciones y veredicto) | `PanelTorque` + `maintenance_measurements` | **KEEP** |
| Marcas / Modelos (ABM) | tabla `brands`; modelos como texto | **IMPROVE** — normalizar modelos antes de listarlos |
| Cotización por lotes | no existe | **UNKNOWN** — sin datos para justificarlo todavía |
| Manuales / PDF por modelo | adjuntos por orden | **DROP por ahora** — no hay manuales cargados en ningún lado |
| Exportar | `lib/csv.ts` | **KEEP** |
| Usuarios del módulo | Configuración + membresías | **KEEP** |
| Notificaciones de ficha (`_mantNotify`) | no existe | **UNKNOWN** |
| Clientes del módulo (lista propia) | `customers` del ERP | **DROP** — una segunda lista de clientes es el problema que la migración vino a resolver |

**Bugs del legacy que NO se copian:** el cliente del activo es texto libre (`clienteNombre`), los
servicios se cuentan en un campo guardado (`serviciosCount`) que se desincroniza, y la lista de
modelos sale de agrupar texto sin normalizar.

---

## 3 · STEL Order — dónde están los activos de verdad

`STEL_ASSET_SOURCE` = **`GET /app/assets`**. No es «producto vendido»: STEL tiene una entidad
propia de activo, con su referencia `ACTxxxxx`, su cuenta, su serie y su garantía. Las referencias
van de `ACT00001` a `ACT00373` — el mismo formato que usaba el piloto de la web anterior.

| clave | valor |
|---|---|
| `STEL_ASSET_ID` | `id` (entero estable) · `full-reference` (`ACT00186`) |
| `STEL_SERIAL_FIELD` | `serial-number` (texto). **Ojo:** `serial-number-id` NO es la serie del equipo, es la serie de numeración del documento |
| `STEL_MODEL_FIELD` | `model` (texto libre) + `brand` (texto libre) |
| `STEL_CUSTOMER_FIELD` | `account-id` + `account-path` (`/clients/` o `/potentialClients/`) |
| `STEL_REFERENCE_FIELD` | `full-reference` |
| `STEL_STATUS_FIELD` | no hay estado de servicio. Hay `subject-to-maintenance` (booleano) y `deleted` |
| `STEL_LAST_ACTIVITY_FIELD` | `utc-last-modification-date` (de 2022-11-03 a 2026-09-04) |
| otros | `name`, `identifier`, `description`, `private-comments`, `warranty-start-date`, `warranty-end-date`, `address-id`, `asset-images[]` |

`STEL_ASSETS_FOUND` = **358** (0 borrados).

### `STEL_SERVICE_HISTORY_AVAILABLE` = sí, pero **no donde parecía**

| colección | filas | con activo | estados |
|---|---|---|---|
| `incidents` | 960 | **8** | Un solo estado real; **no son servicios**: 952 son el registro de envío de facturas electrónicas («Enviado: Factura 00025A… a …», referencias `OC-CLI…`). Descartado como fuente |
| `workEstimates` | 31 | 26 | Pendiente 9 · Cerrada 22 · 2022–2026 |
| **`workOrders`** | **21** | **17** | Cerrada 19 · Pendiente 2 · 2023–2026 · referencias `ORT00001…` |
| `workDeliveryNotes` | 30 | 29 | Pendiente de facturar 11 · Facturada 19 |

El circuito de servicio real en STEL es **presupuesto → orden de trabajo → remito de servicio**,
82 documentos en total, todos con líneas, importes, fechas y activo vinculado. Es poco, pero es
real, y encaja con `maintenance_orders` + `maintenance_quote_lines`.

---

## 4 · Identidad y emparejamiento

`ASSET_NATURAL_KEY` = **`assets.id` de STEL** (entero, estable, presente en los 358).
No el nombre —358 activos y hay `name` con nombres de personas—, no la serie —4 no tienen y 10
repiten—, no el modelo.

`IMPORT_IDEMPOTENCY_KEY` = **`(company_id, external_source='stel', external_id=<assets.id>)`**.
Es la convención que ya usan `products`, `sales_quotes`, `sales_orders`, `deliveries` y `payments`.
`maintenance_assets` **no tiene esas columnas**: ver `IMPORT_SCHEMA_CHANGES_REQUIRED`.

### Clientes (`MATCHED_CUSTOMERS`)

Determinístico, en este orden y sin difusos: **CUIT** (`tax-identification-number` normalizado a
dígitos) → **`legacy_ref`** (la referencia `CLIxxxxx` del cliente de STEL contra
`customers.legacy_ref`). El nombre **sólo se reporta**, nunca se usa para importar.

| | |
|---|---|
| `MATCHED_CUSTOMERS` | **356** de 358 (208 por CUIT · 148 por `legacy_ref`) |
| `UNMATCHED_CUSTOMERS` | **2** (son los 2 activos que en STEL no tienen cuenta) |
| coincidencias sólo por nombre | **0** |
| cuentas que son «cliente potencial» | **0** |
| clientes distintos con activos | **16** — y dos de ellos concentran 141 y 134 equipos |

### Modelos (`MATCHED_MODELS`)

| | |
|---|---|
| `MATCHED_MODELS` | **0** |
| `UNMATCHED_MODELS` | **350** |
| sin modelo | **8** |
| textos de modelo distintos | **102** |
| marcas distintas | **13** (FEIN 204 · FIAM 69 · TORERO 29 · URYU 19 · YOKOTA 14 · BOSCH 6 · …) |

**Ningún modelo coincide con un producto del catálogo**, y el motivo no es que falten productos:
son modelos de fabricante (`ASM18-12-PC`), no SKU de Buscatools. Además el mismo modelo aparece
escrito de tres formas (`ASM18-12- PC`, `ASM 18-12-PC`, `ASM18-12-PC`). Importar cada texto como
un modelo distinto crearía exactamente los duplicados que §9 pide evitar.

**Propuesta:** importar `brand_text` y `model_text` tal cual vienen —son el dato original— y
guardar además un modelo normalizado para agrupar (mayúsculas, sin espacios ni guiones). Sin tabla
de modelos y sin inventar `product_id`.

### Series

| | |
|---|---|
| con serie | 354 de 358 |
| `MISSING_SERIAL` | **4** |
| `DUPLICATE_SERIALS` | **10** activos en **5** grupos de serie normalizada, con **7** escrituras distintas (varios difieren sólo en espacios o guiones). *Corregido en E1: acá decía «7 grupos», que eran las escrituras, no los grupos.* |
| `AMBIGUOUS` | **0** (ningún CUIT ni referencia resolvió a dos clientes) |

---

## 5 · La importación propuesta (NO ejecutada)

| decisión | propuesta |
|---|---|
| `INSERT_ONLY / UPSERT` | **UPSERT por la clave de idempotencia**, pero en la primera corrida son todas altas |
| `MATCH_KEY` | `(company_id, 'stel', assets.id)` |
| `UPDATE_POLICY` | Sólo campos que vengan de STEL y **sólo si el registro es de STEL**. Un activo creado a mano en el ERP no se pisa nunca |
| `CONFLICT_POLICY` | Si la `reference` ya existe con otro `external_id` → **no se toca y se reporta**. Serie duplicada → se importa igual (es un dato real) y se marca para revisión |
| `DELETED_IN_STEL_POLICY` | **No se borra nada.** Un activo que desaparezca de STEL se reporta; la baja la decide una persona |
| provenance | `external_source='stel'`, `external_id`, `imported_at`, y `last_synced_at` en las corridas siguientes |

`WOULD_INSERT` = **358** · `WOULD_UPDATE` = **0** · `WOULD_SKIP` = **0**

`IMPORT_SCHEMA_CHANGES_REQUIRED` = **sí, y es la única decisión de base que hay que tomar**:

```sql
-- Propuesta, NO aplicada:
alter table maintenance_assets
  add column external_source text,
  add column external_id     text,
  add column imported_at     timestamptz,
  add column last_synced_at  timestamptz;
create unique index maintenance_assets_externo
  on maintenance_assets (company_id, external_source, external_id)
  where external_id is not null;
```

Alternativa sin tocar el esquema: usar `reference` = `full-reference` de STEL como clave. **No se
recomienda**: si STEL renumera, se duplican los activos, y no quedaría forma de contestar «¿este
equipo vino de STEL o lo cargó alguien a mano?», que es justo lo que pide §11.

---

## 6 · Diseño propuesto de la UX (sin datos inventados)

`PROPOSED_DASHBOARD` — cuatro KPIs derivados, nada más: **Activos** (`count`), **Modelos**
(modelos normalizados distintos), **Clientes** (dueños distintos), **Servicios** (órdenes
abiertas). «Vencidos» y «Últimos 30 días» quedan fuera hasta que haya órdenes con fechas reales.

`PROPOSED_LIST` — la fila del legacy, mejorada: Referencia · identificador/equipo · Modelo ·
Cliente · Nº de serie · nº de servicios · Estado · Última actividad · **CTA «Servicio»**. Click en
cualquier parte de la fila abre la ficha rápida, con las mismas reglas de Clientes E7 (los
controles no disparan, Enter/Espacio funcionan).

`PROPOSED_QUICK_VIEW` — cajón superpuesto, **sin achicar la tabla**, reusando la arquitectura de
`PanelLateralCliente`: identidad, cliente, modelo, serie, estado, servicios, último servicio y las
acciones «Abrir ficha» y «Nuevo servicio».

`PROPOSED_ASSET_DETAIL` — Resumen · Servicios · Adjuntos · Trazabilidad. **Diagnóstico y
Repuestos no son pestañas del activo**: son de la orden, y crear pestañas vacías era lo que §19
pide no hacer.

`PROPOSED_SERVICE_FLOW` — «Nuevo servicio» desde el activo hereda cliente, activo, modelo y serie
sin volver a pedirlos, y entra directo a la etapa de diagnóstico.

`PROPOSED_ESTADOS` — derivados de lo que ya existe: **OK** (sin orden abierta) · **En servicio**
(orden abierta) · **Cotización pendiente** (`quote_status='pending'`) · y la etapa actual como
segundo chip. **«En espera» no se propone**: el legacy lo tenía con un `pausada` que React no
tiene, y agregarlo es una decisión de producto, no de UI.

---

## 7 · Output del STOP

```
CURRENT_MAINTENANCE_SCHEMA   = 8 tablas, RLS en todas (admin+employee), 25 columnas en
                               maintenance_assets, 48 en maintenance_orders, sin tabla de modelos
CURRENT_DATA_COUNTS          = activos 0 · órdenes 0 · partes 0 · cotizaciones 0 · checks 0 ·
                               mediciones 0 · auditoría 0 · puntos de revisión 16 · serials 0
LEGACY_FEATURE_MATRIX        = 18 funciones clasificadas (§2): 7 KEEP · 6 IMPROVE · 2 DROP · 3 UNKNOWN
STEL_ASSET_SOURCE            = GET /app/assets (entidad propia; NO «producto vendido»)
STEL_ASSETS_FOUND            = 358 (0 borrados) · referencias ACT00001–ACT00373
ASSET_NATURAL_KEY            = assets.id de STEL
IMPORT_IDEMPOTENCY_KEY       = (company_id, external_source='stel', external_id)
MATCHED_CUSTOMERS            = 356 (208 CUIT + 148 legacy_ref) · 16 clientes distintos
UNMATCHED_CUSTOMERS          = 2 (sin cuenta en STEL)
MATCHED_MODELS               = 0
UNMATCHED_MODELS             = 350 (+8 sin modelo) · 102 textos distintos · 13 marcas
MISSING_SERIAL               = 4
DUPLICATE_SERIALS            = 10 activos en 5 grupos normalizados (7 escrituras distintas)
AMBIGUOUS                    = 0
WOULD_INSERT                 = 358
WOULD_UPDATE                 = 0
WOULD_SKIP                   = 0
IMPORT_SCHEMA_CHANGES_REQUIRED = 4 columnas + 1 índice único en maintenance_assets (propuesta,
                               no aplicada). Alternativa sin esquema: usar reference (no recomendada)
DB_CHANGES_APPLIED           = 0
STEL_WRITES                  = 0
PROD_DATA_CHANGED            = 0
```

**Lo que falta decidir antes de importar:** las 4 columnas de procedencia, qué hacer con los 2
activos sin cliente, si se importan también los 82 documentos de servicio (presupuestos, órdenes
y remitos de trabajo) y si «En espera» pasa a ser un estado real.
