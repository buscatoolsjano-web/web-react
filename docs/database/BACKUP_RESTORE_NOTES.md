# Backup lógico — qué restaura y qué no

Generado por [`scripts/backup-logical.mjs`](../../scripts/backup-logical.mjs).
Proyecto origen: `uaxcfufvapzulqvynanp`.

> **Esto NO es un `pg_dump`.** Es un backup lógico **reconstruible**,
> suficiente para un entorno de desarrollo. Reproduce el esquema y los
> datos leyéndolos de la base viva por API, porque en este entorno no hay
> `pg_dump` ni `psql`, y el CLI de Supabase requeriría la contraseña de
> Postgres. Un `pg_dump` real cubre además cosas que este archivo **no**:
> secuencias con su valor actual, propietarios y ACL exactos, comentarios,
> tipos y dominios personalizados, `auth`, `storage` y `realtime`, y
> estadísticas del planificador.

---

## Qué SÍ restaura

| | |
|---|---|
| Extensiones | `pg_trgm`, `unaccent` en el esquema `extensions` |
| Esquemas | `app` |
| Tablas | las 16 del esquema `public`, con sus columnas y `DEFAULT` |
| Columna generada | `products.search_vector` (`GENERATED ALWAYS … STORED`) |
| Constraints | PK, UNIQUE, FK y CHECK |
| Índices | 25, incluidos los GIN de trigram y el índice parcial de apertura |
| Funciones | 12 en `app` + `public.search_products` |
| Vista | `product_availability` |
| Triggers | 9 en `public` + `on_auth_user_created` en `auth.users` |
| RLS | habilitado en las 16 tablas |
| Políticas | las 32 |
| Grants | `authenticated`, `anon`, `service_role` |
| Datos | las 16 tablas, en orden de dependencias, con `ON CONFLICT DO NOTHING` |
| Transacción | todo entre `BEGIN;` y `COMMIT;` |

---

## Qué NO restaura

### 1. `auth.users` — y esto cambia el procedimiento

**Supabase Auth administra `auth.users` y las contraseñas no son
exportables.** El backup no las incluye y no puede incluirlas.

La consecuencia importante: **al recrear los usuarios en otro proyecto,
Supabase les asigna UUID nuevos.** Los ids del backup dejan de ser válidos.

Un texto anterior de este proyecto decía que «el trigger regenera los
profiles y las membresías se revinculan por id». **Eso es incorrecto** y se
corrige acá: sólo sería cierto restaurando sobre el *mismo* proyecto, donde
los ids se conservan. Sobre un proyecto nuevo hace falta un remapeo
explícito.

### 2. Otros objetos gestionados por la plataforma

`storage.*`, `realtime.*`, las funciones internas de Supabase, los
webhooks, la configuración de Auth (incluida *Leaked Password Protection*)
y las variables del proyecto.

---

## Orden de restauración

1. Proyecto Supabase **vacío**, con `auth` ya inicializado por la plataforma.
2. **Crear los usuarios** en Authentication → Users, con los mismos emails.
   Anotar el UUID nuevo de cada uno.
3. **Aplicar el remapeo** (ver abajo) sobre el archivo de backup.
4. Ejecutar el archivo completo: SQL Editor del panel, o
   `psql "<connection-string>" -f <archivo>`.

Las sentencias ya están ordenadas por dependencias de FK, así que no hace
falta desactivar constraints:

```
currencies → companies → profiles → warehouses → price_lists → customers
→ company_memberships → product_categories → brands
→ product_attribute_definitions → product_attribute_categories
→ products → product_prices → stock_movements → stock_balances
→ stock_reservations
```

⚠️ `stock_movements` va **antes** que `stock_balances` a propósito: el
trigger `trg_stock_apply` recalcula los saldos al insertar los movimientos.
Los `INSERT` de `stock_balances` llevan `ON CONFLICT DO NOTHING` para no
pisar lo que el trigger ya dejó bien.

---

## Remapeo de identidades — obligatorio en un proyecto nuevo

### Tabla de correspondencia

Se arma a mano después de crear los usuarios. La identidad estable es el
**email**, no el UUID.

