-- ===========================================================================
-- FASE 9 · EMAILS — ENTREGA 5 · envío, respuesta, reenvío y borradores
-- ===========================================================================
--
-- Migraciones:
--   fase9_emails_entrega5_envios          email_send_requests + secreto HMAC + RPC firmadas
--   fase9_emails_entrega5_eventos         nuevas acciones en email_events
--   fase9_emails_entrega5_autocompletar   autocompletar_destinatarios_email
--   fase9_emails_entrega5_exportar_clave_temporal  (temporal, borrada)
--   fase9_emails_entrega5_clave_servicio  clave_api_email_servicio (sólo service_role)
--   fase9_emails_entrega5_attempted_at    attempted_at + reservar_envio_email DEFINITIVA
--
-- Aplicadas en este orden. La última redefine reservar_envio_email: la versión
-- vigente es la del final de este archivo.
--
-- Gmail sigue siendo la fuente de verdad de borradores, enviados, hilos, ids y
-- adjuntos. Acá NO hay cuerpo, NO hay destinatarios, NO hay bytes, NO hay tabla
-- de borradores.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1 · Por qué una tabla nueva y no email_events
-- ---------------------------------------------------------------------------
-- email_events es una auditoría de HECHOS: una fila por algo que ya pasó, sin
-- estado y sin unicidad. La idempotencia necesita lo contrario: un RECLAMO único
-- por (cuenta, client_request_id) que se toma ANTES de llamar a Gmail y cambia
-- de estado después — reservado → enviado | fallido | incierto. Meter eso en
-- email_events obligaría a actualizar filas de auditoría y a inventar eventos
-- de «intento», que es deformarla.
--
-- La tabla guarda metadata mínima: ni cuerpo, ni destinatarios, ni asunto, ni
-- adjuntos. Sólo lo que hace falta para no mandar dos veces y para reconciliar.

create table public.email_send_requests (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id),
  account_id         uuid not null references email_accounts(id) on delete cascade,
  user_id            uuid not null references profiles(id),
  client_request_id  uuid not null,
  operation          text not null
                       check (operation in ('nuevo','responder','responder_todos','reenviar')),
  status             text not null default 'reservado'
                       check (status in ('reservado','enviado','fallido','incierto')),
  gmail_message_id   text,
  gmail_thread_id    text,
  error_code         text check (error_code is null or length(error_code) <= 60),
  intentos           int not null default 1 check (intentos >= 1),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  completed_at       timestamptz,

  constraint uq_email_send_request unique (account_id, client_request_id),
  -- «enviado» si y sólo si Gmail devolvió un id: no hay envío sin id real.
  constraint chk_email_send_enviado_con_id check ((status = 'enviado') = (gmail_message_id is not null))
);
comment on table public.email_send_requests is
  'Idempotencia de envíos. Un reclamo por (cuenta, client_request_id). Sin cuerpo, sin destinatarios, sin adjuntos. Sólo el servicio de la bandeja cambia su estado, con firma HMAC.';

create index idx_email_send_usuario on public.email_send_requests (user_id, created_at desc);
create index idx_email_send_cuenta  on public.email_send_requests (account_id, created_at desc);

create trigger trg_email_send_touch before update on public.email_send_requests
  for each row execute function app.touch_updated_at();
-- La empresa de la fila es la de su cuenta, no la que mande nadie.
create trigger trg_email_send_coherencia before insert or update on public.email_send_requests
  for each row execute function app.coherencia_empresa_email();

-- RLS activa y SIN policies, sin privilegios: nadie la lee ni la escribe desde
-- el cliente. Todo pasa por las RPC de abajo.
alter table public.email_send_requests enable row level security;
revoke all privileges on public.email_send_requests from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2 · El secreto compartido con el servicio público
-- ---------------------------------------------------------------------------
-- El servicio público NO tiene la service key de Supabase (decisión de la
-- entrega 4). Llama a las RPC con el JWT de la persona. Sin algo más, el mismo
-- navegador con ese JWT podría llamar «completar_envio_email» y marcar como
-- enviado algo que nunca salió, o fabricar un evento de envío.
--
-- La firma lo impide: las RPC que cambian el estado exigen un HMAC-SHA256 con un
-- secreto que sólo conocen la base y el servicio (Secret Manager
-- `email-api-hmac`). El mensaje firmado incluye auth.uid(): una firma no sirve
-- para otra persona.
--
-- La clave se GENERA acá adentro: no aparece en este archivo ni en ninguna
-- migración.

