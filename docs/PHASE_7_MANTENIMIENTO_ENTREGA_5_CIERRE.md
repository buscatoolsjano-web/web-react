# Fase 7 · Mantenimiento · Entrega 5 — Cierre definitivo del módulo

Pasada final. No es una entrega de funciones nuevas: es la comparación del
módulo terminado contra el legacy auditado en la entrega 0, más lo que faltaba
enchufar y los defectos que aparecieron al usarlo.

---

## A · Matriz Legacy → React

La equivalencia se mide por **capacidad funcional**, no por cantidad de
pantallas. El legacy tiene 13 entradas de menú porque cada maestro chiquito es
una pantalla; acá varios de esos maestros ya existen en otros módulos.

| # | Funcionalidad legacy | Estado React | Dónde |
|---|---|---|---|
| 1 | Dashboard de mantenimiento | **NO MIGRADA** · placeholder | contaba activos y fichas; con 1 activo de prueba no medía nada |
| 2 | Nueva ficha (selector de activo) | **EQUIVALENTE** | `/mantenimiento/ordenes/nueva`, con el equipo preseleccionado desde su ficha |
| 3 | Clientes de mantenimiento (`mant_clientes`) | **MEJORADA** | son los `customers` reales (1010), no un maestro paralelo vacío |
| 4 | Activos | **MEJORADA** | `maintenance_assets` con referencia server-side, serie, dueño real y vínculo al catálogo |
| 5 | Cotización por lotes | **NO MIGRADA** · sin datos | `mant_lotes` vacío; ninguna ficha lo usó |
| 6 | Usuarios de mantenimiento | **NO MIGRADA** · código muerto | el maestro existía pero el selector usaba una lista hardcodeada de 6 nombres |
| 7 | Marcas / modelos | **MEJORADA** | marca y modelo son campos del equipo y el modelo sale del catálogo real |
| 8 | Fichas pausadas | **EQUIVALENTE** | `on_hold` + `on_hold_since`, con filtro en el listado |
| 9 | Histórico | **MEJORADA** | no es una colección aparte: es una orden `closed`, con su historial completo |
| 10 | Exportar | **EQUIVALENTE (parcial)** | CSV de equipos y de órdenes. El backup JSON no — ver **M** |
| 11 | Repuestos (`mant_repuestos`) | **MEJORADA** | son productos del catálogo real, con SKU, depósito y consumo que mueve stock |
| 12 | Modelos | **MEJORADA** | del catálogo, no de un maestro propio |
| 13 | Manuales / PDF | **MEJORADA** | eran una URL externa; ahora son adjuntos reales en bucket privado |
| 14 | Ficha de 5 pasos | **MEJORADA** | las transiciones las impone el servidor; el legacy no validaba nada |
| — | Incidencias | **AJENA** | `erp_incidencias` no es de Mantenimiento |

### El circuito de cinco etapas, uno a uno

| paso legacy | React | qué cambió |
|---|---|---|
| 1 · Diagnóstico | etapa `diagnosis` + `maintenance_order_checks` | las 8 partes OK/NOK/N-A son 16 puntos configurables por empresa |
| 2 · Cotización | etapa `quotation` + `maintenance_quote_lines` | numeración server-side, moneda por orden, total calculado por el servidor, líneas contra el catálogo |
| 3 · Reparación | etapa `repair` + `repair_notes` / `repaired_at` | se puede marcar **no requerida**, y queda auditado |
| 4 · Torque | etapa `torque` + `maintenance_measurements` | Cp, Cpk, CV y veredicto los calcula el servidor; el legacy guardaba 10 filas vacías |
| 5 · Cierre | `cerrar_orden_mantenimiento()` | **doce condiciones**. El legacy cerró 2 de sus 3 fichas con la cotización pendiente |

---

## B · Funcionalidad legacy no migrada

Clasificada como pide el punto 2. **Sólo la clase A bloquea el cierre, y no hay
ninguna.**

