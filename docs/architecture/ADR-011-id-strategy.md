# ADR-011 — Estrategia de identificadores

**Estado:** Propuesta · **Fecha:** 2026-09-08 · **Fase:** 2

## Contexto

El legacy usa cuatro esquemas distintos a la vez: referencias de negocio
(`COT00123`, `CLI00719`), ids con timestamp (`'SVC-'+Date.now()`,
`'ACTIVO-'+Date.now()`), el nombre del cliente como clave (`nj`), y la
posición en un array como identidad de línea.

Las referencias se generan con `Math.max(...)` sobre el array cargado en
memoria: **si dos personas guardan a la vez, se duplican**.

## Decisión

Estrategia híbrida con una regla clara:

| Tipo | Dónde | Por qué |
|---|---|---|
| **`uuid` v4** (`gen_random_uuid()`) | Toda entidad de negocio | Aparece en URLs (`#/ventas/pedidos/<id>`); no enumerable; generable en el cliente |
| **`bigint` identity** | Append-only de alto volumen: `stock_movements`, `audit_events`, `wa_messages`, `email_messages` | Nunca van en una URL. Dan localidad de índice y orden de inserción sin columna extra |

**Los números de documento se conservan, pero no como PK:**

```sql
doc_number text NOT NULL,
UNIQUE (company_id, doc_number)
```

Se generan con una **secuencia por empresa y tipo**, dentro de la
transacción.

**`legacy_ref text`** en toda tabla migrada: hace la migración idempotente
y permite auditar el origen de cada fila.

## Alternativas

| Alternativa | Por qué no |
|---|---|
| Todo `bigint` | Ids enumerables en URLs; no se pueden generar en el cliente |
| Todo `uuid` | En tablas de millones de filas, v4 fragmenta el índice y no aporta nada donde el id no se expone |
| `COT00123` como PK | Cambiar un formato de numeración obligaría a migrar todas las FKs |
| **UUID v7** | **Sería mejor que v4** (ordenable por tiempo, menos fragmentación), pero `uuidv7()` nativo llega en PostgreSQL **18** y Supabase corre **17.6.1**. Se descarta agregar una extensión para el arranque |

## Ventajas

- Ids opacos y seguros donde se exponen.
- Índices eficientes donde el volumen importa.
- Numeración de negocio preservada, sin duplicados por concurrencia.
- Migración re-ejecutable sin duplicar.

## Desventajas

- Dos tipos de PK conviviendo: hay que saber cuál usar.
- UUID ocupa 16 bytes contra 8 de `bigint`.

## Riesgo

Fragmentación de índices por UUID v4 en tablas que crezcan más de lo
previsto.

**Mitigación:** revisar al actualizar a PostgreSQL 18. El cambio a UUID v7
afectaría sólo tablas nuevas, sin migrar las existentes.

## Impacto futuro

**Medio.** Cambiar el tipo de PK con datos cargados obliga a reescribir
todas las FKs que la referencian.
