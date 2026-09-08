# Diccionario de datos

> **PROPUESTA — no ejecutado.**

Convenciones que aplican a **todas** las tablas y no se repiten fila por
fila:

| Columna | Tipo | Nulo | Default | Nota |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK. `bigint identity` en tablas append-only |
| `company_id` | `uuid` | no | — | FK → `companies(id)`. **Presente en toda tabla de negocio. Clave de RLS** |
| `created_at` | `timestamptz` | no | `now()` | UTC |
| `updated_at` | `timestamptz` | no | `now()` | Por trigger |
| `created_by` | `uuid` | sí | `auth.uid()` | FK → `profiles(id)` |
| `deleted_at` | `timestamptz` | sí | — | Soft delete donde aplique |
| `legacy_ref` | `text` | sí | — | Referencia del sistema viejo. Migración idempotente |

Columna **RLS**: 🔑 la usa una política · 🔒 dato sensible, restringido por rol.

---

## CORE

### `companies`

| Columna | Tipo | Nulo | FK | Descripción | Índice | RLS |
|---|---|---|---|---|---|---|
| `slug` | `text` | no | — | `buscatools`, `torquetools`, `gas` | UNIQUE | |
| `name` | `text` | no | — | Nombre de fantasía | | |
| `legal_name` | `text` | sí | — | Razón social | | |
| `tax_id` | `text` | sí | — | CUIT | | |
| `address`, `phone`, `email`, `website` | `text` | sí | — | Datos de contacto | | |
| `logo_path` | `text` | sí | — | Ruta en Storage. El legacy guarda base64 inline | | |
| `brand_color` | `text` | sí | — | `#F37021` | | |
| `default_currency` | `text` | no | `currencies` | `ARS` | | |
| `is_active` | `boolean` | no | — | | | |

### `profiles`

| Columna | Tipo | Nulo | FK | Descripción | Índice | RLS |
|---|---|---|---|---|---|---|
| `id` | `uuid` | no | `auth.users(id)` | **PK = id de Supabase Auth** | PK | 🔑 |
| `full_name` | `text` | no | — | | trgm | |
| `avatar_path` | `text` | sí | — | Storage | | |
| `phone` | `text` | sí | — | | | |
| `locale` | `text` | no | — | `es-AR` | | |
| `theme` | `text` | sí | — | `light` / `dark` | | |
| `is_active` | `boolean` | no | — | | | |

> Sin columna de contraseña. Las credenciales viven en `auth.users`.

### `company_memberships`

| Columna | Tipo | Nulo | FK | Descripción | Índice | RLS |
|---|---|---|---|---|---|---|
| `user_id` | `uuid` | no | `profiles(id)` | | UNIQUE(user,company) | 🔑 |
| `company_id` | `uuid` | no | `companies(id)` | | (company, role) | 🔑 |
| `role` | `text` | no | `roles(code)` | `admin`, `employee`, `salesperson`, `technician`, `distributor`, `customer`, `supplier` | | 🔑 |
| `customer_id` | `uuid` | sí | `customers(id)` | **Obligatorio si `role IN (customer, distributor)`** | | 🔑 |
| `supplier_id` | `uuid` | sí | `suppliers(id)` | Obligatorio si `role = supplier` | | 🔑 |
| `status` | `text` | no | — | `active` / `suspended` | parcial WHERE active | 🔑 |

> Tabla más consultada del sistema: la lee cada política RLS de cada
> consulta, vía `app.current_company_ids()`.

### `files`

| Columna | Tipo | Nulo | FK | Descripción | Índice | RLS |
|---|---|---|---|---|---|---|
| `bucket` | `text` | no | — | `product-images`, `documents`, … | | |
| `path` | `text` | no | — | Ruta dentro del bucket | UNIQUE(bucket,path) | |
| `original_name` | `text` | sí | — | Nombre con el que se subió | | |
| `mime_type` | `text` | no | — | | | |
| `size_bytes` | `bigint` | no | — | | | |
| `checksum_sha256` | `text` | sí | — | Deduplicación | | |
| `uploaded_by` | `uuid` | sí | `profiles(id)` | | | 🔑 |

> **Sin `entity_type`/`entity_id`.** Los enlaces van en tablas por dominio.

