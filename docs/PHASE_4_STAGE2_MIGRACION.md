# Fase 4 · Stage 2 — migración histórica de Ventas

Ejecutada el 2026-09-09. **Reconciliación con 0 deltas.**

Fuente: el respaldo read-only del `erp_store` legacy
(`erp_store-completo.json`, sha256 `c396002891e35e06…`), fuera del repositorio.

---

## Resultado

| | legacy | migrado | Δ |
|---|---:|---:|---:|
| cotizaciones | 288 | **288** | 0 |
| pedidos | 166 | **166** | 0 |
| entregas | 182 | **182** | 0 |
| **documentos** | **636** | **636** | **0** |
| líneas de cotización | 992 | 992 | 0 |
| líneas de pedido | 593 | 593 | 0 |
| líneas de entrega | 600 | 600 | 0 |
| **líneas** | **2.185** | **2.185** | **0** |

Los 636 números originales coinciden **uno a uno**, sin faltantes ni sobrantes.
Vínculos: 132 pedidos con cotización y 140 entregas con pedido, exactos. Todos
los documentos tienen cliente resuelto.

### Clasificación

| | documentos |
|---|---:|
| `MIGRABLE_AUTOMATIC` | **409** (64,3 %) |
| `MIGRABLE_WITH_REVIEW` | **145** (22,8 %) |
| `UNRESOLVED` | **82** (12,9 %) |

Idénticos a los aprobados. **Los 636 se migraron**: la clasificación describe
la confianza en el dato, no si el documento entró.

### Otras entidades

| | |
|---|---:|
| clientes creados | **57** (de 3 a 60) |
| contactos migrados | **55** de 87 |
| equivalencias producto↔cliente | **14** de 15 |
| candidatos de OC | **134** (113 alta · 8 media · 13 baja) |

---

## Reconciliación monetaria — sin sumar monedas

| moneda | docs | total legacy | total migrado | con TC |
|---|---:|---:|---:|---:|
| ARS | 104 | 132.925.694,71 | **132.925.694,71** | 1 |
| USD | 499 | 2.055.384,70 | **2.055.384,70** | 1 |
| EUR | 1 | 6.711,81 | **6.711,81** | 0 |
| SIN MONEDA | 32 | 13.165.570,54 | **13.165.570,54** | 0 |

Exacto al centavo en las cuatro. **No se presenta ningún total global**: sumar
ARS con USD no significa nada.

De los 105 documentos en moneda distinta de USD, **uno solo** tiene tipo de
cambio. Los otros 104 quedaron con `exchange_rate = NULL` y
`NO_EXCHANGE_RATE`. No se inventó ninguno.

---

## Cola de revisión — 227 documentos

| motivo | docs | cot | ped | ent | ejemplos |
|---|---:|---:|---:|---:|---|
| `NO_EXCHANGE_RATE` | 104 | 48 | 27 | 29 | COTI02251, COTI02252 |
| `UNRESOLVED_SKU` | 91 | 39 | 20 | 32 | COTI02251, COTI02260 |
| `TOTALS_DO_NOT_CLOSE` | 82 | 19 | 32 | 31 | COTI02519, COTI02520 |
| `NO_ORDER_LINK` | 42 | — | — | 42 | RT-ML2025000058 |
| `NO_QUOTE_LINK` | 34 | — | 34 | — | PDV01153, PDV01154 |
| `MISSING_CURRENCY` | 32 | 6 | 11 | 15 | COTI02531, COTI02532 |
| `NUMBER_OUTLIER` | 9 | — | 9 | — | PDV11157, PDV11209 |
| `DELIVERED_BY_ARRAY_INDEX` | 4 | — | 4 | — | PDV01295, PDV01296 |

---

## Los 4 pedidos con el array `entregado` — informe manual

**La cantidad entregada NO se migró desde el array.** Se informa para que
decidas, como pediste.

Los cuatro son **inequívocos**: los SKU son únicos dentro de cada pedido, los
índices están en rango, y cada pedido tiene una nota de entrega enlazada cuyas
líneas coinciden **exactamente** con las cantidades del array.

| pedido | cliente | array | nota de entrega | coincide |
|---|---|---|---|---|
| PDV01295 | Grupo Mirgor | `{0:2}` | RT0000001406 · PRO12586 ×2 | **sí** |
| PDV01296 | Cerraduras Prive | `{0:1}` | RT0000001407 · PRO09792 ×1 | **sí** |
| PDV01297 | Gilera Motors | `{0:2, 1:4}` | RT0000001408 · PRO12584 ×2, PRO12585 ×4 | **sí** |
| PDV01300 | Whirlpool | `{0:30, 1:6, 2:2}` | RT0000001409 · PRO05462 ×30, SER00006 ×6, SER00007 ×2 | **sí** |

El array era **redundante**: la nota de entrega ya tiene esas cantidades y ya
está migrada. Lo único que falta es el `order_line_id` en esas líneas de
entrega, que se podría poner por coincidencia exacta de SKU sin ambigüedad.
**No lo hice**: pediste documentarlo, no enlazarlo. Es una decisión tuya.

### Una limitación que vale para las 182 entregas, no sólo para estas 4

**Ninguna línea de entrega histórica tiene `order_line_id`.** El legacy nunca
guardó esa relación —sólo `fromPedido` a nivel documento—, así que deducirla
por posición sería inventarla.

Consecuencia práctica: para los pedidos históricos **no se puede derivar la
cantidad pendiente por línea**. Para los pedidos nuevos sí, porque el modelo lo
exige desde el principio.

---

## Números originales

**Ninguno se modificó.** Los 9 `PDV11xxx` conservan su número literal en
`number` y en `original_number`, con `number_outlier = true`,
`needs_review = true`, y la sospecha en `suspected_normalized_number` —
registrada, nunca aplicada.

