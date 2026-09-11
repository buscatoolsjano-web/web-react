# Fase 7 · Mantenimiento — Entrega 3: auditoría previa

Cotización, repuestos y consumo. **Sólo medición.** No se ejecutó ninguna
migración, no se cambió ninguna policy ni función, y la base quedó exactamente
como estaba.

| | |
|---|---|
| Baseline | entregas 1 y 2 cerradas · `5eb22d1` `e1e7c4e` `cb9d888` |
| Probe | [`scripts/fase7-mantenimiento-entrega3-auditoria.mjs`](../scripts/fase7-mantenimiento-entrega3-auditoria.mjs) |
| Invariantes al terminar | **todos en su valor**, incluidos los 21.772 productos y los 381 movimientos de stock |

> **La conclusión corta.** La entrega 1 dejó construido **mucho más de lo que
> parecía**: las dos tablas, los totales server-side, la puerta de transacción
> del consumo, la idempotencia, la concurrencia y las doce validaciones del
> cierre ya existen y **funcionan medidos**. Lo que falta es casi todo
> frontend. Pero aparecieron **cuatro huecos reales en la base**, y uno de
> ellos es **escritura entre empresas**.

---

## A · `maintenance_quote_lines`

| columna | tipo | nulo | default | qué representa |
|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | identidad de la línea — **no** su posición |
| `company_id` | uuid | NO | — | empresa, para la RLS |
| `maintenance_order_id` | uuid | NO | — | la orden dueña. `ON DELETE CASCADE` |
| `line_no` | int | NO | — | orden de presentación. `> 0`, único por orden |
| `line_type` | text | NO | `'labour'` | `labour · part · freight · diagnosis · other` |
| `product_id` | uuid | **SÍ** | — | opcional: por eso existe la línea libre |
| `sku_snapshot` | text | SÍ | — | SKU congelado |
| `description_snapshot` | text | SÍ | — | el texto que se le cobra al cliente |
| `quantity` | numeric(14,4) | NO | — | `> 0` |
| `unit_price` | numeric(18,4) | NO | `0` | `>= 0` |
| `line_total` | numeric(18,4) | NO | `0` | **lo calcula el servidor** |

**Constraints**: PK `id` · UNIQUE `(maintenance_order_id, line_no)` · FK a
`companies`, `maintenance_orders` (cascade) y `products` · CHECK sobre
`line_no`, `line_type`, `quantity` y `unit_price`.

**Índices**: `idx_mql_order (maintenance_order_id)` + el único de `line_no`.

**Triggers**: `trg_mql_calcular` (BEFORE, recalcula `line_total`) ·
`trg_mql_congelar` (BEFORE, bloquea tocar líneas de una orden que no esté
`open`) · `trg_mql_empujar` (AFTER, recalcula el total de la orden).

### ¿Soporta lo que pide la entrega 3?

| | |
|---|---|
| línea libre | **SÍ** — `product_id` nullable, probado |
| línea vinculada a producto | **SÍ** — probado |
| descripción | **SÍ** — `description_snapshot` |
| cantidad · precio unitario · total | **SÍ** |
| pertenencia a la orden | **SÍ** |
| posición / orden de línea | **SÍ** — `line_no`, único por orden |

**No falta ninguna columna.** Sí falta decidir quién asigna `line_no`: hoy
es responsabilidad del cliente y el UNIQUE lo protege de duplicados, pero dos
pestañas pueden chocar con un `23505`.

## B · La cabecera de la cotización, y su estado

**Confirmado: `maintenance_quotes` NO existe.** La cabecera vive en
`maintenance_orders`. Los campos **reales**, sin inventar ninguno:

| columna | tipo | nulo |
|---|---|---|
| `quote_status` | text | NO, default `'pending'`, CHECK `pending·approved·rejected` |
| `quote_currency` | text | SÍ, **sin default** |
| `quote_contact` | text | SÍ |
| `quote_notes` | text | SÍ |
| `quote_approved_at` | **date** | SÍ |
| `quote_approved_by_name` | text | SÍ |
| `quote_subtotal` | numeric | NO, default 0 |
| `quote_total` | numeric | NO, default 0 |

