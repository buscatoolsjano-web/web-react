# Resultados de pruebas — Fase 2B · Etapa 1

Ejecutadas el **2026-09-08** sobre `uaxcfufvapzulqvynanp`.

## Resumen

| Suite | Pruebas | PASS | FAIL |
|---|---:|---:|---:|
| RLS | 36 | **36** | 0 |
| Stock | 15 | **15** | 0 |
| Búsqueda | 11 | **11** | 0 |
| Atributos | 5 | **5** | 0 |
| Precios | 4 | **4** | 0 |
| Diagnóstico | 1 | 1 | 0 |
| **TOTAL** | **72** | **72** | **0** |

Se planificaron 41 pruebas; se ejecutaron 72 porque varias se
descompusieron en casos concretos. **Faltan 5**, que necesitan usuarios
externos y quedan pendientes (ver el final).

## Cómo se probó RLS sin contraseñas

`execute_sql` del MCP corre como `supabase_read_only_user`, que tiene
**`rolbypassrls = true`**: por esa vía RLS nunca se evalúa. Y no puede
hacer `SET ROLE`.

Las pruebas se ejecutan con un harness (`app.as_user`) que reproduce
**exactamente lo que hace PostgREST** al atender a un usuario autenticado:

```sql
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<uuid del usuario>","role":"authenticated"}';
```

`auth.uid()` lee `request.jwt.claims ->> 'sub'`, así que las políticas se
evalúan por el mismo camino de código que en producción.

**Lo que esto cubre:** la evaluación completa de las políticas RLS y de los
`GRANT`/`REVOKE`, que es donde vive la seguridad.
**Lo que no cubre:** la capa HTTP de PostgREST (parseo de query params,
validación del JWT). Eso se verifica en Fase 3, cuando la app real
consulte con sesiones reales.

**No se pidieron ni se usaron contraseñas**, y no se creó ningún usuario.

## Usuarios de prueba

Los 5 reales que ya existían, con el mapeo que definiste. `profiles` se
creó solo por el trigger `on_auth_user_created` — **5 usuarios, 5 perfiles,
0 huérfanos, 0 duplicados**.

| Nombre | Rol | Empresa |
|---|---|---|
| Admin | `admin` | Buscatools |
| Juan | `admin` | Buscatools |
| Jano | `admin` | Buscatools |
| Norberto | `employee` | Buscatools |
| Facundo | `salesperson` | Buscatools |

---

## RLS — 36 pruebas

### Sin membresía y anon (24) — ejecutadas ANTES de asignar membresías

Aprovechando la ventana en la que la base tenía **0 memberships**, tal como
propusiste. No hizo falta crear ninguna cuenta descartable.

| # | Prueba | Esperado | Obtenido | R |
|---|---|---|---|---|
| 7 | Sin membresía no ve `companies`, `company_memberships`, `customers`, `brands`, `product_categories`, `product_attribute_definitions`, `products`, `warehouses`, `stock_movements`, `stock_balances`, `stock_reservations`, `price_lists`, `product_prices` (13 tablas) | 0 en cada una | 0 en las 13 | ✅ |
| 7b | Sin membresía ve **sólo su propio perfil** | 1 | 1 | ✅ |
| 7c | Monedas visibles para cualquier autenticado | 3 | 3 | ✅ |
| 8 | `anon` no lee `products`, `customers`, `companies`, `profiles`, `product_prices`, `stock_balances`, `currencies` (7 tablas) | error de permisos | `permission denied` en las 7 | ✅ |
| 9 | `anon` no puede insertar en `companies` | error | `permission denied` | ✅ |
| 9b | `anon` no puede insertar en `products` | error | `permission denied` | ✅ |

### Con roles internos (12)

