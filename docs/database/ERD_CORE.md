# ERD — CORE (identidad, empresas, permisos, archivos, auditoría)

> **PROPUESTA — no ejecutado.**

Es el dominio del que dependen todos los demás: define quién es quién, a
qué empresa pertenece y qué puede hacer.

```mermaid
erDiagram
    auth_users ||--|| profiles : "1:1"
    profiles ||--o{ company_memberships : "pertenece a"
    companies ||--o{ company_memberships : "tiene"
    company_memberships ||--o{ membership_permissions : "excepciones"
    roles ||--o{ role_permissions : "otorga"
    permissions ||--o{ role_permissions : "se otorga en"
    permissions ||--o{ membership_permissions : "se otorga en"
    companies ||--o{ files : "posee"
    profiles ||--o{ files : "sube"
    companies ||--o{ audit_events : "registra"
    profiles ||--o{ audit_events : "actor"
    companies ||--o{ currencies_enabled : "habilita"

    auth_users {
        uuid id PK "gestionado por Supabase Auth"
        text email
    }

    profiles {
        uuid id PK "= auth.users.id"
        text full_name
        text avatar_path
        text phone
        text locale "es-AR"
        text theme "light|dark"
        boolean is_active
        timestamptz created_at
        timestamptz deleted_at
    }

    companies {
        uuid id PK
        text slug UK "buscatools|torquetools|gas"
        text name
        text legal_name
        text tax_id
        text address
        text phone
        text email
        text website
        text logo_path
        text brand_color
        text default_currency FK
        boolean is_active
        timestamptz created_at
    }

    company_memberships {
        uuid id PK
        uuid user_id FK
        uuid company_id FK
        text role "admin|employee|salesperson|technician|distributor|customer|supplier"
        uuid customer_id FK "obligatorio si role in (customer,distributor)"
        uuid supplier_id FK "obligatorio si role = supplier"
        text status "active|suspended"
        timestamptz created_at
    }

    roles {
        text code PK
        text label
        boolean is_internal
        int rank
    }

    permissions {
        text code PK "sales.quote.create, catalog.cost.read, ..."
        text module
        text label
    }

    role_permissions {
        text role FK
        text permission FK
    }

    membership_permissions {
        uuid membership_id FK
        text permission FK
        boolean granted "true=suma, false=quita"
    }

    files {
        uuid id PK
        uuid company_id FK
        text bucket
        text path UK
        text original_name
        text mime_type
        bigint size_bytes
        text checksum_sha256
        uuid uploaded_by FK
        timestamptz created_at
        timestamptz deleted_at
    }

    audit_events {
        bigint id PK
        uuid company_id FK
        uuid actor_id FK
        text entity_type
        uuid entity_id
        text entity_label "PED00123"
        text action
        jsonb changes "diff por campo"
        inet ip_address
        timestamptz occurred_at
    }

    currencies_enabled {
        uuid company_id FK
        text currency_code FK
        boolean is_default
    }
```

## Notas de diseño

**`profiles.id = auth.users.id`.** Relación 1:1 con la tabla de Supabase
Auth, no una tabla de usuarios paralela. Las contraseñas nunca tocan el
schema `public`.

**`company_memberships` es el corazón del sistema.** La consulta

```sql
SELECT company_id FROM company_memberships
WHERE user_id = auth.uid() AND status = 'active'
```

se ejecuta —vía `app.current_company_ids()`— en **cada política RLS de
cada consulta**. De ahí que su índice sea el más importante de la base y
que la función se declare `STABLE` para que Postgres la evalúe una vez por
consulta y no una vez por fila.

**`customer_id` / `supplier_id` en la membresía** son lo que hace posible
"un cliente ve sólo sus pedidos". Un `CHECK` obliga a que estén presentes
para roles externos y ausentes para internos.

**`roles` y `permissions` son tablas, no `ENUM`s.** Agregar el rol
`supplier` cuando llegue el momento es un `INSERT`, no una migración de
tipo (ADR-011 / sección V).

**`files` no tiene `entity_type`/`entity_id`.** Los enlaces viven en
tablas por dominio (`product_files`, `maintenance_files`, …), por
integridad referencial. El razonamiento está en la sección O del diseño.

**`audit_events` usa `bigint`**: es append-only, de alto volumen y nunca
aparece en una URL.
