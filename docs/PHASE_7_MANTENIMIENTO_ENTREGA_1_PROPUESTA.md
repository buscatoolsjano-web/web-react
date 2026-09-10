# Fase 7 · Mantenimiento — Entrega 1: propuesta de schema

**Nada ejecutado.** No hay DDL aplicado, no hay migraciones, no hay UI. Esto es
la propuesta para que la apruebes o la corrijas.

Todo lo que sigue sale de la auditoría de la entrega 0 y de consultas de sólo
lectura hechas hoy sobre el Supabase nuevo.

---

## T · Lo que NO se crea (primero, para acotar)

| no se crea | por qué |
|---|---|
| `mant_repuestos` / catálogo propio de repuestos | los `FE.REP.*` ya viven en `products` (21.775 filas) |
| `mant_clientes` / maestro propio de clientes | `customers` (1010) con FK real |
| `mant_marcas` / maestro propio de marcas | `brands` (26) |
| `mant_usuarios` / usuarios propios con contraseña | `profiles` + `company_memberships` |
| `maintenance_order_steps` | ver **H** — no está justificada, y explico por qué |
| tabla de cotización con cabecera propia | ver **L** — la cotización es 1:1 con la orden |
| tabla de mano de obra con tareas y tarifas | ver **L.3** — el legacy no la tiene |
| sistema de adjuntos paralelo | ver **O** — se extiende `attachments` |
| `asset_serials` | un activo *es* una unidad; ya se descartó en Fase 2 y sigue valiendo |
| estados de "aprobación de diagnóstico", SLA, planes preventivos, rutas de técnico | un CMMS que el legacy no tiene y nadie pidió |

---

## A · Schema propuesto — 7 tablas nuevas

Todas con `company_id uuid not null` y RLS desde el minuto cero.

### A.1 `maintenance_assets` — el equipo

| columna | tipo | nota |
|---|---|---|
| `id` | uuid PK | **la identidad**, como pediste |
| `company_id` | uuid NOT NULL → companies | |
| `reference` | text NOT NULL | humana, `EQ00001`, por `next_document_number` |
| `customer_id` | uuid **NOT NULL** → customers | ver **D.2** |
| `product_id` | uuid NULL → products | opcional (punto 4) |
| `delivery_serial_id` | uuid NULL → delivery_serials | opcional (punto 3) |
| `serial_number` | text NULL | **nullable, indexado, no único** (punto 2) |
| `serial_normalized` | text NULL | generada: mayúsculas sin espacios ni guiones |
| `brand_id` | uuid NULL → brands | |
| `brand_text` | text NULL | snapshot si la marca no está en `brands` |
| `model_text` | text NULL | snapshot; el legacy guarda `"ASM18-3-PC"` a mano |
| `asset_type` | text NULL | los 13 tipos del legacy, sin CHECK cerrado |
| `identifier` | text NULL | el `identificador` del legacy: la etiqueta del cliente |
| `city`, `state` | text NULL | |
| `warranty_start`, `warranty_end` | date NULL | |
| `under_contract` | boolean NOT NULL default false | el `sujetoMant` del legacy |
| `notes` | text NULL | |
| `deleted_at`, `deleted_by` | | baja lógica, como el resto |
| `created_by/at`, `updated_by/at` | | sellados por trigger |

**No lleva `service_count` ni `last_service_at`.** En el legacy `serviciosCount`
dice 5 y el histórico tiene 3 (bug T‑4): un contador que se escribe a mano se
desincroniza. Se derivan con una función `STABLE`, como los totales de Ventas y
Compras.

### A.2 `maintenance_orders` — la ficha

