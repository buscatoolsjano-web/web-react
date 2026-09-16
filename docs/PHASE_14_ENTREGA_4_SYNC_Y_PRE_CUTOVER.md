# FASE 14 · ENTREGA 4 — CIERRE DE EXCEPCIONES, SYNC STEL Y PRE-CUTOVER

> Se aplicaron las cuatro excepciones autorizadas (revalidadas contra STEL antes de escribir),
> se implementó el sync incremental STEL → React, se resolvió el modelo de autoridad por serie
> (RT vs RT-ML) y quedó el ensayo de corte pasando en una empresa fixture.
> E4.5 alineó los precios de catálogo y, con autorización explícita, el **cutover se ejecutó el
> 2026-09-16 02:05 UTC** (§ 13 bis): quote, sales_order y la serie RT pasaron al ERP; RT-ML sigue
> en STEL. Se emitió la primera cotización del ERP (COTI02629) y ahí se frenó, sin pedido ni
> remito. 2026-09-16.

## 0. Resultado

| | Antes de E4 | Después | Estado |
|---|---|---|---|
| COTI02530 | `accepted` sin id STEL | `sent` (lo que dice STEL) + vinculada al id 59757111 | **APLICADA** |
| SP.2008VP/100 | bloqueado por nombre | vinculado al artículo STEL 24934825 | **APLICADA** |
| 8 líneas que sobraban | intactas | borradas, fila entera en bitácora | **APLICADA** |
| COTI02452 (cliente) | sin CUIT | CUIT de STEL cargado (identidad fuerte) | **APLICADA** |
| SP.2007VPM/80 | conflicto humano | **sin tocar** | DATA_CONFLICT_REQUIRES_HUMAN |
| Reconciliación STEL ↔ React | 2 line mismatch + 1 status + 1 customer | **0 en los tres tipos** | **OK** |
| Sync de catálogo | no existía | incremental con checkpoint, candado y bitácora | **IMPLEMENTADO** |
| Sync de precios | no existía | mecanismo listo y **alineación aplicada** (E4.5, § 7) | **APLICADA** |
| Delta de documentos | manual | incremental, idempotente, sin stock ni secuencias | **IMPLEMENTADO** |
| RT vs RT-ML | el modelo no distinguía series | autoridad por serie (tabla aparte, vacía) | **RESUELTO** |
| Ensayo de corte | no existía | 13 pasos, **PASS** en fixture | **OK** |
| Preflight | no existía | `scripts/fase14-cutover-preflight.mjs` | **READY** (§ 13) |

**E4.5 cerró el último bloqueante** (§ 7): se alinearon 692 precios de «Lista base» con el catálogo
de STEL. Con el preflight en READY y el freeze confirmado, **el corte se ejecutó** (§ 13 bis).

## 1. Cambios productivos exactos

Todo lo que cambió en datos reales, y nada más:

| Run | Qué | Filas |
|---|---|---|
| `2ea4829e-7f0a-4baf-b24f-f7312cb07df8` | Excepciones autorizadas | 1 producto vinculado · 1 cliente con CUIT · 4 documentos (COTI02489, COTI02516, COTI02530, RT0000001405) · 8 líneas borradas · 1 línea vinculada a producto · **14 cambios** |
| `d0a064c9-513c-4999-9c57-7004ee6dd9e3` | Sync de catálogo (sin precios) | 9 productos actualizados (nombre / descripción / tipo) sobre 61 leídos |
| `e948d627-6f64-4780-a673-7718cead8209` | **E4.5** · alineación de precios de «Lista base» | 665 precios actualizados · 27 creados · 0 documentos históricos tocados |

Invariantes verificadas después de cada run: `document_sequences`, `document_numbering_authority`,
`stock_balances`, `stock_movements`, `stock_reservations` y `sales_audit` con el **mismo hash**
antes y después. 0 reservas, 0 movimientos nuevos, 0 eventos de usuario.

Migraciones aplicadas (sin datos): `fase14_e4_autoridad_por_serie`,
`fase14_e4_excepciones_autorizadas`, `fase14_e4_sync_stel`,
`fase14_e4_revocar_anon_lecturas_admin`, `fase14_e4_revertir_conoce_clientes`.
SQL y rollback: `docs/database/PHASE_14_ENTREGA_4_SYNC_STEL_Y_AUTORIDAD_SERIE.sql`.

## 2. GATE: cómo se revalidó cada excepción

`scripts/fase14-e4-gate-excepciones.mjs` vuelve a mirar STEL (la lectura del dry run del mismo
momento, 0 llamadas extra) y decide APLICAR o RETENER. Lo que sale RETENER no entra al plan.

