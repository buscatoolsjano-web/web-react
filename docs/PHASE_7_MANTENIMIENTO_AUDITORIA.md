# Fase 7 · Mantenimiento — Auditoría (entrega 0)

**Sólo auditoría.** No se programó UI, no se creó ninguna tabla, no se ejecutó
ninguna migración y no se modificó ni un dato. Todo lo de acá salió de leer
código como texto y de consultas de sólo lectura.

Baseline: `1f4a69f` (Compras cerrado).

| fuente | qué se hizo |
|---|---|
| `app.js` (5.288.337 bytes, 45.345 líneas) | leído como texto, sin ejecutar el ERP |
| `BuscatoolsERP.html` (4.313.780 bytes) | leído como texto |
| Supabase **legacy** `hnyngsejohkmlaccpkux` | `SELECT` de sólo lectura |
| Supabase **nuevo** `uaxcfufvapzulqvynanp` | `SELECT` de sólo lectura |
| React actual | lectura del repo |

---

## Resumen en una línea

Mantenimiento **existe de verdad y es grande** —60 funciones, 13 pantallas, un
circuito de 5 pasos— pero **está prácticamente sin usar**: en producción hay
**1 activo de prueba, 0 fichas abiertas y 3 fichas cerradas**, todas del mismo
equipo, el mismo cliente y el mismo técnico.

Es exactamente lo contrario de lo que pasó con Compras: allá había datos reales
(142 proveedores) y funciones a medias; acá hay funcionalidad completa y datos
de prueba.

---

## A · Pantallas

El menú tiene **13 entradas** (`app.js:218`) y `renderMantenimientos()`
(`app.js:31025`) despacha **14 vistas**: las 13 más `incidencias`, que no está
en el menú.

| # | pantalla | función | origen de datos | estado |
|---|---|---|---|---|
| 1 | Dashboard | `_mantDashboard` | `mant_activos` + `mant_fichas` | **REAL** |
| 2 | Nueva Ficha | `_mantNuevaFichaSelector` | `mant_activos` | **REAL** |
| 3 | Clientes | `_mantClientesView` | `mant_clientes` | **REAL**, sin datos |
| 4 | Activos | `_mantActivosView` | `mant_activos` | **REAL** |
| 5 | Cotiz. por Lotes | `_mantLotesView` | `mant_lotes` | **REAL**, sin datos |
| 6 | Usuarios | `_mantUsuariosView` | `mant_usuarios` | **PARCIAL** — ver T‑7 |
| 7 | Marcas / Modelos | `_mantMarcasView` | `mant_marcas` + catálogo | **REAL**, sin datos |
| 8 | Fichas pausadas | `_mantPausadasView` | `mant_fichas` (pausada) | **REAL**, sin datos |
| 9 | Histórico | `_mantHistoricoView` | `mant_historico` | **REAL** |
| 10 | Exportar | `_mantExportarView` | todas | **REAL** |
| 11 | Repuestos | `_mantRepuestosView` | `mant_repuestos` | **REAL**, sin datos |
| 12 | Modelos | `_mantModelosView` | catálogo + `mant_modelos_custom` | **REAL** |
| 13 | Manuales / PDF | `_mantManualesView` | `mant_manuales` | **REAL**, sin datos |
| — | Ficha (5 pasos) | `_mantFichaLayout` | `mant_fichas` | **REAL** |
| — | Incidencias | `_mantIncidenciasView` | `erp_incidencias` | **AJENO** — ver T‑8 |

## B · Entidades

Nueve colecciones propias, todas arrays JSON en `localStorage`:

