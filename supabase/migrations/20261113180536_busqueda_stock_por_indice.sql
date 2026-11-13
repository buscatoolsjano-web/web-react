-- La búsqueda del MCP trae el stock por el índice, no con una pasada.
--
-- La versión de 20261113180118 traía el stock de todos los candidatos con una
-- sola consulta sobre `stock_balances`. Como postgres era rápida, pero bajo
-- RLS esa pasada evaluaba `app.is_internal(company_id)` en las 14.856 filas:
-- 1,7 s medidos, y la búsqueda quedaba MÁS lenta que antes (2,2 s). Con un
-- lateral por candidato se lee sólo el stock de cada uno por su índice.
--
-- El archivo 20261113180118 ya trae la versión corregida; esto sólo cambia la
-- base donde se aplicó la anterior. Si no la encuentra, no hace nada.
do $$
declare
  v_def text := pg_get_functiondef('public.asistente_buscar_productos(uuid,text,integer)'::regprocedure);
  v_viejo text := $v$  ), saldos as (
    select sb.product_id, sum(sb.on_hand - sb.reserved) as disponible
      from stock_balances sb
     where sb.product_id in (select id from filtrados)
     group by sb.product_id
  ), con_saldo as (
    select f.*, coalesce(s.disponible, 0) as disponible
      from filtrados f left join saldos s on s.product_id = f.id
  ), ordenados as ($v$;
  v_nuevo text := $v$  ), con_saldo as (
    select f.*, coalesce(s.disponible, 0) as disponible
      from filtrados f
      left join lateral (select sum(sb.on_hand - sb.reserved) as disponible
                           from stock_balances sb where sb.product_id = f.id) s on true
  ), ordenados as ($v$;
begin
  if position(v_viejo in v_def) = 0 then
    raise notice 'asistente_buscar_productos ya trae el stock por índice';
    return;
  end if;
  execute replace(v_def, v_viejo, v_nuevo);
end $$;
