# ERD — COMUNICACIONES (WhatsApp y Email)

> **PROPUESTA — no ejecutado.**

Único dominio donde el legacy ya tiene tablas relacionales reales
(`suite_wa_*`, `erp_emails`). Se rediseñan por tres motivos: guardan media
en base64, referencian clientes y usuarios por texto, y asumen una sola
línea de WhatsApp.

```mermaid
erDiagram
    companies ||--o{ wa_accounts : "posee"
    wa_accounts ||--o{ wa_conversations : "recibe"
    customers ||--o{ wa_conversations : "vinculada a"
    suppliers ||--o{ wa_conversations : "vinculada a"
    profiles ||--o{ wa_conversations : "asignada a"
    wa_conversations ||--o{ wa_messages : "contiene"
    wa_conversations ||--o{ wa_conversation_assignments : "historial"
    wa_messages ||--o{ wa_message_files : "adjuntos"
    files ||--o{ wa_message_files : ""

    companies ||--o{ email_accounts : "posee"
    email_accounts ||--o{ email_threads : "recibe"
    customers ||--o{ email_threads : "vinculado a"
    profiles ||--o{ email_threads : "asignado a"
    email_threads ||--o{ email_messages : "contiene"
    email_messages ||--o{ email_attachments : "adjuntos"
    files ||--o{ email_attachments : ""

    wa_accounts {
        uuid id PK
        uuid company_id FK
        text label "Ventas|Soporte"
        text phone_number
        text provider "baileys|cloud_api"
        boolean is_connected
        text status
        timestamptz last_seen_at
    }

    wa_conversations {
        uuid id PK
        uuid company_id FK
        uuid wa_account_id FK "legacy: linea text = 'default'"
        text chat_id UK "5491100000000@s.whatsapp.net"
        text phone
        text display_name
        uuid customer_id FK "legacy: cli_ref texto"
        uuid supplier_id FK
        uuid assigned_to FK "legacy: asignado texto"
        text status "open|closed|archived"
        text ai_mode "off|draft|auto"
        text[] tags
        text notes
        int unread_count "por trigger"
        timestamptz last_message_at
        text last_message_preview
        text last_message_direction "in|out"
        timestamptz created_at
    }

    wa_messages {
        bigint id PK
        uuid company_id FK
        uuid conversation_id FK
        text external_id UK "id de Baileys"
        text direction "in|out"
        text body
        text message_type "text|image|audio|video|document|location"
        boolean is_read
        text status "queued|sent|delivered|read|failed|draft"
        text error
        uuid sent_by FK "profile - null si es entrante"
        timestamptz sent_at
        timestamptz created_at
    }

    wa_message_files {
        bigint message_id FK
        uuid file_id FK "STORAGE - legacy: base64 en columna datos"
        text role "media|thumbnail"
    }

    wa_conversation_assignments {
        uuid id PK
        uuid conversation_id FK
        uuid assigned_to FK
        uuid assigned_by FK
        timestamptz assigned_at
        timestamptz released_at
    }

    email_accounts {
        uuid id PK
        uuid company_id FK
        text address "info@buscatools.com.ar"
        text display_name
        text provider "gmail"
        boolean is_active
    }

    email_threads {
        uuid id PK
        uuid company_id FK
        uuid email_account_id FK
        text external_thread_id UK "thread id de Gmail"
        text subject
        uuid customer_id FK "resuelto por email_domains"
        uuid assigned_to FK
        text status "new|assigned|in_progress|answered|archived"
        text[] labels
        int message_count
        timestamptz last_message_at
        text notes
        timestamptz created_at
    }

    email_messages {
        bigint id PK
        uuid company_id FK
        uuid thread_id FK
        text external_id UK "gmail_id"
        text direction "in|out"
        text from_email
        text from_name
        text[] to_emails
        text[] cc_emails
        text reply_to
        text subject
        text snippet "<=300 chars - lo unico que lee la bandeja"
        text body_text
        text body_html "solo si <= 64KB"
        text body_html_path "Storage si es mayor"
        boolean has_attachments
        timestamptz sent_at
        timestamptz created_at
    }

    email_attachments {
        uuid id PK
        bigint email_message_id FK
        uuid file_id FK "STORAGE - legacy: base64 en jsonb"
        text filename
        text mime_type
        bigint size_bytes
    }
```

## Notas de diseño

### Lo que cambia respecto del legacy

| Legacy | Nuevo | Por qué |
|---|---|---|
| `suite_wa_media.datos text` (**base64**) | `files` + Storage | Una foto de 2 MB ocupa ~2,7 MB en base64 **dentro de una fila**. Cualquier `SELECT *` la arrastra |
| `linea text DEFAULT 'default'` | `wa_account_id` FK | Habilita varios números sin tocar el schema |
| `cli_ref`, `cli_nombre`, `cli_tipo` | `customer_id` / `supplier_id` | FK real |
| `asignado text` (`'FACUNDO'`) | `assigned_to uuid` | FK a `profiles` |
| `erp_emails.attachments jsonb` (base64) | `email_attachments` + Storage | Idem |
| `erp_emails.body_html` completo | Columna sólo si ≤ 64 KB, si no a Storage | Un mail con firma e imágenes puede pesar cientos de KB |
| Política `FOR INSERT WITH CHECK (true)` | RLS real | **Hoy cualquiera puede insertar emails** |

### La bandeja nunca lee el cuerpo

```sql
SELECT id, subject, from_name, snippet, sent_at, status, assigned_to
FROM email_messages WHERE ...
```

Por eso `snippet` es una columna propia y no un `substring()` calculado:
el listado no debe tocar `body_text` ni `body_html`.

### Sanitización del HTML

El HTML se limpia **antes de guardarlo** (sin `<script>`, sin `<iframe>`,
sin handlers `on*`, sin `javascript:`), no al renderizarlo. Se limpia una
vez en vez de en cada apertura, y una fila envenenada no puede atacar a
otro cliente más adelante.

### Realtime

Este dominio es el único con Realtime, junto a notificaciones (ADR-006).
La suscripción a `wa_messages` actualiza el registro en la caché de
TanStack Query (`setQueryData`); **nunca** dispara un refetch completo,
que es lo que hace el legacy (`refrescar(false)` ante cualquier evento).

`unread_count` se mantiene por trigger sobre `wa_messages`, no
recalculando `COUNT(*)` en cada render.

### `wa_participants` no se creó

Hoy toda conversación es 1:1 con un teléfono. La tabla se agrega cuando
haya grupos de WhatsApp, sin romper nada: `wa_conversations` ya es la
entidad correcta para colgarla.