| Caso | Evidencia medida | Decisión |
|---|---|---|
| **COTI02530** | STEL: estado «Pendiente», última modificación 2026-09-03 19:03 (igual que en E2) · 0 derivados en STEL · 0 pedidos y 0 remitos en React · 0 eventos · React `accepted`, importada | **APLICAR** |
| **SP.2008VP/100** | las líneas usan un solo id de ítem (24934825) y es el del artículo · SKU exacto · marca SPEEDRILL · medida 8 mm · largo 100 mm (atributos estructurados de la descripción) · no borrado ni inactivo · React sin id externo | **APLICAR** |
| **8 líneas** | por línea: 0 referencias aguas abajo · 0 movimientos de stock · 0 eventos · fila idéntica al respaldo de E2 · STEL no volvió a incorporarlas | **APLICAR** (8/8) |
| **COTI02452** | STEL trae CUIT de 11 dígitos · el cliente React vinculado no tenía CUIT · ningún otro cliente de la empresa usa ese número · la cuenta de STEL resuelve a un único cliente | **APLICAR** |
| **SP.2007VPM/80** | el conflicto está **dentro de STEL**: nombre «LARGO MM 65», descripción «Largo: 80 mm», SKU `/80` | **RETENER** |

El aplicador (`fase14-e4-excepciones-aplicar.mjs`) además compara el plan contra el alcance
autorizado campo por campo (`fueraDeAlcance`): si el plan hiciera algo más —insertar un
documento, tocar otro campo, borrar una línea no aprobada— se detiene sin escribir. Salió vacío.

Plan aplicado: hash `093ff3c8fa0ed3434762a26403709a3ff34daab7f36ac7222cd64eb2bc793a3c`
(el dry run previo de E2 fue `10648971e863…`; el hash cambió porque el plan ahora incluye las
excepciones y los clientes).

### Lo que la base exige igual, aunque el plan venga aprobado

- `aprobar_estado_regresivo: true` habilita `accepted → sent`, pero la RPC **recuenta** los
  pedidos y remitos derivados y rechaza con `estado_regresivo_con_derivados` si hay alguno.
  Probado: con un pedido colgando, falla (§ 12).
- El CUIT sólo se carga si el cliente no tenía uno y **ningún otro** cliente de la empresa usa ese
  número (`cuit_en_conflicto`), y tiene que tener forma de CUIT.
- Los borrados siguen necesitando `aprobado: true` por línea y guardan la fila entera para revertir.

## 3. Reconciliación después de las excepciones

Medido sobre la lectura de STEL del momento de aplicar:

| | STEL_ONLY | REACT_ONLY | HEADER | LINE | CURRENCY | TOTAL | STATUS | CUSTOMER | RELATION |
|---|---|---|---|---|---|---|---|---|---|
| **quotes** | 0 | 0 * | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **orders** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **deliveries** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

\* COTI02499 sigue siendo React-only (STEL la borró; se conserva a propósito) y está declarada
como excepción aprobada en el preflight. Las otras dos excepciones permitidas —SP.2007VPM/80 y,
si hubiera seguido ambigua, COTI02452— no generan mismatch de documento.

## 4. Sync STEL → React

### 4.1 Cómo funciona

| Pieza | Decisión |
|---|---|
| Identidad | `products.external_source='stel'` + `external_id`. El SKU sólo sirve para no duplicar al **crear**; un SKU que ya existe con otro id devuelve `sku_existente` y queda para revisión humana |
| Incremental | La API **no** acepta filtro por fecha en `products` (devuelve E000003): se ordena por `utc-last-modification-date:desc` y se corta al llegar al checkpoint. Un día normal es **1 página** |
| Qué sincroniza | nombre, descripción, tipo (servicio) y estado (`inactive` → `discontinued`). Servicios incluidos (`/services`) |
| Qué **no** toca | SKU, categoría, marca, atributos, stock, y el precio de las líneas de documentos (eso es historia) |
| Bajas | `inactive` o `deleted` → `status = 'discontinued'`. **Nunca** borrado físico |
| Borrados en STEL | No aparecen en los listados (sólo por GET por id). Se detectan comparando totales; es una tarea mensual aparte, no del incremental |
| Nuevos | Se crean sólo con `--crear-nuevos`, con tope (`--max-nuevos`), en la categoría de revisión y con `needs_review = true` |
| Checkpoint | `public.stel_sync_state` (server-side, **nunca** localStorage): fecha de modificación y último id vistos, estado, error, llamadas y resumen |
| Candado | Dueño + vencimiento (30 min) en la misma tabla, más el índice único de corridas en curso: dos sync de la misma empresa no arrancan a la vez (`sync_en_curso`) |
| Reintento / resume | Si una corrida falla, el checkpoint **no** avanza y la siguiente retoma desde el último punto bueno |
| Rate limit | Pacing de 1250 ms, timeout 45 s, 3 reintentos con backoff exponencial y 61 s en un 429, presupuesto máximo de llamadas por corrida |
| Auditoría | Cada escritura va a `stel_reconciliation_log` con el run: se puede revertir con `stel_revertir_reconciliacion` |

### 4.2 Llamadas medidas (cupo compartido con Make)

| Corrida | Llamadas reales |
|---|---|
| Catálogo incremental (30 días, 61 ítems) | **2** |
| Catálogo incremental sin novedades | **2** |
| Delta de documentos (ventana de 7 días) | **17** (12 de ellas son el maestro de clientes, que la API no filtra) |
| Reconciliación completa | 59 |

