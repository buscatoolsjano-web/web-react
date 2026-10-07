-- Fase 40 · Que el desalineamiento de la clave se note el mismo día
--
-- Migración aplicada: `fase40_huella_clave_api_email` (São Paulo, 2026-10-07).
--
-- QUÉ PASÓ
--
-- Del 28/09 al 07/10 de 2026 no se pudo mandar un solo mail desde el ERP, y
-- nadie se enteró hasta que una persona lo intentó y vio el cartel.
--
-- La clave que firma los envíos NO se configura: la genera la base, con
-- `gen_random_bytes(32)`, cuando se instala el esquema (ver
-- `docs/database/PHASE_9_EMAILS_ENTREGA_5.sql`). Al migrar el proyecto a São
-- Paulo el esquema se instaló de nuevo y salió una clave nueva; el servicio en
-- Cloud Run siguió con la de Ohio, en `email-api-hmac:1`.
--
-- Desde ahí, `reservar_envio_email` cortaba en `firma_invalida` antes de
-- insertar la fila. Por eso `email_send_requests` no tenía ni un registro del
-- problema: el síntoma era justamente la ausencia de síntomas.
--
-- Arreglo operativo: versión 2 del secreto con la clave que hoy tiene la base,
-- y el servicio apuntado a esa versión (revisión `00007-86k`). Esto de acá es
-- lo otro: que la próxima vez se sepa el mismo día.
--
-- POR QUÉ UNA HUELLA Y NO LA CLAVE
--
-- La función no devuelve nada: recibe una huella y contesta sí o no. Quien
-- pregunta ya tiene que saber la respuesta para que le digan que sí, así que no
-- se filtra nada. Devolver la huella sería gratuito: no sirve para forjar una
-- firma, pero no hay razón para regalarlo.
--
-- 16 hexadecimales son 64 bits: adivinarlos por HTTP no es un ataque, es una
-- fantasía. Y aun adivinándolos no se llega a la clave, que son 256 bits.
--
-- POR QUÉ `anon`
--
-- El servicio sólo tiene la clave publicable de Supabase; al arrancar no hay
-- ninguna persona logueada cuyo JWT usar. Con `anon` la comprobación se puede
-- hacer en el arranque, que es exactamente cuando sirve: si se esperara al
-- primer envío, un desalineamiento puede vivir semanas sin que nadie lo note.
-- Pasó.

create or replace function public.clave_api_email_coincide(p_huella text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(p_huella, '') ~ '^[0-9a-f]{16}$'
     and p_huella = substr(encode(extensions.digest(
           (select clave from app.email_api_secretos where id = 1), 'sha256'), 'hex'), 1, 16);
$$;

revoke all on function public.clave_api_email_coincide(text) from public;
grant execute on function public.clave_api_email_coincide(text) to anon, authenticated, service_role;

comment on function public.clave_api_email_coincide(text) is
  'Compara una huella (16 hex del sha256 de la clave) con la de app.email_api_secretos. No devuelve la huella: sólo sí o no. La usa el servicio de mails al arrancar para detectar que su EMAIL_API_HMAC quedó viejo.';

-- Comprobación (la corrida real dio true / false / false / false):
--
--   select clave_api_email_coincide(
--            substr(encode(extensions.digest(
--              (select clave from app.email_api_secretos where id = 1), 'sha256'), 'hex'), 1, 16)) as con_la_buena,
--          clave_api_email_coincide(repeat('0', 16))      as con_otra,
--          clave_api_email_coincide('no es una huella')   as con_basura,
--          clave_api_email_coincide(null)                 as con_nulo;
--
-- Y por PostgREST, como `anon`, que es como la llama el servicio:
--
--   curl -s -X POST "$URL/rest/v1/rpc/clave_api_email_coincide" \
--     -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--     -H 'Content-Type: application/json' -d '{"p_huella":"…"}'   → true