| clase | qué | por qué |
|---|---|---|
| **A · falta funcionalidad real** | *(ninguna)* | — |
| **B · placeholder legacy** | Dashboard | contaba 1 activo de prueba y 3 fichas de prueba |
| **B · placeholder legacy** | Cotización por lotes, Marcas, Manuales, Repuestos, Clientes de mant. | las cinco pantallas existían y estaban **vacías** en producción |
| **C · código muerto** | `mant_usuarios` | el maestro no alimentaba el selector: el selector usaba `['JANO','NORBERTO','FACUNDO','JUAN','BRIAN','ADMIN']` hardcodeado |
| **D · reemplazado a propósito** | lista blanca de 6 nombres (`_chkTeam`) | ahora es RLS por rol y empresa |
| **D · reemplazado a propósito** | numeración `COT-<año>-<n>` recalculada en cada render y editable a mano | `next_document_number`, server-side |
| **D · reemplazado a propósito** | backup JSON con importador | sobrescribía nueve colecciones desde un archivo del usuario — ver **M** |
| **E · mejora futura** | unidad e instrumento de torque, impuestos, técnico como `profile` | nunca existieron en el legacy |

---

## C · Navegación

Ocho rutas, probadas en producción una por una.

| ruta | resultado |
|---|---|
| `#/mantenimiento` | redirige a `/activos` |
| `#/mantenimiento/activos` | Equipos |
| `#/mantenimiento/activos/nuevo` | Nuevo equipo (antes que `:id`, si no lo tomaría como id) |
| `#/mantenimiento/activos/:id` | ficha |
| `#/mantenimiento/ordenes` | Órdenes |
| `#/mantenimiento/ordenes/nueva` | Nueva orden |
| `#/mantenimiento/ordenes/:id` | ficha |
| `#/mantenimiento/puntos` | Puntos de revisión — sin entrada de menú, se llega desde Órdenes y desde el panel de revisiones |

- **Refresh**: mantiene la ruta y vuelve a montar (`#/mantenimiento/puntos` → recarga → sigue ahí).
- **Atrás / adelante**: seis saltos encadenados, todos correctos.
- **UUID que no existe**: «Este equipo no existe o no es de la empresa activa».
- **Id que no es un UUID**: el mensaje del servidor. Acá apareció un defecto —salía dos veces— corregido en **W**.
- **Ruta inventada**: 404.
- **`lazyConRecarga`**: los siete chunks cargan; tras cada deploy hubo que forzar la recarga una vez porque el chunk viejo queda cacheado.

---

## D · Equipos

Ciclo completo ejercido desde la interfaz: alta con serie, marca y modelo →
ficha → adjuntos → orden desde la ficha.

**Confirmado otra vez, y es la regla que más importa acá:** cambiar el dueño
actual **no toca** el `customer_id` de ninguna orden ya creada. En el E2E el
equipo quedó **sin dueño cargado** y la orden conserva «Acropolis Cables S.A.»
como cliente histórico. La pantalla lo dice con todas las letras:

> El dueño puede faltar y puede cambiar. Cambiarlo no modifica ninguna orden ya
> creada: cada orden guarda su propio cliente, congelado en el momento del
> ingreso.

---

## E · Órdenes

- Número server-side (`OS00001`, `OS00002`, `OS00003`), nunca `MAX+1`.
- Cliente obligatorio; equipo obligatorio.
- Etapa inicial `diagnosis`.
- `on_hold` / reanudar, avanzar, retroceder con confirmación, marcar no requerida, cancelar, cerrar.
- Ninguna mutación inválida pasa: **catorce** intentos sobre una orden cerrada, los catorce rechazados con `23001` — ver **J**.

---

## F · Diagnóstico y revisiones

16 puntos configurables (8 activos en Buscatools). En el E2E se marcaron tres
(OK, OK, NOK) y la ficha mostró «3 de 8 revisados». La reparación marcada como
no requerida hace que su fase de revisión no se pida, y lo dice.

No se agregó ningún punto nuevo.

---

## G · Cotización

Ejercida completa en el E2E: moneda ARS → línea de mano de obra 2 × ARS 18.000
→ línea de repuesto **sin cargo** → total **ARS 36.000 calculado por el
servidor** → aprobar con «quién la aprobó» → congelada.

- Sin moneda elegida no se carga una línea con importe, y lo explica.
- Aprobada y rechazada son terminales.
- **Pendiente no permite cerrar**: es la condición 6, y es el bug del legacy que
  esto viene a impedir.

---

## H · Reparación y repuestos