**No existen**: `quote_required`, `quote_rejected_at`, `quote_rejected_by`,
`quote_approved_by` (uuid). El «quién aprobó» es **un nombre escrito a mano**
—la persona del cliente que dio el OK—, no un usuario del sistema. Es
coherente: quien aprueba una cotización de servicio es el cliente por teléfono
o por mail, no alguien logueado.

### Qué permite hoy `quote_status` — **medido**

Seis transiciones intentadas por UPDATE directo de PostgREST:

| | resultado |
|---|---|
| `pending → approved` | **PERMITIDO** |
| `pending → rejected` | **PERMITIDO** |
| `approved → pending` | **PERMITIDO** |
| `approved → rejected` | **PERMITIDO** |
| `rejected → approved` | **PERMITIDO** |
| `rejected → pending` | **PERMITIDO** |
| un valor inventado | **RECHAZADO** `23514` |

> **No hay ninguna máquina de estados.** Lo único que protege `quote_status`
> es el CHECK de los tres valores. Cualquier transición entre ellos pasa por un
> `UPDATE` suelto, incluido **volver atrás desde aprobada**.

Y la auditoría es asimétrica: de esas seis transiciones **sólo se auditaron
cuatro**. El trigger escribe `quote_approved` / `quote_rejected` al **entrar**
a esos estados; volver a `pending` no deja rastro. O sea: hoy se puede
desaprobar una cotización y **el historial no lo muestra**.

## C · Totales

Está resuelto, y con el mismo patrón que Ventas y Compras:

```
app.totales_cotizacion_mant(orden)  →  sum(quantity × unit_price), redondeado a 2
```

| | |
|---|---|
| `line_total` de la línea | lo pisa `trg_mql_calcular` en BEFORE |
| `quote_subtotal` / `quote_total` de la orden | los empuja `trg_mql_empujar` en AFTER |
| un `line_total` manipulado (mandé 999999) | **recalculado a 100** |
| un `quote_total` manipulado (mandé 1) | **devuelto a 200** por `trg_mo_totales` |
| impuestos | **ninguno**: `total = subtotal = suma de líneas` |

El frontend sólo debe calcular **preview**. El número que vale es el del
servidor, y está protegido de los dos lados.

**Un detalle abierto: `quote_currency` es nullable y no tiene default.** Una
cotización puede quedar con total 200 y moneda `NULL`. La pantalla de la
entrega 2 ya lo muestra sin moneda. Hay que decidir si la entrega 3 la exige
al agregar la primera línea.

## D · `maintenance_order_parts`

| columna | tipo | nulo | qué representa |
|---|---|---|---|
| `id` | uuid | NO | identidad |
| `company_id` | uuid | NO | empresa |
| `maintenance_order_id` | uuid | NO | la orden. `ON DELETE CASCADE` |
| `product_id` | uuid | **NO** | **obligatorio**: un repuesto es del catálogo |
| `warehouse_id` | uuid | **NO** | **obligatorio ya al agregar** |
| `quantity` | numeric(14,4) | NO | `> 0` |
| `sku_snapshot` · `name_snapshot` | text | SÍ | congelados |
| `unit_cost_snapshot` | numeric(18,4) | **SÍ** | costo. **Nullable** |
| `consumed_at` | timestamptz | SÍ | cuándo se consumió |
| `stock_movement_id` | **bigint** | SÍ | el movimiento que lo descontó |
| `created_by` · `created_at` · `updated_at` | | | |

**El CHECK que importa**:

```sql
chk_mop_consumo CHECK (
  (consumed_at IS NULL AND stock_movement_id IS NULL) OR
  (consumed_at IS NOT NULL AND stock_movement_id IS NOT NULL))
```

«Consumido sin movimiento» **no es un estado que exista**.

**Índices**: `idx_mop_order` y `idx_mop_pend` (parcial, `WHERE consumed_at IS
NULL`) — pensado exactamente para la consulta de «qué falta consumir».

**Triggers**: `trg_mop_congelar` (orden no `open` → no se toca) ·
`trg_mop_consumo` (la puerta de transacción) · `trg_mop_borrado` (un repuesto
consumido no se borra).

## E · Productos y costos