| columna | tipo | nota |
|---|---|---|
| `id` | uuid PK | |
| `company_id` | uuid NOT NULL | |
| `number` | text NOT NULL | `OS00001`, único por empresa — ver **P** |
| `series_code` | text NOT NULL default `'OS'` | |
| `asset_id` | uuid NOT NULL → maintenance_assets | |
| `status` | text NOT NULL default `'open'` | `open` · `closed` · `cancelled` |
| `stage` | text NOT NULL default `'diagnosis'` | `diagnosis` · `quotation` · `repair` · `torque` · `closing` |
| `on_hold` | boolean NOT NULL default false | + `on_hold_since timestamptz` |
| `service_type` | text NOT NULL | `corrective` · `preventive` · `general_review` |
| `entry_reason` | text NULL | los 8 motivos del legacy |
| `visual_condition` | text NULL | |
| `technician_id` | uuid NULL → profiles | el técnico asignado |
| `received_by` | uuid NULL → profiles | quién recepcionó |
| `received_at` | date NOT NULL | `fechaIngreso` |
| `diagnosis_notes` | text NULL | |
| `diagnosed_at` / `diagnosed_by` | date / uuid | |
| `quote_status` | text NOT NULL default `'pending'` | `pending` · `approved` · `rejected` |
| `quote_currency` | text NULL → currencies | |
| `quote_contact` | text NULL | |
| `quote_notes` | text NULL | |
| `quote_approved_at` / `quote_approved_by_name` | date / text | quién aprobó **del lado del cliente**: es un nombre, no un usuario nuestro |
| `quote_subtotal` / `quote_total` | numeric | **calculados por el servidor** |
| `repair_notes`, `pending_parts` | text NULL | |
| `repaired_at` / `repaired_by` | date / uuid → profiles | |
| `labour_hours` | numeric NULL | reemplaza el `tiempoRealHs` de texto libre |
| `torque_lsl`, `torque_nominal`, `torque_usl` | numeric NULL | LCI / nominal / LCS |
| `torque_at` / `torque_by` | date / uuid | |
| `next_preventive_date` | date NULL | |
| `delivered_at` | date NULL | `fechaEntrega` |
| `closing_notes` | text NULL | |
| `closed_at` / `closed_by` | timestamptz / uuid | |
| `created_by/at`, `updated_by/at` | | |

### A.3 `maintenance_quote_lines` — el presupuesto

`id`, `company_id`, `maintenance_order_id`, `line_no`, `line_type`
(`labour` · `part` · `freight` · `diagnosis` · `other`), `product_id` NULL,
`sku_snapshot`, `description_snapshot`, `quantity`, `unit_price`, `line_total`
(server-side).

### A.4 `maintenance_order_parts` — los repuestos consumidos

`id`, `company_id`, `maintenance_order_id`, `product_id` **NOT NULL**,
`quantity`, `sku_snapshot`, `name_snapshot`, `unit_cost_snapshot` NULL,
`warehouse_id` → warehouses, `consumed_at` NULL, `stock_movement_id` NULL.

**Está separada de la cotización a propósito**: presupuestar un repuesto y
consumirlo son dos cosas distintas y el legacy las confunde. Ver **J**.

### A.5 `maintenance_measurements` — el torque

`id`, `company_id`, `maintenance_order_id`, `row_no`, `min_value`,
`max_value`, `target_value` (los tres `numeric NULL`).

**Filas variables, no 10 fijas.** El legacy siempre guarda 10 aunque se usen 2:
en los datos reales hay 30 filas y las 30 están vacías.

### A.6 `maintenance_order_checks` — las 8 partes

`id`, `company_id`, `maintenance_order_id`, `check_point_id`, `phase`
(`diagnosis` · `repair`), `result` (`ok` · `nok` · `na`).
Único por `(maintenance_order_id, check_point_id, phase)`.

### A.7 `maintenance_check_points` — qué partes se revisan

`id`, `company_id`, `key`, `label`, `sort_order`, `active`.

Sembrada con las 8 del legacy: `carcasa` CARCASA/ENCASTRE · `tornillos` ·
`conectores` · `reversa` · `software` SOFT/FIRMWARE · `embrague` ·
`cabezal` CABEZAL/BOLILLAS · `rotor`.

> **Es la tabla que cortaría si querés menos.** La alternativa es un CHECK con
> las 8 claves. La propongo como tabla porque el schema es multiempresa desde el
> día uno (punto 6) y esas 8 partes son de un atornillador FEIN: si Torquetools
> revisa otra cosa, con un CHECK hace falta una migración. **Esto es la
> pregunta W‑8 que quedó sin responder.**

### A.8 `maintenance_audit` — el rastro

Mismo esquema que `purchases_audit` y `sales_audit`, que ya existen: `id`
bigserial, `company_id`, `entity_type`, `entity_id`, `action`, `from_status`,
`to_status`, `diff jsonb`, `actor_id`, `created_at`.

---

## B · ERD

```
customers ──┐
products ───┼──< maintenance_assets >──── brands
delivery_serials ─┘        │
                           │ (asset_id)
                           ▼
                   maintenance_orders ──────────────┐
                     │   │   │   │                  │
     ┌───────────────┘   │   │   └──────────┐       │
     ▼                   ▼   ▼              ▼       ▼
maintenance_        maintenance_    maintenance_  maintenance_
quote_lines         order_parts     measurements  order_checks
     │                   │                              │
     │                   │ (stock_movement_id)          │
  products           stock_movements          maintenance_check_points
                           │
                      warehouses

profiles ──── technician_id / received_by / repaired_by / closed_by
attachments ── entity_type ∈ { …, 'maintenance_asset', 'maintenance_order' }
maintenance_audit ── entity_type ∈ { 'maintenance_asset', 'maintenance_order' }
```

