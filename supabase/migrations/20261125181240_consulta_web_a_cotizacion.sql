-- Consultas del sitio -> cotización (2026-11): la cotización que se armó desde la consulta.
alter table public.public_quote_requests
  add column if not exists quote_id uuid references public.sales_quotes(id) on delete set null;

create index if not exists public_quote_requests_quote_id_idx
  on public.public_quote_requests (quote_id) where quote_id is not null;

comment on column public.public_quote_requests.quote_id is
  'La cotización armada desde esta consulta con «Crear cotización». Null si todavía no se cotizó o si la cotización se borró.';
