-- Fase 41 · Etapa 1 — Plantillas de correo: los datos
--
-- QUÉ SE PIDIÓ
--
-- Que los mails salgan con un formato propio: una plantilla de la EMPRESA
-- —común a todos— y una de CADA USUARIO, y que sea flexible.
--
-- EL PROBLEMA QUE RESUELVE, Y QUE NO ES ESTÉTICO
--
-- Todo el correo sale desde `info@buscatools.com.ar`: es el único buzón
-- habilitado y es el de la delegación de Google. Quien escribe NO aparece en
-- el `From`, así que hoy el que recibe no tiene forma de saber si le contestó
-- Jano, Norberto o Facundo. La firma no es un adorno: es lo único que lo dice.
--
-- EL MODELO
--
-- Una plantilla es un DATO, no código. Dos clases, que se combinan:
--
--   envoltorio · el marco de la empresa (encabezado y pie). Uno, común.
--   firma      · quién manda. Una por persona, y puede tener varias.
--
-- El dueño sale de `user_id`: NULL es de la empresa, con valor es de esa
-- persona. No hay columna «ámbito» aparte porque sería un segundo lugar donde
-- escribir lo mismo, y los dos se pueden contradecir.
--
-- LOS MARCADORES, QUE SON LO QUE LA HACE FLEXIBLE
--
-- La plantilla de empresa se escribe UNA vez y se rellena sola según quién
-- manda, con `{{usuario.nombre}}`, `{{empresa.telefono}}` y compañía. Sin eso
-- harían falta cinco plantillas idénticas salvo tres renglones, y el día que
-- cambie el teléfono de la empresa hay que acordarse de las cinco.
--
-- `app.plantilla_resolver` es UNA sola función y la usan los dos lados —la
-- vista previa de la pantalla y el envío—, justamente para que no puedan
-- mostrar cosas distintas.

-- ── 1 · El puesto, que no existía ───────────────────────────────────────────
--
-- `full_name` y `phone` ya estaban en `profiles` y se reusan: no se duplica el
-- nombre de nadie. Lo que falta para una firma es el puesto.

alter table public.profiles add column if not exists job_title text;

comment on column public.profiles.job_title is
  'Puesto como aparece en la firma del correo: «Ventas», «Ingeniería». Lo edita cada uno con guardar_mi_firma().';

-- ── 2 · Las plantillas ──────────────────────────────────────────────────────

create table if not exists public.email_templates (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  -- NULL = de la empresa. Con valor = de esa persona.
  user_id     uuid references auth.users(id) on delete cascade,
  clase       text not null check (clase in ('envoltorio', 'firma')),
  nombre      text not null check (btrim(nombre) <> ''),
  contenido   text not null,
  es_default  boolean not null default false,
  activa      boolean not null default true,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_by  uuid,
  updated_at  timestamptz not null default now()
);

comment on table public.email_templates is
  'Plantillas de correo. user_id NULL = de la empresa; con valor = de esa persona. El contenido admite marcadores {{usuario.*}} y {{empresa.*}} que resuelve app.plantilla_resolver().';

-- Un envoltorio de empresa no tiene sentido por persona: el marco es de la
-- empresa. Se deja la puerta abierta igual —alguien puede querer el suyo— pero
-- la de por defecto es una sola por clase y por dueño.
create unique index if not exists email_templates_default_empresa
  on public.email_templates (company_id, clase)
  where user_id is null and es_default and activa;

create unique index if not exists email_templates_default_persona
  on public.email_templates (company_id, user_id, clase)
  where user_id is not null and es_default and activa;

create index if not exists email_templates_por_duenio
  on public.email_templates (company_id, user_id, clase) where activa;

-- ── 3 · Quién las ve y quién las toca ───────────────────────────────────────
--
-- Leer: el mismo portón que el resto de Emails, `app.current_email_company_ids()`.
-- El envoltorio de la empresa lo usa el mail de todos, así que todo el que
-- pueda enviar tiene que poder leerlo.
--
-- Escribir: la de la empresa, sólo admin. La propia, su dueño. Un admin también
-- puede tocar la de otro —es quien arregla cuando alguien se va o se equivoca—.

alter table public.email_templates enable row level security;

drop policy if exists email_templates_select on public.email_templates;
create policy email_templates_select on public.email_templates
  for select using (company_id = any (app.current_email_company_ids()));

drop policy if exists email_templates_insert on public.email_templates;
create policy email_templates_insert on public.email_templates
  for insert with check (
    company_id = any (app.current_email_company_ids())
    and (
      (user_id is null and app."current_role"(company_id) = 'admin')
      or user_id = (select auth.uid())
      or app."current_role"(company_id) = 'admin'
    )
  );

drop policy if exists email_templates_update on public.email_templates;
create policy email_templates_update on public.email_templates
  for update using (
    company_id = any (app.current_email_company_ids())
    and (user_id = (select auth.uid()) or app."current_role"(company_id) = 'admin')
  ) with check (
    company_id = any (app.current_email_company_ids())
    and (user_id = (select auth.uid()) or app."current_role"(company_id) = 'admin')
  );

