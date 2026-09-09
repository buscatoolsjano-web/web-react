# El `count` exacto del catálogo tarda 6 s — análisis y propuesta

Estado: **propuesta, sin aplicar.** Ninguna policy fue modificada.

Mediciones crudas en [`medicion-antes.txt`](medicion-antes.txt), reproducibles
con [`scripts/medir-rls-count.mjs`](../../scripts/medir-rls-count.mjs).

---

## El síntoma

El listado del catálogo ([`productos.ts:140`](../../src/modules/catalogo/services/productos.ts)) pide
`{ count: 'exact' }`. Con los 21.772 productos reales:

| rol | listado sin count | count exact solo | listado + count |
|---|---:|---:|---:|
| admin · Buscatools | 216 ms | 1.000 ms | 949 ms |
| salesperson · Torquetools (3 productos) | 215 ms | 254 ms | 227 ms |
| **distributor · Buscatools** | 220 ms | **7.631 ms** | **6.088 ms** |
| **customer · Buscatools** | 206 ms | **6.196 ms** | **5.834 ms** |

`authenticated` tiene `statement_timeout = 8 s`. La mediana del distribuidor
para el count solo es **7,6 s**: no es que esté cerca del límite, es que lo
cruza. Vi un `canceling statement due to statement timeout` real.

El listado **sin** count cuesta 220 ms. Todo el coste está en el count.

---

## La causa

La policy de lectura:

```sql
products_select (PERMISSIVE, SELECT):
  company_id = ANY (app.current_company_ids())
  AND deleted_at IS NULL
  AND (app.is_internal(company_id) OR status = 'active')
```

Las tres funciones auxiliares son `STABLE SECURITY DEFINER` en lenguaje SQL.
La diferencia decisiva entre ellas no es la volatilidad: es **si reciben
argumentos**.

- `app.current_company_ids()` **no toma argumentos**. Postgres la resuelve
  una sola vez por consulta, como InitPlan. Es gratis.
- `app.is_internal(company_id)` **recibe una columna**. No se puede plegar en
  un InitPlan, porque su valor depende de cada fila.

Y hay un segundo factor que agrava lo anterior: **Postgres nunca inlinea una
función `SECURITY DEFINER`**. Una función SQL normal se expande dentro de la
consulta y el planner puede reordenarla, indexarla o cortocircuitarla. Una
`SECURITY DEFINER` es una caja negra con `procost` alto que el planner debe
llamar tal cual.

Resultado medido, expandiendo el cuerpo de `is_internal` a mano para poder ver
el plan:

```
-> Seq Scan on products  (rows=21772)
     SubPlan 1
       -> Limit (actual time=0.002..0.003 rows=1 loops=21772)   ← 21.772 ejecuciones
          Buffers: shared hit=43544
Execution Time: 503 ms
```

Contra el piso, sin la condición de rol:

```
-> Index Only Scan using idx_products_listado  (rows=21772)
     Heap Fetches: 0
     Buffers: shared hit=210
Execution Time: 89 ms
```

Dos daños, no uno:

1. **Buffers 210 → 47.473** (×226). El 92 % son del SubPlan.
2. **El Index Only Scan se degrada a Seq Scan.** El índice parcial
   `idx_products_listado` cubría la consulta entera con `Heap Fetches: 0`; la
   llamada por fila lo inutiliza.

Y esos 503 ms son el **mejor caso**: el de la función expandida. El real
—con la función opaca— es ~6.000 ms. La diferencia, ~5,5 s sobre 21.772
filas, son unos **250 µs por llamada**.

### Por qué el externo paga 6× más que el interno

Porque `products` tiene **dos** policies permisivas y las dos se aplican a los
SELECT:

```sql
products_write (PERMISSIVE, cmd = ALL):
  company_id = ANY (app.current_company_ids())
  AND app.current_role(company_id) = ANY (ARRAY['admin','employee'])
```

`cmd = ALL` incluye SELECT, y las policies permisivas se combinan con OR. Así
que cada fila leída evalúa `products_select OR products_write`, es decir
**dos** funciones con argumento de columna. Para un admin la segunda da
verdadero y el OR corta; para un externo hay que evaluar las dos enteras.

Que el coste es por fila está medido, no supuesto:

| filas escaneadas | admin | distributor |
|---:|---:|---:|
| 3.807 | 438 ms | 1.519 ms |
| 21.772 | 987 ms | 6.083 ms |

Descontando ~250 ms de ida y vuelta de red, da 34 µs/fila para el interno y
268 µs/fila para el externo. Lineal en ambos.

---

## Propuesta

**Hacer que la comprobación de rol no dependa de la fila.**

`app.is_internal(X)` es verdadera exactamente cuando `X` pertenece al conjunto
de empresas donde el usuario tiene un rol interno. Ese conjunto no depende de
la fila: se puede calcular una vez.

Dos funciones nuevas, sin argumentos, con la misma forma que la
`current_company_ids()` que ya funciona bien:

```sql
CREATE FUNCTION app.current_internal_company_ids() RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
  SELECT coalesce(array_agg(company_id), '{}')
  FROM company_memberships
  WHERE user_id = auth.uid() AND status = 'active'
    AND role IN ('admin','employee','salesperson','technician');
$$;

CREATE FUNCTION app.current_writer_company_ids() RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
  SELECT coalesce(array_agg(company_id), '{}')
  FROM company_memberships
  WHERE user_id = auth.uid() AND status = 'active'
    AND role IN ('admin','employee');
$$;
```

