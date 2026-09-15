-- =============================================================================
-- Fase 14 · Entrega 2 — camino server-side de reconciliación STEL → React.
--
-- Qué agrega (todo aditivo salvo la puerta en 7 funciones de trigger):
--   1. Identidad externa estable: products.external_source/external_id y únicos
--      (company_id, external_source, external_id) en productos, cotizaciones,
--      pedidos y remitos.
--   2. deliveries.source_quote_id: remito que en STEL sale directo de una
--      cotización (11 casos reales). Nunca a la vez que order_id.
--   3. Bitácora propia: stel_reconciliation_runs + stel_reconciliation_log
--      (source STEL_RECONCILIATION, run id, entidad, id STEL, acción, valor
--      viejo/nuevo). Sin datos de clientes ni secretos. Sólo service_role.
--   4. Contexto de reconciliación NO falsificable: una fila en
--      app.stel_reconciliation_ctx con el xid de la transacción, que sólo
--      escriben las RPC SECURITY DEFINER. app.en_reconciliacion_stel() la lee.
--   5. Puerta en los triggers de documento cerrado y de borrado protegido:
--      se abren SÓLO con ese contexto (no hay bypass general, no se
--      deshabilita ningún trigger). Las comprobaciones de integridad
--      (pedidos derivados, stock movido) siguen valiendo siempre.
--   6. app.proteger_campos_importacion: un usuario de la app (anon /
--      authenticated) no puede poner ni cambiar imported_at, legacy_source,
--      external_source, external_id ni source_quote_id.
--   7. RPC public.stel_* con EXECUTE sólo para service_role y chequeo
--      explícito de auth.role() = 'service_role'.
--
-- Qué NO hace: no toca document_numbering_authority, secuencias, stock ni
-- datos. La autoridad STEL es requisito para iniciar un run.
--
-- Aplicada como migración `fase14_e2_reconciliacion_stel`.
-- Rollback al final del archivo.
-- =============================================================================

-- ── 1. Identidad externa ────────────────────────────────────────────────────
alter table public.products
  add column if not exists external_source text,
  add column if not exists external_id text;

alter table public.products
  add constraint products_external_source_check check (external_source is null or external_source = 'stel'),
  add constraint products_external_par check ((external_source is null) = (external_id is null));

create unique index if not exists uq_products_external on public.products (company_id, external_source, external_id) where external_id is not null;
create unique index if not exists uq_sales_quotes_external on public.sales_quotes (company_id, external_source, external_id) where external_id is not null;
create unique index if not exists uq_sales_orders_external on public.sales_orders (company_id, external_source, external_id) where external_id is not null;
create unique index if not exists uq_deliveries_external on public.deliveries (company_id, external_source, external_id) where external_id is not null;

comment on column public.products.external_id is 'Fase 14 E2: id del ítem en STEL (products o services). Identidad externa; no es el SKU.';

-- ── 2. Remito directo de cotización ─────────────────────────────────────────
alter table public.deliveries add column if not exists source_quote_id uuid references public.sales_quotes (id);
alter table public.deliveries add constraint deliveries_origen_unico check (order_id is null or source_quote_id is null);
create index if not exists idx_deliveries_source_quote on public.deliveries (source_quote_id) where source_quote_id is not null;
comment on column public.deliveries.source_quote_id is 'Fase 14 E2: cotización de la que sale el remito cuando no hay pedido (STEL parent = salesEstimate). Excluye order_id.';

-- ── 3. Bitácora ─────────────────────────────────────────────────────────────
create table if not exists public.stel_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  source text not null default 'STEL_RECONCILIATION' check (source = 'STEL_RECONCILIATION'),
  plan_hash text not null check (plan_hash ~ '^[0-9a-f]{64}$'),
  stel_read_at timestamptz not null,
  status text not null default 'running' check (status in ('running', 'finished', 'failed', 'rolled_back')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary jsonb
);
create unique index if not exists uq_stel_run_en_curso on public.stel_reconciliation_runs (company_id) where status = 'running';

create table if not exists public.stel_reconciliation_log (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.stel_reconciliation_runs (id),
  company_id uuid not null references public.companies (id),
  source text not null default 'STEL_RECONCILIATION' check (source = 'STEL_RECONCILIATION'),
  entity_type text not null check (entity_type in ('quote', 'order', 'delivery', 'quote_line', 'order_line', 'delivery_line', 'product', 'product_price', 'product_category')),
  entity_id uuid not null,
  stel_id text,
  action text not null check (action in ('insert', 'update', 'delete', 'note')),
  field text,
  old_value jsonb,
  new_value jsonb,
  detail jsonb,
  created_at timestamptz not null default now(),
  reverted_at timestamptz
);
create index if not exists idx_stel_log_run on public.stel_reconciliation_log (run_id, id);
create index if not exists idx_stel_log_entidad on public.stel_reconciliation_log (entity_type, entity_id);

alter table public.stel_reconciliation_runs enable row level security;
alter table public.stel_reconciliation_log enable row level security;
revoke all on table public.stel_reconciliation_runs from public, anon, authenticated;
revoke all on table public.stel_reconciliation_log from public, anon, authenticated;
revoke all on sequence public.stel_reconciliation_log_id_seq from public, anon, authenticated;

-- ── 4. Contexto de transacción ──────────────────────────────────────────────
create table if not exists app.stel_reconciliation_ctx (
  txid bigint primary key,
  run_id uuid not null,
  created_at timestamptz not null default now()
);
revoke all on table app.stel_reconciliation_ctx from public, anon, authenticated;

create or replace function app.en_reconciliacion_stel()
returns boolean
language sql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
  select coalesce((
    select exists (
      select 1 from app.stel_reconciliation_ctx c
       where c.txid = (pg_current_xact_id_if_assigned())::text::bigint
    )
  ), false)
$$;
revoke all on function app.en_reconciliacion_stel() from public;
grant execute on function app.en_reconciliacion_stel() to anon, authenticated, service_role;

