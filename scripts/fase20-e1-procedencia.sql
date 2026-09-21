-- ════════════════════════════════════════════════════════════════════════
-- Fase 20 · E1 · Mantenimiento — procedencia de los activos
-- ════════════════════════════════════════════════════════════════════════
--
-- Cuatro columnas y un índice único para poder contestar dos preguntas que
-- hoy no tienen respuesta: **¿este activo vino de STEL o lo cargó alguien a
-- mano?** y **¿es el mismo activo que ya importamos?**
--
-- No se inventa una convención: es la misma que ya usan `products`,
-- `sales_quotes`, `sales_orders`, `deliveries`, `sales_invoices` y `payments`
-- —`text` nulable, sin default, e índice único parcial
-- `uq_<tabla>_external (company_id, external_source, external_id)
--  where external_id is not null`—. `last_synced_at` se suma para las
-- corridas siguientes, con el mismo tipo que usa `email_accounts`.
--
-- `reference` NO es la clave de sincronización: si STEL renumera, se
-- duplicarían los activos y no habría forma de darse cuenta.
--
-- Nada de esto toca una fila: son cuatro columnas nulas sobre una tabla
-- vacía.

alter table public.maintenance_assets
  add column if not exists external_source text,
  add column if not exists external_id     text,
  add column if not exists imported_at     timestamptz,
  add column if not exists last_synced_at  timestamptz;

comment on column public.maintenance_assets.external_source is
  'De qué sistema vino el activo (''stel''). Nulo = se cargó en el ERP.';
comment on column public.maintenance_assets.external_id is
  'El id del activo en ese sistema. Para STEL, assets.id (entero estable), no la referencia ACTxxxxx.';
comment on column public.maintenance_assets.imported_at is
  'Cuándo entró por primera vez.';
comment on column public.maintenance_assets.last_synced_at is
  'Cuándo se lo volvió a leer del origen. Igual a imported_at en la primera corrida.';

create unique index if not exists uq_maintenance_assets_external
  on public.maintenance_assets (company_id, external_source, external_id)
  where external_id is not null;

-- ── Invariantes ────────────────────────────────────────────────────────
do $control$
declare
  cols int;
  idx  int;
  nulable boolean;
begin
  select count(*) into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'maintenance_assets'
     and column_name in ('external_source', 'external_id', 'imported_at', 'last_synced_at');
  if cols <> 4 then
    raise exception 'Faltan columnas de procedencia (hay %)', cols;
  end if;

  select count(*) into idx from pg_indexes
   where schemaname = 'public' and indexname = 'uq_maintenance_assets_external';
  if idx <> 1 then
    raise exception 'No se creó el índice único de identidad externa';
  end if;

  -- El activo sin cliente tiene que seguir siendo legal: son 2 de los 358 y
  -- la decisión es importarlos sin dueño, no inventarles uno.
  select is_nullable = 'YES' into nulable
    from information_schema.columns
   where table_schema = 'public' and table_name = 'maintenance_assets'
     and column_name = 'owner_customer_id';
  if not nulable then
    raise exception 'owner_customer_id dejó de admitir nulos: los activos sin cliente no entrarían';
  end if;
end
$control$;
