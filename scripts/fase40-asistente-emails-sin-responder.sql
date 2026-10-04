-- Fase 40 · El asistente deja de llamar «sin responder» al total de la bandeja
--
-- EL BUG, Y ES MIO
--
-- Al cambiar la bandeja en esta misma fase, el producto pasó a tener un
-- concepto nuevo: «sin responder» —recibido, con el último mensaje entrante y
-- sin resolver—. La tarjeta del panel y el filtro de la bandeja lo usan y dan
-- 720. La herramienta del asistente NO lo tenía.
--
-- Preguntándole «¿cuántos correos tengo sin responder?» contestó:
--
--   «Tenés 1.210 correos sin responder en total. De esos, 1.200 están sin leer.»
--
-- 1.210 es `hay_en_total`: TODOS los hilos de la empresa sin borradores ni
-- spam. El modelo no mintió: le dieron un número llamado «total» y la persona
-- preguntó por «sin responder», así que lo etiquetó con la palabra de la
-- pregunta. Es exactamente la misma clase de error que el «1515 pendientes»
-- que vine a arreglar —un número verosímil que nadie puede auditar de un
-- vistazo— y encima ahora el asistente CONTRADICE al panel: 1.210 contra 720,
-- para la misma pregunta y en el mismo producto.
--
-- EL ARREGLO, Y POR QUÉ NO TOCA LA EDGE FUNCTION
--
-- Se podría haber agregado un parámetro `sin_responder` al esquema de la
-- herramienta, pero eso obliga a redesplegar la función `asistente`. No hace
-- falta: el problema no es que el modelo no pueda PEDIR el dato, es que no lo
-- TIENE. Así que la herramienta ahora devuelve siempre los tres números, cada
-- uno con su nombre:
--
--   · `hay_en_total`        — todos los hilos que coinciden
--   · `sin_leer_en_total`   — los que nadie abrió
--   · `sin_responder_en_total` — los que esperan respuesta nuestra  <-- nuevo
--
-- Y la `nota` le explica la diferencia, porque los tres son distintos y el
-- parecido entre «sin leer» y «sin responder» es justamente la trampa: un hilo
-- se puede haber leído y seguir esperando respuesta.
--
-- El segundo cálculo es otra llamada a `listar_bandeja_email` con `limite 1`
-- —sólo interesa el total— y con EL MISMO texto de búsqueda, así «¿cuántos de
-- Mirgor me quedan sin responder?» también da bien.
--
-- LA DEFINICIÓN ES LA MISMA QUE EN LOS OTROS TRES LUGARES: carpeta
-- `recibidos`, `p_sin_responder`, `p_excluir_resueltos`. Cuatro superficies,
-- una definición. Si algún día cambia, cambia en `listar_bandeja_email` y las
-- cuatro siguen de acuerdo.
--
-- VERIFICADO: antes 1.210 llamado «sin responder»; después 720, que es lo que
-- dice el panel.

create or replace function public.asistente_buscar_emails(
  p_company uuid,
  p_texto text default null::text,
  p_sin_leer boolean default false,
  p_limite integer default 15)
 returns jsonb
 language plpgsql stable
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_lim integer := least(greatest(coalesce(p_limite, 15), 1), 25);
  v_q text := nullif(btrim(coalesce(p_texto, '')), '');
  v_filas jsonb; v_total bigint; v_sin bigint; v_sin_resp bigint;
begin
  select jsonb_agg(jsonb_build_object(
           'asunto', subject, 'resumen', snippet,
           'de', last_message_from, 'fecha', last_message_at,
           'mensajes', message_count, 'estado', workflow_status,
           'asignado_a', assigned_name, 'cliente', customer_name,
           'sin_leer', sin_leer, 'adjuntos', has_attachments)
         order by last_message_at desc),
         max(total), max(total_sin_leer)
    into v_filas, v_total, v_sin
    from public.listar_bandeja_email(p_company, null,
           v_q, coalesce(p_sin_leer, false),
           null, null, null, false, null, null, v_lim, 0);

  /*
   * Los que esperan respuesta nuestra. Se pide aparte porque es otro
   * conjunto, no un recorte del de arriba: `limite 1` porque sólo interesa
   * `total`, y el MISMO texto de búsqueda para que «¿cuántos de Mirgor me
   * quedan sin responder?» no cuente los de todo el mundo.
   */
  select max(total) into v_sin_resp
    from public.listar_bandeja_email(p_company, null,
           v_q, false,
           null, null, null, false, 'recibidos', null, 1, 0,
           true, true);

  if v_filas is null then
    return jsonb_build_object('resultados', 0,
      'nota', 'No hay correos que coincidan con eso.');
  end if;

  return jsonb_build_object(
    'resultados', jsonb_array_length(v_filas),
    'hay_en_total', v_total,
    'sin_leer_en_total', v_sin,
    'sin_responder_en_total', coalesce(v_sin_resp, 0),
    'nota', 'Tenés el ASUNTO y un resumen, no el cuerpo completo: no inventes lo que dice adentro. ' ||
            'Y los tres números son DISTINTOS, no los confundas: «hay_en_total» son todos los hilos ' ||
            'que coinciden; «sin_leer_en_total» los que nadie abrió; «sin_responder_en_total» los ' ||
            'recibidos donde el último que habló fue el cliente y nadie los dio por resueltos. ' ||
            'Si te preguntan cuántos faltan responder, es «sin_responder_en_total» —un correo ' ||
            'leído puede seguir esperando respuesta—.',
    'correos', v_filas);
end $function$;
