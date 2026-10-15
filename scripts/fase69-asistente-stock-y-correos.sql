-- Fase 69 · El asistente: primero lo que hay, y los correos como tarjetas
--
-- QUÉ SE PIDIÓ
--
-- «Quiero que se priorice siempre lo que hay en stock.»
-- «Cuando se habla de los mails quiero mejor formato, no texto plano: que
--  aparezca quién me mandó el mail, cuál es el título, y opciones de click
--  como Ver mail.»
--
-- Son dos cambios en la base, uno por pedido. El resto —las tarjetas, la
-- barra de progreso, que la respuesta no repita en prosa lo que ya está en
-- las tarjetas— es pantalla y prompt, y no pasa por acá.
--
--
-- 1 · BUSCAR PRODUCTOS: EL STOCK ENTRA AL ORDEN
--
-- Preguntando «qué hay de ph1» la respuesta empezaba con seis productos en
-- cero y recién abajo aparecían los que tienen 287, 544 y 71 disponibles. No
-- estaba mal ordenada: estaba ordenada por PARECIDO, y «SP.PH1» se parece más
-- a «ph1» que «SP.VPPH1/50». Pero quien pregunta qué hay de algo está
-- preguntando qué puede vender.
--
-- El stock entra como CRITERIO DE DESEMPATE, no por encima de la coincidencia:
--
--   1. cómo se encontró .... un SKU exacto gana siempre, tenga stock o no
--   2. cuántas palabras ..... el que coincide con más de lo que pediste
--   3. la marca pedida
--   4. ¿tiene stock? ....... ← lo nuevo
--   5. el parecido, y el nombre
--
-- Así el que busca «SP.PH1» exacto lo sigue recibiendo primero —pidió ESE—,
-- y el que busca «ph1» a secas ve antes lo que se puede entregar.
--
-- EL COSTO, MEDIDO. El saldo ahora se calcula ANTES de cortar en 15, así que
-- se calcula para todos los candidatos y no para los 15 que sobreviven. Las
-- búsquedas anchas son las que más candidatos dejan: «punta» 1.114, «llave»
-- 1.553. Mil seiscientos saldos tardan 25 ms contra una preselección que ya
-- tarda 300. Se paga.

create or replace function public.asistente_buscar_productos(
  p_company uuid,
  p_texto text,
  p_limite integer default 15
)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_vacias  constant text[] := array[
    'de','del','la','el','los','las','un','una','unos','unas','y','o','con','para',
    'en','al','por','no','si','que','se','es','lo','su','sus','este','esta','mas',
    'hay','tenes','tienen','tenemos','necesito','quiero','busco','dame','algo',
    'producto','productos','herramienta','herramientas','stock'];
  v_parecido constant real := 0.6;
  v_lim      integer := least(greatest(coalesce(p_limite, 15), 1), 40);
  v_q        text    := btrim(coalesce(p_texto, ''));
  v_palabras text[];
  v_n        integer;
  v_piso     integer;
  v_completos bigint;
  v_filas    jsonb;
