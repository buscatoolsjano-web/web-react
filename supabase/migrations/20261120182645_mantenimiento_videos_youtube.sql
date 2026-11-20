-- Videos de Mantenimiento a YouTube (privados), no a Supabase.
--
-- Un video de ingreso pesa decenas de MB y no tiene por qué ocupar el bucket.
-- Se sube directo desde el navegador a YouTube, como video PRIVADO del canal
-- de la empresa, con el nombre de la orden. Acá queda sólo el link.
--
-- · youtube_connections: la credencial (refresh token) del canal, una por
--   empresa. RLS sin policies: sólo la lee la Edge Function `youtube-video`
--   con la clave de servicio. Nunca llega al navegador.
-- · youtube_oauth_states: el `state` de un «Conectar YouTube» en curso, para
--   que la vuelta de Google sea de quien la pidió. Vence a los 15 minutos.
-- · maintenance_videos: qué video de YouTube es de qué orden o equipo. La
--   leen admin y empleado de la empresa; la escribe la Edge Function, que
--   antes comprueba en YouTube que el video exista en el canal.

create table if not exists public.youtube_connections (
  company_id    uuid primary key references public.companies (id),
  refresh_token text not null,
  channel_id    text,
  channel_title text,
  connected_by  uuid references public.profiles (id),
  connected_at  timestamptz not null default now()
);
alter table public.youtube_connections enable row level security;
revoke all on public.youtube_connections from anon, authenticated;

create table if not exists public.youtube_oauth_states (
  state      text primary key,
  company_id uuid not null references public.companies (id),
  user_id    uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
alter table public.youtube_oauth_states enable row level security;
revoke all on public.youtube_oauth_states from anon, authenticated;

create table if not exists public.maintenance_videos (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id),
  entity_type      text not null check (entity_type in ('maintenance_order', 'maintenance_asset')),
  entity_id        uuid not null,
  youtube_video_id text not null,
  title            text not null,
  bytes            bigint,
  mime_type        text,
  created_by       uuid references public.profiles (id),
  created_at       timestamptz not null default now(),
  unique (company_id, youtube_video_id)
);
create index if not exists maintenance_videos_entidad on public.maintenance_videos (entity_type, entity_id);
alter table public.maintenance_videos enable row level security;
revoke all on public.maintenance_videos from anon;
grant select on public.maintenance_videos to authenticated;

drop policy if exists maintenance_videos_select on public.maintenance_videos;
create policy maintenance_videos_select on public.maintenance_videos
  for select to authenticated
  using (company_id = any (app.current_maintenance_company_ids()));

-- Si la empresa tiene YouTube conectado y a qué canal. Sin el token.
create or replace function public.youtube_estado(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v youtube_connections;
begin
  if not (p_company = any (app.current_maintenance_company_ids())) then
    raise exception 'Sin permiso sobre esa empresa' using errcode = 'insufficient_privilege';
  end if;
  select * into v from youtube_connections where company_id = p_company;
  return jsonb_build_object(
    'conectado', found,
    'canal', v.channel_title,
    'conectado_en', v.connected_at);
end $$;

revoke all on function public.youtube_estado(uuid) from public, anon;
grant execute on function public.youtube_estado(uuid) to authenticated;
