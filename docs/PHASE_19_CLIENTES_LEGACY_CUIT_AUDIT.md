# Fase 19 · E3B — El CUIT del sistema anterior como evidencia de migración

Fecha: 2026-09-20. Proyecto: `uaxcfufvapzulqvynanp`.
**Estado: auditoría y propuesta. NO se aplicó nada.**

> `DB_CHANGES_APPLIED = 0` · `PROD_DATA_CHANGED = 0` · `LEGACY_CHANGED = 0`

---

## 1 · La causa

La cola de revisión tiene 40 clientes. **31** están marcados
`CUIT_REPETIDO_EN_LEGACY`: en el sistema anterior el mismo CUIT aparecía en más de
una ficha, así que la migración **no le asignó ninguno a nadie** y dejó la decisión
para una persona.

Lo que quedó en la base nueva es el *motivo*, no la *evidencia*. La tarjeta dice
«El sistema anterior usaba este CUIT en más de una ficha de cliente» y arriba
muestra «sin CUIT»: no puede decir cuál era el CUIT ni con qué otra ficha chocaba,
porque el número nunca se guardó.

## 2 · La fuente (`SOURCE_OF_TRUTH`)

**No hay un Supabase legacy que consultar.** El sistema anterior era una aplicación
de una sola página; su maestro de clientes viaja dentro del propio HTML, en un
bloque `<script id="clientes-data">`. La migración se corrió con:

```
node scripts/fase5-migrar-clientes.mjs <BuscatoolsERP.html> <erp_store.json>
```

El archivo está en `~/Downloads/BUSCATOOLS — Sistema de gestión.html`. Hay tres
exportaciones distintas (2 jul, 3 jul, 14 jul) y **el maestro es byte a byte
idéntico en las tres**, así que la fuente no depende de cuál se tome.

Cada ficha del maestro tiene `ref`, `nj`, `nc`, **`cif`**, `emails`, `doms`. El CUIT
es `cif`.

Los números cierran solos con el código de la migración:

| Medido en el HTML | |
|---|---|
| clientes en el maestro | **988** (el docstring del script dice 988) |
| con `cif` | 590 |
| CUIT distintos | 574 |
| CUIT que aparecen más de una vez | **15** |
| fichas involucradas en esos 15 | **31** |

**31 fichas** en el HTML ↔ **31 clientes** marcados en producción. La coincidencia no
es aproximada: es el mismo conjunto.

Y el código dice exactamente qué se descartó
(`scripts/fase5-migrar-clientes.mjs`):

```js
let cuit = (i.legacy.cif ?? '').trim() || null
if (cuit && (cuitRepetido(i.cuit) || cuitTomado.has(i.cuit))) {
  motivos.push('CUIT_NO_ASIGNADO')
  cuit = null                       // ← acá se perdió el dato
}
```

Lo que se propone guardar es **ese mismo valor**, con la única transformación que la
migración ya le aplicaba: `trim()`. Nada más.

## 3 · Cómo se recupera (determinista, sin adivinar)

Cruce por **`maestro.ref` ↔ `customers.legacy_ref`**, que es la clave de identidad
más fuerte de la propia migración (regla 1 de 5, por encima del CUIT). Cero
similitud de nombres, cero heurística.

```
LEGACY_CUIT_REVIEW_CASES = 31
RECOVERABLE_EXACT        = 31
UNAVAILABLE              = 0
AMBIGUOUS                = 0
```

Ninguna `ref` falta en el maestro y ninguna aparece dos veces con CUIT distinto.

## 4 · La tabla para revisar

`OTROS_ACTUALES` = clientes vigentes cuyo `tax_id` normalizado coincide con ese CUIT.
**Es 0 en los 15 grupos**: la migración no se lo asignó a nadie, así que no hay una
ficha «ganadora» escondida fuera de la cola. Cada conflicto queda enteramente
descrito por las fichas marcadas.

Los 31 tienen hoy `tax_id = NULL`.

