# Fase 6 · Compras — Entrega 4: recepciones y stock

Estado: **EJECUTADA**, con el punto **I** (mobile real) pendiente de una sesión
iniciada en el navegador.

El circuito cierra: pedido confirmado → elegir cantidades pendientes → crear la
recepción en borrador → confirmarla → el stock sube → el `receipt_status` del
pedido se deriva solo.

Fuera de alcance y **no empezado**: facturas de proveedor, Mantenimiento.

| | |
|---|---|
| SQL aplicado | [`docs/database/PHASE_6_PURCHASES.sql`](database/PHASE_6_PURCHASES.sql) |
| Suite | [`scripts/fase6-recepciones-tests.mjs`](../scripts/fase6-recepciones-tests.mjs) |
| Rutas | `#/compras/recepciones` · `#/compras/recepciones/nueva?pedido=` · `#/compras/recepciones/:id` |

Migraciones nuevas:

| versión | nombre |
|---|---|
| 20260910150610 | `fase6_recepciones_reglas_y_concurrencia` |
| 20260910150734 | `fase6_recepcion_confirmada_borrado_de_mantenimiento` |
| 20260910150830 | `fase6_recepcion_mantenimiento_por_rol_del_jwt` |
| 20260910152848 | `fase6_confirmar_recepcion_permiso_antes_que_idempotencia` |

Las tres últimas salieron de cosas que fallaron. Están en **J**.

---

## A · Flujo implementado

**Desde el pedido.** Un pedido confirmado y no recibido del todo muestra
**«Recibir mercadería»**. Lleva a `#/compras/recepciones/nueva?pedido=<id>`.

> **Por qué una ruta aparte y no un panel dentro del pedido**, que es lo que
> preguntabas en el punto 2: una recepción es un documento con datos propios
> —depósito, fecha, remito del proveedor, notas— y meterla dentro de la ficha
> del pedido mezclaría dos documentos en una pantalla. Con el pedido en la
> query string, la pantalla se comparte por link y el «atrás» del navegador
> vuelve al pedido. La ruta no acepta entrar sin pedido: si falta, explica que
> se recibe desde un pedido confirmado.

**La grilla** muestra por línea: SKU, descripción, pedido, recibido
anteriormente, **en borrador**, pendiente, cantidad a recibir y stock actual en
el depósito elegido. Cada fila es una **línea del pedido** identificada por su
`purchase_order_line_id`; nunca por su posición. Hay un botón «Recibir todo lo
pendiente».

**Se guarda en borrador**, que no mueve nada. Confirmar es otra acción y otro
botón, desde la ficha de la recepción, con confirmación en dos pasos.

**Listado** — `#/compras/recepciones`: número, fecha, proveedor, pedido origen,
depósito, estado, líneas, unidades y creada por. Filtros en la URL: número,
proveedor, pedido, estado, depósito y rango de fechas; plegables en mobile.
**Sin columna de importe**: ver **B**.

## B · Comportamiento de los borradores — la auditoría que pediste

**Medido antes de tocar nada**, como pediste en el punto 6. Así quedó
implementado en la entrega 1 y así sigue:

`confirmar_recepcion()` calcula lo pendiente contando **sólo las recepciones
confirmadas**:

```sql
select l.quantity - coalesce(sum(rl2.quantity), 0)
  from goods_receipt_lines rl2
  join goods_receipts r2 on r2.id = rl2.goods_receipt_id
 where rl2.purchase_order_line_id = ... and r2.status = 'confirmed'
```

De ahí salen las dos respuestas:

| tu pregunta | qué pasa hoy |
|---|---|
| Pedido 100, Draft A = 70, ¿Draft B ofrece 100? | **Sí.** Los dos borradores conviven y los dos ven 100 pendientes. |
| ¿Un borrador abandonado bloquea mercadería? | **No.** No reserva nada; se puede olvidar sin consecuencias. |

**No se agregó ningún sistema de reservas.** Ya existe uno, `stock_reservations`,
y es de Ventas: usarlo acá sería darle un segundo significado. Y reservar con
borradores tiene el problema opuesto: un papel olvidado inmovilizando
mercadería para siempre, que es justo lo que no querías.

Lo que sí se hizo es **decirlo**. `public.pendiente_de_pedido()` devuelve, junto
a lo pendiente, **cuánto ya está anotado en otras recepciones en borrador y en
cuáles**. La grilla lo muestra en su propia columna, con el número de la
recepción en el `title`, y un aviso debajo:

> Hay cantidades anotadas en otras recepciones **en borrador**. No están
> reservadas: lo pendiente se cuenta sólo con lo ya confirmado. Si las dos se
> confirman, la segunda va a fallar por sobre-recepción.

Quien recibe decide con el dato a la vista, en vez de enterarse al confirmar.
Y si igual se confirman las dos, la segunda falla —está probado en **E**.

## C · Parciales

Probado exactamente como lo pediste, 100 → 30 → 40 → 30:

| paso | pendiente después | `receipt_status` |
|---|---:|---|
| — | 100 | `pending` |
| recibe 30 | **70** | `partially_received` |
| recibe 40 | **30** | `partially_received` |
| recibe 30 | **0** | `received` |

El stock subió exactamente 100, con **tres movimientos**, uno por recepción. El
`receipt_status` lo deriva `app.derivar_receipt_status()` mirando **todas** las
líneas; la aplicación no lo escribe y si lo intenta el trigger la ignora.

### Sobre-recepción

Recibir 31 cuando quedan 30: **rechazado**, con el detalle
(`Línea 1: se intenta recibir 31.0000 y quedan 30.0000 pendientes`). La
recepción **sigue en borrador**, la cantidad **sigue siendo 31** —no se recortó
a 30 en silencio— y el stock no se movió.

## D · Stock

**Sólo `confirmar_recepcion()` mueve stock.** Un borrador no genera ni un
movimiento, y está probado con los contadores antes y después.

- `stock_movements` con `movement_type = 'purchase_receipt'`, cantidad
  positiva, `source_type = 'goods_receipt'` y `source_id` = la recepción.
- Un movimiento **por producto**, agrupando las líneas: si dos líneas traen el
  mismo producto, es un solo movimiento.
- **`stock_balances` no se toca desde ningún lado.** Lo mantiene el trigger
  `app.apply_stock_movement()` desde `stock_movements`. En todo el módulo no
  hay un solo UPDATE de saldo.
- `warehouse_id` es obligatorio: sin depósito, `23502` con el mensaje «El
  depósito es obligatorio».

### Depósito

Se leen los activos de la empresa; **no se hardcodea `PRIN` ni ningún uuid**.
Si hay uno solo se preselecciona y se muestra como texto; si hay varios, se
elige, con el marcado por defecto primero. El depósito **de otra empresa se
rechaza** —eso no existía y se agregó, ver **J**.

### Líneas sin producto de catálogo

Auditado, punto 11: `goods_receipt_lines.product_id` era **NOT NULL**, así que
una línea libre —un flete, un servicio— **no se podía recibir**. Y como
`derivar_receipt_status()` cuenta todas las líneas que no son capítulo, **un
pedido con una línea de flete no podía llegar nunca a `received`**.

Se cambió a nullable y ahora:

- Una línea libre **se recibe documentalmente**.
- **No genera ningún `stock_movement`**: no hay producto al que sumarle nada, y
  `stock_movements.product_id` es NOT NULL justamente por eso.
- La grilla lo dice en la fila: *«sin producto de catálogo: no mueve stock»*.
- El pedido puede llegar a `received`. Probado: 5 unidades + 1 flete → un solo
  movimiento y el pedido recibido.

El producto tampoco se elige: **es el de la línea del pedido**. Cambiarlo se
rechaza con `23514`.

## E · Concurrencia

| escenario | resultado |
|---|---|
| Dos confirmaciones simultáneas de **la misma** recepción | Las dos responden bien · **un** movimiento · stock +20 una sola vez |
| Una tercera llamada | `ya_estaba: true`, stock igual |
| Dos recepciones **distintas** de 20 sobre una línea con 30 pendientes | **Una entra y la otra falla** · stock +20, no +40 · una sola confirmada · pedido `partially_received` |
| 15 números NEP simultáneos | 15 distintos, formato `NEP00000`, **sin huecos** |

El segundo caso —el del punto 20— **no funcionaba** antes de esta entrega. Ver
**J**.

## F · Atomicidad multilínea

Pedido con A = 10 y B = 10. Recepción con A = 10 (válida) y B = 11 (inválida):

- La confirmación **falla entera**.
- **A tampoco entró**: su stock quedó igual.
- **0 movimientos** con esa recepción como origen.
- La recepción **no quedó confirmada**: sigue en borrador.

