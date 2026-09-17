-- ---------------------------------------------------------------------------
-- FASE 16 · WHATSAPP — Entrega 3: automatización controlada
-- ---------------------------------------------------------------------------
--
-- Convierte el análisis manual validado en E2.5 en algo que PUEDE correr solo,
-- pero que nace APAGADO para todas las empresas. Ninguna línea de este archivo
-- enciende la IA ni la automatización de nadie.
--
-- Lo que agrega:
--   0. pg_cron + pg_net: el scheduler soportado por Supabase. No había ninguno.
--   1. `whatsapp_ai_settings` — configuración por empresa, todo en false.
--   2. `whatsapp_ai_analysis_queue` — UN trabajo por conversación, con debounce.
--   3. Trigger en `whatsapp_messages` que encola. El webhook NO cambia y nunca
--      llama a un proveedor: inserta el mensaje como siempre y la base anota
--      «esta conversación tiene algo nuevo». Si el encolado falla, el mensaje
--      entra igual (el error se traga con un WARNING).
--   4. Reclamar / completar trabajos con lock atómico (FOR UPDATE SKIP LOCKED),
--      reintentos con espera creciente y recuperación de locks vencidos.
--   5. Guardas de uso: IA apagada, análisis por día, USD por día. Se evalúan
--      ANTES de cada llamada al proveedor, manual o automática.
--   6. Informes: el cálculo sale a una función interna reutilizable; se corrige
--      «mensajes enviados» (sólo `sent`); snapshots diarios y semanales en
--      `whatsapp_ai_reports`, idempotentes por período. Sin IA.
--   7. Métricas de uso y costo para el panel de administración.
--   8. Jobs de pg_cron: disparar el worker sólo si hay trabajo listo, y generar
--      los informes programados que estén habilitados (hoy: ninguno).
--
-- Lo que NO hace: activar IA, automatización ni informes; mandar informes;
-- tocar el webhook, el envío, Meta, clientes, ventas ni ningún otro módulo;
-- modificar filas de mensajes; analizar grupos.


-- ---------------------------------------------------------------------------
-- 0 · Scheduler
-- ---------------------------------------------------------------------------
-- Auditoría previa: el proyecto no tenía pg_cron, pg_net ni ningún scheduler
-- (ni GitHub Actions programadas, ni cron externo). pg_cron corre dentro de la
-- base y pg_net le permite llamar a la Edge Function del worker, que es la
-- única que tiene la clave del proveedor. Es el mecanismo que documenta
-- Supabase para «Edge Functions programadas».

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;


-- ---------------------------------------------------------------------------
-- 1 · Configuración por empresa
-- ---------------------------------------------------------------------------
-- Una fila por empresa. Sin fila = todo apagado (las funciones hacen coalesce a
-- false). Las empresas existentes reciben su fila explícita, apagada.
--
-- Modo efectivo:
--   enabled = false                     → IA desactivada (ni manual ni automática)
--   enabled = true, auto_analyze = false → IA manual
--   enabled = true, auto_analyze = true  → IA automática
--
-- `enabled = false` es el KILL SWITCH: corta las llamadas nuevas, cancela lo
-- pendiente y no borra nada de lo ya analizado.
--
-- Zona horaria fija en E3 (Argentina): los informes y los límites diarios se
-- cuentan en ese día. El check la deja explícita en vez de asumirla.

create table if not exists whatsapp_ai_settings (
  company_id                uuid primary key references companies(id) on delete cascade,
  enabled                   boolean not null default false,
  auto_analyze              boolean not null default false,
  daily_report_enabled      boolean not null default false,
  weekly_report_enabled     boolean not null default false,
  daily_report_time         time,
  weekly_report_day         smallint,
  weekly_report_time        time,
  analysis_debounce_seconds integer not null default 120,
  max_daily_analyses        integer,
  max_daily_cost_usd        numeric(10,4),
  timezone                  text not null default 'America/Argentina/Buenos_Aires',
  updated_at                timestamptz not null default now(),
  updated_by                uuid references profiles(id),
  constraint chk_wa_ai_set_debounce check (analysis_debounce_seconds between 30 and 3600),
  constraint chk_wa_ai_set_max_analisis check (max_daily_analyses is null or max_daily_analyses between 1 and 10000),
  constraint chk_wa_ai_set_max_usd check (max_daily_cost_usd is null or (max_daily_cost_usd > 0 and max_daily_cost_usd <= 1000)),
  constraint chk_wa_ai_set_dia check (weekly_report_day is null or weekly_report_day between 1 and 7),
  constraint chk_wa_ai_set_diario check (not daily_report_enabled or daily_report_time is not null),
  constraint chk_wa_ai_set_semanal check (not weekly_report_enabled or (weekly_report_day is not null and weekly_report_time is not null)),
  constraint chk_wa_ai_set_zona check (timezone = 'America/Argentina/Buenos_Aires')
);

comment on table whatsapp_ai_settings is
  'IA de WhatsApp por empresa. Nace apagada. enabled=false es el kill switch.';
comment on column whatsapp_ai_settings.weekly_report_day is 'ISO: 1 = lunes … 7 = domingo.';

-- Default seguro: todas las empresas existentes, apagadas.
insert into whatsapp_ai_settings (company_id)
select id from companies
on conflict (company_id) do nothing;


-- ---------------------------------------------------------------------------
-- 2 · Cola de análisis
-- ---------------------------------------------------------------------------
-- La clave primaria ES la conversación: una conversación tiene a lo sumo un
-- trabajo. Diez mensajes seguidos no crean diez trabajos: corren el
-- `not_before` del mismo.
--
--   pending    → espera su `not_before`
--   processing → un worker lo tomó (`locked_at` es el token del lock)
--   done       → se analizó hasta el último mensaje que había al tomarlo
--   failed     → agotó reintentos o falló de una forma que no se reintenta sola
--   cancelled  → la IA automática se apagó con el trabajo pendiente
--
-- `last_error = 'limit_reached'` con status pending: se alcanzó un límite
-- diario; el trabajo espera al día siguiente sin llamar a nadie.

create table if not exists whatsapp_ai_analysis_queue (
  conversation_id           uuid primary key references whatsapp_conversations(id) on delete cascade,
  company_id                uuid not null references companies(id) on delete cascade,
  status                    text not null default 'pending',
  requested_at              timestamptz not null default now(),
  not_before                timestamptz not null default now(),
  attempts                  integer not null default 0,
  locked_at                 timestamptz,
  locked_by                 text,
  -- `requested_at` en el momento de tomar el lock: si al terminar es otro, llegó
  -- un mensaje DURANTE el análisis.
  lock_requested_at         timestamptz,
  last_error                text,
  last_processed_message_id uuid,
  done_at                   timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint chk_wa_ai_cola_estado check (status in ('pending', 'processing', 'done', 'failed', 'cancelled')),
  constraint chk_wa_ai_cola_intentos check (attempts >= 0),
  constraint chk_wa_ai_cola_lock check ((status = 'processing') = (locked_at is not null))
);

