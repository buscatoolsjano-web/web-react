# Fase 4 — Ventas · modelo final para aprobación

**SQL propuesto, no ejecutado.** Ninguna tabla creada, nada migrado, sin UI.

Deja sin efecto el modelo de 15 tablas de
[`PHASE_4_SALES_MODEL.md`](PHASE_4_SALES_MODEL.md) en dos puntos, por
evidencia: **son 14 tablas** y hay una corrección sobre los impuestos.

---

## Corrección previa — el argumento de las alícuotas era mío y estaba mal

Dije que las alícuotas intermedias (18,9 %, 15,8 %) eran **promedios
ponderados de líneas con distinta alícuota**, y que eso probaba que el
impuesto tenía que ir por línea.

Lo verifiqué y **no se sostiene**:

- las líneas del legacy no tienen ningún campo de impuesto: son
  `{sku, nombre, desc, qty, price, dto}` y nada más;
- en los 22 documentos anómalos, `base` es **exactamente** la suma de las
  líneas;
- y `total = base + ivaAmount` cierra en los 22.

O sea: la aritmética es coherente y `ivaAmount` simplemente se guardó con otra
alícuota efectiva. Vino así del sistema anterior. **No hay evidencia de
impuesto por línea en los datos.**

Lo que sí es real: **10,5 % existe** (COTI02308, 1.856.900 de base), hay **25
documentos sin IVA**, y ocho alícuotas más que no se explican desde las
líneas.

Sigo proponiendo el impuesto **por línea**, pero por otra razón, y quiero que
quede dicha: no porque el legacy lo tenga, sino porque un pedido que mezcla un
balanceador (21 %) con un servicio exento no se puede representar con un solo
campo en la cabecera, y ese caso va a aparecer. Es una decisión a futuro, no
una lectura del pasado.

---

## A. Modelo final — 14 tablas

Una menos que las 15: **`sales_taxes` se cae** (ver B).

| # | tabla | por qué |
|---|---|---|
| 1 | `customer_addresses` | un cliente factura en una dirección y recibe en otra |
| 2 | `customer_contacts` | 87 contactos reales, con `cargo`, `fax`, `observaciones` |
| 3 | `sales_quotes` | 288 documentos |
| 4 | `sales_quote_lines` | 992 líneas |
| 5 | `customer_purchase_orders` | entidad propia; hoy se importa como cotización |
| 6 | `customer_purchase_order_lines` | doble identificación de producto |
| 7 | `purchase_order_discrepancies` | qué cambió el cliente, con el valor de cada lado |
| 8 | `customer_product_aliases` | 15 alias reales, reclavados por `customer_id` |
| 9 | `sales_orders` | 166 documentos |
| 10 | `sales_order_lines` | 593 líneas |
| 11 | `deliveries` | 182, con numeración propia `RT##########` |
| 12 | `delivery_lines` | 600 líneas, sin índices de array |
| 13 | `delivery_serials` | construcción nueva |
| 14 | `sales_invoices` + `sales_invoice_lines` + `payments` + `payment_allocations` | facturación y cobro |
| — | `document_sequences`, `attachments`, `sales_audit` | transversales |

Contando las transversales y desglosando el grupo 14: **20 objetos**. Las
«14» son las de negocio.

---

## B. `sales_taxes` — **decisión: no crearla**

Pusiste el criterio: sólo si representa configuración fiscal reutilizable.

**Hoy no lo es.** Sería una tabla de cuatro filas —21, 10,5, 0, exento— cuyo
único contenido es un código y un número, elegido a mano por quien carga el
documento. Eso es un enum, no configuración.

Va en la línea:

```sql
tax_treatment      text     not null default 'vat_21'
                            check (tax_treatment in
                              ('vat_21','vat_105','vat_0','exempt','not_taxed','other'))
tax_rate_snapshot  numeric  not null default 21
```

El `check` evita el número inventado; el snapshot es lo que vale
jurídicamente y **nunca se recalcula**.

