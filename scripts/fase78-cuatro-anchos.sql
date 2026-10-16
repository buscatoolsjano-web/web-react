-- Fase 78 · Cuatro anchos, y que las filas cierren
--
-- QUÉ SE PIDIÓ
--
-- «El botón de achicar o agrandar es muy brusco, es como que no hay un
--  intermedio y te achica mucho de la nada. La idea es que haya al menos tres
--  achiques distintos, como para ir regulando, y que más o menos tengan todas
--  la misma coherencia de achique, porque quedan desfasados todo el tiempo.
--  Sería como difícil encuadrar eso.»
--
-- Son dos problemas y hacía falta arreglar los dos.
--
--
-- 1 · LOS ESCALONES: ERAN DOS DISFRAZADOS DE TRES
--
-- Los tamaños de la Fase 76 —`chico`, `normal`, `grande`— eran en realidad DOS
-- anchos: `chico` ocupaba media pantalla y los otros dos la entera. Entre
-- `normal` y `grande` lo único que cambiaba era el alto del gráfico, que en
-- los demás bloques no significa nada. Así que achicar saltaba del 100 % al
-- 50 % sin nada en el medio, exactamente como se sintió.
--
-- Ahora la rejilla es de SEIS columnas y hay cuatro anchos: 2 (un tercio),
-- 3 (la mitad), 4 (dos tercios) y 6 (entera).
--
--
-- 2 · «DESFASADOS»: LA FILA NO CERRABA, Y LO DE ADENTRO NO SE ENTERABA
--
-- Lo primero es aritmética: con dos anchos, mitad + entera no cierra ninguna
-- fila. La propiedad que hace que cierren no es que cada ancho divida a seis
-- —dos tercios son 4 y 4 no divide a 6— sino que a cada uno le quede un
-- COMPLEMENTO que también sea un ancho posible: 2 con 4, 3 con 3, 6 solo.
--
-- Lo segundo es que el contenido de cada bloque seguía reacomodándose por el
-- ancho de la VENTANA. Un bloque de un tercio en una pantalla ancha seguía
-- dibujando sus tres tarjetas de números en tres columnas, y de ahí salía el
-- importe partido al medio: «ARS 1.211.187,0 / 1». Eso se arregló del lado del
-- CSS, con consultas de contenedor: cada bloque pregunta por el ancho que le
-- tocó, no por el de la ventana.
--
--
-- LO QUE CAMBIA EN LA BASE
--
-- Sólo la lista de tamaños válidos. Y los nombres viejos se traducen en la
-- misma migración —`chico` a la mitad, `normal` y `grande` a la fila entera—
-- porque un CHECK se valida contra las filas que YA existen al crearlo: sin
-- traducir primero, un inicio guardado ayer haría fallar la migración de hoy.

update public.profiles
   set inicio = jsonb_set(
         inicio,
         '{widgets}',
         (select coalesce(jsonb_agg(
                   jsonb_set(w, '{tamano}',
                     to_jsonb(case w ->> 'tamano'
                       when 'chico'  then 'mitad'
                       when 'normal' then 'completo'
                       when 'grande' then 'completo'
                       else w ->> 'tamano'
                     end))), '[]'::jsonb)
            from jsonb_array_elements(inicio -> 'widgets') w))
 where inicio is not null
   and exists (select 1 from jsonb_array_elements(inicio -> 'widgets') w
                where w ->> 'tamano' in ('chico', 'normal', 'grande'));

create or replace function app.inicio_valido(p jsonb)
returns boolean
language sql
immutable
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select p is null or (
    jsonb_typeof(p) = 'object'
    and pg_column_size(p) <= 2048
    and (select count(*) from jsonb_object_keys(p) k) = 2
    and not exists (
      select 1 from jsonb_object_keys(p) k where k not in ('version', 'widgets')
    )
    and jsonb_typeof(p -> 'version') = 'number' and (p ->> 'version') = '1'
    and jsonb_typeof(p -> 'widgets') = 'array'
    and jsonb_array_length(p -> 'widgets') <= 30
    and not exists (
      select 1 from jsonb_array_elements(p -> 'widgets') w
       where jsonb_typeof(w) <> 'object'
          or (select count(*) from jsonb_object_keys(w) k) <> 2
          or jsonb_typeof(w -> 'clave') <> 'string'
          or length(w ->> 'clave') not between 1 and 40
          or jsonb_typeof(w -> 'tamano') <> 'string'
          or (w ->> 'tamano') not in ('tercio', 'mitad', 'dosTercios', 'completo')
    )
  )
$function$;

alter table public.profiles drop constraint if exists profiles_inicio_valido;
alter table public.profiles add constraint profiles_inicio_valido check (app.inicio_valido(inicio));

-- VERIFICACIÓN
--
-- APLICADO el 2026-10-16 como `fase78_cuatro_anchos_en_seis_columnas`.
--
-- No había ningún inicio guardado todavía, así que la traducción de nombres no
-- tocó ninguna fila; queda igual por si alguien guardó uno entre el despliegue
-- de la Fase 76 y éste.
--
-- Ida y vuelta con los nombres nuevos, como `authenticated` en una transacción
-- revertida: se guarda `{"evolucion":"mitad","kpis":"mitad"}` y se lee igual.
--
--
-- Y DEL LADO DE LA PANTALLA
--
--   · El frontend TAMBIÉN traduce los nombres viejos al leer (`RENOMBRADOS` en
--     `lib/widgets.ts`). Es redundante con la migración a propósito: una
--     pestaña abierta desde antes puede mandar un `chico` después de que la
--     base dejó de aceptarlo.
--   · El alto del gráfico baja de a poco con el ancho —150, 180, 205, 230— en
--     vez de saltar. El máximo sigue siendo 230 y no los 260 con los que
--     nació: eso fue «el gráfico está perfecto, sólo un poco más chico».
--   · Los bloques de una misma fila se estiran al alto de la más alta, que es
--     la otra mitad de «encuadrar»: sin eso la fila cierra arriba y queda
--     despareja abajo.
