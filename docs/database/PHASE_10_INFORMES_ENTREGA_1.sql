-- ===========================================================================
-- FASE 10 · INFORMES — ENTREGA 1 · actividad comercial
-- ===========================================================================
--
-- Migraciones (en este orden):
--   fase10_informes_entrega1_actividad          primera versión de la función
--   fase10_informes_entrega1_actividad_rangos   versión DEFINITIVA: agrega las
--                                               filas rango_actual/rango_anterior
--
-- Sin tablas, vistas, índices ni cambios de RLS. Una función de lectura.
--
-- Reglas (decisiones de la entrega 1):
--   · sólo admin y employee de la empresa: se valida ANTES de leer; la RLS de
--     ventas dejaría leer también a salesperson y technician;
--   · «vendido» = ENTREGADO: remitos confirmados. En el ERP nuevo confirmar un
--     remito lo deja en 'shipped' (confirmar_entrega); el histórico migrado está
--     en 'delivered'. Se excluyen 'draft' y 'cancelled';
--   · pedidos: KPI aparte, commercial_status = 'confirmed';
--   · cotizado: todo menos 'draft' (sent, accepted, rejected, expired);
--   · por moneda del documento, SIN conversión; sin moneda → 'SIN MONEDA'
--     (los 32 históricos siguen con needs_review, decisión R4 de Ventas);
--   · período por la FECHA DEL DOCUMENTO (nunca created_at), mes calendario;
--     «hoy» en America/Argentina/Buenos_Aires;
--   · importe = total del documento (con impuestos).
--
-- Filas devueltas (dispersas: un mes sin documentos no devuelve fila):
--   rango_actual / rango_anterior  SIEMPRE, con desde/hasta del tramo
--   mes       serie de 12 meses que termina en el mes pedido
--   actual    el mes pedido; si es el mes en curso, del 1 a hoy
--   anterior  el mes anterior: el MISMO tramo de días si el pedido es el mes en
--             curso (1–13 ago vs 1–13 sep), o el mes completo
-- ===========================================================================

create or replace function public.informe_actividad_comercial(p_company uuid, p_mes date default null)
returns table (
  periodo     text,
  tipo        text,
  mes         date,
  desde       date,
  hasta       date,
  moneda      text,
  documentos  bigint,
  importe     numeric,
  en_revision bigint
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_hoy        date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_mes_hoy    date := date_trunc('month', (now() at time zone 'America/Argentina/Buenos_Aires'))::date;
  v_mes        date;
  v_serie_ini  date;
  v_act_hasta  date;
  v_ant_ini    date;
  v_ant_hasta  date;
begin
  if p_company is null or app.current_role(p_company) is null
     or app.current_role(p_company) not in ('admin', 'employee') then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;

  v_mes := date_trunc('month', coalesce(p_mes, v_hoy))::date;
  if v_mes > v_mes_hoy then
    raise exception 'mes_futuro' using errcode = 'invalid_parameter_value';
  end if;

  v_serie_ini := (v_mes - interval '11 months')::date;
  v_ant_ini   := (v_mes - interval '1 month')::date;
  if v_mes = v_mes_hoy then
    v_act_hasta := v_hoy;
    v_ant_hasta := least(v_ant_ini + (v_hoy - v_mes), (v_mes - 1));
  else
    v_act_hasta := ((v_mes + interval '1 month')::date - 1);
    v_ant_hasta := (v_mes - 1);
  end if;

  return query
  with docs as (
    select 'cotizaciones'::text as tipo, q.quote_date as fecha, q.currency_code as moneda, q.total, q.needs_review
      from sales_quotes q
     where q.company_id = p_company and q.status <> 'draft'
       and q.quote_date between v_serie_ini and v_act_hasta
    union all
    select 'pedidos', o.order_date, o.currency_code, o.total, o.needs_review
      from sales_orders o
     where o.company_id = p_company and o.commercial_status = 'confirmed'
       and o.order_date between v_serie_ini and v_act_hasta
    union all
    select 'entregas', d.delivery_date, d.currency_code, d.total, d.needs_review
      from deliveries d
     where d.company_id = p_company and d.status in ('shipped', 'delivered')
       and d.delivery_date between v_serie_ini and v_act_hasta
  )
  select 'rango_actual'::text, null::text, v_mes, v_mes, v_act_hasta, null::text, 0::bigint, 0::numeric, 0::bigint
  union all
  select 'rango_anterior', null, v_ant_ini, v_ant_ini, v_ant_hasta, null, 0, 0, 0
  union all
  select 'mes', d.tipo, date_trunc('month', d.fecha)::date, null::date, null::date,
         coalesce(d.moneda, 'SIN MONEDA'), count(*), coalesce(sum(d.total), 0), count(*) filter (where d.needs_review)
    from docs d
   group by d.tipo, date_trunc('month', d.fecha), coalesce(d.moneda, 'SIN MONEDA')
  union all
  select 'actual', d.tipo, v_mes, v_mes, v_act_hasta,
         coalesce(d.moneda, 'SIN MONEDA'), count(*), coalesce(sum(d.total), 0), count(*) filter (where d.needs_review)
    from docs d
   where d.fecha between v_mes and v_act_hasta
   group by d.tipo, coalesce(d.moneda, 'SIN MONEDA')
  union all
  select 'anterior', d.tipo, v_ant_ini, v_ant_ini, v_ant_hasta,
         coalesce(d.moneda, 'SIN MONEDA'), count(*), coalesce(sum(d.total), 0), count(*) filter (where d.needs_review)
    from docs d
   where d.fecha between v_ant_ini and v_ant_hasta
   group by d.tipo, coalesce(d.moneda, 'SIN MONEDA');
end
$$;

revoke all on function public.informe_actividad_comercial(uuid, date) from public, anon;
grant execute on function public.informe_actividad_comercial(uuid, date) to authenticated;