- Repuesto elegido del catálogo real (`FE.REP.31912098020`, 2 unidades, costo ARS 15.400).
- La ficha muestra **«Stock 0 → -2»** antes de confirmar.
- **Agregar el repuesto no movió stock**: 0 movimientos hasta la confirmación.
- **El consumo sí**: 1 movimiento, −2 unidades, confirmación en dos pasos.
- **Cerrar no volvió a mover stock**: seguía habiendo 1 movimiento.
- El saldo negativo se permite y se avisa: «la reparación ya ocurrió y no
  registrarla haría que el sistema mienta sobre una herramienta que ya tiene el
  repuesto puesto».
- Dar la reparación por completada **no consume nada**, y la pantalla lo aclara.

---

## I · Torque

Desde la interfaz: límites 9 / 10 / 11 → cinco mediciones → **Cpk 4,2164,
veredicto Capaz**, el mismo caso de regresión de la entrega 1, calculado por el
servidor.

Casos borde (0, 1, todas iguales, media 0, exactamente en los límites, fuera de
límites) probados en la suite de la entrega 4: ninguno devuelve NaN ni Infinity;
lo que no existe se muestra **N/D**.

Un nominal fuera de la banda lo rechaza el servidor. Acá apareció el defecto más
feo de esta pasada: el mensaje llegaba crudo. Corregido en **W**.

---

## J · Cierre, cancelación y congelamiento

Las doce condiciones ya estaban probadas de a una en la entrega 4 y esa suite se
reutilizó sin tocarla. Lo que agrega esta entrega es el congelamiento completo:
**catorce intentos, todos rechazados server-side con `23001`**.

| intento sobre una orden cerrada | resultado |
|---|---|
| cambiar el equipo | rechazado |
| cambiar el cliente | rechazado |
| editar el diagnóstico | rechazado |
| cambiar la etapa | rechazado |
| cambiar la moneda de la cotización | rechazado |
| aprobar la cotización | rechazado |
| cambiar los límites de torque | rechazado |
| cambiar la fecha de entrega | rechazado |
| agregar una línea de cotización | rechazado |
| agregar un repuesto | rechazado |
| confirmar el consumo | rechazado |
| agregar una medición | rechazado |
| agregar una revisión | rechazado |
| cancelarla | rechazado |

**La única excepción es adjuntar un archivo, y es deliberada.** Un informe o una
foto que aparece después no cambia lo que pasó, y prohibirlo obligaría a reabrir
la orden —que justamente no se puede— para guardar un papel. Está documentado en
el propio componente.

**Cancelada ≠ cerrada**: chip rojo, texto propio («Cancelar no es cerrar: la
herramienta entró y se devolvió sin trabajo terminado»), motivo guardado y
auditado. No hay reapertura de ninguna de las dos.

---

## K · Historial

Leído como usuario, de la orden E2E completa. Nueve eventos, en orden inverso:

```
Cierre                Abierta → Cerrada                      17:20 · Jano
Avance de etapa       Torque → Cierre                        17:17 · Jano
Avance de etapa       Reparación → Torque                    17:15 · Jano
Consumo de repuestos  1 repuesto                             17:15 · Jano
Repuesto agregado     FE.REP.31912098020 × 2                 17:14 · Jano
Avance de etapa       Cotización → Reparación                17:13 · Jano
Cotización aprobada   ARS 36.000,00 · por Ing. Pablo Acr.    17:12 · Jano
Avance de etapa       Diagnóstico → Cotización               17:11 · Jano
Alta                  — → Abierta                            17:11 · Jano
```

Sin UUID, sin estados internos crudos, sin duplicados, sin un evento por tecla.
Cada línea tiene autor y hora. Cuenta la historia que pide el punto 15.

---

## L · Adjuntos

**El legacy no tiene adjuntos.** Verificado sobre el fuente, no sobre el
informe: cero `<input type="file">` en las 3.800 líneas del módulo salvo el de
importar un backup JSON. Lo único parecido eran los «Manuales», que guardaban
una URL externa.

Pero **la infraestructura ya estaba entera desde la entrega 1**, y sólo faltaba
enchufarla:

- `attachments.entity_type` ya aceptaba `maintenance_asset` y `maintenance_order`.
- `attachments_select` ya resolvía esos dos tipos por `app.current_writer_company_ids()` —admin y empleado—, que es exactamente la política v1 de Mantenimiento.
- El bucket `ventas` ya era privado, con límite de 20 MB.

Se agregó una pestaña **Archivos** en la ficha del equipo y en la de la orden.
**Cero líneas de schema.**

