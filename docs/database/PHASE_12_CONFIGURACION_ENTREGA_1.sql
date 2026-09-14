-- ===========================================================================
-- FASE 12 · CONFIGURACIÓN — ENTREGA 1 · usuarios, roles e invitaciones
-- ===========================================================================
--
-- Migración: fase12_configuracion_entrega1_usuarios
--
-- Autoridad (sin cambios de modelo):
--   · Supabase Auth       identidad (email, contraseña, invitación, confirmación)
--   · profiles            datos globales de la persona
--   · company_memberships empresa + rol + estado (active / suspended)
--
-- Qué cambia:
--   1. `users_audit`: bitácora mínima de altas, reenvíos, cambios de rol y de
--      estado. Sin contraseñas, tokens ni enlaces. Sólo la leen los admin.
--   2. `company_memberships` deja de aceptar escrituras directas de
--      `authenticated`: se borra la policy `memberships_write` (ALL para admin)
--      y se revocan INSERT/UPDATE/DELETE. Con esa policy un admin podía, por la
--      API REST, borrar membresías (incluida la propia), cambiar `user_id` o
--      `company_id`, o dejar la empresa sin administradores. Ahora sólo se
--      escribe con las RPC de abajo (usuario autenticado) o desde la Edge
--      Function `config-usuarios` (clave de servicio, del lado del servidor).
--   3. Invariante «último admin», EN LA BASE: un trigger impide que un UPDATE o
--      DELETE deje a una empresa sin ninguna membresía admin activa. Serializa
--      por empresa con `FOR NO KEY UPDATE` sobre `companies`, así dos admins
--      que se degradan a la vez no terminan en cero.
--   4. RPC para admin (JWT del usuario): listar, cambiar rol, cambiar estado.
--   5. RPC sólo para `service_role` (las usa la Edge Function): validar una
--      invitación, registrar la membresía, preparar y auditar un reenvío.
--
-- Roles: los del CHECK (admin, employee, salesperson, technician, distributor,
-- customer, supplier). En esta entrega sólo se ASIGNAN los internos. Los
-- externos exigen `customer_id`/`supplier_id` (chk_external_link) y quedan
-- fuera de la UI (decisión F15 de la Entrega 0); se pueden suspender.
-- ===========================================================================

