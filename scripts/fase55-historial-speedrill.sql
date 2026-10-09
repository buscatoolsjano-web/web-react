-- Fase 55 · Historial de costos de SPEEDRILL, y un costo viejo no fija precio.
--
-- Aplicado en la migracion `fase55_un_costo_viejo_no_fija_precio`. Se deja el
-- SQL aca para que quede junto al resto del historial de precios.
--
-- POR QUE. SPEEDRILL tenia UNA version cargada —el Excel de 2026— mientras
-- Ingersoll tenia nueve. La diferencia era que de Ingersoll se cargo una
-- factura por fecha y de SPEEDRILL solo la lista actual. Se cargaron las 7
-- facturas del Drive, agrupadas en 4 fechas.
--
-- Y AL CARGARLAS APARECIO EL PROBLEMA: 13 productos empezaron a tomar su PVP de
-- una factura de 2023 o 2024, porque estan en una factura vieja y NO en la
-- lista actual, asi que ese era el unico costo disponible. El resultado:
--
--   SPLMTA30    STEL 36.379,53  ->  PVP 6.510,00   (-82 %)
--   2005.5VPCM  STEL    146,79  ->  PVP    19,32   (-87 %)
--   VPTX20/300  STEL    155,94  ->  PVP    28,35   (-82 %)
--
-- Un costo de 2023 por 3 no es un precio de 2026. La vista tomaba el costo MAS
-- RECIENTE de cada producto —correcto— pero no miraba que tan viejo era ese
-- "mas reciente".
--
-- `max_age_days` lo cierra: pasado el plazo el costo sigue visible como
-- historia, que es para lo que se cargo, pero deja de fijar precio.
--
-- EFECTO COLATERAL QUE HAY QUE SABER: CHICAGO PNEUMATIC paso de 62 productos
-- con PVP a 0, porque su lista es de enero de 2024. Es la misma regla con el
-- mismo criterio, y es el estado conservador: esos productos vuelven al precio
-- de STEL. Si se decide que esa lista igual sirve, se le sube el plazo:
--
--   update public.price_formulas f set max_age_days = 1095
--   from public.price_list_sources s
--   where s.id = f.source_id and s.name = 'CHICAGO PNEUMATIC';
--
-- Es la tercera vez en esta serie que el mismo error aparece con otra cara: un
-- numero no significa nada sin saber SOBRE QUE se multiplica (Fase 51, el
-- `anchor` que era el PVP y no el costo), PARA QUE MARCA (Fase 53, el x11,4 de
-- Ingersoll) y DE CUANDO ES (esta).

alter table public.price_formulas
  add column if not exists max_age_days integer not null default 365
  check (max_age_days > 0);

comment on column public.price_formulas.max_age_days is
  'Un costo mas viejo que esto queda como historia y NO fija precio. Un costo de hace dos anos por el multiplo no es un precio de hoy.';

-- La vista agrega `and b.fecha_costo >= current_date - max_age_days`.
-- Cuerpo completo en la migracion `fase55_un_costo_viejo_no_fija_precio`.
