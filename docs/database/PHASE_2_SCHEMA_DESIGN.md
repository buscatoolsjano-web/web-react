# FASE 2 — Diseño del modelo de datos

> **Estado: PROPUESTA. Nada de esto fue ejecutado.**
> Cero tablas creadas, cero migraciones, cero datos insertados, cero RLS.
> El proyecto `uaxcfufvapzulqvynanp` sigue con el schema `public` vacío.

Fecha: 2026-09-08 · Basado en la auditoría del repo legacy real
(`buscatoolsjano-web/Buscatools`, commit `e074e79`), no del snapshot HTML.

---

## A. RESUMEN EJECUTIVO

### Qué se hizo

Se auditó el código fuente real del legacy y se midieron los datos reales:
21.772 productos, 988 clientes y 142 proveedores. De ahí salen las
decisiones de este documento — no de suposiciones.

### Los cinco hallazgos que definen el diseño

**1. No hay claves foráneas. Todo se relaciona por texto.**
`pedido.cliente` guarda el *nombre* del cliente (`"Nordex"`), no un id.
Lo mismo en cotizaciones, notas de entrega, facturas y activos de
mantenimiento (`activo.clienteNombre`). Renombrar un cliente rompe su
historial. **El modelo nuevo usa FKs reales en todas partes.**

**2. Las entregas parciales se rastrean por índice de array.**

```js
ped.entregado[idx] = ya + qtyAhora;   // idx = posición en el array de items
```

Reordenar o borrar una línea de un pedido corrompe silenciosamente lo ya
entregado. **El modelo nuevo da id propio a cada línea y liga
`delivery_note_items.sales_order_item_id`.**

**3. El catálogo tiene 55 campos con distribución muy desigual.** Sólo 11
superan el 80% de llenado y 30 están por debajo del 10%. Modelarlos todos
como columnas daría 30 columnas casi vacías; meterlos todos en JSONB
haría imposible filtrar. La estrategia híbrida está en la sección F, con
los porcentajes medidos.

**4. El stock se guarda como número pisable y el kardex se trunca.**
`stock = base + delta`, con los deltas en localStorage, y el kardex corta
a 5.000 entradas (`k.splice(5000)`) — se pierde historial. Dato relevante:
**sólo 378 de 21.772 productos tienen stock > 0**, así que una tabla de
saldos es diminuta y los movimientos son el registro real.

**5. La seguridad actual no existe.** RLS es un token compartido
hardcodeado en el JS; las contraseñas son SHA-256 sin salt sincronizadas a
una tabla legible por cualquiera; la política de `erp_emails` incluye un
`FOR INSERT WITH CHECK (true)` totalmente abierto. **Nada de esto se
migra.**

### Forma de la propuesta

**38 tablas** en 7 dominios. Ninguna tabla de negocio sin `company_id`
ni sin RLS.

| Dominio | Tablas |
|---|---|
| Core (identidad, empresas, permisos, archivos, auditoría) | 10 |
| Catálogo | 8 |
| Stock y precios | 6 |
| Ventas | 8 |
| Compras | 5 |
| Mantenimiento | 5 |
| Comunicaciones (WhatsApp, email) | 6 |

### Lo que este documento decide

| Tema | Decisión | Dónde |
|---|---|---|
| Multiempresa | `company_id` en toda tabla + RLS por `company_memberships` | D |
| Roles | Rol **por membresía** + `role_permissions` + overrides puntuales | E |
| Atributos de producto | Híbrido: 15 columnas reales + `attributes jsonb` con registro de claves | F |
| Stock | Movimientos como verdad + saldo persistido por trigger | G |
| Precios | Listas de precios, nunca columnas fijas en `products` | H |
| Ítems de documento | Snapshot de sku/nombre/precio + FK al producto | J |
| Trazabilidad de documentos | FKs directas + enlace **a nivel de línea** | J |
| Archivos | Tabla `files` + tablas de enlace por dominio (no polimórfico) | O |
| Auditoría | Diff por campo, sólo acciones de negocio | P |
| IDs | UUID v4 en entidades; `bigint` en tablas append-only de alto volumen | T |
| Enums | `text` + `CHECK` (no `ENUM` de Postgres) | V |

### Lo que NO se hace ahora

No se crean tablas, no se escribe RLS, no se migra un solo registro.
Todo eso es Fase 2B, y sólo con tu aprobación.

---

## B. ENTIDADES IDENTIFICADAS EN EL LEGACY

Extraídas de `app.js` (45.345 líneas) y de los datos reales del repo.

### B.1 Colecciones en `localStorage` (sincronizadas a `erp_store`)

| Clave legacy | Contenido | Volumen real |
|---|---|---|
| `erp_cotizaciones` | Cotizaciones | — (no hay datos en el repo) |
| `erp_pedidos` | Pedidos de venta | — |
| `erp_notas_entrega` | Notas de entrega | — |
| `erp_facturas` | Facturas de venta | — |
| `erp_clientes` / `clientes-data` | Clientes | **988** |
| `buscatools_clientes_extra` | Campos extra de cliente | — |
| `erp_contactos` | Personas de contacto | — |
| `erp_proveedores` / `proveedores-data` | Proveedores | **142** |
| `erp_pedidos_compra` | Órdenes de compra | — |
| `erp_notas_proveedor` | NE de proveedor | — |
| `erp_facturas_proveedor` | Facturas de proveedor | — |
| `productos-data.json` | Catálogo | **21.772** |
| `erp_producto_overrides` | Overrides de precio/stock por SKU | — |
| `erp_kardex` | Movimientos de stock (**tope 5.000**) | — |
| `_erp_stok` / `_erp_stok_u` | Deltas de stock | — |
| `mant_fichas` | Órdenes de servicio | — |
| `mant_activos` | Equipos del cliente | — |
| `mant_clientes`, `mant_marcas`, `mant_repuestos`, `mant_lotes`, `mant_manuales`, `mant_historico` | Auxiliares de mantenimiento | — |
| `erp_auth_users`, `erp_client_accounts` | **Usuarios + hashes SHA-256** | — |
| `erp_user_perms` | Permisos por usuario | — |
| `erp_trazabilidad_log`, `erp_activity_log` | Logs | — |
| `erp_eventos` | Agenda | — |
| `erp_mensajes`, `erp_chat_messages`, `erp_chat_groups` | Chat interno | — |
| `erp_client_leads`, `erp_client_solicitudes`, `erp_client_carrito` | CRM / portal cliente | — |
| `erp_attachments` | Adjuntos (base64) | — |
| `imp_items_v1`, `imp_params_v1`, `imp_mode_v1` | Calculadora de importación | — |
| `erp_empresas_override` | Datos de empresas | 3 empresas |

### B.2 Tablas ya existentes en el Supabase legacy

Del DDL encontrado en los archivos de migración del legacy:

- `suite_wa_estado`, `suite_wa_conversaciones`, `suite_wa_mensajes`,
  `suite_wa_media` (**`datos text` = base64**)
- `erp_emails` (con `body_html` completo y `attachments jsonb`)
- `erp_email_rules`, `erp_ai_conversations`, `erp_ai_memory`,
  `erp_activity_log`, `erp_store`