| entidad | clave | id | forma |
|---|---|---|---|
| Activo (equipo) | `mant_activos` | `ACT00001` | id, identificador, marca, modelo, tipo, **serie**, clienteNombre, ciudad, provincia, garantiaInicio/Fin, serviciosCount, ultimoServicio, `productoSku` (sólo por un camino) |
| Ficha (orden de servicio) | `mant_fichas` | `SVC-<epoch>` | ~35 campos, ver **J** |
| Histórico | `mant_historico` | igual | la ficha entera + `closedAt` |
| Cliente de mant. | `mant_clientes` | `CLI001` | nombre, ciudad, contacto, email, tel, **`clienteRef`** |
| Marca/modelos | `mant_marcas` | id de marca | nombre, modelos[] |
| Repuesto | `mant_repuestos` | `REP001` | codigo, descripcion, marca, **stock**, precio |
| Lote | `mant_lotes` | — | estado, items[] de activos |
| Manual | `mant_manuales` | `MAN<epoch>` | titulo, tipo, modelos, **url**, desc |
| Usuario de mant. | `mant_usuarios` | `USR<epoch>` | nombre, rol, activo |

## C · Datos reales — medidos, no estimados

Leídos de `erp_store` en el Supabase legacy, que es adonde el ERP sincroniza:

| clave | bytes | tipo | registros | última sync |
|---|---|---|---|---|
| `mant_activos` | 306 | array | **1** | 2026‑09‑09 |
| `mant_fichas` | 5 | array | **0** | 2026‑09‑09 |
| `mant_historico` | 1.283 | array | **3** | 2026‑09‑04 |
| `mant_marcas` | 5 | array | **0** | 2026‑09‑02 |
| `mant_clientes` | — | — | **sin fila** | nunca |
| `mant_repuestos` | — | — | **sin fila** | nunca |
| `mant_lotes` | — | — | **sin fila** | nunca |
| `mant_manuales` | — | — | **sin fila** | nunca |

**El activo único es de prueba:**

```
ACT00001 · identificador "Prueba" · FEIN AccuTec ASM18-3-PC
serie "123456" · cliente "TORQUEAR SA" · ciudad "" · serviciosCount 5
```

**Las 3 fichas del histórico:** todas del mismo `ACT00001`, técnico `ADMIN`,
cliente `TORQUEAR SA`, `CORRECTIVO` / `FALLA DE CORTE`, cotizaciones
`COT-2026-002`, `-003`, `-004` por 50, 0 y 0 USD. Descripciones vacías,
observaciones casi vacías, **las 30 mediciones de torque vacías**, y
`condicionVisual` guardado literalmente como `"— seleccionar —"`, o sea el
texto del placeholder.

> **Salvedad honesta:** `erp_store` refleja lo último sincronizado. Las cuatro
> claves sin fila no se pueden distinguir con certeza entre «nunca se usó» y
> «se usó y nunca sincronizó». Como la sincronización dispara al guardar, lo
> primero es lo casi seguro — pero se confirma con el backup del navegador (**W‑1**).

## D · Claves de storage

| clave | sincroniza | uso |
|---|---|---|
| `mant_activos` | sí | 1 registro |
| `mant_fichas` | sí | 0 |
| `mant_historico` | sí | 3 |
| `mant_clientes` | sí | vacío |
| `mant_marcas` | sí | vacío |
| `mant_repuestos` | sí | vacío |
| `mant_lotes` | sí | vacío |
| `mant_manuales` | sí | vacío |
| `mant_usuarios` | **no** | local a un navegador |
| `mant_modelos` | **no** | derivado del catálogo |
| `mant_modelos_custom` | **no** | local a un navegador |
| `mant_ntf_<algo>` | **no** | marcas de notificación leída |

**Ninguna clave lleva empresa.** El resto del ERP usa `_ekey('erp_proveedores')`
para separar Buscatools de Torquetools; las de Mantenimiento son planas. Todo
el módulo es de una sola empresa de hecho. → **punto 23 respondido: no distingue empresa.**

## E · Supabase legacy

Existe y es el proyecto `hnyngsejohkmlaccpkux` («Buscatools», creado
2026‑07‑14), con **68 tablas**. **Ninguna es de mantenimiento.**

Lo que hay es `erp_store`, una tabla clave‑valor de tres columnas
(`key text`, `value jsonb`, `updated_at`) donde el ERP vuelca `localStorage`
entero. `SUPA_SYNC_KEYS` incluye 8 de las 12 claves de Mantenimiento.