begin
  if v_q = '' then
    return jsonb_build_object('error', 'Falta el texto a buscar.');
  end if;
  perform set_config('pg_trgm.word_similarity_threshold', '0.4', true);

  select array_agg(w) into v_palabras
    from unnest(regexp_split_to_array(lower(v_q), '[^a-z0-9./]+')) as w
   where length(w) >= 2 and not (w = any (v_vacias));
  v_palabras := coalesce(v_palabras, array[lower(v_q)]);
  v_n    := array_length(v_palabras, 1);
  v_piso := greatest(1, (v_n + 1) / 2);

  with preseleccion as (
    select p.id, p.sku, p.name, p.product_type, p.model_code,
           coalesce(b.name, '—') as marca,
           coalesce(c.name, '—') as categoria,
           -- El tipo y la categoría entran al texto buscable: son la parte en
           -- castellano de un catálogo escrito mitad en inglés.
           lower(p.name || ' ' || p.sku || ' ' || coalesce(b.name, '') || ' '
                 || coalesce(p.product_type, '') || ' ' || coalesce(c.name, '')) as texto,
           lower(coalesce(b.name, '')) as marca_baja
      from products p
      left join brands b             on b.id = p.brand_id
      left join product_categories c on c.id = p.category_id
     where p.company_id = p_company and p.deleted_at is null
       and (exists (select 1 from unnest(v_palabras) w
                     where p.name ilike '%' || w || '%'
                        or p.sku  ilike '%' || w || '%'
                        or coalesce(b.name,'') ilike '%' || w || '%'
                        or coalesce(p.product_type,'') ilike '%' || w || '%')
            or v_q <% p.name
            or v_q <% p.sku)
  ), candidatos as (
    select s.*,
           (select count(*) from unnest(v_palabras) w
             where s.texto like '%' || w || '%'
                or word_similarity(w, s.texto) >= v_parecido) as palabras,
           exists (select 1 from unnest(v_palabras) w
                    where s.marca_baja <> ''
                      and (s.marca_baja like '%' || w || '%' or w like '%' || s.marca_baja || '%'))
             as marca_pedida,
           case
             when upper(s.sku) = upper(v_q)                       then 'sku'
             when s.sku  ilike '%' || v_q || '%'                  then 'codigo'
             when upper(coalesce(s.model_code,'')) = upper(v_q)   then 'modelo'
             when s.name ilike '%' || v_q || '%'                  then 'nombre'
             else 'parecido' end as como,
           greatest(word_similarity(v_q, s.name), word_similarity(v_q, s.sku)) as score
      from preseleccion s
  ), filtrados as (
    select * from candidatos
     where palabras >= v_piso or como <> 'parecido' or score >= 0.7
  ), con_saldo as (
    -- El saldo se calcula acá, antes de cortar: si se calculara después, el
    -- corte ya habría dejado afuera justo lo que tiene stock, que es lo que
    -- se quiere arriba. Se guarda para no pedirlo dos veces.
    select f.*, coalesce((select disponible from app.stock_de(f.id)), 0) as disponible
      from filtrados f
  ), ordenados as (
    select *, count(*) filter (where palabras >= v_n) over () as completos
      from con_saldo
     order by case como when 'sku' then 0 when 'codigo' then 1 when 'modelo' then 2 else 3 end,
              palabras desc, marca_pedida desc, (disponible > 0) desc, score desc, name
     limit v_lim
  )
  select max(completos),
         jsonb_agg(jsonb_build_object(
           'sku', sku, 'nombre', name, 'marca', marca, 'categoria', categoria,
           'tipo', product_type, 'encontrado_por', como,
           'coincide', palabras || ' de ' || v_n,
           'precio', (select importe from app.precio_de_lista(p_company, id)),
           'moneda', (select moneda  from app.precio_de_lista(p_company, id)),
           'disponible', disponible)
           order by case como when 'sku' then 0 when 'codigo' then 1 when 'modelo' then 2 else 3 end,
                    palabras desc, marca_pedida desc, (disponible > 0) desc, score desc, name)
    into v_completos, v_filas
    from ordenados;

  if v_filas is null then
    return jsonb_build_object(
      'resultados', 0,
      'nota', 'No encontré ningún producto con «' || v_q || '». ' ||
              'Probá con menos palabras, sólo el modelo, o la marca.');
  end if;

  return jsonb_build_object(
    'resultados', jsonb_array_length(v_filas),
    'coinciden_del_todo', v_completos,
    'orden', 'Vienen ordenados: primero los que mejor coinciden y, a igual coincidencia, ' ||
             'los que tienen stock disponible. Respetá ese orden al nombrarlos.',
    'nota', case
      when v_completos = 0 then
        'Ninguno tiene todas las palabras que pediste: éstos son los más parecidos. ' ||
        'Mirá el campo «coincide» antes de darlos por buenos.'
      when v_completos > jsonb_array_length(v_filas) then
        'Hay ' || v_completos || ' que coinciden del todo; te muestro los ' ||
        jsonb_array_length(v_filas) || ' mejores. Si hace falta, acotá la búsqueda.'
      end,
    'productos', v_filas);
end $function$;


-- 2 · BUSCAR CORREOS: CADA CORREO VIAJA CON SU IDENTIDAD
--
-- La pantalla ahora dibuja cada correo como una tarjeta con «Ver mail». Para
-- enlazar hace falta el id del hilo, que `listar_bandeja_email` devuelve y
-- esta función tiraba. Sin él la tarjeta sabe de quién es y de qué se trata,
-- pero el botón no tiene a dónde ir.
--
-- Es el MISMO principio que ya usan las tarjetas de producto: los datos viajan
-- estructurados, no sacados de la prosa del modelo. Leer «de noreply@… —
-- Asunto — 15/10/2026» de un texto obliga a que el modelo escriba el formato
-- exacto todas las veces, que es la clase de cosa que anda en las pruebas y
-- falla en producción.
--
-- Y el id NO es un dato para que el modelo lo repita: la nota se lo dice, para
-- que no se le ocurra escribir un uuid en una respuesta que lee una persona.

create or replace function public.asistente_buscar_emails(
  p_company uuid,
  p_texto text default null::text,
  p_sin_leer boolean default false,
  p_limite integer default 15
)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_lim integer := least(greatest(coalesce(p_limite, 15), 1), 25);
  v_q text := nullif(btrim(coalesce(p_texto, '')), '');
  v_filas jsonb; v_total bigint; v_sin bigint; v_sin_resp bigint;
begin
  select jsonb_agg(jsonb_build_object(
           'id', id,
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
            'El «id» es para que la pantalla arme el enlace: NUNCA lo escribas en la respuesta. ' ||
            'Y los tres números son DISTINTOS, no los confundas: «hay_en_total» son todos los hilos ' ||
            'que coinciden; «sin_leer_en_total» los que nadie abrió; «sin_responder_en_total» los ' ||
            'recibidos donde el último que habló fue el cliente y nadie los dio por resueltos. ' ||
            'Si te preguntan cuántos faltan responder, es «sin_responder_en_total» —un correo ' ||
            'leído puede seguir esperando respuesta—.',
    'correos', v_filas);
end $function$;
