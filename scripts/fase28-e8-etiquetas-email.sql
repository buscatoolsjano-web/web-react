-- Fase 28 · E8 — Etiquetas de correo, como las de Gmail.
--
-- Se crean, se ponen y se sacan de un hilo, y se filtra la bandeja por ellas.
--
-- SON DEL ERP, NO DE GMAIL. `email_threads.gmail_labels` ya trae las etiquetas
-- de Gmail, pero son de sólo lectura: el navegador nunca habla con Gmail y
-- escribir allá es del servicio de correo, que no vive en este repo. Éstas son
-- otra cosa —«Cotizar», «Reclamo», «Urgente»— y viven acá. Por eso no se
-- mezclan en la misma lista ni en el mismo filtro.
--
-- El color no es un hex: es uno de los seis tonos del sistema de diseño. Una
-- etiqueta con un color inventado se ve mal en modo oscuro y nadie lo mira
-- hasta que ya está cargada.
--
-- Idempotente: se puede correr dos veces.

begin;

-- ── 1 · Las etiquetas de la empresa ───────────────────────────────────────

create table if not exists email_labels (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies (id),
  nombre      text not null,
  color       text not null default 'neutral'
              check (color in ('neutral', 'info', 'brand', 'success', 'warning', 'danger')),
  creado_por  uuid references profiles (id),
  created_at  timestamptz not null default now()
);

-- Dos «Urgente» en la misma empresa no son dos etiquetas, son un error de
-- tipeo. Se compara sin distinguir mayúsculas ni espacios de los bordes.
create unique index if not exists email_labels_nombre_idx
  on email_labels (company_id, lower(btrim(nombre)));

alter table email_labels enable row level security;

drop policy if exists email_labels_select on email_labels;
create policy email_labels_select on email_labels
  for select using (company_id = any (app.current_email_company_ids()));

-- ── 2 · Qué hilo lleva qué etiqueta ───────────────────────────────────────
-- Igual que `email_thread_state`: la clave es (cuenta, hilo de Gmail), no el
-- uuid de `email_threads`, así una resincronización no pierde las etiquetas.

create table if not exists email_thread_labels (
  company_id      uuid not null references companies (id),
  account_id      uuid not null references email_accounts (id) on delete cascade,
  gmail_thread_id text not null,
  label_id        uuid not null references email_labels (id) on delete cascade,
  puesta_por      uuid references profiles (id),
  created_at      timestamptz not null default now(),
  primary key (account_id, gmail_thread_id, label_id)
);

-- Filtrar la bandeja por etiqueta entra por acá.
create index if not exists email_thread_labels_label_idx
  on email_thread_labels (label_id);

alter table email_thread_labels enable row level security;

drop policy if exists email_thread_labels_select on email_thread_labels;
create policy email_thread_labels_select on email_thread_labels
  for select using (company_id = any (app.current_email_company_ids()));

-- ── 3 · Los eventos nuevos en la auditoría ────────────────────────────────

alter table email_events drop constraint if exists email_events_action_check;
alter table email_events add constraint email_events_action_check check (
  action = any (array[
    'asignado', 'estado_cambiado', 'cliente_vinculado', 'cliente_desvinculado',
    'email_enviado', 'nota_editada', 'respuesta_enviada',
    'respuesta_a_todos_enviada', 'reenvio_enviado', 'borrador_descartado',
    'hilo_eliminado', 'hilo_restaurado',
    'etiqueta_puesta', 'etiqueta_sacada'
  ])
);

-- ── 4 · Crear, renombrar y borrar una etiqueta ────────────────────────────