| # | Prueba | Esperado | Obtenido | R |
|---|---|---|---|---|
| 1 | Admin ve los 216 productos | 216 | 216 | ✅ |
| 1b | Admin ve los 3 clientes | 3 | 3 | ✅ |
| 1c | Admin ve los 50 saldos de stock | 50 | 50 | ✅ |
| 2 | Admin BT **no** ve la empresa Torquetools | 0 | 0 | ✅ |
| 2b | Admin BT **no** ve las listas de precios de TT | 0 | 0 | ✅ |
| 2c | Admin BT **no** ve el depósito de TT | 0 | 0 | ✅ |
| 3 | Vendedor ve **sólo su cartera** (1 de 3 clientes) | 1 | 1 | ✅ |
| 3b | Vendedor sí ve todo el catálogo | 216 | 216 | ✅ |
| 12 | Nadie borra clientes (sin política de DELETE) | 0 filas | 0 | ✅ |
| 13 | Vendedor **no** puede crear productos | error de política | `new row violates row-level security policy` | ✅ |
| 13b | Empleado **sí** puede (contraprueba) | 1 | 1 | ✅ |
| 14 | Un usuario no edita el perfil de otro | 0 filas | 0 | ✅ |

---

## Stock — 15 pruebas

Producto de prueba: `SP.S23-BH6`, sin stock previo.

| # | Prueba | Esperado | Obtenido | R |
|---|---|---|---|---|
| S1 | **IN**: `opening_balance` +100 | on_hand 100 | 100.000 | ✅ |
| S2 | **OUT**: `sale_delivery` −30 | 70 | 70.000 | ✅ |
| S3 | **ADJUSTMENT** −5 | 65 | 65.000 | ✅ |
| S4 | **RESERVATION** 20: sube `reserved`, **no toca** `on_hand` | 65 / 20 | 65.000 / 20.000 | ✅ |
| S4b | Vista `product_availability`: booleano, no cantidad | true | true | ✅ |
| S5 | **RELEASE**: `reserved` vuelve a 0, `on_hand` intacto | 65 / 0 | 65.000 / 0.000 | ✅ *(tras corregir un bug — ver abajo)* |
| S5b | Reserva de 45 sobre 65 disponibles | reserved 45 | 45.000 | ✅ |
| S5c | RELEASE de 45: ciclo completo | 65 / 0 | 65.000 / 0.000 | ✅ |
| S6 | **`UPDATE stock_balances`** desde el cliente | error | `permission denied for table stock_balances` | ✅ |
| S7 | **`DELETE stock_movements`** (como admin) | error | `permission denied for table stock_movements` | ✅ |
| S7b | **`UPDATE stock_movements`** (como admin) | error | `permission denied for table stock_movements` | ✅ |
| S8 | `SUM(movimientos)` = `SUM(saldos)` | consistente | consistente | ✅ |
| S9 | Movimiento con `quantity = 0` | error de CHECK | violación de CHECK | ✅ |
| S10 | Reserva negativa | error de CHECK | violación de CHECK | ✅ |
| S11 | `movement_type` no declarado | error de CHECK | violación de CHECK | ✅ |

**Ni siquiera el admin puede tocar `stock_balances` ni modificar un
movimiento.** El saldo sólo lo escribe el trigger.

---

## Precios — 4 pruebas

| # | Prueba | Esperado | Obtenido | R |
|---|---|---|---|---|
| P1 | Interno ve las 3 listas | 3 | 3 | ✅ |
| P1b | Interno ve los 372 precios (124 × 3) | 372 | 372 | ✅ |
| P4 | El mismo producto con 3 precios distintos (`TE.9504`) | 593,37 / 504,36 / 474,70 | idénticos | ✅ |
| P6 | Dos listas por defecto en una empresa | error | violación de índice único | ✅ |

---

## Atributos — 5 pruebas

| # | Prueba | Esperado | Obtenido | R |
|---|---|---|---|---|
| A1 | Clave declarada (`encastre`) | acepta | 1 | ✅ |
| A2 | Clave **no** declarada (`inventado`) | error nombrando la clave | `Atributos no declarados … inventado` | ✅ |
| A3 | `attributes = {}` | acepta, sin consulta extra | 1 | ✅ |
| A4 | Una clave inválida invalida todo el INSERT | error | `… colorFavorito` | ✅ |
| A5 | `min_kg` (declarado `number`) con texto | **se acepta** | 1 | ✅ |

### ⚠️ Limitación documentada (A5)

**La Etapa 1 valida que la clave esté declarada, NO que el valor respete
su `data_type`.** `{"min_kg": "esto es texto"}` se acepta.

