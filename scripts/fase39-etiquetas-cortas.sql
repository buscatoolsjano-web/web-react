-- Fase 39 · Etiquetas de atributos más cortas
--
-- POR QUÉ
--
-- Las etiquetas son los títulos de las columnas dinámicas del catálogo, y con
-- `table-layout: fixed` cada columna mide ~72–96 px. Un título de 19 caracteres
-- ocupa tres o cuatro renglones, y el alto del encabezado es alto que no ven
-- los productos: con 21.752 productos, cada renglón que se ahorra arriba es una
-- fila más de catálogo en pantalla.
--
-- QUÉ SE CAMBIA Y QUÉ NO
--
-- Sólo las etiquetas FILTRABLES largas: son las únicas que llegan a ser una
-- columna de la tabla. Las 13 no filtrables («Página de catálogo», «Categoría
-- completa», «Marca (display)»…) sólo se ven en la ficha del producto, donde el
-- ancho sobra: acortarlas no ganaría nada y perdería claridad.
--
-- Tampoco se tocan las que ya entran en un renglón o dos: Encastre, Medida,
-- Largo, Voltaje, Eslinga, Ergonomía y Revoluciones.
--
-- Son ABREVIATURAS, no cambios de terminología. «Capacidad» no pasa a «Carga»
-- ni «Revoluciones» a «Velocidad»: eso sería discutir el vocabulario del rubro
-- de prestado, y no es lo que hay que resolver acá.
--
-- La unidad NO va en la etiqueta: vive en `unit` y la interfaz la agrega. Por
-- eso «Cap. máx.» se lee «Cap. máx. (kg)» en pantalla.
--
-- DÓNDE MÁS VIVEN ESTAS ETIQUETAS
--
-- Están duplicadas a mano en `src/modules/catalogo/lib/exportar.ts` (columnas
-- del export) y en `src/modules/catalogo/lib/familias.ts` (filas del
-- comparador). Si se cambia acá y no allá, el mismo atributo se llama distinto
-- según la pantalla. Van en el mismo commit.
--
-- PARA VOLVER ATRÁS
--
-- El UPDATE de abajo lleva las etiquetas viejas en la misma tabla: invertir las
-- dos columnas de `cambios` y correrlo de nuevo deshace todo.

begin;

with cambios(clave, antes, despues) as (
  values
    ('carcasa',  'Material de carcasa', 'Carcasa'),
    ('longitud', 'Longitud de cable',   'Long. cable'),
    ('min_kg',   'Capacidad mínima',    'Cap. mín.'),
    ('max_kg',   'Capacidad máxima',    'Cap. máx.'),
    ('torq_min', 'Torque mínimo',       'Torque mín.'),
    ('torq_max', 'Torque máximo',       'Torque máx.')
)
update product_attribute_definitions d
   set label = c.despues
  from cambios c
 where d.key = c.clave
   -- Sólo si todavía dice lo que esperamos. Si alguien ya la editó a mano, esta
   -- fila no se toca y el control de abajo lo hace notar.
   and d.label = c.antes;

-- Control: las seis tienen que haber quedado cortas y filtrables.
do $$
declare
  n int;
begin
  select count(*) into n
    from product_attribute_definitions
   where key in ('carcasa','longitud','min_kg','max_kg','torq_min','torq_max')
     and label in ('Carcasa','Long. cable','Cap. mín.','Cap. máx.','Torque mín.','Torque máx.');
  if n <> 6 then
    raise exception 'Se esperaban 6 etiquetas acortadas y hay %', n;
  end if;
end
$$;

commit;
