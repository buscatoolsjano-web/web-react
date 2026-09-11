-- ===========================================================================
-- FASE 8 · WHATSAPP — SCHEMA EJECUTADO
-- ===========================================================================
--
--   ██  E S T O   S Í   S E   A P L I C Ó  ██
--
-- Estado final de la base después de la entrega 1, verificado contra
-- information_schema, pg_policy, pg_class.relacl y pg_publication_tables.
--
-- La propuesta previa quedó como histórica en PHASE_8_WHATSAPP_PROPOSAL.sql.
-- Donde este archivo difiere de aquélla, manda éste: lo que está acá es lo que
-- hay en la base.
--
-- Migraciones aplicadas, en orden:
--   fase8_whatsapp_entrega1_tablas
--   fase8_whatsapp_entrega1_integridad
--   fase8_whatsapp_entrega1_rls
--   fase8_whatsapp_entrega1_rpc
--   fase8_whatsapp_entrega1_storage_realtime
--   fase8_whatsapp_entrega1_fix_trigger_compartido      ← bug encontrado y corregido
--   fase8_whatsapp_entrega1_fix_execute_helpers         ← bug encontrado y corregido
--   fase8_whatsapp_entrega1_cerrar_execute_publico
--   fase8_whatsapp_entrega1_rls_initplan
--
-- Documentación de Meta consultada el 2026-09-11.
-- Todavía NO existe: app de Meta, número registrado, token, webhook, bandeja
-- React ni envío de mensajes. Esto es sólo la base sobre la que se construye.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0 · Teléfonos: una sola normalización para todo el módulo
-- ---------------------------------------------------------------------------
-- El legacy tenía TRES tratamientos distintos y por eso nada cruzaba con el
-- CRM. Devuelve NULL cuando no se puede determinar: es preferible un hueco
-- honesto a un E.164 inventado que después alguien cruza con otro cliente.

create or replace function app.normalizar_telefono(p_crudo text)
returns text language sql immutable
set search_path to 'public', 'pg_temp'
as $$
  select case
    when length(regexp_replace(coalesce(p_crudo,''), '\D', '', 'g')) between 8 and 15
      then '+' || regexp_replace(p_crudo, '\D', '', 'g')
    else null
  end;
$$;

-- Los últimos ocho dígitos: la única forma de cruzar +54 9 11 …, 011 … y 11…
-- contra los teléfonos que hay cargados.
create or replace function app.cola_telefono(p_crudo text)
returns text language sql immutable
set search_path to 'public', 'pg_temp'
as $$
  select nullif(right(regexp_replace(coalesce(p_crudo,''), '\D', '', 'g'), 8), '');
$$;


-- ---------------------------------------------------------------------------
-- 1 · whatsapp_accounts — un número de WhatsApp de una empresa
-- ---------------------------------------------------------------------------
-- NUNCA guarda access token, app secret ni verify token: esos viven sólo como
-- secretos de las Edge Functions.

create table whatsapp_accounts (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id),
  provider              text not null default 'meta_cloud' check (provider in ('meta_cloud')),
  waba_id               text not null,
  phone_number_id       text not null,
  display_phone_number  text not null,
  display_name          text,
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint uq_wa_account_phone unique (phone_number_id)
);
create index idx_wa_accounts_company on whatsapp_accounts (company_id) where active;
create trigger trg_wa_accounts_touch before update on whatsapp_accounts
  for each row execute function app.touch_updated_at();


-- ---------------------------------------------------------------------------
-- 2 · whatsapp_conversations — la unidad de la bandeja
-- ---------------------------------------------------------------------------
-- La identidad es (account_id, provider_contact_id), NUNCA el teléfono:
-- phone_e164 puede quedar en null y la conversación existe igual. Es la
-- lección de los @lid del legacy, donde 5 de 8 chats no tenían teléfono usable.

create table whatsapp_conversations (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id),
  account_id            uuid not null references whatsapp_accounts(id),
  provider_contact_id   text not null,
  phone_raw             text,
  phone_e164            text,
  profile_name          text,
  customer_id           uuid references customers(id),
  customer_contact_id   uuid references customer_contacts(id),
  vinculo_origen        text check (vinculo_origen in ('exacto','normalizado','manual')),
  -- Clave de AUTORIZACIÓN del salesperson, no sólo un dato de trabajo. Por eso
  -- el cliente no tiene UPDATE sobre esta tabla.
  assigned_to           uuid references profiles(id),
  archived_at           timestamptz,
  last_message_at       timestamptz,
  last_message_preview  text,
  last_message_dir      text check (last_message_dir in ('in','out')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint uq_wa_conv_contacto unique (account_id, provider_contact_id),
  constraint chk_wa_conv_vinculo check (customer_id is null or vinculo_origen is not null),
  constraint chk_wa_conv_contacto_con_cliente check (customer_contact_id is null or customer_id is not null)
);
create index idx_wa_conv_bandeja on whatsapp_conversations
  (company_id, last_message_at desc nulls last) where archived_at is null;
