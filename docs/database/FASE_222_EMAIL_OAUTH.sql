-- Fase 222 · Casillas de Gmail conectadas por OAuth per-cuenta (auth_mode='oauth_user').
--
-- Aplicada a producción (São Paulo) con apply_migration el 2026-10-30, nombre
-- `fase222_email_oauth_credentials`. Este archivo es el registro reversible.
--
-- Contexto: hoy el correo lee Gmail por Domain-Wide Delegation (service account
-- impersonando buzones de un Workspace). Para que cada empresa conecte su propia
-- casilla con "Iniciar sesión con Google" se agrega el modo `oauth_user`
-- (la columna email_accounts.auth_mode ya existía con el enum). El refresh token
-- se guarda cifrado en Supabase Vault; el cliente NUNCA lo lee.

-- Puente entre una casilla OAuth (email_accounts) y su refresh token en Vault.
create table if not exists public.email_oauth_credentials (
  account_id   uuid primary key references public.email_accounts(id) on delete cascade,
  secret_id    uuid not null,
  scope        text not null,
  connected_by uuid references auth.users(id) on delete set null,
  connected_at timestamptz not null default now(),
  revoked_at   timestamptz
);
comment on table public.email_oauth_credentials is
  'Puente entre una casilla OAuth (email_accounts) y su refresh token en Vault. El token NUNCA se lee desde el cliente.';

alter table public.email_oauth_credentials enable row level security;
-- Sin policies: anon/authenticated no leen ni escriben. Sólo service_role (bypass RLS) y las RPC SECURITY DEFINER.

-- Vincular (o rotar) una casilla OAuth. La llama el backend con service key tras
-- validar el `state` firmado del OAuth (por eso recibe p_connected_by y no usa auth.uid()).
create or replace function public.email_vincular_oauth(
  p_company uuid, p_email text, p_display text, p_refresh_token text, p_scope text, p_connected_by uuid
) returns uuid
language plpgsql security definer set search_path = 'public', 'pg_temp'
as $$
declare
  v_email  text := lower(trim(p_email));
  v_account uuid;
  v_otra   uuid;
  v_secret uuid;
begin
  if v_email = '' or coalesce(p_refresh_token, '') = '' then
    raise exception 'Faltan datos para vincular la casilla';
  end if;

  if not exists (
    select 1 from company_memberships
    where user_id = p_connected_by and company_id = p_company and role = 'admin' and status = 'active'
  ) then
    raise exception 'El usuario no es admin de la empresa' using errcode = '42501';
  end if;

  select id, company_id into v_account, v_otra
  from email_accounts where provider = 'gmail' and lower(email_address) = v_email;
  if v_otra is not null and v_otra <> p_company then
    raise exception 'Esa casilla ya esta conectada a otra empresa' using errcode = 'P0001';
  end if;

  insert into email_accounts (company_id, provider, email_address, display_name, auth_mode, active)
  values (p_company, 'gmail', v_email, nullif(p_display, ''), 'oauth_user', true)
  on conflict (provider, email_address) do update
    set company_id = excluded.company_id,
        display_name = coalesce(excluded.display_name, email_accounts.display_name),
        auth_mode = 'oauth_user', active = true,
        sync_error = null, sync_error_at = null, updated_at = now()
  returning id into v_account;

  select secret_id into v_secret from email_oauth_credentials where account_id = v_account;
  if v_secret is null then
    v_secret := vault.create_secret(p_refresh_token, 'email_oauth_' || v_account::text, 'Gmail OAuth refresh token');
    insert into email_oauth_credentials (account_id, secret_id, scope, connected_by)
    values (v_account, v_secret, p_scope, p_connected_by);
  else
    perform vault.update_secret(v_secret, p_refresh_token);
    update email_oauth_credentials
      set scope = p_scope, connected_by = p_connected_by, connected_at = now(), revoked_at = null
      where account_id = v_account;
  end if;

  return v_account;
end $$;

-- Leer el refresh token descifrado. Sólo backend (service key).
create or replace function public.email_leer_refresh(p_account uuid)
returns text
language sql security definer set search_path = 'public', 'pg_temp'
as $$
  select s.decrypted_secret
  from email_oauth_credentials c
  join vault.decrypted_secrets s on s.id = c.secret_id
  where c.account_id = p_account and c.revoked_at is null;
$$;

-- Desconectar: la llama el admin desde el frontend (auth.uid()).
create or replace function public.email_desvincular_oauth(p_account uuid)
returns void
language plpgsql security definer set search_path = 'public', 'pg_temp'
as $$
begin
  if not exists (
    select 1 from email_accounts a
    join company_memberships m on m.company_id = a.company_id
    where a.id = p_account and m.user_id = auth.uid() and m.role = 'admin' and m.status = 'active'
  ) then
    raise exception 'No sos admin de la empresa de esa casilla' using errcode = '42501';
  end if;
  update email_accounts set active = false, updated_at = now() where id = p_account;
  update email_oauth_credentials set revoked_at = now() where account_id = p_account and revoked_at is null;
end $$;

revoke all on function public.email_vincular_oauth(uuid,text,text,text,text,uuid) from public;
grant execute on function public.email_vincular_oauth(uuid,text,text,text,text,uuid) to service_role;
revoke all on function public.email_leer_refresh(uuid) from public;
grant execute on function public.email_leer_refresh(uuid) to service_role;
revoke all on function public.email_desvincular_oauth(uuid) from public;
grant execute on function public.email_desvincular_oauth(uuid) to authenticated, service_role;
