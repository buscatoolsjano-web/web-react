-- Fase 28 · E15 — Chat interno: hablar entre usuarios del ERP.
--
-- Es la tercera cosa de Comunicación, al lado de Emails y WhatsApp, y la única
-- que no sale ni entra de afuera: son las personas de la empresa hablando
-- entre ellas.
--
-- DOS DECISIONES QUE CONVIENE SABER:
--
-- 1 · La conversación tiene PARTICIPANTES, en plural, aunque la pantalla de
--     hoy sólo arme conversaciones de a dos. Así un grupo mañana es pantalla y
--     no una migración de datos.
--
-- 2 · El «sin leer» es POR PERSONA, como en Emails: cada participante tiene su
--     `leido_hasta`. Un contador compartido diría que un mensaje está leído
--     porque lo leyó otro.
--
-- Lo que NO hace, a propósito: no borra mensajes y no edita mensajes. Un chat
-- de trabajo que se puede reescribir hacia atrás no sirve para acordar nada.
--
-- Idempotente: se puede correr dos veces.

begin;

-- ── 1 · Las tres tablas ───────────────────────────────────────────────────

create table if not exists chat_conversaciones (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies (id),
  creada_por        uuid references profiles (id),
  created_at        timestamptz not null default now(),
  -- Denormalizado a propósito: la lista de conversaciones muestra el último
  -- mensaje de cada una, y sin esto serían N consultas para dibujar N filas.
  ultimo_mensaje_en timestamptz,
  ultimo_mensaje    text
);

create table if not exists chat_participantes (
  conversacion_id uuid not null references chat_conversaciones (id) on delete cascade,
  user_id         uuid not null references profiles (id),
  company_id      uuid not null references companies (id),
  -- Hasta cuándo leyó ESTA persona. NULL = no leyó nada todavía.
  leido_hasta     timestamptz,
  created_at      timestamptz not null default now(),
  primary key (conversacion_id, user_id)
);

create index if not exists chat_participantes_usuario_idx on chat_participantes (user_id);

create table if not exists chat_mensajes (
  id              uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null references chat_conversaciones (id) on delete cascade,
  company_id      uuid not null references companies (id),
  autor_id        uuid not null references profiles (id),
  texto           text not null check (btrim(texto) <> '' and length(texto) <= 4000),
  created_at      timestamptz not null default now()
);

create index if not exists chat_mensajes_conversacion_idx
  on chat_mensajes (conversacion_id, created_at desc);

-- ── 2 · Quién ve qué ──────────────────────────────────────────────────────
-- El helper corta la recursión: la política de `chat_participantes` no puede
-- consultar `chat_participantes` sin volver a evaluarse a sí misma.

create or replace function app.mis_conversaciones_chat()
returns uuid[]
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(array_agg(conversacion_id), '{}')
    from chat_participantes
   where user_id = auth.uid();
$function$;

alter table chat_conversaciones enable row level security;
alter table chat_participantes  enable row level security;
alter table chat_mensajes       enable row level security;

drop policy if exists chat_conversaciones_select on chat_conversaciones;
create policy chat_conversaciones_select on chat_conversaciones
  for select using (id = any (app.mis_conversaciones_chat()));

drop policy if exists chat_participantes_select on chat_participantes;
create policy chat_participantes_select on chat_participantes
  for select using (conversacion_id = any (app.mis_conversaciones_chat()));

drop policy if exists chat_mensajes_select on chat_mensajes;
create policy chat_mensajes_select on chat_mensajes
  for select using (conversacion_id = any (app.mis_conversaciones_chat()));

-- No hay política de escritura para nadie: se escribe por RPC, como el resto
-- del sistema. Así el servidor decide quién puede hablar con quién.

-- ── 3 · Con quién se puede hablar ─────────────────────────────────────────

create or replace function public.usuarios_para_chat(p_company uuid)
returns table (user_id uuid, nombre text, rol text)
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if p_company is null or not (p_company = any (app.current_internal_company_ids())) then
    raise exception 'No pertenecés a esta empresa' using errcode = 'insufficient_privilege';
  end if;

  return query
  select m.user_id,
         coalesce(p.full_name, 'Sin nombre'),
         m.role
    from company_memberships m
    join profiles p on p.id = m.user_id
   where m.company_id = p_company
     and m.status = 'active'
     and m.role in ('admin', 'employee', 'salesperson', 'technician')
     -- Uno mismo no: no se chatea con uno mismo.
     and m.user_id <> auth.uid()
   order by coalesce(p.full_name, '');
end $function$;

comment on function public.usuarios_para_chat is
  'Fase 28 E15: las personas de la empresa con las que se puede abrir un chat. Un externo no aparece ni puede pedirlo.';

-- ── 4 · Abrir una conversación de a dos ───────────────────────────────────

