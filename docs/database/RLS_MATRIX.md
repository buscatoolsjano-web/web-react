# Matriz de Row Level Security

> **PROPUESTA — no ejecutado.** Ninguna política fue escrita ni aplicada.
> Este documento define *qué* debe permitir cada regla. El SQL es Fase 2B.

## Funciones auxiliares

Todas las políticas se apoyan en estas cuatro. Se declaran `STABLE` para
que Postgres las evalúe una vez por consulta y no una vez por fila.

| Función | Devuelve |
|---|---|
| `app.current_company_ids()` | `uuid[]` — empresas donde el usuario tiene membresía activa |
| `app.has_role(company, role)` | `boolean` |
| `app.has_permission(company, perm)` | `boolean` — rol + excepciones de la membresía |
| `app.current_customer_id(company)` | `uuid` — el cliente que *es* el usuario (roles `customer` / `distributor`) |

**Condición base**, presente en toda política sin excepción:

```sql
company_id = ANY(app.current_company_ids())
```

Se abrevia `[BASE]` en las tablas siguientes.

## Roles

| Código | Interno | Descripción |
|---|---|---|
| `admin` | sí | Todo dentro de sus empresas |
| `employee` | sí | Según permisos de su membresía |
| `salesperson` | sí | Su cartera de clientes y sus documentos |
| `technician` | sí | Mantenimientos asignados |
| `distributor` | **no** | Catálogo permitido, sus pedidos, su lista de precios |
| `customer` | **no** | Sólo sus propios datos |
| `supplier` | **no** | Preparado, inactivo |

Leyenda: ✅ permitido · ⚠️ condicionado · ❌ denegado

---

## CORE

| Tabla | Rol | SELECT | INSERT | UPDATE | DELETE | Condición |
|---|---|---|---|---|---|---|
| `companies` | admin | ✅ | ❌ | ⚠️ | ❌ | `id = ANY(current_company_ids())`. Alta de empresa sólo por service_role |
| | resto | ⚠️ | ❌ | ❌ | ❌ | Sólo sus empresas, columnas públicas |
| `profiles` | todos | ⚠️ | ❌ | ⚠️ | ❌ | SELECT: perfiles que comparten empresa. UPDATE: sólo el propio (`id = auth.uid()`) |
| | admin | ✅ | ❌ | ⚠️ | ❌ | UPDATE de perfiles de su empresa. El alta la hace Auth |
| `company_memberships` | admin | ✅ | ✅ | ✅ | ⚠️ | `[BASE]`. **No puede quitarse a sí mismo el rol admin** |
| | resto | ⚠️ | ❌ | ❌ | ❌ | Sólo su propia membresía (`user_id = auth.uid()`) |
| `roles`, `permissions`, `role_permissions` | todos | ✅ | ❌ | ❌ | ❌ | Sólo lectura. Se administran por migración |
| `membership_permissions` | admin | ✅ | ✅ | ✅ | ✅ | `[BASE]` vía la membresía |
| | resto | ⚠️ | ❌ | ❌ | ❌ | Sólo las propias |
| `files` | interno | ⚠️ | ✅ | ⚠️ | ❌ | `[BASE]`. UPDATE/DELETE sólo el que subió, o admin. Borrado = `deleted_at` |
| | externo | ⚠️ | ⚠️ | ❌ | ❌ | Sólo archivos ligados a entidades que ya puede ver |
| `audit_events` | admin | ✅ | ❌ | ❌ | ❌ | `[BASE]`. **Nadie inserta desde el cliente: sólo triggers** |
| | resto | ❌ | ❌ | ❌ | ❌ | — |

---

## CATÁLOGO, STOCK Y PRECIOS

