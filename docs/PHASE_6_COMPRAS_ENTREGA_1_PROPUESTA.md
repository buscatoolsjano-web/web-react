# Fase 6 · Compras — entrega 1: schema propuesto

**Propuesta para aprobación. No se ejecutó ningún SQL, no se creó ninguna
tabla.**

---

## Antes que nada: tres cosas que ya existen y no hay que crear

| lo que pediste | lo que ya hay |
|---|---|
| definir un depósito principal (`is_default` / `is_primary`) | **`warehouses.is_default` ya existe** y las dos empresas ya tienen su `PRIN` marcado. Sólo falta el índice único parcial que impida dos |
| no crear una segunda tabla de adjuntos | **`attachments.entity_type` ya acepta `'purchase_order'`**. Hay que sumarle `goods_receipt` y `supplier_invoice` al CHECK, nada más |
| numeración | **`document_sequences`** con `(company_id, doc_type, series_code)` y `next_document_number()` sirven tal cual |

Y una corrección de vocabulario sobre tu punto 3: el schema **no usa
`currency_id`**. La convención de todo el proyecto es
**`currency_code text` con FK a `currencies(code)`** —hoy `ARS`, `USD`, `EUR`—
más `exchange_rate numeric`. Propongo seguir esa convención para no tener dos
formas de decir lo mismo. El requisito de fondo —una moneda por documento, NOT
NULL— se cumple igual.

---

## A · Schema propuesto

Siete tablas. Ninguna columna sin caso de uso.

### `suppliers`

```sql
create table suppliers (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id),
  legacy_ref        text,                     -- PROV00008
  legal_name        text not null,
  trade_name        text,
  tax_id            text,                     -- hoy los 142 lo tienen vacío
  email             text,
  phone             text,
  address_text      text,                     -- la dirección legacy, TAL CUAL
  activity          text,
  agent             text,                     -- «agente» del legacy
  payment_terms     text,                     -- forma de pago POR proveedor
  default_currency  text references currencies(code),
  notes             text,
  status            text not null default 'active'
                    check (status in ('active','inactive')),
  legacy_source     text,
  imported_at       timestamptz,
  needs_review      boolean not null default false,
  review_reason     text,
  deleted_at        timestamptz,              -- baja lógica, como customers
  created_by        uuid references profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
```

- `address_text` y no cinco columnas: **el legacy sólo tiene texto**, y 122 de
  142 direcciones *parecen* estructuradas pero 20 son sólo «AR». Partirlas por
  ` · ` sería una suposición. Si mañana hace falta dirección estructurada para
  proveedores nuevos, se agrega `supplier_addresses` con el mismo modelo que
  `customer_addresses` — pero no ahora, sin ningún caso.
- **No propongo `supplier_contacts`.** Los contactos existen sólo dentro de
  `notas` y quedó decidido no extraerlos. Crear la tabla vacía sería crear una
  pantalla que nadie puede llenar.
- Índices: `(company_id, legacy_ref)` único parcial, `(company_id, tax_id)`
  único parcial sobre el CUIT normalizado a once dígitos —el mismo que
  resolvió el problema en Clientes—, y trigram sobre `legal_name`.

### `purchase_orders` + `purchase_order_lines`