- **Mecanismo:** `setInterval(_supaPoll, 30000)` — **polling cada 30 segundos**.
- **RLS:** hay una política sobre `erp_store` que exige una cabecera propia
  (`app.js:1180`); con la anon key sola no entra.
- **Duplicación:** total. El mismo array vive en `localStorage` y en `erp_store`,
  y gana el último que escribe.
- **Triggers:** ninguno relacionado con mantenimiento.

**El módulo de Mantenimiento no habla con Supabase directamente**: cero
referencias a `supabase`, `fetch` o `sync` en sus 3.200 líneas. Sube por el
mecanismo genérico, no por código propio.

## F · Clientes

El activo guarda **`clienteNombre`, texto libre**. No guarda id.

Existe una cadena de vínculo posible, pero **de dos saltos y opcional**:

```
activo.clienteNombre  (texto)
   → mant_clientes.nombre        (coincidencia por string)
      → mant_clientes.clienteRef (autocompletado manual, opcional)
         → CLIENTES.ref = CLI00001
            → customers.legacy_ref  (base nueva)
```

Con los datos de hoy la cadena **no existe**: `mant_clientes` está vacío.

**Medición del match directo por nombre:** el único valor, `TORQUEAR SA`,
coincide **exactamente y de forma única** con `CLI01072 · TORQUEAR SA` de los
1010 clientes. Pero el nombre está cerca de otros dos —`Torquear Taller`
(CLI00534) y `The Torque Team` (CLI00567)—, así que la técnica funciona acá por
suerte, no por diseño.

> **1 de 1 (100 %) matcheable, con n = 1.** No es una estadística.

### Bug: el filtro por cliente está muerto

`a.clienteId` se **lee en 5 lugares** (dashboard, nueva ficha, activos) y
**nunca se escribe en ninguno**. El selector «filtrar por cliente» de esas tres
pantallas se construye recorriendo `activos` y quedándose con los que tienen
`clienteId` → **siempre sale vacío**, y el filtro `a.clienteId===fCliente`
nunca matchea. Es código muerto con cara de función.

## G · Equipos / productos

Hay **dos caminos de alta con calidad distinta**:

| | `_mantModalActivo` (menú) | `_abrirAgregarActivoDesdeProducto` (ficha de producto) |
|---|---|---|
| serie | opcional | **obligatoria** |
| `productoSku` | **no lo guarda** | **sí** |
| marca/modelo | de una lista o texto libre | del producto |
| `sujetoMant` | no | sí |

El modelo se elige de una lista derivada **en vivo del catálogo**
(`_mantCatalogModelos`, categoría «atornillador») más marcas manuales.

**Medición del match contra los 21.775 productos:** el único modelo,
`ASM18-3-PC`, es **ambiguo**: coinciden `FE.ASM18-3` y `FE.MAQ.71127760000`
(«ASM18-3PC»). → **NECESITA REVIEW**, no inequívoco.

Dato relevante: el catálogo **ya tiene los repuestos FEIN** (`FE.REP.*`, p. ej.
`FE.REP.31912098020 CARCASA PISTOLA ASM18-XX`). Ver **K**.

## H · Seriales

| pregunta | respuesta |
|---|---|
| ¿existe? | sí, `activo.serie` |
| ¿obligatorio? | **no** por el alta del menú; **sí** por el alta desde producto |
| ¿único? | **no**. Ninguna validación de duplicados en ningún camino |
| ¿una máquina aparece varias veces? | no se puede saber con n = 1, pero nada lo impide |
| ¿historial por serial? | **no**: el historial es por `activoId`, no por serie |
| ¿texto libre? | sí — el único valor es `"123456"`, placeholder `"ej. 2023 04 017552"` |

**El sistema objetivo necesita trazabilidad por serie y el legacy no la tiene.**
La tiene por *activo*, que es otra cosa: si el mismo equipo se carga dos veces,
son dos activos con dos historiales.

