# Security fix · O4 — escritura directa sobre `stock_movements`

Deuda transversal arrastrada desde la auditoría de Mantenimiento (entrega 3) y
mantenida abierta a propósito en las entregas 4 y 5, porque toca Ventas,
Compras, Mantenimiento y `stock_balances` a la vez.

**Primero se auditó. Después se tocó una sola cosa.**

---

## A · El bug, reproducido

No por inspección de policies: con **JWT reales** y midiendo el efecto.

```
1 · INSERT DIRECTO · las seis identidades, midiendo el efecto
    FAIL  SE PERMITIÓ: ADMIN (Buscatools) insertó un movimiento — fila 1152
    FAIL    y el trigger corrió: el saldo cambió — null → -7
    FAIL  SE PERMITIÓ: EMPLOYEE (Buscatools) insertó un movimiento — fila 1153
    FAIL    y el trigger corrió: el saldo cambió — -7 → -14
    PASS  TECHNICIAN (Buscatools): rechazado — 42501
    PASS  CUSTOMER: rechazado — 42501
    PASS  DISTRIBUTOR: rechazado — 42501
    PASS  ANON: rechazado — 42501
```

La fila entró por PostgREST con `movement_type: 'adjustment'`, `quantity: -7`,
`source_type: 'ZZ-O4'` — un tipo y un origen elegidos por el cliente— y
**`trg_stock_apply` corrió**: el saldo de un producto que no tenía fila pasó a
existir en −7, y con el segundo intento a −14.

Eso es el agujero completo: **cualquier admin o empleado podía cambiar el stock
de cualquier producto de su empresa sin pasar por ninguna función de negocio**,
sin documento que lo respalde y con el `movement_type` que quisiera.

Lo que **no** era parte del agujero, y conviene decirlo porque acota el alcance:

- `technician`, `customer`, `distributor` y `anon` ya estaban bloqueados por el
  `CHECK` de rol de la policy `stockmov_insert`.
- Un salesperson de Torquetools tampoco podía mover stock en Torquetools.

---

## B · Permisos antes del cambio

Separando las dos capas, como pide el punto 3.

### Privilegios SQL (`relacl`)

| tabla | rol | privilegios |
|---|---|---|
| `stock_movements` | postgres | `arwdDxtm` (todo) |
| | **authenticated** | **`arDxtm`** → **`a` = INSERT** + `r` = SELECT |
| | service_role | `arwdDxtm` |
| | anon / PUBLIC | *(sin entrada: nada)* |
| `stock_balances` | postgres | `arwdDxtm` |
| | authenticated | `rDxtm` → sólo SELECT |
| | service_role | `arwdDxtm` |
| | anon / PUBLIC | *(sin entrada: nada)* |

**`authenticated` nunca tuvo `w` (UPDATE) ni `d` (DELETE) en ninguna de las
dos**, y nunca tuvo escritura sobre `stock_balances`. El agujero era
exactamente una letra: la `a` de `stock_movements`.

### RLS

| tabla | policies |
|---|---|
| `stock_movements` | `stockmov_select` (SELECT, internos de la empresa) · `stockmov_insert` (INSERT, `company_id` de la empresa **y** rol admin/employee) |
| `stock_balances` | RLS activa, sin policy de escritura |

Ninguna de las dos tiene policy de UPDATE ni de DELETE: sin policy, RLS deniega.
Por eso el UPDATE/DELETE fallaba por **las dos** capas a la vez.

`relforcerowsecurity = false` en las dos: el dueño (`postgres`) no pasa por RLS,
que es justo lo que necesitan las funciones `SECURITY DEFINER`.

---

## C · Flujos legítimos — inventario completo

Búsqueda en la base y en el repo. Cuatro funciones tocan `stock_movements`;
sólo tres insertan y ninguna actualiza ni borra. Ninguna usa SQL dinámico.

