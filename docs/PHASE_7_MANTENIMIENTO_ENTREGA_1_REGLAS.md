# Fase 7 · Mantenimiento — Entrega 1: reglas exactas antes del SQL

**Nada aplicado.** No se ejecutó DDL, ni migraciones, ni se tocó un dato. El SQL
está preparado y va al final, marcado como no aplicado.

Esto responde A–E en el orden que hace falta para entenderlo: primero qué tablas
quedan, después cómo se relacionan, después los estados, después el cierre, y por
último el momento exacto del stock.

---

## E · Qué tablas quedan — **8, ninguna redundante**

| # | tabla | por qué no se puede fusionar |
|---|---|---|
| 1 | `maintenance_assets` | el equipo, con identidad propia e historial |
| 2 | `maintenance_orders` | la ficha |
| 3 | `maintenance_quote_lines` | N líneas por orden |
| 4 | `maintenance_order_parts` | ver abajo — la fusión que consideré y descarté |
| 5 | `maintenance_measurements` | N mediciones por orden |
| 6 | `maintenance_order_checks` | 8 partes × 2 fases por orden |
| 7 | `maintenance_check_points` | aprobada como configurable (tu punto 4) |
| 8 | `maintenance_audit` | el rastro; mismo patrón que `purchases_audit` y `sales_audit` |

### La única fusión que evalué en serio: 3 + 4

Podrían ser una sola tabla: una línea de cotización con `line_type='part'` y un
campo «consumido». **La descarté**, y no por gusto:

| | `maintenance_quote_lines` | `maintenance_order_parts` |
|---|---|---|
| `product_id` | **opcional** — se cotiza algo que no está en catálogo | **obligatorio** — sin producto no hay movimiento de stock |
| importe | `unit_price`: lo que se **cobra** | `unit_cost_snapshot`: lo que **costó** |
| depósito | no aplica | `warehouse_id`, obligatorio |
| existe sin la otra | sí: cotización rechazada, nunca se consume | sí: apareció en la reparación, nunca se cotizó |
| se congela | al aprobar | al consumir (`stock_movement_id`) |

Fusionarlas daría una tabla donde la mitad de las columnas son nulas según para
qué sirve la fila — que es exactamente la forma amorfa del legacy que estamos
sacando. **Quedan separadas.**

Las otras dos que revisé: `maintenance_measurements` no puede ser `jsonb` (lo
prohibiste explícitamente y además rompe las consultas), y `maintenance_audit`
no puede colgarse de `purchases_audit` porque cada una tiene su `entity_type` y
su policy.

> **8 tablas nuevas. Tres cambios mínimos sobre lo existente** (attachments,
> movement_type, document_sequences). Nada más.

---

## D · `asset` ↔ `customer` ↔ `delivery_serial`

```
customers ─────────────┬──────────────────────────┐
                       │ owner_customer_id        │ customer_id
                       │ NOT NULL                 │ NOT NULL
                       │ (dueño ACTUAL, mutable)  │ (congelado al recibir)
                       ▼                          ▼
              maintenance_assets ──────< maintenance_orders
                       │
                       │ delivery_serial_id  NULL
                       ▼
               delivery_serials  (0 filas hoy)
                       │
                       └─► delivery_line → delivery → sales_order → customer
```

### D.1 Por qué el cliente aparece dos veces — y no es duplicación

Pediste no duplicar `customer_id` sin necesidad. La necesidad es ésta y es la
misma regla que ya rige el resto del proyecto: **un documento cerrado no se
reescribe**.

| | `maintenance_assets.owner_customer_id` | `maintenance_orders.customer_id` |
|---|---|---|
| significa | de quién **es hoy** la herramienta | de quién **era** cuando entró al taller |
| cambia | sí, si el equipo cambia de dueño | **nunca**, ni aunque el equipo se venda |
| se usa para | la pantalla «Activos en clientes», filtrar equipos | facturar, entregar, el historial |