drop policy if exists email_templates_delete on public.email_templates;
create policy email_templates_delete on public.email_templates
  for delete using (
    company_id = any (app.current_email_company_ids())
    and (user_id = (select auth.uid()) or app."current_role"(company_id) = 'admin')
  );

-- ── 4 · Los marcadores ──────────────────────────────────────────────────────
--
-- `p_html` decide si los VALORES se escapan. El envoltorio es HTML y un
-- cliente que se llame «Juan & Cía» rompería el marcado; una firma que se
-- inserta en el cuadro de texto es texto plano y ahí escapar lo ensuciaría
-- («Juan &amp; Cía»). Se escapa el valor, nunca la plantilla: la plantilla es
-- de la casa, el valor viene de una ficha.
--
-- Un marcador sin dato se reemplaza por vacío. No se deja `{{...}}` a la vista:
-- un mail que le muestra al cliente el nombre de una variable es peor que uno
-- al que le falta el teléfono.
--
-- Pero se barren SÓLO los datos —`{{usuario.*}}` y `{{empresa.*}}`—. `{{cuerpo}}`
-- y `{{firma}}` no son datos: son los huecos donde el envío mete el mensaje y
-- la firma, y se rellenan después. La primera versión barría todo `{{...}}` y
-- se los llevaba puestos: el envoltorio salía sin mensaje adentro.

create or replace function app.plantilla_resolver(
  p_contenido text,
  p_company uuid,
  p_user uuid,
  p_html boolean default true
) returns text
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_out text := coalesce(p_contenido, '');
  v_perfil public.profiles;
  v_emp public.companies;
  v_par record;
  v_valor text;
