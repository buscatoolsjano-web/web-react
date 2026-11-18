-- «Mechas y brocas» (18-11-2026).
--
-- Al revisar a mano lo que había quedado en «Otros» aparecieron unas 130
-- mechas, brocas, machos de roscar, terrajas, fresas e insertos de torno sin
-- un lugar propio: no son abrasivos ni puntas de atornillar. La
-- reclasificación (1.510 productos) la aplica scripts/aplicar-categorias.mjs
-- con la propuesta revisada; el respaldo para deshacer es el mismo de ayer,
-- app.respaldo_categorias_20261117 (estos productos no se habían tocado).

insert into public.product_categories (company_id, name, slug, slug_publico, publica, is_active, needs_review, position)
select c.id, 'Mechas y brocas', 'mechas', 'mechas-y-brocas', true, true, false, 12
from public.companies c
where c.name = 'Buscatools'
  and not exists (
    select 1 from public.product_categories pc where pc.company_id = c.id and pc.slug = 'mechas'
  );
