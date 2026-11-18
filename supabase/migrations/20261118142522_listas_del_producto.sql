-- El costo y la venta de las listas, en la ficha del producto (18-11-2026).
--
-- «Costo y precio en la ficha del producto, con aviso cuando el precio de
-- venta quedó por debajo de la última lista.» Para un producto, por cada
-- fuente de lista que lo trae: la última versión (fecha, costo, venta y la
-- moneda de cada uno) y la anterior, para decir si la lista subió.
--
-- SECURITY INVOKER: la RLS de price_list_* decide quién lo ve (los roles
-- internos). Un externo recibe cero filas y la ficha no muestra nada.

create or replace function public.listas_del_producto(p_company_id uuid, p_product_id uuid)
returns table (
  source_id uuid,
  fuente text,
  fecha date,
  costo numeric,
  moneda_costo text,
  venta numeric,
  moneda_venta text,
  ancla numeric,
  moneda text,
  fecha_anterior date,
  venta_anterior numeric,
  ancla_anterior numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with it as (
    select
      v.source_id,
      s.name as fuente,
      v.issued_on,
      v.currency,
      v.cost_column,
      v.sale_column,
      v.columns,
      i.anchor,
      i.prices,
      row_number() over (partition by v.source_id order by v.issued_on desc) as rn
    from price_list_items i
    join price_list_versions v on v.id = i.version_id
    join price_list_sources s on s.id = v.source_id
    where i.company_id = p_company_id
      and i.product_id = p_product_id
  ),
  num as (
    select it.*,
      case when (it.prices ->> it.cost_column) ~ '^\s*-?\d+(\.\d+)?\s*$'
           then (it.prices ->> it.cost_column)::numeric end as costo,
      case when (it.prices ->> it.sale_column) ~ '^\s*-?\d+(\.\d+)?\s*$'
           then (it.prices ->> it.sale_column)::numeric end as venta,
      (select c ->> 'moneda' from jsonb_array_elements(coalesce(it.columns, '[]')) c
        where c ->> 'clave' = it.cost_column limit 1) as moneda_costo,
      (select c ->> 'moneda' from jsonb_array_elements(coalesce(it.columns, '[]')) c
        where c ->> 'clave' = it.sale_column limit 1) as moneda_venta
    from it
    where it.rn <= 2
  )
  select
    a.source_id, a.fuente, a.issued_on, a.costo, coalesce(a.moneda_costo, a.currency),
    a.venta, coalesce(a.moneda_venta, a.currency), a.anchor, a.currency,
    b.issued_on, b.venta, b.anchor
  from num a
  left join num b on b.source_id = a.source_id and b.rn = 2
  where a.rn = 1
  order by a.issued_on desc
$$;

grant execute on function public.listas_del_producto(uuid, uuid) to authenticated;
