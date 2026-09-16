-- ---------------------------------------------------------------------------
-- FASE 16 · WhatsApp Cloud API — Entrega 1
-- Ventana de servicio, vínculo con el cliente y las tres funciones que usa
-- el backend.
-- ---------------------------------------------------------------------------
--
-- La Fase 8 ya dejó aplicado el modelo entero (seis tablas, RLS, privilegios,
-- bucket y Realtime) y está vacío. Esta migración NO lo rehace: agrega lo
-- único que faltaba para operar contra Meta.
--
-- 1. Tres columnas en `whatsapp_conversations`: cuándo fue el último entrante,
--    el último saliente y cuándo vence la ventana de 24 horas.
-- 2. `app.vincular_telefono_whatsapp` — a qué cliente corresponde un número.
-- 3. `public.registrar_entrante_whatsapp` — un mensaje entrante, idempotente.
-- 4. `public.registrar_estado_whatsapp` — un acuse de Meta, sin retroceder.
-- 5. `public.encolar_mensaje_whatsapp` — un saliente, validando la ventana.
--
-- Las tres primeras son SÓLO para `service_role`: las llama el webhook. La
-- cuarta la llama una persona con su JWT y valida al actor adentro, como
-- `asignar_conversacion_whatsapp`.
--
-- NO toca: la base legacy, ninguna tabla de otro módulo, ninguna policy
-- existente, la autoridad de numeración, Ventas ni Storage.
--
-- SOBRE LOS REVOKE: el proyecto tiene ALTER DEFAULT PRIVILEGES que otorga
-- EXECUTE sobre toda función nueva del esquema public a anon, authenticated y
-- service_role. Son grants EXPLÍCITOS POR ROL, así que un
-- "revoke execute ... from public" NO los saca: hay que nombrar cada rol.
--
-- Lo encontró la suite, no la lectura del código. Con sólo el revoke de public,
-- cualquier persona con sesión —y el anónimo— podía fabricar un mensaje
-- entrante como si viniera de Meta, o sellar uno saliente. Es exactamente el
-- fallo que se lee como éxito si uno mira el SQL y no el efecto.


-- ---------------------------------------------------------------------------
-- 1 · Ventana de servicio
-- ---------------------------------------------------------------------------
-- Meta permite texto libre sólo durante 24 horas desde el último mensaje del
-- cliente. Fuera de eso hay que usar una plantilla aprobada.
--
-- `service_window_expires_at` se intentó como columna GENERADA y Postgres la
-- rechaza: `timestamptz + interval` no es inmutable (depende de la zona), así
-- que no puede ir en una expresión de generación. Queda como columna común con
-- UN SOLO escritor —`registrar_entrante_whatsapp`—, que es además la única
-- función que mueve `last_inbound_at`. Nadie más la toca.
--
-- La UI la lee para saber si puede escribir, y el backend la vuelve a validar
-- antes de mandar: el navegador no decide esto.

alter table whatsapp_conversations
  add column if not exists last_inbound_at  timestamptz,
  add column if not exists last_outbound_at timestamptz,
  add column if not exists service_window_expires_at timestamptz;

comment on column whatsapp_conversations.service_window_expires_at is
  'Vence la ventana de servicio de Meta: 24 h desde el ultimo entrante. La escribe solo registrar_entrante_whatsapp.';


-- ---------------------------------------------------------------------------
-- 2 · A qué cliente corresponde un número
-- ---------------------------------------------------------------------------
-- El problema real: WhatsApp manda 5491121866133 y en la base el mismo
-- teléfono puede estar como «+54 11 2186-6133», «11 2186 6133», «011...» o
-- «15...». Normalizar con reemplazos (sacar el 9, agregar el 15) es destructivo
-- y se equivoca con los números de otras provincias.
--
-- Por eso el match NO reescribe el número: compara los ÚLTIMOS 8 DÍGITOS
-- (`app.cola_telefono`, de la Fase 8), que es lo que sobrevive a todas esas
-- variantes. Primero se intenta la igualdad exacta del E.164 normalizado;
-- recién si no hay, la cola.
--
-- Si hay más de un candidato NO se elige ninguno: una conversación vinculada
-- al cliente equivocado es peor que una sin vincular. Queda para revisión
-- humana, que es lo que pide el vínculo manual.

