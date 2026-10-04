-- Fase 40 · La bandeja deja de mentir: carpetas reales y un «pendiente» que
-- significa algo.
--
-- EL NÚMERO QUE DISPARÓ ESTO
--
-- El panel decía «Emails pendientes: 1515». Medido: había 1516 hilos en la
-- empresa y los 1516 figuraban como pendientes. No era una coincidencia —era
-- una tautología—. `workflow_status` sólo existe si alguien lo tocó, y lo tocó
-- 6 veces en la vida; el resto cae en el `coalesce(..., 'pendiente')` de esta
-- misma función. O sea que el contador no contaba trabajo pendiente: contaba
-- todo el correo que existe, incluido el que mandamos nosotros.
--
-- Desglose de esos 1516, que es lo que explica el arreglo:
--
--   769  en INBOX            → correo recibido, lo único que de verdad espera
--   250  en SENT             → lo que mandamos nosotros
--   311  con etiqueta DRAFT  → BORRADORES, que ya tienen su propia pantalla
--   274  en ninguna de las dos → archivado en Gmail con etiqueta propia
--     9  SPAM
--     1  TRASH
--
-- QUÉ CAMBIA
--
-- 1. BORRADORES FUERA DE LA BANDEJA. 311 de 1516 filas eran borradores. Un
--    borrador no es un hilo de la bandeja: es algo a medio escribir, y se
--    administra en /emails/borradores. Estaban inflando el listado, los
--    contadores y la paginación.
--
-- 2. SPAM Y PAPELERA VAN A «ELIMINADOS», no al limbo. La regla que me impuse
--    es que ningún correo quede inalcanzable desde la interfaz: si lo saco de
--    la bandeja tiene que aparecer en alguna carpeta. Spam y papelera de Gmail
--    caen en Eliminados, junto con lo que se sacó de la bandeja desde el ERP.
--
-- 3. CARPETA NUEVA: «archivados». Son los 274 que no están ni en INBOX ni en
--    SENT porque alguien los archivó en Gmail. Antes sólo se los podía ver
--    desde «Todos», y «Todos» se va de la interfaz. Sin esta carpeta, 274
--    correos reales se volvían invisibles: el precio de separar bien las
--    bandejas no puede ser perder correo.
--
--    `todos` SIGUE existiendo acá a propósito, como rama `else`, porque es el
--    valor por omisión de la función y lo usan `contarSinLeer` y
--    `asignadosAMi`, que no quieren elegir carpeta. Ahora también respeta las
--    exclusiones, así que esas dos dejan de contar borradores y spam.
--
-- 4. `p_sin_responder`: el último mensaje del hilo ENTRÓ. Es la diferencia
--    entre «hay correo» y «hay correo esperándome». Un hilo donde el último
--    que habló fui yo no me está esperando a mí.
--
-- 5. `p_excluir_resueltos`: para el contador, `<> 'resuelto'` en vez de
--    `= 'pendiente'`. Con `= 'pendiente'` el default arrastra todo; con
--    `<> 'resuelto'` marcar un hilo resuelto lo saca de la cuenta, que es lo
--    que alguien espera cuando lo marca.
--
-- CÓMO QUEDA EL CONTADOR: recibidos + último mensaje entrante + no resuelto =
-- 718, y 696 de esos son de los últimos 30 días. Sigue siendo mucho, pero
-- ahora cada unidad es un correo que alguien nos mandó y nadie contestó.
--
-- OJO AL DESPLEGAR: agregar parámetros con CREATE OR REPLACE crea una
-- SOBRECARGA. Con las dos firmas vivas, una llamada de 12 argumentos queda
-- ambigua y PostgREST devuelve PGRST201 —ya rompió el catálogo una vez—. Por
-- eso el DROP y el CREATE van en la MISMA transacción: en ningún instante hay
-- dos, ni cero.
--
-- Los parámetros nuevos tienen default, así que el frontend viejo sigue
-- llamando con 12 argumentos sin enterarse.

drop function if exists public.listar_bandeja_email(
  uuid, uuid, text, boolean, text, text, text, boolean, text, uuid, integer, integer);

