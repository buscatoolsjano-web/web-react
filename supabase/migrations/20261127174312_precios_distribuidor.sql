-- Precios de venta del distribuidor (2026-11-27) — Fase 3.
--
-- El distribuidor compra al precio que le da su proveedor (Fase 2) y vende con
-- SU margen y en SU moneda. Lo decide él (su admin), no el proveedor: es su
-- negocio. Una fila por empresa distribuidora:
--   · margen_pct: el margen general sobre su costo;
--   · margenes_rubro: { category_id: pct } para los rubros con otro margen;
--   · moneda_venta + tipo_cambio: 1 unidad de la moneda del proveedor =
--     tipo_cambio unidades de moneda_venta (1 si es la misma).
-- El cálculo es puro y vive en la app (lib/precioDistribuidor.ts); acá sólo se
-- guarda. La RLS es la de cualquier dato de la empresa: la ven sus miembros y
-- la cambian sus admins.

create table if not exists public.precios_distribuidor (
  company_id uuid primary key references public.companies(id) on delete cascade,
  margen_pct numeric(7, 2) not null default 0 check (margen_pct >= 0 and margen_pct < 1000),
  margenes_rubro jsonb not null default '{}'::jsonb check (jsonb_typeof(margenes_rubro) = 'object'),
  moneda_venta text references public.currencies(code),
  tipo_cambio numeric(16, 6) not null default 1 check (tipo_cambio > 0),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

comment on table public.precios_distribuidor is
  'Margen y moneda de venta de un distribuidor sobre el catálogo compartido. La decide su admin.';

alter table public.precios_distribuidor enable row level security;

drop policy if exists precios_distribuidor_select on public.precios_distribuidor;
create policy precios_distribuidor_select on public.precios_distribuidor
  for select to authenticated
  using (company_id = any (app.current_company_ids()));

drop policy if exists precios_distribuidor_insert on public.precios_distribuidor;
create policy precios_distribuidor_insert on public.precios_distribuidor
  for insert to authenticated
  with check (company_id = any (app.current_admin_company_ids()));

drop policy if exists precios_distribuidor_update on public.precios_distribuidor;
create policy precios_distribuidor_update on public.precios_distribuidor
  for update to authenticated
  using (company_id = any (app.current_admin_company_ids()))
  with check (company_id = any (app.current_admin_company_ids()));

grant select, insert, update on public.precios_distribuidor to authenticated;