---

## C · Estados — dos ejes, no uno

Separados como pediste (punto 12):

**Eje 1 · `status` de la orden** — el ciclo de vida del documento:

```
open ──► closed
  └────► cancelled
```

`closed` y `cancelled` congelan la orden. De `closed` no se vuelve; para
deshacer hace falta una orden nueva. `cancelled` es la salida antes de cerrar.

**Eje 2 · `stage`** — dónde está el trabajo:

```
diagnosis ──► quotation ──► repair ──► torque ──► closing
     ◄───────────┴────────────┴──────────┴──────────┘
                (se puede volver atrás; queda auditado)
```

Avanzar es de a un paso. Volver atrás se permite —el legacy lo permite y es
razonable: aparece algo en la reparación y hay que recotizar— pero **cada
transición deja una fila en `maintenance_audit`**, que es lo que el legacy no
tiene.

**Eje 3 · `quote_status`** (`pending` · `approved` · `rejected`) es del
presupuesto, no de la orden. Tenerlo aparte es justamente lo que permite la
regla de cierre de **E**.

`on_hold` es un flag ortogonal, no un estado: una orden pausada sigue en su
`stage`. Es como está en el legacy (`pausada` + `pausadaAt`) y funciona.

---

## D · El equipo

### D.1 Identidad y serial

Como pediste: **UUID propio**, `reference` humana, y el serial es un atributo.

`serial_number` **nullable, indexado, NO único**. La normalización va en una
columna generada:

```sql
serial_normalized text generated always as (
  upper(regexp_replace(coalesce(serial_number,''), '[^A-Za-z0-9]', '', 'g'))
) stored
```

con un índice sobre `(company_id, serial_normalized)` **no único**, para
buscar y para **detectar** duplicados.

**La advertencia, sin bloquear:** una función `STABLE`
`maintenance_serial_duplicates(company, serial)` que devuelve los otros equipos
con el mismo serial normalizado. La UI la muestra al cargar; la base no rechaza
nada. Es la misma idea que `needs_review` en proveedores: se registra la
ambigüedad, no se resuelve sola.

### D.2 Cliente — propongo NOT NULL

El legacy deja el cliente vacío (el select tiene `value=""`), pero **eso no es
evidencia del negocio: es un formulario que no valida nada**, igual que deja
cerrar una ficha con todo vacío (T‑6) y guarda el placeholder como dato (T‑13).
El único registro real tiene cliente cargado.

Un taller recibe la herramienta *de alguien*, y ese alguien es quien la retira y
quien aprueba el presupuesto. Sin cliente no se puede facturar ni entregar.

**Propongo `customer_id NOT NULL`.** Si el caso «llega una herramienta sin saber
de quién» existe de verdad, decímelo y lo hago nullable — pero quiero que sea tu
decisión con el caso concreto, no una comodidad mía.

### D.3 Producto

`product_id` opcional (punto 4). Cuando no resuelve, quedan `brand_text` y
`model_text` como snapshots. Nunca se obliga a elegir un SKU.

Recordá de la auditoría: el único modelo real, `ASM18-3-PC`, es **ambiguo**
entre `FE.ASM18-3` y `FE.MAQ.71127760000`. El modelo tiene que aguantar eso sin
inventar un match.

---

## E · Seriales y el cierre consistente

Las validaciones que propongo para **cerrar** una orden (punto 11), sacadas de
lo que el legacy hace mal, no de burocracia inventada:

| invariante | por qué | evidencia |
|---|---|---|
| 1. `stage = 'closing'` | no se cierra saltándose el circuito | — |
| 2. `quote_status <> 'pending'` | **2 de las 3 fichas reales se cerraron con la cotización PENDIENTE** | datos |
| 3. si `quote_status = 'approved'`, al menos una línea de cotización | un presupuesto aprobado y vacío no es un presupuesto | — |
| 4. `delivered_at` no nulo | cerrar es entregar | 3/3 lo tienen |
| 5. todo `maintenance_order_parts` con `consumed_at` o borrado | no queda un repuesto "a consumir" en una orden cerrada | ver **J** |
| 6. `received_at <= delivered_at` | fechas coherentes | — |

**Lo que NO exijo**, a propósito: que el diagnóstico tenga las 8 partes
marcadas, que haya mediciones de torque, ni que `repair_notes` esté escrito. En
los datos reales esas cosas están vacías y **una revisión preventiva que salió
bien puede no tener nada que anotar**. Exigirlo sería burocracia.

---

## F · Relación con `delivery_serials`

Opcional y en una sola dirección, como pediste (punto 3):