### Cuándo SÍ habría que crearla

En cuanto la alícuota deje de ser una elección del operador y pase a
depender de algo:

- del **cliente** (condición frente al IVA, exento, monotributo);
- de la **provincia** (percepciones de IIBB, que son por jurisdicción);
- del **producto** (categorías con alícuota diferencial).

Ahí ya no alcanza un enum: hace falta una tabla con reglas, y probablemente
otra de `customer_tax_conditions`. Hoy los datos no lo piden —`iibb` es
`false` en los 636 documentos— y adelantarlo sería construir sobre una
suposición.

Migrar de enum a tabla después es barato: se agrega `tax_id`, se pobla desde
`tax_treatment`, y el snapshot ya está en la línea.

---

## C. `sales_audit` — definición exacta

No es un `audit_logs`. Tres diferencias que lo garantizan.

```sql
create table sales_audit (
  id          bigserial primary key,
  company_id  uuid not null references companies(id),
  entity_type text not null,      -- quote|purchase_order|order|delivery|invoice|payment
  entity_id   uuid not null,
  action      text not null,
  from_status text,
  to_status   text,
  diff        jsonb,              -- {"unit_price":{"from":100,"to":90}}
  actor_id    uuid references profiles(id),
  created_at  timestamptz not null default now()
);
```

**1. Se escribe sólo desde funciones de negocio.** No hay trigger de `UPDATE`
sobre las tablas. Si nadie llama a la función, no hay fila. Es lo contrario
del legacy, donde el trigger registraba todo.

**2. `diff` es acotado y sólo para campos sensibles.** Nunca la fila entera.
La lista es cerrada:

```
unit_price · discount_pct · quantity · currency_code · customer_id
tax_treatment · payment_terms
```

Un cambio de `notes` o de `updated_at` **no genera fila**.

**3. Acciones registradas** — cerradas, no «cualquier cosa que pase»:

| entidad | acciones |
|---|---|
| cotización | `created` `sent` `approved` `rejected` `expired` `converted_to_order` |
| OC cliente | `received` `matched` `discrepancy_resolved` `converted_to_order` |
| pedido | `created` `confirmed` `cancelled` `line_price_changed` `customer_changed` `currency_changed` |
| reserva | `stock_reserved` `stock_released` |
| entrega | `created` `shipped` `delivered` `cancelled` |
| factura | `issued` `cancelled` |
| pago | `registered` `allocated` |
| IA | `ai_suggested` `ai_applied` — cuando exista |

**No se registra:** abrir pantalla, navegar, recalcular totales sin cambio,
`updated_at`, ni ningún `UPDATE` técnico.

### Filas esperadas por pedido — calculado con los datos reales

De la medición: **3,6 líneas por pedido** y **1,10 entregas por pedido**.

| tramo | filas |
|---|---:|
| cotización: created, sent, approved, converted | 4 |
| OC: received, matched | 2 |
| pedido: created, confirmed | 2 |
| reservas: 1 por línea | 3,6 |
| entrega: created + shipped, × 1,10 | 2,2 |
| factura: issued | 1 |
| pago: registered + allocated | 2 |
| transiciones derivadas (cumplimiento, facturación, cobro) | 3 |
| **total** | **≈ 20** |

Con el ritmo actual —166 pedidos en 8 meses, unos **250 al año**— son
**~5.000 filas al año**. A ~200 bytes por fila, **1 MB al año**.

El `audit_logs` del legacy llegó a 984 MB. Esto es **mil veces menos**, y no
por suerte: es la diferencia entre registrar transiciones y registrar
`UPDATE`s.

---

## D. Numeración atómica

