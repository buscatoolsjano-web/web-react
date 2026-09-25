-- Fase 29 · E1 — La bandeja de correo dejaba de pagar RLS por fila.
--
-- `listar_bandeja_email` era la única RPC de listado que no era
-- `security definer`. Con RLS puesta, el LEFT JOIN contra
-- `email_thread_reads` obligaba a evaluar `app.puede_ver_cuenta_email(...)`
-- una vez POR FILA —y esa función adentro consulta `email_accounts` y
-- `company_memberships`—, así que 1.242 hilos salían ~2.500 consultas.
--
-- MEDIDO, no estimado:
--   · sin RLS (superusuario):            29 ms
--   · con RLS, desde el navegador:    4.400 ms  (4315 / 4665 / 4463)
--   · después de este cambio:           215 ms  (215 / 209 / 217)
--
-- Duele el doble porque el contador de no leídos del menú llama a esta misma
-- RPC (`contarSinLeer`, con p_limite 1, sólo para leer `total_sin_leer`), así
-- que los 4,4 s se pagaban en TODAS las pantallas, no sólo en Emails.
--
-- La autorización no se pierde: se hace una vez, arriba, con el mismo
-- conjunto que usaba la política (`app.current_email_company_ids()`, que es
-- admin + employee). Es el patrón que ya usan `listar_chats`,
-- `usuarios_para_chat` y el resto de los listados del ERP.
--
-- El cuerpo es idéntico al anterior: no cambia ni una fila del resultado.
-- Verificado en pantalla: 1242 hilos · 1233 sin leer, igual que antes.
--
-- Idempotente: se puede correr dos veces.

create or replace function public.listar_bandeja_email(
  p_company uuid,
  p_account uuid default null,
  p_q text default null,
  p_sin_leer boolean default false,
  p_estado text default null,
  p_asignado text default null,
  p_cliente text default null,
  p_adjuntos boolean default false,
  p_carpeta text default null,
  p_etiqueta uuid default null,
  p_limite integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid, account_id uuid, gmail_thread_id text, subject text, snippet text,
  last_message_at timestamptz, last_message_from text, last_message_dir text,
  participants text[], message_count integer, has_attachments boolean,
  workflow_status text, assigned_to uuid, assigned_name text,
  customer_id uuid, customer_name text, vinculo_origen text,
  sin_leer boolean, eliminado boolean, etiquetas jsonb,
  total bigint, total_sin_leer bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
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
      left join email_thread_state st
             on st.account_id = t.account_id and st.gmail_thread_id = t.gmail_thread_id
      left join email_thread_reads r
             on r.account_id = t.account_id and r.gmail_thread_id = t.gmail_thread_id
            and r.user_id = (select auth.uid())
     where t.company_id = p_company
       and (p_account is null or t.account_id = p_account)
       and case coalesce(p_carpeta, 'todos')
             when 'eliminados' then st.deleted_at is not null
             when 'recibidos'  then st.deleted_at is null and 'INBOX' = any (t.gmail_labels)
             when 'enviados'   then st.deleted_at is null and 'SENT'  = any (t.gmail_labels)
             else st.deleted_at is null
           end
       and (p_etiqueta is null or exists (
              select 1 from email_thread_labels tl
               where tl.account_id = t.account_id
                 and tl.gmail_thread_id = t.gmail_thread_id
                 and tl.label_id = p_etiqueta))
       and (not coalesce(p_adjuntos, false) or t.has_attachments)
       and (p_estado is null or coalesce(st.workflow_status, 'pendiente') = p_estado)
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
end $$;