```
maintenance_assets.delivery_serial_id  →  delivery_serials.id   (NULL permitido)
```

**Columna y no tabla de vínculo**, porque un equipo físico salió de **una**
entrega o de ninguna. Una tabla de vínculo modelaría N:N, que no existe.

Cuando está, es **evidencia de procedencia**: se vendió, se entregó, y ese
serial es el nuestro. Cuando no está, el equipo existe igual — puede haber
venido de otro proveedor o de antes del sistema.

`delivery_serials` **no es la tabla maestra** y hoy tiene **0 filas**, así que
en la práctica la columna arranca siempre nula. No se fuerza nada.

---

## G · La orden

Ya está en **A.2**. Dos decisiones que quiero marcar:

**Los totales del presupuesto los calcula el servidor**, con el mismo patrón de
Ventas y Compras (`totales_X()` STABLE + `recalcular` BEFORE UPDATE + `empujar`
AFTER en las líneas). Un total mandado por el cliente se ignora.

**`quote_approved_by_name` es texto**, no un FK a `profiles`. En el legacy
`aprobadoPor` es quien aprueba **del lado del cliente** — no es un usuario
nuestro. Ponerle un FK a `profiles` sería modelar mal.

---

## H · Las cinco etapas — `maintenance_order_steps` NO está justificada

Es la pregunta que pediste revisar. Mi respuesta es **no**, y el razonamiento:

**Lo que una tabla de etapas resolvería bien:** etapas configurables, repetibles,
con ciclo de vida propio (asignar, aprobar, rechazar cada una), o un número
variable según el tipo de servicio.

**Lo que muestra la evidencia:** cinco etapas **fijas**, **lineales**, que no se
repiten, sin aprobación propia, y con **cargas estructuralmente distintas**:

| etapa | qué guarda |
|---|---|
| diagnóstico | 8 checks + fecha + técnico + motivo + condición + notas |
| cotización | N líneas + moneda + estado + aprobación |
| reparación | notas + horas + piezas pendientes + fecha + técnico |
| torque | 3 límites + N mediciones |
| cierre | fecha de entrega + próximo preventivo + notas |

Una tabla genérica sólo podría guardar eso en un `jsonb payload` — que es
**exactamente el objeto sin forma del legacy** (`diagnosticoPartes{}`,
`reparacionPartes{}`) que la Fase 2 criticó por escrito. Cambiaríamos un
problema conocido por el mismo problema con otro nombre.

**Lo que propongo en su lugar**, que preserva lo que pediste (estado, quién,
cuándo, datos, resultado):

- **estado** → `maintenance_orders.stage` (+ `status`, + `quote_status`)
- **quién y cuándo** → columnas tipadas por etapa: `diagnosed_at/by`,
  `repaired_at/by`, `torque_at/by`, `closed_at/by`, `quote_approved_at`
- **datos de la etapa** → donde corresponden, con tipo: `maintenance_order_checks`,
  `maintenance_quote_lines`, `maintenance_measurements`, columnas de notas
- **resultado y rastro** → `maintenance_audit`, append-only, una fila por
  transición de etapa con quién, cuándo y el `diff`

Son **10 columnas explícitas** contra una tabla con payload amorfo. Se puede
consultar («¿cuántas órdenes tardaron más de 5 días entre diagnóstico y
entrega?») sin desarmar JSON.

> **Si en algún momento las etapas se vuelven configurables por tipo de servicio,
> ahí la tabla se gana su lugar y se agrega.** Hoy no hay ni un indicio.

---

## I · Repuestos

Sin catálogo propio (punto 7). `maintenance_order_parts.product_id` **NOT NULL**
apunta a `products`, con snapshots de SKU y nombre para que la orden se lea
igual dentro de dos años.

**Está separada de `maintenance_quote_lines` a propósito.** El legacy las
confunde: una línea de cotización con `tipo: 'REPUESTO'` es texto libre que no
identifica nada ni descuenta nada. Separadas:

- **cotizar** un repuesto: una línea de presupuesto (puede o no tener
  `product_id`; el proveedor puede cotizar algo que no está en catálogo)
- **consumir** un repuesto: una fila en `maintenance_order_parts` con
  `product_id` obligatorio, porque para mover stock hay que saber qué producto es

Se puede cotizar sin consumir (la cotización se rechaza) y consumir sin cotizar
(apareció en la reparación). El legacy no distingue y por eso no puede tocar
stock.

> **Aviso de nombres:** en la Fase 2 el nombre `maintenance_parts` significaba
> **las 8 partes de la herramienta** (carcasa, rotor…), no los repuestos. Son
> dos cosas distintas y acá se llaman `maintenance_order_checks` y
> `maintenance_order_parts`. Vale la pena que no se mezclen nunca más.

