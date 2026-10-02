-- Fase 39 · `asistente_buscar_documentos`: ordenar por importe, y desempatar
--
-- DOS BUGS QUE SALIERON DE PROBAR EL ASISTENTE CON PREGUNTAS REALES
--
-- 1. EL RANKING POR PLATA ERA FALSO. La herramienta devuelve como mucho 40
--    filas y las traía ordenadas por FECHA. A «las 3 cotizaciones pendientes
--    más grandes» —sobre 143— el modelo recibía las 40 más recientes y
--    rankeaba esa muestra, que nadie eligió. Contestó que la mayor en USD era
--    de Mirgor por 154.796,85 cuando la real es de Volkswagen por 225.783,46.
--
--    El error no se notaba: los números que daba eran de verdad, sólo que
--    faltaba el primero. Es la peor clase de error.
--
-- 2. «LA ÚLTIMA» SALÍA A CARA O CRUZ. Hay cinco cotizaciones a Mirgor con la
--    misma fecha (15/09). Sin desempate, el orden entre ellas era arbitrario:
--    el asistente nombró la 02554 en una corrida y la 02555 en otra, las dos
--    con sus datos correctos.
--
-- EL ARREGLO, Y EL ERROR QUE CASI COMETO
--
-- Se agregan `p_orden` ('fecha' | 'importe') y `p_moneda`, y se ordena acá con
-- desempate por número descendente.
--
-- La primera versión ordenaba sólo cuando `p_orden = 'importe'`, y para fecha
-- seguía pidiéndole `limite` filas a `informe_documentos`. Eso tenía EL MISMO
-- defecto que venía a corregir, en la otra punta: reordenar la página que
-- eligió otro. Se vio probando: pidiendo 3 cotizaciones de Mirgor devolvía
-- COTI02553, 02552 y 02551 —sin la 02555 ni la 02554, que son las dos
-- últimas—. Por eso ahora `v_tope` es 2000 SIEMPRE: el orden de acá sólo vale
-- si abarca todo lo que el filtro deja pasar.
--
-- LA MONEDA ES OBLIGATORIA AL RANKEAR, a propósito. Acá se opera en USD, ARS
-- y EUR, y un «top 3 por importe» que las mezcla ordena números que no son
-- comparables. Si falta, la función no adivina: devuelve un error que explica
-- qué pedir.
--
-- OJO AL DESPLEGAR: agregar parámetros con CREATE OR REPLACE crea una
-- SOBRECARGA, no reemplaza. Hay que borrar la firma vieja o PostgREST no sabe
-- cuál llamar —ya rompió el catálogo una vez por esto—:
--
--   drop function if exists public.asistente_buscar_documentos(
--     uuid,text,text,text,text,text,integer);
--
-- VERIFICADO: por importe en USD devuelve COTI02426, COTI02389, COTI02276;
-- por fecha para Mirgor, COTI02555, COTI02554, COTI02553. Y end-to-end el
-- asistente pasó de siete llamadas a la herramienta a una sola.

create or replace function public.asistente_buscar_documentos(
  p_company uuid, p_tipo text,
  p_desde text default null, p_hasta text default null,
  p_estado text default null, p_cliente text default null,
  p_limite integer default 20,
  p_orden text default 'fecha', p_moneda text default null)
 returns jsonb language plpgsql stable
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_lim   integer := least(greatest(coalesce(p_limite, 20), 1), 40);
  v_tipo  text;
  v_desde date; v_hasta date;
  v_pide  text := nullif(btrim(coalesce(p_cliente,'')),'');
  v_cli   uuid;
  v_mon   text := nullif(btrim(upper(coalesce(p_moneda,''))),'');
  v_orden text := case when lower(btrim(coalesce(p_orden,''))) = 'importe' then 'importe' else 'fecha' end;
  /*
   * SIEMPRE se trae el conjunto y después se ordena acá. En las dos puntas.
   *
   * Pedirle `limite` filas a `informe_documentos` y reordenar esas es ordenar
   * la página que eligió otro. Con `importe` daba un ranking de una muestra
   * —se perdía la cotización más grande—, y con `fecha` rompía el desempate:
   * pidiendo 3 cotizaciones de Mirgor devolvía COTI02553, 02552 y 02551, sin
   * la 02555 ni la 02554, que son las dos últimas y comparten la misma fecha.
   * El orden de acá sólo vale si abarca todo lo que el filtro deja pasar.
   */
  v_tope  integer := 2000;
  v_filas jsonb; v_total bigint; v_imp numeric;
