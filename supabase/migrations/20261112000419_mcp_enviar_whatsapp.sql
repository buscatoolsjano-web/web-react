-- Fase 245: el MCP manda WhatsApp.
--
-- Igual que el correo: la base ARMA el envío y el ejecutor de la Edge Function
-- lo manda por `whatsapp-send-message`, la única puerta por la que sale un
-- WhatsApp, con la sesión de quien pregunta. Esa puerta vuelve a validar todo
-- (rol, cuenta activa, ventana de 24 h) y deja el mensaje con su
-- client_request_id: un reintento no manda dos.
--
-- Se busca la conversación por teléfono, por cliente o por nombre de perfil.
-- Fuera de la ventana de 24 h WhatsApp sólo deja mandar plantillas aprobadas,
-- así que se avisa en vez de intentar.
create or replace function public.asistente_preparar_whatsapp(p_company uuid, p_destino text, p_texto text)
returns jsonb language plpgsql stable
set search_path to 'public', 'app', 'pg_temp'
as $function$
declare
  v_dig text := regexp_replace(coalesce(p_destino, ''), '\D', '', 'g');
  v_cli uuid;
  v_id  uuid;
  v_c   whatsapp_conversations%rowtype;
begin
  if nullif(btrim(coalesce(p_texto, '')), '') is null then
    return jsonb_build_object('error', 'Falta el texto del mensaje.');
  end if;
  if nullif(btrim(coalesce(p_destino, '')), '') is null then
    return jsonb_build_object('error', 'Falta a quién: un cliente, un teléfono o el nombre del contacto.');
  end if;

  -- Por teléfono: los últimos 8 dígitos alcanzan y evitan pelear con el +54 9.
  if length(v_dig) >= 8 then
    select w.id into v_id from whatsapp_conversations w
     where w.company_id = p_company and w.archived_at is null and w.conversation_type is distinct from 'group'
       and right(regexp_replace(coalesce(w.phone_e164, w.phone_raw, ''), '\D', '', 'g'), 8) = right(v_dig, 8)
     order by w.last_message_at desc nulls last limit 1;
  end if;
  -- Por cliente.
  if v_id is null then
    v_cli := app.cliente_por_texto(p_company, p_destino);
    if v_cli is not null then
      select w.id into v_id from whatsapp_conversations w
       where w.company_id = p_company and w.archived_at is null and w.customer_id = v_cli
       order by w.last_message_at desc nulls last limit 1;
    end if;
  end if;
  -- Por el nombre con el que aparece en WhatsApp.
  if v_id is null then
    select w.id into v_id from whatsapp_conversations w
     where w.company_id = p_company and w.archived_at is null
       and (w.profile_name ilike '%' || btrim(p_destino) || '%' or w.group_name ilike '%' || btrim(p_destino) || '%')
     order by w.last_message_at desc nulls last limit 1;
  end if;

  if v_id is null then
    return jsonb_build_object('error', 'No encontré una conversación de WhatsApp con «' || p_destino || '». '
      || 'Sólo se puede escribir a quien ya tiene una conversación en el ERP.');
  end if;
  select * into v_c from whatsapp_conversations where id = v_id;

  if v_c.service_window_expires_at is null or v_c.service_window_expires_at < now() then
    return jsonb_build_object('error', 'La ventana de 24 h con ' || coalesce(v_c.profile_name, v_c.phone_e164, 'ese contacto')
      || ' está cerrada: WhatsApp sólo deja mandar plantillas aprobadas hasta que vuelva a escribir. '
      || 'Mandale una plantilla desde el ERP o esperá su mensaje.',
      'ultimo_mensaje', v_c.last_message_at);
  end if;

  return jsonb_build_object(
    'destino', coalesce(v_c.profile_name, v_c.group_name, v_c.phone_e164),
    'telefono', v_c.phone_e164,
    'whatsapp', jsonb_build_object(
      'conversation_id', v_c.id,
      'texto', btrim(p_texto),
      -- El mismo mensaje al mismo contacto, el mismo día: una sola fila.
      'client_request_id', md5(v_c.id::text || btrim(p_texto) || current_date::text)::uuid));
exception when others then
  return jsonb_build_object('error', app.asistente_error(sqlerrm));
end $function$;

grant execute on function public.asistente_preparar_whatsapp(uuid, text, text) to authenticated, service_role;
revoke execute on function public.asistente_preparar_whatsapp(uuid, text, text) from anon, public;
