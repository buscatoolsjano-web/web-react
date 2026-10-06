# FASE 40 — LOS BLOQUEADOS DEL SYNC STEL

> Cinco documentos de STEL no entraban al ERP y **nadie sabía cuáles**. Esta entrega los hace visibles,
> resuelve cuatro y deja escrito por qué el quinto no se toca desde acá. STEL sigue siendo la autoridad de
> numeración de COTI, PDV, RT y RT-ML; no se tocaron `document_numbering_authority`, secuencias, stock,
> avisos ni STEL. Fecha: 2026-10-06. Código: commit `eb9c87f`.

## 0. Resultado

| | |
|---|---|
| Bloqueados antes | **5** (1 estado regresivo, 3 clientes sin match, 1 número repetido) |
| Bloqueados después | **1** (RT0000001383, que se arregla en STEL — § 5) |
| Documentos que entraron | **3** cotizaciones (COTI02573, COTI02576, COTI02582) |
| Clientes creados | **3** (CLI01225 SOLICAM, CLI01226 AGEA S.A., CLI01227 SENSIMAT S.A) |
| RECONCILIATION_RUN_ID | `26fce5b4-6ad3-4844-ba90-24853229082e` (§ 6) |
| Invariantes | Secuencias, autoridad, stock y movimientos **idénticos** al baseline |

## 1. Por qué estuvieron invisibles

El resumen del sync guardaba `bloqueados: 5` y nada más. El detalle existía **sólo dentro del plan**, que
vive en un archivo ignorado por git, en la máquina de quien corrió el sync. Un número no se puede abrir.

Un bloqueado **no es un error**: es el planificador negándose a tocar algo porque hace falta que una persona
decida. Para que esa persona decida, tiene que poder ver qué es.

| Cambio | Dónde |
|---|---|
| El detalle va al resumen → queda en `stel_reconciliation_runs.summary`, consultable desde la base sin el archivo | `scripts/lib/stel-sync.mjs` |
| Tope de 50 casos: son para resolver a mano; si alguna vez son cientos, el problema es otro | ídem |
| El plan se devuelve también cuando la corrida **aplica**, no sólo en sólo-lectura: los bloqueados no desaparecen porque el resto se haya aplicado | ídem |
| El CLI los imprime uno por línea, con tipo, número y motivo | `scripts/fase14-e4-sync-stel.mjs` |

## 2. COTI02531 — aceptada con pedido derivado no es una regresión

Bloqueada por `ESTADO_REGRESIVO`: el ERP decía `accepted` y STEL «Pendiente». Es el **mismo documento** en
los dos lados (`external_id` 59789717).

Pero el pedido **PDV01303** lo derivó **STEL mismo** de esa cotización (id STEL 59789722, confirmado, USD
702,34). Lo que quedó viejo es el estado de la cotización en STEL, no el del ERP.

Las dos salidas que existían estaban mal para este caso:

- **bloquear** deja el documento trabado para siempre, porque no hay nada que decidir ni nada que arreglar
  del lado del ERP;
- **aprobarlo como excepción** *escribe* la regresión (`accepted` → `sent`), o sea le borra a la cotización
  el hecho de que ya hay un pedido.

Se agregó una tercera: **ni se bloquea ni se escribe**. El estado del ERP se deriva de un hecho que existe y
se queda como está; el caso queda anotado en `info.aceptadasConPedidoQueStelDejoPendiente` para que se vea
que pasó y no parezca que nadie lo miró.

La regla es angosta a propósito: sólo `accepted` (no `rejected`) y sólo si la cotización tiene pedido
derivado. **Sin pedido, una regresión sigue bloqueando.**

Tests (suite E2, con el MISMO STEL y el pedido como única variable):

- sin pedido derivado: sigue bloqueando (`ESTADO_REGRESIVO`, accepted vs Pendiente);
- con pedido derivado: no se bloquea;
- y no se escribe el estado — la cabecera no lleva `status`;
- y queda anotado en `info`.

## 3. Tres clientes que STEL tenía y el ERP no

El sync nunca crea clientes por heurística, a propósito. Los tres no existían en el ERP **ni por CUIT, ni por
nombre, ni por dominio de mail**. El nombre de cuenta en STEL es la persona de contacto, no la empresa: la
razón social está en `legal-name`.