create index idx_wa_conv_asignada on whatsapp_conversations (assigned_to) where assigned_to is not null;
create index idx_wa_conv_cliente on whatsapp_conversations (customer_id) where customer_id is not null;
create index idx_wa_conv_telefono on whatsapp_conversations (phone_e164) where phone_e164 is not null;
create trigger trg_wa_conv_touch before update on whatsapp_conversations
  for each row execute function app.touch_updated_at();


-- ---------------------------------------------------------------------------
-- 3 · whatsapp_messages — el hilo Y la cola de salida
-- ---------------------------------------------------------------------------
-- No hay whatsapp_outbox: separarlas agrega un join para dibujar el hilo y un
-- instante en que el mensaje existe de un lado y no del otro.

create table whatsapp_messages (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id),
  account_id            uuid not null references whatsapp_accounts(id),
  conversation_id       uuid not null references whatsapp_conversations(id),

  direction             text not null check (direction in ('in','out')),
  message_type          text not null,
  text_body             text,
  caption               text,

  provider_message_id   text,
  reply_to_provider_id  text,                 -- el context.id de Meta

  status                text not null default 'pending',
  client_request_id     uuid,
  attempts              int not null default 0 check (attempts >= 0),
  next_attempt_at       timestamptz,
  claimed_at            timestamptz,

  sent_at               timestamptz,
  delivered_at          timestamptz,
  read_at               timestamptz,
  failed_at             timestamptz,
  provider_status       text,
  error_code            int,                  -- Meta pide construir la lógica
  error_details         text,                 -- sobre code y error_data.details

  provider_timestamp    timestamptz,
  received_at           timestamptz,
  media_id              uuid references whatsapp_media(id),
  created_by            uuid references profiles(id),
  created_at            timestamptz not null default now(),

  -- CORRECCIÓN respecto de la propuesta: allí provider_timestamp era NOT NULL y
  -- el hilo se ordenaba por él. Pero un saliente todavía no aceptado por Meta
  -- NO TIENE provider_timestamp, y aun así tiene que aparecer en su lugar del
  -- hilo. Ahora es nullable y el orden sale de esta columna derivada.
  ordenado_en           timestamptz generated always as (coalesce(provider_timestamp, created_at)) stored,

  -- Meta permite que un mismo mensaje dispare un evento de éxito Y uno de fallo
  -- (distintos dispositivos). Por eso cada estado tiene SU columna y lo que ve
  -- el usuario se deriva por precedencia, en vez de pisarse con el último
  -- webhook que llegue. Si se entregó y después falló en otro dispositivo,
  -- sigue diciendo delivered: llegó.
  estado_visible        text generated always as (
    case
      when direction = 'in'          then 'received'
      when read_at      is not null  then 'read'
      when delivered_at is not null  then 'delivered'
      when failed_at    is not null  then 'failed'
      when sent_at      is not null  then 'sent'
      when status = 'sending'        then 'sending'
      else 'pending'
    end) stored,

  -- Un entrante NUNCA entra en la cola de salida, y un saliente siempre nace en ella.
  constraint chk_wa_msg_estado check (
    (direction = 'in'  and status = 'received')
    or (direction = 'out' and status in ('pending','sending','sent','failed'))),
  constraint chk_wa_msg_idem check (
    (direction = 'out' and client_request_id is not null)
    or (direction = 'in' and client_request_id is null)),
  constraint chk_wa_msg_entrante_sellado check (direction = 'out' or provider_timestamp is not null)
);

-- IDEMPOTENCIA ENTRANTE. Meta reintenta durante 36 horas; un webhook repetido
-- no puede duplicar el mensaje. Acotada POR CUENTA y no global a propósito: la
-- documentación describe el wamid como «a unique ID» pero NO publica garantía
-- explícita de unicidad entre cuentas distintas. Acotarlo es correcto bajo las
-- dos lecturas y no cuesta nada.
create unique index uq_wa_msg_provider on whatsapp_messages (account_id, provider_message_id)
  where provider_message_id is not null;
-- IDEMPOTENCIA SALIENTE. Dos pestañas o un doble clic producen UNA fila.
create unique index uq_wa_msg_cliente on whatsapp_messages (account_id, client_request_id)
  where client_request_id is not null;

create index idx_wa_msg_hilo on whatsapp_messages (conversation_id, ordenado_en desc, id desc);
create index idx_wa_msg_cola on whatsapp_messages (next_attempt_at) where status = 'pending';
create index idx_wa_msg_trabados on whatsapp_messages (claimed_at) where status = 'sending';
create index idx_wa_msg_media on whatsapp_messages (media_id) where media_id is not null;


