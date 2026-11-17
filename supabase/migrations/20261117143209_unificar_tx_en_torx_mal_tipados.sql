-- Puntas Torx con el tipo mal cargado (Allen, Punta o sin tipo): «TX25» → «T25»,
-- igual que el resto. La Torx Plus VPTP10/170 queda afuera: está en la lista de
-- revisión manual. Respaldo en app.respaldo_medidas_limpieza.
insert into app.respaldo_medidas_limpieza (id, company_id, attributes, description)
select id, company_id, attributes, description from public.products
where deleted_at is null and attributes->>'medida' ~* '^TX0*[0-9]{1,2}$'
  and coalesce(product_type, '') <> 'Torx Plus'
on conflict (id) do nothing;

update public.products
set attributes = jsonb_set(attributes, '{medida}',
      to_jsonb('T' || ltrim(substring(attributes->>'medida' from '[0-9]+'), '0')))
where deleted_at is null and attributes->>'medida' ~* '^TX0*[0-9]{1,2}$'
  and coalesce(product_type, '') <> 'Torx Plus';

update public.products p
set description = app.descripcion_concatenada(p)
where p.deleted_at is null and p.description like 'Nombre: %' and p.attributes->>'medida' ~ '^T[0-9]'
  and p.description ~ 'Medida: TX';