-- El worker sólo mira lo listo y lo trabado: índices parciales, sin escanear
-- conversaciones.
create index if not exists idx_wa_ai_cola_listos on whatsapp_ai_analysis_queue (not_before) where status = 'pending';
create index if not exists idx_wa_ai_cola_trabados on whatsapp_ai_analysis_queue (locked_at) where status = 'processing';
create index if not exists idx_wa_ai_cola_empresa on whatsapp_ai_analysis_queue (company_id, status);


-- ---------------------------------------------------------------------------
-- 3 · Corridas: estado «omitido»
-- ---------------------------------------------------------------------------
-- Una corrida que NO llamó al proveedor porque la IA estaba apagada o se
-- alcanzó un límite. Cuenta para observar, no para el resumen: no marca la
-- conversación con error.

alter table whatsapp_ai_runs drop constraint if exists chk_wa_ai_run_status;
alter table whatsapp_ai_runs add constraint chk_wa_ai_run_status
  check (status in ('ok', 'error', 'sin_cambios', 'omitido'));

create or replace function public.registrar_corrida_ia_whatsapp(
  p_conversacion uuid,
  p_estado       text,
  p_error_code   text,
  p_modelo       text,
  p_metricas     jsonb
) returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_empresa uuid;
begin
  if p_estado is null or p_estado not in ('error', 'sin_cambios', 'omitido') then
    raise exception 'ESTADO_INVALIDO' using errcode = '22023';
  end if;

  select company_id into v_empresa from whatsapp_conversations where id = p_conversacion;
  if v_empresa is null then
    raise exception 'CONVERSACION_INEXISTENTE' using errcode = '42704';
  end if;

  if p_estado = 'error' then
    insert into whatsapp_conversation_ai_summary as s (
      conversation_id, company_id, status, last_error, updated_at
    ) values (p_conversacion, v_empresa, 'error', left(p_error_code, 80), now())
    on conflict (conversation_id) do update set
      status = 'error', last_error = excluded.last_error, updated_at = now();
  end if;

  insert into whatsapp_ai_runs (
    company_id, conversation_id, requested_by, status, error_code, model, messages_sent,
    input_tokens, output_tokens, duration_ms,
    provider, cached_tokens, reasoning_tokens, estimated_cost_usd
  ) values (
    v_empresa, p_conversacion, nullif(p_metricas->>'requested_by', '')::uuid, p_estado,
    left(p_error_code, 80), p_modelo,
    coalesce((p_metricas->>'messages_sent')::int, 0),
    (p_metricas->>'input_tokens')::int, (p_metricas->>'output_tokens')::int,
    (p_metricas->>'duration_ms')::int,
    nullif(p_metricas->>'provider', ''), (p_metricas->>'cached_tokens')::int,
    (p_metricas->>'reasoning_tokens')::int, (p_metricas->>'estimated_cost_usd')::numeric
  );
end;
$$;

