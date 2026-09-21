-- ════════════════════════════════════════════════════════════════════════
-- Fase 19 · E7 · Clientes — el histórico reciente de la ficha rápida
-- ════════════════════════════════════════════════════════════════════════
--
-- `resumen_cliente_360` devuelve en `recientes` el ÚLTIMO documento de cada
-- tipo: tres filas. Con eso se puede decir «la última cotización fue ésta»,
-- pero no se puede leer la historia reciente del cliente, que es lo que se
-- mira en la ficha rápida —qué pasó en las últimas semanas, en orden.
--
-- La alternativa era pedir los documentos aparte al abrir el panel. Eso
-- devolvería la ficha a dos consultas, y la de E2 fue justamente bajarla a
-- una. Se amplía el resumen.
--
-- QUÉ NO CAMBIA, y se verifica:
--   · la firma: `(uuid, integer)`, así que no nace una sobrecarga;
--   · `security invoker` — la función sigue heredando `customers_select`;
--   · los permisos: authenticated y service_role, nunca anon ni public;
--   · las claves del JSON y el resto de los bloques, byte por byte.
--
-- La sustitución es quirúrgica a propósito: en vez de volver a escribir los
-- 7.500 caracteres de la función —y arriesgar un error de tipeo en un bloque
-- que nadie estaba tocando— se lee la definición viva, se reemplaza SÓLO el
-- CTE `recientes` y se vuelve a crear. Si el bloque no está tal cual se
-- espera, la migración no hace nada y falla.

do $migracion$
declare
  def text;
  viejo constant text := $viejo$recientes as (
  select distinct on (tipo) tipo, id, numero, fecha, estado, entrega, moneda, total
    from docs
   where fecha is not null
   order by tipo, fecha desc, numero desc
),$viejo$;
  nuevo constant text := $nuevo$recientes as (
  -- Fase 19 · E7: los últimos OCHO documentos, de cualquier tipo, en orden.
  -- Incluye los cancelados: que una cotización se haya caído es parte de la
  -- historia del cliente, y esconderla haría parecer que nunca existió.
  select tipo, id, numero, fecha, estado, entrega, moneda, total
    from docs
   where fecha is not null
   order by fecha desc, numero desc
   limit 8
),$nuevo$;
  apariciones int;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'resumen_cliente_360'
     and pg_get_function_identity_arguments(p.oid) = 'p_customer uuid, p_meses integer';

  if def is null then
    raise exception 'No existe public.resumen_cliente_360(uuid, integer)';
  end if;

  apariciones := (length(def) - length(replace(def, viejo, ''))) / length(viejo);
  if apariciones <> 1 then
    raise exception 'El bloque `recientes` no es el esperado (apariciones: %)', apariciones;
  end if;

  execute replace(def, viejo, nuevo);
end
$migracion$;

-- ── Invariantes ────────────────────────────────────────────────────────
do $control$
declare
  f record;
begin
  select p.prosecdef, p.provolatile, coalesce(p.proacl::text, '') as acl,
         count(*) over () as cuantas
    into f
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'resumen_cliente_360';

  if f.cuantas <> 1 then
    raise exception 'Quedó más de una versión de resumen_cliente_360: %', f.cuantas;
  end if;
  if f.prosecdef then
    raise exception 'La función quedó como security definer';
  end if;
  if f.provolatile <> 's' then
    raise exception 'La función dejó de ser STABLE';
  end if;
  if f.acl like '%anon=%' or f.acl like '%=X/%' and f.acl like '%PUBLIC%' then
    raise exception 'La función quedó ejecutable por anon o por PUBLIC: %', f.acl;
  end if;
  if f.acl not like '%authenticated=X%' then
    raise exception 'authenticated perdió el permiso de ejecución: %', f.acl;
  end if;
end
$control$;