Probado en producción: subir un archivo al equipo, listarlo, abrirlo con URL
firmada (se verificó que la URL trae `token=` y que devuelve HTTP 200 con el
contenido correcto), y que **la URL pública del bucket devuelve 400**.

### El ataque del punto 17

Conociendo el `storage_path` exacto de un archivo ajeno:

| identidad | pedir la URL firmada |
|---|---|
| admin / employee | la firman |
| technician | **«Object not found»** |
| customer | **«Object not found»** |
| distributor | **«Object not found»** |
| anon | **«Object not found»** |

La policy `ventas_objects_select` parece tautológica —«existe un adjunto que
apunta a este objeto»— y **no lo es**: la subconsulta a `attachments` también
pasa por la RLS de `attachments`, así que sólo encuentra fila quien puede ver el
adjunto. Se probó con JWT reales, no leyendo la policy.

---

## M · Impresión y exportación

### Impresión — NO EXISTE en el legacy

Medido sobre `app.js`, no asumido: **cero** llamadas a `openPrintPreview`,
`window.print`, `buildPrintHTML` o `_doPrint` en todo el rango del módulo
(líneas 28.000–31.800). `getDocTypeMeta()` no tiene ningún tipo de
mantenimiento. Las 20 llamadas a impresión del archivo son todas de Ventas,
Compras y Facturación.

**Clasificación: NO EXISTE.**
**IMPRESIÓN = FUTURE ENHANCEMENT.** No se inventan seis formatos como Ventas
sólo por consistencia visual, y no bloquea el cierre.

### Exportación — SÍ EXISTE y es real

`_mantExportarView` tenía cuatro CSV (histórico, activos, clientes, fichas
activas) y un backup JSON de las nueve colecciones, con su importador.

**Migrado:** CSV de **equipos** y de **órdenes**, con botón en cada listado.
Exporta **lo que muestran los filtros**, no la página visible. Verificado en
producción:

```
Numero;Ingreso;Entrega;Cliente;Equipo;Serie;Servicio;Etapa;Estado;En espera;Cotizacion;Moneda;Total
OS00002;2026-09-11;2026-09-11;AESA;EQ00002;ZZ-E5-EXTERNO-0002;Preventivo;Cierre;Cerrada;no;Rechazada;;0.00
OS00001;2026-09-11;2026-09-11;Acropolis Cables S.A.;EQ00001;ZZ-E5-SERIE-0001;Correctivo;Cierre;Cerrada;no;Aprobada;ARS;36000.00
```

Con BOM —sin él Excel en Windows rompe las tildes—, etiquetas en castellano, y
**la moneda en su propia columna** con el total sin símbolo: cada orden cotiza
en la suya, así que quien abra el archivo agrupa por esa columna antes de sumar.

**No migrado, y no por olvido:** los CSV de clientes (se exportan desde
Clientes, que es donde viven ahora) y el histórico (acá es una orden cerrada, o
sea el mismo CSV filtrando por estado). Y el **backup JSON con su importador**:
era el respaldo de una aplicación que vivía en el navegador; un botón que
sobrescribe nueve colecciones desde un archivo del usuario no tiene lugar contra
una base multiempresa con RLS. El respaldo lo hace Supabase.

---

## N · RLS final

Matriz completa con **JWT reales**. Para el EMPLOYEE y el TECHNICIAN, que no
existían en la base, se crearon dos usuarios temporales con contraseña generada
en el script, se usaron y se borraron. No se tocó ningún usuario real.

| identidad | 8 tablas de Mantenimiento | adjuntos de Mantenimiento |
|---|---|---|
| ADMIN | acceso | acceso |
| EMPLOYEE | acceso | acceso |
| TECHNICIAN | **0** | **0** |
| SALESPERSON | **0** | **0** (ni en su propia empresa) |
| CUSTOMER | **0** | **0** |
| DISTRIBUTOR | **0** | **0** |
| ANON | **0** | **0** |

### Por id, no sólo contando

Cada identidad se probó con **21 comprobaciones** por ronda, sobre nueve
tablas: sin filtro, **por id exacto**, **por `maintenance_order_id` del padre**,
y por `company_id` de la empresa ajena. Contar es fácil de aparentar; pedir la
fila exacta que existe, no.

---

## O · Multiempresa

