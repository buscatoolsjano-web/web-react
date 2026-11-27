-- Panel de distribuidores (2026-11-27) — Fase 5.
--
-- Lo que necesita quien administra a los distribuidores (un administrador
-- general), en un solo lugar:
--   · el uso de cada uno: usuarios, cotizaciones del mes, aceptadas, pedidos
--     que le hicieron al proveedor, pendientes y última actividad;
--   · límites opcionales por empresa, que la BASE hace cumplir:
--     limite_usuarios (miembros activos) y limite_cotizaciones_mes;
--   · suspender (y reactivar) el acceso de todos sus usuarios de una vez.
-- Los administradores generales no cuentan para el límite ni se suspenden: son
-- los que administran.

alter table public.companies
  add column if not exists limite_usuarios integer check (limite_usuarios is null or limite_usuarios > 0),
  add column if not exists limite_cotizaciones_mes integer check (limite_cotizaciones_mes is null or limite_cotizaciones_mes > 0);

comment on column public.companies.limite_usuarios is 'Máximo de usuarios activos (sin contar administradores generales). NULL = sin límite.';
comment on column public.companies.limite_cotizaciones_mes is 'Máximo de cotizaciones creadas por mes calendario. NULL = sin límite.';

-- Límite de cotizaciones por mes.
create or replace function app.exigir_limite_cotizaciones()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $$
declare v_limite int; v_hechas int;
begin
  select limite_cotizaciones_mes into v_limite from companies where id = new.company_id;
  if v_limite is null then return new; end if;
  select count(*) into v_hechas from sales_quotes
   where company_id = new.company_id
     and created_at >= date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires') at time zone 'America/Argentina/Buenos_Aires';
  if v_hechas >= v_limite then
    raise exception 'limite_cotizaciones_mes: %', v_limite using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists exigir_limite_cotizaciones on public.sales_quotes;
create trigger exigir_limite_cotizaciones before insert on public.sales_quotes
  for each row execute function app.exigir_limite_cotizaciones();

-- Límite de usuarios activos.
create or replace function app.exigir_limite_usuarios()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'app', 'pg_temp'
as $$
declare v_limite int; v_activos int;
begin
  if new.status <> 'active' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'active' and old.company_id = new.company_id then return new; end if;
  if exists (select 1 from app.general_admins where user_id = new.user_id) then return new; end if;
  select limite_usuarios into v_limite from companies where id = new.company_id;
  if v_limite is null then return new; end if;
  select count(*) into v_activos from company_memberships m
   where m.company_id = new.company_id and m.status = 'active' and m.id <> new.id
     and not exists (select 1 from app.general_admins g where g.user_id = m.user_id);
  if v_activos >= v_limite then
    raise exception 'limite_usuarios: %', v_limite using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists exigir_limite_usuarios on public.company_memberships;
create trigger exigir_limite_usuarios before insert or update of status, company_id on public.company_memberships
  for each row execute function app.exigir_limite_usuarios();

-- Cambiar los límites: sólo un administrador general.
create or replace function public.config_limites_empresa(p_company uuid, p_usuarios integer, p_cotizaciones_mes integer)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'app', 'pg_temp'
as $$
begin
  if auth.uid() is null then raise exception 'sesion_invalida'; end if;
  if not app.is_general_admin() then raise exception 'sin_permiso'; end if;
  if (p_usuarios is not null and p_usuarios < 1) or (p_cotizaciones_mes is not null and p_cotizaciones_mes < 1) then
    raise exception 'limite_invalido';
  end if;
  update companies set limite_usuarios = p_usuarios, limite_cotizaciones_mes = p_cotizaciones_mes, updated_at = now()
   where id = p_company;
  if not found then raise exception 'empresa_inexistente'; end if;
end
$$;

revoke all on function public.config_limites_empresa(uuid, integer, integer) from public, anon;
grant execute on function public.config_limites_empresa(uuid, integer, integer) to authenticated;

