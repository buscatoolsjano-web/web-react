# Fase 7 · Mantenimiento · Entrega 4 — Torque y cierre final

Cierra el circuito de la orden de servicio: la medición de torque con sus
indicadores de capacidad, la etapa de reparación, el avance controlado por las
etapas y el cierre definitivo con sus doce condiciones.

---

## A · Auditoría previa: qué ya existía

El punto 0 del pedido era obligatorio y cambió el alcance de la entrega. El
grueso del torque **ya estaba construido y funcionando desde la entrega 1**.
Lo que sigue es el mapa que salió de medir la base real, no de leer código.

### YA EXISTE (reutilizado, no reescrito)

| Pieza | Dónde |
|---|---|
| Límites de torque en la orden | `torque_lsl`, `torque_nominal`, `torque_usl`, `torque_required`, `torque_at`, `torque_by` |
| Tabla de mediciones | `maintenance_measurements` con `row_no`, `min_value`, `max_value`, `target_value` |
| Cálculo de capacidad | `capacidad_torque(p_order)` — Cp, Cpk, CV, promedio, desvío, veredicto |
| Torque completado exige medición | `app.proteger_orden_mantenimiento()` |
| Un torque completado no queda sin mediciones | `app.proteger_mediciones_mantenimiento()` |
| Las doce condiciones de cierre | `cerrar_orden_mantenimiento()` |
| Cancelación | `cancelar_orden_mantenimiento()` |
| Validación del circuito de etapas | `app.validar_etapa_mantenimiento()` |
| Eventos de auditoría | `app.auditar_orden_mantenimiento()` — incluye `stage_reverted` y `stage_marked_not_required` |
| Congelado al cerrar | las cuatro tablas hijas y la cabecera |
| Rechazo del UPDATE directo a `status` | marcador de transacción `app.cerrando_orden_mant` |

### FALTA BACKEND (lo que esta entrega agregó)

1. El nominal no estaba obligado a caer dentro de `[LCI, LCS]`.
2. `numeric` **acepta NaN**: una medición en NaN se guardaba y
   `capacidad_torque()` devolvía `{"promedio":"NaN"}`.
3. No había forma de preguntar «¿se puede cerrar?» sin intentar cerrar.

### FALTA FRONTEND

Todo: no existía ninguna pantalla de torque, de reparación ni de cierre.

---

## B · Las fórmulas, documentadas y **no** reemplazadas

Se documentan tal como estaban implementadas. No se creó una segunda
implementación matemática, ni en SQL ni en JavaScript.

```
n         count(*) where target_value is not null and target_value > 0
promedio  avg(target_value)
desvio    stddev_samp(target_value)              ← MUESTRAL (n−1), no poblacional
cp        (usl − lsl) / (6 · desvio)
cpk       least((usl − μ) / (3 · σ), (μ − lsl) / (3 · σ))
cv        (desvio / promedio) · 100              ← PORCENTAJE, no la razón cruda

veredicto  cpk ≥ 1.33 → capaz
           cpk ≥ 1.00 → aceptable
           si no      → no_capaz
```

Dos cosas que hay que decir en voz alta porque es fácil suponer lo contrario:

- **El desvío es muestral, `stddev_samp`**, con `n−1` en el denominador. Con
  `stddev_pop` los Cpk darían distintos y no habría forma de comparar con lo
  ya medido.
- **Son tres veredictos, no dos.** «Aceptable» es un estado propio. Colapsarlo
  contra «no capaz» haría rechazar trabajo que el taller da por bueno.

### Caso de regresión

El del pedido, salido de la función real, sin ningún valor escrito a mano:

| Entrada | Valor |
|---|---|
| Mediciones | 9,9 · 10,1 · 10,0 · 9,95 · 10,05 |
| LCI / LCS | 9 / 11 |

```json
{"cp":4.2164,"cv":0.7906,"cpk":4.2164,"desvio":0.0791,
 "promedio":10,"veredicto":"capaz","mediciones":5}
```

**Cpk = 4,2164 · veredicto «capaz»**, igual que el diseño, y la suite lo vuelve
a calcular en JavaScript de forma independiente para confirmar que no le está
creyendo a la función por costumbre.

---

## C · Casos borde: nunca NaN, nunca Infinity

Probados uno por uno contra la función real:

| Caso | Resultado |
|---|---|
| 0 mediciones | Cp, Cpk, CV = `null` → se muestra **N/D** |
| 1 medición | `null` → **N/D** (con n=1 no hay desvío muestral) |
| Todas iguales, σ = 0 | `null` → **N/D** |
| Exactamente en LCI y LCS (9 y 11) | Cpk = **0,2357** — existe y es chico, no es N/D |
| Una medición fuera de límites | Cpk **negativo** (−0,0487), veredicto `no_capaz` |
| Media = 0 | CV = `null`, no una división por cero |

