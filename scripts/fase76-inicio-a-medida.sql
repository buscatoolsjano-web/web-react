-- Fase 76 · El inicio, a medida de cada uno
--
-- QUÉ SE PIDIÓ
--
-- «Quiero que todos los módulos del inicio —gráficos, pendientes, etc.— sean
--  widgets modificables POR USUARIO, para que cada uno pueda agrandar,
--  achicar, subir y bajar lo que quiera.»
--
--
-- DÓNDE SE GUARDA, Y POR QUÉ NO EN `appearance`
--
-- En una columna nueva de `profiles`, con el MISMO molde que la apariencia
-- (Fase 14): la fila se lee con la RLS de siempre y se escribe sólo por una
-- RPC, porque un usuario no tiene UPDATE sobre `profiles`.
--
-- No va adentro de `appearance` por dos razones concretas: su CHECK exige
-- EXACTAMENTE cinco claves y 512 bytes, y la disposición de siete widgets no
-- entra. Meterla ahí sería aflojar la validación de lo que ya está bien
-- validado.
--
-- Tampoco va en el navegador. «Por usuario» quiere decir que lo acomodás una
-- vez y lo encontrás igual desde la notebook de tu casa.
--
--
-- QUÉ SE VALIDA, Y QUÉ NO
--
-- Se valida la FORMA: un objeto con `version` y `widgets`, y cada widget con
-- su clave y un tamaño de la lista.
--
-- NO se valida qué claves existen, y es a propósito —acá se separa de
-- `apariencia_valida`, que sí enumera sus valores—. La lista de widgets va a
-- cambiar cada vez que el inicio gane un bloque, y una lista escrita en un
-- CHECK obliga a una migración para agregar uno. La pantalla ya descarta las
-- claves que no conoce al leer, así que una clave vieja guardada no rompe
-- nada: se ignora. Lo que no se puede ignorar es un tamaño inventado o un
-- array de 4.000 elementos, y eso sí se rechaza.

alter table public.profiles add column if not exists inicio jsonb;

comment on column public.profiles.inicio is
  'Disposición del tablero de inicio de ESTE usuario: orden y tamaño de cada widget. null = el que viene por defecto. Se escribe sólo con guardar_mi_inicio().';

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
          or (w ->> 'tamano') not in ('chico', 'normal', 'grande')
    )
  )
$function$;

alter table public.profiles drop constraint if exists profiles_inicio_valido;
alter table public.profiles add constraint profiles_inicio_valido check (app.inicio_valido(inicio));

/*
 * Guardar lo mío, y sólo lo mío.
 *
 * Calcada de `guardar_mi_apariencia`: el usuario sale del JWT y nunca de un
 * parámetro, así que no hay forma de escribirle el inicio a otro. `null`
 * restaura el que viene por defecto.
 */
create or replace function public.guardar_mi_inicio(p_inicio jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_usuario uuid := auth.uid();
  v_guardado jsonb;
begin
  if v_usuario is null then
    raise exception 'sin_sesion' using errcode = '42501';
  end if;

  update public.profiles
     set inicio = p_inicio
   where id = v_usuario
  returning inicio into v_guardado;

  if not found then
    raise exception 'sin_perfil' using errcode = 'P0002';
  end if;

  return v_guardado;
end
$function$;

grant execute on function public.guardar_mi_inicio(jsonb) to authenticated;

-- VERIFICACIÓN
--
-- APLICADO el 2026-10-15 como `fase76_inicio_a_medida`.
--
-- Lo que acepta y lo que rechaza, probado como `authenticated` en una
-- transacción revertida:
--
--   una disposición de 7 widgets ......... guardada
--   null ................................. guardado (vuelve al de fábrica)
--   un tamaño inventado .................. rechazado por el CHECK
--   un widget con una clave de más ....... rechazado
--   una clave desconocida ................ ACEPTADA a propósito: la pantalla
--                                          la descarta al leer


-- ── LO QUE QUEDÓ DEL LADO DE LA PANTALLA ───────────────────────────────────
--
-- Para que esto se entienda sin abrir el código:
--
--   · `src/modules/dashboard/lib/widgets.ts` — puro: el vocabulario, el inicio
--     de fábrica y las cuatro operaciones (subir, bajar, agrandar, achicar).
--     Ahí vive la regla que hace que esto siga andando dentro de un año: lo
--     que falta en lo guardado se AGREGA AL FINAL, así un widget nuevo aparece
--     para quien ya había acomodado el suyo en vez de quedar invisible.
--
--   · `RejillaInicio.tsx` — dos columnas; `chico` ocupa una y los demás las
--     dos. Lo que cambia entre `normal` y `grande` es el alto, y sólo donde el
--     alto significa algo: el gráfico.
--
--   · El widget `equipo` sólo existe para admin, así que para los demás no
--     está ni en la lista que se puede acomodar: las flechas moverían un hueco.
