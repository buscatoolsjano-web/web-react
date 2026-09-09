-- ============================================================================
-- Fase 3.6 — SQL aplicado en el proyecto uaxcfufvapzulqvynanp
-- Registro para trazabilidad y para el backup lógico. Refleja el estado final,
-- no el orden en que se fue corrigiendo.
--
-- Migraciones aplicadas, en orden:
--   phase36_catalog_facets
--   phase36_fix_attrs_match_precedencia
--   phase36_rls_facetas_sin_funciones_por_fila
--   phase36_revert_temporal_para_medir_antes   (revertida enseguida)
--   phase36_rls_conjuntos_reaplicar
--   phase36_rls_initplan_subquery_v2
--   phase36_facetas_cortocircuito_y_parallel_safe
-- ============================================================================

-- ── Helpers sin argumentos, para que se plieguen en un InitPlan ─────────────
create or replace function app.current_internal_company_ids()
returns uuid[] language sql stable security definer
set search_path to 'public','pg_temp' as $$
  select coalesce(array_agg(company_id),'{}') from company_memberships
  where user_id = auth.uid() and status='active'
    and role in ('admin','employee','salesperson','technician');
$$;

create or replace function app.current_writer_company_ids()
returns uuid[] language sql stable security definer
set search_path to 'public','pg_temp' as $$
  select coalesce(array_agg(company_id),'{}') from company_memberships
  where user_id = auth.uid() and status='active' and role in ('admin','employee');
$$;

create or replace function app.current_price_list_ids()
returns uuid[] language sql stable security definer
set search_path to 'public','pg_temp' as $$
  select coalesce(array_agg(c.default_price_list_id),'{}')
  from company_memberships m join customers c on c.id = m.customer_id
  where m.user_id = auth.uid() and m.status='active'
    and c.default_price_list_id is not null;
$$;

grant execute on function app.current_internal_company_ids() to authenticated;
grant execute on function app.current_writer_company_ids()   to authenticated;
grant execute on function app.current_price_list_ids()       to authenticated;

-- ── Policies reescritas ─────────────────────────────────────────────────────
-- `in (select unnest(f()))` y no `= any (f())`: sin el subquery, una función
-- STABLE sin argumentos se sigue evaluando POR FILA.
drop policy if exists products_select on products;
create policy products_select on products for select to authenticated
using (
  company_id in (select unnest(app.current_company_ids()))
  and deleted_at is null
  and (company_id in (select unnest(app.current_internal_company_ids()))
       or status = 'active')
);

drop policy if exists products_write on products;
create policy products_write on products for all to authenticated
using      (company_id in (select unnest(app.current_writer_company_ids())))
with check (company_id in (select unnest(app.current_writer_company_ids())));

drop policy if exists prices_select on product_prices;
create policy prices_select on product_prices for select to authenticated
using (
  company_id in (select unnest(app.current_company_ids()))
  and (company_id in (select unnest(app.current_internal_company_ids()))
       or (price_list_id in (select unnest(app.current_price_list_ids()))
           and valid_from <= current_date
           and (valid_to is null or valid_to >= current_date)))
);

drop policy if exists prices_write on product_prices;
create policy prices_write on product_prices for all to authenticated
using      (company_id in (select unnest(app.current_writer_company_ids())))
with check (company_id in (select unnest(app.current_writer_company_ids())));

drop policy if exists pricelists_select on price_lists;
create policy pricelists_select on price_lists for select to authenticated
using (
  company_id in (select unnest(app.current_company_ids()))
  and (company_id in (select unnest(app.current_internal_company_ids()))
       or id in (select unnest(app.current_price_list_ids())))
);

-- ── Índices para las facetas ────────────────────────────────────────────────
create index if not exists idx_products_brand_facetas
  on products (company_id, brand_id) where deleted_at is null and status='active';
create index if not exists idx_products_categoria_facetas
  on products (company_id, category_id) where deleted_at is null and status='active';

-- ── Facetas ─────────────────────────────────────────────────────────────────
-- app.attrs_match y public.catalog_facets: ver la migración
-- phase36_facetas_cortocircuito_y_parallel_safe para el cuerpo completo.
-- Claves del diseño:
--   · SECURITY INVOKER: RLS decide el universo, la función no filtra por empresa
--   · cada faceta se calcula con todos los filtros MENOS el suyo (p_excepto)
--   · attrs_match es IMMUTABLE PARALLEL SAFE y se cortocircuita sin filtros

-- ── Segunda tanda (UI) ──────────────────────────────────────────────────────
--   phase36_limpiar_product_type_guion          8 filas '-' -> NULL
--   phase36_product_images                      tabla + RLS + índices
--   phase36_search_products_unificado           listado y búsqueda en una RPC
--   phase36_drop_catalog_facets_sobrecarga_vieja
--   phase36_catalog_facets_mismo_umbral_fuzzy   plpgsql + set_config
--
-- NOTA IMPORTANTE sobre el umbral fuzzy: el operador <% compara contra
-- pg_trgm.word_similarity_threshold, que por defecto es 0.6. Las DOS
-- funciones tienen que bajarlo a 0.4 con set_config, o describen conjuntos
-- distintos: medido, la misma búsqueda daba 1.550 en search_products y 599
-- en catalog_facets. Por eso catalog_facets es plpgsql y no sql.
