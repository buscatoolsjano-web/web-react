# RLS y facetas — resultado antes/después

Mediciones crudas: [`medicion-antes-fase36.txt`](medicion-antes-fase36.txt) ·
[`medicion-despues-fase36.txt`](medicion-despues-fase36.txt).
Repetibles con [`scripts/medir-rls-count.mjs`](../../scripts/medir-rls-count.mjs)
(mediana de 3, sesiones reales, clave publicable).

## Distributor · Buscatools · 21.772 productos

| escenario | antes | después | mejora |
|---|---:|---:|---:|
| listado sin count | 203 ms | 208 ms | — |
| **count exact solo** | **6.036 ms** | **230 ms** | **26×** |
| **listado + count exact** | **5.850 ms** | **277 ms** | **21×** |
| search_products | 6.319 ms | 503 ms | 12,6× |
| **facetas sin filtros** | **7.440 ms** | **425 ms** | **17,5×** |
| **facetas con categoría** | **7.009 ms** | **285 ms** | **24,6×** |
| facetas categoría grande (punta) | 7.561 ms | 373 ms | 20,3× |
| **facetas + búsqueda** | **TIMEOUT (8 s)** | **319 ms** | — |
| **facetas 4 filtros combinados** | **TIMEOUT (8 s)** | **992 ms** | — |

Antes: dos escenarios cortaban por `statement_timeout`. Después: **cero
timeouts**, y el peor caso está a 8× del límite.

Admin y customer quedan en los mismos números que el distributor: la
asimetría entre rol interno y externo (6×) desapareció.

## Planes

| consulta | antes | después |
|---|---|---|
| `count(*)` sobre products | Seq Scan + SubPlan `loops=21772`, **47.473 buffers**, 503 ms | **Index Only Scan**, `Heap Fetches: 0`, **210 buffers**, 145 ms |
| faceta de atributos | 818 ms, sin paralelismo | **129 ms** de trabajo real + Parallel Seq Scan |

## El arreglo tuvo DOS mitades, no una

**Mitad 1 — quitar el argumento de columna.** `app.is_internal(company_id)`
y `app."current_role"(company_id)` reciben una columna, así que no se pueden
plegar en un InitPlan, y al ser `SECURITY DEFINER` tampoco se inlinean. Se
reemplazaron por pertenencia a conjuntos calculados por funciones **sin
argumentos**: `current_internal_company_ids()`, `current_writer_company_ids()`,
`current_price_list_ids()`.

Resultado de esa mitad sola: 6.036 → **2.693 ms**. Mejor, pero lejos.

**Mitad 2 — el subquery escalar.** Una función `STABLE` sin argumentos
**tampoco** se evalúa una sola vez: Postgres sólo la pliega en un InitPlan si
aparece dentro de un subquery. Sin eso seguía llamándose por fila. Es la
misma razón por la que Supabase recomienda `(select auth.uid())` en vez de
`auth.uid()`; su linter lo marca como `auth_rls_initplan`.

Se usa `col in (select unnest(f()))` y no `col = any ((select f()))` porque
Postgres interpreta `ANY(subquery)` como la forma de subconsulta y falla con
`operator does not exist: uuid = uuid[]`.

Resultado con las dos mitades: 6.036 → **230 ms**.

> Mi EXPLAIN inicial predijo 8 ms porque simulaba el conjunto con un array
> **literal**. Esa simulación escondía exactamente la mitad 2. El número real
> es 230 ms.

**Tercera corrección, en las facetas.** `app.attrs_match()` costaba 690 ms de
los 818 de la faceta de atributos: se llamaba 28.218 veces incluso sin
filtros de atributo activos, donde devuelve `true` trivialmente. Además, al
no estar marcada `PARALLEL SAFE`, impedía el plan paralelo. Con cortocircuito
y `PARALLEL SAFE`: 1.537 → **425 ms**.

## Misma seguridad

`company_memberships` tiene `UNIQUE (user_id, company_id)`, así que hay como
mucho una membresía por (usuario, empresa) y el `LIMIT 1` de `current_role()`
es determinista. Por eso «el rol del usuario en X es interno» y «X pertenece
al conjunto de empresas donde el usuario es interno» son la misma
proposición. **No se amplió el acceso de ningún rol.**

Verificado con [`scripts/regresion-rls-roles.mjs`](../../scripts/regresion-rls-roles.mjs):
**71 comprobaciones, 0 fallos**, con JWT reales de admin, salesperson,
distributor, customer y anon. Cada prohibición se prueba con un intento real
—leer una fila ajena por su id exacto, insertar donde no corresponde— y sólo
pasa si es RECHAZADO.

## Lo que queda por encima de 500 ms

`facetas 4 filtros combinados`: **992 ms**. Ahí `attrs_match` sí hace trabajo
real (no se puede cortocircuitar) sobre 28.218 pares. Analizado: el coste es
la función, no el plan. Si molesta en uso real, el siguiente paso medible es
un índice GIN `jsonb_path_ops` — pero no se agrega por intuición.

## Lo que NO se tocó, a propósito

`warehouses_select`, `stockbal_select`, `stockmov_select` y
`reservations_select` siguen usando `is_internal(company_id)`. Sus tablas
tienen 379, ~390, 0 y pocas filas: no hay coste medido que justifique el
riesgo. Si alguna crece, se aplica lo mismo.
