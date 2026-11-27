-- Módulos por empresa (2026-11-27) — Fase 1 de distribuidores.
--
-- Un distribuidor es una empresa propia (la separación de datos ya la hace la
-- RLS por company_id). Esto agrega QUÉ HERRAMIENTAS tiene cada empresa:
--   · companies.modulos NULL = todos (las empresas de hoy no cambian);
--   · una lista = sólo esos módulos además de los básicos (inicio, catálogo,
--     clientes, cotizaciones y configuración, que no se pueden sacar).
-- La base lo hace cumplir: una empresa sin el módulo no puede CREAR facturas,
-- compras, cuentas de mail, etc. (disparador en las tablas principales, que
-- corre también dentro de las funciones SECURITY DEFINER). Sólo un
-- administrador general cambia los módulos: el admin del distribuidor no.

alter table public.companies add column if not exists modulos text[];

alter table public.companies drop constraint if exists companies_modulos_validos;
alter table public.companies add constraint companies_modulos_validos check (
  modulos is null or modulos <@ array[
    'pedidos', 'facturacion', 'compras', 'mantenimiento', 'emails',
    'whatsapp', 'chat', 'informes', 'precios', 'web', 'asistente'
  ]::text[]
);

comment on column public.companies.modulos is
  'Módulos habilitados además de los básicos. NULL = todos. Lo cambia sólo un administrador general (config_modulos_empresa).';

create or replace function app.modulo_activo(p_company uuid, p_modulo text)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $$
  select coalesce((select c.modulos is null or p_modulo = any (c.modulos) from companies c where c.id = p_company), true)
$$;

create or replace function app.exigir_modulo()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $$
begin
  if not app.modulo_activo(new.company_id, tg_argv[0]) then
    raise exception 'modulo_no_habilitado: %', tg_argv[0] using errcode = '42501';
  end if;
  return new;
end
$$;

do $$
declare r record;
begin
  for r in select * from (values
    ('sales_orders', 'pedidos'), ('deliveries', 'pedidos'),
    ('sales_invoices', 'facturacion'),
    ('suppliers', 'compras'), ('purchase_orders', 'compras'), ('goods_receipts', 'compras'), ('supplier_invoices', 'compras'),
    ('maintenance_assets', 'mantenimiento'), ('maintenance_orders', 'mantenimiento'),
    ('maintenance_models', 'mantenimiento'), ('maintenance_quote_batches', 'mantenimiento'),
    ('email_accounts', 'emails'),
    ('whatsapp_accounts', 'whatsapp'), ('whatsapp_conversations', 'whatsapp'),
    ('chat_conversaciones', 'chat')
  ) as t(tabla, modulo) loop
    execute format('drop trigger if exists exigir_modulo on public.%I', r.tabla);
    execute format('create trigger exigir_modulo before insert on public.%I for each row execute function app.exigir_modulo(%L)', r.tabla, r.modulo);
  end loop;
end
$$;

-- ¿Soy administrador general? (para ofrecer «Nueva empresa» y «Módulos»).
create or replace function public.config_soy_admin_general()
 returns boolean
 language sql
 stable security definer
 set search_path to 'app', 'pg_temp'
as $$ select app.is_general_admin() $$;

revoke all on function public.config_soy_admin_general() from public, anon;
grant execute on function public.config_soy_admin_general() to authenticated;

-- Cambiar los módulos de una empresa: sólo un administrador general.
create or replace function public.config_modulos_empresa(p_company uuid, p_modulos text[])
 returns text[]
 language plpgsql
 security definer
 set search_path to 'public', 'app', 'pg_temp'
as $$
begin
  if auth.uid() is null then raise exception 'sesion_invalida'; end if;
  if not app.is_general_admin() then raise exception 'sin_permiso'; end if;
  if not exists (select 1 from companies where id = p_company) then raise exception 'empresa_inexistente'; end if;
  update companies
     set modulos = case when p_modulos is null then null
                        else (select coalesce(array_agg(distinct m order by m), '{}') from unnest(p_modulos) m) end,
         updated_at = now()
   where id = p_company;
  return (select modulos from companies where id = p_company);
