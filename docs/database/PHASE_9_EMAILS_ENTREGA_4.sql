-- ===========================================================================
-- FASE 9 · EMAILS — ENTREGA 4 · lo que la bandeja necesitó de la base
-- ===========================================================================
--
-- Migraciones, en orden:
--   fase9_emails_entrega4_bandeja       listar_bandeja_email (v1)
--   fase9_emails_entrega4_bandeja_lateral  listar_bandeja_email (v2, la vigente)
--   fase9_emails_entrega4_crm           sugerencias_cliente_email
--   fase9_emails_entrega4_asignables    usuarios_asignables_email
--   fase9_emails_entrega4_endurecer     las RPC del ERP validan que el hilo exista
--   fase9_emails_entrega4_realtime      tres tablas a la publicación
--
-- Ninguna tabla nueva, ninguna columna nueva, ninguna policy nueva. Sigue sin
-- haber cuerpos.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1 · listar_bandeja_email — el listado, paginado en el servidor
-- ---------------------------------------------------------------------------
-- Por qué una RPC y no un select con embed: el estado y la lectura se atan al
-- índice por (account_id, gmail_thread_id), sin FK — a propósito, para que el
-- estado sobreviva a un resync (entrega 3). PostgREST sólo embebe por FK, y los
-- filtros «sin leer», «sin asignar» y «sin cliente» son justamente sobre la
-- AUSENCIA de fila. Paginar bien exige resolverlos en el servidor.
--
-- SECURITY INVOKER: la RLS de las cinco tablas decide. Un vendedor la llama y
-- recibe cero filas, no un error — igual que un select.

-- Versión aplicada: fase9_emails_entrega4_bandeja_lateral. La primera versión
-- hacía LEFT JOIN contra customers y profiles para todo el índice: la policy de
-- customers llama a app.current_role() por fila, y la RPC tardaba 650–880 ms
-- contra un piso de red de ~185 ms. Ahora los nombres se resuelven sólo para
-- las filas de la página (25 búsquedas por PK) y la búsqueda por cliente sólo
-- mira hilos que TIENEN cliente. Medido después: 185–197 ms.

create or replace function public.listar_bandeja_email(
  p_company   uuid,
  p_account   uuid    default null,
  p_q         text    default null,
  p_sin_leer  boolean default false,
  p_estado    text    default null,
  -- null = todos · 'nadie' · 'yo' · el uuid de un usuario, como texto
  p_asignado  text    default null,
  -- null = todos · 'con' · 'sin'
  p_cliente   text    default null,
  p_adjuntos  boolean default false,
  p_limite    int     default 25,
  p_offset    int     default 0
)
returns table (
  id uuid, account_id uuid, gmail_thread_id text, subject text, snippet text,
  last_message_at timestamptz, last_message_from text, last_message_dir text,
  participants text[], message_count int, has_attachments boolean,
  workflow_status text, assigned_to uuid, assigned_name text,
  customer_id uuid, customer_name text, vinculo_origen text,
  sin_leer boolean, total bigint, total_sin_leer bigint
)
language sql stable security invoker
set search_path to 'public', 'pg_temp'
as $$
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
             > coalesce(r.last_read_at, '-infinity'::timestamptz) as sin_leer
      from email_threads t
      cross join filtro f
      left join email_thread_state st
             on st.account_id = t.account_id and st.gmail_thread_id = t.gmail_thread_id
      left join email_thread_reads r
             on r.account_id = t.account_id and r.gmail_thread_id = t.gmail_thread_id
            and r.user_id = (select auth.uid())
     where t.company_id = p_company
       and (p_account is null or t.account_id = p_account)
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
            -- El cliente se busca SÓLO entre los hilos que tienen uno.
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
     -- Desempate estable por id: dos hilos con el mismo instante no cambian
     -- de página entre un request y el siguiente.
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
         p.vinculo_origen, p.sin_leer, p.total, p.total_sin_leer
    from pagina p
   order by p.last_message_at desc nulls last, p.id desc;
$$;

revoke execute on function public.listar_bandeja_email(uuid, uuid, text, boolean, text, text, text, boolean, int, int)
  from public, anon;
grant execute on function public.listar_bandeja_email(uuid, uuid, text, boolean, text, text, text, boolean, int, int)
  to authenticated;