**Confirmado: no existe ningún catálogo paralelo de repuestos.** `product_id`
apunta a `products`, y es obligatorio.

La búsqueda server-side ya existe y ya se reutiliza: `search_products(p_company,
p_query, p_limit, p_offset, p_orden)`, la misma del Catálogo, de Compras y del
`SelectorProducto` que la entrega 2 ya tiene en Mantenimiento. **Trae 20 filas,
no 21.772.** Medido en la entrega 2: **487 ms** en régimen.

### El costo: no hay ninguna fuente confiable

Esto es lo más importante de la sección, y la respuesta es **no**:

| fuente candidata | qué hay de verdad |
|---|---|
| una columna de costo en `products` | **no existe** |
| `price_lists` / `product_prices` | **4 listas, 12.505 precios — todas de VENTA, todas en USD** |
| último precio pagado a proveedor | **0 pedidos de compra confirmados, 0 líneas de recepción, 0 líneas de factura** |
| costo promedio por movimientos | `stock_movements` **no tiene columna de costo** |

> **No hay de dónde sacar un costo.** Y las listas de precios son de venta:
> copiar un precio de venta a `unit_cost_snapshot` sería exactamente el error
> que el punto 12 pide evitar — inflaría el costo del servicio con el margen.

Por eso `unit_cost_snapshot` es **nullable**, y está bien que lo sea:
**carga manual o `NULL`**, nunca autocompletado. Se midió: una línea con costo
`NULL` entra sin problema.

**Y falta una decisión**: `unit_cost_snapshot` **no tiene moneda propia**. La
única moneda cercana es `quote_currency`, que es de la cotización —lo que se
cobra—, no del costo. Hoy el costo es un número sin unidad.

## F · Depósito

| pregunta | respuesta medida |
|---|---|
| ¿es obligatorio? | **sí**, `NOT NULL`. Un insert sin depósito da `23502` |
| ¿cuándo se exige? | **al agregar el repuesto**, no al consumir |
| ¿se valida que sea de la misma empresa? | **NO** — ver los gaps |
| ¿se valida que esté activo? | **NO** |
| ¿hay default? | sí: `warehouses.is_default`. Hoy **un depósito por empresa**, `PRIN · Depósito principal`, activo |

No hay baja lógica de depósitos (`is_active`, sin `deleted_at`). El patrón de
Compras —`depositosActivos()` + preseleccionar el `is_default` cuando hay uno
solo— es directamente reutilizable.

## G · `confirmar_consumo_mantenimiento()`

```
confirmar_consumo_mantenimiento(p_order uuid) RETURNS jsonb
SECURITY DEFINER · search_path = 'public','pg_temp'
```

El flujo, línea por línea:

1. **`SELECT ... FOR UPDATE`** sobre la orden. Serializa todo lo demás.
2. Si no existe → `no_data_found`.
3. **PERMISO**: `app.current_role(company)` tiene que ser `admin` o `employee`.
4. La orden tiene que estar `open`.
5. Tiene que haber al menos un repuesto cargado.
6. **Atajo idempotente**: si no queda ninguno pendiente, devuelve
   `{ya_estaba: true, lineas: 0}`.
7. `PERFORM ... ORDER BY id FOR UPDATE` sobre las pendientes — **orden de
   bloqueo determinista**, que es lo que evita el deadlock entre dos
   transacciones.
8. `set_config('app.consumiendo_mant', p_order, true)` — **marcador local de
   transacción**, la misma puerta que Compras.
9. Por cada pendiente: inserta un `stock_movements` con `movement_type =
   'service_consumption'`, **`quantity = -cantidad`**, `source_type =
   'maintenance_order'`, `source_id = la orden`; y sella la línea con
   `consumed_at = now()` y el `stock_movement_id` devuelto.
10. Baja el marcador.
11. **Un** evento `consumption_confirmed` con `{lineas: N}` — no uno por línea.
12. Devuelve `{order_id, ya_estaba: false, lineas: N}`.

### El fast-path — el bug de Recepciones y Facturas NO está acá

El permiso (paso 3) está **antes** del atajo idempotente (paso 6). Medido con
JWT real: un `customer` llamando la RPC sobre una orden **ya consumida**
recibe