Frecuencia propuesta: **catálogo 1 vez por día** (2 llamadas) y **documentos 1 vez cada 6 h**
(4 × 17 ≈ 68) o 1 vez por día si el cupo está justo, más una corrida manual antes del corte.
Nunca un full scan diario: el escaneo completo de productos son ~75 llamadas.

### 4.3 Lo que no se puede sincronizar

- **Unidad de medida**: `products` en React no tiene columna de unidad. Si hace falta, es un
  cambio de esquema aparte.
- **Marca**: STEL la trae dentro del texto de la descripción («Marca: X»), no como campo. Se
  decidió **no** adivinar: la marca la sigue manejando React.

## 5. Autoridad por serie (RT vs RT-ML)

El modelo anterior era `(empresa, tipo de documento)`. Eso no alcanza para decir «los remitos RT
los emite el ERP, pero RT-ML los sigue emitiendo STEL».

**Mecanismo elegido — tabla aparte, no se tocó el modelo existente:**
`public.document_numbering_authority_series (company_id, doc_type, series_code, authority, reason)`.
Resolución en `app.autoridad_efectiva(empresa, tipo, serie)`: **primero la fila de serie, si no la
de tipo, y si no hay nada, ERP**. Con la tabla vacía el comportamiento es idéntico al anterior,
así que es compatible hacia atrás por construcción. Hoy está **vacía** para Buscatools.

Puertas que ya conocen la serie: `next_document_number` (resuelve qué serie va a consumir antes de
pedir permiso), el trigger `app.guardar_autoridad_numeracion` (usa `new.series_code`, así que
`confirmar_entrega` queda cubierto sin tocarla) y la importación desde STEL, que ahora rechaza con
`serie_emitida_por_el_erp` si la serie ya pasó al ERP (§ 10).

`autoridad_numeracion_empresa` sigue devolviendo una fila por tipo: la UI no cambia de
comportamiento y el aviso de STEL no queda pegado por una excepción de serie.

**RT-ML = IMPORT_ONLY.** No existe secuencia `RT-ML` en React y no se crea. La fila
`(delivery, 'RT-ML', 'STEL')` **no se insertó**: es el paso 8b del checklist del corte, porque
tocar `document_numbering_authority*` de Buscatools está fuera de esta entrega.

## 6. Tarifas de STEL vs listas de React

`scripts/fase14-e4-tarifas-auditoria.mjs` (2 llamadas). STEL no expone moneda por tarifa ni la
tarifa en el documento; **sí** expone `rate-id` por cliente.

| STEL_RATE (nombre en el archivo ignorado) | CURRENCY | ACTIVE_PRODUCTS | RECENT_USAGE (renglones último año) | PROPOSED_REACT_MAPPING |
|---|---|---|---|---|
| -2 · Category Rate | n/d | 0 | 0 | ninguno (es interna de STEL) |
| 13741 · tarifa de cliente 1 | n/d | 720 | 1193 | **sin mapear** |
| 15419 · tarifa de cliente 2 | n/d | 720 | 1193 | **sin mapear** |
| 15420 · tarifa de cliente 3 | n/d | 720 | 1195 | **sin mapear** |
| 15421 · tarifa de cliente 4 | n/d | 720 | 1195 | **sin mapear** |
| 15422 · tarifa de cliente 5 | n/d | 720 | 1195 | **sin mapear** |
| 15423 · tarifa de cliente 6 | n/d | 720 | 1193 | **sin mapear** |
| 15424 · tarifa de cliente 7 | n/d | 720 | 1193 | **sin mapear** |
| 16266 · tarifa de cliente 8 | n/d | 720 | 1195 | **sin mapear** |
| 18464 · tarifa de cliente 9 | n/d | 720 | 1190 | **sin mapear** |
| 19324 · tarifa de cliente 10 | n/d | 720 | 1193 | **sin mapear** |
| 19516 · tarifa de cliente 11 | n/d | 720 | 1192 | **sin mapear** |
| — · precio de catálogo (`sales-price`) | **USD** (medido) | 767 | explica 1193 de 2007 renglones USD | **Lista base (USD)** |

**Por qué ninguna tarifa se mapea:** las 11 tarifas con nombre tienen **el mismo precio que el
catálogo** en 752 de 767 productos; las diferencias afectan entre 1 y 8 productos por tarifa. Es
decir, hoy no son listas distintas. El «uso reciente» sale todo parecido justamente por eso: no se
puede distinguir qué tarifa se usó mirando el precio. La asignación real vive en el cliente
(`rate-id`), y leerla son 1001 llamadas (una por cuenta): fuera del cupo operativo y, sobre todo,
sin sentido mientras los precios coincidan.

**Moneda:** STEL no declara la moneda de sus precios, pero se midió: en documentos USD, 1193 de
2007 renglones tienen exactamente el precio de catálogo; en documentos ARS la relación mediana es
~1172 (el tipo de cambio). El catálogo de STEL está en **USD**, igual que las 3 listas de React.