| # | LEGACY_REF | NOMBRE | LEGACY_CUIT_RAW | NORMALIZADO | FICHAS | OTROS_ACTUALES | STATUS |
|---|---|---|---|---|---|---|---|
| 1 | CLI00153 | Diaz Girard Patricio Gonzalo | `20-21669342-7` | 20216693427 | 2 | 0 | READY |
| 2 | CLI00605 | Taller Integral AP | `20216693427` | 20216693427 | 2 | 0 | READY |
| 3 | CLI00336 | Jurídico Paulino Roberto Mendoza | `2024652303-8` | 20246523038 | 2 | 0 | READY |
| 4 | CLI00340 | Paulino Roberto Mendoza | `20-24652303-8` | 20246523038 | 2 | 0 | READY |
| 5 | CLI00810 | Mocciaro Juan Manuel Jesus | `20-27089205-2` | 20270892052 | 3 | 0 | READY |
| 6 | CLI00834 | BUSCATOOLS | `20-27089205-2` | 20270892052 | 3 | 0 | READY |
| 7 | CLI01118 | Prubas JMJM a Make | `20-27089205-2` | 20270892052 | 3 | 0 | READY |
| 8 | CLI00127 | Estab. Mecanico O.C.E S.R.L. | `30-50215968-9` | 30502159689 | 2 | 0 | READY |
| 9 | CLI00307 | Establecimiento Mecánico OCE S.R.L. | `30-50215968-9` | 30502159689 | 2 | 0 | READY |
| 10 | CLI00298 | JOSE M. ALLADIO E HIJOS S.A. | `30502680478` | 30502680478 | 2 | 0 | READY |
| 11 | CLI00527 | Mabe Argentina S.A. | `30-50268047-8` | 30502680478 | 2 | 0 | READY |
| 12 | CLI00243 | Embotelladora de Atlantico S.A. | `30-52913594-3` | 30529135943 | 2 | 0 | READY |
| 13 | CLI01077 | COCA COLA KOANDINA | `30529135943` | 30529135943 | 2 | 0 | READY |
| 14 | CLI00341 | Autosal S.A | `30606552390` | 30606552390 | 2 | 0 | READY |
| 15 | CLI00837 | Autosal SA | `30-60655239-0` | 30606552390 | 2 | 0 | READY |
| 16 | CLI00200 | New San S.A. - USHUAIA | `30-64261755-5` | 30642617555 | 2 | 0 | READY |
| 17 | CLI00824 | NEWSAN SA - MOTOS | `30-64261755-5` | 30642617555 | 2 | 0 | READY |
| 18 | CLI00282 | Weg Equipamientos Eléctricos S.A. | `30-66916066-2` | 30669160662 | 2 | 0 | READY |
| 19 | CLI01136 | WEG Equipamientos Eléctricos S.A. – Unidad Córdoba | `30669160662` | 30669160662 | 2 | 0 | READY |
| 20 | CLI00222 | Goldmund S.A. | `30708603879` | 30708603879 | 2 | 0 | READY |
| 21 | CLI01073 | GOLDMUND S.A. - PEABODY | `30-70860387-9` | 30708603879 | 2 | 0 | READY |
| 22 | CLI00124 | Solnik S.A. | `30-70945325-0` | 30709453250 | 2 | 0 | READY |
| 23 | CLI00224 | Solnik S.A (no expo) | `30-70945325-0` | 30709453250 | 2 | 0 | READY |
| 24 | CLI00244 | Fami Store Etami S.R.L. | `30-71187148-5` | 30711871485 | 2 | 0 | READY |
| 25 | CLI00270 | Storage Compat S.A. | `30711871485` | 30711871485 | 2 | 0 | READY |
| 26 | CLI01097 | EXTERNUM INGENIERIA | `30-71750919-2` | 30717509192 | 2 | 0 | READY |
| 27 | CLI01193 | Externum Ingeniería S.R.L. | `30717509192` | 30717509192 | 2 | 0 | READY |
| 28 | CLI00166 | Grupo E.P S.A. | `33-70731251-9` | 33707312519 | 2 | 0 | READY |
| 29 | CLI00556 | GRUPO EP S.A / EPOXIFORMAS | `33-70731251-9` | 33707312519 | 2 | 0 | READY |
| 30 | CLI00728 | Fluid & Power Connection S.R.L. | `33-71159029-9` | 33711590299 | 2 | 0 | READY |
| 31 | CLI01072 | TORQUEAR SA | `33-71159029-9` | 33711590299 | 2 | 0 | READY |