-- ---------------------------------------------------------------------------
-- 4 · whatsapp_media — metadata; el archivo va a Storage
-- ---------------------------------------------------------------------------
-- El legacy guardaba 16,6 MB de base64 dentro de Postgres y los servía enteros
-- a cualquiera. Tabla aparte y no columnas en messages porque la media existe
-- ANTES y DESPUÉS del mensaje.

create table whatsapp_media (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id),
  conversation_id       uuid not null references whatsapp_conversations(id),
  message_id            uuid references whatsapp_messages(id),
  provider_media_id     text,
  mime_type             text not null,
  file_name             text,
  size_bytes            bigint check (size_bytes is null or size_bytes >= 0),
  sha256                text,
  storage_path          text,
  status                text not null default 'pendiente'
                          check (status in ('pendiente','descargada','fallida','vencida')),
  attempts              int not null default 0 check (attempts >= 0),
  error_details         text,
  provider_expires_at   timestamptz,   -- los 7 días del media id del webhook
  -- Retención propia: 180 días. La columna existe desde el día 1 para que la
  -- fecha quede escrita en cada archivo; el proceso que borra NO se construyó.
  media_expires_at      timestamptz not null default (now() + interval '180 days'),
  created_at            timestamptz not null default now(),
  downloaded_at         timestamptz,
  constraint chk_wa_media_ruta check (status <> 'descargada' or storage_path is not null)
);
-- conversation_id además de message_id: la media entrante existe ANTES que su
-- mensaje, y la RLS necesita un padre que exista siempre.
create index idx_wa_media_conversacion on whatsapp_media (conversation_id);
create index idx_wa_media_mensaje on whatsapp_media (message_id) where message_id is not null;
create index idx_wa_media_cola on whatsapp_media (created_at) where status = 'pendiente';
create index idx_wa_media_retencion on whatsapp_media (media_expires_at) where status = 'descargada';

-- BACKLOG, deliberadamente sin implementar: marcar una media como conservable
-- (`retain` / `business_record`). No se agrega hoy porque no hay pantalla que
-- la escriba ni borrado que la lea, y una columna que nadie escribe ni lee es
-- ruido. El día que exista el borrado es un `alter table` de un segundo.


-- ---------------------------------------------------------------------------
-- 5 · whatsapp_conversation_reads — el no leído, POR USUARIO
-- ---------------------------------------------------------------------------
-- El legacy tenía un contador global: si Juan abría un chat, se apagaba para
-- todos. `last_read_at` sobre `last_read_message_id` porque se compara contra
-- ordenado_en sin joins y no depende de que ninguna fila siga existiendo.