Siete patrones, contra una **empresa tercera real** creada para la prueba (con
su cliente, su categoría, su producto, su depósito, su punto de revisión, su
equipo y su orden). Los siete rechazados:

| # | intento | código |
|---|---|---|
| P1 | línea con `company_id` propio en una orden ajena | `23514` |
| P2 | medición con `company_id` propio en una orden ajena | `23514` |
| P3 | repuesto con un producto de otra empresa | `23514` |
| P4 | repuesto con un depósito de otra empresa | `23514` |
| P5 | revisión con un punto de otra empresa | `23514` |
| P6 | equipo de otra empresa como equipo de la orden | `23514` |
| P7 | adjunto de una empresa donde no se tiene rol | `42501` |

La orden de la empresa tercera quedó con 0 líneas: nada se coló.

**La lección de O1 sigue vigente y probada:** una fila hija no se autoriza por
su propio `company_id`, se autoriza por el de su padre.

### Permisos en la interfaz

Cambio real de empresa, con el mismo usuario: Buscatools **admin** →
Torquetools **salesperson**.

- Las dos entradas de menú desaparecen.
- Las cinco rutas por URL directa muestran el aviso correcto: «Tu rol no tiene
  acceso a Mantenimiento», «no puede configurar», «no puede crear órdenes», «no
  puede dar de alta equipos».
- Al volver a Buscatools, el menú vuelve.

Lo que lo impide de verdad es RLS, no el `if`: la matriz de arriba lo prueba.

---

## P · Performance

Medido en producción con `fetch` instrumentado, no con la primera llamada fría.

| pantalla | requests | payload | p50 de su consulta |
|---|---|---|---|
| Equipos · listado | 1 | ~1,2 kB | 397 ms |
| Órdenes · listado | 1 (+1 de membresías) | 1,6 kB | 405 ms |
| Puntos de revisión | 1 | 0,9 kB | 204 ms |
| **Orden · ficha** | **10 en paralelo** | 7,0 kB | ~250 ms de reloj |
| Orden · pestaña Cierre | +1 (`precheck_cierre_mantenimiento`) | — | — |
| Orden · pestaña Archivos | +1 (`attachments`) | — | — |

**Sin N+1.** Cada listado hace **una** consulta con sus joins embebidos,
independientemente de cuántas filas traiga. La ficha hace diez consultas porque
son diez tablas distintas, una por tabla, todas en paralelo y todas de ~200 ms:
el reloj es el de la más lenta, no la suma.

Las dos más caras están **diferidas a propósito**: el precheck de cierre y los
adjuntos sólo se piden al abrir su pestaña. Preguntar «¿se puede cerrar?» en
cada visita a una orden que recién entró al taller sería una consulta por nada.

Está dentro de valores razonables y no se optimizó nada más.

---

## Q · Catálogo del lado del servidor

Confirmado en producción: el buscador de repuestos escribió «carcasa» y el
servidor devolvió **5 resultados** sobre un catálogo de **21.772 productos**,
por `search_products(p_company, p_query, p_limit)`. La suite verifica además que
con `p_limit: 20` devuelve como mucho 20.

Nunca se traen 21.772 productos al navegador. Vale para los tres selectores:
producto del equipo, concepto de cotización y repuesto.

---

## R · Mobile y escritorio

Matriz real sobre las 14 pantallas y estados, en los cinco anchos.

| ancho | puntero | scroll horizontal global | controles < 44 px | campos < 16 px |
|---|---|---|---|---|
| 390 | grueso | **no** | 0 | 0 |
| 430 | grueso | **no** | 0 | 0 |
| 767 | grueso | **no** | 0 | 0 |
| 768 | fino | **no** | *(medidas de escritorio)* | *(14 px, escritorio)* |
| 1440 | fino | **no** | *(medidas de escritorio)* | *(14 px, escritorio)* |

Pantallas cubiertas: equipos listado, equipo nuevo, equipo detalle, órdenes
listado, orden nueva, puntos, y la ficha de la orden en sus **ocho** pestañas
(Trabajo, Cotización, Repuestos, Torque, Cierre, Ingreso, Archivos, Historial).

Dos cosas que hay que decir con precisión:

1. **Un checkbox mide 20 px y no es un defecto.** El área que se toca es su
   `<label>`, que mide 44. Y la regla de los 16 px es contra el zoom de iOS al
   enfocar un campo de **texto**: un checkbox no tiene texto que ampliar. La
   medición se ajustó para no contar falsos positivos — y al ajustarla apareció
   uno **verdadero**, el del circuito, corregido en **W**.
