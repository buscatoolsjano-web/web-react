-- Página pública para lo que se reclasificó y recibió marca (18-11-2026).
--
-- «Sí, generalas.» Un producto se ve en la web si tiene public_slug, marca y
-- categoría pública. Los que estaban en «Otros» o sin marca nunca tuvieron
-- slug porque no se podían mostrar. Ahora que tienen categoría y marca, se
-- les genera, con la misma función que usa el alta (app.slug_de_producto).
--
-- Se publican SÓLO esos: los que antes de esta limpieza estaban en «Otros» o
-- «Pendiente» (app.respaldo_categorias_20261117) o no tenían marca
-- (app.respaldo_marcas_20261118). Los demás sin slug pueden estar ocultos a
-- propósito desde Web › Visibilidad y no se tocan.
--
-- Para deshacer:
--   update products set public_slug = null
--   where id in (select product_id from app.publicados_20261118);

create table if not exists app.publicados_20261118 (
  product_id uuid primary key,
  public_slug text not null,
  publicado timestamptz not null default now()
);

do $$
declare
  r record;
  v_slug text;
begin
  for r in
    select p.id, p.company_id, p.name, p.sku
      from public.products p
      join public.product_categories pc on pc.id = p.category_id and pc.publica
      join public.brands b on b.id = p.brand_id
      left join app.respaldo_categorias_20261117 rc on rc.product_id = p.id
      left join public.product_categories oc on oc.id = rc.category_id
      left join app.respaldo_marcas_20261118 rm on rm.product_id = p.id
     where p.company_id = (select id from public.companies where name = 'Buscatools')
       and p.public_slug is null
       and p.deleted_at is null
       and p.status = 'active'
       and (oc.slug in ('otros', 'pendiente-clasificacion-stel') or rm.product_id is not null)
     order by p.sku
  loop
    -- De a uno: así cada slug ve los anteriores y no se repiten.
    v_slug := app.slug_de_producto(r.company_id, r.name, r.sku);
    update public.products set public_slug = v_slug where id = r.id;
    insert into app.publicados_20261118 (product_id, public_slug) values (r.id, v_slug);
  end loop;
end $$;
