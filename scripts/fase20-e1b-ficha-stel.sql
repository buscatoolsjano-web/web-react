-- ════════════════════════════════════════════════════════════════════════
-- Fase 20 · E1b · Mantenimiento — lo que falta para que la ficha se vea
-- como la del sistema anterior
-- ════════════════════════════════════════════════════════════════════════
--
-- Cuatro datos que STEL tiene y que hasta ahora no tenían dónde vivir:
--
--   · `name`         — «FIAM 26C8A S/N 2307232», el título del equipo. NO es
--                      el identificador: en STEL son campos distintos y los
--                      358 equipos tienen nombre, 333 identificador;
--   · `description`  — el texto largo del bloque «General», con el relato del
--                      taller (252 equipos lo tienen);
--   · `address_text` — «Calle / Dirección», que hoy sólo llegaba partido en
--                      ciudad y provincia;
--   · las imágenes   — 914 fotos de 329 equipos, en su propia tabla porque un
--                      equipo tiene varias y la ficha las muestra en pestaña.
--
-- Todas nulables: un equipo cargado a mano no tiene nada de esto y sigue
-- siendo válido. Ninguna toca una fila existente.
--
-- Las fotos entran primero como URL de STEL (`url`) y más adelante se copian
-- a nuestro almacenamiento (`storage_path`). Las dos columnas conviven a
-- propósito: mientras `storage_path` sea nulo, la imagen vive en el servidor
-- de STEL, y eso se puede ver de un vistazo con un `count`.

alter table public.maintenance_assets
  add column if not exists name         text,
  add column if not exists description  text,
  add column if not exists address_text text;

comment on column public.maintenance_assets.name is
  'El nombre del equipo, como lo escribe el taller. Distinto de identifier.';
comment on column public.maintenance_assets.description is
  'El relato largo del equipo: qué le pasó, qué se le hizo.';
comment on column public.maintenance_assets.address_text is
  'La dirección donde está el equipo, en una línea.';

create table if not exists public.maintenance_asset_images (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id),
  asset_id     uuid not null references public.maintenance_assets (id) on delete cascade,
  -- El id de la imagen en el origen. Es lo que hace idempotente la
  -- sincronización: la misma foto no entra dos veces.
  external_id  text,
  position     integer not null default 0,
  -- Mientras `storage_path` sea nulo, la foto vive en el servidor del origen.
  url          text,
  storage_path text,
  created_at   timestamptz not null default now(),
  constraint maintenance_asset_images_algo_tiene
    check (url is not null or storage_path is not null)
);

create unique index if not exists uq_mai_externo
  on public.maintenance_asset_images (asset_id, external_id)
  where external_id is not null;

create index if not exists idx_mai_asset
  on public.maintenance_asset_images (asset_id, position);

-- ── RLS: la misma del resto del módulo, ni más ni menos ────────────────
alter table public.maintenance_asset_images enable row level security;

drop policy if exists mant_asset_images_select on public.maintenance_asset_images;
create policy mant_asset_images_select on public.maintenance_asset_images
  for select to authenticated
  using (company_id in (select unnest(app.current_maintenance_company_ids())));

drop policy if exists mant_asset_images_write on public.maintenance_asset_images;
create policy mant_asset_images_write on public.maintenance_asset_images
  for all to authenticated
  using (company_id in (select unnest(app.current_maintenance_writer_ids())))
  with check (company_id in (select unnest(app.current_maintenance_writer_ids())));

grant select, insert, update, delete on public.maintenance_asset_images to authenticated;
grant all on public.maintenance_asset_images to service_role;

-- ── Invariantes ────────────────────────────────────────────────────────
do $control$
declare
  cols int;
  rls  boolean;
  pols int;
  anon_puede_por_policy int;
begin
  select count(*) into cols from information_schema.columns
   where table_schema = 'public' and table_name = 'maintenance_assets'
     and column_name in ('name', 'description', 'address_text');
  if cols <> 3 then raise exception 'Faltan columnas en maintenance_assets (hay %)', cols; end if;

  select c.relrowsecurity into rls from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'maintenance_asset_images';
  if not rls then raise exception 'La tabla de imágenes quedó SIN RLS'; end if;

  select count(*) into pols from pg_policies
   where tablename = 'maintenance_asset_images';
  if pols <> 2 then raise exception 'La tabla de imágenes tiene % policies, esperaba 2', pols; end if;

  -- Ojo con lo que se controla acá: las ocho tablas del módulo tienen el
  -- grant de `anon` que Supabase pone por defecto a todo lo que nace en
  -- `public`, y lo que impide leer es la RLS. Pedir que el grant no exista
  -- sería más estricto que el resto del esquema y quedaría raro; lo que sí
  -- tiene que ser cierto es que **ninguna policy le dé acceso a anon**.
  select count(*) into anon_puede_por_policy from pg_policies
   where tablename = 'maintenance_asset_images' and 'anon' = any(roles);
  if anon_puede_por_policy > 0 then
    raise exception 'Hay % policy que le dan acceso a anon', anon_puede_por_policy;
  end if;
end
$control$;
