-- ===========================================================================
-- FASE 9 · EMAILS — SCHEMA PROPUESTO · versión 2
-- ===========================================================================
--
--   ██  P R O P U E S T A  ·  N O   E J E C U T A D O  ██
--
-- Nada de esto se aplicó. No existe ninguna de estas tablas (verificado: 0
-- tablas `email_%` en el proyecto nuevo). Acompaña a
-- docs/PHASE_9_EMAILS_ENTREGA_1_ARQUITECTURA.md.
--
-- La regla que ordena todo el archivo:
--
--     el correo es de Gmail;  el trabajo sobre el correo es nuestro.
--
-- Por eso acá NO hay cuerpos, no hay adjuntos binarios y no hay una tabla de
-- mensajes. El legacy mezcló las dos cosas y terminó con 68 MB de body_html
-- para cinco semanas de correo.
--
-- Versión 2: incorpora las trece decisiones aprobadas. Lo que más cambió:
-- assigned_to dejó de ser llave de autorización y la RLS quedó sin ninguna rama
-- por asignación, porque el salesperson no entra en la v1 y esa rama sería
-- código muerto.
--
-- Autenticación decidida: service account + Domain-Wide Delegation, app
-- INTERNAL, scope gmail.modify. NADA de https://mail.google.com/.
-- Gate previo, que no se resuelve desde acá: ¿hay un Super Admin de Workspace?
-- Si no lo hay, plan B = OAuth app INTERNAL con refresh token del buzón, y el
-- schema NO cambia.
--
-- Documentación de Google consultada el 2026-09-11.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1 · email_accounts — un buzón de una empresa
-- ---------------------------------------------------------------------------
-- Sin esta tabla no hay multiempresa ni varios buzones, y `info@` volvería a
-- quedar escrito fijo como está hoy en el escenario de Make.
--
-- Guarda además el CURSOR DE SINCRONIZACIÓN, que es lo que impide perder
-- correo en silencio: Make no tenía cursor y por eso, con más de 25 mails entre
-- dos corridas, los perdía sin avisar.
--
-- ██ NUNCA guarda un token. ██  Con Domain-Wide Delegation no hay un token por
-- buzón: el service account impersona cada dirección, y su clave vive como
-- secreto de la Edge Function.

create table email_accounts (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id),

  provider              text not null default 'gmail' check (provider in ('gmail')),
  email_address         text not null,
  display_name          text,

  -- Sincronización. `last_history_id` es el cursor de la Gmail API.
  -- Google: si el startHistoryId queda fuera del rango disponible devuelve
  -- HTTP 404 y hay que hacer un resync completo. El historial dura
  -- «typically at least one week and often longer», nunca garantizado.
  last_history_id       text,
  last_synced_at        timestamptz,
  last_full_sync_at     timestamptz,

  -- El watch de Gmail caduca: «You must call the watch at least once every
  -- 7 days or you'll stop receiving updates». Se renueva por cron DIARIO, que
  -- es lo que Google recomienda y deja seis días de margen si el cron falla.
  watch_expiration      timestamptz,
  watch_topic           text,

  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint uq_email_account_direccion unique (provider, email_address)
);
comment on table email_accounts is
  'Un buzón. Nunca guarda access token, refresh token ni claves: eso vive sólo como secreto de las Edge Functions.';
comment on column email_accounts.last_history_id is
  'Cursor de la Gmail API. Si vence, history.list devuelve 404 y corresponde un resync completo.';

create index idx_email_accounts_company on email_accounts (company_id) where active;
-- El cron de renovación busca por acá.
create index idx_email_accounts_watch on email_accounts (watch_expiration) where active;
create trigger trg_email_accounts_touch before update on email_accounts
  for each row execute function app.touch_updated_at();


-- ---------------------------------------------------------------------------
-- 2 · email_threads — el índice de la bandeja. DESCARTABLE.
-- ---------------------------------------------------------------------------
-- Es lo mínimo para dibujar la lista sin llamar a Gmail. Se puede borrar
-- entera y reconstruir: todo sale del proveedor.
--
-- La identidad es el threadId de Gmail. NUNCA el asunto: agrupar por asunto es
-- justamente lo que no hay que hacer teniendo un id de conversación real.
--
-- NO GUARDA CUERPOS. El snippet lo entrega Gmail («A short part of the message
-- text»); el legacy lo mapeaba y llegaba vacío en las 976 filas, y por eso
-- alguien metió body_text en el listado — 716 de los 766 kB de cada request.