```
Sin permiso para registrar consumos en esta empresa
```

y **no** el `{ya_estaba: true}` que le confirmaría que esa orden existe y está
consumida. Lo mismo `distributor` y `anon`.

*(Detalle menor: «orden inexistente» y «sin permiso» dan mensajes distintos, así
que un externo puede distinguir si un uuid existe. Es el mismo comportamiento
que las RPC de Compras y Ventas; lo anoto como consistente, no como regresión.)*

## H · Stock

| | |
|---|---|
| `service_consumption` en el CHECK de `movement_type` | **sí**, es uno de los nueve |
| signo | **negativo** — `-quantity` |
| `source_type` / `source_id` | `'maintenance_order'` / el id de la orden |
| saldo | lo aplica `app.apply_stock_movement()` AFTER INSERT, sumando la cantidad con su signo |
| unicidad | **no hay UNIQUE** sobre `(source_type, source_id)`: la idempotencia la da `consumed_at`, no un índice |

### Stock negativo — medido

```
saldo antes:  0
se consumen:  3
saldo después: -3       el consumo NO fue rechazado
```

Es la política aprobada: la reparación ya ocurrió físicamente y negarse a
registrarla haría que el sistema mienta sobre una herramienta que ya tiene el
repuesto puesto.

### Idempotencia y concurrencia — medidas

| prueba | resultado |
|---|---|
| confirmar dos veces, secuencial | 2ª devuelve `{ya_estaba: true, lineas: 0}` · **1 solo movimiento** |
| **dos llamadas simultáneas**, dos conexiones, `Promise.all` | A: `{lineas: 1}` · B: `{ya_estaba: true}` · **1 solo movimiento, 1 solo evento de auditoría** |
| UPDATE directo de `consumed_at` | **RECHAZADO** `23001` |
| UPDATE directo de `consumed_at` + `stock_movement_id` apuntando a un movimiento real | **RECHAZADO** `23001` |
| estado de la línea tras los dos intentos | `consumed_at=NULL`, `stock_movement_id=NULL` |

El `FOR UPDATE` sobre la orden es lo que hace que la segunda llamada espere y
después encuentre 0 pendientes. **La concurrencia está resuelta.**

## I · Atomicidad y granularidad

`confirmar_consumo_mantenimiento` es plpgsql: **una transacción**. Un error en
cualquier línea revierte todas, y el marcador `set_config(..., true)` es
transaction-local, así que tampoco sobrevive.

Medido con dos repuestos en una orden: `{lineas: 2}`, **2 movimientos, 0
pendientes**. Todo o nada.

> **Pero la pregunta del punto 17 no se puede plantear con esta firma.** La RPC
> recibe **la orden**, no una lista de líneas: consume **todas** las
> pendientes. No existe «A válida y B inválida» porque no hay forma de elegir.
>
> Eso choca con el punto 14: *«dos pestañas: un solo consumo **por línea**»*.
> Hoy la granularidad es **por orden**. Si querés consumo por línea, hay que
> cambiar la firma —`p_parts uuid[]`— y **eso es una decisión tuya**, no un bug.

## J · Auditoría

| evento | estado |
|---|---|
| `quote_approved` | **EXISTE** — trigger, al entrar a `approved` |
| `quote_rejected` | **EXISTE** — trigger, al entrar a `rejected` |
| `consumption_confirmed` | **EXISTE** — RPC, uno por confirmación con `{lineas: N}` |
| volver de `approved`/`rejected` a `pending` | **FALTA** — hoy es invisible |
| `part_added` | **NO EXISTE** |
| `quote_created` / `quote_updated` | **NO EXISTE** |

Sobre los dos últimos, mi lectura: **`quote_created/updated` no hace falta** —
es justamente el «audit log por cada edición de draft» que pediste evitar; las
líneas de una cotización se editan muchas veces antes de mandarla. **`part_added`
sí vale la pena**: un repuesto agregado es una decisión técnica que después
mueve stock, y no es una edición de borrador.

## K · RLS — medido con JWT real

