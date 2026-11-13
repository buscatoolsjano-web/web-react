-- Una cotización que ya tiene pedido no se puede rechazar ni dar por vencida.
--
-- «Arreglá lo de la cotización rechazada.» Probando el MCP, una cotización
-- convertida en pedido se pudo pasar a «rechazada». En el uso real ya lo
-- frenaba `bloquear_cotizacion_cerrada` —una aceptada no cambia de estado—,
-- pero por un costado: el candado mira el ESTADO (aceptada), no si hay PEDIDO,
-- y se abre en la misma transacción en la que nace el pedido. Además el
-- mensaje salía en inglés: «está accepted y no se puede modificar».
--
-- Ahora la regla es la de negocio y va primero: con un pedido vivo (no
-- cancelado), la cotización no pasa a rechazada ni a vencida, venga de donde
-- venga el cambio. Si el cliente se echó atrás, lo que se cancela es el pedido.
-- Y los mensajes dicen el estado en castellano.

create or replace function app.bloquear_cotizacion_cerrada()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_pedido text;
  v_estado text := case old.status when 'accepted' then 'aceptada' when 'rejected' then 'rechazada'
                                   when 'expired' then 'vencida' else old.status end;
begin
  -- Fase 14 E2: sólo la RPC de reconciliación STEL (contexto de transacción).
  if app.en_reconciliacion_stel() then
    return new;
  end if;

  -- La regla de negocio, antes que cualquier excepción de flujo.
  if new.status in ('rejected', 'expired') and new.status is distinct from old.status then
    select o.number into v_pedido from sales_orders o
     where o.quote_id = old.id and o.commercial_status <> 'cancelled' limit 1;
    if v_pedido is not null then
      raise exception 'La cotización % ya es el pedido %: no se puede rechazar. Si el cliente se echó atrás, cancelá el pedido.',
        old.number, v_pedido using errcode = 'restrict_violation';
    end if;
  end if;

  -- Fase 43: el sistema derivando el estado de ESTA cotización en ESTA
  -- transacción —se cerró porque nació su pedido, o vuelve a pendiente porque
  -- el pedido se borró—. No es alguien editando un documento cerrado.
  if app.en_workflow('estado_derivado', old.id) then
    return new;
  end if;

  if old.status not in ('accepted', 'rejected', 'expired') then
    return new;
  end if;

  if new.customer_id    is distinct from old.customer_id
     or new.currency_code  is distinct from old.currency_code
     or new.exchange_rate  is distinct from old.exchange_rate
     or new.quote_date     is distinct from old.quote_date
     or new.discount_pct   is distinct from old.discount_pct
     or new.perception_pct is distinct from old.perception_pct
     or new.subtotal       is distinct from old.subtotal
     or new.tax_amount     is distinct from old.tax_amount
     or new.total          is distinct from old.total
     or new.status         is distinct from old.status then
    raise exception 'La cotización % está % y no se puede modificar', old.number, v_estado
      using errcode = 'restrict_violation';
  end if;

  return new;
end $function$;