Y las policies pasan a ser:

```sql
products_select:
  company_id = ANY (app.current_company_ids())
  AND deleted_at IS NULL
  AND (company_id = ANY (app.current_internal_company_ids()) OR status = 'active')

products_write:
  company_id = ANY (app.current_writer_company_ids())
```

### Por qué es EXACTAMENTE equivalente, no aproximadamente

`app.current_role(p_company)` hace `SELECT role … LIMIT 1`. Un `LIMIT 1` sin
`ORDER BY` sólo es determinista si no puede haber más de una fila. Lo
verifiqué: existe

```
company_memberships_user_id_company_id_key  UNIQUE (user_id, company_id)
```

Con esa restricción hay como mucho una membresía por (usuario, empresa), así
que «el rol de X está en el conjunto interno» y «X está en el conjunto de
empresas con rol interno» son la misma proposición. La reescritura no amplía
ni reduce el acceso de ningún rol.

En `products_write`, `current_writer_company_ids()` es un subconjunto estricto
de `current_company_ids()`, así que la primera condición era redundante y se
puede omitir sin cambiar el resultado.

### Resultado medido de la propuesta

Simulada con el array literal que devolvería cada función:

| caso | plan | buffers | tiempo |
|---|---|---:|---:|
| externo (array vacío) | **Index Only Scan**, `Heap Fetches: 0` | **210** | **8 ms** |
| interno (array con la empresa) | Seq Scan | 3.929 | **27 ms** |

El externo vuelve al piso exacto de 210 buffers. El interno usa Seq Scan
porque puede ver también los inactivos y el índice parcial no aplica, pero 27 ms
sobre un presupuesto de 8 s es margen de sobra.

---

## Las alternativas que descarté, y por qué

**B — un helper `SECURITY DEFINER` con otra forma pero que siga recibiendo
`company_id`.** No sirve. El problema no es *cómo está escrita* la función
sino que **recibe un valor que varía por fila**. Cualquier función con ese
argumento se evalúa por fila, y si además es `SECURITY DEFINER` tampoco se
inlinea. Cambiar el cuerpo no cambia nada.

Una variante de B sí funcionaría —envolver la llamada en un subquery escalar,
`(SELECT app.is_internal(...))`, truco habitual para forzar un InitPlan— pero
sólo cuando el argumento es constante. Acá el argumento es una columna, así
que no aplica.

**C — separar policies para internos y externos.** No reduce nada por sí
solo: las policies permisivas se combinan con OR y **cada una se evalúa por
fila igual**. De hecho el problema actual es precisamente que hay dos policies
y las dos se evalúan. Sumar una tercera lo empeora.

Ahora bien, la propuesta sí **arregla** ese efecto de rebote, porque deja las
dos policies sin funciones con argumento.

**Bajar `procost` de las funciones.** Cambiaría el orden de evaluación, no la
cantidad de llamadas. Y es un parche sobre el planner, no sobre la causa.

**`count: 'planned'`.** Es el fallback, no la solución: da 21.769 en vez de
21.772 y depende de cuándo corrió el último `ANALYZE`. Con la propuesta no
hace falta.

---

## Un hallazgo lateral que conviene decidir aparte

`products_write` es `PERMISSIVE` con `cmd = ALL`, así que **también concede
SELECT**, y su qual **no incluye `deleted_at IS NULL`**. Consecuencia: un
admin o un employee puede leer productos borrados lógicamente, cosa que
`products_select` prohíbe.

Hoy no se nota: hay **0 productos con `deleted_at`** y **0 inactivos**. Es un
efecto latente, no un agujero visible.

La reescritura propuesta lo **conserva tal cual** —no lo arregla ni lo
empeora— porque cambiarlo sería modificar la seguridad, no la performance, y
son dos decisiones distintas. Queda anotado para resolverlo aparte.

---

## Alcance

`is_internal(company_id)` aparece en el qual de **6 policies de SELECT**:

| tabla | filas | ¿se nota? |
|---|---:|---|
| `products` | 21.775 | **sí, es la que rompe** |
| `product_prices` | 12.254 | sí, la lee el catálogo |
| `stock_movements` | ~390 | no con este volumen |
| `stock_balances` | 379 | no |
| `stock_reservations` | 0 | no |
| `price_lists` | pocas | no |
| `warehouses` | pocas | no |

`current_role(company_id)` aparece además en las policies de escritura de
`customers`, `product_prices`, `products` y `stock_reservations`.

Aplicar el cambio a las 6 de SELECT es coherente y del mismo riesgo. Las de
escritura tocan pocas filas por sentencia, así que se pueden dejar.

---

## Qué falta antes de aplicar

1. Tu aprobación de la alternativa.
2. Repetir las mismas mediciones con `scripts/medir-rls-count.mjs`.
3. Regresión de RLS con `admin`, `salesperson`, `customer`, `distributor` y
   `anon`: otra empresa → 0, lista de precios ajena → 0, stock interno para
   externo → 0, inactivos según rol, y `search_products` respetando RLS.