Las secuencias **no se movieron** por los outliers: siguen en `quote=2541`,
`sales_order=1316`, `delivery=1424`.

### Dos series de remito, no una

| serie | remitos | rango |
|---|---:|---|
| `RT0…` | **178** | RT0000001242 – RT0000001423 |
| `RT-ML…` | **4** | RT-ML2025000058 – RT-ML2025000061 |

La secuencia sembrada cubre sólo la serie `RT0`. Los cuatro `RT-ML` son otra
numeración —por el prefijo, probablemente de MercadoLibre— y **no** los
absorbe. Si esa serie sigue en uso, necesita su propio `doc_type`. Pendiente de
tu decisión.

---

## Lo que NO se migró, y por qué

| tabla | filas | motivo |
|---|---:|---|
| `sales_invoices` | **0** | histórico NO DISPONIBLE / NO ENCONTRADO. No se reconstruye desde entregas |
| `payments` / `payment_allocations` | **0** | ídem |
| `customer_purchase_orders` | **0** | ninguna OC se crea desde texto; hay 134 candidatos pendientes |
| `stock_movements` | **381** | **sin cambios** — la migración no altera el stock |
| `stock_reservations` | **0** | no se reserva stock por pedidos históricos |
| `sales_audit` | **0** | no se llena por migración |

---

## Producto

| | |
|---|---:|
| líneas totales | 2.185 |
| con `product_id` | **1.999 (91,5 %)** |
| sin resolver | 186 |

**Ninguna línea sin producto perdió su SKU**: las 186 conservan
`sku_snapshot`, `name_snapshot` y `description_snapshot`, así que el documento
histórico se lee completo aunque el producto no exista en el catálogo.

Prefijos sin resolver: `SER` 141 (servicios) · `PRO` 42 · `B` 3.
**No se creó ningún producto ficticio.**

---

## Impuestos

El legacy no tiene impuesto por línea: sólo un flag `iva` y un `ivaAmount` por
documento. Se registró el tratamiento **efectivo** de cada documento en sus
líneas, sin inventar un desglose que nunca existió:

`vat_21` cuando la alícuota efectiva es 21 % · `vat_105` cuando es 10,5 % ·
`not_taxed` cuando `iva = false` · `other` en los demás casos, con la alícuota
real en `tax_rate_snapshot`.

Los totales originales (`subtotal`, `tax_amount`, `total`) se guardaron tal
cual. **Los 82 documentos que no cierran no se recalcularon.**

---

## Cambios de esquema que hizo falta hacer

No son tablas nuevas: son columnas, y sin ellas la migración habría tenido que
elegir entre inventar un dato o perderlo.

| tabla | columnas |
|---|---|
| `sales_quotes`, `sales_orders`, `deliveries` | `title`, `subtotal`, `tax_amount`, `total`, `imported_at`, `legacy_source` |
| `deliveries` | `currency_code`, `exchange_rate` |
| `customers` | `legacy_name` |

Más tres índices únicos parciales sobre `(company_id, original_number)`, que
son la clave de idempotencia.

---

## Idempotencia

Segunda corrida completa: **0 inserciones**. Los diez conteos idénticos y la
huella sha256 de las 288 cotizaciones **idéntica**.

La clave estable es `(company_id, original_number)` —el `ref` del legacy—, que
funciona también para los 9 outliers porque el número se preserva literal.

---

## RLS con volumen real

Las 71 comprobaciones sobre los cinco roles, repetidas con los 636 documentos
cargados: **0 fallos**. Lo más significativo: con **166 pedidos históricos** en
la base, un cliente externo ve exactamente **1** —el suyo— y no llega al de
otro cliente ni por id exacto, ni por número, ni filtrando por el `customer_id`
ajeno, ni por el listado completo.

## Performance con volumen real

Mediana de 5 corridas, sesión real:

| consulta | mediana |
|---|---:|
| cotizaciones, página 1 con total exacto | 196 ms |
| pedidos por cliente | 190 ms |
| pedidos por rango de fecha | 191 ms |
| búsqueda por número exacto | 192 ms |
| detalle de pedido con líneas | 197 ms |
| entregas de un pedido | 194 ms |
| histórico cliente × producto | 220 ms |
| documentos con `needs_review` | 189 ms |
| candidatos de OC de confianza alta | 193 ms |

Todas en el **piso de ida y vuelta de red** (~190 ms, el mismo que medimos en
el catálogo). El tiempo de base es despreciable a este volumen. **No se agregó
ningún índice**: no hay nada que optimizar todavía.

---

## Bugs encontrados y corregidos

1. **Las claves de la memoria de equivalencias venían inconsistentes** en el
   legacy: unas ya normalizadas (`integra services`) y otras no
   (`grupo mirgor s.a.`). Las buscaba sin normalizar y el 75 % no matcheaba.
2. **`deliveries` no tenía `currency_code`.** La entrega del legacy es un
   remito valorizado con moneda y total propios; sin la columna la importación
   falló en el primer lote.
3. **La aserción de limpieza de las pruebas de RLS esperaba `sales_orders = 0`**,
   que dejó de ser cierto al haber histórico. Comparaba contra cero en vez de
   contra el estado previo.

## Casos sin migrar, reportados y no descartados

- **13 clientes nombrados sólo en contactos** (Whirlpool Brasil, Newsan
  Ushuaia, Selplast, Magna Argentina…) que no aparecen en ningún documento de
  venta. No se crearon: el alcance aprobado son los del histórico de ventas.
  Sus **32 contactos** quedaron sin migrar.
- **1 equivalencia** (`gmra s a u`) cuyo cliente no existe en el histórico.

Nada de esto se perdió: está en el respaldo del legacy y listado acá.