create table email_threads (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id),
  account_id            uuid not null references email_accounts(id) on delete cascade,

  gmail_thread_id       text not null,

  -- Lo que se dibuja en la lista, denormalizado del último mensaje.
  subject               text,
  snippet               text,
  last_message_at       timestamptz,
  last_message_from     text,
  last_message_dir      text check (last_message_dir in ('in','out')),
  -- Direcciones que participan del hilo: con esto se hace el matching con el
  -- CRM sin necesitar una tabla de mensajes ni una de contactos.
  participants          text[] not null default '{}',

  gmail_labels          text[] not null default '{}',
  message_count         int not null default 0 check (message_count >= 0),
  has_attachments       boolean not null default false,
  size_estimate         bigint check (size_estimate is null or size_estimate >= 0),

  synced_at             timestamptz not null default now(),

  constraint uq_email_thread unique (account_id, gmail_thread_id)
);
comment on table email_threads is
  'Índice descartable de la bandeja. Se puede vaciar y reconstruir desde Gmail. El estado del ERP vive en email_thread_state, aparte, justamente para que un resync no se lo lleve puesto.';

-- El orden de la bandeja.
create index idx_email_threads_bandeja on email_threads (company_id, last_message_at desc nulls last);
create index idx_email_threads_cuenta on email_threads (account_id, last_message_at desc nulls last);
-- Para el matching con el CRM y para buscar por participante.
create index idx_email_threads_participantes on email_threads using gin (participants);
create index idx_email_threads_labels on email_threads using gin (gmail_labels);


-- ---------------------------------------------------------------------------
-- 3 · email_thread_state — el estado del ERP. NO RECONSTRUIBLE.
-- ---------------------------------------------------------------------------
-- Separada de email_threads a propósito, y NO por simetría. Tres razones
-- concretas, cada una medida:
--
--   1. Un resync completo borra y rehace el índice. Si el estado viviera en la
--      misma fila, se lo llevaría puesto. Es exactamente la lección de las 91
--      filas del legacy: de 65 MB, lo único irrecuperable eran 91 estados.
--
--   2. El estado puede existir ANTES que el índice. Los 20 estados legacy
--      recuperables se importan antes del primer sync; con una FK al índice no
--      habría dónde ponerlos.
--
--   3. Las dos se atan por (account_id, gmail_thread_id), sin que ninguna
--      dependa del ciclo de vida de la otra.
--
-- Un hilo SIN fila acá es 'pendiente'. No hace falta escribir nada para el caso
-- normal: en el legacy sólo 91 de 976 mails tenían estado — el 9 %.

create table email_thread_state (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id),
  account_id            uuid not null references email_accounts(id) on delete cascade,
  gmail_thread_id       text not null,

  -- Enum mínimo. El legacy tenía seis estados y tres no eran workflow:
  -- `spam` y `archivado` son etiquetas de Gmail, y `enviado` es una propiedad
  -- del mensaje. Esos tres no se copian.
  workflow_status       text not null default 'pendiente'
                          check (workflow_status in ('pendiente','en_proceso','resuelto')),

  -- Reparte trabajo entre admin y employee, y NADA MÁS: en la v1 no es una
  -- llave de autorización. Nadie ve más ni menos según a quién esté asignado un
  -- hilo. Si algún día el área comercial usa Emails, ahí se agrega la rama en la
  -- policy; hoy sería una vía de autorización que nadie ejercita.
  assigned_to           uuid references profiles(id),

  -- Vínculo con el CRM. Nullable de verdad: medido sobre el correo real, el
  -- 65,7 % de los mails externos no matchea con ningún cliente.
  customer_id           uuid references customers(id),
  customer_contact_id   uuid references customer_contacts(id),
  -- De dónde salió el vínculo. Sólo 'exacto' se aplica automáticamente.
  vinculo_origen        text check (vinculo_origen in ('exacto','sugerido_dominio','ambiguo','manual')),

  internal_note         text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint uq_email_thread_state unique (account_id, gmail_thread_id),
  -- Si hay cliente, hay que saber por qué. Es la misma regla que en WhatsApp.
  constraint chk_email_state_vinculo check (customer_id is null or vinculo_origen is not null),
  -- Un contacto no cuelga de la nada.
  constraint chk_email_state_contacto check (customer_contact_id is null or customer_id is not null)
);
comment on table email_thread_state is
  'Lo único que Gmail no puede reconstruir: asignación, estado de trabajo y vínculo con el CRM. Sobrevive a un resync completo del índice.';

