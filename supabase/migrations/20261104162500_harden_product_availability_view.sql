create or replace view public.product_availability
with (security_invoker = true)
as
select
  company_id,
  product_id,
  warehouse_id,
  (on_hand - reserved) > 0::numeric as is_available
from public.stock_balances b
where company_id = any (app.current_company_ids());