| Email | `OLD_AUTH_USER_ID` (del backup) | `NEW_AUTH_USER_ID` (del proyecto nuevo) |
|---|---|---|
| *(interno · admin)* | `…` | *(a completar)* |
| *(interno · admin)* | `…` | *(a completar)* |
| *(interno · admin)* | `…` | *(a completar)* |
| *(interno · employee)* | `…` | *(a completar)* |
| *(interno · salesperson)* | `…` | *(a completar)* |
| *(externo · customer)* | `…` | *(a completar)* |
| *(externo · distributor)* | `…` | *(a completar)* |

Los emails y los UUID reales no se listan acá: salen del backup y del panel
del proyecto nuevo. **Este documento no contiene datos de usuarios.**

### Qué depende de esos ids

Siete columnas, en seis tablas. La cuenta es del estado actual:

| Tabla | Columna | Referencia | Obligatoria | Filas pobladas hoy |
|---|---|---|---|---:|
| `profiles` | `id` | `auth.users(id)` | **NOT NULL** | **7** |
| `company_memberships` | `user_id` | `profiles(id)` | **NOT NULL** | **8** |
| `customers` | `salesperson_id` | `profiles(id)` | nullable | **1** |
| `customers` | `created_by` | `profiles(id)` | nullable | 0 |
| `products` | `created_by` | `profiles(id)` | nullable | 0 |
| `stock_movements` | `created_by` | `profiles(id)` | nullable | **3** |
| `stock_reservations` | `created_by` | `profiles(id)` | nullable | 0 |

**Sólo 19 valores hay que remapear hoy**: 7 profiles, 8 membresías, 1
vendedor asignado y 3 movimientos. Las demás columnas están en NULL porque
los datos se cargaron por migración, no desde la aplicación.

### Cómo aplicarlo

**Antes** de ejecutar el archivo, reemplazar cada `OLD` por su `NEW` en el
texto del backup. Es un buscar-y-reemplazar sobre el .sql; conviene
hacerlo con un script y no a mano.

Después de restaurar, verificar que no quedó ningún id viejo:

```sql
-- Debe dar 0 en las tres.
SELECT count(*) FROM profiles p
 WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id);

SELECT count(*) FROM company_memberships m
 WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = m.user_id);

SELECT count(*) FROM customers c
 WHERE c.salesperson_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = c.salesperson_id);
```

### El orden importa

`profiles.id` tiene FK a `auth.users(id)`, así que **los usuarios tienen
que existir antes** de insertar los profiles. Y el trigger
`on_auth_user_created` crea un profile automáticamente al dar de alta cada
usuario: por eso los `INSERT` de `profiles` llevan `ON CONFLICT DO
NOTHING`, para no chocar con la fila que el trigger ya creó.

Consecuencia práctica: el `full_name` que quede será el que derivó el
trigger del email, no el del backup. Si importa conservarlo, hay que
correr un `UPDATE` después.

### Cuando cambien las FK

Toda tabla futura que referencie `profiles(id)` —pedidos, cotizaciones,
órdenes de compra, órdenes de trabajo— se suma a esta lista. La consulta
que la mantiene al día:

```sql
SELECT c.relname AS tabla, a.attname AS columna
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_class ref ON ref.oid = con.confrelid
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(con.conkey)
WHERE con.contype = 'f' AND ref.relname IN ('profiles','users')
ORDER BY 1, 2;
```

---

## Restaurar sobre el MISMO proyecto

Es el caso del rollback de esta migración, y es mucho más simple: **los
UUID no cambian**, así que no hay remapeo. Alcanza con vaciar las tablas
de datos y ejecutar la sección de datos del archivo.

Para revertir sólo la importación del catálogo, sin tocar el resto, está el
procedimiento por `legacy_ref` y `source_type = 'migration'` en
[`PHASE_3_5_PREPARATION.md`](../PHASE_3_5_PREPARATION.md).

---

## Lo que el archivo no debe contener

`scripts/backup-logical.mjs` no escribe claves: lee
`SUPABASE_SERVICE_ROLE_KEY` del entorno, nunca la imprime y nunca la
incluye en la salida. El archivo se escribe **fuera del repositorio** y el
script rechaza rutas que apunten adentro.

Verificaciones que se corren sobre el archivo generado antes de importar:

1. existe
2. tamaño > 0
3. está fuera del repositorio
4. no contiene `service_role`
5. no contiene ningún JWT ni patrón de secreto
6. tiene `BEGIN;` y `COMMIT;`
7. el orden de las sentencias es restaurable
8. aparecen las 16 tablas
9. los recuentos de filas coinciden con el manifiesto
10. el md5 de los SKU coincide con el manifiesto
