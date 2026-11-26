-- El índice del modelo tenía «model_code is not null», pero emparejar_lineas_de_oc
-- no pone esa condición en su consulta: el índice parcial no se podía usar y la
-- búsqueda por modelo seguía recorriendo el catálogo (~200-800 ms por línea).
drop index if exists public.products_oc_model_norm_idx;
create index if not exists products_oc_model_norm_idx
  on public.products (company_id, app.normalizar_texto_oc(model_code))
  where deleted_at is null;
