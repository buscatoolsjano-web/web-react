-- Mantenimiento: lo que el sitio viejo (mantenimiento.buscatool.com) tenía y el
-- ERP no, para que el taller se pueda pasar.
--
-- 1 · Pausa con motivo. `on_hold` decía «en espera» pero no el porqué. Ahora
--     lleva motivo (sin repuesto, repuesto con falla, urgencia, espera del
--     cliente, otro) y una nota; los dos quedan en la auditoría al pausar.
-- 2 · Resultado final y eficiencia en el cierre. «Aprobada / Reprobada / En
--     espera de repuesto / Calibrada» y el % de eficiencia general. El
--     resultado pasa a ser condición para cerrar.
-- 3 · El presupuesto de mantenimiento se manda por mail: queda el evento
--     «emailed» en la auditoría de la orden, como en Ventas y Compras.

-- ── 1 ─────────────────────────────────────────────────────────────────────
alter table public.maintenance_orders
  add column if not exists on_hold_reason text,
  add column if not exists on_hold_note text,
  add column if not exists final_result text,
  add column if not exists efficiency_pct numeric;

alter table public.maintenance_orders drop constraint if exists chk_mo_motivo_pausa;
alter table public.maintenance_orders add constraint chk_mo_motivo_pausa check (
  on_hold_reason is null
  or on_hold_reason = any (array['sin_repuesto','repuesto_con_falla','urgencia','espera_cliente','otro'])
);
alter table public.maintenance_orders drop constraint if exists chk_mo_pausa_coherente;
alter table public.maintenance_orders add constraint chk_mo_pausa_coherente check (
  on_hold or (on_hold_reason is null and on_hold_note is null)
);
alter table public.maintenance_orders drop constraint if exists chk_mo_resultado_final;
alter table public.maintenance_orders add constraint chk_mo_resultado_final check (
  final_result is null
  or final_result = any (array['aprobada','reprobada','espera_repuesto','calibrada'])
);
alter table public.maintenance_orders drop constraint if exists chk_mo_eficiencia;
alter table public.maintenance_orders add constraint chk_mo_eficiencia check (
  efficiency_pct is null or (efficiency_pct >= 0 and efficiency_pct <= 100)
);

-- La auditoría de la pausa lleva el motivo y la nota.
create or replace function app.auditar_orden_mantenimiento()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_accion text; v_motivo text;
begin
  if tg_op = 'INSERT' then
    insert into maintenance_audit (company_id, entity_type, entity_id, action,
                                   from_status, to_status, actor_id)
    values (new.company_id, 'maintenance_order', new.id, 'create', null, new.status, auth.uid());

    if not new.repair_required or not new.torque_required then
      insert into maintenance_audit (company_id, entity_type, entity_id, action, diff, actor_id)
      values (new.company_id, 'maintenance_order', new.id, 'stage_marked_not_required',
              jsonb_strip_nulls(jsonb_build_object(
                'repair', case when not new.repair_required then true end,
                'torque', case when not new.torque_required then true end,
                'al_crear', true)),
              auth.uid());
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into maintenance_audit (company_id, entity_type, entity_id, action,
                                   from_status, to_status, diff, actor_id)
    values (new.company_id, 'maintenance_order', new.id,
            case new.status when 'closed' then 'order_closed'
                            when 'cancelled' then 'order_cancelled'
                            else 'status_changed' end,
            old.status, new.status,
            case when new.status = 'closed' then jsonb_strip_nulls(jsonb_build_object(
              'resultado', new.final_result, 'eficiencia', new.efficiency_pct)) end,
            auth.uid());
  end if;

  if new.stage is distinct from old.stage then
    v_accion := case
      when array_position(app.etapas_requeridas(new.repair_required, new.torque_required), new.stage)
         < array_position(app.etapas_requeridas(new.repair_required, new.torque_required), old.stage)
      then 'stage_reverted' else 'stage_changed' end;
    insert into maintenance_audit (company_id, entity_type, entity_id, action,
                                   from_status, to_status, actor_id)
    values (new.company_id, 'maintenance_order', new.id, v_accion,
            old.stage, new.stage, auth.uid());
  end if;

  if new.on_hold is distinct from old.on_hold then
    insert into maintenance_audit (company_id, entity_type, entity_id, action,
                                   from_status, to_status, diff, actor_id)
    values (new.company_id, 'maintenance_order', new.id,
            case when new.on_hold then 'order_put_on_hold' else 'order_resumed' end,
            old.stage, new.stage,
            case when new.on_hold
              then jsonb_strip_nulls(jsonb_build_object('motivo', new.on_hold_reason, 'nota', new.on_hold_note))
              else jsonb_strip_nulls(jsonb_build_object('motivo', old.on_hold_reason)) end,
            auth.uid());
  end if;

  if (old.repair_required and not new.repair_required)
     or (old.torque_required and not new.torque_required) then
    insert into maintenance_audit (company_id, entity_type, entity_id, action, diff, actor_id)
    values (new.company_id, 'maintenance_order', new.id, 'stage_marked_not_required',
            jsonb_strip_nulls(jsonb_build_object(
              'repair', case when old.repair_required and not new.repair_required then true end,
              'torque', case when old.torque_required and not new.torque_required then true end)),
            auth.uid());
  end if;

  if new.quote_status is distinct from old.quote_status
     and new.quote_status in ('approved','rejected') then
    v_motivo := nullif(btrim(coalesce(current_setting('app.motivo_cotizacion_mant', true), '')), '');
    insert into maintenance_audit (company_id, entity_type, entity_id, action,
                                   from_status, to_status, diff, actor_id)
    values (new.company_id, 'maintenance_order', new.id,
            'quote_' || new.quote_status, old.quote_status, new.quote_status,
            jsonb_strip_nulls(jsonb_build_object('total', new.quote_total,
                                                 'moneda', new.quote_currency_code,
                                                 'por', new.quote_approved_by_name,
                                                 'motivo', v_motivo)),
            auth.uid());
  end if;

  return new;
