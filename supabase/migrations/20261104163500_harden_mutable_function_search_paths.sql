alter function app.forma_pago_nombre(text)
  set search_path = app, public, extensions, pg_temp;
alter function public.asistente_crear_cotizacion(uuid, text, jsonb, text)
  set search_path = public, app, extensions, pg_temp;
alter function public._preflight()
  set search_path = public, app, extensions, pg_temp;
alter function app.titulo_de_oc(text)
  set search_path = app, public, extensions, pg_temp;
alter function app.validar_regla_email(jsonb, jsonb)
  set search_path = app, public, extensions, pg_temp;
alter function app.entidad_borrable(text)
  set search_path = app, public, extensions, pg_temp;