revoke execute on function public.registrar_corrida_ia_whatsapp(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant  execute on function public.registrar_corrida_ia_whatsapp(uuid, text, text, text, jsonb) to service_role;


-- ---------------------------------------------------------------------------
-- 4 · RLS
-- ---------------------------------------------------------------------------
-- Configuración y cola: lectura para administración (admin y employee) de la
-- empresa. Nadie escribe directo: las escrituras van por RPC, y la
-- configuración sólo la cambia un admin.

alter table whatsapp_ai_settings enable row level security;
alter table whatsapp_ai_analysis_queue enable row level security;

revoke all on whatsapp_ai_settings from anon, authenticated;
revoke all on whatsapp_ai_analysis_queue from anon, authenticated;
grant select on whatsapp_ai_settings to authenticated;
grant select on whatsapp_ai_analysis_queue to authenticated;

drop policy if exists wa_ai_set_select on whatsapp_ai_settings;
create policy wa_ai_set_select on whatsapp_ai_settings for select to authenticated
  using (company_id = any (app.current_whatsapp_admin_ids()));

drop policy if exists wa_ai_cola_select on whatsapp_ai_analysis_queue;
create policy wa_ai_cola_select on whatsapp_ai_analysis_queue for select to authenticated
  using (company_id = any (app.current_whatsapp_admin_ids()));


-- ---------------------------------------------------------------------------
-- 5 · Helpers
-- ---------------------------------------------------------------------------

-- Inicio del día local de la empresa (hoy: siempre Argentina).
create or replace function app.inicio_dia_local_wa(p_zona text, p_ahora timestamptz)
returns timestamptz
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select ((p_ahora at time zone p_zona)::date)::timestamp at time zone p_zona;
$$;

-- Espera antes del reintento N. Después del tercero: no hay más reintentos.
create or replace function app.espera_reintento_wa(p_intento integer)
returns interval
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case p_intento
    when 1 then interval '2 minutes'
    when 2 then interval '10 minutes'
    when 3 then interval '60 minutes'
  end;
$$;

-- Qué fallos se reintentan solos. Lo transitorio sí (límite del proveedor,
-- caída, red, timeout, base momentáneamente no disponible). Credenciales,
-- configuración, negativas y salidas inválidas NO: repetirlas no las arregla y
-- cuestan; quedan en `failed` para que una persona las mire.
create or replace function app.error_reintentable_wa(p_codigo text)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(p_codigo in (
    'proveedor_limite', 'proveedor_caido', 'proveedor_red', 'proveedor_timeout',
    'guardado', 'mensajes', 'conversacion', 'lock_vencido', 'worker_excepcion'
  ), false);
$$;

revoke execute on function app.inicio_dia_local_wa(text, timestamptz) from public, anon, authenticated;
revoke execute on function app.espera_reintento_wa(integer) from public, anon, authenticated;
revoke execute on function app.error_reintentable_wa(text) from public, anon, authenticated;
grant  execute on function app.inicio_dia_local_wa(text, timestamptz) to service_role;
grant  execute on function app.espera_reintento_wa(integer) to service_role;
grant  execute on function app.error_reintentable_wa(text) to service_role;


-- ---------------------------------------------------------------------------
-- 6 · Encolar al llegar un mensaje
-- ---------------------------------------------------------------------------
-- Cuenta como «algo nuevo en la conversación»:
--   · un entrante que se inserta;
--   · un saliente que pasa a `sent` (uno pendiente o fallido no le llegó a nadie).
--
-- Sólo si la empresa tiene IA habilitada Y automática, la conversación es
-- individual y no está archivada. Una archivada no se analiza sola; si alguien
-- la desarchiva, el próximo mensaje la vuelve a encolar.
--
-- Debounce: cada mensaje corre el `not_before` a ahora + N segundos. Nunca lo
-- ADELANTA (greatest): una espera por reintento o por límite diario se respeta.
--
-- Un trabajo `failed` no se reabre solo por un mensaje nuevo: si falló por
-- credenciales, cada mensaje sería otra llamada fallida. Se reintenta a mano.
--
-- Nada de esto puede tirar abajo la recepción de un mensaje: cualquier error
-- se registra como WARNING y el INSERT del mensaje sigue.

create or replace function app.encolar_analisis_whatsapp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_debounce integer;
  v_tipo     text;
  v_archivo  timestamptz;
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

    select conversation_type, archived_at into v_tipo, v_archivo
      from whatsapp_conversations where id = new.conversation_id;
    if v_tipo is distinct from 'individual' or v_archivo is not null then
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
$$;

revoke execute on function app.encolar_analisis_whatsapp() from public, anon, authenticated;

drop trigger if exists trg_wa_msg_encolar_ia on whatsapp_messages;
create trigger trg_wa_msg_encolar_ia
  after insert or update of status on whatsapp_messages
  for each row execute function app.encolar_analisis_whatsapp();


-- ---------------------------------------------------------------------------
-- 7 · Guardas de uso — antes de CADA llamada al proveedor
-- ---------------------------------------------------------------------------
-- La usan el análisis manual y el worker. Devuelve si se puede llamar y, si no,
-- por qué. Una llamada al proveedor es una corrida con mensajes enviados
-- (`messages_sent > 0`): `sin_cambios` y `omitido` no cuentan; un error del
-- proveedor sí (la llamada se hizo).
--
-- El costo es el ESTIMADO registrado en cada corrida con los precios
-- verificados. Entre la verificación y el registro puede correr otra llamada:
-- el desborde máximo es una llamada por worker concurrente, documentado.

create or replace function public.verificar_uso_ia_whatsapp(p_conversacion uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_empresa uuid;
  v_set     whatsapp_ai_settings%rowtype;
  v_desde   timestamptz;
  v_llamadas integer;
  v_costo   numeric;
begin
  select company_id into v_empresa from whatsapp_conversations where id = p_conversacion;
  if v_empresa is null then
    raise exception 'CONVERSACION_INEXISTENTE' using errcode = '42704';
  end if;

  select * into v_set from whatsapp_ai_settings where company_id = v_empresa;
  if not found or not v_set.enabled then
    return jsonb_build_object('permitido', false, 'motivo', 'ia_desactivada');
  end if;

  v_desde := app.inicio_dia_local_wa(v_set.timezone, now());
  select count(*) filter (where messages_sent > 0), coalesce(sum(estimated_cost_usd), 0)
    into v_llamadas, v_costo
    from whatsapp_ai_runs
   where company_id = v_empresa and created_at >= v_desde;

  if v_set.max_daily_analyses is not null and v_llamadas >= v_set.max_daily_analyses then
    return jsonb_build_object('permitido', false, 'motivo', 'limite_analisis', 'llamadas_hoy', v_llamadas, 'costo_hoy', v_costo);
  end if;
  if v_set.max_daily_cost_usd is not null and v_costo >= v_set.max_daily_cost_usd then
    return jsonb_build_object('permitido', false, 'motivo', 'limite_costo', 'llamadas_hoy', v_llamadas, 'costo_hoy', v_costo);
  end if;

  return jsonb_build_object('permitido', true, 'motivo', null, 'llamadas_hoy', v_llamadas, 'costo_hoy', v_costo);
end;
$$;

revoke execute on function public.verificar_uso_ia_whatsapp(uuid) from public, anon, authenticated;
grant  execute on function public.verificar_uso_ia_whatsapp(uuid) to service_role;


-- ---------------------------------------------------------------------------
-- 8 · Reclamar trabajos — SÓLO servidor
-- ---------------------------------------------------------------------------
-- 1. Recupera locks vencidos (un worker que murió): cuentan como un intento
--    fallido con su espera; al tercero, `failed`.
-- 2. Cancela lo pendiente de empresas que ya no tienen IA automática.
-- 3. Toma hasta N trabajos listos con FOR UPDATE SKIP LOCKED: dos workers al
--    mismo tiempo nunca toman la misma conversación.
--
-- `p_ahora` y `p_empresa` existen para las pruebas: mover el reloj de UNA
-- empresa de fixture sin tocar la cola de nadie más. Mover el reloj exige
-- acotar la empresa.

create or replace function public.reclamar_analisis_whatsapp(
  p_limite  integer,
  p_worker  text,
  p_ahora   timestamptz default null,
  p_empresa uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_ahora  timestamptz := coalesce(p_ahora, now());
  v_limite integer := least(greatest(coalesce(p_limite, 5), 1), 20);
  v_res    jsonb;
begin
  if p_ahora is not null and p_empresa is null then
    raise exception 'RELOJ_SIN_EMPRESA' using errcode = '22023';
  end if;

  -- 1 · Locks vencidos.
  update whatsapp_ai_analysis_queue q set
    status     = case when app.espera_reintento_wa(q.attempts + 1) is null then 'failed' else 'pending' end,
    attempts   = q.attempts + 1,
    not_before = v_ahora + coalesce(app.espera_reintento_wa(q.attempts + 1), interval '0'),
    last_error = 'lock_vencido',
    locked_at  = null,
    locked_by  = null,
    updated_at = now()
   where q.status = 'processing'
     and q.locked_at < v_ahora - interval '10 minutes'
     and (p_empresa is null or q.company_id = p_empresa);

  -- 2 · IA automática apagada: lo pendiente se cancela, no se analiza.
  update whatsapp_ai_analysis_queue q set
    status = 'cancelled', last_error = 'ia_desactivada', updated_at = now()
   where q.status = 'pending'
     and (p_empresa is null or q.company_id = p_empresa)
     and not exists (select 1 from whatsapp_ai_settings s
                      where s.company_id = q.company_id and s.enabled and s.auto_analyze);

  -- 3 · Tomar.
  with elegidos as (
    select q.conversation_id
      from whatsapp_ai_analysis_queue q
     where q.status = 'pending' and q.not_before <= v_ahora
       and (p_empresa is null or q.company_id = p_empresa)
     order by q.not_before
     limit v_limite
     for update skip locked
  ), tomados as (
    update whatsapp_ai_analysis_queue q set
      -- El lock se mide en el MISMO reloj con el que se decide si venció.
      status = 'processing', locked_at = v_ahora + (clock_timestamp() - now()),
      lock_requested_at = q.requested_at, locked_by = left(p_worker, 80), updated_at = now()
      from elegidos e
     where q.conversation_id = e.conversation_id
    returning q.conversation_id, q.company_id, q.attempts, q.locked_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'conversation_id', t.conversation_id, 'company_id', t.company_id,
           'attempts', t.attempts, 'locked_at', t.locked_at)), '[]'::jsonb)
    into v_res
    from tomados t;

  return v_res;
end;
$$;

revoke execute on function public.reclamar_analisis_whatsapp(integer, text, timestamptz, uuid) from public, anon, authenticated;
grant  execute on function public.reclamar_analisis_whatsapp(integer, text, timestamptz, uuid) to service_role;


-- ---------------------------------------------------------------------------
-- 9 · Completar un trabajo — SÓLO servidor
-- ---------------------------------------------------------------------------
-- `p_locked_at` es el token del lock: si el trabajo ya no está en processing
-- con ese mismo lock (lo recuperó otro worker), no se toca nada.
--
-- MENSAJES NUEVOS DURANTE LA CORRIDA: el análisis manda los mensajes que había
-- y el checkpoint avanza hasta el último de ESOS. Si mientras tanto entró otro,
-- el trigger actualizó `requested_at` (≠ lock_requested_at): el trabajo vuelve a
-- pending con su debounce en vez de quedar done. Ningún mensaje se pierde.
--
-- Resultados:
--   ok | sin_cambios | obsoleto | no_soportado → done (o pending si llegó algo)
--   reciente   → pending en 30 s (otro análisis acaba de terminar)
--   liberado   → pending ya (el worker se quedó sin tiempo antes de empezarlo)
--   limite     → pending hasta el día siguiente, `last_error = limit_reached`
--   desactivada → cancelled
--   error      → reintento con espera (2, 10, 60 min) si es transitorio; si no,
--                o después del tercero, failed.

create or replace function public.completar_analisis_whatsapp(
  p_conversacion uuid,
  p_locked_at    timestamptz,
  p_resultado    text,
  p_codigo       text default null,
  p_ahora        timestamptz default null
) returns text
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_q      whatsapp_ai_analysis_queue%rowtype;
  v_ahora  timestamptz := coalesce(p_ahora, now());
  v_nuevo  boolean;
  v_zona   text;
  v_espera interval;
begin
  select * into v_q from whatsapp_ai_analysis_queue where conversation_id = p_conversacion for update;
  if not found or v_q.status <> 'processing' or v_q.locked_at is distinct from p_locked_at then
    return 'lock_perdido';
  end if;

  v_nuevo := v_q.requested_at is distinct from v_q.lock_requested_at;

  if p_resultado in ('ok', 'sin_cambios', 'obsoleto', 'no_soportado') then
    update whatsapp_ai_analysis_queue set
      status     = case when v_nuevo then 'pending' else 'done' end,
      not_before = case when v_nuevo then greatest(not_before, v_ahora) else not_before end,
      attempts   = 0,
      last_error = null,
      done_at    = case when v_nuevo then done_at else now() end,
      last_processed_message_id = coalesce(
        (select last_analyzed_message_id from whatsapp_conversation_ai_summary where conversation_id = p_conversacion),
        last_processed_message_id),
      locked_at = null, locked_by = null, updated_at = now()
     where conversation_id = p_conversacion;
    return case when v_nuevo then 'pending' else 'done' end;

  elsif p_resultado in ('reciente', 'liberado') then
    update whatsapp_ai_analysis_queue set
      status = 'pending',
      not_before = greatest(not_before, v_ahora + case when p_resultado = 'reciente' then interval '30 seconds' else interval '0' end),
      locked_at = null, locked_by = null, updated_at = now()
     where conversation_id = p_conversacion;
    return 'pending';

  elsif p_resultado = 'limite' then
    select timezone into v_zona from whatsapp_ai_settings where company_id = v_q.company_id;
    update whatsapp_ai_analysis_queue set
      status = 'pending',
      last_error = 'limit_reached',
      not_before = app.inicio_dia_local_wa(coalesce(v_zona, 'America/Argentina/Buenos_Aires'), v_ahora) + interval '1 day',
      locked_at = null, locked_by = null, updated_at = now()
     where conversation_id = p_conversacion;
    return 'pending';

  elsif p_resultado = 'desactivada' then
    update whatsapp_ai_analysis_queue set
      status = 'cancelled', last_error = 'ia_desactivada',
      locked_at = null, locked_by = null, updated_at = now()
     where conversation_id = p_conversacion;
    return 'cancelled';

  elsif p_resultado = 'error' then
    v_espera := case when app.error_reintentable_wa(p_codigo) then app.espera_reintento_wa(v_q.attempts + 1) end;
    update whatsapp_ai_analysis_queue set
      status     = case when v_espera is null then 'failed' else 'pending' end,
      attempts   = v_q.attempts + 1,
      not_before = case when v_espera is null then not_before else v_ahora + v_espera end,
      last_error = left(coalesce(p_codigo, 'error'), 80),
      locked_at = null, locked_by = null, updated_at = now()
     where conversation_id = p_conversacion;
    return case when v_espera is null then 'failed' else 'pending' end;
  end if;

  raise exception 'RESULTADO_INVALIDO' using errcode = '22023';
end;
$$;

revoke execute on function public.completar_analisis_whatsapp(uuid, timestamptz, text, text, timestamptz) from public, anon, authenticated;
grant  execute on function public.completar_analisis_whatsapp(uuid, timestamptz, text, text, timestamptz) to service_role;


-- ---------------------------------------------------------------------------
-- 10 · Reintentar a mano — admin
-- ---------------------------------------------------------------------------

create or replace function public.reintentar_analisis_whatsapp(p_conversacion uuid)
returns text
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_q whatsapp_ai_analysis_queue%rowtype;
begin
  select * into v_q from whatsapp_ai_analysis_queue where conversation_id = p_conversacion for update;
  if not found or not coalesce(app.is_admin(v_q.company_id), false) then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if v_q.status not in ('failed', 'cancelled') then
    raise exception 'NO_REINTENTABLE' using errcode = '22023';
  end if;
  if not exists (select 1 from whatsapp_ai_settings where company_id = v_q.company_id and enabled and auto_analyze) then
    raise exception 'IA_AUTOMATICA_APAGADA' using errcode = '22023';
  end if;

  update whatsapp_ai_analysis_queue set
    status = 'pending', attempts = 0, last_error = null, not_before = now(), updated_at = now()
   where conversation_id = p_conversacion;
  return 'pending';
end;
$$;

revoke execute on function public.reintentar_analisis_whatsapp(uuid) from public, anon;
grant  execute on function public.reintentar_analisis_whatsapp(uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 11 · Configuración: leer y guardar
-- ---------------------------------------------------------------------------
-- Leer: admin (con `puede_editar`). El panel de la conversación usa
-- `estado_ia_whatsapp`, que sólo dice el modo y lo ve cualquiera con WhatsApp.
--
-- Guardar: sólo admin, con la versión leída (`updated_at`) para no pisar a
-- otro admin. Apagar la IA o la automática cancela lo pendiente EN LA MISMA
-- transacción. No se borra ningún resumen, ítem, corrida ni informe.

create or replace function app.config_ia_json_wa(p_set whatsapp_ai_settings, p_company uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'company_id', p_company,
    'enabled', coalesce(p_set.enabled, false),
    'auto_analyze', coalesce(p_set.auto_analyze, false),
    'daily_report_enabled', coalesce(p_set.daily_report_enabled, false),
    'weekly_report_enabled', coalesce(p_set.weekly_report_enabled, false),
    'daily_report_time', to_char(p_set.daily_report_time, 'HH24:MI'),
    'weekly_report_day', p_set.weekly_report_day,
    'weekly_report_time', to_char(p_set.weekly_report_time, 'HH24:MI'),
    'analysis_debounce_seconds', coalesce(p_set.analysis_debounce_seconds, 120),
    'max_daily_analyses', p_set.max_daily_analyses,
    'max_daily_cost_usd', p_set.max_daily_cost_usd,
    'timezone', coalesce(p_set.timezone, 'America/Argentina/Buenos_Aires'),
    'updated_at', p_set.updated_at,
    'modo', case when not coalesce(p_set.enabled, false) then 'desactivada'
                 when coalesce(p_set.auto_analyze, false) then 'automatica'
                 else 'manual' end
  );
$$;

revoke execute on function app.config_ia_json_wa(whatsapp_ai_settings, uuid) from public, anon, authenticated;

create or replace function public.config_ia_whatsapp(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_set whatsapp_ai_settings%rowtype;
begin
  if not coalesce(app.is_admin(p_company), false) then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  select * into v_set from whatsapp_ai_settings where company_id = p_company;
  return app.config_ia_json_wa(v_set, p_company) || jsonb_build_object('puede_editar', true);
end;
$$;

revoke execute on function public.config_ia_whatsapp(uuid) from public, anon;
grant  execute on function public.config_ia_whatsapp(uuid) to authenticated, service_role;

create or replace function public.estado_ia_whatsapp(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_set whatsapp_ai_settings%rowtype;
begin
  if not (p_company = any (app.current_whatsapp_company_ids())) then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  select * into v_set from whatsapp_ai_settings where company_id = p_company;
  return jsonb_build_object('modo', app.config_ia_json_wa(v_set, p_company)->>'modo');
end;
$$;

revoke execute on function public.estado_ia_whatsapp(uuid) from public, anon;
grant  execute on function public.estado_ia_whatsapp(uuid) to authenticated, service_role;

create or replace function public.guardar_config_ia_whatsapp(
  p_company uuid,
  p_version timestamptz,
  p_config  jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_actual  whatsapp_ai_settings%rowtype;
  v_nuevo   whatsapp_ai_settings%rowtype;
  v_clave   text;
  v_cancel  integer := 0;
begin
  if not coalesce(app.is_admin(p_company), false) then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    raise exception 'CONFIG_INVALIDA' using errcode = '22023';
  end if;
  for v_clave in select jsonb_object_keys(p_config) loop
    if v_clave not in ('enabled', 'auto_analyze', 'daily_report_enabled', 'weekly_report_enabled',
                       'daily_report_time', 'weekly_report_day', 'weekly_report_time',
                       'analysis_debounce_seconds', 'max_daily_analyses', 'max_daily_cost_usd') then
      raise exception 'CAMPO_NO_EDITABLE' using errcode = '22023', detail = v_clave;
    end if;
  end loop;

  insert into whatsapp_ai_settings (company_id) values (p_company) on conflict (company_id) do nothing;
  select * into v_actual from whatsapp_ai_settings where company_id = p_company for update;

  -- La versión: si otro admin guardó después de que ésta se leyó, no se pisa.
  -- Una fila recién creada acá (sin versión leída) se acepta.
  if p_version is not null and v_actual.updated_at is distinct from p_version then
    -- Sin errcode 40001: PostgREST reintenta los errores de serialización.
    raise exception 'CONFLICTO_VERSION';
  end if;

  begin
    update whatsapp_ai_settings s set
      enabled                   = coalesce((p_config->>'enabled')::boolean, s.enabled),
      auto_analyze              = coalesce((p_config->>'auto_analyze')::boolean, s.auto_analyze),
      daily_report_enabled      = coalesce((p_config->>'daily_report_enabled')::boolean, s.daily_report_enabled),
      weekly_report_enabled     = coalesce((p_config->>'weekly_report_enabled')::boolean, s.weekly_report_enabled),
      daily_report_time         = case when p_config ? 'daily_report_time' then nullif(p_config->>'daily_report_time', '')::time else s.daily_report_time end,
      weekly_report_day         = case when p_config ? 'weekly_report_day' then nullif(p_config->>'weekly_report_day', '')::smallint else s.weekly_report_day end,
      weekly_report_time        = case when p_config ? 'weekly_report_time' then nullif(p_config->>'weekly_report_time', '')::time else s.weekly_report_time end,
      analysis_debounce_seconds = coalesce((p_config->>'analysis_debounce_seconds')::integer, s.analysis_debounce_seconds),
      max_daily_analyses        = case when p_config ? 'max_daily_analyses' then nullif(p_config->>'max_daily_analyses', '')::integer else s.max_daily_analyses end,
      max_daily_cost_usd        = case when p_config ? 'max_daily_cost_usd' then nullif(p_config->>'max_daily_cost_usd', '')::numeric else s.max_daily_cost_usd end,
      updated_at                = clock_timestamp(),
      updated_by                = auth.uid()
     where s.company_id = p_company
    returning * into v_nuevo;
  exception
    when check_violation then
      raise exception 'CONFIG_INVALIDA' using errcode = '22023', detail = sqlerrm;
    when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
      raise exception 'CONFIG_INVALIDA' using errcode = '22023', detail = sqlerrm;
  end;

  -- Kill switch: sin IA automática, lo pendiente se cancela ya.
  if not (v_nuevo.enabled and v_nuevo.auto_analyze) then
    update whatsapp_ai_analysis_queue set
      status = 'cancelled', last_error = 'ia_desactivada', updated_at = now()
     where company_id = p_company and status = 'pending';
    get diagnostics v_cancel = row_count;
  end if;

  return app.config_ia_json_wa(v_nuevo, p_company)
      || jsonb_build_object('puede_editar', true, 'trabajos_cancelados', v_cancel);
end;
$$;

revoke execute on function public.guardar_config_ia_whatsapp(uuid, timestamptz, jsonb) from public, anon;
grant  execute on function public.guardar_config_ia_whatsapp(uuid, timestamptz, jsonb) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 12 · Informe: cálculo reutilizable + métrica «mensajes enviados» corregida
-- ---------------------------------------------------------------------------
-- El cuerpo del informe pasa a `app.datos_informe_whatsapp`, SECURITY INVOKER:
--   · llamado por una persona (vía `informe_whatsapp`), la RLS acota a lo que
--     ella ve, igual que antes;
--   · llamado por el scheduler (postgres) o por el servidor (service_role),
--     ve la empresa entera: es el snapshot de administración.
--
-- «Mensajes enviados» (`mensajes_salientes`) = direction 'out' y status 'sent'.
--   · `sent`: Meta aceptó el mensaje. Entregado y leído NO son estados aparte:
--     son `delivered_at` / `read_at` sobre la MISMA fila `sent`, así que no hay
--     doble conteo.
--   · NO cuentan: `pending` y `sending` (en cola, todavía no aceptados) ni
--     `failed` (no salió; se cuentan en «errores de envío»).

create or replace function app.datos_informe_whatsapp(
  p_company uuid,
  p_desde   timestamptz,
  p_hasta   timestamptz,
  p_horas   integer default 4
) returns jsonb
language plpgsql
stable
security invoker
set search_path = public, app, pg_temp
as $$
declare
  v_resultado jsonb;
  v_ids       uuid[];
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin')
     and not (p_company = any (app.current_whatsapp_company_ids())) then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta <= p_desde
     or p_hasta - p_desde > interval '31 days' then
    raise exception 'PERIODO_INVALIDO' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct m.conversation_id), '{}')
    into v_ids
    from whatsapp_messages m
   where m.company_id = p_company
     and m.ordenado_en >= p_desde and m.ordenado_en < p_hasta;

  with activas as (
    select c.id, c.profile_name, c.phone_e164, c.customer_id, c.assigned_to, c.created_at,
           c.last_message_at, c.last_message_dir, c.conversation_type,
           coalesce(nullif(btrim(cu.trade_name), ''), nullif(btrim(cu.legal_name), '')) as cliente,
           p.full_name as asignado
      from whatsapp_conversations c
      left join customers cu on cu.id = c.customer_id
      left join profiles p on p.id = c.assigned_to
     where c.company_id = p_company and c.id = any (v_ids)
  ),
  mensajes as (
    select count(*) filter (where direction = 'in')  as entrantes,
           count(*) filter (where direction = 'out' and status = 'sent') as salientes,
           count(*) filter (where direction = 'out' and status = 'failed') as fallidos
      from whatsapp_messages
     where company_id = p_company and ordenado_en >= p_desde and ordenado_en < p_hasta
  ),
  senales as (
    select * from public.senales_atencion_whatsapp(v_ids, p_horas)
  ),
  items_periodo as (
    select i.* from whatsapp_ai_items i
     where i.company_id = p_company
       and (i.generated_at >= p_desde and i.generated_at < p_hasta
            or i.resolved_at >= p_desde and i.resolved_at < p_hasta
            or i.conversation_id = any (v_ids))
  ),
  temas as (
    select t as tema, count(*) as veces
      from whatsapp_conversation_ai_summary s, unnest(s.topics) t
     where s.company_id = p_company and s.conversation_id = any (v_ids)
     group by t order by count(*) desc, t limit 10
  )
  select jsonb_build_object(
    'desde', p_desde,
    'hasta', p_hasta,
    'totales', jsonb_build_object(
      'conversaciones_activas', (select count(*) from activas),
      'conversaciones_nuevas',  (select count(*) from activas where created_at >= p_desde and created_at < p_hasta),
      'mensajes_entrantes',     (select entrantes from mensajes),
      'mensajes_salientes',     (select salientes from mensajes),
      'errores_envio',          (select fallidos from mensajes),
      'sin_respuesta',          (select count(*) from senales where 'sin_respuesta' = any (motivos)),
      'sin_asignar',            (select count(*) from activas where assigned_to is null),
      'pendientes_abiertos',    (select count(*) from items_periodo where status = 'open' and type in ('pending', 'follow_up', 'next_step')),
      'pendientes_resueltos',   (select count(*) from items_periodo where status = 'resolved' and resolved_at >= p_desde and resolved_at < p_hasta),
      'compromisos',            (select count(*) from items_periodo where type = 'commitment' and status <> 'dismissed' and generated_at >= p_desde and generated_at < p_hasta),
      'compromisos_vencidos',   (select count(*) from items_periodo where type = 'commitment' and status = 'open' and due_at is not null
                                      and (due_at at time zone 'UTC')::date < (now() at time zone 'America/Argentina/Buenos_Aires')::date),
      'decisiones',             (select count(*) from items_periodo where type = 'decision' and status <> 'dismissed' and generated_at >= p_desde and generated_at < p_hasta)
    ),
    'conversaciones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id,
               'contacto', coalesce(nullif(btrim(a.profile_name), ''), a.phone_e164),
               'cliente_id', a.customer_id,
               'cliente', a.cliente,
               'asignado_id', a.assigned_to,
               'asignado', a.asignado,
               'nueva', a.created_at >= p_desde and a.created_at < p_hasta,
               'ultimo_mensaje_en', a.last_message_at,
               'motivos', coalesce(sn.motivos, '{}'),
               'resumen', s.summary,
               'estado_ia', s.conversation_state
             ) order by cardinality(coalesce(sn.motivos, '{}')) desc, a.last_message_at desc)
        from activas a
        left join senales sn on sn.conversation_id = a.id
        left join whatsapp_conversation_ai_summary s on s.conversation_id = a.id
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'conversation_id', i.conversation_id, 'type', i.type, 'actor', i.actor,
               'description', i.description, 'confidence', i.confidence, 'due_at', i.due_at,
               'status', i.status, 'source_message_ids', i.source_message_ids,
               'generated_at', i.generated_at, 'resolved_at', i.resolved_at
             ) order by i.generated_at desc)
        from items_periodo i
    ), '[]'::jsonb),
    'temas', coalesce((select jsonb_agg(jsonb_build_object('tema', tema, 'veces', veces)) from temas), '[]'::jsonb),
    'por_asignado', coalesce((
      select jsonb_agg(jsonb_build_object('asignado_id', assigned_to, 'asignado', asignado, 'conversaciones', n)
                       order by n desc, asignado nulls last)
        from (select assigned_to, asignado, count(*) n from activas group by assigned_to, asignado) x
    ), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$$;

revoke execute on function app.datos_informe_whatsapp(uuid, timestamptz, timestamptz, integer) from public, anon;
grant  execute on function app.datos_informe_whatsapp(uuid, timestamptz, timestamptz, integer) to authenticated, service_role;

-- La RPC de siempre, con la misma firma y el mismo contrato.
create or replace function public.informe_whatsapp(
  p_company uuid,
  p_desde   timestamptz,
  p_hasta   timestamptz,
  p_horas   integer default 4
) returns jsonb
language plpgsql
stable
security invoker
set search_path = public, app, pg_temp
as $$
begin
  if not (p_company = any (app.current_whatsapp_company_ids())) then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  return app.datos_informe_whatsapp(p_company, p_desde, p_hasta, p_horas);
end;
$$;

revoke execute on function public.informe_whatsapp(uuid, timestamptz, timestamptz, integer) from public, anon;
grant  execute on function public.informe_whatsapp(uuid, timestamptz, timestamptz, integer) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 13 · Snapshots de informes
-- ---------------------------------------------------------------------------
-- Un informe por empresa, tipo y período. Regenerar el mismo período
-- ACTUALIZA la fila (unique): nunca hay dos. `source_cutoff` dice hasta cuándo
-- miró los datos; `version` es la versión del formato del payload.
--
-- Los snapshots ven la empresa entera: se leen sólo desde administración
-- (admin y employee). Un vendedor sigue viendo el informe en vivo, acotado a lo
-- suyo.
--
-- Generar un informe NO llama a ningún proveedor y NO lo manda a nadie.

create table if not exists whatsapp_ai_reports (
  id            bigint generated always as identity primary key,
  company_id    uuid not null references companies(id) on delete cascade,
  type          text not null,
  period_start  timestamptz not null,
  period_end    timestamptz not null,
  generated_at  timestamptz not null default now(),
  source_cutoff timestamptz not null,
  payload       jsonb not null,
  version       smallint not null default 1,
  constraint chk_wa_ai_rep_tipo check (type in ('daily', 'weekly')),
  constraint chk_wa_ai_rep_periodo check (
    (type = 'daily' and period_end - period_start = interval '1 day')
    or (type = 'weekly' and period_end - period_start = interval '7 days')),
  constraint uq_wa_ai_rep_periodo unique (company_id, type, period_start, period_end)
);

alter table whatsapp_ai_reports enable row level security;
revoke all on whatsapp_ai_reports from anon, authenticated;
grant select on whatsapp_ai_reports to authenticated;

drop policy if exists wa_ai_rep_select on whatsapp_ai_reports;
create policy wa_ai_rep_select on whatsapp_ai_reports for select to authenticated
  using (company_id = any (app.current_whatsapp_admin_ids()));

create or replace function public.generar_informe_whatsapp(
  p_company uuid,
  p_tipo    text,
  p_desde   timestamptz,
  p_hasta   timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_corte   timestamptz := clock_timestamp();
  v_payload jsonb;
  v_id      bigint;
  v_nuevo   boolean;
  v_largo   interval;
begin
  if p_tipo not in ('daily', 'weekly') then
    raise exception 'TIPO_INVALIDO' using errcode = '22023';
  end if;
  -- Calculado aparte: dentro de un IF de plpgsql, el THEN de un CASE corta la condición.
  v_largo := case p_tipo when 'daily' then interval '1 day' else interval '7 days' end;
  if p_desde is null or p_hasta is null or p_hasta - p_desde <> v_largo then
    raise exception 'PERIODO_INVALIDO' using errcode = '22023';
  end if;
  if not exists (select 1 from companies where id = p_company) then
    raise exception 'EMPRESA_INEXISTENTE' using errcode = '42704';
  end if;

  v_payload := app.datos_informe_whatsapp(p_company, p_desde, p_hasta, 4);

  insert into whatsapp_ai_reports as r (company_id, type, period_start, period_end, generated_at, source_cutoff, payload, version)
  values (p_company, p_tipo, p_desde, p_hasta, now(), v_corte, v_payload, 1)
  on conflict (company_id, type, period_start, period_end) do update set
    payload = excluded.payload, generated_at = now(), source_cutoff = excluded.source_cutoff, version = excluded.version
  returning r.id, (xmax = 0) into v_id, v_nuevo;

  return jsonb_build_object('id', v_id, 'creado', v_nuevo, 'source_cutoff', v_corte);
end;
$$;

revoke execute on function public.generar_informe_whatsapp(uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
grant  execute on function public.generar_informe_whatsapp(uuid, text, timestamptz, timestamptz) to service_role;

-- Lo que corre pg_cron cada 15 minutos. Por cada empresa con informes
-- habilitados (hoy: ninguna):
--   · diario: pasada la hora configurada, el informe de AYER (día cerrado);
--   · semanal: el día y hora configurados, la ÚLTIMA SEMANA CERRADA (lunes a
--     lunes).
-- Si el período ya tiene snapshot, no se regenera: correr esto N veces genera
-- un solo informe por período.

create or replace function app.generar_informes_programados_whatsapp(p_ahora timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_ahora  timestamptz := coalesce(p_ahora, now());
  v_set    record;
  v_local  timestamp;
  v_hoy    date;
  v_lunes  date;
  v_desde  timestamptz;
  v_hasta  timestamptz;
  v_n      integer := 0;
begin
  for v_set in
    select * from whatsapp_ai_settings where daily_report_enabled or weekly_report_enabled
  loop
    begin
      v_local := v_ahora at time zone v_set.timezone;
      v_hoy   := v_local::date;

      if v_set.daily_report_enabled and v_local::time >= v_set.daily_report_time then
        v_desde := (v_hoy - 1)::timestamp at time zone v_set.timezone;
        v_hasta := v_hoy::timestamp at time zone v_set.timezone;
        if not exists (select 1 from whatsapp_ai_reports where company_id = v_set.company_id and type = 'daily'
                        and period_start = v_desde and period_end = v_hasta) then
          perform public.generar_informe_whatsapp(v_set.company_id, 'daily', v_desde, v_hasta);
          v_n := v_n + 1;
        end if;
      end if;

      if v_set.weekly_report_enabled and extract(isodow from v_hoy)::int = v_set.weekly_report_day
         and v_local::time >= v_set.weekly_report_time then
        v_lunes := v_hoy - (extract(isodow from v_hoy)::int - 1);
        v_desde := (v_lunes - 7)::timestamp at time zone v_set.timezone;
        v_hasta := v_lunes::timestamp at time zone v_set.timezone;
        if not exists (select 1 from whatsapp_ai_reports where company_id = v_set.company_id and type = 'weekly'
                        and period_start = v_desde and period_end = v_hasta) then
          perform public.generar_informe_whatsapp(v_set.company_id, 'weekly', v_desde, v_hasta);
          v_n := v_n + 1;
        end if;
      end if;
    exception when others then
      -- Una empresa con un problema no frena a las demás.
      raise warning 'informes programados % : % %', v_set.company_id, sqlstate, left(sqlerrm, 120);
    end;
  end loop;
  return v_n;
end;
$$;

revoke execute on function app.generar_informes_programados_whatsapp(timestamptz) from public, anon, authenticated;
grant  execute on function app.generar_informes_programados_whatsapp(timestamptz) to service_role;

-- `app` no está expuesto por la API: este wrapper existe para que el servidor
-- (y las pruebas) puedan ejecutar la MISMA lógica que corre pg_cron.
create or replace function public.generar_informes_programados_whatsapp(p_ahora timestamptz default null)
returns integer
language sql
security definer
set search_path = public, app, pg_temp
as $$
  select app.generar_informes_programados_whatsapp(p_ahora);
$$;

revoke execute on function public.generar_informes_programados_whatsapp(timestamptz) from public, anon, authenticated;
grant  execute on function public.generar_informes_programados_whatsapp(timestamptz) to service_role;


-- ---------------------------------------------------------------------------
-- 14 · Métricas para el panel de administración
-- ---------------------------------------------------------------------------
-- Una sola lectura agregada (FILTER sobre el índice company_id, created_at):
-- hoy, últimos 7 días y mes actual, en hora argentina. Más la cola, el estado
-- del proveedor y los trabajos fallidos. Sin texto de mensajes.

create or replace function public.metricas_ia_whatsapp(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_zona   text := 'America/Argentina/Buenos_Aires';
  v_hoy    timestamptz;
  v_semana timestamptz;
  v_mes    timestamptz;
  v_res    jsonb;
begin
  if not coalesce(app.is_admin(p_company), false) then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  v_hoy    := app.inicio_dia_local_wa(v_zona, now());
  v_semana := v_hoy - interval '6 days';
  v_mes    := date_trunc('month', now() at time zone v_zona) at time zone v_zona;

  with r as (
    select * from whatsapp_ai_runs
     where company_id = p_company and created_at >= least(v_semana, v_mes)
  ),
  periodo as (
    select k, desde from (values ('hoy', v_hoy), ('ultimos_7_dias', v_semana), ('mes', v_mes)) v(k, desde)
  ),
  agregado as (
    select p.k, jsonb_build_object(
      'corridas',          count(r.id),
      'llamadas',          count(r.id) filter (where r.messages_sent > 0),
      'input_tokens',      coalesce(sum(r.input_tokens), 0),
      'output_tokens',     coalesce(sum(r.output_tokens), 0),
      'reasoning_tokens',  coalesce(sum(r.reasoning_tokens), 0),
      'costo_usd',         coalesce(sum(r.estimated_cost_usd), 0),
      'errores',           count(r.id) filter (where r.status = 'error'),
      'omitidas',          count(r.id) filter (where r.status = 'omitido')
    ) m
      from periodo p left join r on r.created_at >= p.desde
     group by p.k
  ),
  ultimo_ok as (
    select max(created_at) en from whatsapp_ai_runs where company_id = p_company and status = 'ok'
  ),
  ultimo_error as (
    select error_code, created_at from whatsapp_ai_runs
     where company_id = p_company and status = 'error' and error_code like 'proveedor_%'
     order by created_at desc limit 1
  ),
  ultimo_modelo as (
    select provider, model from whatsapp_ai_runs
     where company_id = p_company and status = 'ok' order by created_at desc limit 1
  )
  select jsonb_build_object(
    'periodos', (select jsonb_object_agg(k, m) from agregado),
    'cola', (select jsonb_build_object(
               'pendientes', count(*) filter (where status = 'pending' and last_error is distinct from 'limit_reached'),
               'procesando', count(*) filter (where status = 'processing'),
               'fallidos',   count(*) filter (where status = 'failed'),
               'limite_alcanzado', count(*) filter (where status = 'pending' and last_error = 'limit_reached'),
               'cancelados', count(*) filter (where status = 'cancelled'))
               from whatsapp_ai_analysis_queue where company_id = p_company),
    'proveedor', jsonb_build_object(
      'proveedor', (select provider from ultimo_modelo),
      'modelo', (select model from ultimo_modelo),
      'ultimo_ok_en', (select en from ultimo_ok),
      'ultimo_error', (select error_code from ultimo_error),
      'ultimo_error_en', (select created_at from ultimo_error),
      -- «No disponible»: el último intento contra el proveedor falló y no hubo
      -- un análisis bueno después.
      'no_disponible', coalesce((select e.created_at > coalesce((select en from ultimo_ok), '-infinity')
                                   from ultimo_error e), false)
    ),
    'fallidos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'conversation_id', q.conversation_id,
               'contacto', coalesce(nullif(btrim(c.profile_name), ''), 'Contacto'),
               'error', q.last_error, 'intentos', q.attempts, 'actualizado_en', q.updated_at)
             order by q.updated_at desc)
        from (select * from whatsapp_ai_analysis_queue
               where company_id = p_company and status = 'failed'
               order by updated_at desc limit 20) q
        join whatsapp_conversations c on c.id = q.conversation_id
    ), '[]'::jsonb)
  ) into v_res;

  return v_res;
end;
$$;

revoke execute on function public.metricas_ia_whatsapp(uuid) from public, anon;
grant  execute on function public.metricas_ia_whatsapp(uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 15 · Worker: token interno y disparador
-- ---------------------------------------------------------------------------
-- El worker es una Edge Function sin JWT (la llama pg_cron, que no tiene uno).
-- Lo protege un token aleatorio que NACE en Vault y no sale de la base salvo en
-- el header de esa llamada: no está en el repo, en un secret de Edge Function
-- ni en ningún log. El worker lo valida preguntándole a la base.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'whatsapp_ai_worker_token') then
    perform vault.create_secret(
      encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex'),
      'whatsapp_ai_worker_token',
      'Token interno: pg_cron -> Edge Function whatsapp-ai-worker. No se usa fuera de la base.'
    );
  end if;
end;
$$;

create or replace function public.validar_token_worker_ia_whatsapp(p_token text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_token text;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'whatsapp_ai_worker_token';
  return v_token is not null and p_token is not null
     and sha256(convert_to(p_token, 'UTF8')) = sha256(convert_to(v_token, 'UTF8'));
end;
$$;

revoke execute on function public.validar_token_worker_ia_whatsapp(text) from public, anon, authenticated;
grant  execute on function public.validar_token_worker_ia_whatsapp(text) to service_role;

-- Llama al worker SÓLO si hay algo listo o trabado: con la IA apagada en todas
-- las empresas, esto no hace ninguna llamada HTTP.
create or replace function app.disparar_worker_ia_whatsapp()
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token text;
begin
  if not exists (select 1 from whatsapp_ai_analysis_queue where status = 'pending' and not_before <= now())
     and not exists (select 1 from whatsapp_ai_analysis_queue where status = 'processing' and locked_at < now() - interval '10 minutes') then
    return null;
  end if;

  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'whatsapp_ai_worker_token';
  if v_token is null then
    raise warning 'disparar_worker_ia_whatsapp: falta el token interno';
    return null;
  end if;

  return net.http_post(
    url := 'https://uaxcfufvapzulqvynanp.supabase.co/functions/v1/whatsapp-ai-worker',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-token', v_token),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
end;
$$;

revoke execute on function app.disparar_worker_ia_whatsapp() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 16 · Jobs de pg_cron
-- ---------------------------------------------------------------------------
-- Worker: cada 2 minutos (con debounce de 120 s, un análisis automático sale
-- entre 2 y 4 minutos después del último mensaje). Sin trabajo, no hay HTTP.
-- Informes: cada 15 minutos; sin empresas habilitadas, no genera nada.

select cron.schedule('whatsapp-ai-worker', '*/2 * * * *', $$select app.disparar_worker_ia_whatsapp()$$);
select cron.schedule('whatsapp-ai-informes', '*/15 * * * *', $$select app.generar_informes_programados_whatsapp()$$);


-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- select cron.unschedule('whatsapp-ai-worker');
-- select cron.unschedule('whatsapp-ai-informes');
-- drop function if exists app.disparar_worker_ia_whatsapp();
-- drop function if exists public.validar_token_worker_ia_whatsapp(text);
-- delete from vault.secrets where name = 'whatsapp_ai_worker_token';
-- drop function if exists public.metricas_ia_whatsapp(uuid);
-- drop function if exists public.generar_informes_programados_whatsapp(timestamptz);
-- drop function if exists app.generar_informes_programados_whatsapp(timestamptz);
-- drop function if exists public.generar_informe_whatsapp(uuid, text, timestamptz, timestamptz);
-- drop table if exists whatsapp_ai_reports;
-- -- informe_whatsapp: volver a crear la versión de PHASE_16_WHATSAPP_ENTREGA_2.sql
-- --   (cuerpo inline; OJO: esa versión cuenta los salientes fallidos como enviados)
-- drop function if exists app.datos_informe_whatsapp(uuid, timestamptz, timestamptz, integer);
-- drop function if exists public.guardar_config_ia_whatsapp(uuid, timestamptz, jsonb);
-- drop function if exists public.estado_ia_whatsapp(uuid);
-- drop function if exists public.config_ia_whatsapp(uuid);
-- drop function if exists app.config_ia_json_wa(whatsapp_ai_settings, uuid);
-- drop function if exists public.reintentar_analisis_whatsapp(uuid);
-- drop function if exists public.completar_analisis_whatsapp(uuid, timestamptz, text, text, timestamptz);
-- drop function if exists public.reclamar_analisis_whatsapp(integer, text, timestamptz, uuid);
-- drop function if exists public.verificar_uso_ia_whatsapp(uuid);
-- drop trigger if exists trg_wa_msg_encolar_ia on whatsapp_messages;
-- drop function if exists app.encolar_analisis_whatsapp();
-- drop function if exists app.error_reintentable_wa(text);
-- drop function if exists app.espera_reintento_wa(integer);
-- drop function if exists app.inicio_dia_local_wa(text, timestamptz);
-- delete from whatsapp_ai_runs where status = 'omitido';
-- alter table whatsapp_ai_runs drop constraint if exists chk_wa_ai_run_status;
-- alter table whatsapp_ai_runs add constraint chk_wa_ai_run_status check (status in ('ok', 'error', 'sin_cambios'));
-- -- registrar_corrida_ia_whatsapp: la versión de E2.5 (sin 'omitido')
-- drop table if exists whatsapp_ai_analysis_queue;
-- drop table if exists whatsapp_ai_settings;
-- -- pg_cron y pg_net pueden quedar: sin jobs no hacen nada.
--
-- La función analyze desplegada de E3 llama a `verificar_uso_ia_whatsapp`:
-- revertir la base exige volver a desplegar la función de E2.5 ANTES.