exception when check_violation then
  raise exception 'modulo_invalido';
end
$$;

revoke all on function public.config_modulos_empresa(uuid, text[]) from public, anon;
grant execute on function public.config_modulos_empresa(uuid, text[]) to authenticated;

-- El alta de empresa acepta los módulos (NULL = completa, como hasta hoy).
-- La firma cambia: se borra la vieja para no dejar una sobrecarga.
drop function if exists public.config_crear_empresa(text, text);

create or replace function public.config_crear_empresa(p_nombre text, p_moneda text, p_modulos text[] default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'app', 'pg_temp'
as $function$
declare
  v_actor  uuid := auth.uid();
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_moneda text := upper(btrim(coalesce(p_moneda, '')));
  v_base   text;
  v_slug   text;
  v_n      int := 1;
  v_company uuid;
  v_modulos text[];
begin
  if v_actor is null then
    raise exception 'sesion_invalida';
  end if;

  if not app.is_general_admin() then
    raise exception 'sin_permiso';
  end if;

  if v_nombre = '' or length(v_nombre) > 120 then
    raise exception 'nombre_invalido';
  end if;
  if v_moneda not in ('ARS', 'USD', 'EUR') then
    raise exception 'moneda_invalida';
  end if;

  if p_modulos is not null then
    select coalesce(array_agg(distinct m order by m), '{}') into v_modulos from unnest(p_modulos) m;
  end if;

  v_base := app.slugificar(v_nombre);
  if v_base = '' then
    raise exception 'nombre_invalido';
  end if;
  v_slug := v_base;
  while exists (select 1 from companies where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;

  begin
    insert into companies (slug, name, default_currency, is_active, catalogo_publico, modulos)
    values (v_slug, v_nombre, v_moneda, true, false, v_modulos)
    returning id into v_company;
  exception when check_violation then
    raise exception 'modulo_invalido';
  end;

  insert into document_sequences (company_id, doc_type, prefix, padding, next_number, series_code, is_default, is_selectable)
  values
    (v_company, 'customer',          'CLI',  5,  1, 'CLI',  true, true),
    (v_company, 'supplier',          'PROV', 5,  1, 'PROV', true, true),
    (v_company, 'quote',             'COTI', 5,  1, 'COTI', true, true),
    (v_company, 'sales_order',       'PDV',  5,  1, 'PDV',  true, true),
    (v_company, 'delivery',          'RT',   5, 1, 'RT',   true, true),
    (v_company, 'sales_invoice',     'FAC',  5,  1, 'FAC',  true, true),
    (v_company, 'purchase_order',    'PC',   5,  1, 'PC',   true, true),
    (v_company, 'goods_receipt',     'NTEP', 5,  1, 'NTEP', true, true),
    (v_company, 'supplier_invoice',  'FP',   5,  1, 'FP',   true, true),
    (v_company, 'maintenance_order', 'OS',   5,  1, 'OS',   true, true),
    (v_company, 'maintenance_asset', 'EQ',   5,  1, 'EQ',   true, true);

  insert into price_lists (company_id, name, currency_code, is_default)
  values (v_company, 'Lista base', v_moneda, true);

  insert into warehouses (company_id, code, name, is_default, is_active)
  values (v_company, 'PRIN', 'Depósito principal', true, true);

  insert into company_memberships (user_id, company_id, role, status)
  values (v_actor, v_company, 'admin', 'active');

  return jsonb_build_object('company_id', v_company, 'slug', v_slug, 'name', v_nombre, 'moneda', v_moneda, 'modulos', v_modulos);
end;
$function$;

revoke all on function public.config_crear_empresa(text, text, text[]) from public, anon;
grant execute on function public.config_crear_empresa(text, text, text[]) to authenticated;
