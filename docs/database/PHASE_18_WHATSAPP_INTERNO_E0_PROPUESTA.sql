-- ============================================================================
-- Fase 18 · WhatsApp interno · Entrega 0 — PROPUESTA DE MIGRACIÓN
--
-- ⚠️ ESTE ARCHIVO NO SE APLICÓ. No se corrió ninguna migración en esta entrega.
--    Está acá para que se revise el cambio completo antes de tocar la base
--    productiva (uaxcfufvapzulqvynanp), y para que `RepositorioSupabase` —que
--    llama a estas cuatro RPC y todavía no funciona— tenga contra qué leerse.
--
-- Qué resuelve: hoy el modelo de grupos de la Fase 16 existe
-- (`conversation_type`, `provider_group_id`, `group_name`, `sender_wa_id`,
-- `sender_name`) pero NADA puede escribir en él desde un cliente que no sea la
-- Cloud API de Meta. Faltan seis cosas, y ninguna es cosmética:
--
--   1. `whatsapp_accounts` sólo admite `provider = 'meta_cloud'`, con
--      `waba_id` y `phone_number_id` NOT NULL. Una cuenta vinculada por QR no
--      tiene ninguno de los dos.
--   2. No hay allowlist de grupos. Sin ella, «qué grupos se leen» sería una
--      variable de entorno en un servidor, no un dato auditable.
--   3. `chk_wa_msg_idem` exige `client_request_id` para todo `out`. Un mensaje
--      que la propia cuenta escribió desde el celular se OBSERVA, no se encola:
--      nunca tuvo un `client_request_id`.
--   4. No hay dónde guardar una edición ni un borrado. En un grupo de trabajo
--      «lo edité» y «lo borré» pasan todo el tiempo, y un resumen de IA sobre
--      un texto que ya no dice eso es peor que no tener resumen.
--   5. No hay forma de saber que el `wa_id` que escribió es Facundo. Sin eso,
--      «quién se comprometió a qué» no se puede responder.
--   6. `app.encolar_analisis_whatsapp` descarta explícitamente todo lo que no
--      sea `individual`. La IA de la Fase 16 no vería un solo mensaje de grupo.
--
-- Cómo aplicarla el día que se decida: revisar, correr dentro de la
-- transacción de abajo contra una rama de Supabase primero, y recién después
-- contra producción. El rollback está al final, comentado.
--
-- Lo que esta propuesta NO hace, a propósito:
--   · no toca el número +54 9 11 2186-6133, ni la WABA, ni el webhook oficial;
--   · no cambia una sola policy de las conversaciones individuales;
--   · no habilita ningún grupo: la allowlist nace vacía y cada fila nace en
--     `enabled = false`;
--   · no manda nada a OpenAI: el análisis sigue pasando por la misma cola, con
--     el mismo debounce y los mismos topes de costo de la Fase 16.
-- ============================================================================

begin;

-- ── 1 · Una cuenta que no es de Meta ────────────────────────────────────────
-- `provider` pasa a admitir 'baileys'. `waba_id` y `phone_number_id` dejan de
-- ser NOT NULL a nivel columna, pero siguen siendo obligatorios PARA
-- `meta_cloud`: el CHECK nuevo dice exactamente eso, así que la cuenta oficial
-- no puede quedar a medio cargar por este cambio.
--
-- `uq_wa_account_phone` es UNIQUE sobre `phone_number_id`: en Postgres los
-- NULL no colisionan entre sí, así que pueden convivir varias cuentas baileys.
alter table whatsapp_accounts
  alter column waba_id drop not null,
  alter column phone_number_id drop not null;

alter table whatsapp_accounts
  drop constraint whatsapp_accounts_provider_check;

alter table whatsapp_accounts
  add constraint whatsapp_accounts_provider_check check (
    (provider = 'meta_cloud'
     and waba_id is not null and phone_number_id is not null)
    or
    (provider = 'baileys'
     and waba_id is null and phone_number_id is null)
  );

comment on column whatsapp_accounts.provider is
  'meta_cloud = API oficial (Fase 8). baileys = cliente NO oficial vinculado por QR (Fase 18), sólo para grupos internos.';