Si el cliente viviera **sólo** en el equipo, vender la herramienta reescribiría
las tres órdenes viejas y dirían que el trabajo se le hizo a alguien que en ese
momento no la tenía. Es el mismo motivo por el que un pedido guarda snapshots
del precio en vez de mirar el catálogo de hoy.

Al crear una orden, `customer_id` **se precarga** desde el equipo. Cambiar el
dueño del equipo después no toca ninguna orden.

Los dos son **NOT NULL** (tus puntos 2 y 11). Un equipo sin dueño no lo vi en
ninguna evidencia, y una orden sin cliente no se puede facturar ni entregar.

### D.2 `delivery_serial_id`: evidencia, no requisito

- **Columna, no tabla de vínculo**: la herramienta física salió de *una* entrega
  o de ninguna. Una tabla intermedia modelaría N:N, que no existe.
- **NULL permitido y hoy siempre nulo**: `delivery_serials` tiene **0 filas**.
- Cuando esté, un CHECK exige que sea de la misma empresa. **No se exige** que
  el `customer_id` de la entrega coincida con el dueño actual: justamente porque
  la herramienta puede haber cambiado de manos.
- Nunca es obligatoria: un equipo puede ser de otra marca, comprado a otro, o
  anterior al sistema.

### D.3 Producto

`product_id` opcional. Si no resuelve —recordá que `ASM18-3-PC` es **ambiguo**
entre `FE.ASM18-3` y `FE.MAQ.71127760000`—, quedan `brand_text` y `model_text`
como snapshots. Nunca se fuerza un SKU.

---

## B · Máquina de estados mínima

**Tres ejes independientes.** Ninguno mezcla etapas con ciclo de vida.

### B.1 `status` — el ciclo de vida del documento

```
        ┌──────────► closed      (terminal)
open ───┤
        └──────────► cancelled   (terminal)
```

- `open` es el único estado que permite escribir.
- `closed` exige las 12 validaciones de **A**.
- `cancelled` es la salida sin validaciones: se recibió y no se hizo nada.
- De `closed` y `cancelled` **no se vuelve**. Deshacer es una orden nueva.

### B.2 `stage` — dónde está el trabajo

```
diagnosis ──► quotation ──► repair ──► torque ──► closing
    ▲             ▲            ▲          ▲
    └─────────────┴────────────┴──────────┘
              volver atrás, a cualquier anterior
```

- **Adelante: de a un paso**, y salteando las etapas marcadas como no requeridas.
  Con `repair_required = false`, de `quotation` se pasa a `torque`.
- **Atrás: a cualquier etapa anterior.** Es lo que el legacy permite y tiene
  sentido —aparece algo en la reparación y hay que recotizar— pero acá **cada
  transición deja una fila en `maintenance_audit`**, que es lo que falta hoy.
- Sólo se mueve con `status = 'open'`.

### B.3 `quote_status` — el presupuesto

```
pending ──► approved
   └──────► rejected
```

Mientras la orden está abierta se puede corregir en cualquier dirección (el
cliente aprueba y después se arrepiente). Tenerlo **aparte** de `stage` es lo
que permite la validación de cierre que el legacy no tiene.

### B.4 Los tres flags, que no son estados

| flag | default | qué hace |
|---|---|---|
| `on_hold` + `on_hold_since` | false | pausa; **no cambia `stage`**. Es el `pausada` del legacy, que funciona |
| `repair_required` | **true** | en false, `repair` se saltea y no se exige al cerrar |
| `torque_required` | **true** | ídem con `torque` |

Los dos «required» arrancan en **true** a propósito: el taller es de
herramientas de torque y el legacy muestra siempre las 5 etapas. Marcar «no
requerida» es un acto explícito, no un olvido.

---

## A · Regla exacta de cierre

Cerrar es `status: open → closed`. **Sólo desde `cerrar_orden_mantenimiento()`**,
nunca por un `UPDATE` suelto — la puerta que cerramos en la entrega 5 de Compras.

Las 12 condiciones, en orden de evaluación:

| # | condición | por qué está | evidencia |
|---|---|---|---|
| 1 | `status = 'open'` | no se cierra dos veces | — |
| 2 | permiso admin/employee de esa empresa | permiso antes que nada | entrega 4 de Compras |
| 3 | `stage = 'closing'` | no se cierra salteando el circuito | — |
| 4 | `diagnosed_at is not null` | **diagnóstico completado** (tu punto 12) | el diagnóstico es la entrada; sin él no se sabe qué se hizo |
| 5 | `quote_status <> 'pending'` | **cotización resuelta** | **2 de las 3 fichas reales se cerraron con la cotización PENDIENTE** |
| 6 | si `quote_status = 'approved'` → al menos una línea de cotización | un presupuesto aprobado y vacío no es un presupuesto | — |
| 7 | `repair_required = false` **o** `repaired_at is not null` | **reparación completada o marcada no requerida** | tu punto 12 |
| 8 | `torque_required = false` **o** `torque_at is not null` | **torque completado o marcado no requerido** | tu punto 12 |
| 9 | si `torque_required` → al menos una medición cargada | un paso de torque «hecho» sin una sola medición no midió nada | en los datos reales hay 30 filas de torque y las 30 están vacías |
| 10 | `delivered_at is not null` | **cierre con fecha**; cerrar es entregar | 3/3 la tienen |
| 11 | `received_at <= delivered_at` | fechas coherentes | — |
| 12 | ninguna `maintenance_order_parts` sin `consumed_at` | no queda un repuesto «a consumir» colgado de una orden cerrada | ver **C** |

### Lo que deliberadamente NO se exige

| no se pide | por qué |
|---|---|
| las 8 partes marcadas en el diagnóstico | en los datos reales están a medias (una ficha tiene 3 de 8) y **una revisión que salió bien puede no tener nada que anotar** |
| las 8 partes marcadas en la reparación | ídem; una ficha real tiene `reparacionPartes: {}` vacío |
| `repair_notes` escrito | obligar a escribir produce «ok» y nada más |
| `labour_hours` cargado | en los datos reales: `"2"`, `""`, `""` |
| `closing_notes`, `next_preventive_date` | opcionales por naturaleza |
| que una cotización rechazada impida reparar | puede hacerse un arreglo mínimo sin cargo; no hay evidencia de la regla contraria |

**Cancelar** (`open → cancelled`) **no valida nada**: es la salida para una
herramienta que entró y se devuelve sin trabajo. Exigirle requisitos sería
burocracia pura.

---

## C · Momento exacto del consumo de stock

### C.1 La línea

```
agregar repuesto a la orden        →  NO toca stock
cotizarlo                          →  NO toca stock
editar el borrador                 →  NO toca stock
─────────────────────────────────────────────────────
confirmar_consumo_mantenimiento()  →  SÍ: un stock_movement por línea
─────────────────────────────────────────────────────
cerrar la orden                    →  NO toca stock (ya se consumió)
```

**El disparador es una acción explícita, no el cierre.** Los dos momentos son
distintos: el repuesto se pone en la herramienta el día de la reparación, y la
orden puede cerrarse una semana después cuando el cliente la retira. Atarlos
obligaría a cerrar para descontar, o a descontar cosas que todavía no se usaron.

Y por eso la validación 12 de **A**: al cerrar, no puede quedar una línea sin
consumir. O se consumió, o se saca de la orden.

### C.2 Qué hace exactamente `confirmar_consumo_mantenimiento(p_order)`

```
 1. lee la orden FOR UPDATE; si no existe → no_data_found
 2. PERMISO PRIMERO (admin/employee de esa empresa) — antes del atajo de
    idempotencia, para no filtrarle información a un externo
 3. si status <> 'open' → rechaza
 4. si no hay ninguna parte → rechaza
 5. si TODAS ya tienen consumed_at → devuelve { ya_estaba: true }   ← idempotente
 6. bloquea las filas pendientes FOR UPDATE, ordenadas por id
 7. por cada parte sin consumed_at:
        insert stock_movements (
          movement_type = 'service_consumption',
          quantity      = -cantidad,               ← negativo
          source_type   = 'maintenance_order',
          source_id     = orden,
          warehouse_id  = el de la línea )
        set consumed_at = now(), stock_movement_id = <el insertado>
 8. registra UN evento en maintenance_audit (no uno por línea)
 9. devuelve { ya_estaba: false, lineas: n, movimientos: n }
```