```sql
create table purchase_orders (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id),
  supplier_id           uuid not null references suppliers(id),
  number                text not null,        -- PC00002…
  series_code           text not null default 'PC',
  status                text not null default 'draft'
                        check (status in ('draft','confirmed','cancelled')),
  receipt_status        text not null default 'pending'
                        check (receipt_status in ('pending','partially_received','received')),
  currency_code         text not null references currencies(code),
  exchange_rate         numeric(18,6),        -- snapshot; null si no hay
  order_date            date not null,
  expected_date         date,                 -- ETA, en cabecera
  payment_terms         text,                 -- snapshot del proveedor
  notes                 text,
  subtotal              numeric(18,4) not null default 0,
  tax_amount            numeric(18,4) not null default 0,
  total                 numeric(18,4) not null default 0,
  created_by            uuid references profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (company_id, number)
);

create table purchase_order_lines (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id),
  purchase_order_id     uuid not null references purchase_orders(id) on delete cascade,
  line_no               int  not null check (line_no > 0),
  line_type             text not null default 'product'
                        check (line_type in ('product','chapter','free')),
  product_id            uuid references products(id),      -- nullable: línea libre
  sku_snapshot          text,
  name_snapshot         text,
  description_snapshot  text,
  quantity              numeric(18,4) not null check (quantity > 0),
  unit_price            numeric(18,4),
  discount_pct          numeric(6,3) not null default 0
                        check (discount_pct >= 0 and discount_pct <= 100),
  tax_treatment         text not null default 'vat_21'
                        check (tax_treatment in ('vat_21','vat_105','vat_0','exempt','not_taxed','other')),
  tax_rate_snapshot     numeric(6,3),
  line_total            numeric(18,4) not null default 0,
  unique (purchase_order_id, line_no)
);
```

- **`tax_treatment` por línea**, exactamente el mismo CHECK que
  `sales_quote_lines`. Nada de `iva boolean`, nada de 21 % fijo.
- Los totales **los calcula el servidor**, con el mismo patrón que Ventas
  (`app.totales_*` + trigger BEFORE UPDATE en la cabecera + trigger AFTER en
  las líneas). Es lo que hace estructuralmente imposible el bug del 1 %.
- `expected_date` en cabecera y **no por línea**: una ETA por documento
  alcanza, y por línea sería un sistema que hoy nadie pidió.

### `goods_receipts` + `goods_receipt_lines`

```sql
create table goods_receipts (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id),
  supplier_id           uuid not null references suppliers(id),
  purchase_order_id     uuid references purchase_orders(id),   -- nullable: recepción suelta
  warehouse_id          uuid not null references warehouses(id),
  number                text not null,
  series_code           text not null default 'NEP',
  status                text not null default 'draft'
                        check (status in ('draft','confirmed')),
  receipt_date          date not null,
  supplier_document     text,                 -- el remito del proveedor
  notes                 text,
  confirmed_at          timestamptz,
  confirmed_by          uuid references profiles(id),
  created_by            uuid references profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (company_id, number)
);

create table goods_receipt_lines (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references companies(id),
  goods_receipt_id        uuid not null references goods_receipts(id) on delete cascade,
  purchase_order_line_id  uuid references purchase_order_lines(id),  -- LA relación
  product_id              uuid not null references products(id),
  sku_snapshot            text,
  name_snapshot           text,
  quantity                numeric(18,4) not null check (quantity > 0),
  unique (goods_receipt_id, purchase_order_line_id)
);
```

- **`purchase_order_line_id` es la relación.** Nunca un índice de array. El
  caso 100 → 30 → 40 → pendiente 30 se resuelve sumando
  `goods_receipt_lines.quantity` por `purchase_order_line_id` de las
  recepciones **confirmadas**.
- `product_id` es NOT NULL acá aunque en la línea del pedido sea nullable: lo
  que entra al depósito tiene que ser un producto del catálogo, o el
  movimiento de stock no tiene a qué apuntar. Una línea libre del pedido
  —«flete», «servicio»— **no se recibe**.
- `warehouse_id` en la cabecera: una recepción entra a **un** depósito.

### `supplier_invoices` + `supplier_invoice_lines`

