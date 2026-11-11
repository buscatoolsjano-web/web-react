-- Fase 228: videos del ingreso en Mantenimiento.
--
-- El bucket `ventas` (archivos privados de la empresa) sólo aceptaba imágenes,
-- PDF y documentos de hasta 20 MB. Para que el técnico deje grabado cómo entró
-- una máquina —el ruido de un motor no sale en una foto— se suman los formatos
-- de video que graban los navegadores y los teléfonos:
--   · video/webm      Chrome / Android (MediaRecorder)
--   · video/mp4       Safari / iPhone y la mayoría de los teléfonos
--   · video/quicktime .mov de iPhone
-- y el tope sube a 50 MB. Las imágenes siguen topeadas a 20 MB del lado de la
-- app (subirAdjunto); el tope del bucket es el máximo del más grande.
update storage.buckets
set
  file_size_limit = 52428800,
  allowed_mime_types = (
    select array_agg(distinct t order by t)
    from unnest(
      coalesce(allowed_mime_types, '{}'::text[])
      || array['video/webm', 'video/mp4', 'video/quicktime']
    ) as t
  )
where id = 'ventas';
