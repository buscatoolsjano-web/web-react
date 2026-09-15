# FASE 14 · ENTREGA 1 — RECONCILIACIÓN DIRECTA CONTRA LA API DE STEL ORDER

> Cotizaciones, pedidos y remitos de **Buscatools** en el ERP React comparados contra **STEL Order leído
> directamente por su API** (no contra el legacy). Primera pasada **sólo lectura** en los dos lados;
> después, un **DRY RUN** con cada corrección propuesta y una prueba completa en empresa fixture.
> **No se escribió nada en productivo. No se cambió la autoridad STEL → ERP. No se tocaron avisos,
> botones, secuencias, stock, Gmail, apariencia ni UI.** Lectura de STEL: 2026-09-15 18:22–18:25 UTC.

## 0. Resultado

| Tema | Resultado |
|---|---|
| STEL_API_CONNECTION | **OK.** `https://app.stelorder.com/app`, header `APIKEY`; 115 llamadas GET en el día (3 de sonda + 112 de la auditoría, ≈2,5 min), 0 errores, 0 reintentos; las re-corridas usaron cache (0 llamadas) |
| STEL_LATEST_DATA | Última cotización **COTI02555** (creada 2026-09-15 15:14 UTC) · último pedido **PDV01318** (15:14 UTC) · último remito **RT0000001431** (11:40 UTC). **STEL sigue emitiendo hoy.** |
| CUTOVER_READY | **NO** (§ 18) |

| | Cotizaciones | Pedidos | Remitos |
|---|---|---|---|
| STEL (desde 2026-01-01) | 303 | 170 | 191 |
| React | 288 | 166 | 182 |
| **Matched** | 287 | 166 | 182 |
| **STEL_ONLY** (falta en React) | **16** | **4** | **9** |
| **REACT_ONLY** | 1 (COTI02499) | 0 | 0 |
| Header mismatch (sin tipo de cambio) | 43 | 20 | 21 |
| Line mismatch (contenido) | 6 | 0 | 1 |
| Sólo orden de líneas distinto | 6 | 0 | 0 |
| Total mismatch (total ≠) | 27 | 1 | 0 |
| Subtotal/IVA ≠ con total igual | 16 | 19 | 21 |
| Currency mismatch | 22 (6 sin moneda + 16 faltantes) | 15 (11 + 4) | 24 (15 + 9) |
| Estado distinto (STEL→React) | 25 | 0 | 0 |
| Cliente ambiguo | 1 | 0 | 0 |
| Vínculo con el padre faltante | — | 14 | 7 |

| Productos (763 distintos usados en las líneas) | |
|---|---|
| MATCHED (por SKU, único y exacto) | 713 productos · 2.055 líneas |
| MISSING en React | **50** (43 productos + 7 servicios) · 198 líneas |
| AMBIGUOUS (SKU repetido o sólo por mayúsculas) | 0 |
| WRONG_LINK (línea apunta a otro producto que el del SKU) | 1 línea (COTI02526) |
| NAME_MISMATCH real (similitud < 0,34) | 2 productos · 5 líneas; 486 líneas sólo con otra redacción |

| Monedas | |
|---|---|
| Documentos React sin moneda | **32** (6 cotizaciones, 11 pedidos, 15 remitos) — **los 32 resueltos por STEL** (19 USD, 13 ARS; ver § 8) |
| Diferentes (React ≠ STEL) | **0** |
| Sin moneda en STEL | **0** — STEL expone `currency-code` en el 100 % de los 664 documentos |

| Numeración | Cotización | Pedido | Remito |
|---|---|---|---|
| STEL mayor (serie principal) | COTI02555 | PDV01318 | RT0000001431 |
| React mayor | COTI02540 | PDV01315 | RT0000001423 |
| React próximo (`document_sequences`) | COTI02629 | **PDV01316** | **RT0000001424** |
| Colisión | no (salto de 73) | **SÍ: 1316–1318 ya usados en STEL** | **SÍ: 1424–1431 ya usados en STEL** |

| DRY RUN (§ 15) | |
|---|---|
| insert | **29** documentos (74 líneas) |
| update | 1.553 cambios de campo en 635 documentos (1.270 son `external_source`/`external_id`) |
| product-link | 1 |
| currency-fix | 32 |
| total-fix | 205 campos |
| line-fix | 1.224 (1.213 update, 3 insert, 8 delete) |
| relationship-fix | 21 |
| bloqueadas | 45 (37 por trigger de cotización cerrada, 2 por líneas de cotización cerrada, 6 borrados que requieren aprobación) |

## 1. Seguridad

- La clave vive en `.env.stel.local` (raíz del repo). Estaba en el escritorio como `.env.stel.local.txt`; se
  movió a la raíz con el nombre correcto. Ignorada por `.gitignore` (`.env.*.local`, línea 14): `git check-ignore` lo confirma y
  `git status` no la muestra. **Su valor no se mostró, imprimió ni copió**: un proceso local sólo informó que
  la variable `STEL_API_KEY` está definida y no está vacía.