`READY = 31 · UNAVAILABLE = 0 · AMBIGUOUS = 0`

**Leído de corrido, esto ya decide la mayoría de los casos**: Solnik / Solnik (no
expo), Estab. Mecanico O.C.E / Establecimiento Mecánico OCE, WEG / WEG Córdoba,
New San Ushuaia / NEWSAN Motos, Autosal S.A / Autosal SA, Goldmund / Goldmund
Peabody, EXTERNUM / Externum S.R.L., Grupo E.P / Grupo EP Epoxiformas son la misma
empresa escrita dos veces. Los otros siete grupos son decisiones tuyas, no mías.

## 5 · RAW sí, normalizada no (`RAW_VS_NORMALIZED`)

La propia tabla demuestra por qué el crudo importa: el mismo CUIT viene escrito de
tres formas distintas —`20-21669342-7`, `20216693427`, y **`2024652303-8`, que está
mal puesto el guión**—. De los 31, **23 traen separadores y 8 son sólo dígitos**. Si
se normalizara al guardar, esa evidencia de cómo se cargaban los datos se perdería,
que es justo lo que esta columna existe para conservar.

**Recomendación: opción A, `legacy_tax_id_raw text` y nada más.** La comparación se
hace en la consulta con `regexp_replace(x, '\D', '', 'g')`, que es IMMUTABLE y por lo
tanto admitiría una columna generada o un índice de expresión el día que haga falta.
Hoy no hace falta: son 31 filas de 1.010 y ningún plan las recorre en caliente.
Agregar una segunda columna sería duplicar el dato para no ganar nada, y darle a
alguien un valor «limpio» a mano para copiar a `tax_id`.

La condición para pasar a la opción B, escrita para que sea verificable: cuando
haya un uso que filtre o agrupe por CUIT legacy sobre miles de filas y se mida que
el `regexp_replace` domina el plan.

## 6 · El nombre (`RECOMMENDED_COLUMN`)

Propongo **`legacy_tax_id_raw`** en lugar de `legacy_cuit_raw`:

- el esquema está en inglés y el campo vigente se llama `tax_id`, no `cuit`;
- las columnas históricas ya existentes son `legacy_ref`, `legacy_name`,
  `legacy_source`, así que el prefijo `legacy_` es la convención;
- `_raw` es la parte que no se puede perder: es la promesa de que el valor **no está
  normalizado** y de que no es operativo.

Si preferís la palabra local, `legacy_cuit_raw` no rompe nada; es tu decisión y
cambia una línea. Lo que no cambiaría es el `_raw`.

`COLUMN_TYPE = text`, nullable, sin default, sin unique, sin FK, sin NOT NULL, sin
trigger, fuera de cualquier índice de CUIT vigente. Lleva un `comment on column` que
dice en la propia base que no es el CUIT vigente: es lo único que evita que dentro
de seis meses alguien lo copie a `tax_id`.

## 7 · Triggers y efectos laterales

`customers` tiene cuatro triggers que corren en UPDATE:

| Trigger | Qué haría | Riesgo real |
|---|---|---|
| `trg_customers_touch` → `app.touch_updated_at()` | `NEW.updated_at = now()`, **sin condición** | **ALTO.** Movería el testigo de concurrencia de los 31 |
| `trg_cliente_revision` → `app.revisar_motivos_cliente()` | recalcula `review_reason` / `needs_review` | **Nulo, por dos caminos** |
| `trg_91_auditar_estado_cliente` | inserta en `sales_audit` | **Nulo, por dos caminos** |
| `trg_cliente_vendedor` | fija `salesperson_id` | **Nulo** |

```
TRIGGERS_AFFECTED   = 4 (sólo 1 con efecto real)
UPDATED_AT_RISK     = ALTO si no se neutraliza; NULO con la estrategia de abajo
REVIEW_REASON_RISK  = NULO
AUDIT_RISK          = NULO
```

Por qué los tres «nulo» no son una suposición:

- **Revisión.** El trigger arranca con `if auth.role() = 'service_role' then return
  new; end if;`, y la conexión de migración no lleva JWT. Pero además **lo simulé en
  SQL sobre los 31**, reconstruyendo `review_reason` con la misma lógica del trigger:
  **31 de 31 dan idénticos**. Como `tax_id` sigue en NULL, `CUIT_NO_ASIGNADO` y
  `CUIT_REPETIDO_EN_LEGACY` no se pueden dar por resueltos —la condición es
  `length(digitos) = 11`— y el resto de los motivos no los resuelve ningún dato.
- **Auditoría.** `auditar_estado_cliente` sale temprano si `auth.uid() is null`
  (migración: null) y, aun con sesión, sólo escribe cuando cambian `deleted_at` o
  `status`. No cambia ninguno.
- **Vendedor.** Sólo actúa si el rol es `salesperson`. La migración no lo es.

### `SAFE_BACKFILL_STRATEGY`

Una transacción con **`set local session_replication_role = replica`**.

- Apaga los triggers de fila **sólo en esa sesión** y **sólo hasta el commit**: no es
  `alter table ... disable trigger`, así que no es DDL, no toma lock exclusivo y no
  afecta a ninguna otra conexión. Nada queda apagado «a ciegas» ni en forma global.
- No desactiva RLS.
- Requiere un rol que pueda cambiar el parámetro (`postgres`, el que corre las
  migraciones). Si el runner lo rechazara, la alternativa es desactivar dentro de la
  misma transacción **un solo trigger nombrado**, `trg_customers_touch`; es DDL y
  toma un lock breve, por eso es el plan B y no el A.

`ALTER TABLE ... ADD COLUMN` de una columna nullable sin default es metadata-only en
PG 11+: no reescribe la tabla y no dispara triggers de fila. El paso 1 no mueve nada
por sí solo.

## 8 · Backfill (`BACKFILL_ROWS_PROPOSED = 31`, `IDEMPOTENT = sí`)

SQL completo y listo, **sin ejecutar**, preparado en su momento como
`scripts/fase19-e3b-legacy-cuit.sql`. **Ese archivo ya no está**: la sección 15
explica por qué este plan no se pudo aplicar y la 16, qué se aplicó en su lugar.
Conservarlo habría dejado en el repo un SQL que propone una columna que se
descartó.

- Un `UPDATE ... FROM (values ...)` explícito **por UUID**, con las 31 filas escritas
  a mano. Sin `join` por nombre, sin `like`, sin similitud.
- Idempotencia por `and c.legacy_tax_id_raw is null`: la segunda corrida escribe 0
  filas. Y un control previo que cuenta cuántas ya tienen un valor **distinto** al
  propuesto: si no es 0, no se sigue.
- Verificación **antes del commit**, con la transacción abierta, comparando los md5
  contra la baseline. Si no coinciden, `rollback`.

## 9 · Baseline (`BASELINE`, medida el 20/09/2026)

Tiene que quedar **idéntica** después, salvo la columna nueva:

| | |
|---|---|
| `customers` | 1010 (1010 activos) |
| `needs_review` | **40** |
| con `tax_id` | 565 |
| `max(updated_at)` | **2026-09-16 00:01:50.325964+00** |
| md5 de `review_reason` | `661ba49eefdabf55fbf640c4f3a54535` |
| md5 de `tax_id` | `d47cdbe6a6fad70a30dd71a18a6b2a18` |
| md5 de `updated_at` | `accded6d2617819116efcf4141be66fc` |
| `sales_audit` | 2 filas (0 de clientes) |
| cotizaciones / pedidos / entregas | 306 / 172 / 193 |

De los 31 en particular: `updated_at` entre `2026-09-10 00:53:35` y
`2026-09-10 15:34:39`, `needs_review = true`, `tax_id = NULL`. Los tres valores
tienen que quedar exactamente igual.

**Ninguna revisión se resuelve.** La columna agrega evidencia; no decide.

## 10 · Interfaz (diseño, `UI_PROPOSAL` — no implementado)

En `/clientes/revisar`, sólo para el motivo `CUIT_REPETIDO_EN_LEGACY`:

```
Solnik S.A.                                    CLI00124 · sin CUIT

  El sistema anterior usaba este CUIT en más de una ficha de cliente.

  CUIT vigente          Sin CUIT
  CUIT en el sistema    30-70945325-0
  anterior

  Las otras fichas con ese mismo CUIT
    · Solnik S.A (no expo)   CLI00224     [abrir]

  [ Dar por revisado ]   [ Abrir el cliente ]
```

Reglas de esa pantalla:

- si `legacy_tax_id_raw` es NULL, **no se promete nada**: «El CUIT original no quedó
  en los datos migrados.» Hoy ese caso no existe (31 de 31 recuperables), pero la
  pantalla tiene que soportarlo sin mentir;
- el crudo se muestra **tal cual vino**, incluido `2024652303-8`. Si alguien ve un
  guión mal puesto, eso es información, no un error de la pantalla;
- las otras fichas se agrupan por el CUIT **normalizado**, que es lo que las hace
  comparables;
- ningún botón fusiona, elige ganador ni escribe `tax_id`. La pantalla muestra; la
  persona decide.

### Dónde NO se muestra (`SECURITY` / alcance)

`legacy_tax_id_raw` no entra en el listado de clientes, ni en la ficha normal, ni en
cotización, pedido, remito, selector de cliente, impresión, PDF o CSV. Sólo en la
cola de revisión (y, si algún día existe, en un panel de migración). Concretamente:
no se agrega a `SELECT_LISTADO` ni a `SELECT_DETALLE` en
`src/modules/clientes/services/clientes.ts`, sino a la consulta de la cola.

## 11 · Seguridad

- Los permisos de `customers` son **de tabla, no de columna**: `relacl` da
  `authenticated` y `service_role`, y hay **0 columnas con ACL propia**. Una columna
  nueva hereda exactamente la visibilidad de la fila.
- RLS está activa y la cola de revisión lee `customers` por PostgREST con el JWT de
  la persona, así que la política `customers_select` ya decide quién ve qué.
  **No hace falta ninguna RPC nueva**, y por lo tanto no hay ningún
  `security definer` que pudiera devolver CUIT de clientes ajenos.
- `anon` no tiene grant sobre `customers`.

## 12 · Tests propuestos (`TEST_PLAN` — para la implementación, no para ahora)

**Invariantes sobre producción** (lectura, en la suite de scripts):

1. la columna existe, es `text`, nullable, sin default, sin unique, sin FK;
2. exactamente 31 filas con `legacy_tax_id_raw` no nulo, y son las 31 esperadas;
3. las otras 979 siguen en NULL;
4. cada uno de los 31 tiene **el valor crudo exacto** de la tabla de arriba;
5. `needs_review = 40` y el md5 de `review_reason` no se movió;
6. el md5 de `updated_at` y el `max(updated_at)` no se movieron;
7. `sales_audit` sigue en 2 filas, 0 de clientes;
8. ningún `tax_id` cambió (md5);
9. cotizaciones / pedidos / entregas sin cambios;
10. re-ejecutar el backfill escribe 0 filas (idempotencia);
11. el agrupamiento por CUIT normalizado da exactamente 15 grupos y 31 fichas.

**De interfaz** (Vitest, con datos ficticios `ZZ`):

12. con `legacy_tax_id_raw`, la tarjeta muestra el crudo y lista las otras fichas;
13. sin él, muestra «no quedó en los datos migrados» y **no** una comparación vacía;
14. el crudo se muestra sin reformatear (caso `2024652303-8`);
15. ningún botón de la tarjeta escribe `tax_id` ni resuelve la revisión sola;
16. la columna no aparece en el listado, la ficha, los documentos ni el CSV.

**RLS** (con clave anónima y con un usuario de otra empresa): un cliente ajeno no
devuelve fila, así que tampoco su `legacy_tax_id_raw`. Se apoya en la política que
ya existe; el test sólo confirma que la columna nueva no abrió un camino distinto.

## 13 · Rollback (`ROLLBACK`)

Mientras **nada** de la interfaz lea la columna:

```sql
alter table customers drop column legacy_tax_id_raw;
```