Ninguno devuelve `NaN` ni `Infinity`: la suite hace la comprobación sobre el
JSON crudo, no sobre el valor ya convertido.

`indicadorDeCapacidad()` es lo único que decide cómo se muestra un indicador
ausente, y muestra **`N/D`**, no `0`. Un indicador que no existe no es un
indicador que vale cero: mostrar «0» diría «el proceso es pésimo» cuando lo que
pasa es que todavía no hay con qué opinar. Un cero real sí se muestra como `0`.

---

## D · Lo que **no** se agregó (punto 1 del pedido)

No hay unidad, ni instrumento, ni número de serie del instrumento, ni fecha o
técnico por medición, ni certificado, ni tolerancia, ni incertidumbre, ni
método de calibración. Exactamente **LCI / NOMINAL / LCS + N mediciones**, con
`min_value` / `max_value` / `target_value`.

No hay JSONB ni tabla paralela: las mediciones viven en
`maintenance_measurements`, que ya existía.

Los indicadores **no se guardan**. Se calculan en el servidor en cada consulta.
Guardarlos crearía la posibilidad de que el número guardado y el número real
dejen de coincidir.

---

## E · Las migraciones

### `fase7_entrega4_validaciones_de_torque`

```sql
alter table maintenance_orders add constraint chk_mo_torque_nominal check (
  torque_lsl is null or torque_usl is null or torque_nominal is null
  or (torque_nominal >= torque_lsl and torque_nominal <= torque_usl));
```

Y dos CHECK contra `'NaN'::numeric`, `'Infinity'` y `'-Infinity'` sobre los tres
límites y sobre los tres valores de la medición.

El guardián **no puede ser `x = x`**: para `numeric`, `NaN = NaN` es TRUE. Hay
que comparar contra `'NaN'::numeric` explícitamente.

### `fase7_entrega4_bloqueos_de_cierre`

Una implementación, dos usos. Las condiciones 4 a 12 salieron de
`cerrar_orden_mantenimiento()` y pasaron a `app.bloqueos_de_cierre_mant()`, con
**los mismos textos de mensaje**. La función de cierre conserva 1 a 3 en línea
—existencia, permiso y cancelada, que deciden si la orden siquiera se puede
mirar— y llama a la compartida para el resto.

`precheck_cierre_mantenimiento()` llama a esa misma función. **No hay una
segunda copia de las doce condiciones.** Si mañana cambia una, cambia en un
solo lugar.

El permiso se verifica **antes** de devolver nada: un externo no aprende el
estado de una orden ajena preguntando por qué no puede cerrarla.

### `fase7_entrega4_fix_concat_bloqueos`

Un bug que introduje yo en la migración anterior y que encontró la suite:

```sql
select array['a']::text[] || 'b';
ERROR:  22P02: malformed array literal: "b"
```

`text[] || 'literal'` **no agrega un elemento**. Postgres elige entre
`anycompatiblearray || anycompatiblearray` y `anycompatiblearray ||
anycompatiblenonarray`, y con un literal sin tipo elige la primera: intenta
leer «Falta completar el diagnóstico» como un array y falla.

Las ramas que usaban `format()` funcionaban, porque `format()` devuelve `text`
declarado. Por eso el bug afectaba a **7 de las 12 condiciones** y no a las
otras dos. Cada mensaje lleva ahora su `::text`.

Se barrió el resto del esquema buscando el mismo patrón: no aparece en ninguna
otra función.

---

## F · La matriz de las doce condiciones

Las doce se prueban **de a una**: doce órdenes, a cada una le falta exactamente
una cosa. Una sola orden con doce errores simultáneos sólo probaría la primera.