create table whatsapp_conversation_reads (
  conversation_id       uuid not null references whatsapp_conversations(id) on delete cascade,
  user_id               uuid not null references profiles(id),
  last_read_at          timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
-- La policy filtra por user_id y la PK es (conversation_id, user_id), que no
-- lo cubre.
create index idx_wa_reads_usuario on whatsapp_conversation_reads (user_id);


-- ---------------------------------------------------------------------------
-- 6 · whatsapp_webhook_events — crudo, para depurar
-- ---------------------------------------------------------------------------
-- Retención conceptual de 14 días: un problema de webhooks se nota en horas o
-- días, no en semanas, y catorce cubren dos fines de semana largos y una vuelta
-- de vacaciones.
--
-- DEUDA OPERACIONAL DECLARADA: el proceso que borra NO existe. No se inventó un
-- cron sólo para esta entrega. Hasta que exista, la tabla crece sin límite —
-- hoy con 0 filas, y sin webhook conectado no puede crecer.

create table whatsapp_webhook_events (
  id                    bigserial primary key,
  account_id            uuid references whatsapp_accounts(id),
  provider_event_id     text,
  event_type            text,
  payload               jsonb not null,
  signature_ok          boolean not null,
  processed_at          timestamptz,
  error_details         text,
  received_at           timestamptz not null default now(),
  constraint uq_wa_event unique (provider_event_id),
  -- Para depurar alcanza con el sobre. Si alguien intenta volcar un adjunto en
  -- base64 acá, esto lo frena: la media va a Storage, no a un jsonb.
  constraint chk_wa_event_tamano check (octet_length(payload::text) <= 262144)
);
create index idx_wa_event_retencion on whatsapp_webhook_events (received_at);
create index idx_wa_event_sin_procesar on whatsapp_webhook_events (received_at) where processed_at is null;

-- Cuando exista el cron:
-- delete from whatsapp_webhook_events where received_at < now() - interval '14 days';


-- ---------------------------------------------------------------------------
-- 7 · Integridad que un FK no alcanza a expresar
-- ---------------------------------------------------------------------------
-- La lección de O1 (Mantenimiento): una fila hija NO se valida por el
-- company_id que manda el cliente, sino contra el de su padre.
--
-- BUG ENCONTRADO Y CORREGIDO: la primera versión hacía
-- `tg_table_name = 'whatsapp_media' and new.message_id is not null` en un solo
-- if. plpgsql compila la expresión COMPLETA antes de evaluarla y no
-- cortocircuita, así que intentaba resolver new.message_id también para una
-- conversación —que no tiene esa columna— y reventaba con
-- «record "new" has no field "message_id"». Cada referencia a una columna que
-- no existe en las tres tablas tiene que quedar DENTRO de la rama de su tabla.

create or replace function app.coherencia_empresa_whatsapp()
returns trigger language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_empresa_padre uuid;
  v_cliente_empresa uuid;
  v_contacto_cliente uuid;
  v_contacto_empresa uuid;
  v_cuenta_padre uuid;
  v_conv_del_mensaje uuid;
begin
  if tg_table_name = 'whatsapp_conversations' then
    select company_id into v_empresa_padre from whatsapp_accounts where id = new.account_id;
    if v_empresa_padre is distinct from new.company_id then
      raise exception 'La conversación pertenece a otra empresa que su cuenta de WhatsApp'
        using errcode = 'check_violation';
    end if;

    if new.customer_id is not null then
      select company_id into v_cliente_empresa from customers where id = new.customer_id;
      if v_cliente_empresa is distinct from new.company_id then
        raise exception 'El cliente vinculado pertenece a otra empresa'
          using errcode = 'check_violation';
      end if;
    end if;

    -- El contacto tiene que ser de ESE cliente, no de cualquiera.
    if new.customer_contact_id is not null then
      select customer_id, company_id into v_contacto_cliente, v_contacto_empresa
        from customer_contacts where id = new.customer_contact_id;
      if v_contacto_empresa is distinct from new.company_id then
        raise exception 'El contacto vinculado pertenece a otra empresa'
          using errcode = 'check_violation';
      end if;
      if v_contacto_cliente is distinct from new.customer_id then
        raise exception 'El contacto vinculado no pertenece al cliente de la conversación'
          using errcode = 'check_violation';
      end if;
    end if;

    -- Asignar a un usuario de otra empresa le daría lectura por la policy del
    -- salesperson. Y un technician no puede usar WhatsApp.
    if new.assigned_to is not null then
      if not exists (
        select 1 from company_memberships
         where user_id = new.assigned_to
           and company_id = new.company_id
           and status = 'active'
           and role in ('admin','employee','salesperson'))
      then
        raise exception 'El usuario asignado no tiene una membresía activa que pueda usar WhatsApp en esta empresa'
          using errcode = 'check_violation';
      end if;
    end if;

  elsif tg_table_name = 'whatsapp_messages' then
    select company_id, account_id into v_empresa_padre, v_cuenta_padre
      from whatsapp_conversations where id = new.conversation_id;
    if v_empresa_padre is distinct from new.company_id then
      raise exception 'El mensaje pertenece a otra empresa que su conversación'
        using errcode = 'check_violation';
    end if;
    if v_cuenta_padre is distinct from new.account_id then
      raise exception 'El mensaje pertenece a otra cuenta de WhatsApp que su conversación'
        using errcode = 'check_violation';
    end if;

  elsif tg_table_name = 'whatsapp_media' then
    select company_id into v_empresa_padre
      from whatsapp_conversations where id = new.conversation_id;
    if v_empresa_padre is distinct from new.company_id then
      raise exception 'El adjunto pertenece a otra empresa que su conversación'
        using errcode = 'check_violation';
    end if;
    if new.message_id is not null then
      select conversation_id into v_conv_del_mensaje
        from whatsapp_messages where id = new.message_id;
      if v_conv_del_mensaje is distinct from new.conversation_id then
        raise exception 'El adjunto pertenece a otra conversación que su mensaje'
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  return new;
end $$;

create trigger trg_wa_conv_coherencia before insert or update on whatsapp_conversations
  for each row execute function app.coherencia_empresa_whatsapp();
create trigger trg_wa_msg_coherencia before insert or update on whatsapp_messages
  for each row execute function app.coherencia_empresa_whatsapp();
create trigger trg_wa_media_coherencia before insert or update on whatsapp_media
  for each row execute function app.coherencia_empresa_whatsapp();

create or replace function app.coherencia_lectura_whatsapp()
returns trigger language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not exists (select 1 from whatsapp_conversations where id = new.conversation_id) then
    raise exception 'La conversación no existe' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger trg_wa_reads_coherencia before insert or update on whatsapp_conversation_reads
  for each row execute function app.coherencia_lectura_whatsapp();

-- media_expires_at nace con 180 días al insertar (el default) y se recalcula
-- desde la descarga real cuando el archivo entra.
create or replace function app.vencimiento_media_whatsapp()
returns trigger language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.status = 'descargada' and new.downloaded_at is null then
    new.downloaded_at := now();
  end if;
  if new.downloaded_at is not null
     and (tg_op = 'INSERT' or new.downloaded_at is distinct from old.downloaded_at) then
    new.media_expires_at := new.downloaded_at + interval '180 days';
  end if;
  return new;
end $$;

-- El orden importa: los triggers de una misma tabla y evento disparan por
-- nombre alfabético, y «coherencia» va antes que «vencimiento».
create trigger trg_wa_media_vencimiento before insert or update on whatsapp_media
  for each row execute function app.vencimiento_media_whatsapp();


-- ---------------------------------------------------------------------------
-- 8 · RLS
-- ---------------------------------------------------------------------------
-- Dos helpers porque son DOS preguntas distintas: «¿puede usar WhatsApp?» y
-- «¿ve toda la empresa?». Ninguno de los existentes sirve:
-- current_writer_company_ids() deja afuera al salesperson y
-- current_internal_company_ids() incluye technician, que acá no va.

create or replace function app.current_whatsapp_admin_ids()
returns uuid[] language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(array_agg(company_id), '{}')
  from company_memberships
  where user_id = auth.uid() and status = 'active'
    and role in ('admin','employee');
$$;

create or replace function app.current_whatsapp_company_ids()
returns uuid[] language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(array_agg(company_id), '{}')
  from company_memberships
  where user_id = auth.uid() and status = 'active'
    and role in ('admin','employee','salesperson');
$$;

-- LA REGLA, EN UN SOLO LUGAR. Los hijos no se autorizan por su company_id:
-- siguen a la conversación padre. Con el salesperson en el medio esto deja de
-- ser prolijidad — si whatsapp_messages mirara su propio company_id, un
-- vendedor leería los mensajes de conversaciones que no puede abrir.
--
-- SECURITY DEFINER a propósito: llamada desde la policy de messages lee
-- conversations sin volver a entrar en su RLS, que si no sería recursión.
create or replace function app.puede_ver_conversacion_wa(p_conv uuid)
returns boolean language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from whatsapp_conversations c
     where c.id = p_conv
       and (
         c.company_id = any (app.current_whatsapp_admin_ids())
         or (c.company_id = any (app.current_whatsapp_company_ids())
             and c.assigned_to = auth.uid())
         -- CARTERA DEL VENDEDOR: evaluada y NO activada. Medido sobre la base
         -- real: 1 de 1010 clientes tiene salesperson_id cargado, así que esta
         -- rama sería una vía de autorización que casi nunca se cumple y que
         -- nadie ejercita. Se agrega el día que el dato exista.
         --
         -- or (c.company_id = any (app.current_whatsapp_company_ids())
         --     and exists (select 1 from customers cu
         --                  where cu.id = c.customer_id
         --                    and cu.salesperson_id = auth.uid()))
       ));