create index idx_email_state_asignado on email_thread_state (assigned_to) where assigned_to is not null;
create index idx_email_state_status on email_thread_state (company_id, workflow_status);
create index idx_email_state_cliente on email_thread_state (customer_id) where customer_id is not null;
create trigger trg_email_state_touch before update on email_thread_state
  for each row execute function app.touch_updated_at();


-- ---------------------------------------------------------------------------
-- 4 · email_thread_reads — el no leído, POR USUARIO
-- ---------------------------------------------------------------------------
-- Cardinalidad distinta de email_thread_state: una fila por (hilo, usuario).
--
-- Gmail tiene un no-leído por BUZÓN; el ERP necesita uno por PERSONA. En el
-- legacy `is_read` era una columna compartida: si Juan abría, se apagaba para
-- todos — y por eso hay 873 de 976 sin leer, porque nadie puede bajar ese
-- número. Abrir un hilo acá NO toca el no-leído de Gmail.
--
-- El contador no se guarda: se deriva. Persistirlo abre la posibilidad de que
-- el número guardado y el real dejen de coincidir.

create table email_thread_reads (
  account_id            uuid not null references email_accounts(id) on delete cascade,
  gmail_thread_id       text not null,
  user_id               uuid not null references profiles(id),
  last_read_at          timestamptz not null default now(),
  primary key (account_id, gmail_thread_id, user_id)
);
comment on table email_thread_reads is
  'No leído por usuario. Que Juan abra un hilo no se lo marca leído a Facundo, ni cambia nada en Gmail.';

-- La policy filtra por user_id y la PK arranca por account_id, que no lo cubre.
create index idx_email_reads_usuario on email_thread_reads (user_id);


-- ---------------------------------------------------------------------------
-- 5 · email_events — auditoría de ACCIONES HUMANAS, y nada más
-- ---------------------------------------------------------------------------
-- Sólo lo que hizo una persona y a alguien le puede importar después. NINGÚN
-- evento de sincronización: ésa es la diferencia entre una auditoría que se lee
-- y un audit_logs infinito que nadie abre.

create table email_events (
  id                    bigserial primary key,
  company_id            uuid not null references companies(id),
  account_id            uuid not null references email_accounts(id) on delete cascade,
  gmail_thread_id       text,

  action                text not null
                          check (action in ('asignado','estado_cambiado','cliente_vinculado',
                                            'cliente_desvinculado','email_enviado','nota_editada')),
  actor                 uuid references profiles(id),
  detalle               jsonb,
  created_at            timestamptz not null default now()
);
comment on table email_events is
  'Acciones humanas. Los sync de Gmail NO se auditan acá: van a email_sync_log, que tiene retención corta.';

create index idx_email_events_hilo on email_events (account_id, gmail_thread_id, created_at desc);
create index idx_email_events_empresa on email_events (company_id, created_at desc);


-- ---------------------------------------------------------------------------
-- 6 · email_sync_log — para que una pérdida NO sea silenciosa
-- ---------------------------------------------------------------------------
-- Existe por una razón concreta: el modo de falla de Make era perder correo sin
-- que nadie se enterara. Acá queda registrado cada salto de historyId, cada
-- resync completo y cada error.
--
-- NO guarda el payload del push: Google manda sólo {emailAddress, historyId},
-- que no tiene nada que valga la pena conservar. Guarda la TRANSICIÓN.
--
-- Retención: 30 días. Ningún rol de aplicación la ve.

create table email_sync_log (
  id                    bigserial primary key,
  account_id            uuid not null references email_accounts(id) on delete cascade,
  kind                  text not null
                          check (kind in ('push','cron','manual','resync_completo','watch_renovado')),
  history_id_desde      text,
  history_id_hasta      text,
  threads_tocados       int not null default 0,
  -- Se llena cuando history.list devuelve 404 y hubo que rehacer todo: es la
  -- señal de que el historial venció, y conviene poder contarlas.
  historial_vencido     boolean not null default false,
  error_details         text,
  duracion_ms           int,
  created_at            timestamptz not null default now()
);

create index idx_email_sync_cuenta on email_sync_log (account_id, created_at desc);
create index idx_email_sync_errores on email_sync_log (created_at desc) where error_details is not null;

