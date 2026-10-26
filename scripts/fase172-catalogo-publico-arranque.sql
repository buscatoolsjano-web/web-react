-- Fase 172 · El catálogo público aparece sin la espera del arranque
--
-- Viene de la Fase 171 (que arregló `catalogo_publico_listar` con
-- `not materialized`). Seguía notándose lento al ENTRAR. Midiendo de punta a
-- punta en app.buscatools.com (incógnito) salieron tres cosas:
--
--   1) `catalogo_publico_categorias` tardaba ~3,5 s de servidor (y >3 s para
--      anon, que tiene statement_timeout=3s: la llamada moría con 500/57014 y
--      React Query la reintentaba —se veían DOS tandas de consultas—).
--   2) `catalogo_publico_facetas` ~0,7-0,9 s y `catalogo_publico_listar` ya
--      rápido tras la Fase 171.
--   3) El frontend no dispara NINGUNA consulta hasta ~1,6 s (baja y monta el
--      bundle), y encima `listar`/`facetas` esperan ~0,7-0,9 s más a que baje
--      el chunk perezoso de la página. Eso se arregla del lado del front
--      (Fase 172, adelanto desde el layout); acá va sólo la base.
--
-- ── CATEGORÍAS: UNA SOLA PASADA POR LAS FOTOS ───────────────────────────────
--
-- El costo estaba en el `left join lateral` que, por CADA categoría, escaneaba
-- TODO product_images (32k filas) y después miraba el producto por PK para
-- filtrar por categoría: ~129k lookups, ~400k buffers, ~3,5 s.
--
-- Medido con EXPLAIN (ANALYZE, BUFFERS) contra São Paulo:
--   lateral por categoría (lo viejo)        → ~3520 ms / 405k buffers
--   lateral manejado desde products          → ~431 ms / 33k buffers
--   una pasada con `distinct on` (lo nuevo)  → ~155 ms / 6,7k buffers
--
-- `distinct on (category_id)` resuelve UNA foto por categoría en un solo
-- escaneo. La foto que el admin eligió como portada gana por el orden del
-- `distinct on` (el booleano `= portada_product_id` primero); si no hay, la
-- primaria. El resultado es idéntico al anterior.
--
-- Ojo de medición (reutilizable):
--   · El MCP mide como `postgres` (o service_role), que puede ser mucho más
--     rápido que `anon`. Medir también con `set role anon` (y acordarse de
--     `reset role`): ver [[medir-y-probar-como-authenticated]].
--   · El `jit` global YA está en off en este proyecto. Forzar `set jit=on`
--     dispara ~1,5 s de compilación en estas RPC (cost alto por los seq scan),
--     así que NO volver a encenderlo global. El `SET jit=off` por función que
--     quedó abajo es cinturón-y-tiradores (el top-level no siempre lo respeta,
--     pero no molesta).
--   · El pico en frío (primer visitante en un backend recién reciclado) sigue
--     existiendo; lo ataca el keep-warm de más abajo.

CREATE OR REPLACE FUNCTION public.catalogo_publico_categorias()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
 SET jit TO 'off'
AS $function$
  with cats as (
    select c.id as cat_id,
           coalesce(c.slug_publico, c.slug) as slug,
           c.name as nombre,
           c.portada_url,
           count(*) as n
      from public.products p
      join public.companies c0         on c0.id = p.company_id and c0.catalogo_publico
      join public.brands b             on b.id = p.brand_id and b.is_active
      join public.product_categories c on c.id = p.category_id and c.publica
     where p.deleted_at is null and p.status = 'active'
       and p.public_slug is not null
     group by c.id, 2, 3, c.portada_url
  ),
  -- Una foto por categoria en UNA sola pasada. La portada elegida gana; si no,
  -- la primaria. Antes esto era un lateral por categoria: ~3,5 s / 400k buffers.
  port as (
    select distinct on (pp.category_id)
           pp.category_id, pi.source_url
      from public.products pp
      join public.product_images pi    on pi.product_id = pp.id and pi.source_url is not null
      join public.companies c0         on c0.id = pp.company_id and c0.catalogo_publico
      join public.product_categories c on c.id = pp.category_id and c.publica
     where pp.public_slug is not null and pp.status = 'active' and pp.deleted_at is null
     order by pp.category_id,
              (c.portada_product_id is not null and pp.id = c.portada_product_id) desc,
              pi.is_primary desc nulls last, pi.position nulls last, pi.created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'slug', cats.slug, 'nombre', cats.nombre, 'productos', cats.n,
           'portadaUrl', coalesce(cats.portada_url, port.source_url)) order by cats.n desc), '[]'::jsonb)
    from cats
    left join port on port.category_id = cats.cat_id
$function$;

-- Cinturón-y-tiradores: estas tres RPC tienen cost alto por los seq scan sobre
-- products, así que si alguien encendiera el jit global las castigaría. El jit
-- no les sirve (queries medianas, la compilación no se recupera).
alter function public.catalogo_publico_facetas(text,text,text,text,jsonb,text,text) set jit = off;
alter function public.catalogo_publico_listar(text,text,text,integer,integer,text,text,jsonb,text) set jit = off;

-- ── KEEP-WARM: que el primer visitante no pague la lectura fría ─────────────
--
-- Con poco tráfico los backends de PostgREST se reciclan y el primer pedido en
-- uno nuevo lee las páginas del catálogo desde disco (~2-3 s). Un pg_cron cada
-- minuto llama las tres RPC de la portada (sin filtros) y mantiene esas páginas
-- calientes en shared_buffers (que es compartido por todos los backends). Las
-- RPC filtradas, menos frecuentes, llegan cuando el visitante ya está adentro.

CREATE OR REPLACE FUNCTION app.calentar_catalogo_publico()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public','extensions','pg_temp'
AS $$
begin
  perform catalogo_publico_categorias();
  perform catalogo_publico_facetas(null,null,null,null,null,null,null);
  perform catalogo_publico_listar(null,null,null,1,100,null,null,null,null);
end $$;

-- select cron.schedule('calentar-catalogo-publico', '* * * * *',
--                      $$select app.calentar_catalogo_publico()$$);
-- (Ya agendado en producción: jobid 9.)
