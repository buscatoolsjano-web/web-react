-- Fase 137 · Edición masiva de productos desde el catálogo.
-- (Aplicada a São Paulo con apply_migration `fase137_editar_productos_masivo`;
--  se deja acá para que el repo tenga la fuente, como el resto de las fases.)
--
-- Cambia UN campo en una lista EXPLÍCITA de productos de UNA empresa. No hay
-- update «a todo lo que filtra»: la pantalla manda los ids elegidos y nada más.
--
-- SECURITY INVOKER a propósito: corre como quien llama, así la policy
-- `products_write` (admin/employee) sigue decidiendo quién puede escribir. El
-- campo va en lista blanca; cualquier otro revienta antes de tocar nada. La
-- referencia (sku) NO se puede tocar acá: es la clave única por empresa y
-- ponerle el mismo valor a varios los haría chocar.
create or replace function public.editar_productos_masivo(
  p_company uuid,
  p_ids uuid[],
  p_campo text,
  p_valor text
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
  v text := nullif(btrim(p_valor), '');
begin
  if p_company is null or p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;

  if p_campo = 'brand_id' then
    update products set brand_id = v::uuid
     where company_id = p_company and id = any(p_ids) and deleted_at is null;
  elsif p_campo = 'category_id' then
    if v is null then raise exception 'La categoría no puede quedar vacía.'; end if;
    update products set category_id = v::uuid
     where company_id = p_company and id = any(p_ids) and deleted_at is null;
  elsif p_campo in ('product_type', 'series', 'origin_country') then
    execute format(
      'update products set %I = $1 where company_id = $2 and id = any($3) and deleted_at is null',
      p_campo
    ) using v, p_company, p_ids;
  elsif p_campo like 'attr.%' then
    if v is null then
      update products set attributes = attributes - substring(p_campo from 6)
       where company_id = p_company and id = any(p_ids) and deleted_at is null;
    else
      update products
         set attributes = coalesce(attributes, '{}'::jsonb)
              || jsonb_build_object(substring(p_campo from 6), v)
       where company_id = p_company and id = any(p_ids) and deleted_at is null;
    end if;
  else
    raise exception 'Campo no permitido: %', p_campo;
  end if;

  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.editar_productos_masivo(uuid, uuid[], text, text) to authenticated;