### Decisión de listas (§ 9 del pedido)

- **No** se crean 12 listas (serían copias entre sí) y **no** se destruye ninguna de las 3 que hay.
- Mapeo explícito implementado: **precio de catálogo de STEL (USD) → «Lista base» (USD, la
  predeterminada)**. Es el único mapeo que la evidencia sostiene.
- Las 11 tarifas con nombre quedan **sin mapear**: mapearlas requiere decidir si React va a modelar
  listas por cliente y leer la asignación cuenta por cuenta. **Decisión empresarial: se detiene esa
  parte y se reporta**, como pide el punto 9.

## 7. Precios: el desfasaje ×3 y su alineación (E4.5)

### 7.1 El hallazgo

Medido sobre los 765 productos vinculados, antes de tocar nada:

| Medición | Valor |
|---|---|
| Con precio de catálogo en STEL | 719 |
| Precio ya igual en React | 26 |
| Precio distinto | **666** |
| De esos, React = STEL × **3,000** exacto | **649** |
| Sin precio en React | 27 |

Ejemplos: `GE.TSN125A` React 2244 / STEL 748 · `SP.PH2` React 5,43 / STEL 1,81 ·
`PRO12575` React 1620 / STEL 540.

Y lo que dicen los documentos reales: PRO12575 se vendió a **540** en COTI02505, PDV01314 y
RT0000001426; PRO12576 a **18,2**. Es decir, **se vende al precio de STEL**, no al de la lista.
La «Lista base» viene del catálogo legacy con un margen ×3 y quedó desfasada; STEL es el maestro
operativo y es lo que se factura. Sin alinear, el ERP habría cotizado al triple desde el día uno.

### 7.2 Qué se aplicó

Con autorización explícita (E4.5), releyendo STEL antes de escribir:
`scripts/fase14-e45-precios-alineacion.mjs`.

| | Valor |
|---|---|
| Plan | `5ef349bf45aa8986b41ed9685f692118eeb26478a9807be10fac6461807ed8d7` |
| Run | `e948d627-6f64-4780-a673-7718cead8209` |
| Fuente | `sales-price` del catálogo de STEL (USD), nunca una fórmula, un documento, otra tarifa ni FX |
| Destino | **sólo** «Lista base» (USD, la predeterminada) |
| Precios actualizados | **665** |
| Precios creados (React no tenía) | **27** |
| Ya iguales | 26 |
| Bloqueados / a revisión | 47 (§ 7.4) |
| Documentos históricos modificados | **0** |

Las otras dos listas quedaron intactas (124 precios cada una, datos de prueba de Fase 3) y
tampoco se tocó ninguna línea de documento, total, stock, secuencia ni autoridad: la huella por
tabla de todo eso es idéntica antes y después.

### 7.3 Los casos que no eran ×3

20 productos tenían una diferencia real de precio sin ser exactamente el triple:

- **3** son ×3 con redondeo (`PRO12411` 2,99998 · `TC.CL140NX15D-MH` 2,99996 · `TE.9346.0` 3,00002);
- **15 subían** de precio al alinear (familia `TE.*`: STEL los remarcó entre marzo y agosto de
  2026 y React tenía el valor viejo). Contrastado con ventas: `TE.9361` se vendió a 2226 y
  `TE.HEAVY.75` a 3198, exactamente el catálogo nuevo de STEL;
- **2** con otro ratio: `SP.VPEM5/100` (4,07; se vendió a 37,42 = el precio de STEL) y
  **`TE.9323`** (1,51), el único donde la última venta registrada (534,20) no se explica ni por
  el catálogo de STEL (191,10) ni por el de React (288,86). Se alineó igual, porque la regla
  autorizada es explícita —el catálogo de STEL manda y el precio de los documentos no se usa como
  fuente— pero queda anotado acá por si el negocio quiere revisarlo.

Se evaluó y **se descartó** usar «la última venta» como guardia automática: marca 44 productos, y
en casi todos la venta fue negociada o simbólica (ratios de 0,004 a 8) mientras el catálogo seguía
siendo ×3 limpio. Habría bloqueado alineaciones correctas por una señal ruidosa.

### 7.4 Lo que quedó sin alinear (47)

| Clase | Cantidad | Qué es |
|---|---|---|
| `HUMAN_REVIEW` | 27 | 25 ítems inactivos o borrados en STEL y 2 cuyo id vinculado ya no se puede leer. **Ninguno tiene precio en React**: no hay nada desalineado, hay que decidir si el producto sigue vivo |
| `NO_STEL_PRICE` | 19 | STEL no tiene precio de catálogo para ese ítem. Tampoco lo tienen en React |
| `DATA_CONFLICT` | 1 | `IR.QA1L08C4LD`: la referencia hoy devuelve el ítem STEL 41790901 y el producto está vinculado al 41455829. Es el **único** caso que queda con una diferencia real de precio (React 12300 · STEL 4100) y se deja como está hasta que una persona decida a qué ítem corresponde |

