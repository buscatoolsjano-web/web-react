-- La anulación de la recepción insertaba el contramovimiento con origen
-- «goods_receipt», y choca con uq_stock_mov_recepcion (un movimiento por
-- recepción y producto). Va con origen propio: «goods_receipt_cancel».

create or replace function public.anular_recepcion(p_receipt uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_r       goods_receipts;
  v_rol     text;
  v_motivo  text := nullif(btrim(coalesce(p_motivo, '')), '');
  r         record;
  v_movs    int := 0;
  v_estado  text;
  v_sku     text;
begin
  select * into v_r from goods_receipts where id = p_receipt for update;
  if not found then
    raise exception 'La recepción no existe' using errcode = 'no_data_found';
  end if;

  v_rol := app."current_role"(v_r.company_id);
  if v_rol is null or v_rol not in ('admin', 'employee') then
    raise exception 'Sin permiso para anular recepciones en esta empresa' using errcode = 'insufficient_privilege';
  end if;

  if v_r.status = 'cancelled' then
    return jsonb_build_object('ya_anulada', true, 'movimientos', 0);
  end if;
  if v_r.status <> 'confirmed' then
    raise exception 'La recepción % está en borrador: no movió stock, se borra directamente', v_r.number
      using errcode = 'restrict_violation';
  end if;
  if v_motivo is null then
    raise exception 'Falta el motivo de la anulación' using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from supplier_invoice_lines sil
      join goods_receipt_lines rl on rl.id = sil.goods_receipt_line_id
     where rl.goods_receipt_id = p_receipt
  ) then
    raise exception 'La recepción % ya está en una factura de proveedor: anulá primero la factura', v_r.number
      using errcode = 'restrict_violation';
  end if;

  -- Lo que sumó esta recepción, por producto y depósito (neto: por si hubo algo).
  for r in
    select m.product_id, m.warehouse_id, sum(m.quantity) neto
      from stock_movements m
     where m.source_type = 'goods_receipt' and m.source_id = p_receipt
     group by m.product_id, m.warehouse_id
    having sum(m.quantity) <> 0
  loop
    -- La mercadería tiene que seguir en el depósito: si ya se entregó, anular
    -- dejaría el stock en negativo.
    if coalesce((select b.on_hand from stock_balances b
                  where b.product_id = r.product_id and b.warehouse_id = r.warehouse_id
                  for update), 0) < r.neto then
      select sku into v_sku from products where id = r.product_id;
      raise exception 'De % ya salió mercadería: en el depósito quedan menos unidades de las que entraron con %',
        coalesce(v_sku, 'un producto'), v_r.number
        using errcode = 'check_violation';
    end if;

    insert into stock_movements (company_id, product_id, warehouse_id, movement_type,
                                 quantity, source_type, source_id, notes, created_by)
    values (v_r.company_id, r.product_id, r.warehouse_id, 'return_out',
            -r.neto, 'goods_receipt_cancel', p_receipt,
            'Anulación de la recepción ' || v_r.number || ': ' || v_motivo, auth.uid());
    v_movs := v_movs + 1;
  end loop;

  perform set_config('app.anulando_recepcion', p_receipt::text, true);
  update goods_receipts
     set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = v_motivo
   where id = p_receipt;
  perform set_config('app.anulando_recepcion', '', true);

  if v_r.purchase_order_id is not null then
    v_estado := app.derivar_receipt_status(v_r.purchase_order_id);
  end if;

  perform registrar_evento_compra('goods_receipt', p_receipt, 'cancel', 'confirmed', 'cancelled',
    jsonb_build_object('motivo', v_motivo, 'movimientos', v_movs));

  return jsonb_build_object('ya_anulada', false, 'movimientos', v_movs, 'receipt_status_pedido', v_estado);
end $$;