create table app.email_api_secretos (
  id         smallint primary key default 1 check (id = 1),
  clave      bytea not null,
  creado_en  timestamptz not null default now()
);
alter table app.email_api_secretos enable row level security;
revoke all privileges on app.email_api_secretos from public, anon, authenticated;
insert into app.email_api_secretos (clave) values (extensions.gen_random_bytes(32));

create or replace function app.firma_email_api_valida(p_mensaje text, p_firma text)
returns boolean language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(p_firma, '') ~ '^[0-9a-f]{64}$'
     and encode(extensions.hmac(convert_to(p_mensaje, 'UTF8'),
                                (select clave from app.email_api_secretos where id = 1),
                                'sha256'), 'hex') = p_firma;
$$;
revoke execute on function app.firma_email_api_valida(text, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3 · reservar_envio_email — el reclamo, ANTES de llamar a Gmail
-- ---------------------------------------------------------------------------
-- Una sentencia de INSERT ... ON CONFLICT DO NOTHING. Diez requests simultáneos
-- con el mismo client_request_id: uno inserta, los otros nueve esperan el índice
-- único y ven la fila existente. Sólo el que insertó (`nuevo = true`) llama a
-- Gmail.
--
-- `fallido` es el único estado que se puede volver a reservar: significa que
-- Gmail NO aceptó el envío (validación, 4xx definitivo, 429). `incierto` NO se
-- reintenta a ciegas: el servicio primero busca el Message-ID en Gmail.
--
-- Límite de seguridad, además de los de Workspace: 30 envíos por persona por hora
-- y 400 por cuenta por día.

create or replace function public.reservar_envio_email(
  p_account uuid, p_client_request_id uuid, p_operacion text, p_firma text)
returns table (id uuid, status text, nuevo boolean, gmail_message_id text,
               gmail_thread_id text, created_at timestamptz, intentos int)
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
declare
  v_uid     uuid := auth.uid();
  v_empresa uuid;
  v_fila    email_send_requests;
begin
  if v_uid is null then
    raise exception 'sin_sesion' using errcode = 'insufficient_privilege';
  end if;
  if not app.firma_email_api_valida(
       'reservar|' || p_account || '|' || p_client_request_id || '|' || coalesce(p_operacion, '') || '|' || v_uid,
       p_firma) then
    raise exception 'firma_invalida' using errcode = 'insufficient_privilege';
  end if;
  select company_id into v_empresa from email_accounts where email_accounts.id = p_account and active;
  if v_empresa is null or not (v_empresa = any (app.current_email_company_ids())) then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;

  select * into v_fila from email_send_requests r
   where r.account_id = p_account and r.client_request_id = p_client_request_id;

  if not found then
    if (select count(*) from email_send_requests r
         where r.user_id = v_uid and r.created_at > now() - interval '1 hour'
           and r.status <> 'fallido') >= 30 then
      raise exception 'limite_envios_usuario' using errcode = 'P0001';
    end if;
    if (select count(*) from email_send_requests r
         where r.account_id = p_account and r.created_at > now() - interval '1 day'
           and r.status <> 'fallido') >= 400 then
      raise exception 'limite_envios_cuenta' using errcode = 'P0001';
    end if;

    insert into email_send_requests (company_id, account_id, user_id, client_request_id, operation)
    values (v_empresa, p_account, v_uid, p_client_request_id, p_operacion)
    on conflict (account_id, client_request_id) do nothing
    returning * into v_fila;

    if found then
      return query select v_fila.id, v_fila.status, true, v_fila.gmail_message_id,
                          v_fila.gmail_thread_id, v_fila.created_at, v_fila.intentos;
      return;
    end if;
    -- Perdió la carrera: otro request insertó entre el select y el insert.
    select * into v_fila from email_send_requests r
     where r.account_id = p_account and r.client_request_id = p_client_request_id;
  end if;

  if v_fila.user_id <> v_uid then
    raise exception 'solicitud_de_otro_usuario' using errcode = 'insufficient_privilege';
  end if;
  if v_fila.operation <> p_operacion then
    raise exception 'operacion_distinta' using errcode = 'check_violation';
  end if;

  if v_fila.status = 'fallido' then
    update email_send_requests r
       set status = 'reservado', intentos = r.intentos + 1, error_code = null, completed_at = null
     where r.id = v_fila.id and r.status = 'fallido'
    returning * into v_fila;
    if found then
      return query select v_fila.id, v_fila.status, true, v_fila.gmail_message_id,
                          v_fila.gmail_thread_id, v_fila.created_at, v_fila.intentos;
      return;
    end if;
    select * into v_fila from email_send_requests r where r.id = v_fila.id;
  end if;

  return query select v_fila.id, v_fila.status, false, v_fila.gmail_message_id,
                      v_fila.gmail_thread_id, v_fila.created_at, v_fila.intentos;
end $$;

revoke execute on function public.reservar_envio_email(uuid, uuid, text, text) from public, anon;
grant execute on function public.reservar_envio_email(uuid, uuid, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 4 · completar_envio_email — el resultado, DESPUÉS de Gmail
-- ---------------------------------------------------------------------------
-- Transiciones válidas:
--   reservado → enviado | fallido | incierto
--   incierto  → enviado | incierto
--   enviado   → enviado  (mismo message id: repetición inocua)
-- Al pasar a `enviado` deja UN evento en email_events, en la misma transacción.

create or replace function public.completar_envio_email(
  p_request uuid, p_estado text, p_message_id text, p_thread_id text,
  p_error text, p_firma text)
returns table (id uuid, status text, gmail_message_id text, gmail_thread_id text)
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
declare
  v_uid   uuid := auth.uid();
  v_fila  email_send_requests;
  v_accion text;
begin
  if v_uid is null then
    raise exception 'sin_sesion' using errcode = 'insufficient_privilege';
  end if;
  if not app.firma_email_api_valida(
       'completar|' || p_request || '|' || coalesce(p_estado, '') || '|' || coalesce(p_message_id, '')
         || '|' || coalesce(p_thread_id, '') || '|' || coalesce(p_error, '') || '|' || v_uid,
       p_firma) then
    raise exception 'firma_invalida' using errcode = 'insufficient_privilege';
  end if;

  select * into v_fila from email_send_requests r where r.id = p_request and r.user_id = v_uid for update;
  if not found then
    raise exception 'solicitud_inexistente' using errcode = 'no_data_found';
  end if;

  if p_estado not in ('enviado', 'fallido', 'incierto') then
    raise exception 'estado_invalido' using errcode = 'check_violation';
  end if;
  if not (
       (v_fila.status = 'reservado' and p_estado in ('enviado', 'fallido', 'incierto'))
    or (v_fila.status = 'incierto'  and p_estado in ('enviado', 'incierto'))
    or (v_fila.status = 'enviado'   and p_estado = 'enviado' and v_fila.gmail_message_id = p_message_id)
  ) then
    raise exception 'transicion_invalida' using errcode = 'check_violation';
  end if;

  if v_fila.status = 'enviado' then
    return query select v_fila.id, v_fila.status, v_fila.gmail_message_id, v_fila.gmail_thread_id;
    return;
  end if;

  update email_send_requests r
     set status = p_estado,
         gmail_message_id = case when p_estado = 'enviado' then p_message_id else null end,
         gmail_thread_id = case when p_estado = 'enviado' then p_thread_id else r.gmail_thread_id end,
         error_code = case when p_estado = 'enviado' then null else left(p_error, 60) end,
         completed_at = case when p_estado in ('enviado', 'fallido') then now() else null end
   where r.id = v_fila.id
  returning * into v_fila;

  if p_estado = 'enviado' then
    v_accion := case v_fila.operation
                  when 'nuevo' then 'email_enviado'
                  when 'responder' then 'respuesta_enviada'
                  when 'responder_todos' then 'respuesta_a_todos_enviada'
                  when 'reenviar' then 'reenvio_enviado'
                end;
    insert into email_events (company_id, account_id, gmail_thread_id, action, actor, detalle)
    values (v_fila.company_id, v_fila.account_id, v_fila.gmail_thread_id, v_accion, v_uid,
            jsonb_build_object('gmail_message_id', v_fila.gmail_message_id,
                               'client_request_id', v_fila.client_request_id,
                               'intentos', v_fila.intentos));
  end if;

  return query select v_fila.id, v_fila.status, v_fila.gmail_message_id, v_fila.gmail_thread_id;
end $$;

revoke execute on function public.completar_envio_email(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.completar_envio_email(uuid, text, text, text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 5 · registrar_descarte_borrador_email
-- ---------------------------------------------------------------------------
-- Descartar un borrador lo borra de Gmail para siempre (drafts.delete no pasa
-- por la papelera). Es la única acción de borradores que deja evento: cada
-- autoguardado, no.

create or replace function public.registrar_descarte_borrador_email(
  p_account uuid, p_thread text, p_firma text)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_empresa uuid;
begin
  if v_uid is null or not app.firma_email_api_valida(
       'descartar|' || p_account || '|' || coalesce(p_thread, '') || '|' || v_uid, p_firma) then
    raise exception 'firma_invalida' using errcode = 'insufficient_privilege';
  end if;
  select company_id into v_empresa from email_accounts where id = p_account;
  if v_empresa is null or not (v_empresa = any (app.current_email_company_ids())) then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;
  insert into email_events (company_id, account_id, gmail_thread_id, action, actor, detalle)
  values (v_empresa, p_account, p_thread, 'borrador_descartado', v_uid, null);
end $$;

revoke execute on function public.registrar_descarte_borrador_email(uuid, text, text) from public, anon;
grant execute on function public.registrar_descarte_borrador_email(uuid, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 6 · Acciones nuevas en email_events
-- ---------------------------------------------------------------------------

alter table public.email_events drop constraint email_events_action_check;
alter table public.email_events add constraint email_events_action_check
  check (action in ('asignado','estado_cambiado','cliente_vinculado','cliente_desvinculado',
                    'email_enviado','nota_editada',
                    'respuesta_enviada','respuesta_a_todos_enviada','reenvio_enviado',
                    'borrador_descartado'));


-- ---------------------------------------------------------------------------
-- 7 · autocompletar_destinatarios_email
-- ---------------------------------------------------------------------------
-- Del CRM (contactos y emails de clientes) y del índice (participantes de hilos
-- ya vistos). Sin tabla de contactos nueva.
--
-- `clientes` cuenta en cuántos clientes aparece la dirección: la UI la muestra
-- como contexto y NUNCA como vínculo verificado. SECURITY INVOKER: un vendedor
-- no ve el índice, así que no recibe direcciones del historial.

create or replace function public.autocompletar_destinatarios_email(p_company uuid, p_q text)
returns table (direccion text, nombre text, cliente_id uuid, cliente_nombre text,
               fuente text, clientes int)
language sql stable security invoker
set search_path to 'public', 'pg_temp'
as $$
  with q as (
    select '%' || replace(replace(replace(lower(btrim(p_q)), '\', '\\'), '%', '\%'), '_', '\_') || '%' as patron
     where length(btrim(coalesce(p_q, ''))) >= 2
  ),
  crm as (
    select lower(btrim(cc.email)) as direccion, cc.full_name as nombre, cu.id as cliente_id,
           coalesce(cu.trade_name, cu.legal_name) as cliente_nombre, 'contacto' as fuente
      from customer_contacts cc
      join customers cu on cu.id = cc.customer_id
      cross join q
     where cu.company_id = p_company and cu.deleted_at is null and cc.email is not null
       and (lower(cc.email) like q.patron or lower(cc.full_name) like q.patron
            or lower(cu.legal_name) like q.patron or lower(coalesce(cu.trade_name, '')) like q.patron)
    union all
    select lower(btrim(e)), null, cu.id, coalesce(cu.trade_name, cu.legal_name), 'cliente'
      from customers cu
      cross join q
      cross join lateral unnest(cu.emails) e
     where cu.company_id = p_company and cu.deleted_at is null
       and (lower(e) like q.patron or lower(cu.legal_name) like q.patron
            or lower(coalesce(cu.trade_name, '')) like q.patron)
  ),
  historial as (
    select distinct lower(btrim(p)) as direccion
      from email_threads t
      cross join q
      cross join lateral unnest(t.participants) p
     where t.company_id = p_company and lower(p) like q.patron
     limit 20
  ),
  todo as (
    select c.direccion, c.nombre, c.cliente_id, c.cliente_nombre, c.fuente from crm c
     where position('@' in c.direccion) > 1
    union all
    select h.direccion, null, null, null, 'historial' from historial h
     where position('@' in h.direccion) > 1
       and not exists (select 1 from crm c where c.direccion = h.direccion)
  ),
  conteo as (
    select direccion, count(distinct cliente_id)::int as clientes from todo group by direccion
  )
  select distinct on (t.direccion) t.direccion, t.nombre, t.cliente_id, t.cliente_nombre, t.fuente, c.clientes
    from todo t join conteo c using (direccion)
   order by t.direccion, (t.fuente = 'contacto') desc, (t.fuente = 'cliente') desc
   limit 10;
$$;

revoke execute on function public.autocompletar_destinatarios_email(uuid, text) from public, anon;
grant execute on function public.autocompletar_destinatarios_email(uuid, text) to authenticated;

-- ===========================================================================
-- fase9_emails_entrega5_exportar_clave_temporal  (ya NO existe)
-- ===========================================================================
-- Se creó una función temporal para leer la clave una vez y se borró en la
-- migración siguiente. Queda registrada acá sólo por trazabilidad: no hay que
-- recrearla.

-- ===========================================================================
-- fase9_emails_entrega5_clave_servicio
-- ===========================================================================
-- La clave HMAC la conocen sólo la base y buscatools-erp-email-api (vía Secret
-- Manager). Esta función existe para cargar el secreto sin copiarlo a mano:
-- EXECUTE sólo para service_role, que ya puede leer todo igual (bypass RLS).
-- anon y authenticated no la pueden ejecutar.

drop function if exists public.exportar_clave_api_email_temporal();

create or replace function public.clave_api_email_servicio()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select encode(clave, 'hex') from app.email_api_secretos where id = 1 $$;

revoke all on function public.clave_api_email_servicio() from public, anon, authenticated;
grant execute on function public.clave_api_email_servicio() to service_role;

-- ===========================================================================
-- fase9_emails_entrega5_attempted_at
-- ===========================================================================
-- Hallazgo del primer envío real (13/9): Gmail REEMPLAZA el Message-ID que manda
-- el servicio, así que la reconciliación de un envío incierto no puede buscarlo
-- por Message-ID. Ahora busca en SENT la cabecera propia X-BT-Request-Id, dentro
-- de una ventana alrededor del ÚLTIMO intento. created_at no sirve de centro: una
-- fila «fallido» re-reservada horas después lo conserva. attempted_at se fija al
-- reservar y al re-reservar, y la RPC lo devuelve (el cambio de firma de retorno
-- obliga a DROP + CREATE; los permisos se vuelven a aplicar igual que antes).
-- Un conflicto (dos mensajes con el mismo request id) queda en error_code como
-- 'conflicto_request_id:N' con la fila en «incierto» — sin columna nueva.

alter table public.email_send_requests add column attempted_at timestamptz;
update public.email_send_requests set attempted_at = created_at where attempted_at is null;
alter table public.email_send_requests alter column attempted_at set not null,
                                        alter column attempted_at set default now();

drop function public.reservar_envio_email(uuid, uuid, text, text);

-- Versión DEFINITIVA: reemplaza a la de fase9_emails_entrega5_envios.
create function public.reservar_envio_email(p_account uuid, p_client_request_id uuid, p_operacion text, p_firma text)
returns table (id uuid, status text, nuevo boolean, gmail_message_id text,
               gmail_thread_id text, created_at timestamptz, intentos int, attempted_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
declare
  v_uid     uuid := auth.uid();
  v_empresa uuid;
  v_fila    email_send_requests;
begin
  if v_uid is null then
    raise exception 'sin_sesion' using errcode = 'insufficient_privilege';
  end if;
  if not app.firma_email_api_valida(
       'reservar|' || p_account || '|' || p_client_request_id || '|' || coalesce(p_operacion, '') || '|' || v_uid,
       p_firma) then
    raise exception 'firma_invalida' using errcode = 'insufficient_privilege';
  end if;
  select company_id into v_empresa from email_accounts where email_accounts.id = p_account and active;
  if v_empresa is null or not (v_empresa = any (app.current_email_company_ids())) then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;

  select * into v_fila from email_send_requests r
   where r.account_id = p_account and r.client_request_id = p_client_request_id;

  if not found then
    if (select count(*) from email_send_requests r
         where r.user_id = v_uid and r.created_at > now() - interval '1 hour'
           and r.status <> 'fallido') >= 30 then
      raise exception 'limite_envios_usuario' using errcode = 'P0001';
    end if;
    if (select count(*) from email_send_requests r
         where r.account_id = p_account and r.created_at > now() - interval '1 day'
           and r.status <> 'fallido') >= 400 then
      raise exception 'limite_envios_cuenta' using errcode = 'P0001';
    end if;

    insert into email_send_requests (company_id, account_id, user_id, client_request_id, operation)
    values (v_empresa, p_account, v_uid, p_client_request_id, p_operacion)
    on conflict (account_id, client_request_id) do nothing
    returning * into v_fila;

    if found then
      return query select v_fila.id, v_fila.status, true, v_fila.gmail_message_id,
                          v_fila.gmail_thread_id, v_fila.created_at, v_fila.intentos, v_fila.attempted_at;
      return;
    end if;
    select * into v_fila from email_send_requests r
     where r.account_id = p_account and r.client_request_id = p_client_request_id;
  end if;

  if v_fila.user_id <> v_uid then
    raise exception 'solicitud_de_otro_usuario' using errcode = 'insufficient_privilege';
  end if;
  if v_fila.operation <> p_operacion then
    raise exception 'operacion_distinta' using errcode = 'check_violation';
  end if;

  if v_fila.status = 'fallido' then
    update email_send_requests r
       set status = 'reservado', intentos = r.intentos + 1, error_code = null, completed_at = null,
           attempted_at = now()
     where r.id = v_fila.id and r.status = 'fallido'
    returning * into v_fila;
    if found then
      return query select v_fila.id, v_fila.status, true, v_fila.gmail_message_id,
                          v_fila.gmail_thread_id, v_fila.created_at, v_fila.intentos, v_fila.attempted_at;
      return;
    end if;
    select * into v_fila from email_send_requests r where r.id = v_fila.id;
  end if;

  return query select v_fila.id, v_fila.status, false, v_fila.gmail_message_id,
                      v_fila.gmail_thread_id, v_fila.created_at, v_fila.intentos, v_fila.attempted_at;
end $function$;

revoke all on function public.reservar_envio_email(uuid, uuid, text, text) from public, anon;
grant execute on function public.reservar_envio_email(uuid, uuid, text, text) to authenticated;

-- ===========================================================================
-- Estado final de la entrega (verificado contra la base)
-- ===========================================================================
--   email_send_requests  RLS activa, SIN policies; sin privilegios para anon/authenticated.
--                        Sólo se toca por las RPC firmadas.
--   app.email_api_secretos  RLS activa, SIN policies; sin privilegios.
--   reservar_envio_email, completar_envio_email, registrar_descarte_borrador_email
--                        SECURITY DEFINER; EXECUTE authenticated + service_role; exigen
--                        firma HMAC del servicio (la clave vive en Secret Manager
--                        como email-api-hmac y en app.email_api_secretos).
--   autocompletar_destinatarios_email  SECURITY INVOKER; EXECUTE authenticated.
--   clave_api_email_servicio           EXECUTE sólo service_role.
--   app.firma_email_api_valida         sin EXECUTE para nadie salvo el dueño.