```sql
create table document_sequences (
  company_id   uuid   not null references companies(id) on delete cascade,
  doc_type     text   not null,
  prefix       text   not null,
  padding      int    not null default 0,
  next_number  bigint not null,
  primary key (company_id, doc_type)
);

create function app.next_document_number(p_company uuid, p_doc_type text)
returns text
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare v_prefix text; v_padding int; v_num bigint;
begin
  -- UPDATE ... RETURNING toma un lock de fila: dos transacciones simultáneas
  -- se serializan y reciben números distintos. Nunca un MAX().
  update document_sequences
     set next_number = next_number + 1
   where company_id = p_company and doc_type = p_doc_type
  returning prefix, padding, next_number - 1
       into v_prefix, v_padding, v_num;

  if not found then
    raise exception 'No hay secuencia para % / %', p_company, p_doc_type
      using errcode = 'no_data_found';
  end if;

  return v_prefix || lpad(v_num::text, v_padding, '0');
end $$;

revoke all on function app.next_document_number(uuid, text) from public, anon;
grant execute on function app.next_document_number(uuid, text) to authenticated;
```

Cumple los seis requisitos: **atómica** (lock de fila), **por
`company_id`**, **por `doc_type`** (PK compuesta), **soporta concurrencia**
(las transacciones se serializan en esa fila y sólo en esa), **sin `MAX()`** y
**sin `localStorage`**.

`document_sequences` no es legible por nadie: sólo esta función la toca, y es
`SECURITY DEFINER`.

Valores iniciales:

| doc_type | prefix | padding | next_number |
|---|---|---:|---:|
| `quote` | `COTI` | 5 | **2541** |
| `sales_order` | `PDV` | 5 | **1316** |
| `delivery` | `RT` | 10 | **1424** |
| `invoice` | — | — | **pendiente** (I1) |

### Los «outliers» no eran outliers — eran un `1` de más

Encontré 9 pedidos fuera de la serie 1151–1315: `PDV11157`, `PDV11209`,
`PDV11225`, `PDV11239`, `PDV11252`, `PDV11259`, `PDV11284`, `PDV11290`,
`PDV11292`.

Y la serie principal tiene 8 huecos: `1157, 1209, 1225, 1252, 1259, 1290,
1292, 1307`.

**Siete de los ocho huecos los llena exactamente un «outlier» al quitarle el
`1` de adelante.** No son otra serie ni documentos de otro sistema: es un
error de tipeo que puso un dígito de más.

| outlier | sin el `1` | ¿existe ese número? |
|---|---|---|
| PDV11157 → 1157 | | **no, es el hueco** |
| PDV11209 → 1209 | | **no, es el hueco** |
| PDV11225 → 1225 | | **no, es el hueco** |
| PDV11252 → 1252 | | **no, es el hueco** |
| PDV11259 → 1259 | | **no, es el hueco** |
| PDV11290 → 1290 | | **no, es el hueco** |
| PDV11292 → 1292 | | **no, es el hueco** |
| PDV11239 → 1239 | | sí existe — **par duplicado**, mismo día |
| PDV11284 → 1284 | | sí existe — **par duplicado**, 03 y 04/08 |

Sólo el hueco **1307** queda sin explicar.

**Qué propongo**, respetando tu decisión de no inventar nada: migrar los 9 con
su número histórico literal y `number_outlier = true`, **sin renumerarlos**.
La secuencia arranca en 1316, que sigue siendo correcto. Los dos pares
duplicados (1239 y 1284) se marcan además `needs_review`, porque puede que
sean el mismo pedido cargado dos veces — o dos pedidos distintos del mismo
día. No lo puedo decidir yo.

---

## E. SQL propuesto

Completo en [`database/PHASE_4_SALES.sql`](database/PHASE_4_SALES.sql) — **no
ejecutado**. Lo que sigue son las decisiones que el SQL materializa.

**Todas las tablas llevan** `company_id uuid not null references companies(id)`,
`created_at`, y las de documento además `created_by`, `updated_by`,
`updated_at`, `legacy_ref`, `needs_review`, `review_reason`.

**Claves naturales** que evitan duplicados en la reimportación:

```sql
unique (company_id, number)                        -- cada documento
unique (company_id, customer_id, po_number)        -- dos clientes pueden repetir número
unique (company_id, customer_id, normalized_key)   -- alias, nunca cruza clientes
unique (company_id, product_id, serial_number)     -- una serie, un producto
unique (payment_id, invoice_id)                    -- una asignación por par
unique (order_id, line_no)                         -- posición estable de la línea
```

**Reglas que NO pueden ser un `CHECK`** —porque miran otras filas— y van en
funciones:

1. lo entregado por línea no puede superar lo pedido;
2. lo facturado por línea no puede superar lo entregado;
3. la suma de `payment_allocations` de un pago no puede superar su `amount`;
4. la suma de asignaciones a una factura no puede superar su `total`.

**Un `CHECK` que sí sirve**, y que aprendimos a poner en la base y no en el
importador:

```sql
-- Un diagrama nunca es imagen principal (Fase 3.6) → mismo criterio acá:
constraint chk_delivery_qty check (quantity > 0)
```

**Cuidado ya conocido:** `uq_product_images_origen` nos enseñó que
`ON CONFLICT` **no puede inferir un índice parcial**. Ninguno de los `unique`
de arriba es parcial, así que el importador sí puede usar `ON CONFLICT` — pero
queda anotado en el script.

---

## F. Matriz de RLS final

Patrón único, el que quedó bien en la Fase 3.6:

```sql
create policy sales_orders_select on sales_orders for select to authenticated
using (
  company_id in (select unnest(app.current_company_ids()))
  and (
    company_id in (select unnest(app.current_internal_company_ids()))
    or customer_id in (select unnest(app.current_customer_ids()))
  )
);
```

Tres reglas que **no** se pueden relajar, cada una por un error que ya
cometimos:

1. **Nunca** una función con la columna como argumento —`is_internal(company_id)`—:
   es una llamada por fila y costó 6 s en un `count`.
2. **Siempre** dentro de un subquery: una función `STABLE` sin argumentos
   **tampoco** se pliega en un InitPlan sin él.
3. **Siempre** la referencia calificada dentro del subquery
   (`sales_orders.company_id`), o resuelve contra la tabla de adentro y se
   vuelve una tautología.

### La función nueva

```sql
create function app.current_customer_ids()
returns uuid[]
language sql stable security definer
set search_path to 'public','pg_temp'
as $$
  select coalesce(array_agg(customer_id), '{}')
  from company_memberships
  where user_id = auth.uid() and status = 'active' and customer_id is not null;
$$;
```

Sin argumentos, para que se resuelva una vez. `SECURITY DEFINER` **es
necesario**: lee `company_memberships`, cuya propia policy depende de
`auth.uid()`, y sin él habría recursión.

### Matriz

| tabla | interno | externo | escritura |
|---|---|---|---|
| `sales_quotes` / `_lines` | su empresa | **sólo las suyas** | admin, employee, salesperson |
| `customer_purchase_orders` / `_lines` | su empresa | **sólo las suyas** | admin, employee, salesperson |
| `purchase_order_discrepancies` | su empresa | **no** | admin, employee |
| `customer_product_aliases` | su empresa | **no** | admin, employee, salesperson |
| `sales_orders` / `_lines` | su empresa | **sólo los suyos** | admin, employee, salesperson |
| `deliveries` / `_lines` | su empresa | **sólo las suyas** | admin, employee |
| `delivery_serials` | su empresa | **sólo los suyos** | admin, employee |
| `sales_invoices` / `_lines` | su empresa | **sólo las suyas** | admin, employee |
| `payments` / `payment_allocations` | su empresa | **no** | admin |
| `customer_addresses` / `_contacts` | su empresa | **sólo los suyos** | admin, employee, salesperson |
| `attachments` | según el padre | según el padre | admin, employee |
| `document_sequences` | **nadie** | **no** | sólo la función |
| `sales_audit` | admin | **no** | sólo funciones de negocio |