```sql
create table supplier_invoices (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id),
  supplier_id           uuid not null references suppliers(id),
  number                text not null,             -- nuestro número interno
  series_code           text not null default 'FP',
  supplier_number       text,                      -- el número que trae la factura
  status                text not null default 'draft'
                        check (status in ('draft','registered','cancelled')),
  currency_code         text not null references currencies(code),
  exchange_rate         numeric(18,6),
  invoice_date          date not null,
  due_date              date,
  payment_terms         text,
  notes                 text,
  subtotal              numeric(18,4) not null default 0,
  tax_amount            numeric(18,4) not null default 0,
  total                 numeric(18,4) not null default 0,
  created_by            uuid references profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (company_id, number)
);

create table supplier_invoice_lines (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null references companies(id),
  supplier_invoice_id      uuid not null references supplier_invoices(id) on delete cascade,
  goods_receipt_line_id    uuid references goods_receipt_lines(id),   -- N:N por línea
  purchase_order_line_id   uuid references purchase_order_lines(id),
  line_no                  int not null check (line_no > 0),
  line_type                text not null default 'product'
                           check (line_type in ('product','chapter','free')),
  product_id               uuid references products(id),
  sku_snapshot             text,
  description_snapshot     text,
  quantity                 numeric(18,4) not null check (quantity > 0),
  unit_price               numeric(18,4) not null,
  discount_pct             numeric(6,3) not null default 0,
  tax_treatment            text not null default 'vat_21'
                           check (tax_treatment in ('vat_21','vat_105','vat_0','exempt','not_taxed','other')),
  tax_rate_snapshot        numeric(6,3),
  line_total               numeric(18,4) not null default 0,
  unique (supplier_invoice_id, line_no)
);
```

**La relación factura ↔ recepción vive en las líneas, no en la cabecera.** Eso
resuelve los tres casos sin una tabla puente:

| caso | cómo queda |
|---|---|
| factura parcial de una recepción | sólo algunas líneas de la recepción tienen línea de factura |
| una factura de varias recepciones | sus líneas apuntan a líneas de recepciones distintas |
| varias facturas de una misma OC | cada factura apunta a otras líneas |
| gastos que no vienen de una recepción (flete, despacho) | línea con `goods_receipt_line_id` en `null` |

**No propongo `supplier_invoices.purchase_order_id` en la cabecera.** Sería
cómodo y sería mentira en cuanto una factura cubra dos pedidos. La OC se deriva
de las líneas, que es exacto. Si querés el atajo igual, es una columna
denormalizada y hay que decir que puede quedar incompleta — decilo y la agrego.

---

## B · ERD

```
companies
    │
    ├──< suppliers ──────────────────────────┐
    │        │                               │
    │        └──< purchase_orders            │
    │                 │                      │
    │                 └──< purchase_order_lines
    │                              │  ▲
    │                              │  │ purchase_order_line_id
    │                              │  │
    │        ┌──< goods_receipts ──┘  │
    │        │        │  │            │
    │        │        │  └──< goods_receipt_lines
    │        │        │                  ▲
    │        │        └── warehouse_id   │ goods_receipt_line_id
    │        │              │            │
    │        │           warehouses      │
    │        │                           │
    │        └──< supplier_invoices      │
    │                    │               │
    │                    └──< supplier_invoice_lines
    │
    └──< stock_movements  ← purchase_receipt · source_type='goods_receipt'

products ──< purchase_order_lines / goods_receipt_lines / supplier_invoice_lines
attachments  → entity_type: purchase_order | goods_receipt | supplier_invoice
purchases_audit → entity_type: purchase_order | goods_receipt | supplier_invoice
```

---

## C · Estados

**Dos columnas en el pedido, como en Ventas.** Una la escriben las personas, la
otra la deriva la base.

```
purchase_orders.status        draft ──► confirmed ──► (fin)
   (lo escribe la gente)        │           │
                                └──► cancelled ◄┘

purchase_orders.receipt_status   pending ──► partially_received ──► received
   (lo DERIVA un trigger, la aplicación no lo escribe nunca)
```

Reglas:

- de `draft` a `confirmed`: hace falta al menos una línea con cantidad y precio
- **`cancelled` sólo si no hay ninguna recepción confirmada**
- con una recepción confirmada, las líneas del pedido **no se editan más**
  —es la regla del legacy y es buena—