---

## J · Stock

Como pediste (punto 8): **se descuenta sólo cuando se consume de verdad**.

```
cotizar / seleccionar / borrador   →  NO toca stock
confirmar el consumo               →  1 stock_movement por línea, negativo
```

El disparador que propongo es **confirmar el consumo de la orden**, una acción
explícita —una RPC, como `confirmar_recepcion`— y no el cierre de la ficha:
consumir y cerrar son momentos distintos, y atarlos obligaría a cerrar para
descontar.

`maintenance_order_parts.stock_movement_id` guarda el movimiento generado. Una
línea con `stock_movement_id` no se edita ni se borra: ahí está el rastro.

Idempotencia y bloqueo con el mismo patrón que la entrega 4 de Compras:
`for update` sobre las filas, permiso antes del atajo, y la transición al estado
que dispara efectos **sólo desde su función** — la puerta que cerramos en la
entrega 5.

**Devolución (punto 9):** no se borra ningún movimiento. Si un repuesto vuelve,
es un **contramovimiento explícito** con su propia fila. Para v1 propongo **no
implementarlo**: no hay evidencia de que pase, y `return_in` ya existe si hace
falta después.

### El `movement_type` — acá me detengo

Los valores que existen hoy son:

```
opening_balance · purchase_receipt · sale_delivery · adjustment
transfer_in · transfer_out · return_in · return_out
```

**Ninguno sirve.** `sale_delivery` es una venta con entrega; `adjustment` es una
corrección y taparía el motivo; `transfer_out` implica otro depósito.

Hace falta **un valor nuevo en el CHECK — un solo valor, el cambio mínimo**. Como
pediste, **no lo bautizo yo**. Candidatos:

| candidato | a favor | en contra |
|---|---|---|
| `service_consumption` | describe qué pasó, no de qué módulo viene | largo |
| `maintenance_use` | ata el nombre al módulo | si mañana Ventas consume repuestos, queda raro |
| `repair_consumption` | corto y claro | «reparación» excluye el preventivo |

**Mi recomendación: `service_consumption`.** Decidilo vos y lo aplico.

---

## K · Torque — exactamente lo que hay, nada más

Auditado línea por línea. El legacy guarda **sólo esto**:

| campo | tipo real |
|---|---|
| `torqueLci`, `torqueNominal`, `torqueLcs` | string (se parsean con `parseFloat`) |
| `torqueMediciones[10]` | array de `{min, max, target}`, strings |

**No guarda**: unidad, instrumento de medición, fecha por medición, técnico por
medición, ni observación por fila. **No los invento.**

Lo que el legacy **calcula al vuelo y nunca guarda**: promedios, desvío estándar,
**Cp**, **Cpk**, **CV**, eficiencia (`Cpk/1.33 × 100`), repetibilidad por fila
(`(1 − (max−min)/nominal) × 100`) y el veredicto:

```
Cpk ≥ 1.33  →  PROCESO CAPAZ
1.00 ≤ Cpk < 1.33  →  PROCESO ACEPTABLE
Cpk < 1.00  →  PROCESO NO CAPAZ
```

**Propuesta:** guardar los datos crudos (`numeric`, no string; vacío = NULL) y
**derivar** Cp/Cpk/CV/veredicto con una función `STABLE` del servidor, como los
totales. Es el mismo principio: un número calculado no se guarda, se calcula —
y así una medición corregida no deja un Cpk viejo pegado.

Dos ajustes al legacy, chicos y justificados: **filas variables** en vez de 10
fijas, y `numeric` en vez de texto.

> **Lo que sí falta y es una decisión tuya:** no hay **unidad** (se asume Nm) ni
> **instrumento**. Para un informe de calibración que el cliente firma,
> normalmente hacen falta los dos. Es funcionalidad **nueva**: decime si entra.

---

## L · La cotización — no reutilizar `sales_quotes`

Comparado con evidencia, como pediste (punto 14):

| | cotización de mantenimiento | `sales_quotes` |
|---|---|---|
| cliente | del equipo, indirecto | `customer_id` directo |
| líneas | `{desc, tipo, cant, pu}` | producto, snapshots, descuentos, impuestos por línea |
| impuestos | **ninguno** | por línea, con tratamiento |
| descuentos | **ninguno** | línea y global |
| numeración | `COT-<año>-<conteo>` editable | `document_sequences` |
| estados | `PENDIENTE/APROBADA/RECHAZADA` | los suyos + conversión a pedido |
| convierte a pedido | **nunca** | sí |
| impresión | **no existe** | 6 formatos |
| cardinalidad | **1 por ficha** | N por cliente |
| relación con Ventas | **ninguna** | es Ventas |