$$;

-- Mínimo privilegio sobre la cuenta: el salesperson sólo ve la cuenta desde la
-- que le hablan sus conversaciones asignadas, no el padrón de números.
create or replace function app.tiene_conversacion_en_cuenta_wa(p_cuenta uuid)
returns boolean language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from whatsapp_conversations c
     where c.account_id = p_cuenta
       and c.assigned_to = auth.uid()
       and c.company_id = any (app.current_whatsapp_company_ids()));
$$;

alter table whatsapp_accounts           enable row level security;
alter table whatsapp_conversations      enable row level security;
alter table whatsapp_messages           enable row level security;
alter table whatsapp_media              enable row level security;
alter table whatsapp_conversation_reads enable row level security;
alter table whatsapp_webhook_events     enable row level security;

-- SIEMPRE con TO authenticated: create policy sin TO queda en TO PUBLIC, y eso
-- ya nos mordió una vez.
--
-- `auth.uid()` va envuelto en un subselect para que el planificador lo resuelva
-- como InitPlan —una vez por consulta— en vez de una vez por fila.

create policy wa_accounts_select on whatsapp_accounts for select to authenticated
  using (
    company_id = any (app.current_whatsapp_admin_ids())
    or app.tiene_conversacion_en_cuenta_wa(id)
  );

-- La conversación repite la condición EN LÍNEA en vez de llamar a la función:
-- si la llamara, la policy se mordería la cola.
create policy wa_conv_select on whatsapp_conversations for select to authenticated
  using (
    company_id = any (app.current_whatsapp_admin_ids())
    or (company_id = any (app.current_whatsapp_company_ids())
        and assigned_to = (select auth.uid()))
  );

