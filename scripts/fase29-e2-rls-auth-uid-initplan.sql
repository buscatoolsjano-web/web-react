-- Fase 29 · E2 — `auth.uid()` una sola vez por consulta, no una por fila.
--
-- Escrito suelto, `auth.uid()` es una llamada que Postgres repite en CADA
-- fila. Envuelto en `(select auth.uid())` pasa a ser un InitPlan: se resuelve
-- una vez y el resultado se reusa. Es la corrección que marca el linter de
-- Supabase (`auth_rls_initplan`, 4 hallazgos → 0) y la que ya usaban las
-- políticas de correo.
--
-- Las cuatro políticas quedan con EXACTAMENTE la misma lógica: lo único que
-- cambia es cuántas veces se evalúa lo mismo. Quién ve qué no se mueve.
-- Verificado comparando `pg_policies.qual` antes y después: la única
-- diferencia es el `(select ...)`.
--
-- Hoy la diferencia es chica porque las tablas son chicas; crece con los
-- datos, que es justo cuando no se quiere estar arreglando esto.
--
-- Idempotente: se puede correr dos veces.

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using ((id = (select auth.uid())) or app.shares_company(id));

drop policy if exists memberships_select on public.company_memberships;
create policy memberships_select on public.company_memberships
  for select to authenticated
  using ((user_id = (select auth.uid())) or app.is_admin(company_id));

drop policy if exists customers_select on public.customers;
create policy customers_select on public.customers
  for select to authenticated
  using (
    company_id = any (app.current_company_ids())
    and (
      app."current_role"(company_id) = any (array['admin','employee'])
      or (app."current_role"(company_id) = 'salesperson' and salesperson_id = (select auth.uid()))
      or (id = app.current_customer_id(company_id) and deleted_at is null)
    )
  );

drop policy if exists customers_update on public.customers;
create policy customers_update on public.customers
  for update to authenticated
  using (
    company_id = any (app.current_company_ids())
    and (
      app."current_role"(company_id) = any (array['admin','employee'])
      or (app."current_role"(company_id) = 'salesperson' and salesperson_id = (select auth.uid()))
    )
  )
  with check (company_id = any (app.current_company_ids()));
