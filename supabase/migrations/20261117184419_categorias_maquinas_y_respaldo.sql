-- Reclasificación del catálogo de Buscatools (17-11-2026).
--
-- «Necesito que analices todos los productos si están correctamente en su
-- categoría, priorizando Speedrill, Tecna, Fein, Fiam.» La revisión encontró
-- torquímetros TOHNICHI en Repuestos, 519 atornilladores Ingersoll Rand en
-- Otros, puntas SPEEDRILL en Otros, máquinas FEIN en Accesorios… La
-- reclasificación en sí la aplica scripts/clasificar-categorias.mjs (dos mil
-- productos, por id); acá va lo estructural:
--
--   1. Un respaldo de la categoría y el tipo de CADA producto de Buscatools
--      antes de tocar nada. Para deshacer:
--        update products p set category_id = r.category_id, product_type = r.product_type
--        from app.respaldo_categorias_20261117 r where r.product_id = p.id;
--   2. Cuatro categorías para las máquinas que no tenían dónde ir (amoladoras,
--      taladros, sierras, polipastos): estaban en Otros o en Accesorios.

create table if not exists app.respaldo_categorias_20261117 as
select p.id as product_id, p.company_id, p.category_id, p.product_type, now() as respaldado
from public.products p
join public.companies c on c.id = p.company_id
where c.name = 'Buscatools';

insert into public.product_categories (company_id, name, slug, slug_publico, publica, is_active, needs_review, position)
select c.id, v.name, v.slug, v.slug_publico, true, true, false, v.position
from public.companies c
cross join (values
  ('Amoladoras y lijadoras', 'amoladora', 'amoladoras-y-lijadoras', 8),
  ('Taladros y roscadoras', 'taladro', 'taladros-y-roscadoras', 9),
  ('Sierras y corte', 'sierra', 'sierras-y-corte', 10),
  ('Elevación de cargas', 'elevacion', 'elevacion-de-cargas', 11)
) as v(name, slug, slug_publico, position)
where c.name = 'Buscatools'
  and not exists (
    select 1 from public.product_categories pc where pc.company_id = c.id and pc.slug = v.slug
  );
