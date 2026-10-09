-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Fase 58 · E2 — Los permisos de cada rol, configurables de verdad         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- EL PEDIDO. «Ahora está administrador, empleado, vendedor y técnico pero yo no
-- sé a qué tiene acceso cada cosa. Quiero poder configurar eso como yo quiera».
--
-- POR QUÉ NO ALCANZABA CON LA PANTALLA. Quién puede ver y escribir qué NO vive
-- en el frontend: vive en cinco funciones de `app` que usan 104 políticas RLS,
-- con los roles escritos a mano adentro:
--
--   app.current_internal_company_ids()     admin, employee, salesperson, technician
--   app.current_writer_company_ids()       admin, employee
--   app.current_email_company_ids()        admin, employee
--   app.current_whatsapp_company_ids()     admin, employee, salesperson
--   app.current_maintenance_company_ids()  admin, employee
--
-- Si los permisos se configuraran sólo en la pantalla, apagar uno escondería el
-- menú y la base lo seguiría permitiendo: la pantalla mentiría. Pero esas cinco
-- funciones son el ÚNICO cuello de botella de las 104 políticas, así que pasan a
-- consultar una tabla y el interruptor cambia lo que la base deja hacer.
--
-- EL ADMIN NO SE CONFIGURA, A PROPÓSITO. Tiene todo siempre y no está en la
-- tabla. Es lo que evita la clase de error más fea que podría tener esta
-- pantalla: quedarse afuera de la pantalla de permisos por haberse quitado un
-- permiso a sí mismo, sin nadie que lo pueda devolver.
--
-- NADA CAMBIA AL APLICARLA. Las concesiones se siembran con exactamente los
-- roles que hoy tienen las cinco funciones, para las dos empresas. La
-- verificación del final lo compara rol por rol contra la lista de arriba.

begin;

-- ── El catálogo: qué permisos existen ──────────────────────────────────────
--
-- Tabla y no un enum: la pantalla necesita la etiqueta y, sobre todo, la
-- explicación de qué habilita cada uno —que era la mitad del pedido («yo no sé
-- a qué tiene acceso cada cosa»)—. Un enum no lleva texto.

create table if not exists public.capability_catalog (
  key         text primary key,
  label       text not null,
  description text not null,
  -- Qué función de `app` la aplica. Está para poder AFIRMAR que cada permiso
  -- del catálogo tiene quien lo haga cumplir: la verificación del final falla
  -- si alguna vez se agrega uno que no apaga nada.
  enforced_by text not null,
  position    integer not null
);

comment on table public.capability_catalog is
  'Fase 58 · E2: los permisos que se pueden dar o quitar por rol. Estático: lo cambia una migración, no la aplicación.';

insert into public.capability_catalog (key, label, description, enforced_by, position) values
  ('comercial_ver', 'Ver lo comercial',
   'Ver el catálogo con sus costos y listas de precios, los clientes con sus contactos y direcciones, y las cotizaciones, pedidos y remitos.',
   'app.current_internal_company_ids', 1),
  ('comercial_escribir', 'Cargar y editar documentos',
   'Crear y modificar cotizaciones, pedidos de venta, remitos, facturas, pedidos de compra y productos. Sin esto, lo comercial se ve pero no se toca.',
   'app.current_writer_company_ids', 2),
  ('emails', 'Correo',
   'Leer y responder las casillas de la empresa, y usar sus plantillas.',
   'app.current_email_company_ids', 3),
  ('whatsapp', 'WhatsApp',
   'Ver y contestar las conversaciones de WhatsApp de la empresa.',
   'app.current_whatsapp_company_ids', 4),
  ('mantenimiento', 'Mantenimiento',
   'Equipos, órdenes de servicio, mediciones y su historial.',
   'app.current_maintenance_company_ids', 5)
on conflict (key) do update
  set label = excluded.label,
      description = excluded.description,
      enforced_by = excluded.enforced_by,
      position = excluded.position;

-- ── Las concesiones: qué rol tiene cada permiso, en cada empresa ───────────
--
-- Por empresa y no global: Buscatools y Torquetools pueden querer repartir el
-- trabajo distinto, y todo lo demás del sistema ya está partido por company_id.

