-- Fase 142 · Cada categoría con una foto real, elegible por un admin.
-- (Aplicada a São Paulo con apply_migration `fase142_portada_de_categoria`;
--  se deja acá para que el repo tenga la fuente.)
--
-- La portada apunta a un PRODUCTO (su foto es la portada), no a una URL suelta:
-- queda en sync si al producto le cambian la foto, y el admin elige «mostrá este
-- producto». Se agrega la columna, se hace backfill de cada categoría pública con
-- un producto visible suyo que tenga foto, y la RPC catalogo_publico_categorias
-- devuelve además `portadaUrl` (con fallback a cualquier producto visible).
--
-- Nota: 4 categorías públicas (Llaves dinamométricas, Repuestos, EPP, Herramientas
-- manuales) no tienen NINGUNA foto en sus productos, así que quedan sin portada
-- hasta que alguien les cargue/elija una desde el gestor (Fase 143).

alter table public.product_categories
  add column if not exists portada_product_id uuid references public.products(id) on delete set null;

update public.product_categories c
set portada_product_id = (
  select pp.id
    from public.products pp
    join public.product_images pi on pi.product_id = pp.id and pi.source_url is not null
   where pp.category_id = c.id
     and pp.public_slug is not null and pp.status = 'active' and pp.deleted_at is null
   order by pi.is_primary desc nulls last, pi.position nulls last, pp.name
   limit 1
)
where c.publica and c.portada_product_id is null;

-- La definición completa de catalogo_publico_categorias vive en la migración.