- `scripts/lib/stel-api.mjs` la carga del archivo (o del entorno), **la manda sólo como header** (nunca en la
  URL), limpia cualquier texto de error antes de mostrarlo y **sólo tiene GET**.
- Salidas con datos reales en carpetas ignoradas: `scripts/output/` (reporte, snapshot y plan) y
  `.stel-cache/` (respuestas recortadas, sin la clave; **borrada al terminar**). Ninguna contiene la clave.
- La integración existente (Edge Function `stel-daily-sync` y `stel-products-scan` del legacy) usa la misma
  clave guardada en un almacén de secretos del legacy. No se usó ese camino, no se creó otra clave.

## 2. Contrato real de la API

Fuentes: la especificación pública (`/app/api/openapi.json`, 133 rutas) y el código de las dos Edge
Functions. Nada se asumió.

| Tema | Contrato |
|---|---|
| Base / auth | `https://app.stelorder.com/app`, header `APIKEY` |
| Entidades | `salesEstimates`, `salesOrders`, `salesDeliveryNotes`, `clients`, `products`, `services`, `documentStates`, `rates`, `productCategories` (+ `/{ID}`) |
| Paginación | `limit` + `start` (desplazamiento). Orden con `sort=campo:asc`; **`id` no es campo de orden** (se usó `creation-date`) |
| Filtros | `start-date` / `end-date` ISO 8601 `yyyy-MM-dd'T'HH:mm:ssZ` (con sólo la fecha: error E000003); `full-reference=in:a,b`; `utc-last-modification-date` |
| Borrados | **No aparecen en los listados**; sólo por `GET /{ID}` |
| Cupo | **60 llamadas/minuto** y **300 / 1.000 / 2.000 por día** según plan, **compartido** con el escenario de Make que usa la misma clave |
| Documento | `full-reference`, `date`, `creation-date`, `account-id`, `document-state-id`, **`currency-code`**, **`currency-rate`**, `discount-percentage`, `discount-total-amount`, **`subtotal-amount`**, **`tax-total-amount`**, `tax-breakdown[]`, `total-amount`, `income-tax-percentage`, **`parent-document-id` + `parent-document-path`**, `lines[]` |
| Línea | `line-type` (`ITEM`/`SECTION`), `item-id`, `item-path` (`/products/` o `/services/`), `item-reference` (= SKU), `item-name`, `units`, `item-base-price`, `discount-percentage`, `total-amount` (neto de la línea), `primary-tax-percentage`, `parent-document-id` |

Respetado: pausa de 1,25 s entre llamadas, timeout 45 s, 3 reintentos con backoff (61 s ante 429),
presupuesto duro de llamadas por corrida (`--max-llamadas`, 150 por defecto) y cache local para
re-analizar sin volver a llamar. **Clientes:** el listado no filtra por id → se leyó el maestro completo
(1.001, 6 páginas). **Productos:** por `full-reference=in:` en lotes de 40; los borrados, por id. **Conteo del
maestro:** búsqueda binaria sobre `start` con `limit=1` (unas 30 llamadas en vez de ~75 páginas de 200).

## 3. Período

- **FULL:** todo documento STEL con fecha ≥ **2026-01-01** (el período migrado empieza el 2026-01-05). La API
  permite histórico completo (no se encontró límite de antigüedad); lo anterior a 2026 no se migró y sólo
  aparece como padre (10 pedidos/remitos de 2026 cuelgan de documentos de 2025).
- **DELTA** (posterior al último documento realmente sincronizado, por `creation-date`):
  - cotizaciones desde 2026-09-07 14:05 UTC: **COTI02541–COTI02555** (15);
  - pedidos desde 2026-09-08 12:58 UTC: **PDV01316–PDV01318** (3);
  - remitos desde 2026-09-08 12:59 UTC: **RT0000001424–RT0000001431** (8).
- **Faltaban de antes del corte:** COTI02535 → PDV01307 → RT-ML2025000057 (cadena ARS del 2026-09-04 que
  el sync nunca trajo).

## 4. Método y tolerancia

- Emparejado por **número exacto** (`full-reference` = `original_number`); los 635 pares salieron así. El
  número sospechado de la importación sólo se usaría con fecha y total confirmando (no hizo falta).
- **Tolerancia de montos: 0,01** (un centavo) en todos los recálculos. 0,05 sólo para clasificar
  `ROUNDING_ONLY`. Cantidades 0,0001. STEL no documenta otra regla.
- Recálculo STEL: `Σ total-amount de líneas ITEM × (1 − descuento global) = subtotal-amount`,
  `Σ tax-breakdown = tax-total-amount`, `subtotal + IVA = total-amount`.
- **Líneas: por contenido**, no por posición. El sync del legacy guardaba el orden del arreglo, no el campo
  `order`: con el emparejado posicional daban 12 cotizaciones distintas y 20 WRONG_LINK falsos; por contenido
  son 6 y 1. Se ignoran líneas `SECTION` (1.239, títulos) y con cantidad 0 (ninguna).