- `receipt_status` sale de comparar, por línea, lo pedido contra la suma de lo
  recibido **en recepciones confirmadas**. Un borrador de recepción no mueve
  nada

```
goods_receipts.status   draft ──► confirmed
```

- `confirmed` es lo que mueve stock, una sola vez
- **no propongo cancelar una recepción confirmada en la v1**: habría que
  revertir stock y eso es una decisión aparte. Va al backlog

```
supplier_invoices.status   draft ──► registered ──► (cancelled)
```

Sin estado de pago: los pagos están fuera de alcance y no quiero un booleano
que después nadie sepa quién puso.

---

## D · Numeración

`document_sequences` tal cual está, cuatro tipos nuevos:

| doc_type | serie | prefijo | padding | próximo |
|---|---|---|---|---|
| `supplier` | `PROV` | PROV | 5 | **146** |
| `purchase_order` | `PC` | PC | 5 | **2** |
| `goods_receipt` | `NEP` | NEP | 5 | 1 |
| `supplier_invoice` | `FP` | FP | 5 | 1 |

- El máximo real de proveedores es `PROV00145` con **3 huecos**, que **no se
  rellenan**. El próximo es 146.
- `PC00001` existe en el legacy pero **no se migra** (ver J). Aun así la serie
  arranca en 2 para no reutilizar un número que alguien podría tener anotado.
- Los prefijos son los que el equipo ya lee. Son datos en
  `document_sequences`, así que cambiarlos después es un UPDATE.
- **`next_document_number` necesita un retoque**: hoy su guarda exige
  `app.current_writer_company_ids()` salvo para `doc_type = 'customer'`, que
  ampliamos en Clientes. Hay que sumar los cuatro tipos de compras al mismo
  criterio: **exactamente los roles que pueden crear ese documento**.

---

## E · Matriz de RLS

| tabla | admin | employee | salesperson | technician | customer | distributor | anon |
|---|---|---|---|---|---|---|---|
| `suppliers` | RW | RW | — | — | — | — | — |
| `purchase_orders` (+líneas) | RW | RW | — | — | — | — | — |
| `goods_receipts` (+líneas) | RW | RW | — | — | — | — | — |
| `supplier_invoices` (+líneas) | RW | RW | — | — | — | — | — |
| `stock_movements` | ya definido en Stage 1, sin cambios |

Es decir: **`app.current_writer_company_ids()`** —admin y employee— para leer y
escribir, y **cero para todos los demás**.

Por qué tan cerrado: un pedido de compra lleva **precio de costo**. Un
`salesperson` que lo lea puede deducir el margen de cada producto. El legacy no
prueba que lo necesite —el módulo casi no se usó— y vos dijiste que no
ampliemos sin evidencia funcional. **Si aparece la necesidad, se abre lectura y
se prueba; es una línea de policy.**

`technician` queda afuera por lo mismo, aunque sea rol interno.

---

## F · Integración con stock

Sin sistema nuevo. Al confirmar una recepción, **una fila por línea** en
`stock_movements`:

```
movement_type = 'purchase_receipt'      (ya existe en el CHECK)
quantity      = + cantidad recibida
warehouse_id  = el de la recepción
source_type   = 'goods_receipt'
source_id     = id de la recepción
```

`stock_balances` se actualiza por el mismo camino que ya usa Ventas.

Y una defensa de fondo, además de la transacción:

```sql
create unique index uq_stock_mov_recepcion
  on stock_movements (source_type, source_id, product_id, warehouse_id)
  where source_type = 'goods_receipt';
```

Con eso, **duplicar el movimiento es imposible a nivel de base**, no sólo
improbable a nivel de aplicación.

**El borrador de recepción no toca stock.** Nada.

---

## G · Confirmación transaccional

Una función, con la misma forma que `confirmar_entrega` de Ventas, que ya está
probada:

```sql
public.confirmar_recepcion(p_receipt uuid) returns jsonb
```

`SECURITY DEFINER`. Todo o nada, en este orden:

1. `select … from goods_receipts where id = p_receipt for update` — bloquea la
   fila; dos pestañas se serializan
2. **si ya está `confirmed`, devuelve el mismo resultado y no toca nada** — ésa
   es la idempotencia
3. valida rol y empresa
4. por cada línea: `recibido_antes + esta_cantidad <= cantidad_pedida`.
   **Si se pasa, `raise exception` y no se hace nada.** No se recorta en
   silencio
5. inserta los movimientos de stock
6. pone la recepción en `confirmed`, con `confirmed_at` y `confirmed_by`
7. deriva `receipt_status` del pedido
8. registra el evento en la auditoría

Devuelve `{ receipt_id, movimientos, receipt_status_pedido, ya_estaba }`.

### Sobre-recepción

Bloqueada, como pediste: pedido 100, recibido 70, intentar 31 → **rechazo**,
con el número pendiente en el mensaje. Sin recorte silencioso y sin stock
inexplicado.

---

## H · Auditoría y adjuntos

**Adjuntos: se reutiliza `attachments`.** Sólo hay que sumar dos valores al
CHECK de `entity_type` (`goods_receipt`, `supplier_invoice`); `purchase_order`
ya está. El bucket privado, las signed URLs y las policies de Storage ya
funcionan.

**Auditoría: propongo una tabla nueva, `purchases_audit`**, con la misma forma
que `sales_audit` (`entity_type, entity_id, action, from_status, to_status,
diff, actor_id`) y su `registrar_evento_compra`.

Justificación, porque pediste una: `sales_audit` **no tiene CHECK** en
`entity_type`, así que técnicamente aceptaría eventos de compras sin tocar
nada. Pero:

- la tabla se llama `sales_audit` y su documentación dice qué guarda
- **las suites de Ventas afirman conteos sobre `sales_audit`** —«la auditoría
  no se dispara sola con un UPDATE» compara contra un número—. Meterle eventos
  de compras haría que esas afirmaciones dejaran de significar lo que dicen
- Ventas está **cerrado**

Una tabla de siete columnas es más barata que ensuciar un módulo cerrado.

---

## I · Estrategia de proveedores

Los 142, desde el `<script id="proveedores-data">` del HTML legacy —**no desde
`localStorage`, donde la clave no existe**—.

| legacy | destino |
|---|---|
| `ref` | `legacy_ref` |
| `nj` | `legal_name` |
| `nc` | `trade_name` |
| `cif` | `tax_id` — **los 142 lo tienen vacío**, queda `null` |
| `tel` | `phone`, tal cual, con sus formatos mezclados |
| `email` | `email` — **los 142 lo tienen vacío**, queda `null` |
| `direccion` | `address_text`, **texto tal cual** |
| `actividad` | `activity` — vacío en los 142 |
| `agente` | `agent` — siempre «BUSCATOOLS» |
| `formaPago` | `payment_terms`, texto libre, 13 valores distintos |
| `notas` | `notes`, **completa y sin tocar** |

Más `legacy_source = 'maestro_proveedores'` e `imported_at`.

- **Los 22 emails dentro de `notas` no se extraen.** La nota va entera.
- **`needs_review` esperado: 0.** No hay referencias repetidas, ni razones
  sociales repetidas ni CUIT en conflicto. Marcar los 142 «porque no tienen
  CUIT» sería ruido, no revisión.
- Script idempotente y con reconciliación explícita, igual que en Clientes.

---

## J · El PC00001 del legacy

**No se migra.** Es:

```json
{"proveedor":"","titulo":"Pedido a proveedor","fecha":"2026-08-13",
 "items":[{"sku":"TE.X-LIGHT.3","qty":1,"price":0,"dto":0}],
 "estado":"pendiente","creadoPor":"ADMIN"}
```

Sin proveedor, con una línea a precio 0, nunca recibido, nunca facturado.
Clasificado **`TEST` / `NON_PRODUCTION`**. Queda en el backup del
2026-09-10 (`sha256 81a02598…`) y en esta documentación, y el sistema nuevo
arranca sin él.