create table if not exists public.role_capabilities (
  company_id uuid not null references public.companies(id) on delete cascade,
  role       text not null,
  capability text not null references public.capability_catalog(key) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references public.profiles(id) on delete set null,
  primary key (company_id, role, capability),
  -- `admin` NO está: tiene todo siempre (ver `app.rol_tiene`). Los externos
  -- tampoco: lo que ve un cliente o un proveedor lo decide su vínculo con la
  -- empresa, no un interruptor de esta pantalla.
  constraint role_capabilities_role_check
    check (role in ('employee', 'salesperson', 'technician'))
);

comment on table public.role_capabilities is
  'Fase 58 · E2: qué permisos tiene cada rol en cada empresa. El admin no figura: tiene todo. Lo leen las funciones app.current_*_company_ids.';

-- ── El predicado ───────────────────────────────────────────────────────────

create or replace function app.rol_tiene(p_company uuid, p_role text, p_cap text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  -- El admin primero y sin consultar la tabla: así sigue entrando aunque la
  -- tabla quede vacía por un error de datos. Un sistema sin administrador que
  -- pueda arreglarlo no se arregla desde adentro.
  select p_role = 'admin'
     or exists (
       select 1 from public.role_capabilities rc
        where rc.company_id = p_company
          and rc.role = p_role
          and rc.capability = p_cap
     );
$function$;

comment on function app.rol_tiene(uuid, text, text) is
  'Fase 58 · E2: ¿este rol tiene este permiso en esta empresa? El admin siempre sí.';

-- ── Las cinco funciones, ahora consultando la tabla ────────────────────────
--
-- La forma se mantiene —devuelven uuid[] y son STABLE SECURITY DEFINER— para
-- no tocar ninguna de las 104 políticas que las usan.
--
-- Los roles externos (customer, distributor, supplier) quedan afuera igual que
-- antes: no pueden tener concesiones porque el CHECK de la tabla no los acepta,
-- así que `rol_tiene` les da false.

create or replace function app.current_internal_company_ids()
returns uuid[]
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(array_agg(m.company_id), '{}')
  from company_memberships m
  where m.user_id = auth.uid() and m.status = 'active'
    and app.rol_tiene(m.company_id, m.role, 'comercial_ver');
$function$;

create or replace function app.current_writer_company_ids()
returns uuid[]
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(array_agg(m.company_id), '{}')
  from company_memberships m
  where m.user_id = auth.uid() and m.status = 'active'
    and app.rol_tiene(m.company_id, m.role, 'comercial_escribir');
$function$;

create or replace function app.current_email_company_ids()
returns uuid[]
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(array_agg(m.company_id), '{}')
  from company_memberships m
  where m.user_id = auth.uid() and m.status = 'active'
    and app.rol_tiene(m.company_id, m.role, 'emails');
$function$;

create or replace function app.current_whatsapp_company_ids()
returns uuid[]
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(array_agg(m.company_id), '{}')
  from company_memberships m
  where m.user_id = auth.uid() and m.status = 'active'
    and app.rol_tiene(m.company_id, m.role, 'whatsapp');
$function$;

create or replace function app.current_maintenance_company_ids()
returns uuid[]
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(array_agg(m.company_id), '{}')
  from company_memberships m
  where m.user_id = auth.uid() and m.status = 'active'
    and app.rol_tiene(m.company_id, m.role, 'mantenimiento');
$function$;

-- ── Las concesiones de hoy, tal cual ───────────────────────────────────────
--
-- Se arman con el producto de las empresas por la lista literal de arriba. El
-- `admin` no va: lo da `rol_tiene`.

insert into public.role_capabilities (company_id, role, capability)
select c.id, g.role, g.capability
from public.companies c
cross join (values
  ('employee',    'comercial_ver'),
  ('salesperson', 'comercial_ver'),
  ('technician',  'comercial_ver'),
  ('employee',    'comercial_escribir'),
  ('employee',    'emails'),
  ('employee',    'whatsapp'),
  ('salesperson', 'whatsapp'),
  ('employee',    'mantenimiento')
) as g(role, capability)
on conflict do nothing;

-- ── Quién puede leer esto ──────────────────────────────────────────────────

alter table public.capability_catalog enable row level security;
alter table public.role_capabilities  enable row level security;

-- El catálogo no tiene datos de nadie: es una lista de nombres y explicaciones.
drop policy if exists capability_catalog_select on public.capability_catalog;
create policy capability_catalog_select on public.capability_catalog
  for select to authenticated using (true);

-- Las políticas RLS se evalúan COMO EL USUARIO QUE CONSULTA, así que la función
-- que usan tiene que estar concedida a `authenticated`. `app.es_admin_activo`
-- NO lo está, y a propósito: recibe un actor cualquiera, y concederla dejaría a
-- cualquiera averiguar si OTRA persona es admin. Así que va una del patrón
-- `current_*_ids()`, que sólo puede hablar de quien llama.
--
-- La primera versión de esta migración usaba `es_admin_activo` en la política y
-- la tabla daba «permission denied» al leerla como `authenticated`. No se vio al
-- aplicarla —como `postgres` no hay RLS— sino al probar haciéndose pasar por un
-- admin real. Ésa es la única prueba que vale.
create or replace function app.current_admin_company_ids()
returns uuid[]
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(array_agg(m.company_id), '{}')
  from company_memberships m
  join companies c on c.id = m.company_id
  where m.user_id = auth.uid() and m.status = 'active'
    and m.role = 'admin' and c.is_active;
$function$;

revoke all on function app.current_admin_company_ids() from public;
grant execute on function app.current_admin_company_ids() to authenticated;

-- Las concesiones las lee el admin, que es quien ve la pantalla. El resto no
-- necesita la tabla entera: para saber lo suyo está `public.mis_capacidades()`.
drop policy if exists role_capabilities_select on public.role_capabilities;
create policy role_capabilities_select on public.role_capabilities
  for select to authenticated
  using (company_id = any (app.current_admin_company_ids()));

-- Sin políticas de insert, update ni delete A PROPÓSITO: se cambian por la RPC
-- de abajo, que valida y deja registro. Una escritura directa no auditaría.

-- ── Lo mío ─────────────────────────────────────────────────────────────────
--
-- Qué puede hacer QUIEN PREGUNTA, en todas sus empresas de una sola vez.
--
-- En una llamada y sin recibir el company_id: desde Argentina cada ida y vuelta
-- a São Paulo son ~220 ms, así que esto tiene que poder pedirse EN PARALELO con
-- las membresías. Si necesitara la empresa activa serían dos viajes en fila.

create or replace function public.mis_capacidades()
returns table (company_id uuid, capability text)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select m.company_id, k.key
  from company_memberships m
  cross join public.capability_catalog k
  where m.user_id = auth.uid() and m.status = 'active'
    and app.rol_tiene(m.company_id, m.role, k.key);
$function$;

comment on function public.mis_capacidades() is
  'Fase 58 · E2: los permisos del usuario que llama, en todas sus empresas. Una llamada, sin parámetros, para poder pedirse en paralelo con las membresías.';

revoke all on function public.mis_capacidades() from public;
grant execute on function public.mis_capacidades() to authenticated;

-- ── El registro del cambio ─────────────────────────────────────────────────
--
-- Tabla propia y no `company_audit`: su `changed_fields` es `text[]`, una lista
-- de nombres de campo, y no puede guardar un antes/despué. El primer intento
-- metía ahí un `jsonb_build_object` —plpgsql no lo valida al crear la función—
-- y habría estallado recién al primer guardado de permisos.
--
-- Guarda las dos listas COMPLETAS y no la diferencia: así se puede responder
-- «qué podía hacer un vendedor en marzo» leyendo un solo renglón.

create table if not exists public.role_capabilities_audit (
  id         bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  role       text not null,
  capabilities_before text[] not null,
  capabilities_after  text[] not null,
  actor_id   uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists role_capabilities_audit_company_idx
  on public.role_capabilities_audit (company_id, created_at desc);

alter table public.role_capabilities_audit enable row level security;

drop policy if exists role_capabilities_audit_select on public.role_capabilities_audit;
create policy role_capabilities_audit_select on public.role_capabilities_audit
  for select to authenticated
  using (company_id = any (app.current_admin_company_ids()));

grant select on public.role_capabilities_audit to authenticated;

-- ── Guardar los permisos de un rol ─────────────────────────────────────────

create or replace function public.config_permisos_rol_guardar(
  p_company uuid,
  p_role    text,
  p_caps    text[]
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_antes text[];
  v_despues text[];
  v_desconocidas text[];
begin
  if not app.es_admin_activo(auth.uid(), p_company) then
    raise exception 'sin_permiso' using errcode = 'P0001';
  end if;

  -- El admin no se configura: tiene todo y no está en la tabla.
  if p_role not in ('employee', 'salesperson', 'technician') then
    raise exception 'rol_no_configurable' using errcode = 'P0001';
  end if;

  -- Un permiso que no existe se rechaza en vez de guardarse: una clave mal
  -- escrita quedaría ahí sin apagar nada y la pantalla la mostraría prendida.
  select coalesce(array_agg(c), '{}') into v_desconocidas
  from unnest(coalesce(p_caps, '{}')) as c
  where c not in (select key from public.capability_catalog);

  if array_length(v_desconocidas, 1) > 0 then
    raise exception 'permiso_desconocido' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(capability order by capability), '{}') into v_antes
  from public.role_capabilities
  where company_id = p_company and role = p_role;

  delete from public.role_capabilities
  where company_id = p_company and role = p_role;

  -- `distinct` y no `on conflict`: la lista viene de casillas de la pantalla y
  -- un duplicado es un error del que la manda, no algo que haya que tolerar en
  -- silencio fila por fila.
  insert into public.role_capabilities (company_id, role, capability, granted_by)
  select distinct p_company, p_role, c, auth.uid()
  from unnest(coalesce(p_caps, '{}')) as c;

  select coalesce(array_agg(capability order by capability), '{}') into v_despues
  from public.role_capabilities
  where company_id = p_company and role = p_role;

  -- Sólo si de verdad cambió: guardar un renglón por cada vez que se abrió y
  -- cerró el formulario sin tocar nada haría ilegible el registro.
  if v_antes is distinct from v_despues then
    insert into public.role_capabilities_audit
      (company_id, role, capabilities_before, capabilities_after, actor_id)
    values (p_company, p_role, v_antes, v_despues, auth.uid());
  end if;
end;
$function$;

revoke all on function public.config_permisos_rol_guardar(uuid, text, text[]) from public;
grant execute on function public.config_permisos_rol_guardar(uuid, text, text[]) to authenticated;

grant select on public.capability_catalog to authenticated;
grant select on public.role_capabilities  to authenticated;

commit;

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Verificación — que NADA haya cambiado                                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Compara rol por rol lo que `app.rol_tiene` responde ahora contra los roles
-- que las cinco funciones tenían escritos a mano antes de esta migración.

do $$
declare
  v_falla text;
  v_sin_quien text;
begin
  -- La verdad de antes, copiada de las definiciones viejas.
  create temp table esperado (capability text, role text) on commit drop;
  insert into esperado values
    ('comercial_ver', 'admin'), ('comercial_ver', 'employee'),
    ('comercial_ver', 'salesperson'), ('comercial_ver', 'technician'),
    ('comercial_escribir', 'admin'), ('comercial_escribir', 'employee'),
    ('emails', 'admin'), ('emails', 'employee'),
    ('whatsapp', 'admin'), ('whatsapp', 'employee'), ('whatsapp', 'salesperson'),
    ('mantenimiento', 'admin'), ('mantenimiento', 'employee');

  select string_agg(format('%s/%s en %s: esperado %s, da %s', r.role, k.key, c.slug,
                           exists (select 1 from esperado e where e.capability = k.key and e.role = r.role),
                           app.rol_tiene(c.id, r.role, k.key)), E'\n')
    into v_falla
  from public.companies c
  cross join public.capability_catalog k
  cross join (values ('admin'), ('employee'), ('salesperson'), ('technician')) as r(role)
  where app.rol_tiene(c.id, r.role, k.key)
     <> exists (select 1 from esperado e where e.capability = k.key and e.role = r.role);

  if v_falla is not null then
    raise exception E'Los permisos NO quedaron como estaban:\n%', v_falla;
  end if;

  -- Cada permiso del catálogo tiene que apagar algo de verdad. Uno sin función
  -- que lo aplique sería un interruptor que sólo esconde el menú.
  select string_agg(k.key, ', ') into v_sin_quien
  from public.capability_catalog k
  where to_regprocedure(k.enforced_by || '()') is null;

  if v_sin_quien is not null then
    raise exception 'Permisos sin quien los aplique: %', v_sin_quien;
  end if;

  raise notice 'OK · los permisos de los 4 roles quedaron idénticos en las 2 empresas, y los 5 son aplicados por la base.';
end $$;
