create or replace view public.product_creation_health
with (security_invoker = true)
as
select
  company_id,
  count(*)::bigint as attempts_24h,
  count(*) filter (where status = 'succeeded')::bigint as succeeded_24h,
  count(*) filter (where status = 'failed')::bigint as failed_24h,
  count(*) filter (where status = 'started')::bigint as pending,
  max(created_at) as last_attempt_at
from public.product_creation_attempts
where created_at >= now() - interval '24 hours'
group by company_id;

grant select on public.product_creation_health to authenticated;

-- Estas funciones son triggers internos: Postgres las ejecuta como parte del
-- trigger y no necesitan estar disponibles como RPC para clientes.
revoke execute on function public.validar_producto_de_la_misma_empresa() from public, anon, authenticated;
revoke execute on function public.validar_lista_de_la_misma_empresa() from public, anon, authenticated;