El preflight lee esa clasificación (`scripts/output/e45/verificacion.json`) y la informa aparte en
`noAlineables` en vez de contarla como desalineada; si el archivo no está, cuenta estricto.

### 7.5 Idempotencia y mantenimiento

Segunda corrida del dry run inmediatamente después: **PRICES_TO_UPDATE = 0**, 718 ya iguales.
De ahí en más lo mantiene el sync incremental de E4: cuando STEL cambia un precio, la corrida
diaria lo escribe en «Lista base», el checkpoint avanza y la siguiente no hace nada (probado en
fixture con 1 sola llamada, sin full scan).

**FX_POLICY = NONE_FOR_INITIAL_CUTOVER.** Las listas tienen moneda obligatoria a nivel de esquema
(`price_lists.currency_code NOT NULL`) y las 3 son USD. Una cotización en ARS no recibe precios
sugeridos de una lista USD (regla de E3): se carga el precio a mano. No hay conversión automática.

## 8. Delta de documentos durante la coexistencia

`sincronizarDocumentos` reutiliza la reconciliación de E2 sobre una ventana de fechas:

- **incremental** (desde el checkpoint) e **idempotente**: repetir el mismo delta da
  `documento_ya_existe` y no duplica;
- **sin efectos de stock** y **sin consumir secuencias** (verificado en la suite);
- **no crea productos ni resuelve clientes por heurística**: si el delta necesitara eso, se detiene
  y lo reporta para una corrida manual;
- corre bajo el mismo candado y la misma bitácora que el resto.

Medición de hoy: delta pendiente **0**.

## 9. Observabilidad (§ 16)

Configuración → Numeración, al pie: «Sincronización con STEL». Por entidad muestra estado
(Al día / En curso / Con error / Sin correr), cuándo fue la última corrida, el punto de control,
el último id visto, cuántas llamadas usó y el error si lo hubo. Es **sólo lectura**: no hay botón
para lanzar un sync. La RPC `stel_sync_estado` la ejecuta únicamente un admin de la propia empresa
(anon no tiene EXECUTE) y no devuelve nada relacionado con la clave de la API.

## 10. Guard de emisión de STEL después del corte (§ 21)

Si después del freeze apareciera un documento nuevo de STEL en una serie que ya emite el ERP,
importarlo silenciosamente crearía una colisión de numeración. Ahora la base lo impide:
`stel_reconciliar_documento`, al insertar, resuelve la autoridad de esa serie y si es `ERP` corta
con **`serie_emitida_por_el_erp:<tipo>:<serie>`**. El delta falla con ese error, queda en
`stel_sync_state.last_error` y se ve en la pantalla de Numeración. Eso es la alerta: nada entra por
la ventana. La serie RT-ML, que sigue siendo de STEL, se importa normalmente (probado).

## 11. Plan de alineación de secuencias (calculado, NO ejecutado)

`next = max(next actual, último de STEL + 1, mayor de React + 1)`, por serie real, sin bajar nunca.

| Serie | next hoy | Último STEL | Mayor React | **next propuesto** | Nota |
|---|---|---|---|---|---|
| quote / COTI (pad 5) | 2629 | COTI02555 | COTI02555 | **2629** (COTI02629) | ya está por encima; los huecos se conservan |
| sales_order / PDV (pad 5) | 1316 | PDV01318 | PDV01318 | **1319** | excluye los 9 `PDV11xxx` (§ abajo) |
| delivery / RT (pad 10) | 1424 | RT0000001432 | RT0000001432 | **1433** | |
| delivery / RT-ML | no existe | RT-ML2025000061 | (5 importados) | **no se crea** | IMPORT_ONLY |

Los 9 `PDV11xxx` son un bloque de numeración del propio STEL que convive con los `PDV01xxx` sin ser
su continuación: no empujan la serie. El riesgo queda acotado porque `(company_id, number)` es
**único** en las tres tablas: si dentro de ~10.000 pedidos el ERP llegara a `PDV11292`, la base
rechaza el insert; no hay forma de duplicar un número en silencio.

Se recalcula en el momento del corte (T4/T7): STEL sigue emitiendo.

## 12. Tests

| Suite | Resultado |
|---|---|
| `scripts/fase14-e4-sync-cutover-tests.mjs` (nueva) | **TODO PASA** — excepciones, sync, precios, checkpoint/candado, autoridad por serie, delta, ensayo de corte, funciones puras, limpieza |
| `scripts/fase14-e45-precios-tests.mjs` (nueva) | **TODO PASA** — clasificación, escritura acotada a la lista por defecto, sync incremental de precio con checkpoint, y cotización → pedido con el precio alineado |
| `scripts/fase14-e3-cutover-readiness-tests.mjs` | TODO PASA |
| `scripts/fase14-stel-e2-tests.mjs` | ALL PASS |
| `scripts/fase14-stel-api-reconcile-fixture-tests.mjs` | ALL PASS |
| `scripts/fase14-ventas-cutover-fixture-tests.mjs` | TODO PASA |
| `scripts/fase12-configuracion-entrega25-stel-guard-tests.mjs` | TODO PASA |
| `lint` · `typecheck` · `test` · `test:isolated` · `build` | OK |

