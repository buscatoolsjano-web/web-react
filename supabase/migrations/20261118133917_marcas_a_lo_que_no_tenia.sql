-- Marca a lo que no tenía (18-11-2026).
--
-- «Agregarle marca a lo que no tiene. Si se sabe cuál es, se la agregás bien;
-- si no, Genérico.» 2.502 productos de Buscatools no tenían marca y por eso
-- no salían en el catálogo público (la marca es obligatoria ahí). La marca se
-- detecta con scripts/marcas-sin-marca.mjs y la aplica
-- scripts/aplicar-marcas.mjs; acá va el respaldo y las marcas nuevas: las
-- reales con dos o más productos, o marcas de herramienta conocidas. Las
-- sueltas van a Genérico con su nombre en marca_disp.
--
-- Para deshacer:
--   update products p set brand_id = null, attributes = r.attributes
--   from app.respaldo_marcas_20261118 r where r.product_id = p.id;

create table if not exists app.respaldo_marcas_20261118 as
select p.id as product_id, p.brand_id, p.attributes, now() as respaldado
from public.products p
join public.companies c on c.id = p.company_id
where c.name = 'Buscatools' and p.brand_id is null;

insert into public.brands (company_id, name)
select c.id, v.name
from public.companies c
cross join (values
  ('AIMCO'),
  ('Atlas Copco'),
  ('Avdel'),
  ('Bosch'),
  ('Brady'),
  ('Brikol'),
  ('Cleco'),
  ('Corghi'),
  ('Crane'),
  ('Crossmaster'),
  ('Danfoss'),
  ('DeWalt'),
  ('Demag'),
  ('Destaco'),
  ('Doble A'),
  ('Dormer'),
  ('Dremel'),
  ('ESAB'),
  ('Einhell'),
  ('Endo'),
  ('Euro-Torq'),
  ('Ezeta'),
  ('Felo'),
  ('Fluke'),
  ('Gesipa'),
  ('Hamilton'),
  ('Harden'),
  ('Hellermann Tyton'),
  ('Hyundai'),
  ('IFM'),
  ('INGUN'),
  ('Ingco'),
  ('Interroll'),
  ('Irimo'),
  ('Kito'),
  ('Klauke'),
  ('Knipex'),
  ('Kushiro'),
  ('Kärcher'),
  ('Ledvance'),
  ('Libus'),
  ('Logiform'),
  ('Lumenac'),
  ('Lusqtoff'),
  ('Makita'),
  ('Mitsubishi'),
  ('Mountz'),
  ('Neumacon'),
  ('Norbar'),
  ('POP'),
  ('Panasonic'),
  ('Parker'),
  ('Pro''sKit'),
  ('ReeR'),
  ('Riello'),
  ('Roamat'),
  ('Ruhlmann'),
  ('SKF'),
  ('Shinano'),
  ('Sick'),
  ('Stanley'),
  ('Starrett'),
  ('Sturtevant Richmont'),
  ('Tacsa'),
  ('Thiele'),
  ('Truper'),
  ('Tyrolit'),
  ('Uranga'),
  ('Vessel'),
  ('WAGO'),
  ('Wembley'),
  ('Wilkox'),
  ('Yale'),
  ('Zephyr Tools')
) as v(name)
where c.name = 'Buscatools'
  and not exists (select 1 from public.brands b where b.company_id = c.id and lower(b.name) = lower(v.name));
