# Estado previo a la ejecución — Fase 2B · Etapa 1

Registrado el **2026-09-08 18:52:17 UTC**, inmediatamente antes de ejecutar
el primer bloque de [`STAGE_1_SCHEMA.sql`](STAGE_1_SCHEMA.sql).

Sirve como punto de retorno: si algo sale mal, éste es el estado al que
hay que volver.

## Proyecto

| | |
|---|---|
| Proyecto | `uaxcfufvapzulqvynanp` ("WEB REACT") |
| Base | `postgres` |
| Versión | PostgreSQL **17.6** on x86_64-pc-linux-gnu |
| Región | us-east-2 |
| Estado | `ACTIVE_HEALTHY` |
| **Tamaño de la base** | **10.203 kB** |

> El proyecto legacy `hnyngsejohkmlaccpkux` **no se toca** en ninguna
> etapa. No aparece en ningún script.

## Contenido de la base

| Objeto | Cantidad |
|---|---|
| Tablas en `public` | **0** |
| Vistas en `public` | **0** |
| Funciones en `public` + `app` | **0** |
| Schema `app` | **no existe** |
| Usuarios en `auth.users` | **0** |
| Buckets de Storage | **0** |
| Migraciones aplicadas | **0** |

La base está exactamente como Supabase la crea: sólo los schemas
gestionados (`auth`, `storage`, `realtime`, `vault`, `extensions`).

## Extensiones instaladas

| Extensión | Versión | Schema |
|---|---|---|
| `plpgsql` | 1.0 | `pg_catalog` |
| `pgcrypto` | 1.3 | `extensions` |
| `uuid-ossp` | 1.1 | `extensions` |
| `pg_stat_statements` | 1.11 | `extensions` |
| `supabase_vault` | 0.3.1 | `vault` |

**Relevantes para esta etapa, y NO instaladas todavía:**

| Extensión | Disponible | Instalada | Se instala en Bloque 1 |
|---|---|---|---|
| `pg_trgm` | 1.6 | ❌ | ✅ sí |
| `unaccent` | 1.1 | ❌ | ✅ sí |
| `vector` (pgvector) | 0.8.2 | ❌ | ❌ **no, a propósito** |

## Estado del repositorio

| | |
|---|---|
| Commit | `0e160e8f9514a3cfea9d1b4313d2785ee9ef85e9` |
| Mensaje | *Fase 2B Etapa 1: revision de simplificacion y SQL propuesto* |
| Fecha | 2026-09-08 15:50:34 -0300 |
| Rama | `main`, sincronizada con `origin/main` |
| Working tree | **limpio** (0 archivos modificados) |

## Validación estática previa

Ejecutada con
[`scripts/validate-stage1-sql.mjs`](../../scripts/validate-stage1-sql.mjs)
sobre el DDL. **0 fallos, 0 avisos.**

| # | Verificación | Resultado |
|---|---|---|
| 1 | Son 15 tablas | ✅ |
| 2 | 36 FKs, todas hacia tablas ya definidas (orden correcto) | ✅ |
| 3 | 11 funciones `SECURITY DEFINER`, todas con `SET search_path` explícito | ✅ |
| 4 | RLS habilitado en las 15 tablas | ✅ |
| 5 | 30 políticas, **ninguna** otorga acceso a `anon` | ✅ |
| 5b | Ningún `WITH CHECK (true)` — el patrón del bug de `erp_emails` no se repite | ✅ |
| 5c | Único `USING (true)`: `currencies` (lectura de monedas para autenticados) | ✅ |
| 6 | `stock_balances`: ninguna política de escritura + `REVOKE` explícito | ✅ |
| 7 | `stock_movements`: sólo SELECT e INSERT, sin UPDATE ni DELETE para nadie | ✅ |
| 8 | 9 triggers, todos sobre funciones y tablas existentes | ✅ |
| 9 | Sin `service_role` en el código | ✅ |
| 9b | Sin referencias al Supabase legacy ni a `erp_store` | ✅ |
| 9c | No instala `pgvector` | ✅ |
| 9d | `REVOKE ALL` a `anon` sobre `public` | ✅ |
| 9e | `EXECUTE` revocado a `PUBLIC` en las funciones `SECURITY DEFINER` | ✅ |
| 10 | Delimitadores `$$` y paréntesis balanceados; 8 bloques | ✅ |

### Corrección aplicada durante la validación

El punto **9e** falló en la primera pasada. Postgres otorga `EXECUTE` a
`PUBLIC` por defecto en toda función, y en funciones `SECURITY DEFINER`
eso es riesgoso. Se agregó al Bloque 5:

```sql
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC, anon;
GRANT  EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO authenticated;
```

`authenticated` sí necesita `EXECUTE` porque las políticas RLS se evalúan
como el usuario que consulta.

## Cómo revertir

Si hiciera falta volver a este estado exacto:

```sql
DROP SCHEMA IF EXISTS app CASCADE;
DROP TABLE IF EXISTS
  product_prices, price_lists, stock_reservations, stock_balances,
  stock_movements, warehouses, products, product_attribute_definitions,
  product_categories, brands, company_memberships, customers,
  profiles, companies, currencies CASCADE;
DROP VIEW IF EXISTS product_availability;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
-- Las extensiones pueden quedar: son inocuas.
```

Los usuarios de `auth.users` que se creen manualmente **no** se borran con
eso: hay que eliminarlos desde el Dashboard.
