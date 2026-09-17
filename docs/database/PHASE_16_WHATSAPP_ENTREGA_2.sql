-- ---------------------------------------------------------------------------
-- FASE 16 · WHATSAPP — Entrega 2: capa de IA, informes y preparación para grupos
-- ---------------------------------------------------------------------------
--
-- Principio: la IA NO es fuente de verdad. Todo lo que se crea acá son
-- SUGERENCIAS sobre una conversación —un resumen, pendientes, decisiones—
-- y cada una apunta a los mensajes reales de donde salió. Ninguna función de
-- este archivo toca clientes, pedidos, cotizaciones, stock, asignaciones ni
-- estados de mensajes.
--
-- Lo que agrega:
--   1. Preparación para grupos: `conversation_type`, `provider_group_id`,
--      `group_name` y el autor del mensaje. Sin tabla de participantes todavía.
--   2. `whatsapp_conversation_ai_summary` — un resumen por conversación, con su
--      checkpoint incremental.
--   3. `whatsapp_ai_items` — lo detectado, con `source_message_ids` y
--      fingerprint para no duplicar al reanalizar.
--   4. `whatsapp_ai_runs` — cada llamada al proveedor: tokens, duración, error.
--   5. RPCs: guardar un análisis (sólo servidor), registrar un fallo (sólo
--      servidor), resolver/descartar una sugerencia (persona), señales de
--      atención (reglas determinísticas + IA) e informe por período.
--
-- Lo que NO hace: habilitar grupos, llamar a ningún proveedor, analizar
-- conversaciones reales, abrir la RLS existente ni ampliar permisos.


-- ---------------------------------------------------------------------------
-- 1 · Preparación para grupos
-- ---------------------------------------------------------------------------
-- Hoy toda conversación es 1:1 y así queda: el default rellena las filas
-- existentes con 'individual' al agregar la columna (backfill atómico, sin
-- UPDATE aparte).
--
-- Un grupo futuro NO rompe `uq_wa_conv_contacto (account_id, provider_contact_id)`:
-- su `provider_contact_id` es 'group:' || provider_group_id. Así el índice único
-- sigue valiendo para los dos tipos sin tocarlo, y un wa_id de persona nunca
-- puede chocar con el id de un grupo.

alter table whatsapp_conversations
  add column if not exists conversation_type text not null default 'individual',
  add column if not exists provider_group_id text,
  add column if not exists group_name text;

alter table whatsapp_conversations
  drop constraint if exists chk_wa_conv_tipo;
alter table whatsapp_conversations
  add constraint chk_wa_conv_tipo check (
    (conversation_type = 'individual' and provider_group_id is null and group_name is null)
    or (conversation_type = 'group' and provider_group_id is not null
        and provider_contact_id = 'group:' || provider_group_id)
  );

comment on column whatsapp_conversations.conversation_type is
  'individual (1:1, el unico tipo habilitado hoy) o group (preparado, no habilitado).';

-- En un grupo el que escribe no es «el contacto»: hay que saber quién. En 1:1
-- quedan en NULL — el autor de un inbound es el contacto de la conversación.
alter table whatsapp_messages
  add column if not exists sender_wa_id text,
  add column if not exists sender_name text;

comment on column whatsapp_messages.sender_wa_id is
  'Autor del mensaje en un grupo. NULL en conversaciones individuales.';


-- ---------------------------------------------------------------------------
-- 2 · Resumen por conversación
-- ---------------------------------------------------------------------------
-- Una fila por conversación. El checkpoint (`last_analyzed_message_*`) es lo
-- que hace incremental el análisis: la próxima vez se manda el resumen previo
-- y sólo los mensajes posteriores.
--
-- Si el proveedor falla, `status` pasa a 'error' y `last_error` guarda el
-- código, pero `summary` y el checkpoint NO se tocan: un fallo no borra lo que
-- ya se sabía.

