-- ===========================================================================
-- FASE 8 · WHATSAPP — SCHEMA PROPUESTO
-- ===========================================================================
--
--   ██  P R O P U E S T A  ·  N O   E J E C U T A D O  ██
--
-- Este archivo NO se aplicó. No existe ninguna de estas tablas en el proyecto.
-- Acompaña a docs/PHASE_8_WHATSAPP_ENTREGA_1_ARQUITECTURA.md y está para
-- discutirlo, no para correrlo.
--
-- Antes de aplicarlo hacen falta las cinco decisiones de la sección final de
-- ese informe, y el alta en Meta de la entrega 1.5.
--
-- Documentación de Meta consultada el 2026-09-11. Las fuentes están en la
-- sección A del informe.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0 · Normalización de teléfonos — UNA sola, para todo
-- ---------------------------------------------------------------------------
--
-- El legacy tenía TRES tratamientos distintos —`'+' + valor`, quitar no
-- dígitos, y comparar los últimos 8— y por eso nada cruzaba con el CRM. Acá
-- hay una función y la usan el webhook, el matching y la búsqueda.
--
-- Devuelve NULL cuando no se puede determinar el país. **No se inventa un
-- E.164**: es preferible un hueco honesto a un número inventado que después
-- alguien cruza con un cliente equivocado.

create or replace function app.normalizar_telefono(p_crudo text)
returns text
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select case
    -- Cloud API entrega el wa_id con código de país incluido, sin '+'.
    when length(regexp_replace(coalesce(p_crudo,''), '\D', '', 'g')) between 8 and 15
      then '+' || regexp_replace(p_crudo, '\D', '', 'g')
    else null
  end;
$$;

-- La cola usada para el cruce con el CRM argentino: los últimos ocho dígitos.
-- Absorbe +54 9 11 xxxx-xxxx, 011 xxxx-xxxx y 11xxxxxxxx, que es como están
-- cargados los teléfonos que hay. Se documenta acá y no se repite en ningún
-- otro lado.
create or replace function app.cola_telefono(p_crudo text)
returns text
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select nullif(right(regexp_replace(coalesce(p_crudo,''), '\D', '', 'g'), 8), '');
$$;


-- ---------------------------------------------------------------------------
-- 1 · whatsapp_accounts — un número de WhatsApp de una empresa
-- ---------------------------------------------------------------------------
--
-- Sin esta tabla no hay multiempresa ni varios números. La v1 va a usar uno
-- solo, pero nada queda cableado: no hay ningún phone_number_id global.
--
-- **NUNCA guarda un access token.** Sólo identificadores que Meta considera
-- públicos. El token vive como secreto de la Edge Function.

create table whatsapp_accounts (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id),

  provider              text not null default 'meta_cloud'
                          check (provider in ('meta_cloud')),
  waba_id               text not null,
  phone_number_id       text not null,
  display_phone_number  text not null,
  display_name          text,

  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- El phone_number_id es la identidad del número del lado de Meta.
  constraint uq_wa_account_phone unique (phone_number_id)
);

create index idx_wa_accounts_company on whatsapp_accounts (company_id) where active;


-- ---------------------------------------------------------------------------
-- 2 · whatsapp_conversations — la unidad de la bandeja
-- ---------------------------------------------------------------------------
--
-- La identidad es (account_id, provider_contact_id), NUNCA el teléfono. Con
-- Cloud API el wa_id ES un teléfono, pero el diseño no lo supone: si algún día
-- llega un identificador que no lo es, entra igual y phone_e164 queda en null.
-- Es la lección de los @lid de Baileys, donde 5 de 8 chats no tenían teléfono.
--
-- customer_id es NULLABLE y no es un detalle: hoy sólo 3 de 1010 clientes
-- tienen teléfono cargado. Se puede conversar sin cliente asociado.