create or replace function public.guardar_etiqueta_email(
  p_company uuid,
  p_nombre  text,
  p_color   text default 'neutral',
  p_id      uuid default null
)
returns email_labels
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_fila   email_labels;
begin
  if not (p_company = any (app.current_email_company_ids())) then
    raise exception 'No tenés permiso para tocar las etiquetas de esta empresa'
      using errcode = 'insufficient_privilege';
  end if;
  if v_nombre = '' then
    raise exception 'La etiqueta necesita un nombre' using errcode = 'check_violation';
  end if;
  if length(v_nombre) > 40 then
    raise exception 'El nombre de la etiqueta no puede pasar de 40 caracteres'
      using errcode = 'check_violation';
  end if;

  if p_id is null then
    insert into email_labels (company_id, nombre, color, creado_por)
    values (p_company, v_nombre, coalesce(p_color, 'neutral'), auth.uid())
    returning * into v_fila;
  else
    update email_labels
       set nombre = v_nombre, color = coalesce(p_color, color)
     where id = p_id and company_id = p_company
    returning * into v_fila;
    if v_fila.id is null then
      raise exception 'La etiqueta no existe' using errcode = 'no_data_found';
    end if;
  end if;

  return v_fila;
end $function$;

comment on function public.guardar_etiqueta_email is
  'Fase 28 E8: crea la etiqueta (p_id null) o la renombra. Nombre único por empresa, sin distinguir mayúsculas.';

create or replace function public.borrar_etiqueta_email(p_label uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_empresa uuid;
begin
  select company_id into v_empresa from email_labels where id = p_label;
  if v_empresa is null then
    raise exception 'La etiqueta no existe' using errcode = 'no_data_found';
  end if;
  if not (v_empresa = any (app.current_email_company_ids())) then
    raise exception 'No tenés permiso para tocar las etiquetas de esta empresa'
      using errcode = 'insufficient_privilege';
  end if;
  -- El `on delete cascade` la saca de todos los hilos que la tenían.
  delete from email_labels where id = p_label;
end $function$;

comment on function public.borrar_etiqueta_email is
  'Fase 28 E8: borra la etiqueta y la saca de todos los hilos. No borra ningún correo.';

-- ── 5 · Poner y sacar una etiqueta de un hilo ─────────────────────────────

create or replace function public.etiquetar_hilo_email(
  p_account uuid,
  p_thread  text,
  p_label   uuid,
  p_poner   boolean default true
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_empresa uuid;
  v_nombre  text;
begin
  select company_id into v_empresa from email_accounts where id = p_account;
  if v_empresa is null then
    raise exception 'La cuenta de correo no existe' using errcode = 'no_data_found';
  end if;
  if not (v_empresa = any (app.current_email_company_ids())) then
    raise exception 'No tenés permiso para trabajar sobre esta cuenta de correo'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hilo_email_existe(p_account, p_thread) then
    raise exception 'El hilo no existe en esta cuenta de correo' using errcode = 'no_data_found';
  end if;

  -- La etiqueta tiene que ser de la MISMA empresa que la cuenta: si no, se
  -- podría etiquetar el correo de una empresa con la etiqueta de otra.
  select nombre into v_nombre from email_labels
   where id = p_label and company_id = v_empresa;
  if v_nombre is null then
    raise exception 'La etiqueta no existe en esta empresa' using errcode = 'no_data_found';
  end if;

  if p_poner then
    insert into email_thread_labels (company_id, account_id, gmail_thread_id, label_id, puesta_por)
    values (v_empresa, p_account, p_thread, p_label, auth.uid())
    on conflict (account_id, gmail_thread_id, label_id) do nothing;
  else
    delete from email_thread_labels
     where account_id = p_account and gmail_thread_id = p_thread and label_id = p_label;
  end if;

  insert into email_events (company_id, account_id, gmail_thread_id, action, actor, detalle)
  values (v_empresa, p_account, p_thread,
          case when p_poner then 'etiqueta_puesta' else 'etiqueta_sacada' end,
          auth.uid(), jsonb_build_object('label_id', p_label, 'nombre', v_nombre));
end $function$;

comment on function public.etiquetar_hilo_email is
  'Fase 28 E8: pone o saca una etiqueta del ERP en un hilo. No toca las etiquetas de Gmail.';

grant execute on function public.guardar_etiqueta_email(uuid, text, text, uuid) to authenticated;
grant execute on function public.borrar_etiqueta_email(uuid) to authenticated;
grant execute on function public.etiquetar_hilo_email(uuid, text, uuid, boolean) to authenticated;

commit;
