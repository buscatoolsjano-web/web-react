-- ════════════════════════════════════════════════════════════════════════
-- Fase 20 · E2 · Mantenimiento — el historial de servicio importado de STEL
-- ════════════════════════════════════════════════════════════════════════
--
-- Esto NO es trabajo vivo. `maintenance_orders` representa lo que el taller
-- está haciendo hoy y sus triggers protegen cotización, cierre, torque y
-- stock; la historia de STEL está cerrada y no tiene por qué abrirles una
-- puerta. Por eso vive en sus propias tablas, y es de SÓLO LECTURA desde la
-- aplicación: no hay policy de escritura y `authenticated` sólo recibe el
-- grant de SELECT. Quien importa es el importador, con la clave de servicio.
--
-- El modelo sigue la forma real del dato, que la auditoría midió:
--
--   CADENA      (36)  el evento de STEL: presupuesto → orden → remito.
--                     Se encadenan por parent-document-id, un ID real.
--   DOCUMENTOS  (76)  los papeles que prueban el evento. Van una sola vez:
--                     un remito de 13 equipos es UN documento, no trece.
--   SERVICIOS  (200)  el evento visto desde cada equipo. Una fila por
--                     (cadena × equipo), porque el historial que le importa a
--                     alguien es el de SU llave de impulso.
--   LÍNEAS     (263)  lo que decía cada documento, tal cual, como evidencia.
--
-- STEL tiene 41 cadenas y 82 documentos: 5 cadenas (6 documentos, 22 líneas)
-- no tienen ningún equipo vinculado y quedan afuera a propósito, porque la
-- historia se lee desde el equipo y esas seis no aparecerían en ninguna ficha.
-- Están documentadas una por una en la auditoría.
--
-- Una regla entra como CHECK y no como costumbre: el importe sólo puede estar
-- cargado si es atribuible a un equipo. Se midió que las unidades de las
-- líneas no siguen a la cantidad de activos (11 equipos y una línea de 48
-- unidades), así que repartir sería inventar plata dentro de un historial.

-- ── 1 · Cadenas: el evento de STEL ─────────────────────────────────────
create table if not exists public.maintenance_service_chains (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id),
  -- Identidad: la sigla de la colección raíz más su id interno de STEL
  -- (`we23822940`). El número visible va en `label`: si STEL renumerara, el
  -- historial entero se duplicaría sin que nadie se entere.
  external_source  text not null default 'stel',
  external_id      text not null,
  label            text not null,
  -- Las seis formas que existen hoy más `order_delivery`, que no aparece en
  -- los 82 documentos pero es una cadena posible: una orden sin presupuesto
  -- con su remito. Se acepta para que una sincronización futura no falle por
  -- una forma legítima.
  chain_class      text not null check (chain_class in
                     ('complete','estimate_order','estimate_delivery','order_delivery',
                      'estimate_only','order_only','delivery_only')),
  customer_id      uuid references public.customers (id),
  received_at      date not null,
  delivered_at     date,
  -- Estados propios de la historia. No son los de `maintenance_orders`: acá
  -- no hay etapas ni transiciones, hay un servicio que terminó o no.
  status           text not null check (status in ('closed','open_quote','in_progress')),
  quotation_status text not null check (quotation_status in ('approved','pending')),
  invoiced         boolean,
  -- El estado tal como lo escribe STEL, para poder auditar la traducción.
  stel_status_raw  text not null,
  asset_count      integer not null check (asset_count >= 0),
  amount_attribution text not null check (amount_attribution in ('asset','shared','unknown')),
  currency_code    text references public.currencies (code),
  amount           numeric(14,2),
  technician_name_raw text,
  confidence       text not null check (confidence in ('alta','media')),
  imported_at      timestamptz not null default now(),
  last_synced_at   timestamptz,
  constraint chk_msc_fechas check (delivered_at is null or delivered_at >= received_at)
);

create unique index if not exists uq_msc_externo
  on public.maintenance_service_chains (company_id, external_source, external_id);