create policy wa_msg_select on whatsapp_messages for select to authenticated
  using (app.puede_ver_conversacion_wa(conversation_id));

create policy wa_media_select on whatsapp_media for select to authenticated
  using (app.puede_ver_conversacion_wa(conversation_id));

-- La lectura es propia Y de una conversación visible. Las dos condiciones: sin
-- la segunda, un usuario fabricaría filas de lectura sobre chats ajenos.
create policy wa_reads_select on whatsapp_conversation_reads for select to authenticated
  using (user_id = (select auth.uid()) and app.puede_ver_conversacion_wa(conversation_id));
create policy wa_reads_insert on whatsapp_conversation_reads for insert to authenticated
  with check (user_id = (select auth.uid()) and app.puede_ver_conversacion_wa(conversation_id));
create policy wa_reads_update on whatsapp_conversation_reads for update to authenticated
  using (user_id = (select auth.uid()) and app.puede_ver_conversacion_wa(conversation_id))
  with check (user_id = (select auth.uid()) and app.puede_ver_conversacion_wa(conversation_id));

-- whatsapp_webhook_events NO lleva ninguna policy. Con RLS habilitada y sin
-- policies queda denegada por defecto para todo rol de aplicación. Sólo la toca
-- el backend con service_role, que tiene BYPASSRLS.


-- ---------------------------------------------------------------------------
-- 9 · Privilegios
-- ---------------------------------------------------------------------------
-- Privilegio Y policy, no una de las dos. Es la lección de O4: el privilegio
-- tiene que impedir la escritura directa aunque mañana alguien escriba mal una
-- policy.

revoke all privileges on whatsapp_accounts, whatsapp_conversations,
                         whatsapp_messages, whatsapp_media,
                         whatsapp_conversation_reads, whatsapp_webhook_events
  from public, anon, authenticated;

grant select on whatsapp_accounts      to authenticated;
grant select on whatsapp_conversations to authenticated;
grant select on whatsapp_messages      to authenticated;
grant select on whatsapp_media         to authenticated;
-- Lo único que el cliente escribe directo: su propia marca de leído. Sin DELETE.
grant select, insert, update on whatsapp_conversation_reads to authenticated;
-- NADA sobre whatsapp_webhook_events. Ni un UPDATE sobre conversations: si lo
-- hubiera, un salesperson se apropiaría de cualquier chat poniéndose en
-- assigned_to, y a partir de ahí la policy de lectura lo dejaría pasar.

-- BUG ENCONTRADO Y CORREGIDO: revocar EXECUTE de `public` sin dárselo a
-- `authenticated` rompe TODAS las policies que llaman a estas funciones —
-- `authenticated` lo heredaba de PUBLIC y nunca tuvo grant propio. Se manifestó
-- como 0 filas visibles para todos los roles, incluido el admin. Revocar de
-- PUBLIC sigue siendo lo correcto; faltaba el grant explícito.
revoke execute on function app.current_whatsapp_admin_ids()          from public, anon;
revoke execute on function app.current_whatsapp_company_ids()        from public, anon;
revoke execute on function app.puede_ver_conversacion_wa(uuid)       from public, anon;
revoke execute on function app.tiene_conversacion_en_cuenta_wa(uuid) from public, anon;
revoke execute on function app.normalizar_telefono(text)             from public, anon;
revoke execute on function app.cola_telefono(text)                   from public, anon;
revoke execute on function app.uuid_o_null(text)                     from public, anon;

grant execute on function app.current_whatsapp_admin_ids()          to authenticated, service_role;
grant execute on function app.current_whatsapp_company_ids()        to authenticated, service_role;
grant execute on function app.puede_ver_conversacion_wa(uuid)       to authenticated, service_role;
grant execute on function app.tiene_conversacion_en_cuenta_wa(uuid) to authenticated, service_role;
grant execute on function app.normalizar_telefono(text)             to authenticated, service_role;
grant execute on function app.cola_telefono(text)                   to authenticated, service_role;
grant execute on function app.uuid_o_null(text)                     to authenticated, service_role;

-- Las de trigger no se llaman nunca como función normal. Revocar EXECUTE no las
-- apaga: el privilegio se controla al CREAR el trigger, no cada vez que dispara
-- (comprobado volviendo a correr la suite entera después de revocarlas).
revoke execute on function app.coherencia_empresa_whatsapp() from public, anon, authenticated;
revoke execute on function app.coherencia_lectura_whatsapp() from public, anon, authenticated;
revoke execute on function app.vencimiento_media_whatsapp()  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 10 · La cola: reclamo atómico
-- ---------------------------------------------------------------------------
-- NO alcanza con SELECT de los pendientes y después UPDATE: entre las dos
-- sentencias otro worker lee las mismas filas y el cliente recibe el mensaje
-- dos veces. Tiene que ser UNA sentencia. FOR UPDATE SKIP LOCKED hace que el
-- segundo worker SALTEE lo que el primero ya tomó, en vez de esperarlo.
--
-- SECURITY INVOKER a propósito: sólo service_role puede ejecutarla, y si
-- alguien ampliara el grant por error la función seguiría sin poder escribir,
-- porque authenticated no tiene UPDATE sobre la tabla.

