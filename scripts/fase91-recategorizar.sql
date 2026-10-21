-- ─────────────────────────────────────────────────────────────────────────────
-- Fase 91 · Recategorización de APEX contra apexbits.com
-- ─────────────────────────────────────────────────────────────────────────────
-- El import original clasificó por la palabra suelta del nombre ("socket",
-- "square"), así que 456 productos quedaron en la familia equivocada: anillos
-- de retención como «Embocadura», puntas Allen como «Embocadura», adaptadores,
-- nutsetters y cardánicos mal tipados. apexbits.com (el slug describe qué ES
-- cada producto) es la fuente de verdad.
--
-- El trabajo vive en los `.mjs` de esta fase (leen apexbits-index.json del crawl
-- de la Fase 89 y cruzan contra nuestro catálogo):
--   · fase91-apex-auditar-categoria.mjs   detecta los errores de FAMILIA
--   · fase91-plan-recategorizar.mjs        deriva el tipo/categoría real del slug
--   · fase91-aplicar-recategorizar.mjs     escribe product_type/category_id
-- Export para auditar: scripts/.apex/recategorizacion-apex.csv
--
-- Lo que se cambió: product_type de 456 productos; categoría a «Accesorios» de
-- los 9 anillos de retención; y el nombre («APEX <modelo> <TIPO>») donde embebía
-- el tipo viejo. El slug público NO se tocó (es una URL viva; cambiarlo rompe
-- enlaces). Reversible desde fase91.categoria_bak.

-- Backup del estado previo (tipo + categoría).
create schema if not exists fase91;
revoke all on schema fase91 from anon, authenticated;
drop table if exists fase91.categoria_bak;
create table fase91.categoria_bak as
  select p.id, p.sku, p.product_type, p.category_id
  from public.products p join public.brands b on b.id = p.brand_id
  where b.name ilike 'apex' and p.deleted_at is null;

-- La recategorización en sí la aplica fase91-aplicar-recategorizar.mjs (es por
-- fila, derivada del slug). Después, el nombre se regenera donde seguía el
-- patrón viejo:
--   update public.products p set name = 'APEX '||p.model_code||' '||upper(p.product_type)
--   from fase91.categoria_bak b
--   where b.id=p.id and p.product_type is distinct from b.product_type
--     and p.name = 'APEX '||p.model_code||' '||upper(b.product_type);

-- Rollback: restaurar tipo/categoría/nombre desde fase91.categoria_bak + fase89.products_bak.