create index if not exists idx_msc_empresa_fecha
  on public.maintenance_service_chains (company_id, received_at desc);

comment on table public.maintenance_service_chains is
  'Un servicio de STEL: presupuesto → orden de trabajo → remito, encadenados por ID real. Historia cerrada, de sólo lectura.';
comment on column public.maintenance_service_chains.amount is
  'El importe del documento económico de la cadena. Es contexto: sólo es del equipo cuando amount_attribution = asset.';

-- ── 2 · Documentos de origen: los papeles, una sola vez ────────────────
create table if not exists public.maintenance_service_source_documents (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id),
  chain_id         uuid not null references public.maintenance_service_chains (id) on delete cascade,
  external_source  text not null default 'stel',
  external_id      text not null,
  doc_kind         text not null check (doc_kind in ('estimate','work_order','delivery_note')),
  reference        text not null,
  doc_date         date not null,
  stel_status      text,
  currency_code    text references public.currencies (code),
  total_amount     numeric(14,2),
  pdf_path         text,
  -- La traza del encadenamiento real, para poder reconstruirlo sin volver a STEL.
  parent_external_id text,
  created_at       timestamptz not null default now()
);

create unique index if not exists uq_mssd_externo
  on public.maintenance_service_source_documents (company_id, external_source, external_id);
create index if not exists idx_mssd_cadena
  on public.maintenance_service_source_documents (chain_id, doc_date);

comment on table public.maintenance_service_source_documents is
  'Los documentos de STEL que prueban el servicio. Uno por documento, nunca uno por equipo: un remito de 13 equipos es una sola fila.';

-- ── 3 · Servicios: el evento visto desde cada equipo ───────────────────
create table if not exists public.maintenance_service_history (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id),
  chain_id         uuid not null references public.maintenance_service_chains (id) on delete cascade,
  asset_id         uuid not null references public.maintenance_assets (id) on delete cascade,
  -- El dueño del equipo cuando se importó. Es un snapshot: si el equipo cambia
  -- de dueño, el servicio siguió siendo del que lo mandó.
  customer_id      uuid references public.customers (id),
  external_source  text not null default 'stel',
  external_id      text not null,
  received_at      date not null,
  delivered_at     date,
  status           text not null check (status in ('closed','open_quote','in_progress')),
  quotation_status text not null check (quotation_status in ('approved','pending')),
  invoiced         boolean,
  title            text,
  -- STEL no tiene campo de diagnóstico. Queda nulo a propósito: repetir acá el
  -- texto del trabajo sería inventar un diagnóstico que nadie escribió.
  diagnosis_notes  text,
  repair_notes     text,
  closing_notes    text,
  technician_name_raw text,
  currency_code    text references public.currencies (code),
  amount           numeric(14,2),
  amount_attribution text not null check (amount_attribution in ('asset','shared','unknown')),
  stel_status_raw  text not null,
  imported_at      timestamptz not null default now(),
  last_synced_at   timestamptz,
  constraint chk_msh_fechas check (delivered_at is null or delivered_at >= received_at),
  -- La regla crítica, en la base y no en la costumbre: un importe cargado
  -- significa que es de este equipo. Si el documento se comparte, no hay
  -- importe, porque no se puede repartir sin inventarlo.
  constraint chk_msh_importe_atribuible check (amount is null or amount_attribution = 'asset')
);

create unique index if not exists uq_msh_externo
  on public.maintenance_service_history (company_id, external_source, external_id);
create index if not exists idx_msh_equipo
  on public.maintenance_service_history (asset_id, received_at desc);
create index if not exists idx_msh_cadena
  on public.maintenance_service_history (chain_id);

comment on table public.maintenance_service_history is
  'Un servicio histórico atribuido a UN equipo. 36 cadenas de STEL sobre 132 equipos dan 200 filas: el mismo evento se ve una vez por equipo.';
comment on column public.maintenance_service_history.diagnosis_notes is
  'Nulo en lo importado: STEL no guarda diagnóstico. No se rellena con el texto del trabajo.';