create table if not exists whatsapp_conversation_ai_summary (
  conversation_id          uuid primary key references whatsapp_conversations(id) on delete cascade,
  company_id               uuid not null references companies(id),
  summary                  text,
  topics                   text[] not null default '{}',
  conversation_state       text,
  requires_attention       boolean not null default false,
  last_analyzed_message_id uuid,
  last_analyzed_message_at timestamptz,
  status                   text not null default 'ok',
  last_error               text,
  model                    text,
  analyses_count           integer not null default 0,
  generated_at             timestamptz,
  updated_at               timestamptz not null default now(),
  constraint chk_wa_ai_sum_status check (status in ('ok', 'error')),
  constraint chk_wa_ai_sum_estado check (
    conversation_state is null
    or conversation_state in ('esperando_empresa', 'esperando_contacto', 'en_curso', 'cerrada')
  ),
  constraint chk_wa_ai_sum_largo check (summary is null or char_length(summary) <= 2000),
  constraint chk_wa_ai_sum_temas check (cardinality(topics) <= 10)
);

create index if not exists idx_wa_ai_sum_empresa on whatsapp_conversation_ai_summary (company_id);


-- ---------------------------------------------------------------------------
-- 3 · Lo detectado
-- ---------------------------------------------------------------------------
-- `source_message_ids` es obligatorio y no vacío: una conclusión sin fuente no
-- entra. La RPC verifica además que cada id sea un mensaje de ESTA conversación.
--
-- `fingerprint` = md5(conversación | tipo | fuentes ordenadas | descripción
-- normalizada). Reanalizar lo mismo choca contra el índice único y no duplica;
-- y como el conflicto no actualiza nada, una sugerencia que alguien ya resolvió
-- o descartó no vuelve a abrirse sola.
--
-- `due_at` sólo existe si el mensaje nombra la fecha. Lo valida la función del
-- servidor antes de llegar acá (ver `validarResultado`); la base sólo impide
-- que un vencimiento aparezca en un tipo que no lo admite.

create table if not exists whatsapp_ai_items (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id),
  conversation_id    uuid not null references whatsapp_conversations(id) on delete cascade,
  type               text not null,
  actor              text not null default 'unknown',
  description        text not null,
  source_message_ids uuid[] not null,
  confidence         numeric(3, 2) not null,
  due_at             timestamptz,
  status             text not null default 'open',
  assigned_user_id   uuid references profiles(id),
  fingerprint        text not null,
  model              text,
  generated_at       timestamptz not null default now(),
  resolved_at        timestamptz,
  resolved_by        uuid references profiles(id),
  constraint chk_wa_ai_item_tipo check (
    type in ('pending', 'commitment', 'decision', 'next_step', 'important', 'follow_up')),
  constraint chk_wa_ai_item_actor check (actor in ('company', 'contact', 'unknown')),
  constraint chk_wa_ai_item_estado check (status in ('open', 'resolved', 'dismissed')),
  constraint chk_wa_ai_item_confianza check (confidence >= 0 and confidence <= 1),
  constraint chk_wa_ai_item_fuentes check (cardinality(source_message_ids) between 1 and 20),
  constraint chk_wa_ai_item_texto check (char_length(description) between 1 and 500),
  constraint chk_wa_ai_item_cierre check (
    (status = 'open' and resolved_at is null) or (status <> 'open' and resolved_at is not null)),
  constraint chk_wa_ai_item_vence check (
    due_at is null or type in ('pending', 'commitment', 'next_step', 'follow_up'))
);

create unique index if not exists uq_wa_ai_item_huella on whatsapp_ai_items (conversation_id, fingerprint);
create index if not exists idx_wa_ai_item_conv on whatsapp_ai_items (conversation_id, status);
create index if not exists idx_wa_ai_item_empresa on whatsapp_ai_items (company_id, generated_at desc);
create index if not exists idx_wa_ai_item_abiertos on whatsapp_ai_items (company_id, due_at)
  where status = 'open';


-- ---------------------------------------------------------------------------
-- 4 · Cada llamada al proveedor
-- ---------------------------------------------------------------------------
-- Sin prompts ni respuestas: sólo lo que se necesita para medir costo y
-- detectar fallas. Ni un fragmento de mensaje entra acá.

