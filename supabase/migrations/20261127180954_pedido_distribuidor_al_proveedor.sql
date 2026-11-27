-- Del distribuidor al proveedor: el pedido (2026-11-27) — Fase 4.
--
-- Cuando el cliente del distribuidor acepta una cotización, el distribuidor
-- le pide la mercadería a su proveedor (Buscatools) con un clic: se crea en
-- Buscatools un PEDIDO EN BORRADOR, a nombre del distribuidor como cliente, con
-- los productos compartidos de esa cotización y a SU precio de distribuidor
-- (el de catalog_shares, nunca el precio de venta del distribuidor ni nada de
-- su cliente). Buscatools lo revisa y lo confirma como cualquier pedido.
--
--   · El distribuidor no tiene permisos en Buscatools: todo lo hace esta función
--     (SECURITY DEFINER), que valida que la cotización sea suya y esté aceptada.
--   · Una cotización pide una sola vez (pedidos_distribuidor.quote_id único).
--   · Si el distribuidor todavía no es cliente de Buscatools, se lo da de alta
--     con el nombre de su empresa y queda guardado en catalog_shares.
--   · Las líneas libres o alternativas no pasan; se informa cuántas quedaron.
--   · Serie: la por defecto de pedidos del proveedor (en Buscatools, PDV-ERP).

alter table public.catalog_shares
  add column if not exists customer_id uuid references public.customers(id) on delete set null;

comment on column public.catalog_shares.customer_id is
  'El cliente (en la empresa dueña) que representa al distribuidor: a su nombre entran sus pedidos.';

