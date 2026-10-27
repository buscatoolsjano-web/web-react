-- Fase 177 · El catálogo del ERP tampoco arranca en frío
--
-- Hermano de la Fase 176 (que adelantó la portada PÚBLICA con un head-start en
-- index.html). Acá el problema es el catálogo del ERP: al entrar mostraba
-- «Cargando…» varios segundos.
--
-- La causa ya estaba documentada en la Fase 66 (usePrecalentarCatalogo): la RPC
-- `search_products` lee ~60 MB (la tabla `products` y sus índices) para dar el
-- total exacto del paginador, y EN FRÍO eso son ~2,4 s (contra ~170 ms en
-- caliente). El prefetch de la Fase 66 ayuda —pide la primera página 1,2 s
-- después de resolver la empresa, mientras se mira el Dashboard—, pero no es a
-- prueba de todo: si se entra al catálogo antes de que termine, o si la caché
-- de Postgres se enfrió por poco tráfico, se paga igual.
--
-- FIX: sumar `search_products` (primera página de cada empresa) al keep-warm que
-- ya corre cada minuto (pg_cron jobid 9, creado en la Fase 172 para la portada
-- pública). Así esas ~60 MB quedan siempre en shared_buffers y la consulta es
-- ~170 ms tanto para el prefetch como para una navegación en frío. Corre como
-- postgres, que no lo frena la RLS; lo que importa es que las páginas queden
-- calientes, y shared_buffers es compartido por todos los backends.
--
-- Medido: search_products(primera página) en caliente → 171 ms / 7.772 buffers.
--
-- Cambio SÓLO de base (ya aplicado en producción). El head-start del front va en
-- el commit de la Fase 176 (index.html + catalogoPublico.ts).

CREATE OR REPLACE FUNCTION app.calentar_catalogo_publico()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public','extensions','pg_temp'
AS $$
begin
  -- Portada del catálogo PÚBLICO (anon).
  perform catalogo_publico_categorias();
  perform catalogo_publico_facetas(null,null,null,null,null,null,null);
  perform catalogo_publico_listar(null,null,null,1,100,null,null,null,null);

  -- Catálogo del ERP: la primera página de cada empresa (Buscatools y
  -- Torquetools). Mantiene caliente lo que lee search_products.
  perform * from search_products('bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c'::uuid, null, 50, 0, null, null, null, null, null, null, true, null);
  perform * from search_products('492a0ee9-220f-4dc8-9eaa-ec914ea10907'::uuid, null, 50, 0, null, null, null, null, null, null, true, null);
end $$;

-- (El cron ya existe: jobid 9, 'calentar-catalogo-publico', cada minuto.)