2. **A 768 con mouse los controles son de escritorio, y está bien.** La regla
   del proyecto es `@media (max-width: 767px), (pointer: coarse)`. Un iPad
   vertical mide 768 **y es táctil**, así que entra por la segunda condición.
   Eso destapó el cuarto defecto de **W**.

Las tablas anchas scrollean dentro de su propio contenedor; el documento no
scrollea de costado en ningún ancho.

---

## S · E2E principal

Ejercido **entero desde la interfaz en producción**, con sesión real.

```
Equipo EQ00001 (serie ZZ-E5-SERIE-0001, Fein ASCD 18-1000 W34)
  → adjunto: foto de la placa, abierta con URL firmada
  → OS00001, cliente Acropolis Cables S.A.
  → diagnóstico: 3 de 8 revisiones + notas → completado
  → cotización ARS: mano de obra 2 × 18.000 + repuesto sin cargo
     → total ARS 36.000 (servidor) → aprobada por «Ing. Pablo Acropolis»
  → reparación: repuesto FE.REP.31912098020 × 2 del catálogo
     → agregar NO mueve stock → consumo confirmado (2 pasos) → −2 unidades
     → notas → reparación completada
  → torque: LCI 9 / nominal 10 / LCS 11 → 5 mediciones → Cpk 4,2164 · Capaz
  → cierre: fecha de entrega → precheck sin bloqueos → confirmación → CERRADA
```

Estado final verificado contra la base:

| | |
|---|---|
| status / stage | `closed` / `closing` |
| `closed_at` · `closed_by` | los dos presentes |
| cotización | `approved` · ARS · 36.000 |
| diagnóstico · reparación · torque · entrega | las cuatro fechas |
| líneas · repuestos consumidos · mediciones · revisiones | 2 · 1 · 5 · 3 |
| eventos de auditoría | 9 |
| movimientos de stock | **1**, de **−2** unidades |
| cliente histórico | Acropolis Cables S.A. |
| dueño actual del equipo | **null** — y la orden conserva su cliente |
| adjuntos del equipo | 1 |

---

## T · E2E alternativo

Otro camino, sin inventar nada para que pasara:

```
Equipo EQ00002 EXTERNO (marca que no está en el catálogo, sin dueño)
  → OS00002, servicio preventivo
  → reparación NO REQUERIDA + torque NO REQUERIDO (los dos auditados)
  → diagnóstico completado
  → cotización RECHAZADA, con motivo
  → cierre → CERRADA
```

**El comportamiento real, documentado:** una orden con la cotización
**rechazada se cierra**. Rechazada ≠ cancelada: el trabajo de revisión se hizo
igual, el cliente decidió no hacer el arreglo, y la orden se entrega y se
cierra. La condición 6 sólo bloquea la cotización **pendiente**.

Y **cierra sin una sola medición de torque**, porque el torque está marcado como
no requerido, que es un estado explícito y no «cero mediciones».

---

## U · Concurrencia

| prueba | esperado | resultado |
|---|---|---|
| 16 números pedidos a la vez desde dos conexiones | 16 distintos | **16 distintos** |
| dos consumos simultáneos de la misma orden | uno solo mueve stock | **1**, y un solo movimiento |
| dos cierres simultáneos (suite de la entrega 4) | un cierre, un evento | **1 y 1** |

El stock bajó exactamente una vez.

---

## V · Seguridad de las RPC

Las **diez** RPC que usa el módulo, auditadas:

| función | SECURITY DEFINER | search_path | EXECUTE |
|---|---|---|---|
| `aprobar_cotizacion_mantenimiento` | sí | `public, pg_temp` | authenticated, service_role |
| `rechazar_cotizacion_mantenimiento` | sí | `public, pg_temp` | authenticated, service_role |
| `cancelar_orden_mantenimiento` | sí | `public, pg_temp` | authenticated, service_role |
| `cerrar_orden_mantenimiento` | sí | `public, pg_temp` | authenticated, service_role |
| `precheck_cierre_mantenimiento` | sí (STABLE) | `public, pg_temp` | authenticated, service_role |
| `confirmar_consumo_mantenimiento` | sí | `public, pg_temp` | authenticated, service_role |
| `next_document_number` | sí | `public, pg_temp` | authenticated, service_role |
| `capacidad_torque` | **no** (INVOKER, STABLE) | `public, pg_temp` | authenticated, service_role |
| `duplicados_de_serial` | **no** (INVOKER, STABLE) | `public, pg_temp` | authenticated, service_role |
| `search_products` | **no** (INVOKER, STABLE) | `public, extensions, pg_temp` | **PUBLIC + anon** |

