-- Fase 40 · Lo pendiente, persona por persona
--
-- PARA QUÉ
--
-- El panel ya decía cuánto hay pendiente en total, pero no de quién. Con un
-- número solo no se puede repartir trabajo ni saber si alguien está tapado.
--
-- LO QUE VA A MOSTRAR HOY, Y HAY QUE DECIRLO
--
-- Medido antes de escribir esto, sobre la empresa real:
--
--   · 717 de los 718 correos sin responder están SIN ASIGNAR (uno es de
--     Norberto).
--   · las 143 cotizaciones enviadas y los 28 pedidos sin entregar están TODOS
--     sin vendedor: `salesperson_id` es null en los 308 documentos.
--
-- Así que al principio esto va a ser una fila «Sin asignar» enorme y el resto
-- en cero. Es correcto que se vea así: el panel no inventa un reparto que
-- nadie hizo, y poner esos 717 a nombre de alguien sería mentir. Que se vea
-- vacío es exactamente el dato que hace falta para empezar a asignar.
--
-- LA FILA «SIN ASIGNAR» ES UNA FILA, no una nota al pie: va al final, como
-- cierre de la tabla, y es la que hay que vaciar. Esconderla en un total
-- aparte la volvería invisible.
--
-- LAS TRES DEFINICIONES SON LAS MISMAS QUE YA USA LA APP, a propósito:
--
--   · correo: recibido, con el último mensaje entrante y sin resolver — el
--     mismo criterio que la tarjeta «Emails sin responder» y que el filtro
--     «Sin responder» de la bandeja. Tres lugares, una definición.
--   · cotizaciones: `status = 'sent'`, las que esperan respuesta del cliente.
--   · pedidos: `fulfillment_status = 'pending'`, que es el estado del
--     encabezado y no el recuento línea por línea. Está elegido así en el
--     resto del panel porque las líneas migradas tienen huecos: por líneas da
--     18 y por encabezado 28, y el bueno es 28.
--
-- SÓLO LA VEN ADMIN Y EMPLOYEE. Es un panel para repartir trabajo, y la
-- puerta se cierra acá adentro con `app.current_role` en vez de confiar en que
-- la pantalla no se dibuje: una RPC que devuelve el tablero de toda la empresa
-- no puede quedar abierta a cualquier rol con sesión.
--
-- Los usuarios de prueba (`customer`, `distributor`, `test`) no son personas
-- que atiendan trabajo y no aparecen: la lista es de quienes pueden tener algo
-- pendiente.

create or replace function public.pendiente_por_persona(p_company uuid)
 returns table(
   user_id uuid,
   nombre text,
   rol text,
   correos_sin_responder bigint,
   cotizaciones_enviadas bigint,
   pedidos_sin_entregar bigint)
 language plpgsql stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if p_company is null
     or coalesce(app."current_role"(p_company), '') not in ('admin', 'employee') then
    raise exception 'Tu rol no puede ver el pendiente de toda la empresa'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  with personas as (
    select m.user_id, coalesce(p.full_name, '(sin nombre)') as nombre, m.role::text as rol
      from company_memberships m
      left join profiles p on p.id = m.user_id
     where m.company_id = p_company
       and m.status = 'active'
       and m.role::text in ('admin', 'employee', 'salesperson', 'technician')
  ),
  correo as (
    select st.assigned_to as quien, count(*) as n
      from email_threads t
      left join email_thread_state st
             on st.account_id = t.account_id and st.gmail_thread_id = t.gmail_thread_id
     where t.company_id = p_company
       and st.deleted_at is null
       and not 'DRAFT' = any (t.gmail_labels)
       and not 'SPAM'  = any (t.gmail_labels)
       and not 'TRASH' = any (t.gmail_labels)
       and 'INBOX' = any (t.gmail_labels)
       and t.last_message_dir = 'in'
       and coalesce(st.workflow_status, 'pendiente') <> 'resuelto'
     group by st.assigned_to
  ),
  cotiz as (
    select q.salesperson_id as quien, count(*) as n
      from sales_quotes q
     where q.company_id = p_company and q.status = 'sent'
     group by q.salesperson_id
  ),
  pedidos as (
    select o.salesperson_id as quien, count(*) as n
      from sales_orders o
     where o.company_id = p_company and o.fulfillment_status = 'pending'
     group by o.salesperson_id
  ),
  /*
   * Las personas MÁS la fila sin asignar. `null` como `user_id` es el valor
   * que ya usa el filtro `asignado=nadie` de la bandeja, así que la pantalla
   * puede armar el link sin un caso especial.
   */
  filas as (
    select user_id, nombre, rol from personas
    union all
    select null::uuid, 'Sin asignar', ''
  )
  select f.user_id, f.nombre, f.rol,
         coalesce(co.n, 0), coalesce(ct.n, 0), coalesce(pe.n, 0)
    from filas f
    left join correo  co on co.quien is not distinct from f.user_id
    left join cotiz   ct on ct.quien is not distinct from f.user_id
    left join pedidos pe on pe.quien is not distinct from f.user_id
   order by (f.user_id is null),            -- «Sin asignar» primero: es la que hay que vaciar
            coalesce(co.n, 0) + coalesce(ct.n, 0) + coalesce(pe.n, 0) desc,
            f.nombre;
end $function$;

grant execute on function public.pendiente_por_persona(uuid) to authenticated;