Si la cola de revisión ya la muestra, **primero se revierte la interfaz** y después
la columna; al revés la pantalla queda pidiendo un campo que no existe. El `drop`
pierde la evidencia, pero es recuperable: se vuelve a correr el backfill desde el
mismo HTML, que es inmutable.

## 14 · Lo que falta

```
NEXT_ACTION = esperar aprobación de Juan para aplicar columna + backfill
```

Antes de tocar nada quiero tu visto bueno sobre tres cosas: el **nombre**
(`legacy_tax_id_raw` o `legacy_cuit_raw`), **RAW sola** sin columna normalizada, y
la **estrategia de `session_replication_role`** para no mover `updated_at`.

---

## 15 · Intento de aplicación del 20/09/2026 — ABORTADO

Con las tres decisiones aprobadas, se intentó aplicar columna + backfill en una
**única sentencia `DO`** (una sola sentencia es atómica pase lo que pase con el
runner: cualquier `raise exception` deshace también el `ALTER`).

Falló en el paso 0, antes de tocar nada:

```
ERROR: 42501: permission denied to set parameter "session_replication_role"
CONTEXT: SQL statement "SELECT set_config('session_replication_role','replica',true)"
         PL/pgSQL function inline_code_block line 14 at PERFORM
```

**Estado después del intento: idéntico al de antes.** Verificado:

| | valor | ¿igual a la baseline? |
|---|---|---|
| columna `legacy_tax_id_raw` | no existe | — |
| `customers` / `needs_review` | 1010 / 40 | sí |
| `max(updated_at)` | 2026-09-16 00:01:50.325964+00 | sí |
| md5 `updated_at` | `accded6d2617819116efcf4141be66fc` | sí |
| md5 `review_reason` | `661ba49eefdabf55fbf640c4f3a54535` | sí |
| md5 `tax_id` | `d47cdbe6a6fad70a30dd71a18a6b2a18` | sí |
| `sales_audit` | 2 | sí |
| cotizaciones / pedidos / entregas | 306 / 172 / 193 | sí |
| migración registrada en `schema_migrations` | 0 | — |

### Por qué no es un problema de permisos que se pueda pedir

`session_replication_role` es un parámetro **sólo de superusuario**, y
`pg_parameter_acl` no tiene ninguna entrada para él: nadie recibió `GRANT SET`.
El único superusuario del proyecto es `supabase_admin`, que es interno de Supabase.
No hay ruta —ni por el runner de migraciones, ni por la clave de servicio, que va
por PostgREST y ni siquiera abre una sesión SQL propia—.

**El plan A no es «difícil»: es imposible en esta plataforma.** Y el plan B
(`alter table ... disable trigger trg_customers_touch`) no está autorizado.

### Opción C, para decidir: la evidencia en su propia tabla

Antes de pedir autorización para el plan B conviene mirar una tercera forma, que
sale mejor en todos los ejes que motivaron la discusión:

```sql
create table customer_legacy_tax_ids (
  customer_id uuid primary key references customers(id) on delete cascade,
  legacy_tax_id_raw text not null,
  legacy_ref text not null,
  source text not null default 'maestro_clientes_html',
  recorded_at timestamptz not null default now()
);
```

| | columna en `customers` | tabla aparte |
|---|---|---|
| `updated_at` de los 31 | hay que neutralizar un trigger | **ni se toca: no hay UPDATE sobre `customers`** |
| `review_reason` / `needs_review` | hay que neutralizar un trigger | **no corre ningún trigger** |
| `sales_audit` | hay que neutralizar un trigger | **no corre ningún trigger** |
| permiso especial | **superusuario (imposible)** | ninguno |
| rollback | `drop column` | `drop table` |
| visibilidad | hereda la fila | una policy `exists (select 1 from customers c where c.id = customer_id)`, que **es** `customers_select` |
| costo | ninguno | un `join` en la cola de revisión |

Es estrictamente más segura: el riesgo que motivó toda la sección 7 —un trigger
`BEFORE UPDATE` que corre sin condición— **desaparece porque no hay UPDATE**.

Lo que se pierde: `customers.legacy_tax_id_raw` era un nombre más simple de leer, y
una tabla más es una tabla más. El contenido, la fuente, el valor crudo, la
idempotencia, los tests y la interfaz propuesta son los mismos.