`quantity` negativo: el trigger `app.apply_stock_movement()` que ya existe suma
el valor con signo al saldo, así que **no hace falta tocar nada del stock**.

### C.3 La puerta

`consumed_at` y `stock_movement_id` **sólo se pueden escribir desde adentro de
esa función**, con la misma marca de transacción que la entrega 5:

```sql
if coalesce(current_setting('app.consumiendo_mantenimiento', true), '') <> ...
  raise exception 'El consumo se registra con confirmar_consumo_mantenimiento()'
```

Sin esto, un `UPDATE` por PostgREST marcaría el repuesto como consumido **sin
generar el movimiento** — exactamente el agujero que encontramos en recepciones,
donde la mercadería quedaba recibida y el stock sin entrar.

Una línea con `stock_movement_id` **no se edita ni se borra**: ahí está el rastro.

### C.4 Saldo negativo: se permite, y es medido

`stock_balances` **no tiene restricción de no-negatividad** sobre `on_hand`
—sólo `reserved >= 0`—, y el trigger de saldo suma con signo. O sea que el
schema actual ya lo admite.

**Se deja así, a propósito:** la reparación ya ocurrió físicamente. Negarse a
registrar el consumo porque el saldo no da haría que el sistema mienta sobre una
herramienta que ya tiene el repuesto puesto. El faltante se ve en el saldo, que
es donde tiene que verse.

### C.5 Devolución

**No se implementa en v1** y **no se borra ningún movimiento** (tu punto 9). Si
un repuesto vuelve, es un contramovimiento explícito con su propia fila.
`return_in` ya existe en el CHECK para cuando haga falta.

---

## Anexo · SQL preparado — **NO APLICADO**

> Nada de esto se ejecutó. Está acá para que lo revises antes de que lo aplique.

### 1 · Cambios sobre lo existente (tres, mínimos)

```sql
-- 1.1 attachments: dos tipos de entidad nuevos
alter table attachments drop constraint attachments_entity_type_check;
alter table attachments add constraint attachments_entity_type_check
  check (entity_type = any (array[
    'quote','purchase_order','order','delivery','invoice','payment','customer',
    'goods_receipt','supplier_invoice','supplier',
    'maintenance_asset','maintenance_order']));

-- y las dos ramas nuevas en la policy, que YA está partida por entity_type
create or replace policy attachments_select on attachments for select using (
  case
    when entity_type = any (array['supplier','purchase_order','goods_receipt',
                                  'supplier_invoice',
                                  'maintenance_asset','maintenance_order'])
      then company_id in (select unnest(app.current_writer_company_ids()))
    else company_id in (select unnest(app.current_internal_company_ids()))
  end);

-- 1.2 stock_movements: UN valor nuevo
alter table stock_movements drop constraint stock_movements_movement_type_check;
alter table stock_movements add constraint stock_movements_movement_type_check
  check (movement_type = any (array[
    'opening_balance','purchase_receipt','sale_delivery','adjustment',
    'transfer_in','transfer_out','return_in','return_out',
    'service_consumption']));

-- 1.3 document_sequences: dos filas por empresa. Sin DDL.
insert into document_sequences (company_id, doc_type, series_code, next_number)
select id, t.doc_type, t.series, 1
  from companies, (values ('maintenance_asset','EQ'),
                          ('maintenance_order','OS')) as t(doc_type, series)
on conflict do nothing;
```

### 2 · Helpers de RLS