-- ── 5. Puerta en los triggers ───────────────────────────────────────────────
create or replace function app.bloquear_cotizacion_cerrada()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
begin
  -- Fase 14 E2: sólo la RPC de reconciliación STEL (contexto de transacción).
  if app.en_reconciliacion_stel() then
    return new;
  end if;

  if old.status not in ('accepted', 'rejected', 'expired') then
    return new;
  end if;

  if new.customer_id    is distinct from old.customer_id
     or new.currency_code  is distinct from old.currency_code
     or new.exchange_rate  is distinct from old.exchange_rate
     or new.quote_date     is distinct from old.quote_date
     or new.discount_pct   is distinct from old.discount_pct
     or new.perception_pct is distinct from old.perception_pct
     or new.subtotal       is distinct from old.subtotal
     or new.tax_amount     is distinct from old.tax_amount
     or new.total          is distinct from old.total
     or new.status         is distinct from old.status then
    raise exception 'La cotización % está % y no se puede modificar', old.number, old.status
      using errcode = 'restrict_violation';
  end if;

  return new;
end $function$;

create or replace function app.bloquear_lineas_cotizacion_cerrada()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare v_quote uuid; v_status text; v_number text;
begin
  if app.en_reconciliacion_stel() then
    return coalesce(new, old);
  end if;

  v_quote := coalesce(new.quote_id, old.quote_id);
  select status, number into v_status, v_number from sales_quotes where id = v_quote;

  if v_status in ('accepted', 'rejected', 'expired') then
    raise exception 'La cotización % está % y no se le pueden tocar las líneas',
      v_number, v_status
      using errcode = 'restrict_violation';
  end if;

  return coalesce(new, old);
end $function$;

create or replace function app.bloquear_pedido_cerrado()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if app.en_reconciliacion_stel() then
    return new;
  end if;

  if old.commercial_status <> 'cancelled' then
    return new;
  end if;

  if new.customer_id      is distinct from old.customer_id
     or new.currency_code    is distinct from old.currency_code
     or new.exchange_rate    is distinct from old.exchange_rate
     or new.order_date       is distinct from old.order_date
     or new.discount_pct     is distinct from old.discount_pct
     or new.perception_pct   is distinct from old.perception_pct
     or new.subtotal         is distinct from old.subtotal
     or new.tax_amount       is distinct from old.tax_amount
     or new.total            is distinct from old.total
     or new.commercial_status is distinct from old.commercial_status then
    raise exception 'El pedido % está cancelado y no se puede modificar', old.number
      using errcode = 'restrict_violation';
  end if;

  return new;
end $function$;

create or replace function app.bloquear_lineas_pedido_cerrado()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_order uuid; v_status text; v_number text; v_entregas int;
begin
  if app.en_reconciliacion_stel() then
    return coalesce(new, old);
  end if;

  v_order := coalesce(new.order_id, old.order_id);
  select commercial_status, number into v_status, v_number
    from sales_orders where id = v_order;

  if v_status = 'cancelled' then
    raise exception 'El pedido % está cancelado y no se le pueden tocar las líneas', v_number
      using errcode = 'restrict_violation';
  end if;

  select count(*) into v_entregas from deliveries where order_id = v_order;
  if v_entregas > 0 then
    raise exception 'El pedido % ya tiene % entrega(s): sus líneas no se modifican',
      v_number, v_entregas
      using errcode = 'restrict_violation';
  end if;

  return coalesce(new, old);
end $function$;

-- Borrado: la puerta abre SÓLO «histórico» y «ya emitido» (para revertir un
-- INSERT de la reconciliación). Pedidos derivados y stock movido siguen bloqueando.
create or replace function app.proteger_borrado_cotizacion()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_pedidos int; v_reconciliacion boolean := app.en_reconciliacion_stel();
begin
  if old.imported_at is not null and not v_reconciliacion then
    raise exception 'La cotización % es histórica y no se borra', old.number
      using errcode = 'restrict_violation';
  end if;

  select count(*) into v_pedidos from sales_orders where quote_id = old.id;
  if v_pedidos > 0 then
    raise exception 'La cotización % tiene % pedido(s): cancelala en vez de borrarla',
      old.number, v_pedidos using errcode = 'restrict_violation';
  end if;

  if old.status <> 'draft' and not app.puede_borrar_por_mantenimiento(old.imported_at) and not v_reconciliacion then
    raise exception 'La cotización % ya fue enviada: se rechaza, no se borra', old.number
      using errcode = 'restrict_violation';
  end if;

  delete from sales_audit where entity_type = 'sales_quote' and entity_id = old.id;
  return old;
end $function$;

create or replace function app.proteger_borrado_pedido()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_entregas int; v_reconciliacion boolean := app.en_reconciliacion_stel();
begin
  if old.imported_at is not null and not v_reconciliacion then
    raise exception 'El pedido % es histórico y no se borra', old.number
      using errcode = 'restrict_violation';
  end if;

  select count(*) into v_entregas from deliveries where order_id = old.id;
  if v_entregas > 0 then
    raise exception 'El pedido % tiene % entrega(s): cancelalo en vez de borrarlo',
      old.number, v_entregas using errcode = 'restrict_violation';
  end if;

  if old.commercial_status <> 'draft'
     and not app.puede_borrar_por_mantenimiento(old.imported_at) and not v_reconciliacion then
    raise exception 'El pedido % ya fue confirmado: cancelalo en vez de borrarlo', old.number
      using errcode = 'restrict_violation';
  end if;

  delete from sales_audit where entity_type = 'sales_order' and entity_id = old.id;
  return old;
end $function$;

create or replace function app.proteger_borrado_entrega()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_movs int; v_reconciliacion boolean := app.en_reconciliacion_stel();
begin
  if old.imported_at is not null and not v_reconciliacion then
    raise exception 'El remito % es histórico y no se borra', old.number
      using errcode = 'restrict_violation';
  end if;

  -- Esto NO tiene puerta (tampoco para la reconciliación): borrar el movimiento
  -- no devuelve las unidades, porque el trigger de stock es AFTER INSERT.
  select count(*) into v_movs from stock_movements
   where source_type = 'delivery' and source_id = old.id;
  if v_movs > 0 then
    raise exception
      'El remito % ya movió stock: borrarlo no devolvería las unidades', old.number
      using errcode = 'restrict_violation';
  end if;

  if old.status <> 'draft' and not app.puede_borrar_por_mantenimiento(old.imported_at) and not v_reconciliacion then
    raise exception 'El remito % ya fue despachado y no se borra', old.number
      using errcode = 'restrict_violation';
  end if;

  delete from sales_audit where entity_type = 'delivery' and entity_id = old.id;
  return old;
end $function$;

-- ── 6. Campos de importación: nunca desde la app ────────────────────────────
create or replace function app.proteger_campos_importacion()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_nueva jsonb := to_jsonb(new);
  v_vieja jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_campo text;
