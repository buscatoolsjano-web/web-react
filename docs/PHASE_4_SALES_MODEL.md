# Fase 4 — Ventas · inventario real y modelo final

**Nada creado, nada migrado, nada de UI.** Entrega para aprobación final.

Inventario hecho con **lectura de sólo lectura** del Supabase legacy
(únicamente `GET`) y del `localStorage` del origen legacy, entrando por un
archivo estático para **no ejecutar `app.js`** y no disparar su sincronización
—que habría sido una escritura—.

---

## 1. Inventario read-only del `erp_store` legacy

30 claves, 1,24 MB. Respaldo íntegro guardado **fuera del repositorio** con
manifiesto y sha256 por clave.

### Documentos de venta

| clave | registros | líneas | rango de fechas | bytes |
|---|---:|---:|---|---:|
| `erp_cotizaciones` | **288** | 992 | 2026-01-05 → 2026-09-07 | 345.199 |
| `erp_pedidos` | **166** | 593 | 2026-01-06 → 2026-09-08 | 208.979 |
| `erp_notas_entrega` | **182** | 600 | 2026-01-06 → 2026-09-08 | 216.438 |
| `erp_contactos` | 87 | — | — | 11.978 |
| `spd_client_memory_v1` | 4 clientes / 15 alias | — | — | 811 |
| `erp_kardex` | 22 | — | — | 4.875 |
| `erp_trazabilidad_log` | **2.000** | — | — | 198.806 |

**636 documentos de venta, 2.185 líneas, ocho meses de historia.**

`erp_trazabilidad_log` tiene exactamente 2.000 registros: es un número
redondo sospechoso. Está recortado, así que la traza anterior ya se perdió.

### Campos por documento — presencia real

| campo | cotizaciones | pedidos | notas de entrega |
|---|---:|---:|---:|
| `ref`, `fecha`, `cliente`, `items`, `total`, `estado` | 288 | 166 | 182 |
| `_importadoDeSistemaAnterior` | **286** | **166** | **182** |
| `moneda` | 282 | 155 | 167 |
| `fromCotizacion` / `fromPedido` | — | **132** | **140** |
| `contacto` | 21 | 20 | 21 |
| `creadoPor` | 21 | 20 | 21 |
| `formaPago` | **2** | 0 | 0 |
| `tc` (tipo de cambio) | **2** | 0 | 0 |
| `entregado` | — | **4** | — |

### Estados reales

```
cotizaciones      pendiente 154   cerrada 134
pedidos           cerrada 136     pendiente 26    entregado 4
notas de entrega  facturada 140   pendiente de facturar 21   pendiente 21
```

### Otras claves

`erp_auth_users` (11), `erp_client_accounts` (5), `erp_user_perms` (5),
`erp_bandeja_mensajes` (14), `erp_mensajes` (13), `erp_client_leads` (6),
`mant_*` (4 claves, casi vacías), y **`buscatools_clientes_extra__erpemp_gas`
(7 entradas)** — hay una **tercera empresa** con el namespace `gas`, además de
Buscatools y Torquetools.

---

## 2. Export de seguridad de facturas y cobranzas — **no hay qué exportar acá**

Inventarié el `localStorage` del origen legacy en este equipo: **31 claves**.

**No están `erp_facturas`, ni `erp_recibos`, ni `erp_notas_credito`, ni
`erp_facturas_prov`, ni `erp_notas_proveedor`.** Ninguna de las cinco.

Y las 30 claves que sí están **coinciden exactamente** con las del servidor
—288 cotizaciones, 166 pedidos, 182 notas de entrega, 87 contactos, 22
movimientos de kardex, 4 clientes con memoria—. La única diferencia es una
clave de caché de Firebase.

**Conclusión:** este navegador no aporta nada que el servidor no tenga, y los
documentos financieros **no están acá**. Están en otra máquina: la que
realmente factura.

Igual dejé el respaldo hecho, con checksum:

```
erp_store-completo.json    1,24 MB
sha256  c396002891e35e06d63007b0770e3c96…
MANIFEST.json              30 claves, sha256 por clave, conteo por clave
```

Fuera del repositorio. No borré nada de ningún `localStorage`.

**Advertencia que pediste registrar:** el export de una sola máquina no
representa el universo. Faltan por lo menos las facturas, los recibos y las
notas de crédito, y no sé cuántos son. **Ver decisión R1.**