begin
  select * into v_perfil from public.profiles where id = p_user;
  select * into v_emp from public.companies where id = p_company;

  for v_par in select * from (values
    ('usuario.nombre',    coalesce(v_perfil.full_name, '')),
    ('usuario.puesto',    coalesce(v_perfil.job_title, '')),
    ('usuario.telefono',  coalesce(v_perfil.phone, '')),
    ('empresa.nombre',    coalesce(v_emp.name, '')),
    ('empresa.legal',     coalesce(v_emp.legal_name, '')),
    ('empresa.telefono',  coalesce(v_emp.phone, '')),
    ('empresa.email',     coalesce(v_emp.email, '')),
    ('empresa.web',       coalesce(v_emp.website, '')),
    ('empresa.direccion', coalesce(v_emp.address, '')),
    ('empresa.color',     coalesce(v_emp.brand_color, '#333333'))
  ) as t(marcador, valor) loop
    v_valor := v_par.valor;
    if p_html then
      v_valor := replace(replace(replace(replace(v_valor, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;');
    end if;
    v_out := replace(v_out, '{{' || v_par.marcador || '}}', v_valor);
  end loop;

  -- Un dato mal escrito se borra antes de que lo vea un cliente. Los huecos
  -- estructurales siguen de largo.
  v_out := regexp_replace(v_out, '\{\{(usuario|empresa)\.[a-z_]+\}\}', '', 'g');
  return v_out;
end
$$;

revoke all on function app.plantilla_resolver(text, uuid, uuid, boolean) from public;
grant execute on function app.plantilla_resolver(text, uuid, uuid, boolean) to authenticated, service_role;

-- ── 5 · La plantilla que usa el envío, ya resuelta ──────────────────────────
--
-- Devuelve el envoltorio y la firma que le tocan a una persona, con los
-- marcadores ya reemplazados. Un solo viaje, y la elección de cuál aplica
-- —la propia, si no la de la empresa— vive acá y no repetida en cada cliente.

create or replace function public.plantillas_para_enviar(p_company uuid, p_plantilla uuid default null)
returns table (envoltorio text, firma text, firma_id uuid)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid uuid := (select auth.uid());
  v_env text;
  v_fir text;
  v_fid uuid;
begin
  if v_uid is null then
    raise exception 'sin_sesion' using errcode = '42501';
  end if;
  if not (p_company = any (app.current_email_company_ids())) then
    raise exception 'sin_permiso' using errcode = '42501';
  end if;

  select t.contenido into v_env
    from public.email_templates t
   where t.company_id = p_company and t.clase = 'envoltorio'
     and t.user_id is null and t.es_default and t.activa
   limit 1;

  -- Si piden una firma puntual, esa; si no, la propia por defecto; y si la
  -- persona no tiene ninguna, la de la empresa como red.
  if p_plantilla is not null then
    select t.contenido, t.id into v_fir, v_fid
      from public.email_templates t
     where t.id = p_plantilla and t.company_id = p_company and t.clase = 'firma' and t.activa
       and (t.user_id = v_uid or t.user_id is null)
     limit 1;
  end if;
  if v_fid is null then
    select t.contenido, t.id into v_fir, v_fid
      from public.email_templates t
     where t.company_id = p_company and t.clase = 'firma' and t.activa and t.es_default
       and t.user_id = v_uid
     limit 1;
  end if;
  if v_fid is null then
    select t.contenido, t.id into v_fir, v_fid
      from public.email_templates t
     where t.company_id = p_company and t.clase = 'firma' and t.activa and t.es_default
       and t.user_id is null
     limit 1;
  end if;

  return query select
    app.plantilla_resolver(v_env, p_company, v_uid, true),
    app.plantilla_resolver(v_fir, p_company, v_uid, false),
    v_fid;
end
$$;

revoke all on function public.plantillas_para_enviar(uuid, uuid) from public;
grant execute on function public.plantillas_para_enviar(uuid, uuid) to authenticated, service_role;

-- ── 6 · Que cada uno pueda cargar sus datos ─────────────────────────────────
--
-- Mismo patrón que `guardar_mi_apariencia`: `profiles` no tiene policy de
-- UPDATE a propósito, así que se escribe por una función que sólo toca la
-- fila de quien llama.

create or replace function public.guardar_mi_firma(
  p_nombre text,
  p_puesto text,
  p_telefono text
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid uuid := (select auth.uid());
  v_fila public.profiles;
begin
  if v_uid is null then
    raise exception 'sin_sesion' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_nombre, '')), '') is null then
    raise exception 'nombre_requerido' using errcode = 'P0001';
  end if;

  update public.profiles
     set full_name = btrim(p_nombre),
         job_title = nullif(btrim(coalesce(p_puesto, '')), ''),
         phone     = nullif(btrim(coalesce(p_telefono, '')), ''),
         updated_at = now()
   where id = v_uid
  returning * into v_fila;

  if not found then
    raise exception 'sin_perfil' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'nombre', v_fila.full_name,
    'puesto', v_fila.job_title,
    'telefono', v_fila.phone
  );
end
$$;

revoke all on function public.guardar_mi_firma(text, text, text) from public;
grant execute on function public.guardar_mi_firma(text, text, text) to authenticated;

-- ── 7 · Las dos de la empresa, para que el sistema arranque con algo ────────
--
-- El envoltorio tiene DOS huecos, `{{cuerpo}}` y `{{firma}}`, que llena el
-- envío. Todo lo demás son marcadores de dato y salen resueltos.

insert into public.email_templates (company_id, user_id, clase, nombre, contenido, es_default)
select c.id, null, 'envoltorio', 'Institucional',
$html$<div style="margin:0;padding:0;background:#f4f4f5">
  <div style="max-width:620px;margin:0 auto;background:#ffffff">
    <div style="height:4px;background:{{empresa.color}};font-size:0;line-height:0">&nbsp;</div>
    <div style="padding:18px 24px 6px">
      <span style="font:600 18px/1.2 Arial,Helvetica,sans-serif;color:{{empresa.color}}">{{empresa.nombre}}</span>
    </div>
    <div style="padding:0 24px 18px;font:14px/1.55 Arial,Helvetica,sans-serif;color:#1f2328">
      {{cuerpo}}
      {{firma}}
    </div>
    <div style="padding:14px 24px;border-top:1px solid #e5e7eb;font:12px/1.5 Arial,Helvetica,sans-serif;color:#6b7280">
      {{empresa.legal}} &middot; {{empresa.direccion}}<br>
      Tel. {{empresa.telefono}} &middot; {{empresa.email}} &middot; {{empresa.web}}
    </div>
  </div>
</div>$html$, true
from public.companies c where c.slug = 'buscatools'
on conflict do nothing;

insert into public.email_templates (company_id, user_id, clase, nombre, contenido, es_default)
select c.id, null, 'firma', 'Genérica de la empresa',
$txt$--
{{usuario.nombre}}
{{usuario.puesto}}
{{empresa.nombre}} · Tel. {{empresa.telefono}}
{{empresa.web}}$txt$, true
from public.companies c where c.slug = 'buscatools'
on conflict do nothing;

-- ── 8 · Lo que se verificó, contra producción y revirtiendo ────────────────
--
-- Resolución, con el usuario admin:
--
--   firma            → "--\nAdmin\n\nBuscatools · Tel. 11.2169.3304\nwww.buscatools.com"
--   {{cuerpo}}       → conservado
--   {{firma}}        → conservado
--   marcadores sueltos → ninguno
--   color de marca   → #F37021 aplicado
--   dirección        → Melincué 5125 aplicada
--
-- Permisos, en un bloque que revierte:
--
--   empleado ve las plantillas de la empresa .......... 2 (esperado 2)
--   empleado crea SU firma ............................ sí
--   empleado crea una DE LA EMPRESA ................... rechazado
--   empleado edita el envoltorio de la empresa ........ 0 filas
--   vendedor (sin Emails) ve plantillas ............... 0
--
-- PENDIENTE PARA LA ETAPA 2: un marcador vacío deja su renglón en blanco —hoy
-- la firma del admin tiene una línea sola donde iría el puesto, porque nadie
-- cargó el suyo todavía—. Se resuelve en el editor, mostrando la vista previa
-- con los datos reales: quien la escribe ve el hueco y decide.