En la base nueva ya existe `delivery_serials` (10 columnas, con
`serial_number`, `product_id`, `customer_id`, `delivery_date`) — **creada en una
fase anterior y con 0 filas**. Ver **R**.

## I · Estados

No hay una máquina de estados. Hay **cuatro campos de estado independientes**:

| campo | valores | dónde |
|---|---|---|
| `lastStep` | `diagnostico` · `cotizacion` · `reparacion` · `torque` · `cierre` | avance de la ficha |
| `estadoCotizacion` | `PENDIENTE` · `APROBADA` · `RECHAZADA` | paso 2 |
| `estadoFinal` | `APROBADA` (default) · lo que tenga el select | paso 5 |
| `pausada` | booleano + `pausadaAt` | fichas pausadas |

Más los catálogos cerrados:

- `tipoServicio`: `CORRECTIVO` · `PREVENTIVO` · `REVISIÓN GENERAL`
- `motivoIngreso`: `FALLA DE CORTE` · `FALLA ELECTRICA` · `GOLPE/CAIDA` ·
  `ACTUALIZACIÓN FIRMWARE` · `MANTENIMIENTO PREVENTIVO` · `REVISIÓN GENERAL` ·
  `CALIBRACIÓN TORQUE` · `OTRO`
- partes (×8): `OK` · `NOK` · `N/A`
- lotes: `PENDIENTE` · `APROBADA` · `RECHAZADA` · `EN_REVISION`

**Transiciones observables en los datos:** las 3 fichas están en `lastStep:
cierre` y `estadoFinal: APROBADA`; dos con `estadoCotizacion: PENDIENTE` y una
`APROBADA`. O sea **se cerraron dos fichas con la cotización sin aprobar**: el
cierre no valida nada.

## J · El circuito real

```
Activo existente ──► «Abrir ficha»
        │
        └─► si ya hay una ficha abierta para ese activo, la reabre
            si no, crea SVC-<epoch> con tipoServicio CORRECTIVO

  1 DIAGNÓSTICO   fecha ingreso, técnico, motivo, condición visual,
                  8 partes OK/NOK/N/A "como llegó", observaciones
  2 COTIZACIÓN    nro (COT-<año>-<n>), moneda USD/ARS/EUR, contacto,
                  ítems libres {desc, tipo, cant, pu}, estado, aprobación
  3 REPARACIÓN    fecha, técnico, trabajos, piezas pendientes,
                  8 partes OK/NOK/N/A "después"
  4 TORQUE        10 filas {min, max, target} + nominal, LCI, LCS
  5 CIERRE        eficiencia, próximo preventivo, estado final,
                  fecha entrega, observaciones finales
        │
        └─► CERRAR: la ficha se MUEVE de mant_fichas a mant_historico
                    y el activo actualiza ultimoServicio
```

Los pasos se pueden saltear hacia atrás pero no hacia adelante (los futuros se
ven bloqueados). **Ninguna validación impide cerrar con pasos vacíos** — los
datos lo demuestran.

Hay además un botón **CANCELAR** siempre visible y una función de **pausar**.

## K · Repuestos y stock

**El legacy no toca el stock. En ningún lado.** Verificado por búsqueda en las
3.200 líneas del módulo: ni `stock_movements`, ni descuento, ni reserva, ni
devolución. La única aparición de «stock» es un campo propio.

Lo que hay son **dos cosas separadas y ambas débiles**:

1. **`mant_repuestos`**: un mini‑catálogo propio con `codigo`, `descripcion`,
   `marca`, **`stock`** (un número que se escribe a mano y nadie mueve) y
   `precio`. Id `REP001` por **MAX+1**. **Está vacío.**
2. **Los ítems de la cotización**: texto libre con un `tipo` que puede ser
   `REPUESTO`. **No apuntan a `mant_repuestos` ni al catálogo.** Escribís la
   descripción a mano.

O sea: consumir un repuesto en una reparación **no descuenta nada, en ninguna
parte**, y el repuesto ni siquiera queda identificado.

Y como se vio en **G**, el catálogo real ya tiene los repuestos FEIN con SKU.

