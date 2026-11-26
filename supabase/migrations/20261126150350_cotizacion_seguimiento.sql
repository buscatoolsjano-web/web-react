-- Seguimiento de cotizaciones (2026-11): ganada/perdida con motivo y próximo contacto.
-- «Ganada» no se marca: la deriva la base cuando la cotización tiene pedido.
alter table public.sales_quotes
  add column if not exists lost_reason text
    check (lost_reason in ('precio', 'plazo', 'competencia', 'sin_respuesta', 'postergado', 'otro')),
  add column if not exists lost_note text,
  add column if not exists lost_at timestamptz,
  add column if not exists next_follow_up date,
  add column if not exists follow_up_note text;

comment on column public.sales_quotes.lost_reason is 'Por qué se perdió (status rejected): precio, plazo, competencia, sin_respuesta, postergado, otro.';
comment on column public.sales_quotes.next_follow_up is 'Cuándo volver a contactar al cliente por esta cotización. Mientras esté en el futuro, no aparece en «Para reclamar».';

create index if not exists sales_quotes_next_follow_up_idx
  on public.sales_quotes (company_id, next_follow_up) where next_follow_up is not null;

-- Reabrir una perdida (rejected -> sent): corrige una marcada por error.
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
  if app.en_reconciliacion_stel() then
    return new;
  end if;

  if new.status in ('rejected', 'expired') and new.status is distinct from old.status then
    select o.number into v_pedido from sales_orders o
     where o.quote_id = old.id and o.commercial_status <> 'cancelled' limit 1;
    if v_pedido is not null then
      raise exception 'La cotización % ya es el pedido %: no se puede rechazar. Si el cliente se echó atrás, cancelá el pedido.',
        old.number, v_pedido using errcode = 'restrict_violation';
    end if;
  end if;

  if app.en_workflow('estado_derivado', old.id) then
    return new;
  end if;

  -- Reabrir: una perdida vuelve a pendiente (2026-11). Sólo el estado y los
  -- datos del seguimiento; el resto del documento sigue protegido abajo
  -- recién cuando vuelva a estar cerrada.
  if old.status = 'rejected' and new.status = 'sent'
     and new.customer_id    is not distinct from old.customer_id
     and new.currency_code  is not distinct from old.currency_code
     and new.exchange_rate  is not distinct from old.exchange_rate
     and new.quote_date     is not distinct from old.quote_date
     and new.discount_pct   is not distinct from old.discount_pct
     and new.perception_pct is not distinct from old.perception_pct
     and new.subtotal       is not distinct from old.subtotal
     and new.tax_amount     is not distinct from old.tax_amount
     and new.total          is not distinct from old.total then
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