```sql
-- Lectura y escritura de Mantenimiento. Hoy los dos devuelven lo mismo:
-- admin + employee. `technician` NO entra en v1 (tu punto 8); cuando exista
-- alguien con ese rol y un flujo real, el de lectura suma una línea.
create or replace function app.current_maintenance_company_ids()
returns uuid[] language sql stable security definer
set search_path to 'public','pg_temp' as $$
  select coalesce(array_agg(company_id), '{}') from company_memberships
   where user_id = auth.uid() and status = 'active'
     and role in ('admin','employee');
$$;

create or replace function app.current_maintenance_writer_ids()
returns uuid[] language sql stable security definer
set search_path to 'public','pg_temp' as $$
  select coalesce(array_agg(company_id), '{}') from company_memberships
   where user_id = auth.uid() and status = 'active'
     and role in ('admin','employee');
$$;
```

### 3 · Las 8 tablas

```sql
-- ── 3.1 Puntos de revisión (configurables, tu punto 4) ──────────────────────
create table maintenance_check_points (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id),
  key         text not null,
  label       text not null,
  sort_order  int  not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (company_id, key)
);

-- ── 3.2 Equipos ─────────────────────────────────────────────────────────────
create table maintenance_assets (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id),
  reference          text not null,                    -- EQ00001
  owner_customer_id  uuid not null references customers(id),
  product_id         uuid     references products(id),
  delivery_serial_id uuid     references delivery_serials(id),
  serial_number      text,
  serial_normalized  text generated always as (
                       nullif(upper(regexp_replace(
                         coalesce(serial_number,''), '[^A-Za-z0-9]', '', 'g')), '')
                     ) stored,
  brand_id           uuid references brands(id),
  brand_text         text,
  model_text         text,
  asset_type         text,
  identifier         text,
  city               text,
  state              text,
  warranty_start     date,
  warranty_end       date,
  under_contract     boolean not null default false,
  notes              text,
  deleted_at         timestamptz,
  deleted_by         uuid references profiles(id),
  created_by         uuid references profiles(id),
  created_at         timestamptz not null default now(),
  updated_by         uuid references profiles(id),
  updated_at         timestamptz not null default now(),
  unique (company_id, reference),
  constraint chk_ma_garantia check (warranty_end is null or warranty_start is null
                                    or warranty_end >= warranty_start)
);
-- NO único: el serial se detecta duplicado, no se bloquea (tu punto 16)
create index idx_ma_serial   on maintenance_assets (company_id, serial_normalized)
  where serial_normalized is not null;
create index idx_ma_customer on maintenance_assets (company_id, owner_customer_id);
create index idx_ma_product  on maintenance_assets (product_id) where product_id is not null;

-- ── 3.3 Órdenes ─────────────────────────────────────────────────────────────
create table maintenance_orders (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id),
  number        text not null,                          -- OS00001
  series_code   text not null default 'OS',
  asset_id      uuid not null references maintenance_assets(id),
  customer_id   uuid not null references customers(id),  -- congelado (D.1)

  status        text not null default 'open'
                check (status in ('open','closed','cancelled')),
  stage         text not null default 'diagnosis'
                check (stage in ('diagnosis','quotation','repair','torque','closing')),
  on_hold       boolean not null default false,
  on_hold_since timestamptz,

  service_type    text not null default 'corrective'
                  check (service_type in ('corrective','preventive','general_review')),
  entry_reason    text,
  visual_condition text,
  technician_id   uuid references profiles(id),
  received_by     uuid references profiles(id),
  received_at     date not null default current_date,

  diagnosis_notes text,
  diagnosed_at    date,
  diagnosed_by    uuid references profiles(id),

  quote_status    text not null default 'pending'
                  check (quote_status in ('pending','approved','rejected')),
  quote_currency  text references currencies(code),
  quote_contact   text,
  quote_notes     text,
  quote_approved_at      date,
  quote_approved_by_name text,          -- del lado del CLIENTE: no es un profile
  quote_subtotal  numeric(18,4) not null default 0,
  quote_total     numeric(18,4) not null default 0,

  repair_required boolean not null default true,
  repair_notes    text,
  pending_parts   text,
  repaired_at     date,
  repaired_by     uuid references profiles(id),
  labour_hours    numeric(10,2),

  torque_required boolean not null default true,
  torque_lsl      numeric(12,4),
  torque_nominal  numeric(12,4),
  torque_usl      numeric(12,4),
  torque_at       date,
  torque_by       uuid references profiles(id),

  next_preventive_date date,
  delivered_at    date,
  closing_notes   text,
  closed_at       timestamptz,
  closed_by       uuid references profiles(id),

  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),

  unique (company_id, number),
  constraint chk_mo_fechas check (delivered_at is null or delivered_at >= received_at),
  constraint chk_mo_torque check (torque_lsl is null or torque_usl is null
                                  or torque_usl >= torque_lsl)
);
create index idx_mo_fecha    on maintenance_orders (company_id, received_at desc, number desc);
create index idx_mo_asset    on maintenance_orders (asset_id);
create index idx_mo_customer on maintenance_orders (company_id, customer_id);
create index idx_mo_abiertas on maintenance_orders (company_id, stage)
  where status = 'open';

-- ── 3.4 Líneas de cotización ────────────────────────────────────────────────
create table maintenance_quote_lines (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references companies(id),
  maintenance_order_id uuid not null references maintenance_orders(id) on delete cascade,
  line_no              int  not null check (line_no > 0),
  line_type            text not null default 'labour'
                       check (line_type in ('labour','part','freight','diagnosis','other')),
  product_id           uuid references products(id),
  sku_snapshot         text,
  description_snapshot text,
  quantity             numeric(14,4) not null check (quantity > 0),
  unit_price           numeric(18,4) not null default 0 check (unit_price >= 0),
  line_total           numeric(18,4) not null default 0,   -- lo calcula el servidor
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (maintenance_order_id, line_no)
);
create index idx_mql_order on maintenance_quote_lines (maintenance_order_id);

-- ── 3.5 Repuestos consumidos ────────────────────────────────────────────────
create table maintenance_order_parts (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references companies(id),
  maintenance_order_id uuid not null references maintenance_orders(id) on delete cascade,
  product_id           uuid not null references products(id),
  warehouse_id         uuid not null references warehouses(id),
  quantity             numeric(14,4) not null check (quantity > 0),
  sku_snapshot         text,
  name_snapshot        text,
  unit_cost_snapshot   numeric(18,4),
  consumed_at          timestamptz,
  stock_movement_id    uuid references stock_movements(id),
  created_by           uuid references profiles(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- o las dos, o ninguna: no existe «consumido sin movimiento»
  constraint chk_mop_consumo check (
    (consumed_at is null and stock_movement_id is null) or
    (consumed_at is not null and stock_movement_id is not null))
);
create index idx_mop_order on maintenance_order_parts (maintenance_order_id);
create index idx_mop_pend  on maintenance_order_parts (maintenance_order_id)
  where consumed_at is null;

-- ── 3.6 Mediciones de torque ────────────────────────────────────────────────
create table maintenance_measurements (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references companies(id),
  maintenance_order_id uuid not null references maintenance_orders(id) on delete cascade,
  row_no               int  not null check (row_no > 0),
  min_value            numeric(12,4),
  max_value            numeric(12,4),
  target_value         numeric(12,4),
  created_at           timestamptz not null default now(),
  unique (maintenance_order_id, row_no),
  constraint chk_mm_rango check (min_value is null or max_value is null
                                 or max_value >= min_value)
);

-- ── 3.7 Checks de las partes ────────────────────────────────────────────────
create table maintenance_order_checks (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references companies(id),
  maintenance_order_id uuid not null references maintenance_orders(id) on delete cascade,
  check_point_id       uuid not null references maintenance_check_points(id),
  phase                text not null check (phase in ('diagnosis','repair')),
  result               text not null check (result in ('ok','nok','na')),
  created_at           timestamptz not null default now(),
  unique (maintenance_order_id, check_point_id, phase)
);

-- ── 3.8 Auditoría ───────────────────────────────────────────────────────────
create table maintenance_audit (
  id          bigserial primary key,
  company_id  uuid not null references companies(id),
  entity_type text not null check (entity_type in ('maintenance_asset','maintenance_order')),
  entity_id   uuid not null,
  action      text not null,
  from_status text,
  to_status   text,
  diff        jsonb,
  actor_id    uuid references profiles(id),
  created_at  timestamptz not null default now()
);
create index idx_mau_entity on maintenance_audit (entity_type, entity_id, id);
```