Policies de las dos tablas: `*_select` con `app.current_maintenance_company_ids()`
y `*_write` (ALL) con `app.current_maintenance_writer_ids()`, ambas **`TO
authenticated`**, y las dos tablas con **`FORCE ROW LEVEL SECURITY`**.

| identidad | filas | por id | por parent_id | escritura | RPC |
|---|---|---|---|---|---|
| **admin** (Buscatools) | ve las suyas | ve | ve | **permitida** | permitida |
| **employee** | = admin (probado en entrega 2) | | | permitida | permitida |
| **salesperson** (Torquetools) | 0 | — | — | **`42501`** | rechazada |
| **technician** | 0 (probado en entrega 2) | — | — | rechazada | rechazada |
| **customer** | **0** | **0** | **0** | **`42501`** | **rechazada** |
| **distributor** | **0** | **0** | **0** | **`42501`** | **rechazada** |
| **anon** | **0** | — | — | **`42501`** | **rechazada** |

La decisión v1 **se cumple**. Probado por id exacto y por `parent_id`, no sólo
contando filas.

## L · Frontend actual

Búsqueda exhaustiva en `src/`: **cero** referencias a `maintenance_quote_lines`,
`maintenance_order_parts`, `confirmar_consumo_mantenimiento`, `capacidad_torque`,
`cerrar_orden_mantenimiento` o `maintenance_measurements`.

| pieza | estado |
|---|---|
| `quote_status` en el listado y en el chip | **REAL** — lectura, ya funciona |
| `quote_total` / `quote_currency` en el tipo `OrdenListado` | **REAL** — se leen, no se muestran en el listado |
| `etiquetaDeCotizacion`, `OPCIONES_COTIZACION` | **REAL** |
| acciones `quote_approved`/`quote_rejected`/`consumption_confirmed` en el historial | **REAL** — ya traducidas |
| tipos generados de las dos tablas en `database.types.ts` | **REAL** — ya están |
| líneas de cotización · repuestos · consumo · stock | **NO EXISTE** |
| el bloque «Todavía no está en esta entrega» de la ficha | **PLACEHOLDER DECLARADO** — es el que hay que reemplazar |

## M · Reutilización

| pieza | de dónde | cómo |
|---|---|---|
| `SelectorProducto` | **ya en Mantenimiento** | tal cual; hay que agregarle el precio de venta como *referencia* en la cotización, no como costo |
| `buscarProductos` | **ya en Mantenimiento** | tal cual |
| `formatearImporte` / `formatearNumero` | **ya en Mantenimiento** | tal cual |
| Paginador, Listado, Panel, Chips, Pagina.module.css | **ya en Mantenimiento** | tal cual |
| `depositosActivos()` + preselección del default | `compras/services/recepciones.ts` | **copiar las ~20 líneas**, no acoplar los módulos |
| grilla de líneas editable | `compras/components/EditorLineas.tsx` | **mirar el patrón, no importarlo**: la de Compras tiene impuestos, monedas y descuentos que acá no existen |
| `attachments` | `compras/services/adjuntosCompras.ts` | parametrizado por entidad, pero **no aplica a esta entrega** |

El criterio: reutilizar lo que ya está **dentro** de Mantenimiento, copiar lo
chico de Compras, y no inventar una abstracción compartida para veinte líneas.

## N · Los nueve casos

| | caso | estado |
|---|---|---|
| **A** | cotización: mano de obra libre 1 × $100 | **SUPPORTED** — probado, `line_total = 100` |
| **B** | cotización: repuesto del catálogo 2 × $50 | **SUPPORTED** — probado, total 200 |
| **C** | cotización rechazada → 0 stock | **SUPPORTED** — rechazar no toca stock |
| **D** | cotización aprobada → 0 stock hasta el consumo | **SUPPORTED** — probado: aprobar dejó el saldo en 0 |
| **E** | repuesto no cotizado durante la reparación | **SUPPORTED** — no hay FK entre líneas y repuestos; son independientes |
| **F** | agregar repuesto → stock intacto | **SUPPORTED** — probado |
| **G** | confirmar consumo → stock baja | **SUPPORTED** — probado, −3 |
| **H** | confirmar dos veces → un movimiento | **SUPPORTED** — probado, también en paralelo |
| **I** | stock 2, consumo 3 → −1 | **SUPPORTED** — probado con 0 y 3 → −3 |

