-- Mantenimiento: cotización por lotes.
--
-- Un cliente grande (Whirlpool, Mirgor, Simpa) manda varios equipos juntos y
-- quiere UN presupuesto, no uno por herramienta. El lote junta las órdenes de
-- un mismo cliente: se manda como un solo PDF, se aprueba o se rechaza de una
-- vez y genera UN pedido de venta con todas las líneas, agrupadas por equipo.
--
-- Reglas:
--   · Un lote es de un cliente; sus órdenes, de ese cliente y abiertas, con la
--     cotización pendiente. Una orden está en un lote a lo sumo.
--   · Todo pasa por funciones: la orden no se mueve de lote, ni se aprueba ni
--     se rechaza sola mientras está en un lote abierto.
--   · Aprobar el lote aprueba cada cotización con `aprobar_cotizacion_mantenimiento`
--     (las mismas validaciones: líneas y moneda) y exige una sola moneda.
--   · El pedido del lote es uno para todas sus órdenes: por eso se saca la
--     unicidad de `maintenance_orders.sales_order_id` (una orden sigue teniendo
--     un pedido como mucho).

create table if not exists public.maintenance_quote_batches (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id),
  number           text not null,
  customer_id      uuid not null references public.customers (id),
  status           text not null default 'open' check (status in ('open', 'approved', 'rejected')),
  currency_code    text references public.currencies (code),
  notes            text,
  approved_at      date,
  approved_by_name text,
  sales_order_id   uuid references public.sales_orders (id),
  created_by       uuid references public.profiles (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, number)
);
alter table public.maintenance_quote_batches enable row level security;
revoke all on public.maintenance_quote_batches from anon;
revoke insert, update, delete on public.maintenance_quote_batches from authenticated;
grant select on public.maintenance_quote_batches to authenticated;
drop policy if exists mqb_select on public.maintenance_quote_batches;
create policy mqb_select on public.maintenance_quote_batches
  for select to authenticated
  using (company_id = any (app.current_maintenance_company_ids()));

alter table public.maintenance_orders
  add column if not exists batch_id uuid references public.maintenance_quote_batches (id);
create index if not exists maintenance_orders_batch on public.maintenance_orders (batch_id) where batch_id is not null;

-- Un pedido de lote es de varias órdenes.
drop index if exists public.maintenance_orders_sales_order_uq;

alter table public.maintenance_audit drop constraint if exists maintenance_audit_entity_type_check;
alter table public.maintenance_audit add constraint maintenance_audit_entity_type_check
  check (entity_type = any (array['maintenance_asset', 'maintenance_order', 'maintenance_batch']));

