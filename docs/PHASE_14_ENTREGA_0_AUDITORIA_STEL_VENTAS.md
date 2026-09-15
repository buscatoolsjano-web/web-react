# FASE 14 · ENTREGA 0 — AUDITORÍA STEL / VENTAS (READ-ONLY)

> Reconciliación documento por documento y línea por línea de cotizaciones, pedidos y remitos de
> Buscatools entre el ERP React y la fuente legacy, más numeración, productos, montos, monedas,
> permisos, flujo de stock y convivencia con STEL. **Sólo lectura sobre datos reales**: las
> consultas de auditoría corrieron con un rol de base de sólo lectura; las pruebas de escritura
> corrieron en empresas fixture `zz-f14-*`. **No se corrigió ningún dato. No se cambió la autoridad
> STEL → ERP. No se movieron secuencias. No se tocaron avisos ni botones de emisión.**
> Medido el 2026-09-15 entre 15:00 y 16:00 UTC.

## 1. Fuentes disponibles

| Fuente | Qué es | Estado hoy | Uso en esta auditoría |
|---|---|---|---|
| ERP React (Supabase nuevo) | `sales_quotes` 288, `sales_orders` 166, `deliveries` 182 de Buscatools, **todos importados** (`imported_at` no nulo, `legacy_source = erp_store`); 0 nativos | Vigente | Lado «React» |
| Legacy `erp_store` (Supabase del ERP HTML) | Blobs JSON por clave: `erp_cotizaciones` 295, `erp_pedidos` 166, `erp_notas_entrega` 185 | Recibe el sync diario de STEL | Lado «fuente» |
| Espejo normalizado del legacy (`sales_orders`, `deliveries`, `products`…) | Base normalizada vieja | Sin actualizar desde 2026-08-28; no fue fuente de la migración | No se usa |
| STEL Order (API) | Sistema que numera y emite hoy | **No accesible** desde el ERP (la clave vive en el legacy y no se lee) | Sólo a través de lo que el sync dejó en `erp_store` |
| Dump `erp_store-completo.json` (2026-09-09) | Copia usada por la importación | No está en esta máquina | No se usa |
| `stel_products_cache` (legacy) | 14.641 productos cacheados de STEL | — | Fuera de alcance (U-B-2) |

### Sync STEL → legacy (`stel-daily-sync`)

- Job de `pg_cron` en el proyecto legacy, `0 9 * * *`, activo. Llama a una Edge Function que lee de
  STEL cotizaciones, pedidos y remitos de **los últimos 10 días** (límite 200) y los agrega a
  `erp_store` por `ref` sin duplicar (`stel_append_records`).
- Lo que escribe: `ref`, fecha, título, cliente (razón social), ítems con SKU, cantidad, descuento y
  precio **derivado** del total de línea, total del documento. **Sin moneda, sin base ni IVA.**
- **Sólo escribe en el legacy. Nunca escribe en el ERP React.**
- Las 9 corridas del cron desde 2026-09-06 figuran «succeeded», pero eso es sólo el disparo HTTP. La
  respuesta registrada de la corrida de **hoy (09:00 UTC) es HTTP 402: el proyecto legacy está
  restringido por exceso de cuota de egress.** Los últimos documentos que el sync agregó son del
  2026-09-11 y 2026-09-12 09:00; **después, nada**.
- Deuda de seguridad (sin detalle en este repo público): el comando del cron lleva una credencial en
  línea.

**Consecuencia:** el legacy ya no es un espejo confiable de STEL. Lo emitido en STEL después del
2026-09-12 **no se puede medir desde acá**; hay que leerlo en STEL al momento del corte.

## 2. Método

Para cada documento se calcula, **en ambas bases y con la misma normalización**, un resumen de:

- **Cabecera (H):** fecha, moneda, tipo de cambio, subtotal (`base`), IVA (`ivaAmount`), total,
  título, estado (con la misma traducción que usó la importación), notas (`formaPago`) y vínculo
  (`fromCotizacion` → `quote_id`, `fromPedido` → `order_id`).
- **Líneas (L):** posición, SKU, nombre, descripción, cantidad, precio unitario y descuento
  (cotizaciones y pedidos, en orden); remitos: SKU, nombre y cantidad como multiconjunto.
- **Cliente (C):** razón social normalizada (minúsculas, sin acentos, sólo letras y números) contra
  razón social, nombre de fantasía o nombre legacy del cliente vinculado.