create or replace function app.vincular_telefono_whatsapp(
  p_company uuid,
  p_phone   text
) returns table (customer_id uuid, customer_contact_id uuid, origen text)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  with normalizado as (
    select app.normalizar_telefono(p_phone) as e164,
           app.cola_telefono(p_phone)       as cola
  ),
  -- Candidatos por contacto de cliente y por cliente, con su grado de certeza.
  candidatos as (
    select cc.customer_id, cc.id as contacto_id,
           case when app.normalizar_telefono(cc.phone) = n.e164 then 'exacto' else 'normalizado' end as origen
      from customer_contacts cc, normalizado n
     where cc.company_id = p_company
       and n.cola is not null
       and app.cola_telefono(cc.phone) = n.cola

    union all

    select c.id, null::uuid,
           case when app.normalizar_telefono(c.phone) = n.e164 then 'exacto' else 'normalizado' end
      from customers c, normalizado n
     where c.company_id = p_company
       and c.deleted_at is null
       and n.cola is not null
       and app.cola_telefono(c.phone) = n.cola
  ),
  -- Un contacto y su propio cliente no son dos candidatos: son el mismo.
  por_cliente as (
    select customer_id,
           -- Si hay UN solo contacto, se toma; si hay varios, el cliente sin contacto.
           case when count(*) filter (where contacto_id is not null) = 1
                -- max(uuid) no existe en Postgres; con un solo elemento
                -- alcanza con tomar el primero del array.
                then (array_agg(contacto_id) filter (where contacto_id is not null))[1]
           end as contacto_id,
           case when bool_or(origen = 'exacto') then 'exacto' else 'normalizado' end as origen
      from candidatos
     group by customer_id
  )
  select p.customer_id, p.contacto_id, p.origen
    from por_cliente p
   -- Ambiguo entre dos clientes distintos: no se vincula nada.
   where (select count(*) from por_cliente) = 1;
$$;

revoke execute on function app.vincular_telefono_whatsapp(uuid, text) from public, anon, authenticated;
grant  execute on function app.vincular_telefono_whatsapp(uuid, text) to service_role;


-- ---------------------------------------------------------------------------
-- 3 · Un mensaje entrante
-- ---------------------------------------------------------------------------
-- Todo el trabajo de un entrante en UNA transacción y UN viaje: resolver la
-- cuenta por `phone_number_id`, encontrar o crear la conversación, intentar el
-- vínculo, insertar el mensaje y mover la ventana.
--
-- Idempotente por diseño: Meta reintenta hasta 36 horas y el mismo `wamid`
-- vuelve. El `on conflict do nothing` sobre `uq_wa_msg_provider` es lo que
-- garantiza una sola fila; si no insertó, la función devuelve `duplicado` y no
-- vuelve a mover la ventana ni el preview.
--
-- Devuelve jsonb y no lanza excepción para los casos esperables: el webhook
-- tiene que contestar 200 a Meta igual, y un evento de una cuenta que no es
-- nuestra no es un error del servidor.

