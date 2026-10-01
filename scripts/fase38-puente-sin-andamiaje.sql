-- Fase 38 · El puente de correo deja de depender del andamiaje
--
-- INCIDENTE. Al limpiar el andamiaje de la migración se borró `_resync()` —con
-- razón: con la web ya escribiendo en Brasil, resincronizar desde Ohio pisa
-- datos nuevos—. Pero `app.puente_de_correo()` lo usaba para copiar las ocho
-- tablas de correo.
--
-- El puente quedó fallando cada 5 minutos con
--
--     ERROR: function public._resync(text[]) does not exist
--
-- y nadie se enteró: **un cron que falla no le avisa a nadie**. Estuvo caído
-- horas. Se descubrió al ir a mover el sync y notar que Ohio tenía 1.476 hilos
-- y Brasil 1.446.
--
-- La causa del descuido: antes de borrar se verificó qué funciones de
-- producción usaban las TABLAS `_*`, y ninguna lo hacía. No se verificaron las
-- FUNCIONES `_*`. Era la mitad de la pregunta.
--
-- Lección, y por eso la copia va ahora acá adentro: una pieza de producción no
-- puede depender de andamiaje. Si el andamiaje es borrable —y tiene que
-- serlo—, lo que sobreviva no puede llamarlo.

create or replace function app.puente_de_correo()
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_ohio   timestamptz;
  v_brasil timestamptz;
  v_filas  bigint := 0;
  n        bigint;
  v_cols   text;
  t        text;
  -- `email_sync_log` queda afuera: 2.600 filas de bitácora que no mira nadie
  -- y se llevaban un tercio del tiempo de cada pasada.
  v_tablas text[] := array[
    'email_accounts','email_events','email_labels','email_send_requests',
    'email_thread_labels','email_thread_reads','email_thread_state','email_threads'];
begin
  if current_setting('session_replication_role') <> 'replica' then
    return 'falta: set local session_replication_role = replica';
  end if;

  begin
    select max(last_synced_at) into v_ohio from remoto.email_accounts;
  exception when others then
    return 'no se pudo leer Ohio: no se copió nada';
  end;
  select max(last_synced_at) into v_brasil from public.email_accounts;

  if v_ohio is null then
    return 'Ohio no tiene marca de sincronización: no se copió nada';
  end if;

  -- ¿Brasil ya es el primario? Entonces esto sobra y es PELIGROSO.
  if v_brasil is not null and v_brasil > v_ohio then
    perform cron.unschedule('puente-de-correo');
    return 'Brasil recibió correo propio: el puente se desprogramó solo';
  end if;

  -- Las columnas se resuelven mirando las DOS puntas: agregar una columna de
  -- un lado no rompe la copia.
  foreach t in array v_tablas loop
    select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into v_cols
      from information_schema.columns c
     where c.table_schema = 'remoto' and c.table_name = t
       and exists (select 1 from information_schema.columns d
                    where d.table_schema = 'public' and d.table_name = t
                      and d.column_name = c.column_name);
    if v_cols is null then
      return 'sin columnas comunes en ' || t || ': no se copió nada';
    end if;

    execute format('delete from public.%I', t);
    execute format('insert into public.%I (%s) select %s from remoto.%I', t, v_cols, v_cols, t);
    get diagnostics n = row_count;
    v_filas := v_filas + n;
  end loop;

  return 'copiadas ' || v_filas || ' filas de correo';
end $function$;

-- Comprobación: las dos puntas tienen que dar el MISMO número de hilos.
--   select (select count(*) from email_threads), (select count(*) from remoto.email_threads);
--
-- Y el cron tiene que dejar de fallar:
--   select start_time, status from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname = 'puente-de-correo')
--    order by start_time desc limit 3;
