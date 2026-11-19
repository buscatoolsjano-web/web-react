-- Guardar los datos fiscales del cliente (condición frente al IVA y CUIT).
--
-- Va aparte de `guardar_cliente` a propósito: lo llama la ficha del cliente y
-- también el modal que aparece al facturar a un cliente que no los tiene, sin
-- tener que mandar el formulario entero ni el testigo de concurrencia.
create or replace function public.cliente_guardar_datos_fiscales(p_customer uuid, p_condicion text, p_cuit text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v customers%rowtype;
  v_rol text;
  v_cuit text := nullif(btrim(coalesce(p_cuit, '')), '');
  v_cond text := nullif(btrim(coalesce(p_condicion, '')), '');
  v_diff jsonb := '{}'::jsonb;
begin
  select * into v from customers where id = p_customer for update;
  if v.id is null then
    raise exception 'CLIENTE_INEXISTENTE';
  end if;

  v_rol := app."current_role"(v.company_id);
  if v_rol is null or v_rol not in ('admin', 'employee', 'salesperson') then
    raise exception 'SIN_PERMISO';
  end if;
  if v_rol = 'salesperson' and v.salesperson_id is distinct from auth.uid() then
    raise exception 'SIN_PERMISO';
  end if;

  if v_cond is not null and v_cond not in ('responsable_inscripto', 'monotributo', 'exento', 'consumidor_final', 'no_responsable', 'exterior') then
    raise exception 'CONDICION_INVALIDA';
  end if;

  -- El CUIT sólo se toca si vino; si vino, son 11 dígitos.
  if v_cuit is not null and length(regexp_replace(v_cuit, '\D', '', 'g')) <> 11 then
    raise exception 'CUIT_INVALIDO' using detail = 'Un CUIT tiene 11 dígitos.';
  end if;

  if v_cond is distinct from v.tax_condition then
    v_diff := v_diff || jsonb_build_object('tax_condition', jsonb_build_array(v.tax_condition, v_cond));
  end if;
  if v_cuit is not null and v_cuit is distinct from v.tax_id then
    v_diff := v_diff || jsonb_build_object('tax_id', jsonb_build_array(v.tax_id, v_cuit));
  end if;
  if v_diff = '{}'::jsonb then
    return jsonb_build_object('id', v.id, 'sin_cambios', true);
  end if;

  begin
    update customers
       set tax_condition = v_cond,
           tax_id = coalesce(v_cuit, tax_id)
     where id = p_customer;
  exception when unique_violation then
    raise exception 'CLIENTE_DUPLICADO' using detail = 'Ya hay un cliente con ese CUIT en esta empresa.';
  end;

  insert into sales_audit (company_id, entity_type, entity_id, action, diff, actor_id)
  values (v.company_id, 'customer', v.id, 'updated', v_diff, auth.uid());

  return jsonb_build_object('id', v.id, 'sin_cambios', false);
end $$;

revoke all on function public.cliente_guardar_datos_fiscales(uuid, text, text) from public, anon;
grant execute on function public.cliente_guardar_datos_fiscales(uuid, text, text) to authenticated;