- Además, el número (`number` = `original_number`) y, en pedidos, el cumplimiento.

Redondeo: montos, cantidades y precios a 4 decimales (la escala de las columnas), tipo de cambio a
6, descuento de línea a 3. **Tolerancia de los recálculos: 0,01** (un centavo). No se usó ninguna
tolerancia mayor.

## 3. Resumen de reconciliación

| Entidad | Fuente | React | Matched | Missing (en fuente, no en React) | Extra (en React, no en fuente) | Field mismatch | Line mismatch | Total mismatch (recálculo React) | Product mismatch | Duplicate number |
|---|---|---|---|---|---|---|---|---|---|---|
| Cotizaciones | 295 | 288 | **288** | **7** | 0 | 0 | 0 | 36 (ver §5) | 0 vínculos erróneos · 86 líneas sin producto | 0 |
| Pedidos | 166 | 166 | **166** | 0 | 0 | 0 | 0 | 32 (ver §5) | 0 · 38 | 0 (2 pares si se normalizan los atípicos) |
| Remitos | 185 | 182 | **182** | **3** | 0 | 0 | 0 | 21 sin desglose · 182 con líneas sin precio | 0 · 62 | 0 |

- **Líneas:** fuente 1.011 / 593 / 612 ítems; React 992 / 593 / 600. La diferencia es exactamente
  la de los documentos faltantes más las líneas con cantidad 0 que la importación descartó a propósito.
- **Otra moneda en el legacy:** el campo `_moneda` (etiqueta larga) nunca contradice a `moneda`.

### Documentos faltantes (IN_SOURCE_NOT_REACT)

| Documento | Fecha | Origen | Moneda | Total | Líneas | SKU sin producto en React |
|---|---|---|---|---|---|---|
| COTI02541 | 2026-09-07 | Carga manual en el legacy (09-09) | USD | 1.150,64 | 1 | PRO12600 |
| COTI02542 | 2026-09-10 | STEL (sync 09-11) | **sin** | 1.154,04 | 4 | PRO12602, PRO12603, PRO12604 |
| COTI02543 | 2026-09-10 | STEL (sync 09-11) | **sin** | 3.236.750 | 5 | — |
| COTI02544 | 2026-09-10 | STEL (sync 09-11) | **sin** | 10.241,51 | 4 | B2036LA-2 |
| COTI02545 | 2026-09-11 | STEL (sync 09-12) | **sin** | 209,12 | 3 | PRO12605, PRO12609, PRO12610 |
| COTI02546 | 2026-09-11 | STEL (sync 09-12) | **sin** | 230,38 | 1 | PRO12606 |
| COTI02547 | 2026-09-11 | STEL (sync 09-12) | **sin** | 1.333,88 | 1 | PRO12608 |
| RT0000001424 | 2026-09-10 | STEL (sync 09-11) | **sin** | 1.767,48 | 10 | — |
| RT0000001425 | 2026-09-10 | STEL (sync 09-11) | **sin** | 2.014 | 1 | — |
| RT0000001426 | 2026-09-11 | STEL (sync 09-12) | **sin** | 2.700 | 1 | — |

`IN_REACT_NOT_SOURCE`: 0. `FIELD_MISMATCH`, `LINE_MISMATCH` contra la fuente: 0 en los 636
documentos emparejados.

## 4. Numeración

| Tipo | Serie | Docs React | Máx React | Máx legacy | Próximo React (`next_number`) | Huecos | Fuera de patrón | Duplicados | Estado |
|---|---|---|---|---|---|---|---|---|---|
| quote | COTI (5 díg.) | 288 | 2540 | **2547** | **2629** | 2414, 2535 | 0 | 0 | Adelante del legacy por 81; STEL real desconocido |
| sales_order | PDV (5 díg.) | 166 | 1315 (sin atípicos) | 1315 | **1316** | 1157, 1209, 1225, 1252, 1259, 1290, 1292, 1307 | 9 atípicos `PDV11157…PDV11292` | 0 literales; 2 si se normalizan (1239, 1284) | Al límite: colisiona con cualquier PDV01316+ emitido en STEL después del 09-12 |
| delivery | RT (10 díg.) | 178 | 1423 | **1426** | **1424** | 1288, 1351, 1395, 1397 | 0 | 0 | **COLISIÓN: RT0000001424, 1425 y 1426 ya existen en STEL** |
| delivery | RT-ML | 4 | 2025000061 | 2025000061 | sin secuencia | 0 | — | 0 | No emitible desde el ERP |

