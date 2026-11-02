-- Fase 224 · Cargar costo, precio de venta y stock inicial al crear un producto
-- nacido en el ERP (external_source <> 'stel').
--
-- «Esto dice que no se puede guardar acá, pero al ser un producto nuevo que no
--  se extrae de StelOrder, sí se tiene que poder cargar: el precio de costo, el
--  precio de venta y el stock inicial.»
--
-- El alta no los dejaba porque STEL es el maestro de product_prices y del stock.
-- Pero un producto creado a mano NO existe en STEL: `stel_sync_precio` sólo toca
-- productos con external_source='stel' (si no, devuelve 'producto_no_vinculado'
-- y no escribe), así que un precio puesto a mano sobre un producto del ERP no lo
-- pisa nunca. El costo no tenía dónde vivir (sólo existía dentro de listas/
-- facturas externas): se le dan columnas propias al producto.
--
-- Aplicado en producción (São Paulo) vía migración
-- `fase224_datos_comerciales_producto_erp`. Esta copia es el registro.
--
-- OJO: external_source IS NULL NO significa «cargado a mano»: los ~21.000
-- productos del catálogo importado (APEX, clon, etc.) también son NULL. Sólo
-- external_source='stel' (941 en Buscatools) son los que STEL maneja. La RPC
-- refuza esos; para el resto, escribe.

alter table public.products
  add column if not exists cost_amount numeric,
  add column if not exists cost_currency text;

comment on column public.products.cost_amount is
  'Costo cargado a mano en el ERP (productos no-STEL). STEL no lo toca. Fase 224.';
comment on column public.products.cost_currency is
  'Moneda del costo (EUR/USD/ARS): puede diferir de la moneda de venta, como el costo EUR con PVP USD. Fase 224.';

-- Setea los datos comerciales iniciales en una sola transacción. SECURITY
-- DEFINER para escribir product_prices (sin policy de insert para authenticated:
-- hoy sólo lo llena STEL con service role); la función valida admin/employee de
-- la empresa y que el producto NO sea de STEL.
create or replace function public.erp_cargar_datos_comerciales(
  p_company       uuid,
  p_product       uuid,
  p_cost_amount   numeric default null,
  p_cost_currency text    default null,
  p_price_amount  numeric default null,
  p_stock_inicial numeric default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_role   text;
  v_source text;
  v_list   uuid;
  v_wh     uuid;
  v_uid    uuid := auth.uid();
  r        jsonb := jsonb_build_object('costo', false, 'precio', false, 'stock', false);
begin
  v_role := app.current_role(p_company);
  if v_role is null or v_role not in ('admin','employee') then
    raise exception 'sin_permiso' using errcode = '42501';
  end if;

  select external_source into v_source
  from public.products
  where id = p_product and company_id = p_company and deleted_at is null;
  if not found then
    raise exception 'producto_inexistente';
  end if;
  if v_source = 'stel' then
    raise exception 'producto_de_stel';
  end if;

  if p_cost_amount is not null then
    if p_cost_amount <= 0 then raise exception 'costo_invalido'; end if;
    update public.products
       set cost_amount   = p_cost_amount,
           cost_currency = coalesce(nullif(trim(p_cost_currency), ''), cost_currency),
           updated_at    = now()
     where id = p_product;
    r := jsonb_set(r, '{costo}', 'true');
  end if;

  if p_price_amount is not null then
    if p_price_amount <= 0 then raise exception 'precio_invalido'; end if;
    select id into v_list from public.price_lists
     where company_id = p_company and is_default limit 1;
    if v_list is null then raise exception 'sin_lista_por_defecto'; end if;
    delete from public.product_prices
     where company_id = p_company and price_list_id = v_list
       and product_id = p_product and valid_to is null;
    insert into public.product_prices (company_id, price_list_id, product_id, amount, valid_from)
    values (p_company, v_list, p_product, p_price_amount, current_date);
    r := jsonb_set(r, '{precio}', 'true');
  end if;

  if p_stock_inicial is not null and p_stock_inicial <> 0 then
    select id into v_wh from public.warehouses
     where company_id = p_company and is_default limit 1;
    if v_wh is null then raise exception 'sin_deposito_por_defecto'; end if;
    insert into public.stock_movements
      (company_id, product_id, warehouse_id, movement_type, quantity, notes, created_by)
    values
      (p_company, p_product, v_wh, 'opening_balance', p_stock_inicial,
       'Carga inicial al crear el producto', v_uid);
    r := jsonb_set(r, '{stock}', 'true');
  end if;

  return r;
end $$;

revoke all on function public.erp_cargar_datos_comerciales(uuid,uuid,numeric,text,numeric,numeric) from public;
grant execute on function public.erp_cargar_datos_comerciales(uuid,uuid,numeric,text,numeric,numeric) to authenticated;