- Remitos: multiconjunto SKU + cantidad (React no guarda posición).
- **Tipo de cambio: informativo, no mismatch.** STEL guarda **USD por unidad de la moneda del documento**
  (ARS ≈ 0,00066–0,00111; EUR 1,17813); React tiene un campo libre sin semántica fijada y lo tiene vacío en
  49 de 50 documentos no USD (COTI02538 dice `1`). Convertirlo es una decisión, no una corrección.

## 5. Documentos faltantes y extra

**STEL_ONLY (29).** Todos con cliente resuelto, moneda y totales de STEL:

| Tipo | Documentos |
|---|---|
| Cotizaciones (16) | COTI02535 (ARS, Cerrada) · COTI02541–COTI02547 · COTI02548–COTI02555 (hoy y ayer) |
| Pedidos (4) | PDV01307 (ARS) · PDV01316 · PDV01317 · PDV01318 |
| Remitos (9) | RT-ML2025000057 (ARS) · RT0000001424–RT0000001431 |

- **COTI02541** existe en el legacy como carga manual (1.150,64 USD) pero **STEL tiene otro contenido**
  (1.479,30 USD): manda STEL.
- La lista conocida (COTI02541–2547, RT1424–1426) queda **confirmada y ampliada**.

**REACT_ONLY (1): COTI02499** (2026-08-12, USD 1.075,28, importada del `erp_store`). STEL tiene un **hueco
exacto en 2499**; los borrados no salen en los listados, así que lo más probable es que se haya borrado en
STEL. Además, las 6 líneas que React tiene en **RT0000001405** suman lo mismo (1.075,28) y STEL guarda ese
remito con 1 sola línea: el legacy le colgó las líneas de la cotización borrada. **No se borra nada**
(se reporta; el DRY RUN marca esas 5 líneas extra como `REQUIERE_APROBACION_BORRADO`).

## 6. Cabeceras y totales — causa raíz

| Causa | Cotizaciones | Pedidos | Remitos | Qué pasó |
|---|---|---|---|---|
| Subtotal/IVA en 0, total correcto | 16 | 19 | 21 | Documentos del sync (sin base ni IVA) |
| **Subtotal ANTES del descuento global** | **18** | 0 | 0 | El legacy no aplicaba `discount-percentage` del documento: total inflado (p. ej. COTI02426: 246.516,56 vs 225.783,46 STEL) |
| Editado en STEL después del sync | 6 | 1 (PDV01314) | 1 (RT0000001405) | Cantidades, precios, descuentos o SKUs cambiados en STEL |
| Total del legacy = sólo el IVA | 2 | 0 | 0 | COTI02254 (2,84 vs 16,34) y COTI02485 (565,85 vs 3.260,35) |
| Redondeo | 1 | 0 | 0 | COTI02538 (0,1352) |

- **Descuento global real en STEL:** 20 cotizaciones, 12 pedidos y 10 remitos lo usan (3 % a 35 %).
- **Totales internos de STEL:** 2 documentos por tipo (misma cadena COTI02254/PDV01151/RT1242 y
  COTI02485/PDV01279/RT1398) tienen líneas cuyo `unidades × precio × (1 − dto)` no da el neto; la cabecera
  cierra. Se **preserva el total oficial de STEL** y se documenta la diferencia.
- **Percepción (`income-tax-percentage`):** 0 en los 664 documentos.
- **Estado de cotización:** 24 figuran `sent` en React y **Cerrada** en STEL (el sync ponía siempre
  «pendiente»); COTI02530 figura `accepted` en React y **Pendiente** en STEL (queda bloqueada, revisar).

## 7. Líneas

| Documento | Diferencia (STEL manda) |
|---|---|
| COTI02489 | STEL 1 línea, React 3 (2 sobran en React) |
| COTI02515 | Precio 15,08 → 15.080,45 ARS (el legacy lo guardó ≈ 1.000 veces menor) |
| COTI02516 | Una línea reemplazada por otra (PRO00238 ↔ GE.TSN125A) |
| COTI02523 | 7 líneas con precio/descuento/cantidad distintos y 2 líneas que sólo tiene STEL |
| COTI02526 | TE.LIGHT.4 → TE.9361, precio y descuento |
| COTI02528 | PRO12597 → PRO12599, cantidad y precio |
| RT0000001405 | STEL 1 línea, React 6 (ver § 5) |

- **Remitos históricos sin precio de línea:** STEL devuelve precio y descuento para las **595** líneas
  emparejadas (`item-base-price`, `discount-percentage`).

## 8. Monedas

Moneda de STEL de los 32 documentos que hoy están **sin moneda** en React:

| Moneda STEL | Documentos |
|---|---|
| USD (19) | COTI02531, 02532, 02533, 02534, 02539 · PDV01301–01306, 01312, 01313, 01314, 01315 · RT0000001410, 1411, 1422, 1423 |
| ARS (13) | COTI02540 · PDV01311 · RT0000001412–1421, RT-ML2025000061 |

