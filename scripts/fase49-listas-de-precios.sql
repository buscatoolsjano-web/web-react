-- Fase 49 · Las listas de precios de las marcas
--
-- APLICADA el 2026-10-08 (`fase49_listas_de_precios` y `fase49b_guard_por_tabla`).
--
--
-- ── POR QUÉ TABLAS NUEVAS Y NO `product_prices` ──────────────────────────
--
-- `product_prices` es de SÓLO LECTURA para el ERP: el maestro es STEL y el
-- sync nocturno lo llena. Escribir las listas ahí sería pelearse cada noche
-- con el sync, que pisa lo que toca —se comprobó con `app.stel_campos`, que
-- declara `name`, `description`, `status` y `product_type`—.
--
-- Esto es otra cosa: el REGISTRO de lo que manda cada marca, con su fecha, su
-- archivo de origen y su historia. Sirve para ver cuánto aumentó cada uno y
-- para decidir qué actualizar en STEL. No decide precios: los registra.
--
--
-- ── LO QUE SE APRENDIÓ MIRANDO LOS ARCHIVOS ──────────────────────────────
--
-- Una «lista de precios» no es una columna. La de SPEEDRILL 2026 trae cuatro:
--
--   Referencia | Descripción | PVP ESPAÑA EUR | COSTO BUSCATOOLS ESPAÑA EUR
--              | PVP BUSCATOOLS ARG USD | COSTO ARG USD
--
-- Y sobre los 3.630 renglones, tres de esas cuatro son FÓRMULA de la primera:
--
--   costo EUR  = PVP EUR   x 0,50     el descuento que hace la marca
--   PVP USD    = PVP EUR   x 1,50
--   costo USD  = costo EUR x 1,75
--
-- O sea que la única columna independiente es el PVP de España: es lo que
-- mueve el proveedor. Mientras los factores no cambien, el % de aumento es
-- IDÉNTICO en las cuatro.
--
-- La trampa es justamente ésa: si en la lista siguiente el descuento baja de
-- 50 % a 45 %, el costo sube más que el PVP y una comparativa que mire una
-- sola columna lo esconde. Por eso se guardan LAS CUATRO columnas tal como
-- vienen, más los factores, y se marca cuál es la columna ancla.
--
--
-- ── EL PUENTE CON EL CATÁLOGO ────────────────────────────────────────────
--
-- La «Referencia» del archivo es el MODELO (S3154C), no el SKU. El cruce es
-- el prefijo de la marca, un punto y la referencia — la regla de la Fase 45.
-- Sin ese arreglo este módulo no tenía cómo atar una lista a un producto.
--
-- Primera carga: 3.627 de 3.630 cruzan. Los 3 que no son productos que
-- SPEEDRILL vende y el catálogo no tiene; se guardan igual, con `product_id`
-- en null, porque el día que existan el histórico ya está.

create table if not exists public.price_list_sources (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  brand_id    uuid references public.brands(id) on delete set null,
  kind        text not null check (kind in ('marca', 'proveedor')),
  notes       text,
  created_at  timestamptz not null default now(),
  unique (company_id, name)
);

create table if not exists public.price_list_versions (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  source_id     uuid not null references public.price_list_sources(id) on delete cascade,
  issued_on     date not null,          -- la fecha DE LA LISTA, no la de carga
  currency      text not null,
  anchor_column text not null,          -- cuál columna es la del proveedor
  factors       jsonb not null default '{}'::jsonb,
  origin        text not null check (origin in ('drive', 'mail', 'manual')),
  file_name     text,
  file_ref      text,
  file_url      text,
  notes         text,
  loaded_at     timestamptz not null default now(),
  loaded_by     uuid references auth.users(id) on delete set null,
  unique (source_id, issued_on, anchor_column)
);