create table whatsapp_conversations (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id),
  account_id            uuid not null references whatsapp_accounts(id),

  -- Identidad externa
  provider_contact_id   text not null,
  phone_raw             text,
  phone_e164            text,
  profile_name          text,           -- el pushname que publica WhatsApp

  -- Vínculo con el CRM: opcional, y sólo automático si el match es único
  customer_id           uuid references customers(id),
  customer_contact_id   uuid references customer_contacts(id),
  vinculo_origen        text check (vinculo_origen in ('exacto','normalizado','manual')),

  -- Trabajo del equipo
  assigned_to           uuid references profiles(id),
  archived_at           timestamptz,

  -- Denormalizado para ordenar la bandeja sin tocar messages
  last_message_at       timestamptz,
  last_message_preview  text,
  last_message_dir      text check (last_message_dir in ('in','out')),

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint uq_wa_conv_contacto unique (account_id, provider_contact_id)
);

create index idx_wa_conv_bandeja on whatsapp_conversations
  (company_id, last_message_at desc nulls last) where archived_at is null;
create index idx_wa_conv_cliente on whatsapp_conversations (customer_id)
  where customer_id is not null;
create index idx_wa_conv_telefono on whatsapp_conversations (phone_e164)
  where phone_e164 is not null;


-- ---------------------------------------------------------------------------
-- 3 · whatsapp_messages — el hilo Y la cola de salida
-- ---------------------------------------------------------------------------
--
-- Se descartó una tabla `whatsapp_outbox` aparte: agrega un join para dibujar
-- el hilo y un momento en que el mensaje existe en un lado y no en el otro. El
-- legacy usó este mismo patrón —status='pendiente' en la misma tabla— y
-- funcionó. Un outbox separado se justifica con muchos productores y ruteo
-- complejo; no es el caso.
--
-- TRES marcas de tiempo, porque responden preguntas distintas:
--   provider_timestamp  cuándo ocurrió, según Meta   ← ordena el hilo
--   received_at         cuándo lo recibió el webhook
--   created_at          cuándo se escribió la fila
--
-- Y el estado NO es una progresión monótona: la documentación de Meta dice que
-- un mismo mensaje puede disparar éxito y fallo cuando el usuario tiene varios
-- dispositivos. Por eso cada estado tiene su columna y el status visible se
-- deriva por precedencia, en vez de pisarse con el último webhook que llegue.

create table whatsapp_messages (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id),
  account_id            uuid not null references whatsapp_accounts(id),
  conversation_id       uuid not null references whatsapp_conversations(id),

  direction             text not null check (direction in ('in','out')),
  message_type          text not null,     -- text · image · audio · video ·
                                           -- document · sticker · location ·
                                           -- contacts · reaction · template ·
                                           -- interactive · unsupported
  text_body             text,
  caption               text,

  -- Identidad del proveedor. Null mientras está en la cola.
  provider_message_id   text,
  reply_to_provider_id  text,             -- el context.id de Meta

  -- Cola de salida
  status                text not null default 'pending'
                          check (status in ('pending','sent','delivered','read','failed')),
  client_request_id     uuid,             -- idempotencia del lado nuestro
  attempts              int not null default 0,
  next_attempt_at       timestamptz,

  -- Un timestamp por estado: los webhooks llenan el suyo y repetirlo no hace nada
  sent_at               timestamptz,
  delivered_at          timestamptz,
  read_at               timestamptz,
  failed_at             timestamptz,
  provider_status       text,             -- el valor crudo, para depurar
  error_code            int,              -- Meta pide construir la lógica sobre
  error_details         text,             -- code y error_data.details, no sobre
                                          -- los títulos, que se van a deprecar

  provider_timestamp    timestamptz not null,
  received_at           timestamptz,
  created_by            uuid references profiles(id),
  created_at            timestamptz not null default now(),

  -- Un webhook repetido no puede duplicar un mensaje. Meta reintenta 36 horas.
  constraint uq_wa_msg_provider unique (account_id, provider_message_id),
  -- Dos clics, un mensaje.
  constraint uq_wa_msg_cliente unique (account_id, client_request_id)
);

-- El hilo se ordena por el reloj de Meta, con desempate estable.
create index idx_wa_msg_hilo on whatsapp_messages
  (conversation_id, provider_timestamp desc, id desc);
-- La cola: sólo lo pendiente, que es un puñado de filas.
create index idx_wa_msg_cola on whatsapp_messages (next_attempt_at)
  where status = 'pending';