- **Ninguna tiene `anon`**, salvo `search_products`, que es compartida con el
  catálogo público del sitio y es `SECURITY INVOKER`: lo que devuelve lo decide
  la RLS de `products`. No es superficie exclusiva de Mantenimiento.
- **Ninguna quedó `TO PUBLIC` por accidente.**
- Las dos `SECURITY INVOKER` de Mantenimiento lo son a propósito: leen, y la RLS
  de sus tablas ya resuelve quién ve qué.
- **El permiso se verifica ANTES del atajo idempotente** en `cerrar_` y en
  `precheck_`: un externo no aprende el estado de una orden ajena preguntando
  por qué no puede cerrarla. Probado con customer, distributor y anon.

---

## W · Bugs encontrados y corregidos

Los cinco aparecieron **usando la aplicación en producción**, no leyendo código.

| # | qué | clase | estado |
|---|---|---|---|
| 1 | El mensaje de error salía dos veces: «No se pudo leer la orden: No se pudo leer la orden: invalid input syntax for type uuid». El servicio ya arma el mensaje y la página le anteponía otro igual. Seis lugares. | **BUG VISUAL** | corregido |
| 2 | Los CHECK de tabla llegaban crudos: «new row for relation "maintenance_orders" violates check constraint "chk_mo_torque_nominal"». Se traducen por nombre de constraint en cinco servicios. | **BUG UX** | corregido |
| 3 | «Torque no requerida», «Cierre completada». Las cinco etapas no tienen el mismo género y la palabra era una sola. | **BUG VISUAL** | corregido |
| 4 | Los dos checkboxes del circuito tenían 24 px de área táctil. `Formulario` y `Filtros` ya llevaban 44; `PanelEtapas` no. | **BUG UX** | corregido |
| 5 | Un iPad vertical mide 768: no entra en el layout de tarjetas —que corta en 767— y sin embargo se toca con el dedo. La tabla se quedaba con botones de ordenar y enlaces de 18 px. | **BUG UX** | corregido |

Los cinco verificados **en producción después del deploy**: el mensaje sale una
vez, «La fecha de entrega no puede ser anterior a la de ingreso», «El nominal
tiene que quedar entre el LCI y el LCS», «— Torque **no requerido**», etiquetas
de 44 px y tabla táctil de 44 px.

### Pluralización (punto 9)

«Quedan 1 repuesto(s) sin confirmar el consumo» y «la cotización tiene 1
línea(s) con importe» eran los **dos únicos** textos del módulo con paréntesis.
El paréntesis es la forma de no decidir, y acá el número siempre se conoce.

```
1  → «Queda 1 repuesto sin confirmar el consumo»
2+ → «Quedan 2 repuestos sin confirmar el consumo»
```

El lado React ya pluralizaba bien en todos lados. Se barrió el módulo entero:
no queda ningún otro.

### Un defecto menor que se documenta y no se toca

Un id mal escrito en la URL dispara ~24 peticiones antes de rendirse: son 8
consultas × 3 reintentos, el comportamiento por defecto de TanStack Query en
toda la aplicación. Cambiarlo sería tocar la política global de reintentos por
una URL que sólo se alcanza escribiéndola a mano. **Backlog.**

---

## X · O4 — `stock_movements`

**NO se corrigió en esta entrega, como se pidió.**

```
O4 · authenticated puede insertar en stock_movements directamente.

    SECURITY PRIORITY — HIGH
    GLOBAL
    AFECTA MÚLTIPLES MÓDULOS
```

**Mantenimiento NO depende de ese INSERT.** Verificado sobre el código: en todo
`src/modules/mantenimiento/` hay **una sola** referencia a las tablas de stock,
y es un `select` de `stock_balances` para mostrar el saldo actual al lado del
repuesto. **Cero escrituras.** El stock se mueve únicamente por
`confirmar_consumo_mantenimiento()`.

El E2E lo confirma desde el otro lado: el único movimiento de la orden lo creó
la RPC, agregar el repuesto no movió nada y cerrar tampoco.