### `audit_events`

| Columna | Tipo | Nulo | FK | Descripción | Índice | RLS |
|---|---|---|---|---|---|---|
| `id` | `bigint` | no | — | Identity. Append-only | PK | |
| `actor_id` | `uuid` | sí | `profiles(id)` | Nulo si lo hizo el sistema | (company,actor,occurred) | 🔑 |
| `entity_type` | `text` | no | — | `sales_order`, `product`… | (company,entity_type,entity_id,occurred) | |
| `entity_id` | `uuid` | sí | — | | | |
| `entity_label` | `text` | sí | — | `PED00123` — legible sin join | | |
| `action` | `text` | no | — | `create`, `update`, `delete`, `status_change`, `approve`, `convert` | | |
| `changes` | `jsonb` | sí | — | **Diff por campo**, no la fila entera | | |
| `occurred_at` | `timestamptz` | no | — | Futuro: `PARTITION BY RANGE` | | |

---

## CATÁLOGO

### `products` — la tabla más consultada del sistema (21.772 filas)

| Columna | Tipo | Nulo | FK | Descripción | Llenado legacy | Índice | RLS |
|---|---|---|---|---|---|---|---|
| `sku` | `text` | no | — | Clave natural. 0 duplicados medidos | 100% | UNIQUE(company,sku); trgm | |
| `name` | `text` | no | — | | 100% | trgm | |
| `model_code` | `text` | sí | — | legacy `base` | 100% | | |
| `brand_id` | `uuid` | **sí** | `brands(id)` | **5.456 productos sin marca** | 74,9% | (company,brand) | |
| `category_id` | `uuid` | no | `product_categories(id)` | 12.588 caen en `otros` | 100% | (company,category) | |
| `product_type` | `text` | sí | — | 41 valores. Filtro principal | 42,2% | | |
| `series` | `text` | sí | — | 159 valores. Filtro principal | 41,7% | | |
| `description` | `text` | sí | — | legacy `desc` | 100% | | |
| `description_long` | `text` | sí | — | legacy `descl` | 99,7% | | |
| `origin_country` | `text` | sí | — | ISO 3166. 6 valores | 40,5% | | |
| `ncm_code` | `text` | sí | — | Posición arancelaria | 24,5% | | |
| `weight_g` | `integer` | sí | — | | 100% | | |
| `volume_cm3` | `integer` | sí | — | | 100% | | |
| `attributes` | `jsonb` | no `'{}'` | — | Cola larga validada contra `product_attribute_definitions` | — | **GIN** | |
| `status` | `text` | no | — | `active`, `discontinued`, `draft` | — | | 🔑 |
| `is_kit` | `boolean` | no | — | | — | | |
| `search_vector` | `tsvector` | — | — | **GENERATED**. Reemplaza el campo `s` | 100% | **GIN** | |

### `product_costs` 🔒

| Columna | Tipo | Nulo | FK | Descripción | RLS |
|---|---|---|---|---|---|
| `product_id` | `uuid` | no | `products(id)` | | |
| `supplier_id` | `uuid` | sí | `suppliers(id)` | | |
| `cost` | `numeric(14,4)` | no | — | | 🔒 |
| `currency_code` | `text` | no | `currencies` | | |
| `effective_date` | `date` | no | — | | |

> **Tabla separada de `products` por seguridad.** Distribuidores y
> clientes tienen `SELECT` denegado. Dentro de `products`, ocultarla
> dependería de que ningún `SELECT` se olvide.

### `stock_movements` — append-only

| Columna | Tipo | Nulo | FK | Descripción | Índice |
|---|---|---|---|---|---|
| `id` | `bigint` | no | — | Identity | PK |
| `product_id` | `uuid` | no | `products(id)` | | (company,product,warehouse,created DESC) |
| `warehouse_id` | `uuid` | no | `warehouses(id)` | | |
| `movement_type` | `text` | no | — | `purchase_receipt`, `sale_delivery`, `adjustment`, `transfer_in/out`, `return_in/out`, `opening_balance` | |
| `quantity` | `numeric(14,3)` | no | — | **Con signo.** `CHECK (quantity <> 0)` | |
| `source_type` | `text` | sí | — | `delivery_note`, `purchase_receipt`, `manual` | (source_type, source_id) |
| `source_id` | `uuid` | sí | — | Qué documento lo originó | |