---

## K · Tests previstos

**Unitarios (lógica pura)**: pendiente por línea; validación del formulario;
formato de referencia; normalización de CUIT para el índice único.

**Contra datos reales, con sesión** (una suite por entrega):

- **proveedores**: 142 migrados, reconciliación campo por campo, idempotencia,
  0 duplicados de `legacy_ref`, alta con referencia del servidor
- **numeración**: 12 altas simultáneas de cada tipo, sin huecos ni repetidos
- **pedido**: alta, edición, confirmación, cancelación bloqueada con recepción
  confirmada
- **recepción parcial**: 100 → 30 → 40 → pendiente 30, **por
  `purchase_order_line_id`**, nunca por posición
- **sobre-recepción**: intentar 31 sobre 30 pendientes → **rechazo**, y el
  stock no se movió
- **idempotencia**: confirmar dos veces en paralelo → **un solo** movimiento de
  stock; y con el índice único, el segundo intento ni siquiera puede insertar
- **estados derivados**: `receipt_status` cambia solo, y la aplicación no puede
  escribirlo
- **totales**: los calcula el servidor; el bug del 1 % **no se puede
  reproducir** ni mandando `iva: true`
- **moneda**: un documento con dos monedas no existe; sin moneda no se puede
  crear
- **factura**: parcial, una de varias recepciones, varias de una OC, y una
  línea de flete sin recepción
- **RLS**: los siete roles, cada prohibición con un intento real. Un
  `salesperson` **no ve un solo pedido de compra**
- **regresión**: las siete suites de Ventas y las cinco de Clientes,
  288 / 166 / 182 / 636 y la huella `8091b9166350c5bf2c331b1d882ec654`

---

## L · Riesgos

| # | riesgo | mitigación |
|---|---|---|
| 1 | **Es funcionalidad nueva, no migración.** Nadie ejerció el circuito, así que no hay datos que confirmen que el diseño sirve | entregar de a poco y mirar cada entrega con quien vaya a comprar. La entrega 2 (proveedores) es la única con red |
| 2 | Tocar `stock_movements` puede mover el stock actual | las 381 filas existentes no se tocan; sólo se agregan movimientos nuevos, y el índice único impide duplicarlos |
| 3 | `next_document_number` es **compartida con Ventas** | su guarda se amplía para los tipos de compras; la suite de numeración concurrente de Ventas se corre después de tocarla, como se hizo en Clientes |
| 4 | Precio de costo expuesto | RLS cerrada a admin y employee desde el primer día, probada con intentos reales |
| 5 | Recepción de un producto que no está en el catálogo | `goods_receipt_lines.product_id` es NOT NULL: hay que dar de alta el producto antes. Es una fricción a propósito |
| 6 | Cancelar una recepción confirmada | no se puede en la v1; queda en backlog con la decisión de cómo revertir stock |
| 7 | Cambiar la moneda de un pedido con líneas cargadas | se bloquea, como en Ventas: un documento = una moneda, y se elige al crearlo |
| 8 | La factura sin cabecera a la OC obliga a derivarla | es una consulta por las líneas; si molesta en la UI, se agrega una vista, no una columna que pueda mentir |

---

## Lo que necesito que apruebes

1. **`currency_code` en vez de `currency_id`**, por consistencia con todo el
   proyecto.
2. **RLS cerrada a admin + employee**, con `salesperson` y `technician` sin
   acceso a Compras.
3. **`purchases_audit` nueva** en vez de reusar `sales_audit`.
4. **Sin cabecera `purchase_order_id` en la factura**: la relación vive en las
   líneas.
5. **Sin `supplier_contacts`** por ahora.
6. **Prefijos `PROV` / `PC` / `NEP` / `FP`**, y la serie de pedidos arrancando
   en `PC00002`.
7. **Sin cancelación de recepciones confirmadas** en la primera versión.
