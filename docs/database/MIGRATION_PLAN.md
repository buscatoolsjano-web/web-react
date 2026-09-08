# Plan de migración de datos legacy

> **PROPUESTA — no ejecutado.** Ningún dato fue migrado.
> El proyecto `uaxcfufvapzulqvynanp` sigue vacío.

## Regla general

> Primero el schema nuevo y aprobado. Después, sólo los datos útiles.

Nada se copia "porque estaba". Cada tabla origen se clasifica antes de
tocarla.

---

## Clasificación por origen

Leyenda: **MIGRAR** tal cual · **TRANSFORMAR** cambia de forma ·
**NO MIGRAR** se descarta · **ARCHIVAR** se guarda fuera de la base

### Se migra

| Origen | Destino | Volumen | Acción | Complejidad |
|---|---|---|---|---|
| `productos-data.json` | `products` + `brands` + `product_categories` + `product_prices` + `stock_movements` | **21.772** | TRANSFORMAR | 🔴 Alta |
| `clientes-data` (index.html) | `customers` + `customer_contacts` | **988** | TRANSFORMAR | 🟡 Media |
| `buscatools_clientes_extra` | columnas de `customers` + `customer_addresses` | — | TRANSFORMAR | 🟡 Media |
| `erp_contactos` | `customer_contacts` | — | MIGRAR | 🟢 Baja |
| `proveedores-data` | `suppliers` | **142** | MIGRAR | 🟢 Baja |
| `erp_cotizaciones` | `quotes` + `quote_items` | — | TRANSFORMAR | 🔴 Alta |
| `erp_pedidos` | `sales_orders` + `sales_order_items` | — | TRANSFORMAR | 🔴 Alta |
| `erp_notas_entrega` | `delivery_notes` + `delivery_note_items` | — | TRANSFORMAR | 🔴 Alta |
| `erp_facturas` | `sales_invoices` + items | — | TRANSFORMAR | 🟡 Media |
| `erp_pedidos_compra`, `erp_notas_proveedor`, `erp_facturas_proveedor` | Compras | — | TRANSFORMAR | 🟡 Media |
| `mant_activos` | `assets` | — | TRANSFORMAR | 🟡 Media |
| `mant_fichas` | `maintenance_orders` + 3 tablas hijas | — | TRANSFORMAR | 🔴 Alta |
| `suite_wa_conversaciones` / `_mensajes` | `wa_conversations` / `wa_messages` | — | TRANSFORMAR | 🟡 Media |
| `suite_wa_media` (base64) | Storage + `files` | — | TRANSFORMAR | 🔴 Alta |
| `erp_emails` | `email_threads` + `email_messages` | — | TRANSFORMAR | 🟡 Media |
| `erp_producto_overrides` | `product_prices` + `stock_movements` | — | TRANSFORMAR | 🟡 Media |

### No se migra

| Origen | Por qué |
|---|---|
| **`erp_store` como estructura** | Es el blob JSON que se elimina por diseño |
| **`erp_auth_users`, `erp_client_accounts`** | SHA-256 sin salt. **Los usuarios se recrean en Supabase Auth con invitación por email** |
| **`erp_user_perms`** | Modelo de permisos rediseñado. Se recrea a mano: son pocos usuarios |
| **`erp_trazabilidad_log`, `erp_activity_log`** | Logs de navegación, sin valor de negocio |
| `_importOrigen` (58% de productos) | Rastro del proceso de importación |
| `_apexPageCatalog`, `_apexFamilyTitle`, `_apexEnriquecido` (16%) | Idem |
| `s`, `nj_n`, `nc_n` | Cadenas de búsqueda pre-armadas → `search_vector` |
| `_erp_stok`, `_erp_stok_u` | Deltas de stock en localStorage → asiento de apertura |
| `erp_chat_messages`, `erp_chat_groups` | Chat interno; se decide si el módulo sigue existiendo |
| `erp_cot_descartadas`, borradores | Efímeros |
| `imp_*_v1` | Estado de la calculadora de importación, por usuario |
| Tokens, claves y secretos | Nunca |

### Se archiva

| Origen | Destino |
|---|---|
| `erp_kardex` (tope 5.000, ya truncado) | Export CSV a Storage. **No** se carga en `stock_movements`: está incompleto y contaminaría el saldo |
| `mant_historico` | Se evalúa por caso: si mapea a órdenes cerradas, se migra; si no, CSV |
| Volcado completo de `erp_store` | Un JSON en Storage, como red de seguridad, con fecha |

---

## Plan por módulo

Cada módulo sigue los mismos cinco pasos:

1. **Extraer** del legacy a un JSON local (sin escribir en el legacy).
2. **Perfilar**: contar, medir nulos, detectar duplicados y valores fuera
   de rango. **Reportar antes de transformar.**
3. **Transformar** con un script idempotente (clave: `legacy_ref`).
4. **Cargar** primero en un *branch* de Supabase, nunca en producción.
5. **Validar**: totales, muestreo manual de 20 registros, integridad
   referencial, y comparación contra la pantalla del legacy.

### M1 — Core (sin datos legacy)