-- Retención (NO se aplica en esta entrega):
-- delete from email_sync_log where created_at < now() - interval '30 days';


-- ---------------------------------------------------------------------------
-- 7 · Coherencia de empresa — la lección de O1
-- ---------------------------------------------------------------------------
-- Una fila hija NO se valida por el company_id que manda el cliente, sino
-- contra el de su padre.

create or replace function app.coherencia_empresa_email()
returns trigger language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_empresa_padre uuid;
  v_cliente_empresa uuid;
  v_contacto_cliente uuid;
  v_contacto_empresa uuid;
begin
  select company_id into v_empresa_padre from email_accounts where id = new.account_id;
  if v_empresa_padre is distinct from new.company_id then
    raise exception 'La fila pertenece a otra empresa que su cuenta de correo'
      using errcode = 'check_violation';
  end if;

  if tg_table_name = 'email_thread_state' then
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
        raise exception 'El contacto vinculado no pertenece al cliente del hilo'
          using errcode = 'check_violation';
      end if;
    end if;

    -- Sólo se asigna a alguien que trabaje en esa empresa y pueda usar Emails.
    -- En la v1 eso es admin o employee: el salesperson no tiene acceso, así que
    -- asignarle un hilo sería dejarle trabajo que no puede abrir.
    if new.assigned_to is not null then
      if not exists (
        select 1 from company_memberships
         where user_id = new.assigned_to and company_id = new.company_id
           and status = 'active' and role in ('admin','employee'))
      then
        raise exception 'El usuario asignado no tiene una membresía activa que pueda usar Emails en esta empresa'
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  return new;
end $$;

create trigger trg_email_threads_coherencia before insert or update on email_threads
  for each row execute function app.coherencia_empresa_email();
create trigger trg_email_state_coherencia before insert or update on email_thread_state
  for each row execute function app.coherencia_empresa_email();
create trigger trg_email_events_coherencia before insert or update on email_events
  for each row execute function app.coherencia_empresa_email();


-- ---------------------------------------------------------------------------
-- 8 · RLS
-- ---------------------------------------------------------------------------
-- v1: ADMIN + EMPLOYEE. Todos los demás, cero. Sin excepciones y sin ramas.
--
-- NINGUNA policy mira assigned_to. Es la diferencia con WhatsApp y es
-- deliberada: allá el salesperson entra y necesita una regla por asignación;
-- acá no entra, así que esa rama sería código muerto — una vía de autorización
-- que nadie ejercita y que igual hay que mantener y probar. Cuando el área
-- comercial use Emails, se agrega: es un `or` en una policy.
--
-- Helper propio, NO el de WhatsApp, aunque hoy devuelva exactamente lo mismo.
-- El motivo no es estilístico: si se compartiera, cambiar el modelo de roles de
-- WhatsApp cambiaría en silencio quién lee el correo de la empresa. Son dos
-- reglas que coinciden hoy, no una sola regla con dos usos.

create or replace function app.current_email_company_ids()
returns uuid[] language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(array_agg(company_id), '{}')
  from company_memberships
  where user_id = auth.uid() and status = 'active'
    and role in ('admin','employee');
$$;

-- SECURITY DEFINER para que, llamada desde la policy de email_thread_reads, lea
-- email_accounts sin volver a entrar en su propia RLS. Se define ACÁ y no más
-- abajo porque las policies que la usan se crean a continuación.
create or replace function app.puede_ver_cuenta_email(p_cuenta uuid)
returns boolean language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from email_accounts a
     where a.id = p_cuenta
       and a.company_id = any (app.current_email_company_ids()));
$$;

alter table email_accounts      enable row level security;
alter table email_threads       enable row level security;
alter table email_thread_state  enable row level security;
alter table email_thread_reads  enable row level security;
alter table email_events        enable row level security;
alter table email_sync_log      enable row level security;

-- SIEMPRE con TO authenticated: `create policy` sin TO queda en TO PUBLIC.
-- `auth.uid()` envuelto en subselect para que se resuelva como InitPlan, una
-- vez por consulta y no una por fila.

create policy email_accounts_select on email_accounts for select to authenticated
  using (company_id = any (app.current_email_company_ids()));

create policy email_threads_select on email_threads for select to authenticated
  using (company_id = any (app.current_email_company_ids()));

create policy email_state_select on email_thread_state for select to authenticated
  using (company_id = any (app.current_email_company_ids()));