| Tabla | Rol | SELECT | INSERT | UPDATE | DELETE | Condición |
|---|---|---|---|---|---|---|
| `products` | admin | ✅ | ✅ | ✅ | ⚠️ | `[BASE]`. DELETE = soft |
| | employee | ⚠️ | ⚠️ | ⚠️ | ❌ | Según `catalog.product.*` |
| | salesperson | ✅ | ❌ | ❌ | ❌ | `[BASE]` + `deleted_at IS NULL` |
| | distributor | ⚠️ | ❌ | ❌ | ❌ | `[BASE]` + `status='active'` + categoría habilitada |
| | customer | ⚠️ | ❌ | ❌ | ❌ | Igual que distribuidor |
| | technician | ✅ | ❌ | ❌ | ❌ | Necesita ver repuestos |
| `brands`, `product_categories`, `product_attribute_definitions` | interno | ✅ | ⚠️ | ⚠️ | ⚠️ | Escritura sólo admin |
| | externo | ✅ | ❌ | ❌ | ❌ | Necesarias para filtrar |
| `product_components` | interno | ✅ | ⚠️ | ⚠️ | ⚠️ | `[BASE]`, escritura admin/employee |
| | externo | ❌ | ❌ | ❌ | ❌ | La composición de un kit es información interna |
| **`product_costs`** | admin | ✅ | ✅ | ✅ | ✅ | `[BASE]` |
| | employee | ⚠️ | ⚠️ | ⚠️ | ❌ | Requiere permiso `catalog.cost.read` |
| | **salesperson** | ⚠️ | ❌ | ❌ | ❌ | Sólo con permiso explícito |
| | **distributor, customer** | ❌ | ❌ | ❌ | ❌ | **Nunca.** Motivo por el que el costo está en tabla aparte |
| `price_lists` | interno | ✅ | ⚠️ | ⚠️ | ❌ | Escritura admin |
| | distributor/customer | ⚠️ | ❌ | ❌ | ❌ | **Sólo la lista que tienen asignada** |
| `product_prices` | interno | ✅ | ⚠️ | ⚠️ | ⚠️ | `[BASE]` |
| | externo | ⚠️ | ❌ | ❌ | ❌ | Sólo precios de su lista y con vigencia actual |
| `stock_balances` | interno | ✅ | ❌ | ❌ | ❌ | Sólo lo escribe el trigger |
| | externo | ⚠️ | ❌ | ❌ | ❌ | Puede ver **disponibilidad**, no la cantidad exacta (vista con booleano) |
| `stock_movements` | admin | ✅ | ❌ | ❌ | ❌ | **Nadie escribe directo.** Ver la nota de O4 abajo |
| | employee | ✅ | ❌ | ❌ | ❌ | Lee para las pantallas de Compras y Mantenimiento |
| | externo | ❌ | ❌ | ❌ | ❌ | — |
| `warehouses` | interno | ✅ | ⚠️ | ⚠️ | ❌ | Escritura admin |
| | externo | ❌ | ❌ | ❌ | ❌ | — |

---

## CLIENTES Y VENTAS

`[MIO]` = `customer_id = app.current_customer_id(company_id)`
`[CARTERA]` = `customer_id IN (SELECT customer_id FROM customer_sales_reps WHERE profile_id = auth.uid())`

| Tabla | Rol | SELECT | INSERT | UPDATE | DELETE | Condición |
|---|---|---|---|---|---|---|
| `customers` | admin | ✅ | ✅ | ✅ | ⚠️ | `[BASE]`, DELETE = soft |
| | employee | ⚠️ | ⚠️ | ⚠️ | ❌ | Según permisos |
| | **salesperson** | ⚠️ | ✅ | ⚠️ | ❌ | `[BASE]` **+ `[CARTERA]`** — no ve clientes de otro vendedor |
| | **customer/distributor** | ⚠️ | ❌ | ⚠️ | ❌ | `[MIO]`. UPDATE sólo datos de contacto |
| `customer_contacts`, `customer_addresses` | interno | ✅ | ✅ | ✅ | ⚠️ | Heredan del cliente |
| | externo | ⚠️ | ⚠️ | ⚠️ | ⚠️ | `[MIO]` |
| `customer_sales_reps` | admin | ✅ | ✅ | ✅ | ✅ | `[BASE]` |
| | salesperson | ⚠️ | ❌ | ❌ | ❌ | Sólo sus asignaciones |
| | externo | ❌ | ❌ | ❌ | ❌ | — |
| `quotes` | admin | ✅ | ✅ | ✅ | ⚠️ | `[BASE]` |
| | salesperson | ⚠️ | ✅ | ⚠️ | ⚠️ | `[CARTERA]` o `salesperson_id = auth.uid()`. UPDATE sólo en `draft` |
| | customer/distributor | ⚠️ | ❌ | ❌ | ❌ | `[MIO]` + `status <> 'draft'` — **no ve borradores** |
| `sales_orders` | admin | ✅ | ✅ | ✅ | ⚠️ | `[BASE]` |
| | salesperson | ⚠️ | ✅ | ⚠️ | ❌ | `[CARTERA]` |
| | **distributor** | ⚠️ | ⚠️ | ❌ | ❌ | `[MIO]`. **Puede crear su propio pedido** (portal) |
| | customer | ⚠️ | ❌ | ❌ | ❌ | `[MIO]` |
| `delivery_notes` | admin/employee | ✅ | ✅ | ⚠️ | ❌ | `[BASE]`. **No se borra: se cancela** |
| | salesperson | ⚠️ | ⚠️ | ❌ | ❌ | `[CARTERA]` |
| | customer/distributor | ⚠️ | ❌ | ❌ | ❌ | `[MIO]` |
| `sales_invoices` | admin | ✅ | ✅ | ⚠️ | ❌ | `[BASE]`. **Documento legal: nunca se borra** |
| | employee | ⚠️ | ⚠️ | ⚠️ | ❌ | Permiso `sales.invoice.*` |
| | salesperson | ⚠️ | ❌ | ❌ | ❌ | `[CARTERA]` |
| | customer/distributor | ⚠️ | ❌ | ❌ | ❌ | `[MIO]` |
| `*_items` (todos) | — | — | — | — | — | **Heredan la política del documento padre** vía `EXISTS`. Nunca tienen política propia más laxa |