Se crean a mano: 3 empresas, roles, permisos, depósito por defecto,
monedas, lista de precios base. Los usuarios se invitan por email desde
Supabase Auth.

**No se migra ningún usuario.** Son 6 personas: recrearlas es más rápido y
más seguro que migrar hashes que igual habría que invalidar.

### M2 — Catálogo (21.772 productos) 🔴

El más grande y el más delicado.

| Paso | Detalle |
|---|---|
| 2.1 | Extraer 25 marcas → `brands` |
| 2.2 | **Revisar la taxonomía antes de cargar.** 12.588 de 21.772 productos (58%) caen en la categoría `otros`. Migrar eso tal cual perpetúa un catálogo inservible para filtrar. **Requiere una decisión de negocio, no técnica** |
| 2.3 | Declarar las claves de `attributes` en `product_attribute_definitions` |
| 2.4 | Cargar productos: 15 columnas + `attributes` con la cola larga |
| 2.5 | `pu` → `product_prices` en la lista base USD (12.263 productos con precio > 0; **el 43,7% queda sin precio**) |
| 2.6 | `sr` → un movimiento `opening_balance` por producto con stock. **Sólo 378 productos**. `sv` no se migra: se recalcula |
| 2.7 | `imgs[]` → filas en `files` **apuntando a la URL de `buscatool.com`**. La descarga a Storage es un trabajo aparte (8.859 imágenes) y no bloquea el módulo |
| 2.8 | `sim_*` → `product_equivalences` (1.705 productos) |
| 2.9 | Kits → `product_components` |

**Riesgos:** los 5.456 productos sin marca quedan con `brand_id NULL` (por
eso la columna es nullable). La recategorización puede requerir varias
pasadas.

### M3 — Clientes y proveedores (988 + 142) 🟡

| Paso | Detalle |
|---|---|
| 3.1 | Perfilar duplicados por `tax_id` normalizado y por nombre similar (trigram). Los 988 `nj` son únicos, pero puede haber la misma empresa escrita de dos formas |
| 3.2 | Cargar `customers` con `legacy_ref = ref` |
| 3.3 | `emails[]` → `customer_contacts` (877 clientes tienen al menos uno) |
| 3.4 | `doms[]` → `customers.email_domains` |
| 3.5 | Aplanar `clientes_extra` en columnas y direcciones |
| 3.6 | **Construir el mapa `nombre → customer_id`.** Es el artefacto crítico del que dependen M4, M5 y M6 |

### M4 — Ventas 🔴

**El paso más delicado de toda la migración.** Los documentos guardan el
nombre del cliente como texto y hay que resolverlo a una FK.

| Paso | Detalle |
|---|---|
| 4.1 | Para cada documento, resolver `cliente` (texto) → `customer_id` usando el mapa de M3 |
| 4.2 | **Los no resueltos NO se inventan.** Van a un informe de excepciones para revisión manual. Un documento sin cliente resuelto **no se carga** hasta decidir qué hacer |
| 4.3 | Cabeceras con `legacy_ref = ref`, `doc_number = ref` |
| 4.4 | Líneas con `position` = índice del array, `line_type` según `type` |
| 4.5 | Snapshots: `sku_snapshot ← it.sku`, `name_snapshot ← it.nombre`, etc. |
| 4.6 | `product_id`: resolver por SKU. Si el SKU no existe, **queda NULL y la línea igual se migra** con su snapshot |
| 4.7 | Enlazar: `fromCotizacion → quote_id`, `fromPedido → sales_order_id` |
| 4.8 | **Convertir `entregado{idx:qty}` a `delivery_note_items.sales_order_item_id`.** Es una conversión con riesgo: si el array cambió de orden alguna vez, los datos legacy ya están mal y no hay forma de saberlo. **Se genera un informe de inconsistencias** (entregado > pedido, sumas que no cierran) para revisar antes de dar por buena la migración |
| 4.9 | `creadoPor` (texto `'JANO'`) → `created_by uuid`, con una tabla de equivalencias de 6 filas |

### M5 — Compras 🟡

Mismo patrón; menos volumen. `proveedor` (texto) → `supplier_id`.

### M6 — Mantenimiento 🟡

| Paso | Detalle |
|---|---|
| 6.1 | `mant_activos.clienteNombre` → `assets.customer_id` (mismo mapa de M3) |
| 6.2 | `productoSku` → `product_id` cuando exista |
| 6.3 | Descomponer cada ficha: cabecera → `maintenance_orders`; etapas → `maintenance_order_steps`; `diagnosticoPartes`/`reparacionPartes` → `maintenance_parts`; `torqueMediciones[10]` → `maintenance_measurements` **descartando las posiciones vacías** |

### M7 — Comunicaciones 🟡🔴

