-- Importar OC: el emparejador busca cada código normalizado contra el SKU, la
-- referencia vieja y el modelo de todo el catálogo. Sin índice eran tres
-- recorridos completos por línea (~455 ms cada uno): 0,85 s por línea y las OCs
-- de más de ~9 líneas se cortaban por el statement_timeout de 8 s (2026-11).
-- Las expresiones son EXACTAMENTE las de emparejar_lineas_de_oc, para que el
-- planificador las use.
create index if not exists products_oc_sku_norm_idx
  on public.products (company_id, app.normalizar_texto_oc(sku))
  where deleted_at is null;

create index if not exists products_oc_legacy_norm_idx
  on public.products (company_id, app.normalizar_texto_oc(legacy_ref))
  where deleted_at is null and legacy_ref is not null;

create index if not exists products_oc_model_norm_idx
  on public.products (company_id, app.normalizar_texto_oc(model_code))
  where deleted_at is null and model_code is not null;

analyze public.products;