Cubre explícitamente lo pedido: reconciliación de excepciones, sync incremental de productos,
idempotencia, checkpoint, reintento/backoff, candado y concurrencia, producto inactivo, mapeo de
precios, multi-moneda, RT-ML import-only, autoridad por serie, delta de documentos, ensayo de corte
y funciones del preflight.

Unitarios nuevos: `src/modules/configuracion/lib/sync-stel.test.ts` (10 casos) y tres casos más en
`NumeracionPage.test.tsx`, incluido uno que verifica que la pantalla no muestre nada parecido a una
clave de API.

## 13. Preflight

`node scripts/fase14-cutover-preflight.mjs [--snapshot <hash>]` (sólo lectura).

| Criterio | Hoy |
|---|---|
| STEL_REACHABLE | ✔ |
| LAST_QUOTE / LAST_ORDER / LAST_DELIVERY | COTI02555 · PDV01318 · RT0000001432 |
| DELTA_PENDING | 0 |
| RECONCILIATION_MISMATCHES | 0 |
| PRODUCT_SYNC_OK | ✔ (última corrida `finished`, checkpoint 2026-09-15 18:20) |
| PRICE_MAPPING_DEFINED | ✔ |
| **PRICE_SYNC_OK** | ✔ 0 desalineados, 0 sin precio; 47 no alineables con motivo (§ 7.4) |
| RTML_POLICY_OK | ✔ (sin secuencia RT-ML) · fila de autoridad de serie: pendiente para el corte |
| SEQUENCE_PLAN_SAFE | ✔ (ningún próximo propuesto está ocupado y ninguna secuencia baja) |
| SEQUENCE_COLLISIONS | 2 — esperado: PDV y RT todavía emitirían un número usado; lo arregla T7 |
| STOCK_INVARIANTS | ✔ 0 reservas, 0 saldos negativos |
| CURRENCY_INVARIANTS | ✔ 0 documentos sin moneda, lista por defecto con moneda |
| AUTHORITY_CURRENT | quote=STEL, sales_order=STEL, delivery=STEL |
| CUTOVER_REHEARSAL | ✔ PASS (13/13) |
| ROLLBACK_DOCUMENTED | ✔ (§ 15) |

**FINAL: READY.** READY significa que no queda nada técnico por resolver, **no** que haya que
cortar: el corte se ejecuta con el checklist del § 14 y con autorización explícita.

## 13 bis. CUTOVER EJECUTADO — 2026-09-16 02:05 UTC

`CUTOVER_RUN_ID = cutover-2026-09-16-a7f3c2e1` (migración `fase14_cutover_buscatools_erp`).

Se ejecutó el corte productivo de Buscatools para **quote**, **sales_order** y la serie normal
**RT**, con el freeze de STEL confirmado por el usuario. **RT-ML quedó fuera**, en STEL.

### Gate previo (02:02 UTC, lectura fresca de STEL)

| Criterio | Valor |
|---|---|
| DELTA_PENDING | 0 (delta final aplicado: 0 documentos nuevos) |
| RECONCILIATION_MISMATCHES | 0 |
| PRODUCT_SYNC_OK · PRICE_SYNC_OK | ✔ · ✔ |
| Stock · Moneda | ✔ 0 reservas, 0 saldos negativos · ✔ 0 documentos sin moneda |
| Últimos de STEL | COTI02555 · PDV01318 · RT0000001432 |

### Lo que cambió, en una sola transacción

Con verificaciones adentro: si la autoridad ya no era STEL, si había filas de autoridad por serie,
si las secuencias se habían movido desde el gate o si el próximo número de cualquier serie ya
existía, la transacción abortaba sin aplicar nada.

| | Antes | Después |
|---|---|---|
| authority quote | STEL | **ERP** |
| authority sales_order | STEL | **ERP** |
| authority delivery | STEL | **ERP** |
| authority serie RT-ML | (no existía) | **STEL** (import-only) |
| secuencia COTI | 2629 | 2629 (ya estaba por encima) |
| secuencia PDV | 1316 | **1319** |
| secuencia RT | 1424 | **1433** |

Ninguna secuencia bajó. Hash de stock y de movimientos idéntico antes y después; cantidad de
documentos idéntica (304 / 170 / 192). Las cuatro filas quedaron en
`document_numbering_authority_audit` con la misma marca de tiempo: una sola operación.

### Verificación inmediata

- Resolución de autoridad: COTI → ERP · PDV → ERP · RT → ERP · **RT-ML → STEL**.
- «Nueva cotización» habilitada para el admin y sin el aviso de STEL en pantalla.
- RT-ML sigue sin secuencia en React y su serie sigue en STEL.
- Colisiones: 0. Ningún documento ocupa un número desde el próximo de cada serie en adelante.
- RLS y roles: no se tocó ninguna política. La matriz de roles la cubren las suites de E3 y E4,
  incluido el ensayo con la autoridad ya en ERP.