> Sin `UPDATE` ni `DELETE` para ningún rol. Corregir = contramovimiento.

### `stock_balances` — derivada

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `product_id` + `warehouse_id` | `uuid` | no | PK compuesta |
| `on_hand` | `numeric(14,3)` | no | **Sólo lo escribe el trigger** |
| `reserved` | `numeric(14,3)` | no | Idem |

> `disponible = on_hand - reserved`. Arranca con ~378 filas, no 21.772.

---

## VENTAS

### `customers` (988 filas reales)

| Columna | Tipo | Nulo | Descripción | Calidad medida | Índice |
|---|---|---|---|---|---|
| `legal_name` | `text` | no | legacy `nj` — hoy es la PK de facto | 100%, 0 duplicados | trgm |
| `trade_name` | `text` | sí | legacy `nc` | 97% | trgm |
| `tax_id` | `text` | sí | CUIT | 60% | UNIQUE parcial |
| `email_domains` | `text[]` | no `'{}'` | legacy `doms`. Asocia mails entrantes | — | GIN |
| `payment_terms` | `text` | sí | `30 DIAS F/F con ECHEQ` | | |
| `default_price_list_id` | `uuid` | sí | FK `price_lists` | | 🔑 |
| `discount_pct` | `numeric(5,2)` | sí | | | |
| `credit_limit` | `numeric(14,2)` | sí | | | 🔒 |
| `status` | `text` | no | `active` / `inactive` | | |

### `quotes` / `sales_orders` / `delivery_notes` / `sales_invoices`

Cabecera común:

| Columna | Tipo | Nulo | FK | Descripción | Índice | RLS |
|---|---|---|---|---|---|---|
| `doc_number` | `text` | no | — | `COT00123`. Secuencia por empresa y tipo | UNIQUE(company,doc_number) | |
| `customer_id` | `uuid` | no | `customers(id)` | **FK real. El legacy guarda el nombre** | (company,customer,issue_date DESC) | 🔑 |
| `contact_id` | `uuid` | sí | `customer_contacts(id)` | | | |
| `salesperson_id` | `uuid` | sí | `profiles(id)` | | (company,salesperson) | 🔑 |
| `issue_date` | `date` | no | — | **`date`, no `timestamptz`**: no tiene hora | | |
| `currency_code` | `text` | no | `currencies` | | | |
| `exchange_rate` | `numeric(14,6)` | sí | — | Congelado al emitir | | |
| `payment_terms` | `text` | sí | — | | | |
| `discount_pct` | `numeric(5,2)` | no | — | legacy `dtoGlobal` | | |
| `subtotal`, `tax_amount`, `total` | `numeric(14,2)` | no | — | **Se persisten**: congelados al emitir | | |
| `status` | `text` | no | — | Ver enums por documento | (company,status) | 🔑 |
| `notes`, `customer_reference`, `cost_center` | `text` | sí | — | | | |

Estados: **quotes** `draft·sent·accepted·rejected·expired·converted` ·
**sales_orders** `pending·partial·delivered·cancelled` ·
**delivery_notes** `pending·delivered·invoiced·cancelled` ·
**sales_invoices** `pending·paid·overdue·cancelled`

### `*_items` — líneas

| Columna | Tipo | Nulo | FK | Descripción | Índice |
|---|---|---|---|---|---|
| `position` | `integer` | no | — | **Orden estable.** El legacy usa el índice del array como identidad | (doc_id, position) |
| `line_type` | `text` | no | — | `item` \| `chapter` (separador de sección) | |
| `product_id` | `uuid` | **sí** | `products(id)` | `ON DELETE SET NULL`. Para analizar | (product_id) |
| `sku_snapshot` | `text` | sí | — | **Congelado** | |
| `name_snapshot` | `text` | sí | — | **Congelado** | |
| `description_snapshot` | `text` | sí | — | **Congelado** (puede editarse a mano) | |
| `quantity` | `numeric(14,3)` | sí | — | Nulo si `line_type='chapter'` | |
| `unit_price` | `numeric(14,4)` | sí | — | **Congelado** | |
| `discount_pct` | `numeric(5,2)` | sí | — | **Congelado** | |
| `tax_rate` | `numeric(5,2)` | sí | — | **Congelado**: la alícuota puede cambiar por ley | |
| `line_total` | `numeric(14,2)` | sí | — | | |