-- ── 2 · La allowlist de grupos ─────────────────────────────────────────────
-- El permiso vive en la base, no en el proceso. Tres razones: se audita, se
-- cambia sin reiniciar nada, y un listener mal configurado no puede ampliar su
-- propio alcance.
--
-- `enabled` y `ai_enabled` nacen en `false` y son independientes: un grupo se
-- puede guardar sin mandarlo al modelo. Eso permite mirar qué entra antes de
-- gastar un peso en tokens.
create table if not exists whatsapp_group_allowlist (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id),
  account_id        uuid not null references whatsapp_accounts(id),
  provider_group_id text not null,
  group_name        text,
  enabled           boolean not null default false,
  ai_enabled        boolean not null default false,
  notes             text,
  created_by        uuid references profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint uq_wa_allowlist unique (account_id, provider_group_id),
  -- La IA sobre un grupo que no se ingiere no tiene qué leer.
  constraint chk_wa_allowlist_ia check (not ai_enabled or enabled)
);

comment on table whatsapp_group_allowlist is
  'Qué grupos de WhatsApp se leen. Default NO: que la cuenta sea miembro de un grupo no alcanza, alguien lo tiene que habilitar.';

create trigger trg_wa_allowlist_touch before update on whatsapp_group_allowlist
  for each row execute function app.touch_updated_at();

alter table whatsapp_group_allowlist enable row level security;

-- Lo ve quien puede ver WhatsApp en la empresa; lo cambia sólo admin/employee.
-- Un vendedor no decide qué conversaciones internas se graban.
create policy wa_allowlist_select on whatsapp_group_allowlist
  for select to authenticated
  using (company_id = any (app.current_whatsapp_company_ids()));

create policy wa_allowlist_write on whatsapp_group_allowlist
  for all to authenticated
  using (company_id = any (app.current_whatsapp_admin_ids()))
  with check (company_id = any (app.current_whatsapp_admin_ids()));

-- ── 3 · Quiénes están en el grupo ──────────────────────────────────────────
-- Un grupo no tiene «un contacto»: tiene ocho. `whatsapp_conversations` sólo
-- puede guardar uno, así que los participantes van aparte.
create table if not exists whatsapp_conversation_participants (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id),
  conversation_id uuid not null references whatsapp_conversations(id) on delete cascade,
  wa_id           text not null,
  display_name    text,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  left_at         timestamptz,
  constraint uq_wa_participante unique (conversation_id, wa_id)
);

comment on column whatsapp_conversation_participants.display_name is
  'Cómo se llama HOY en WhatsApp. Cambia y no es identidad: la identidad es wa_id, y quién es esa persona lo dice employee_external_identities.';

alter table whatsapp_conversation_participants enable row level security;

create policy wa_participantes_select on whatsapp_conversation_participants
  for select to authenticated
  using (company_id = any (app.current_whatsapp_company_ids()));

-- ── 4 · Qué wa_id es qué empleado ──────────────────────────────────────────
-- Sin esto, la IA puede decir «alguien se comprometió a mandar la cotización»
-- y no mucho más. Es un mapeo explícito y cargado a mano: NO se infiere del
-- nombre visible, que lo cambia cualquiera desde el teléfono.
create table if not exists employee_external_identities (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id),
  profile_id   uuid not null references profiles(id),
  channel      text not null check (channel in ('whatsapp')),
  external_id  text not null,
  display_name text,
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now(),
  constraint uq_employee_identity unique (company_id, channel, external_id)
);

alter table employee_external_identities enable row level security;

create policy employee_identities_select on employee_external_identities
  for select to authenticated
  using (company_id = any (app.current_whatsapp_company_ids()));

create policy employee_identities_write on employee_external_identities
  for all to authenticated
  using (company_id = any (app.current_whatsapp_admin_ids()))
  with check (company_id = any (app.current_whatsapp_admin_ids()));

-- ── 5 · Ediciones, borrados y el mensaje propio observado ──────────────────
alter table whatsapp_messages
  add column if not exists edited_at        timestamptz,
  add column if not exists deleted_at       timestamptz,
  add column if not exists deleted_by_wa_id text;

comment on column whatsapp_messages.deleted_at is
  'Se marca, NO se borra la fila. Que el mensaje existió es parte de la historia; el contenido se oculta en la pantalla.';

-- `chk_wa_msg_idem` exigía `client_request_id` para todo `out`. Se le agrega
-- UNA rama: un `out` sin `client_request_id` es válido si trae
-- `provider_message_id`, o sea si es un mensaje OBSERVADO —ya existía cuando
-- lo vimos— y no uno encolado para enviar.
--
-- El camino de envío no se afloja: cuando el frontend encola un saliente
-- todavía no hay `provider_message_id` (lo devuelve el proveedor después), así
-- que esa fila sigue necesitando `client_request_id` y la idempotencia del
-- envío queda igual que en la Fase 8.
alter table whatsapp_messages drop constraint chk_wa_msg_idem;

