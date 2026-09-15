-- =============================================================================
-- Fase 14 · Entrega 3 — invariantes de workflow previas al cutover.
--
-- 1. Remito despachado NO se cancela ni vuelve atrás (DELIVERY_ALREADY_DISPATCHED).
--    · draft → cancelled: permitido.
--    · draft → shipped: SÓLO dentro de public.confirmar_entrega (contexto de
--      transacción no falsificable app.workflow_ctx), que es quien descuenta stock.
--    · shipped/delivered → cualquier otro estado: bloqueado.
--    · cancelled es terminal (DELIVERY_CANCELLED).
--    · Un remito nuevo no importado nace en draft (DELIVERY_STATUS_REQUIRES_DISPATCH).
--    · Las líneas de un remito que no está en borrador no se tocan desde la app.
-- 2. Moneda obligatoria en documentos NUEVOS (no importados): cotización,
--    pedido y remito (DOCUMENT_CURRENCY_REQUIRED). Un pedido que viene de una
--    cotización y un remito que viene de un pedido conservan la moneda del
--    documento fuente (DOCUMENT_CURRENCY_MISMATCH). Los históricos importados
--    (imported_at) quedan fuera: STEL tiene cambios de moneda reales.
--
-- Estado verificado antes (2026-09-15): 0 cotizaciones, pedidos y remitos no
-- importados; 0 documentos sin moneda; 192 remitos, todos delivered e
-- importados; 0 remitos cancelados con movimientos.
--
-- Orden de triggers BEFORE (alfabético): trg_000_campos_importacion,
-- trg_00_autoridad_numeracion (el bloqueo STEL sigue primero), trg_05_*.
-- Con RLS: una sesión que no escribe en la empresa sigue viendo el rechazo de
-- la política, no el de estos triggers.
--
-- Aplicada como migraciones `fase14_e3_invariantes_remito_moneda` y
-- `fase14_e3_moneda_documento_campos_por_tabla` y `fase14_e3_moneda_desmarcar_por_mantenimiento`
-- (correcciones de app.exigir_moneda_documento, ya incluidas abajo). Rollback al final.
-- =============================================================================

-- ── Contexto de workflow (mismo patrón que app.stel_reconciliation_ctx) ─────
create table if not exists app.workflow_ctx (
  txid bigint not null,
  accion text not null,
  entity_id uuid not null,
  primary key (txid, accion, entity_id)
);
revoke all on table app.workflow_ctx from public, anon, authenticated;

create or replace function app.en_workflow(p_accion text, p_id uuid)
returns boolean
language sql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
  select coalesce((
    select exists (
      select 1 from app.workflow_ctx w
       where w.txid = (pg_current_xact_id_if_assigned())::text::bigint
         and w.accion = p_accion and w.entity_id = p_id
    )
  ), false)
$$;
revoke all on function app.en_workflow(text, uuid) from public;
grant execute on function app.en_workflow(text, uuid) to anon, authenticated, service_role;