create function public.listar_bandeja_email(
  p_company uuid,
  p_account uuid default null::uuid,
  p_q text default null::text,
  p_sin_leer boolean default false,
  p_estado text default null::text,
  p_asignado text default null::text,
  p_cliente text default null::text,
  p_adjuntos boolean default false,
  p_carpeta text default null::text,
  p_etiqueta uuid default null::uuid,
  p_limite integer default 25,
  p_offset integer default 0,
  p_sin_responder boolean default false,
  p_excluir_resueltos boolean default false)
 returns table(
   id uuid, account_id uuid, gmail_thread_id text, subject text, snippet text,
   last_message_at timestamp with time zone, last_message_from text, last_message_dir text,
   participants text[], message_count integer, has_attachments boolean,
   workflow_status text, assigned_to uuid, assigned_name text,
   customer_id uuid, customer_name text, vinculo_origen text,
   sin_leer boolean, eliminado boolean, etiquetas jsonb,
   total bigint, total_sin_leer bigint)
 language plpgsql stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  -- La misma puerta que abría la política, pero una sola vez.
  if p_company is null or not (p_company = any (app.current_email_company_ids())) then
    raise exception 'No podés ver el correo de esta empresa' using errcode = 'insufficient_privilege';
  end if;

  return query
  with filtro as (
    select nullif(
             '%' || replace(replace(replace(btrim(coalesce(p_q, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%',
             '%%') as patron
  ),
  base as (
    select t.id, t.account_id, t.gmail_thread_id, t.subject, t.snippet,
           t.last_message_at, t.last_message_from, t.last_message_dir,
           t.participants, t.message_count, t.has_attachments,
           coalesce(st.workflow_status, 'pendiente') as workflow_status,
           st.assigned_to, st.customer_id, st.vinculo_origen,
           coalesce(t.last_message_at, '-infinity'::timestamptz)
             > coalesce(r.last_read_at, '-infinity'::timestamptz) as sin_leer,
           st.deleted_at is not null as eliminado
      from email_threads t
      cross join filtro f
      /*
       * Las tres etiquetas de Gmail que sacan un hilo de la bandeja, resueltas
       * una sola vez. Van en un lateral y no repetidas en el `case` porque el
       * `case` ya tiene cinco ramas y cada una las necesitaba.
       */
      cross join lateral (
        select 'DRAFT' = any (t.gmail_labels) as es_borrador,
               'SPAM'  = any (t.gmail_labels) as es_spam,
               'TRASH' = any (t.gmail_labels) as es_papelera
      ) g
      left join email_thread_state st
             on st.account_id = t.account_id and st.gmail_thread_id = t.gmail_thread_id
      left join email_thread_reads r
             on r.account_id = t.account_id and r.gmail_thread_id = t.gmail_thread_id
            and r.user_id = (select auth.uid())
     where t.company_id = p_company
       and (p_account is null or t.account_id = p_account)
       /*
        * El borrador no aparece en NINGUNA carpeta: no es un hilo de la
        * bandeja y tiene su propia pantalla. Spam y papelera sí aparecen, en
        * Eliminados, para que nada quede inalcanzable.
        */
       and not g.es_borrador
       and case coalesce(p_carpeta, 'todos')
             when 'eliminados' then st.deleted_at is not null or g.es_spam or g.es_papelera
             when 'recibidos'  then st.deleted_at is null and not (g.es_spam or g.es_papelera)
                                    and 'INBOX' = any (t.gmail_labels)
             when 'enviados'   then st.deleted_at is null and not (g.es_spam or g.es_papelera)
                                    and 'SENT'  = any (t.gmail_labels)
             when 'archivados' then st.deleted_at is null and not (g.es_spam or g.es_papelera)
                                    and not 'INBOX' = any (t.gmail_labels)
                                    and not 'SENT'  = any (t.gmail_labels)
             else st.deleted_at is null and not (g.es_spam or g.es_papelera)
           end
       and (p_etiqueta is null or exists (
              select 1 from email_thread_labels tl
               where tl.account_id = t.account_id
                 and tl.gmail_thread_id = t.gmail_thread_id
                 and tl.label_id = p_etiqueta))
       and (not coalesce(p_adjuntos, false) or t.has_attachments)
       and (p_estado is null or coalesce(st.workflow_status, 'pendiente') = p_estado)
       -- Para contar: «no resuelto», no «igual a pendiente». Ver cabecera.
       and (not coalesce(p_excluir_resueltos, false)
            or coalesce(st.workflow_status, 'pendiente') <> 'resuelto')
       -- El último que habló fue el otro: el hilo espera una respuesta nuestra.
       and (not coalesce(p_sin_responder, false) or t.last_message_dir = 'in')
       and (p_asignado is null
            or (p_asignado = 'nadie' and st.assigned_to is null)
            or (p_asignado = 'yo'    and st.assigned_to = (select auth.uid()))
            or (st.assigned_to::text = p_asignado))
       and (p_cliente is null
            or (p_cliente = 'con' and st.customer_id is not null)
            or (p_cliente = 'sin' and st.customer_id is null))
       and (f.patron is null
            or t.subject ilike f.patron
            or t.snippet ilike f.patron
            or t.last_message_from ilike f.patron
            or array_to_string(t.participants, ' ') ilike f.patron
            or (st.customer_id is not null and exists (
                  select 1 from customers cb
                   where cb.id = st.customer_id
                     and (cb.legal_name ilike f.patron or cb.trade_name ilike f.patron))))
       and (not coalesce(p_sin_leer, false)
            or coalesce(t.last_message_at, '-infinity'::timestamptz)
               > coalesce(r.last_read_at, '-infinity'::timestamptz))
  ),
  pagina as (
    select b.*,
           count(*) over () as total,
           count(*) filter (where b.sin_leer) over () as total_sin_leer
      from base b
     order by b.last_message_at desc nulls last, b.id desc
     limit least(greatest(coalesce(p_limite, 25), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select p.id, p.account_id, p.gmail_thread_id, p.subject, p.snippet,
         p.last_message_at, p.last_message_from, p.last_message_dir,
         p.participants, p.message_count, p.has_attachments,
         p.workflow_status, p.assigned_to,
         (select pr.full_name from profiles pr where pr.id = p.assigned_to),
         p.customer_id,
         (select coalesce(c.trade_name, c.legal_name) from customers c where c.id = p.customer_id),
         p.vinculo_origen, p.sin_leer, p.eliminado,
         coalesce((
           select jsonb_agg(jsonb_build_object('id', l.id, 'nombre', l.nombre, 'color', l.color)
                            order by l.nombre)
             from email_thread_labels tl
             join email_labels l on l.id = tl.label_id
            where tl.account_id = p.account_id and tl.gmail_thread_id = p.gmail_thread_id
         ), '[]'::jsonb),
         p.total, p.total_sin_leer
    from pagina p
   order by p.last_message_at desc nulls last, p.id desc;
end $function$;

grant execute on function public.listar_bandeja_email(
  uuid, uuid, text, boolean, text, text, text, boolean, text, uuid, integer, integer,
  boolean, boolean) to authenticated;
