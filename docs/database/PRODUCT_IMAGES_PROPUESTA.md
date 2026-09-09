# `product_images` — propuesta final de columnas y constraints

**No ejecutado.** Para aprobar antes de crear la tabla.

Basada en la verificación real de las 3.317 URLs
([`../IMAGENES_VERIFICACION.md`](../IMAGENES_VERIFICACION.md)), no en supuestos.

---

## Los hechos que determinan el diseño

| hecho medido | consecuencia en el modelo |
|---|---|
| **Máximo 2 imágenes** por producto (6.187 con 1, 1.336 con 2, **0 con 3+**) | `position` alcanza con un `int`; no hace falta orden complejo |
| **8.859 referencias** sobre **3.317 archivos** | la fila es por *(producto, imagen)*, no por archivo: una URL se repite en hasta **77** productos |
| **1.624 de 3.317** tienen miniatura verificada | hace falta guardar `thumb_url`, y que pueda ser `NULL` |
| **327 URLs son diagramas de catálogo**, no fotos | hace falta `kind` |
| 2 URLs devuelven 503 | hace falta tolerar imágenes muertas sin romper el listado |
| Futuro: migración a Storage | hace falta `storage_path` desde ya, para no migrar dos veces |

---

## La tabla

```sql
create table product_images (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  product_id   uuid not null references products(id)  on delete cascade,

  -- Origen. Hoy siempre source_url; cuando llegue Storage se completa
  -- storage_path y source_url queda como referencia histórica.
  source_url   text,
  storage_path text,

  -- Miniatura VERIFICADA. NULL significa "no existe", nunca "no la busqué":
  -- la regla es no derivarla nunca reescribiendo el nombre del archivo.
  thumb_url    text,

  kind         text not null default 'product_image'
               check (kind in ('product_image','shared_diagram',
                               'technical_diagram','unknown')),

  position     int  not null default 0,
  is_primary   boolean not null default false,
  alt_text     text,

  -- Traza de la verificación offline, para saber cuándo se comprobó.
  checked_at   timestamptz,
  http_status  int,
  bytes        int,

  created_at   timestamptz not null default now(),

  constraint chk_origen check (source_url is not null or storage_path is not null),
  constraint chk_position check (position >= 0)
);
```

### Constraints e índices

```sql
-- Una sola imagen principal por producto. Índice único PARCIAL: permite
-- muchas filas con is_primary = false.
create unique index uq_product_images_primary
  on product_images (company_id, product_id) where is_primary;

-- Idempotencia de la carga: el mismo producto no puede tener dos veces la
-- misma URL. Es la clave natural para reimportar sin duplicar.
create unique index uq_product_images_origen
  on product_images (product_id, source_url) where source_url is not null;

-- Lectura del listado y del detalle.
create index idx_product_images_producto
  on product_images (company_id, product_id, position);
```

> **Cuidado con el `ON CONFLICT`.** `uq_product_images_origen` es un índice
> **parcial**, y Postgres no puede inferirlo desde `ON CONFLICT (cols)` sin
> repetir el predicado — cosa que `supabase-js` no sabe expresar. Es el mismo
> bug que apareció en la Fase 3.5 con el índice de apertura de stock. El
> importador debe **leer lo existente e insertar lo que falta**, no hacer
> upsert. Queda anotado en el script, no sólo acá.

### RLS

```sql
alter table product_images enable row level security;

-- Una imagen nunca puede ser más visible que su producto: se delega en él.
create policy product_images_select on product_images for select to authenticated
using (
  exists (select 1 from products p
          where p.id = product_images.product_id
            and p.company_id = product_images.company_id)
);

create policy product_images_write on product_images for all to authenticated
using      (company_id in (select unnest(app.current_writer_company_ids())))
with check (company_id in (select unnest(app.current_writer_company_ids())));
```

La política de lectura **no repite** las condiciones de `products`: consulta
`products`, y RLS se aplica a esa consulta. Si el producto no es visible, el
`exists` da falso. Así no hay dos definiciones de visibilidad que se puedan
desincronizar.

> Nota sobre la referencia calificada: dentro del subquery se escribe
> `product_images.product_id`, con el nombre de la tabla. Sin calificar,
> `product_id` resolvería contra `products` y la condición sería una
> tautología. Es exactamente el bug que cometí en la N:N de la Fase 3.5.

---

## Cómo se carga

8.859 filas desde el JSON legacy, cruzando con el informe de verificación:

| campo | de dónde sale |
|---|---|
| `source_url` | `imgs[i]` del legacy |
| `position` | el índice `i` en el array |
| `is_primary` | `i = 0` **y** `kind = 'product_image'` |
| `kind` | clasificación del informe de verificación |
| `thumb_url` | del informe, **sólo si** `thumbnail_exists` |
| `http_status`, `bytes`, `checked_at` | del informe |
| `alt_text` | `null` por ahora — inventarlo sería peor que dejarlo vacío |

**Regla explícita para los diagramas (punto 12):** un `shared_diagram` o
`technical_diagram` **nunca** se marca `is_primary`. Un producto cuya única
imagen sea un diagrama queda sin principal, y el listado le muestra el
placeholder. Es correcto: un diagrama de la página 22 del catálogo, repetido
en 77 productos, no identifica a ninguno.

Consecuencia medible: de los 7.523 productos con imagen, los que sólo tienen
diagramas de apexbits quedarán sin foto principal. Se cuenta en la
reconciliación y se informa; no se disimula.

---

## Lo que NO lleva

- **Ni `width` ni `height`.** El `HEAD` no los da, y obtenerlos exige
  descargar las 3.317 imágenes. El layout sin CLS se resuelve con una caja de
  proporción fija en CSS, que además funciona con imágenes de cualquier
  tamaño.
- **Ni tabla de assets aparte.** Sería lo correcto si el mismo archivo
  necesitara metadatos propios compartidos, pero hoy la única duplicación es
  una cadena de texto repetida. Cuando llegue Storage, `storage_path` se
  completa con un `UPDATE ... FROM` agrupado por `source_url`: un solo paso,
  sin tabla nueva.
- **Ni orden editable por el usuario.** Con dos imágenes como máximo, el
  `position` del legacy alcanza.

---

## Reconciliación obligatoria

Igual que en la Fase 3.5, con deltas que deben dar cero:

1. filas cargadas = 8.859
2. productos con al menos una imagen = 7.523
3. productos con imagen principal = 7.523 − (los que sólo tienen diagramas)
4. URLs distintas = 3.317
5. filas con `thumb_url` = 1.624
6. `kind` por clase = 2.990 / 309 / 18 / 0 (por URL, expandido a referencias)
7. ningún producto con dos `is_primary`
8. segunda corrida idéntica a la primera (idempotencia)