---

## 3–4. Cantidades y rangos

Resumido arriba. Lo importante para dimensionar:

| moneda | documentos | total |
|---|---:|---:|
| USD | 499 | 2.055.385 |
| ARS | 104 | 132.925.695 |
| EUR | 1 | 6.712 |
| **sin moneda** | **32** | 13.165.571 |

**32 documentos sin moneda declarada, por 13,1 millones.** No se puede
adivinar: hay que decidir qué se asume (ver R4).

---

## 5. Calidad de los vínculos históricos — mejor de lo que esperaba

Esto cambia la evaluación de riesgo que te di antes:

| comprobación | resultado |
|---|---|
| pedidos con `fromCotizacion` | 132 de 166 (79,5 %) |
| …que apuntan a una cotización **inexistente** | **0** |
| notas de entrega con `fromPedido` | 140 de 182 (76,9 %) |
| …que apuntan a un pedido **inexistente** | **0** |
| refs duplicadas en cotizaciones / pedidos / NE | **0 / 0 / 0** |
| pedidos con `entregado` por índice de array | **4 de 166** |

**Cero enlaces rotos y cero números duplicados.** Los enlaces por texto que
critiqué son frágiles *por diseño*, pero en la práctica están íntegros.

Y el riesgo del índice de array que marqué como grave **casi no existe**:
sólo 4 pedidos lo usan, con 1, 1, 2 y 3 líneas, todos de una sola entrega.
Son verificables a mano en cinco minutos.

### Resolución contra la base nueva

| | |
|---|---:|
| SKU distintos usados en ventas | 731 |
| **encontrados en `products`** | **692 (94,7 %)** |
| no encontrados | 39 |
| **líneas resolubles** | **1.999 de 2.185 (91,5 %)** |
| líneas sin SKU | **0** |

Los 39 que no resuelven son `SER*` (servicios, 141 líneas) y algunos `PRO*`
dados de alta a mano. **No son un error de migración: son líneas que no
apuntan a un producto del catálogo**, y el modelo ya las contempla con
`product_id` nullable.

| | |
|---|---:|
| clientes distintos en ventas | **58** |
| ya existentes en `customers` | **0** (la tabla tiene 3 filas de prueba) |

Los 58 hay que darlos de alta. Los cinco primeros por volumen: Grupo Mirgor
(236 documentos), Whirlpool (73), Mabe (69), SAS Automotriz–Motherson (35),
Integra Services (23).

---

## 6. Qué SÍ se puede reconstruir con certeza

| relación | evidencia |
|---|---|
| cotización → pedido | 132 enlaces, **0 rotos** |
| pedido → nota de entrega | 140 enlaces, **0 rotos** |
| línea → producto | 91,5 % por SKU exacto |
| documento → cliente | por nombre; 58 nombres, revisables uno a uno |
| documento → moneda | 604 de 636 |
| entregas parciales | sólo 4 casos, verificables a mano |
| **número de OC del cliente** | **351 documentos lo tienen en el título** y 1.249 líneas en la descripción; **133 números distintos** detectados (`4502534492`, `4800025297`, `4101092142`…) |

Ese último es un hallazgo que no esperaba: **la OC del cliente sí quedó
registrada**, como texto libre dentro del título y de las descripciones. Es
recuperable con una extracción por patrón **más revisión humana** — no
automática, porque entre los "números" detectados hay basura como `CESAR`.

## 7. Qué NO se puede reconstruir

| |  |
|---|---|
| **Facturas, cobranzas y notas de crédito** | no están en el servidor ni en este equipo |
| **Tipo de cambio de las ventas en ARS** | 104 documentos en ARS, **1 solo tiene `tc`** |
| **Vendedor** | `creadoPor` en 62 documentos, y dice `STEL Order`, no una persona |
| **Forma de pago** | 2 documentos de 636 |
| **Qué OC originó cada cotización** | el número está en el texto, la relación no |
| **Precio de lista al momento de la venta** | nunca se guardó; sólo el precio acordado |
| **Los 34 pedidos sin cotización** | ¿venta directa o el enlace se perdió? No hay forma de saberlo |
| **Los 42 remitos sin pedido** | ídem |

**Nada de esto se inventa.** Se migra como `needs_review`, igual que hicimos
con los 12.593 productos de la Fase 3.5.

---

## 8. Correcciones a lo que te dije antes