-- ---------------------------------------------------------------------------
-- 4 · whatsapp_media — metadata; el archivo va a Storage
-- ---------------------------------------------------------------------------
--
-- NO se repite el legacy: 16,6 MB de base64 adentro de Postgres, que ocupaban
-- ~22 MB de tabla y se servían enteros a cualquiera.
--
-- Tabla aparte y no columnas en messages, porque **la media existe antes y
-- después del mensaje**: entrante, llega un id y el archivo se baja después,
-- con su propio estado y sus reintentos, mientras el mensaje ya se muestra;
-- saliente, el archivo se sube ANTES de que exista el mensaje.
--
-- Dos vencimientos de Meta que mandan sobre el diseño:
--   · el media id de un webhook vence a los 7 DÍAS  → si no se baja, se pierde
--   · la URL de descarga vence a los 5 MINUTOS      → se pide justo antes

create table whatsapp_media (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id),
  message_id            uuid references whatsapp_messages(id),

  provider_media_id     text,
  mime_type             text not null,
  file_name             text,
  size_bytes            bigint,
  sha256                text,

  storage_path          text,             -- bucket privado «whatsapp»
  status                text not null default 'pendiente'
                          check (status in ('pendiente','descargada','fallida')),
  attempts              int not null default 0,
  error_details         text,

  provider_expires_at   timestamptz,      -- los 7 días del id del webhook
  created_at            timestamptz not null default now(),
  downloaded_at         timestamptz
);

create index idx_wa_media_mensaje on whatsapp_media (message_id);
create index idx_wa_media_cola on whatsapp_media (created_at)
  where status = 'pendiente';

-- El mensaje apunta a su archivo.
alter table whatsapp_messages
  add column media_id uuid references whatsapp_media(id);


-- ---------------------------------------------------------------------------
-- 5 · whatsapp_conversation_reads — el no leído, POR USUARIO
-- ---------------------------------------------------------------------------
--
-- El legacy tenía un contador global: si Juan abría un chat, se apagaba para
-- todos. Con varios empleados atendiendo eso es un error de diseño.
--
-- El no leído NO se guarda: se calcula. Es la misma decisión que con los
-- indicadores de torque — lo derivado no se persiste, porque persistirlo crea
-- la posibilidad de que el número guardado y el real dejen de coincidir.

create table whatsapp_conversation_reads (
  conversation_id       uuid not null references whatsapp_conversations(id),
  user_id               uuid not null references profiles(id),
  last_read_at          timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- no_leidos(conversación, usuario) =
--   mensajes entrantes con provider_timestamp > coalesce(last_read_at, '-infinity')
--
-- Para la bandeja se resuelve con UNA consulta agrupada sobre la página
-- visible, no una por fila.


-- ---------------------------------------------------------------------------
-- 6 · whatsapp_webhook_events — crudo, para depurar, CON retención
-- ---------------------------------------------------------------------------
--
-- Depurar un webhook que no se puede reproducir es casi imposible sin el
-- payload. Pero nace con retención —30 días— para que no sea otro audit_logs
-- infinito: es una herramienta de diagnóstico, NO una fuente de verdad.
--
-- Ningún rol de aplicación la ve. Es exclusivamente del backend.

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

  constraint uq_wa_event unique (provider_event_id)
);

create index idx_wa_event_retencion on whatsapp_webhook_events (received_at);

-- Retención propuesta: borrar lo que tenga más de 30 días.
-- delete from whatsapp_webhook_events where received_at < now() - interval '30 days';


-- ---------------------------------------------------------------------------
-- 7 · Coherencia de empresa — la lección de O1
-- ---------------------------------------------------------------------------
--
-- Una fila hija NO se autoriza por su propio company_id: se valida contra el de
-- su padre. Es el agujero que encontramos en Mantenimiento, donde alguien podía
-- escribir en la orden de otra empresa poniendo su propio company_id en la
-- fila hija.

create or replace function app.coherencia_empresa_whatsapp()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_otra uuid;
begin
  if tg_table_name = 'whatsapp_conversations' then
    select company_id into v_otra from whatsapp_accounts where id = new.account_id;
    if v_otra is distinct from new.company_id then
      raise exception 'La conversación es de otra empresa que su cuenta de WhatsApp'
        using errcode = 'check_violation';
    end if;

  elsif tg_table_name = 'whatsapp_messages' then
    select company_id into v_otra from whatsapp_conversations where id = new.conversation_id;
    if v_otra is distinct from new.company_id then
      raise exception 'El mensaje es de otra empresa que su conversación'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;


