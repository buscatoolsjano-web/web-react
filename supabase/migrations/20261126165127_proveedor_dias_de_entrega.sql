-- Días de entrega habituales del proveedor (2026-11).
-- Al armar un pedido de compra, la llegada estimada se propone sola:
-- fecha del pedido + estos días. Se puede cambiar en cada pedido.
alter table public.suppliers
  add column if not exists lead_time_days integer
    check (lead_time_days is null or (lead_time_days >= 0 and lead_time_days <= 365));

comment on column public.suppliers.lead_time_days is
  'Días habituales entre el pedido y la llegada. Propone la llegada estimada de los pedidos de compra nuevos.';
