-- Fase 50 · La planilla, adentro
--
-- APLICADA el 2026-10-08 (`fase50_matriz_de_precios`).
--
-- La Fase 49 dejó la pantalla mostrando el ARCHIVO: un enlace al Excel del
-- Drive. No servía. Lo que hace falta es leer la planilla SIN SALIR del ERP,
-- con una fila por referencia y UNA COLUMNA POR FECHA, como la hoja que se
-- lleva a mano.
--
-- Pivotear con columnas dinámicas no se puede en SQL plano, así que cada fila
-- trae sus precios en un jsonb {fecha: precio}. La pantalla ya tiene la lista
-- de fechas por separado y arma las columnas con ésa, buscando cada precio por
-- clave. NO depende del orden del jsonb: Postgres lo normaliza por largo y
-- bytes, y confiar en ese orden ya costó una vez (Fase 43).
--
-- Una referencia aparece aunque esté en una sola de las listas: el jsonb
-- simplemente no tiene esa fecha y la celda queda vacía. Eso ES el dato —el
-- producto entró, o dejó de estar— y un INNER JOIN lo perdería.
create or replace view public.price_list_matrix
with (security_invoker = true) as
select
  i.company_id,
  v.source_id,
  i.reference,
  -- La descripción de la lista MÁS NUEVA en la que aparece: es la vigente.
  (array_agg(i.description order by v.issued_on desc))[1]        as description,
  (array_agg(i.product_id order by v.issued_on desc))[1]         as product_id,
  jsonb_object_agg(v.issued_on::text, i.anchor)                  as precios,
  count(*)                                                       as en_listas,
  max(v.issued_on)                                               as ultima,
  min(v.issued_on)                                               as primera
from public.price_list_items i
join public.price_list_versions v on v.id = i.version_id
group by i.company_id, v.source_id, i.reference;

comment on view public.price_list_matrix is
  'Fase 50: una fila por referencia y sus precios por fecha, para mostrar la planilla adentro del ERP. Los precios van en un jsonb {fecha: precio} porque SQL no pivota columnas dinamicas; la pantalla arma las columnas con la lista de fechas y NO con el orden del jsonb, que Postgres normaliza.';

-- `security_invoker` para que respete RLS: sin eso la vista correría con los
-- permisos de quien la creó y un rol externo vería costos.