-- ── 4 · Líneas de los documentos: la evidencia, tal cual ───────────────
create table if not exists public.maintenance_service_source_lines (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id),
  source_document_id uuid not null references public.maintenance_service_source_documents (id) on delete cascade,
  external_id        text,
  line_no            integer not null,
  line_type          text not null check (line_type in ('product','service','section')),
  sku                text,
  description        text,
  quantity           numeric(14,3),
  unit_price         numeric(14,2),
  amount             numeric(14,2),
  currency_code      text references public.currencies (code),
  -- Emparejado por SKU exacto contra el catálogo, o nulo. Nunca por parecido
  -- de nombres. Y nunca mueve stock: esto es historia, no consumo.
  matched_product_id uuid references public.products (id),
  created_at         timestamptz not null default now()
);

create unique index if not exists uq_mssl_externo
  on public.maintenance_service_source_lines (company_id, source_document_id, external_id)
  where external_id is not null;
create index if not exists idx_mssl_documento
  on public.maintenance_service_source_lines (source_document_id, line_no);
create index if not exists idx_mssl_producto
  on public.maintenance_service_source_lines (matched_product_id)
  where matched_product_id is not null;

comment on table public.maintenance_service_source_lines is
  'Lo que decía cada documento de STEL, línea por línea. Read-only: no participa del flujo operativo y no mueve stock.';

-- ── RLS: se ve la historia si se ve el equipo ──────────────────────────
--
-- La policy de los servicios pregunta por el equipo con un EXISTS, y ese
-- SELECT pasa a su vez por la RLS de `maintenance_assets`. Hoy da lo mismo que
-- comparar `company_id` —la visibilidad de un equipo es su empresa—, pero si
-- mañana se restringe, el historial la sigue solo. Las otras tres tablas
-- cuelgan de los servicios por la misma razón: un documento se ve si se ve
-- alguno de los equipos que estuvieron en ese servicio.
--
-- No hay policy de escritura en ninguna de las cuatro, y `authenticated` sólo
-- tiene el grant de SELECT: la historia importada no se edita desde la app.
alter table public.maintenance_service_chains           enable row level security;
alter table public.maintenance_service_source_documents enable row level security;
alter table public.maintenance_service_history          enable row level security;
alter table public.maintenance_service_source_lines     enable row level security;

drop policy if exists mant_hist_select on public.maintenance_service_history;
create policy mant_hist_select on public.maintenance_service_history
  for select to authenticated
  using (
    company_id in (select unnest(app.current_maintenance_company_ids()))
    and exists (select 1 from public.maintenance_assets a where a.id = maintenance_service_history.asset_id)
  );

drop policy if exists mant_cadenas_select on public.maintenance_service_chains;
create policy mant_cadenas_select on public.maintenance_service_chains
  for select to authenticated
  using (
    company_id in (select unnest(app.current_maintenance_company_ids()))
    -- La columna se califica con el nombre de la tabla, y no es un adorno:
    -- `maintenance_service_history` también tiene una columna `id`, así que un
    -- `= id` suelto se resuelve contra ELLA y la condición nunca da verdadero.
    -- Sin RLS que falle: simplemente no se ve ninguna cadena, ningún documento
    -- y ninguna línea. Se encontró mirando la pantalla, no leyendo el SQL.
    and exists (select 1 from public.maintenance_service_history h where h.chain_id = maintenance_service_chains.id)
  );

drop policy if exists mant_docs_select on public.maintenance_service_source_documents;
create policy mant_docs_select on public.maintenance_service_source_documents
  for select to authenticated
  using (
    company_id in (select unnest(app.current_maintenance_company_ids()))
    and exists (select 1 from public.maintenance_service_chains c where c.id = maintenance_service_source_documents.chain_id)
  );

