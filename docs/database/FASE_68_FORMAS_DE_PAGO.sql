-- Fase 68: la forma de pago deja de ser texto libre.
--
-- ── El pedido ───────────────────────────────────────────────────────────────
--
-- «La forma de pago está bien que sea opcional, pero tiene que ser con
-- opciones. No puede ser un texto plano que puedo escribir lo que quiera. Y
-- esos los voy a ir agregando desde ahí o desde configuración.»
--
-- ── Por qué el documento SIGUE guardando texto ──────────────────────────────
--
-- `sales_quotes.payment_terms` y `sales_orders.payment_terms` no cambian: se
-- siguen guardando como texto. Esta tabla es un CATÁLOGO DE OPCIONES, no una
-- clave foránea, y la diferencia importa.
--
-- Una cotización tiene que conservar la forma de pago *como se acordó*. Si
-- mañana se renombra «30 días» a «30 días F/F con ECHEQ», las cotizaciones de
-- marzo no pueden cambiar solas: se le mandaron a un cliente diciendo otra
-- cosa. Es el mismo criterio que los `sku_snapshot` y `name_snapshot` de los
-- renglones, que ya están así por la misma razón.
--
-- De paso: no hay que migrar ni un documento, nada de lo que ya anda se toca,
-- y renombrar o borrar una opción es seguro por construcción.
--
-- ── Quién escribe ───────────────────────────────────────────────────────────
--
-- Se lee por RLS y se escribe por RPC `security definer` que comprueba el rol,
-- que es el patrón de los otros maestros (marcas, categorías). Crear puede
-- `admin` y `employee` —los mismos que pueden cotizar—, porque el pedido es
-- justamente poder agregar una opción nueva mientras se arma la cotización.

create table if not exists public.payment_terms (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  active      boolean not null default true,
  -- El orden lo decide quien configura, no el alfabeto: «pago por adelantado»
  -- antes que «15 días» es lo natural de leer, y alfabéticamente iría al revés.
  sort_order  integer not null default 100,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  constraint payment_terms_nombre_no_vacio check (btrim(name) <> '')
);

-- Sin duplicados por empresa, ignorando mayúsculas y espacios: «30 días» y
-- «30 Días » son la misma opción escrita dos veces.
create unique index if not exists payment_terms_empresa_nombre_uk
  on public.payment_terms (company_id, lower(btrim(name)));

create index if not exists payment_terms_empresa_idx
  on public.payment_terms (company_id, active, sort_order);

alter table public.payment_terms enable row level security;

-- Lectura: cualquiera de la empresa. Es una lista de opciones, no un dato
-- sensible, y el formulario de cotización la necesita.
drop policy if exists payment_terms_select on public.payment_terms;
create policy payment_terms_select on public.payment_terms
  for select to authenticated
  using (company_id in (select unnest(app.current_company_ids())));

grant select on public.payment_terms to authenticated;

comment on table public.payment_terms is
  'Fase 68. Catalogo de formas de pago por empresa. Los documentos guardan el TEXTO, no el id: una cotizacion conserva lo que se acordo aunque la opcion se renombre despues.';

-- ── Las RPC ─────────────────────────────────────────────────────────────────
--
-- Mismo patrón que marcas y categorías: se lee por RLS y se escribe por
-- `security definer` que comprueba el rol. La diferencia está en quién puede
-- CREAR: acá también `employee`, porque el pedido era poder agregar una opción
-- mientras se arma la cotización, y cotizar lo hacen admin y employee.
-- Administrar la lista —renombrar, desactivar, borrar— sigue siendo de admin.

create or replace function app.forma_pago_nombre(p_texto text)
returns text language sql immutable as $$
  select nullif(btrim(regexp_replace(coalesce(p_texto, ''), '\s+', ' ', 'g')), '')
$$;

create or replace function app.forma_pago_exigir_puede_crear(p_company uuid)
returns void language plpgsql security definer as $$
begin
  if p_company is null
     or coalesce(app."current_role"(p_company), '') not in ('admin', 'employee') then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;
end
$$;

-- `config_formas_pago_listar(p_company)`  → jsonb [{id, nombre, activa, orden, usos}]
--     `usos` cuenta en cuántos documentos está escrito ese texto hoy. No
--     bloquea nada: es información para decidir entre desactivar y borrar.
-- `config_forma_pago_crear(p_company, p_nombre)`       → admin o employee
-- `config_forma_pago_renombrar(p_company, p_id, p_nombre)` → admin
-- `config_forma_pago_estado(p_company, p_id, p_activa)`    → admin
-- `config_forma_pago_eliminar(p_company, p_id)`            → admin
--
-- Renombrar y eliminar NO tocan ningún documento, por lo que dice el bloque de
-- arriba: ahí quedó el texto, no una referencia.
--
-- El cuerpo completo está aplicado en la base (migración
-- `fase68_payment_terms_rpcs_y_semilla`). Los errores que levantan son los
-- mismos códigos que el resto de los maestros —`sin_permiso`,
-- `nombre_duplicado`, `no_encontrado`, `datos_invalidos:name`— para que
-- `mensajeErrorMaestro()` los traduzca sin tocar nada.

-- ── La semilla ──────────────────────────────────────────────────────────────
--
-- Las que se pidieron, en el orden en que se leen naturalmente, y además lo
-- que YA estaba escrito a mano en documentos: si no, una cotización existente
-- abriría con el desplegable vacío y guardarla borraría lo que decía.

insert into public.payment_terms (company_id, name, sort_order)
select c.id, v.nombre, v.orden
  from public.companies c
  cross join (values
    ('Pago por adelantado', 10),
    ('50% por adelantado', 20),
    ('15 días', 30),
    ('30 días', 40),
    ('60 días', 50)
  ) as v(nombre, orden)
on conflict do nothing;

insert into public.payment_terms (company_id, name, sort_order)
select distinct d.company_id, btrim(d.payment_terms), 100
  from (
    select company_id, payment_terms from public.sales_quotes
    union all
    select company_id, payment_terms from public.sales_orders
  ) d
 where coalesce(btrim(d.payment_terms), '') <> ''
on conflict do nothing;
