-- Fase 28 · E2 — Emails: Recibidos, Enviados, y poder eliminar.
--
-- La bandeja mostraba los 728 hilos juntos. Ahora se puede mirar por carpeta,
-- y sacar de la bandeja lo que no sirve.
--
-- DOS DECISIONES QUE CONVIENE SABER:
--
-- 1 · «Recibidos» y «Enviados» son las etiquetas de Gmail (INBOX / SENT), no
--     la dirección del último mensaje. Es lo que dice el buzón: un hilo
--     archivado en Gmail no está en Recibidos, igual que en Gmail.
--
--     Con los datos de hoy: 513 en INBOX, 81 en SENT, 53 en las dos (un hilo
--     que se contestó), y 187 en NINGUNA —archivados o con etiqueta propia—.
--     Por eso «Todos» sigue siendo la carpeta por defecto: si Recibidos y
--     Enviados fueran las únicas vistas, esos 187 hilos (26 %) no se verían
--     desde ninguna parte.
--
-- 2 · «Eliminar» saca el hilo de la bandeja del ERP. NO lo borra de Gmail:
--     el navegador nunca habla con Gmail, y escribir allá es del servicio de
--     correo, que no vive en este repo. Por eso se guarda como `deleted_at`
--     y hay carpeta «Eliminados» con «Restaurar»: nada se pierde.
--
-- Idempotente: se puede correr dos veces.

begin;

-- ── 1 · Dónde se anota que un hilo está fuera de la bandeja ───────────────
-- En `email_thread_state`, que es estado del ERP y sobrevive a la sync: si
-- fuera en `email_threads` la próxima corrida de Gmail lo pisaría.

alter table email_thread_state
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references profiles (id);

comment on column email_thread_state.deleted_at is
  'Fase 28 · E2: sacado de la bandeja del ERP. No es un borrado en Gmail.';

-- Las tres carpetas y el contador del menú preguntan siempre por esto.
create index if not exists email_thread_state_deleted_idx
  on email_thread_state (account_id, gmail_thread_id)
  where deleted_at is not null;

-- ── 2 · Los dos eventos nuevos en la auditoría ────────────────────────────

alter table email_events drop constraint if exists email_events_action_check;
alter table email_events add constraint email_events_action_check check (
  action = any (array[
    'asignado', 'estado_cambiado', 'cliente_vinculado', 'cliente_desvinculado',
    'email_enviado', 'nota_editada', 'respuesta_enviada',
    'respuesta_a_todos_enviada', 'reenvio_enviado', 'borrador_descartado',
    'hilo_eliminado', 'hilo_restaurado'
  ])
);

-- ── 3 · La bandeja, ahora por carpeta ─────────────────────────────────────
-- Se recrea entera porque cambia la firma. Lo único nuevo es `p_carpeta` y el
-- filtro por `deleted_at`: el resto es idéntico a la versión anterior.

drop function if exists public.listar_bandeja_email(
  uuid, uuid, text, boolean, text, text, text, boolean, integer, integer);
drop function if exists public.listar_bandeja_email(
  uuid, uuid, text, boolean, text, text, text, boolean, text, integer, integer);

create function public.listar_bandeja_email(
  p_company  uuid,
  p_account  uuid    default null,
  p_q        text    default null,
  p_sin_leer boolean default false,
  p_estado   text    default null,
  p_asignado text    default null,
  p_cliente  text    default null,
  p_adjuntos boolean default false,
  p_carpeta  text    default null,
  p_limite   integer default 25,
  p_offset   integer default 0
)
returns table (
  id uuid, account_id uuid, gmail_thread_id text, subject text, snippet text,
  last_message_at timestamptz, last_message_from text, last_message_dir text,
  participants text[], message_count integer, has_attachments boolean,
  workflow_status text, assigned_to uuid, assigned_name text,
  customer_id uuid, customer_name text, vinculo_origen text,
  sin_leer boolean, eliminado boolean, total bigint, total_sin_leer bigint
)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
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
       -- La carpeta. Lo eliminado sólo aparece en su propia carpeta: ni en
       -- «Todos», ni en los contadores, ni en una búsqueda.
       and case coalesce(p_carpeta, 'todos')
             when 'eliminados' then st.deleted_at is not null
             when 'recibidos'  then st.deleted_at is null and 'INBOX' = any (t.gmail_labels)
             when 'enviados'   then st.deleted_at is null and 'SENT'  = any (t.gmail_labels)
             else st.deleted_at is null
           end
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
            -- El cliente se busca SÓLO entre los hilos que tienen uno: un join
            -- contra los 1.010 clientes evaluaría su RLS fila por fila.
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
  -- Los nombres, recién sobre la página: 25 búsquedas por PK, no un join entero.
  select p.id, p.account_id, p.gmail_thread_id, p.subject, p.snippet,
         p.last_message_at, p.last_message_from, p.last_message_dir,
         p.participants, p.message_count, p.has_attachments,
         p.workflow_status, p.assigned_to,
         (select pr.full_name from profiles pr where pr.id = p.assigned_to),
         p.customer_id,
         (select coalesce(c.trade_name, c.legal_name) from customers c where c.id = p.customer_id),
         p.vinculo_origen, p.sin_leer, p.eliminado, p.total, p.total_sin_leer
    from pagina p
   order by p.last_message_at desc nulls last, p.id desc;
$function$;

comment on function public.listar_bandeja_email is
  'La bandeja. `p_carpeta`: todos (por defecto) | recibidos (INBOX) | enviados (SENT) | eliminados.';

grant execute on function public.listar_bandeja_email(
  uuid, uuid, text, boolean, text, text, text, boolean, text, integer, integer) to authenticated;

-- ── 4 · Eliminar y restaurar ──────────────────────────────────────────────

create or replace function public.eliminar_hilo_email(
  p_account  uuid,
  p_thread   text,
  p_eliminar boolean default true
)
returns email_thread_state
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_empresa uuid;
  v_estado  email_thread_state;
begin
  select company_id into v_empresa from email_accounts where id = p_account;
  if v_empresa is null then
    raise exception 'La cuenta de correo no existe' using errcode = 'no_data_found';
  end if;
  if not (v_empresa = any (app.current_email_company_ids())) then
    raise exception 'No tenés permiso para trabajar sobre esta cuenta de correo'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hilo_email_existe(p_account, p_thread) then
    raise exception 'El hilo no existe en esta cuenta de correo' using errcode = 'no_data_found';
  end if;

  insert into email_thread_state (company_id, account_id, gmail_thread_id, deleted_at, deleted_by)
  values (v_empresa, p_account, p_thread,
          case when p_eliminar then now() end,
          case when p_eliminar then auth.uid() end)
  on conflict (account_id, gmail_thread_id)
    do update set deleted_at = excluded.deleted_at,
                  deleted_by = excluded.deleted_by
  returning * into v_estado;

  insert into email_events (company_id, account_id, gmail_thread_id, action, actor)
  values (v_empresa, p_account, p_thread,
          case when p_eliminar then 'hilo_eliminado' else 'hilo_restaurado' end,
          auth.uid());

  return v_estado;
end $function$;

comment on function public.eliminar_hilo_email is
  'Fase 28 · E2: saca el hilo de la bandeja del ERP, o lo devuelve. NO toca Gmail.';

grant execute on function public.eliminar_hilo_email(uuid, text, boolean) to authenticated;

commit;
