-- Fase 246: las fotos de un producto se suben desde su ficha.
--
-- Van al bucket PÚBLICO `catalogo-publico` —donde ya están las 14.590 fotos
-- que se ven en el ERP y en la web— bajo `productos/<empresa>/<producto>/`.
-- Hasta ahora ese bucket sólo dejaba escribir en `portadas/<empresa>/`. Se
-- abre una carpeta más, con la MISMA regla: sólo quien escribe en esa empresa,
-- y sólo dentro de la carpeta de su empresa. Leer ya es público (el bucket lo es).
create policy catalogo_publico_productos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'catalogo-publico'
    and (storage.foldername(name))[1] = 'productos'
    and (storage.foldername(name))[2] in (select unnest(app.current_writer_company_ids())::text)
  );

create policy catalogo_publico_productos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'catalogo-publico'
    and (storage.foldername(name))[1] = 'productos'
    and (storage.foldername(name))[2] in (select unnest(app.current_writer_company_ids())::text)
  );

create policy catalogo_publico_productos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'catalogo-publico'
    and (storage.foldername(name))[1] = 'productos'
    and (storage.foldername(name))[2] in (select unnest(app.current_writer_company_ids())::text)
  );
