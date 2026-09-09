# Fase 4 · Stage 2.5 — consolidación histórica

Ejecutado el 2026-09-09, después de Stage 2. Dos temas: las **series de remito**
y la reconstrucción de **`delivery_lines.order_line_id`**.

---

## A · Series de documento — **APLICADO**

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

### Cambio aplicado — migración `phase4_stage25_series_code`

El tipo de documento sigue siendo **uno solo**; lo que se multiplica es la
serie. No se creó ningún `delivery_ml`.

```sql
alter table document_sequences add column series_code text not null default '';
alter table document_sequences add column is_default  boolean not null default false;
update document_sequences set series_code = prefix, is_default = true;   -- COTI, PDV, RT
alter table document_sequences drop constraint document_sequences_pkey;
alter table document_sequences add primary key (company_id, doc_type, series_code);
create unique index uq_document_sequences_default
  on document_sequences (company_id, doc_type) where is_default;

alter table sales_quotes add column series_code text;
alter table sales_orders add column series_code text;
alter table deliveries   add column series_code text;

drop function if exists public.next_document_number(uuid, text);
create or replace function public.next_document_number(
  p_company uuid, p_doc_type text, p_series text default '') ...
   where company_id = p_company and doc_type = p_doc_type
     and case when coalesce(p_series,'') = '' then is_default
              else series_code = p_series end
```

#### Una columna más que el mínimo: `is_default`

`p_series = ''` tiene que significar **"la serie por defecto de este tipo"**, no
*"la serie cuyo código es la cadena vacía"*. Sin `is_default`, una vez que las
filas existentes pasan a llamarse `COTI` / `PDV` / `RT`, una llamada de dos
argumentos no encuentra ninguna fila y la compatibilidad se rompe.

Y hace algo más, que es exactamente tu punto 6: **garantiza que pedir un número
sin especificar serie nunca toque el contador de una serie secundaria.** El
índice único parcial impide que haya dos series por defecto para el mismo tipo.

No es simetría: sin esta columna el cambio no funciona.

#### Por qué `sales_invoices` NO la lleva

Su número puede venir de STEL, donde la "serie" sería el **punto de venta**. No
hay todavía ni una factura ni el formato real confirmado, así que la columna no
tendría ni un uso ni un valor — sería exactamente la simetría vacía que pediste
evitar. `external_number` ya guarda el número completo tal como lo emita el
sistema fiscal. Cuando llegue la primera factura real vamos a saber si el punto
de venta es la serie, y ahí se agrega con fundamento.

#### El overload había que eliminarlo

Con las dos firmas vivas, una llamada de dos argumentos queda **ambigua** y
PostgREST devuelve `PGRST203` — el mismo error que nos costó `catalog_facets` en
la Fase 3.6. Por eso `drop function ... (uuid, text)` antes de crear la de tres.

### Comportamiento verificado con llamadas reales

| intento | resultado |
|---|---|
| `next_document_number(c, 'delivery')` — firma vieja de 2 argumentos | **`RT0000001424`** · usa la serie por defecto |
| `next_document_number(c, 'delivery', 'RT')` — serie explícita | **`RT0000001425`** |
| `next_document_number(c, 'delivery', 'RT-ML')` | **rechazado** `no_data_found` |
| contador de `RT` después del intento de `RT-ML` | **no se movió** |
| `next_document_number(c, 'quote')` | **`COTI02541`** |

Las secuencias quedaron restauradas en `RT=1424`, `COTI=2541`, `PDV=1316`.

### RT-ML: soportada, conservada, NO emitida

- **El schema la soporta**: `series_code = 'RT-ML'` es un valor válido.
- **El histórico la conserva**: los cuatro documentos la llevan, y su
  `original_number` quedó **exactamente** como estaba.
- **La web nueva NO la emite**: no hay fila en `document_sequences`, así que
  pedirla devuelve `no_data_found`. Es un rechazo verificado, no una omisión.

Hasta decisión de negocio: no sabemos qué significa `ML`, qué significa el
`2025` embebido (los cuatro documentos son de **2026**, así que no es el año del
documento), si es parte fija, campaña o canal, cuál sería el próximo número, ni
quién debería poder emitirla.

### Series en los documentos históricos

`scripts/backfill-series-code.mjs`, reconociendo la serie por el prefijo del
número original y **sólo** si es una de las series conocidas de ese tipo:

| tabla | serie | documentos |
|---|---|---:|
| `sales_quotes` | `COTI` | 288 |
| `sales_orders` | `PDV` | 166 |
| `deliveries` | `RT` | 178 |
| `deliveries` | **`RT-ML`** | **4** |
| | **total** | **636** |

