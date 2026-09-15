-- =============================================================================
-- Fase 14 · Entrega 0 — superficie de escritura de public.profiles.
--
-- ANTES (auditado 2026-09-15):
--   · ACL: authenticated = arwdDxtm (INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES,
--     TRIGGER, MAINTAIN además de SELECT).
--   · RLS: profiles_update_own (UPDATE, id = auth.uid()) → cualquier usuario podía
--     cambiar por REST TODAS las columnas de su perfil: full_name, is_active,
--     deleted_at, locale, theme, phone, avatar_path, created_at, updated_at.
--     Sin política de INSERT/DELETE (RLS los negaba), pero el privilegio existía.
--   · Escritores legítimos: app.handle_new_user (trigger de alta, SECURITY DEFINER,
--     dueño postgres) y public.config_registrar_miembro (SECURITY DEFINER, EXECUTE
--     sólo service_role, lo usa la Edge Function config-usuarios). Nadie del
--     frontend escribía profiles salvo la apariencia (Fase 14 E0).
--
-- DESPUÉS:
--   · authenticated: sólo SELECT (profiles_select sin cambios: propio o compañero).
--   · Única escritura de un usuario: public.guardar_mi_apariencia(p_appearance jsonb),
--     que actualiza SÓLO la columna appearance de la fila auth.uid(). No recibe id,
--     empresa ni otras columnas; el valor lo valida el CHECK profiles_appearance_valida.
--   · Se elimina profiles_update_own (sin privilegio UPDATE ya no aplica).
--   · app.apariencia_valida deja de ser ejecutable por authenticated (el CHECK corre
--     como el dueño de la función que escribe).
--   · service_role y las funciones SECURITY DEFINER existentes no cambian.
--
-- Aplicada como migración `fase14_e0_profiles_escritura_minima`.
--
-- Rollback (vuelve exactamente al estado anterior de esta migración):
--   grant insert, update, delete, truncate, references, trigger, maintain on public.profiles to authenticated;
--   create policy profiles_update_own on public.profiles for update to authenticated
--     using (id = auth.uid()) with check (id = auth.uid());
--   grant execute on function app.apariencia_valida(jsonb) to authenticated;
--   drop function public.guardar_mi_apariencia(jsonb);
-- (El frontend de apariencia usa la RPC: con el rollback hay que volver también
--  el servicio a `update … eq('id', user)`.)
-- =============================================================================

create or replace function public.guardar_mi_apariencia(p_appearance jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usuario uuid := auth.uid();
  v_guardada jsonb;
begin
  if v_usuario is null then
    raise exception 'sin_sesion' using errcode = '42501';
  end if;

  update public.profiles
     set appearance = p_appearance
   where id = v_usuario
  returning appearance into v_guardada;

  if not found then
    raise exception 'sin_perfil' using errcode = 'P0002';
  end if;

  return v_guardada;
end
$$;

comment on function public.guardar_mi_apariencia(jsonb) is
  'Fase 14 E0: única escritura de profiles para un usuario. Sólo appearance, sólo su fila. NULL = original.';

revoke all on function public.guardar_mi_apariencia(jsonb) from public, anon;
grant execute on function public.guardar_mi_apariencia(jsonb) to authenticated;

revoke all on table public.profiles from authenticated;
grant select on table public.profiles to authenticated;

drop policy if exists profiles_update_own on public.profiles;

revoke execute on function app.apariencia_valida(jsonb) from authenticated;