Todo pasa dentro de una sola función plpgsql, o sea una transacción: la
validación corre entera antes del primer insert, y si algo falla no queda nada.

## G · RLS

| rol | listado | id exacto | número NEP | por pedido | por proveedor | por depósito | líneas | confirmar |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| admin / employee | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| salesperson | **0** | 0 | 0 | 0 | 0 | 0 | 0 | `42501` |
| customer | **0** | 0 | 0 | 0 | 0 | 0 | 0 | `42501` |
| distributor | **0** | 0 | 0 | 0 | 0 | 0 | 0 | `42501` |
| anónimo | **0** | — | — | — | — | — | — | — |

Los siete caminos que pediste, cubiertos, más `goods_receipt_lines` por
separado: no alcanza con proteger la cabecera. Y la empresa ajena: Jano es
salesperson en Torquetools y no ve ni puede crear recepciones ahí.

Que `confirmar_recepcion` rechace a un externo **es nuevo**: antes contestaba.
Ver **J**.

## H · Auditoría

Sólo eventos de negocio, con el vocabulario que ya existía en
`purchases_audit.action`:

| lo que pediste | acción registrada | dónde |
|---|---|---|
| `goods_receipt_created` | `create` | recepción |
| `goods_receipt_confirmed` | `confirm` | recepción |
| `stock_received` | `stock_applied` | recepción, **uno por recepción** |
| — | `receive` con el `receipt_status` nuevo | pedido |

**Un solo evento de stock por recepción, no uno por línea**, como pediste: veinte
filas «entró un producto» no dicen más que una que diga «entraron veinte».

**Editar un borrador no deja rastro** y está probado: dos cambios de notas
producen un solo evento, el del alta.

## I · Mobile — pendiente

**No lo pude terminar.** Preparé los datos, empecé la revisión y la sesión del
navegador venció en el medio; volver a entrar necesita escribir una contraseña
y eso no lo hago.

Los fixtures se borraron: la base quedó en los invariantes de **K**.

Cuando inicies sesión en el panel del navegador los recreo —son cinco
segundos— y hago la pasada completa a 390 / 430 / 768 con el mismo método de la
entrega 3: abrir el pedido, «Recibir mercadería», cantidades, depósito, crear
el borrador, confirmarlo, ver el estado actualizado, y medir
`document.scrollWidth === window.innerWidth` en cada ancho.

Lo que está hecho y es verificable en el código:

- La grilla de nueve columnas scrollea **dentro de su propia caja**
  (`overflow-x:auto`, `min-width:52rem`); el body nunca scrollea en horizontal.
- El listado es tabla en escritorio y **tarjetas por debajo de 768**.
- Los inputs de cantidad pasan a **16px y 44px** por debajo de 768.
- Los filtros del listado se pliegan en mobile detrás de «Filtros» con
  contador, igual que en pedidos.
- Los controles de la cabecera de la recepción tienen `max-width: 22rem`, no se
  desbordan en 390.

## J · Bugs encontrados

Seis. Cinco los encontró un test que falló; uno, armar los datos de prueba.

### 1 · Dos recepciones distintas sobre la misma línea entraban las dos

El punto 20, y era real. `confirmar_recepcion` hacía `for update` sobre **la
recepción**, que es una fila distinta en cada transacción. Dos confirmaciones
simultáneas de recepciones distintas leían las dos «quedan 30», las dos pasaban
la validación y entraban 40 sobre una línea de 30.

Corregido bloqueando **las líneas del pedido** —`select … for update`, en orden
de id para no trabarse entre sí— antes de calcular lo pendiente. La segunda
espera a la primera y recalcula sobre lo que quedó de verdad.

### 2 · Una línea libre no se podía recibir, y bloqueaba el pedido para siempre

`goods_receipt_lines.product_id` era NOT NULL. Un pedido con una línea de flete
no podía llegar nunca a `received`. Ver **D**.

### 3 · Nada comprobaba de qué empresa era el depósito

Se podía crear una recepción en el **depósito de otra empresa**, contra un
**pedido de otra empresa**, contra un pedido **de otro proveedor** o contra uno
**en borrador o cancelado**. Ninguna de esas cuatro cosas estaba validada.

