-- Fase 70 · E1 · Reglas de correo: el motor
--
-- QUÉ SE PIDIÓ
--
-- «Las etiquetas, quiero que sean como en Gmail, que les puedas agregar
--  filtros»: condiciones sobre de / para / asunto / contiene / es cliente del
--  ERP, y acciones de etiquetar, asignar, dar por resuelto y sacar de la
--  bandeja. Corriendo cuando llega el correo, y con un «aplicar a los que ya
--  están» con previsualización.
--
-- Esta entrega es el MOTOR. La pantalla de reglas (E2) y el aplicar
-- retroactivo (E3) se apoyan en lo que se define acá.
--
--
-- ── DÓNDE CORRE, Y POR QUÉ ACÁ ──────────────────────────────────────────────
--
-- En la base, en un trigger sobre `email_threads`.
--
-- El correo entra por el servicio de Cloud Run, que hace un upsert por
-- PostgREST con la clave de servicio. Si el motor viviera allá habría que
-- redesplegarlo para cada cambio, y lo que entrara por cualquier otro camino
-- —un resync, una carga a mano, el día que haya una segunda cuenta— pasaría de
-- largo sin que nadie se entere. En la base no hay forma de esquivarlo: el
-- hilo no existe hasta que la fila está, y la fila no está sin pasar por acá.
--
--
-- ── CUÁNDO CORRE ────────────────────────────────────────────────────────────
--
-- Cuando el hilo NACE y cuando LLEGA UN MENSAJE NUEVO (cambia
-- `last_message_at`). No en cada upsert: la sincronización reescribe la misma
-- fila muchas veces por día sin que haya pasado nada, y una regla que se
-- aplica sola cada vez es una regla que le pisa el trabajo a una persona cada
-- vez.
--
--
-- ── LA REGLA NO LE PISA EL TRABAJO A UNA PERSONA ────────────────────────────
--
-- Es el principio que ordena todo el resto, y cada acción lo respeta a su
-- manera:
--
--   · etiquetar ......... agrega; nunca saca una etiqueta que puso alguien.
--   · asignar ........... sólo si NO hay nadie asignado.
--   · dar por resuelto .. sólo si está en «pendiente», que es como nace. Si
--                         alguien lo puso en proceso, o ya lo resolvió, la
--                         regla no tiene nada que decir.
--   · sacar de bandeja .. sólo si está en la bandeja y nadie lo devolvió antes.
--                         Devolver un hilo es decir «esto lo quiero ver»; que
--                         una regla lo vuelva a esconder con el mensaje
--                         siguiente sería discutirle a quien lo devolvió.
--
-- Una regla que no puede hacer nada no es un error: es una regla que llegó
-- tarde, y eso está bien.
--
--
-- ── «MARCAR COMO LEÍDO» NO ESTÁ, Y ES A PROPÓSITO ───────────────────────────
--
-- Lo leído acá es POR PERSONA (`email_thread_reads` tiene `user_id`): un hilo
-- está leído para vos y sin leer para los demás. Una regla de la empresa no
-- tiene a quién marcárselo. Lo que se buscaba con eso —que el ruido no moleste
-- a nadie— lo hace «dar por resuelto», que sí es del equipo y además saca el
-- hilo de «los que esperan respuesta».
--
--
-- ── LA AUDITORÍA USA LOS EVENTOS QUE YA EXISTEN ─────────────────────────────
--
-- Una regla escribe el MISMO evento que escribiría una persona
-- —`etiqueta_puesta`, `asignado`, `estado_cambiado`, `hilo_eliminado`— con
-- `actor` en null y la regla en el detalle. Así «¿quién le puso esta
-- etiqueta?» tiene respuesta sin pantallas nuevas, y las que ya leen
-- `email_events` siguen andando sin cambiar una línea.

-- ── 1 · la tabla ────────────────────────────────────────────────────────────

create table if not exists public.email_rules (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  nombre      text not null,
  activa      boolean not null default true,
  /* En qué orden se evalúan. Importa poco —se aplican TODAS las que
     coinciden, como los filtros de Gmail— salvo para «asignar»: la primera
     que asigna gana, porque la segunda ya encuentra un asignado. */
  orden       integer not null default 100,
  /* Todas las condiciones tienen que cumplirse. Es el «Y» del filtro de
     Gmail, y es lo que hace que una regla se pueda leer en voz alta. */
  condiciones jsonb not null,
  acciones    jsonb not null,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now(),
  constraint chk_email_rules_nombre check (btrim(nombre) <> '' and length(nombre) <= 60)
);