| Ref ERP | Razón social | CUIT | Cuenta STEL | Contacto | Desbloquea |
|---|---|---|---|---|---|
| CLI01225 | SOLICAM | 30-71759555-2 | 18003914 (CLI01238) | Agustin Romero · agustin.romero@solicam.com.ar | COTI02573 |
| CLI01226 | AGEA S.A. | 30-50012415-2 | 18038835 (CLI01239) | Mendoza Pineda · imendoza@agea.com.ar | COTI02576 |
| CLI01227 | SENSIMAT S.A | 30-62914200-9 | 18135883 (CLI01240) | — | COTI02582 |

Creados con la RPC real de la app (`crear_cliente`), que trae su validación, su numeración CLI y su evento de
auditoría — no con un `insert` a mano. Ensayado primero en una transacción que revierte. Cada uno queda único
por CUIT, así que el planificador los resuelve `POR_CUIT_OK` sin aprobar nada.

**Sin dirección a propósito:** STEL tiene la provincia pero no la calle, y la base exige calle
(`CALLE_REQUERIDA`). La zona quedó escrita en las notas del cliente, junto con la cuenta STEL de origen y la
cotización que desbloquea.

## 4. COTI02582 entró sola

En cuanto existió el cliente SENSIMAT, el **sync automático** (el que corre desde el checkpoint) la levantó
por su cuenta y creó sus 3 productos nuevos:

| Run | Hora UTC | Resultado |
|---|---|---|
| `55e7f427-…` | 19:18:14 → 19:18:22 | productos: leídos 3, **creados 3** (PRO12665, PRO12666, PRO12667) |
| `da60cf53-…` | 19:18:24 → 19:19:02 | documentos: **insertados 1** (COTI02582, USD 133,72, 3 líneas) |

COTI02573 y COTI02576 **no** las levantó, y está bien: fueron modificadas el 24/09 y el 30/09, antes del
checkpoint, así que el incremental no las ve. Para ésas hace falta la lectura completa — § 6.

## 5. Lo que no se arregla desde el ERP

### RT0000001383 — el número está repetido **dentro de STEL**

| STEL id | Fecha | Total | Líneas | Estado | En el ERP |
|---|---|---|---|---|---|
| 58288662 | 2026-07-23 | USD 502,14 | — | 831766 | sí, entregado |
| 60951071 | 2026-10-05 | USD 767,78 | 11 | Pendiente de facturar | no |

Los dos con `reference: 0000001383` y la **misma serie** (`serial-number-id` 436239). Verificado contra la
API el 2026-10-06: 58288662 sigue siendo RT0000001383.

El ERP se niega bien (`ID_EXTERNO_DISTINTO`): meter el segundo pisaría al primero. **Se arregla renumerando
uno de los dos en STEL**; cuando eso pase, el sync lo levanta solo.

### SP.2007VPM/80 — retenido por el gate de E4, y sigue bien retenido