- **Cambio de moneda dentro de STEL (confirmado por la API, no es error de React):** COTI02339 **ARS** →
  PDV01223 **USD** y PDV01274 **USD** → RT0000001382 **ARS**. Ninguna otra relación cambia de moneda.
- En todo el período STEL usa USD (542), ARS (121) y EUR (1).

## 9. Relaciones (`parent-document-id` explícito de STEL; nada inferido)

| Estado | Cantidad |
|---|---|
| OK (React tiene el mismo vínculo) | 272 |
| **Falta el vínculo en React** | **21**: PDV01301–01306, 01308–01315 ← su cotización; RT0000001410, RT0000001422, RT0000001423, RT-ML2025000058–061 ← su pedido |
| Hijo falta en React | 11 |
| Padre anterior al período (2025) | 10 |
| **Remito que sale directo de una cotización** | **11** (RT0000001352, RT0000001412–1421): React no tiene `quote_id` en `deliveries` |
| Sin padre en STEL | 36 |
| Vínculo distinto en React | **0** |

## 10. Clientes

- STEL 1.001 clientes · React 1.010.
- Por documento: **538 por CUIT exacto**, **125 por razón social normalizada inequívoca**, **0 vinculados a
  otro cliente**, **1 ambiguo** (COTI02452: el cliente STEL `CLI01227` tiene CUIT pero React no lo tiene y
  la razón social coincide con más de un cliente) → **no se vincula automáticamente**.
- `customers.legacy_ref` (`CLI…`) **no** es el id de STEL (salió de un MAX+1 local): no se usa para vincular.

## 11. Productos

- **713 de 763** productos usados en las líneas existen en React con el mismo SKU (único, exacto). React no
  guarda el id de STEL: el match es por SKU (`legacy_ref` = SKU).
- **27 de los 50 faltantes están inactivos en STEL** con precio 0: son ítems de una sola cotización.
- **Los 7 servicios** (`/services/`) no existen como producto en React; SER00006, SER00007, SER00012 y
  SER00013 (alquileres) suman 134 líneas.
- **49 de los 50 faltantes no tienen categoría en STEL** y ninguno trae marca: `products.category_id` es
  NOT NULL → **no se pueden crear sin decidir una categoría de revisión** (no se inventa).
- NAME_MISMATCH real: `SP.2007VPM/80` y `SP.2008VP/100` (el nombre de STEL describe otra medida que el
  catálogo React) → revisar antes de vincular por SKU.

**MISSING_IN_REACT (lista exacta):**