-- ── La orden: el lote sólo cambia desde las funciones del lote ─────────────
create or replace function app.proteger_orden_mantenimiento()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_mantenimiento boolean;
begin
  v_mantenimiento := auth.uid() is null and coalesce(auth.role(),'') = 'service_role';

  if tg_op = 'DELETE' then
    if old.status <> 'open' and not v_mantenimiento then
      raise exception 'La orden % está %: no se borra', old.number, old.status
        using errcode='restrict_violation';
    end if;
    return old;
  end if;

  if new.batch_id is distinct from old.batch_id
     and coalesce(current_setting('app.lote_mant', true),'') = '' then
    raise exception 'Una orden entra o sale de un lote desde la pantalla del lote'
      using errcode='restrict_violation';
  end if;

  if new.sales_order_id is distinct from old.sales_order_id then
    if coalesce(current_setting('app.vinculando_pedido_mant', true),'') <> new.id::text then
      raise exception 'El pedido de venta se genera con «Generar pedido de venta»'
        using errcode='restrict_violation';
    end if;
    if (to_jsonb(new) - 'sales_order_id' - 'updated_at' - 'updated_by')
       is distinct from (to_jsonb(old) - 'sales_order_id' - 'updated_at' - 'updated_by') then
      raise exception 'El vínculo con el pedido se guarda solo' using errcode='restrict_violation';
    end if;
    return new;
  end if;

  if new.number is distinct from old.number
     or new.series_code is distinct from old.series_code then
    raise exception 'El número de la orden no se cambia' using errcode='restrict_violation';
  end if;

  if new.customer_id is distinct from old.customer_id then
    raise exception 'El cliente de la orden queda congelado al ingresar'
      using errcode='restrict_violation';
  end if;

  if old.status in ('closed','cancelled') then
    raise exception 'La orden % está %: no se modifica', old.number, old.status
      using errcode='restrict_violation';
  end if;

  if new.status is distinct from old.status then
    if new.status not in ('closed','cancelled') then
      raise exception 'Transición no permitida: % → %', old.status, new.status
        using errcode='restrict_violation';
    end if;
    if new.status = 'closed'
       and coalesce(current_setting('app.cerrando_orden_mant', true),'') <> new.id::text then
      raise exception 'Una orden se cierra con cerrar_orden_mantenimiento(), no cambiándole el estado'
        using errcode='restrict_violation';
    end if;
    if new.status = 'cancelled'
       and coalesce(current_setting('app.cancelando_orden_mant', true),'') <> new.id::text then
      raise exception 'Una orden se cancela con cancelar_orden_mantenimiento()'
        using errcode='restrict_violation';
    end if;
  end if;

  if new.torque_at is not null and old.torque_at is null and new.torque_required then
    if not exists (select 1 from maintenance_measurements
                    where maintenance_order_id = new.id and target_value is not null) then
      raise exception 'El torque no se puede dar por completado sin ninguna medición cargada'
        using errcode='check_violation';
    end if;
  end if;

  return new;
end $function$;