Cero documentos sin serie reconocida. Los 9 `PDV11xxx` quedan en `PDV`: son la
misma serie con un número raro, no otra serie. Ningún `original_number` ni
`number` se tocó.

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
| documentos con `series_code` | — | **636** |
| `document_sequences` | 6 | **6** |

La huella se volvió a medir **después** del cambio de series y sigue dando
`8091b916…`: agregar `series_code` no tocó ni un número, ni un total, ni una
moneda.

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

Segunda corrida completa con `--apply`, de los dos scripts, **después** del
cambio de series:

| | |
|---|---:|
| `backfill-order-line-id.mjs` · filas actualizadas | **0** |
| `backfill-order-line-id.mjs` · entregas marcadas | **0** |
| `backfill-series-code.mjs` · documentos actualizados | **0** |
| secuencias | **6** — ninguna duplicada |
| dos series por defecto para el mismo tipo | **0** |
| documentos duplicados por `(company_id, original_number)` | **0** |
| documentos sin `series_code` | **0** |

Los dos scripts recalculan la clasificación entera cada vez y sólo escriben lo
que difiere; la clasificación siguió dando 484 / 14 / 7.

## Bugs encontrados y corregidos

1. **200 `update` en paralelo hacían fallar el `fetch`.** La primera corrida
   murió a mitad de camino con `TypeError: fetch failed`. Se bajó el lote a 25
   con reintento exponencial. No hubo daño: como el script es idempotente, la
   segunda corrida completó las 308 que faltaban y la tercera confirmó 0.
2. **`.gitignore` tenía `.env.rls` sin comodín.** El archivo real quedó guardado
   como `.env.rls.txt` y **no estaba siendo ignorado**: aparecía como `??` en
   `git status`, a un `git add -A` de distancia de commitear dos contraseñas.
   Corregido a `.env.rls*` y verificado con `git check-ignore`.
3. **La limpieza de `stage1-ventas-tests.mjs` comparaba contra cero.** Esperaba
   `sales_quotes = 0`, `sales_orders = 0`, `deliveries = 0` y `customers = 3`,
   que era cierto en Stage 1 y dejó de serlo con los 636 documentos históricos:
   daba un FAIL con los fixtures perfectamente borrados. Ahora captura el estado
   previo y compara contra él, igual que hace la suite de RLS. Es el mismo bug
   que ya habíamos corregido en la suite de RLS, en el otro script.

## Nuevos motivos de revisión

| motivo | entregas |
|---|---:|
| `ORDER_LINE_AMBIGUOUS` | 7 |
| `ORDER_LINE_UNRESOLVED` | 7 |
| `OVERDELIVERED` | 2 |

Se **agregan** a los motivos existentes, nunca los reemplazan.

## RLS

`scripts/stage1-ventas-rls.mjs` se amplió con los dos vectores nuevos.

### Entregas y el `order_line_id` — el vector que introdujo el backfill

Para cada rol externo, con intento real:

- ve **su** entrega, y **no** la de otro cliente por id exacto
- **no** la encuentra por número de documento
- **no** lee `delivery_lines` de la entrega ajena por `delivery_id`
- **no** lee `delivery_lines` filtrando por el **`order_line_id` ajeno**
- **no** lee la `sales_order_line` ajena por su id exacto

### Series + RLS — `series_code` no es autorización

Las dos series se montan en la **misma empresa**, y cada rol externo es dueño de
una distinta (el cliente tiene `RT`, el distribuidor `RT-ML`), así que filtrar
por la otra serie es un intento real de cruce:

- ve sus documentos filtrando por **su** serie
- cambiar `series_code` **no** da acceso a la serie ajena
- serie ajena **+** su propia `company_id` sigue rechazado
- **no** puede reetiquetar la serie de su propia entrega
- **no** puede numerar pidiendo una serie
- un interno de Buscatools ve **las dos** series de su empresa

`series_code` no aparece en ninguna policy: el aislamiento sigue siendo por
`company_id` y por customer.

### Series: consistencia del contador

| | |
|---|---|
| `delivery` tiene **una sola** serie por defecto | `RT` |
| `RT-ML` **no** tiene secuencia activa | el schema la soporta, la web no la emite |
| la llamada sin serie usa la serie por defecto | `RT0000001424` |
| pedir `RT-ML` es rechazado | `P0002` |
| el intento de `RT-ML` **no** movió el contador de `RT` | 1424 → 1425 |
| contador restaurado | 1424 |

### Resultado con JWT reales — **110 checks, 110 PASS, 0 FAIL**