end $function$;

-- ── 2 ─────────────────────────────────────────────────────────────────────
create or replace function app.bloqueos_de_cierre_mant(p_order uuid)
 returns text[]
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_o maintenance_orders; v_n int; v_out text[] := '{}';
begin
  select * into v_o from maintenance_orders where id = p_order;
  if not found then return array['La orden no existe'::text]; end if;

  -- 4 · no se cierra salteando el circuito
  if v_o.stage <> 'closing' then
    v_out := v_out || format('La orden está en la etapa «%s»: se cierra desde «Cierre»', v_o.stage);
  end if;

  -- 5 · diagnóstico completado
  if v_o.diagnosed_at is null then
    v_out := v_out || 'Falta completar el diagnóstico'::text;
  end if;

  -- 6 · cotización resuelta
  if v_o.quote_status = 'pending' then
    v_out := v_out || 'La cotización sigue pendiente: hay que aprobarla o rechazarla'::text;
  end if;

  -- 7 · una cotización aprobada sin líneas no es una cotización
  if v_o.quote_status = 'approved' then
    select count(*) into v_n from maintenance_quote_lines where maintenance_order_id = p_order;
    if v_n = 0 then
      v_out := v_out || 'La cotización está aprobada y no tiene ninguna línea'::text;
    end if;
  end if;

  -- 8 · reparación completada o marcada no requerida
  if v_o.repair_required and v_o.repaired_at is null then
    v_out := v_out || 'Falta completar la reparación, o marcarla como no requerida'::text;
  end if;

  -- 9 · torque completado o marcado no requerido
  if v_o.torque_required and v_o.torque_at is null then
    v_out := v_out || 'Falta completar el torque, o marcarlo como no requerido'::text;
  end if;

  -- 10 · si el torque aplica, al menos una medición cargada
  if v_o.torque_required then
    select count(*) into v_n from maintenance_measurements
     where maintenance_order_id = p_order and target_value is not null;
    if v_n = 0 then
      v_out := v_out || 'El torque es requerido y no hay ninguna medición cargada'::text;
    end if;
  end if;

  -- 11 · cerrar es entregar, y con fechas coherentes
  if v_o.delivered_at is null then
    v_out := v_out || 'Falta la fecha de entrega'::text;
  elsif v_o.delivered_at < v_o.received_at then
    v_out := v_out || 'La entrega no puede ser anterior al ingreso'::text;
  end if;

  -- 12 · no queda un repuesto «a consumir» colgado
  select count(*) into v_n from maintenance_order_parts
   where maintenance_order_id = p_order and consumed_at is null;
  if v_n = 1 then
    v_out := v_out || 'Queda 1 repuesto sin confirmar el consumo'::text;
  elsif v_n > 1 then
    v_out := v_out || format('Quedan %s repuestos sin confirmar el consumo', v_n);
  end if;

  -- 13 · el resultado final (aprobada, reprobada, en espera de repuesto, calibrada)
  if v_o.final_result is null then
    v_out := v_out || 'Falta el resultado final del servicio'::text;
  end if;

  return v_out;
end $function$;

-- ── 3 ─────────────────────────────────────────────────────────────────────
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
  else
    insert into sales_audit (company_id, entity_type, entity_id, action, diff, actor_id)
    values (v_company,
            case p_tipo when 'cotizacion' then 'quote' when 'pedido' then 'order' else 'delivery' end,
            p_id, 'emailed', v_diff, auth.uid());
  end if;
end $$;

revoke all on function public.registrar_envio_documento(text, uuid, text[], text[], text) from public, anon;
grant execute on function public.registrar_envio_documento(text, uuid, text[], text[], text) to authenticated;