Específicos:

| Tabla | Columna | Descripción |
|---|---|---|
| `sales_order_items` | `quote_item_id` | FK a la línea de origen |
| `sales_order_items` | `delivered_qty` | **Por trigger. Reemplaza `ped.entregado[idx]`** |
| `delivery_note_items` | `sales_order_item_id` | **FK que hace confiables las parciales** |
| `sales_invoice_items` | `delivery_note_item_id` | Cadena hasta la factura |

---

## MANTENIMIENTO

### `assets`

| Columna | Tipo | Nulo | FK | Descripción | Índice |
|---|---|---|---|---|---|
| `customer_id` | `uuid` | no | `customers(id)` | **FK real. El legacy usa `clienteNombre` texto** | (company,customer) | 🔑 |
| `product_id` | `uuid` | sí | `products(id)` | Si el equipo está en el catálogo | |
| `serial_number` | `text` | sí | — | | UNIQUE parcial (company, serial) |
| `identifier` | `text` | sí | — | legacy `identificador` | |
| `warranty_start`, `warranty_end` | `date` | sí | — | | |
| `under_maintenance_contract` | `boolean` | no | — | legacy `sujetoMant` | |
| `next_preventive_date` | `date` | sí | — | | |

### `maintenance_orders`

Reemplaza los 36 campos de `mant_fichas`. Cabecera con estado y fechas;
las etapas van en `maintenance_order_steps`, los repuestos en
`maintenance_parts` y las mediciones en `maintenance_measurements` (el
legacy usa un array fijo de 10 posiciones).

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `asset_id` | `uuid` | no | FK `assets` |
| `service_type` | `text` | no | `corrective` \| `preventive` \| `warranty` |
| `assigned_technician_id` | `uuid` | sí | FK `profiles` 🔑 |
| `current_step` | `text` | no | `diagnosis·quote·repair·torque·closing` |
| `status` | `text` | no | `open·paused·waiting_approval·waiting_parts·repaired·closed·cancelled` |
| `torque_nominal`, `torque_lcl`, `torque_ucl` | `numeric` | sí | Parámetros de control |

---

## COMUNICACIONES

### `wa_messages` — append-only

| Columna | Tipo | Nulo | Descripción | Índice |
|---|---|---|---|---|
| `id` | `bigint` | no | Identity | PK |
| `conversation_id` | `uuid` | no | FK | (conversation_id, sent_at DESC) |
| `external_id` | `text` | sí | Id de Baileys. Evita duplicados | UNIQUE |
| `direction` | `text` | no | `in` \| `out` | |
| `body` | `text` | sí | | |
| `message_type` | `text` | no | `text·image·audio·video·document·location` | |
| `status` | `text` | no | `queued·sent·delivered·read·failed·draft` | |

> **Sin columna de media.** Los archivos van a Storage vía
> `wa_message_files`. El legacy guarda base64 en `suite_wa_media.datos`.

### `email_messages`

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `snippet` | `text` | sí | **≤ 300 chars. Lo único que lee la bandeja** |
| `body_text` | `text` | sí | Para buscar y para la IA |
| `body_html` | `text` | sí | **Sólo si ≤ 64 KB**, ya sanitizado |
| `body_html_path` | `text` | sí | Storage si supera el límite |
| `to_emails`, `cc_emails` | `text[]` | sí | El legacy guarda un `text` con comas |

---

## Tipos numéricos

| Uso | Tipo | Por qué |
|---|---|---|
| Importes | `numeric(14,2)` | **Nunca `float`**: el redondeo binario rompe totales |
| Precios unitarios | `numeric(14,4)` | 4 decimales para no perder precisión al prorratear |
| Cantidades | `numeric(14,3)` | Admite fracciones (metros, kg) |
| Porcentajes | `numeric(5,2)` | 0,00 a 999,99 |
| Tipo de cambio | `numeric(14,6)` | |
| Peso, volumen | `integer` | El legacy ya los guarda en gramos y cm³ |