| Paso | Detalle |
|---|---|
| 7.1 | `suite_wa_conversaciones` → `wa_conversations`; `cli_ref`/`cli_nombre` → `customer_id` |
| 7.2 | `asignado` (texto) → `assigned_to uuid` |
| 7.3 | `suite_wa_mensajes` → `wa_messages` con `external_id` para no duplicar |
| 7.4 | **`suite_wa_media.datos` (base64) → Storage.** Decodificar, subir, crear `files`, enlazar. Lento y con reintentos. Si un blob está corrupto, se registra y se sigue |
| 7.5 | `erp_emails` → `email_threads` (agrupando por `thread_id`) + `email_messages` |
| 7.6 | `body_html` > 64 KB → Storage. `attachments` base64 → Storage |
| 7.7 | Resolver `related_cliente` y el dominio del remitente → `customer_id` |

---

## Reglas de ejecución

1. **Idempotencia obligatoria.** Todo script usa `ON CONFLICT (company_id,
   legacy_ref) DO UPDATE`. Se debe poder correr diez veces sin duplicar.
2. **Nunca directo a producción.** Primero un branch de Supabase.
3. **Sin `service_role` en el frontend.** Los scripts corren desde una
   máquina de confianza.
4. **El legacy es de sólo lectura.** Los scripts leen un export, no la
   base viva.
5. **Informe obligatorio por módulo**: filas leídas, cargadas, omitidas y
   con excepción. Si las omitidas superan el 1%, se frena y se revisa.
6. **Orden fijo**, por dependencias:
   `core → catálogo → clientes/proveedores → ventas → compras →
   mantenimiento → comunicaciones`.
7. **Punto de retorno:** hasta que el módulo de Ventas esté validado, el
   legacy sigue siendo el sistema de producción. La migración se puede
   descartar y rehacer sin consecuencias.

---

## Riesgos

| # | Riesgo | Sev. | Mitigación |
|---|---|---|---|
| 1 | **Cliente por nombre → FK**: nombres que no matchean, o dos variantes del mismo cliente | 🔴 | Informe de excepciones. Sin resolución manual no se carga el documento |
| 2 | **`entregado[idx]` ya corrupto en origen** por reordenamientos históricos | 🔴 | Informe de inconsistencias. Los datos malos son anteriores a la migración: hay que detectarlos, no heredarlos en silencio |
| 3 | 58% del catálogo en la categoría `otros` | 🟠 | Decisión de negocio previa a M2 |
| 4 | 43,7% de productos sin precio | 🟠 | Se migran igual, sin precio. Se listan para carga posterior |
| 5 | 8.859 imágenes en un WordPress externo | 🟠 | Se difiere: se guarda la URL. Si `buscatool.com` cae, se pierden las imágenes → conviene planificar la descarga |
| 6 | Media de WhatsApp en base64, posiblemente corrupta | 🟠 | Migración tolerante a fallos con registro de errores |
| 7 | El kardex ya está truncado a 5.000 | 🟡 | Se archiva como CSV; el saldo arranca de `opening_balance`, no del histórico |
| 8 | Doble operación durante el corte | 🔴 | **Regla del corte:** el día que Ventas pasa a React, el legacy queda en sólo lectura. No hay período de escritura simultánea |

---

## Dataset de prueba

Se genera **antes** de migrar nada real, para probar schema, RLS y UI.

| Entidad | Cantidad | Cómo |
|---|---|---|
| `companies` | **2** — Buscatools, Torquetools | A mano. Dos empresas es el mínimo para probar aislamiento |
| `profiles` + memberships | **6** — uno por rol | admin, employee, salesperson, technician, distributor, customer |
| `customers` | **20** | **Muestra real anonimizada** de los 988: nombres reemplazados, estructura conservada |
| `products` | **200** | **Muestra estratificada real**: 50 con marca+categoría+precio+stock, 50 sin marca, 50 con muchos `attributes`, 50 sin precio. Refleja la distribución medida |
| `price_lists` | 2 — base y distribuidor | Para probar precios diferenciales |
| `quotes` | 10 | 3 borradores, 4 enviadas, 3 convertidas |
| `sales_orders` | 10 | **3 con entrega parcial** — el caso que el legacy hace mal |
| `delivery_notes` | 8 | Incluye 2 parciales del mismo pedido |
| `sales_invoices` | 5 | 1 vencida |
| `suppliers` | 5 | |
| `purchase_orders` | 5 | 2 con recepción parcial |
| `assets` | 10 | Con número de serie y garantía |
| `maintenance_orders` | 5 | Uno por etapa del proceso |
| `wa_conversations` | 3 | 1 asignada, 1 sin asignar, 1 cerrada |
| `wa_messages` | ~50 | Con y sin adjunto |
| `email_threads` | 3 | |
| `stock_movements` | ~100 | Ingresos, egresos y ajustes |

**Por qué muestra real anonimizada y no datos inventados:** los datos
inventados son demasiado prolijos. Los reales traen los casos que rompen —
productos sin marca, clientes sin CUIT, precios faltantes — y son
justamente los que la UI tiene que soportar.

**Criterio de aceptación del dataset:** los 10 casos de prueba de la
[matriz RLS](RLS_MATRIX.md#plan-de-pruebas-fase-2b) se pueden ejecutar
todos contra él.

**No se genera todavía.** Es la primera tarea de Fase 2B, después de que
apruebes el schema.
