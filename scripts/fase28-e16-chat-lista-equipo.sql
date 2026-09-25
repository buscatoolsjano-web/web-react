-- Fase 28 · E16 — El chat lista a TODO el equipo, se haya hablado o no.
--
-- En E15 la lista de la izquierda mostraba conversaciones: si nunca le
-- escribiste a alguien, esa persona no estaba. Para empezar una charla había
-- que buscarla en un desplegable «Hablar con…», que es un paso de más para lo
-- más común que se hace en un chat de trabajo.
--
-- Ahora la lista sale de las PERSONAS, no de las conversaciones: una fila por
-- cada compañero activo de la empresa, con su conversación pegada al costado
-- si existe. Cuando no existe, `id` vuelve en null y la pantalla lo muestra
-- como «Sin mensajes». La conversación se crea recién al mandar el primer
-- mensaje, no al tocar la fila: así no quedan conversaciones vacías de cada
-- vez que alguien hace clic para curiosear.
--
-- Los grupos siguen viniendo como antes (UNION al final). Hoy la pantalla no
-- arma ninguno, pero la tabla los soporta desde E15 y la lista no los pierde.
--
-- Idempotente: se puede correr dos veces.

create or replace function public.listar_chats(p_company uuid)
returns table (
  id uuid,
  con_quien text,
  con_quien_id uuid,
  ultimo_mensaje text,
  ultimo_mensaje_en timestamptz,
  sin_leer integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_company is null or not (p_company = any (app.current_internal_company_ids())) then
    raise exception 'No perteneces a esta empresa' using errcode = 'insufficient_privilege';
  end if;

  return query
  with companeros as (
    select m.user_id, coalesce(p.full_name, 'Sin nombre') as nombre
      from company_memberships m
      join profiles p on p.id = m.user_id
     where m.company_id = p_company
       and m.status = 'active'
       and m.role in ('admin', 'employee', 'salesperson', 'technician')
       and m.user_id <> auth.uid()
  ),
  -- El directo con cada companero: el que tiene exactamente a los dos.
  directos as (
    select c.user_id,
           (select k.id
              from chat_conversaciones k
             where k.company_id = p_company
               and (select count(*) from chat_participantes x where x.conversacion_id = k.id) = 2
               and exists (select 1 from chat_participantes x where x.conversacion_id = k.id and x.user_id = auth.uid())
               and exists (select 1 from chat_participantes x where x.conversacion_id = k.id and x.user_id = c.user_id)
             limit 1) as conversacion_id
      from companeros c
  ),
  filas_persona as (
    select k.id,
           c.nombre as con_quien,
           c.user_id as con_quien_id,
           k.ultimo_mensaje,
           k.ultimo_mensaje_en,
           coalesce((select count(*)::integer from chat_mensajes m
                      where m.conversacion_id = k.id
                        and m.autor_id <> auth.uid()
                        and m.created_at > coalesce(yo.leido_hasta, '-infinity'::timestamptz)), 0) as sin_leer
      from companeros c
      join directos d on d.user_id = c.user_id
      left join chat_conversaciones k on k.id = d.conversacion_id
      left join chat_participantes yo on yo.conversacion_id = k.id and yo.user_id = auth.uid()
  ),
  filas_grupo as (
    select k.id,
           coalesce((
             select string_agg(coalesce(p.full_name, 'Sin nombre'), ', ' order by p.full_name)
               from chat_participantes x join profiles p on p.id = x.user_id
              where x.conversacion_id = k.id and x.user_id <> auth.uid()
           ), 'Sin nadie') as con_quien,
           null::uuid as con_quien_id,
           k.ultimo_mensaje,
           k.ultimo_mensaje_en,
           (select count(*)::integer from chat_mensajes m
             where m.conversacion_id = k.id
               and m.autor_id <> auth.uid()
               and m.created_at > coalesce(yo.leido_hasta, '-infinity'::timestamptz)) as sin_leer
      from chat_conversaciones k
      join chat_participantes yo on yo.conversacion_id = k.id and yo.user_id = auth.uid()
     where k.company_id = p_company
       and (select count(*) from chat_participantes x where x.conversacion_id = k.id) <> 2
  )
  select f.id, f.con_quien, f.con_quien_id, f.ultimo_mensaje, f.ultimo_mensaje_en, f.sin_leer
    from (select * from filas_persona union all select * from filas_grupo) f
   -- Lo que espera: primero lo que tiene sin leer, despues lo mas reciente, y
   -- al final el resto por nombre.
   order by (f.sin_leer > 0) desc,
            f.ultimo_mensaje_en desc nulls last,
            f.con_quien;
end $$;