Tres cosas de mi diseño anterior estaban mal, y los datos lo muestran:

**1. Dije que moneda y tipo de cambio ya estaban resueltos.** Falso a medias.
La moneda sí (604 de 636). El tipo de cambio **no**: 2 documentos de 636, y de
los 105 en moneda distinta de USD, **uno solo** lo tiene. La infraestructura
existe en el código; el dato no se cargó nunca.

**2. Dije que `erp_contactos` no sincronizaba.** Sí sincroniza: está en el
servidor con 87 registros. Lo leí mal de `SUPA_SYNC_KEYS`.

**3. Reporté que `moneda` y `_moneda` discrepaban en 582 documentos.** Era un
falso positivo mío: `_moneda` es la etiqueta para mostrar
(`"USD $ - Dolar estadounidense"`), no otro código. No hay discrepancia.

Y una que sí se confirmó, más fuerte de lo que pensaba: **el IVA no es 21 %
fijo**. Alícuotas efectivas reales:

```
21 %    527 documentos        10,5 %   3 documentos
20 %      4                   18,9 %   3
15,8 %    3                   19,9 %   2
17,9 %    2                   … y seis valores más, uno cada uno
iva=false 25 documentos
```

El 10,5 % es real. **Lo de los promedios ponderados era una hipótesis mía y
resultó falsa**: verifiqué que las líneas del legacy no tienen ningún campo de
impuesto, que `base` es exactamente la suma de las líneas en los 22 casos y
que `total = base + ivaAmount` cierra. El `ivaAmount` anómalo vino así del
sistema anterior y no se explica desde las líneas. Ver
[`PHASE_4_SALES_FINAL.md`](PHASE_4_SALES_FINAL.md), corrección previa.

Dos datos más que simplifican: **`dtoGlobal` es 0 en los 636 documentos** (el
descuento global no se usa nunca; sólo 109 de 2.185 líneas tienen descuento) y
**`iibb` es `false` en los 636**.

---

## 9. Modelo final — 15 tablas

Dos más que las 13 que propuse: se agregan `sales_taxes` (por lo del punto
anterior) y `sales_audit`.

### Cliente

```sql
customer_addresses (
  id uuid pk, company_id uuid not null, customer_id uuid not null,
  kind text not null check (kind in ('billing','shipping','both')),
  is_default boolean not null default false,
  street text, city text, state text, postal_code text,
  country_code text, notes text,
  created_at, updated_at)

customer_contacts (
  id uuid pk, company_id uuid not null, customer_id uuid not null,
  full_name text not null, role text, email text, phone text, fax text,
  is_default boolean not null default false, notes text,
  created_at, updated_at)
```

`role`, `fax` y `notes` salen de los 87 contactos reales, que tienen
exactamente `nombre, cargo, email, telefono, fax, observaciones, cliente`.

### Cotización

```sql
sales_quotes (
  id uuid pk, company_id uuid not null,
  number text not null,                    -- COTI02541…
  external_number text, external_source text,   -- STEL u otro
  customer_id uuid not null, contact_id uuid, salesperson_id uuid,
  quote_date date not null, valid_until date,
  currency_code text not null, exchange_rate numeric,
  payment_terms text, notes text,
  status text not null,                    -- draft|sent|accepted|rejected|expired
  approved_by uuid, approved_at timestamptz,
  needs_review boolean not null default false, review_reason text,
  legacy_ref text,                         -- el ref original
  created_by, created_at, updated_by, updated_at,
  unique (company_id, number))

sales_quote_lines (
  id uuid pk, company_id uuid not null, quote_id uuid not null,
  line_no int not null,
  product_id uuid,                         -- NULL para servicios y ad-hoc
  sku_snapshot text, name_snapshot text, description_snapshot text,
  brand_snapshot text,
  quantity numeric not null, unit_price numeric not null,
  list_price_snapshot numeric,             -- lo que decía la lista
  discount_pct numeric not null default 0,
  tax_id uuid, tax_rate_snapshot numeric,  -- POR LÍNEA
  kit_components_snapshot jsonb,
  line_type text not null default 'item',  -- item|service|chapter
  notes text,
  unique (quote_id, line_no))
```

### OC del cliente — entidad propia