-- ---------------------------------------------------------------------------
-- 2 · sugerencias_cliente_email — el matching con el CRM, sin vincular nada
-- ---------------------------------------------------------------------------
-- Arquitectura, sección S:
--   exacto            la dirección coincide con UN solo cliente
--   sugerido_dominio  el dominio pertenece a UN solo cliente
--   ambiguo           varios clientes
--
-- DEVUELVE, NO ESCRIBE. La arquitectura aprobó auto-vincular el EXACTO, pero
-- hacerlo en el sync rompería la invariante probada de la entrega 3 —«el sync
-- nunca toca email_thread_state»—. Queda como sugerencia con un click.
--
-- Se excluyen la dirección del propio buzón, su dominio (son colegas, no
-- clientes) y los proveedores de correo públicos: un dominio gmail.com en la
-- ficha de un cliente apuntaría a cualquiera.

create or replace function public.sugerencias_cliente_email(p_account uuid, p_thread text)
returns table (
  customer_id   uuid,
  customer_name text,
  contact_id    uuid,
  contact_name  text,
  direccion     text,
  clase         text
)
language sql stable security invoker
set search_path to 'public', 'pg_temp'
as $$
  with hilo as (
    select t.company_id, t.participants, lower(a.email_address) as propia,
           split_part(lower(a.email_address), '@', 2) as dominio_propio
      from email_threads t
      join email_accounts a on a.id = t.account_id
     where t.account_id = p_account and t.gmail_thread_id = p_thread
  ),
  dirs as (
    select distinct lower(btrim(p)) as dir, split_part(lower(btrim(p)), '@', 2) as dominio
      from hilo h, unnest(h.participants) as p
     where position('@' in p) > 1
       and lower(btrim(p)) <> h.propia
       and split_part(lower(btrim(p)), '@', 2) <> h.dominio_propio
  ),
  exactos as (
    select d.dir, cu.id as customer_id, coalesce(cu.trade_name, cu.legal_name) as customer_name,
           cc.id as contact_id, cc.full_name as contact_name
      from dirs d
      join customer_contacts cc on lower(btrim(cc.email)) = d.dir
      join customers cu on cu.id = cc.customer_id
     where cu.company_id = (select company_id from hilo) and cu.deleted_at is null
    union
    select d.dir, cu.id, coalesce(cu.trade_name, cu.legal_name), null::uuid, null::text
      from dirs d
      join customers cu on d.dir = any (select lower(btrim(e)) from unnest(cu.emails) e)
     where cu.company_id = (select company_id from hilo) and cu.deleted_at is null
  ),
  exactos_clasificados as (
    -- Un cliente que matchea por contacto Y por su lista de emails aparece una
    -- sola vez, con el contacto.
    select distinct on (e.dir, e.customer_id)
           e.dir, e.customer_id, e.customer_name, e.contact_id, e.contact_name,
           case when n.clientes = 1 then 'exacto' else 'ambiguo' end as clase
      from exactos e
      join (select dir, count(distinct customer_id) as clientes from exactos group by dir) n using (dir)
     order by e.dir, e.customer_id, e.contact_id nulls last
  ),
  por_dominio as (
    select d.dir, cu.id as customer_id, coalesce(cu.trade_name, cu.legal_name) as customer_name
      from dirs d
      join customers cu on d.dominio = any (select lower(btrim(x)) from unnest(cu.email_domains) x)
     where cu.company_id = (select company_id from hilo) and cu.deleted_at is null
       and d.dir not in (select dir from exactos)
       and d.dominio not in ('gmail.com','googlemail.com','hotmail.com','hotmail.com.ar','outlook.com',
                             'outlook.com.ar','live.com','live.com.ar','yahoo.com','yahoo.com.ar',
                             'icloud.com','me.com','aol.com','protonmail.com','proton.me',
                             'fibertel.com.ar','speedy.com.ar','arnet.com.ar','ciudad.com.ar')
  ),
  dominio_unico as (
    select distinct dir, customer_id, customer_name from por_dominio
  ),
  dominio_clasificado as (
    select p.dir, p.customer_id, p.customer_name, null::uuid as contact_id, null::text as contact_name,
           case when n.clientes = 1 then 'sugerido_dominio' else 'ambiguo' end as clase
      from dominio_unico p
      join (select dir, count(*) as clientes from dominio_unico group by dir) n using (dir)
  )
  select * from (
    select customer_id, customer_name, contact_id, contact_name, dir, clase from exactos_clasificados
    union all
    select customer_id, customer_name, contact_id, contact_name, dir, clase from dominio_clasificado
  ) s
  order by case s.clase when 'exacto' then 0 when 'sugerido_dominio' then 1 else 2 end,
           s.customer_name, s.dir
  limit 20;
