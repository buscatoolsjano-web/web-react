-- Listas de precios: costo y precio de venta, cada columna con su moneda, y
-- la planilla ordenada por lo que importa.
--
-- «Quiero tener más de 1 dato: el costo de compra y el precio de venta, y
-- después tener bien las monedas.» Hasta ahora una versión tenía UNA moneda y
-- UN precio (el ancla); las demás columnas se guardaban en `prices` sin saber
-- qué eran ni en qué moneda estaban. Ahora la versión dice qué columna es el
-- costo, cuál la venta, y la moneda de cada una.
--
-- «Priorizar los que más vendemos y los que tienen foto, y los que NO están en
-- el catálogo, últimos.» La planilla pasa a una función que ordena así, en
-- vez de por referencia.

alter table public.price_list_versions
  add column if not exists columns jsonb,
  add column if not exists cost_column text,
  add column if not exists sale_column text;

comment on column public.price_list_versions.columns is
  'Las columnas de precio del archivo: [{clave, encabezado, moneda}]. La clave es la de price_list_items.prices.';
comment on column public.price_list_versions.cost_column is
  'Qué clave de prices es el costo de compra (null: la lista no lo trae).';
comment on column public.price_list_versions.sale_column is
  'Qué clave de prices es el precio de venta (null: la lista no lo trae).';

create or replace function public.listas_planilla(
  p_company_id uuid,
  p_source_id uuid,
  p_texto text default '',
  p_desde int default 0,
  p_cuantos int default 25
)
returns table (
  reference text,
  description text,
  product_id uuid,
  precios jsonb,
  costo numeric,
  moneda_costo text,
  venta numeric,
  moneda_venta text,
  vendidos numeric,
  tiene_foto boolean,
  total bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with items as (
    select
      i.reference,
      i.description,
      i.product_id,
      i.anchor,
      i.prices,
      v.issued_on,
      v.cost_column,
      v.sale_column,
      v.columns,
      v.currency
    from price_list_items i
    join price_list_versions v on v.id = i.version_id
    where v.company_id = p_company_id
      and v.source_id = p_source_id
  ),
  por_ref as (
    select
      it.reference,
      (array_agg(it.description order by it.issued_on desc))[1] as description,
      (array_agg(it.product_id order by it.issued_on desc))[1] as product_id,
      jsonb_object_agg(it.issued_on::text, it.anchor) as precios,
      (array_agg(it.prices order by it.issued_on desc))[1] as prices,
      (array_agg(it.cost_column order by it.issued_on desc))[1] as cost_column,
      (array_agg(it.sale_column order by it.issued_on desc))[1] as sale_column,
      (array_agg(it.columns order by it.issued_on desc))[1] as columns,
      (array_agg(it.currency order by it.issued_on desc))[1] as currency
    from items it
    group by it.reference
  ),
  filtradas as (
    select r.*
    from por_ref r
    where coalesce(p_texto, '') = ''
       or r.reference ilike '%' || p_texto || '%'
       or r.description ilike '%' || p_texto || '%'
  ),
  ventas as (
    select l.product_id, sum(coalesce(l.quantity_ordered, 0)) as vendidos
    from sales_order_lines l
    join sales_orders o on o.id = l.order_id
    where o.company_id = p_company_id
      and l.product_id in (select f.product_id from filtradas f where f.product_id is not null)
    group by l.product_id
  ),
  fotos as (
    select distinct pi.product_id
    from product_images pi
    where pi.product_id in (select f.product_id from filtradas f where f.product_id is not null)
  )
  select
    f.reference,
    f.description,
    f.product_id,
    f.precios,
    -- Una celda «a consultar» no es un número: queda null.
    case when (f.prices ->> f.cost_column) ~ '^\s*-?\d+(\.\d+)?\s*$'
         then (f.prices ->> f.cost_column)::numeric end as costo,
    (select c ->> 'moneda' from jsonb_array_elements(coalesce(f.columns, '[]')) c
      where c ->> 'clave' = f.cost_column limit 1) as moneda_costo,
    case when (f.prices ->> f.sale_column) ~ '^\s*-?\d+(\.\d+)?\s*$'
         then (f.prices ->> f.sale_column)::numeric end as venta,
    (select c ->> 'moneda' from jsonb_array_elements(coalesce(f.columns, '[]')) c
      where c ->> 'clave' = f.sale_column limit 1) as moneda_venta,
    coalesce(vt.vendidos, 0) as vendidos,
    (fo.product_id is not null) as tiene_foto,
    count(*) over () as total
  from filtradas f
  left join ventas vt on vt.product_id = f.product_id
  left join fotos fo on fo.product_id = f.product_id
  order by
    (f.product_id is null),          -- los que no están en el catálogo, últimos
    coalesce(vt.vendidos, 0) desc,   -- los más vendidos primero
    (fo.product_id is null),         -- con foto antes que sin foto
    f.reference
  offset greatest(p_desde, 0)
  limit least(greatest(p_cuantos, 1), 500)
$$;

grant execute on function public.listas_planilla(uuid, uuid, text, int, int) to authenticated;

-- Las listas ya cargadas: qué columna es cada cosa, deducido de sus claves.
-- La moneda sale del sufijo de la clave (costo_usd → USD) y si no lo tiene,
-- de la versión. Costo: costo/neto. Venta: venta/pvp/lista, y entre varias, la
-- de Argentina primero y la de la moneda de la versión después.
with claves as (
  select v.id as version_id, v.currency, k as clave
  from price_list_versions v
  cross join lateral (
    select distinct jsonb_object_keys(i.prices) as k
    from price_list_items i where i.version_id = v.id
  ) ks
  where v.columns is null
    and k ~ '^(costo|cost|neto|net|lista|list|pvp|venta|precio|importe)'
    and k !~ '(renglon|descuento|cantidad)'
),
con_moneda as (
  select c.*,
         coalesce(upper(substring(c.clave from '_(usd|eur|ars|gbp)$')), c.currency) as moneda
  from claves c
),
por_version as (
  select
    version_id,
    jsonb_agg(jsonb_build_object('clave', clave, 'encabezado', clave, 'moneda', moneda) order by clave) as columns,
    (array_agg(clave order by (moneda = currency) desc, clave)
       filter (where clave ~ '^(costo|cost|neto|net)'))[1] as cost_column,
    (array_agg(clave order by (clave ~ '_arg') desc, (moneda = currency) desc, clave)
       filter (where clave ~ '^(venta|pvp|lista|list)'))[1] as sale_column
  from con_moneda
  group by version_id
)
update price_list_versions v
set columns = p.columns, cost_column = p.cost_column, sale_column = p.sale_column
from por_version p
where p.version_id = v.id;
