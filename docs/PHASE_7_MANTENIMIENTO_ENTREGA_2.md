# Fase 7 · Mantenimiento — Entrega 2: activos, órdenes y configuración base

Estado: **ENTREGADA**. Equipos, órdenes de servicio y puntos de revisión, con
UI React, RLS probada con JWT real para las seis identidades y revisión mobile
medida en el navegador.

**Fuera de alcance y no empezado**: consumo real de repuestos, stock, torque
operativo completo, cierre final y WhatsApp.

| | |
|---|---|
| Migración nueva | `fase7_auditar_espera_orden_mantenimiento` — una sola |
| SQL canónico | [`docs/database/PHASE_7_MAINTENANCE.sql`](database/PHASE_7_MAINTENANCE.sql) |
| Suite de base | [`scripts/fase7-mantenimiento-entrega2-tests.mjs`](../scripts/fase7-mantenimiento-entrega2-tests.mjs) |
| Fixtures de revisión | [`scripts/fase7-mantenimiento-entrega2-fixtures.mjs`](../scripts/fase7-mantenimiento-entrega2-fixtures.mjs) |

---

## A · Qué se construyó

| | ruta | qué hace |
|---|---|---|
| Equipos | `#/mantenimiento/activos` | listado con filtros, orden y paginado del servidor |
| | `#/mantenimiento/activos/nuevo` | alta |
| | `#/mantenimiento/activos/:id` | ficha con tres pestañas: datos, órdenes, historial |
| Órdenes | `#/mantenimiento/ordenes` | listado con filtros, orden y paginado del servidor |
| | `#/mantenimiento/ordenes/nueva` | alta, con `?eq=<uuid>` para venir desde un equipo |
| | `#/mantenimiento/ordenes/:id` | ficha con tres pestañas: trabajo, ingreso, historial |
| Configuración | `#/mantenimiento/puntos` | ABM de puntos de revisión |

`#/mantenimiento` redirige a los equipos. Igual que Ventas y Compras, la
sección sola no tiene pantalla propia: un tablero de Mantenimiento sería una
idea nueva y esto es una migración.

En el menú entran dos ítems —**Equipos** y **Órdenes de servicio**— filtrados
por rol. Se quitó «Mantenimiento» de la lista de *Próximamente*.

## B · La única migración nueva

`fase7_auditar_espera_orden_mantenimiento`. **No toca el schema**: sólo
reescribe `app.auditar_orden_mantenimiento()` para agregar dos acciones.

`on_hold` es un eje ortogonal a la etapa —pausa el trabajo sin moverlo— y la
entrega 1 lo dejó sin auditar. Con la UI de esta entrega pasa a ser algo que
una persona hace con un botón, y *«¿por qué estuvo parada tres semanas?»* no se
contesta con un booleano.

| acción nueva | `from_status` → `to_status` |
|---|---|
| `order_put_on_hold` | la **etapa** en la que quedó parada |
| `order_resumed` | la misma etapa |

Van en el mismo trigger que el resto para que el orden temporal de los eventos
siga siendo uno solo. El resto de la función quedó idéntica.

## C · Las decisiones que se ven en pantalla

### El serial avisa, no bloquea

El formulario busca duplicados mientras se escribe —`duplicados_de_serial()`,
debounceada a 400 ms— y muestra **cuáles son**, con enlace a cada uno y su
fecha de alta. Después deja guardar igual.

El sistema anterior nunca garantizó el serial: no es obligatorio y no es
único. Convertirlo en regla ahora inventaría una que no existía y dejaría
afuera equipos reales. Se registra la ambigüedad, como `needs_review` en
proveedores.

La normalización la hace la base: `fein 88231 a` y `FEIN-88231-A` son el mismo
serial y el aviso los encuentra a los dos. **Probado**, incluido que no cruza
empresas.

### El dueño cambia; la historia no

`maintenance_assets.owner_customer_id` es el dueño **actual**. Cambiarlo:

* escribe `owner_changed` en la auditoría, con el de dónde y el a dónde;
* **no toca ni una orden**.

`maintenance_orders.customer_id` es un snapshot congelado por trigger. Se
probó de las dos maneras: un `UPDATE` directo del cliente de la orden **no
cambia nada** (y además devuelve `23001`), y cambiar el dueño del equipo deja
la orden histórica diciendo el cliente original.

La ficha del equipo lo dice con todas las letras en vez de dejarlo implícito.

### El cliente de la orden es obligatorio, el del equipo no

Un equipo puede entrar al taller antes de saber de quién es: `owner_customer_id`
es nullable por decisión de la entrega 1. Una orden **no**: sin cliente no se
puede facturar ni entregar, y `customer_id` es `not null`.

El alta precarga el cliente del dueño actual del equipo y avisa que a partir de
ahí queda congelado. Si el equipo no tiene dueño, el campo queda vacío y hay que
elegirlo: **no se inventa un cliente**.

### Las etapas: de a una, y «no requerida» no es «pendiente»

El panel ofrece exactamente la etapa que
`app.validar_etapa_mantenimiento()` va a aceptar, y para atrás un desplegable
con las anteriores de la secuencia. Lo que manda es el servidor: si igual se
colara un salto, lo rechaza.

Las tres situaciones de una etapa salteable se distinguen visualmente:

| | |
|---|---|
| **Pendiente** | requerida y sin fecha |
| **Completada** | requerida y con fecha |
| **No requerida** | marcada como no requerida |

Confundir las dos últimas era justo lo que había que evitar. El CHECK del
schema garantiza que «no requerida y completada» no existe.

### Los puntos de revisión son configurables, no están en el código

Los ocho que vienen sembrados —`carcasa`, `tornillos`, `conectores`,
`reversa`, `software`, `embrague`, `cabezal`, `rotor`— salen de `MANT_PARTS`
(`app.js:28804`) y **aparecen con datos en las tres fichas reales** del
histórico del legacy (`diagnosticoPartes: {rotor:"NOK", cabezal:"NOK", …}`).
No son placeholders.

Pero son de un atornillador FEIN, y el esquema es multiempresa desde el primer
día. Por eso están en una tabla con ABM y no en un CHECK: si otra empresa
revisa otra cosa, se configura y no hace falta una migración.

Borrar un punto ya usado lo impide la FK —dejaría revisiones apuntando a la
nada— y la pantalla lo explica y ofrece «Desactivar» en su lugar.

### Las revisiones son filas, no un blob JSON

`maintenance_order_checks` guarda una fila por `(orden, punto, fase)`. El
legacy metía `diagnosticoPartes: {...}` dentro de la ficha, así que no se podía
preguntar cuántos rotores fallaron este mes sin abrir cada orden una por una.

Dos fases: **al diagnosticar** y **al reparar**. La segunda sólo aparece si la
orden requiere reparación. Volver a tocar la opción elegida desmarca: «no
revisado» tiene que poder volver a ser el estado, y no es lo mismo que «N/A».

### Nada trae datasets completos al navegador

| selector | cómo |
|---|---|
| Producto | `search_products`, 20 filas, debounce 300 ms — **no** los 21.772 |
| Cliente | `ilike` con `limit(20)` — **no** los 1.010 |
| Equipo | `ilike` con `limit(20)`, y muestra el dueño al lado |

El selector de producto **no muestra ningún precio**: acá el producto sirve
para decir qué herramienta es, no cuánto vale.

## D · Permisos

`permisosDe()` habilita **admin y employee**, y nadie más. Es el mismo conjunto
que `app.current_maintenance_company_ids()`.

Ocultar el enlace del menú y devolver una pantalla con un aviso es una
cortesía. **Lo que protege los datos es RLS**, y eso es lo que se probó.

`technician` existe en el CHECK de `company_memberships` pero tiene cero
miembros y no entró en el helper. Cuando exista alguien con ese rol y un flujo
real, hay que tocar el helper de la base **además** del archivo de permisos.