| STEL_ID | SKU | Descripción (STEL) | Tipo | Usos | Documentos | Estado STEL |
|---|---|---|---|---|---|---|
| 21987654 | SER00006 | ALQUILER DE DISPENSER FRIO CALOR | servicio | 43 | COTI02251, COTI02278, COTI02299 y 40 más | activo |
| 21987839 | SER00007 | ALQUILER DE RACKS AGUA | servicio | 43 | COTI02251, COTI02278, COTI02299 y 40 más | activo |
| 24961465 | SER00012 | ALQUILER DE DISPENSER FRIO CALOR CONECTADO A RED | servicio | 24 | COTI02252, COTI02279, COTI02326 y 21 más | activo |
| 25007157 | SER00013 | ALQUILER DE DISPENSER FRIO CALOR CONECTADO A RED | servicio | 24 | COTI02252, COTI02279, COTI02326 y 21 más | activo |
| 46767235 | PRO12599 | Alicate Artesanías Pinza De Corte | producto | 5 | COTI02528, COTI02529, PDV01315 y 2 más | activo |
| 20473543 | SER00004 | FLETE | servicio | 5 | COTI02282, COTI02349, COTI02422 y 2 más | activo |
| 32049096 | B2036LA-2 | DUROFIX Bateria 20V 4 Ah Cod. B2036LA-2 | producto | 4 | COTI02519, COTI02544, PDV01294, RT0000001404 | activo |
| 46830664 | PRO12600 | Linterna de Inspección LED 900lm Recargable | producto | 3 | COTI02539, PDV01315, RT0000001423 | activo |
| 44624867 | PRO12438 | ALARGUES DE 150MM DE 3/8 A 3/8 | producto | 2 | COTI02417, PDV11239 | inactivo |
| 44624868 | PRO12439 | LLAVE FIJA DE 14 | producto | 2 | COTI02417, PDV11239 | inactivo |
| 46766584 | PRO12596 | Pinza Para Precinto Plástico Lusqtoff L1064 9mm | producto | 2 | COTI02528, RT0000001411 | activo |
| 46766610 | PRO12597 | Alicate Cortacable Para Cable Trenzado - Knipex | producto | 2 | COTI02530, RT0000001411 | activo |
| 46767231 | PRO12598 | Pinza Abrazadera Terminal Redonda / Eurotech | producto | 2 | COTI02529, RT0000001411 | activo |
| 41812924 | PRO12225 | Perfil C 200 * 70 * 3,2 mm - Longitud 12 mts | producto | 1 | COTI02281 | inactivo |
| 41812925 | PRO12226 | Caño tubular perfil cuadrado 100 * 100 * 3,2 mm | producto | 1 | COTI02281 | inactivo |
| 41812926 | PRO12227 | Chapas 1,50 * 3 mts - Espesor 3/8" | producto | 1 | COTI02281 | inactivo |
| 41812927 | PRO12228 | Perfil L 1 1/2" * 1 1/2" * 1/4" * 6 mts | producto | 1 | COTI02281 | inactivo |
| 41812928 | PRO12229 | Perfil L 2" * 2" * 3/16" * 6 mts | producto | 1 | COTI02281 | inactivo |
| 41812929 | PRO12230 | Anclaje de hormigón Ø 12 * 100 mm | producto | 1 | COTI02281 | inactivo |
| 41812930 | PRO12231 | Consumible alambre AWS 70 T1 1.2 MIG MAG | producto | 1 | COTI02281 | inactivo |
| 41812931 | PRO12232 | Tornillo calidad 8.8 M10 * 30 | producto | 1 | COTI02281 | inactivo |
| 41812932 | PRO12233 | Arandela plana P/M10 | producto | 1 | COTI02281 | inactivo |
| 41812933 | PRO12234 | Tuercas autofrenantes M10 | producto | 1 | COTI02281 | inactivo |
| 41812934 | PRO12235 | Planchuela 3/8" * 100 * 12 mts | producto | 1 | COTI02281 | inactivo |
| 41928813 | PRO12256 | SET EMBRAGUE COMPLETO PARA URYU UOW-T60 | producto | 1 | COTI02288 | inactivo |
| 42382383 | PRO12274 | ESTIC SPT020-25 - PRESS UNIT SPT SERIES 20KN | producto | 1 | COTI02310 | inactivo |
| 42382384 | PRO12275 | ESTIC MPU60-40 - PRESS CONTROL UNIT 200W | producto | 1 | COTI02310 | inactivo |
| 42382385 | PRO12276 | ESTIC ENRZ-CVMN2-100 - MOTOR CABLE 10M | producto | 1 | COTI02310 | inactivo |
| 42382386 | PRO12277 | ESTIC ENRZ-CVTR-100 - SIGNAL CABLE 10M | producto | 1 | COTI02310 | inactivo |
| 44935239 | PRO12447 | Pizarrón Blanco 80 x 120 Cm | producto | 1 | RT0000001343 | inactivo |
| 45238847 | PRO12466 | LLAVE FIJA DE 14 | producto | 1 | RT0000001357 | inactivo |
| 45490225 | PRO12481 | DXSK2M15L | producto | 1 | COTI02459 | inactivo |
| 45490226 | PRO12482 | DXSK2H14L | producto | 1 | COTI02459 | inactivo |
| 45490227 | PRO12483 | AK32H | producto | 1 | COTI02459 | inactivo |
| 45490228 | PRO12484 | AK42H | producto | 1 | COTI02459 | inactivo |
| 45490229 | PRO12485 | EA48H | producto | 1 | COTI02459 | inactivo |
| 45490230 | PRO12486 | EA66H | producto | 1 | COTI02459 | inactivo |
| 46878774 | PRO12601 | 2904-259A TALADROS MILWAUKEE | producto | 1 | COTI02541 | activo |
| 46895261 | PRO12602 | LLAVE CRIQUE ENCASTRE 1/2" | producto | 1 | COTI02542 | activo |
| 46895640 | PRO12603 | JUEGO DE LLAVES Y TUBOS 110 PIEZAS | producto | 1 | COTI02542 | activo |
| 46895985 | PRO12604 | LLAVE AJUSTE BATERIA ENCASTRE 3/8" ANGULAR | producto | 1 | COTI02542 | activo |
| 46926759 | PRO12605 | Kit 2 Manija Mandril Porta Macho Con Crique 5 A | producto | 1 | COTI02545 | activo |
| 46927566 | PRO12606 | MANÓMETROS DE PRESIÓN DIFERENCIAL DE RAMA INCLIN | producto | 1 | COTI02546 | activo |
| 46927643 | PRO12607 | Paño para limpieza 34x34cm, caja x 480 | producto | 1 | COTI02523 | inactivo |
| 46928125 | PRO12608 | MALACATE APAREJO ELECTRICO 1000KG 12M 1700W HAMI | producto | 1 | COTI02547 | activo |
| 46928151 | PRO12609 | Manija Gira Macho Con Criquet Serie Larga M3 A M | producto | 1 | COTI02545 | activo |
| 46928241 | PRO12610 | Vincha Lupa Con Luz Led Recargable Ajustable + 6 | producto | 1 | COTI02545 | activo |
| 47094550 | PRO12612 | CINTA DEMARCAR PELIGRO ROLLO 200M | producto | 1 | RT0000001431 | activo |
| 41334471 | SER00046 | COMPRESOR 10HP TORNILLO SERVICE-1 | servicio | 1 | COTI02260 | activo |
| 41334507 | SER00047 | COMPRESOR 10HP TORNILLO SERVICE-3 | servicio | 1 | COTI02260 | activo |