begin
  if coalesce(auth.role(), '') not in ('anon', 'authenticated') then
    return new;
  end if;
  foreach v_campo in array array['imported_at', 'legacy_source', 'external_source', 'external_id', 'source_quote_id'] loop
    if v_nueva ? v_campo
       and (v_nueva -> v_campo) is distinct from coalesce(v_vieja -> v_campo, 'null'::jsonb)
       and not (tg_op = 'INSERT' and (v_nueva -> v_campo) = 'null'::jsonb) then
      raise exception 'campo_de_importacion'
        using errcode = '42501', detail = format('%s.%s sólo lo escribe la reconciliación server-side', tg_table_name, v_campo);
    end if;
  end loop;
  return new;
end $function$;

drop trigger if exists trg_000_campos_importacion on public.sales_quotes;
create trigger trg_000_campos_importacion before insert or update on public.sales_quotes
  for each row execute function app.proteger_campos_importacion();
drop trigger if exists trg_000_campos_importacion on public.sales_orders;
create trigger trg_000_campos_importacion before insert or update on public.sales_orders
  for each row execute function app.proteger_campos_importacion();
drop trigger if exists trg_000_campos_importacion on public.deliveries;
create trigger trg_000_campos_importacion before insert or update on public.deliveries
  for each row execute function app.proteger_campos_importacion();
drop trigger if exists trg_000_campos_importacion on public.products;
create trigger trg_000_campos_importacion before insert or update on public.products
  for each row execute function app.proteger_campos_importacion();

-- ── 7. Funciones internas (esquema app, no expuesto por REST) ───────────────
create or replace function app.stel_exigir_servicio()
returns void language plpgsql stable set search_path = pg_catalog, pg_temp as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'solo_servicio' using errcode = '42501';
  end if;
end $$;

create or replace function app.stel_run_activo(p_run uuid)
returns uuid language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_company uuid;
begin
  select company_id into v_company from public.stel_reconciliation_runs where id = p_run and status = 'running';
  if v_company is null then
    raise exception 'run_no_activo' using errcode = 'P0002';
  end if;
  return v_company;
end $$;

create or replace function app.stel_ctx_on(p_run uuid)
returns void language plpgsql volatile security definer set search_path = pg_catalog, pg_temp as $$
begin
  insert into app.stel_reconciliation_ctx (txid, run_id)
  values ((pg_current_xact_id())::text::bigint, p_run)
  on conflict (txid) do nothing;
end $$;

create or replace function app.stel_ctx_off()
returns void language plpgsql volatile security definer set search_path = pg_catalog, pg_temp as $$
begin
  delete from app.stel_reconciliation_ctx where txid = (pg_current_xact_id_if_assigned())::text::bigint;
end $$;

create or replace function app.stel_log(p_run uuid, p_company uuid, p_entidad text, p_id uuid, p_stel text, p_accion text,
  p_campo text, p_viejo jsonb, p_nuevo jsonb, p_detalle jsonb default null)
returns void language sql volatile security definer set search_path = public, pg_temp as $$
  insert into public.stel_reconciliation_log (run_id, company_id, entity_type, entity_id, stel_id, action, field, old_value, new_value, detail)
  values (p_run, p_company, p_entidad, p_id, p_stel, p_accion, p_campo, p_viejo, p_nuevo, p_detalle);
$$;

/** Columnas que la reconciliación puede escribir, por tabla y operación. */
create or replace function app.stel_campos(p_tabla text, p_op text)
returns text[] language sql immutable set search_path = pg_catalog, pg_temp as $$
  select case p_tabla || ':' || p_op
    when 'sales_quotes:insert' then array['customer_id', 'quote_date', 'currency_code', 'title', 'subtotal', 'tax_amount', 'total', 'discount_pct', 'perception_pct', 'series_code', 'status', 'needs_review', 'review_reason']
    when 'sales_quotes:update' then array['currency_code', 'subtotal', 'tax_amount', 'total', 'discount_pct', 'status', 'customer_id', 'external_source', 'external_id']
    when 'sales_orders:insert' then array['customer_id', 'order_date', 'quote_id', 'currency_code', 'title', 'subtotal', 'tax_amount', 'total', 'discount_pct', 'perception_pct', 'series_code', 'commercial_status', 'fulfillment_status', 'needs_review', 'review_reason']
    when 'sales_orders:update' then array['currency_code', 'subtotal', 'tax_amount', 'total', 'discount_pct', 'quote_id', 'customer_id', 'external_source', 'external_id']
    when 'deliveries:insert' then array['customer_id', 'delivery_date', 'order_id', 'source_quote_id', 'currency_code', 'title', 'subtotal', 'tax_amount', 'total', 'series_code', 'needs_review', 'review_reason']
    when 'deliveries:update' then array['currency_code', 'subtotal', 'tax_amount', 'total', 'order_id', 'source_quote_id', 'customer_id', 'external_source', 'external_id']
    when 'sales_quote_lines:insert' then array['line_no', 'product_id', 'sku_snapshot', 'name_snapshot', 'quantity', 'unit_price', 'discount_pct', 'tax_treatment', 'tax_rate_snapshot', 'line_type']
    when 'sales_quote_lines:update' then array['product_id', 'sku_snapshot', 'name_snapshot', 'quantity', 'unit_price', 'discount_pct']
    when 'sales_order_lines:insert' then array['line_no', 'product_id', 'sku_snapshot', 'name_snapshot', 'quantity_ordered', 'unit_price', 'discount_pct', 'tax_treatment', 'tax_rate_snapshot', 'line_type']
    when 'sales_order_lines:update' then array['product_id', 'sku_snapshot', 'name_snapshot', 'quantity_ordered', 'unit_price', 'discount_pct']
    when 'delivery_lines:insert' then array['product_id', 'sku_snapshot', 'name_snapshot', 'quantity', 'unit_price', 'discount_pct', 'tax_treatment', 'tax_rate_snapshot', 'warehouse_id']
    when 'delivery_lines:update' then array['product_id', 'sku_snapshot', 'name_snapshot', 'quantity', 'unit_price', 'discount_pct']
    when 'products:update' then array['name', 'description', 'status']
    else array[]::text[]
  end
$$;