## E · RLS · las seis identidades con JWT real

No alcanzaba con contar filas: cada prohibición se probó con **un intento real
midiendo el efecto**, porque con PostgREST una operación prohibida puede
devolver «éxito» con cero filas.

| identidad | cómo se obtuvo el JWT | lee | escribe |
|---|---|---|---|
| **admin** | `buscatools.jano@gmail.com` en Buscatools | sí | sí |
| **employee** | mismo usuario, membresía `employee` en una empresa de prueba | sí | **sí** |
| **salesperson** | mismo usuario, es vendedor en Torquetools | **0 filas** | **rechazado** |
| **technician** | mismo usuario, membresía `technician` en una empresa de prueba | **0 filas** | **rechazado** |
| **customer** | `cliente.test@buscatools.com.ar` | **0 filas** | **rechazado** |
| **distributor** | `distribuidor.test@buscatools.com.ar` | **0 filas** | **rechazado** |
| **anónimo** | sin sesión | **0 filas** | **rechazado** |

Para `employee` y `technician` no existen usuarios de prueba, así que se le
dieron esos roles al mismo usuario en **dos empresas de prueba creadas y
borradas por la suite**. El helper de RLS lee `company_memberships`, no el JWT,
así que su sesión ya valía. Es la prueba más limpia de que **manda el rol y no
el usuario**: la misma persona es admin en una empresa, employee en otra,
vendedor en una tercera y técnico en una cuarta, y ve cosas distintas en cada
una.

Además de contar filas se probó **por id exacto y por serial exacto**, y que
`duplicados_de_serial()` no le devuelve nada a nadie de afuera.

## F · Los tests

### Base de datos — `fase7-mantenimiento-entrega2-tests.mjs`

Los quince casos pedidos, con las mismas llamadas que hace el navegador:

| # | caso | resultado |
|---|---|---|
| 1 | alta de equipo con cliente y producto | **PASS** — `EQ00001`, serial normalizado por el servidor |
| 2 | equipo sin serial | **PASS** — queda `null`, no en blanco |
| 3 | equipo sin dueño | **PASS** |
| 4 | serial duplicado advertido | **PASS** — entra igual; la RPC encuentra los dos, excluye el propio, normaliza y no cruza empresas |
| 5 | alta de orden exige cliente | **PASS** — `23502`, y 0 filas sin cliente |
| 6 | transición inicial válida | **PASS** — nace `open` / `diagnosis` / sin espera |
| 7 | cliente de la orden congelado | **PASS** — el `UPDATE` no cambia nada y devuelve `23001` |
| 8 | cambiar el dueño no cambia la orden histórica | **PASS** — y queda auditado con `de` y `a` |
| 9 | salto de etapa inválido rechazado | **PASS** — y la etapa no se movió |
| 9b | avance de a una, vuelta atrás, salteo de no requeridas | **PASS** — `stage_changed` y `stage_reverted` auditados |
| 10 | espera | **PASS** — no mueve la etapa; `order_put_on_hold` y `order_resumed` auditados |
| 11 | check points CRUD | **PASS** — los 8 sembrados, alta, clave repetida rechazada, edición, desactivación |
| 12 | order checks | **PASS** — upsert corrige sin duplicar, dos fases conviven, fase y resultado inventados rechazados, punto usado no se borra |
| 13 | baja lógica | **PASS** — la fila sigue existiendo; se reactiva |
| 14 | los listados de la pantalla | **PASS** — una consulta, total exacto del servidor |
| 15 | RLS, seis identidades | **PASS** — ver la tabla de arriba |
| 16 | rendimiento | **PASS** — ver abajo |

**0 fallos.**

#### Rendimiento

Se mide el **régimen, no el arranque en frío**: la primera llamada paga el
plan y la conexión —`search_products` midió **2.611 ms en frío** contra ~500 ms
estables— y ese número no dice nada sobre si la consulta está bien escrita. La
suite descarta una corrida de calentamiento y cronometra la siguiente.