create or replace function public.registrar_entrante_whatsapp(
  p_phone_number_id text,
  p_waba_id         text,
  p_wa_id           text,
  p_profile_name    text,
  p_provider_message_id text,
  p_tipo            text,
  p_texto           text,
  p_caption         text,
  p_reply_to        text,
  p_timestamp       timestamptz,
  p_media           jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_cuenta   whatsapp_accounts%rowtype;
  v_conv     whatsapp_conversations%rowtype;
  v_vinculo  record;
  v_msg_id   uuid;
  v_media_id uuid;
  v_preview  text;
  v_cuando   timestamptz;
begin
  -- 1 · La cuenta. Un evento cuyo phone_number_id no está configurado y activo
  --     se ignora: es de otra cuenta, o de una que dimos de baja.
  select * into v_cuenta
    from whatsapp_accounts
   where phone_number_id = p_phone_number_id and active
   limit 1;
  if not found then
    return jsonb_build_object('resultado', 'cuenta_desconocida');
  end if;

  v_cuando := coalesce(p_timestamp, now());

  -- 2 · La conversación. La identidad es (cuenta, wa_id), no el teléfono:
  --     el wa_id es lo único que Meta garantiza estable.
  insert into whatsapp_conversations (
    company_id, account_id, provider_contact_id, phone_raw, phone_e164, profile_name
  )
  values (
    v_cuenta.company_id, v_cuenta.id, p_wa_id, p_wa_id,
    app.normalizar_telefono(p_wa_id), nullif(p_profile_name, '')
  )
  on conflict (account_id, provider_contact_id) do update
     -- El nombre de perfil lo cambia el cliente cuando quiere; se refresca.
     set profile_name = coalesce(nullif(excluded.profile_name, ''), whatsapp_conversations.profile_name)
  returning * into v_conv;

  -- 3 · Vínculo con el cliente, sólo si todavía no lo tiene. Un vínculo manual
  --     hecho por una persona no se pisa con el automático.
  if v_conv.customer_id is null then
    select * into v_vinculo
      from app.vincular_telefono_whatsapp(v_cuenta.company_id, p_wa_id);
    if found and v_vinculo.customer_id is not null then
      update whatsapp_conversations
         set customer_id = v_vinculo.customer_id,
             customer_contact_id = v_vinculo.customer_contact_id,
             vinculo_origen = v_vinculo.origen
       where id = v_conv.id;
    end if;
  end if;

  -- 4 · La media, si el mensaje la trae. Nace `pendiente`: el archivo lo baja
  --     el backend después de contestarle a Meta, nunca antes.
  if p_media is not null and p_media ? 'id' then
    insert into whatsapp_media (
      company_id, conversation_id, provider_media_id, mime_type, file_name, sha256
    )
    values (
      v_cuenta.company_id, v_conv.id,
      p_media->>'id',
      coalesce(nullif(p_media->>'mime_type', ''), 'application/octet-stream'),
      nullif(p_media->>'filename', ''),
      nullif(p_media->>'sha256', '')
    )
    returning id into v_media_id;
  end if;

  -- 5 · El mensaje. Acá vive la idempotencia.
  insert into whatsapp_messages (
    company_id, account_id, conversation_id, direction, message_type,
    text_body, caption, provider_message_id, reply_to_provider_id,
    status, provider_timestamp, received_at, media_id
  )
  values (
    v_cuenta.company_id, v_cuenta.id, v_conv.id, 'in', p_tipo,
    nullif(p_texto, ''), nullif(p_caption, ''), p_provider_message_id,
    nullif(p_reply_to, ''), 'received', v_cuando, now(), v_media_id
  )
  -- El predicado NO es decorativo: uq_wa_msg_provider es un índice único
  -- PARCIAL, y un ON CONFLICT que no lo repite no lo encuentra.
  on conflict (account_id, provider_message_id) where provider_message_id is not null do nothing
  returning id into v_msg_id;

  if v_msg_id is null then
    -- Ya estaba. Se borra la media que se acababa de crear para este intento:
    -- si no, cada reintento de Meta dejaría un huérfano que alguien baja.
    if v_media_id is not null then
      delete from whatsapp_media where id = v_media_id;
    end if;
    return jsonb_build_object('resultado', 'duplicado', 'conversation_id', v_conv.id);
  end if;

  -- 6 · Cabecera de la conversación y ventana de servicio.
  v_preview := left(coalesce(nullif(p_texto, ''), nullif(p_caption, ''), '[' || p_tipo || ']'), 160);
  update whatsapp_conversations
     set last_message_at = v_cuando,
         last_message_preview = v_preview,
         last_message_dir = 'in',
         last_inbound_at = greatest(coalesce(last_inbound_at, '-infinity'::timestamptz), v_cuando),
         service_window_expires_at = greatest(coalesce(last_inbound_at, '-infinity'::timestamptz), v_cuando) + interval '24 hours'
   where id = v_conv.id;

  return jsonb_build_object(
    'resultado', 'creado',
    'conversation_id', v_conv.id,
    'message_id', v_msg_id,
    'media_id', v_media_id
  );
end;
$$;

revoke execute on function public.registrar_entrante_whatsapp(text, text, text, text, text, text, text, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant  execute on function public.registrar_entrante_whatsapp(text, text, text, text, text, text, text, text, text, timestamptz, jsonb) to service_role;


-- ---------------------------------------------------------------------------
-- 4 · Un acuse de Meta
-- ---------------------------------------------------------------------------
-- Cada estado tiene SU columna (la Fase 8 lo diseñó así porque Meta puede
-- mandar éxito y fallo del mismo mensaje desde dos dispositivos), y
-- `estado_visible` se deriva por precedencia. Así que acá no hay que decidir
-- nada: se sella la marca de tiempo del evento y listo.
--
-- Un acuse atrasado NO retrocede: `least` sobre la marca existente conserva la
-- primera vez que pasó, y `read` nunca vuelve a `sent` porque son columnas
-- distintas, no un campo que se pisa.

create or replace function public.registrar_estado_whatsapp(
  p_phone_number_id text,
  p_provider_message_id text,
  p_estado          text,
  p_timestamp       timestamptz,
  p_error_code      int default null,
  p_error_details   text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_cuenta_id uuid;
  v_msg_id    uuid;
  v_cuando    timestamptz := coalesce(p_timestamp, now());
begin
  select id into v_cuenta_id
    from whatsapp_accounts
   where phone_number_id = p_phone_number_id and active
   limit 1;
  if v_cuenta_id is null then
    return jsonb_build_object('resultado', 'cuenta_desconocida');
  end if;

  update whatsapp_messages m
     set sent_at      = case when p_estado in ('sent','delivered','read')
                             then least(coalesce(m.sent_at, v_cuando), v_cuando) else m.sent_at end,
         delivered_at = case when p_estado in ('delivered','read')
                             then least(coalesce(m.delivered_at, v_cuando), v_cuando) else m.delivered_at end,
         read_at      = case when p_estado = 'read'
                             then least(coalesce(m.read_at, v_cuando), v_cuando) else m.read_at end,
         failed_at    = case when p_estado = 'failed'
                             then coalesce(m.failed_at, v_cuando) else m.failed_at end,
         -- `status` es la cola de salida, no lo que ve el usuario. Una vez que
         -- Meta aceptó el mensaje, la cola terminó: no se vuelve a intentar.
         status       = case when p_estado = 'failed' and m.status in ('pending','sending') then 'failed'
                             when p_estado in ('sent','delivered','read') then 'sent'
                             else m.status end,
         provider_status = p_estado,
         error_code    = coalesce(p_error_code, m.error_code),
         error_details = coalesce(nullif(p_error_details, ''), m.error_details)
   where m.account_id = v_cuenta_id
     and m.provider_message_id = p_provider_message_id
     and m.direction = 'out'
  returning m.id into v_msg_id;

  if v_msg_id is null then
    -- El acuse puede llegar antes de que terminemos de guardar el saliente, o
    -- ser de un mensaje que no es nuestro. No es un error del webhook.
    return jsonb_build_object('resultado', 'sin_mensaje');
  end if;
  return jsonb_build_object('resultado', 'actualizado', 'message_id', v_msg_id);
end;
$$;

revoke execute on function public.registrar_estado_whatsapp(text, text, text, timestamptz, int, text) from public, anon, authenticated;
grant  execute on function public.registrar_estado_whatsapp(text, text, text, timestamptz, int, text) to service_role;


-- ---------------------------------------------------------------------------
-- 5 · Encolar un saliente
-- ---------------------------------------------------------------------------
-- Esta la llama una PERSONA, con su JWT, desde la Edge Function de envío. Es
-- `security definer` y valida al actor adentro: la misma forma que
-- `asignar_conversacion_whatsapp`, que es la única puerta de la asignación.
--
-- Lo que valida, en orden: que la conversación exista, que el actor pueda
-- verla (la misma función que usa toda la RLS), que su rol escriba, que la
-- cuenta esté activa y que la ventana de servicio esté abierta.
--
-- La ventana se valida ACÁ y no sólo en el navegador. Si el frontend se
-- equivoca o alguien llama la función a mano, Meta cobraría una plantilla o
-- devolvería un error; es más barato cortarlo antes.

create or replace function public.encolar_mensaje_whatsapp(
  p_conversacion      uuid,
  p_texto             text,
  p_client_request_id uuid
) returns whatsapp_messages
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_conv   whatsapp_conversations%rowtype;
  v_rol    text;
  v_activa boolean;
  v_msg    whatsapp_messages%rowtype;
begin
  if p_client_request_id is null then
    raise exception 'CLIENT_REQUEST_ID_REQUERIDO' using errcode = '22023';
  end if;
  if coalesce(btrim(p_texto), '') = '' then
    raise exception 'TEXTO_VACIO' using errcode = '22023';
  end if;
  if length(p_texto) > 4096 then
    raise exception 'TEXTO_DEMASIADO_LARGO' using errcode = '22023';
  end if;

  select * into v_conv from whatsapp_conversations where id = p_conversacion;
  if not found then
    raise exception 'CONVERSACION_INEXISTENTE' using errcode = '42704';
  end if;

  -- La misma regla de visibilidad que la RLS: admin y employee ven toda la
  -- empresa, el vendedor sólo lo asignado.
  if not app.puede_ver_conversacion_wa(p_conversacion) then
    raise exception 'SIN_ACCESO' using errcode = '42501';
  end if;

  select cm.role into v_rol
    from company_memberships cm
   where cm.user_id = auth.uid()
     and cm.company_id = v_conv.company_id
     and cm.status = 'active'
   limit 1;
  if v_rol is null or v_rol not in ('admin', 'employee', 'salesperson') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  select active into v_activa from whatsapp_accounts where id = v_conv.account_id;
  if not coalesce(v_activa, false) then
    raise exception 'CUENTA_INACTIVA' using errcode = '42501';
  end if;

  if v_conv.service_window_expires_at is null or v_conv.service_window_expires_at <= now() then
    raise exception 'TEMPLATE_REQUIRED' using errcode = '42501';
  end if;

  insert into whatsapp_messages (
    company_id, account_id, conversation_id, direction, message_type,
    text_body, status, client_request_id, next_attempt_at, created_by
  )
  values (
    v_conv.company_id, v_conv.account_id, p_conversacion, 'out', 'text',
    p_texto, 'pending', p_client_request_id, now(), auth.uid()
  )
  -- Mismo caso: uq_wa_msg_cliente también es parcial.
  on conflict (account_id, client_request_id) where client_request_id is not null do nothing
  returning * into v_msg;

  if v_msg.id is null then
    -- Doble clic, o un reintento del navegador: se devuelve el que ya existe
    -- en vez de crear un segundo mensaje.
    select * into v_msg
      from whatsapp_messages
     where account_id = v_conv.account_id and client_request_id = p_client_request_id;
  end if;

  return v_msg;
end;
$$;

revoke execute on function public.encolar_mensaje_whatsapp(uuid, text, uuid) from public, anon;
grant  execute on function public.encolar_mensaje_whatsapp(uuid, text, uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 6 · Sellar el saliente después de que Meta lo aceptó
-- ---------------------------------------------------------------------------
-- Sólo `service_role`: lo llama la Edge Function de envío con la respuesta de
-- Graph. Guarda el wamid y mueve `last_outbound_at`.

create or replace function public.sellar_saliente_whatsapp(
  p_mensaje uuid,
  p_provider_message_id text,
  p_error_code    int default null,
  p_error_details text default null
) returns whatsapp_messages
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_msg whatsapp_messages%rowtype;
begin
  update whatsapp_messages
     set provider_message_id = coalesce(p_provider_message_id, provider_message_id),
         status   = case when p_provider_message_id is not null then 'sent' else 'failed' end,
         sent_at  = case when p_provider_message_id is not null then coalesce(sent_at, now()) else sent_at end,
         failed_at = case when p_provider_message_id is null then coalesce(failed_at, now()) else failed_at end,
         error_code = p_error_code,
         error_details = nullif(p_error_details, ''),
         claimed_at = null,
         next_attempt_at = null
   where id = p_mensaje
  returning * into v_msg;

  if v_msg.id is null then
    raise exception 'MENSAJE_INEXISTENTE' using errcode = '42704';
  end if;

  if p_provider_message_id is not null then
    update whatsapp_conversations
       set last_message_at = coalesce(v_msg.sent_at, now()),
           last_message_preview = left(coalesce(v_msg.text_body, '[mensaje]'), 160),
           last_message_dir = 'out',
           last_outbound_at = coalesce(v_msg.sent_at, now())
     where id = v_msg.conversation_id;
  end if;

  return v_msg;
end;
$$;

revoke execute on function public.sellar_saliente_whatsapp(uuid, text, int, text) from public, anon, authenticated;
grant  execute on function public.sellar_saliente_whatsapp(uuid, text, int, text) to service_role;


-- ---------------------------------------------------------------------------
-- 7 · Marcar la media como descargada
-- ---------------------------------------------------------------------------

create or replace function public.sellar_media_whatsapp(
  p_media uuid,
  p_storage_path text,
  p_size_bytes bigint,
  p_mime_type text default null,
  p_error_details text default null
) returns void
language sql
security definer
set search_path = public, app, pg_temp
as $$
  update whatsapp_media
     set status = case when p_storage_path is not null then 'descargada' else 'fallida' end,
         storage_path = coalesce(p_storage_path, storage_path),
         size_bytes = coalesce(p_size_bytes, size_bytes),
         mime_type = coalesce(nullif(p_mime_type, ''), mime_type),
         downloaded_at = case when p_storage_path is not null then now() else downloaded_at end,
         attempts = attempts + 1,
         error_details = nullif(p_error_details, '')
   where id = p_media;
$$;

revoke execute on function public.sellar_media_whatsapp(uuid, text, bigint, text, text) from public, anon, authenticated;
grant  execute on function public.sellar_media_whatsapp(uuid, text, bigint, text, text) to service_role;


-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- Las tablas quedan como las dejó la Fase 8. Ninguna de estas funciones es
-- llamada por una policy, así que se pueden borrar sin dejar la RLS rota.
--
-- drop function if exists public.sellar_media_whatsapp(uuid, text, bigint, text, text);
-- drop function if exists public.sellar_saliente_whatsapp(uuid, text, int, text);
-- drop function if exists public.encolar_mensaje_whatsapp(uuid, text, uuid);
-- drop function if exists public.registrar_estado_whatsapp(text, text, text, timestamptz, int, text);
-- drop function if exists public.registrar_entrante_whatsapp(text, text, text, text, text, text, text, text, text, timestamptz, jsonb);
-- drop function if exists app.vincular_telefono_whatsapp(uuid, text);
-- alter table whatsapp_conversations
--   drop column if exists service_window_expires_at,
--   drop column if exists last_outbound_at,
--   drop column if exists last_inbound_at;