| módulo | flujo | quién inserta | por dónde | ¿necesita GRANT directo? |
|---|---|---|---|---|
| Ventas | confirmar un remito | `confirmar_entrega(uuid)` | RPC `SECURITY DEFINER`, owner `postgres` | **NO** |
| Compras | confirmar una recepción | `confirmar_recepcion(uuid)` | RPC `SECURITY DEFINER`, owner `postgres` | **NO** |
| Mantenimiento | confirmar el consumo de repuestos | `confirmar_consumo_mantenimiento(uuid)` | RPC `SECURITY DEFINER`, owner `postgres` | **NO** |
| Ventas | proteger el borrado de un remito | `app.proteger_borrado_entrega()` | trigger, **sólo lee** | **NO** |
| — | migración del catálogo | `import-catalog.mjs` | `SUPABASE_SECRET_KEY` → service_role | **NO** |
| — | regresión de bugs de migración | `regresion-bugs-migracion.mjs` | `SUPABASE_SECRET_KEY` → service_role | **NO** |
| — | ataque de prueba | `stage3-entregas-tests.mjs` | sesión de customer/distributor/salesperson | es un test: **espera el rechazo** |
| — | limpieza de fixtures | varias suites | service_role | **NO** |

**`src/` no escribe stock en ningún lado.** En todo el frontend hay una sola
referencia a las tablas de stock, y es un `select` de `stock_balances` en
`modules/mantenimiento/services/repuestos.ts` para mostrar el saldo al lado del
repuesto. Cero `insert`, cero `update`, cero `upsert`.

Las tres RPC son `SECURITY DEFINER` propiedad de `postgres`, o sea **corren con
los privilegios del dueño, no con los de quien llama**. Revocarle el INSERT a
`authenticated` no las toca.

### Los tipos de movimiento realmente en uso

El `CHECK` admite nueve: `opening_balance`, `purchase_receipt`, `sale_delivery`,
`adjustment`, `transfer_in`, `transfer_out`, `return_in`, `return_out`,
`service_consumption`. En producción hay **cuatro filas de tres tipos**:

| movement_type | source_type | filas | actor |
|---|---|---|---|
| `opening_balance` | `migration` | 378 | null (service_role) |
| `sale_delivery` | `test` | 1 | con actor |
| `opening_balance` | `test` | 1 | con actor |
| `adjustment` | `test` | 1 | con actor |

Las tres de `source_type: 'test'` son huella histórica de fases anteriores y no
se tocaron.

---

## D · Ajustes, transferencias e inventario

**No existe ninguna funcionalidad de ajuste manual, recuento, corrección ni
transferencia en el ERP nuevo.** Búsqueda en todo `src/`: cero coincidencias de
`adjustment`, `transfer_in`, `transfer_out`, `opening_balance`, «ajuste de
stock», «inventario» o «recuento» fuera de los tipos generados.

Por eso **no se creó ninguna función `registrar_ajuste_stock()` ni
`transferir_stock()`**: no habría a quién servirle. Cuando exista la pantalla,
se creará la RPC con su validación, su chequeo de empresa y su auditoría — y no
un `GRANT INSERT` abierto «por comodidad», que es exactamente lo que esto vino
a cerrar.

**Queda anotado como la puerta por la que entrará esa funcionalidad el día que
se pida.**

---

## E · UPDATE, DELETE y `stock_balances`

Probado con las cinco identidades autenticadas, antes y después del cambio.
Todo rechazado con `42501`, las dos veces:

| intento | admin | employee | technician | customer | distributor |
|---|---|---|---|---|---|
| `UPDATE stock_movements` | ✗ | ✗ | ✗ | ✗ | ✗ |
| `DELETE stock_movements` | ✗ | ✗ | ✗ | ✗ | ✗ |
| `UPDATE stock_balances.on_hand` | ✗ | ✗ | ✗ | ✗ | ✗ |
| `INSERT stock_balances` | ✗ | ✗ | ✗ | ✗ | ✗ |
| `DELETE stock_balances` | ✗ | ✗ | ✗ | ✗ | ✗ |

Se probaron las dos columnas que escribe un trigger, `on_hand` y `reserved`: el
privilegio es de tabla, pero conviene que la prueba diga lo que se quiso probar.

El movimiento histórico que se intentó reescribir quedó con su cantidad
original (16).

### Superficie adyacente: `stock_reservations`

El punto 12 pedía reportar cualquier otro hueco del mismo *security surface*.
Apareció uno adyacente, y **no es un hueco: es una puerta con diseño**.