- **RT 1424–1426 revalidado hoy:** los tres existen en el legacy (STEL, 10 y 11 de septiembre) y
  no en React; la secuencia React apunta a 1424. La colisión sigue abierta.
- Los 9 atípicos tienen un `1` de más (sospecha registrada `PDV1157` etc., nunca aplicada). 7 de
  ellos llenan huecos de la serie; 1239 y 1284 serían duplicados si se normalizaran; el hueco 1307
  no se explica. La secuencia tardaría ~9.800 pedidos en alcanzar `PDV11157`.
- Duplicados por `company_id + tipo + número normalizado`: **0** en los tres tipos.

## 5. Montos (recálculo desde las líneas, por moneda, tolerancia 0,01)

Nunca se suman monedas entre sí. Totales de cabecera por moneda (React):

| Tipo | ARS | USD | EUR | SIN MONEDA |
|---|---|---|---|---|
| Cotizaciones | 48 docs · 60.162.220,22 | 233 · 1.362.732,01 | 1 · 6.711,81 | 6 · 80.668,25 |
| Pedidos | 27 · 35.947.084,07 | 128 · 339.049,48 | — | 11 · 88.331,57 |
| Remitos | 29 · 36.816.390,42 | 138 · 353.603,21 | — | 15 · 12.996.570,72 |

### 5.1 Documentos de STEL sin desglose (subtotal 0, IVA 0, total > 0)

El sync de STEL no trae base ni IVA, y la importación copió 0. **62 documentos**: cotizaciones 21
(ARS 2, USD 13, sin moneda 6), pedidos 20 (ARS 4, USD 5, sin moneda 11), remitos 21 (ARS 4, USD 2,
sin moneda 15).

- En 34 de las 41 cotizaciones y pedidos, líneas × 1,21 cierra con el total (IVA 21 %); en 1 pedido
  USD cierra sin IVA.
- **No cierran de ninguna forma:** COTI02254, COTI02485, COTI02531, PDV01296, PDV01303, PDV01310.
- Severidad **media** (histórico). Causa probable: STEL no envía base/IVA; mezcla de alícuotas o
  percepciones. Corrección propuesta: reconstruir subtotal/IVA desde STEL, no desde fórmulas.

### 5.2 Cotizaciones con IVA «other» (tasa efectiva redondeada)

15 cotizaciones USD con tasa efectiva del legacy (13,7 %–20,4 %) guardada con un decimal; subtotal y
total cierran, pero IVA por línea vs. IVA de cabecera difiere entre 0,14 y 18,18:

| Documento | Tasa guardada | Dif. IVA (líneas − cabecera) |
|---|---|---|
| COTI02266 | 20,0 | 3,02 |
| COTI02310 | 19,9 | −18,18 |
| COTI02337 | 19,9 | −1,04 |
| COTI02351 | 13,7 | 4,47 |
| COTI02370 | 20,4 | 1,77 |
| COTI02376 | 19,9 | −1,03 |
| COTI02383 | 17,9 | 11,04 |
| COTI02410 | 15,7 | −0,31 |
| COTI02432 | 15,8 | 0,52 |
| COTI02433 | 15,8 | 0,14 |
| COTI02468 | 19,9 | −2,66 |
| COTI02489 | 20,0 | 3,36 |
| COTI02490 | 17,9 | 3,25 |
| COTI02497 | 19,7 | −7,98 |
| COTI02511 | 15,8 | 1,21 |

Severidad **baja** (el total del documento es el del legacy). Causa: el legacy no tenía IVA por
línea; la importación representó la tasa efectiva. Corrección propuesta: ninguna automática; si
alguna se reabre, revisar alícuotas reales por ítem.

### 5.3 Pedidos cuyo subtotal no es la suma de las líneas

Todos marcados `TOTALS_DO_NOT_CLOSE` desde la importación. La cabecera es la del legacy; las líneas
no reflejan un descuento aplicado sólo al total:

| Pedido | Moneda | Subtotal cabecera | Σ líneas | Diferencia | Descuento implícito |
|---|---|---|---|---|---|
| PDV01202 | USD | 12.552,00 | 15.690,00 | 3.138,00 | 20 % |
| PDV01211 | USD | 1.296,00 | 1.440,00 | 144,00 | 10 % |
| PDV01212 | USD | 7.160,37 | 8.950,46 | 1.790,09 | 20 % |
| PDV01229 | USD | 653,13 | 687,50 | 34,37 | 5 % |
| PDV01241 | USD | 18.762,90 | 22.074,00 | 3.311,10 | 15 % |
| PDV01247 | USD | 787,50 | 1.050,00 | 262,50 | 25 % |
| PDV01268 | USD | 5.054,00 | 5.320,00 | 266,00 | 5 % |
| PDV01283 | USD | 1.975,72 | 2.079,70 | 103,98 | 5 % |
| PDV01291 | USD | 1.824,32 | 2.432,43 | 608,11 | 25 % |
| PDV11284 | USD | 871,63 | 917,50 | 45,87 | 5 % |
| PDV01151 | USD | 13,50 | 0,00 | −13,50 | líneas con precio 0 |
| PDV01279 | USD | 2.694,50 | 0,00 | −2.694,50 | líneas con precio 0 |

Severidad **media** (histórico). Causa probable: descuento global cargado en el legacy sin
`dtoGlobal`. Corrección propuesta: registrar el descuento global en la cabecera (`discount_pct`) tras
confirmar con el pedido del cliente; no tocar líneas.

### 5.4 Remitos

Las líneas importadas no tienen precio (el legacy no lo guardaba en el remito): el total de los 182
remitos **no se puede recalcular** desde las líneas; se conserva el del legacy. Los remitos nuevos
del ERP sí copian precio, descuento e IVA de la línea del pedido (verificado en el fixture).

Fórmula del servidor verificada en el fixture: neto de línea → descuento global → IVA por línea →
percepción; los totales que manda el cliente se ignoran.

## 6. Productos

| Chequeo | Cotizaciones (992) | Pedidos (593) | Remitos (600) |
|---|---|---|---|
| Con producto | 906 | 555 | 538 |
| `MISSING_PRODUCT` (SKU no existe en el catálogo) | 86 | 38 | 62 |
| Resolubles hoy por SKU exacto o mayúsculas | 0 | 0 | 0 |
| `AMBIGUOUS_SKU` | 0 | 0 | 0 |
| `WRONG_PRODUCT_LINK` (SKU del producto ≠ SKU de la línea) | 0 | 0 | 0 |
| Producto dado de baja | 0 | 0 | 0 |
| `DESCRIPTION_MISMATCH` (similitud nombre < 0,3) | 67 | 32 | 33 |

- Los 186 SKU sin producto son de prefijos `PRO`, `SER` y `B20` (servicios y productos que no
  entraron al catálogo). Las líneas conservan el snapshot completo: el documento se lee igual.
- `DESCRIPTION_MISMATCH` es histórico (nombre del momento vs. nombre actual del catálogo);
  severidad baja; no se corrige.
- **Delta:** 31 SKU en los 10 documentos faltantes; **10 no existen en React**: PRO12600, PRO12602,
  PRO12603, PRO12604, PRO12605, PRO12606, PRO12608, PRO12609, PRO12610 y B2036LA-2. El SKU `PRO`
  más alto del catálogo React es PRO12595: **STEL sigue dando de alta productos** que el ERP no tiene.

### Productos y precios para emitir (U-B-2 sigue abierta)

| Pregunta | Hoy |
|---|---|
| Maestro de productos | Catálogo React (21.772 productos de Buscatools), cargado del legacy/STEL el 2026-09-08/09; **no se sincroniza** con STEL |
| De dónde sale el precio | Sólo de la **lista por defecto** de la empresa: «Lista base», USD, 12.254 productos con precio (9.518 sin precio) |
| Qué precio usa una cotización nueva | El de la lista por defecto **sólo si la moneda del documento es la de la lista (USD)**; en ARS/EUR no se sugiere |
| Si no hay precio | La línea entra con **precio 0** y se completa a mano; guardar con precio 0 no se bloquea |
| Memoria de precios por cliente | Existe (Clientes), **no se usa** al cotizar |
| Moneda por defecto | USD al crear; al convertir cotización → pedido, **USD si la cotización no tiene moneda** |
| Descuento | Por línea y global; el servidor recalcula |
| Listas «Distribuidores» y «Especial Cliente Demo» | 124 precios cada una, alta 2026-09-08: parecen semillas de prueba en la empresa real (a revisar) |

## 7. Moneda