create policy email_events_select on email_events for select to authenticated
  using (company_id = any (app.current_email_company_ids()));

-- Lo único que el cliente escribe directo: su propia marca de leído. Y sólo
-- sobre una cuenta que puede ver.
create policy email_reads_propias on email_thread_reads for select to authenticated
  using (user_id = (select auth.uid()) and app.puede_ver_cuenta_email(account_id));
create policy email_reads_insert on email_thread_reads for insert to authenticated
  with check (user_id = (select auth.uid()) and app.puede_ver_cuenta_email(account_id));
create policy email_reads_update on email_thread_reads for update to authenticated
  using (user_id = (select auth.uid()) and app.puede_ver_cuenta_email(account_id))
  with check (user_id = (select auth.uid()) and app.puede_ver_cuenta_email(account_id));

-- email_sync_log NO lleva ninguna policy: con RLS activa y sin policies queda
-- denegada por defecto para todo rol de aplicación. Sólo la toca el backend.


-- ---------------------------------------------------------------------------
-- 9 · Privilegios
-- ---------------------------------------------------------------------------
-- Privilegio Y policy, no una de las dos. El privilegio es el que aguanta
-- aunque mañana alguien escriba mal una policy — es la lección de O4, y la de
-- la entrega 0.5 de esta misma fase.

revoke all privileges on email_accounts, email_threads, email_thread_state,
                         email_thread_reads, email_events, email_sync_log
  from public, anon, authenticated;

grant select on email_accounts     to authenticated;
grant select on email_threads      to authenticated;
grant select on email_thread_state to authenticated;
grant select on email_events       to authenticated;
grant select, insert, update on email_thread_reads to authenticated;
-- NADA sobre email_sync_log.
--
-- Y ni un UPDATE sobre email_thread_state. No por el salesperson —que no existe
-- acá— sino por la razón general: la asignación, el estado y el vínculo con el
-- cliente son lo ÚNICO que no se puede reconstruir desde Gmail, y no se dejan a
-- merced de un PATCH suelto desde el navegador. Todo cambio va por RPC, que
-- además deja el rastro en email_events.