## 12. Numeración y colisiones (STEL leído hoy, no el legacy)

| | Cotización | Pedido | Remito |
|---|---|---|---|
| STEL mayor · fecha · id | COTI02555 · 2026-09-15 · 60163211 | PDV01318 · 2026-09-15 · 60163213 | RT0000001431 · 2026-09-15 · 60153206 |
| STEL último creado | COTI02555 15:14 UTC | PDV01318 15:14 UTC | RT0000001431 11:40 UTC |
| React mayor · próximo | COTI02540 · COTI02629 | PDV01315 · **PDV01316** | RT0000001423 · **RT0000001424** |
| Números que React emitiría y STEL ya usó | 0 | **3** (PDV01316–1318) | **8** (RT1424–1431) |
| Próximo seguro mínimo hoy | COTI02556 | PDV01319 | RT0000001432 |
| Duplicados en STEL | 0 | 0 | 0 |
| Huecos en STEL (período) | 2414, **2499** | 1157, 1209, 1225, 1252, 1259, 1290, 1292 | 1288, 1351, 1395, 1397 |
| Fuera de patrón en STEL | — | **PDV11157, 11209, 11225, 11239, 11252, 11259, 11284, 11290, 11292** | serie **RT-ML2025000057–061** (MercadoLibre, otra numeración) |

- **Los nueve PDV11xxx existen en STEL mismo** (no fueron un error de la importación): 7 llenan exactamente
  los huecos. Corregirlos es tarea de STEL, no de React.
- **RT1424–1426** revalidado contra la API: los tres existen en STEL (y ahora hasta RT1431).
- La serie **RT-ML** no tiene secuencia en React.
- `next_number` de React **no se movió** en esta entrega.

## 13. ¿STEL es el maestro de productos y precios? (U-B-2)

| Medida (API, hoy) | Valor |
|---|---|
| Productos en STEL (sin borrados) | **14.659** (React: 21.772, sin id de STEL) |
| Última modificación de un producto | 2026-09-15 15:17 UTC |
| Modificados en los últimos 30 días | 57 |
| Creados en los últimos 30 días | **41** (último: hoy 12:17 UTC; SKUs `PRO126xx` nacen al cotizar) |
| Con precio de venta (> 0), muestra de los 200 más recientes | 177 |
| Con precios por tarifa, misma muestra | 200 |
| Tarifas (listas) | **12**, incluidas por cliente o canal (MercadoLibre, Newsan, Mirgor, Whirlpool, Distribuidor A/B…) |
| Categorías | 55 |

**Respuesta medida:** hoy **STEL es el maestro operativo de productos vendidos y de precios**: los productos
nuevos se crean en STEL mientras se cotiza (50 SKUs usados en ventas no existen en React) y los precios
viven en STEL (precio de venta + 12 tarifas). El catálogo React es más grande pero **no está sincronizado**
con STEL. Antes del cutover hace falta decidir y construir la sincronización (o el corte) de productos y
precios.

## 14. Gate antes de escribir

| Condición | Resultado |
|---|---|
| La API responde correctamente | ✅ 112/112 |
| Documentos completos | ✅ listados con cabecera y líneas; período completo desde 2026-01-01 |
| Líneas completas | ✅ SKU, cantidad, precio, descuento, IVA y neto en el 100 % |
| Productos mapeables | ⚠️ 713/763 por SKU; 50 faltantes sin categoría → la creación necesita decisión |
| Monedas disponibles | ✅ 100 % |
| Relaciones confiables | ✅ explícitas (`parent-document-id` + `parent-document-path`) |

→ **Suficiente para preparar la reparación y el DRY RUN** (hecho). **No suficiente para escribir en
productivo** sin las decisiones de § 16.

## 15. DRY RUN

`node scripts/fase14-stel-api-reconcile-dryrun.mjs` → `scripts/output/fase14-stel-dryrun.json` (ignorado):
cada acción con `action`, `document`, `field`, `old`, `new`, `source = STEL` y, si corresponde, `bloqueado`.

