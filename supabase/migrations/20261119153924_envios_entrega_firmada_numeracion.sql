-- Tres arreglos del circuito venta/compra.
--
-- 6 · El mail enviado queda registrado en el documento. Antes el envío no se
--     vinculaba con nada: desde la cotización no se sabía cuándo ni a quién se
--     había mandado. Ahora `registrar_envio_documento` deja un evento
--     «emailed» en la auditoría del documento (Ventas o Compras), que es lo
--     que muestra su trazabilidad.
-- 8 · El remito tiene el paso «entregado»: después de despachar, se marca
--     entregado con la fecha y quién recibió (el remito firmado).
-- 9 · Remitos con 5 dígitos como el resto (RT00001) en las empresas que todavía
--     no emitieron ninguno, y en las que se den de alta. Buscatools sigue con
--     los 10 de STEL: cambiarlo cortaría su numeración.

-- ── 6 ─────────────────────────────────────────────────────────────────────
alter table public.purchases_audit drop constraint if exists purchases_audit_action_check;
alter table public.purchases_audit add constraint purchases_audit_action_check check (action = any (array[
  'create', 'update', 'status_change', 'confirm', 'cancel', 'receive', 'stock_applied', 'delete', 'emailed'
]));

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
  else
    insert into sales_audit (company_id, entity_type, entity_id, action, diff, actor_id)
    values (v_company,
            case p_tipo when 'cotizacion' then 'quote' when 'pedido' then 'order' else 'delivery' end,
            p_id, 'emailed', v_diff, auth.uid());
  end if;
end $$;

revoke all on function public.registrar_envio_documento(text, uuid, text[], text[], text) from public, anon;
grant execute on function public.registrar_envio_documento(text, uuid, text[], text[], text) to authenticated;

-- ── 8 ─────────────────────────────────────────────────────────────────────
alter table public.deliveries
  add column if not exists received_at date,
  add column if not exists received_by_name text;

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
    if new.status = 'cancelled' and app.en_workflow('anular_entrega', new.id) then
      return new;
    end if;
    -- Despachado → entregado: sólo por `marcar_entrega_recibida`, que registra
    -- la fecha y quién recibió. No mueve stock (ya salió al despachar).
    if old.status = 'shipped' and new.status = 'delivered' and app.en_workflow('marcar_entrega_recibida', new.id) then
      return new;
    end if;
    raise exception 'DELIVERY_ALREADY_DISPATCHED'
      using errcode = 'restrict_violation',
            detail = format('El remito %s ya descontó stock: para dejarlo sin efecto hay que anularlo, que devuelve las unidades.', old.number);
  end if;

  if old.status = 'cancelled' then
    raise exception 'DELIVERY_CANCELLED'
      using errcode = 'restrict_violation',
            detail = format('El remito %s está cancelado.', old.number);
  end if;

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

create or replace function public.marcar_entrega_recibida(p_delivery uuid, p_fecha date default null, p_recibio text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  d record;
  v_fecha date := coalesce(p_fecha, current_date);
begin
  select * into d from deliveries where id = p_delivery for update;
  if not found then
    raise exception 'El remito no existe' using errcode = 'no_data_found';
  end if;
  if not (d.company_id = any (app.current_writer_company_ids())) then
    raise exception 'Sin permiso sobre esa empresa' using errcode = 'insufficient_privilege';
  end if;
  if d.status = 'delivered' then
    return jsonb_build_object('ya_estaba', true);
  end if;
  if d.status <> 'shipped' then
    raise exception 'El remito % no está despachado: primero se despacha', d.number using errcode = 'check_violation';
  end if;

  insert into app.workflow_ctx (txid, accion, entity_id)
  values ((pg_current_xact_id())::text::bigint, 'marcar_entrega_recibida', p_delivery)
  on conflict do nothing;
  update deliveries
     set status = 'delivered', received_at = v_fecha,
         received_by_name = nullif(btrim(coalesce(p_recibio, '')), ''),
         updated_by = auth.uid()
   where id = p_delivery;
  delete from app.workflow_ctx
   where txid = (pg_current_xact_id())::text::bigint
     and accion = 'marcar_entrega_recibida' and entity_id = p_delivery;

  insert into sales_audit (company_id, entity_type, entity_id, action, from_status, to_status, diff, actor_id)
  values (d.company_id, 'delivery', p_delivery, 'delivered', 'shipped', 'delivered',
          jsonb_strip_nulls(jsonb_build_object('fecha', v_fecha, 'recibio', nullif(btrim(coalesce(p_recibio, '')), ''))),
          auth.uid());

  return jsonb_build_object('ya_estaba', false);
end $$;

revoke all on function public.marcar_entrega_recibida(uuid, date, text) from public, anon;
grant execute on function public.marcar_entrega_recibida(uuid, date, text) to authenticated;

-- ── 9 ─────────────────────────────────────────────────────────────────────
update public.document_sequences s
   set padding = 5
  from public.companies c
 where c.id = s.company_id
   and s.doc_type = 'delivery' and s.prefix = 'RT' and s.padding = 10
   and s.next_number = 1
   and c.name <> 'Buscatools';

do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.config_crear_empresa'::regproc);
  if position($q$'RT',   10$q$ in v_def) > 0 then
    execute replace(v_def, $q$'RT',   10$q$, $q$'RT',   5$q$);
  end if;
end $$;