alter table whatsapp_messages
  add constraint chk_wa_msg_idem check (
    (direction = 'in'  and client_request_id is null)
    or (direction = 'out' and client_request_id is not null)
    or (direction = 'out' and client_request_id is null and provider_message_id is not null)
  );

-- ── 6 · Las cuatro RPC que llama el listener ───────────────────────────────
-- Por qué RPC y no `insert` directo con service role: la validación —cuenta,
-- empresa, allowlist, idempotencia, forma de la conversación de grupo— queda
-- del lado del servidor, donde no la puede saltear un proceso mal configurado
-- ni un `.env` con el id equivocado. Es lo mismo que ya hace el webhook
-- oficial con `registrar_entrante_whatsapp`.
--
-- La empresa NUNCA viene del llamador: sale de `whatsapp_accounts`.

create or replace function public.ingresar_mensaje_grupo_whatsapp(
  p_account             uuid,
  p_group_id            text,
  p_provider_message_id text,
  p_sender_wa_id        text,
  p_direction           text,
  p_sent_at             timestamptz,
  p_message_type        text,
  p_group_name          text default null,
  p_sender_name         text default null,
  p_text                text default null,
  p_reply_to            text default null,
  p_media               jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'app', 'pg_temp'
as $function$
declare
  v_cuenta   whatsapp_accounts%rowtype;
  v_conv     whatsapp_conversations%rowtype;
  v_msg_id   uuid;
  v_media_id uuid;
  v_preview  text;
  v_cuando   timestamptz;
begin
  if p_direction not in ('in', 'out') then
    raise exception 'DIRECCION_INVALIDA' using errcode = '22023';
  end if;

  select * into v_cuenta from whatsapp_accounts where id = p_account and active;
  if not found then
    return jsonb_build_object('estado', 'cuenta_desconocida');
  end if;

  -- La allowlist otra vez, del lado del servidor. El listener ya filtró, pero
  -- el filtro que importa es el que no depende de que el proceso esté bien.
  if not exists (
    select 1 from whatsapp_group_allowlist
     where account_id = v_cuenta.id and provider_group_id = p_group_id and enabled
  ) then
    return jsonb_build_object('estado', 'grupo_no_autorizado');
  end if;

  v_cuando := coalesce(p_sent_at, now());

  -- `chk_wa_conv_tipo` obliga a que el contacto de una conversación de grupo
  -- sea 'group:' || provider_group_id. Se respeta acá y no en el llamador.
  insert into whatsapp_conversations (
    company_id, account_id, provider_contact_id,
    conversation_type, provider_group_id, group_name
  )
  values (
    v_cuenta.company_id, v_cuenta.id, 'group:' || p_group_id,
    'group', p_group_id, nullif(p_group_name, '')
  )
  on conflict (account_id, provider_contact_id) do update
     set group_name = coalesce(nullif(excluded.group_name, ''), whatsapp_conversations.group_name)
  returning * into v_conv;

  if p_media is not null then
    insert into whatsapp_media (
      company_id, conversation_id, provider_media_id, mime_type, file_name, size_bytes
    )
    values (
      v_cuenta.company_id, v_conv.id,
      nullif(p_media->>'provider_media_id', ''),
      coalesce(nullif(p_media->>'mime', ''), 'application/octet-stream'),
      nullif(p_media->>'file_name', ''),
      nullif(p_media->>'bytes', '')::bigint
    )
    returning id into v_media_id;
  end if;

  -- La idempotencia es del índice, no de una consulta previa: un reconnect
  -- reemite mensajes ya vistos, muchas veces en paralelo con el anterior.
  insert into whatsapp_messages (
    company_id, account_id, conversation_id, direction, message_type,
    text_body, provider_message_id, reply_to_provider_id,
    status, provider_timestamp, received_at, sent_at, media_id,
    sender_wa_id, sender_name
  )
  values (
    v_cuenta.company_id, v_cuenta.id, v_conv.id, p_direction, p_message_type,
    nullif(p_text, ''), p_provider_message_id, nullif(p_reply_to, ''),
    case when p_direction = 'in' then 'received' else 'sent' end,
    v_cuando, now(),
    case when p_direction = 'out' then v_cuando end,
    v_media_id,
    nullif(p_sender_wa_id, ''), nullif(p_sender_name, '')
  )
  on conflict (account_id, provider_message_id) where provider_message_id is not null
  do nothing
  returning id into v_msg_id;

  if v_msg_id is null then
    if v_media_id is not null then
      delete from whatsapp_media where id = v_media_id;
    end if;
    return jsonb_build_object('estado', 'duplicado', 'conversacion_id', v_conv.id);
  end if;

  if v_media_id is not null then
    update whatsapp_media set message_id = v_msg_id where id = v_media_id;
  end if;

  -- El participante queda registrado por el hecho de haber escrito, aunque la
  -- metadata del grupo nunca haya llegado.
  if nullif(p_sender_wa_id, '') is not null then
    insert into whatsapp_conversation_participants (
      company_id, conversation_id, wa_id, display_name
    )
    values (v_cuenta.company_id, v_conv.id, p_sender_wa_id, nullif(p_sender_name, ''))
    on conflict (conversation_id, wa_id) do update
       set display_name = coalesce(nullif(excluded.display_name, ''),
                                   whatsapp_conversation_participants.display_name),
           last_seen_at = greatest(whatsapp_conversation_participants.last_seen_at, v_cuando),
           left_at = null;
  end if;

  v_preview := left(coalesce(nullif(p_text, ''), '[' || p_message_type || ']'), 160);
  update whatsapp_conversations
     set last_message_at = greatest(coalesce(last_message_at, '-infinity'::timestamptz), v_cuando),
         last_message_preview = v_preview,
         last_message_dir = p_direction,
         last_inbound_at = case when p_direction = 'in'
              then greatest(coalesce(last_inbound_at, '-infinity'::timestamptz), v_cuando)
              else last_inbound_at end,
         last_outbound_at = case when p_direction = 'out'
              then greatest(coalesce(last_outbound_at, '-infinity'::timestamptz), v_cuando)
              else last_outbound_at end
   where id = v_conv.id;
  -- Ojo: NO se toca `service_window_expires_at`. La ventana de 24 h es una
  -- regla de la API oficial para poder responder; por un grupo leído con un
  -- cliente no oficial no se manda nada, así que fingir una ventana sería
  -- mentirle a la pantalla de Ventas.

  return jsonb_build_object(
    'estado', 'guardado',
    'conversacion_id', v_conv.id,
    'mensaje_id', v_msg_id,
    'media_id', v_media_id
  );
end;
$function$;

create or replace function public.editar_mensaje_grupo_whatsapp(
  p_account             uuid,
  p_provider_message_id text,
  p_edited_at           timestamptz,
  p_text                text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_n integer;
begin
  -- Sólo se edita lo que ya existe y no está borrado. Si la edición llegó
  -- antes que el mensaje —pasa en un reconnect— no se inventa una fila: se
  -- contesta `sin_efecto` y el mensaje original va a entrar por su lado.
  update whatsapp_messages
     set text_body = nullif(p_text, ''),
         edited_at = coalesce(p_edited_at, now())
   where account_id = p_account
     and provider_message_id = p_provider_message_id
     and deleted_at is null
     and coalesce(edited_at, '-infinity'::timestamptz) < coalesce(p_edited_at, now());
  get diagnostics v_n = row_count;

  return jsonb_build_object('estado', case when v_n > 0 then 'aplicada' else 'sin_efecto' end);
end;
$function$;

create or replace function public.borrar_mensaje_grupo_whatsapp(
  p_account             uuid,
  p_provider_message_id text,
  p_deleted_at          timestamptz,
  p_deleted_by          text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_n integer;
begin
  -- Se MARCA. El texto queda en la fila: lo que se decide en la pantalla es
  -- mostrarlo o no, y eso se puede cambiar de opinión. Borrarlo acá, no.
  update whatsapp_messages
     set deleted_at = coalesce(p_deleted_at, now()),
         deleted_by_wa_id = nullif(p_deleted_by, '')
   where account_id = p_account
     and provider_message_id = p_provider_message_id
     and deleted_at is null;
  get diagnostics v_n = row_count;

  return jsonb_build_object('estado', case when v_n > 0 then 'aplicada' else 'sin_efecto' end);
end;
$function$;

create or replace function public.registrar_grupo_whatsapp(
  p_account       uuid,
  p_group_id      text,
  p_group_name    text default null,
  p_participantes jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cuenta whatsapp_accounts%rowtype;
  v_conv   whatsapp_conversations%rowtype;
  v_n      integer := 0;
begin
  select * into v_cuenta from whatsapp_accounts where id = p_account and active;
  if not found then
    return jsonb_build_object('estado', 'cuenta_desconocida');
  end if;

  if not exists (
    select 1 from whatsapp_group_allowlist
     where account_id = v_cuenta.id and provider_group_id = p_group_id and enabled
  ) then
    return jsonb_build_object('estado', 'grupo_no_autorizado');
  end if;

  insert into whatsapp_conversations (
    company_id, account_id, provider_contact_id,
    conversation_type, provider_group_id, group_name
  )
  values (
    v_cuenta.company_id, v_cuenta.id, 'group:' || p_group_id,
    'group', p_group_id, nullif(p_group_name, '')
  )
  on conflict (account_id, provider_contact_id) do update
     set group_name = coalesce(nullif(excluded.group_name, ''), whatsapp_conversations.group_name)
  returning * into v_conv;

  insert into whatsapp_conversation_participants (company_id, conversation_id, wa_id, display_name)
  select v_cuenta.company_id, v_conv.id, p->>'wa_id', nullif(p->>'display_name', '')
    from jsonb_array_elements(coalesce(p_participantes, '[]'::jsonb)) p
   where nullif(p->>'wa_id', '') is not null
  on conflict (conversation_id, wa_id) do update
     set display_name = coalesce(nullif(excluded.display_name, ''),
                                 whatsapp_conversation_participants.display_name),
         last_seen_at = now(),
         left_at = null;
  get diagnostics v_n = row_count;

  -- Quien ya no figura en la lista se marca como que se fue. No se borra la
  -- fila: los mensajes que escribió siguen ahí y hay que poder nombrarlo.
  update whatsapp_conversation_participants
     set left_at = now()
   where conversation_id = v_conv.id
     and left_at is null
     and wa_id not in (
       select p->>'wa_id' from jsonb_array_elements(coalesce(p_participantes, '[]'::jsonb)) p
        where nullif(p->>'wa_id', '') is not null
     );

  return jsonb_build_object('estado', 'ok', 'conversacion_id', v_conv.id, 'participantes', v_n);
end;
$function$;

-- ── 7 · La IA deja de ignorar los grupos ───────────────────────────────────
-- El cambio es chico y es el que enciende todo: hoy la primera condición de
-- `encolar_analisis_whatsapp` descarta cualquier conversación que no sea
-- `individual`.
--
-- Un grupo entra sólo si su fila de la allowlist tiene `ai_enabled`. El resto
-- del trigger —el debounce, el `on conflict` de la cola, el `enabled and
-- auto_analyze` de `whatsapp_ai_settings`, el `raise warning` que no rompe la
-- inserción— queda exactamente igual.
create or replace function app.encolar_analisis_whatsapp()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_debounce integer;
  v_tipo     text;
  v_archivo  timestamptz;
  v_cuenta   uuid;
  v_grupo    text;
begin
  if not (
    (tg_op = 'INSERT' and new.direction = 'in')
    or (new.direction = 'out' and new.status = 'sent'
        and (tg_op = 'INSERT' or old.status is distinct from 'sent'))
  ) then
    return null;
  end if;

  begin
    select analysis_debounce_seconds into v_debounce
      from whatsapp_ai_settings
     where company_id = new.company_id and enabled and auto_analyze;
    if v_debounce is null then
      return null;
    end if;

    select conversation_type, archived_at, account_id, provider_group_id
      into v_tipo, v_archivo, v_cuenta, v_grupo
      from whatsapp_conversations where id = new.conversation_id;
    if v_archivo is not null then
      return null;
    end if;

    if v_tipo = 'group' then
      -- Guardar un grupo y analizarlo son dos permisos distintos.
      if not exists (
        select 1 from whatsapp_group_allowlist
         where account_id = v_cuenta and provider_group_id = v_grupo
           and enabled and ai_enabled
      ) then
        return null;
      end if;
    elsif v_tipo is distinct from 'individual' then
      return null;
    end if;

    insert into whatsapp_ai_analysis_queue as q (
      conversation_id, company_id, status, requested_at, not_before
    ) values (
      new.conversation_id, new.company_id, 'pending', clock_timestamp(),
      clock_timestamp() + make_interval(secs => v_debounce)
    )
    on conflict (conversation_id) do update set
      requested_at = excluded.requested_at,
      status       = case when q.status in ('done', 'cancelled') then 'pending' else q.status end,
      attempts     = case when q.status in ('done', 'cancelled') then 0 else q.attempts end,
      last_error   = case when q.status in ('done', 'cancelled') then null else q.last_error end,
      not_before   = case when q.status = 'failed' then q.not_before
                          when q.status in ('done', 'cancelled') then excluded.not_before
                          else greatest(q.not_before, excluded.not_before) end,
      updated_at   = now();
  exception when others then
    raise warning 'encolar_analisis_whatsapp: % %', sqlstate, left(sqlerrm, 120);
  end;
  return null;
end;
$function$;

-- ── 8 · Permisos ───────────────────────────────────────────────────────────
-- Las cuatro RPC las llama UN proceso con service role. No las llama el
-- navegador, y por eso `authenticated` no las tiene: un token de usuario no
-- debería poder inventar mensajes en un grupo.
revoke execute on function public.ingresar_mensaje_grupo_whatsapp(
  uuid, text, text, text, text, timestamptz, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.editar_mensaje_grupo_whatsapp(uuid, text, timestamptz, text)
  from public, anon, authenticated;
revoke execute on function public.borrar_mensaje_grupo_whatsapp(uuid, text, timestamptz, text)
  from public, anon, authenticated;
revoke execute on function public.registrar_grupo_whatsapp(uuid, text, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.ingresar_mensaje_grupo_whatsapp(
  uuid, text, text, text, text, timestamptz, text, text, text, text, text, jsonb) to service_role;
grant execute on function public.editar_mensaje_grupo_whatsapp(uuid, text, timestamptz, text)
  to service_role;
grant execute on function public.borrar_mensaje_grupo_whatsapp(uuid, text, timestamptz, text)
  to service_role;
grant execute on function public.registrar_grupo_whatsapp(uuid, text, text, jsonb)
  to service_role;

-- Las tablas nuevas se leen con RLS desde el frontend; la escritura de la
-- allowlist y de las identidades pasa por las policies de arriba.
grant select on whatsapp_conversation_participants to authenticated;
grant select, insert, update, delete on whatsapp_group_allowlist to authenticated;
grant select, insert, update, delete on employee_external_identities to authenticated;

commit;

-- ============================================================================
-- ROLLBACK
--
-- Sirve mientras no haya mensajes de grupo guardados. Después, tirar las
-- columnas `edited_at` / `deleted_at` es perder información real: en ese caso
-- lo correcto es apagar el listener (`LISTENER_ENABLED=false`) y poner la
-- allowlist en `enabled = false`, que deja de ingerir sin romper nada.
--
-- begin;
--   drop function if exists public.ingresar_mensaje_grupo_whatsapp(
--     uuid, text, text, text, text, timestamptz, text, text, text, text, text, jsonb);
--   drop function if exists public.editar_mensaje_grupo_whatsapp(uuid, text, timestamptz, text);
--   drop function if exists public.borrar_mensaje_grupo_whatsapp(uuid, text, timestamptz, text);
--   drop function if exists public.registrar_grupo_whatsapp(uuid, text, text, jsonb);
--
--   -- Y volver `app.encolar_analisis_whatsapp` a su versión anterior, que está
--   -- en docs/database/PHASE_16_WHATSAPP_IA.sql.
--
--   drop table if exists employee_external_identities;
--   drop table if exists whatsapp_conversation_participants;
--   drop table if exists whatsapp_group_allowlist;
--
--   alter table whatsapp_messages
--     drop column if exists edited_at,
--     drop column if exists deleted_at,
--     drop column if exists deleted_by_wa_id;
--
--   alter table whatsapp_messages drop constraint chk_wa_msg_idem;
--   alter table whatsapp_messages add constraint chk_wa_msg_idem check (
--     (direction = 'out' and client_request_id is not null)
--     or (direction = 'in' and client_request_id is null));
--
--   alter table whatsapp_accounts drop constraint whatsapp_accounts_provider_check;
--   alter table whatsapp_accounts add constraint whatsapp_accounts_provider_check
--     check (provider = 'meta_cloud');
--   alter table whatsapp_accounts
--     alter column waba_id set not null,
--     alter column phone_number_id set not null;
-- commit;
-- ============================================================================
