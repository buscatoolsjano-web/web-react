-- Mantenimiento → Ventas: el presupuesto aprobado genera el pedido de venta.
--
-- Hasta acá el taller aprobaba la cotización y cerraba la orden sin que nada
-- llegara a Ventas: el trabajo podía quedar sin facturar. Ahora, con la
-- cotización APROBADA, `mantenimiento_crear_pedido_venta()` arma un pedido de
-- venta BORRADOR con las mismas líneas, por el mismo `crear_pedido()` que usa
-- Ventas (mismas validaciones, numeración y auditoría). Desde ahí sigue el
-- circuito de siempre: confirmar, remito, factura.
--
-- · Una orden, un pedido: `maintenance_orders.sales_order_id` lo vincula y no
--   se genera dos veces.
-- · Se puede generar también con la orden cerrada (se cierra el taller y
--   después se factura). El vínculo es lo ÚNICO que se escribe en una orden
--   cerrada, y sólo desde esta función.
-- · Los precios de la cotización son netos: las líneas van con IVA 21 %, que
--   es lo que lleva casi todo lo vendido; el pedido nace en borrador para
--   revisarlo antes de confirmar.

alter table public.maintenance_orders
  add column if not exists sales_order_id uuid references public.sales_orders (id);
create unique index if not exists maintenance_orders_sales_order_uq
  on public.maintenance_orders (sales_order_id) where sales_order_id is not null;

-- La protección de la orden deja pasar SÓLO el vínculo con el pedido, y sólo
-- desde la función.
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

  -- El vínculo con el pedido de venta: sólo desde mantenimiento_crear_pedido_venta().
  if new.sales_order_id is distinct from old.sales_order_id then
    if coalesce(current_setting('app.vinculando_pedido_mant', true),'') <> new.id::text then
      raise exception 'El pedido de venta se genera con «Generar pedido de venta»'
        using errcode='restrict_violation';
    end if;
    -- Nada más puede cambiar junto con el vínculo (así pasa también con la orden cerrada).
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

revoke all on function public.mantenimiento_crear_pedido_venta(uuid) from public, anon;
grant execute on function public.mantenimiento_crear_pedido_venta(uuid) to authenticated;