```
stock_reservations · authenticated = ardDxtm  → INSERT, SELECT, DELETE
  reservations_insert  INSERT  admin | employee | salesperson, de su empresa
  reservations_delete  DELETE  admin | employee | salesperson, de su empresa
  reservations_select  SELECT  internos de la empresa
  trg_reservation_apply  AFTER INSERT OR DELETE → app.apply_stock_reservation()
```

O sea: un salesperson **sí** puede escribir reservas directamente, y eso mueve
`stock_balances.reserved`. Tres razones por las que no se tocó:

1. **`reserved` no es `on_hand`.** No cambia lo que existe en el depósito: marca
   lo que está comprometido. Nadie puede hacer desaparecer una herramienta
   reservando.
2. **El trigger es simétrico**: `AFTER INSERT OR DELETE`. Poner y sacar una
   reserva deja el saldo donde estaba. `apply_stock_movement()`, en cambio, es
   sólo `AFTER INSERT`, y por eso los movimientos tienen que ser append-only.
3. **Hay policies explícitas de INSERT y DELETE**, escritas a propósito, con su
   chequeo de empresa y de rol. No es un grant heredado por descuido como el de
   O4: es el mecanismo por el que `confirmar_entrega()` consume reservas.

Queda anotado acá porque alguien que lea «el stock no se toca directo» merece
saber que `reserved` sí se toca, por una puerta con nombre.

**Esto importa más de lo que parece**: `trg_stock_apply` es `AFTER INSERT`
únicamente. Un UPDATE o un DELETE **no** recalcularían `stock_balances`, así que
un movimiento borrado dejaría el saldo mintiendo. Que las dos operaciones estén
cerradas por privilegio **y** por ausencia de policy es lo que hace que el saldo
siga siendo la suma de los movimientos.

---

## F · El trigger

```sql
create or replace function app.apply_stock_movement() returns trigger
language plpgsql security definer set search_path to 'public','pg_temp' as $$
begin
  insert into stock_balances (company_id, product_id, warehouse_id, on_hand)
  values (new.company_id, new.product_id, new.warehouse_id, new.quantity)
  on conflict (product_id, warehouse_id) do update
    set on_hand = stock_balances.on_hand + excluded.on_hand,
        updated_at = now();
  return new;
end $$;
```

`AFTER INSERT FOR EACH ROW`. Suma lo que reciba, por producto y depósito. El
signo lo pone quien inserta: `confirmar_entrega` manda la cantidad en negativo,
`confirmar_recepcion` en positivo.

**No se tocó.** Funciona y el cambio no lo necesita.

---

## G · El cambio aplicado

Migración `security_o4_revoke_stock_writes`. Ni una línea de lógica de negocio.

```sql
revoke insert on public.stock_movements from authenticated;

revoke insert, update, delete, truncate on public.stock_movements from public, anon;
revoke insert, update, delete, truncate on public.stock_balances  from public, anon, authenticated;

grant select on public.stock_movements to authenticated;
grant select on public.stock_balances  to authenticated;
```

Los `revoke` sobre `public` y `anon` son no-ops hoy —no tienen nada— y están
puestos **explícitamente**: `revoke ... from anon` no alcanza si mañana alguien
hace `grant ... to public`, y esa fue exactamente la lección del fix de las RPC
ejecutables por PUBLIC.

### Privilegios después

| tabla | authenticated antes | authenticated después |
|---|---|---|
| `stock_movements` | `arDxtm` | **`rDxtm`** — se fue la `a` |
| `stock_balances` | `rDxtm` | **`rxtm`** |

`postgres` y `service_role` sin cambios.

### La policy se deja donde está

`stockmov_insert` no se borró **a propósito**. Con el privilegio revocado no
llega a evaluarse nunca, pero es la segunda capa: si alguien re-otorga el INSERT
por descuido, la policy sigue exigiendo empresa y rol admin/employee.

**Defensa en profundidad: el privilegio y la policy, no uno de los dos.** Es lo
que pide el punto 18 — que RLS no sea la única protección, y que el privilegio
no dependa de que nadie escriba mal una policy en el futuro.

---

## H · Ataques después del fix

`scripts/security-o4-stock-movements-tests.mjs` — nació como auditoría y queda
como **suite permanente**: falla si alguien vuelve a otorgar el privilegio.