Es deliberado: pediste no agregar lógica extra al trigger sin necesidad
demostrada. Validar tipos exigiría un `CASE` sobre `data_type` con
casteos, y la validación de tipo corresponde más naturalmente a Zod en el
borde de la aplicación. **Si en Fase 3 aparece un caso real de dato mal
tipado, se agrega entonces.**

---

## Búsqueda — 11 pruebas

| # | Prueba | Esperado | Obtenido | R |
|---|---|---|---|---|
| B1 | SKU exacto | 1 | 1 | ✅ |
| B2 | Nombre parcial `%balanceador%` | >0 | 20 | ✅ |
| B3 | **Tipeo** `'2520 8B'` encuentra `SP.2520/8B` | SP.2520/8B | SP.2520/8B | ✅ *(tras corregir el search_path)* |
| B3b | Tipeo en el nombre: `balansiador` | >0 | 20 con `word_similarity > 0.4` | ✅ |
| B3c | `similarity()` resoluble desde `authenticated` | numérico | 0.727 | ✅ |
| B4 | Texto libre `'balanceador tecna'` | >0 | 13 | ✅ |
| B5 | Filtro por marca TECNA | >0 | 13 | ✅ |
| B6 | Filtro por categoría balanceador | >0 | 20 | ✅ |
| B6c | Filtro por atributo JSONB (`encastre`) | >0 | 15 | ✅ |
| B7 | `balanceadór` (con acento) encuentra lo mismo | >0 | 20 | ✅ |
| B8 | **`pgvector` NO instalado** | 0 | 0 | ✅ |

### Tiempos (216 productos)

| Consulta | Filas | ms |
|---|---:|---:|
| Filtro atributo JSONB | 15 | **0,11** |
| Nombre parcial ILIKE | 20 | **0,59** |
| SKU exacto | 1 | **0,70** |
| Trigram `word_similarity` | 20 | **2,02** |
| Full-text `tsvector` | 13 | **3,20** |
| Join marca + categoría | 13 | **4,77** |

Como acordamos, **no se marca ningún test como fallo por elegir Seq Scan**:
con 216 filas Postgres decide correctamente. Lo verificado es que los
índices existen y que las consultas son las que van a escalar. Los planes
reales se vuelven a medir con los 21.772 productos.

### 🔎 Hallazgo para la implementación de búsqueda en Fase 3

1. El operador `%` (`similarity`) compara **la cadena completa**. En
   nombres largos como `TECNA 9504 - BALANCEADOR DE 40 A 50 KG`, buscar
   una sola palabra se diluye y no matchea.
2. El adecuado es `%>` (`word_similarity`), que compara contra la mejor
   palabra. Pero su umbral por defecto es **0.6**, y `balansiador` vs
   `BALANCEADOR` puntúa **0.5**: tampoco matchea.

**Recomendación:** en el service de búsqueda, filtrar explícitamente con
`word_similarity(q, name) > 0.4` y `ORDER BY word_similarity(...) DESC
LIMIT n`, en vez de depender del umbral global. Es lo que devolvió los 20
resultados correctos.

---

## Problemas encontrados y corregidos

### 1. 🔴 El RELEASE de reservas estaba roto (prueba S5)

**Síntoma:** liberar una reserva no bajaba `reserved`; quedaba trabada.

**Diagnóstico:** primero sospeché de la política RLS. El registro D1 lo
descartó ejecutando el `DELETE` como `postgres`, sin RLS de por medio: el
error real era

```
new row for relation "stock_balances" violates check constraint
"chk_reserved_non_negative"
```

**Causa raíz:** el trigger usaba `INSERT … ON CONFLICT DO UPDATE` con un
delta que en el RELEASE es negativo. **PostgreSQL evalúa los `CHECK` sobre
la fila propuesta *antes* de resolver el conflicto**, así que una fila con
`reserved = -20` violaba la restricción aunque el resultado del UPDATE
hubiera sido 0.

**Corrección:** el upsert sólo tiene sentido en el alta (la fila de saldo
puede no existir). En la baja la fila existe por definición, así que va un
`UPDATE` directo. Migración `fix_apply_stock_reservation_negative_delta`.