Son documentos distintos. Meter la cotización de reparación en `sales_quotes`
obligaría a inventarle un cliente directo, dejar 20 columnas nulas y aceptar que
aparezca en el listado de cotizaciones de Ventas.

**Propuesta:** `maintenance_quote_lines` colgando de la orden, más los campos de
cabecera en `maintenance_orders` (`quote_status`, `quote_currency`,
`quote_total`, `quote_approved_at`). **Sin tabla de cabecera propia**, porque la
relación es 1:1 con la orden y una tabla de una fila por orden es una junta de
más.

### L.2 Impuestos

El legacy no tiene. **No los agrego.** Si el presupuesto se le manda al cliente
para que lo apruebe, en algún momento van a hacer falta — pero eso es
funcionalidad nueva y prefiero que lo decidas explícitamente. Hoy:
`line_total = quantity × unit_price`, y listo.

### L.3 Mano de obra

Lo que existe de verdad: un `line_type = 'labour'` en la cotización con cantidad
y precio, y `tiempoRealHs` (texto libre, valores reales `"2"`, `""`, `""`).

**Propuesta:** conservar el tipo de línea —que es el mecanismo real— y cambiar
`tiempoRealHs` por `labour_hours numeric` en la orden. **No creo una tabla de
tareas, tarifas ni partes de hora**: el legacy no las tiene y sería estructura
vacía (punto 15).

---

## M · Técnicos

Sin lista blanca (punto 16). `technician_id`, `received_by`, `repaired_by`,
`closed_by` son FK a `profiles`, y sólo se ofrecen los miembros activos de la
empresa.

**Hallazgo útil:** `company_memberships` **ya admite el rol `technician`** —está
en el CHECK y `app.current_internal_company_ids()` ya lo incluye— pero **hoy
tiene 0 miembros**. Existe la casilla y está vacía.

Quién puede qué — **mi propuesta para v1**:

| acción | admin | employee | technician | salesperson | customer/distributor | anon |
|---|---|---|---|---|---|---|
| ver Mantenimiento | ✔ | ✔ | ✔ | ✘ | ✘ | ✘ |
| crear equipo / ficha | ✔ | ✔ | ✘ | ✘ | ✘ | ✘ |
| diagnosticar / reparar / torque | ✔ | ✔ | ✔ | ✘ | ✘ | ✘ |
| cotizar y aprobar cotización | ✔ | ✔ | ✘ | ✘ | ✘ | ✘ |
| confirmar consumo (mueve stock) | ✔ | ✔ | ✘ | ✘ | ✘ | ✘ |
| cerrar / cancelar | ✔ | ✔ | ✘ | ✘ | ✘ | ✘ |

**Pero ojo con mi propia regla:** el legacy trata a los 6 de `TEAM_USERS` igual,
así que **no hay evidencia legacy de un rol técnico acotado**. Siendo simétrico
con lo que pediste sobre `salesperson`, la opción conservadora es **v1 sólo
admin + employee**, igual que Compras, y sumar `technician` cuando exista alguien
con ese rol. El helper se escribe de forma que agregarlo después sea una línea.

**Es una decisión tuya** (ver **W‑2**).

---

## N · RLS

Mismo patrón que Compras, con helpers nuevos en el schema `app`:

```sql
app.current_maintenance_company_ids()  -- lectura
app.current_maintenance_writer_ids()   -- escritura
```

Arrancan devolviendo lo mismo que `current_writer_company_ids()` (admin +
employee). Si aprobás el rol técnico, el de lectura suma `technician` y es un
solo `create or replace`.

- Las 7 tablas con RLS **habilitada y forzada**.
- `SELECT` por `company_id IN (...lectura)`; `INSERT/UPDATE/DELETE` por escritura.
- `maintenance_audit`: **sólo SELECT**, como `purchases_audit`. Se escribe desde
  triggers `SECURITY DEFINER`.
- Las RPC con permiso adentro y **`revoke execute … from anon`** desde el
  principio — el hallazgo de la entrega 1 de Compras no se repite.
- La transición que dispara efectos (confirmar consumo) sólo desde su función,
  con la marca de transacción de la entrega 5.
- `customer` y `distributor`: **0 en v1**. Un portal donde el cliente sigue su
  reparación es una idea razonable y es **funcionalidad nueva**; no la abro sin
  que la pidas.

---

## O · Adjuntos

Sin sistema paralelo (punto 18). El cambio mínimo sobre lo que existe:

1. Dos valores en el CHECK: `'maintenance_asset'` y `'maintenance_order'`.
2. Dos ramas en el `CASE` de la política `attachments_select`, que **ya está
   partida por `entity_type`** desde la entrega 2 de Compras.

Nada más: bucket privado, URL firmada de 5 minutos y límite de 20 MB ya están.

**Es útil y es chico**, y para un taller es lo más pedible que falta: la foto del
equipo como llegó, la de la placa, la del serial. Pero **es funcionalidad
nueva**: lo propongo, no lo ejecuto, y puede quedar para una entrega posterior
sin bloquear nada.

---

## P · Numeración

No hay serie humana usable en el legacy: la ficha es `SVC-1783021387008`
(timestamp) y el `ref` que muestra es **el id del equipo**, no de la ficha. El
número de cotización se recalcula por conteo y es editable.

**Propongo `document_sequences`** —que ya existe y no tiene CHECK de `doc_type`,
así que agregar es insertar dos filas— con:

| entidad | serie | ejemplo |
|---|---|---|
| equipo | `EQ` | `EQ00001` |
| orden de servicio | `OS` | `OS00001` |

**La justificación, no la estética:** al equipo se le cuelga una etiqueta física
cuando entra al taller, y al cliente se le dice «tu reparación es la OS00042».
Un uuid no se dicta por teléfono ni se escribe en una etiqueta.

**La cotización NO lleva número propio.** Es 1:1 con la orden: alcanza con
`OS00042` y no hay riesgo de duplicar como pasa hoy (en los datos reales existen
`COT-2026-002/003/004` y **falta el 001**).

Si preferís que el uuid alcance y no haya referencia humana, se saca — pero
entonces hay que resolver cómo se identifica la herramienta en el mostrador.

---

## Q · Tests de la entrega 1

La suite `scripts/fase7-mantenimiento-schema-tests.mjs`, con el mismo criterio
de siempre: **intento real y efecto medido**, no sólo el código de error.

**Estructura y numeración**
1. `EQ` y `OS` arrancan en 1 y son consecutivas.
2. 20 números pedidos en paralelo → 20 distintos, sin huecos ni repetidos.
3. `number` no se puede cambiar después.

**Equipo**
4. Un equipo sin serial entra (nullable).
5. Dos equipos con el **mismo** serial entran, y la función de duplicados
   devuelve los dos.
6. `serial_normalized` iguala `AB-123`, `ab 123` y `AB123`.
7. Un cliente de otra empresa: rechazado.
8. `delivery_serial_id` nulo es válido; apuntando a otra empresa, rechazado.

**Orden y estados**
9. `stage` avanza de a un paso; saltear de `diagnosis` a `closing`: rechazado.
10. Volver atrás se permite y **deja fila en `maintenance_audit`**.
11. Cerrar con `quote_status='pending'`: **rechazado** (el bug del legacy).
12. Cerrar sin `delivered_at`: rechazado.
13. Cerrar con una parte sin consumir: rechazado.
14. `received_at > delivered_at`: rechazado.
15. Una orden cerrada no se edita, no se borra y no vuelve a `open`.

**Cotización**
16. `quote_total` lo calcula el servidor; un total mandado por el cliente se ignora.
17. Borrar una línea recalcula el total.

**Repuestos y stock**
18. Agregar una parte a una orden **no mueve stock** (contado antes y después).
19. Confirmar el consumo genera **un movimiento por línea**, negativo, con
    `stock_movement_id` guardado.
20. Confirmar dos veces es **idempotente**: no descuenta dos veces.
21. Dos órdenes consumiendo el mismo producto en paralelo: los dos movimientos
    entran y el saldo cierra.
22. Una línea con `stock_movement_id` no se edita ni se borra.
23. `UPDATE` directo del estado que dispara el consumo: **rechazado** (la puerta
    de la entrega 5).

**Torque y checks**
24. Cp/Cpk/CV los calcula el servidor y coinciden con la cuenta del legacy.
25. Con menos de 2 mediciones no hay desvío: devuelve nulo, no un error.
26. Un `result` fuera de `ok/nok/na`: rechazado.
27. La misma parte dos veces en la misma fase: rechazada por el único.

**RLS**
28. Matriz completa con JWT real sobre las 7 tablas: por id, por número, por
    serial, por cliente, por producto y por empresa ajena.
29. `anon` no puede ejecutar ninguna RPC.
30. `maintenance_audit` no se escribe desde PostgREST.

**Adjuntos**
31. Un adjunto de `maintenance_order` lo ve admin y **no** lo ve ningún externo.

**Limpieza**
32. La suite se limpia sola y deja los invariantes de todas las fases intactos:
    142 · 381 · 379 · 288/166/182/636 · huella `8091b916…` · 1010 · 87 · 14.