revoke execute on function app.current_email_company_ids()      from public, anon;
revoke execute on function app.puede_ver_cuenta_email(uuid)     from public, anon;
revoke execute on function app.coherencia_empresa_email()       from public, anon, authenticated;
grant  execute on function app.current_email_company_ids()  to authenticated, service_role;
grant  execute on function app.puede_ver_cuenta_email(uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 10 · Las acciones del servidor
-- ---------------------------------------------------------------------------
-- Firmas propuestas. El cuerpo se escribe en las entregas 3 a 5.
--
--   asignar_hilo_email(p_account uuid, p_thread text, p_usuario uuid)
--       · sólo admin y employee
--       · p_usuario null = desasignar
--       · crea la fila de estado si no existía
--       · registra en email_events
--
--   cambiar_estado_email(p_account uuid, p_thread text, p_estado text)
--       · pendiente | en_proceso | resuelto
--
--   vincular_cliente_email(p_account uuid, p_thread text,
--                          p_customer uuid, p_contacto uuid, p_origen text)
--       · valida que el cliente sea de la misma empresa
--       · 'exacto' lo puede escribir el backend; el resto exige acción humana
--
--   marcar_hilo_leido_email(p_account uuid, p_thread text)
--       · SECURITY INVOKER: la regla ya está en la policy de email_thread_reads
--
--   no_leidos_email(p_account uuid, p_threads text[])
--       · deriva el contador por usuario, UNA consulta por página de bandeja
--
-- Y las que NO son RPC de Postgres sino Edge Functions, porque hablan con
-- Gmail y necesitan el secreto:
--
--   gmail-push    recibe el Pub/Sub y encola
--   gmail-sync    history.list, actualiza el índice, renueva el watch
--   gmail-fetch   cuerpo de un hilo, adjunto, envío — todo bajo demanda


-- ---------------------------------------------------------------------------
-- 11 · Reconciliación de los 91 estados legacy
-- ---------------------------------------------------------------------------
-- Clasificado sobre el export real de la entrega 0.5
-- (estados-de-trabajo.json, sha256 3776919c17122b36…):
--
--     AUTO         20    14 sin_responder+JUAN · 5 en_proceso · 1 resuelto
--     REVIEW       67    todos `spam`
--     UNRESOLVED    4    los salientes: 2 sin thread_id, 2 que no decodifican
--
--     82 hilos distintos · 0 conflictos
--
-- La unidad es el HILO, no el mensaje: 86 de los 91 tienen un UID de IMAP
-- inútil contra la Gmail API, pero un thread_id de Gmail válido en base64.
--
-- Los 67 de spam NO son AUTO a propósito: en el legacy «spam» era una lista de
-- REMITENTES bloqueados en localStorage, y el status de cada mail era el
-- efecto. Aplicarlos como estado de hilo cambiaría su significado; el lugar
-- correcto es un filtro de Gmail o una lista de remitentes.
--
-- La importación NO se puede escribir todavía: verificar que cada thread_id
-- siga existiendo en Gmail necesita la API andando, o sea la entrega 2.
-- Forma esperada, una vez que exista:
--
--   insert into email_thread_state
--     (company_id, account_id, gmail_thread_id, workflow_status, assigned_to)
--   select …, convert_from(decode(legacy.thread_id,'base64'),'UTF8'), …
--     from (…el export…) legacy
--    where legacy.clase = 'AUTO'
--      and app.existe_hilo_en_gmail(…)   -- comprobado contra el proveedor
--   on conflict (account_id, gmail_thread_id) do nothing;
--
-- SÓLO METADATA. Ni cuerpos, ni asuntos, ni remitentes, ni binarios.


-- ===========================================================================
-- LO QUE NO SE CREA, Y POR QUÉ
-- ===========================================================================
--
--   · email_messages — una fila por mensaje. Para la bandeja alcanza el hilo, y
--     para abrir un hilo ya se llama a threads.get (40 unidades) que devuelve
--     todos sus mensajes. Una tabla local NO ahorraría esa llamada: sería una
--     segunda copia con su propia invalidación. Se agrega el día que aparezca
--     un caso que la necesite de verdad.
--
--   · email_contacts — customers y customer_contacts ya son los maestros. Los
--     participantes del hilo van en email_threads.participants, con índice GIN.
--
--   · Adjuntos permanentes — el binario es de Gmail y se trae bajo demanda. La
--     tabla `attachments` del ERP ya es polimórfica (entity_type/entity_id):
--     sirve tal cual el día que alguien haga «guardar este adjunto en el
--     cliente», que es una acción explícita y no automática.
--
--   · Tabla de tokens — con Domain-Wide Delegation no hay un token por buzón.
--     La clave del service account vive como secreto de la Edge Function.
--
--   · Eventos crudos de Pub/Sub — el payload es {emailAddress, historyId}. No
--     hay nada que guardar; email_sync_log registra la transición.
--
--   · Full-text local de cuerpos — no guardamos cuerpos. La búsqueda de
--     contenido va a Gmail con `q=`; la de cliente/asignado/estado, a Supabase.
--
--   · Tabla de borradores — decidido: se usan los DRAFTS REALES de Gmail. Un
--     borrador local sería una segunda fuente de verdad para algo que Gmail ya
--     tiene, y además no aparecería en el Gmail de la persona.
--
--   · Caché de imágenes remotas / proxy — decidido: en la v1 las imágenes
--     remotas se BLOQUEAN por defecto y se cargan con un botón. Sin proxy, así
--     que no hay nada que guardar.
--
-- ===========================================================================
-- ESTADO DEL LEGACY MIENTRAS TANTO
-- ===========================================================================
--
--   MAKE EMAIL INGESTION = DEPRECATED / DISABLED
--     Los tres escenarios de Emails quedaron APAGADOS (5856917, 5856923,
--     6036490). Deshabilitados, no borrados. El de Ventas —6060632, «Enviar
--     Cotización/Pedido → Gmail»— sigue activo a propósito: no toca Supabase.
--
--   ERP_EMAILS = CONGELADA / SÓLO RESPALDO
--     976 filas · 479 adjuntos · 91 estados exportados aparte.
--     Sin acceso para anon ni authenticated, bucket privado, sin policies.
--     No se reabre y no se borra hasta terminar la migración.
--
--   Los 91 estados NO se migran todavía: AUTO 20 · REVIEW 67 · UNRESOLVED 4.
--     Se reconcilian por gmail_thread_id cuando la Gmail API esté disponible.
--     Los UID de IMAP del legacy no se usan como id de Gmail. Nunca.
--
-- ===========================================================================
-- FIN DE LA PROPUESTA · NADA DE ESTO SE APLICÓ
-- ===========================================================================
