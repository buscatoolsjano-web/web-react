-- Fase 115 · Tracking de visitas del sitio público + métricas de la web.
-- Las filas las escribe SÓLO la Edge Function `web-visita` (service role); la
-- tabla no tiene policy de insert para nadie, igual que public_quote_requests.
-- Aplicada con apply_migration el 2026-10-23.
create table if not exists public.web_page_views (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  path text not null,
  visitor_id text,          -- uuid que el navegador guarda en localStorage (visitante único, sin datos personales)
  referrer text,
  created_at timestamptz not null default now()
);
create index if not exists web_page_views_company_fecha on public.web_page_views (company_id, created_at);

alter table public.web_page_views enable row level security;
drop policy if exists web_page_views_lectura on public.web_page_views;
create policy web_page_views_lectura on public.web_page_views
  for select using (
    exists (select 1 from public.company_memberships m
            where m.company_id = web_page_views.company_id
              and m.user_id = auth.uid() and m.status = 'active')
  );

create or replace function public.web_metricas(p_company uuid, p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v jsonb;
begin
  if not exists (select 1 from company_memberships m
                 where m.company_id = p_company and m.user_id = auth.uid() and m.status = 'active') then
    raise exception 'sin_acceso';
  end if;
  with vis as (
    select * from web_page_views
     where company_id = p_company and created_at::date between p_desde and p_hasta
  ),
  con as (
    select * from public_quote_requests
     where company_id = p_company and created_at::date between p_desde and p_hasta
  ),
  dias as (
    select g::date d from generate_series(p_desde, p_hasta, interval '1 day') g
  )
  select jsonb_build_object(
    'visitas', (select count(*) from vis),
    'visitantes', (select count(distinct coalesce(visitor_id, id::text)) from vis),
    'consultas', (select count(*) from con),
    'consultas_pendientes', (select count(*) from con where coalesce(estado,'pendiente')='pendiente'),
    'por_dia', coalesce((select jsonb_agg(jsonb_build_object(
        'dia', d,
        'visitas', (select count(*) from vis where created_at::date = d),
        'consultas', (select count(*) from con where created_at::date = d)
      ) order by d) from dias), '[]'::jsonb),
    'top_paths', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('path', path, 'visitas', count(*)) x
        from vis group by path order by count(*) desc limit 10) t), '[]'::jsonb),
    'productos_mas_pedidos', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('sku', it->>'sku', 'nombre', it->>'nombre', 'veces', count(*)) x
        from con, lateral jsonb_array_elements(coalesce(con.items,'[]'::jsonb)) it
        where it->>'sku' is not null
        group by it->>'sku', it->>'nombre' order by count(*) desc limit 10) t), '[]'::jsonb)
  ) into v;
  return v;
end $$;
grant execute on function public.web_metricas(uuid, date, date) to authenticated;