```sql
customer_purchase_orders (
  id uuid pk, company_id uuid not null, customer_id uuid not null,
  po_number text not null,                 -- el número DEL CLIENTE
  po_date date, quote_id uuid,
  currency_code text, exchange_rate numeric,
  payment_terms text, cost_center text,
  shipping_address_id uuid, contact_id uuid,
  received_at timestamptz, received_by uuid,
  raw_text text,                           -- el texto tal como llegó
  match_status text,                       -- match|difference|missing|extra|unmatched
  notes text, needs_review boolean default false,
  created_at, updated_at,
  unique (company_id, customer_id, po_number))

customer_purchase_order_lines (
  id uuid pk, company_id uuid not null, po_id uuid not null, line_no int not null,
  product_id uuid,
  customer_product_code text,              -- EXACTO como lo mandó
  customer_description text,               -- EXACTO como lo mandó
  quantity numeric, unit_price numeric, discount_pct numeric,
  match_status text, match_confidence numeric, matched_by uuid, matched_at timestamptz,
  quote_line_id uuid,
  unique (po_id, line_no))

purchase_order_discrepancies (
  id uuid pk, company_id uuid not null, po_id uuid not null,
  po_line_id uuid, quote_line_id uuid,
  field text not null,                     -- unit_price|quantity|currency|…
  quote_value text, po_value text,
  severity text, resolved_at timestamptz, resolved_by uuid, resolution_note text,
  created_at)
```

El `unique (company_id, customer_id, po_number)` importa: dos clientes
distintos pueden mandar el mismo número de OC, y eso no es un conflicto.

### Equivalencias por cliente

```sql
customer_product_aliases (
  id uuid pk, company_id uuid not null, customer_id uuid not null,
  customer_code text, customer_description text,
  normalized_key text not null,
  product_id uuid not null,
  status text not null default 'suggested',  -- suggested|confirmed|rejected
  confidence numeric, source text,           -- manual|import|ai
  times_used int not null default 0, last_used_at timestamptz,
  created_by, confirmed_by, created_at, updated_at,
  unique (company_id, customer_id, normalized_key))
```

Migra los 15 alias existentes de 4 clientes, cambiando la clave de nombre
normalizado a `customer_id`. **El `unique` lleva `customer_id`: un alias nunca
cruza clientes.**

### Pedido

```sql
sales_orders (
  id uuid pk, company_id uuid not null,
  number text not null,                    -- PDV01316…
  external_number text, external_source text,
  customer_id uuid not null, contact_id uuid, salesperson_id uuid,
  order_date date not null,
  quote_id uuid, po_id uuid,
  origin text not null,                    -- quote_po|po_only|direct|manual|migration
  currency_code text not null, exchange_rate numeric,
  payment_terms text, cost_center text,
  shipping_address_id uuid, billing_address_id uuid,
  commercial_status text not null default 'draft',
  fulfillment_status text not null default 'pending',
  invoicing_status text not null default 'not_invoiced',
  payment_status text not null default 'unpaid',
  notes text, needs_review boolean default false, review_reason text,
  legacy_ref text,
  created_by, created_at, updated_by, updated_at,
  unique (company_id, number))

sales_order_lines (
  id uuid pk, company_id uuid not null, order_id uuid not null, line_no int not null,
  product_id uuid, quote_line_id uuid, po_line_id uuid,
  sku_snapshot text, name_snapshot text, description_snapshot text,
  customer_product_code text, customer_description text,
  quantity_ordered numeric not null,
  unit_price numeric not null, list_price_snapshot numeric,
  discount_pct numeric not null default 0,
  tax_id uuid, tax_rate_snapshot numeric,
  kit_components_snapshot jsonb,
  line_type text not null default 'item', notes text,
  unique (order_id, line_no))
```

### Entrega / remito

Decisión A tuya: **la entrega lleva numeración propia y estable**. El legacy
ya la tiene: las notas de entrega se numeran `RT0000001242`…`RT0000001423`.

```sql
deliveries (
  id uuid pk, company_id uuid not null,
  number text not null,                    -- RT0000001424…
  external_number text, external_source text,   -- STEL como fuente futura
  order_id uuid, customer_id uuid not null,
  delivery_date date not null,
  shipping_address_id uuid, contact_id uuid,
  carrier text, tracking text,
  status text not null default 'draft',    -- draft|shipped|delivered|cancelled
  notes text, legacy_ref text,
  created_by, created_at, updated_by, updated_at,
  unique (company_id, number))

delivery_lines (
  id uuid pk, company_id uuid not null, delivery_id uuid not null,
  order_line_id uuid,                      -- NULL si la entrega es suelta
  product_id uuid, sku_snapshot text, name_snapshot text,
  quantity numeric not null check (quantity > 0),
  warehouse_id uuid not null, notes text)

delivery_serials (
  id uuid pk, company_id uuid not null,
  delivery_line_id uuid not null, product_id uuid not null,
  serial_number text not null,
  customer_id uuid not null, delivery_date date not null, notes text,
  created_at,
  unique (company_id, product_id, serial_number))
```

