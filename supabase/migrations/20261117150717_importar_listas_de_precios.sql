-- Importar listas de precios desde la pantalla (Excel o CSV).
--
-- Hasta acá cada lista se cargaba con un script por marca. Ahora la pantalla
-- lee el archivo, detecta columnas y marca, y la carga va por estas tres
-- funciones, con los permisos de quien importa (RLS: admin de la empresa):
--
--   1. listas_detectar_marca(empresa, referencias)
--      Cuántas referencias del archivo existen en el catálogo de cada marca.
--      Es la señal más confiable de qué marca es una lista: el nombre del
--      archivo puede no decirlo, las referencias sí.
--
--   2. listas_preparar_version(empresa, marca, fecha, moneda, ancla, archivo)
--      La fuente de la marca (la crea si no existe) y la versión de esa fecha.
--      Si ya había una versión de esa fecha y columna, la vacía: reimportar
--      reemplaza, no duplica.
--
--   3. listas_cerrar_version(version)
--      Cruza cada renglón con su producto y devuelve el resumen, con la
--      comparación contra la versión anterior.
--
-- Los renglones se insertan entre 2 y 3, en tandas, directo en
-- price_list_items: una lista de 10.000 renglones no entra cómoda en una sola
-- llamada.
--
-- El cruce con el catálogo, por orden: «PREFIJO.REFERENCIA» (la regla de
-- siempre), la referencia como SKU tal cual, y el código de modelo dentro de
-- la marca. Una referencia que no cruza no es un error: se guarda igual.

-- Qué producto de qué marca corresponde a cada referencia, por las tres vías.
-- Tres joins por igualdad (que Postgres resuelve con hash) y no uno con OR,
-- que con 10.000 referencias recorrería el catálogo una vez por renglón.
-- `prioridad`: 1 = PREFIJO.REF, 2 = SKU igual a la referencia, 3 = modelo.
create or replace function app.cruces_de_referencias(p_company_id uuid, p_referencias text[])
returns table (ref text, brand_id uuid, product_id uuid, prioridad integer)
language sql
stable
set search_path = public, pg_temp
as $$
  with refs as (
    select distinct upper(btrim(r)) ref
    from unnest(p_referencias) r
    where btrim(coalesce(r, '')) <> ''
  ),
  prods as (
    select p.id, p.brand_id, upper(p.sku) sku, upper(p.model_code) modelo
    from products p
    where p.company_id = p_company_id and p.deleted_at is null
  ),
  marcas as (
    select b.id, upper(b.sku_prefix) prefijo
    from brands b
    where b.company_id = p_company_id and coalesce(b.sku_prefix, '') <> ''
  )
  select r.ref, m.id, p.id, 1
  from prods p
  join marcas m on m.prefijo = split_part(p.sku, '.', 1)
  join refs r on r.ref = substr(p.sku, length(m.prefijo) + 2)
  union all
  select r.ref, p.brand_id, p.id, 2
  from prods p join refs r on r.ref = p.sku
  union all
  select r.ref, p.brand_id, p.id, 3
  from prods p join refs r on r.ref = p.modelo
  where p.brand_id is not null
$$;

create or replace function public.listas_detectar_marca(p_company_id uuid, p_referencias text[])
returns table (brand_id uuid, marca text, prefijo text, coincidencias integer)
language sql
stable
set search_path = public, pg_temp
as $$
  select b.id, b.name, b.sku_prefix, count(distinct c.ref)::int
  from app.cruces_de_referencias(p_company_id, p_referencias) c
  join brands b on b.id = c.brand_id
  group by b.id, b.name, b.sku_prefix
  order by 4 desc
  limit 5
$$;