| # | Condición | Backend | Mensaje en la interfaz | Test |
|---|---|---|---|---|
| 1 | La orden existe | `cerrar_orden_mantenimiento`, inline | «La orden no existe» | `C1 · una orden inexistente` |
| 2 | Permiso (admin o empleado) | `cerrar_orden_mantenimiento`, inline, **antes de todo** | «Sin permiso para cerrar órdenes en esta empresa» | `customer: cerrar`, `distributor: cerrar`, `anon: cerrar` |
| 3 | No está cancelada | `cerrar_orden_mantenimiento`, inline | «La orden N está cancelada» | `C3 · una orden cancelada` |
| 4 | Etapa = cierre | `bloqueos_de_cierre_mant` | «La orden está en la etapa «X»: se cierra desde «Cierre»» | `C4` + precheck |
| 5 | Diagnóstico completado | `bloqueos_de_cierre_mant` | «Falta completar el diagnóstico» | `C5` + precheck |
| 6 | Cotización resuelta | `bloqueos_de_cierre_mant` | «La cotización sigue pendiente: hay que aprobarla o rechazarla» | `C6` + precheck |
| 7 | Aprobada ⇒ con líneas | `bloqueos_de_cierre_mant` | «La cotización está aprobada y no tiene ninguna línea» | `C7` + precheck |
| 8 | Reparación completada o no requerida | `bloqueos_de_cierre_mant` | «Falta completar la reparación, o marcarla como no requerida» | `C8` + precheck |
| 9 | Torque completado o no requerido | `bloqueos_de_cierre_mant` | «Falta completar el torque, o marcarlo como no requerido» | `C9` + precheck |
| 10 | Torque requerido ⇒ ≥ 1 medición | `bloqueos_de_cierre_mant` | «El torque es requerido y no hay ninguna medición cargada» | `C10` + precheck |
| 11 | Fecha de entrega, y ≥ ingreso | `bloqueos_de_cierre_mant` + CHECK `chk_mo_fechas` | «Falta la fecha de entrega» / «La entrega no puede ser anterior al ingreso» | `C11`, `C11b` |
| 12 | Sin repuestos sin consumir | `bloqueos_de_cierre_mant` | «Quedan N repuesto(s) sin confirmar el consumo» | `C12` + precheck |

Dos aclaraciones honestas sobre cómo se probaron dos de ellas:

- **La 7** se alcanza por la vía legítima: aprobar la cotización —la RPC exige
  al menos una línea— y después **borrar esa línea**. No es un estado
  hipotético: lo alcanza un administrador con dos clics. El primer intento de
  esta prueba forzaba `quote_status = 'approved'` con la clave de servicio, y
  `validar_cotizacion_mant` lo rechazaba en silencio: la condición nunca se
  estaba probando y el test daba un falso «se permitió».
- **La 11b** (entrega anterior al ingreso) **no es alcanzable**: lo impide el
  CHECK `chk_mo_fechas` de la tabla, ni siquiera con la clave de servicio. La
  condición en la RPC es una segunda línea de defensa. Lo que la suite prueba
  es la defensa que actúa primero.

---

## G · El precheck de cierre

`precheck_cierre_mantenimiento(p_order)` devuelve, sin escribir nada:

```json
{"puede_cerrar": false,
 "bloqueos": ["La orden está en la etapa «diagnosis»: se cierra desde «Cierre»",
              "Falta completar el diagnóstico", "..."],
 "etapa": "diagnosis", "en_espera": false, "diagnosticada": false,
 "cotizacion": "pending", "lineas": 0,
 "requiere_reparacion": true, "reparada": false,
 "requiere_torque": true, "torque_hecho": false, "mediciones": 0,
 "repuestos_pendientes": 0, "repuestos_consumidos": 0, "entregada": null}
```

Devuelve **todos** los bloqueos de una vez, no el primero: al operario le sirve
saber las cuatro cosas que le faltan, no descubrirlas de a una.

Y no tiene efectos: la suite confirma que después de consultarlo la orden sigue
`open`.

---

## H · El circuito de etapas

Cada etapa se muestra con su situación explícita, y **el símbolo nunca va
solo**: lleva la palabra al lado, porque un tilde y un guion son
indistinguibles para quien no conoce la convención.

| Marca | Palabra |
|---|---|
| `✓` | completada |
| `○` | pendiente / en curso |
| `—` | **no requerida** |

Se avanza **de a una etapa**, salteando sólo las marcadas como no requeridas.
El botón ofrece exactamente la que `app.validar_etapa_mantenimiento()` va a
aceptar.

Se puede **volver atrás** a cualquier etapa anterior, con confirmación explícita
que dice adónde («Sí, volver a Diagnóstico»). Queda auditado como
`stage_reverted`. **No se borra ningún dato al retroceder**: una vuelta atrás es
un hecho del taller, no un error que haya que esconder.

**La espera es ortogonal**: `on_hold` pausa el trabajo sin moverlo de etapa. No
es una etapa. La ficha lo dice con todas las letras: «La etapa no cambió: la
espera es un estado aparte».

---

## I · Reparación

Se completó con los campos que ya tenía el esquema —`repair_notes`,
`repaired_at`, `labour_hours`— sin inventar ningún checklist nuevo.