create table if not exists public.price_list_items (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  version_id  uuid not null references public.price_list_versions(id) on delete cascade,
  reference   text not null,            -- la del archivo (el modelo), no el SKU
  description text,
  anchor      numeric(14,4),            -- la columna ancla, para comparar
  prices      jsonb not null default '{}'::jsonb,   -- todas, sin perder nada
  product_id  uuid references public.products(id) on delete set null,
  unique (version_id, reference)
);

create index if not exists idx_pli_version   on public.price_list_items (version_id);
create index if not exists idx_pli_producto  on public.price_list_items (product_id) where product_id is not null;
create index if not exists idx_pli_ref       on public.price_list_items (company_id, reference);
create index if not exists idx_plv_source    on public.price_list_versions (source_id, issued_on desc);


-- ── LA COMPARATIVA ───────────────────────────────────────────────────────
--
-- En una vista y no en el frontend, para que la misma cuenta valga para la
-- pantalla, para un informe y para cualquiera que consulte la base.
--
-- `security_invoker` para que respete RLS: sin eso la vista correría con los
-- permisos de quien la creó y un externo vería costos.
--
-- Incluye las TRES cosas que pasan entre dos listas: lo que cambió de precio,
-- lo que ENTRÓ y lo que SALIÓ. Las dos últimas son la mitad de la historia y
-- un join simple las pierde; por eso el `full outer join`.
create or replace view public.price_list_changes
with (security_invoker = true) as
with previa as (
  select v.*,
         lag(v.id)        over (partition by v.source_id, v.anchor_column order by v.issued_on) as prev_id,
         lag(v.issued_on) over (partition by v.source_id, v.anchor_column order by v.issued_on) as prev_issued_on
    from public.price_list_versions v
)
select
  coalesce(i.company_id, pi.company_id)        as company_id,
  v.source_id,
  v.id                                         as version_id,
  v.issued_on,
  v.prev_id                                    as prev_version_id,
  v.prev_issued_on,
  coalesce(i.reference, pi.reference)          as reference,
  coalesce(i.description, pi.description)      as description,
  coalesce(i.product_id, pi.product_id)        as product_id,
  i.anchor                                     as precio,
  pi.anchor                                    as precio_anterior,
  case when pi.anchor is not null and pi.anchor <> 0 and i.anchor is not null
       then round((i.anchor - pi.anchor) / pi.anchor * 100, 2)
  end                                          as porcentaje,
  case
    when v.prev_id is null                     then 'primera lista'
    when pi.id is null                         then 'entro'
    when i.id  is null                         then 'salio'
    when i.anchor is null or pi.anchor is null then 'sin dato'
    when i.anchor > pi.anchor                  then 'subio'
    when i.anchor < pi.anchor                  then 'bajo'
    else                                            'igual'
  end                                          as movimiento
from previa v
full outer join public.price_list_items i  on i.version_id  = v.id
left join      public.price_list_items pi on pi.version_id = v.prev_id
                                        and pi.reference  = i.reference
where i.id is not null or pi.id is not null;


-- ── PERMISOS ─────────────────────────────────────────────────────────────
--
-- Los costos son información comercial: SÓLO roles internos, con el mismo
-- helper con el que el catálogo decide quién ve stock. Escribir, sólo admin.

alter table public.price_list_sources  enable row level security;
alter table public.price_list_versions enable row level security;
alter table public.price_list_items    enable row level security;

drop policy if exists pls_select on public.price_list_sources;
create policy pls_select on public.price_list_sources for select
  using (company_id = any (app.current_internal_company_ids()));
drop policy if exists pls_write on public.price_list_sources;
create policy pls_write on public.price_list_sources for all
  using (company_id = any (app.current_internal_company_ids()) and app."current_role"(company_id) = 'admin')
  with check (company_id = any (app.current_internal_company_ids()) and app."current_role"(company_id) = 'admin');

drop policy if exists plv_select on public.price_list_versions;
create policy plv_select on public.price_list_versions for select
  using (company_id = any (app.current_internal_company_ids()));
