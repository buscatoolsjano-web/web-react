-- Fase 21 · E3 — «Cotización abierta», una sola definición.
--
-- El problema: el Dashboard decía 154 cotizaciones abiertas y el listado, al
-- seguir el link, mostraba 143. No era un error de conteo: eran dos reglas.
-- El informe de pipeline sabía que una cotización ACEPTADA sigue abierta hasta
-- que se convierte en pedido confirmado; el listado sólo sabía filtrar por
-- estado, y `estado=sent` se comía las 11 aceptadas sin pedido.
--
-- Arreglar el número habría sido mentir. Se arregla el listado: la regla pasa a
-- vivir en la base, una sola vez, y tanto el KPI como el filtro la leen de acá.
-- Como es una función que recibe la fila, PostgREST la expone como columna
-- calculada y el listado puede pedir `?abierta=is.true` sin reimplementar nada.
--
-- Aplicada como `fase21_e3_cotizacion_abierta_regla_unica` (2026-09-22).
-- `security invoker` por omisión: la RLS de sales_quotes sigue mandando.

create or replace function public.abierta(q public.sales_quotes)
returns boolean
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select q.status in ('sent', 'accepted')
     and not exists (
       select 1 from public.sales_orders o
        where o.quote_id = q.id
          and o.company_id = q.company_id
          and o.commercial_status = 'confirmed'
     );
$$;

comment on function public.abierta(public.sales_quotes) is
  'Fase 21 E3: emitida y sin pedido confirmado derivado. Única definición de '
  '«cotización abierta»: la usan el KPI del Dashboard y el filtro del listado.';

-- ── Invariantes ────────────────────────────────────────────────────────────
-- Se corren después de aplicar. Fallan ruidosamente en vez de devolver un
-- número plausible y equivocado, que es exactamente lo que pasó antes.
do $$
declare
  solo_funcion int; solo_a_mano int; aceptadas int; coladas int;
begin
  -- 1. La función y la regla escrita a mano marcan LAS MISMAS filas.
  --    Si alguien toca una sin la otra, esto se entera.
  with a_mano as (
    select q.id from public.sales_quotes q
     where q.status in ('sent','accepted')
       and not exists (select 1 from public.sales_orders o
                        where o.quote_id = q.id and o.company_id = q.company_id
                          and o.commercial_status = 'confirmed')
  ), por_funcion as (
    select q.id from public.sales_quotes q where public.abierta(q)
  )
  select (select count(*) from (select id from por_funcion except select id from a_mano) d),
         (select count(*) from (select id from a_mano except select id from por_funcion) d)
    into solo_funcion, solo_a_mano;
  if solo_funcion <> 0 or solo_a_mano <> 0 then
    raise exception 'abierta() no coincide con la regla: % de más, % de menos',
      solo_funcion, solo_a_mano;
  end if;

  -- 2. Las aceptadas sin pedido NO se pierden: son la diferencia entera entre
  --    los 154 del KPI y los 143 que el listado sabía mostrar.
  select count(*) into aceptadas
    from public.sales_quotes q where public.abierta(q) and q.status = 'accepted';
  if aceptadas = 0 then
    raise exception 'ninguna aceptada quedó abierta: la regla volvió a ser estado=sent';
  end if;

  -- 3. Nada cerrado se cuela: ni un estado terminal, ni una ya convertida.
  select count(*) into coladas
    from public.sales_quotes q
   where public.abierta(q)
     and (q.status not in ('sent','accepted')
          or exists (select 1 from public.sales_orders o
                      where o.quote_id = q.id and o.company_id = q.company_id
                        and o.commercial_status = 'confirmed'));
  if coladas <> 0 then
    raise exception '% cotizaciones cerradas contadas como abiertas', coladas;
  end if;

  raise notice 'abierta(): OK — % aceptadas sin pedido incluidas', aceptadas;
end $$;