Que O4 siga abierto no bloquea el cierre de Mantenimiento, porque el módulo no
lo usa. Es un agujero **global**, y se arregla cuando se decida arreglarlo para
todos.

> **Cerrado después de esta entrega.** El `revoke` se aplicó en su propio fix
> transversal, con la auditoría que exigía este punto: ver
> `docs/SECURITY_FIX_O4_STOCK_MOVEMENTS.md`. Lo de arriba es lo que era cierto
> cuando se escribió este informe.


---

## Y · Datos legacy

**4 de 4 registros = TEST / NON_PRODUCTION**, y ninguno se migró.

El activo `ACT00001` («Prueba», serie «123456») y sus tres fichas —importes 0,
campos vacíos, el placeholder guardado como valor— siguen sin tocarse. La base
nueva tiene **0 equipos y 0 órdenes** productivos: no hay nada migrado ni
inventado. No se creó ningún dato ficticio para que el módulo pareciera tener
histórico.

---

## Z · Invariantes, regresión y producción

### Invariantes al terminar

| | esperado | real |
|---|---|---|
| equipos · órdenes · líneas · repuestos · mediciones · revisiones · auditoría | 0 | **0** en las siete |
| puntos de revisión | 16 | **16** |
| movimientos de stock | 381 | **381** |
| saldos | 379 | **379** |
| `service_consumption` | 0 | **0** |
| saldos negativos | 0 | **0** |
| deriva saldo ↔ suma de movimientos | 0 | **0** |
| adjuntos | 0 | **0** |
| empresas · clientes · contactos · proveedores | 2 · 1010 · 87 · 142 | **exacto** |
| cotizaciones · pedidos · entregas | 288 · 166 · 182 | **exacto** |
| líneas de entrega · de cotización · de pedido | 600 · 992 · 593 | **exacto** |
| imágenes de producto | 8859 | **8859** |
| productos de Buscatools | 21.772 | **21.772** |
| secuencias | en 1 | `maintenance_asset=1 maintenance_order=1` |
| usuarios temporales | borrados | 1 membresía employee, 0 technician |

### Regresión

| | |
|---|---|
| **25 suites de base de datos** | **0 fallos** |
| `tsc --noEmit` (strict) | limpio |
| `eslint src scripts` | limpio |
| `vitest run` | 47 archivos · **550 tests** |
| `test:isolated` | 47 archivos · **550 tests** |
| `npm run build` | ✓ |

Una nota honesta: la primera corrida dio 4 fallos en la suite de la entrega 5 y
1 en `fase6-cierre`. **Fue error mío**: lancé dos lotes de suites en paralelo, y
todas afirman invariantes globales —cuántos saldos, cuántos movimientos—, así
que se pisaron. En serie dan 0. Quedó un saldo huérfano en 0 de esa corrida, que
detectó `fase6-cierre` y se borró a mano. El script lleva ahora la advertencia.

### Producción

Cuatro deploys en esta entrega, cada uno verificado **usando las pantallas**, no
mirando el HTTP 200 ni el texto dentro del chunk. Los dos E2E se ejercieron
enteros desde la interfaz con sesión real.

---

## Criterio de cierre

| criterio | estado |
|---|---|
| toda funcionalidad REAL del legacy tiene equivalente | **sí** — clase A vacía |
| E2E principal funciona | **sí**, desde la UI |
| E2E alternativo funciona según reglas reales | **sí**, y el comportamiento quedó documentado |
| RLS correcta | **sí**, 7 identidades × 9 tablas, por id |
| multiempresa correcta | **sí**, 7 patrones rechazados |
| mobile correcto | **sí**, 5 anchos × 14 pantallas |
| producción correcta | **sí**, ejercida con sesión real |
| invariantes intactos | **sí** |
| no quedan bugs funcionales conocidos en el módulo | **sí** — los 5 encontrados están corregidos y verificados |

No bloquean, y quedan explícitamente separados: los 4 registros de prueba no
migrados, la impresión que el legacy no tenía, el backup JSON que no se migra,
el technician futuro, la unidad e instrumento de torque, los impuestos, la
política futura de stock negativo, y **O4**, que es global y del que
Mantenimiento no depende.

---

# PHASE 7 — MANTENIMIENTO = CLOSED / MIGRADO A REACT
