-- Fase 51 · El PVP como fórmula sobre el costo del proveedor
--
-- POR QUÉ UNA VISTA Y NO FILAS EN `product_prices`.
--
-- STEL es el maestro de `product_prices`: `scripts/lib/stel-sync.mjs` llama a
-- `stel_sync_precio` en cada corrida y reescribe el importe desde su propio
-- `sales-price`. Un PVP calculado y guardado ahí duraría hasta la siguiente
-- sincronización. Por eso el PVP es DERIVADO: se calcula al leer, desde el
-- costo de la última lista del proveedor, y no hay nada que se pueda pisar.
-- Como efecto, «recalcular todo» no es una corrida que haya que acordarse de
-- lanzar: pasa solo cada vez que entra una lista nueva.
--
-- LA FÓRMULA ES UN DATO, NO CÓDIGO. Se decidió ×3 «por ahora, después lo
-- afilamos mejor»: eso pide una tabla, no una constante compilada. Cambiar el
-- múltiplo es un UPDATE y toma efecto en la siguiente lectura.
--
-- SOBRE QUÉ COLUMNA MULTIPLICA. No es la misma en todas las listas, y ésta es
-- la parte que importa:
--
--   · SPEEDRILL trae seis columnas y una es el costo de verdad
--     (`costo_eur` = PVP España × 0,50). Verificado en 3.628 renglones:
--     `costo_eur × 3` reproduce EXACTO la columna «PVP BUSCATOOLS ARG USD»
--     que el archivo ya calcula (mediana del múltiplo: 3,0000).
--   · TECNA NO trae costo. Sólo «VENTA ESPAÑA EUR» y «VENTA ARG EUR», con
--     ×2,5 entre las dos. Multiplicar ×3 una venta no da un PVP comparable,
--     así que esa lista queda con su ×2,5 y marcada como que su base NO es un
--     costo. Es una diferencia real entre proveedores, no un caso borde.
--
-- La Fase 49 había anclado las dos listas en la columna equivocada —«PVP
-- ESPAÑA», que es el DOBLE del costo—. El `anchor` se deja como está porque la
-- planilla histórica lo usa; la fórmula lee la clave que le indica
-- `base_key` dentro de `prices`, donde las cuatro columnas ya están cargadas.
--
-- NO SE CONVIERTE MONEDA. El costo de SPEEDRILL está en EUR y el PVP sale en
-- USD, porque así lo hace la planilla que se usa hoy: el ×3 absorbe el flete,
-- la importación y la diferencia de cambio. Es una decisión explícita, no un
-- olvido. Si algún día se separa el tipo de cambio del markup, se agrega una
-- columna acá y se dice; mientras tanto, que nadie lo "arregle" metiendo un FX
-- que cambiaría todos los precios un 5 %.

begin;

-- ── 1 · la fórmula ─────────────────────────────────────────────────────────