- **Sin moneda: 32 documentos importados**, todos marcados `MISSING_CURRENCY`:
  COTI02531, COTI02532, COTI02533, COTI02534, COTI02539, COTI02540 · PDV01301, PDV01302, PDV01303,
  PDV01304, PDV01305, PDV01306, PDV01311, PDV01312, PDV01313, PDV01314, PDV01315 ·
  RT-ML2025000061, RT0000001410 a RT0000001423.
  Más **9 del delta** (6 cotizaciones y 3 remitos de STEL): 41 en total en la fuente.
- **Moneda distinta entre cotización y pedido:** PDV01223 (USD) ← COTI02339 (ARS).
- **Moneda distinta entre pedido y remito:** RT0000001382 (ARS) ← PDV01274 (USD).
- **Moneda que no es USD, sin tipo de cambio:** 104 documentos (`NO_EXCHANGE_RATE`).
- **USD por defecto aplicado mal:** no hay documentos nativos, así que no se puede observar en el
  histórico; el riesgo existe en el código de conversión (una cotización sin moneda genera un pedido
  en USD sin que nadie lo elija — reproducido en el fixture).

## 8. Vínculos

- Pedidos sin cotización: 34 (`NO_QUOTE_LINK`). Remitos sin pedido: 42 (`NO_ORDER_LINK`).
- Líneas de remito sin línea de pedido: 116 (ambiguas o no resueltas en Stage 2.5; incluye
  `ORDER_LINE_AMBIGUOUS`, `ORDER_LINE_UNRESOLVED` y `OVERDELIVERED`).
- Pedidos y remitos emparejados con la fuente: el vínculo coincide en los 166 pedidos y 182 remitos.

## 9. Detalle de errores

| Documento(s) | Campo | Fuente | React | Severidad | Causa probable | Corrección propuesta (NO ejecutada) |
|---|---|---|---|---|---|---|
| COTI02541–02547 | documento | existe | no existe | **Alta** (cutover) | Delta posterior a la importación | Importar el delta con la vía de importación (service role + `imported_at`) antes del corte |
| RT0000001424–1426 | documento y número | existe | no existe; secuencia = 1424 | **Crítica** | STEL siguió emitiendo remitos | Importar los 3 remitos y llevar la secuencia a (último RT de STEL + 1) en el corte |
| Todo lo emitido en STEL después del 2026-09-12 | documento | desconocido | — | **Crítica** | Sync caído (legacy restringido) | Leer en STEL los últimos números y documentos antes del corte |
| 10 SKU del delta | producto | existe en STEL | no existe | Alta | STEL da de alta productos que el catálogo no recibe | Resolver U-B-2 y dar de alta esos productos antes de emitir |
| 32 + 9 documentos | moneda | vacía | NULL | Media | STEL no envía moneda | Completar a mano con respaldo documental; no asumir USD |
| PDV01223 / RT0000001382 | moneda | distinta en la cadena | idem | Media | Carga legacy | Confirmar con el comprobante real |
| 62 docs STEL | subtotal/IVA | null | 0 | Media | Sync sin desglose | Reconstruir desde STEL |
| 12 pedidos §5.3 | subtotal vs líneas | descuento sólo en total | idem | Media | Descuento global no registrado | `discount_pct` de cabecera tras confirmar |
| 15 cotizaciones §5.2 | IVA línea vs cabecera | tasa efectiva | redondeada | Baja | Sin IVA por línea en el legacy | Ninguna automática |
| 186 líneas | product_id | SKU sin producto | NULL | Baja (histórico) | Servicios / productos fuera del catálogo | Ninguna; snapshot conservado |
| 9 pedidos PDV11xxx | número | con un 1 de más | idem | Baja | Tipeo | Mantener; documentar |
| 104 documentos | tipo de cambio | vacío | NULL | Baja | El legacy no lo guardaba | Ninguna automática |

## 10. Flujo de stock y fixture end-to-end

Script `scripts/fase14-ventas-cutover-fixture-tests.mjs` (empresa `zz-f14-erp`, sin autoridad STEL,
secuencias COTI/PDV/RT con los mismos formatos que Buscatools). **Resultado: TODO PASA**, datos
reales idénticos antes/después (secuencias, autoridad, saldos, documentos, movimientos, reservas,
eventos).