create or replace function public.listas_preparar_version(
  p_company_id uuid,
  p_brand_id uuid,
  p_fecha date,
  p_moneda text,
  p_ancla text,
  p_archivo text,
  p_nota text default null
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_marca text;
  v_fuente uuid;
  v_version uuid;
begin
  select name into v_marca from brands where id = p_brand_id and company_id = p_company_id;
  if v_marca is null then
    raise exception 'LISTA_MARCA_INVALIDA' using detail = 'La marca no es de esta empresa.';
  end if;

  select id into v_fuente from price_list_sources
  where company_id = p_company_id and (brand_id = p_brand_id or name = v_marca)
  order by (brand_id = p_brand_id) desc
  limit 1;

  if v_fuente is null then
    insert into price_list_sources (company_id, name, brand_id, kind)
    values (p_company_id, v_marca, p_brand_id, 'marca')
    returning id into v_fuente;
  end if;

  insert into price_list_versions (company_id, source_id, issued_on, currency, anchor_column, factors,
                                   origin, file_name, notes, loaded_by)
  values (p_company_id, v_fuente, p_fecha, upper(p_moneda), p_ancla, '{}'::jsonb,
          'manual', p_archivo, p_nota, auth.uid())
  on conflict (source_id, issued_on, anchor_column) do update
    set currency = excluded.currency, file_name = excluded.file_name, notes = excluded.notes,
        origin = 'manual', loaded_at = now(), loaded_by = auth.uid()
  returning id into v_version;

  delete from price_list_items where version_id = v_version;
  return v_version;
end $$;

create or replace function public.listas_cerrar_version(p_version_id uuid)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v record;
  v_anterior uuid;
  v_res jsonb;
begin
  select pv.id, pv.company_id, pv.source_id, pv.issued_on, s.brand_id, b.sku_prefix
    into v
  from price_list_versions pv
  join price_list_sources s on s.id = pv.source_id
  left join brands b on b.id = s.brand_id
  where pv.id = p_version_id;
  if v.id is null then
    raise exception 'LISTA_VERSION_INEXISTENTE';
  end if;

  -- Cada renglón con su producto: sólo cruces de ESTA marca (o un SKU idéntico
  -- a la referencia), y entre varios, el de mayor prioridad. Se prueba con la
  -- referencia y, si no cruza, con el modelo (`prices.modelo`): Chicago
  -- Pneumatic manda el número de parte como referencia (8941088542) y el
  -- catálogo tiene el modelo (CP8854-2).
  with cand as (
    select distinct on (c.ref) c.ref, c.product_id
    from app.cruces_de_referencias(
           v.company_id,
           array(select reference from price_list_items where version_id = v.id
                 union
                 select prices->>'modelo' from price_list_items
                 where version_id = v.id and prices ? 'modelo')) c
    where c.brand_id is not distinct from v.brand_id or c.prioridad = 2
    order by c.ref, c.prioridad, (c.brand_id is not distinct from v.brand_id) desc
  )
  update price_list_items i
  set product_id = coalesce(r.product_id, mo.product_id)
  from price_list_items i2
  left join cand r on r.ref = upper(btrim(i2.reference))
  left join cand mo on mo.ref = upper(btrim(i2.prices->>'modelo'))
  where i.id = i2.id and i2.version_id = v.id
    and coalesce(r.product_id, mo.product_id) is not null;

  select id into v_anterior from price_list_versions
  where source_id = v.source_id and issued_on < v.issued_on
  order by issued_on desc limit 1;

  select jsonb_build_object(
    'renglones', count(*),
    'cruzan', count(*) filter (where i.product_id is not null),
    'conAnterior', count(a.id),
    'suben', count(*) filter (where a.anchor is not null and i.anchor > a.anchor),
    'bajan', count(*) filter (where a.anchor is not null and i.anchor < a.anchor),
    'iguales', count(*) filter (where a.anchor is not null and i.anchor = a.anchor),
    'nuevas', count(*) filter (where v_anterior is not null and a.id is null),
    'medianaPct', percentile_cont(0.5) within group (order by
        case when a.anchor > 0 and i.anchor is not null then (i.anchor / a.anchor - 1) * 100 end)
  )
  into v_res
  from price_list_items i
  left join price_list_items a on a.version_id = v_anterior and upper(a.reference) = upper(i.reference)
  where i.version_id = v.id;

  return v_res || jsonb_build_object('versionId', v.id, 'versionAnterior', v_anterior);
end $$;

grant execute on function app.cruces_de_referencias(uuid, text[]) to authenticated;
grant execute on function public.listas_detectar_marca(uuid, text[]) to authenticated;
grant execute on function public.listas_preparar_version(uuid, uuid, date, text, text, text, text) to authenticated;
grant execute on function public.listas_cerrar_version(uuid) to authenticated;
