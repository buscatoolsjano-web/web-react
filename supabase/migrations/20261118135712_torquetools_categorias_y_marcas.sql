-- Torquetools: la misma limpieza que Buscatools (18-11-2026).
--
-- El catálogo de Torquetools es un clon del de Buscatools (mismo SKU). Los
-- 21.644 que cruzan heredan la categoría, el tipo y la marca ya corregidos;
-- los propios de Torquetools (la categoría «Herramientas», 6.269 productos)
-- pasan por las mismas reglas por marca. Lo aplica
-- scripts/aplicar-categorias-torquetools.mjs con la propuesta de
-- scripts/torquetools-categorias.mjs. Todo acotado a Torquetools.
--
-- Para deshacer:
--   update products p set category_id = r.category_id, product_type = r.product_type, brand_id = r.brand_id
--   from app.respaldo_torquetools_20261118 r where r.product_id = p.id;

create table if not exists app.respaldo_torquetools_20261118 as
select p.id as product_id, p.category_id, p.product_type, p.brand_id, now() as respaldado
from public.products p
join public.companies c on c.id = p.company_id
where c.name = 'Torquetools';

insert into public.product_categories (company_id, name, slug, slug_publico, publica, is_active, needs_review, position)
-- slug_publico es único en toda la base y Torquetools no tiene catálogo público: va nulo, como sus otras categorías.
select c.id, v.name, v.slug, null, true, true, false, v.position
from public.companies c
cross join (values
  ('Amoladoras y lijadoras', 'amoladora', 'amoladoras-y-lijadoras', 8),
  ('Taladros y roscadoras', 'taladro', 'taladros-y-roscadoras', 9),
  ('Sierras y corte', 'sierra', 'sierras-y-corte', 10),
  ('Elevación de cargas', 'elevacion', 'elevacion-de-cargas', 11),
  ('Mechas y brocas', 'mechas', 'mechas-y-brocas', 12)
) as v(name, slug, slug_publico, position)
where c.name = 'Torquetools'
  and not exists (select 1 from public.product_categories pc where pc.company_id = c.id and pc.slug = v.slug);

insert into public.brands (company_id, name)
select c.id, v.name
from public.companies c
cross join (values ('AIMCO'),('Avdel'),('Bosch'),('Brady'),('Brikol'),('Cleco'),('Corghi'),('Crossmaster'),('Danfoss'),('DeWalt'),('Demag'),('Destaco'),('Doble A'),('Dormer'),('Dremel'),('ESAB'),('Einhell'),('Ezeta'),('Fluke'),('Gesipa'),('Hamilton'),('Harden'),('Hellermann Tyton'),('Hyundai'),('IFM'),('INGUN'),('Ingco'),('Irimo'),('Knipex'),('Kushiro'),('Kärcher'),('Ledvance'),('Libus'),('Logiform'),('Lumenac'),('Lusqtoff'),('Mitsubishi'),('Mountz'),('Neumacon'),('POP'),('Pro''sKit'),('Riello'),('Roamat'),('Ruhlmann'),('SKF'),('Shinano'),('Stanley'),('Starrett'),('Tacsa'),('Thiele'),('Truper'),('Tyrolit'),('Uranga'),('WAGO'),('Wembley'),('Wilkox'),('Yale')) as v(name)
where c.name = 'Torquetools'
  and not exists (select 1 from public.brands b where b.company_id = c.id and lower(b.name) = lower(v.name));