-- ── Aprobar / rechazar una orden suelta: no si está en un lote abierto ────
create or replace function public.aprobar_cotizacion_mantenimiento(p_order uuid, p_por text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_o maintenance_orders; v_rol text; v_n int; v_lote text;
begin
  select * into v_o from maintenance_orders where id = p_order for update;
  if not found then
    raise exception 'La orden no existe' using errcode = 'no_data_found';
  end if;

  v_rol := app."current_role"(v_o.company_id);
  if v_rol is null or v_rol not in ('admin','employee') then
    raise exception 'Sin permiso para aprobar cotizaciones en esta empresa'
      using errcode = 'insufficient_privilege';
  end if;

  if v_o.quote_status = 'approved' then
    return jsonb_build_object('order_id', p_order, 'ya_estaba', true, 'estado', 'approved');
  end if;
  if v_o.batch_id is not null and coalesce(current_setting('app.lote_mant', true), '') = '' then
    select number into v_lote from maintenance_quote_batches where id = v_o.batch_id;
    raise exception 'La orden % está en el lote %: se aprueba desde el lote', v_o.number, v_lote
      using errcode = 'restrict_violation';
  end if;
  if v_o.quote_status <> 'pending' then
    raise exception 'La cotización está %: es un estado final', v_o.quote_status
      using errcode = 'restrict_violation';
  end if;
  if v_o.status <> 'open' then
    raise exception 'La orden % está %', v_o.number, v_o.status
      using errcode = 'restrict_violation';
  end if;

  select count(*) into v_n from maintenance_quote_lines where maintenance_order_id = p_order;
  if v_n = 0 then
    raise exception 'La cotización de la orden % no tiene ninguna línea', v_o.number
      using errcode = 'check_violation';
  end if;
  if v_o.quote_currency_code is null then
    raise exception 'La cotización de la orden % no tiene moneda', v_o.number using errcode = 'check_violation';
  end if;

  perform set_config('app.cotizando_mant', p_order::text, true);
  update maintenance_orders
     set quote_status = 'approved',
         quote_approved_at = current_date,
         quote_approved_by_name = nullif(btrim(coalesce(p_por, '')), '')
   where id = p_order;
  perform set_config('app.cotizando_mant', '', true);

  return jsonb_build_object('order_id', p_order, 'ya_estaba', false,
                            'estado', 'approved', 'lineas', v_n);
end $function$;

create or replace function public.rechazar_cotizacion_mantenimiento(p_order uuid, p_motivo text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_o maintenance_orders; v_rol text; v_lote text;
begin
  select * into v_o from maintenance_orders where id = p_order for update;
  if not found then
    raise exception 'La orden no existe' using errcode = 'no_data_found';
  end if;

  v_rol := app."current_role"(v_o.company_id);
  if v_rol is null or v_rol not in ('admin','employee') then
    raise exception 'Sin permiso para rechazar cotizaciones en esta empresa'
      using errcode = 'insufficient_privilege';
  end if;

  if v_o.quote_status = 'rejected' then
    return jsonb_build_object('order_id', p_order, 'ya_estaba', true, 'estado', 'rejected');
  end if;
  if v_o.batch_id is not null and coalesce(current_setting('app.lote_mant', true), '') = '' then
    select number into v_lote from maintenance_quote_batches where id = v_o.batch_id;
    raise exception 'La orden % está en el lote %: se rechaza desde el lote', v_o.number, v_lote
      using errcode = 'restrict_violation';
  end if;
  if v_o.quote_status <> 'pending' then
    raise exception 'La cotización está %: es un estado final', v_o.quote_status
      using errcode = 'restrict_violation';
  end if;
  if v_o.status <> 'open' then
    raise exception 'La orden % está %', v_o.number, v_o.status
      using errcode = 'restrict_violation';
  end if;

  perform set_config('app.cotizando_mant', p_order::text, true);
  perform set_config('app.motivo_cotizacion_mant', coalesce(p_motivo, ''), true);
  update maintenance_orders set quote_status = 'rejected' where id = p_order;
  perform set_config('app.cotizando_mant', '', true);
  perform set_config('app.motivo_cotizacion_mant', '', true);

  return jsonb_build_object('order_id', p_order, 'ya_estaba', false, 'estado', 'rejected');
end $function$;

-- ── Helpers del lote ──────────────────────────────────────────────────────
create or replace function app.lote_mant_para_escribir(p_batch uuid)
 returns maintenance_quote_batches
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $$
declare v_b maintenance_quote_batches; v_rol text;
begin
  select * into v_b from maintenance_quote_batches where id = p_batch for update;
  if not found then
    raise exception 'El lote no existe' using errcode = 'no_data_found';
  end if;
  v_rol := app."current_role"(v_b.company_id);
  if v_rol is null or v_rol not in ('admin','employee') then
    raise exception 'Sin permiso en Mantenimiento de esta empresa' using errcode = 'insufficient_privilege';
  end if;
  return v_b;
end $$;

/** Mete una orden en un lote abierto, con las condiciones de siempre. */
create or replace function app.lote_mant_meter(p_b maintenance_quote_batches, p_order uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $$
declare v_o maintenance_orders; v_otro text;
begin
  select * into v_o from maintenance_orders where id = p_order for update;
  if not found or v_o.company_id <> p_b.company_id then
    raise exception 'La orden no existe en esta empresa' using errcode = 'no_data_found';
  end if;
  if v_o.batch_id = p_b.id then return; end if;
  if v_o.batch_id is not null then
    select number into v_otro from maintenance_quote_batches where id = v_o.batch_id;
    raise exception 'La orden % ya está en el lote %', v_o.number, v_otro using errcode = 'restrict_violation';
  end if;
  if v_o.customer_id <> p_b.customer_id then
    raise exception 'La orden % es de otro cliente', v_o.number using errcode = 'check_violation';
  end if;
  if v_o.status <> 'open' or v_o.quote_status <> 'pending' then
    raise exception 'La orden % no tiene la cotización pendiente: no entra en un lote', v_o.number
      using errcode = 'check_violation';
  end if;
  if v_o.sales_order_id is not null then
    raise exception 'La orden % ya tiene pedido de venta', v_o.number using errcode = 'check_violation';
  end if;

  perform set_config('app.lote_mant', p_b.id::text, true);
  update maintenance_orders set batch_id = p_b.id where id = p_order;
  perform set_config('app.lote_mant', '', true);

  insert into maintenance_audit (company_id, entity_type, entity_id, action, diff, actor_id)
  values (p_b.company_id, 'maintenance_order', p_order, 'added_to_batch',
          jsonb_build_object('lote', p_b.number), auth.uid());
end $$;

-- ── Crear ─────────────────────────────────────────────────────────────────
create or replace function public.mant_lote_crear(p_company uuid, p_customer uuid, p_orders uuid[])
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'app', 'pg_temp'
as $$
declare v_rol text; v_num text; v_b maintenance_quote_batches; v_id uuid;
begin
  v_rol := app."current_role"(p_company);
  if v_rol is null or v_rol not in ('admin','employee') then
    raise exception 'Sin permiso en Mantenimiento de esta empresa' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from customers where id = p_customer and company_id = p_company and deleted_at is null) then
    raise exception 'El cliente no existe en esta empresa' using errcode = 'no_data_found';
  end if;
  if coalesce(array_length(p_orders, 1), 0) = 0 then
    raise exception 'Un lote necesita al menos una orden' using errcode = 'check_violation';
  end if;

  -- El número: LT00001, LT00002… por empresa. El candado evita dos iguales.
  perform pg_advisory_xact_lock(hashtext('mant_lote:' || p_company::text));
  select 'LT' || lpad((coalesce(max(substring(number from 3)::int), 0) + 1)::text, 5, '0')
    into v_num from maintenance_quote_batches where company_id = p_company and number ~ '^LT\d+$';

  insert into maintenance_quote_batches (company_id, number, customer_id, created_by)
  values (p_company, v_num, p_customer, auth.uid()) returning * into v_b;

  foreach v_id in array p_orders loop
    perform app.lote_mant_meter(v_b, v_id);
  end loop;

  insert into maintenance_audit (company_id, entity_type, entity_id, action, diff, actor_id)
  values (p_company, 'maintenance_batch', v_b.id, 'create',
          jsonb_build_object('lote', v_num, 'ordenes', array_length(p_orders, 1)), auth.uid());

  return jsonb_build_object('id', v_b.id, 'number', v_num);
end $$;

create or replace function public.mant_lote_agregar(p_batch uuid, p_orders uuid[])
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'app', 'pg_temp'
as $$
declare v_b maintenance_quote_batches; v_id uuid;
begin
  v_b := app.lote_mant_para_escribir(p_batch);
  if v_b.status <> 'open' then
    raise exception 'El lote % está %: ya no se le agregan órdenes', v_b.number, v_b.status
      using errcode = 'restrict_violation';
  end if;
  foreach v_id in array coalesce(p_orders, '{}') loop
    perform app.lote_mant_meter(v_b, v_id);
  end loop;
  update maintenance_quote_batches set updated_at = now() where id = p_batch;
end $$;

create or replace function public.mant_lote_quitar(p_batch uuid, p_order uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'app', 'pg_temp'
as $$
declare v_b maintenance_quote_batches; v_o maintenance_orders;
begin
  v_b := app.lote_mant_para_escribir(p_batch);
  if v_b.status <> 'open' then
    raise exception 'El lote % está %: sus órdenes ya no se mueven', v_b.number, v_b.status
      using errcode = 'restrict_violation';
  end if;
  select * into v_o from maintenance_orders where id = p_order and batch_id = p_batch for update;
  if not found then return; end if;

  perform set_config('app.lote_mant', p_batch::text, true);
  update maintenance_orders set batch_id = null where id = p_order;
  perform set_config('app.lote_mant', '', true);
  update maintenance_quote_batches set updated_at = now() where id = p_batch;

  insert into maintenance_audit (company_id, entity_type, entity_id, action, diff, actor_id)
  values (v_b.company_id, 'maintenance_order', p_order, 'removed_from_batch',
          jsonb_build_object('lote', v_b.number), auth.uid());
end $$;

-- ── Aprobar y rechazar el lote entero ─────────────────────────────────────
create or replace function public.mant_lote_aprobar(p_batch uuid, p_por text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'app', 'pg_temp'
as $$
declare v_b maintenance_quote_batches; v_id uuid; v_monedas text[]; v_n int := 0;
begin
  v_b := app.lote_mant_para_escribir(p_batch);
  if v_b.status = 'approved' then
    return jsonb_build_object('id', p_batch, 'ya_estaba', true);
  end if;
  if v_b.status <> 'open' then
    raise exception 'El lote % está %: es un estado final', v_b.number, v_b.status using errcode = 'restrict_violation';
  end if;

  select array_agg(distinct quote_currency_code) into v_monedas
    from maintenance_orders where batch_id = p_batch;
  if v_monedas is null then
    raise exception 'El lote % no tiene órdenes', v_b.number using errcode = 'check_violation';
  end if;
  if array_length(v_monedas, 1) > 1 or v_monedas[1] is null then
    raise exception 'Las cotizaciones del lote tienen que estar todas en la misma moneda'
      using errcode = 'check_violation';
  end if;

  perform set_config('app.lote_mant', p_batch::text, true);
  for v_id in select id from maintenance_orders where batch_id = p_batch order by number loop
    perform aprobar_cotizacion_mantenimiento(v_id, p_por);
    v_n := v_n + 1;
  end loop;
  perform set_config('app.lote_mant', '', true);

  update maintenance_quote_batches
     set status = 'approved', currency_code = v_monedas[1], approved_at = current_date,
         approved_by_name = nullif(btrim(coalesce(p_por, '')), ''), updated_at = now()
   where id = p_batch;

  insert into maintenance_audit (company_id, entity_type, entity_id, action, diff, actor_id)
  values (v_b.company_id, 'maintenance_batch', p_batch, 'quote_approved',
          jsonb_strip_nulls(jsonb_build_object('ordenes', v_n, 'por', nullif(btrim(coalesce(p_por, '')), ''))), auth.uid());
  return jsonb_build_object('id', p_batch, 'ya_estaba', false, 'ordenes', v_n);
end $$;

create or replace function public.mant_lote_rechazar(p_batch uuid, p_motivo text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'app', 'pg_temp'
as $$
declare v_b maintenance_quote_batches; v_id uuid; v_n int := 0;
begin
  v_b := app.lote_mant_para_escribir(p_batch);
  if v_b.status = 'rejected' then
    return jsonb_build_object('id', p_batch, 'ya_estaba', true);
  end if;
  if v_b.status <> 'open' then
    raise exception 'El lote % está %: es un estado final', v_b.number, v_b.status using errcode = 'restrict_violation';
  end if;

  perform set_config('app.lote_mant', p_batch::text, true);
  for v_id in select id from maintenance_orders where batch_id = p_batch order by number loop
    perform rechazar_cotizacion_mantenimiento(v_id, p_motivo);
    v_n := v_n + 1;
  end loop;
  perform set_config('app.lote_mant', '', true);

  update maintenance_quote_batches set status = 'rejected', updated_at = now() where id = p_batch;
  insert into maintenance_audit (company_id, entity_type, entity_id, action, diff, actor_id)
  values (v_b.company_id, 'maintenance_batch', p_batch, 'quote_rejected',
          jsonb_strip_nulls(jsonb_build_object('ordenes', v_n, 'motivo', nullif(btrim(coalesce(p_motivo, '')), ''))), auth.uid());
  return jsonb_build_object('id', p_batch, 'ya_estaba', false, 'ordenes', v_n);
end $$;

-- ── El pedido de venta del lote ───────────────────────────────────────────
create or replace function public.mant_lote_crear_pedido(p_batch uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'app', 'pg_temp'
as $$
declare
  v_b      maintenance_quote_batches;
  v_o      record;
  v_lineas jsonb := '[]'::jsonb;
  v_cond   text;
  v_pedido jsonb;
  v_numero text;
  v_n      int := 0;
begin
  v_b := app.lote_mant_para_escribir(p_batch);
  if v_b.sales_order_id is not null then
    select number into v_numero from sales_orders where id = v_b.sales_order_id;
    return jsonb_build_object('id', v_b.sales_order_id, 'number', v_numero, 'ya_estaba', true);
  end if;
  if v_b.status <> 'approved' then
    raise exception 'El pedido sale del lote aprobado: primero hay que aprobarlo' using errcode = 'check_violation';
  end if;
  if exists (select 1 from maintenance_orders where batch_id = p_batch and sales_order_id is not null) then
    raise exception 'Alguna orden del lote ya tiene pedido de venta' using errcode = 'check_violation';
  end if;

  -- Un capítulo por equipo, y debajo sus líneas.
  for v_o in
    select o.id, o.number, a.model_text, a.serial_number
      from maintenance_orders o join maintenance_assets a on a.id = o.asset_id
     where o.batch_id = p_batch order by o.number
  loop
    v_n := v_n + 1;
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
      'line_type', 'chapter', 'quantity', 1, 'unit_price', 0,
      'tax_treatment', 'not_taxed', 'tax_rate_snapshot', 0,
      'name_snapshot', concat_ws(' · ', v_o.number, v_o.model_text,
                                 case when v_o.serial_number is not null then 'serie ' || v_o.serial_number end)));
    v_lineas := v_lineas || coalesce((
      select jsonb_agg(jsonb_build_object(
               'line_type', 'item',
               'product_id', ql.product_id,
               'sku_snapshot', ql.sku_snapshot,
               'name_snapshot', coalesce(nullif(btrim(ql.description_snapshot), ''),
                 case ql.line_type when 'labour' then 'Mano de obra' when 'part' then 'Repuesto'
                                   when 'freight' then 'Flete' when 'diagnosis' then 'Diagnóstico' else 'Otro' end),
               'quantity', ql.quantity,
               'unit_price', ql.unit_price,
               'tax_treatment', 'vat_21',
               'tax_rate_snapshot', 21) order by ql.line_no)
        from maintenance_quote_lines ql
       where ql.maintenance_order_id = v_o.id and ql.quantity <> 0), '[]'::jsonb);
  end loop;
  if v_n = 0 then
    raise exception 'El lote no tiene órdenes' using errcode = 'check_violation';
  end if;

  select c.payment_terms into v_cond from customers c where c.id = v_b.customer_id;
  v_pedido := crear_pedido(
    v_b.company_id,
    jsonb_strip_nulls(jsonb_build_object(
      'customer_id', v_b.customer_id,
      'currency_code', v_b.currency_code,
      'payment_terms', v_cond,
      'title', format('Servicio · lote %s (%s %s)', v_b.number, v_n, case when v_n = 1 then 'equipo' else 'equipos' end),
      'notes', nullif(btrim(concat_ws(E'\n', 'Lote de mantenimiento ' || v_b.number, v_b.notes)), ''))),
    v_lineas);

  for v_o in select id from maintenance_orders where batch_id = p_batch loop
    perform set_config('app.vinculando_pedido_mant', v_o.id::text, true);
    update maintenance_orders set sales_order_id = (v_pedido->>'id')::uuid where id = v_o.id;
  end loop;
  perform set_config('app.vinculando_pedido_mant', '', true);

  update maintenance_quote_batches set sales_order_id = (v_pedido->>'id')::uuid, updated_at = now() where id = p_batch;
  insert into maintenance_audit (company_id, entity_type, entity_id, action, diff, actor_id)
  values (v_b.company_id, 'maintenance_batch', p_batch, 'sales_order_created',
          jsonb_build_object('pedido', v_pedido->>'number', 'total', v_pedido->'total'), auth.uid());

  return v_pedido || jsonb_build_object('ya_estaba', false);
end $$;

-- Una orden de un lote factura por el lote.
create or replace function public.mantenimiento_crear_pedido_venta(p_order uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'app', 'pg_temp'
as $$
declare
  v_o       maintenance_orders;
  v_rol     text;
  v_moneda  text;
  v_cond    text;
  v_modelo  text;
  v_lineas  jsonb;
  v_pedido  jsonb;
  v_numero  text;
begin
  select * into v_o from maintenance_orders where id = p_order for update;
  if not found then
    raise exception 'La orden no existe' using errcode = 'no_data_found';
  end if;

  v_rol := app."current_role"(v_o.company_id);
  if v_rol is null or v_rol not in ('admin','employee') then
    raise exception 'Sin permiso para generar pedidos en esta empresa' using errcode = 'insufficient_privilege';
  end if;

  if v_o.sales_order_id is not null then
    select number into v_numero from sales_orders where id = v_o.sales_order_id;
    return jsonb_build_object('id', v_o.sales_order_id, 'number', v_numero, 'ya_estaba', true);
  end if;
  if v_o.batch_id is not null then
    select number into v_numero from maintenance_quote_batches where id = v_o.batch_id;
    raise exception 'La orden está en el lote %: el pedido se genera desde el lote', v_numero
      using errcode = 'restrict_violation';
  end if;
  if v_o.status = 'cancelled' then
    raise exception 'La orden % está cancelada', v_o.number using errcode = 'restrict_violation';
  end if;
  if v_o.quote_status <> 'approved' then
    raise exception 'El pedido de venta sale de la cotización aprobada: primero hay que aprobarla'
      using errcode = 'check_violation';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'line_type', 'item',
           'product_id', ql.product_id,
           'sku_snapshot', ql.sku_snapshot,
           'name_snapshot', coalesce(nullif(btrim(ql.description_snapshot), ''),
             case ql.line_type when 'labour' then 'Mano de obra' when 'part' then 'Repuesto'
                               when 'freight' then 'Flete' when 'diagnosis' then 'Diagnóstico' else 'Otro' end),
           'quantity', ql.quantity,
           'unit_price', ql.unit_price,
           'tax_treatment', 'vat_21',
           'tax_rate_snapshot', 21) order by ql.line_no), '[]'::jsonb)
    into v_lineas
    from maintenance_quote_lines ql
   where ql.maintenance_order_id = p_order and ql.quantity <> 0;
  if jsonb_array_length(v_lineas) = 0 then
    raise exception 'La cotización no tiene líneas para pasar al pedido' using errcode = 'check_violation';
  end if;

  select c.payment_terms into v_cond from customers c where c.id = v_o.customer_id;
  v_moneda := coalesce(v_o.quote_currency_code,
                       (select c.default_currency from customers c where c.id = v_o.customer_id),
                       (select co.default_currency from companies co where co.id = v_o.company_id));
  select model_text into v_modelo from maintenance_assets where id = v_o.asset_id;

  v_pedido := crear_pedido(
    v_o.company_id,
    jsonb_strip_nulls(jsonb_build_object(
      'customer_id', v_o.customer_id,
      'currency_code', v_moneda,
      'payment_terms', v_cond,
      'title', left(concat_ws(' · ', 'Servicio ' || v_o.number, v_modelo), 200),
      'notes', nullif(btrim(concat_ws(E'\n', 'Orden de servicio ' || v_o.number, v_o.quote_notes)), ''))),
    v_lineas);

  perform set_config('app.vinculando_pedido_mant', p_order::text, true);
  update maintenance_orders set sales_order_id = (v_pedido->>'id')::uuid where id = p_order;
  perform set_config('app.vinculando_pedido_mant', '', true);

  insert into maintenance_audit (company_id, entity_type, entity_id, action, diff, actor_id)
  values (v_o.company_id, 'maintenance_order', p_order, 'sales_order_created',
          jsonb_build_object('pedido', v_pedido->>'number', 'total', v_pedido->'total'), auth.uid());

  return v_pedido || jsonb_build_object('ya_estaba', false);
end $$;

-- El presupuesto del lote mandado por mail queda en su auditoría.
create or replace function public.registrar_envio_documento(
  p_tipo text, p_id uuid, p_para text[], p_cc text[] default '{}', p_asunto text default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_company uuid;
  v_diff jsonb := jsonb_strip_nulls(jsonb_build_object(
    'para', to_jsonb(coalesce(p_para, '{}')),
    'cc', case when coalesce(array_length(p_cc, 1), 0) > 0 then to_jsonb(p_cc) end,
    'asunto', p_asunto));
begin
  case p_tipo
    when 'cotizacion' then select company_id into v_company from sales_quotes where id = p_id;
    when 'pedido' then select company_id into v_company from sales_orders where id = p_id;
    when 'entrega' then select company_id into v_company from deliveries where id = p_id;
    when 'pedido_compra' then select company_id into v_company from purchase_orders where id = p_id;
    when 'orden_mantenimiento' then select company_id into v_company from maintenance_orders where id = p_id;
    when 'lote_mantenimiento' then select company_id into v_company from maintenance_quote_batches where id = p_id;
    else raise exception 'Tipo de documento desconocido: %', p_tipo using errcode = 'check_violation';
  end case;
  if v_company is null then
    raise exception 'El documento no existe' using errcode = 'no_data_found';
  end if;
  if not (v_company = any (app.current_writer_company_ids())) then
    raise exception 'Sin permiso sobre esa empresa' using errcode = 'insufficient_privilege';
  end if;

  if p_tipo = 'pedido_compra' then
    insert into purchases_audit (company_id, entity_type, entity_id, action, diff, actor_id)
    values (v_company, 'purchase_order', p_id, 'emailed', v_diff, auth.uid());
  elsif p_tipo = 'orden_mantenimiento' then
    insert into maintenance_audit (company_id, entity_type, entity_id, action, diff, actor_id)
    values (v_company, 'maintenance_order', p_id, 'quote_emailed', v_diff, auth.uid());
  elsif p_tipo = 'lote_mantenimiento' then
    insert into maintenance_audit (company_id, entity_type, entity_id, action, diff, actor_id)
    values (v_company, 'maintenance_batch', p_id, 'quote_emailed', v_diff, auth.uid());
  else
    insert into sales_audit (company_id, entity_type, entity_id, action, diff, actor_id)
    values (v_company,
            case p_tipo when 'cotizacion' then 'quote' when 'pedido' then 'order' else 'delivery' end,
            p_id, 'emailed', v_diff, auth.uid());
  end if;
end $$;

revoke all on function public.mant_lote_crear(uuid, uuid, uuid[]) from public, anon;
revoke all on function public.mant_lote_agregar(uuid, uuid[]) from public, anon;
revoke all on function public.mant_lote_quitar(uuid, uuid) from public, anon;
revoke all on function public.mant_lote_aprobar(uuid, text) from public, anon;
revoke all on function public.mant_lote_rechazar(uuid, text) from public, anon;
revoke all on function public.mant_lote_crear_pedido(uuid) from public, anon;
grant execute on function public.mant_lote_crear(uuid, uuid, uuid[]) to authenticated;
grant execute on function public.mant_lote_agregar(uuid, uuid[]) to authenticated;
grant execute on function public.mant_lote_quitar(uuid, uuid) to authenticated;
grant execute on function public.mant_lote_aprobar(uuid, text) to authenticated;
grant execute on function public.mant_lote_rechazar(uuid, text) to authenticated;
grant execute on function public.mant_lote_crear_pedido(uuid) to authenticated;
revoke all on function app.lote_mant_meter(maintenance_quote_batches, uuid) from public, anon, authenticated;
revoke all on function app.lote_mant_para_escribir(uuid) from public, anon, authenticated;