| bloque | checks | fallos |
|---|---:|---:|
| ADMIN · Buscatools | 10 | **0** |
| SALESPERSON · Torquetools | 8 | **0** |
| DISTRIBUTOR · Buscatools | 31 | **0** |
| CUSTOMER · Buscatools | 31 | **0** |
| ANON (sin sesión) | 23 | **0** |
| Series de documento | 6 | **0** |
| Limpieza | 1 | **0** |
| **total** | **110** | **0** |

**Ningún acceso inesperado. Ninguna policy necesita cambio.**

Jano multiempresa quedó probado en las dos direcciones: como ADMIN de Buscatools
ve también Torquetools, y como SALESPERSON de Torquetools ve también Buscatools
—y ninguno de los dos alcanza la tercera empresa, a la que no pertenece nadie.

### Secretos en los logs

La salida capturada se escaneó contra el valor real de `BT_PW_JANO`,
`BT_PW_TEST`, `SUPABASE_SECRET_KEY` y `VITE_SUPABASE_ANON_KEY`, más los
patrones `eyJ…` (JWT) y `sb_secret_…` / `sb_publishable_…`:

**0 coincidencias en los seis.** Las contraseñas sólo se pasan a
`signInWithPassword`; no se imprimen, no se loguean, no se commitean y no llegan
al frontend.

### Cómo correrlo

```bash
set -a; source .env; source .env.migration; source .env.rls; set +a
node scripts/stage1-ventas-rls.mjs
```

`.gitignore` cubre `.env.rls*` — el comodín importa: el archivo puede terminar
guardado como `.env.rls.txt` y `.env.rls` a secas no lo agarraba.

## Constraints e integridad

`scripts/stage1-ventas-tests.mjs`, con el histórico cargado: **32 checks, 0
fallos** — numeración concurrente, flujo completo, los 14 intentos que deben
fallar, y la auditoría que no se dispara sola.

Integridad de los 484 enlaces, **después** de correr las dos suites:

| comprobación | |
|---|---:|
| `delivery_lines` con `order_line_id` | **484** |
| FK rota | **0** |
| enlace que cruza de empresa | **0** |
| enlace a una línea de OTRO pedido | **0** |
| enlace a un pedido de OTRO cliente | **0** |
| `product_id` distinto | **0** |
| `sku_snapshot` distinto | **0** |
| huella md5 de los 636 documentos | **`8091b916…`** sin cambios |
| `document_sequences` · `stock_movements` · `sales_audit` | 6 · 381 · **0** |

No se cambió ninguna policy. Lo único que cambió en una función
`SECURITY DEFINER` es la firma de `next_document_number`, con el mismo control
de permiso por empresa que ya tenía.

---

## Regla para la UI histórica — anotada, no implementada

Queda escrita acá para cuando empiece la UI. **No se programó nada.**

Cuando `order_line_id` y las entregas permiten reconstruir, mostrar por línea:

```
Pedido      Entregado      Pendiente
```

Cuando **no** hay evidencia suficiente, mostrar algo equivalente a
*«Entrega histórica no reconstruida»* o *«No consta detalle completo de
entrega»*, y **no calcular un pendiente falso**.

### Los tres estados no son dos

| estado | qué significa | cuándo |
|---|---|---|
| `ENTREGADO` / `PENDIENTE` | hay evidencia por línea | 131 pedidos |
| `NO CONSTA ENTREGA` | **no sabemos** si hubo entrega | 21 pedidos |
| `DETALLE NO RECONSTRUIDO` | hay entrega, pero no se sabe a qué línea | 14 pedidos |

`NO CONSTA ENTREGA` **no es** `NO ENTREGADO`. Para esos 21 pedidos hay un remito
huérfano del mismo cliente que podría ser la entrega que falta; mostrar
«Pendiente = cantidad pedida» sería afirmar que no se entregó, y eso no está
demostrado.

`ENTREGADO > PEDIDO` (los 2 `OVERDELIVERED`) debe **mostrarse como
inconsistencia histórica**, no ocultarse ni corregirse.

---

## PHASE 4 — STAGE 2.5 = CLOSED

| criterio | estado |
|---|---|
| series schema | **PASS** — `(company_id, doc_type, series_code)`, 636 documentos con serie, RT-ML soportada y no emitible |
| backfill `order_line_id` | **PASS** — 484 de 505 (95,8 %), 0 anomalías de integridad |
| RLS con JWT real | **PASS** — 110 checks, 0 fallos, 5 roles |
| constraints | **PASS** — 32 checks, 0 fallos |
| idempotencia | **PASS** — segunda corrida de los dos scripts: 0 cambios |
| CI | **PASS** |

Cerrado el 2026-09-09.