| | |
|---|---|
| Nombre en STEL | SPEEDRILL 2007VPM EMBOCADURA LARGO **MM 65** ENCASTRE 1/4 HEX |
| Descripción en STEL | Largo: **80 mm** |
| SKU | SP.2007VPM/**80** (idéntico en los dos lados) |
| Nombre en el ERP | SPEEDRILL 2007VPM/80 POWER DRIVE NUTSETTER |

Decisión previa, en `scripts/fase14-e4-gate-excepciones.mjs`: `RETENER` —
*«DATA_CONFLICT_REQUIRES_HUMAN: el conflicto está dentro de STEL (nombre 65 mm vs descripción 80 mm vs SKU
/80). No se modifica.»* Hay además un guardrail que falla a propósito si alguien intenta aplicarlo.

El SKU coincide exacto, pero **eso no alcanza**: la pregunta no es cómo se llama el artículo, es qué artículo
es. Si el de STEL es realmente de 65 mm, vincularlo le vuelca precios y stock al de 80. El hermano
`SP.2007VPM/100` sí está vinculado, pero para ése el gate verificó medida y largo (8 y 100, los dos
coinciden); para el /80 esos chequeos están en `null` justamente porque los datos se contradicen.

Se resuelve en STEL, decidiendo qué medida es la correcta.

### COTI02499 — residuo de la migración, no bloquea nada

Viene del ERP viejo (`legacy_source: erp_store`, importada el 2026-09-09) y ocupa un número de la serie COTI.
Verificado contra la API: **STEL no tiene ningún COTI02499** y su secuencia ya pasó de largo, así que no hay
colisión posible. Se conserva.

## 6. Ejecución productiva (autorizada, 2026-10-06)

Autorización del usuario sobre el plan `f9ea17135b4e970b7d285973b47c784ad19dddbfcaf84eb9ccb6b6a738bb3ad1`,
con el dry run a la vista. El plan es mínimo: **sólo inserta dos cotizaciones y no toca nada más.**

### Gate 1 — dry run

| | |
|---|---|
| STEL leído | 2026-10-06 19:27 UTC, 61 llamadas, 0 errores. Cotizaciones 330, pedidos 191, remitos 214 |
| DOCUMENTS_TO_INSERT | **2** (quote: 2) · LINES_TO_INSERT **3** |
| PRODUCTS_TO_CREATE / TO_LINK / CATEGORY_TO_CREATE | 0 / 0 / 0 |
| DOCUMENTS_TO_UPDATE · HEADER_FIELD_CHANGES · LINES_TO_UPDATE | 0 · 0 · 0 |
| CURRENCY_FIXES · TOTAL_FIELD_FIXES · STATUS_FIXES · RELATION_FIXES | 0 · 0 · 0 · 0 |
| LINES_TO_DELETE_PENDING_APPROVAL | 0 |
| BLOCKED | **2** (`NAME_MISMATCH` SP.2007VPM/80 + `ID_EXTERNO_DISTINTO` RT0000001383) |

El dry run se corrió **dos veces** (19:27 y 20:04 UTC) y dio el **mismo hash**: ni STEL ni el ERP se movieron
en lo que toca a este plan.

### Ejecución

| Paso | Resultado |
|---|---|
| Gate | STEL releído, 61 llamadas: plan de ahora = hash autorizado, **exacto** |
| Snapshot | Huella de 17 tablas (`sales_quotes` 333, `sales_quote_lines` 1.154, `sales_orders` 194, `deliveries` 216, `products` 21.879, `customers` 1.013, `document_sequences` 14, `document_numbering_authority` 4, `stock_balances` 379, `stock_movements` 385) |
| Backup | `scripts/output/e2/respaldo-aplicar-f9ea17135b4e.json` — **0 filas afectadas**: el plan sólo inserta, no pisa nada existente |
| RECONCILIATION_RUN_ID | `26fce5b4-6ad3-4844-ba90-24853229082e`, 20:05:52 UTC, `finished`, 7 filas de bitácora (5 inserts) |
| Documentos | **2 insertados**, 0 actualizados · 5 cambios · fallidos 0 · salteados 0 |
| Invariantes | `invariantesRotos: []` — secuencias, autoridad de numeración, stock y movimientos idénticos |
| Segunda corrida | **0 acciones** (0 documentos, 0 productos, 2 bloqueados): idempotente |

### Lo que entró

| Cotización | STEL id | Cliente | Moneda | Total | Líneas | Sin producto |
|---|---|---|---|---|---|---|
| COTI02573 | 60496074 | SOLICAM (CLI01225) | USD | 726,00 | 1 (SP.VPTX30/90) | 0 |
| COTI02576 | 60736025 | AGEA S.A. (CLI01226) | USD | 5.694,99 | 2 (PRO12637, PRO12639) | 0 |

Las dos como `sent`, serie COTI, `external_source: stel`, `legacy_source: stel_reconciliation`, sin
`needs_review`, sin consumir la secuencia del ERP y sin mover stock.

### Verificación posterior

Sync de documentos en sólo lectura (ventana desde 2026-09-01):

```
documentos: 0 · insertados: 0 · actualizados: 0 · bloqueados: 1
 · delivery RT0000001383 — ID_EXTERNO_DISTINTO
```

Y COTI02531 **no aparece ni bloqueada ni modificada**: quedó en
`info.aceptadasConPedidoQueStelDejoPendiente`, que es exactamente el comportamiento nuevo de § 2.

### Reversión

```bash
node scripts/fase14-stel-e2-reconciliacion.mjs revertir --run 26fce5b4-6ad3-4844-ba90-24853229082e --autorizo-reversion
```

Los 3 clientes de § 3 **no** entran en esa reversión: se crearon por la RPC de la app, fuera del run, y se
dan de baja desde la pantalla de Clientes como cualquier otro.

## 7. Pruebas

| Suite | Resultado |
|---|---|
| `fase14-stel-e2-tests.mjs` | ALL PASS — incluye las 4 comprobaciones nuevas de § 2 |
| `fase14-stel-api-reconcile-fixture-tests.mjs` | ALL PASS |
| `fase14-e4-sync-cutover-tests.mjs` | TODO PASA |

Las tres verifican además su huella de datos reales intacta. `eslint` limpio.

## 8. Lo que queda

1. **RT0000001383** — renumerar uno de los dos remitos en STEL (§ 5). Es la única cosa que todavía bloquea
   el sync.
2. **SP.2007VPM/80** — decidir en STEL si el artículo es de 65 o de 80 mm (§ 5).