`order_id` es nullable **porque 42 de 182 remitos históricos no tienen
pedido**. Forzarlo obligaría a inventar el vínculo.

### Impuestos

```sql
sales_taxes (
  id uuid pk, company_id uuid not null,
  code text not null,                      -- IVA21|IVA105|IVA0|EXENTO|…
  name text not null, rate numeric not null,
  kind text not null default 'vat',        -- vat|perception|withholding
  is_active boolean not null default true,
  unique (company_id, code))
```

Las líneas guardan `tax_id` **y** `tax_rate_snapshot`. El id dice qué
tratamiento se eligió; el snapshot, con qué alícuota se calculó. Si mañana
cambia la alícuota, la venta vieja no se mueve.

`kind` deja lugar a percepciones y retenciones **sin obligarlas ahora**: hoy
sólo se cargan las de `kind='vat'`, y las otras existen como concepto.

### Factura y cobranza

```sql
sales_invoices (
  id uuid pk, company_id uuid not null,
  number text not null, external_number text, external_source text,
  customer_id uuid not null, order_id uuid,
  invoice_date date not null, due_date date,
  currency_code text not null, exchange_rate numeric,
  subtotal numeric, tax_amount numeric, total numeric,
  status text not null default 'draft',    -- draft|issued|paid|cancelled
  notes text, legacy_ref text,
  created_by, created_at, updated_by, updated_at,
  unique (company_id, number))

sales_invoice_lines (
  id uuid pk, company_id uuid not null, invoice_id uuid not null,
  order_line_id uuid, delivery_line_id uuid,
  product_id uuid, sku_snapshot text, name_snapshot text,
  quantity numeric not null, unit_price numeric not null,
  discount_pct numeric default 0, tax_id uuid, tax_rate_snapshot numeric)

payments (
  id uuid pk, company_id uuid not null, customer_id uuid not null,
  payment_date date not null, amount numeric not null,
  currency_code text not null, exchange_rate numeric,
  method text, reference text, notes text,
  created_by, created_at)

payment_allocations (
  id uuid pk, company_id uuid not null,
  payment_id uuid not null, invoice_id uuid not null,
  amount numeric not null check (amount > 0),
  created_at,
  unique (payment_id, invoice_id))
```

`sales_invoice_lines.delivery_line_id` es lo que rompe la limitación legacy de
una factura por remito: una factura puede juntar líneas de varias entregas, y
una entrega puede repartirse en varias facturas.

### Numeración, adjuntos, auditoría

```sql
document_sequences (
  company_id uuid not null, doc_type text not null,
  prefix text not null, padding int not null default 0,
  next_number bigint not null,
  primary key (company_id, doc_type))

attachments (
  id uuid pk, company_id uuid not null,
  entity_type text not null, entity_id uuid not null,
  storage_path text not null,              -- Supabase Storage, NUNCA base64
  file_name text, mime_type text, bytes bigint,
  kind text,                               -- customer_po|quote_pdf|remito|invoice|receipt|photo|other
  uploaded_by uuid, created_at)

sales_audit (
  id bigserial pk, company_id uuid not null,
  entity_type text not null, entity_id uuid not null,
  action text not null,
  from_status text, to_status text,
  diff jsonb,                              -- {"campo":{"from":…,"to":…}}
  actor_id uuid, created_at timestamptz not null default now())
```

---

## 10. ERD