| ACTION | Cantidad | Qué |
|---|---|---|
| INSERT | 29 docs · 74 líneas | Los STEL_ONLY: `imported_at`, `external_source='stel'`, `external_id`, `legacy_source='stel_reconciliation'`, moneda y totales de STEL, cliente resuelto, producto por SKU o NULL con `needs_review` |
| SET_EXTERNAL_ID | 635 | `external_source='stel'` + `external_id` = id STEL en todo lo emparejado (idempotencia futura) |
| SET_CURRENCY | 32 | § 8 |
| FIX_TOTAL | 205 campos | subtotal, IVA, total y descuento global = valores oficiales de STEL |
| UPDATE (estado) | 25 | 24 `sent → accepted` + COTI02530 `accepted → sent` (bloqueada) |
| LINK_QUOTE | 14 | `sales_orders.quote_id` |
| LINK_ORDER | 7 | `deliveries.order_id` |
| LINK_PRODUCT | 1 | COTI02526 → TE.9361 |
| LINK_CUSTOMER | 0 | — |
| FIX_LINE update | 1.213 | 1.190 precio/descuento de líneas de remito + 23 campos de las 6 cotizaciones editadas |
| FIX_LINE insert | 3 | COTI02516 (1), COTI02523 (2) |
| FIX_LINE delete | 8 | COTI02489 (2), COTI02516 (1), RT0000001405 (5) — **destructivo, requiere aprobación** |

**Bloqueadas (45), por los triggers actuales:**

| Motivo | Acciones | Documentos |
|---|---|---|
| `bloquear_cotizacion_cerrada` (aceptada no cambia moneda/totales/estado) | 37 | COTI02254, 02258, 02337, 02357, 02376, 02383, 02432, 02468, 02485, 02489, 02511, 02519, 02520, 02530 |
| `bloquear_lineas_cotizacion_cerrada` | 2 | COTI02489 |
| Borrado sin aprobación | 6 | COTI02516, RT0000001405 |

No hay acciones sobre secuencias, stock, bitácoras ni autoridad.

## 16. Reparación controlada — diseño (no aplicado)

1. **Atomicidad.** PostgREST no tiene transacciones. La corrida productiva necesita una RPC
   `app.reconciliar_documento_stel(p jsonb)` (SECURITY DEFINER, EXECUTE sólo `service_role`) que aplique
   cabecera + líneas + estado de UN documento en una transacción y devuelva el diff. El aplicador de fixture
   (`aplicarPlan`) ordena cabecera → líneas → estado y compensa un INSERT fallido, y **se niega a cualquier
   empresa que no sea `zz-*`**.
2. **Documentos cerrados.** Para las 39 acciones bloqueadas hace falta una puerta explícita en
   `bloquear_cotizacion_cerrada` y `bloquear_lineas_cotizacion_cerrada`:
   `current_setting('app.reconciliacion_stel', true) = 'on' and auth.role() = 'service_role'`, activada con
   `set_config(..., true)` **sólo dentro de la RPC**. Es un cambio de schema: se documenta, no se aplicó.
3. **Id externo de productos y líneas.** `products` no tiene id de STEL. Propuesta:
   `product_external_refs(company_id, product_id, source, external_id, external_ref, unique(company_id, source, external_id))`
   y `external_line_id` en las tres tablas de líneas. Sin eso, la segunda corrida depende del SKU y del
   emparejado por contenido.
4. **Remito desde cotización.** 11 casos reales; `deliveries` necesitaría `quote_id` (o un vínculo genérico
   al documento origen) para no perder el dato.
5. **Productos faltantes.** Sólo con datos de STEL: SKU, nombre, descripción, estado (`inactive` →
   `discontinued`), `product_type` servicio para `/services/`, **categoría = una categoría de revisión que el
   negocio defina** (STEL no la trae), sin marca, sin precio inventado, `needs_review = true`. Hasta decidirlo,
   las líneas quedan con `product_id NULL` y snapshot completo.
6. **Totales.** Nunca el recálculo de React: se copian `subtotal-amount`, `tax-total-amount`,
   `total-amount` y `discount-percentage` de STEL. Los documentos siguen con `imported_at`, así que
   `recalcular_totales_*` no los pisa.
7. **Líneas.** Campo por campo, conservando id, `line_no` y relaciones. El orden distinto (6 cotizaciones)
   **no se corrige**. Insertar/borrar sólo lo que no tiene par; borrar requiere aprobación.
8. **Stock.** No hay trigger de stock en `deliveries`/`delivery_lines`: sólo mueve stock un INSERT en
   `stock_movements`, que la reconciliación nunca hace. Verificado en fixture: 0 movimientos.
9. **Bitácora.** `sales_audit` sólo se escribe por la RPC de eventos de la UI; la reconciliación no la
   llama. Marca de origen: `legacy_source = 'stel_reconciliation'` y `review_reason` con prefijo
   `STEL_RECONCILIATION`.
10. **Secuencias.** Los documentos entran con su número de STEL; no se llama a `next_document_number`.
    `guardar_autoridad_numeracion` los deja pasar sólo por `imported_at` + `service_role`.
11. **Snapshot y rollback.** Antes de escribir: counts y md5 por tabla (mismo método de E0), exportar las
    filas afectadas a `scripts/output/` y conservar el plan (tiene `old` de cada campo). Rollback: UPDATE
    inverso campo por campo; los INSERT se quitan con `imported_at = null` + borrado por la puerta de
    mantenimiento (`proteger_borrado_*` no deja borrar importados); las líneas borradas se reinsertan desde
    el export.