begin
  v_tipo := case lower(btrim(coalesce(p_tipo, '')))
              when 'cotizacion'  then 'cotizaciones' when 'cotizaciones' then 'cotizaciones'
              when 'pedido'      then 'pedidos'      when 'pedidos'      then 'pedidos'
              when 'remito'      then 'entregas'     when 'entrega'      then 'entregas'
              when 'entregas'    then 'entregas'     when 'nota de entrega' then 'entregas'
              else null end;
  if v_tipo is null then
    return jsonb_build_object('error',
      'No conozco el tipo «' || coalesce(p_tipo,'') || '». Los que hay son: cotizacion, pedido, remito.');
  end if;

  if v_orden = 'importe' and v_mon is null then
    return jsonb_build_object('error',
      'Para ordenar por importe hace falta la moneda: acá se opera en USD, ARS y EUR ' ||
      'y un ranking que las mezcla no significa nada. Volvé a llamarme con moneda.');
  end if;

  begin
    v_desde := coalesce(nullif(btrim(coalesce(p_desde,'')),'')::date, current_date - 30);
    v_hasta := coalesce(nullif(btrim(coalesce(p_hasta,'')),'')::date, current_date);
  exception when others then
    return jsonb_build_object('error', 'Las fechas van en formato AAAA-MM-DD.');
  end;

  if v_pide is not null then
    v_cli := app.cliente_por_texto(p_company, v_pide);
    if v_cli is null then
      return jsonb_build_object('error',
        'No encontré al cliente «' || v_pide || '». Buscalo con buscar_cliente.');
    end if;
  end if;

  begin
    with d as (
      select * from public.informe_documentos(p_company, v_desde, v_hasta, v_tipo, v_mon,
               nullif(btrim(coalesce(p_estado,'')),''), null, null, v_cli, v_tope, 0)
    ), ordenado as (
      select d.*, row_number() over (
               order by case when v_orden = 'importe' then d.importe end desc nulls last,
                        case when v_orden = 'importe' then null::date else d.fecha end desc nulls last,
                        d.numero desc) as rn
        from d
    )
    select jsonb_agg(jsonb_build_object(
             'tipo', tipo, 'numero', numero, 'fecha', fecha, 'cliente', cliente,
             'estado', estado, 'moneda', moneda, 'importe', importe,
             'en_revision', en_revision) order by rn),
           max(total_filas), max(total_importe)
      into v_filas, v_total, v_imp
      from ordenado where rn <= v_lim;
  exception
    when insufficient_privilege then
      return jsonb_build_object('error', 'Tu rol no puede ver estos documentos.');
    when others then
      return jsonb_build_object('error', 'No pude buscar con esos filtros. Probá sin el estado.');
  end;

  if v_filas is null then
    return jsonb_build_object('resultados', 0, 'periodo', v_desde || ' a ' || v_hasta,
      'nota', 'No hay ' || v_tipo || ' en ese período'
              || case when v_pide is not null then ' para ese cliente' else '' end || '.');
  end if;

  return jsonb_build_object(
    'resultados', jsonb_array_length(v_filas), 'hay_en_total', v_total,
    'ordenado_por', v_orden, 'moneda', v_mon,
    'periodo', v_desde || ' a ' || v_hasta, 'importe_total_del_periodo', v_imp,
    'nota', case
      when v_total > v_tope
        then 'Hay ' || v_total || ' y el orden cubre los ' || v_tope || ' primeros: puede faltar alguno.'
      when v_total > jsonb_array_length(v_filas)
        then 'Hay ' || v_total || '; te muestro los ' || jsonb_array_length(v_filas)
             || case when v_orden = 'importe' then ' de mayor importe.' else ' más recientes.' end
      end,
    'documentos', v_filas);
end $function$;

drop function if exists public.asistente_buscar_documentos(uuid,text,text,text,text,text,integer);
