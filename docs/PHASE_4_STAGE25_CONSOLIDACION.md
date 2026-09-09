# Fase 4 · Stage 2.5 — consolidación histórica

Ejecutado el 2026-09-09, después de Stage 2. Dos temas: las **series de remito**
y la reconstrucción de **`delivery_lines.order_line_id`**.

---

## A · Series de remito — propuesta, NO aplicada

### Lo que dice el dato

| serie | remitos | rango de número | rango de fecha |
|---|---:|---|---|
| `RT0…` | **178** | RT0000001242 – RT0000001423 | 2026-01-06 → **2026-09-08** |
| `RT-ML…` | **4** | RT-ML2025000058 – RT-ML2025000061 | 2026-08-27 → **2026-09-07** |

**Las dos series están vivas al mismo tiempo.** No es que una reemplazó a la
otra: los últimos remitos de ambas son de esta misma semana. `RT-ML` no es un
resto histórico.

Dos cosas que **no** se afirman porque no hay evidencia:

- **`ML` no se interpreta.** Es probable que sea MercadoLibre; probable no es
  demostrado, y el dato no lo dice.
- **El `2025` embebido no es necesariamente un año.** Los cuatro documentos
  tienen fecha de 2026. Si fuera el año del documento, no coincidiría. Puede
  ser el año de alta de la serie, un identificador de canal, o nada.

Lo que sí se puede afirmar: la parte variable de `RT-ML` (…000058 → …000061)
avanza de a uno, así que **hay un contador propio**, distinto del de `RT0`.

### El modelo actual NO lo soporta

```sql
create table document_sequences (
  company_id  uuid not null references companies(id) on delete cascade,
  doc_type    text not null,
  prefix      text not null,
  padding     int  not null default 0,
  next_number bigint not null,
  primary key (company_id, doc_type)     -- ← una sola serie por tipo
);
```

La PK `(company_id, doc_type)` admite **una sola** serie por tipo de documento.
Hoy `delivery` es `RT` con padding 10, `next_number = 1424`. No hay dónde poner
un segundo contador sin inventar un `doc_type` falso.

### Cambio mínimo propuesto

Coincide con tu preferencia conceptual, y evita `delivery_ml`: el tipo de
documento sigue siendo **uno solo**, lo que se multiplica es la serie.

```sql
alter table document_sequences add column series_code text not null default '';
alter table document_sequences drop constraint document_sequences_pkey;
alter table document_sequences add primary key (company_id, doc_type, series_code);

-- la serie viaja con el documento, para saber de cuál salió cada número
alter table deliveries add column series_code text;

create or replace function public.next_document_number(
  p_company uuid, p_doc_type text, p_series text default '')
...
  update document_sequences
     set next_number = next_number + 1
   where company_id = p_company and doc_type = p_doc_type
     and series_code = p_series
```

**Impacto medido, no estimado:**

| | |
|---|---|
| filas existentes | 6, todas pasan a `series_code = ''` por el `default`. Ninguna se mueve |
| llamadas desde la UI | **0** — todavía no hay UI de Ventas |
| llamadas en el repo | 3, todas en `scripts/stage1-ventas-rls.mjs` |
| firma vieja | sigue funcionando: `p_series` tiene `default ''` |
| documentos históricos | **no se tocan**: `original_number` y `number` quedan literales |

### Qué NO se hace ahora

- **No se crea la secuencia `RT-ML`.** No hay confirmación de que la serie siga
  emitiéndose desde este sistema, y sembrar un contador sin saber su regla
  (¿el `2025` se recalcula? ¿es fijo?) es inventarla.
- **No se aplica el cambio de esquema.** Queda propuesto, con el impacto arriba.
- Los cuatro `RT-ML2025000058…61` conservan su `original_number` exacto.

---

## B · Backfill de `delivery_lines.order_line_id`