| Paso | Verificado |
|---|---|
| Cotización USD completa | 4 líneas (IVA 21, IVA 10,5, capítulo, servicio exento), descuento de línea y global 2 %, percepción 3 %, notas; número COTI02629; guardar → reabrir: cabecera y líneas idénticas; totales del servidor = cuenta (839,86 / 135,30 / 975,16) |
| Editar borrador | cantidad y descuento global → el servidor recalcula (904,40 / 152,82 / 1.057,22); totales enviados por el cliente se ignoran |
| ARS con tipo de cambio | se guarda en pesos, sin conversión |
| Sin moneda | se puede guardar; al convertir, la regla de la UI pone USD (riesgo) |
| Enviar / aceptar | eventos auditados; la aceptada queda congelada (el trigger rechaza editar líneas) |
| Cotización → pedido | PDV01316, `quote_id`, mismas líneas, precios, cantidades, moneda y totales; la cotización no cambia de estado; segunda conversión rechazada por índice único **pero el número pedido antes ya se consumió** (PDV01317 quemado) |
| Remito parcial | RT0000001427 en borrador: **0 movimientos** |
| Confirmar y despachar | 2 movimientos `sale_delivery` negativos, saldo 50→49 y 50→48, pedido `partially_delivered`; re-despachar es idempotente |
| Sobreentrega | la línea se rechaza; el remito vacío queda creado si no lo borra la UI (la UI lo borra) |
| Cancelar borrador | sin movimientos |
| Resto | con todas las líneas de producto entregadas **sigue parcial** hasta entregar también la línea de servicio (el cumplimiento sólo excluye capítulos); la línea de servicio no mueve stock; luego `delivered` |
| **Cancelar un remito ya despachado** | **se permite, sin movimiento compensatorio ni recálculo del cumplimiento** (saldo queda descontado, pedido sigue `delivered`) |
| Secuencias | avanzan una vez por cada número pedido, incluidos los intentos fallidos |

## 11. Permisos (JWT reales, fixture)

| Rol | Leer | Numerar | Crear | Editar borrador | Emitir (enviar) | Confirmar pedido | Despachar |
|---|---|---|---|---|---|---|---|
| admin | sí | sí | sí | sí | sí | sí | sí |
| employee | sí | sí | sí | sí | sí | sí | sí |
| salesperson | sí | no (permiso) | no (permiso) | no (0 filas) | no | no | no (permiso) |
| technician | sí | no | no | no | no | no | no |
| customer | sí (su cliente) | no | no | no | no | no | no |
| distributor | sí (su cliente) | no | no | no | no | no | no |
| anon | no | no | no | no | no | no | no |

Sin cambios de permisos. **Nota para el cutover:** hoy un vendedor no puede crear cotizaciones en
el ERP; si en STEL sí lo hace, es una decisión de negocio pendiente.

## 12. Convivencia con STEL

- ¿Puede STEL importar de vuelta al ERP? **No**: el sync sólo escribe en `erp_store` del legacy.
- ¿Puede haber documentos paralelos? **Sí**: STEL numera por su cuenta. Si el ERP emite COTI02629 y
  STEL sigue emitiendo, STEL llegará a 2629 y habrá dos documentos con el mismo número en sistemas
  distintos; en remitos ya ocurre hoy (1424–1426).
- El sync diario no genera documentos nuevos en STEL ni en el ERP, pero seguiría copiando al legacy
  lo que STEL emita (cuando el legacy vuelva a tener cuota).
- **No hay coexistencia posible para el mismo tipo y serie.** El corte exige congelar STEL por tipo.

## 13. Clasificación

| Tipo | Clasificación | Motivo |
|---|---|---|
| **quotes** | **READY_WITH_FIXES** | Histórico reconciliado 288/288 con 0 diferencias; secuencia 2629 por encima de lo conocido; fixture PASS. Faltan: congelar STEL y conocer su último número, importar el delta (7 + lo posterior al 09-12), dar de alta los SKU faltantes (U-B-2), decidir la moneda por defecto al convertir |
| **sales_orders** | **READY_WITH_FIXES** | 166/166 con 0 diferencias; fixture PASS. Faltan: congelar STEL y confirmar que no emitió PDV01316+ (la secuencia está al límite), moneda por defecto al convertir, número quemado si falla el alta |
| **deliveries** | **NOT_READY** | Colisión confirmada (secuencia 1424 vs RT0000001426 ya emitido); 3+ remitos faltantes; cancelar un remito despachado deja el stock descontado sin compensar; histórico sin precios; RT-ML sin secuencia |

Criterios READY no cumplidos por ningún tipo: **convivencia con STEL resuelta** y **documentos del
delta reconciliados**. Ver el plan en `PHASE_14_ENTREGA_0_APARIENCIA_Y_CUTOVER.md`.
