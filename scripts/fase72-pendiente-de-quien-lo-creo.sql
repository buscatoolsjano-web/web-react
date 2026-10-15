-- Fase 72 · «Tenés pendiente» cuenta lo que creaste
--
-- QUÉ SE PIDIÓ
--
-- «Si hay algún pedido pendiente que me aparezca ahí», sobre el bloque «Lo
-- tuyo» del tablero, que decía siempre «No tenés nada asignado a tu nombre».
--
--
-- POR QUÉ ESTABA SIEMPRE VACÍO
--
-- `pendiente_por_persona` repartía las cotizaciones y los pedidos por
-- `salesperson_id`, y ese campo está en NULL en los 751 documentos de la
-- empresa. O sea que el reparto no repartía nada: todo caía en «Sin asignar»,
-- para todos, siempre. El bloque personal no estaba roto —decía la verdad—
-- pero esa verdad no servía para nada.
--
--
-- LA REGLA QUE YA SE HABÍA TOMADO
--
-- En la Fase 43 el listado de Ventas dejó de mirar sólo `salesperson_id`: la
-- columna Vendedor muestra `salesperson_id` y, cuando no hay, QUIÉN LO CREÓ.
-- Fue una decisión explícita —«en vendedor tiene que aparecer siempre quien lo
-- creó»— y acá se aplica la misma, que es lo que hace que el tablero y el
-- listado digan lo mismo del mismo documento.
--
-- No es un invento: `created_by` lo tienen los documentos que nacieron en el
-- ERP, y son exactamente los que no traen `external_source`. Los de STEL no
-- tienen ninguno de los dos y siguen cayendo en «Sin asignar», donde
-- corresponde y donde el pie del panel ya explica de dónde vinieron.
--
--
-- LO QUE NO SE TOCA
--
-- El correo sigue repartiéndose por `assigned_to`, que es un campo que la
-- gente SÍ usa —y que desde la Fase 70 pueden completar las reglas solas—.
-- Ahí no hay nada que deducir.

create or replace function public.pendiente_por_persona(p_company uuid)
returns table(
  user_id uuid, nombre text, rol text, es_mio boolean,
  correos_sin_responder bigint, cotizaciones_enviadas bigint, pedidos_sin_entregar bigint,
  cotizaciones_mes bigint, pedidos_mes bigint, entregas_mes bigint, correos_enviados_mes bigint
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_hoy   date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_desde date := date_trunc('month', (now() at time zone 'America/Argentina/Buenos_Aires'))::date;
  v_yo    uuid := auth.uid();
begin
  if p_company is null
     or coalesce(app."current_role"(p_company), '') not in ('admin', 'employee') then
    raise exception 'Tu rol no puede ver el pendiente de toda la empresa'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  with personas as (
    select m.user_id as uid, coalesce(p.full_name, '(sin nombre)') as nom, m.role::text as rl
      from company_memberships m
      left join profiles p on p.id = m.user_id
     where m.company_id = p_company and m.status = 'active'
       and m.role::text in ('admin', 'employee', 'salesperson', 'technician')
  ),
  correo as (
    select st.assigned_to as quien, count(*) as n
      from email_threads t
      left join email_thread_state st
             on st.account_id = t.account_id and st.gmail_thread_id = t.gmail_thread_id
     where t.company_id = p_company and st.deleted_at is null
       and not 'DRAFT' = any (t.gmail_labels) and not 'SPAM' = any (t.gmail_labels)
       and not 'TRASH' = any (t.gmail_labels) and 'INBOX' = any (t.gmail_labels)
       and t.last_message_dir = 'in'
       and coalesce(st.workflow_status, 'pendiente') <> 'resuelto'
     group by st.assigned_to
  ),
  -- El vendedor y, si no hay, quien lo creó. La misma regla que la columna
  -- Vendedor del listado de Ventas desde la Fase 43.
  cotiz as (
    select coalesce(q.salesperson_id, q.created_by) as quien, count(*) as n from sales_quotes q
     where q.company_id = p_company and q.status = 'sent' group by 1
  ),
  pedidos as (
    select coalesce(o.salesperson_id, o.created_by) as quien, count(*) as n from sales_orders o
     where o.company_id = p_company and o.fulfillment_status = 'pending' group by 1
  ),
  hechos as (
    select q.created_by as quien, 'c'::text as que, count(*) as n from sales_quotes q
     where q.company_id = p_company and q.status <> 'draft'
       and q.quote_date between v_desde and v_hoy group by q.created_by
    union all
    select o.created_by, 'p', count(*) from sales_orders o
     where o.company_id = p_company and o.commercial_status = 'confirmed'
       and o.order_date between v_desde and v_hoy group by o.created_by
    union all
    select d.created_by, 'e', count(*) from deliveries d
     where d.company_id = p_company and d.status in ('shipped', 'delivered')
       and d.delivery_date between v_desde and v_hoy group by d.created_by
  ),
  hecho as (
    select h.quien,
           coalesce(sum(h.n) filter (where h.que = 'c'), 0) as nc,
           coalesce(sum(h.n) filter (where h.que = 'p'), 0) as np,
           coalesce(sum(h.n) filter (where h.que = 'e'), 0) as ne
      from hechos h group by h.quien
  ),
  enviados as (
    select s.user_id as quien, count(*) as n from email_send_requests s
     where s.company_id = p_company and s.status = 'enviado'
       and (s.created_at at time zone 'America/Argentina/Buenos_Aires')::date between v_desde and v_hoy
     group by s.user_id
  ),
  filas as (
    select personas.uid, personas.nom, personas.rl from personas
    union all select null::uuid, 'Sin asignar', ''
  )
  select f.uid, f.nom, f.rl,
         -- `coalesce`: en la fila «Sin asignar» `f.uid` es null, y `null = v_yo`
         -- da null, no false. Sin esto la fila de nadie llega al cliente con
         -- `es_mio: null` y hay que adivinar qué significa.
         coalesce(f.uid = v_yo, false),
         coalesce(co.n, 0), coalesce(ct.n, 0), coalesce(pe.n, 0),
         coalesce(he.nc, 0)::bigint, coalesce(he.np, 0)::bigint, coalesce(he.ne, 0)::bigint,
         coalesce(en.n, 0)
    from filas f
    left join correo   co on co.quien is not distinct from f.uid
    left join cotiz    ct on ct.quien is not distinct from f.uid
    left join pedidos  pe on pe.quien is not distinct from f.uid
    left join hecho    he on he.quien is not distinct from f.uid
    left join enviados en on en.quien is not distinct from f.uid
   order by (f.uid is null),
            coalesce(co.n, 0) + coalesce(ct.n, 0) + coalesce(pe.n, 0) desc,
            f.nom;
end $function$;

-- VERIFICACIÓN
--
-- APLICADO el 2026-10-15 como `fase72_pendiente_de_quien_lo_creo`.
--
-- Lo pendiente, repartido con la regla nueva (datos reales):
--
--   cotizaciones enviadas .... Jano 1 · Juan 2 · Norberto 1 · sin autor 155
--   pedidos sin entregar ..... Jano 1 ·                        sin autor 31
--
-- Antes, los 159 y los 32 caían enteros en «Sin asignar». Los 155 y los 31 que
-- se quedan ahí son los que entraron por la sincronización de STEL: no tienen
-- vendedor NI autor, y por eso no hay a quién atribuirlos.