### Bug encontrado por el smoke test

Al crear la primera cotización apareció un defecto que hasta ahora **no se podía ver**, porque el
ERP nunca había podido emitir: en un documento nuevo, `BuscadorCliente` mostraba el campo de
búsqueda pero dejaba la consulta deshabilitada (`enabled: … && abierto`, y `abierto` sólo se
encendía con el botón «Cambiar», que únicamente existe cuando ya hay un cliente elegido). Resultado:
«Ningún cliente activo coincide» para cualquier texto, y ninguna forma de elegir cliente.

Arreglado en el momento: la búsqueda se habilita cuando el campo está a la vista
(`editable && (valor === null || abierto)`), con cinco casos de regresión en
`BuscadorCliente.test.tsx`.

### Smoke test productivo

**COTI02629** — Cliente de prueba · 16/09/2026 · USD · serie COTI · borrador.

| Verificación | Resultado |
|---|---|
| Número | COTI02629, el que seguía; la secuencia quedó en 2630 |
| Moneda | USD explícita (el alta no trae moneda por defecto) |
| Precio | BR.PH1 a **USD 31,16**, que es el precio actual de STEL. El viejo ×3 (93,48) no aparece |
| Línea | 1 unidad, 0 % de descuento, IVA 21 % |
| Totales (los calcula el servidor) | subtotal 31,16 · impuestos 6,54 · **total 37,70** |
| Persistencia | se guardó, se salió del documento y al reabrirlo está igual |
| En la base | `imported_at`, `external_source` y `legacy_source` en NULL: es un documento propio del ERP, no una importación |
| Efectos | 1 evento de auditoría, **0 movimientos de stock**, hash de stock sin cambios |

**Se frenó ahí**: no se convirtió a pedido ni se generó remito.

### Monitoreo post-corte (02:31 UTC)

STEL sigue respondiendo y sus últimos números **no se movieron** (COTI02555 · PDV01318 ·
RT0000001432): no hubo emisión en STEL después del freeze, así que no hay alerta crítica.
DELTA_PENDING 0 · RECONCILIATION_MISMATCHES 0 · colisiones 0 · sync de catálogo y de documentos en
`finished` y sin candado · autoridad ERP ×3 · RT-ML STEL.

El preflight ahora descuenta los documentos emitidos por el ERP (los que no tienen `imported_at`)
al contar faltantes: que COTI02629 no exista en STEL es el corte funcionando, no un desfasaje.

### Pendiente inmediato

La aplicación desplegada en `app.buscatools.com` **todavía corre el build anterior**: la rama
local no está pusheada. El corte ya está vivo en la base, así que quien entre hoy a la app
desplegada puede emitir, pero sin los arreglos de E3, E4 y el del buscador de clientes. **Conviene
desplegar antes de avisarle al equipo que puede empezar a usar el ERP.**

## 14. CHECKLIST DEL FREEZE (ejecutado el 2026-09-16; ver § 13 bis)

Cada paso con responsable y verificación. Nada de esto corrió sobre Buscatools.

| # | Paso | Responsable | Verificación |
|---|---|---|---|
| 1 | Avisar a los usuarios: ventana y qué deja de poder hacerse en STEL | Jano | Aviso enviado |
| 2 | Los usuarios dejan de emitir COTI/PDV/RT en STEL | Ventas | Nadie crea documentos nuevos |
| 3 | Verificar que no queden operaciones en vuelo | Jano | Sin actividad en STEL |
| 4 | Leer STEL: `fase14-cutover-preflight.mjs` | Sistema | ~60 llamadas, sin errores |
| 5 | Delta final: `sync-stel.mjs documentos --aplicar` | Sistema | `DELTA_PENDING = 0` |
| 6 | Alinear precios si se autorizó (§ 7) | Jano | `PRICE_SYNC_OK` ✔ |
| 7 | Reconciliación completa | Sistema | `RECONCILIATION_MISMATCHES = 0` salvo excepciones aprobadas |
| 8 | Últimos números por serie, incluidas RT-ML y los PDV11xxx | Sistema | Anotados |
| 9 | Alinear `document_sequences` al valor propuesto (§ 11) | Jano | `next` > último de STEL en cada serie; ninguna baja |
| 9b | Insertar `(delivery, 'RT-ML', 'STEL')` en `document_numbering_authority_series` | Jano | `RTML_SERIES_ROW` ✔ |
| 10 | Cambiar `document_numbering_authority` a ERP (quote → sales_order → delivery) | Jano | Queda en la bitácora de autoridad |
| 11 | Login en React y recargar (la UI se habilita sola, no hace falta deploy) | Ventas | Botones activos, aviso de STEL desaparecido |
| 12 | Smoke test: cotización → pedido → remito, y despacho controlado si se autoriza | Ventas + Jano | Números correlativos |
| 13 | Verificar números, stock y cumplimiento del smoke test | Jano | Stock descontado una vez; sin huecos |
| 14 | Monitoreo de los primeros documentos y de `stel_sync_state` | Jano | Sin `serie_emitida_por_el_erp`, sin duplicados |