drop policy if exists mant_lineas_select on public.maintenance_service_source_lines;
create policy mant_lineas_select on public.maintenance_service_source_lines
  for select to authenticated
  using (
    company_id in (select unnest(app.current_maintenance_company_ids()))
    and exists (select 1 from public.maintenance_service_source_documents d where d.id = maintenance_service_source_lines.source_document_id)
  );

-- Revocar ANTES de dar. Supabase tiene privilegios por defecto que le dan
-- todo a `anon` y a `authenticated` sobre cualquier tabla que nazca en
-- `public`: sin este revoke, «sólo lectura» sería una intención y no una
-- regla, y lo único que estaría frenando un DELETE sería la ausencia de una
-- policy. El invariante de abajo falla la migración si esto no se cumple.
revoke all on public.maintenance_service_chains           from anon, authenticated;
revoke all on public.maintenance_service_source_documents from anon, authenticated;
revoke all on public.maintenance_service_history          from anon, authenticated;
revoke all on public.maintenance_service_source_lines     from anon, authenticated;

grant select on public.maintenance_service_chains           to authenticated;
grant select on public.maintenance_service_source_documents to authenticated;
grant select on public.maintenance_service_history          to authenticated;
grant select on public.maintenance_service_source_lines     to authenticated;
grant all on public.maintenance_service_chains           to service_role;
grant all on public.maintenance_service_source_documents to service_role;
grant all on public.maintenance_service_history          to service_role;
grant all on public.maintenance_service_source_lines     to service_role;

-- ── Invariantes ────────────────────────────────────────────────────────
do $control$
declare
  t           text;
  rls         boolean;
  pols        int;
  escribe     int;
  anon_policy int;
  grants      int;
  trigs       int;
begin
  foreach t in array array['maintenance_service_chains','maintenance_service_source_documents',
                           'maintenance_service_history','maintenance_service_source_lines']
  loop
    select c.relrowsecurity into rls from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = t;
    if rls is null then raise exception 'No se creó la tabla %', t; end if;
    if not rls then raise exception 'La tabla % quedó SIN RLS', t; end if;

    -- Una sola policy, y de SELECT: la historia importada no se edita.
    select count(*) into pols from pg_policies where tablename = t;
    if pols <> 1 then raise exception 'La tabla % tiene % policies, esperaba 1 (sólo SELECT)', t, pols; end if;

    select count(*) into escribe from pg_policies
     where tablename = t and cmd <> 'SELECT';
    if escribe > 0 then raise exception 'La tabla % tiene % policy de escritura: la historia es read-only', t, escribe; end if;

    -- Acá se es más estricto que en el resto del módulo, y a propósito: anon
    -- no tiene policy NI grant. Ninguna de las dos cosas.
    select count(*) into anon_policy from pg_policies
     where tablename = t and 'anon' = any(roles);
    if anon_policy > 0 then raise exception 'Hay % policy que le dan acceso a anon en %', anon_policy, t; end if;

    select count(*) into grants from information_schema.role_table_grants
     where table_schema = 'public' and table_name = t and grantee = 'anon';
    if grants > 0 then raise exception '% le da % permisos a anon', t, grants; end if;

    -- Y `authenticated` no tiene con qué escribir aunque apareciera una policy.
    select count(*) into grants from information_schema.role_table_grants
     where table_schema = 'public' and table_name = t and grantee = 'authenticated'
       and privilege_type <> 'SELECT';
    if grants > 0 then raise exception '% le da % permisos que no son SELECT a authenticated', t, grants; end if;

    -- Sin triggers: esto es historia, no una máquina de estados.
    select count(*) into trigs from pg_trigger g
      join pg_class c on c.oid = g.tgrelid
     where c.relname = t and not g.tgisinternal;
    if trigs > 0 then raise exception 'La tabla % tiene % triggers y no debería tener ninguno', t, trigs; end if;
  end loop;

  -- La regla del importe tiene que estar en la base, no en el importador.
  if not exists (select 1 from pg_constraint where conname = 'chk_msh_importe_atribuible') then
    raise exception 'Falta el CHECK que impide cargar un importe no atribuible';
  end if;
end
$control$;
