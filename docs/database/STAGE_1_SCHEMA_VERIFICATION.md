# Verificación del schema — Fase 2B · Etapa 1

Ejecutado el **2026-09-08**, entre las 18:52 y las 19:00 UTC, sobre
`uaxcfufvapzulqvynanp`. Estado previo en
[`STAGE_1_PRE_EXECUTION_STATE.md`](STAGE_1_PRE_EXECUTION_STATE.md).

## Resumen

| Objeto | Antes | Después |
|---|---|---|
| Tablas en `public` | 0 | **15** |
| Vistas | 0 | **1** (`product_availability`) |
| Tablas con RLS | 0 | **15 / 15** |
| Políticas | 0 | **30** |
| Funciones en `app` | 0 | **12** |
| Triggers | 0 | **9** |
| Índices | 0 | **46** |
| Foreign keys | 0 | **36** |
| CHECK constraints | 0 | **14** |
| Extensiones en `public` | 0 | **0** ✅ |
| Tamaño de la base | 10.203 kB | **11 MB** |

## Bloques ejecutados

| # | Migración | Resultado | Verificación |
|---|---|---|---|
| 1 | `stage1_block1_extensions_and_app_schema` | ✅ | `pg_trgm` 1.6, `unaccent` 1.1, schema `app` con ACL `authenticated=U` |
| 2 | `stage1_block2_base_tables` | ✅ | 3 tablas con sus FKs |
| 3 | `stage1_block3_customers_memberships_catalog` | ✅ | 9 tablas; `products` con 9 índices |
| 4 | `stage1_block4_stock_and_prices` | ✅ | **15/15 tablas**; FK diferida `fk_customers_price_list` creada |
| 5 | `stage1_block5_rls_helper_functions` | ✅ | 7 funciones, todas `SECURITY DEFINER` + `STABLE` + `search_path` |
| 6 | `stage1_block6_triggers` | ✅ | 9 triggers + vista `product_availability` |
| 7 | `stage1_block7_rls_policies` | ✅ | RLS en 15/15, 30 políticas, 0 para `anon` |
| 7b | `stage1_block7b_harden_append_only_tables` | ✅ | *(agregado durante la ejecución — ver abajo)* |
| 8 | `stage1_block8_seeds` | ✅ | 3 monedas, 2 empresas, 2 depósitos, 4 listas, 8 categorías, 25 marcas, 26 atributos |
| — | `stage1_fix_extensions_out_of_public_schema` | ✅ | *(corrección de advisor — ver abajo)* |

Ningún bloque falló. No hubo que detener la ejecución.

## Tablas creadas

| Tabla | Índices | FKs | CHECKs | Políticas |
|---|---:|---:|---:|---:|
| `brands` | 2 | 1 | 0 | 2 |
| `companies` | 2 | 1 | 0 | 2 |
| `company_memberships` | 4 | 3 | 3 | 2 |
| `currencies` | 1 | 0 | 0 | 1 |
| `customers` | 7 | 5 | 2 | 3 |
| `price_lists` | 3 | 2 | 0 | 2 |
| `product_attribute_definitions` | 2 | 2 | 1 | 2 |
| `product_categories` | 2 | 2 | 0 | 2 |
| `product_prices` | 4 | 3 | 2 | 2 |
| `products` | 9 | 4 | 1 | 2 |
| `profiles` | 2 | 1 | 1 | 2 |
| `stock_balances` | 1 | 3 | 1 | 1 |
| `stock_movements` | 3 | 4 | 2 | 2 |
| `stock_reservations` | 2 | 4 | 1 | 3 |
| `warehouses` | 2 | 1 | 0 | 2 |

## Funciones en `app`

Las 7 auxiliares de RLS, verificadas una por una:

| Función | `SECURITY DEFINER` | Volatilidad | `search_path` | ACL |
|---|---|---|---|---|
| `current_company_ids()` | ✅ | STABLE | `public, pg_temp` | `postgres`, `authenticated` |
| `current_role(uuid)` | ✅ | STABLE | `public, pg_temp` | idem |
| `current_customer_id(uuid)` | ✅ | STABLE | `public, pg_temp` | idem |
| `current_price_list_id(uuid)` | ✅ | STABLE | `public, pg_temp` | idem |
| `is_internal(uuid)` | ✅ | STABLE | `public, pg_temp` | idem |
| `is_admin(uuid)` | ✅ | STABLE | `public, pg_temp` | idem |
| `shares_company(uuid)` | ✅ | STABLE | `public, pg_temp` | idem |

Más 5 de trigger: `touch_updated_at`, `handle_new_user`,
`validate_product_attributes`, `apply_stock_movement`,
`apply_stock_reservation`.

**`PUBLIC` no tiene `EXECUTE` en ninguna.** El ACL es exactamente
`postgres=X/postgres | authenticated=X/postgres`, lo que cierra el vector
de *object hijacking* vía `search_path` que pediste verificar.

## Triggers