create table if not exists whatsapp_ai_runs (
  id               bigint generated always as identity primary key,
  company_id       uuid not null references companies(id),
  conversation_id  uuid not null references whatsapp_conversations(id) on delete cascade,
  requested_by     uuid references profiles(id),
  status           text not null,
  error_code       text,
  model            text,
  messages_sent    integer not null default 0,
  input_tokens     integer,
  output_tokens    integer,
  duration_ms      integer,
  items_saved      integer not null default 0,
  items_discarded  integer not null default 0,
  created_at       timestamptz not null default now(),
  constraint chk_wa_ai_run_status check (status in ('ok', 'error', 'sin_cambios'))
);

create index if not exists idx_wa_ai_run_conv on whatsapp_ai_runs (conversation_id, created_at desc);
create index if not exists idx_wa_ai_run_empresa on whatsapp_ai_runs (company_id, created_at desc);

-- Para los informes: mensajes de la empresa en un período, sin recorrer hilos.
create index if not exists idx_wa_msg_empresa_fecha on whatsapp_messages (company_id, ordenado_en);


-- ---------------------------------------------------------------------------
-- 5 · RLS
-- ---------------------------------------------------------------------------
-- Leer lo que la IA dijo de una conversación exige poder leer la conversación:
-- el permiso se DERIVA de `conversation_id`, con la misma función que usan los
-- mensajes. Un vendedor ve la IA de lo que tiene asignado y nada más.
--
-- Nadie escribe directo: no hay policies de INSERT/UPDATE/DELETE. Las
-- escrituras van por RPC.
--
-- Las corridas (costo, tokens) son de administración: admin y employee.

alter table whatsapp_conversation_ai_summary enable row level security;
alter table whatsapp_ai_items enable row level security;
alter table whatsapp_ai_runs enable row level security;

revoke all on whatsapp_conversation_ai_summary from anon, authenticated;
revoke all on whatsapp_ai_items from anon, authenticated;
revoke all on whatsapp_ai_runs from anon, authenticated;
grant select on whatsapp_conversation_ai_summary to authenticated;
grant select on whatsapp_ai_items to authenticated;
grant select on whatsapp_ai_runs to authenticated;

drop policy if exists wa_ai_sum_select on whatsapp_conversation_ai_summary;
create policy wa_ai_sum_select on whatsapp_conversation_ai_summary for select to authenticated
  using (app.puede_ver_conversacion_wa(conversation_id));

drop policy if exists wa_ai_item_select on whatsapp_ai_items;
create policy wa_ai_item_select on whatsapp_ai_items for select to authenticated
  using (app.puede_ver_conversacion_wa(conversation_id));

drop policy if exists wa_ai_run_select on whatsapp_ai_runs;
create policy wa_ai_run_select on whatsapp_ai_runs for select to authenticated
  using (company_id = any (app.current_whatsapp_admin_ids()));


-- ---------------------------------------------------------------------------
-- 6 · Normalización y huella
-- ---------------------------------------------------------------------------
-- La misma regla vive en `logica.ts` (normalizarDescripcion) para deduplicar
-- dentro de un resultado antes de llegar acá. Si cambia una, cambia la otra.

create or replace function app.huella_item_wa(
  p_conv uuid, p_tipo text, p_fuentes uuid[], p_descripcion text
) returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select md5(
    p_conv::text || '|' || p_tipo || '|' ||
    (select coalesce(string_agg(f::text, ',' order by f::text), '')
       from unnest(p_fuentes) f) || '|' ||
    btrim(regexp_replace(lower(p_descripcion), '[^[:alnum:]]+', ' ', 'g'))
  );
$$;

revoke execute on function app.huella_item_wa(uuid, text, uuid[], text) from public, anon, authenticated;
grant  execute on function app.huella_item_wa(uuid, text, uuid[], text) to service_role;


-- ---------------------------------------------------------------------------
-- 7 · Guardar un análisis — SÓLO servidor
-- ---------------------------------------------------------------------------
-- La llama `whatsapp-ai-analyze` con service_role DESPUÉS de validar la salida
-- del modelo. Esta función es la segunda línea: vuelve a validar todo lo que
-- se puede validar en la base.
--
--   p_resultado = {
--     summary, topics[], conversation_state, requires_attention,
--     items: [{ type, actor, description, source_message_ids[], confidence, due_at }]
--   }
--   p_metricas = { messages_sent, input_tokens, output_tokens, duration_ms,
--                  items_discarded, requested_by }
--
-- Incremental y sin retroceso: si ya hay un análisis que llegó MÁS LEJOS que
-- `p_hasta_mensaje`, éste es viejo y se rechaza (ANALISIS_OBSOLETO). Dos
-- análisis simultáneos se serializan con el lock de la conversación.

