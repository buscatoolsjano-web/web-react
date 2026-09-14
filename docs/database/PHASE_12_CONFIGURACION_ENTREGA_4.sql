-- =============================================================================
-- Fase 12 · Configuración · Entrega 4 — Visor de auditoría.
--
-- Une, en modo sólo lectura, las cuatro bitácoras de Configuración:
--   users_audit ............................ usuarios y membresías (E1)
--   company_audit .......................... datos y logo de la empresa (E2)
--   catalog_audit .......................... marcas y categorías (E3)
--   document_numbering_authority_audit ..... autoridad de numeración (E2.5)
--
-- NO incluye bitácoras operativas (sales_audit, purchases_audit,
-- maintenance_audit, email_events) ni logs técnicos (email_sync_log,
-- whatsapp_webhook_events, auth.audit_log_entries).
--
-- Por qué SECURITY DEFINER y no INVOKER:
--   · document_numbering_authority_audit está cerrada a authenticated (E2.5);
--   · nombre y email del actor y del usuario afectado salen de auth.users, que
--     un invoker no puede leer.
-- Guardas: admin ACTIVO de esa empresa (app.is_admin), search_path fijo,
-- EXECUTE sólo authenticated, detalles armados con lista blanca (nunca el JSON
-- crudo), email sólo de personas que son (o fueron) miembros de la empresa.
--
-- No escribe nada. No borra ni actualiza auditoría. Sin índices nuevos (doc §I).
--
-- Aplicada como migraciones `fase12_config_e4_auditoria` y
-- `fase12_config_e4_auditoria_rendimiento`. Este archivo es el estado final.
-- =============================================================================