### 4 · Semilla de los 8 puntos de revisión

```sql
insert into maintenance_check_points (company_id, key, label, sort_order)
select c.id, p.key, p.label, p.ord
  from companies c,
       (values ('carcasa','CARCASA/ENCASTRE',1), ('tornillos','TORNILLOS',2),
               ('conectores','CONECTORES',3),    ('reversa','REVERSA',4),
               ('software','SOFT/FIRMWARE',5),   ('embrague','EMBRAGUE',6),
               ('cabezal','CABEZAL/BOLILLAS',7), ('rotor','ROTOR',8))
       as p(key,label,ord)
on conflict do nothing;
```

### 5 · Funciones y triggers (resumen de lo que se escribe)

| objeto | qué hace |
|---|---|
| `app.sellar_autor_mantenimiento()` | `created_by` / `updated_by` los pone el servidor |
| `app.validar_orden_mantenimiento()` | equipo y cliente de la misma empresa; moneda válida |
| `app.proteger_orden_cerrada()` | `closed`/`cancelled` congelan; `number` inmutable; **`open → closed` sólo con la marca de `cerrar_orden_mantenimiento()`** |
| `app.validar_etapa_mantenimiento()` | adelante de a un paso salteando las no requeridas; atrás libre; sólo con `status='open'` |
| `app.proteger_lineas_mantenimiento()` | las líneas de una orden que no está `open` no se tocan |
| `app.proteger_consumo()` | `consumed_at` / `stock_movement_id` **sólo desde la función** |
| `app.totales_cotizacion_mantenimiento()` + `recalcular` + `empujar` | totales server-side, patrón de Ventas y Compras |
| `app.auditar_orden_mantenimiento()` | alta, cambio de etapa, cierre, cancelación. **No** las ediciones de borrador |
| `public.capacidad_torque(p_order)` | **STABLE**: promedio, desvío, **Cp, Cpk, CV** y veredicto. No guarda nada |
| `public.duplicados_de_serial(p_company, p_serial)` | **STABLE**: los equipos con el mismo serial normalizado. Avisa, no bloquea |
| `public.confirmar_consumo_mantenimiento(p_order)` | el de **C.2** |
| `public.cerrar_orden_mantenimiento(p_order)` | las 12 validaciones de **A** |
| `public.cancelar_orden_mantenimiento(p_order, p_motivo)` | sin validaciones |

