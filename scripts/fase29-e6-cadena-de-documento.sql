-- Fase 29 · E6 — La cadena de un documento: cotización → pedido → entrega → factura.
--
-- Hasta ahora sólo se sabía de dónde VENÍA un documento (`doc.origen`). Para
-- dibujar la cadena hace falta también hacia adelante: si esta cotización ya
-- tiene pedido, si ese pedido ya tiene remito, si hay factura.
--
-- Va en UNA sola función y no en cuatro consultas desde el front porque cada
-- viaje a la base cuesta ~220 ms desde acá: cuatro encadenadas serían casi un
-- segundo para dibujar una barra.
--
-- Sobre la multiplicidad: hoy la cadena es 1:1 en los datos reales (ninguna
-- cotización tiene más de un pedido, ningún pedido más de una entrega), pero
-- el esquema no lo impide. Así que se devuelve el PRIMERO por fecha y además
-- `cuantos`, para que la pantalla pueda decir «y 2 más» en vez de mentir
-- mostrando uno solo como si fuera todo.
--
-- Los 11 remitos que salen de una cotización sin pasar por un pedido
-- (`source_quote_id`, ver Fase 15 · E6) se resuelven con el `coalesce`: sin
-- eso, esos remitos quedarían sin cotización en la barra.
--
-- Idempotente: se puede correr dos veces.

create or replace function public.cadena_de_documento(p_tipo text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_company   uuid;
  v_quote     uuid;
  v_order     uuid;
  v_delivery  uuid;
  v_invoice   uuid;
  v_resultado jsonb;
begin
  if p_tipo not in ('cotizacion','pedido','entrega','factura') or p_id is null then
    raise exception 'Tipo de documento desconocido: %', p_tipo using errcode = 'invalid_parameter_value';
  end if;

  -- 1 · Ubicar el documento y subir hasta la cotización, que es la raíz.
  if p_tipo = 'cotizacion' then
    select q.company_id, q.id into v_company, v_quote from sales_quotes q where q.id = p_id;

  elsif p_tipo = 'pedido' then
    select o.company_id, o.quote_id, o.id into v_company, v_quote, v_order
      from sales_orders o where o.id = p_id;

  elsif p_tipo = 'entrega' then
    select d.company_id, d.order_id, d.id, coalesce(o.quote_id, d.source_quote_id)
      into v_company, v_order, v_delivery, v_quote
      from deliveries d
      left join sales_orders o on o.id = d.order_id
     where d.id = p_id;

  else
    select f.company_id, f.order_id, f.id, o.quote_id
      into v_company, v_order, v_invoice, v_quote
      from sales_invoices f
      left join sales_orders o on o.id = f.order_id
     where f.id = p_id;
  end if;

  if v_company is null then
    raise exception 'No existe ese documento' using errcode = 'no_data_found';
  end if;

  -- 2 · La misma puerta que usan el resto de los listados de Ventas.
  if not (v_company = any (app.current_internal_company_ids())) then
    raise exception 'No perteneces a esta empresa' using errcode = 'insufficient_privilege';
  end if;

  -- 3 · Bajar la cadena llenando lo que falte. Cada paso se busca desde el
  --     anterior, así que un pedido sin cotización no inventa una.
  if v_order is null and v_quote is not null then
    select o.id into v_order
      from sales_orders o where o.quote_id = v_quote
     order by o.created_at, o.id limit 1;
  end if;

  if v_delivery is null and v_order is not null then
    select d.id into v_delivery
      from deliveries d where d.order_id = v_order
     order by d.created_at, d.id limit 1;
  end if;

  if v_invoice is null and v_order is not null then
    select f.id into v_invoice
      from sales_invoices f where f.order_id = v_order
     order by f.created_at, f.id limit 1;
  end if;

  select jsonb_build_object(
    'cotizacion', case when v_quote is null then null else (
      select jsonb_build_object('id', q.id, 'numero', q.number, 'estado', q.status, 'cuantos', 1)
        from sales_quotes q where q.id = v_quote) end,
    'pedido', case when v_order is null then null else (
      select jsonb_build_object('id', o.id, 'numero', o.number, 'estado', o.commercial_status,
                                'cuantos', coalesce((select count(*) from sales_orders x
                                                      where v_quote is not null and x.quote_id = v_quote), 1))
        from sales_orders o where o.id = v_order) end,
    'entrega', case when v_delivery is null then null else (
      select jsonb_build_object('id', d.id, 'numero', d.number, 'estado', d.status,
                                'cuantos', coalesce((select count(*) from deliveries x
                                                      where v_order is not null and x.order_id = v_order), 1))
        from deliveries d where d.id = v_delivery) end,
    'factura', case when v_invoice is null then null else (
      select jsonb_build_object('id', f.id, 'numero', f.number, 'estado', f.status,
                                'cuantos', coalesce((select count(*) from sales_invoices x
                                                      where v_order is not null and x.order_id = v_order), 1))
        from sales_invoices f where f.id = v_invoice) end
  ) into v_resultado;

  return v_resultado;
end $$;

grant execute on function public.cadena_de_documento(text, uuid) to authenticated;
