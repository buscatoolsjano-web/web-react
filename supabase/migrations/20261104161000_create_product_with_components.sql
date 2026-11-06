create or replace function public.create_product_with_components(
  p_company uuid,
  p_product jsonb,
  p_components jsonb default '[]'::jsonb
) returns table(id uuid, sku text, name text)
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into public.products (
    company_id, sku, name, model_code, description, description_long,
    status, brand_id, category_id, product_type, series, is_kit,
    attributes, origin_country, ncm_code, weight_g, volume_cm3
  )
  values (
    p_company, p_product->>'sku', p_product->>'name',
    nullif(p_product->>'model_code',''),
    nullif(p_product->>'description',''),
    nullif(p_product->>'description_long',''),
    coalesce(nullif(p_product->>'status',''),'active'),
    nullif(p_product->>'brand_id','')::uuid,
    (p_product->>'category_id')::uuid,
    nullif(p_product->>'product_type',''),
    nullif(p_product->>'series',''),
    coalesce((p_product->>'is_kit')::boolean, false),
    coalesce(p_product->'attributes','{}'::jsonb),
    nullif(p_product->>'origin_country',''),
    nullif(p_product->>'ncm_code',''),
    (p_product->>'weight_g')::numeric,
    (p_product->>'volume_cm3')::numeric
  )
  returning public.products.id into v_id;

  if jsonb_array_length(coalesce(p_components,'[]'::jsonb)) > 0 then
    insert into public.product_kit_components (
      company_id, kit_product_id, component_product_id, quantity, position
    )
    select p_company, v_id, (x->>'productoId')::uuid,
           (x->>'cantidad')::numeric, ordinality - 1
    from jsonb_array_elements(p_components) with ordinality as t(x, ordinality);
  end if;

  return query select p.id, p.sku, p.name
  from public.products p where p.id = v_id;
end;
$$;

revoke all on function public.create_product_with_components(uuid,jsonb,jsonb) from public;
grant execute on function public.create_product_with_components(uuid,jsonb,jsonb) to authenticated;
