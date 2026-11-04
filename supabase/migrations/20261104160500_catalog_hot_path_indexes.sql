create index if not exists products_company_active_created_idx
  on public.products(company_id, created_at desc) where deleted_at is null;
create index if not exists products_company_sku_idx
  on public.products(company_id, sku) where deleted_at is null;
create index if not exists products_company_name_trgm_idx
  on public.products using gin (lower(name) gin_trgm_ops) where deleted_at is null;
create index if not exists brands_company_active_idx
  on public.brands(company_id, is_active);
create index if not exists product_categories_company_active_idx
  on public.product_categories(company_id, is_active);
create index if not exists product_images_product_primary_idx
  on public.product_images(product_id, is_primary, position);
create index if not exists product_prices_product_list_idx
  on public.product_prices(product_id, price_list_id, valid_from, valid_to);