create index if not exists idx_email_rules_empresa on public.email_rules (company_id, activa, orden, created_at);

alter table public.email_rules enable row level security;

/* Igual que `email_labels`: se LEE con la RLS de correo y se ESCRIBE por RPC.
   La escritura pasa por `guardar_regla_email`, que además valida la forma de
   las condiciones y las acciones —cosa que una política no puede hacer—. */
drop policy if exists email_rules_select on public.email_rules;
create policy email_rules_select on public.email_rules
  for select using (company_id = any (app.current_email_company_ids()));

drop trigger if exists trg_email_rules_touch on public.email_rules;
create trigger trg_email_rules_touch
  before update on public.email_rules
  for each row execute function app.touch_updated_at();

-- ── 2 · qué es una regla bien formada ───────────────────────────────────────
--
-- Se valida al GUARDAR y no al aplicar. Un jsonb con una llave mal escrita no
-- rompe nada: simplemente no hace nada, en silencio, y quien escribió la regla
-- se entera semanas después de que su correo nunca se etiquetó. Eso es peor
-- que un error al guardar.

create or replace function app.validar_regla_email(p_condiciones jsonb, p_acciones jsonb)
returns void
language plpgsql
immutable
as $$
declare
  c jsonb; a jsonb;
  v_campos constant text[] := array['de','para','asunto','texto','es_cliente'];
  v_ops    constant text[] := array['contiene','no_contiene','es'];
begin
  if jsonb_typeof(p_condiciones) <> 'array' or jsonb_array_length(p_condiciones) = 0 then
    raise exception 'La regla necesita al menos una condición' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_acciones) <> 'array' or jsonb_array_length(p_acciones) = 0 then
    raise exception 'La regla necesita al menos una acción' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_condiciones) > 10 or jsonb_array_length(p_acciones) > 6 then
    raise exception 'La regla tiene demasiadas condiciones o acciones' using errcode = 'check_violation';
  end if;

  for c in select * from jsonb_array_elements(p_condiciones) loop
    if not (c->>'campo' = any (v_campos)) then
      raise exception 'Condición desconocida: %', coalesce(c->>'campo', '(vacía)')
        using errcode = 'check_violation';
    end if;
    if c->>'campo' = 'es_cliente' then
      if jsonb_typeof(c->'valor') <> 'boolean' then
        raise exception 'La condición «es cliente» se contesta con sí o con no'
          using errcode = 'check_violation';
      end if;
    else
      if not (c->>'op' = any (v_ops)) then
        raise exception 'Comparación desconocida: %', coalesce(c->>'op', '(vacía)')
          using errcode = 'check_violation';
      end if;
      if btrim(coalesce(c->>'valor', '')) = '' then
        raise exception 'La condición sobre «%» está sin texto', c->>'campo'
          using errcode = 'check_violation';
      end if;
    end if;
  end loop;

  for a in select * from jsonb_array_elements(p_acciones) loop
    case a->>'tipo'
      when 'etiquetar' then
        if (a->>'label_id') is null then
          raise exception 'Falta elegir la etiqueta' using errcode = 'check_violation';
        end if;
      when 'asignar' then
        if (a->>'user_id') is null then
          raise exception 'Falta elegir a quién asignarle' using errcode = 'check_violation';
        end if;
      when 'estado' then
        if not (a->>'valor' = any (array['pendiente','en_proceso','resuelto'])) then
          raise exception 'Estado desconocido: %', coalesce(a->>'valor', '(vacío)')
            using errcode = 'check_violation';
        end if;
      when 'sacar_de_bandeja' then
        null;
      else
        raise exception 'Acción desconocida: %', coalesce(a->>'tipo', '(vacía)')
          using errcode = 'check_violation';
    end case;
  end loop;
end $$;