-- ---------------------------------------------------------------------------
-- 8 · RLS
-- ---------------------------------------------------------------------------
--
-- Helper propio. NO se reutiliza `app.current_internal_company_ids()` porque
-- ese incluye technician, y la política v1 lo deja afuera: el día que exista un
-- technician de verdad no queremos que herede WhatsApp por accidente.

create or replace function app.current_whatsapp_company_ids()
returns uuid[]
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(array_agg(company_id), '{}') from company_memberships
   where user_id = auth.uid() and status = 'active'
     and role in ('admin','employee','salesperson');
$$;

-- RLS habilitada en las seis.
alter table whatsapp_accounts             enable row level security;
alter table whatsapp_conversations        enable row level security;
alter table whatsapp_messages             enable row level security;
alter table whatsapp_media                enable row level security;
alter table whatsapp_conversation_reads   enable row level security;
alter table whatsapp_webhook_events       enable row level security;

-- Lectura: los tres roles internos, de su empresa. SIEMPRE con TO authenticated:
-- `create policy` sin TO queda en TO PUBLIC, y esa ya nos mordió una vez.
create policy wa_accounts_select on whatsapp_accounts for select to authenticated
  using (company_id = any (app.current_whatsapp_company_ids()));

create policy wa_conv_select on whatsapp_conversations for select to authenticated
  using (company_id = any (app.current_whatsapp_company_ids()));

create policy wa_msg_select on whatsapp_messages for select to authenticated
  using (company_id = any (app.current_whatsapp_company_ids()));

create policy wa_media_select on whatsapp_media for select to authenticated
  using (company_id = any (app.current_whatsapp_company_ids()));

-- Las lecturas son de cada uno: el no leído es por usuario.
create policy wa_reads_propias on whatsapp_conversation_reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- whatsapp_webhook_events NO lleva ninguna policy: con RLS habilitada y sin
-- policies queda denegada por defecto para todo rol de aplicación. Sólo la
-- toca el backend, que usa service_role y tiene BYPASSRLS.

-- NINGUNA policy de INSERT, UPDATE ni DELETE sobre mensajes desde el cliente.
-- Ni siquiera para mandar: para eso está la RPC, que valida permiso, empresa y
-- ventana. Es la lección de O4 — que la capa de privilegios impida la escritura
-- directa aunque mañana alguien escriba mal una policy.
revoke insert, update, delete on whatsapp_accounts,
                                 whatsapp_conversations,
                                 whatsapp_messages,
                                 whatsapp_media,
                                 whatsapp_webhook_events
  from authenticated, anon, public;


-- ---------------------------------------------------------------------------
-- 9 · Las acciones del servidor
-- ---------------------------------------------------------------------------
--
-- Firmas propuestas. El cuerpo se escribe en la entrega 5.
--
--   enviar_mensaje_whatsapp(p_conversacion uuid, p_texto text,
--                           p_media uuid, p_client_request_id uuid)
--       · verifica rol y empresa
--       · verifica la VENTANA: si está cerrada, rechaza el texto libre y
--         exige plantilla. La decisión es server-side, siempre.
--       · inserta status='pending' y devuelve el id
--
--   marcar_conversacion_leida(p_conversacion uuid)
--       · upsert en whatsapp_conversation_reads para auth.uid()
--       · NO toca a los demás usuarios
--
--   vincular_conversacion_cliente(p_conversacion uuid, p_customer uuid,
--                                 p_contacto uuid)
--       · verifica que el cliente sea de la misma empresa
--
--   asignar_conversacion(p_conversacion uuid, p_usuario uuid)
--
-- La ventana, como consulta:
--
--   create function app.ventana_abierta(p_conversacion uuid) returns boolean as $$
--     select exists (
--       select 1 from whatsapp_messages
--        where conversation_id = p_conversacion and direction = 'in'
--          and provider_timestamp > now() - interval '24 hours');
--   $$ language sql stable;


-- ===========================================================================
-- FIN DE LA PROPUESTA · NADA DE ESTO SE APLICÓ
-- ===========================================================================
