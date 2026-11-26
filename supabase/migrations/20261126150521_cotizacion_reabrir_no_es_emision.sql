-- Reabrir una cotización perdida no es una emisión (2026-11).
-- La regla de autoridad de numeración tomaba rejected -> sent como un alta y la
-- frenaba en las series que todavía numera STEL. Una cotización que estuvo
-- aceptada, rechazada o vencida ya fue emitida: volver a «sent» no emite nada.
create or replace function app.guardar_autoridad_numeracion()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_doc_type text;
  v_estado_nuevo text;
  v_estado_viejo text;
  v_emitidos text[];
begin
  case tg_table_name
    when 'sales_quotes' then
      v_doc_type := 'quote';
      v_emitidos := array['sent', 'accepted'];
      v_estado_nuevo := new.status;
      v_estado_viejo := case when tg_op = 'UPDATE' then old.status end;
    when 'sales_orders' then
      v_doc_type := 'sales_order';
      v_emitidos := array['confirmed'];
      v_estado_nuevo := new.commercial_status;
      v_estado_viejo := case when tg_op = 'UPDATE' then old.commercial_status end;
    when 'deliveries' then
      v_doc_type := 'delivery';
      v_emitidos := array['shipped', 'delivered'];
      v_estado_nuevo := new.status;
      v_estado_viejo := case when tg_op = 'UPDATE' then old.status end;
    else
      raise exception 'guardar_autoridad_numeracion: tabla no soportada %', tg_table_name;
  end case;

  if app.es_importacion_externa(new.imported_at) then
    return new;
  end if;

  if coalesce(auth.role(), '') in ('anon', 'authenticated')
     and not (new.company_id = any (app.current_writer_company_ids())) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    perform app.exigir_emision_erp(new.company_id, v_doc_type, new.series_code);
  elsif new.company_id is distinct from old.company_id then
    perform app.exigir_emision_erp(new.company_id, v_doc_type, new.series_code);
  elsif v_estado_nuevo = any (v_emitidos) and v_estado_nuevo is distinct from v_estado_viejo
        -- Una cotización que ya estuvo aceptada, rechazada o vencida fue emitida.
        and not (tg_table_name = 'sales_quotes' and v_estado_viejo in ('accepted', 'rejected', 'expired')) then
    perform app.exigir_emision_erp(new.company_id, v_doc_type, new.series_code);
  end if;

  return new;
end $function$;