```
                    companies ──┬── profiles / company_memberships
                                │
                          customers ──┬── customer_addresses
                                │     ├── customer_contacts
                                │     └── customer_product_aliases ── products
                                │
    ┌───────────────────────────┼──────────────────────────────┐
    │                           │                              │
sales_quotes            customer_purchase_orders          sales_orders
    │                           │                              │
sales_quote_lines ◄──── customer_purchase_order_lines ────► sales_order_lines
    │        ▲                  │                              │    │
    │        └── purchase_order_discrepancies ─────────────────┘    │
    │                                                              │
    │                                        stock_reservations ◄───┤
    │                                        (source_type=          │
    │                                         'sales_order')        │
    │                                                              │
    │                                              deliveries ─────┤
    │                                                  │           │
    │                                          delivery_lines ─────┘
    │                                                  │
    │                                          delivery_serials
    │                                                  │
    │                                          stock_movements
    │                                                  │
    └──────────────────────────► sales_invoices ◄──────┘
                                       │
                              sales_invoice_lines
                                       │
                          payment_allocations ── payments

    transversales:  document_sequences · attachments · sales_audit · sales_taxes
```

---

## 11. Matriz de RLS

Patrón fijo, el que quedó bien en la Fase 3.6: funciones **sin argumentos**,
**dentro de un subquery**, y la referencia **calificada**.

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

Hace falta **una función nueva**: `app.current_customer_ids()`, que devuelve
los `customer_id` ligados a las membresías del usuario. Sin ella un cliente
externo vería los pedidos de todos.

| tabla | interno lee | externo lee | escribe |
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
| `sales_taxes` | su empresa | lectura | admin |
| `document_sequences` | **nadie** | **no** | sólo funciones `SECURITY DEFINER` |
| `attachments` | según el documento padre | según el padre | admin, employee |
| `sales_audit` | admin | **no** | sólo el servidor |

**El costo y el margen no viven en estas tablas.** Como con el stock en el
catálogo: si el dato viaja al navegador, está. Van en una vista aparte con su
propia policy, y para quien no corresponde **no salen del servidor**.

---

## 12. Numeración server-side

`document_sequences` con PK `(company_id, doc_type)` y una función:

```sql
create function app.next_document_number(p_company uuid, p_doc_type text)
returns text language plpgsql security definer as $$
declare v_prefix text; v_padding int; v_num bigint;
begin
  update document_sequences
     set next_number = next_number + 1
   where company_id = p_company and doc_type = p_doc_type
  returning prefix, padding, next_number - 1 into v_prefix, v_padding, v_num;
  if not found then raise exception 'sin secuencia para % / %', p_company, p_doc_type; end if;
  return v_prefix || lpad(v_num::text, v_padding, '0');
end $$;
```

El `UPDATE … RETURNING` toma un lock de fila: dos usuarios simultáneos reciben
números distintos. **No se calcula ningún `MAX`.**

Valores iniciales, tomados de los máximos reales **más uno** — y no del conteo
de registros, porque **hay huecos**: COTI tiene 2, PDV **17**, RT 4.

| doc_type | prefix | padding | next_number | de dónde |
|---|---|---:|---:|---|
| `quote` | `COTI` | 5 | **2541** | máx. real 2540 |
| `sales_order` | `PDV` | 5 | **1316** | máx. real 1315 (hay un `PDV11292` suelto, a revisar) |
| `delivery` | `RT` | 10 | **1424** | máx. real 1423 |
| `invoice` | — | — | — | **pendiente**: no tengo los datos |

`external_number` + `external_source` quedan preparados en los cuatro
documentos para cuando STEL sea la fuente definitiva. Hoy `creadoPor` dice
`STEL Order` en 62 documentos, así que STEL ya está en el circuito.

---

## 13. Estrategia de migración

Cinco etapas, cada una verificable y reversible.

**M1 · Clientes y contactos.** Alta de los 58 clientes desde los nombres
distintos, con revisión humana del mapeo. Los 87 contactos se enganchan por su
campo `cliente` (texto) contra el cliente ya creado. Reconciliación: 58 y 87.

**M2 · Cotizaciones y líneas.** 288 + 992. `product_id` por SKU exacto
(94,7 %); el resto queda NULL con `needs_review`. `legacy_ref` guarda el `ref`
original. Reconciliación: recuentos, y suma de `total` por moneda contra el
origen.

**M3 · Pedidos y líneas.** 166 + 593, con `quote_id` resuelto por
`fromCotizacion` (132, cero rotos). Los 34 sin cotización quedan
`origin='migration'` + `needs_review`.

**M4 · Entregas.** 182 + 600, con `order_id` por `fromPedido` (140, cero
rotos). Los 4 pedidos con `entregado` se convierten a `delivery_lines`
**a mano**, uno por uno: son 7 líneas en total.