**Costo y margen no viven en estas tablas.** Igual que el stock en el
catálogo: si el dato llega al navegador, está. Van en una vista aparte con
policy propia, y para quien no corresponde **no salen del servidor**.

### Pruebas que van con el cambio

Las mismas 71 de la Fase 3.6, más, para cada tabla nueva y para los 5 roles:
leer una fila ajena **por su id exacto** debe devolver 0; insertar en una
empresa ajena debe ser **rechazado**; un `customer` debe ver **sus** pedidos y
**no** los de otro cliente de la misma empresa. Intentos reales, no ausencia
de filas.

---

## G. Clasificación de la migración histórica

Sobre los 636 documentos, con reglas explícitas:

| tipo | total | AUTOMÁTICO | CON REVISIÓN | NO RESUELTO |
|---|---:|---:|---:|---:|
| cotizaciones | 288 | **214** | 55 | 19 |
| pedidos | 166 | **94** | 40 | 32 |
| notas de entrega | 182 | **101** | 50 | 31 |
| **total** | **636** | **409 (64 %)** | **145 (23 %)** | **82 (13 %)** |

**Motivos, por documento** (un documento puede tener varios):

| motivo | cot. | ped. | NE |
|---|---:|---:|---:|
| `SIN_COTIZACION` / `SIN_PEDIDO` | — | 34 | 42 |
| `SKU_NO_RESUELTO` | 39 | 20 | 32 |
| `TOTALES_NO_CIERRAN` | 19 | 32 | 31 |
| `ARS_SIN_TC` | 48 | 27 | 29 |
| `MISSING_CURRENCY` | 6 | 11 | 15 |
| `NUMERO_OUTLIER` | — | 9 | — |
| `ENTREGADO_POR_INDICE` | — | 4 | — |

**`TOTALES_NO_CIERRAN` son 60 documentos** con `base = 0` e `ivaAmount = 0`
pero `total > 0`: nunca se recalcularon. Se migran con el `total` original y
`needs_review`; **no se recalcula la base desde las líneas**, porque eso sería
cambiar el importe de una venta histórica.

**Los 58 clientes** se dan de alta con revisión humana del mapeo nombre →
cliente. Ninguno existe hoy (la tabla tiene 3 filas de prueba).

**Los 4 pedidos con `entregado[idx]`** se convierten a `delivery_lines` **a
mano**: son 7 líneas en total, y verificarlas cuesta cinco minutos.

**Las 32 sin moneda** van con `currency_code = NULL`, `needs_review = true`,
motivo `MISSING_CURRENCY`, conservando el importe tal cual. El reporte que
pediste —documento, fecha, total, cliente, motivo— sale de una consulta sobre
esas filas.

**Las 104 en ARS sin TC** van con `exchange_rate = NULL`. Los reportes
distinguen ARS / USD / SIN TC y **no convierten**.

**La empresa `gas`**: las 7 entradas quedan fuera del inventario principal,
marcadas `NEEDS_REVIEW_COMPANY`, sin crear ninguna `company`.

---

## H. Candidatos de OC del cliente

142 candidatos (par valor + cliente), extraídos de 351 títulos y 1.249
descripciones. **Ninguno se convierte solo.**

```sql
create table customer_po_candidates (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null,
  customer_id  uuid,                  -- puede no estar resuelto todavía
  source_type  text not null,         -- quote|order|delivery
  source_ref   text not null,         -- el ref legacy del documento
  source_field text not null,         -- titulo|item_description
  raw_text     text not null,         -- el texto donde apareció
  candidate    text not null,         -- el valor extraído
  confidence   text not null,         -- high|medium|low
  doc_count    int  not null,         -- en cuántos documentos aparece
  status       text not null default 'pending',  -- pending|confirmed|rejected
  po_id        uuid,                  -- se completa al confirmar
  reviewed_by  uuid, reviewed_at timestamptz,
  created_at   timestamptz not null default now()
);
```

