-- La seguridad (RLS) del stock, sin costo por fila.
--
-- Las cuatro tablas de stock filtraban con `app.is_internal(company_id)`, una
-- función que busca la membresía de la persona y se evaluaba UNA VEZ POR FILA:
-- leer `stock_balances` (14.856 filas) tardaba 1,8–3,5 s, y el catálogo del
-- ERP, que ordena por «destacado» (con stock primero), lo hacía en cada
-- pantalla: 866 ms en caliente y hasta 3,7 s en frío.
--
-- La regla es la misma —miembro activo de la empresa con rol interno: admin,
-- employee, salesperson o technician— pero las empresas se calculan una sola
-- vez por consulta. Medido con rollback: mismas 14.856 filas y misma suma;
-- 1.834 ms → 6 ms; `search_products` por «destacado» 866 ms → ~200 ms.

create or replace function app.current_stock_company_ids()
 returns uuid[]
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $$
  select coalesce(array_agg(company_id), '{}')
    from company_memberships
   where user_id = auth.uid()
     and status = 'active'
     and role in ('admin', 'employee', 'salesperson', 'technician');
$$;
revoke all on function app.current_stock_company_ids() from public, anon;
grant execute on function app.current_stock_company_ids() to authenticated;

alter policy stockbal_select on public.stock_balances
  using (company_id in (select unnest(app.current_stock_company_ids())));
alter policy stockmov_select on public.stock_movements
  using (company_id in (select unnest(app.current_stock_company_ids())));
alter policy reservations_select on public.stock_reservations
  using (company_id in (select unnest(app.current_stock_company_ids())));
alter policy warehouses_select on public.warehouses
  using (company_id in (select unnest(app.current_stock_company_ids())));
