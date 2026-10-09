-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Fase 58 · E4 — Eliminar cuentas, no suspenderlas                        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- EL PEDIDO. «Quiero poder eliminar cuentas. No suspender, sino eliminarlas».
--
-- LO QUE ENCONTRÉ ANTES DE ESCRIBIR NADA. Borrar a una persona de la base no es
-- una cosa, son dos, y una de las dos la base NO deja hacer:
--
--   · 84 claves foráneas apuntan a `profiles` con NO ACTION. Alguien que cargó
--     una cotización, un producto, un remito o un mail no se puede borrar: el
--     DELETE falla. Y está bien que falle —su nombre está en documentos— así
--     que esto no es un obstáculo para sortear, es la respuesta correcta.
--   · De las que no bloquean, dos son CASCADE sobre `sales_order_salespeople` y
--     `sales_quote_salespeople`: borrarían EN SILENCIO a quién le vendió. Otras
--     seis son SET NULL sobre tablas de auditoría: el actor quedaría en null.
--
-- ASÍ QUE «ELIMINAR» HACE DOS COSAS SEGÚN EL CASO, Y LO DICE:
--
--   1. Siempre: BORRA la membresía. La fila desaparece de la lista, no queda
--      gris como con suspender. La persona pierde el acceso a esta empresa en
--      el acto, porque es la fila que leen todas las políticas RLS.
--   2. Además, si se pide y la persona no tiene ninguna otra empresa ni dejó
--      historial: borra la CUENTA de Auth. Si tiene historial, el borrado de la
--      cuenta se revierte solo y la función devuelve que eliminó el acceso
--      nada más. No falla: el acceso ya se fue, que es lo que se pidió.
--
-- POR QUÉ NO HACE FALTA LA EDGE FUNCTION. Borrar de `auth.users` necesita
-- permiso sobre el schema `auth`: lo tiene `postgres`, que es el dueño de todas
-- las RPC `config_*`, así que una SECURITY DEFINER alcanza y no hay que mover
-- la clave de servicio a ningún lado nuevo.

begin;

-- ── El registro ────────────────────────────────────────────────────────────

alter table public.users_audit drop constraint if exists users_audit_action_check;
alter table public.users_audit add constraint users_audit_action_check
  check (action in ('USER_INVITED', 'MEMBERSHIP_ADDED', 'INVITATION_RESENT',
                    'MEMBERSHIP_ROLE_CHANGED', 'MEMBERSHIP_SUSPENDED',
                    'MEMBERSHIP_REACTIVATED',
                    'MEMBERSHIP_DELETED', 'ACCOUNT_DELETED'));

-- El email, porque `target_user_id` es SET NULL contra `profiles`: al borrar la
-- cuenta entera el registro se quedaría sin decir de quién fue. Guardar el texto
-- es lo único que sobrevive a la desaparición de la persona.
alter table public.users_audit add column if not exists target_email text;

comment on column public.users_audit.target_email is
  'Fase 58 E4: el email en el momento del cambio. Se completa al eliminar, porque target_user_id queda en null cuando se borra la cuenta.';

-- ── Eliminar ───────────────────────────────────────────────────────────────

create or replace function public.config_eliminar_miembro(
  p_membership      uuid,
  p_borrar_cuenta   boolean default false
)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_company uuid;
  v_user    uuid;
  v_rol     text;
  v_estado  text;
  v_email   text;
  v_otras   integer;
  v_admins  integer;
  v_cuenta_borrada boolean := false;
begin
  select m.company_id, m.user_id, m.role, m.status, p.email
    into v_company, v_user, v_rol, v_estado, v_email
  from company_memberships m
  join profiles p on p.id = m.user_id
  where m.id = p_membership;

  if v_company is null then
    raise exception 'no_encontrado' using errcode = 'P0001';
  end if;

  if not app.es_admin_activo(auth.uid(), v_company) then
    raise exception 'sin_permiso' using errcode = 'P0001';
  end if;

  -- Lo mismo que impide suspenderse a uno mismo, por la misma razón y más
  -- fuerte: de esto no se vuelve apretando «reactivar».
  if v_user = auth.uid() then
    raise exception 'no_auto_eliminacion' using errcode = 'P0001';
  end if;

  select count(*) into v_admins
  from company_memberships
  where company_id = v_company and role = 'admin' and status = 'active';

  if v_rol = 'admin' and v_estado = 'active' and v_admins <= 1 then
    raise exception 'ultimo_admin' using errcode = 'P0001';
  end if;

  delete from company_memberships where id = p_membership;

  insert into public.users_audit
    (company_id, membership_id, target_user_id, target_email, action,
     from_role, from_status, actor_id)
  values (v_company, p_membership, v_user, v_email, 'MEMBERSHIP_DELETED',
          v_rol, v_estado, auth.uid());

  if p_borrar_cuenta then
    select count(*) into v_otras from company_memberships where user_id = v_user;

    if v_otras = 0 then
      /*
       * El bloque con EXCEPTION es un savepoint: si alguna de las 84 claves
       * foráneas con NO ACTION lo frena —la persona dejó historial—, se
       * revierte SÓLO este DELETE y la eliminación de la membresía de arriba
       * queda firme. Eliminar el acceso es lo que se pidió; borrar la cuenta
       * era el extra.
       */
      begin
        delete from auth.users where id = v_user;
        v_cuenta_borrada := true;
      exception
        when foreign_key_violation then
          v_cuenta_borrada := false;
      end;
    end if;

    if v_cuenta_borrada then
      insert into public.users_audit
        (company_id, membership_id, target_user_id, target_email, action, actor_id)
      values (v_company, p_membership, null, v_email, 'ACCOUNT_DELETED', auth.uid());
    end if;
  end if;

  return case when v_cuenta_borrada then 'cuenta_eliminada' else 'acceso_eliminado' end;
end;
$function$;

revoke all on function public.config_eliminar_miembro(uuid, boolean) from public;
grant execute on function public.config_eliminar_miembro(uuid, boolean) to authenticated;

comment on function public.config_eliminar_miembro(uuid, boolean) is
  'Fase 58 E4: borra la membresía (siempre) y, si se pide y la persona no tiene otras empresas ni historial, también su cuenta de Auth. Devuelve acceso_eliminado o cuenta_eliminada.';

commit;