Además, el legacy ya empujaba a un modelo relacional por RPC —
`sync_customer`, `sync_cotizacion`, `sync_pedido`, `sync_nota_entrega`,
`sync_kardex` — con `p_org_id` y `p_warehouse_id` fijos. Es un intento
previo de normalización: confirma la dirección, y de ahí se toma
vocabulario (`org`, `warehouse`, saldos antes/después).

### B.3 Estructuras reales extraídas del código

**Documento de venta** (cotización/pedido/NE/factura comparten forma):

```js
{ ref, fromCotizacion|fromPedido|fromNE, cliente /* STRING */, titulo,
  fecha, formaPago, iva /* bool */, iibb /* bool */, dtoGlobal,
  contacto, contactos[], items[], base, ivaAmount, total, uds,
  estado, convertidaA, entregado /* {idx: qty} */, creadoPor, created,
  updated, facturaRef, fechaVencimiento, paidDate, moneda }
```

**Ítem de documento:**

```js
{ sku, nombre, desc, qty, price, dto, subtotal,
  type /* 'chapter' = separador de sección */,
  esKit, componentes: [{sku, qty}] }
```

**Entrada de kardex:**

```js
{ id, sku, nombre, fecha, tipo /* egreso|ingreso|ajuste */,
  doc, qty /* con signo */, kind /* sv|sr */, saldo_sv, saldo_sr, user }
```

**Ficha de mantenimiento** (`SVC-<timestamp>`) — 36 campos:

```js
{ id, ref, activoId, tipoServicio, tecnico, recepcionadoPor,
  fechaIngreso, fechaReparacion, fechaEntrega, fechaAprobacion,
  createdAt, updatedAt, pausada, pausadaAt, lastStep,
  motivoIngreso, condicionVisual, aprietesIngreso, obsDiagnostico,
  diagnosticoPartes {}, reparacionPartes {}, trabajosRealizados,
  cotItems [{desc, tipo, cant, pu}], cotMoneda, cotContacto,
  nroCotizacion, estadoCotizacion, obsCotizacion, aprobadoPor,
  torqueMediciones [10x{min,max,target}], torqueNominal, torqueLci,
  torqueLcs, eficienciaGeneral, tecnicoReparacion, tiempoRealHs,
  piezasPendientes, proximoPreventivo, estadoFinal, observacionesFinales }
```

**Activo (equipo del cliente):**

```js
{ id: 'ACTIVO-<ts>', createdAt, serviciosCount, productoSku,
  identificador, marca, modelo, tipo, serie,
  clienteNombre /* STRING */, ciudad, provincia,
  garantiaInicio, garantiaFin, sujetoMant }
```

**Cliente** (988 registros medidos):

```js
{ ref: 'CLI00719', nj /* razón social — actúa de PK */, nc /* nombre
  comercial */, cif /* CUIT */, emails[], doms[] /* dominios de mail */,
  nj_n, nc_n /* normalizados para buscar */ }
```

Calidad medida: 0 `nj` duplicados · 877/988 (89%) con email ·
592/988 (60%) con CUIT · 958/988 (97%) con nombre comercial.

**Proveedor** (142 registros): `ref, nj, nc, cif, tel, email, direccion,
actividad, agente, formaPago, notas`.

### B.4 Estados y enumeraciones reales

| Entidad | Estados encontrados |
|---|---|
| Cotización | `borrador`, `pendiente`, `cerrada`, `rechazada` |
| Pedido | `pendiente`, `parcial`, `entregado`, `cancelado` |
| Nota de entrega | `pendiente`, `cerrada`, `facturada`, `cancelada` |
| Factura | `pendiente`, pagada (vía `paidDate`) |
| Kardex | `ingreso`, `egreso`, `ajuste` — con `kind` `sr`/`sv` |
| Ficha mant. | `estadoCotizacion: PENDIENTE`, `estadoFinal`, `pausada` |
| Servicio mant. | `CORRECTIVO` (+ preventivo implícito) |
| WhatsApp conv. | `abierta`, `cerrada`; `ia_modo`: `off`/`borrador`/`auto` |
| WhatsApp msg | `enviando`, `pendiente`, `entregado`, `error`, `borrador` |
| Email | `nuevo`, `asignado`, `en_proceso`, `respondido`, `archivado` |
| Rol usuario | `ADMIN`, equipo (implícito), `cliente` |

### B.5 Campos calculados que hoy se persisten

`base`, `ivaAmount`, `total`, `uds` en cada documento; `subtotal` en cada
línea; `serviciosCount` en el activo; `saldo_sr`/`saldo_sv` en kardex;
`s` en producto (cadena de búsqueda pre-armada); `nj_n`/`nc_n` en cliente.

Se recalculan y persisten a mano en varios lugares, y pueden divergir.
En el modelo nuevo: **totales de documento sí se persisten** (deben quedar
congelados al emitir), **saldos y cadenas de búsqueda no** (se derivan).

---

## C. MAPA LEGACY → NUEVO MODELO

Leyenda: **M** migrar · **T** transformar · **N** no migrar · **A** archivar

### C.1 Clientes

| Legacy | Nuevo | Acción | Nota |
|---|---|---|---|
| `clientes-data[].ref` | `customers.legacy_ref` | M | Se conserva para trazar la migración |
| `.nj` | `customers.legal_name` | M | Hoy es la clave real. Pasa a ser un campo más |
| `.nc` | `customers.trade_name` | M | 97% presente |
| `.cif` | `customers.tax_id` | T | Normalizar formato CUIT |
| `.emails[]` | `customer_contacts.email` | T | Array → filas |
| `.doms[]` | `customers.email_domains text[]` | M | Se usa para asociar mails entrantes |
| `.nj_n`, `.nc_n` | — | N | Reemplazados por `search_vector` |
| `clientes_extra{}` | columnas de `customers` + `customer_addresses` | T | Se aplana |
| `erp_contactos` | `customer_contacts` | M | — |
| `doc.cliente` (texto) | `*.customer_id` (FK) | **T** | **Resolución por nombre. El paso más delicado de toda la migración** |

### C.2 Catálogo

| Legacy | Nuevo | Acción |
|---|---|---|
| `sku` | `products.sku` | M (clave natural, 0 duplicados) |
| `nombre` | `products.name` | M |
| `base` | `products.model_code` | M |
| `marca` (75%) | `brands.name` → `products.brand_id` | T |
| `cat` (100%) | `product_categories` → `category_id` | T |
| `tipo` (42%) | `products.product_type` | M |
| `serie` (42%) | `products.series` | M |
| `desc`, `descl` | `products.description`, `.description_long` | M |
| `peso_g`, `volumen_cm3` | columnas | M |
| `ncm` (24%) | `products.ncm_code` | M |
| `origen` (40%) | `products.origin_country` | T (normalizar a ISO) |
| `imgs[]` (35%) | `files` + `product_files` | T (URLs externas; se difiere la descarga) |
| `encastre`, `largo`, `medida`, `sufijos`, `min_kg`, `max_kg`, `rpm`, `torq_*`, `voltaje`, `carcasa`, … | `products.attributes jsonb` | T |
| `sim_sp`, `sim_tc`, `sim_cp`, `sim_ir` | `product_equivalences` | T |
| `pu` (77%) | `product_prices` (lista base, USD) | T |
| `costo` (1%), `fob_eur` | `product_costs` | T |
| `sr`, `sv` (83%) | `stock_movements` (asiento de apertura) + `stock_balances` | T |
| `esKit`, `componentes[]` | `product_components` | T |
| `s` | `products.search_vector` | N (se regenera) |
| `_importOrigen`, `_apex*` | — | **N** (metadatos de importación, no de negocio) |
| `catalogo_id`, `catalogo_pagina` | `attributes` | M |

