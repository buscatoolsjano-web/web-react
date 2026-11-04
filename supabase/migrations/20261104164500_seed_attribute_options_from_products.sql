with valores as (
  select
    d.company_id,
    d.id as definition_id,
    trim(e.value) as value,
    row_number() over (partition by d.id order by trim(e.value)) as rn
  from public.product_attribute_definitions d
  join public.products p on p.company_id = d.company_id
  cross join lateral jsonb_each_text(coalesce(p.attributes, '{}'::jsonb)) e
  where e.key = d.key
    and trim(e.value) <> ''
    and not exists (
      select 1 from public.product_attribute_options o
      where o.definition_id = d.id
    )
)
insert into public.product_attribute_options(company_id, definition_id, value, position)
select company_id, definition_id, value, rn::integer
from valores
where rn <= 100
on conflict (definition_id, value) do nothing;