create or replace function public.guardar_analisis_whatsapp(
  p_conversacion  uuid,
  p_hasta_mensaje uuid,
  p_resultado     jsonb,
  p_modelo        text,
  p_metricas      jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_conv       whatsapp_conversations%rowtype;
  v_hasta_en   timestamptz;
  v_previo_en  timestamptz;
  v_item       jsonb;
  v_fuentes    uuid[];
  v_validas    int;
  v_tipo       text;
  v_actor      text;
  v_desc       text;
  v_conf       numeric;
  v_vence      timestamptz;
  v_nuevos     int := 0;
  v_repetidos  int := 0;
  v_estado     text;
  v_temas      text[];
begin
  select * into v_conv from whatsapp_conversations where id = p_conversacion for update;
  if not found then
    raise exception 'CONVERSACION_INEXISTENTE' using errcode = '42704';
  end if;

  if p_resultado is null or jsonb_typeof(p_resultado) <> 'object' then
    raise exception 'RESULTADO_INVALIDO' using errcode = '22023';
  end if;

  -- El checkpoint tiene que ser un mensaje de ESTA conversación.
  select ordenado_en into v_hasta_en
    from whatsapp_messages where id = p_hasta_mensaje and conversation_id = p_conversacion;
  if v_hasta_en is null then
    raise exception 'CHECKPOINT_INVALIDO' using errcode = '22023';
  end if;

  select last_analyzed_message_at into v_previo_en
    from whatsapp_conversation_ai_summary where conversation_id = p_conversacion;
  if v_previo_en is not null and v_previo_en > v_hasta_en then
    raise exception 'ANALISIS_OBSOLETO';
  end if;

  v_estado := nullif(p_resultado->>'conversation_state', '');
  if v_estado is not null
     and v_estado not in ('esperando_empresa', 'esperando_contacto', 'en_curso', 'cerrada') then
    raise exception 'RESULTADO_INVALIDO' using errcode = '22023', detail = 'conversation_state';
  end if;

  select coalesce(array_agg(left(btrim(t), 60)), '{}')
    into v_temas
    from (select jsonb_array_elements_text(coalesce(p_resultado->'topics', '[]'::jsonb)) t limit 10) x
   where btrim(t) <> '';

  -- ── Ítems ─────────────────────────────────────────────────────────────
  for v_item in select * from jsonb_array_elements(coalesce(p_resultado->'items', '[]'::jsonb)) loop
    v_tipo  := v_item->>'type';
    v_actor := coalesce(v_item->>'actor', 'unknown');
    v_desc  := btrim(coalesce(v_item->>'description', ''));
    v_conf  := (v_item->>'confidence')::numeric;

    if v_tipo is null
       or v_tipo not in ('pending', 'commitment', 'decision', 'next_step', 'important', 'follow_up')
       or v_actor not in ('company', 'contact', 'unknown')
       or v_desc = '' or char_length(v_desc) > 500
       or v_conf is null or v_conf < 0 or v_conf > 1 then
      raise exception 'ITEM_INVALIDO' using errcode = '22023';
    end if;

    select coalesce(array_agg(distinct x::uuid), '{}')
      into v_fuentes
      from jsonb_array_elements_text(coalesce(v_item->'source_message_ids', '[]'::jsonb)) x;

    if cardinality(v_fuentes) = 0 then
      raise exception 'ITEM_SIN_FUENTE' using errcode = '22023';
    end if;

    -- Cada fuente tiene que ser un mensaje real de esta conversación. Un id
    -- inventado, de otra conversación o de un mensaje borrado corta todo.
    select count(*) into v_validas
      from whatsapp_messages
     where conversation_id = p_conversacion and id = any (v_fuentes);
    if v_validas <> cardinality(v_fuentes) then
      raise exception 'FUENTE_INVALIDA' using errcode = '22023';
    end if;

    v_vence := nullif(v_item->>'due_at', '')::timestamptz;

    insert into whatsapp_ai_items (
      company_id, conversation_id, type, actor, description, source_message_ids,
      confidence, due_at, fingerprint, model
    ) values (
      v_conv.company_id, p_conversacion, v_tipo, v_actor, v_desc, v_fuentes,
      round(v_conf, 2), v_vence,
      app.huella_item_wa(p_conversacion, v_tipo, v_fuentes, v_desc), p_modelo
    )
    on conflict (conversation_id, fingerprint) do nothing;

    if found then v_nuevos := v_nuevos + 1; else v_repetidos := v_repetidos + 1; end if;
  end loop;

  -- ── Resumen ───────────────────────────────────────────────────────────
  insert into whatsapp_conversation_ai_summary as s (
    conversation_id, company_id, summary, topics, conversation_state, requires_attention,
    last_analyzed_message_id, last_analyzed_message_at, status, last_error, model,
    analyses_count, generated_at, updated_at
  ) values (
    p_conversacion, v_conv.company_id,
    left(nullif(btrim(p_resultado->>'summary'), ''), 2000), v_temas, v_estado,
    coalesce((p_resultado->>'requires_attention')::boolean, false),
    p_hasta_mensaje, v_hasta_en, 'ok', null, p_modelo, 1, now(), now()
  )
  on conflict (conversation_id) do update set
    summary                  = excluded.summary,
    topics                   = excluded.topics,
    conversation_state       = excluded.conversation_state,
    requires_attention       = excluded.requires_attention,
    last_analyzed_message_id = excluded.last_analyzed_message_id,
    last_analyzed_message_at = excluded.last_analyzed_message_at,
    status                   = 'ok',
    last_error               = null,
    model                    = excluded.model,
    analyses_count           = s.analyses_count + 1,
    generated_at             = now(),
    updated_at               = now();

  insert into whatsapp_ai_runs (
    company_id, conversation_id, requested_by, status, model, messages_sent,
    input_tokens, output_tokens, duration_ms, items_saved, items_discarded
  ) values (
    v_conv.company_id, p_conversacion, nullif(p_metricas->>'requested_by', '')::uuid, 'ok', p_modelo,
    coalesce((p_metricas->>'messages_sent')::int, 0),
    (p_metricas->>'input_tokens')::int, (p_metricas->>'output_tokens')::int,
    (p_metricas->>'duration_ms')::int, v_nuevos,
    coalesce((p_metricas->>'items_discarded')::int, 0)
  );

  return jsonb_build_object('ok', true, 'items_nuevos', v_nuevos, 'items_repetidos', v_repetidos);
end;
$$;

revoke execute on function public.guardar_analisis_whatsapp(uuid, uuid, jsonb, text, jsonb) from public, anon, authenticated;
grant  execute on function public.guardar_analisis_whatsapp(uuid, uuid, jsonb, text, jsonb) to service_role;


-- ---------------------------------------------------------------------------
-- 8 · Registrar un fallo — SÓLO servidor
-- ---------------------------------------------------------------------------
-- No destructivo: el resumen previo y su checkpoint quedan como estaban. Si
-- todavía no había resumen, se crea la fila vacía con el error, para que la
-- pantalla pueda decir «el último análisis falló» en vez de nada.
--
-- `p_estado = 'sin_cambios'` registra una corrida que no llamó al proveedor
-- (no había mensajes nuevos): cuenta para medir, no para el resumen.

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
  if p_estado is null or p_estado not in ('error', 'sin_cambios') then
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
    input_tokens, output_tokens, duration_ms
  ) values (
    v_empresa, p_conversacion, nullif(p_metricas->>'requested_by', '')::uuid, p_estado,
    left(p_error_code, 80), p_modelo,
    coalesce((p_metricas->>'messages_sent')::int, 0),
    (p_metricas->>'input_tokens')::int, (p_metricas->>'output_tokens')::int,
    (p_metricas->>'duration_ms')::int
  );