12. **Idempotencia.** `external_id` + comparación de valores actuales: segunda corrida = 0 acciones
    aplicables (probado).

## 17. Prueba en fixture

`node scripts/fase14-stel-api-reconcile-fixture-tests.mjs` — **ALL PASS** (31 comprobaciones), corrida tres
veces. Empresa `zz-f14e1-*` con autoridad STEL y snapshot STEL sintético que reproduce:
- cotización sin moneda, subtotal antes del descuento global y líneas en otro orden;
- cotización aceptada sin moneda (bloqueada);
- pedido sin vínculo y con línea sin producto;
- remito sin vínculo y sin precios;
- cadena cotización → pedido → remito sólo en STEL, con producto faltante y ARS;
- cotización sólo en React.

Verificado:
- el plan esperado;
- aplicar sin fallas;
- negación ante la empresa real;
- **segunda corrida: 0 acciones aplicables** (lo bloqueado sigue reportado);
- ids y orden de líneas conservados;
- total histórico preservado;
- **0 movimientos de stock, 0 eventos, secuencias y autoridad intactas**;
- limpieza completa y **huella de datos reales idéntica**.

## 18. Cutover readiness

| | Estado | Por qué |
|---|---|---|
| QUOTES_READY | **NO** | STEL emite hoy; 16 faltantes; 43 cabeceras y 6 contenidos a corregir (14 bloqueadas por trigger); 1 cliente ambiguo; productos/precios con maestro en STEL |
| ORDERS_READY | **NO** | Colisión PDV01316–1318; 4 faltantes; 14 vínculos a cotización; blocker USD por defecto |
| DELIVERIES_READY | **NO** | Colisión RT1424–1431; 9 faltantes; remito despachado cancelable sin devolver stock; remitos desde cotización sin campo; serie RT-ML sin secuencia |
| **CUTOVER_READY** | **NO** | |

**BLOCKERS**
1. STEL sigue emitiendo cotizaciones, pedidos y remitos hoy (último 15:14 UTC).
2. Colisión de numeración: React emitiría PDV01316–1318 y RT0000001424–1431, ya usados en STEL.
3. Reconciliación productiva no ejecutada: 29 documentos faltantes y 2.762 acciones pendientes de aprobación.
4. 39 acciones bloqueadas por los triggers de documento cerrado (requiere la puerta y la RPC de § 16).
5. 50 productos/servicios faltantes sin categoría en STEL: decisión de categoría de revisión.
6. Sin id externo de productos ni de líneas (§ 16.3).
7. U-B-2: STEL es el maestro operativo de productos y precios; no hay sincronización con React.
8. **Remito despachado cancelable sin restaurar stock** (C.6 de E0): no habilitar autoridad de remitos.
9. **Cotización sin moneda → pedido USD automático** en la conversión de la UI: eliminar antes del cutover
   (no se tocó en esta entrega).
10. Semántica del tipo de cambio sin definir (STEL: USD por unidad; React: libre).
11. 11 remitos que salen directo de cotización: `deliveries` sin vínculo a cotización.
12. Serie RT-ML (MercadoLibre) sin secuencia en React; 9 PDV11xxx fuera de patrón en STEL.
13. Borrados propuestos (COTI02489, COTI02516, RT0000001405) y COTI02499 sólo en React: requieren decisión.
14. Cupo diario de la API compartido con Make: un sync ERP ↔ STEL debe presupuestar llamadas.

## 19. Archivos

| Archivo | Qué |
|---|---|
| `scripts/lib/stel-api.mjs` | Cliente GET: clave sin log, pausa, timeout, reintentos, presupuesto, cache |
| `scripts/fase14-stel-api-auditoria.mjs` | Auditoría (STEL + React sólo lectura) → `scripts/output/fase14-stel-reconciliacion.json` y `fase14-stel-snapshot.json` |
| `scripts/fase14-stel-api-reconcile-dryrun.mjs` | Plan puro + aplicador sólo-fixture → `scripts/output/fase14-stel-dryrun.json` |
| `scripts/fase14-stel-api-reconcile-fixture-tests.mjs` | Prueba end-to-end en empresa `zz-f14e1-*` |
| `.gitignore` | `scripts/output/` y `.stel-cache/` |

```
set -a; . ./.env; . ./.env.migration; set +a
node scripts/fase14-stel-api-auditoria.mjs --max-llamadas 150
node scripts/fase14-stel-api-reconcile-dryrun.mjs
node scripts/fase14-stel-api-reconcile-fixture-tests.mjs
```

## 20. No tocado

Autoridad STEL → ERP, avisos, botones «Nueva», secuencias, stock productivo, datos de Ventas productivos,
Gmail, apariencia, UI, Fase 13, WhatsApp. Ninguna escritura en STEL (el cliente no tiene métodos de
escritura). Ninguna escritura en Buscatools ni Torquetools.