**M5 · OC del cliente, con revisión.** Extraer los 133 números detectados en
títulos y descripciones, crear `customer_purchase_orders` y proponer el
vínculo. **Ninguno se confirma automáticamente**: entre los detectados hay
`CESAR`, que no es un número de OC.

**Fuera de alcance hasta R1:** facturas, cobranzas y notas de crédito.

**No se migra:** `erp_trazabilidad_log` (2.000 registros ya recortados, y su
esquema no se corresponde con `sales_audit`), `erp_kardex` (22 movimientos que
ya están representados en `stock_movements`), y los mensajes.

---

## Riesgos y decisiones

### R1 · ¿Dónde están las facturas? — **bloquea M6**

No están en el servidor ni en este equipo. Están en la máquina de quien
factura. **¿Desde qué equipo/navegador se emiten?** Con esa respuesta hago el
mismo inventario y export que hice acá.

Mientras tanto siguen sin respaldo.

### R2 · La tercera empresa

Apareció `buscatools_clientes_extra__erpemp_gas`: hay un namespace `gas`
además de Buscatools y Torquetools. **¿Es una empresa real que hay que dar de
alta, o una prueba?** Cambia el alcance de la migración.

### R3 · Sin tipo de cambio en 104 ventas en ARS

Sólo 1 de 105 documentos no-USD tiene `tc`. Para consolidar en una moneda hace
falta decidir: **¿se deja `exchange_rate` en NULL y se reporta cada moneda por
separado, o cargamos un tipo de cambio histórico por fecha?** Lo segundo es
inventar un dato que no existía; prefiero lo primero, pero es tu decisión.

### R4 · 32 documentos sin moneda, por 13,1 millones

La cifra sugiere ARS (un total de 13 millones en USD sería inverosímil para
esos documentos), pero **suponer no es saber**. ¿Los marco `needs_review` con
`currency_code` NULL, o asumo ARS y lo documento?

### R5 · El `PDV11292`

Un pedido con número 11292 entre otros de 1151–1315. O es un tipeo, o vino de
otra serie. Si arranco la secuencia en 11293 quemo 10.000 números; si arranco
en 1316, ese documento queda fuera de serie. **Propongo 1316 y marcar ese
documento como fuera de serie.** Confirmame.

### R6 · Backlog de seguridad (P3)

Registrado, sin tocar nada:

| ítem | estado | riesgo |
|---|---|---|
| `SUPA_APP_TOKEN` en `app.js` público | **en uso** — es el header que autoriza escribir en `erp_store` | **alto** |
| `SUPA_KEY` publishable | en uso, correcto por diseño | ninguno |
| `erp_openai_key` en localStorage | **no está** en este equipo; puede estar en otro | medio |
| Firebase service accounts en `Downloads` | presentes, **no abiertos** | **alto** |
| Firebase RTDB | sólo chat y push | bajo |

Ninguno afecta a la base nueva: son del legacy. Recomiendo rotar el token y
mover los JSON. **No bloquea la Fase 4.**

### R7 · Lo que el modelo NO resuelve

- **Contabilidad.** No hay libro IVA, ni cuentas, ni asientos. `payments` y
  `payment_allocations` alcanzan para saber qué se debe, no para cerrar un
  balance.
- **Retenciones y percepciones.** El `kind` está previsto, el cálculo no.
- **Notas de crédito.** Existen en el legacy pero no las tengo. Cuando
  aparezcan (R1) hará falta `credit_notes` + su asignación, con la misma forma
  que `payment_allocations`.
- **Productos serializados.** Falta `products.is_serialized` y, sobre todo,
  **la lista de qué productos lo son**. Sin esa lista el campo queda en false
  y los números de serie no se piden. Tu criterio: atornilladores,
  herramientas eléctricas/neumáticas, controladores y equipos — pero eso son
  ~180 productos sobre 21.772 y hay que confirmarlos uno por uno.

---

## Lo que hice y lo que no

**Hice:** lectura `GET` del `erp_store` legacy, lectura del `localStorage` del
origen legacy sin ejecutar `app.js`, respaldo íntegro con sha256 fuera del
repositorio, y este documento.

**No hice:** ninguna escritura, ningún UPDATE, ningún DELETE, ninguna RPC de
escritura, ningún cambio de RLS ni de funciones del legacy, ninguna rotación,
ningún borrado de `localStorage`. No abrí los JSON de service account. No creé
tablas. No migré datos. No empecé UI.