**Esto necesita una decisión nueva: no está dentro de lo aprobado.**

---

## 16 · Aplicado el 20/09/2026 — tabla aparte

Autorizada la opción C, se aplicó en **una única sentencia `DO`** (una sola
sentencia es atómica pase lo que pase con el runner: cualquier `raise exception`
deshace también el `create table`), con **23 invariantes verificadas antes del
commit**.

### Lo que quedó

```sql
create table public.customer_legacy_tax_ids (
  customer_id       uuid primary key references customers(id) on delete cascade,
  legacy_tax_id_raw text not null check (btrim(legacy_tax_id_raw) <> ''),
  legacy_ref        text not null,
  source            text not null default 'maestro_clientes_html',
  created_at        timestamptz not null default now()
);
```

Tres decisiones, con su motivo:

- **`customer_id` es la PK.** La evidencia demostró un CUIT legacy por cliente
  (31 fichas, 31 referencias, un `cif` cada una). Una relación 1:N sería diseñar
  para un caso que los datos no tienen, y además no impediría duplicar.
- **No lleva `company_id`,** aunque todas las otras tablas `customer_*` lo tienen.
  Ésas lo llevan porque **sus policies filtran por él**; ésta se subordina al
  cliente, así que `company_id` sería una copia de un dato que vive en `customers`
  y que podría quedar desalineada. Se omitió por la misma razón por la que en E2
  no se guardó un CUIT normalizado.
- **`legacy_ref` sí aporta:** es la clave exacta con la que se hizo el cruce, y
  permite rehacerlo contra el HTML sin volver a auditar nada.

### Permisos y RLS

```sql
revoke all on customer_legacy_tax_ids from public, anon, authenticated;
grant select on customer_legacy_tax_ids to authenticated;
alter table customer_legacy_tax_ids enable row level security;
create policy legacy_tax_ids_select on customer_legacy_tax_ids
  for select to authenticated
  using (exists (select 1 from customers c
                  where c.id = customer_legacy_tax_ids.customer_id));
```

**El `revoke` no es decorativo.** En este proyecto los *default ACL* de `public`
otorgan TODO (`arwdDxtm`) a `anon`, `authenticated` y `service_role` sobre
cualquier tabla nueva: sin esa línea la evidencia habría nacido **escribible por
`anon`**. Quedó `{postgres=arwdDxtm, service_role=arwdDxtm, authenticated=r}`.

Sin `grant` de escritura **no hace falta ninguna policy de escritura**: la tabla
no se edita desde la aplicación, la escribe una migración.

El `exists` se evalúa como el usuario que consulta, así que arrastra
`customers_select` entera —incluida la parte que limita al vendedor a sus
clientes—. Sin `security definer` en ninguna parte.

> **Hallazgo aparte, no corregido:** `customer_po_candidates` resuelve su
> visibilidad con `company_id in current_internal_company_ids()`, que es **más
> débil** que `customers_select`: un vendedor ve candidatos de OC de clientes
> que no tiene asignados. No se tocó —es de otra entrega y otra decisión—, pero
> queda anotado.

### La lectura

`grupos_cuit_legacy(uuid[])`, `security invoker`, sin `anon`. Devuelve el crudo y
las otras fichas del mismo CUIT **normalizado**. La normalización vive sólo acá:
nada normalizado se guarda.

Se le pasan **únicamente los ids de la página que se está mirando**, así que el
navegador nunca recibe las 31 evidencias para mostrar 25 filas.

### Verificado

31 evidencias, 15 grupos, 31/31 idénticas a la fuente. Y lo que **no** se movió:
`customers` 1010, `needs_review` 40, los tres md5 (`updated_at`, `review_reason`,
`tax_id`) idénticos a la baseline, `max(updated_at)` en 16/09, `sales_audit` en 2,
documentos 306/172/193. Ninguna revisión se resolvió.

`scripts/fase19-e3b-legacy-cuit-tests.mjs` lo vuelve a comprobar contra
producción, con sesiones reales para la RLS, y coteja las 31 contra el HTML del
sistema anterior si se le pasa la ruta.