-- Suspender o reactivar a todos los usuarios de un distribuidor (menos los
-- administradores generales). Devuelve cuántos cambió.
create or replace function public.config_suspender_empresa(p_company uuid, p_suspender boolean)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'app', 'pg_temp'
as $$
declare v_n int;
begin
  if auth.uid() is null then raise exception 'sesion_invalida'; end if;
  if not app.is_general_admin() then raise exception 'sin_permiso'; end if;
  -- Nunca una empresa con todos los módulos (Buscatools, Torquetools…): esto es
  -- para distribuidores.
  if not exists (select 1 from companies where id = p_company and modulos is not null) then
    raise exception 'no_es_distribuidor';
  end if;
  update company_memberships m
     set status = case when p_suspender then 'suspended' else 'active' end
   where m.company_id = p_company
     and m.status = case when p_suspender then 'active' else 'suspended' end
     and not exists (select 1 from app.general_admins g where g.user_id = m.user_id);
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

revoke all on function public.config_suspender_empresa(uuid, boolean) from public, anon;
grant execute on function public.config_suspender_empresa(uuid, boolean) to authenticated;

-- El panel: un renglón por distribuidor del proveedor (con catálogo compartido,
-- pausado o no) y por empresa distribuidora a la que pertenece quien mira.
create or replace function public.config_panel_distribuidores(p_owner uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'app', 'pg_temp'
as $$
declare
  v_desde timestamptz := date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires') at time zone 'America/Argentina/Buenos_Aires';
begin
  if auth.uid() is null then raise exception 'sesion_invalida'; end if;
  if not app.is_general_admin() then raise exception 'sin_permiso'; end if;

  return coalesce((
    with dist as (
      select s.distributor_company_id as id from catalog_shares s where s.owner_company_id = p_owner
      union
      select c.id from companies c
       where c.modulos is not null and c.id <> p_owner and c.id = any (app.current_company_ids())
    )
    select jsonb_agg(jsonb_build_object(
      'id', c.id,
      'nombre', c.name,
      'moneda', c.default_currency,
      'modulos', to_jsonb(c.modulos),
      'limiteUsuarios', c.limite_usuarios,
      'limiteCotizacionesMes', c.limite_cotizaciones_mes,
      'compartido', (select jsonb_build_object('activo', s.is_active, 'descuento', s.descuento_pct)
                       from catalog_shares s where s.distributor_company_id = c.id and s.owner_company_id = p_owner),
      'usuariosActivos', (select count(*) from company_memberships m where m.company_id = c.id and m.status = 'active'
                            and not exists (select 1 from app.general_admins g where g.user_id = m.user_id)),
      'usuariosSuspendidos', (select count(*) from company_memberships m where m.company_id = c.id and m.status = 'suspended'
                            and not exists (select 1 from app.general_admins g where g.user_id = m.user_id)),
      'cotizacionesMes', (select count(*) from sales_quotes q where q.company_id = c.id and q.created_at >= v_desde),
      'cotizaciones', (select count(*) from sales_quotes q where q.company_id = c.id),
      'aceptadas', (select count(*) from sales_quotes q where q.company_id = c.id and q.status = 'accepted'),
      'pedidos', (select count(*) from pedidos_distribuidor pd where pd.distributor_company_id = c.id and pd.owner_company_id = p_owner),
      'pedidosPendientes', (select count(*) from pedidos_distribuidor pd join sales_orders o on o.id = pd.sales_order_id
                              where pd.distributor_company_id = c.id and pd.owner_company_id = p_owner and o.commercial_status = 'draft'),
      'montoPedidos', (select coalesce(sum(o.total), 0) from pedidos_distribuidor pd join sales_orders o on o.id = pd.sales_order_id
                         where pd.distributor_company_id = c.id and pd.owner_company_id = p_owner and o.commercial_status <> 'cancelled'),
      'ultimaActividad', (select max(q.updated_at) from sales_quotes q where q.company_id = c.id)
    ) order by c.name)
    from dist d join companies c on c.id = d.id
  ), '[]'::jsonb);
end
$$;

revoke all on function public.config_panel_distribuidores(uuid) from public, anon;
grant execute on function public.config_panel_distribuidores(uuid) to authenticated;