-- 1 · Bitácora ---------------------------------------------------------------
create table public.users_audit (
  id             bigint generated always as identity primary key,
  company_id     uuid not null references public.companies(id) on delete cascade,
  membership_id  uuid not null,
  target_user_id uuid references public.profiles(id) on delete set null,
  action         text not null check (action in (
                   'USER_INVITED', 'MEMBERSHIP_ADDED', 'INVITATION_RESENT',
                   'MEMBERSHIP_ROLE_CHANGED', 'MEMBERSHIP_SUSPENDED', 'MEMBERSHIP_REACTIVATED')),
  from_role      text,
  to_role        text,
  from_status    text,
  to_status      text,
  actor_id       uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index idx_users_audit_empresa on public.users_audit (company_id, created_at desc);
alter table public.users_audit enable row level security;
create policy users_audit_select on public.users_audit
  for select to authenticated using (app.is_admin(company_id));
revoke all on public.users_audit from anon, authenticated;
grant select on public.users_audit to authenticated;

-- 2 · Sin escrituras directas en memberships ----------------------------------
drop policy if exists memberships_write on public.company_memberships;
revoke all on public.company_memberships from anon;
revoke insert, update, delete, truncate, references, trigger on public.company_memberships from authenticated;

-- 3 · Último admin -------------------------------------------------------------
create or replace function app.proteger_ultimo_admin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_quedan integer;
begin
  -- Sólo importa si la fila que cambia ES un admin activo.
  if old.role <> 'admin' or old.status <> 'active' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE' and new.role = 'admin' and new.status = 'active'
     and new.company_id = old.company_id then
    return new;
  end if;
  -- Borrados en cascada (se elimina la empresa o la persona) y operaciones de
  -- plataforma con la clave de servicio: no son decisiones de un usuario.
  if tg_op = 'DELETE' and (pg_trigger_depth() > 1 or coalesce(auth.role(), '') <> 'authenticated') then
    return old;
  end if;

  -- Mutex por empresa: un segundo cambio concurrente espera acá y, al seguir,
  -- cuenta con lo que el primero ya confirmó.
  perform 1 from companies where id = old.company_id for no key update;

  select count(*) into v_quedan
    from company_memberships
   where company_id = old.company_id and role = 'admin' and status = 'active' and id <> old.id;

  if v_quedan = 0 then
    raise exception 'ultimo_admin'
      using errcode = 'check_violation',
            hint = 'La empresa tiene que conservar al menos un administrador activo.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;
revoke all on function app.proteger_ultimo_admin() from public, anon, authenticated;

create trigger trg_memberships_ultimo_admin
  before update or delete on public.company_memberships
  for each row execute function app.proteger_ultimo_admin();

-- Auditoría de cambios de rol y estado, venga de donde venga el UPDATE.
create or replace function app.auditar_membresia()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- Null cuando el UPDATE no viene de un usuario (clave de servicio, SQL).
  v_actor uuid := auth.uid();
begin
  if new.role is distinct from old.role then
    insert into users_audit (company_id, membership_id, target_user_id, action,
                             from_role, to_role, from_status, to_status, actor_id)
    values (new.company_id, new.id, new.user_id, 'MEMBERSHIP_ROLE_CHANGED',
            old.role, new.role, old.status, new.status, v_actor);
  end if;
  if new.status is distinct from old.status then
    insert into users_audit (company_id, membership_id, target_user_id, action,
                             from_role, to_role, from_status, to_status, actor_id)
    values (new.company_id, new.id, new.user_id,
            case new.status when 'suspended' then 'MEMBERSHIP_SUSPENDED' else 'MEMBERSHIP_REACTIVATED' end,
            old.role, new.role, old.status, new.status, v_actor);
  end if;
  return new;
end
$$;
revoke all on function app.auditar_membresia() from public, anon, authenticated;

create trigger trg_memberships_auditar
  after update on public.company_memberships
  for each row execute function app.auditar_membresia();

-- 4 · RPC para admin ---------------------------------------------------------
create or replace function public.config_listar_usuarios(p_company uuid)
returns table (
  membership_id    uuid,
  user_id          uuid,
  nombre           text,
  email            text,
  rol              text,
  estado           text,
  cliente          text,
  alta             timestamptz,
  invitado_el      timestamptz,
  email_confirmado boolean,
  ultimo_ingreso   timestamptz,
  bloqueada        boolean,
  es_propia        boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_company is null or not coalesce(app.is_admin(p_company), false) then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;

  -- Sólo miembros de ESTA empresa: nunca la lista global de Auth.
  return query
  select m.id, m.user_id, p.full_name, u.email::text, m.role, m.status,
         c.legal_name, m.created_at, u.invited_at, u.email_confirmed_at is not null,
         u.last_sign_in_at, coalesce(u.banned_until > now(), false), m.user_id = auth.uid()
    from company_memberships m
    join profiles p   on p.id = m.user_id
    join auth.users u on u.id = m.user_id
    left join customers c on c.id = m.customer_id
   where m.company_id = p_company
   order by (m.status = 'suspended'), lower(coalesce(p.full_name, u.email));
end
$$;

create or replace function public.config_cambiar_rol(p_membership uuid, p_rol text)
returns table (membership_id uuid, rol text, estado text)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid;
  v_m company_memberships%rowtype;
begin
  select m.company_id into v_company from company_memberships m where m.id = p_membership;
  -- Inexistente y ajena dan el mismo error: no se confirma que el id exista.
  if v_company is null or not coalesce(app.is_admin(v_company), false) then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;
  if p_rol is null or p_rol not in ('admin', 'employee', 'salesperson', 'technician') then
    raise exception 'rol_invalido' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_m from company_memberships m where m.id = p_membership for update;
  if v_m.customer_id is not null or v_m.supplier_id is not null
     or v_m.role not in ('admin', 'employee', 'salesperson', 'technician') then
    raise exception 'rol_externo' using errcode = 'invalid_parameter_value';
  end if;

  if v_m.role <> p_rol then
    update company_memberships set role = p_rol where id = p_membership;
  end if;

  return query select m.id, m.role, m.status from company_memberships m where m.id = p_membership;
end
$$;

create or replace function public.config_cambiar_estado(p_membership uuid, p_estado text)
returns table (membership_id uuid, rol text, estado text)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid;
  v_m company_memberships%rowtype;
begin
  select m.company_id into v_company from company_memberships m where m.id = p_membership;
  if v_company is null or not coalesce(app.is_admin(v_company), false) then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;
  if p_estado is null or p_estado not in ('active', 'suspended') then
    raise exception 'estado_invalido' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_m from company_memberships m where m.id = p_membership for update;
  -- Suspenderse a uno mismo deja afuera a quien está operando: no se permite.
  if p_estado = 'suspended' and v_m.user_id = auth.uid() then
    raise exception 'no_auto_suspension' using errcode = 'check_violation';
  end if;

  if v_m.status <> p_estado then
    update company_memberships set status = p_estado where id = p_membership;
  end if;

  return query select m.id, m.role, m.status from company_memberships m where m.id = p_membership;
end
$$;

revoke all on function public.config_listar_usuarios(uuid) from public, anon;
revoke all on function public.config_cambiar_rol(uuid, text) from public, anon;
revoke all on function public.config_cambiar_estado(uuid, text) from public, anon;
grant execute on function public.config_listar_usuarios(uuid) to authenticated;
grant execute on function public.config_cambiar_rol(uuid, text) to authenticated;
grant execute on function public.config_cambiar_estado(uuid, text) to authenticated;

-- 5 · RPC sólo para la Edge Function (service_role) ---------------------------
-- El actor llega como parámetro porque la clave de servicio no tiene auth.uid():
-- la función lo saca del JWT ya verificado. Por eso NINGUNA de estas se le
-- concede a authenticated.

create or replace function app.es_admin_activo(p_actor uuid, p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from company_memberships m join companies c on c.id = m.company_id
     where m.user_id = p_actor and m.company_id = p_company
       and m.role = 'admin' and m.status = 'active' and c.is_active
  );
$$;
revoke all on function app.es_admin_activo(uuid, uuid) from public, anon, authenticated;

create or replace function public.config_validar_invitacion(p_actor uuid, p_company uuid, p_email text, p_rol text)
returns table (
  email                text,
  user_id              uuid,
  email_confirmado     boolean,
  invitacion_pendiente boolean,
  bloqueada            boolean,
  membership_id        uuid,
  membership_estado    text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if p_actor is null or p_company is null or not app.es_admin_activo(p_actor, p_company) then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;
  if p_rol is null or p_rol not in ('admin', 'employee', 'salesperson', 'technician') then
    raise exception 'rol_invalido' using errcode = 'invalid_parameter_value';
  end if;
  if length(v_email) > 254 or v_email !~ '^[a-z0-9._%+''-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$' then
    raise exception 'email_invalido' using errcode = 'invalid_parameter_value';
  end if;

  return query
  select v_email, u.id, u.email_confirmed_at is not null,
         u.invited_at is not null and u.email_confirmed_at is null,
         coalesce(u.banned_until > now(), false), m.id, m.status
    from (select 1) uno
    left join auth.users u on lower(u.email) = v_email
    left join company_memberships m on m.user_id = u.id and m.company_id = p_company;
end
$$;

create or replace function public.config_registrar_miembro(
  p_actor uuid, p_company uuid, p_user uuid, p_rol text, p_nombre text, p_evento text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_id     uuid;
  v_estado text;
  v_nombre text := nullif(btrim(coalesce(p_nombre, '')), '');
begin
  if p_actor is null or p_company is null or not app.es_admin_activo(p_actor, p_company) then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;
  if p_rol is null or p_rol not in ('admin', 'employee', 'salesperson', 'technician') then
    raise exception 'rol_invalido' using errcode = 'invalid_parameter_value';
  end if;
  if p_evento not in ('USER_INVITED', 'MEMBERSHIP_ADDED') then
    raise exception 'evento_invalido' using errcode = 'invalid_parameter_value';
  end if;
  if v_nombre is not null and length(v_nombre) > 120 then
    raise exception 'nombre_invalido' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from profiles where id = p_user) then
    raise exception 'usuario_inexistente' using errcode = 'foreign_key_violation';
  end if;

  select m.status into v_estado from company_memberships m
   where m.user_id = p_user and m.company_id = p_company;
  if v_estado = 'suspended' then
    raise exception 'membresia_suspendida' using errcode = 'unique_violation';
  elsif v_estado is not null then
    raise exception 'ya_es_miembro' using errcode = 'unique_violation';
  end if;

  begin
    insert into company_memberships (company_id, user_id, role, status)
    values (p_company, p_user, p_rol, 'active')
    returning id into v_id;
  exception when unique_violation then
    raise exception 'ya_es_miembro' using errcode = 'unique_violation';
  end;

  -- El nombre sólo se completa en una cuenta nueva: una persona que ya existía
  -- conserva el suyo aunque otra empresa la cargue distinto.
  if p_evento = 'USER_INVITED' and v_nombre is not null then
    update profiles set full_name = v_nombre where id = p_user;
  end if;

  insert into users_audit (company_id, membership_id, target_user_id, action, to_role, to_status, actor_id)
  values (p_company, v_id, p_user, p_evento, p_rol, 'active', p_actor);

  return v_id;
end
$$;

create or replace function public.config_preparar_reenvio(p_actor uuid, p_membership uuid)
returns table (email text, company_id uuid)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_m company_memberships%rowtype;
  v_u auth.users%rowtype;
begin
  select * into v_m from company_memberships m where m.id = p_membership;
  if v_m.id is null or p_actor is null or not app.es_admin_activo(p_actor, v_m.company_id) then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;
  if v_m.status <> 'active' then
    raise exception 'membresia_suspendida' using errcode = 'check_violation';
  end if;
  select * into v_u from auth.users u where u.id = v_m.user_id;
  if v_u.email_confirmed_at is not null then
    raise exception 'invitacion_no_pendiente' using errcode = 'check_violation';
  end if;
  if coalesce(v_u.banned_until > now(), false) then
    raise exception 'cuenta_bloqueada' using errcode = 'check_violation';
  end if;
  return query select v_u.email::text, v_m.company_id;
end
$$;

create or replace function public.config_auditar_reenvio(p_actor uuid, p_membership uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_m company_memberships%rowtype;
begin
  select * into v_m from company_memberships m where m.id = p_membership;
  if v_m.id is null or p_actor is null or not app.es_admin_activo(p_actor, v_m.company_id) then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;
  insert into users_audit (company_id, membership_id, target_user_id, action, to_role, to_status, actor_id)
  values (v_m.company_id, v_m.id, v_m.user_id, 'INVITATION_RESENT', v_m.role, v_m.status, p_actor);
end
$$;

revoke all on function public.config_validar_invitacion(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.config_registrar_miembro(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.config_preparar_reenvio(uuid, uuid) from public, anon, authenticated;
revoke all on function public.config_auditar_reenvio(uuid, uuid) from public, anon, authenticated;
grant execute on function public.config_validar_invitacion(uuid, uuid, text, text) to service_role;
grant execute on function public.config_registrar_miembro(uuid, uuid, uuid, text, text, text) to service_role;
grant execute on function public.config_preparar_reenvio(uuid, uuid) to service_role;
grant execute on function public.config_auditar_reenvio(uuid, uuid) to service_role;