El legacy nunca guardó esta relación: sólo `fromPedido` a nivel documento. Se
reconstruyó donde la evidencia es inequívoca, con
[`scripts/backfill-order-line-id.mjs`](../scripts/backfill-order-line-id.mjs).

### Reglas aplicadas

1. Los candidatos se buscan **exclusivamente dentro del `sales_order` enlazado**.
2. `product_id` exacto, cuando ambos lados están resueltos.
3. `sku_snapshot` exacto (`btrim`), **sólo si** (2) no encontró ninguno.
4. Se enlaza **sólo con exactamente 1 candidata**. 0 → `UNRESOLVED`. 2+ → `AMBIGUOUS`.

Sin fuzzy, sin nombres parecidos, sin posición de array. **La cantidad nunca
decide el match**: se usa después, sólo para validar.

> **Sobre el tercer nivel de evidencia.** La regla de migración aprobada para el
> SKU es `trim()` y comparación exacta contra `products.sku`: no hay ninguna
> transformación adicional. Un tercer nivel "SKU legacy normalizado" sería
> idéntico al segundo, así que **no se agregó**. No había una regla más laxa que
> aplicar sin inventarla.

### Resultado

| | líneas | % del universo |
|---|---:|---:|
| `delivery_lines` totales | 600 | |
| sin pedido origen — fuera del universo | 95 | |
| **universo evaluable** | **505** | 100 % |
| **`UNIQUE_MATCH`** | **484** | **95,8 %** |
| · por `product_id` | 450 | 89,1 % |
| · por `sku_snapshot` | 34 | 6,7 % |
| `AMBIGUOUS` | 14 | 2,8 % |
| `UNRESOLVED` | 7 | 1,4 % |

**Doble evidencia en el 100 % de los enlaces.** Los 484 coinciden a la vez en
`product_id` **y** en `sku_snapshot`: 0 enlaces con producto distinto, 0 con SKU
distinto. Los dos criterios, aplicados por separado, dan el mismo resultado.

### Los 21 que no se enlazan

| pedido | entrega | SKU | qty | clase | motivo |
|---|---|---|---:|---|---|
| PDV01217 | RT0000001312 | GRAMPA.80-4T | 1 | `AMBIGUOUS` | el SKU está en 2 líneas del pedido |
| PDV01217 | RT0000001312 | GRAMPA.80-4T | 1 | `AMBIGUOUS` | ídem |
| PDV01234 | RT0000001348 | PRO12318 | 1 | `AMBIGUOUS` | 2 líneas |
| PDV01234 | RT0000001348 | PRO12318 | 24 | `AMBIGUOUS` | 2 líneas |
| PDV01237 | RT0000001338 | PRO12354 | 4 | `AMBIGUOUS` | 2 líneas |
| PDV01253 | RT0000001358 | PRO00001 | 6 | `AMBIGUOUS` | 2 líneas |
| PDV01253 | RT0000001358 | PRO00001 | 5 | `AMBIGUOUS` | 2 líneas |
| PDV01255 | RT0000001360 | GRAMPA.80-4T | 1 | `AMBIGUOUS` | **3** líneas |
| PDV01255 | RT0000001360 | GRAMPA.80-4T | 1 | `AMBIGUOUS` | 3 líneas |
| PDV01255 | RT0000001360 | GRAMPA.80-4T | 1 | `AMBIGUOUS` | 3 líneas |
| PDV01282 | RT0000001399 | SP.2007VPCM | 4 | `AMBIGUOUS` | 2 líneas |
| PDV01282 | RT0000001399 | SP.2007VPCM | 3 | `AMBIGUOUS` | 2 líneas |
| PDV11252 | RT0000001378 | SP.J2317HL | 8 | `AMBIGUOUS` | 2 líneas |
| PDV11252 | RT0000001378 | SP.J2317HL | 6 | `AMBIGUOUS` | 2 líneas |
| PDV01182 | RT0000001273 | PRO12283 | 1 | `UNRESOLVED` | el SKU no está en el pedido |
| PDV01239 | RT0000001356 | TC.QSP100N4 | 5 | `UNRESOLVED` | ídem |
| PDV01263 | RT0000001369 | PRO11572 | 10 | `UNRESOLVED` | ídem |
| PDV01266 | RT0000001371 | PRO12495 | 1 | `UNRESOLVED` | ídem |
| PDV11157 | RT0000001262 | SP.VPTX15/70 | 100 | `UNRESOLVED` | ídem |
| PDV11225 | RT0000001327 | PRO12329 | 1 | `UNRESOLVED` | ídem |
| PDV11239 | RT0000001357 | PRO12466 | 4 | `UNRESOLVED` | ídem |

