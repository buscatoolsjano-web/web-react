-- Fase 40 · Devolverle a STEL la numeración de SUS series
--
-- POR QUÉ
--
-- Al poner al día el sync de STEL aparecieron 39 documentos que no podían
-- entrar. Todos con el mismo error:
--
--   [23x] serie_emitida_por_el_erp:quote:COTI
--   [10x] serie_emitida_por_el_erp:sales_order:PDV
--   [ 6x] serie_emitida_por_el_erp:delivery:RT
--
-- No era una falla del importador: era el cutover haciendo su trabajo. El ERP
-- había tomado la autoridad de numeración de `quote`, `sales_order`,
-- `delivery` y `sales_invoice`, y la base se niega a insertar documentos
-- numerados por STEL en una serie que emite el ERP. Tiene razón en negarse:
-- dos sistemas numerando la misma serie terminan en dos documentos distintos
-- con el mismo número, que es exactamente lo que ya pasó con PDV01320.
--
-- QUÉ SE MIDIÓ ANTES DE DECIDIR
--
-- Desde el cutover (16/09) el ERP emitió NUEVE documentos, y de esos uno solo
-- es una venta real: la cadena de Ing. Jose Luis Castillo —COTI02556,
-- PDV01319, RT0000001433—. Los otros ocho son pruebas contra el cliente
-- «ZZ SIN USAR · El Gitano», varias todavía en borrador.
--
-- STEL, en cambio, emitió 39 documentos reales en ese mismo período. O sea
-- que el trabajo de verdad siguió pasando por STEL; el ERP se usó para probar.
--
-- POR SERIE Y NO EN GENERAL, QUE ES LA DIFERENCIA IMPORTANTE
--
-- `app.autoridad_efectiva` mira PRIMERO la tabla por serie y recién después
-- la general. Dar vuelta la general le devolvería a STEL también las series
-- propias del ERP —COT-BTS, PDV-ERP, RT-ERP—, que el ERP sí emite y debe
-- seguir emitiendo. Entonces se le devuelven a STEL exactamente las cuatro
-- series que son suyas, y nada más:
--
--   quote       · COTI    (306 documentos)
--   sales_order · PDV     (172)
--   delivery    · RT      (188)
--   delivery    · RT-ML   (5)
--
-- Las del ERP quedan intactas bajo autoridad del ERP, porque la tabla general
-- no se toca.
--
-- LO QUE ESTO NO ARREGLA, Y HAY QUE RESOLVER APARTE
--
-- La colisión de PDV01320 sigue en pie: el ERP tiene ahí un BORRADOR de prueba
-- de USD 37,70 del cliente ficticio, y STEL tiene un pedido real de USD
-- 72.598,79. Cambiar la autoridad no renumera nada. Ese documento de prueba
-- hay que sacarlo del medio para que entre el real, y eso es una decisión de
-- quien administra, no de esta migración.
--
-- Lo mismo con COTI02629, otro borrador de prueba parado dentro de la serie
-- de STEL.

insert into document_numbering_authority_series
  (company_id, doc_type, series_code, authority, reason)
select c.id, v.doc_type, v.series_code, 'STEL', v.reason
from companies c,
     (values
       ('quote', 'COTI',
        'STEL sigue emitiendo esta serie: 39 documentos reales desde el cutover del 16/09 contra una sola venta real del ERP. Fase 40.'),
       ('sales_order', 'PDV',
        'STEL sigue emitiendo esta serie: 39 documentos reales desde el cutover del 16/09 contra una sola venta real del ERP. Fase 40.'),
       ('delivery', 'RT',
        'STEL sigue emitiendo esta serie: 39 documentos reales desde el cutover del 16/09 contra una sola venta real del ERP. Fase 40.'),
       ('delivery', 'RT-ML',
        'Serie de remitos de STEL, mismo motivo que RT. Fase 40.')
     ) as v(doc_type, series_code, reason)
where c.slug = 'buscatools'
on conflict (company_id, doc_type, series_code)
  do update set authority = excluded.authority,
                reason = excluded.reason,
                updated_at = now();