create or replace function public.tomar_mensajes_whatsapp(p_limite int default 10)
returns setof whatsapp_messages
language sql volatile
set search_path to 'public', 'pg_temp'
as $$
  update whatsapp_messages m
     set status = 'sending',
         claimed_at = now(),
         attempts = attempts + 1
   where m.id in (
     select id from whatsapp_messages
      where status = 'pending'
        and direction = 'out'
        and (next_attempt_at is null or next_attempt_at <= now())
      order by created_at
      for update skip locked
      limit p_limite)
  returning m.*;
$$;
revoke execute on function public.tomar_mensajes_whatsapp(int) from public, anon, authenticated;
grant execute on function public.tomar_mensajes_whatsapp(int) to service_role;


-- ---------------------------------------------------------------------------
-- 11 · Reaper
-- ---------------------------------------------------------------------------
-- Si el worker se cae DESPUÉS del POST a Meta pero ANTES de guardar el
-- provider_message_id, la fila queda trabada en sending. La tentación es
-- devolverla a pending. NO hay que hacerlo: no existe en la documentación de
-- Meta ninguna clave de idempotencia para el envío, así que reintentar a ciegas
-- es mandarle el mismo mensaje dos veces a un cliente.
--
-- Va a failed y decide una persona. TIMEOUT: 5 minutos.

create or replace function public.reciclar_mensajes_whatsapp(p_timeout interval default interval '5 minutes')
returns setof whatsapp_messages
language sql volatile
set search_path to 'public', 'pg_temp'
as $$
  update whatsapp_messages m
     set status = 'failed',
         failed_at = now(),
         error_details = 'no se pudo confirmar el envío: el worker no respondió dentro del tiempo previsto'
   where m.id in (
     select id from whatsapp_messages
      where status = 'sending'
        and claimed_at is not null
        and claimed_at < now() - p_timeout
      for update skip locked)
  returning m.*;
$$;
revoke execute on function public.reciclar_mensajes_whatsapp(interval) from public, anon, authenticated;
grant execute on function public.reciclar_mensajes_whatsapp(interval) to service_role;


-- ---------------------------------------------------------------------------
-- 12 · Asignación — la única puerta
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER porque authenticated no tiene UPDATE sobre conversations, y
-- no lo va a tener. p_usuario null = desasignar.

create or replace function public.asignar_conversacion_whatsapp(
  p_conversacion uuid,
  p_usuario uuid default null)
returns whatsapp_conversations
language plpgsql volatile security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_conv whatsapp_conversations;
begin
  -- El lock serializa a dos admins reasignando a la vez: gana el último, sin
  -- estados intermedios raros.
  select * into v_conv from whatsapp_conversations where id = p_conversacion for update;
  if not found then
    raise exception 'La conversación no existe' using errcode = 'no_data_found';
  end if;

  -- Sólo admin y employee. Un salesperson no se autoasigna: si pudiera, se
  -- apropiaría de cualquier chat y la policy de lectura lo dejaría entrar.
  if not (v_conv.company_id = any (app.current_whatsapp_admin_ids())) then
    raise exception 'No tenés permiso para asignar conversaciones en esta empresa'
      using errcode = 'insufficient_privilege';
  end if;

  -- El trigger de coherencia también lo valida; acá el mensaje de error es el
  -- que va a leer una persona.
  if p_usuario is not null then
    if not exists (
      select 1 from company_memberships
       where user_id = p_usuario and company_id = v_conv.company_id
         and status = 'active' and role in ('admin','employee','salesperson'))
    then
      raise exception 'El usuario no trabaja en esta empresa o no puede usar WhatsApp'
        using errcode = 'check_violation';
    end if;
  end if;

  update whatsapp_conversations
     set assigned_to = p_usuario
   where id = p_conversacion
  returning * into v_conv;

  return v_conv;