create table if not exists public.pedidos_distribuidor (
  id uuid primary key default gen_random_uuid(),
  distributor_company_id uuid not null references public.companies(id) on delete cascade,
  quote_id uuid not null unique references public.sales_quotes(id) on delete cascade,
  owner_company_id uuid not null references public.companies(id) on delete cascade,
  sales_order_id uuid references public.sales_orders(id) on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists pedidos_distribuidor_owner_idx on public.pedidos_distribuidor (owner_company_id);
create index if not exists pedidos_distribuidor_order_idx on public.pedidos_distribuidor (sales_order_id);

alter table public.pedidos_distribuidor enable row level security;

drop policy if exists pedidos_distribuidor_select on public.pedidos_distribuidor;
create policy pedidos_distribuidor_select on public.pedidos_distribuidor
  for select to authenticated
  using (distributor_company_id = any (app.current_company_ids())
         or owner_company_id = any (app.current_internal_company_ids()));

-- Pedirle al proveedor lo de una cotización aceptada.
create or replace function public.distribuidor_pedir_al_proveedor(p_quote uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'app', 'pg_temp'
as $$
declare
  v_q sales_quotes;
  v_rol text;
  s catalog_shares;
  v_dist companies;
  v_cliente uuid;
  v_moneda text;
  v_serie text;
  v_numero text;
  v_o sales_orders;
  v_n int := 0;
  v_omitidas int := 0;
  r record;
begin
  if auth.uid() is null then raise exception 'sesion_invalida'; end if;

  select * into v_q from sales_quotes where id = p_quote;
  if not found then raise exception 'cotizacion_inexistente'; end if;

  select cm.role into v_rol from company_memberships cm
   where cm.user_id = auth.uid() and cm.company_id = v_q.company_id and cm.status = 'active' limit 1;
  if v_rol is null or v_rol not in ('admin', 'employee') then raise exception 'sin_permiso' using errcode = '42501'; end if;

  if v_q.status <> 'accepted' then raise exception 'cotizacion_no_aceptada'; end if;
  if exists (select 1 from pedidos_distribuidor where quote_id = p_quote) then raise exception 'ya_pedida'; end if;

  select * into s from catalog_shares where distributor_company_id = v_q.company_id and is_active for update;
  if not found then raise exception 'sin_proveedor'; end if;

  -- El distribuidor como cliente del proveedor (se crea la primera vez).
  v_cliente := s.customer_id;
  if v_cliente is null or not exists (select 1 from customers where id = v_cliente and company_id = s.owner_company_id and deleted_at is null) then
    select * into v_dist from companies where id = v_q.company_id;
    insert into customers (company_id, legal_name, trade_name, tax_id, phone)
    values (s.owner_company_id, coalesce(v_dist.legal_name, v_dist.name), v_dist.name, v_dist.tax_id, v_dist.phone)
    returning id into v_cliente;
    update catalog_shares set customer_id = v_cliente, updated_at = now() where id = s.id;
  end if;

  select currency_code into v_moneda from price_lists where company_id = s.owner_company_id and is_default limit 1;
  select ds.series_code into v_serie from document_sequences ds
   where ds.company_id = s.owner_company_id and ds.doc_type = 'sales_order' and ds.is_default;
  if v_serie is null then raise exception 'sin_serie'; end if;

  -- Antes de numerar: ¿hay algo para pedir?
  select count(*) filter (where not ok), count(*) filter (where ok) into v_omitidas, v_n
    from (select l.product_id is not null and app.producto_compartido(l.product_id, v_q.company_id) as ok
            from sales_quote_lines l
           where l.quote_id = p_quote and l.line_type <> 'chapter' and not l.is_alternative) x;
  if v_n = 0 then raise exception 'sin_productos_del_proveedor'; end if;

  -- El número, como next_document_number pero sin su control de pertenencia
  -- (quien pide es el distribuidor, que no es de la empresa dueña; ya se validó
  -- arriba que la cotización es suya). Mismo control de STEL, misma secuencia.
  perform app.exigir_emision_erp(s.owner_company_id, 'sales_order'::text, v_serie);
  update document_sequences
     set next_number = next_number + 1
   where company_id = s.owner_company_id and doc_type = 'sales_order' and series_code = v_serie
  returning prefix || lpad((next_number - 1)::text, padding, '0') into v_numero;

  insert into sales_orders (
    company_id, number, series_code, commercial_status, origin, customer_id,
    order_date, title, currency_code, price_list_id, notes, created_by, updated_by
  ) values (
    s.owner_company_id, v_numero, v_serie, 'draft', 'po_only', v_cliente,
    (now() at time zone 'America/Argentina/Buenos_Aires')::date,
    left('Pedido de ' || (select name from companies where id = v_q.company_id), 200),
    v_moneda, s.price_list_id,
    'Pedido del distribuidor desde su cotización ' || v_q.number || '. Precios de distribuidor.',
    auth.uid(), auth.uid()
  ) returning * into v_o;

  v_n := 0;
  for r in
    select l.product_id, l.quantity, p.sku, p.name, pr.precio
      from sales_quote_lines l
      join products p on p.id = l.product_id
      left join app.precios_compartidos(s.id, array[l.product_id]) pr on true
     where l.quote_id = p_quote and l.line_type <> 'chapter' and not l.is_alternative
       and app.producto_compartido(l.product_id, v_q.company_id)
     order by l.line_no, l.id
  loop
    v_n := v_n + 1;
    insert into sales_order_lines (
      company_id, order_id, line_no, line_type, product_id, sku_snapshot, name_snapshot,
      quantity_ordered, unit_price, list_price_snapshot, discount_pct, tax_treatment, tax_rate_snapshot
    ) values (
      s.owner_company_id, v_o.id, v_n, 'item', r.product_id, r.sku, r.name,
      r.quantity, coalesce(r.precio, 0), r.precio, 0, 'vat_21', 21
    );
  end loop;

  insert into pedidos_distribuidor (distributor_company_id, quote_id, owner_company_id, sales_order_id)
  values (v_q.company_id, p_quote, s.owner_company_id, v_o.id);

  select * into v_o from sales_orders where id = v_o.id;
  return jsonb_build_object('numero', v_o.number, 'lineas', v_n, 'omitidas', v_omitidas, 'total', v_o.total, 'moneda', v_o.currency_code);
end
$$;

revoke all on function public.distribuidor_pedir_al_proveedor(uuid) from public, anon;
grant execute on function public.distribuidor_pedir_al_proveedor(uuid) to authenticated;

-- Cómo va lo que se le pidió al proveedor (lo ve el distribuidor desde su cotización).
create or replace function public.distribuidor_pedido_de_cotizacion(p_quote uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public', 'app', 'pg_temp'
as $$
  select jsonb_build_object(
           'numero', o.number,
           'proveedor', (select name from companies where id = pd.owner_company_id),
           'estado', o.commercial_status,
           'entrega', o.fulfillment_status,
           'pedidoEl', pd.created_at)
    from pedidos_distribuidor pd
    left join sales_orders o on o.id = pd.sales_order_id
   where pd.quote_id = p_quote
     and pd.distributor_company_id = any (app.current_company_ids())
$$;

revoke all on function public.distribuidor_pedido_de_cotizacion(uuid) from public, anon;
grant execute on function public.distribuidor_pedido_de_cotizacion(uuid) to authenticated;