$$;

revoke execute on function public.sugerencias_cliente_email(uuid, text) from public, anon;
grant execute on function public.sugerencias_cliente_email(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 3 · usuarios_asignables_email — a quién se le puede asignar un hilo
-- ---------------------------------------------------------------------------
-- Hace falta porque la policy de company_memberships es
-- `user_id = auth.uid() OR app.is_admin(company_id)`: un EMPLOYEE no ve las
-- membresías de sus compañeros, así que no podría armar la lista. DEFINER, pero
-- sólo para quien ya puede usar Emails en esa empresa, y devuelve sólo id y
-- nombre de admin/employee activos — el mismo conjunto que acepta el trigger.

create or replace function public.usuarios_asignables_email(p_company uuid)
returns table (user_id uuid, full_name text)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select m.user_id, coalesce(nullif(btrim(p.full_name), ''), 'Usuario sin nombre')
    from company_memberships m
    left join profiles p on p.id = m.user_id
   where m.company_id = p_company
     and p_company = any (app.current_email_company_ids())
     and m.status = 'active'
     and m.role in ('admin', 'employee')
   order by 2;
$$;

revoke execute on function public.usuarios_asignables_email(uuid) from public, anon;
grant execute on function public.usuarios_asignables_email(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 4 · Endurecer las RPC del ERP
-- ---------------------------------------------------------------------------
-- Encontrado al auditar: las tres aceptaban un gmail_thread_id cualquiera y
-- creaban una fila de estado para un hilo que no existe. No filtraba nada —la
-- cuenta sí se validaba—, pero dejaba basura con aspecto de dato.
--
-- Ahora el hilo tiene que existir en el índice DE ESA CUENTA, o ya tener estado
-- (el caso de un estado legacy importado antes de que el índice lo cubra).
--
-- Y una acción que no cambia nada no deja evento: reasignar a la misma persona
-- no es una acción humana útil de auditar.

create or replace function app.hilo_email_existe(p_account uuid, p_thread text)
returns boolean language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (select 1 from email_threads where account_id = p_account and gmail_thread_id = p_thread)
      or exists (select 1 from email_thread_state where account_id = p_account and gmail_thread_id = p_thread);
$$;
revoke execute on function app.hilo_email_existe(uuid, text) from public, anon, authenticated;

create or replace function public.asignar_hilo_email(p_account uuid, p_thread text, p_usuario uuid default null)
returns email_thread_state
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_empresa uuid;
  v_previo  email_thread_state;
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

  select * into v_previo from email_thread_state
   where account_id = p_account and gmail_thread_id = p_thread;
  if found and v_previo.assigned_to is not distinct from p_usuario then
    return v_previo;
  end if;

  insert into email_thread_state (company_id, account_id, gmail_thread_id, assigned_to)
  values (v_empresa, p_account, p_thread, p_usuario)
  on conflict (account_id, gmail_thread_id)
    do update set assigned_to = excluded.assigned_to
  returning * into v_estado;

  insert into email_events (company_id, account_id, gmail_thread_id, action, actor, detalle)
  values (v_empresa, p_account, p_thread, 'asignado', auth.uid(),
          jsonb_build_object('assigned_to', p_usuario, 'anterior', v_previo.assigned_to,
                             'desasignado', p_usuario is null));
  return v_estado;
end $$;

create or replace function public.cambiar_estado_email(p_account uuid, p_thread text, p_estado text)
returns email_thread_state
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_empresa uuid;
  v_previo  email_thread_state;
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
  if p_estado is null or p_estado not in ('pendiente', 'en_proceso', 'resuelto') then
    raise exception 'Estado de trabajo inválido' using errcode = 'check_violation';
  end if;
  if not app.hilo_email_existe(p_account, p_thread) then
    raise exception 'El hilo no existe en esta cuenta de correo' using errcode = 'no_data_found';
  end if;

  select * into v_previo from email_thread_state
   where account_id = p_account and gmail_thread_id = p_thread;
  -- Sin fila, el hilo ya es 'pendiente': pasarlo a 'pendiente' no cambia nada.
  if coalesce(v_previo.workflow_status, 'pendiente') = p_estado then
    return v_previo;
  end if;

  insert into email_thread_state (company_id, account_id, gmail_thread_id, workflow_status)
  values (v_empresa, p_account, p_thread, p_estado)
  on conflict (account_id, gmail_thread_id)
    do update set workflow_status = excluded.workflow_status
  returning * into v_estado;

  insert into email_events (company_id, account_id, gmail_thread_id, action, actor, detalle)
  values (v_empresa, p_account, p_thread, 'estado_cambiado', auth.uid(),
          jsonb_build_object('workflow_status', p_estado,
                             'anterior', coalesce(v_previo.workflow_status, 'pendiente')));
  return v_estado;
end $$;

create or replace function public.vincular_cliente_email(
  p_account uuid, p_thread text, p_customer uuid default null,
  p_contacto uuid default null, p_origen text default 'manual')
returns email_thread_state
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_empresa uuid;
  v_previo  email_thread_state;
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
  if p_customer is not null and (p_origen is null or p_origen not in ('exacto','sugerido_dominio','ambiguo','manual')) then
    raise exception 'Origen de vínculo inválido' using errcode = 'check_violation';
  end if;
  if not app.hilo_email_existe(p_account, p_thread) then
    raise exception 'El hilo no existe en esta cuenta de correo' using errcode = 'no_data_found';
  end if;

  select * into v_previo from email_thread_state
   where account_id = p_account and gmail_thread_id = p_thread;
  if coalesce(v_previo.customer_id::text, '') = coalesce(p_customer::text, '')
     and coalesce(v_previo.customer_contact_id::text, '') = coalesce(p_contacto::text, '') then
    return v_previo;
  end if;

  -- El trigger app.coherencia_empresa_email rechaza un cliente o un contacto de
  -- otra empresa, y un contacto que no sea de ese cliente.
  insert into email_thread_state (company_id, account_id, gmail_thread_id,
                                  customer_id, customer_contact_id, vinculo_origen)
  values (v_empresa, p_account, p_thread, p_customer, p_contacto,
          case when p_customer is null then null else p_origen end)
  on conflict (account_id, gmail_thread_id)
    do update set customer_id = excluded.customer_id,
                  customer_contact_id = excluded.customer_contact_id,
                  vinculo_origen = excluded.vinculo_origen
  returning * into v_estado;

  insert into email_events (company_id, account_id, gmail_thread_id, action, actor, detalle)
  values (v_empresa, p_account, p_thread,
          case when p_customer is null then 'cliente_desvinculado' else 'cliente_vinculado' end,
          auth.uid(),
          jsonb_build_object('customer_id', p_customer, 'contact_id', p_contacto,
                             'origen', case when p_customer is null then null else p_origen end,
                             'anterior', v_previo.customer_id));
  return v_estado;
end $$;

-- Marcar leído sólo lo que el usuario puede ver en el índice. INVOKER: el
-- exists pasa por la RLS de email_threads, así que un hilo ajeno no deja fila.
create or replace function public.marcar_hilo_leido_email(p_account uuid, p_thread text)
returns void
language sql
set search_path to 'public', 'pg_temp'
as $$
  insert into email_thread_reads (account_id, gmail_thread_id, user_id, last_read_at)
  select p_account, p_thread, auth.uid(), now()
   where exists (select 1 from email_threads
                  where account_id = p_account and gmail_thread_id = p_thread)
  on conflict (account_id, gmail_thread_id, user_id) do update set last_read_at = now();
$$;


-- ---------------------------------------------------------------------------
-- 5 · Realtime
-- ---------------------------------------------------------------------------
-- Las tres que la bandeja escucha. email_events y email_sync_log NO: nadie
-- dibuja nada en vivo a partir de ellas.
--
-- postgres_changes evalúa la RLS de cada suscriptor con su JWT: un vendedor
-- suscripto recibe cero eventos, sin filtro en el frontend.

alter publication supabase_realtime add table public.email_threads;
alter publication supabase_realtime add table public.email_thread_state;
alter publication supabase_realtime add table public.email_thread_reads;