end $$;
revoke execute on function public.asignar_conversacion_whatsapp(uuid, uuid) from public, anon;
grant execute on function public.asignar_conversacion_whatsapp(uuid, uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 13 · Marcar leída y derivar no leídos
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER a propósito: la regla de quién puede marcar qué ya está en
-- la policy de whatsapp_conversation_reads. Una implementación, dos usos.

create or replace function public.marcar_conversacion_leida_whatsapp(p_conversacion uuid)
returns void
language sql volatile
set search_path to 'public', 'pg_temp'
as $$
  insert into whatsapp_conversation_reads (conversation_id, user_id, last_read_at)
  values (p_conversacion, auth.uid(), now())
  on conflict (conversation_id, user_id) do update set last_read_at = now();
$$;
revoke execute on function public.marcar_conversacion_leida_whatsapp(uuid) from public, anon;
grant execute on function public.marcar_conversacion_leida_whatsapp(uuid) to authenticated, service_role;

-- El contador NO se guarda: se calcula. Persistirlo crea la posibilidad de que
-- el número guardado y el real dejen de coincidir — la misma decisión que con
-- los indicadores de torque. UNA consulta para toda la página de bandeja.
--
-- INVOKER: la RLS de messages y de reads hace el resto, así que una
-- conversación que el usuario no puede ver devuelve 0 y no una fuga.
create or replace function public.no_leidos_whatsapp(p_conversaciones uuid[])
returns table (conversation_id uuid, no_leidos bigint)
language sql stable
set search_path to 'public', 'pg_temp'
as $$
  select conv.id, count(m.id)
    from unnest(p_conversaciones) as conv(id)
    left join whatsapp_conversation_reads r
           on r.conversation_id = conv.id and r.user_id = auth.uid()
    left join whatsapp_messages m
           on m.conversation_id = conv.id
          and m.direction = 'in'
          and m.ordenado_en > coalesce(r.last_read_at, '-infinity'::timestamptz)
   group by conv.id;
$$;
revoke execute on function public.no_leidos_whatsapp(uuid[]) from public, anon;
grant execute on function public.no_leidos_whatsapp(uuid[]) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 14 · Storage
-- ---------------------------------------------------------------------------
-- Una ruta mal formada no puede tumbar una policy: sin esto, un objeto con un
-- path raro haría fallar la consulta entera en vez de simplemente no autorizar.
create or replace function app.uuid_o_null(p_texto text)
returns uuid language plpgsql immutable
set search_path to 'pg_temp'
as $$
begin
  return p_texto::uuid;
exception when others then
  return null;
end $$;

-- Bucket PRIVADO. 100 MB es el techo de documento de Meta.
insert into storage.buckets (id, name, public, file_size_limit)
values ('whatsapp', 'whatsapp', false, 104857600)
on conflict (id) do nothing;

-- Ruta estable por IDs reales: company/account/conversation/message/archivo.
-- El path NO es la seguridad —eso es lo que la entrega 0.5 encontró mal
-- resuelto en el legacy—: la autorización es la misma función que gobierna la
-- conversación.
create policy whatsapp_objects_select on storage.objects for select to authenticated
  using (
    bucket_id = 'whatsapp'
    and app.puede_ver_conversacion_wa(app.uuid_o_null((storage.foldername(name))[3]))
  );

-- Sin policies de INSERT/UPDATE/DELETE para authenticated: la media la sube y
-- la borra el backend con service_role. Nadie sube desde el navegador.


-- ---------------------------------------------------------------------------
-- 15 · Realtime
-- ---------------------------------------------------------------------------
-- Cero polling: el legacy consultaba cada 2 segundos. Sólo las tres tablas que
-- la UI necesita ver cambiar.
alter publication supabase_realtime add table whatsapp_conversations;
alter publication supabase_realtime add table whatsapp_messages;
alter publication supabase_realtime add table whatsapp_media;

-- whatsapp_webhook_events NO se publica: es crudo del proveedor y ningún rol de
-- aplicación puede verlo. whatsapp_conversation_reads tampoco: cada usuario
-- conoce sus propias marcas.
--
-- Replica identity queda en la de por defecto (la clave primaria). Los DELETE
-- no se entregan por Realtime porque el registro viejo sólo trae la PK y la RLS
-- no se puede evaluar; acá no se borran mensajes, así que no hace falta FULL.


-- ===========================================================================
-- LO QUE NO SE HIZO EN ESTA ENTREGA, A PROPÓSITO
-- ===========================================================================
--
--   · enviar_mensaje_whatsapp / archivar_conversacion / vincular_cliente:
--     estaban listadas como FIRMAS en la propuesta, con el cuerpo diferido.
--     No se implementan sin el backend de Meta que las use.
--   · app.ventana_abierta_wa (las 24 horas): no hay envío todavía, así que no
--     hay quién la consulte.
--   · El cron de retención de webhook_events (14 días) y el de media (180):
--     deuda operacional declarada, no inventada acá.
--   · La columna «conservar» de media: backlog.
--   · Meta App, número, token, webhook, bandeja React: entregas siguientes.
-- ===========================================================================