| Trigger | Tabla | Función | `SECURITY DEFINER` |
|---|---|---|---|
| `on_auth_user_created` | `auth.users` | `handle_new_user` | ✅ |
| `trg_products_validate_attrs` | `products` | `validate_product_attributes` | ✅ |
| `trg_stock_apply` | `stock_movements` | `apply_stock_movement` | ✅ |
| `trg_reservation_apply` | `stock_reservations` | `apply_stock_reservation` | ✅ |
| `trg_companies_touch` | `companies` | `touch_updated_at` | — |
| `trg_profiles_touch` | `profiles` | `touch_updated_at` | — |
| `trg_memberships_touch` | `company_memberships` | `touch_updated_at` | — |
| `trg_customers_touch` | `customers` | `touch_updated_at` | — |
| `trg_products_touch` | `products` | `touch_updated_at` | — |

Los cinco `touch_updated_at` **no** son `SECURITY DEFINER` a propósito: no
lo necesitan, y darles privilegios de más sería innecesario.

## Grants efectivos — lo que importa

| Tabla | `authenticated` SELECT | INSERT | UPDATE | DELETE | `anon` SELECT |
|---|---|---|---|---|---|
| **`stock_balances`** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **`stock_movements`** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **`stock_reservations`** | ✅ | ✅ | ❌ | ✅ | ❌ |
| Resto (12 tablas) | ✅ | ✅ | ✅ | ✅ | ❌ |

- `stock_balances` sólo se puede leer. La escritura queda exclusivamente
  en manos del trigger `SECURITY DEFINER`.
- `stock_movements` es append-only real: el `UPDATE` y el `DELETE` fallan
  con error de permisos, no en silencio.
- `stock_reservations` admite `DELETE` (es el RELEASE) pero no `UPDATE`:
  una reserva se libera y se crea otra, no se edita.
- **`anon` no puede leer ninguna tabla.**

## Seeds cargados

| Tabla | Filas | Contenido |
|---|---|---|
| `currencies` | 3 | ARS, USD, EUR |
| `companies` | 2 | `buscatools`, `torquetools` |
| `warehouses` | 2 | Depósito principal por empresa |
| `price_lists` | 4 | BT: Lista base *(default)*, Distribuidores, Especial Cliente Demo · TT: Lista base |
| `product_categories` | 8 | Las 8 reales del legacy; `otros` marcada `needs_review = true` |
| `brands` | 25 | Las 25 reales del legacy |
| `product_attribute_definitions` | 26 | La cola larga declarada |

## Correcciones aplicadas durante la ejecución

### 1. `stock_movements` podía recibir `UPDATE` sin error

**Detectado** al verificar el Bloque 7: sin políticas de `UPDATE`/`DELETE`,
RLS deniega, pero el intento devuelve *"0 filas afectadas"* en silencio en
vez de fallar.

**Corregido** (migración `stage1_block7b`):

```sql
REVOKE UPDATE, DELETE ON stock_movements    FROM authenticated;
REVOKE UPDATE          ON stock_reservations FROM authenticated;
```

Ahora el intento devuelve un error explícito, que es lo correcto para una
tabla que por diseño nunca se modifica.

### 2. Extensiones instaladas en `public`

**Detectado** por el advisor de seguridad de Supabase
(`extension_in_public`, 2 hallazgos). Las extensiones en `public` pueden
ser sombreadas y son un riesgo conocido.

**Corregido** moviéndolas a `extensions`. Como los índices GIN usan
`gin_trgm_ops`, hubo que borrarlos, mover la extensión y recrearlos
calificando el operador:

```sql
CREATE INDEX idx_products_sku_trgm ON products
  USING gin (sku extensions.gin_trgm_ops);
```

Se hizo ahora, sin datos cargados, que es el momento más barato.
**Advisor re-ejecutado: el hallazgo desapareció.**

### 3. `PUBLIC` con `EXECUTE` por defecto

**Detectado** en la validación estática previa, antes de ejecutar nada.
Postgres otorga `EXECUTE` a `PUBLIC` en toda función; en funciones
`SECURITY DEFINER` eso es riesgoso. Se agregó al Bloque 5 antes de
ejecutarlo.

## Advertencia abierta (requiere acción tuya)

El advisor reporta una sola advertencia pendiente:

> **Leaked Password Protection Disabled** — Supabase Auth puede verificar
> las contraseñas contra HaveIBeenPwned.org y rechazar las comprometidas.
> Está desactivado.

Es un ajuste del proyecto, en **Authentication → Policies**. No lo toco:
es configuración de la cuenta y la decisión es tuya. Recomiendo activarlo
antes de que existan usuarios reales.

## Estado de los usuarios de Auth

Al momento de esta verificación había **3 usuarios** creados, y el trigger
`on_auth_user_created` funcionó en los tres: cada uno tiene su `profile`
con `full_name` derivado del email.

**El trigger está validado en producción.** Falta definir el mapeo
usuario → rol para poder crear las membresías.