Agregado `app.validar_recepcion()`. Y `app.validar_linea_recepcion()`, que
comprueba que la línea sea del pedido de esa recepción, que no sea un capítulo
y que el producto sea el de la línea del pedido.

### 4 · Una recepción confirmada se podía editar y borrar

No había ninguna guarda: la policy es `FOR ALL`. Agregados
`app.proteger_recepcion_confirmada()` y `app.proteger_lineas_recepcion()`.

Con una vuelta de tuerca que hay que contar: la primera versión bloqueaba el
DELETE **para todos, incluida la clave de servicio**, y eso dejó doce
proveedores y cuatro recepciones de prueba imposibles de limpiar. La salida es
angosta y explícita: **sólo el DELETE**, y sólo desde una sesión cuyo JWT dice
`service_role` y sin `auth.uid()` —un script de mantenimiento, nunca un
navegador—. El UPDATE no tiene salida: una recepción confirmada no se modifica
ni desde un script.

De paso: el primer intento usaba `current_user`, que dentro de una función
SECURITY DEFINER es el **dueño** de la función y no quien la llama. No
funcionaba. Se cambió por `auth.role()`, que lee el JWT de la request.

### 5 · Un externo le podía sacar información a `confirmar_recepcion`

La comprobación de permisos estaba **después** del atajo de idempotencia. Sobre
una recepción ya confirmada, la función devolvía el JSON —cuántos movimientos
tiene, en qué estado quedó el pedido— sin mirar quién preguntaba. No confirmaba
nada, pero contaba cosas, y al ser SECURITY DEFINER la RPC no está cubierta por
RLS.

Corregido con el orden obvio: primero el permiso, después todo lo demás.

### 6 · El trigger de líneas no cubría el INSERT

Ya estaba en la entrega 3 pero conviene repetirlo acá porque es el mismo error
que se repitió en las recepciones: un trigger declarado `BEFORE UPDATE OR
DELETE` deja el INSERT afuera. Los dos triggers nuevos de recepciones se
declararon desde el principio `BEFORE INSERT OR UPDATE OR DELETE`.

### Y una aclaración sobre la valorización

Auditado, punto 15: **`goods_receipts` NO está valorizada**. `goods_receipt_lines`
tiene `quantity` y los snapshots del producto, y **ninguna columna de precio**;
`goods_receipts` no tiene totales.

**No se agregó ninguna.** El costo, cuando haga falta, está en la línea del
pedido —`purchase_order_lines.unit_price`— y se llega por
`purchase_order_line_id`. Copiarlo a la recepción sólo porque el legacy lo
hacía sería duplicar un dato que ya existe, con el riesgo de que las dos copias
se separen. Por eso el listado de recepciones **no tiene columna de importe**.

## K · Regresión e invariantes

**16 suites contra la base real: 0 fallos en las 16.**

7 de Ventas · 5 de Clientes · schema de Compras · Proveedores · Pedidos de
compra · Recepciones.

Al terminar los fixtures, exactamente lo que pediste:

| | |
|---|---:|
| proveedores | **142** |
| purchase_orders reales | **0** |
| goods_receipts reales | **0** |
| supplier_invoices | **0** |
| stock_movements | **381** |
| stock_balances | **379** |
| purchases_audit | **0** |
| cotizaciones / pedidos / entregas / documentos | 288 / 166 / 182 / 636 |
| huella de Ventas | `8091b9166350c5bf2c331b1d882ec654` |
| clientes / contactos / alias | 1010 / 87 / 14 |

## L · CI y deploy

- `npm run lint` · `tsc -b` · **393 tests** · `test:isolated` · `npm run build` — verde.
- `database.types.ts`: `goods_receipt_lines.product_id` pasó a nullable y se
  agregó `pendiente_de_pedido`. Las ocho tablas siguen generadas por
  `scripts/fase6-generar-tipos-compras.mjs`.
- «Notas de entrada» entra en el menú, visible sólo para admin y employee.

---

## Lo que queda para la entrega 5

Facturas de proveedor. El schema está desde la entrega 1 —incluido el enlace
por `purchase_order_line_id` y `goods_receipt_line_id`, y el flete que entra en
el neto sin gravarse si está exento— y probado; falta la pantalla.

Decisiones ya tomadas: sin `purchase_order_id` en la cabecera de la factura —se
llega por las líneas—, número del proveedor único por proveedor, y varias
facturas pueden convivir sobre el mismo pedido.
