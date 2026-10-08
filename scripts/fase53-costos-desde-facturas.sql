-- Fase 53 · Costos desde facturas de compra, y registrar un costo no es
-- decidir un precio.
--
-- Aplicado en dos migraciones: `fase53_origen_factura` y
-- `fase53_formula_puede_no_fijar_precio`. Se deja el SQL acá para que quede
-- junto al resto del historial de precios.
--
-- 1 · `origin` admite 'factura'. Hasta ahora decia de donde salio el archivo
--     ('drive', 'mail', 'manual') y faltaba QUE ES: una lista cubre el
--     catalogo del fabricante, una factura cubre solo lo que se compro y su
--     costo es el realmente pagado. Ingersoll Rand no publica lista —se
--     busco en el Drive y en el Gmail—, asi que es su unica fuente.
--
-- 2 · `price_formulas.applies_to_price`. Se cargaron los costos de Ingersoll y
--     el x3 daba el 26 % del precio que STEL tiene hoy: el multiplo real de esa
--     marca es ~11,4. Sin esta columna, cargar el costo bajaba el precio de
--     venta de 17 productos un 74 % sin que nadie lo hubiera decidido para esa
--     marca. Es la misma leccion de la Fase 51 con el `anchor`: un multiplo no
--     significa nada sin saber sobre que se multiplica. El x3 se eligio sobre
--     el precio de venta en Espana de SPEEDRILL; sobre un costo de factura
--     —neto, con el 47 % de descuento de distribuidor ya aplicado— es otra
--     cosa.

alter table public.price_list_versions
  drop constraint if exists price_list_versions_origin_check;
alter table public.price_list_versions
  add constraint price_list_versions_origin_check
  check (origin = any (array['drive'::text, 'mail'::text, 'manual'::text, 'factura'::text]));

alter table public.price_formulas
  add column if not exists applies_to_price boolean not null default true;

comment on column public.price_formulas.applies_to_price is
  'false = registrar el costo pero NO reemplazar el precio de venta. Para marcas cuyo multiplo todavia no se decidio.';

update public.price_formulas f
set applies_to_price = false,
    notes = 'Costo real pagado (neto unitario de la factura). NO fija precio: el x3 daba el 26 % del precio actual de STEL, que usa ~x11,4 para esta marca. Falta decidir el multiplo.',
    updated_at = now()
from public.price_list_sources s
where s.id = f.source_id
  and f.company_id = (select id from companies where slug = 'buscatools')
  and s.name = 'INGERSOLL RAND';

-- La vista sólo calcula PVP donde la fórmula fija precio. (Cuerpo completo en
-- la migración `fase53_formula_puede_no_fijar_precio`.)
