-- Fase 57 · Dos atributos que son los extremos de UN rango.
--
-- Aplicado en la migracion `fase57_pares_de_atributos_que_son_un_rango`.
--
-- EL PROBLEMA. En Atornilladores la barra de filtros mostraba cuatro controles:
--
--   «Torque min. desde» · «Torque min. hasta» · «Torque max. desde» · «Torque max. hasta»
--
-- Son dos atributos numericos, cada uno con su par desde/hasta. Leido parece
-- repetido y, peor, no sirve para la pregunta que uno hace: quien busca un
-- atornillador «de 10 Nm» quiere los que PUEDEN dar 10, o sea los que tienen
-- torq_min <= 10 <= torq_max. Con cuatro controles hay que razonar al reves
-- —poner 10 en «Torque min. hasta» y 10 en «Torque max. desde»— y nadie lo hace.
--
-- LA SOLUCION es un solo rango que devuelve los productos cuyo intervalo SE
-- SOLAPA con el pedido:
--
--     torq_min <= HASTA    y    torq_max >= DESDE
--
-- Eso se expresa con el contrato que ya existe, asi que `search_products` no se
-- toca y las URLs con filtros siguen andando: el filtro se sigue guardando en
-- las dos claves REALES, no en una clave inventada del par.
--
-- POR QUE EN LA BASE Y NO EN EL CODIGO. Hay que saber QUE PARES forman un
-- rango, y las dos convenciones que existen no coinciden: `torq_min/torq_max`
-- usa sufijo y `min_kg/max_kg` usa prefijo. Deducirlo del nombre seria el mismo
-- error que esta serie ya cometio tres veces con los precios —suponer que un
-- numero significa algo sin que nadie lo haya declarado—.
--
-- Tres columnas y ninguna inferencia:
--   · `range_group`  identificador del par ('torque', 'capacidad')
--   · `range_role`   cual extremo es ('min' | 'max')
--   · `range_label`  como se llama el rango junto ('Torque', 'Capacidad')
--
-- Con un check que exige los tres juntos o ninguno, y un unique que impide dos
-- extremos del mismo lado en un grupo —con dos 'min' el apareo elegiria uno al
-- azar—.
--
-- SOLO SE APAREA EN LOS FILTROS. En la tabla, «Torque min.» y «Torque max.»
-- como dos columnas esta bien: son dos datos del producto.

alter table public.product_attribute_definitions
  add column if not exists range_group text,
  add column if not exists range_role  text,
  add column if not exists range_label text;

alter table public.product_attribute_definitions
  drop constraint if exists pad_range_role_check;
alter table public.product_attribute_definitions
  add constraint pad_range_role_check check (range_role is null or range_role in ('min', 'max'));

alter table public.product_attribute_definitions
  drop constraint if exists pad_range_completo_check;
alter table public.product_attribute_definitions
  add constraint pad_range_completo_check check (
    (range_group is null and range_role is null and range_label is null)
    or (range_group is not null and range_role is not null and range_label is not null)
  );

drop index if exists pad_range_group_rol_uq;
create unique index pad_range_group_rol_uq
  on public.product_attribute_definitions (company_id, range_group, range_role)
  where range_group is not null;

update public.product_attribute_definitions set range_group='torque', range_role='min', range_label='Torque' where key='torq_min';
update public.product_attribute_definitions set range_group='torque', range_role='max', range_label='Torque' where key='torq_max';
update public.product_attribute_definitions set range_group='capacidad', range_role='min', range_label='Capacidad' where key='min_kg';
update public.product_attribute_definitions set range_group='capacidad', range_role='max', range_label='Capacidad' where key='max_kg';