## L · Técnicos y mano de obra

- **Técnico**: `ficha.tecnico` y `ficha.tecnicoReparacion`, elegidos de una
  **lista hardcodeada**: `['JANO','NORBERTO','FACUNDO','JUAN','BRIAN','ADMIN']`.
  Es un string, no una referencia. Coincide con `TEAM_USERS` (`app.js:1694`).
- **`mant_usuarios`** es un maestro aparte (nombre, rol, activo, contraseña) que
  **no alimenta ese selector** — el selector usa la lista hardcodeada. Está vacío
  y no sincroniza. → **PARCIAL / código muerto en la práctica.**
- **Mano de obra**: existe sólo como un `tipo` de ítem de cotización
  (`MANO DE OBRA`) con `cant` y `pu`. No hay horas, ni tarifa, ni tareas.
- **`tiempoRealHs`**: un campo de texto libre. En los datos: `"2"`, `""`, `""`.

## M · Presupuestos

Sí existe, dentro de la ficha (paso 2), y **no tiene nada que ver con
`sales_quotes`**:

| | legacy mantenimiento | `sales_quotes` (base nueva) |
|---|---|---|
| numeración | `COT-<año>-<n>`, **derivada de `historico.length + fichas.length + 1`** y **editable a mano** | `document_sequences`, server‑side |
| líneas | `{desc, tipo, cant, pu}`, texto libre | `sales_quote_lines` con producto, snapshots, impuestos |
| impuestos | **ninguno** | por línea, con tratamiento |
| descuentos | **ninguno** | por línea y global |
| moneda | USD/ARS/EUR por ficha | `currency_code` con FK |
| aprobación | `estadoCotizacion` + `fechaAprobacion` + `aprobadoPor` | estados propios |
| impresión | **no existe** | 6 formatos |
| relación con Ventas | **ninguna** | — |

**El número es reproduciblemente frágil**: se recalcula en cada render a partir
de un conteo, así que borrar una ficha cambia el número de la siguiente, y el
campo es un `<input>` editable. En los datos reales: `002`, `003`, `004` — **no
existe el `001`**.

## N · Adjuntos y fotos

**No hay.** Ni fotos de la máquina, ni de la placa, ni del serial, ni PDF, ni
video, ni base64, ni Storage. Cero `<input type="file">` en el módulo salvo el
de importar backup.

Lo único parecido son los **Manuales**, que guardan una **URL externa** y nada
más (`{titulo, tipo, modelos, url, desc}`). No se sube un archivo.

Para un servicio técnico esto es una carencia grande, pero **es una carencia del
legacy, no un requisito a migrar** (ver **28**).

## O · Impresión

**No existe ninguna impresión en Mantenimiento.** Cero referencias a
`openPrintPreview`, `buildPrintHTML`, `window.print` o similares en todo el
módulo. `getDocTypeMeta()` no tiene ningún tipo de mantenimiento.

Lo que sí hay es **Exportar** (`_mantExportarView`): CSV de activos e histórico
y un **backup JSON completo** de las 9 colecciones —el mismo que sirve para
sacar los datos con seguridad (**W‑1**)— más su importador.

## P · Permisos

`renderMantenimientos()` arranca con `if(!_chkTeam()) return '';`

```js
function _chkTeam(){
  const u = state.user;
  if(!u || !TEAM_USERS.includes(u)){ navigateTo('catalogo','productos'); return false; }
  if(!_hasSessToken(u)){ _forceLogout(); return false; }
  return true;
}
```

- Es una **lista blanca de 6 nombres** hardcodeada, no un sistema de roles.
- Dentro del módulo **no hay ningún control más**: los seis ven y hacen todo.
- No hay separación por técnico: cualquiera edita la ficha de cualquiera. El
  filtro «mis fichas» del dashboard es una comodidad, no un permiso.
- Como los datos viven en `localStorage`, **el control es de pantalla, no de
  datos**: quien abre la consola del navegador los lee y los escribe enteros.