Y la pantalla dice explícitamente lo que era fácil confundir:

> Dar la reparación por completada **no consume ningún repuesto**: lo que se usó
> y lo que se descuenta del depósito son dos cosas distintas, y el consumo se
> confirma en su propia pestaña.

La suite lo mide: agregar un repuesto **no** mueve stock; confirmar el consumo
**sí**; cerrar la orden **no vuelve a moverlo** (1 movimiento antes del cierre,
1 después).

---

## J · Repuestos sin consumir al cerrar

**No se inventó ninguna regla.** La que ya existía es la condición 12: un
repuesto cargado y sin consumir **bloquea el cierre**. No se descuenta solo, no
se descarta solo, no se cierra ignorándolo.

La pantalla de cierre lo muestra como un punto más del resumen, con su cuenta,
y el bloqueo dice exactamente cuántos son.

---

## K · Cerrada = congelada

Con la orden cerrada, la suite intentó editar las cinco cosas y las cinco
fueron rechazadas con `23001`:

- la cabecera de la orden
- una línea de cotización
- un repuesto
- **una medición**
- una revisión

No hay reapertura en esta entrega. Cerrar dos veces es idempotente
(`{"ya_estaba": true}`) y **no duplica el evento** `order_closed`.

Una orden **cancelada** se distingue visualmente de una cerrada y no se puede
cerrar (condición 3).

---

## L · Concurrencia

Dos sesiones autenticadas distintas cierran la misma orden **a la vez**
(`Promise.all`):

- exactamente **una** obtiene `ya_estaba: false`
- exactamente **un** evento `order_closed`
- la orden queda `closed`
- sin doble efecto

El `select … for update` de la RPC serializa las dos.

---

## M · UPDATE directo

Poner `status = 'closed'` con un UPDATE suelto se rechaza con `23001`, y la
orden **sigue abierta**. La única puerta es el marcador de transacción
`app.cerrando_orden_mant`, que sólo la RPC sabe poner.

---

## N · Multiempresa — la regresión de O1

Una medición con `company_id` = Buscatools apuntando a una orden de **otra
empresa**: rechazada. La orden ajena queda con **0 mediciones**.

La fila hija no se autoriza por su propio `company_id`: se autoriza por el de
su orden. Es la misma lección de O1 y de las RLS tautológicas.

Cerrar una orden de una empresa donde no se tiene rol: `42501`. Consultar su
precheck: `42501` también.

---

## O · RLS v1

Probada con **JWT reales**, no por inspección de policies:

| Identidad | Ve mediciones | Escribe | Cierra | Precheck |
|---|---|---|---|---|
| admin (Buscatools) | sí | sí | sí | sí |
| employee | sí | sí | sí | sí |
| salesperson (Torquetools) | 0 | **no** (`23514`) | no | no |
| customer | **0** | no (`42501`) | no (`42501`) | no (`42501`) |
| distributor | **0** | no (`42501`) | no (`42501`) | no (`42501`) |
| anon | **0** | — | no (`42501`) | no (`42501`) |

Los externos se probaron de tres formas, porque «no ve nada» es fácil de
aparentar: consulta sin filtro, consulta **por `measurement_id` exacto** y
consulta **por `maintenance_order_id` exacto**. Cero en las tres.

---

## P · Auditoría

Los eventos que ya escribía la entrega 1, verificados sobre datos reales:
`create`, `stage_changed`, `stage_reverted`, `stage_marked_not_required`,
`order_put_on_hold`, `order_resumed`, `quote_approved`, `quote_rejected`,
`part_added`, `part_removed`, `consumption_confirmed`, `order_closed`,
`order_cancelled`.

«No requerido» queda auditado también **al crear la orden**, no sólo al
desmarcarlo después.

---

## Q · Lo que se documenta y **no** se cambió

Tres comportamientos que la auditoría encontró y que no se tocaron, porque
cambiarlos habría sido inventar una regla que nadie pidió:

1. **`on_hold` no es una de las doce condiciones**: una orden en espera **se
   puede cerrar** hoy. La espera es ortogonal a la etapa y al cierre.
2. **Una cotización rechazada puede cerrarse.** Rechazada ≠ cancelada: el
   trabajo pudo hacerse igual sin presupuesto aprobado. La suite lo prueba
   como comportamiento esperado, no como bug.
3. **Una medición negativa se guarda pero queda fuera de las estadísticas**,
   por el filtro `target_value > 0` de `capacidad_torque()`.

---

## R · Tests

