-- Fase 29 · E8 — El estado de servicio de cada equipo.
--
-- El panel del sistema anterior filtraba el parque por lo que le está pasando
-- a cada equipo AHORA: ⏸ En espera · ⏳ Cotiz. pendiente · ● En servicio · ✓ OK.
-- Es la pregunta de taller —«qué tengo frenado, qué está cotizado, qué está en
-- el banco»— y en el ERP sólo se podía ver desde Órdenes, no desde Equipos.
--
-- Va como COLUMNA CALCULADA de PostgREST y no como vista: una función que
-- recibe la fila se puede pedir en el `select` y además filtrar
-- (`?estado_servicio=eq.ok`), sin tocar la consulta que ya existe ni sus cinco
-- embebidos. Una vista habría obligado a PostgREST a volver a resolver esas
-- relaciones, con riesgo de romper el listado entero por un filtro.
--
-- `stable` y SIN `security definer`: adentro lee `maintenance_orders`, y tiene
-- que hacerlo con los permisos de quien pregunta. Si fuera definer, un rol que
-- no ve las órdenes igual sabría por el estado cuáles están en el taller.
--
-- El orden de prioridad importa cuando un equipo tiene más de una orden
-- abierta: primero lo que está frenado, después lo que espera respuesta del
-- cliente, y al final lo que efectivamente se está trabajando. Se muestra lo
-- que exige atención, no lo más reciente.
--
-- Verificado con un conjunto sintético de 8 casos, incluidos los empates y el
-- hecho de que una orden CERRADA en espera no cuenta.
--
-- Idempotente: se puede correr dos veces.

create or replace function public.estado_servicio(a public.maintenance_assets)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when exists (select 1 from maintenance_orders o
                  where o.asset_id = a.id and o.status = 'open' and o.on_hold)
      then 'en_espera'
    when exists (select 1 from maintenance_orders o
                  where o.asset_id = a.id and o.status = 'open'
                    and coalesce(o.on_hold, false) = false
                    and o.quote_status = 'pending')
      then 'cotizacion_pendiente'
    when exists (select 1 from maintenance_orders o
                  where o.asset_id = a.id and o.status = 'open')
      then 'en_servicio'
    else 'ok'
  end
$$;

grant execute on function public.estado_servicio(public.maintenance_assets) to authenticated;

comment on function public.estado_servicio(public.maintenance_assets) is
  'Columna calculada: qué le está pasando al equipo ahora (en_espera / cotizacion_pendiente / en_servicio / ok). Fase 29 E8.';