---

## COMPRAS

| Tabla | Rol | SELECT | INSERT | UPDATE | DELETE | Condición |
|---|---|---|---|---|---|---|
| `suppliers` | admin | ✅ | ✅ | ✅ | ⚠️ | `[BASE]` |
| | employee | ⚠️ | ⚠️ | ⚠️ | ❌ | Permiso `purchases.supplier.*` |
| | salesperson, technician | ✅ | ❌ | ❌ | ❌ | Lectura (para saber quién provee un repuesto) |
| | customer, distributor | ❌ | ❌ | ❌ | ❌ | **Los proveedores son información interna** |
| `purchase_orders`, `purchase_order_items`, `purchase_receipts`, `supplier_invoices`, `supplier_payments` | admin | ✅ | ✅ | ✅ | ⚠️ | `[BASE]` |
| | employee | ⚠️ | ⚠️ | ⚠️ | ❌ | Permiso `purchases.*` |
| | resto interno | ❌ | ❌ | ❌ | ❌ | Costos de compra son sensibles |
| | externo | ❌ | ❌ | ❌ | ❌ | — |
| | *(futuro `supplier`)* | ⚠️ | ❌ | ⚠️ | ❌ | Sólo sus propias OC; podría confirmar ETA |

---

## MANTENIMIENTO

| Tabla | Rol | SELECT | INSERT | UPDATE | DELETE | Condición |
|---|---|---|---|---|---|---|
| `assets` | admin/employee | ✅ | ✅ | ✅ | ⚠️ | `[BASE]` |
| | **technician** | ✅ | ✅ | ⚠️ | ❌ | `[BASE]` — necesita ver todo el parque |
| | customer/distributor | ⚠️ | ❌ | ❌ | ❌ | `[MIO]` — sus propios equipos |
| `maintenance_orders` | admin/employee | ✅ | ✅ | ✅ | ⚠️ | `[BASE]` |
| | **technician** | ⚠️ | ✅ | ⚠️ | ❌ | `assigned_technician_id = auth.uid()` **o** sin asignar (para tomarla) |
| | customer | ⚠️ | ❌ | ❌ | ❌ | `[MIO]` + estado ≠ borrador |
| `maintenance_order_steps`, `maintenance_parts`, `maintenance_measurements` | technician | ⚠️ | ⚠️ | ⚠️ | ⚠️ | Sólo de órdenes asignadas a él |
| | customer | ⚠️ | ❌ | ❌ | ❌ | Lectura de sus órdenes (sin costos internos) |
| `maintenance_files` | technician | ⚠️ | ✅ | ❌ | ❌ | De sus órdenes |
| | customer | ⚠️ | ❌ | ❌ | ❌ | Fotos de sus equipos |

---

## COMUNICACIONES