-- ── 3 · ¿este hilo coincide? ────────────────────────────────────────────────
--
-- Nota sobre «para»: el índice guarda `participants`, que son TODAS las
-- direcciones del hilo —la nuestra incluida—, no una lista de destinatarios.
-- Así que «para» quiere decir «alguno de los que participan». Es lo que hay, y
-- es lo que la pantalla tiene que decir: prometer un «para» exacto que no se
-- puede cumplir sería peor que llamarlo por su nombre.

create or replace function app.hilo_coincide_regla(
  p_hilo public.email_threads,
  p_condiciones jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  c jsonb;
  v_texto text;
  v_valor text;
  v_hay   boolean;
begin
  for c in select * from jsonb_array_elements(p_condiciones) loop
    if c->>'campo' = 'es_cliente' then
      /* Se reusa el MISMO emparejador que sugiere el cliente en la pantalla
         del hilo: una segunda copia de esa lógica se desincroniza y entonces
         la regla dice que no es cliente de alguien que la pantalla, al lado,
         muestra como cliente. */
      v_hay := exists (
        select 1 from public.sugerencias_cliente_email(p_hilo.account_id, p_hilo.gmail_thread_id)
         where clase in ('exacto', 'sugerido_dominio'));
      if v_hay <> (c->'valor')::boolean then return false; end if;
      continue;
    end if;

    v_texto := lower(case c->>'campo'
      when 'de'     then coalesce(p_hilo.last_message_from, '')
      when 'para'   then array_to_string(coalesce(p_hilo.participants, '{}'), ' ')
      when 'asunto' then coalesce(p_hilo.subject, '')
      else concat_ws(' ', p_hilo.subject, p_hilo.snippet, p_hilo.last_message_from,
                     array_to_string(coalesce(p_hilo.participants, '{}'), ' '))
    end);
    v_valor := lower(btrim(coalesce(c->>'valor', '')));

    case c->>'op'
      when 'contiene'    then if position(v_valor in v_texto) = 0 then return false; end if;
      when 'no_contiene' then if position(v_valor in v_texto) > 0 then return false; end if;
      when 'es' then
        /* «Es» sobre una lista de participantes es «hay uno que es
           exactamente éste», no «la lista entera es este texto». */
        if c->>'campo' = 'para' then
          if not exists (select 1 from unnest(coalesce(p_hilo.participants, '{}')) p
                          where lower(btrim(p)) = v_valor) then return false; end if;
        elsif btrim(v_texto) <> v_valor then
          return false;
        end if;
      else
        return false;
    end case;
  end loop;

  return true;
end $$;

-- ── 4 · aplicar las reglas a un hilo ────────────────────────────────────────
--
-- Devuelve qué hizo, en un jsonb, para que el aplicar retroactivo (E3) pueda
-- contar y para que el trigger pueda ignorarlo.
--
-- `p_simulado` es lo que hace posible la previsualización: con `true` evalúa
-- todo igual pero no escribe una sola fila. Es la MISMA función, y por eso lo
-- que la previa promete es lo que después pasa; una previa escrita aparte
-- promete lo que el que la escribió creía que iba a pasar.

create or replace function app.aplicar_reglas_email(
  p_account   uuid,
  p_thread    text,
  p_regla     uuid default null,
  p_simulado  boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_hilo   public.email_threads;
  v_regla  public.email_rules;
  v_estado public.email_thread_state;
  a        jsonb;
  v_hechas jsonb := '[]'::jsonb;
  v_nombre text;
begin
  select * into v_hilo from public.email_threads
   where account_id = p_account and gmail_thread_id = p_thread;
  if not found then return jsonb_build_object('acciones', v_hechas); end if;

  for v_regla in
    select * from public.email_rules
     where company_id = v_hilo.company_id
       and activa
       and (p_regla is null or id = p_regla)
     order by orden, created_at
  loop
    begin
      if not app.hilo_coincide_regla(v_hilo, v_regla.condiciones) then continue; end if;

      -- El estado se relee por regla: una regla anterior pudo asignar, y la
      -- siguiente tiene que ver eso y no un estado viejo.
      select * into v_estado from public.email_thread_state
       where account_id = p_account and gmail_thread_id = p_thread;

      for a in select * from jsonb_array_elements(v_regla.acciones) loop
        case a->>'tipo'

          when 'etiquetar' then
            select nombre into v_nombre from public.email_labels
             where id = (a->>'label_id')::uuid and company_id = v_hilo.company_id;
            -- La etiqueta pudo borrarse después de escribir la regla. No es un
            -- error: es una acción que ya no tiene sentido.
            if v_nombre is null then continue; end if;
            if exists (select 1 from public.email_thread_labels
                        where account_id = p_account and gmail_thread_id = p_thread
                          and label_id = (a->>'label_id')::uuid) then continue; end if;
            if not p_simulado then
              insert into public.email_thread_labels
                (company_id, account_id, gmail_thread_id, label_id, puesta_por)
              values (v_hilo.company_id, p_account, p_thread, (a->>'label_id')::uuid, null)
              on conflict do nothing;
              insert into public.email_events (company_id, account_id, gmail_thread_id, action, actor, detalle)
              values (v_hilo.company_id, p_account, p_thread, 'etiqueta_puesta', null,
                      jsonb_build_object('label_id', a->>'label_id', 'nombre', v_nombre,
                                         'regla_id', v_regla.id, 'regla', v_regla.nombre));
            end if;
            v_hechas := v_hechas || jsonb_build_object('tipo', 'etiquetar', 'detalle', v_nombre,
                                                       'regla', v_regla.nombre);

          when 'asignar' then
            -- Sólo si no hay nadie: la regla propone, no reasigna.
            if v_estado.assigned_to is not null then continue; end if;
            select full_name into v_nombre from public.profiles where id = (a->>'user_id')::uuid;
            if v_nombre is null then continue; end if;
            if not p_simulado then
              insert into public.email_thread_state (company_id, account_id, gmail_thread_id, assigned_to)
              values (v_hilo.company_id, p_account, p_thread, (a->>'user_id')::uuid)
              on conflict (account_id, gmail_thread_id)
                do update set assigned_to = excluded.assigned_to
              returning * into v_estado;
              insert into public.email_events (company_id, account_id, gmail_thread_id, action, actor, detalle)
              values (v_hilo.company_id, p_account, p_thread, 'asignado', null,
                      jsonb_build_object('a', a->>'user_id', 'nombre', v_nombre,
                                         'regla_id', v_regla.id, 'regla', v_regla.nombre));
            else
              v_estado.assigned_to := (a->>'user_id')::uuid;
            end if;
            v_hechas := v_hechas || jsonb_build_object('tipo', 'asignar', 'detalle', v_nombre,
                                                       'regla', v_regla.nombre);

          when 'estado' then
            -- Sólo desde «pendiente», que es como nace. Si alguien lo movió,
            -- la regla no tiene nada que decir.
            if coalesce(v_estado.workflow_status, 'pendiente') <> 'pendiente' then continue; end if;
            if (a->>'valor') = 'pendiente' then continue; end if;
            if not p_simulado then
              insert into public.email_thread_state (company_id, account_id, gmail_thread_id, workflow_status)
              values (v_hilo.company_id, p_account, p_thread, a->>'valor')
              on conflict (account_id, gmail_thread_id)
                do update set workflow_status = excluded.workflow_status
              returning * into v_estado;
              insert into public.email_events (company_id, account_id, gmail_thread_id, action, actor, detalle)
              values (v_hilo.company_id, p_account, p_thread, 'estado_cambiado', null,
                      jsonb_build_object('estado', a->>'valor',
                                         'regla_id', v_regla.id, 'regla', v_regla.nombre));
            else
              v_estado.workflow_status := a->>'valor';
            end if;
            v_hechas := v_hechas || jsonb_build_object('tipo', 'estado', 'detalle', a->>'valor',
                                                       'regla', v_regla.nombre);

          when 'sacar_de_bandeja' then
            if v_estado.deleted_at is not null then continue; end if;
            -- Si alguien lo devolvió a la bandeja alguna vez, ya dijo que esto
            -- lo quiere ver. Una regla no le discute.
            if exists (select 1 from public.email_events
                        where account_id = p_account and gmail_thread_id = p_thread
                          and action = 'hilo_restaurado') then continue; end if;
            if not p_simulado then
              insert into public.email_thread_state (company_id, account_id, gmail_thread_id, deleted_at, deleted_by)
              values (v_hilo.company_id, p_account, p_thread, now(), null)
              on conflict (account_id, gmail_thread_id)
                do update set deleted_at = excluded.deleted_at, deleted_by = null
              returning * into v_estado;
              insert into public.email_events (company_id, account_id, gmail_thread_id, action, actor, detalle)
              values (v_hilo.company_id, p_account, p_thread, 'hilo_eliminado', null,
                      jsonb_build_object('regla_id', v_regla.id, 'regla', v_regla.nombre));
            else
              v_estado.deleted_at := now();
            end if;
            v_hechas := v_hechas || jsonb_build_object('tipo', 'sacar_de_bandeja', 'detalle', null,
                                                       'regla', v_regla.nombre);

          else null;
        end case;
      end loop;

    exception when others then
      /*
       * UNA REGLA ROTA NO PUEDE ROMPER EL CORREO.
       *
       * Esto corre adentro del upsert de la sincronización: sin este guardia,
       * una regla que apunta a un usuario que ya no está haría fallar el lote
       * entero y el buzón dejaría de indexarse. Se anota en el log del
       * servidor —que es donde se mira cuando algo no pasa— y se sigue con la
       * regla siguiente.
       */
      raise warning 'regla de correo % («%») falló sobre %/%: %',
        v_regla.id, v_regla.nombre, p_account, p_thread, sqlerrm;
    end;
  end loop;

  return jsonb_build_object('acciones', v_hechas);
end $$;

-- ── 5 · el disparador ───────────────────────────────────────────────────────

create or replace function app.reglas_email_al_llegar()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  -- Sólo cuando nace el hilo o llega un mensaje nuevo. Ver el encabezado.
  if tg_op = 'UPDATE' and new.last_message_at is not distinct from old.last_message_at then
    return null;
  end if;
  -- Sin reglas activas no se paga nada: es una consulta por índice.
  if not exists (select 1 from public.email_rules
                  where company_id = new.company_id and activa) then
    return null;
  end if;
  perform app.aplicar_reglas_email(new.account_id, new.gmail_thread_id);
  return null;
end $$;

drop trigger if exists trg_email_threads_reglas on public.email_threads;
create trigger trg_email_threads_reglas
  after insert or update on public.email_threads
  for each row execute function app.reglas_email_al_llegar();

-- ── 6 · guardar y borrar reglas ─────────────────────────────────────────────

create or replace function public.guardar_regla_email(
  p_company     uuid,
  p_nombre      text,
  p_condiciones jsonb,
  p_acciones    jsonb,
  p_activa      boolean default true,
  p_orden       integer default 100,
  p_id          uuid default null
)
returns public.email_rules
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_fila public.email_rules;
  a jsonb;
begin
  if not (p_company = any (app.current_email_company_ids())) then
    raise exception 'No tenés permiso para tocar las reglas de correo de esta empresa'
      using errcode = 'insufficient_privilege';
  end if;

  perform app.validar_regla_email(p_condiciones, p_acciones);

  -- Lo que la regla nombra tiene que existir Y ser de esta empresa. Sin esto,
  -- una regla podría etiquetar con la etiqueta de otra empresa.
  for a in select * from jsonb_array_elements(p_acciones) loop
    if a->>'tipo' = 'etiquetar' and not exists (
         select 1 from public.email_labels
          where id = (a->>'label_id')::uuid and company_id = p_company) then
      raise exception 'La etiqueta no existe en esta empresa' using errcode = 'no_data_found';
    end if;
    if a->>'tipo' = 'asignar' and not exists (
         select 1 from public.company_memberships
          where user_id = (a->>'user_id')::uuid and company_id = p_company and status = 'active') then
      raise exception 'Esa persona no trabaja en esta empresa' using errcode = 'no_data_found';
    end if;
  end loop;

  if p_id is null then
    insert into public.email_rules (company_id, nombre, activa, orden, condiciones, acciones, created_by, updated_by)
    values (p_company, btrim(p_nombre), coalesce(p_activa, true), coalesce(p_orden, 100),
            p_condiciones, p_acciones, auth.uid(), auth.uid())
    returning * into v_fila;
  else
    update public.email_rules
       set nombre = btrim(p_nombre), activa = coalesce(p_activa, activa),
           orden = coalesce(p_orden, orden), condiciones = p_condiciones,
           acciones = p_acciones, updated_by = auth.uid()
     where id = p_id and company_id = p_company
    returning * into v_fila;
    if v_fila.id is null then
      raise exception 'La regla no existe' using errcode = 'no_data_found';
    end if;
  end if;

  return v_fila;
end $$;

create or replace function public.borrar_regla_email(p_regla uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_empresa uuid;
begin
  select company_id into v_empresa from public.email_rules where id = p_regla;
  if v_empresa is null then
    raise exception 'La regla no existe' using errcode = 'no_data_found';
  end if;
  if not (v_empresa = any (app.current_email_company_ids())) then
    raise exception 'No tenés permiso para tocar las reglas de correo de esta empresa'
      using errcode = 'insufficient_privilege';
  end if;
  /* Se borra de verdad. Lo que hizo mientras existió queda en
     `email_events` con su nombre, así que la historia no se pierde. */
  delete from public.email_rules where id = p_regla;
end $$;

grant execute on function public.guardar_regla_email(uuid, text, jsonb, jsonb, boolean, integer, uuid) to authenticated;
grant execute on function public.borrar_regla_email(uuid) to authenticated;

-- ── 7 · aplicar a los que ya están, con previsualización ────────────────────
--
-- La misma función del trigger, con `p_simulado`. Previsualizar con una copia
-- de las reglas escrita aparte prometería lo que creyó quien la escribió; así
-- lo que la previa muestra es, literalmente, lo que va a pasar.
--
-- ── POR QUÉ VA DE A TANDAS ──────────────────────────────────────────────────
--
-- Medido sobre los 2.023 hilos que hay hoy:
--
--   una regla de texto ....................  86 ms   (0,04 ms por hilo)
--   una regla con «es cliente» ............  13,2 s  (6,5 ms por hilo)
--
-- La diferencia es el emparejador de clientes, que mira direcciones y dominios
-- contra el padrón. Trece segundos no entran en el tiempo que PostgREST le da
-- a una consulta, así que la pantalla pide de a doscientos y va contando. Es
-- también lo que permite mostrar un avance de verdad en vez de una rueda.
--
-- `p_desde` + `p_limite` sobre un orden fijo —del mensaje más nuevo al más
-- viejo—. Aplicar no cambia `last_message_at`, así que el orden no se mueve
-- debajo de los pies mientras se recorre.

create or replace function app.recorrer_regla_email(
  p_regla    uuid,
  p_desde    integer,
  p_limite   integer,
  p_simulado boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_regla   public.email_rules;
  v_lim     integer := least(greatest(coalesce(p_limite, 200), 1), 500);
  v_desde   integer := greatest(coalesce(p_desde, 0), 0);
  v_total   bigint;
  v_mirados integer := 0;
  v_coinciden integer := 0;
  h         record;
  r         jsonb;
  v_acciones jsonb := '{}'::jsonb;
  v_ejemplos jsonb := '[]'::jsonb;
  t         jsonb;
  v_tipo    text;
begin
  select * into v_regla from public.email_rules where id = p_regla;
  if not found then
    raise exception 'La regla no existe' using errcode = 'no_data_found';
  end if;
  if not (v_regla.company_id = any (app.current_email_company_ids())) then
    raise exception 'No tenés permiso para tocar las reglas de correo de esta empresa'
      using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_total from public.email_threads where company_id = v_regla.company_id;

  for h in
    select account_id, gmail_thread_id, subject, last_message_from, last_message_at
      from public.email_threads
     where company_id = v_regla.company_id
     order by last_message_at desc nulls last, gmail_thread_id
     offset v_desde limit v_lim
  loop
    v_mirados := v_mirados + 1;
    /* La regla se pasa SIEMPRE por id: así corre esta y sólo esta, aunque la
       empresa tenga otras diez activas. Previsualizar una y que se apliquen
       las demás de paso sería imperdonable. */
    r := app.aplicar_reglas_email(h.account_id, h.gmail_thread_id, p_regla, p_simulado);
    if jsonb_array_length(r->'acciones') = 0 then continue; end if;

    v_coinciden := v_coinciden + 1;
    for t in select * from jsonb_array_elements(r->'acciones') loop
      v_tipo := t->>'tipo';
      v_acciones := jsonb_set(v_acciones, array[v_tipo],
                              to_jsonb(coalesce((v_acciones->>v_tipo)::int, 0) + 1));
    end loop;

    /* Cinco ejemplos y basta: es para reconocer de qué correo habla, no para
       revisar la lista entera. Quien quiera verlos todos los filtra en la
       bandeja, que es la pantalla que sabe mostrarlos. */
    if jsonb_array_length(v_ejemplos) < 5 then
      v_ejemplos := v_ejemplos || jsonb_build_object(
        'asunto', h.subject, 'de', h.last_message_from, 'fecha', h.last_message_at,
        'que', r->'acciones');
    end if;
  end loop;

  return jsonb_build_object(
    'regla', v_regla.nombre,
    'simulado', p_simulado,
    'total', v_total,
    'desde', v_desde,
    'mirados', v_mirados,
    'quedan', greatest(v_total - (v_desde + v_mirados), 0),
    'coinciden', v_coinciden,
    'acciones', v_acciones,
    'ejemplos', v_ejemplos);
end $$;

create or replace function public.previsualizar_regla_email(
  p_regla  uuid,
  p_desde  integer default 0,
  p_limite integer default 200
)
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$ select app.recorrer_regla_email(p_regla, p_desde, p_limite, true) $$;

create or replace function public.aplicar_regla_email_ahora(
  p_regla  uuid,
  p_desde  integer default 0,
  p_limite integer default 200
)
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$ select app.recorrer_regla_email(p_regla, p_desde, p_limite, false) $$;

grant execute on function public.previsualizar_regla_email(uuid, integer, integer) to authenticated;
grant execute on function public.aplicar_regla_email_ahora(uuid, integer, integer) to authenticated;

-- ── VERIFICACIÓN ────────────────────────────────────────────────────────────
--
-- APLICADO el 2026-10-15, en dos migraciones: `fase70_reglas_de_correo_motor`
-- y `fase70_reglas_de_correo_retroactivo`.
--
-- Todo lo de abajo se ensayó contra los datos reales, dentro de transacciones
-- que se revirtieron, con una regla «Avisos de STEL» —de contiene
-- «stelorder.com» → etiquetar + asignar + dar por resuelto—.
--
-- LO QUE SE RECHAZA AL GUARDAR
--   una regla sin condiciones ........ «La regla necesita al menos una condición»
--   una acción inventada ............. «Acción desconocida: mandar_whatsapp»
--
-- LO QUE HACE
--   aplicar a un hilo que coincide ... etiquetar + asignar + estado, y tres
--                                      eventos con actor=null y la regla en el
--                                      detalle; la etiqueta queda con
--                                      `puesta_por` en null, que es como se
--                                      reconoce que no la puso una persona
--   aplicar de nuevo ................. no hace nada: siguen siendo 3 eventos
--
-- LO QUE NO PISA
--   Sobre un hilo que alguien ya había tomado —en proceso, asignado a otra
--   persona, y devuelto a la bandeja— la regla sólo agregó la etiqueta:
--
--     quedó: en_proceso / asignado a quien lo tomó / en la bandeja
--
-- CUÁNDO CORRE
--   tocar el snippet del hilo ........ no hace nada (0 etiquetas)
--   un mensaje nuevo ................. aplica (1 etiqueta, resuelto, fuera de
--                                      la bandeja)
--   un hilo que no coincide .......... intacto
--
-- UNA REGLA ROTA NO ROMPE EL CORREO
--   Con una regla cuyo `label_id` ni siquiera es un uuid, el upsert del sync
--   terminó bien igual y la regla siguiente —la sana— hizo su trabajo. El
--   fallo queda en el log del servidor con el id y el nombre de la regla.
--
-- APLICAR A LOS QUE YA ESTÁN
--   previa de los 200 más nuevos ..... 4 coinciden · 4 etiquetar · 4 estado,
--                                      y 0 filas escritas
--   aplicar .......................... exactamente eso: 4 etiquetas puestas
--   volver a aplicar ................. 0 coinciden
