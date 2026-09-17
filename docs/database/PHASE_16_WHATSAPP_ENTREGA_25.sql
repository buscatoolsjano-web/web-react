-- ---------------------------------------------------------------------------
-- FASE 16 · WHATSAPP — Entrega 2.5: métricas por proveedor (piloto OpenAI)
-- ---------------------------------------------------------------------------
--
-- Aditivo y mínimo. El piloto real necesita saber, por corrida, QUÉ proveedor
-- respondió, cuántos tokens salieron de caché y cuántos fueron de razonamiento,
-- y cuánto costó. E2 sólo guardaba entrada, salida y modelo.
--
-- Lo que NO hace: tocar resúmenes, ítems, RLS, policies ni permisos. Las dos
-- RPC se modifican SÓLO en su INSERT a whatsapp_ai_runs; el resto del cuerpo
-- queda byte por byte igual (se reemplaza sobre la definición vigente y la
-- migración corta si el reemplazo no encuentra el texto esperado).
--
-- Sin texto: ni prompt, ni respuesta, ni mensajes. Sólo números y un código.

alter table whatsapp_ai_runs
  add column if not exists provider           text,
  add column if not exists cached_tokens      integer,
  add column if not exists reasoning_tokens   integer,
  add column if not exists estimated_cost_usd numeric(12, 8);

comment on column whatsapp_ai_runs.provider is
  'falso | openai | anthropic. Permite contar llamadas reales por proveedor.';
comment on column whatsapp_ai_runs.estimated_cost_usd is
  'Costo estimado con la tabla de precios verificada en el codigo (PRECIOS_OPENAI). NULL si el proveedor no es openai o no hubo uso.';

-- guardar_analisis_whatsapp: el INSERT de la corrida exitosa.
do $$
declare d text; n int;
begin
  select pg_get_functiondef('public.guardar_analisis_whatsapp(uuid,uuid,jsonb,text,jsonb)'::regprocedure) into d;
  n := length(d);
  d := replace(d,
    'input_tokens, output_tokens, duration_ms, items_saved, items_discarded
  ) values (',
    'input_tokens, output_tokens, duration_ms, items_saved, items_discarded,
    provider, cached_tokens, reasoning_tokens, estimated_cost_usd
  ) values (');
  d := replace(d,
    'coalesce((p_metricas->>''items_discarded'')::int, 0)
  );',
    'coalesce((p_metricas->>''items_discarded'')::int, 0),
    nullif(p_metricas->>''provider'', ''''), (p_metricas->>''cached_tokens'')::int,
    (p_metricas->>''reasoning_tokens'')::int, (p_metricas->>''estimated_cost_usd'')::numeric
  );');
  if length(d) = n or position('estimated_cost_usd' in d) = 0 or position('p_metricas->>''provider''' in d) = 0 then
    raise exception 'guardar_analisis_whatsapp: no se encontro el INSERT esperado';
  end if;
  execute d;
end $$;

-- registrar_corrida_ia_whatsapp: el INSERT de las corridas con error o sin cambios.
do $$
declare d text; n int;
begin
  select pg_get_functiondef('public.registrar_corrida_ia_whatsapp(uuid,text,text,text,jsonb)'::regprocedure) into d;
  n := length(d);
  d := replace(d,
    'input_tokens, output_tokens, duration_ms
  ) values (',
    'input_tokens, output_tokens, duration_ms,
    provider, cached_tokens, reasoning_tokens, estimated_cost_usd
  ) values (');
  d := replace(d,
    '(p_metricas->>''duration_ms'')::int
  );',
    '(p_metricas->>''duration_ms'')::int,
    nullif(p_metricas->>''provider'', ''''), (p_metricas->>''cached_tokens'')::int,
    (p_metricas->>''reasoning_tokens'')::int, (p_metricas->>''estimated_cost_usd'')::numeric
  );');
  if length(d) = n or position('estimated_cost_usd' in d) = 0 or position('p_metricas->>''provider''' in d) = 0 then
    raise exception 'registrar_corrida_ia_whatsapp: no se encontro el INSERT esperado';
  end if;
  execute d;
end $$;

-- `create or replace` conserva los grants existentes (sólo service_role). Se
-- reafirman igual, por si esta migración se aplica sobre una base distinta.
revoke execute on function public.guardar_analisis_whatsapp(uuid, uuid, jsonb, text, jsonb) from public, anon, authenticated;
grant  execute on function public.guardar_analisis_whatsapp(uuid, uuid, jsonb, text, jsonb) to service_role;
revoke execute on function public.registrar_corrida_ia_whatsapp(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant  execute on function public.registrar_corrida_ia_whatsapp(uuid, text, text, text, jsonb) to service_role;


-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- Volver a aplicar las dos funciones desde PHASE_16_WHATSAPP_ENTREGA_2.sql y:
-- alter table whatsapp_ai_runs drop column if exists estimated_cost_usd,
--   drop column if exists reasoning_tokens, drop column if exists cached_tokens,
--   drop column if exists provider;