Comparado conceptualmente con los roles nuevos: los 6 de `TEAM_USERS` caen del
lado de **admin/employee**; `salesperson`, `customer` y `distributor` no tienen
equivalente en el legacy porque el módulo directamente no era accesible.

## Q · Numeración

| entidad | formato | generación | problema |
|---|---|---|---|
| Activo | `ACT00001` | `nextMantActivoRef()` = **MAX+1** | se reutiliza al borrar; carrera entre dispositivos |
| Ficha | `SVC-1783021387008` | **`Date.now()`** | no es legible ni consecutivo |
| Cotización | `COT-2026-002` | **conteo derivado**, editable a mano | se corre al borrar; duplicable; en los datos falta el `001` |
| Cliente mant. | `CLI001` | MAX+1 | **colisiona en forma con `CLI00001` del sistema** |
| Repuesto | `REP001` | MAX+1 | — |
| Manual | `MAN<epoch>` | `Date.now()` | — |
| Usuario | `USR<epoch>` | `Date.now()` | — |

**Ninguna** usa un contador transaccional. En la base nueva ya existe
`document_sequences` + `next_document_number()`, que es lo que se usó en Ventas
y en Compras.

## R · Backend nuevo — qué sirve

46 tablas, **ninguna de mantenimiento**. Lo que hay:

| tabla | veredicto | por qué |
|---|---|---|
| `customers` (1010) | **REUTILIZABLE** | el cliente del equipo |
| `products` (21.775) | **REUTILIZABLE** | modelo del equipo y repuestos, ya con SKU |
| `brands` (26) | **REUTILIZABLE** | marcas |
| `profiles` (7) | **REUTILIZABLE** | técnicos de verdad, con id |
| `companies` / `company_memberships` | **REUTILIZABLE** | empresa y roles |
| `attachments` (0) | **EXTENSIBLE** | fotos y PDF: bucket privado + RLS ya resueltos; falta sumar los `entity_type` |
| `document_sequences` | **REUTILIZABLE** | numeración de verdad |
| `warehouses` (2), `stock_movements` (381), `stock_balances` (379) | **REUTILIZABLE** | si algún día el repuesto descuenta |
| `stock_reservations` (0) | **EXTENSIBLE** | existe y está sin usar |
| `delivery_serials` (**0 filas**) | **EXTENSIBLE — la pieza clave** | ya modela `serial_number` + `product_id` + `customer_id` + fecha. Es el germen de la trazabilidad por serie |
| `sales_quotes` / `sales_quote_lines` | **NO APLICA (por ahora)** | ver **M**: el presupuesto de reparación no tiene casi nada en común |
| `purchases_audit` / `sales_audit` | **PATRÓN REUTILIZABLE** | el mismo esquema de auditoría |

**Falta todo lo propio**: equipo/activo, ficha de servicio, sus pasos, las
mediciones de torque y el estado de las 8 partes.

## S · Frontend nuevo — qué existe hoy

- `src/modules/mantenimiento/` existe con las **5 carpetas vacías**
  (`components`, `hooks`, `pages`, `services`, `types`), cada una con un
  `.gitkeep`. **Ni un archivo de código.**
- **Ninguna ruta** en `src/app/routes.tsx`.
- En la navegación aparece como **`'Mantenimiento'` dentro de `PROXIMAMENTE`**
  (`AppLayout.tsx:43`): una etiqueta deshabilitada, sin enlace.
- No hay servicios, hooks, tipos ni permisos.

## T · Deuda y bugs del legacy

