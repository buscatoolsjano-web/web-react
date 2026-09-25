-- Fase 28 · E13 — el ERP numera Ventas. Se acabó el cartel de autoridad.
--
-- QUÉ DECIDE ESTO, dicho sin vueltas: **desde hoy STEL no numera ningún
-- documento de venta nuevo de Buscatools**. Cotización, pedido y nota de
-- entrega salen en una serie del ERP y los numera el ERP.
--
-- Venía de la Fase 19: durante el cutover STEL seguía siendo la autoridad, el
-- ERP no dejaba emitir y lo explicaba con un cartel amarillo. La E11 pasó las
-- cotizaciones al ERP; esto hace lo mismo con pedidos y remitos y saca el
-- cartel de todas partes.
--
-- TRES PIEZAS, y ninguna borra nada:
--
-- 1 · Las series del ERP pasan a ser las de por defecto (PDV-ERP, RT-ERP;
--     COT-BTS ya lo era).
-- 2 · Las series de STEL —COTI, PDV, RT, RT-ML— dejan de ofrecerse para
--     documentos nuevos. Siguen existiendo con sus 672 documentos.
-- 3 · La autoridad pasa a ERP y se sacan las excepciones por serie. Sin esto
--     una cotización COTI vieja seguiría mostrando el cartel en su ficha, y
--     con él «Marcar como enviada» deshabilitado sin nada que se pueda hacer
--     al respecto.
--
-- Que la autoridad sea ERP NO abre la puerta a numerar en una serie de STEL:
-- esas series ya no se pueden elegir (`is_selectable`), y duplicar usa la
-- serie por defecto.
--
-- Sólo Buscatools. Torquetools no tiene nada de esto configurado.

begin;

-- ── 1 · Las series del ERP, por defecto ───────────────────────────────────
-- El orden importa: hay un único por (empresa, tipo), así que primero se apaga
-- la vieja y recién después se prende la nueva.

update document_sequences
   set is_default = false, is_selectable = false
 where company_id = (select id from companies where name = 'Buscatools')
   and doc_type in ('sales_order', 'delivery')
   and series_code in ('PDV', 'RT', 'RT-ML');

update document_sequences
   set is_default = true, is_selectable = true
 where company_id = (select id from companies where name = 'Buscatools')
   and (doc_type, series_code) in (('sales_order', 'PDV-ERP'), ('delivery', 'RT-ERP'));

-- ── 2 · La autoridad: el ERP, y sin excepciones por serie ─────────────────

update document_numbering_authority
   set authority = 'ERP'
 where company_id = (select id from companies where name = 'Buscatools')
   and doc_type in ('quote', 'sales_order', 'delivery');

-- Las excepciones por serie decían «esta serie la numera STEL». Ya no hace
-- falta: ninguna de esas series se puede elegir, y mientras estaban, la ficha
-- de cada documento viejo mostraba el cartel y sus acciones bloqueadas.
delete from document_numbering_authority_series
 where company_id = (select id from companies where name = 'Buscatools')
   and doc_type in ('quote', 'sales_order', 'delivery');

commit;