| Tabla | Rol | SELECT | INSERT | UPDATE | DELETE | Condición |
|---|---|---|---|---|---|---|
| `wa_accounts` | admin | ✅ | ✅ | ✅ | ⚠️ | `[BASE]` |
| | employee/salesperson | ✅ | ❌ | ❌ | ❌ | — |
| | externo | ❌ | ❌ | ❌ | ❌ | — |
| `wa_conversations` | admin | ✅ | ✅ | ✅ | ❌ | `[BASE]` |
| | employee/salesperson | ⚠️ | ⚠️ | ⚠️ | ❌ | `assigned_to = auth.uid()` **o** sin asignar. Con permiso `wa.view_all` ve todas |
| | externo | ❌ | ❌ | ❌ | ❌ | **Nunca.** Es la bandeja interna |
| `wa_messages` | interno | ⚠️ | ⚠️ | ⚠️ | ❌ | Heredan de la conversación. UPDATE sólo `is_read`/`status`. **Sin DELETE** |
| `email_threads`, `email_messages` | admin | ✅ | ✅ | ✅ | ❌ | `[BASE]` |
| | employee | ⚠️ | ⚠️ | ⚠️ | ❌ | `assigned_to = auth.uid()` o permiso `email.view_all` |
| | externo | ❌ | ❌ | ❌ | ❌ | — |
| `email_attachments`, `wa_message_files` | — | ⚠️ | ⚠️ | ❌ | ❌ | Heredan del mensaje |

---

## Reglas transversales

1. **Ninguna política usa `USING (true)`.** El legacy tiene un
   `FOR INSERT WITH CHECK (true)` en `erp_emails` — cualquiera con la anon
   key puede insertar. Ese patrón está prohibido.
2. **Toda tabla tiene RLS habilitado.** Una tabla sin política queda
   inaccesible, que es el lado correcto donde fallar.
3. **Toda política de lectura incluye `deleted_at IS NULL`**, salvo las
   vistas de papelera para admin.
4. **Las tablas append-only** (`stock_movements`, `audit_events`,
   `wa_messages`, `email_messages`) no tienen `UPDATE` ni `DELETE` para
   ningún rol, incluido admin. Corregir un movimiento = crear el
   contramovimiento.

   **Y desde el fix de O4, `stock_movements` tampoco acepta `INSERT` desde el
   cliente.** El diseño original le daba INSERT a admin y employee, y la
   implementación lo hizo; medido con JWT reales, eso permitía que un admin
   moviera el stock de cualquier producto de su empresa por PostgREST, con el
   `movement_type` que quisiera y sin ningún documento detrás. El privilegio
   se revocó: el stock se mueve sólo por `confirmar_entrega()`,
   `confirmar_recepcion()` y `confirmar_consumo_mantenimiento()`, que son
   `SECURITY DEFINER`. La policy `stockmov_insert` se dejó en su lugar como
   segunda capa. Ver `docs/SECURITY_FIX_O4_STOCK_MOVEMENTS.md`.

   `stock_balances` nunca tuvo escritura desde el cliente: lo escribe
   `app.apply_stock_movement()`.
5. **`audit_events` no acepta `INSERT` desde el cliente.** Sólo lo
   escriben triggers `SECURITY DEFINER`.
6. **Las tablas de líneas nunca tienen política propia más laxa** que su
   documento padre: siempre `EXISTS (SELECT 1 FROM <padre> WHERE ...)`.
7. **`service_role` nunca se usa desde el frontend.** Sólo en Edge
   Functions y scripts de migración.

## Plan de pruebas (Fase 2B)

Cada regla necesita un test que intente el acceso indebido **contra la API
REST con un JWT de ese rol**, no a través de la UI. Casos mínimos:

| # | Escenario | Resultado esperado |
|---|---|---|
| 1 | Cliente A pide `sales_orders` de Cliente B por id directo | 0 filas |
| 2 | Distribuidor A lista `customers` | Sólo su propia fila |
| 3 | Distribuidor pide `product_costs` | 0 filas |
| 4 | Vendedor 1 pide `quotes` de la cartera del vendedor 2 | 0 filas |
| 5 | Usuario de Buscatools pide productos de Torquetools | 0 filas |
| 6 | Técnico intenta `UPDATE` de una orden no asignada | 0 filas afectadas |
| 7 | Cualquiera intenta `DELETE` en `stock_movements` | Error de política |
| 8 | Cualquiera intenta `INSERT` en `audit_events` | Error de política |
| 9 | Cliente pide `wa_conversations` | 0 filas |
| 10 | Usuario sin membresía activa pide cualquier tabla | 0 filas |

**Ninguna de estas pruebas pasa por el navegador.** Se hacen con `curl` o
con el cliente de Supabase autenticado como cada rol, porque el punto es
verificar que la base rechaza, no que la UI oculta.