end;
$$;

revoke execute on function public.registrar_corrida_ia_whatsapp(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant  execute on function public.registrar_corrida_ia_whatsapp(uuid, text, text, text, jsonb) to service_role;


-- ---------------------------------------------------------------------------
-- 9 · Resolver o descartar una sugerencia — la persona
-- ---------------------------------------------------------------------------
-- Es la ÚNICA escritura humana sobre lo que dijo la IA, y sólo cambia el
-- estado de la sugerencia. No crea tareas, no asigna, no toca nada más.
--
-- Puede hacerlo quien puede VER la conversación: resolver una sugerencia no es
-- un permiso de negocio nuevo, es marcarla como atendida.

create or replace function public.resolver_item_ia_whatsapp(p_item uuid, p_estado text)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_item whatsapp_ai_items%rowtype;
begin
  if p_estado is null or p_estado not in ('open', 'resolved', 'dismissed') then
    raise exception 'ESTADO_INVALIDO' using errcode = '22023';
  end if;

  select * into v_item from whatsapp_ai_items where id = p_item for update;
  -- Inexistente o invisible dan el MISMO error: no se confirma que exista.
  if not found or not app.puede_ver_conversacion_wa(v_item.conversation_id) then
    raise exception 'ITEM_INEXISTENTE' using errcode = '42704';
  end if;

  update whatsapp_ai_items set
    status      = p_estado,
    resolved_at = case when p_estado = 'open' then null else now() end,
    resolved_by = case when p_estado = 'open' then null else auth.uid() end
  where id = p_item;

  return jsonb_build_object('ok', true, 'estado', p_estado);
end;
$$;

revoke execute on function public.resolver_item_ia_whatsapp(uuid, text) from public, anon;
grant  execute on function public.resolver_item_ia_whatsapp(uuid, text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 10 · Señales de atención — reglas + IA
-- ---------------------------------------------------------------------------
-- NO depende sólo de la IA. Cinco reglas determinísticas y una sexta que viene
-- del último análisis; cualquiera alcanza:
--
--   sin_respuesta     el último mensaje es del contacto (derivado de los mensajes)
--   pregunta          el último mensaje del contacto, posterior a nuestra última
--                     respuesta, tiene un signo de pregunta
--   demora            sin respuesta hace más de p_horas
--   error_envio       nuestro último mensaje falló
--   pendiente_abierto hay un pendiente, seguimiento o compromiso de la empresa abierto
--   ia                el último análisis la marcó
--
-- SECURITY INVOKER: corre con la RLS de quien pregunta. Pasar ids de
-- conversaciones ajenas devuelve cero filas, no un error ni un dato.

create or replace function public.senales_atencion_whatsapp(
  p_conversaciones uuid[],
  p_horas          integer default 4
) returns table (conversation_id uuid, motivos text[])
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  -- «Espera respuesta» se deriva de los MENSAJES, no de la columna
  -- desnormalizada `last_message_dir`: ésa no se recalcula si un mensaje se
  -- borra, y la suite lo encontró así.
  with conv as (
    select c.id
      from whatsapp_conversations c
     where c.id = any (p_conversaciones)
  ),
  ultimo_in as (
    select distinct on (m.conversation_id) m.conversation_id, m.text_body, m.caption, m.ordenado_en
      from whatsapp_messages m join conv on conv.id = m.conversation_id
     where m.direction = 'in'
     order by m.conversation_id, m.ordenado_en desc
  ),
  ultimo_out as (
    select distinct on (m.conversation_id) m.conversation_id, m.status, m.ordenado_en
      from whatsapp_messages m join conv on conv.id = m.conversation_id
     where m.direction = 'out'
     order by m.conversation_id, m.ordenado_en desc
  ),
  base as (
    select conv.id,
           ui.conversation_id is not null
             and (uo.ordenado_en is null or ui.ordenado_en > uo.ordenado_en) as espera,
           ui.text_body, ui.caption, ui.ordenado_en as in_en, uo.status as out_status
      from conv
      left join ultimo_in  ui on ui.conversation_id = conv.id
      left join ultimo_out uo on uo.conversation_id = conv.id
  )
  select b.id,
         array_remove(array[
           case when b.espera then 'sin_respuesta' end,
           case when b.espera and coalesce(b.text_body, b.caption, '') ~ '[?¿]' then 'pregunta' end,
           case when b.espera and b.in_en < now() - make_interval(hours => greatest(p_horas, 1)) then 'demora' end,
           case when b.out_status = 'failed' then 'error_envio' end,
           case when exists (
                  select 1 from whatsapp_ai_items i
                   where i.conversation_id = b.id and i.status = 'open'
                     and (i.type in ('pending', 'follow_up')
                          or (i.type = 'commitment' and i.actor = 'company')))
                then 'pendiente_abierto' end,
           case when s.requires_attention then 'ia' end
         ], null) as motivos
    from base b
    left join whatsapp_conversation_ai_summary s on s.conversation_id = b.id;
$$;

revoke execute on function public.senales_atencion_whatsapp(uuid[], integer) from public, anon;
grant  execute on function public.senales_atencion_whatsapp(uuid[], integer) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 11 · Informe por período
-- ---------------------------------------------------------------------------
-- Diario y semanal son la MISMA función con otro rango: el navegador calcula
-- el día o la semana en la hora de Argentina y manda los bordes.
--
-- No se persiste nada: el informe se arma a demanda con lo que ya existe
-- (conversaciones, mensajes, resúmenes, ítems). Pedirlo dos veces no escribe
-- dos veces ni llama a la IA.
--
-- SECURITY INVOKER: la RLS acota a lo que la persona puede ver. Un vendedor
-- obtiene el informe de SUS conversaciones asignadas, no el de la empresa.
-- Además se exige que la empresa sea una de las suyas con WhatsApp.
--
-- Lo que una persona DESCARTÓ no cuenta como compromiso ni decisión detectada:
-- alguien dijo que la sugerencia estaba mal.
--
-- Sólo hechos: no hay rankings, puntajes ni «performance» de nadie. Por
-- asignado se cuentan conversaciones, nada más.

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
declare
  v_resultado jsonb;
  v_ids       uuid[];
begin
  if not (p_company = any (app.current_whatsapp_company_ids())) then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta <= p_desde
     or p_hasta - p_desde > interval '31 days' then
    raise exception 'PERIODO_INVALIDO' using errcode = '22023';
  end if;

  -- Las conversaciones con actividad en el período, ya filtradas por RLS.
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
           count(*) filter (where direction = 'out') as salientes,
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
                                      -- Un vencimiento es un DÍA (medianoche UTC de la fecha escrita): vence cuando
                                      -- termina ese día en Argentina, no a las 21 h del día anterior.
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

revoke execute on function public.informe_whatsapp(uuid, timestamptz, timestamptz, integer) from public, anon;
grant  execute on function public.informe_whatsapp(uuid, timestamptz, timestamptz, integer) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- drop function if exists public.informe_whatsapp(uuid, timestamptz, timestamptz, integer);
-- drop function if exists public.senales_atencion_whatsapp(uuid[], integer);
-- drop function if exists public.resolver_item_ia_whatsapp(uuid, text);
-- drop function if exists public.registrar_corrida_ia_whatsapp(uuid, text, text, text, jsonb);
-- drop function if exists public.guardar_analisis_whatsapp(uuid, uuid, jsonb, text, jsonb);
-- drop function if exists app.huella_item_wa(uuid, text, uuid[], text);
-- drop index if exists idx_wa_msg_empresa_fecha;
-- drop table if exists whatsapp_ai_runs;
-- drop table if exists whatsapp_ai_items;
-- drop table if exists whatsapp_conversation_ai_summary;
-- alter table whatsapp_messages drop column if exists sender_name, drop column if exists sender_wa_id;
-- alter table whatsapp_conversations drop constraint if exists chk_wa_conv_tipo;
-- alter table whatsapp_conversations drop column if exists group_name,
--   drop column if exists provider_group_id, drop column if exists conversation_type;
--
-- Las tres tablas nuevas no tienen dependencias fuera de este archivo, y las
-- columnas agregadas son nullable o tienen default: soltarlas no pierde ningún
-- dato de la integración 1:1.