Los 14 `AMBIGUOUS` son el mismo caso repetido: el pedido repite el SKU en dos o
tres líneas —distinto precio, distinta condición— y **el remito no dice de cuál
salió**. Elegir una sería inventar. Quedan con `order_line_id = NULL`.

Los 7 `UNRESOLVED` se entregaron con un SKU que **no figura en el pedido**. Es
un dato del negocio, no un fallo del match: se entregó algo distinto de lo
pedido, o el remito se enlazó al pedido equivocado en el legacy.

### Los 4 pedidos con el array `entregado[idx]` — 7/7 `UNIQUE_MATCH`

| pedido | entrega | SKU | línea de pedido | qty pedido | qty entrega | motivo |
|---|---|---|---:|---:|---:|---|
| PDV01295 | RT0000001406 | PRO12586 | 1 | 2 | 2 | `PRODUCT_ID_UNIQUE` |
| PDV01296 | RT0000001407 | PRO09792 | 1 | 1 | 1 | `PRODUCT_ID_UNIQUE` |
| PDV01297 | RT0000001408 | PRO12584 | 1 | 2 | 2 | `PRODUCT_ID_UNIQUE` |
| PDV01297 | RT0000001408 | PRO12585 | 2 | 4 | 4 | `PRODUCT_ID_UNIQUE` |
| PDV01300 | RT0000001409 | PRO05462 | 1 | 30 | 30 | `PRODUCT_ID_UNIQUE` |
| PDV01300 | RT0000001409 | SER00006 | 2 | 6 | 6 | `SKU_UNIQUE` |
| PDV01300 | RT0000001409 | SER00007 | 3 | 2 | 2 | `SKU_UNIQUE` |

**7 de 7**, y las cantidades coinciden exactamente en los siete. Ninguno se
enlazó por posición de array: los siete salieron de la misma regla general.

---

## C · Validación por cantidad

Después de proponer los enlaces, `sum(delivery_lines.quantity)` contra
`sales_order_lines.quantity_ordered`:

| | order lines | |
|---|---:|---|
| `OK` | **459** | entregado = pedido |
| `UNDERDELIVERED` | 22 | **es válido**: significa pendiente |
| `OVERDELIVERED` | **2** | requiere revisión |
| `UNKNOWN` | 56 | del pedido, sin ninguna entrega enlazada |

Los dos `OVERDELIVERED`:

| pedido | línea | SKU | pedido | entregado |
|---|---:|---|---:|---:|
| PDV01181 | 1 | TE.X-LIGHT.1 | 1 | **2** |
| PDV01238 | 1 | PRO12354 | 4 | **7** (en 2 remitos) |

**No se corrigió ninguna cantidad.** Las dos entregas quedaron marcadas
`OVERDELIVERED` en `review_reason`.

---

## D · Impacto sobre el pendiente por línea

**Antes: 0 de 166.** Sin `order_line_id`, `delivered` por línea no existía.

