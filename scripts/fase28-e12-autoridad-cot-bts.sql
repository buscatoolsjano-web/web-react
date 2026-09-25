-- Fase 28 · E12 — arreglo del E11: la autoridad de la serie también se renombra.
--
-- El E11 renombró COT-ERP a COT-BTS en `document_sequences` pero NO en
-- `document_numbering_authority_series`, que es donde dice que esa serie la
-- numera el ERP. El join de `series_de_documento` dejó de encontrarla y cayó a
-- la autoridad general de la empresa, que para cotizaciones es STEL: volvió el
-- cartel amarillo y «Crear cotización» quedó deshabilitado.
--
-- Lo agarró la verificación en el navegador, no un test: ningún test mira dos
-- tablas de configuración a la vez. Es exactamente el tipo de error que no se
-- ve leyendo el diff.

update document_numbering_authority_series
   set series_code = 'COT-BTS'
 where doc_type = 'quote'
   and series_code = 'COT-ERP'
   and company_id = (select id from companies where name = 'Buscatools');