`scripts/fase7-mantenimiento-entrega4-tests.mjs` — prefijo `ZZ-M4`,
autolimpiante, **0 fallos**. Trece secciones:

1. El caso de regresión de la entrega 1, contra la función real
2. Casos borde (0 / 1 / todas iguales / en los límites / fuera de límites)
3. Validaciones de límites y mediciones (LCS<LCI, nominal fuera, NaN, Infinity)
4. Torque requerido y no requerido
5. **Las doce condiciones de cierre, de a una**
6. El precheck: la misma lógica, sin efectos
7. E2E **con** torque, repuesto y consumo, + congelado + idempotencia
8. E2E **sin** torque
9. Cotización rechazada
10. Concurrencia: dos cierres simultáneos
11. UPDATE directo
12. Multiempresa (regresión de O1)
13. RLS con las seis identidades

Unitarios: `indicadorDeCapacidad` (N/D vs 0 real, sufijo del CV) y
`etiquetaDeVeredicto` (los tres veredictos, y uno desconocido que se muestra
crudo en vez de desaparecer).

---

## S · Regresión completa

| Suite | Resultado |
|---|---|
| 24 suites de base de datos | **0 fallos** |
| `tsc --noEmit` (strict) | limpio |
| `eslint src scripts` | limpio |
| `vitest run` | 46 archivos, **533 tests** |
| `test:isolated` | 46 archivos, **533 tests** |
| `npm run build` | ✓ |

---

## T · Invariantes al terminar

Todo verificado con cuentas explícitas después de la limpieza:

| Invariante | Valor |
|---|---|
| Equipos de mantenimiento | 0 |
| Órdenes | 0 |
| Mediciones | 0 |
| Repuestos de orden | 0 |
| Líneas de cotización | 0 |
| Revisiones | 0 |
| Filas de auditoría | 0 |
| Puntos de revisión | **16** |
| Empresas | 2 |
| Clientes | 1010 |
| Movimientos de stock | **381** |
| Saldos de stock | **379** |
| Proveedores | 142 |
| Productos de Buscatools | **21.772** |

Las secuencias de `document_sequences` se restauraron a su valor previo.

---

## U · Errores míos en esta entrega

Dos, y los dos los encontró la propia suite antes que nadie:

1. **El `||` de arriba.** Escribí `v_out || 'literal'` en la migración de los
   bloqueos y rompía 7 de las 12 condiciones con `22P02`. En producción habría
   significado que intentar cerrar una orden a la que le falta el diagnóstico
   diera un error de sintaxis de array en vez del mensaje correcto.
2. **Dos setups de test que fallaban en silencio** (la condición 7 y la 11b).
   Los dos daban «SE PERMITIÓ» —un falso positivo de bug— cuando lo que pasaba
   era que mi propio setup era rechazado por un trigger y por un CHECK. Si no
   los hubiera investigado habría reportado dos agujeros que no existen.

---

## V · O4 — sigue abierto, sin tocar

`authenticated` todavía puede insertar en `stock_movements` manualmente.

**SECURITY PRIORITY — HIGH.** No se resolvió en esta entrega, tal como se pidió.

---

## W · Mobile y verificación en producción

*(Pendiente de medir. Se completa después del deploy, sobre la aplicación real
y con una sesión iniciada — no alcanza con que el chunk contenga el texto.)*

---

## X · Archivos

**Nuevos**

```
src/modules/mantenimiento/services/torque.ts
src/modules/mantenimiento/services/cierre.ts
src/modules/mantenimiento/hooks/useTorque.ts
src/modules/mantenimiento/hooks/useCierre.ts
src/modules/mantenimiento/components/PanelTorque.tsx
src/modules/mantenimiento/components/PanelCierre.tsx
scripts/fase7-mantenimiento-entrega4-auditoria.mjs
scripts/fase7-mantenimiento-entrega4-tests.mjs
```

**Modificados**

```
src/modules/mantenimiento/types/index.ts
src/modules/mantenimiento/lib/estados.ts        (+ etiquetaDeVeredicto)
src/modules/mantenimiento/lib/formato.ts        (+ indicadorDeCapacidad)
src/modules/mantenimiento/services/ordenes.ts
src/modules/mantenimiento/components/ChipEstado.tsx     (+ ChipVeredicto)
src/modules/mantenimiento/components/PanelEtapas.tsx
src/modules/mantenimiento/components/PanelCotizacion.module.css
src/modules/mantenimiento/pages/OrdenDetallePage.tsx
src/types/database.types.ts
docs/database/PHASE_7_MAINTENANCE.sql
```

---

## Y · Estado

*(Pendiente hasta completar W.)*