| | pedidos | |
|---|---:|---|
| **`COMPLETO`** | **126** | todas sus líneas de entrega enlazadas |
| `SIN_ENTREGA` sin remito huérfano del cliente | **5** | `delivered = 0` es confiable |
| **subtotal confiable** | **131 / 166 · 78,9 %** | |
| `PARCIAL` | 9 | algunas líneas enlazadas, otras no |
| `SIN_RECONSTRUIR` | 5 | ninguna línea enlazada (todas ambiguas) |
| `SIN_ENTREGA` **con** remito huérfano del mismo cliente | 21 | ver abajo |

### Los 21 que no se pueden dar por no entregados

Hay **42 remitos sin pedido**. De los 26 pedidos sin entrega enlazada, **21
tienen al menos un remito huérfano del mismo cliente** (28 remitos implicados).
`delivered = 0` para esos 21 **no está demostrado**: puede haber una entrega
real que el legacy nunca enlazó.

Decir "pendiente = todo" ahí sería una afirmación sin respaldo. La UI histórica
tiene que poder mostrar *"no consta entrega"*, que no es lo mismo que
*"no se entregó"*.

---

## Reconciliación post-backfill

Instantánea completa antes y después:

| | antes | después |
|---|---:|---:|
| cotizaciones / pedidos / entregas | 288 / 166 / 182 | **288 / 166 / 182** |
| líneas (cot / ped / ent) | 992 / 593 / 600 | **992 / 593 / 600** |
| clientes | 60 | **60** |
| suma de cantidades (ent / ped / cot) | 1.605.066,01 / 1.604.229 / 1.608.335 | **idénticas** |
| huella md5 de número+total+moneda de los 636 | `8091b916…` | **`8091b916…`** |
| `stock_movements` | 381 | **381** |
| `sales_audit` / `sales_invoices` / `payments` | 0 / 0 / 0 | **0 / 0 / 0** |
| `delivery_lines` con `order_line_id` | 0 | **484** |
| entregas con `needs_review` | 81 | 95 |

**Lo único que cambió es lo autorizado**: `order_line_id` en 484 líneas y el
`review_reason` de 16 entregas. Ni un número, ni una cantidad, ni un total, ni
un cliente.

### Integridad de los enlaces

| comprobación | |
|---|---:|
| enlaces que cruzan de empresa | **0** |
| enlaces a una línea de OTRO pedido | **0** |
| enlaces con `product_id` distinto | **0** |
| enlaces con `sku_snapshot` distinto | **0** |

## Idempotencia

Segunda corrida completa con `--apply`: **0 filas actualizadas, 0 entregas
marcadas**, y las mismas 484 / 14 / 7. La clasificación se recalcula entera cada
vez y sólo escribe lo que difiere.

## Bug encontrado y corregido

**200 `update` en paralelo hacían fallar el `fetch`.** La primera corrida murió
a mitad de camino con `TypeError: fetch failed`. Se bajó el lote a 25 con
reintento exponencial. No hubo daño: como el script es idempotente, la segunda
corrida completó las 308 que faltaban y la tercera confirmó 0.

## Nuevos motivos de revisión

| motivo | entregas |
|---|---:|
| `ORDER_LINE_AMBIGUOUS` | 7 |
| `ORDER_LINE_UNRESOLVED` | 7 |
| `OVERDELIVERED` | 2 |

Se **agregan** a los motivos existentes, nunca los reemplazan.

## RLS

Se verificó que la política de `delivery_lines` y `deliveries` sigue en pie (RLS
habilitada, 2 policies cada una, sin cambios) y que ningún enlace cruza empresa
ni pedido — que es el único vector nuevo que introduce el backfill.

**La regresión con JWT reales de los 5 roles no se pudo correr**: necesita
`BT_PW_JANO` y `BT_PW_TEST` en el entorno, y no están. El comando es:

```bash
BT_PW_JANO=… BT_PW_TEST=… node scripts/stage1-ventas-rls.mjs
```

No se cambió ninguna policy, ninguna función `SECURITY DEFINER` y ningún `grant`.