-- ── confirmar_entrega: igual que antes + contexto alrededor del cambio de estado ─
create or replace function public.confirmar_entrega(p_delivery uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_company uuid; v_status text; v_order uuid; v_number text; v_warehouse uuid;
  v_movs int := 0; v_libera int := 0; v_cumplimiento text; l record; r record;
  v_restante numeric;
begin
  -- FOR UPDATE: el segundo que llegue espera y encuentra el estado ya
  -- cambiado. Sin esto, dos confirmaciones simultáneas descuentan dos veces.
  select company_id, status, order_id, number
    into v_company, v_status, v_order, v_number
    from deliveries where id = p_delivery for update;

  if v_company is null then
    raise exception 'La entrega no existe' using errcode = 'no_data_found';
  end if;

  if auth.uid() is not null
     and v_company <> all (app.current_writer_company_ids()) then
    raise exception 'Sin permiso sobre esa empresa' using errcode = 'insufficient_privilege';
  end if;

  -- Fase 12 E2.5: si STEL numera los remitos de esta empresa, no se despacha
  -- desde el ERP. Antes de todo efecto: 0 movimientos, 0 reservas, 0 eventos.
  perform app.exigir_emision_erp(v_company, 'delivery');

  if v_status = 'cancelled' then
    raise exception 'El remito % está cancelado', v_number using errcode = 'restrict_violation';
  end if;

  -- La guarda de idempotencia: ya estaba despachado, no se repite nada.
  if v_status <> 'draft' then
    return jsonb_build_object('ya_confirmada', true, 'status', v_status,
                              'movimientos', 0, 'reservas_liberadas', 0);
  end if;

  select id into v_warehouse from warehouses where company_id = v_company limit 1;

  for l in
    select dl.id, dl.product_id, dl.quantity, dl.warehouse_id, dl.order_line_id
      from delivery_lines dl
     where dl.delivery_id = p_delivery and dl.product_id is not null
  loop
    -- La cantidad va en NEGATIVO: el trigger de stock suma lo que reciba.
    insert into stock_movements (company_id, product_id, warehouse_id, movement_type,
                                 quantity, source_type, source_id, notes)
    values (v_company, l.product_id, coalesce(l.warehouse_id, v_warehouse),
            'sale_delivery', -l.quantity, 'delivery', p_delivery,
            'Remito ' || v_number);
    v_movs := v_movs + 1;

    -- Reservas del pedido para ese producto: se consumen hasta la cantidad
    -- entregada. Se BORRA y, si sobra, se vuelve a insertar el resto: el
    -- trigger de reservas sólo entiende INSERT y DELETE.
    if v_order is not null then
      v_restante := l.quantity;
      for r in
        select id, quantity, warehouse_id, notes
          from stock_reservations
         where company_id = v_company and product_id = l.product_id
           and source_type = 'sales_order' and source_id = v_order
         order by created_at
      loop
        exit when v_restante <= 0;
        delete from stock_reservations where id = r.id;
        v_libera := v_libera + 1;
        if r.quantity > v_restante then
          insert into stock_reservations (company_id, product_id, warehouse_id,
                                          quantity, source_type, source_id, notes)
          values (v_company, l.product_id, r.warehouse_id, r.quantity - v_restante,
                  'sales_order', v_order, r.notes);
        end if;
        v_restante := v_restante - r.quantity;
      end loop;
    end if;
  end loop;

  -- Fase 14 E3: el paso draft → shipped sólo vale acá (app.proteger_estado_entrega).
  insert into app.workflow_ctx (txid, accion, entity_id)
  values ((pg_current_xact_id())::text::bigint, 'despachar_entrega', p_delivery)
  on conflict do nothing;
  update deliveries set status = 'shipped' where id = p_delivery;
  delete from app.workflow_ctx
   where txid = (pg_current_xact_id())::text::bigint and accion = 'despachar_entrega' and entity_id = p_delivery;

  if v_order is not null then
    v_cumplimiento := app.derivar_cumplimiento(v_order);
  end if;

  insert into sales_audit (company_id, entity_type, entity_id, action,
                           from_status, to_status, diff, actor_id)
  values (v_company, 'delivery', p_delivery, 'shipped', 'draft', 'shipped',
          jsonb_build_object('movimientos', v_movs, 'reservas_liberadas', v_libera),
          auth.uid());

  if v_movs > 0 then
    insert into sales_audit (company_id, entity_type, entity_id, action, diff, actor_id)
    values (v_company, 'delivery', p_delivery, 'stock_consumed',
            jsonb_build_object('lineas', v_movs), auth.uid());
  end if;

  if v_libera > 0 then
    insert into sales_audit (company_id, entity_type, entity_id, action, diff, actor_id)
    values (v_company, 'delivery', p_delivery, 'reservation_released',
            jsonb_build_object('reservas', v_libera), auth.uid());
  end if;

  return jsonb_build_object('ya_confirmada', false, 'status', 'shipped',
                            'movimientos', v_movs, 'reservas_liberadas', v_libera,
                            'cumplimiento', v_cumplimiento);
end $function$;

-- ── Estado del remito ───────────────────────────────────────────────────────
create or replace function app.proteger_estado_entrega()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if app.en_reconciliacion_stel() then
    return new;
  end if;
  -- Quien no escribe en la empresa recibe el rechazo de RLS, no éste.
  if coalesce(auth.role(), '') in ('anon', 'authenticated')
     and not (new.company_id = any (app.current_writer_company_ids())) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' and new.imported_at is null then
      raise exception 'DELIVERY_STATUS_REQUIRES_DISPATCH'
        using errcode = 'check_violation',
              detail = 'Un remito nuevo nace en borrador; se despacha con Confirmar y despachar.';
    end if;
    return new;
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  if old.status in ('shipped', 'delivered') then
    raise exception 'DELIVERY_ALREADY_DISPATCHED'
      using errcode = 'restrict_violation',
            detail = format('El remito %s ya generó movimiento de stock y no puede cancelarse ni volver atrás directamente.', old.number);
  end if;

  if old.status = 'cancelled' then
    raise exception 'DELIVERY_CANCELLED'
      using errcode = 'restrict_violation',
            detail = format('El remito %s está cancelado.', old.number);
  end if;

  -- old.status = 'draft'
  if new.status = 'cancelled' then
    return new;
  end if;
  if new.status = 'shipped' and app.en_workflow('despachar_entrega', new.id) then
    return new;
  end if;
  raise exception 'DELIVERY_STATUS_REQUIRES_DISPATCH'
    using errcode = 'check_violation',
          detail = 'El estado de un remito sólo avanza con Confirmar y despachar, que descuenta el stock.';
end $function$;

drop trigger if exists trg_05_estado_entrega on public.deliveries;
create trigger trg_05_estado_entrega before insert or update on public.deliveries
  for each row execute function app.proteger_estado_entrega();

create or replace function app.bloquear_lineas_entrega_despachada()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_status text; v_company uuid; v_number text;
begin
  if app.en_reconciliacion_stel() or coalesce(auth.role(), '') not in ('anon', 'authenticated') then
    return coalesce(new, old);
  end if;
  select status, company_id, number into v_status, v_company, v_number
    from deliveries where id = coalesce(new.delivery_id, old.delivery_id);
  if v_company is null or not (v_company = any (app.current_writer_company_ids())) then
    return coalesce(new, old);
  end if;
  if v_status <> 'draft' then
    raise exception 'DELIVERY_ALREADY_DISPATCHED'
      using errcode = 'restrict_violation',
            detail = format('Las líneas del remito %s (%s) no se modifican.', v_number, v_status);
  end if;
  return coalesce(new, old);
end $function$;

drop trigger if exists trg_05_lineas_entrega_estado on public.delivery_lines;
create trigger trg_05_lineas_entrega_estado before insert or update or delete on public.delivery_lines
  for each row execute function app.bloquear_lineas_entrega_despachada();

-- ── Moneda del documento nuevo ──────────────────────────────────────────────
create or replace function app.exigir_moneda_documento()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  -- Los campos que no existen en todas las tablas se leen por jsonb: PL/pgSQL
  -- resuelve new.quote_id aunque la condición de tabla sea falsa (corrección
  -- `fase14_e3_moneda_documento_campos_por_tabla`, detectada por la suite E3).
  v_nueva jsonb := to_jsonb(new);
  v_vieja jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_campo_origen text := case tg_table_name when 'sales_orders' then 'quote_id' when 'deliveries' then 'order_id' end;
  v_origen text;
  v_hay_origen boolean := false;
begin
  if new.imported_at is not null or app.en_reconciliacion_stel() then
    return new;
  end if;
  -- Mantenimiento: service_role quita la marca de importación de un histórico sin tocar
  -- su moneda ni su origen (paso previo del borrado, como app.puede_borrar_por_mantenimiento).
  -- Migración `fase14_e3_moneda_desmarcar_por_mantenimiento`.
  if tg_op = 'UPDATE' and old.imported_at is not null
     and coalesce(auth.role(), '') = 'service_role'
     and new.currency_code is not distinct from old.currency_code
     and (v_campo_origen is null or (v_nueva -> v_campo_origen) is not distinct from (v_vieja -> v_campo_origen)) then
    return new;
  end if;
  if coalesce(auth.role(), '') in ('anon', 'authenticated')
     and not (new.company_id = any (app.current_writer_company_ids())) then
    return new;
  end if;

  if new.currency_code is null then
    raise exception 'DOCUMENT_CURRENCY_REQUIRED'
      using errcode = 'check_violation',
            detail = 'El documento necesita una moneda elegida explícitamente: no hay moneda por defecto.';
  end if;

  if v_campo_origen is not null and (v_nueva ->> v_campo_origen) is not null
     and (tg_op = 'INSERT'
          or (v_nueva -> v_campo_origen) is distinct from (v_vieja -> v_campo_origen)
          or new.currency_code is distinct from (v_vieja ->> 'currency_code')) then
    if tg_table_name = 'sales_orders' then
      select currency_code, true into v_origen, v_hay_origen from sales_quotes where id = (v_nueva ->> 'quote_id')::uuid;
    else
      select currency_code, true into v_origen, v_hay_origen from sales_orders where id = (v_nueva ->> 'order_id')::uuid;
    end if;
  end if;

  if v_hay_origen and v_origen is distinct from new.currency_code then
    raise exception 'DOCUMENT_CURRENCY_MISMATCH'
      using errcode = 'check_violation',
            detail = format('El documento conserva la moneda de su documento de origen (%s).', coalesce(v_origen, 'sin moneda'));
  end if;
  return new;
end $function$;

drop trigger if exists trg_05_moneda_documento on public.sales_quotes;
create trigger trg_05_moneda_documento before insert or update on public.sales_quotes
  for each row execute function app.exigir_moneda_documento();
drop trigger if exists trg_05_moneda_documento on public.sales_orders;
create trigger trg_05_moneda_documento before insert or update on public.sales_orders
  for each row execute function app.exigir_moneda_documento();
drop trigger if exists trg_05_moneda_documento on public.deliveries;
create trigger trg_05_moneda_documento before insert or update on public.deliveries
  for each row execute function app.exigir_moneda_documento();

-- =============================================================================
-- ROLLBACK
--   drop trigger trg_05_moneda_documento on public.sales_quotes;
--   drop trigger trg_05_moneda_documento on public.sales_orders;
--   drop trigger trg_05_moneda_documento on public.deliveries;
--   drop function app.exigir_moneda_documento();
--   drop trigger trg_05_lineas_entrega_estado on public.delivery_lines;
--   drop function app.bloquear_lineas_entrega_despachada();
--   drop trigger trg_05_estado_entrega on public.deliveries;
--   drop function app.proteger_estado_entrega();
--   -- public.confirmar_entrega: la misma definición sin las tres sentencias de
--   --   app.workflow_ctx alrededor de `update deliveries set status = 'shipped'`
--   drop function app.en_workflow(text, uuid);
--   drop table app.workflow_ctx;
-- =============================================================================