/** Estado React que corresponde a un estado STEL. NULL = sin mapeo inequívoco. */
create or replace function app.stel_estado_react(p_tipo text, p_estado text)
returns text language sql immutable set search_path = pg_catalog, pg_temp as $$
  select case
    when p_tipo = 'quote' then case lower(trim(p_estado))
      when 'pendiente' then 'sent' when 'en curso' then 'sent'
      when 'cerrada' then 'accepted' when 'cerrado' then 'accepted' when 'aceptada' then 'accepted'
      when 'rechazada' then 'rejected' end
    when p_tipo = 'order' then case when p_estado is null then null when lower(trim(p_estado)) = 'rechazado' then 'cancelled' else 'confirmed' end
    when p_tipo = 'delivery' then case when p_estado is null then null else 'delivered' end
  end
$$;

/** Valor actual de una columna como jsonb (NULL SQL → 'null'). */
create or replace function app.stel_valor(p_tabla text, p_campo text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  execute format('select coalesce(to_jsonb(t.%I), ''null''::jsonb) from public.%I t where t.id = $1', p_campo, p_tabla) into v using p_id;
  return v;
end $$;

create or replace function app.stel_poner(p_tabla text, p_campo text, p_id uuid, p_valor jsonb)
returns void language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  execute format('update public.%I t set %I = (jsonb_populate_record(null::public.%I, $1)).%I where t.id = $2', p_tabla, p_campo, p_tabla, p_campo)
    using jsonb_build_object(p_campo, p_valor), p_id;
end $$;

create or replace function app.stel_insertar(p_tabla text, p_fila jsonb)
returns uuid language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_cols text; v_id uuid;
begin
  select string_agg(format('%I', k), ', ') into v_cols from jsonb_object_keys(p_fila) k;
  execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) returning id', p_tabla, v_cols, v_cols, p_tabla)
    into v_id using p_fila;
  return v_id;
end $$;

