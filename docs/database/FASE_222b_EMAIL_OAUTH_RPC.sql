-- Fase 222 b/c/d · RPCs del flujo OAuth que llama el servicio PÚBLICO sin service key.
-- Aplicadas a producción (São Paulo) el 2026-10-30 con apply_migration:
--   fase222b_email_oauth_rpc_firmadas, fase222c_email_uid_si_admin, fase222d_email_ref_por_buzon.
--
-- Todas se autorizan con firma HMAC (app.firma_email_api_valida, la misma infra
-- que los envíos) + un timestamp anti-replay de 2 min. Sólo el backend produce
-- la firma (comparte EMAIL_API_HMAC con app.email_api_secretos). Esto evita darle
-- la service key al servicio público (internet-facing).

-- ── 222b: vincular (rotar) + leer refresh, firmadas ──────────────────────────
-- email_vincular_oauth pasa a (… , p_ts bigint, p_firma text). Se DROPea la de 6
-- args (cambiar la firma con create-or-replace crearía una sobrecarga).
-- email_leer_refresh_firmado es la versión para el público (la email_leer_refresh
-- sin firma, service_role, la sigue usando el sync privado). Definiciones completas
-- en el historial de migraciones; el mensaje firmado es:
--   vincular: concat_ws('|','email_vincular_oauth', ts, company, lower(email), connected_by, scope)
--   leer:     concat_ws('|','email_leer_refresh',  ts, account)

-- ── 222c: uid del que llama si es admin de la empresa ────────────────────────
-- La usa /oauth/google/start (con el JWT) para validar admin y sacar el uid
-- VERIFICADO que va firmado en el `state` (el callback de Google no trae JWT).
create or replace function public.email_uid_si_admin(p_company uuid)
returns uuid
language sql stable security definer set search_path = 'public', 'pg_temp'
as $$
  select auth.uid()
  where exists (
    select 1 from company_memberships
    where user_id = auth.uid() and company_id = p_company and role = 'admin' and status = 'active'
  );
$$;
revoke all on function public.email_uid_si_admin(uuid) from public;
grant execute on function public.email_uid_si_admin(uuid) to authenticated, service_role;

-- ── 222d: auth_mode + id por dirección, firmado ──────────────────────────────
-- Lo usa el resolver de token del servicio público para saber si una casilla es
-- DWD u oauth_user, sin JWT ni service key. Mensaje: concat_ws('|','email_ref_por_buzon', ts, lower(buzon)).
create or replace function public.email_ref_por_buzon(p_buzon text, p_ts bigint, p_firma text)
returns table(auth_mode text, account_id uuid)
language plpgsql security definer set search_path = 'public', 'pg_temp'
as $$
declare
  v_buzon text := lower(trim(p_buzon));
  v_msg text := concat_ws('|', 'email_ref_por_buzon', p_ts::text, v_buzon);
begin
  if not app.firma_email_api_valida(v_msg, p_firma) then
    raise exception 'firma invalida' using errcode = '42501';
  end if;
  if abs((extract(epoch from now()) * 1000)::bigint - p_ts) > 120000 then
    raise exception 'pedido vencido' using errcode = '42501';
  end if;
  return query
    select a.auth_mode, a.id
    from email_accounts a
    where a.provider = 'gmail' and lower(a.email_address) = v_buzon and a.active
    limit 1;
end $$;
revoke all on function public.email_ref_por_buzon(text,bigint,text) from public;
grant execute on function public.email_ref_por_buzon(text,bigint,text) to anon, service_role;