| # | ataque | resultado |
|---|---|---|
| A1 | customer INSERT `stock_movements` | **rechazado** `42501` |
| A2 | distributor INSERT | **rechazado** `42501` |
| A3 | salesperson INSERT en su propia empresa | **rechazado** `42501` |
| A4 | **employee INSERT directo** | **rechazado** `42501` |
| A4b | **admin INSERT directo** | **rechazado** `42501` |
| A5 | UPDATE de un movimiento histórico | **rechazado** `42501` |
| A6 | DELETE de un movimiento histórico | **rechazado** `42501` |
| A7 | UPDATE / INSERT / DELETE de un saldo | **rechazado** `42501` |
| A8 | anon | **rechazado** `42501` |

```
RESULTADO: 0 hallazgo(s)
```

La suite mide el **efecto**, no el código: si una fila llegara a entrar,
comprueba si el trigger corrió y si el saldo se movió. Antes del fix reportaba
las dos cosas; ahora no llega a entrar ninguna.

### Lectura

| identidad | movimientos visibles | saldos visibles |
|---|---|---|
| admin / employee / technician | sí | sí |
| customer / distributor / anon | **0** | **0** |

Los internos siguen viendo el stock —lo necesitan las pantallas de Compras y de
Mantenimiento— y los externos no ven nada.

---

## I · Ventas sigue moviendo stock

`stage3-entregas-tests` → **0 fallos**.

Confirmar un remito descuenta exactamente una vez, la idempotencia sigue
funcionando (`ya_confirmada: true` en el segundo intento, sin movimientos
nuevos) y dos confirmaciones simultáneas siguen descontando una sola vez gracias
al `for update`.

---

## J · Compras sigue moviendo stock

`fase6-recepciones-tests` → **0 fallos**.

Confirmar una recepción suma exactamente una vez. El índice único parcial
`uq_stock_mov_recepcion (source_type, source_id, product_id, warehouse_id)
where source_type = 'goods_receipt'` sigue siendo la garantía de que una
recepción no se aplica dos veces.

---

## K · Mantenimiento sigue moviendo stock

`fase7-mantenimiento-entrega3-tests` → **0 fallos**.

Agregar un repuesto no mueve stock; confirmar el consumo sí, una sola vez;
cerrar la orden no vuelve a moverlo. Dos consumos simultáneos siguen moviendo
stock una sola vez.

---

## L · Multiempresa

- Un salesperson de Torquetools no puede mover stock en Torquetools: **rechazado**.
- Las tres RPC verifican la empresa **antes** de insertar, con
  `app.current_writer_company_ids()`, y esa verificación no cambió.
- Con el privilegio revocado, la vía directa ya no existe para ninguna empresa.

---

## M · Scripts administrativos

Se revisaron los **24 scripts** que mencionan `stock_movements` o
`stock_balances`. Todos los que escriben usan `SUPABASE_SECRET_KEY`, o sea
**service_role**, que conserva `arwdDxtm` en las dos tablas:

| script | clave | qué hace con el stock |
|---|---|---|
| `import-catalog.mjs` | secret | inserta las aperturas de la migración |
| `reconcile-catalog.mjs` · `reconciliar-ventas.mjs` | secret | reconcilian |
| `backup-logical.mjs` | secret | respalda |
| `regresion-bugs-migracion.mjs` | secret | prueba la idempotencia de `opening_balance` |
| las 18 suites de fase | secret **+** anon | anon/sesión para los ataques, secret para preparar y limpiar |

`regresion-bugs-migracion` → **0 fallos**, incluidas sus pruebas de
idempotencia de `opening_balance`.

`import-catalog.mjs` **no se ejecutó**: reimportaría el catálogo entero sobre
producción. Que no le afecte el cambio se verificó leyendo el código —usa la
clave de servicio, línea 164— y no corriéndolo.

**No se le dio ningún GRANT a `authenticated` para resolver un script
administrativo.** Son dos cosas distintas: el usuario de la aplicación y la
clave de backend, que no se expone al frontend y vive en `.env.migration`, fuera
del repo.

---

## N · Invariantes

Los fixtures de la auditoría se limpiaron y todo volvió al baseline:

| invariante | valor |
|---|---|
| `stock_movements` | **381** |
| `stock_balances` | **379** |
| saldos negativos | **0** |
| deriva saldo ↔ suma de movimientos | **0** |
| reservas · saldos con `reserved <> 0` | 0 · 0 |
| productos de Buscatools | 21.772 |
| clientes · contactos · aliases · proveedores | 1010 · 87 · 14 · 142 |
| cotizaciones · pedidos · entregas · líneas de entrega | 288 · 166 · 182 · 600 |
| órdenes de compra reales | 0 |
| equipos y órdenes de mantenimiento productivas | 0 · 0 |
| imágenes de producto | 8859 |

### Un residuo que dejó mi propia limpieza

La primera corrida de la auditoría terminó con **380 saldos en vez de 379**. El
movimiento de prueba creó una fila de saldo para un producto que no tenía
ninguna; al borrar el movimiento, `trg_stock_apply` —que es `AFTER INSERT`— no
revirtió nada, y mi limpieza sólo borraba filas cuyo `on_hand` ya fuera cero, así
que la dejó en cero en vez de borrarla.

Lo detectó la comprobación de invariantes del propio script. Se borró la fila y
se corrigió la lógica: **sin movimientos no hay saldo, la fila se borra, no se
pone en cero.** Una fila en cero sigue siendo una fila que antes no existía.

---

## O · Regresión

| | |
|---|---|
| **27 suites de base de datos, en serie** | **0 fallos** |
| `tsc --noEmit` (strict) | limpio |
| `eslint src scripts` | limpio |
| `vitest run` | 47 archivos · **550 tests** |
| `test:isolated` | 47 archivos · **550 tests** |
| `npm run build` | ✓ |

En serie y no en paralelo: todas afirman invariantes globales y dos a la vez se
pisan — es la lección que quedó anotada en la entrega 5.

---

## P · Bugs encontrados

Ninguno nuevo en el producto. El único hallazgo fue el propio O4, reproducido y
cerrado, más el defecto de limpieza de mi script descrito en **N**.

Nada de lo que el enunciado prohibía tocar se tocó: no cambió la política de
stock negativo, ni los tipos de movimiento, ni las reservas, ni la lógica de
Ventas, Compras o Mantenimiento. No se creó ningún módulo de Inventario.

---

## Q · Alcance del cambio y despliegue

El cambio es **exclusivamente de privilegios en la base**. No hay una sola línea
de TypeScript modificada, así que **no hay chunk nuevo que desplegar**: el
`index-BC4dyyc3.js` que está en producción es el mismo de antes del fix, y
responde HTTP 200. La aplicación ya está corriendo contra la base corregida
desde que se aplicó la migración.

Lo que se commitea es la suite de ataques, este informe y la corrección de la
matriz de RLS, que todavía describía el INSERT como permitido.

### Cómo se verificó, con precisión

La comprobación en producción se hizo **en la capa que cambió**: la suite de
ataques corre contra la base de producción, con los **mismos JWT reales** que
usa la aplicación —los emite el mismo Supabase Auth— y contra el mismo
PostgREST. Las seis identidades leen el stock y ninguna lo escribe.

**No se ejercitaron pantallas**, y no por omisión: no cambió ninguna. El
frontend nunca usó el privilegio revocado —su única referencia a las tablas de
stock es un `select`— así que mirar una pantalla no probaría nada que la suite
no pruebe mejor, sobre las seis identidades en vez de sobre una.

---

## Criterio de cierre

| criterio | estado |
|---|---|
| INSERT directo no autorizado bloqueado | **sí** — las seis identidades, `42501` |
| UPDATE directo bloqueado | **sí** |
| DELETE directo bloqueado | **sí** |
| `stock_balances` no manipulable directamente | **sí** — sólo SELECT |
| Ventas sigue moviendo stock | **sí** |
| Compras sigue moviendo stock | **sí** |
| Mantenimiento sigue moviendo stock | **sí** |
| idempotencia sigue funcionando | **sí**, en los tres flujos |
| multiempresa | **PASS** |
| scripts administrativos | **PASS** |
| invariantes intactos | **sí** — 381 / 379 / 0 / 0 |
| regresión | **PASS** |

---

# O4 = CLOSED