| # | qué | gravedad |
|---|---|---|
| T‑1 | **El cliente es texto libre.** `activo.clienteNombre` sin id | alta |
| T‑2 | **`clienteId` se lee en 5 lugares y no se escribe en ninguno** → el filtro por cliente de 3 pantallas está muerto | alta |
| T‑3 | **El serial no es obligatorio ni único** por el camino principal | alta |
| T‑4 | **`serviciosCount` deriva**: el activo dice 5 servicios y el histórico tiene 3. Sube al crear la ficha y nunca baja | media |
| T‑5 | **El número de cotización se recalcula por conteo** y es editable → se corre y se duplica. En los datos falta el `001` | media |
| T‑6 | **Se puede cerrar una ficha con la cotización PENDIENTE** y con todos los pasos vacíos. Pasó 2 de 3 veces | media |
| T‑7 | **`mant_usuarios` no alimenta el selector de técnico**, que usa una lista hardcodeada. Guarda contraseñas y no sincroniza | media |
| T‑8 | **`incidencias` vive en el menú de Mantenimiento pero es de otro subsistema** (`erp_incidencias`, con `_ekey`), sólo se llega desde Clientes, y usa **el índice del array como identidad** (`data-inc-idx`) | media |
| T‑9 | **`localStorage` como base de datos**, con sincronización por **polling de 30 s** y «gana el último que escribe». Sin transacciones ni bloqueos | alta |
| T‑10 | **Todas las numeraciones son MAX+1 o `Date.now()`** | media |
| T‑11 | **`CLI001` de mantenimiento colisiona en forma con `CLI00001`** del sistema | baja |
| T‑12 | **`mant_repuestos` duplica el catálogo** —que ya tiene los `FE.REP.*`— con un `stock` propio que nadie mueve | media |
| T‑13 | **El placeholder se guarda como dato**: `condicionVisual: "— seleccionar —"` en las 3 fichas | baja |
| T‑14 | **Sin empresa**: las claves no llevan `_ekey`, a diferencia del resto del ERP | media |
| T‑15 | **Permiso por lista blanca de 6 nombres**, y los datos en el navegador: el control es de pantalla, no de datos | alta |
| T‑16 | **Todo se carga entero en memoria** y se filtra en JS. Sin paginación ni orden server‑side (**punto 20**) | baja hoy (n=4) |

## U · Clasificación de la migración

| clase | qué | cantidad |
|---|---|---|
| **A · MIGRABLE EXACTO** | nada | **0** |
| **B · MIGRABLE CON MATCH INEQUÍVOCO** | el cliente `TORQUEAR SA` → `CLI01072` | **1 de 1** |
| **C · NECESITA REVIEW** | el modelo `ASM18-3-PC` → `FE.ASM18-3` o `FE.MAQ.71127760000` | **1 de 1** |
| **D · NO RECONSTRUIBLE** | las 30 mediciones de torque (vacías), `trabajosRealizados`, `observacionesFinales`, `eficienciaGeneral` (vacíos en las 3) | — |
| **E · NO MIGRAR / PRUEBA** | **el activo `ACT00001` («Prueba», serie «123456») y sus 3 fichas** | **4 de 4** |

### La conclusión incómoda

**No hay datos históricos que migrar.** Los 4 registros que existen son de
prueba: identificador «Prueba», serie «123456», importes 0, campos vacíos y el
placeholder guardado como valor.

Eso cambia la naturaleza de la fase: **Mantenimiento no es una migración de
datos, es una migración de funcionalidad**. No hay reconciliación que hacer ni
huella que preservar. Sí hay un circuito de 5 pasos que entender y respetar.

## V · Propuesta de entregas

Ajustada a lo que se encontró —funcionalidad real, datos nulos— y no a la
plantilla de Compras:

| entrega | qué | por qué acá |
|---|---|---|
| **1 · Schema** | equipos/activos, fichas de servicio, sus pasos, partes, mediciones de torque, técnicos; numeración con `document_sequences`; RLS; auditoría | es lo primero porque no hay datos que condicionen el modelo |
| **2 · Equipos** | maestro de equipos con **serie obligatoria y única por empresa**, vínculo real a `customers` y a `products`, e historial por equipo | el maestro antes que el circuito, como proveedores antes que pedidos |
| **3 · Ficha: listado y alta** | listado con filtros en URL, alta, ficha, estados visibles | la pantalla mínima usable |
| **4 · El circuito de 5 pasos** | diagnóstico → cotización → reparación → torque → cierre, con las transiciones impuestas por el servidor | el corazón del módulo |
| **5 · Repuestos y mano de obra** | ítems de cotización **contra el catálogo real**, y la decisión de stock de **W‑4** | depende de una decisión tuya |
| **6 · Adjuntos** | fotos del equipo, de la placa, del serial y PDF, sobre `attachments` | es funcionalidad **nueva**; va aparte y se puede recortar |
| **7 · Impresión y export** | orden de servicio y presupuesto de reparación | también **nuevo**: el legacy no imprime |
| **8 · Cierre** | E2E, RLS final, mobile real, regresión | como en Compras |