/** Una referencia a otra fila de la MISMA empresa. `{"stel_id": "..."}` resuelve un producto por id STEL. */
create or replace function app.stel_ref(p_company uuid, p_tabla text, p_valor jsonb)
returns uuid language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if p_valor is null or p_valor = 'null'::jsonb then
    return null;
  end if;
  if jsonb_typeof(p_valor) = 'object' then
    if p_tabla <> 'products' or not (p_valor ? 'stel_id') then
      raise exception 'referencia_invalida:%', p_tabla;
    end if;
    select id into v_id from public.products
     where company_id = p_company and external_source = 'stel' and external_id = p_valor ->> 'stel_id';
  else
    execute format('select id from public.%I where id = $1 and company_id = $2', p_tabla) into v_id using (p_valor #>> '{}')::uuid, p_company;
  end if;
  if v_id is null then
    raise exception 'referencia_no_encontrada:%:%', p_tabla, p_valor #>> '{}';
  end if;
  return v_id;
end $$;

-- ── 8. RPC (service_role) ───────────────────────────────────────────────────
create or replace function public.stel_reconciliacion_iniciar(p_company uuid, p_plan_hash text, p_stel_read_at timestamptz)
returns uuid language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_run uuid;
begin
  perform app.stel_exigir_servicio();
  if not exists (select 1 from public.companies where id = p_company) then
    raise exception 'empresa_inexistente' using errcode = 'P0002';
  end if;
  -- La reconciliación corre con STEL como autoridad: no es un cutover.
  if (select count(*) from public.document_numbering_authority
       where company_id = p_company and doc_type in ('quote', 'sales_order', 'delivery') and authority = 'STEL') <> 3 then
    raise exception 'autoridad_no_es_stel' using errcode = 'restrict_violation';
  end if;
  insert into public.stel_reconciliation_runs (company_id, plan_hash, stel_read_at)
  values (p_company, p_plan_hash, p_stel_read_at)
  returning id into v_run;
  return v_run;
end $$;

create or replace function public.stel_reconciliacion_cerrar(p_run uuid, p_estado text, p_resumen jsonb)
returns void language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  perform app.stel_exigir_servicio();
  if p_estado not in ('finished', 'failed') then
    raise exception 'estado_invalido';
  end if;
  update public.stel_reconciliation_runs
     set status = p_estado, finished_at = now(), summary = p_resumen
   where id = p_run and status = 'running';
  if not found then
    raise exception 'run_no_activo' using errcode = 'P0002';
  end if;
end $$;

create or replace function public.stel_asegurar_categoria_revision(p_run uuid, p_nombre text, p_slug text)
returns uuid language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_company uuid; v_id uuid; v_revision boolean;
begin
  perform app.stel_exigir_servicio();
  v_company := app.stel_run_activo(p_run);
  select id, needs_review into v_id, v_revision from public.product_categories where company_id = v_company and slug = p_slug;
  if v_id is not null then
    if v_revision is distinct from true then
      raise exception 'categoria_existente_no_es_de_revision:%', p_slug using errcode = 'restrict_violation';
    end if;
    return v_id;
  end if;
  insert into public.product_categories (company_id, name, slug, needs_review)
  values (v_company, p_nombre, p_slug, true)
  returning id into v_id;
  perform app.stel_log(p_run, v_company, 'product_category', v_id, null, 'insert', null, null,
    jsonb_build_object('name', p_nombre, 'slug', p_slug, 'needs_review', true));
  return v_id;
end $$;

/**
 * p: {op: 'crear'|'vincular'|'actualizar', stel_id, sku, ...}
 *   crear:      name, description, product_type, status, category_id (categoría de revisión), precio: {price_list_id, amount}
 *   vincular:   product_id (el SKU tiene que coincidir exacto)
 *   actualizar: campos: {name|description|status: {old, new}} (sólo productos creados por la reconciliación)
 */
create or replace function public.stel_reconciliar_producto(p_run uuid, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_company uuid; v_stel text := p ->> 'stel_id'; v_id uuid; v_prod record; v_cat record; v_lista record;
  v_campo text; v_cambio jsonb; v_actual jsonb; v_cambios int := 0; v_precio uuid;
begin
  perform app.stel_exigir_servicio();
  v_company := app.stel_run_activo(p_run);
  if v_stel is null or v_stel !~ '^[0-9]{1,18}$' then
    raise exception 'stel_id_invalido';
  end if;

  if p ->> 'op' = 'crear' then
    select id into v_id from public.products where company_id = v_company and external_source = 'stel' and external_id = v_stel;
    if v_id is not null then
      return jsonb_build_object('product_id', v_id, 'cambios', 0);
    end if;
    if exists (select 1 from public.products where company_id = v_company and sku = p ->> 'sku') then
      raise exception 'sku_existente:%', p ->> 'sku' using errcode = 'unique_violation';
    end if;
    select * into v_cat from public.product_categories where id = (p ->> 'category_id')::uuid and company_id = v_company;
    if v_cat.id is null or v_cat.needs_review is distinct from true then
      raise exception 'categoria_no_es_de_revision';
    end if;
    if coalesce(p ->> 'status', '') not in ('active', 'discontinued') then
      raise exception 'estado_producto_invalido';
    end if;
    insert into public.products (company_id, sku, name, description, product_type, status, category_id, needs_review, external_source, external_id)
    values (v_company, p ->> 'sku', p ->> 'name', nullif(p ->> 'description', ''), nullif(p ->> 'product_type', ''), p ->> 'status', v_cat.id, true, 'stel', v_stel)
    returning id into v_id;
    perform app.stel_log(p_run, v_company, 'product', v_id, v_stel, 'insert', null, null,
      jsonb_build_object('sku', p ->> 'sku', 'name', p ->> 'name', 'status', p ->> 'status', 'product_type', p ->> 'product_type'));
    v_cambios := 1;
    if p ? 'precio' and (p #>> '{precio,amount}') is not null then
      select * into v_lista from public.price_lists where id = (p #>> '{precio,price_list_id}')::uuid and company_id = v_company;
      if v_lista.id is null then
        raise exception 'lista_de_precios_invalida';
      end if;
      insert into public.product_prices (company_id, price_list_id, product_id, amount)
      values (v_company, v_lista.id, v_id, (p #>> '{precio,amount}')::numeric)
      returning id into v_precio;
      perform app.stel_log(p_run, v_company, 'product_price', v_precio, v_stel, 'insert', null, null,
        jsonb_build_object('price_list_id', v_lista.id, 'amount', (p #>> '{precio,amount}')::numeric));
      v_cambios := v_cambios + 1;
    end if;
    return jsonb_build_object('product_id', v_id, 'cambios', v_cambios);

  elsif p ->> 'op' = 'vincular' then
    select * into v_prod from public.products where id = (p ->> 'product_id')::uuid and company_id = v_company for update;
    if v_prod.id is null then
      raise exception 'producto_inexistente';
    end if;
    if v_prod.sku is distinct from p ->> 'sku' then
      raise exception 'sku_no_coincide:%', p ->> 'sku';
    end if;
    if v_prod.external_id is not null then
      if v_prod.external_source = 'stel' and v_prod.external_id = v_stel then
        return jsonb_build_object('product_id', v_prod.id, 'cambios', 0);
      end if;
      raise exception 'producto_vinculado_a_otro:%', p ->> 'sku' using errcode = 'restrict_violation';
    end if;
    update public.products set external_source = 'stel', external_id = v_stel where id = v_prod.id;
    -- Un solo registro: products_external_par exige fuente e id juntos también al revertir.
    perform app.stel_log(p_run, v_company, 'product', v_prod.id, v_stel, 'update', 'external',
      jsonb_build_object('source', null, 'id', null), jsonb_build_object('source', 'stel', 'id', v_stel));
    return jsonb_build_object('product_id', v_prod.id, 'cambios', 1);

  elsif p ->> 'op' = 'actualizar' then
    select id into v_id from public.products where company_id = v_company and external_source = 'stel' and external_id = v_stel for update;
    if v_id is null then
      raise exception 'producto_inexistente';
    end if;
    if not exists (select 1 from public.stel_reconciliation_log where entity_type = 'product' and entity_id = v_id and action = 'insert' and reverted_at is null) then
      raise exception 'producto_no_creado_por_reconciliacion' using errcode = 'restrict_violation';
    end if;
    for v_campo, v_cambio in select * from jsonb_each(p -> 'campos') loop
      if not (v_campo = any (app.stel_campos('products', 'update'))) then
        raise exception 'campo_no_permitido:products.%', v_campo;
      end if;
      v_actual := app.stel_valor('products', v_campo, v_id);
      if v_actual is distinct from coalesce(v_cambio -> 'old', 'null'::jsonb) then
        raise exception 'conflicto:products.%', v_campo using errcode = 'serialization_failure';
      end if;
      if v_actual is distinct from coalesce(v_cambio -> 'new', 'null'::jsonb) then
        perform app.stel_poner('products', v_campo, v_id, v_cambio -> 'new');
        perform app.stel_log(p_run, v_company, 'product', v_id, v_stel, 'update', v_campo, v_actual, v_cambio -> 'new');
        v_cambios := v_cambios + 1;
      end if;
    end loop;
    return jsonb_build_object('product_id', v_id, 'cambios', v_cambios);
  end if;

  raise exception 'op_invalida';
end $$;

/**
 * Reconcilia UN documento en una transacción.
 * p: {
 *   tipo: 'quote'|'order'|'delivery', stel_id, numero, estado_stel,
 *   operacion: 'insert'|'update',
 *   react_id (update),
 *   cabecera: insert → {campo: valor}; update → {campo: {old, new}},
 *   lineas: {insertar: [{campo: valor}], actualizar: [{id, campos: {campo: {old, new}}}], borrar: [{id, aprobado}]},
 *   auditoria: {subtotal_bruto, descuento_monto, total_calculado, motivo_diferencia}  (opcional, se guarda como nota)
 * }
 */
create or replace function public.stel_reconciliar_documento(p_run uuid, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_company uuid;
  v_tipo text := p ->> 'tipo';
  v_stel text := p ->> 'stel_id';
  v_numero text := p ->> 'numero';
  v_tabla text; v_lineas text; v_fk text; v_entidad text; v_entidad_linea text; v_col_estado text;
  v_doc uuid; v_fila jsonb := '{}'::jsonb; v_campo text; v_valor jsonb; v_actual jsonb;
  v_linea jsonb; v_linea_id uuid; v_cambios int := 0; v_estado_nuevo text; v_estado_mapeado text;
  v_ref_tabla text; v_existente record; v_old_row jsonb; v_proximo int;
begin
  perform app.stel_exigir_servicio();
  v_company := app.stel_run_activo(p_run);
  if v_stel is null or v_stel !~ '^[0-9]{1,18}$' then
    raise exception 'stel_id_invalido';
  end if;
  if v_numero is null or v_numero !~ '^[A-Z][A-Z-]*[0-9]+$' then
    raise exception 'numero_invalido';
  end if;
  case v_tipo
    when 'quote' then v_tabla := 'sales_quotes'; v_lineas := 'sales_quote_lines'; v_fk := 'quote_id'; v_entidad := 'quote'; v_entidad_linea := 'quote_line'; v_col_estado := 'status';
    when 'order' then v_tabla := 'sales_orders'; v_lineas := 'sales_order_lines'; v_fk := 'order_id'; v_entidad := 'order'; v_entidad_linea := 'order_line'; v_col_estado := 'commercial_status';
    when 'delivery' then v_tabla := 'deliveries'; v_lineas := 'delivery_lines'; v_fk := 'delivery_id'; v_entidad := 'delivery'; v_entidad_linea := 'delivery_line'; v_col_estado := 'status';
    else raise exception 'tipo_invalido';
  end case;
  v_estado_mapeado := app.stel_estado_react(v_tipo, p ->> 'estado_stel');

  perform app.stel_ctx_on(p_run);

  if p ->> 'operacion' = 'insert' then
    execute format('select id from public.%I where company_id = $1 and (number = $2 or (external_source = ''stel'' and external_id = $3)) limit 1', v_tabla)
      into v_doc using v_company, v_numero, v_stel;
    if v_doc is not null then
      raise exception 'documento_ya_existe:%', v_numero using errcode = 'unique_violation';
    end if;
    for v_campo, v_valor in select * from jsonb_each(p -> 'cabecera') loop
      if not (v_campo = any (app.stel_campos(v_tabla, 'insert'))) then
        raise exception 'campo_no_permitido:%.%', v_tabla, v_campo;
      end if;
      v_ref_tabla := case v_campo when 'customer_id' then 'customers' when 'quote_id' then 'sales_quotes' when 'order_id' then 'sales_orders' when 'source_quote_id' then 'sales_quotes' end;
      if v_ref_tabla is not null then
        v_valor := coalesce(to_jsonb(app.stel_ref(v_company, v_ref_tabla, v_valor)), 'null'::jsonb);
      end if;
      v_fila := v_fila || jsonb_build_object(v_campo, v_valor);
    end loop;
    if v_fila ->> v_col_estado is distinct from v_estado_mapeado and v_tipo <> 'delivery' then
      raise exception 'estado_no_corresponde_a_stel:%', v_numero;
    end if;
    if v_tipo = 'delivery' then
      v_fila := v_fila || jsonb_build_object('status', coalesce(v_estado_mapeado, 'delivered'));
    end if;
    if v_tipo = 'order' then
      v_fila := v_fila || jsonb_build_object('origin', 'migration');
    end if;
    v_fila := v_fila || jsonb_build_object('company_id', v_company, 'number', v_numero, 'original_number', v_numero,
      'imported_at', now(), 'external_source', 'stel', 'external_id', v_stel, 'legacy_source', 'stel_reconciliation');
    v_doc := app.stel_insertar(v_tabla, v_fila);
    perform app.stel_log(p_run, v_company, v_entidad, v_doc, v_stel, 'insert', null, null, v_fila - 'imported_at');
    v_cambios := 1;

  elsif p ->> 'operacion' = 'update' then
    execute format('select id, number, external_source, external_id, imported_at from public.%I where id = $1 and company_id = $2 for update', v_tabla)
      into v_existente using (p ->> 'react_id')::uuid, v_company;
    if v_existente.id is null then
      raise exception 'documento_inexistente:%', v_numero using errcode = 'P0002';
    end if;
    if v_existente.number is distinct from v_numero then
      raise exception 'numero_no_coincide:%', v_numero;
    end if;
    if v_existente.external_id is not null and (v_existente.external_source <> 'stel' or v_existente.external_id <> v_stel) then
      raise exception 'id_externo_no_coincide:%', v_numero using errcode = 'restrict_violation';
    end if;
    if v_existente.imported_at is null then
      raise exception 'documento_no_historico:%', v_numero using errcode = 'restrict_violation';
    end if;
    v_doc := v_existente.id;
    for v_campo, v_valor in select * from jsonb_each(p -> 'cabecera') loop
      if not (v_campo = any (app.stel_campos(v_tabla, 'update'))) then
        raise exception 'campo_no_permitido:%.%', v_tabla, v_campo;
      end if;
      v_actual := app.stel_valor(v_tabla, v_campo, v_doc);
      if v_actual is distinct from coalesce(v_valor -> 'old', 'null'::jsonb) then
        raise exception 'conflicto:%.%', v_numero, v_campo using errcode = 'serialization_failure';
      end if;
      if v_campo = 'external_source' and (v_valor ->> 'new') is distinct from 'stel' then
        raise exception 'fuente_invalida';
      end if;
      if v_campo = 'external_id' and (v_valor ->> 'new') is distinct from v_stel then
        raise exception 'id_externo_invalido';
      end if;
      if v_campo = v_col_estado then
        -- El estado sólo puede pasar al que corresponde al estado STEL, y nunca volver atrás.
        if (v_valor ->> 'new') is distinct from v_estado_mapeado then
          raise exception 'estado_no_corresponde_a_stel:%', v_numero;
        end if;
        if (v_actual #>> '{}') in ('accepted', 'rejected') and (v_valor ->> 'new') = 'sent' then
          raise exception 'estado_regresivo:%', v_numero using errcode = 'restrict_violation';
        end if;
        continue; -- se aplica al final, después de las líneas
      end if;
      v_ref_tabla := case v_campo when 'customer_id' then 'customers' when 'quote_id' then 'sales_quotes' when 'order_id' then 'sales_orders' when 'source_quote_id' then 'sales_quotes' end;
      if v_ref_tabla is not null then
        v_valor := jsonb_build_object('old', v_valor -> 'old', 'new', coalesce(to_jsonb(app.stel_ref(v_company, v_ref_tabla, v_valor -> 'new')), 'null'::jsonb));
      end if;
      if v_actual is distinct from coalesce(v_valor -> 'new', 'null'::jsonb) then
        perform app.stel_poner(v_tabla, v_campo, v_doc, v_valor -> 'new');
        perform app.stel_log(p_run, v_company, v_entidad, v_doc, v_stel, 'update', v_campo, v_actual, v_valor -> 'new');
        v_cambios := v_cambios + 1;
      end if;
    end loop;
  else
    raise exception 'operacion_invalida';
  end if;

  -- Líneas: insertar
  for v_linea in select * from jsonb_array_elements(coalesce(p #> '{lineas,insertar}', '[]'::jsonb)) loop
    v_fila := jsonb_build_object('company_id', v_company, v_fk, v_doc);
    for v_campo, v_valor in select * from jsonb_each(v_linea) loop
      if not (v_campo = any (app.stel_campos(v_lineas, 'insert'))) then
        raise exception 'campo_no_permitido:%.%', v_lineas, v_campo;
      end if;
      if v_campo = 'product_id' then
        v_valor := coalesce(to_jsonb(app.stel_ref(v_company, 'products', v_valor)), 'null'::jsonb);
      elsif v_campo = 'warehouse_id' then
        v_valor := to_jsonb(app.stel_ref(v_company, 'warehouses', v_valor));
      end if;
      v_fila := v_fila || jsonb_build_object(v_campo, v_valor);
    end loop;
    if v_tipo = 'delivery' and not (v_fila ? 'warehouse_id') then
      v_fila := v_fila || jsonb_build_object('warehouse_id',
        (select id from public.warehouses where company_id = v_company and is_default limit 1));
    end if;
    if v_tipo <> 'delivery' and not (v_fila ? 'line_no') then
      execute format('select coalesce(max(line_no), 0) + 1 from public.%I where %I = $1', v_lineas, v_fk) into v_proximo using v_doc;
      v_fila := v_fila || jsonb_build_object('line_no', v_proximo);
    end if;
    v_linea_id := app.stel_insertar(v_lineas, v_fila);
    perform app.stel_log(p_run, v_company, v_entidad_linea, v_linea_id, v_stel, 'insert', null, null, v_fila);
    v_cambios := v_cambios + 1;
  end loop;

  -- Líneas: actualizar campo por campo
  for v_linea in select * from jsonb_array_elements(coalesce(p #> '{lineas,actualizar}', '[]'::jsonb)) loop
    execute format('select id from public.%I where id = $1 and %I = $2 and company_id = $3 for update', v_lineas, v_fk)
      into v_linea_id using (v_linea ->> 'id')::uuid, v_doc, v_company;
    if v_linea_id is null then
      raise exception 'linea_no_pertenece:%', v_numero;
    end if;
    for v_campo, v_valor in select * from jsonb_each(v_linea -> 'campos') loop
      if not (v_campo = any (app.stel_campos(v_lineas, 'update'))) then
        raise exception 'campo_no_permitido:%.%', v_lineas, v_campo;
      end if;
      v_actual := app.stel_valor(v_lineas, v_campo, v_linea_id);
      if v_actual is distinct from coalesce(v_valor -> 'old', 'null'::jsonb) then
        raise exception 'conflicto:%.linea.%', v_numero, v_campo using errcode = 'serialization_failure';
      end if;
      if v_campo = 'product_id' then
        v_valor := jsonb_build_object('old', v_valor -> 'old', 'new', coalesce(to_jsonb(app.stel_ref(v_company, 'products', v_valor -> 'new')), 'null'::jsonb));
      end if;
      if v_actual is distinct from coalesce(v_valor -> 'new', 'null'::jsonb) then
        perform app.stel_poner(v_lineas, v_campo, v_linea_id, v_valor -> 'new');
        perform app.stel_log(p_run, v_company, v_entidad_linea, v_linea_id, v_stel, 'update', v_campo, v_actual, v_valor -> 'new');
        v_cambios := v_cambios + 1;
      end if;
    end loop;
  end loop;

  -- Líneas: borrar SÓLO con aprobación explícita; la fila entera queda en la bitácora.
  for v_linea in select * from jsonb_array_elements(coalesce(p #> '{lineas,borrar}', '[]'::jsonb)) loop
    if (v_linea ->> 'aprobado') is distinct from 'true' then
      raise exception 'borrado_sin_aprobacion:%', v_numero using errcode = 'restrict_violation';
    end if;
    execute format('select to_jsonb(t) from public.%I t where t.id = $1 and t.%I = $2 and t.company_id = $3 for update', v_lineas, v_fk)
      into v_old_row using (v_linea ->> 'id')::uuid, v_doc, v_company;
    if v_old_row is null then
      raise exception 'linea_no_pertenece:%', v_numero;
    end if;
    execute format('delete from public.%I where id = $1', v_lineas) using (v_linea ->> 'id')::uuid;
    perform app.stel_log(p_run, v_company, v_entidad_linea, (v_linea ->> 'id')::uuid, v_stel, 'delete', null, v_old_row, null);
    v_cambios := v_cambios + 1;
  end loop;

  -- Estado al final
  if p ->> 'operacion' = 'update' and (p -> 'cabecera') ? v_col_estado then
    v_actual := app.stel_valor(v_tabla, v_col_estado, v_doc);
    v_valor := p #> array['cabecera', v_col_estado, 'new'];
    if v_actual is distinct from v_valor then
      perform app.stel_poner(v_tabla, v_col_estado, v_doc, v_valor);
      perform app.stel_log(p_run, v_company, v_entidad, v_doc, v_stel, 'update', v_col_estado, v_actual, v_valor);
      v_cambios := v_cambios + 1;
    end if;
  end if;

  if p ? 'auditoria' and v_cambios > 0 then
    perform app.stel_log(p_run, v_company, v_entidad, v_doc, v_stel, 'note', null, null, null, p -> 'auditoria');
  end if;

  perform app.stel_ctx_off();
  return jsonb_build_object('document_id', v_doc, 'cambios', v_cambios);
end $$;

/** Revierte hasta p_limite entradas de un run, de la última a la primera. Cada llamada es atómica. */
create or replace function public.stel_revertir_reconciliacion(p_run uuid, p_limite int default 200)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_run record; r record; v_tabla text; v_actual jsonb; v_hechas int := 0; v_cols text; v_quedan int;
begin
  perform app.stel_exigir_servicio();
  select * into v_run from public.stel_reconciliation_runs where id = p_run for update;
  if v_run.id is null or v_run.status not in ('finished', 'failed') then
    raise exception 'run_no_revertible' using errcode = 'restrict_violation';
  end if;
  insert into app.stel_reconciliation_ctx (txid, run_id) values ((pg_current_xact_id())::text::bigint, p_run) on conflict (txid) do nothing;

  for r in select * from public.stel_reconciliation_log
            where run_id = p_run and reverted_at is null and action <> 'note'
            order by id desc limit greatest(1, least(p_limite, 1000)) loop
    v_tabla := case r.entity_type
      when 'quote' then 'sales_quotes' when 'order' then 'sales_orders' when 'delivery' then 'deliveries'
      when 'quote_line' then 'sales_quote_lines' when 'order_line' then 'sales_order_lines' when 'delivery_line' then 'delivery_lines'
      when 'product' then 'products' when 'product_price' then 'product_prices' when 'product_category' then 'product_categories' end;
    if r.action = 'update' and r.entity_type = 'product' and r.field = 'external' then
      select jsonb_build_object('source', external_source, 'id', external_id) into v_actual from public.products where id = r.entity_id for update;
      if v_actual is distinct from r.new_value then
        raise exception 'conflicto_al_revertir:products.external' using errcode = 'serialization_failure';
      end if;
      update public.products set external_source = r.old_value ->> 'source', external_id = r.old_value ->> 'id' where id = r.entity_id;
    elsif r.action = 'update' then
      v_actual := app.stel_valor(v_tabla, r.field, r.entity_id);
      if v_actual is distinct from coalesce(r.new_value, 'null'::jsonb) then
        raise exception 'conflicto_al_revertir:%.%', v_tabla, r.field using errcode = 'serialization_failure';
      end if;
      perform app.stel_poner(v_tabla, r.field, r.entity_id, r.old_value);
    elsif r.action = 'insert' then
      execute format('delete from public.%I where id = $1', v_tabla) using r.entity_id;
    elsif r.action = 'delete' then
      select string_agg(format('%I', k), ', ') into v_cols from jsonb_object_keys(r.old_value) k;
      execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)', v_tabla, v_cols, v_cols, v_tabla) using r.old_value;
    end if;
    update public.stel_reconciliation_log set reverted_at = now() where id = r.id;
    v_hechas := v_hechas + 1;
  end loop;

  delete from app.stel_reconciliation_ctx where txid = (pg_current_xact_id_if_assigned())::text::bigint;
  select count(*) into v_quedan from public.stel_reconciliation_log where run_id = p_run and reverted_at is null and action <> 'note';
  if v_quedan = 0 then
    update public.stel_reconciliation_runs set status = 'rolled_back' where id = p_run;
  end if;
  return jsonb_build_object('revertidas', v_hechas, 'quedan', v_quedan);
end $$;

-- ── 9. Grants: nada para anon/authenticated ─────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'app.stel_exigir_servicio()', 'app.stel_run_activo(uuid)', 'app.stel_ctx_on(uuid)', 'app.stel_ctx_off()',
    'app.stel_log(uuid, uuid, text, uuid, text, text, text, jsonb, jsonb, jsonb)', 'app.stel_campos(text, text)',
    'app.stel_estado_react(text, text)', 'app.stel_valor(text, text, uuid)', 'app.stel_poner(text, text, uuid, jsonb)',
    'app.stel_insertar(text, jsonb)', 'app.stel_ref(uuid, text, jsonb)',
    'public.stel_reconciliacion_iniciar(uuid, text, timestamptz)', 'public.stel_reconciliacion_cerrar(uuid, text, jsonb)',
    'public.stel_asegurar_categoria_revision(uuid, text, text)', 'public.stel_reconciliar_producto(uuid, jsonb)',
    'public.stel_reconciliar_documento(uuid, jsonb)', 'public.stel_revertir_reconciliacion(uuid, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
-- app.proteger_campos_importacion corre como trigger para cualquier rol: se deja ejecutable.

-- ── 10. Corrección aplicada después (migración `fase14_e2_app_usage_service_role`) ──
-- Tres de las funciones de trigger con puerta (bloquear_cotizacion_cerrada,
-- bloquear_lineas_cotizacion_cerrada, bloquear_pedido_cerrado) NO son SECURITY
-- DEFINER: corren con el rol que escribe. authenticated ya tenía USAGE en el esquema
-- app; service_role no, y sus escrituras fallaban con «permission denied for schema
-- app» (lo detectó la suite E2 antes de cualquier uso productivo). El esquema app no
-- está expuesto por REST.
grant usage on schema app to service_role;

-- ── 11. Corrección (migración `fase14_e2_vinculo_producto_atomico`) ─────────
-- El vínculo externo de un producto se registra como UN par (campo 'external') y
-- se revierte en un solo UPDATE: con dos entradas, revertir la primera dejaba la fila
-- con fuente sin id y violaba products_external_par (lo detectó la suite E2). El
-- cuerpo de arriba de stel_reconciliar_producto y stel_revertir_reconciliacion ya
-- es la versión corregida.

-- =============================================================================
-- ROLLBACK (en este orden; sólo si no hay runs aplicados, o después de revertirlos):
--   drop function public.stel_revertir_reconciliacion(uuid, integer);
--   drop function public.stel_reconciliar_documento(uuid, jsonb);
--   drop function public.stel_reconciliar_producto(uuid, jsonb);
--   drop function public.stel_asegurar_categoria_revision(uuid, text, text);
--   drop function public.stel_reconciliacion_cerrar(uuid, text, jsonb);
--   drop function public.stel_reconciliacion_iniciar(uuid, text, timestamptz);
--   drop function app.stel_ref(uuid, text, jsonb); drop function app.stel_insertar(text, jsonb);
--   drop function app.stel_poner(text, text, uuid, jsonb); drop function app.stel_valor(text, text, uuid);
--   drop function app.stel_estado_react(text, text); drop function app.stel_campos(text, text);
--   drop function app.stel_log(uuid, uuid, text, uuid, text, text, text, jsonb, jsonb, jsonb);
--   drop function app.stel_ctx_off(); drop function app.stel_ctx_on(uuid);
--   drop function app.stel_run_activo(uuid); drop function app.stel_exigir_servicio();
--   drop trigger trg_000_campos_importacion on public.sales_quotes;   (ídem sales_orders, deliveries, products)
--   drop function app.proteger_campos_importacion();
--   -- las 7 funciones de trigger: volver a la definición de docs/PHASE_14_ENTREGA_2_RECONCILIACION_PRODUCTIVA.md § Anexo
--   --   (idénticas a esta migración sin el bloque `app.en_reconciliacion_stel()`)
--   drop function app.en_reconciliacion_stel(); drop table app.stel_reconciliation_ctx;
--   drop table public.stel_reconciliation_log; drop table public.stel_reconciliation_runs;
--   alter table public.deliveries drop constraint deliveries_origen_unico; drop index idx_deliveries_source_quote;
--   alter table public.deliveries drop column source_quote_id;
--   drop index uq_deliveries_external, uq_sales_orders_external, uq_sales_quotes_external, uq_products_external;
--   alter table public.products drop constraint products_external_par, drop constraint products_external_source_check;
--   alter table public.products drop column external_id, drop column external_source;
--   revoke usage on schema app from service_role;   (sólo junto con quitar la puerta de los triggers)
-- =============================================================================