### C.3 Ventas

| Legacy | Nuevo | Acción |
|---|---|---|
| `erp_cotizaciones[]` | `quotes` + `quote_items` | M |
| `erp_pedidos[]` | `sales_orders` + `sales_order_items` | M |
| `erp_notas_entrega[]` | `delivery_notes` + `delivery_note_items` | M |
| `erp_facturas[]` | `sales_invoices` + `sales_invoice_items` | M |
| `.ref` | `.doc_number` (+ `legacy_ref`) | M |
| `.fromCotizacion`, `.fromPedido`, `.fromNE` | FK directa | T |
| `.convertidaA` | — | N (derivable de la FK inversa) |
| `.entregado{idx:qty}` | `sales_order_items.delivered_qty` | **T (corrige el bug del índice)** |
| `.items[].type='chapter'` | `*_items.line_type='chapter'` | M |
| `.items[]` campos | snapshot + `product_id` | T |
| `.iva` bool / `.iibb` bool | `tax_rate numeric` + `applies_iibb` | T |
| `.base`, `.ivaAmount`, `.total`, `.uds` | columnas persistidas | M |
| `.creadoPor` (texto) | `created_by uuid` FK a `profiles` | T |
| `.created`/`.updated` (epoch ms) | `created_at`/`updated_at timestamptz` | T |

### C.4 Compras, mantenimiento, comunicaciones

| Legacy | Nuevo | Acción |
|---|---|---|
| `erp_proveedores` | `suppliers` | M |
| `erp_pedidos_compra` | `purchase_orders` + `purchase_order_items` | M |
| `erp_notas_proveedor` | `purchase_receipts` + items | M |
| `erp_facturas_proveedor` | `supplier_invoices` | M |
| `mant_activos` | `assets` | M |
| `.clienteNombre` | `assets.customer_id` (FK) | **T** |
| `mant_fichas` | `maintenance_orders` + `maintenance_order_steps` | T |
| `.cotItems[]` | `maintenance_quote_items` | T |
| `.torqueMediciones[10]` | `maintenance_measurements` | T |
| `.diagnosticoPartes{}`, `.reparacionPartes{}` | `maintenance_parts` | T |
| `mant_historico` | `maintenance_orders` cerradas | T |
| `suite_wa_conversaciones` | `wa_conversations` | M |
| `suite_wa_mensajes` | `wa_messages` | M |
| `suite_wa_media.datos` (base64) | **Storage** + `files` | **T** |
| `erp_emails` | `email_threads` + `email_messages` | T |
| `.attachments jsonb` | Storage + `email_attachments` | T |
| `erp_auth_users`, hashes | — | **N** (Supabase Auth) |
| `erp_user_perms` | `company_memberships` + permisos | T (rediseño) |
| `erp_trazabilidad_log`, `erp_activity_log` | — | **N** |
| `erp_store` | — | **N** |
| `erp_attachments` (base64) | Storage | T |

---

## D. MODELO MULTIEMPRESA

### Decisión

`company_id uuid NOT NULL` en **toda** tabla de negocio, y el filtrado lo
hace RLS, no el código de la aplicación.

```
companies ──< company_memberships >── profiles ──1:1── auth.users
```

La clave es una función auxiliar:

```sql
-- STABLE: Postgres la evalúa una vez por consulta, no una vez por fila.
CREATE FUNCTION app.current_company_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT coalesce(array_agg(company_id), '{}')
  FROM public.company_memberships
  WHERE user_id = auth.uid() AND status = 'active';
$$;
```

Toda política empieza por `company_id = ANY(app.current_company_ids())`.
Un `SELECT * FROM products` sin filtro ya vuelve filtrado por la base.

### Por qué así y no de otra forma

| Alternativa | Por qué no |
|---|---|
| Un proyecto Supabase por empresa | Se multiplica la infraestructura; imposible que un usuario opere en dos empresas |
| Un schema por empresa | Migraciones ×N; consultas entre empresas imposibles |
| Filtrar en el frontend | Es exactamente el error del legacy (`_ekey()`): depende de que nadie se olvide |

**Riesgo asumido:** olvidar `company_id` en una tabla nueva la deja sin
aislamiento. **Mitigación:** un test automatizado que recorra
`information_schema` y falle si una tabla de negocio no tiene `company_id`
o no tiene RLS activo.

### Empresas iniciales

Buscatools, Torquetools, GAS. La primera con datos reales; las otras dos
existen en el legacy sin datos cargados.

---

## E. AUTH / PROFILES / MEMBERSHIPS / ROLES

### La pregunta que planteaste

> ¿(A) rol por membresía, (B) roles separados + membership_role, o
> (C) permisos directos por membresía?

### Recomendación: **A + tabla de permisos por rol**

```
profiles (1:1 con auth.users)
   │
   └──< company_memberships (user_id, company_id, role, ...)
                                            │
                          role_permissions (role, permission)
                                            │
              membership_permissions (membership_id, permission, granted)
                                     ← sólo excepciones puntuales
```

- El **rol vive en la membresía**: un usuario es ADMIN en Buscatools y
  VENDEDOR en Torquetools sin duplicarse. Cumple tu requisito literal.
- `role_permissions` es una tabla semilla que define qué puede cada rol.
  Cambiar un permiso de rol se hace con un `INSERT`, no con un deploy.