Las cuatro RPC con `revoke execute … from anon` desde el principio.

### 6 · RLS

Las 8 tablas con `enable` + `force`. `SELECT` por
`app.current_maintenance_company_ids()`, escritura por
`app.current_maintenance_writer_ids()`. `maintenance_audit`: **sólo SELECT**;
se escribe desde triggers `SECURITY DEFINER`.

`salesperson`, `technician`, `customer`, `distributor` y `anon`: **0** (tu punto 8).

---

## Lo que falta para que ejecute

Confirmame estos cinco puntos y aplico:

1. **`maintenance_assets.owner_customer_id NOT NULL`** — vos aprobaste NOT NULL
   para la **orden**; para el **equipo** lo propongo yo con el razonamiento de
   **D.1**. Si preferís que el equipo pueda existir sin dueño, es un cambio de
   una palabra.
2. **`repair_required` y `torque_required` arrancan en `true`.** ¿O preferís
   `torque_required` en false por defecto y que se marque cuando corresponde?
3. **Validación 9** (si el torque es requerido, al menos una medición). Es la
   única de las 12 que no sale de tu lista ni de un bug medido: la agregué
   porque un paso «hecho» sin ninguna medición no midió nada. Decime si la saco.
4. **Saldo negativo permitido** al consumir (**C.4**). Es lo que el schema ya
   hace hoy; lo confirmo porque es una decisión de negocio, no técnica.
5. **`EQ` y `OS`** como series (`EQ00001`, `OS00001`).

Con eso ejecuto la migración, corro la suite y te reporto.
