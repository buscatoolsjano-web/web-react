# FASE 2B · ETAPA 1 — Core, Catálogo, Stock y Precios

> **PROPUESTA — nada ejecutado.**
> El schema `public` de `uaxcfufvapzulqvynanp` sigue vacío (verificado).
> SQL completo en [`STAGE_1_SCHEMA.sql`](STAGE_1_SCHEMA.sql).

---

## 1. Revisión de simplificación

### Corrección previa

En el informe de Fase 2 dije **38 tablas**. Al contarlas en el DDL son
**58**. Conté los dominios por encima y subestimé el total. Con la
revisión de abajo quedan **51**.

### Método

Para cada tabla candidata a fusión busqué **evidencia en el legacy**: si el
sistema real no distingue el caso, la tabla es especulación.

### Se eliminan 7 tablas

#### 1. `roles` → columna `text` con `CHECK`

`roles` era una tabla de lookup. Pero **agregar un rol exige escribir
políticas RLS nuevas**, o sea un deploy: es un valor definido por el
código, no algo que un admin administre. Mantenerlo como tabla
contradecía mi propia regla de la sección V ("tabla de lookup sólo para lo
que el usuario administra sin deploy").

#### 2, 3, 4. `permissions` + `role_permissions` + `membership_permissions` → columna `allowed_sections text[]`

Evidencia del legacy:

```js
const PERM_SECCIONES = ['catalogo','clientes','ventas','mantenimientos',
  'facturacion','compras','importacion','agenda','informes','finanzas',
  'crm','chat','emails','whatsapp'];
```

La granularidad real que usa el negocio son **14 flags de sección por
usuario**, no permisos CRUD finos tipo `sales.quote.create`. Tres tablas
para modelar eso es sobre-ingeniería.

`company_memberships.allowed_sections text[]` (NULL = las del rol) hace lo
mismo con una columna, y es literalmente lo que hoy guarda
`erp_user_perms`.

> Si algún día hace falta granularidad fina de verdad, se agrega entonces,
> con el caso de uso a la vista. Hoy no existe.

#### 5. `customer_sales_reps` → columna `customers.salesperson_id`

Busqué evidencia de varios vendedores por cliente y no la hay: `vendedor`
es un valor único en oportunidades y documentos. Era una relación N:N sin
caso de uso. Pasa a ser una FK.

#### 6. `wa_message_files` → columna `wa_messages.file_id`

El DDL del legacy lo dice: `media_id`, `media_nombre` — **singular**. Un
mensaje de WhatsApp tiene como mucho un archivo. Una tabla de enlace para
una relación 1:1 es puro costo.

#### 7. `wa_conversation_assignments` → cubierto por `audit_events`

Era historial de asignaciones. `audit_events` ya registra
`{"assigned_to": {"from": ..., "to": ...}}`. El legacy ni siquiera tiene
historial de asignaciones: la tabla era especulación.

### Se simplifica sin eliminar

**`email_attachments`** duplicaba `filename`, `mime_type` y `size_bytes`,
que ya están en `files`. Queda como enlace puro
(`email_message_id`, `file_id`) más el orden.

### Se mantienen, con la razón

| Tabla | Por qué NO se fusiona |
|---|---|
| `currencies` | 3 filas, pero da integridad referencial y metadatos (símbolo, decimales). Un admin puede agregar una moneda sin deploy |
| `customer_contacts` / `customer_addresses` | Los datos reales son N:N: 877 clientes tienen `emails[]`, y facturación ≠ entrega |
| `product_costs` separada de `products` | **Seguridad.** Es lo que permite negarle el costo a un distribuidor con una política, en vez de confiar en que ningún `SELECT` se olvide |
| `stock_balances` separada de `products` | Hay múltiples depósitos: el saldo es por producto **y** depósito |
| `stock_reservations` | Una reserva no altera `on_hand`. Meterla como movimiento rompería el significado del saldo |
| `product_equivalences` | 1.694 productos tienen equivalencias con la competencia. Es una funcionalidad |
| `product_components` | Los kits ya existen en el legacy; con tabla propia se puede consultar "qué kits contienen esta pieza" |
| `maintenance_order_steps` | **La más discutible.** Son 5 etapas fijas y podrían ser columnas. Se mantiene porque hace falta *quién y cuándo* por etapa para medir tiempos de taller. **A revisar en Fase 6 con la operación real a la vista** |
| `sales_invoice_items` | Una factura puede consolidar varias notas de entrega |
| `product_files` / `maintenance_files` | Tienen atributos propios (`role`, `position`): son entidades, no enlaces puros |

**Resultado: 58 → 51 tablas.** No reduje por reducir: cada eliminación
está respaldada por ausencia de evidencia en el sistema real.

---

## 2. Tablas de la Etapa 1 — 15

| # | Tabla | Por qué está en esta etapa |
|---|---|---|
| 1 | `currencies` | FK de `price_lists` y `companies` |
| 2 | `companies` | Base del multiempresa |
| 3 | `profiles` | 1:1 con `auth.users` |
| 4 | `company_memberships` | **El corazón de RLS** |
| 5 | **`customers`** | ⚠️ **Agregado a tu lista** — ver abajo |
| 6 | `brands` | Filtro de catálogo |
| 7 | `product_categories` | Filtro de catálogo |
| 8 | `product_attribute_definitions` | Valida `products.attributes` |
| 9 | `products` | El objeto de la prueba |
| 10 | `warehouses` | FK de stock |
| 11 | `stock_movements` | Fuente de verdad |
| 12 | `stock_balances` | Saldo eficiente |
| 13 | **`stock_reservations`** | ⚠️ **Agregada** — sin ella no se pueden probar RESERVATION y RELEASE, que pediste explícitamente |
| 14 | `price_lists` | Prueba de precios diferenciales |
| 15 | `product_prices` | Idem |

### Las dos adiciones a tu lista, justificadas

**`customers`** — sin esta tabla **no se puede probar ningún rol externo.**
`company_memberships.customer_id` apunta a ella, y sin ese vínculo las
pruebas 4 y 5 (*"cliente ve únicamente sus propios datos"*, *"distribuidor
ve precios permitidos"*) no se pueden escribir: no hay forma de saber qué
cliente **es** el usuario.

**`stock_reservations`** — pediste probar `RESERVATION` y `RELEASE`. Una
reserva no es un movimiento (no cambia `on_hand`, cambia `reserved`), así
que necesita su tabla.

### Tablas de roles y permisos: **ninguna**

Pediste que demostrara cuáles hacen falta. La respuesta es **ninguna**:

- `role` es una columna con `CHECK` (justificación arriba).
- `allowed_sections text[]` cubre la granularidad real del legacy.
- Las 10 pruebas de RLS se resuelven **todas** con el rol. Ninguna
  necesita permisos finos.

### No se crean en esta etapa

Ventas, Compras, Mantenimiento, WhatsApp, Emails, IA, auditoría,
`files`, `product_files`, `product_costs`, `product_components`,
`product_equivalences`, `customer_contacts`, `customer_addresses`.

> **Nota sobre `files`:** las imágenes de producto no hacen falta para
> validar arquitectura, seguridad ni búsqueda. Los 216 productos de prueba
> se cargan **sin imágenes**; `files` + `product_files` entran en Fase 3,
> junto con la UI del catálogo que las necesita.

---

## 3. Orden de ejecución

Ocho bloques, cada uno una migración independiente y re-ejecutable:

| # | Bloque | Contenido |
|---|---|---|
| 1 | Extensiones | `pg_trgm`, `unaccent`, schema `app` |
| 2 | Tablas base | `currencies`, `companies`, `profiles` |
| 3 | Clientes, membresías, catálogo | `customers` → `company_memberships` → `brands`, `product_categories`, `product_attribute_definitions`, `products` |
| 4 | Stock y precios | `warehouses`, `stock_movements`, `stock_balances`, `stock_reservations`, `price_lists`, `product_prices` + FK diferida |
| 5 | Funciones | Las 7 auxiliares de RLS |
| 6 | Triggers | `updated_at`, perfil automático, validación de atributos, saldos |
| 7 | RLS | `ENABLE` en las 15 + 26 políticas + `REVOKE` a `anon` |
| 8 | Seeds | Monedas, 2 empresas, depósitos, 4 listas, 8 categorías, 25 marcas, 22 definiciones de atributos |

**Dos dependencias de orden que importan:**

- `customers` **antes** de `company_memberships` (la membresía externa
  apunta al cliente).
- `price_lists` **después** de `customers`, así que
  `customers.default_price_list_id` se agrega como FK diferida al final
  del bloque 4.

---

## 4. Decisiones técnicas de esta etapa

### Cómo se evita la recursión infinita en RLS

La política de `company_memberships` necesita saber si el usuario es admin
de esa empresa — y eso se consulta en `company_memberships`. Sin cuidado,
es recursión infinita.

**Solución:** las 7 funciones auxiliares son `SECURITY DEFINER`, o sea que
corren como su dueño (`postgres`) y **no disparan RLS**. Además son
`STABLE`, así que Postgres las evalúa una vez por consulta y no una vez
por fila — sin eso, cada `SELECT` sobre 21.772 productos haría 21.772
consultas a `company_memberships`.

### Cómo se protege `stock_balances`

Tres capas:

1. **Sin políticas de escritura.** Con RLS activo, ausencia de política =
   denegado.
2. **`REVOKE INSERT, UPDATE, DELETE ... FROM authenticated`** —
   defensa en profundidad.
3. El trigger que lo mantiene es `SECURITY DEFINER`: escribe sin
   necesitar permisos del usuario.

`stock_movements` no tiene políticas de `UPDATE` ni `DELETE` **para
nadie, incluido admin**. Corregir un movimiento es crear el
contramovimiento.

### Cómo se valida `attributes` sin lógica compleja

Un `CHECK` de Postgres no puede consultar otra tabla, así que la única
forma de hacerlo cumplir en la base es un trigger. El que propongo es
**una sola consulta**:

```sql
SELECT array_agg(k) INTO invalidas
FROM jsonb_object_keys(NEW.attributes) AS k
WHERE NOT EXISTS (
  SELECT 1 FROM product_attribute_definitions d
  WHERE d.company_id = NEW.company_id AND d.key = k
);
```

Si hay claves no declaradas, el `INSERT` falla con el nombre de las claves
ofensoras. Sin recorridos, sin bucles.

**Costo:** una consulta extra por escritura de producto. En la importación
masiva de 21.772 productos se desactiva el trigger y se valida en una sola
consulta al final. Lo dejo documentado en el plan de carga.

### Un usuario externo no ve cantidades exactas

`stock_balances` está denegado a clientes y distribuidores. Para que
igual sepan si hay stock, se crea la vista `product_availability`, que
expone `is_available boolean` en vez del número. Se creó con
`security_invoker = true` para que herede las políticas de quien la
consulta.

---

## 5. Dataset de prueba

### Productos: 216, verificados

Generados con [`scripts/sample-products.mjs`](../../scripts/sample-products.mjs)
(determinista y reproducible). **Ya lo corrí** sobre los 21.772 productos
reales; ésta es la composición:

| Característica | Muestra | Catálogo real | ¿Representativo? |
|---|---|---|---|
| Sin precio | 43% | 43,7% | ✅ |
| Sin marca | 25% | 25,0% | ✅ |
| Categoría `otros` | 43% | 57,8% | ✅ sobre-representado a propósito |
| Con stock | 23% | 1,7% | ⚠️ **sobre-representado a propósito**: sólo hay 378 en todo el catálogo y hacen falta para probar stock |
| Con imágenes | 53% | 34,6% | (no se cargan en esta etapa) |
| Marcas distintas | **25 de 25** | 25 | ✅ cobertura total |
| Categorías | **8 de 8** | 8 | ✅ cobertura total |
| Tipos de producto | 21 | 41 | ✅ |

Cumple tu requisito: **no son productos "limpios"**. El 43% no tiene
precio, el 25% no tiene marca y el 43% cae en `otros`.

### Usuarios: 7

Uno más que los 6 que pediste — el séptimo es necesario para la prueba 7.

| # | Usuario | Membresías |
|---|---|---|
| 1 | `admin@test.buscatools` | **admin** en Buscatools |
| 2 | `vendedor1@test.buscatools` | **salesperson** en Buscatools + **admin** en Torquetools |
| 3 | `empleado@test.buscatools` | **employee** en Buscatools |
| 4 | `tecnico@test.buscatools` | **technician** en Buscatools |
| 5 | `distribuidor@test.buscatools` | **distributor** en Buscatools → *Distribuidor Demo* |
| 6 | `cliente@test.buscatools` | **customer** en Buscatools → *Cliente Demo* |
| 7 | `sinmembresia@test.buscatools` | **ninguna** — prueba 7 |

El usuario 2 es la prueba en vivo de tu requisito: **un `auth.users.id`
con rol distinto en cada empresa, sin duplicar el usuario.**

### Clientes: 3

*Cliente Demo* (lista Especial) · *Distribuidor Demo* (lista
Distribuidores) · *Otro Cliente* (lista base — sirve para probar que
Cliente Demo no lo ve).

### Precios: 3 listas

Base (todos) · Distribuidores · Especial Cliente Demo.

### ⚠️ Paso manual tuyo

**No puedo crear usuarios de Supabase Auth**: requiere la `service_role`
key o el Dashboard, y no manejo credenciales. Los 7 usuarios los tenés que
crear vos en **Authentication → Users → Add user** (con contraseña, sin
confirmación por email).

El trigger `on_auth_user_created` crea el `profile` solo. Después yo corro
el script que asigna membresías y clientes.

---

## 6. Casos de prueba

### 6.1 RLS — las 10 que pediste

Todas se ejecutan **contra la API REST con el JWT de cada rol**, no por la
UI. El punto es verificar que la base rechaza, no que la pantalla oculta.

| # | Prueba | Cómo | Esperado |
|---|---|---|---|
| 1 | Admin Buscatools ve todo lo suyo | `GET /products` como admin | 216 productos |
| 2 | Admin Buscatools **no** ve Torquetools | `GET /products?company_id=eq.<TT>` como admin BT | **0 filas** |
| 2b | El usuario 2 sí ve ambas | `GET /companies` como vendedor1 | **2 filas** |
| 3 | Vendedor ve sólo su cartera | `GET /customers` como vendedor1 | Sólo los suyos, no los 3 |
| 4 | Cliente ve únicamente lo propio | `GET /customers` como cliente | **1 fila** (Cliente Demo) |
| 5 | Distribuidor ve su lista | `GET /price_lists` como distribuidor | **1 fila** (Distribuidores) |
| 5b | Distribuidor **no** ve otras listas | `GET /product_prices?price_list_id=eq.<Especial>` | **0 filas** |
| 6 | Técnico *(cuando llegue Mantenimiento)* | — | Diferido a Fase 6 |
| 7 | Sin membresía no accede | `GET /products` como usuario 7 | **0 filas** en todas las tablas |
| 8 | Anon no lee | `GET /products` con la anon key sin JWT | **0 filas / 401** |
| 9 | Anon no escribe | `POST /products` con la anon key | **Error de política** |
| 10 | Manipular la request no saltea RLS | `GET /customers?id=eq.<otro>` como cliente | **0 filas** |

Pruebas adicionales que agrego:

| # | Prueba | Esperado |
|---|---|---|
| 11 | Distribuidor pide `stock_balances` | **0 filas** (sólo ve `product_availability`) |
| 12 | Cliente intenta `UPDATE` de un producto | 0 filas afectadas |
| 13 | Vendedor intenta `INSERT` en `products` | Error de política |

### 6.2 Stock

| # | Prueba | Esperado |
|---|---|---|
| S1 | `IN`: `opening_balance` +100 | `on_hand = 100` |
| S2 | `OUT`: `sale_delivery` −30 | `on_hand = 70` |
| S3 | `ADJUSTMENT`: −5 | `on_hand = 65` |
| S4 | `RESERVATION`: reservar 20 | `reserved = 20`, `on_hand = 65`, disponible 45 |
| S5 | `RELEASE`: borrar la reserva | `reserved = 0`, disponible 65 |
| S6 | **`UPDATE stock_balances` desde el cliente** | **Error de permisos** |
| S7 | **`DELETE stock_movements` como admin** | **Error de política** |
| S8 | Consistencia | `SUM(movements) = stock_balances.on_hand` para los 50 productos con stock |
| S9 | `quantity = 0` | Error de `CHECK` |
| S10 | Reserva negativa | Error de `CHECK` |

### 6.3 Precios

| # | Prueba | Esperado |
|---|---|---|
| P1 | Interno ve las 3 listas | 3 filas |
| P2 | Distribuidor ve sólo la suya | 1 fila |
| P3 | Cliente ve sólo la Especial | 1 fila |
| P4 | El mismo producto tiene precio distinto según quién pregunta | Base ≠ Distribuidor ≠ Especial |
| P5 | Precio vencido (`valid_to` pasado) no aparece para externos | 0 filas |
| P6 | Dos listas por defecto en una empresa | Error del índice único |

### 6.4 Atributos

| # | Prueba | Esperado |
|---|---|---|
| A1 | Producto con `{"encastre": "1/4 HEX"}` | OK |
| A2 | Producto con `{"inventado": "x"}` | **Error**: "Atributos no declarados: inventado" |
| A3 | `attributes = '{}'` | OK, sin consulta extra |
| A4 | Filtro `attributes->>'encastre' = '1/4 HEX'` | Usa el índice GIN |

### 6.5 Búsqueda (216 productos)

| # | Prueba | Consulta | Esperado |
|---|---|---|---|
| B1 | SKU exacto | `sku = 'SP.2520/8B'` | 1 fila, por índice único |
| B2 | Nombre parcial | `name ILIKE '%balanceador%'` | Usa trigram |
| B3 | **Error de tipeo** | `sku % '2520 8B'` (similaridad) | Encuentra `SP.2520/8B` |
| B4 | Texto libre | `search_vector @@ plainto_tsquery('spanish','balanceador tecna')` | Ordenado por relevancia |
| B5 | Por marca | `brand_id = <TECNA>` | Usa índice |
| B6 | Por categoría | `category_id = <balanceador>` | Usa índice |
| B7 | Acentos | `unaccent('balanceadór')` | Encuentra los mismos |
| B8 | Sin `pgvector` | `SELECT * FROM pg_extension WHERE extname='vector'` | **0 filas** |

Cada prueba de búsqueda se corre con `EXPLAIN ANALYZE` para confirmar que
usa el índice previsto y no un seq scan.

---

## 7. Fase futura: CATALOG DATA CLEANUP

Como pediste, la limpieza no bloquea la migración. Queda diseñada desde
ahora, con soporte en el schema:

**Dos columnas ya incluidas en Etapa 1:**

- `products.needs_review boolean` — marca los importados sin revisar.
  Índice parcial `WHERE needs_review` para que la cola de trabajo se
  consulte sin costo.
- `product_categories.needs_review boolean` — `otros` entra marcada.

**Alcance de la fase (posterior a Ventas):**

| Trabajo | Volumen real |
|---|---|
| Recategorizar | 12.588 productos en `otros` |
| Completar marcas | 5.456 sin marca |
| Normalizar atributos | Promover a columna las claves que superen el 50% |
| Detectar duplicados | Por `model_code` + `brand_id` y por trigram sobre `name` |
| Cargar precios faltantes | 9.509 sin precio |

**Por qué es seguro hacerlo después:** recategorizar es un `UPDATE` de
`category_id`; completar una marca es un `UPDATE` de `brand_id`. Ninguna
de las dos cosas cambia el schema ni rompe documentos, porque las líneas
guardan snapshot. La arquitectura no queda condicionada por la calidad de
los datos.

---

## 8. Lo que voy a ejecutar cuando apruebes

En este orden, deteniéndome al final:

1. Los 8 bloques de [`STAGE_1_SCHEMA.sql`](STAGE_1_SCHEMA.sql), uno por
   migración.
2. Verificar que las 15 tablas existen y las 15 tienen RLS activo.
3. **Pausa:** vos creás los 7 usuarios en el Dashboard.
4. Asignar memberships y crear los 3 clientes de prueba.
5. Cargar los 216 productos + movimientos de stock + precios en 3 listas.
6. Ejecutar las 13 pruebas de RLS, 10 de stock, 6 de precios, 4 de
   atributos y 8 de búsqueda.
7. Documentar resultados en `STAGE_1_TEST_RESULTS.md`.
8. Corregir lo que falle y volver a probar.
9. **Detenerme.** Ventas no empieza sin tu aprobación.

Todo sobre `uaxcfufvapzulqvynanp`. El Supabase legacy no se toca.