| consulta | medido | tope |
|---|---|---|
| listado de equipos, página de 25 | **204 ms** | 1.500 |
| búsqueda de productos (no trae los 21.772) | **487 ms** | 2.000 |
| búsqueda de clientes (no trae los 1.010) | **176 ms** | 1.500 |

### Unitarios

| archivo | qué prueba |
|---|---|
| `lib/estados.test.ts` | las cinco etapas, el salteo, el ida y vuelta, las tres situaciones, la editabilidad |
| `lib/validacion.test.ts` | que **nada** sea obligatorio en el equipo y que sí lo sea en la orden |
| `lib/permisos.test.ts` | admin y employee sí; los otros cuatro roles y «sin membresía», no |
| `lib/formato.test.ts` | importes con moneda, fechas, las acciones de auditoría, el nombre del equipo |
| `hooks/useFiltrosActivos.test.ts` | la URL, con ida y vuelta |
| `hooks/useFiltrosOrdenes.test.ts` | ídem, y que los tres ejes de estado se lean por separado |

## G · Mobile

Revisión **real en el navegador**, con sesión iniciada y datos de verdad
(4 equipos y 3 órdenes de fixtures), midiendo el DOM. No por inspección de CSS.

| ancho | scroll horizontal global | elementos < 44 px | campos < 16 px | layout |
|---|---|---|---|---|
| **390** | **no** | **0** | **0** | tarjetas |
| **430** | **no** | **0** | **0** | tarjetas |
| **767** | **no** | 0 en controles | **0** | tabla, controles a 44 px / 16 px |
| **768** | **no** | enlaces de tabla a 18 px | selects de filtro a 14 px | tabla, densidad de escritorio |
| **1440** | **no** | — | — | tabla |

Las siete pantallas: equipos, equipo nuevo, ficha de equipo, órdenes, orden
nueva, ficha de orden y puntos de revisión.

**Sobre los 768.** El corte de layout es `max-width: 767px` y el de densidad
táctil es `(max-width: 767px), (pointer: coarse)`. Un iPad en vertical mide
768 **y es táctil**, así que entra por la segunda condición y recibe los 44 px
y los 16 px; se comprobó midiendo a 767, donde el emulador reporta puntero
grueso: los cinco selects dieron **44 px @ 16 px**. A 768 con puntero fino
—una ventana de laptop angosta— queda la densidad de escritorio, que es lo
correcto y lo mismo que hacen Ventas, Clientes y Compras.

La tabla de puntos de revisión mide 506 px dentro de un contenedor de 357 px
y **scrollea dentro de su propia caja** (`overflow-x: auto`). El documento no
scrollea en ningún ancho.

### Cuatro cosas que encontró la revisión y se corrigieron

1. **La ficha mostraba etiqueta y valor pegados en la misma línea** —
   «NÚMERO DE SERIEFEIN-88231-A»—. Estaba armada con dos `<span>`, que son
   inline. Pasó a `<dl>` / `<dt>` / `<dd>`, que es lo que esto es, anulando el
   `margin-inline-start: 40px` que el navegador le pone al `dd`.
2. **El chip del presupuesto decía sólo «Pendiente»**, al lado de un chip de
   etapa que puede decir «Cotización». Ahora dice «Presupuesto: Pendiente».
3. **Los enlaces del subtítulo y de los datos medían 18 px de alto.** Son la
   navegación principal de la ficha —al equipo, al cliente—, no una nota al
   pie. Con puntero grueso pasan a 44 px.
4. **`.primario` y `.secundario` se usan también en enlaces** («+ Nueva
   orden», «Equipos») y un `<a>` no centra su texto en los 44 px de alto ni
   pierde el subrayado solo.

Y una en el historial, encontrada en la misma pasada: la puesta en espera
mostraba «Cotización → Cotización» —guarda la misma etapa en los dos extremos,
porque es donde quedó parada—; ahora dice «en Cotización». Y el alta de la
orden mostraba «— → open» en vez de «— → Abierta».