Reparto por confianza, con la regla explícita:

| confianza | regla | candidatos | ejemplos |
|---|---|---:|---|
| **alta** | sólo dígitos, ≥ 6 | **120** | `4502534492`, `4800025297`, `4101092142` |
| **media** | alfanumérico con dígitos | **9** | `260204-3`, `00000-00006307`, `4800026071MAYKELLY` |
| **baja** | el resto | **13** | `CESAR`, `EMILIANO`, `MATIAS`, `xxxx`, `ENTREGADO`, `2026` |

**101 de los 142 aparecen en más de un documento**, y uno aparece en 20. Ese
es el indicio más fuerte: una OC que atraviesa cotización, pedido y remito es
casi con seguridad una OC real.

Los 13 de confianza baja **entran igual** como candidatos con `low`, para que
quede registrado que el patrón los detectó y que una persona los descartó. No
se filtran en silencio.

---

## I. Decisiones bloqueadas por la otra PC

**I1 · Numeración de facturas.** No sé el prefijo, ni el padding, ni el último
número. `document_sequences` para `invoice` queda **sin fila** hasta tener el
dato. Crear la secuencia adivinando arrancaría la numeración fiscal en un
número equivocado.

**I2 · Estructura real de facturas, recibos y notas de crédito.** Del código
del legacy sé los campos —`ref, fromNE, fromPedido, cliente, fecha, items,
base, ivaAmount, total, estado` para factura; `facturaRef, cliente, monto,
fecha, formaPago` para recibo— pero **no vi un solo registro**. El modelo de
§E está hecho sobre el código, no sobre los datos. Puede faltar algo.

**I3 · Cuántas facturas y cobranzas hay.** Sin esto, la migración de esas
tablas no se puede planificar ni reconciliar.

**I4 · Notas de crédito.** `credit_notes` **no está** en las 14 tablas, a
propósito: sé que existen en el legacy y no tengo ni su cantidad ni su forma.
Cuando aparezcan, es una tabla más con la misma estructura que
`payment_allocations` para asignarlas a facturas.

**I5 · Si esa PC tiene documentos que el servidor no tiene.** El equipo que
audité estaba **exactamente sincronizado** con el servidor. La otra puede no
estarlo, y entonces habría cotizaciones o pedidos que hoy no están en los 636.

**Qué necesito de vos:** desde qué equipo/navegador se emiten las facturas.
Con eso hago el mismo procedimiento read-only —listar claves, contar, validar,
exportar, checksum, guardar fuera del repo, no borrar nada— y cierro I1–I5.

---

## Estado de las decisiones

| | decisión | estado |
|---|---|---|
| R1 | facturas y cobranzas | **bloqueado** — falta identificar la PC |
| R2 | empresa `gas` | resuelto: `NEEDS_REVIEW_COMPANY`, fuera del inventario |
| R3 | ARS sin TC | resuelto: `exchange_rate = NULL`, sin convertir |
| R4 | sin moneda | resuelto: `currency_code = NULL` + `needs_review` + reporte |
| R5 | `PDV11292` | resuelto, **y mejor de lo pensado**: son 9 typos, 7 llenan huecos |
| R6 | seguridad legacy | registrado en `DEUDA_TECNICA.md`, prioridad alta |
| B | `sales_taxes` | **resuelto: no se crea**; enum + snapshot en la línea |
| C | `sales_audit` | resuelto: ~20 filas por pedido, ~1 MB al año |
| D | numeración | resuelto: función atómica, `UPDATE … RETURNING` |
| F | `app.current_customer_ids()` | resuelto, con las tres reglas de RLS |

---

## Lo que no hice

No ejecuté SQL. No creé tablas. No migré nada. No empecé UI. No escribí en el
legacy: todas las lecturas fueron `GET`. No abrí los service accounts. No
borré ningún `localStorage`.