drop policy if exists plv_write on public.price_list_versions;
create policy plv_write on public.price_list_versions for all
  using (company_id = any (app.current_internal_company_ids()) and app."current_role"(company_id) = 'admin')
  with check (company_id = any (app.current_internal_company_ids()) and app."current_role"(company_id) = 'admin');

drop policy if exists pli_select on public.price_list_items;
create policy pli_select on public.price_list_items for select
  using (company_id = any (app.current_internal_company_ids()));
drop policy if exists pli_write on public.price_list_items;
create policy pli_write on public.price_list_items for all
  using (company_id = any (app.current_internal_company_ids()) and app."current_role"(company_id) = 'admin')
  with check (company_id = any (app.current_internal_company_ids()) and app."current_role"(company_id) = 'admin');


-- ── EL GUARD, Y EL ERROR QUE TUVO ────────────────────────────────────────
--
-- Mismo criterio que la Fase 47: una fila no puede apuntar a la marca, la
-- fuente, la versión ni el producto de OTRA empresa. La FK no alcanza porque
-- el id existe — es de otro.
--
-- La primera versión era un solo `if` encadenado y empezaba así:
--
--     if tg_table_name = 'price_list_sources' and new.brand_id is not null
--
-- PL/pgSQL resuelve `new.brand_id` al ejecutar la condición ENTERA, no después
-- de ver que el primer operando es falso. Insertar en `price_list_versions`
-- —que no tiene ese campo— reventaba con «record new has no field brand_id».
-- Cada tabla tiene ahora su propio bloque.
create or replace function public.validar_lista_de_la_misma_empresa()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_otra uuid;
begin
  if tg_table_name = 'price_list_sources' then
    if new.brand_id is not null then
      select company_id into v_otra from brands where id = new.brand_id;
      if v_otra is distinct from new.company_id then
        raise exception 'marca_de_otra_empresa' using errcode = '23514',
          hint = 'buscar la marca por nombre Y company_id';
      end if;
    end if;

  elsif tg_table_name = 'price_list_versions' then
    select company_id into v_otra from price_list_sources where id = new.source_id;
    if v_otra is distinct from new.company_id then
      raise exception 'fuente_de_otra_empresa' using errcode = '23514';
    end if;

  elsif tg_table_name = 'price_list_items' then
    select company_id into v_otra from price_list_versions where id = new.version_id;
    if v_otra is distinct from new.company_id then
      raise exception 'version_de_otra_empresa' using errcode = '23514';
    end if;
    if new.product_id is not null then
      select company_id into v_otra from products where id = new.product_id;
      if v_otra is distinct from new.company_id then
        raise exception 'producto_de_otra_empresa' using errcode = '23514';
      end if;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_pls_misma_empresa on public.price_list_sources;
create trigger trg_pls_misma_empresa before insert or update on public.price_list_sources
  for each row execute function public.validar_lista_de_la_misma_empresa();
drop trigger if exists trg_plv_misma_empresa on public.price_list_versions;
create trigger trg_plv_misma_empresa before insert or update on public.price_list_versions
  for each row execute function public.validar_lista_de_la_misma_empresa();
drop trigger if exists trg_pli_misma_empresa on public.price_list_items;
create trigger trg_pli_misma_empresa before insert or update on public.price_list_items
  for each row execute function public.validar_lista_de_la_misma_empresa();


-- ── PRIMERA CARGA ────────────────────────────────────────────────────────
--
--   SPEEDRILL · 05/10/2026 · ancla «PVP ESPANA EUR» · 3.630 renglones
--   3.627 cruzan con el catálogo · 3 no están en el ERP
--   rango 0,77 a 511,72 EUR · promedio 51,39
--
-- Nota sobre el parseo, que costó: el primer intento sacaba 2.752 renglones y
-- perdía 878 —el 24 %— porque cortaba la fila en la primera coma, y 777
-- descripciones tienen comas. Anclando cada renglón al «USD» final del
-- anterior salen los 3.630. Si alguna carga da bastante menos de lo esperado,
-- mirar ahí antes que en ningún otro lado.