### Una cosa que NO se tocó

El selector de empresa del encabezado (`EmpresaSelector`) tiene `font-size:
14px`. En iOS eso hace zoom al enfocar. Es **anterior a esta entrega**, vive en
el shell de la aplicación y afecta a todos los módulos por igual, así que
corregirlo sería una pasada de rediseño sobre secciones ya cerradas. Queda
anotado para que decidas.

## H · Invariantes

Medidos después de limpiar las fixtures de revisión:

| | esperado | medido |
|---|---|---|
| equipos · órdenes · checks | 0 / 0 / 0 | **0 / 0 / 0** |
| cotizaciones · repuestos · mediciones de mantenimiento | 0 / 0 / 0 | **0 / 0 / 0** |
| auditoría de mantenimiento | 0 | **0** |
| puntos de revisión (8 × 2 empresas) | 16 | **16** |
| empresas | 2 | **2** |
| clientes · proveedores | 1010 / 142 | **1010 / 142** |
| auditoría de compras | 0 | **0** |
| stock_movements · stock_balances | 381 / 379 | **381 / 379** |
| delivery_lines · quote_lines · order_lines | 600 / 992 / 593 | **600 / 992 / 593** |
| product_images | 8859 | **8859** |
| **productos Buscatools** | **21.772** | **21.772** |

Las cuatro secuencias de mantenimiento volvieron a `next_number = 1`.

**0 filas productivas de mantenimiento al terminar.**

## I · Regresión

| | |
|---|---|
| Suites de base | **20 / 20**, 0 FAIL |
| Unitarios | **507 / 507**, 46 archivos (los mismos con `test:isolated`) |
| `tsc --noEmit` | limpio |
| `eslint` | limpio |
| `npm run build` | ✓ |

Las 20 suites cubren Ventas, Clientes, Catálogo, Compras, Mantenimiento y los
dos fixes de RLS.

El advisor de seguridad **no reporta nada nuevo**. Lo que informa es todo
anterior a esta entrega: `document_sequences` con RLS y sin policies, la vista
`product_availability`, y las once funciones `SECURITY DEFINER` ejecutables por
`authenticated` —que son las puertas de transacción y verifican permisos
adentro—.

## J · Lo que NO se hizo

Sigue **sin empezar**, tal como se pidió:

| | |
|---|---|
| Consumo real de repuestos | el esquema y la RPC existen desde la entrega 1; **la pantalla no los ofrece** |
| Movimiento de stock por servicio | ídem |
| Torque operativo completo | `maintenance_measurements` y `capacidad_torque()` existen; sin UI |
| Cotización de mantenimiento | `maintenance_quote_lines` existe; sin UI. Por eso el listado **no tiene columna de total**: hoy serían todos ceros |
| Cierre final de la orden | `cerrar_orden_mantenimiento()` existe; el panel dice que está en la última etapa y que el cierre es de la entrega siguiente |
| WhatsApp | no se tocó |

La ficha de la orden lo dice en pantalla, en un bloque propio: poner botones
que todavía no hacen lo que dicen sería peor que no tenerlos.

## K · Deuda y riesgos conocidos

* **`document_sequences` tiene RLS sin policies** (INFO del advisor). Es
  anterior a esta entrega: se escribe sólo desde `next_document_number()`, que
  es `SECURITY DEFINER`. No se tocó acá.
* **Las 11 funciones `SECURITY DEFINER` ejecutables por `authenticated`** que
  marca el advisor son intencionales: son las puertas de transacción, y cada
  una verifica permisos adentro. Cinco son de Mantenimiento y ya se revisaron
  en la entrega 1.
* El panel de etapas **no ofrece** cerrar la orden cuando llega a la última:
  es correcto para esta entrega, pero deja la orden «abierta y en cierre» hasta
  que llegue la entrega 3.