---

## R · Riesgos

| # | riesgo | mitigación |
|---|---|---|
| R‑1 | **Serial no único**: dos equipos del mismo cliente con el mismo serial, historiales partidos | la función de duplicados avisa al cargar; si el negocio confirma que el serial es único, se agrega el índice único después — al revés no se puede |
| R‑2 | **`customer_id NOT NULL`** puede frenar un caso real que no vi | la decisión es tuya (**D.2**); cambiarlo a nullable después es una migración trivial, al revés hay que limpiar datos |
| R‑3 | **7 tablas para 4 registros de prueba**: sobre-ingeniería | 6 son inevitables; `maintenance_check_points` es la única discutible y está marcada |
| R‑4 | **`movement_type` nuevo** toca una tabla con 381 filas en producción | es agregar un valor al CHECK; no reescribe ni una fila |
| R‑5 | **Sin unidad ni instrumento en torque**: si el informe se le entrega al cliente, van a faltar | decisión abierta en **K** |
| R‑6 | **Sin impuestos en la cotización**: si se factura la reparación, falta | decisión abierta en **L.2** |
| R‑7 | **El rol `technician` existe y está vacío**: si se le da acceso y nunca se crea nadie, es código muerto | **W‑2** |
| R‑8 | La UI de esto es grande (13 pantallas legacy, ficha de 5 pasos) | el schema no la condiciona; las entregas 3 y 4 la reparten |

---

## S · Qué reutiliza del backend actual

| se reutiliza | cómo |
|---|---|
| `customers` (1010) | FK del equipo |
| `products` (21.775) | producto del equipo y **repuestos**, sin catálogo paralelo |
| `brands` (26) | marca del equipo |
| `profiles` (7) + `company_memberships` | técnicos y permisos, con el rol `technician` que ya existe |
| `companies` | multiempresa desde el día uno |
| `document_sequences` + `next_document_number()` | numeración transaccional |
| `stock_movements` / `stock_balances` / `warehouses` | consumo de repuestos |
| `delivery_serials` | procedencia opcional |
| `attachments` + bucket privado + URL firmadas | dos valores nuevos en un CHECK |
| `currencies` | moneda del presupuesto |
| helpers `app.current_*` | base de los dos helpers nuevos |
| patrón `purchases_audit` / `sales_audit` | `maintenance_audit` |
| patrón `totales_X` + `recalcular` + `empujar` | totales del presupuesto |
| patrón «la transición sólo desde su función» (entrega 5) | confirmar consumo |

**Cambios sobre lo existente: tres, todos mínimos.**

1. `attachments_entity_type_check`: +2 valores, y 2 ramas en `attachments_select`.
2. `stock_movements_movement_type_check`: **+1 valor** (nombre a definir, **J**).
3. `document_sequences`: +2 filas por empresa (`EQ`, `OS`). Sin DDL.

Ninguno reescribe datos existentes.

---

## Datos de prueba del legacy

`ACT00001` («Prueba», serie `123456`) y sus 3 fichas quedan clasificados
**TEST / NON_PRODUCTION** y **no se migran**. No van a existir en ninguna tabla
productiva. Punto 20 cerrado.

**W‑1 (backup JSON):** no bloquea. Si aparece, sirve para confirmar
`mant_usuarios` y `mant_modelos_custom`, que no sincronizan. La salvedad queda
escrita en la auditoría.

---

## Lo que necesito que decidas antes de escribir el SQL

| # | decisión | mi recomendación |
|---|---|---|
| **W‑1** | Nombre del `movement_type` nuevo | `service_consumption` |
| **W‑2** | ¿`technician` accede en v1, o sólo admin+employee? | sólo admin+employee, y sumarlo cuando exista alguien con ese rol |
| **W‑3** | `customer_id` NOT NULL, ¿o hay un caso real sin cliente? | NOT NULL |
| **W‑4** | Partes revisadas: ¿tabla configurable o CHECK con las 8 fijas? (era W‑8) | tabla, porque el schema es multiempresa |
| **W‑5** | Torque: ¿se agregan **unidad** e **instrumento**? Es nuevo | sí la unidad (barata y evita ambigüedad); el instrumento, sólo si el informe se firma |
| **W‑6** | Cotización: ¿lleva impuestos? Es nuevo | no en v1 |
| **W‑7** | Referencia humana `EQ`/`OS`, ¿o alcanza el uuid? | `EQ` y `OS` |
| **W‑8** | Adjuntos: ¿entran en la entrega 1 o después? | que entren: son 2 valores en un CHECK |

Con esas ocho respuestas escribo el SQL de la entrega 1.