> Este bug habría llegado a producción y habría dejado stock reservado sin
> poder liberarse. Lo encontró la prueba.

### 2. 🟠 La búsqueda por tipeo quedó rota al mover las extensiones (prueba B3)

Al corregir el advisor de Supabase moviendo `pg_trgm` y `unaccent` de
`public` a `extensions`, el operador `%` y las funciones `similarity()` y
`unaccent()` quedaron **fuera del `search_path` de `authenticated`**, que
es `"$user", public`.

La app, que se conecta como `authenticated`, no habría podido resolver
`sku % 'texto'`.

**Corrección:** `ALTER ROLE authenticated|anon|service_role SET search_path
= "$user", public, extensions`. Los índices GIN no se vieron afectados
porque se crearon calificando el operador (`extensions.gin_trgm_ops`).

### 3. 🟠 Nueve marcas inventadas en el seed

El seed del Bloque 8 incluía ATLAS COPCO, DESOUTTER, CLECO, STANLEY,
BOSCH, MAKITA, METABO, DEWALT y MILWAUKEE. **No existen en el catálogo
legacy: las supuse.** Faltaban las 9 reales: BR, RIVIT, TO, GE, NA, KI,
KOKEN, SI, MI.

Corregido contra el dato real. Las 25 marcas cargadas ahora coinciden
exactamente con las del catálogo.

> Nota de calidad: BR, TO, GE, NA, KI, SI y MI tienen 2 productos cada una
> y parecen nombres truncados en el legacy. Se cargaron **tal cual** (el
> dato real manda) y quedan como cola de trabajo de CATALOG DATA CLEANUP.

### 4. 🟢 `stock_movements` aceptaba `UPDATE` en silencio

Sin política de UPDATE/DELETE, RLS deniega pero devuelve *"0 filas
afectadas"* sin error. Se agregó `REVOKE` para que falle explícitamente
(migración `stage1_block7b`).

### 5. 🟢 `PUBLIC` conservaba `EXECUTE` en las funciones `SECURITY DEFINER`

Detectado en la validación estática, **antes** de ejecutar. Corregido en
el Bloque 5.

### 6. 🟢 Extensiones instaladas en `public`

Detectado por el advisor de Supabase. Movidas a `extensions`, recreando
los 5 índices GIN. Advisor re-ejecutado: hallazgo resuelto. *(Este arreglo
causó el problema 2.)*

---

## Estado final de los datos

| | |
|---|---|
| Productos | **216** (0 restos de prueba) |
| — sin marca | 53 (25%) |
| — a revisar (`needs_review`) | 175 (81%) |
| — con atributos | 124 |
| Marcas / categorías / tipos | 25 / 8 / 21 |
| Precios | 372 (124 × 3 listas) |
| Movimientos de stock | 53 · Saldos: 51 · Reservas: 0 |
| Clientes de prueba | 3 (datos inventados, no reales) |
| Usuarios / membresías | 5 / 5 |
| **Tamaño de la base** | 10.203 kB → **13 MB** |

---

## Pendiente: 5 pruebas que necesitan usuarios externos

| # | Prueba | Necesita |
|---|---|---|
| 4 | Cliente ve únicamente sus propios datos | usuario `customer` |
| 5 | Distribuidor ve sólo su lista de precios | usuario `distributor` |
| 5b | Distribuidor **no** ve las otras listas | idem |
| 10 | Manipular la request no saltea RLS (`?id=eq.<otro>`) | usuario `customer` |
| 11 | Distribuidor pide `stock_balances` → 0 filas | usuario `distributor` |

Los datos ya están listos: *Cliente Demo* (lista Especial), *Distribuidor
Demo* (lista Distribuidores) y *Otro Cliente* (lista base) existen, con
precios diferenciados cargados.

---

## Limpieza pendiente antes de producción

El harness de pruebas (`app.as_user`, `app.as_anon`, `app.test_results`)
hace `SET ROLE` y **debe eliminarse** cuando terminen las pruebas de la
etapa. Hoy tiene `REVOKE ALL` para `PUBLIC`, `anon` y `authenticated`:
sólo `postgres` puede invocarlo. Se mantiene únicamente porque faltan las
5 pruebas de arriba.
