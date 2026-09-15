-- =============================================================================
-- Fase 14 · Entrega 0 — Apariencia por usuario.
--
-- Dónde se guarda: public.profiles, fila del propio usuario (id = auth.users.id).
--   · profiles ya existe (una fila por usuario, trigger app.handle_new_user);
--   · RLS ya garantiza el aislamiento: profiles_update_own (id = auth.uid()) y
--     profiles_select (propio o compañero de empresa);
--   · la columna vieja `theme` sólo admite light/dark y nadie la usa: no se toca.
--
-- Cambio mínimo:
--   1. columna `appearance jsonb` (NULL = original Buscatools);
--   2. función pura app.apariencia_valida(jsonb) con la lista blanca exacta de
--      claves y valores (los mismos ids que src/features/apariencia/opciones.ts);
--   3. CHECK que la usa: un valor inválido se rechaza en la base, no sólo en la UI.
--
-- Sin company_id ni user_id libres: el cliente actualiza SU fila por RLS.
-- Sin RPC nueva, sin SECURITY DEFINER, sin datos: las filas existentes quedan NULL.
-- Aplicada como migración `fase14_e0_apariencia_por_usuario`.
--
-- Rollback:
--   alter table public.profiles drop constraint profiles_appearance_valida;
--   alter table public.profiles drop column appearance;
--   drop function app.apariencia_valida(jsonb);
-- =============================================================================

alter table public.profiles add column if not exists appearance jsonb;

comment on column public.profiles.appearance is
  'Fase 14 E0: apariencia elegida por el usuario {version, preset, acento, tamano, fuente}. NULL = original Buscatools.';

create or replace function app.apariencia_valida(p jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select p is null or (
    jsonb_typeof(p) = 'object'
    and pg_column_size(p) <= 512
    and (select count(*) from jsonb_object_keys(p) k) = 5
    and not exists (
      select 1 from jsonb_object_keys(p) k
      where k not in ('version', 'preset', 'acento', 'tamano', 'fuente')
    )
    and jsonb_typeof(p -> 'version') = 'number' and (p ->> 'version') = '1'
    and jsonb_typeof(p -> 'preset') = 'string'
    and (p ->> 'preset') in (
      'claro-naranja', 'oscuro-naranja', 'turquesa-marino', 'violeta-claro',
      'azul-marino', 'verde-menta-claro', 'azul-cielo-oscuro', 'azul-noche',
      'azul-corporativo', 'azul-corporativo-claro', 'gris-pizarra-oscuro',
      'verde-esmeralda', 'azul-electrico', 'verde-industrial', 'grafito',
      'naranja-oscuro', 'cian-oscuro'
    )
    and jsonb_typeof(p -> 'acento') = 'string'
    and (p ->> 'acento') in ('tema', 'naranja', 'azul', 'turquesa', 'verde', 'violeta', 'rosa', 'grafito')
    and jsonb_typeof(p -> 'tamano') = 'string'
    and (p ->> 'tamano') in ('compacto', 'normal', 'grande')
    and jsonb_typeof(p -> 'fuente') = 'string'
    and (p ->> 'fuente') in ('sistema', 'clasica', 'serif')
  )
$$;

revoke all on function app.apariencia_valida(jsonb) from public, anon;
grant execute on function app.apariencia_valida(jsonb) to authenticated, service_role;

alter table public.profiles
  add constraint profiles_appearance_valida check (app.apariencia_valida(appearance));