create or replace function public.abrir_chat_directo(p_company uuid, p_otro uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_yo   uuid := auth.uid();
  v_id   uuid;
begin
  if p_company is null or not (p_company = any (app.current_internal_company_ids())) then
    raise exception 'No pertenecés a esta empresa' using errcode = 'insufficient_privilege';
  end if;
  if p_otro is null or p_otro = v_yo then
    raise exception 'Elegí con quién querés hablar' using errcode = 'check_violation';
  end if;
  -- La otra persona tiene que ser de la misma empresa y de adentro. Sin esto,
  -- `security definer` sería una puerta para abrirle un chat a cualquiera.
  if not exists (
    select 1 from company_memberships m
     where m.company_id = p_company and m.user_id = p_otro and m.status = 'active'
       and m.role in ('admin', 'employee', 'salesperson', 'technician')
  ) then
    raise exception 'Esa persona no trabaja en esta empresa' using errcode = 'no_data_found';
  end if;

  -- ¿Ya hay una de a dos entre nosotros? Se busca la que tiene EXACTAMENTE
  -- estos dos participantes: una conversación de grupo que nos incluya a los
  -- dos no es «nuestro chat».
  select c.id into v_id
    from chat_conversaciones c
   where c.company_id = p_company
     and (select count(*) from chat_participantes x where x.conversacion_id = c.id) = 2
     and exists (select 1 from chat_participantes x where x.conversacion_id = c.id and x.user_id = v_yo)
     and exists (select 1 from chat_participantes x where x.conversacion_id = c.id and x.user_id = p_otro)
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into chat_conversaciones (company_id, creada_por) values (p_company, v_yo)
  returning id into v_id;

  insert into chat_participantes (conversacion_id, user_id, company_id)
  values (v_id, v_yo, p_company), (v_id, p_otro, p_company);

  return v_id;
end $function$;

comment on function public.abrir_chat_directo is
  'Fase 28 E15: devuelve el chat de a dos con esa persona, y lo crea si no existía. Nunca duplica.';

-- ── 5 · Hablar, y marcar leído ────────────────────────────────────────────

create or replace function public.enviar_mensaje_chat(p_conversacion uuid, p_texto text)
returns chat_mensajes
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_texto   text := btrim(coalesce(p_texto, ''));
  v_empresa uuid;
  v_fila    chat_mensajes;
begin
  select c.company_id into v_empresa
    from chat_conversaciones c
    join chat_participantes x on x.conversacion_id = c.id and x.user_id = auth.uid()
   where c.id = p_conversacion;
  if v_empresa is null then
    raise exception 'Esa conversación no existe o no es tuya' using errcode = 'insufficient_privilege';
  end if;
  if v_texto = '' then
    raise exception 'El mensaje está vacío' using errcode = 'check_violation';
  end if;
  if length(v_texto) > 4000 then
    raise exception 'El mensaje no puede pasar de 4000 caracteres' using errcode = 'check_violation';
  end if;

  insert into chat_mensajes (conversacion_id, company_id, autor_id, texto)
  values (p_conversacion, v_empresa, auth.uid(), v_texto)
  returning * into v_fila;

  update chat_conversaciones
     set ultimo_mensaje_en = v_fila.created_at,
         ultimo_mensaje = left(v_texto, 200)
   where id = p_conversacion;

  -- Lo que uno escribe ya está leído por uno.
  update chat_participantes
     set leido_hasta = v_fila.created_at
   where conversacion_id = p_conversacion and user_id = auth.uid();

  return v_fila;
end $function$;

create or replace function public.marcar_chat_leido(p_conversacion uuid)
returns void
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  update chat_participantes
     set leido_hasta = now()
   where conversacion_id = p_conversacion and user_id = auth.uid();
$function$;

-- ── 6 · La lista, y el número del menú ────────────────────────────────────

create or replace function public.listar_chats(p_company uuid)
returns table (
  id uuid, con_quien text, con_quien_id uuid,
  ultimo_mensaje text, ultimo_mensaje_en timestamptz, sin_leer integer
)
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if p_company is null or not (p_company = any (app.current_internal_company_ids())) then
    raise exception 'No pertenecés a esta empresa' using errcode = 'insufficient_privilege';
  end if;

  return query
  select c.id,
         -- Con quién hablo: el otro. En un grupo, los otros separados por coma.
         coalesce((
           select string_agg(coalesce(p.full_name, 'Sin nombre'), ', ' order by p.full_name)
             from chat_participantes x join profiles p on p.id = x.user_id
            where x.conversacion_id = c.id and x.user_id <> auth.uid()
         ), 'Sin nadie'),
         (select x.user_id from chat_participantes x
           where x.conversacion_id = c.id and x.user_id <> auth.uid() limit 1),
         c.ultimo_mensaje,
         c.ultimo_mensaje_en,
         (select count(*)::integer from chat_mensajes m
           where m.conversacion_id = c.id
             and m.autor_id <> auth.uid()
             and m.created_at > coalesce(yo.leido_hasta, '-infinity'::timestamptz))
    from chat_conversaciones c
    join chat_participantes yo on yo.conversacion_id = c.id and yo.user_id = auth.uid()
   where c.company_id = p_company
   order by c.ultimo_mensaje_en desc nulls last, c.created_at desc;
end $function$;

create or replace function public.contar_chats_sin_leer(p_company uuid)
returns integer
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(count(*), 0)::integer
    from chat_mensajes m
    join chat_participantes yo
      on yo.conversacion_id = m.conversacion_id and yo.user_id = auth.uid()
   where m.company_id = p_company
     and m.autor_id <> auth.uid()
     and m.created_at > coalesce(yo.leido_hasta, '-infinity'::timestamptz);
$function$;

grant execute on function public.usuarios_para_chat(uuid) to authenticated;
grant execute on function public.abrir_chat_directo(uuid, uuid) to authenticated;
grant execute on function public.enviar_mensaje_chat(uuid, text) to authenticated;
grant execute on function public.marcar_chat_leido(uuid) to authenticated;
grant execute on function public.listar_chats(uuid) to authenticated;
grant execute on function public.contar_chats_sin_leer(uuid) to authenticated;

commit;

-- ── 7 · Tiempo real ───────────────────────────────────────────────────────
-- Fuera de la transacción: `alter publication` no se puede deshacer en una.

alter publication supabase_realtime add table chat_mensajes;
alter publication supabase_realtime add table chat_conversaciones;