## 15. ROLLBACK DEL CORTE

**Principio: nunca bajar un número.** Si el ERP ya emitió, esos números están usados para siempre.

1. `update document_numbering_authority set authority = 'STEL', reason = '<motivo>'` para los tres
   tipos. La base y la UI vuelven a bloquear solas (la UI, al recargar: cache de 5 minutos).
2. Borrar la fila de `document_numbering_authority_series` de RT-ML sólo si se había insertado y se
   quiere volver al modelo por tipo. No es obligatorio: con el tipo en STEL, la fila de serie STEL
   es redundante.
3. **STEL tiene que continuar por encima del máximo que emitió React.** Antes de que STEL vuelva a
   emitir, leer el mayor número de cada serie en React y configurar en STEL el siguiente. Si no se
   hace, STEL repite números que React ya usó y la próxima importación choca contra el índice único
   `(company_id, number)`.
4. Las secuencias de React **no se tocan**: quedan donde están, listas para un segundo intento.
5. Los documentos que el ERP haya emitido se quedan en React (no se borran) y hay que cargarlos a
   mano en STEL si el negocio los necesita allá.
6. Revertir escrituras de reconciliación o de sync, si hiciera falta:
   `node scripts/fase14-stel-e2-reconciliacion.mjs revertir --run <uuid> --autorizo-reversion`.

Rollback de las migraciones de E4: al pie de
`docs/database/PHASE_14_ENTREGA_4_SYNC_STEL_Y_AUTORIDAD_SERIE.sql`. Ninguna borra datos de negocio.

## 16. Ensayo de corte (fixture, PASS)

13 pasos sobre una empresa `zz-f14e4-corte`, sin tocar Buscatools:

| # | Paso | Resultado |
|---|---|---|
| 1 | Con autoridad STEL, el ERP no numera | bloqueado ✔ |
| 2 | Delta final importado | COTI02555 ✔ |
| 3 | Último número leído y próximo calculado | COTI02555 → 2556 ✔ |
| 4 | Secuencia alineada sin bajar | next = 2556 ✔ |
| 5 | Autoridad → ERP | ✔ |
| 6 | Cotización nueva con el número correcto | COTI02556 ✔ |
| 7 | Pedido desde la cotización | ✔ |
| 8 | Remito en borrador | RT0000000001 ✔ |
| 9 | Despacho confirmado | ✔ |
| 10 | Stock descontado una sola vez | 10 → 8 ✔ |
| 11 | Cancelar un remito despachado | `DELIVERY_ALREADY_DISPATCHED` ✔ |
| 12 | Reintento del despacho | idempotente, stock sin cambios ✔ |
| 13 | Rollback de autoridad | vuelve a bloquear y la secuencia **no baja** (2557) ✔ |

## 17. Seguridad

- La clave de STEL vive sólo en `.env.stel.local` (ignorado por git, `.gitignore:14`), se manda
  únicamente como header `APIKEY`, se redacta de cualquier texto de error y no aparece en ningún
  output, log, commit ni test. **0 frontend, 0 bundle.**
- Todas las RPC de sync y reconciliación son `service_role` y nada más: `revoke` explícito a
  `public`, `anon` y `authenticated`. Las dos lecturas nuevas para el panel de administración
  (`stel_sync_estado`, `autoridad_numeracion_series`) están revocadas para `anon` y verifican el rol
  adentro.
- `stel_sync_state` y `document_numbering_authority_series` tienen RLS activo y ninguna política:
  no se llega a ellas desde la app, sólo por funciones SECURITY DEFINER.
- Los roles de la aplicación no tienen ninguna vía a los internals de sync o reconciliación
  (probado con employee: `sin_permiso`).

## 18. Lo que queda

1. **Mapeo de las tarifas por cliente**: decisión de negocio (§ 6). La alineación de precios de
   catálogo ya se hizo (§ 7).
2. `TE.9323` e `IR.QA1L08C4LD`: dos precios que conviene que mire una persona (§ 7.3 y § 7.4).
3. SP.2007VPM/80: conflicto interno de STEL, necesita que una persona diga cuál es el largo real.
4. Productos nuevos de STEL que todavía no están en React (11 en la última ventana): crear con
   `--crear-nuevos` antes del corte, o quedan sin poder cotizarse.
5. Freeze, alineación de secuencias y cambio de autoridad: § 14, con autorización explícita.
6. Fila de autoridad de serie para RT-ML: paso 9b del checklist.
7. Cron del sync: los scripts existen y están medidos, falta agendarlos (§ 4.2).
8. Flujo de devolución de un remito despachado (sigue pendiente desde E3).

**CUTOVER_SUCCESS = YES** (2026-09-16 02:05 UTC, § 13 bis). El ERP numera y emite cotizaciones,
pedidos y remitos de la serie RT; RT-ML sigue siendo de STEL. Falta desplegar la rama para que la
app publicada tenga los arreglos de E3, E4 y el del buscador de clientes.
