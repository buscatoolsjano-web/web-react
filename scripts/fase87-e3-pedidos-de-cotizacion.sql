-- Fase 87 · E3 · Los pedidos de cotización que llegan del sitio público
--
-- Aplicado en producción en dos migraciones (`fase87_pedidos_*`). La segunda
-- salió de probar: ver el punto 3.
--
-- ── LA DIFERENCIA CON TODO LO DEMÁS ────────────────────────────────────────
--
-- Es lo primero que ESCRIBE en la base sin que haya una persona identificada
-- del otro lado. Lo público, hasta acá, eran tres funciones de sólo lectura.
--
-- Por eso NO hay política de INSERT para nadie. Ni para `anon`, ni para
-- `authenticated`. La única forma de que entre una fila es la Edge Function
-- `cotizar-publico`, que corre con la clave de servicio —que saltea RLS— y
-- que antes valida la forma, recorta los largos, descarta los renglones sin
-- SKU, mira una trampa para robots y cuenta cuántos pedidos vinieron de la
-- misma conexión en la última hora.
--
-- Si la política de inserción viviera acá, cualquiera podría escribir desde
-- la consola del navegador salteándose esas cinco cosas. Una política de RLS
-- no sabe contar lo que pasó hace una hora.

-- ── 1. La tabla ────────────────────────────────────────────────────────────

create table if not exists public.public_quote_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),

  -- Lo que escribió quien consulta. `nombre` y `email` son lo único
  -- obligatorio: cada campo obligatorio de más en un formulario de contacto
  -- es una consulta menos.
  nombre text not null,
  email text not null,
  empresa text,
  telefono text,
  mensaje text,

  -- Lo que tenía en la lista, congelado. Se guarda el SKU y el nombre tal
  -- como los vio, y NO el id interno del producto: si mañana se renombra o
  -- se da de baja, el pedido tiene que seguir diciendo qué pidieron.
  items jsonb not null default '[]'::jsonb,
  cantidad_items integer not null default 0,

  -- De dónde vino. La IP va HASHEADA y no en claro: alcanza para contar
  -- cuántos pedidos mandó la misma conexión, que es para lo único que se
  -- necesita, y no deja guardado un dato personal que nadie va a mirar.
  origen_hash text,
  agente text,

  estado text not null default 'nueva'
    check (estado in ('nueva', 'contactada', 'cerrada')),
  atendida_por uuid references auth.users(id) on delete set null,
  atendida_en timestamptz,
  nota_interna text
);

comment on table public.public_quote_requests is
  'Pedidos de cotización del sitio público. Nadie puede INSERTAR por PostgREST: sólo la Edge Function «cotizar-publico», que valida y acota antes.';

-- Por empresa y fecha, que es como se mira la bandeja; el parcial de las
-- nuevas, que es lo que cuenta el globito y se consulta muchas veces por
-- minuto; y el de la huella, sin el cual cada pedido nuevo recorrería la
-- tabla entera para aplicar el freno.
create index if not exists public_quote_requests_bandeja
  on public.public_quote_requests (company_id, created_at desc);

create index if not exists public_quote_requests_nuevas
  on public.public_quote_requests (company_id)
  where estado = 'nueva';

create index if not exists public_quote_requests_origen
  on public.public_quote_requests (origen_hash, created_at desc)
  where origen_hash is not null;

-- ── 2. Quién puede leer y atender ──────────────────────────────────────────

alter table public.public_quote_requests enable row level security;

-- La gente de la casa, de su empresa, con la misma llave que todo lo demás.
-- Un cliente con usuario NO los ve: son consultas de terceros, no documentos
-- suyos.
drop policy if exists public_quote_requests_select on public.public_quote_requests;
create policy public_quote_requests_select
  on public.public_quote_requests for select
  using (company_id in (select unnest(app.current_internal_company_ids())));

drop policy if exists public_quote_requests_update on public.public_quote_requests;
create policy public_quote_requests_update
  on public.public_quote_requests for update
  using (company_id in (select unnest(app.current_internal_company_ids())))
  with check (company_id in (select unnest(app.current_internal_company_ids())));

-- Y NINGUNA política de insert ni de delete. Es a propósito: ver arriba.

-- ── 3. Los permisos de tabla, al ras ───────────────────────────────────────
--
-- CORRECCIÓN, encontrada probando. Supabase le concede TODO a `anon` y a
-- `authenticated` sobre cualquier tabla nueva del esquema público. La RLS
-- igual lo frena —comprobado: un insert anónimo devuelve «new row violates
-- row-level security policy»—, pero el resto de las tablas de esta base
-- tienen esas concesiones quitadas, y por eso un `select` anónimo sobre
-- `products` devuelve 401 y sobre ésta devolvía 200 con una lista vacía.
--
-- No es lo mismo. Las dos protegen el dato, pero una dice «no existís acá» y
-- la otra dice «existe, y está vacío para vos»: confirma que la tabla existe
-- y cómo se llama, y deja el permiso puesto por si algún día alguien escribe
-- una política más floja.

revoke all on table public.public_quote_requests from anon;

revoke all on table public.public_quote_requests from authenticated;
grant select, update on table public.public_quote_requests to authenticated;

-- Verificado después, sin sesión: 401 al leer y 401 al insertar, y la Edge
-- Function sigue guardando.