-- Persona para el filtro de actores (pocos ids distintos por empresa).
create or replace function app.auditoria_persona(p_company uuid, p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when p_user is null then null else jsonb_build_object(
    'id', p_user,
    'nombre', (select p.full_name from profiles p where p.id = p_user),
    'email', (select u.email::text from auth.users u
               where u.id = p_user
                 and exists (select 1 from company_memberships m where m.user_id = p_user and m.company_id = p_company)),
    'miembro', exists (select 1 from company_memberships m where m.user_id = p_user and m.company_id = p_company)
  ) end
$$;

revoke all on function app.auditoria_persona(uuid, uuid) from public, anon, authenticated;

-- La primera versión resolvía nombre y email por evento, antes de paginar: con
-- 12.000 eventos tardaba ~550 ms en la página 100 y ~1.550 ms buscando texto.
-- Esta versión resuelve cada persona una sola vez con joins y arma el JSON sólo
-- para la página (~135 ms y ~220 ms; doc §I).
create or replace function public.config_auditoria_listar(
  p_company uuid,
  p_desde date default null,
  p_hasta date default null,
  p_modulo text default null,
  p_evento text default null,
  p_actor uuid default null,
  p_texto text default null,
  p_limite int default 50,
  p_desplazamiento int default 0)
returns table (
  origen text, evento_id bigint, modulo text, evento text, fecha timestamptz,
  actor jsonb, entidad_tipo text, entidad_id text, entidad_nombre text, entidad_existe boolean,
  detalles jsonb, total bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz constant text := 'America/Argentina/Buenos_Aires';
  v_q text;
  v_empresa text;
begin
  if p_company is null or not coalesce(app.is_admin(p_company), false) then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;
  if p_limite is null or p_limite < 1 or p_limite > 100
     or p_desplazamiento is null or p_desplazamiento < 0 or p_desplazamiento > 1000000
     or (p_modulo is not null and p_modulo not in ('usuarios', 'empresa', 'catalogo', 'numeracion'))
     or (p_evento is not null and p_evento !~ '^[A-Z_]{3,60}$')
     or (p_desde is not null and p_hasta is not null and p_hasta < p_desde)
     or length(coalesce(p_texto, '')) > 100 then
    raise exception 'datos_invalidos' using errcode = 'invalid_parameter_value';
  end if;

  v_q := nullif(regexp_replace(btrim(coalesce(p_texto, '')), '\s+', ' ', 'g'), '');
  if v_q is not null then
    v_q := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  select co.name into v_empresa from companies co where co.id = p_company;

  return query
  with eventos as (
    select 'users_audit'::text o, a.id, 'usuarios'::text m, a.action ev, a.created_at f, a.actor_id act,
           'usuario'::text et, a.target_user_id::text eid, null::uuid euuid, null::text enombre,
           jsonb_strip_nulls(jsonb_build_object('rol_anterior', a.from_role, 'rol_nuevo', a.to_role,
                                                'estado_anterior', a.from_status, 'estado_nuevo', a.to_status)) det,
           a.target_user_id tuser
      from users_audit a where a.company_id = p_company
    union all
    select 'company_audit', a.id, 'empresa', a.action, a.created_at, a.actor_id,
           'empresa', a.company_id::text, null::uuid, null,
           jsonb_build_object('campos', to_jsonb(a.changed_fields)), null::uuid
      from company_audit a where a.company_id = p_company
    union all
    select 'catalog_audit', a.id, 'catalogo', a.action, a.created_at, a.actor_id,
           case a.entity_type when 'brand' then 'marca' else 'categoria' end, a.entity_id::text, a.entity_id, a.entity_name,
           jsonb_build_object('campos', to_jsonb(a.changed_fields), 'nombre_registrado', a.entity_name), null::uuid
      from catalog_audit a where a.company_id = p_company
    union all
    select 'document_numbering_authority_audit', a.id, 'numeracion', 'NUMBERING_AUTHORITY_' || a.operation,
           a.changed_at, a.changed_by, 'tipo_documento', a.doc_type, null::uuid, a.doc_type,
           jsonb_strip_nulls(jsonb_build_object('tipo_documento', a.doc_type, 'autoridad_anterior', a.old_authority,
                                                'autoridad_nueva', a.new_authority, 'motivo', a.reason,
                                                'origen_tecnico', coalesce(a.jwt_role, a.db_role))), null::uuid
      from document_numbering_authority_audit a where a.company_id = p_company
  ),
  filtrados as (
    select e.*
      from eventos e
     where (p_desde is null or e.f >= (p_desde::timestamp at time zone v_tz))
       and (p_hasta is null or e.f < ((p_hasta + 1)::timestamp at time zone v_tz))
       and (p_modulo is null or e.m = p_modulo)
       and (p_evento is null or e.ev = p_evento)
       and (p_actor is null or e.act = p_actor)
  ),
  -- Cada persona se resuelve UNA vez (no por evento). Email sólo si es o fue
  -- miembro de esta empresa: no se exponen datos de cuentas ajenas.
  ids as (
    select fi.act uid from filtrados fi where fi.act is not null
    union
    select fi.tuser from filtrados fi where fi.tuser is not null
  ),
  personas as (
    select i.uid, p.full_name nombre, mm.miembro,
           case when mm.miembro then u.email::text end email
      from ids i
      left join profiles p on p.id = i.uid
      left join auth.users u on u.id = i.uid
      cross join lateral (
        select exists (select 1 from company_memberships cm where cm.user_id = i.uid and cm.company_id = p_company) miembro
      ) mm
  ),
  resueltos as (
    select fi.o, fi.id, fi.m, fi.ev, fi.f, fi.et, fi.eid, fi.enombre, fi.det, fi.act,
           pa.nombre a_nombre, pa.email a_email, pa.miembro a_miembro,
           pt.nombre t_nombre, pt.email t_email, pt.miembro t_miembro,
           coalesce(b.name, c.name) nombre_actual
      from filtrados fi
      left join personas pa on pa.uid = fi.act
      left join personas pt on pt.uid = fi.tuser
      left join brands b on fi.et = 'marca' and b.id = fi.euuid and b.company_id = p_company
      left join product_categories c on fi.et = 'categoria' and c.id = fi.euuid and c.company_id = p_company
  ),
  finales as (
    select r.*,
           case r.o
             when 'users_audit' then coalesce(r.t_nombre, r.t_email)
             when 'catalog_audit' then coalesce(r.nombre_actual, r.enombre)
             when 'company_audit' then v_empresa
             else r.enombre end enom,
           case r.o
             when 'users_audit' then coalesce(r.t_miembro, false)
             when 'catalog_audit' then r.nombre_actual is not null
             else true end existe
      from resueltos r
     where v_q is null
        or coalesce(case r.o when 'users_audit' then coalesce(r.t_nombre, r.t_email)
                             when 'catalog_audit' then coalesce(r.nombre_actual, r.enombre)
                             when 'company_audit' then v_empresa
                             else r.enombre end, '') ilike v_q
        or coalesce(r.a_nombre, '') ilike v_q
        or coalesce(r.a_email, '') ilike v_q
        or coalesce(r.t_email, '') ilike v_q
        or coalesce(r.det ->> 'motivo', '') ilike v_q
        or coalesce(r.enombre, '') ilike v_q
        or r.ev ilike v_q
  ),
  pagina as (
    select x.*, count(*) over () n
      from finales x
     order by x.f desc, x.id desc, x.o
     limit p_limite offset p_desplazamiento
  )
  -- El JSON del actor y el detalle final se arman sólo para la página.
  select pg.o, pg.id, pg.m, pg.ev, pg.f,
         case when pg.act is null then null
              else jsonb_build_object('id', pg.act, 'nombre', pg.a_nombre, 'email', pg.a_email, 'miembro', coalesce(pg.a_miembro, false)) end,
         pg.et, pg.eid, pg.enom, pg.existe,
         case when pg.o = 'users_audit' then pg.det || jsonb_strip_nulls(jsonb_build_object('email_afectado', pg.t_email)) else pg.det end,
         pg.n
    from pagina pg
   order by pg.f desc, pg.id desc, pg.o;
end $$;

-- Actores que aparecen en la auditoría de la empresa (para el filtro).
create or replace function public.config_auditoria_actores(p_company uuid)
returns table (actor_id uuid, nombre text, email text, eventos bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_company is null or not coalesce(app.is_admin(p_company), false) then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;
  return query
  with a as (
    select x.actor_id id from users_audit x where x.company_id = p_company and x.actor_id is not null
    union all select x.actor_id from company_audit x where x.company_id = p_company and x.actor_id is not null
    union all select x.actor_id from catalog_audit x where x.company_id = p_company and x.actor_id is not null
    union all select x.changed_by from document_numbering_authority_audit x where x.company_id = p_company and x.changed_by is not null
  ), g as (select a.id, count(*) n from a group by a.id)
  select g.id, (app.auditoria_persona(p_company, g.id)) ->> 'nombre', (app.auditoria_persona(p_company, g.id)) ->> 'email', g.n
    from g
   order by lower(coalesce((app.auditoria_persona(p_company, g.id)) ->> 'nombre', (app.auditoria_persona(p_company, g.id)) ->> 'email', g.id::text));
end $$;

revoke all on function public.config_auditoria_listar(uuid, date, date, text, text, uuid, text, int, int) from public, anon;
revoke all on function public.config_auditoria_actores(uuid) from public, anon;
grant execute on function public.config_auditoria_listar(uuid, date, date, text, text, uuid, text, int, int) to authenticated;
grant execute on function public.config_auditoria_actores(uuid) to authenticated;
