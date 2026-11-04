create table if not exists public.product_creation_attempts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  product_id uuid null references public.products(id),
  actor_id uuid null default auth.uid() references auth.users(id),
  client_request_id uuid not null unique,
  sku text not null,
  name text not null,
  status text not null default 'started' check (status in ('started','succeeded','failed')),
  error_code text null,
  error_message text null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null
);

create index if not exists product_creation_attempts_company_created_idx
  on public.product_creation_attempts(company_id, created_at desc);

alter table public.product_creation_attempts enable row level security;

create policy product_creation_attempts_insert
  on public.product_creation_attempts for insert to authenticated
  with check (company_id in (select unnest(app.current_writer_company_ids())));

create policy product_creation_attempts_update
  on public.product_creation_attempts for update to authenticated
  using (company_id in (select unnest(app.current_writer_company_ids())))
  with check (company_id in (select unnest(app.current_writer_company_ids())));

create policy product_creation_attempts_select
  on public.product_creation_attempts for select to authenticated
  using (company_id in (select unnest(app.current_internal_company_ids())));