- `membership_permissions` cubre la excepción ("este vendedor además ve
  Compras") sin inventar un rol nuevo por cada caso.

| Opción | Por qué no se eligió |
|---|---|
| **B** — roles N:N por membresía | Un usuario con 3 roles a la vez vuelve indecidible qué gana; nadie pidió eso |
| **C** — sólo permisos por membresía | Sin roles, alta de usuario = marcar 40 permisos a mano. Se degrada rápido |

**Riesgo:** las excepciones de `membership_permissions` pueden proliferar
hasta volverse el sistema real. **Mitigación:** si un mismo conjunto de
excepciones aparece 3+ veces, se crea un rol.

### Roles iniciales

| Rol | Alcance |
|---|---|
| `admin` | Todo dentro de sus empresas |
| `employee` | Según permisos |
| `salesperson` | Sus clientes y sus documentos |
| `technician` | Mantenimientos asignados |
| `distributor` | Catálogo permitido, sus pedidos, su lista de precios |
| `customer` | Sus propios documentos y equipos |
| `supplier` | *(preparado, inactivo)* |

Los tres últimos son **usuarios externos**: sus políticas son las más
restrictivas y las que hay que probar primero.

### Vínculo con entidades de negocio

Un usuario externo necesita saber *qué* cliente o distribuidor es:

```
company_memberships.customer_id  → customers(id)   -- si role IN (customer, distributor)
company_memberships.supplier_id  → suppliers(id)   -- si role = supplier
```

Con un `CHECK` que obligue a que esté presente para esos roles y ausente
para los internos. Sin esto, "un cliente ve sólo sus pedidos" no se puede
escribir.

---

## F. CATÁLOGO

### La evidencia (21.772 productos, llenado por valor no vacío)

| Franja | Campos |
|---|---|
| **>80%** (11) | `sku` 100 · `base` 100 · `nombre` 100 · `cat` 100 · `s` 100 · `peso_g` 100 · `volumen_cm3` 100 · `desc` 100 · `descl` 99,7 · `sr` 83 · `sv` 83 |
| **50-80%** (3) | `pu` 76,9 · `marca` 74,9 · `_importOrigen` 57,8 |
| **10-50%** (11) | `tipo` 42,2 · `serie` 41,7 · `origen` 40,5 · `encastre` 38,7 · `largo` 35,7 · `imgs` 34,6 · `ncm` 24,5 · `medida` 21,8 · `_apexFamilyTitle` 16,3 · `_apexPageCatalog` 16,3 · `sufijos` 15,2 |
| **<10%** (30) | `sim_sp` 7,8 · `modelo` 2,4 · `min_kg`/`max_kg`/`longitud`/`carcasa` 1,7 · `costo` 1,1 · `torq_min`/`torq_max` 0,8 · `rpm` 0,3 · `voltaje` 0,2 · … |

Cardinalidades: 25 marcas · 8 categorías · 41 tipos · 159 series ·
512 modelos · 35 encastres · 6 orígenes. **0 SKUs duplicados.**

### Decisión: híbrido, con la línea en ~35% + criterio de negocio

**Columnas reales** (15): se filtran, se ordenan o son críticas.

`id · company_id · sku · name · description · description_long ·
brand_id · category_id · model_code · product_type · series ·
origin_country · ncm_code · weight_g · volume_cm3 · status ·
search_vector · legacy_ref · timestamps`

`product_type` (42%) y `series` (42%) se promueven pese a estar por
debajo del 50%: son los **filtros principales del catálogo** en la UI
legacy. `ncm_code` (24%) y `origin_country` (40%) también, porque los
consume el módulo de Importación.

**`attributes jsonb`** para el resto: `encastre`, `largo`, `medida`,
`sufijos`, `min_kg`, `max_kg`, `carcasa`, `rpm`, `torq_min`, `torq_max`,
`voltaje`, `alimentacion`, `ergonomia`, `dim_caja`, `eslinga`,
`catalogo_id`, `catalogo_pagina`…

**El JSONB no es un vertedero.** Va acompañado de:

```
product_attribute_definitions (key, label, data_type, unit,
                               applies_to_category_id, is_filterable)
```

Un `CHECK` valida que toda clave usada esté declarada. Así se sabe qué
significa cada atributo, se puede construir la UI de filtros y se puede
promover a columna cuando uno crezca.

**Descartados:** `s` (→ `search_vector`), `_importOrigen`, `_apexPageCatalog`,
`_apexFamilyTitle`, `_apexEnriquecido` (metadatos del proceso de importación).

**A tabla propia:** `sim_sp`/`sim_tc`/`sim_cp`/`sim_ir` → `product_equivalences`
(equivalencias con SKU de la competencia: es una funcionalidad, no un atributo).

### Marcas, categorías y modelos (2F)

| Entidad | Decisión | Por qué |
|---|---|---|
| `brands` | **Tabla** | 25 valores, con logo y datos propios. **5.456 productos (25%) no tienen marca** → `brand_id` nullable |
| `product_categories` | **Tabla, con jerarquía** (`parent_id`) | 8 valores, pero **12.588 productos caen en `otros`** — la taxonomía hay que rehacerla, y con tabla se puede sin tocar código |
| `model` | **Columna de texto** (`model_code`) | 512 valores casi únicos por producto. Una tabla `product_models` sería una fila por producto: normalizar por normalizar |

`product_models` **no se crea.** Si algún día hace falta agrupar variantes
(mismo modelo, distinta medida), la agrupación natural es `model_code` +
`brand_id`, y recién ahí se evalúa una tabla `product_families`.

### Kits

`product_components (parent_product_id, component_product_id, quantity)`.
El legacy los resuelve con `esKit` + `componentes[]` embebido y expande al
descontar stock. Con tabla propia se pueden consultar los kits que
contienen un componente — hoy imposible.

---

## G. STOCK

### Decisión: movimientos como verdad + saldo persistido por trigger

```
warehouses
stock_movements   (append-only, bigint, la fuente de verdad)
stock_balances    (product_id + warehouse_id → on_hand, reserved)
stock_reservations
```

**Por qué saldo persistido y no vista calculada:**

| Opción | Ventaja | Desventaja | Veredicto |
|---|---|---|---|
| Saldo calculado al vuelo | Siempre consistente | `SUM()` sobre millones de filas por cada listado | ❌ |
| Vista materializada | Consulta rápida | Refresco periódico = saldo desactualizado | ❌ para stock |
| **Saldo persistido + trigger** | Lectura O(1), consistente en la misma transacción | El trigger debe ser correcto | ✅ |

Refuerzo de consistencia: un job de verificación compara
`SUM(movements)` contra `stock_balances` y alerta si divergen. Y el saldo
**sólo** se modifica por trigger — nunca con un `UPDATE` a mano.

**Dato que lo hace barato:** sólo 378 de 21.772 productos tienen stock.
`stock_balances` arranca con cientos de filas, no con 21.772.

### Tipos de movimiento

`purchase_receipt · sale_delivery · adjustment · transfer_in ·
transfer_out · return_in · return_out · opening_balance ·
production_in · production_out`

Reservas **no** son movimientos: viven en `stock_reservations` y afectan
`reserved`, no `on_hand`. Así:

```
disponible = on_hand - reserved
proyectado = disponible + (en camino de compras confirmadas)
```

Esto reemplaza el `sr`/`sv` del legacy con significado explícito: hoy
"virtual" mezcla reservado con proyectado y nadie puede explicar el número.

**Trazabilidad:** cada movimiento guarda `source_type` + `source_id`
(qué documento lo generó) y `created_by`. El legacy guarda sólo un texto
`doc` y trunca a 5.000 entradas.

---

## H. PRECIOS

### Decisión: listas de precios, nunca columnas fijas

```
currencies              (ARS, USD, EUR)
price_lists             (nombre, moneda, vigencia, es_default)
product_prices          (price_list_id, product_id, amount, valid_from, valid_to)
customer_price_lists    (customer_id → price_list_id)
product_costs           (product_id, supplier_id, cost, currency, fecha)
```

Precio aplicable a un cliente:

1. precio especial vigente para ese cliente y producto;
2. si no, la lista asignada al cliente;
3. si no, la lista por defecto de la empresa.

**Por qué no columnas** (`price_list`, `price_distributor`, `price_special`…):
cada nuevo tipo de precio sería una migración, no hay historial, no hay
vigencias, y no se puede tener una lista por distribuidor. Con 21.772
productos y varios distribuidores, es cuestión de tiempo.

**Los costos van aparte** (`product_costs`), no en `products`, por una
razón de seguridad: un distribuidor con acceso al catálogo **no debe ver
el costo**. Separar la tabla hace que eso sea una política RLS y no un
`SELECT` cuidadoso.

Historial: `product_prices` con `valid_from`/`valid_to` **es** el
historial. No hace falta `price_history` aparte.

---

## I. CLIENTES

```
customers               (legal_name, trade_name, tax_id, email_domains[], ...)
customer_contacts       (nombre, cargo, email, teléfono, es_principal)
customer_addresses      (tipo: fiscal|entrega, calle, ciudad, provincia, país)
customer_sales_reps     (customer_id, profile_id)   -- vendedores asignados
```

Cuatro tablas, no una gigante, porque los datos reales lo piden: emails
llegan como array (`emails[]`), un cliente tiene domicilio fiscal y
domicilios de entrega distintos, y `erp_contactos` ya existe como
colección separada.

**Condiciones comerciales** (`payment_terms`, `default_price_list_id`,
`default_currency`, `credit_limit`, `discount_pct`) van **como columnas de
`customers`**: son una por cliente, no una lista.

**`customer_company_links` no se crea.** Un cliente pertenece a una
empresa (`company_id`). Si el mismo cliente real opera con Buscatools y
con Torquetools, son dos filas — con condiciones y precios distintos, que
es justamente lo correcto.

---

## J. VENTAS

```
quotes ──< quote_items
   │
sales_orders ──< sales_order_items
   │
delivery_notes ──< delivery_note_items
   │
sales_invoices ──< sales_invoice_items
```

Cabecera común: `company_id · doc_number · customer_id · contact_id ·
salesperson_id · issue_date · due_date · currency_code · exchange_rate ·
payment_terms · status · discount_pct · subtotal · tax_amount · total ·
notes · customer_reference · cost_center · created_by · timestamps ·
deleted_at · legacy_ref`

### Snapshots: qué se congela y qué no

Ésta es la pregunta que hiciste, y la respuesta tiene una regla simple:

> **Se congela todo lo que se imprimió en el documento. Se referencia
> todo lo que sirve para analizar.**

| Campo de la línea | Tipo | Por qué |
|---|---|---|
| `product_id` | **FK** (nullable) | Para agrupar ventas por producto. `ON DELETE SET NULL` |
| `sku_snapshot` | **Snapshot** | El SKU puede cambiar; el documento emitido no |
| `name_snapshot` | **Snapshot** | Idem |
| `description_snapshot` | **Snapshot** | Puede haberse editado a mano en el documento |
| `unit_price` | **Snapshot** | Obligatorio: el precio de lista cambia |
| `currency_code` | **Snapshot** | — |
| `discount_pct` | **Snapshot** | — |
| `tax_rate` | **Snapshot** | La alícuota puede cambiar por ley |
| `quantity`, `line_total` | Dato propio | — |
| `line_type` | `item` \| `chapter` | El legacy ya usa capítulos como separadores |
| `position` | Orden | **Estable, independiente del array** |

Si el producto se borra, la línea sobrevive con su snapshot: el documento
histórico sigue siendo legible. Es exactamente lo que el legacy logra por
accidente (guarda todo desnormalizado) y acá se hace a propósito, sin
perder la capacidad de analizar.

### Conversión entre documentos (2J)

**Decisión: FKs directas + enlace a nivel de línea. Sin tabla polimórfica
`document_links`.**

```sql
sales_orders.quote_id          → quotes(id)
delivery_notes.sales_order_id  → sales_orders(id)
sales_invoices.delivery_note_id→ delivery_notes(id)

delivery_note_items.sales_order_item_id → sales_order_items(id)  -- ★
sales_order_items.quote_item_id         → quote_items(id)
```

★ **es la corrección del bug del índice.** Cada línea entregada apunta a
la línea del pedido que la origina, así:

```sql
-- cuánto falta entregar de cada línea (no depende de posiciones)
SELECT soi.id, soi.quantity - coalesce(sum(dni.quantity), 0) AS pendiente
FROM sales_order_items soi
LEFT JOIN delivery_note_items dni ON dni.sales_order_item_id = soi.id
GROUP BY soi.id;
```

Y `sales_order_items.delivered_qty` se mantiene por trigger para no
recalcular en cada listado.

Los tres requisitos que planteaste quedan cubiertos:

- *una cotización genera varios pedidos* → varios `sales_orders` con el
  mismo `quote_id`;
- *un pedido con entregas parciales* → varias `delivery_notes` con el
  mismo `sales_order_id`;
- *una NE cubre parte de un pedido* → las líneas apuntan a las líneas del
  pedido, con cantidad propia.

**Por qué no `document_links` polimórfico:** sin FK real, sin cascada,
sin integridad, y las consultas necesitan un `CASE` por tipo. La cadena
comercial es fija (cotización → pedido → NE → factura) y se conoce de
antemano; no hay grafo arbitrario que justifique el costo.

---

## K. COMPRAS

```
suppliers ──< purchase_orders ──< purchase_order_items
                    │
                    └──< purchase_receipts ──< purchase_receipt_items
supplier_invoices
supplier_payments
```

Misma lógica que ventas: snapshots en las líneas, recepciones parciales
por línea (`purchase_receipt_items.purchase_order_item_id`), y
`received_qty` mantenido por trigger.

Campos propios de compras: `eta_date`, `confirmed_at`,
`incoterm`, `freight_cost`, `customs_cost`, `landed_cost` — que alimentan
el módulo de Importación (la calculadora Europa→Argentina del legacy).

Cada `purchase_receipt` confirmado genera movimientos
`purchase_receipt` en `stock_movements`.

---

## L. MANTENIMIENTO

```
assets ──< maintenance_orders ──< maintenance_order_steps
                   │              maintenance_parts
                   │              maintenance_measurements
                   └──< maintenance_files (→ files)
```

`assets`: `customer_id` **FK real** (el legacy usa `clienteNombre` texto),
`product_id` opcional (el activo suele ser un producto del catálogo),
`serial_number`, `brand_id`, `model`, `location_city`, `location_state`,
`warranty_start`, `warranty_end`, `under_maintenance_contract`.

**`asset_serials` no se crea**: en los datos reales un activo *es* una
unidad con un número de serie. Una tabla aparte sólo tendría sentido si un
activo agrupara varias unidades, y no hay evidencia de eso.

La ficha legacy tiene 36 campos que mezclan cinco etapas
(diagnóstico → cotización → reparación → torque → cierre). Se separa:

- `maintenance_orders`: cabecera y estado actual.
- `maintenance_order_steps`: una fila por etapa, con sus datos, quién y
  cuándo. Reemplaza `lastStep` + los `fechaX` sueltos, y da historial real.
- `maintenance_parts`: reemplaza `diagnosticoPartes{}` y
  `reparacionPartes{}` (objetos sin forma), ligando a `product_id` cuando
  el repuesto está en el catálogo.
- `maintenance_measurements`: reemplaza el array fijo de 10
  `torqueMediciones` — que hoy siempre ocupa 10 lugares aunque se usen 2.

Preguntas que el modelo responde: qué equipo tiene el cliente
(`assets.customer_id`), cuándo se vendió (vía `delivery_note_items` →
`product_id` + serie), historial (`maintenance_orders` por `asset_id`),
técnico (`assigned_technician_id`), repuestos (`maintenance_parts`),
fotos y videos (`files`), garantía (`warranty_end`), próxima acción
(`next_preventive_date`).

---

## M. WHATSAPP

```
wa_accounts        (varias líneas — el legacy tiene 'linea' fija en 'default')
wa_conversations   (por chat_id, con customer_id y assigned_to reales)
wa_messages        (bigint, append-only)
wa_conversation_assignments  (historial de asignaciones)
```

Cambios respecto del legacy:

| Legacy | Nuevo |
|---|---|
| `linea text default 'default'` | `wa_account_id` FK → varios números |
| `cli_ref`, `cli_nombre`, `cli_tipo` (texto) | `customer_id` / `supplier_id` FK |
| `asignado text` | `assigned_to uuid` → `profiles` |
| `suite_wa_media.datos` **base64** | **Supabase Storage** + `files` |
| `no_leidos` en la conversación | Se mantiene (es un contador legítimo, por trigger) |

`wa_participants` **no se crea todavía**: hoy toda conversación es 1:1 con
un teléfono. Se agrega cuando haya grupos, sin romper nada.

Realtime sólo acá y en notificaciones (ADR-006), con actualización del
registro — nunca refetch total.

---

## N. EMAILS

```
email_accounts   ──< email_threads ──< email_messages ──< email_attachments
```

### La pregunta del `body_html`

El legacy guarda `body_text` **y** `body_html` completos en la fila.
El HTML de un mail con firma corporativa e imágenes embebidas ronda
100-500 KB; cada listado de bandeja que haga `SELECT *` los arrastra.

**Decisión:**

| Campo | Dónde |
|---|---|
| `snippet` (≤ 300 chars) | Columna — es lo único que necesita la lista |
| `body_text` | Columna — se usa para buscar y para la IA |
| `body_html` | Columna **sólo si ≤ 64 KB**; si es mayor, a Storage y se guarda `body_html_path` |
| adjuntos | **Siempre** Storage. Nunca base64 |

Sanitización: el HTML se limpia (sin `<script>`, sin `<iframe>`, sin
handlers `on*`) **antes** de guardarlo, no al mostrarlo. Se guarda limpio
una vez en vez de limpiarlo en cada render, y una fila envenenada no puede
atacar a otro cliente después.

La lista de bandeja nunca selecciona `body_*`: sólo
`id, subject, from_name, snippet, date, status, assigned_to`.

---

## O. ARCHIVOS

### La pregunta: ¿polimórfico o no?

```
files (id, company_id, bucket, path, mime_type, size_bytes,
       checksum, uploaded_by, created_at, deleted_at)
```

Hasta acá no hay discusión. La pregunta es cómo se liga a las entidades.

| Opción | Ventajas | Desventajas |
|---|---|---|
| **A. Polimórfico** — `file_links(file_id, entity_type, entity_id)` | Una tabla; agregar un dominio no cuesta nada | **Postgres no puede validar la FK.** Un `entity_id` puede apuntar a nada. Sin cascada: borrar un producto deja enlaces huérfanos. Los índices son menos selectivos |
| **B. Tablas de enlace por dominio** — `product_files`, `maintenance_files`, … | FK real, `ON DELETE CASCADE`, índices ajustados, se lee el schema y se entiende | ~6 tablas pequeñas; agregar un dominio es una migración |

### Recomendación: **B**

Los dominios que necesitan archivos se conocen y son pocos: productos,
mantenimiento, documentos de venta, documentos de compra, mensajes de
WhatsApp, adjuntos de mail. Seis tablas de tres columnas cada una es un
costo trivial frente a perder integridad referencial en el sistema de
archivos — que es justamente donde el legacy ya acumuló basura.

El argumento decisivo es el borrado: con la opción A, borrar un producto
deja archivos en Storage que nadie sabe que hay que limpiar. Con B, la
cascada los marca y un job los recoge.

**Se descarta también** poner `entity_type`/`entity_id` con un `CHECK`
gigante: tiene los defectos de A con la rigidez de B.

Buckets: `product-images`, `documents`, `maintenance-media`,
`wa-media`, `email-attachments`. Todos privados, servidos por URL firmada.

---

## P. AUDITORÍA

### El error a no repetir

El legacy tiene tres sistemas de log a la vez (`erp_trazabilidad_log`,
`erp_activity_log`, `logAct` por documento), registra navegación, y trunca
(`m[k].slice(-500)`, `k.splice(5000)`). Resultado: mucho volumen, poca
información y pérdida silenciosa.

### Decisión

```
audit_events (
  id            bigint identity,
  company_id    uuid,
  actor_id      uuid,          -- profiles
  entity_type   text,          -- 'sales_order', 'product', ...
  entity_id     uuid,
  entity_label  text,          -- 'PED00123' — legible sin join
  action        text,          -- create | update | delete | status_change |
                               -- approve | convert | send | login_failed
  changes       jsonb,         -- diff por campo, NO la fila entera
  occurred_at   timestamptz
)
```

### `old_data`/`new_data` completos vs diff por campo

**Diff por campo**, con este formato:

```json
{"status": {"from": "pendiente", "to": "entregado"},
 "total":  {"from": 8450.00,     "to": 9100.00}}
```

| | Fila completa | Diff por campo |
|---|---|---|
| Tamaño | KB por evento (un pedido con 50 líneas) | Bytes |
| Legibilidad | Hay que comparar a ojo | Se lee directo |
| Reconstrucción histórica | Posible | Sólo de campos auditados |

Se acepta perder la reconstrucción total: para eso están los backups.
Lo que se necesita a diario es *quién cambió qué y cuándo*.

**Sólo se auditan acciones de negocio:** crear/modificar/borrar
documentos, cambios de estado, aprobaciones, cambios de precio o stock,
altas y bajas de usuarios, cambios de permisos, logins fallidos.

**No se audita:** navegación, apertura de pantallas, filtros, scroll, ni
`SELECT`s.

Los campos auditados por entidad se declaran en una lista blanca en la
función de trigger. Crecimiento estimado: unos pocos MB al año.

Cuando la tabla crezca, se particiona por mes (`PARTITION BY RANGE
(occurred_at)`). No hace falta ahora, pero la columna ya está pensada
para eso.

---

## Q. IA

### Decisión: por ahora, ninguna tabla de IA nueva

Lo que la IA necesita para responder *"¿cuánto le vendimos a Nordex este
mes?"* no es una tabla de IA: es que `sales_invoices.customer_id` sea una
FK y que `issue_date` sea `timestamptz`. Eso ya está en el diseño.

Las preguntas que planteaste, contra este modelo:

| Pregunta | Se responde con |
|---|---|
| ¿Cuánto le vendimos a Nordex este mes? | `sales_invoices` JOIN `customers` WHERE `issue_date` |
| ¿Qué pidió este cliente? | `sales_orders` + `sales_order_items` + `products` |
| ¿Tenemos PH2 de 50 mm? | `products.search_vector` + `attributes->>'medida'` + `stock_balances` |
| ¿Qué habló Facundo con Nordex? | `wa_conversations.customer_id` + `assigned_to` + `wa_messages` |
| ¿Qué mantenimiento tuvo la serie XYZ? | `assets.serial_number` → `maintenance_orders` |
| ¿Qué compras están demoradas? | `purchase_orders` WHERE `eta_date` < now() AND status ≠ recibida |

**Las seis se responden con SQL sobre el modelo relacional.** Ninguna
necesita embeddings ni tablas especiales.

### Qué sí se crea, y cuándo

| Tabla | Cuándo |
|---|---|
| `ai_conversations`, `ai_messages` | Fase 8, cuando haya asistente con historial |
| `ai_memory` | Sólo si se demuestra que hace falta memoria entre sesiones |
| `ai_actions` | **Sí, en cuanto la IA pueda escribir.** Registro de qué hizo, con qué parámetros, quién lo pidió y si se confirmó. Sin esto, una IA con permiso de escritura es incontrolable |

El legacy ya tiene `erp_ai_conversations`, `erp_ai_memory` y un "ejecutor
de acciones" de 11.283 líneas que crea documentos. **Eso no se migra**: se
rediseña en Fase 8 con `ai_actions` desde el principio.

---

## R. BÚSQUEDA

Tres necesidades distintas, tres soluciones:

| Necesidad | Solución | Índice |
|---|---|---|
| SKU exacto o por prefijo | B-tree | `products(company_id, sku)` |
| SKU/nombre con error de tipeo ("2520/8B" vs "2520 8B") | **pg_trgm** | GIN sobre `sku` y `name` |
| Texto libre ("balanceador 5 kg tecna") | **tsvector generado** | GIN sobre `search_vector` |
| Filtro por atributo técnico | JSONB | GIN sobre `attributes` |

```sql
search_vector tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('spanish', coalesce(sku,'')), 'A') ||
  setweight(to_tsvector('spanish', coalesce(name,'')), 'A') ||
  setweight(to_tsvector('spanish', coalesce(model_code,'')), 'B') ||
  setweight(to_tsvector('spanish', coalesce(description,'')), 'C')
) STORED
```

Columna generada: se mantiene sola, sin trigger y sin poder desincronizarse
— a diferencia del campo `s` del legacy, que se arma a mano.

**pgvector: no.** No hay ningún caso de uso hoy que la búsqueda
estructurada no cubra mejor, más barato y de forma explicable. Se revisa
si aparece búsqueda semántica real ("algo para apretar tornillos chicos").

Extensiones necesarias: `pg_trgm`, `unaccent` (para que "balanceador"
encuentre "Balanceadór"). Ambas disponibles en Supabase.

---

## S. SOFT DELETE

| Categoría | Estrategia | Tablas |
|---|---|---|
| **Documentos legales** | **Nunca se borran.** Sólo `status = 'cancelled'` | `sales_invoices`, `delivery_notes`, `supplier_invoices` |
| **Entidades de negocio** | `deleted_at` + `deleted_by` | `customers`, `products`, `suppliers`, `quotes`, `sales_orders`, `assets`, `maintenance_orders`, `purchase_orders`, `profiles` |
| **Registros append-only** | Nunca se borran ni se editan | `stock_movements`, `audit_events`, `wa_messages`, `email_messages` |
| **Hijos y enlaces** | **Hard delete** en cascada del padre | `*_items`, `product_files`, `customer_contacts`, `stock_reservations` |
| **Efímeros** | Hard delete | `notifications`, caches, borradores |

Las líneas de un documento se borran de verdad al editarlo (antes de
emitirlo). Una vez emitido, el documento no se edita: se cancela y se
hace uno nuevo. Eso evita el `deleted_at` en tablas de líneas, que
complicaría cada suma de totales.

Todas las políticas RLS de lectura incluyen `deleted_at IS NULL`, así
"borrado" significa lo mismo en toda la aplicación.

---

## T. ESTRATEGIA DE IDs

### Decisión: híbrida, con una regla clara

| Tipo | Cuándo | Por qué |
|---|---|---|
| **`uuid` v4** (`gen_random_uuid()`) | Toda entidad de negocio | Aparece en URLs (`#/ventas/pedidos/<id>`); no es enumerable; se puede generar en el cliente antes de guardar |
| **`bigint` identity** | Tablas append-only de alto volumen: `stock_movements`, `audit_events`, `wa_messages`, `email_messages` | Nunca van en una URL. El id secuencial da localidad en el índice y ordena por inserción sin columna extra |

**Sobre UUID v7:** sería mejor que v4 (ordenable por tiempo, menos
fragmentación de índice), pero `uuidv7()` nativo llega en PostgreSQL 18 y
Supabase corre **17.6.1**. Se puede agregar por extensión, pero prefiero no
sumar una dependencia en la base para el arranque. **Revisar al actualizar
a PG 18**; el cambio afectaría sólo tablas nuevas.

**Números de documento aparte.** `COT00123`, `PED00456` son identidad de
negocio y hay que conservarlos, pero **no** como PK:

```sql
doc_number  text NOT NULL,
UNIQUE (company_id, doc_number)
```

Se generan con una secuencia por empresa y tipo de documento, dentro de la
transacción — no con `Math.max(...)` sobre el array como hoy, que produce
duplicados si dos personas guardan a la vez.

`legacy_ref text` en toda tabla migrada: permite re-ejecutar la migración
sin duplicar y auditar de dónde salió cada fila.

---

## U. TIMESTAMPS

```sql
created_at timestamptz NOT NULL DEFAULT now()
updated_at timestamptz NOT NULL DEFAULT now()   -- por trigger
deleted_at timestamptz                           -- donde aplique
created_by uuid REFERENCES profiles(id)
updated_by uuid REFERENCES profiles(id)          -- donde aporte
deleted_by uuid REFERENCES profiles(id)
```

Reglas:

- **`timestamptz` siempre, `timestamp` nunca.** Se almacena en UTC y se
  muestra en la zona del usuario. El legacy guarda `Date.now()` (epoch ms)
  y `'2026-09-08'` (fecha suelta) mezclados.
- **Fechas de negocio son `date`**, no `timestamptz`: `issue_date`,
  `due_date`, `eta_date`. La fecha de una factura no tiene hora ni zona.
- `updated_at` lo pone un trigger, nunca la aplicación.
- `created_by` se completa con `auth.uid()` por `DEFAULT`.

---

## V. ENUMS

### Decisión: `text` + `CHECK` para estados; tablas de lookup para lo que el usuario administra

| Enfoque | Cuándo | Ejemplo |
|---|---|---|
| **`text` + `CHECK`** | Estados y tipos definidos por el código | `status`, `movement_type`, `line_type`, `role` |
| **Tabla de lookup** | Valores que un admin agrega sin deploy | `product_categories`, `brands`, `currencies`, `payment_terms` |
| **`ENUM` de Postgres** | **Nunca** | — |

**Por qué no `ENUM`:** agregar un valor requiere `ALTER TYPE`, que no
convive bien con migraciones transaccionales; **quitar un valor es
imposible** sin recrear el tipo y todas las columnas que lo usan; y
renombrar es igual de caro. `text` + `CHECK` se modifica con un
`ALTER TABLE ... DROP CONSTRAINT / ADD CONSTRAINT` dentro de una
transacción, y en la aplicación se tipa igual de bien con una unión de
TypeScript.

El costo (unos bytes más por fila, sin validación a nivel de tipo) es
irrelevante frente a la rigidez que evita.

Los valores viven en **un solo lugar por dominio** en TypeScript y se
comparan contra los `CHECK` en un test, para que no se desincronicen.

---

## W. ÍNDICES

Regla: sólo se crea un índice que responda a una consulta concreta del
sistema. Cada índice cuesta espacio y penaliza las escrituras.

### Presentes en toda tabla de negocio

| Índice | Justificación |
|---|---|
| `PRIMARY KEY (id)` | — |
| `(company_id)` o `(company_id, ...)` como **prefijo** | **Toda** consulta pasa por RLS, que filtra por `company_id`. Sin esto, RLS hace seq scan |
| `UNIQUE (company_id, doc_number)` | Identidad de negocio y prevención de duplicados |
| `(company_id, created_at DESC)` | Listados por defecto, ordenados por fecha |

### Por tabla

| Tabla | Índices | Para qué |
|---|---|---|
| `products` | `UNIQUE(company_id, sku)`; `(company_id, brand_id)`; `(company_id, category_id)`; GIN `search_vector`; GIN `attributes`; GIN trgm `sku`, `name` | Búsqueda y filtros del catálogo |
| `customers` | `UNIQUE(company_id, tax_id) WHERE tax_id IS NOT NULL`; GIN trgm `legal_name`, `trade_name`; GIN `email_domains` | Búsqueda, dedupe, asociar mails |
| `quotes` / `sales_orders` / `delivery_notes` / `sales_invoices` | `(company_id, customer_id, issue_date DESC)`; `(company_id, status)`; `(company_id, salesperson_id)` | Listados, filtros, "mis ventas" |
| `*_items` | `(<doc>_id, position)`; `(product_id)` | Cargar el documento; ventas por producto |
| `delivery_note_items` | `(sales_order_item_id)` | Cálculo de pendiente de entrega |
| `stock_movements` | `(company_id, product_id, warehouse_id, created_at DESC)`; `(source_type, source_id)` | Kardex por producto; trazar el documento |
| `stock_balances` | `UNIQUE(product_id, warehouse_id)` | Saldo por producto |
| `product_prices` | `UNIQUE(price_list_id, product_id, valid_from)`; `(product_id)` | Resolver precio |
| `company_memberships` | `UNIQUE(user_id, company_id)`; `(company_id, role)`; `(user_id) WHERE status='active'` | **La usa `current_company_ids()` en cada consulta: es el índice más caliente del sistema** |
| `wa_messages` | `(conversation_id, ts DESC)`; `(company_id, ts DESC)` | Cargar conversación; bandeja |
| `wa_conversations` | `(company_id, status, last_message_at DESC)`; `(assigned_to)`; `(customer_id)` | Bandeja, mis conversaciones |
| `email_messages` | `(thread_id, date DESC)`; `(company_id, status, date DESC)`; `(assigned_to)` | Bandeja |
| `assets` | `(company_id, customer_id)`; `UNIQUE(company_id, serial_number) WHERE serial_number IS NOT NULL` | Equipos del cliente; buscar por serie |
| `maintenance_orders` | `(company_id, asset_id, created_at DESC)`; `(company_id, status)`; `(assigned_technician_id)` | Historial; tablero; mis órdenes |
| `audit_events` | `(company_id, entity_type, entity_id, occurred_at DESC)`; `(company_id, actor_id, occurred_at DESC)` | Historial de un documento; qué hizo un usuario |

### Índices que NO se crean

- En columnas booleanas de baja selectividad (`iva`, `is_active`) — salvo
  como índice **parcial** si la consulta siempre filtra por un valor.
- En `updated_at` — nadie consulta por ahí.
- En FKs que nunca se consultan en sentido inverso.
- Un índice por columna "por si acaso": se agregan cuando una consulta
  real lo pida, medido con `EXPLAIN ANALYZE`.

---

## X. MATRIZ RLS

En [`RLS_MATRIX.md`](RLS_MATRIX.md), con el detalle por tabla y rol.

Principios:

1. **Toda tabla con RLS habilitado.** Sin excepciones. Una tabla sin
   política queda inaccesible por defecto, que es el lado correcto donde
   fallar.
2. **Todas las políticas empiezan igual:**
   `company_id = ANY(app.current_company_ids())`.
3. **Los usuarios externos** (cliente, distribuidor, proveedor) suman
   siempre una condición de pertenencia: `customer_id = app.current_customer_id()`.
4. **Nunca `USING (true)`.** El legacy tiene un
   `FOR INSERT WITH CHECK (true)` en `erp_emails`; ese patrón está prohibido.
5. **Los costos y márgenes** están en tablas separadas justamente para
   poder negarlos por RLS a distribuidores y clientes.
6. **Se prueba con la API, no con la UI.** Cada regla necesita un test que
   intente el acceso indebido con un token de otro rol y verifique que la
   base lo rechaza.

---

## Y. PLAN DE MIGRACIÓN

En [`MIGRATION_PLAN.md`](MIGRATION_PLAN.md).

---

## Z. DATASET DE PRUEBA

En [`MIGRATION_PLAN.md`](MIGRATION_PLAN.md#dataset-de-prueba). Resumen:
2 empresas · 6 usuarios (uno por rol) · 20 clientes · 200 productos
(muestra estratificada real, no inventada) · 10 cotizaciones · 10 pedidos
(3 con entrega parcial) · 5 compras · 5 mantenimientos · 3 conversaciones.

**No se genera todavía.**

---

## Decisiones estructurales — resumen

| # | Decisión | Alternativas | Riesgo | Impacto futuro |
|---|---|---|---|---|
| 1 | `company_id` + RLS | Proyecto/schema por empresa; filtro en frontend | Olvidar la columna en una tabla nueva → test automático | Alto y positivo: sostiene todo el multiempresa |
| 2 | Rol por membresía + `role_permissions` | Roles N:N; sólo permisos | Proliferación de excepciones | Medio: cambiar después obliga a migrar permisos |
| 3 | Catálogo híbrido (15 cols + JSONB con registro) | Todo columnas; todo JSONB | Que el JSONB se vuelva vertedero → tabla de definiciones + CHECK | Alto: es la tabla más consultada |
| 4 | Stock por movimientos + saldo por trigger | Saldo calculado; vista materializada | Trigger incorrecto → job de verificación | Alto: no se puede cambiar con datos cargados |
| 5 | Listas de precios | Columnas de precio en `products` | Más joins para mostrar un precio | Alto: habilita distribuidores |
| 6 | Snapshot en líneas + FK al producto | Sólo FK; sólo snapshot | Redundancia controlada | Bajo: es el estándar en ERPs |
| 7 | Enlace de líneas entre documentos | Índices de array (legacy); `document_links` | Ninguno; corrige un bug real | Alto: habilita parciales confiables |
| 8 | Archivos con tablas de enlace por dominio | Polimórfico | Una migración por dominio nuevo | Medio |
| 9 | Auditoría con diff por campo | Filas completas; sin auditoría | No se puede reconstruir todo → backups | Bajo |
| 10 | UUID v4 + bigint en append-only | Todo UUID; todo bigint | Fragmentación de índice → revisar UUIDv7 en PG 18 | Medio |
| 11 | `text` + `CHECK` | `ENUM`; lookup para todo | Ninguno relevante | Bajo, y evita migraciones dolorosas |
| 12 | Sin pgvector, sin tablas de IA | Embeddings desde el inicio | Que aparezca un caso semántico real → se agrega después | Bajo |