Las entregas **6 y 7 son mejoras, no migración**, y están separadas a propósito
(**punto 28**). Si querés el módulo mínimo en producción antes, se cierra en la 5.

## W · Decisiones que necesito de vos

**W‑1 · El backup del navegador.** Todo lo de arriba sale de `erp_store`, que
es lo último sincronizado. Para confirmar que no hay nada más —sobre todo en las
4 claves que no sincronizan (`mant_usuarios`, `mant_modelos_custom`)— necesito
el JSON de **Mantenimiento → Exportar → backup JSON**. Es un botón que ya
existe, no ejecuta nada raro y no escribe. Si preferís, lo damos por cerrado con
lo medido y lo dejo anotado como salvedad.

**W‑2 · ¿Se migran los 4 registros de prueba?** Mi recomendación: **no**.
Arrancar limpio y que el primer equipo real se cargue a mano. Si querés
conservarlos, se migran como `needs_review`.

**W‑3 · Trazabilidad por serie: ¿equipo o serie?** Es *la* decisión de modelo.
El legacy tiene «activos» que se pueden duplicar. La opción sana es que **la
serie sea la identidad del equipo, única por empresa**, y que `delivery_serials`
—que ya existe vacío— se llene cuando se entrega uno. Eso conecta Ventas con
Mantenimiento, pero es una relación nueva: decidime si entra en la fase o queda
para después.

**W‑4 · ¿El repuesto descuenta stock?** Hoy no descuenta nada. Con
`stock_movements` andando, un repuesto usado en una reparación **podría**
descontar de verdad. Es **funcionalidad nueva** y cambia el alcance de la
entrega 5. Tres caminos: (a) no tocar stock, como el legacy; (b) descontar al
cerrar la ficha; (c) reservar al aprobar la cotización y descontar al cerrar.

**W‑5 · El presupuesto de reparación: ¿propio o `sales_quotes`?** Como está en
**M**, el del legacy no tiene impuestos, ni productos, ni numeración seria. Se
puede (a) hacerlo propio y simple como el legacy, (b) hacerlo propio pero bien
—con líneas contra el catálogo e impuestos—, o (c) emitir una cotización de
Ventas de verdad desde la ficha. Cambia bastante el trabajo.

**W‑6 · Empresa.** El legacy no distingue. ¿Mantenimiento es sólo de Buscatools
o también de Torquetools? Afecta el schema desde la primera tabla.

**W‑7 · Técnicos.** ¿El técnico pasa a ser un `profile` de verdad (con id, y
sólo los de la empresa), o se mantiene una lista de nombres? Con `profiles` se
puede filtrar «mis fichas» de verdad y auditar quién hizo qué.

**W‑8 · ¿Qué se hace con las 8 partes y las 10 mediciones de torque?** Están
vacías en los 3 registros, pero son **el núcleo técnico del módulo** —lo que
distingue esto de un ticket genérico—. Doy por sentado que se migran tal cual
(8 partes fijas, 10 filas de torque); decime si la lista de partes tiene que
poder configurarse por modelo.

---

## Lo que NO hice, a propósito

- No ejecuté el ERP legacy: `app.js` y el HTML se leyeron como texto.
- No escribí, borré ni toqué `localStorage`.
- No modifiqué el Supabase legacy: sólo `SELECT`.
- No creé tablas, ni corrí migraciones, ni escribí una línea de UI.
- No hice ningún match de datos: sólo lo medí.
- No diseñé el circuito ideal: documenté el que hay.