**Los nueve están soportados por el modelo actual sin ningún cambio de
schema.** La entrega 3 es, en lo esencial, **una entrega de frontend**.

## O · Los gaps reales

Cuatro, medidos.

### O1 · Escritura entre empresas — el grave

Prueba: una orden en una empresa donde `jano` **no tiene ninguna membresía**.

```
jano ¿ve esa orden?                                    no (0 filas)
inserta una LÍNEA DE COTIZACIÓN con company_id=BT
  en esa orden ajena                                   >>> PERMITIDO
  y la ve en su propio listado                         SÍ
  y el total de la orden AJENA quedó en                1
inserta un REPUESTO con company_id=BT en esa orden      >>> PERMITIDO
  ¿puede confirmar el consumo?                          NO — sin permiso
```

La RLS mira `company_id` **de la fila**, que es el suyo. Nada compara ese
`company_id` con el de `maintenance_order_id`. Resultado: **un writer de la
empresa A puede escribir en la cotización de la empresa B y cambiarle el
total**, aunque no pueda leer esa orden.

No se puede llegar a mover stock —la RPC verifica el rol sobre la empresa de la
orden— pero **sí se puede corromper el total de un documento ajeno**.

Es el mismo tipo de hueco que el fix de las policies tautológicas: la
protección existía sólo por la forma de la consulta, no por una regla.

### O2 · `product_id` y `warehouse_id` de otra empresa

Medido: aceptados en las dos tablas. Un repuesto puede descontar de un depósito
de otra empresa. Está **dentro** del mismo problema O1 pero es un CHECK
distinto y necesita su propia validación.

### O3 · `quote_status` sin máquina de estados

Las seis transiciones pasan, incluido **desaprobar sin dejar rastro**. El punto
16 pide *«toda transición server-side y auditada»*: hoy **no lo es**.

### O4 · `authenticated` puede insertar en `stock_movements`

Medido: se pudo insertar a mano un movimiento `service_consumption` con
`quantity = -1` apuntando a la orden, **sin pasar por ninguna RPC**, y el saldo
se movió.

No es de Mantenimiento —es un grant de nivel de tabla que afecta también a
Ventas y a Compras, y ninguna de las dos lo cerró— pero **hace que la puerta de
transacción del consumo sea evitable**: no se puede sellar la línea sin la RPC,
pero sí se puede mover el stock por afuera.

### Lo que NO es un gap

* **`anon` con DELETE/INSERT/SELECT/UPDATE** en las dos tablas: es el grant por
  defecto de Supabase sobre `public` y está **igual en las 15 tablas** que
  revisé de Ventas, Clientes y Compras. La RLS lo bloquea, y se midió: `42501`.
  No es una regresión de Mantenimiento.
* **`quote_currency` nullable**: no es un defecto, es una decisión pendiente.
* **Granularidad por orden en el consumo**: no es un bug, es la firma que se
  aprobó. Cambiarla es decisión tuya.

## P · Cambios mínimos propuestos

Clasificados como pediste. **Nada ejecutado.**

| # | cambio | clase | por qué |
|---|---|---|---|
| **P1** | Trigger que exija `company_id` de la línea = `company_id` de su orden, en `maintenance_quote_lines` y `maintenance_order_parts` | **A · integridad** | cierra O1. Sin esto se puede escribir en documentos de otra empresa |
| **P2** | El mismo trigger valida que `product_id` y `warehouse_id` sean de esa empresa, y el depósito `is_active` | **A · integridad** | cierra O2 |
| **P3** | Validar la transición de `quote_status` + auditar **todas**, incluida la vuelta a `pending` | **A · integridad** | cierra O3 y es literalmente el punto 16 |
| **P4** | Evento `part_added` en `maintenance_audit` | **B · funcionalidad** | el punto 17 lo pide y hoy no existe |
| **P5** | Decidir `quote_currency`: exigirla al agregar la primera línea, o dejarla opcional | **B · funcionalidad** | hoy una cotización puede tener total sin moneda |
| **P6** | Decidir la moneda de `unit_cost_snapshot` | **B · funcionalidad** | hoy el costo es un número sin unidad |
| **P7** | `revoke insert on stock_movements from authenticated` | **C · mejora futura** | cierra O4, pero **toca Ventas y Compras, que están cerradas**. Fuera del alcance de la entrega 3 salvo que lo pidas |
| **P8** | Granularidad por línea en el consumo (`p_parts uuid[]`) | **C · mejora futura** | sólo si querés consumo parcial |