create table if not exists public.price_formulas (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,

  -- null = la regla general de la empresa. Con `source_id`, la de esa lista,
  -- que le gana a la general.
  source_id uuid references public.price_list_sources(id) on delete cascade,

  multiplier numeric(10,4) not null check (multiplier > 0),

  -- Qué clave de `price_list_items.prices` es la base de la cuenta.
  -- null = usar `anchor`.
  base_key text,

  -- Si esa base es el costo de verdad o el precio de venta del proveedor. No
  -- cambia la cuenta: cambia lo que la pantalla puede afirmar. Un PVP derivado
  -- de un costo real es un margen; derivado de la venta del proveedor es una
  -- referencia, y conviene que se vea la diferencia.
  base_is_cost boolean not null default true,

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Una sola regla general por empresa, y una sola por lista.
create unique index if not exists price_formulas_general_uq
  on public.price_formulas (company_id) where source_id is null;
create unique index if not exists price_formulas_source_uq
  on public.price_formulas (company_id, source_id) where source_id is not null;

alter table public.price_formulas enable row level security;

-- Misma forma que `price_list_sources`: interno para leer, admin para escribir.
drop policy if exists pf_select on public.price_formulas;
create policy pf_select on public.price_formulas for select
  using (company_id = any (app.current_internal_company_ids()));

drop policy if exists pf_write on public.price_formulas;
create policy pf_write on public.price_formulas for all
  using (
    company_id = any (app.current_internal_company_ids())
    and app."current_role"(company_id) = 'admin'
  )
  with check (
    company_id = any (app.current_internal_company_ids())
    and app."current_role"(company_id) = 'admin'
  );

-- ── 2 · las reglas de hoy, sólo para buscatools ────────────────────────────
--
-- Cada statement va acotado por `company_id`: torquetools comparte la base y
-- una migración sin acotar le cambiaría los precios a la otra empresa.

insert into public.price_formulas (company_id, source_id, multiplier, base_key, base_is_cost, notes)
select c.id, null, 3, null, true,
       'Regla general: PVP = costo x 3. Absorbe flete, importacion y cambio.'
from public.companies c
where c.slug = 'buscatools'
on conflict do nothing;

insert into public.price_formulas (company_id, source_id, multiplier, base_key, base_is_cost, notes)
select c.id, s.id, 3, 'costo_eur', true,
       'Verificado en 3.628 renglones: costo_eur x 3 = columna PVP BUSCATOOLS ARG USD del archivo.'
from public.companies c
join public.price_list_sources s on s.company_id = c.id and s.name = 'SPEEDRILL'
where c.slug = 'buscatools'
on conflict do nothing;

insert into public.price_formulas (company_id, source_id, multiplier, base_key, base_is_cost, notes)
select c.id, s.id, 2.5, 'venta_espana_eur', false,
       'El archivo de TECNA no trae costo: la base es la VENTA en Espana y el x2,5 es el del propio Excel.'
from public.companies c
join public.price_list_sources s on s.company_id = c.id and s.name = 'TECNA'
where c.slug = 'buscatools'
on conflict do nothing;

-- ── 3 · el PVP, derivado ───────────────────────────────────────────────────
--
-- `security_invoker` para que la RLS del lector decida qué ve, igual que el
-- resto de las vistas del ERP.
--
-- `distinct on` toma la lista MÁS RECIENTE de cada fuente por producto:
-- calcular el PVP de hoy con un costo de 2024 mediría la inflación, no el
-- margen. El desempate por `id` hace el resultado estable cuando dos listas
-- comparten fecha.

create or replace view public.product_pvp with (security_invoker = true) as
with ultimo as (
  select distinct on (i.company_id, i.product_id)
         i.company_id,
         i.product_id,
         i.reference,
         v.source_id,
         v.issued_on   as fecha_costo,
         v.currency    as moneda_costo,
         i.anchor,
         i.prices
  from public.price_list_items i
  join public.price_list_versions v on v.id = i.version_id
  where i.product_id is not null
  order by i.company_id, i.product_id, v.issued_on desc, i.id
),
con_regla as (
  select u.*,
         coalesce(fs.multiplier, fg.multiplier)       as multiplier,
         coalesce(fs.base_key, fg.base_key)           as base_key,
         coalesce(fs.base_is_cost, fg.base_is_cost)   as base_is_cost
  from ultimo u
  left join public.price_formulas fs
    on fs.company_id = u.company_id and fs.source_id = u.source_id
  left join public.price_formulas fg
    on fg.company_id = u.company_id and fg.source_id is null
),
base as (
  select c.*,
         case
           when c.base_key is null then c.anchor
           -- Una clave que no existe da null y la fila se descarta abajo: es
           -- preferible a caer al `anchor`, que en estas listas es el doble del
           -- costo y daría un PVP del doble sin que nadie se entere.
           else nullif(c.prices ->> c.base_key, '')::numeric
         end as costo
  from con_regla c
)
select b.company_id,
       b.product_id,
       b.reference,
       b.source_id,
       b.fecha_costo,
       b.moneda_costo,
       b.costo,
       b.multiplier,
       b.base_is_cost,
       round(b.costo * b.multiplier, 2) as pvp
from base b
where b.costo is not null
  and b.costo > 0
  and b.multiplier is not null;

comment on view public.product_pvp is
  'PVP derivado del costo de la ultima lista del proveedor (Fase 51). No se guarda: STEL es el maestro de product_prices y lo pisaria.';

commit;