Mi recomendación: **P1 a P4 dentro de la entrega 3** (son una sola migración
chica), **P5 y P6 los decidís vos antes de programar**, y **P7 y P8 quedan
afuera**.

## Q · Suite propuesta

`scripts/fase7-mantenimiento-entrega3-tests.mjs`, prefijo `ZZ-M3`:

| # | prueba |
|---|---|
| 1 | línea libre de cotización: entra, `line_total` calculado por el servidor |
| 2 | línea con producto del catálogo: entra, con snapshots |
| 3 | `line_total` manipulado → recalculado |
| 4 | `quote_total` de la orden manipulado → recalculado |
| 5 | total = suma de líneas; borrar una línea baja el total |
| 6 | `line_no` duplicado → `23505` |
| 7 | aprobar: `pending → approved`, auditado |
| 8 | rechazar: `pending → rejected`, auditado |
| 9 | transición inválida rechazada **y auditada** (P3) |
| 10 | no se puede cerrar con la cotización `pending` |
| 11 | no se puede cerrar aprobada y sin líneas |
| 12 | repuesto del catálogo: entra, `product_id` obligatorio |
| 13 | repuesto sin depósito → `23502` |
| 14 | costo `NULL` permitido; **ningún precio de venta se copia como costo** |
| 15 | agregar repuesto **no** mueve stock |
| 16 | aprobar la cotización **no** mueve stock |
| 17 | agregar repuesto **no** altera el total de la cotización |
| 18 | confirmar consumo: mueve stock una vez, signo negativo, `service_consumption` |
| 19 | confirmar dos veces → un movimiento (secuencial) |
| 20 | **dos llamadas simultáneas** → un movimiento, un evento |
| 21 | UPDATE directo de `consumed_at` → rechazado |
| 22 | UPDATE directo de `consumed_at` + `stock_movement_id` → rechazado |
| 23 | borrar un repuesto ya consumido → rechazado |
| 24 | saldo negativo permitido (stock 2, consumo 3 → −1) |
| 25 | atomicidad: dos repuestos, o los dos o ninguno |
| 26 | **línea de cotización en una orden de otra empresa → rechazada** (P1) |
| 27 | **repuesto con producto o depósito de otra empresa → rechazado** (P2) |
| 28 | `part_added` auditado (P4) |
| 29 | RLS de las dos tablas, **seis identidades**, por id y por `parent_id` |
| 30 | fast-path: un externo sobre una orden ya consumida recibe «sin permiso» |
| 31 | quote line sin repuesto · repuesto sin quote line — independientes |
| 32 | limpieza: 0 filas productivas, saldos y secuencias en su valor |

Más los unitarios de las libs puras (cálculo de preview de totales, validación
de líneas, permisos) y la revisión mobile a 390/430/767/768/1440.

---

## Un error mío durante esta auditoría

La primera corrida del probe la canalicé por `head -80`. `head` cerró el pipe,
node murió con SIGPIPE **antes del bloque `finally`** y la limpieza no llegó a
ejecutarse: quedaron 2 equipos, 2 órdenes, 2 líneas, 2 repuestos, 13 eventos de
auditoría y **2 movimientos de stock** en la base.

Lo detecté en la verificación de invariantes de la segunda corrida, lo limpié a
mano y volví a medir todo. **La base quedó en su valor exacto**: 0 filas
productivas de mantenimiento, 381 movimientos, 379 saldos sin ninguna deriva
contra sus movimientos, 1010 clientes, 2 empresas, 21.772 productos y las cuatro
secuencias en 1.

Le agregué al script una advertencia en la cabecera para que no vuelva a pasar.

---

# AUDITORÍA PREVIA · ENTREGA 3 — TERMINADA. No se implementó nada.
