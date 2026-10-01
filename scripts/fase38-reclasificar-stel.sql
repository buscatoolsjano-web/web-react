-- Fase 38 · Vaciar «Pendiente de clasificación STEL»
--
-- Eran 52 productos y NINGUNO era basura: los 52 tenían historia comercial
-- —97 renglones de cotización, 38 de pedido, 66 de remito— y la última
-- cotización era del 2026-09-11. Entre ellos, siete SERVICIOS que se facturan
-- (flete y alquileres) que nunca encajaron en una categoría de productos y por
-- eso habían quedado en el limbo.
--
-- Decisión del dueño, con la lista a la vista: dar de baja los servicios y los
-- materiales de obra, y reclasificar el resto.

do $$
declare k_acc uuid; k_punta uuid; k_herr uuid; k_otros uuid; k_stel uuid;
begin
  select id into k_acc   from product_categories where slug = 'accesorio';
  select id into k_punta from product_categories where slug = 'punta';
  select id into k_herr  from product_categories where slug = 'herramientas';
  select id into k_otros from product_categories where slug = 'otros';
  select id into k_stel  from product_categories where slug = 'pendiente-clasificacion-stel';

  -- 1 · Baja LÓGICA, no borrado. Los 18 están en 97 renglones de documentos;
  --     un `delete` los rompería. Con `deleted_at` desaparecen del catálogo y
  --     las cotizaciones y remitos viejos quedan enteros.
  --     7 servicios (SER*) + 11 materiales de obra (perfiles, chapas,
  --     tornillería, alambre MIG).
  update products set deleted_at = now(), updated_at = now()
   where deleted_at is null and category_id = k_stel
     and (sku like 'SER%' or sku between 'PRO12225' and 'PRO12235');

  -- 2 · El resto, a su categoría.
  update products set category_id = k_acc, updated_at = now()
   where deleted_at is null and sku in ('B2036LA-2','ES.ENRZ-CVMN2-100','ES.ENRZ-CVTR-100','PRO12256');

  update products set category_id = k_punta, updated_at = now()
   where deleted_at is null and sku in ('PRO12438','PRO12602','PRO12603','PRO12605','PRO12609');

  update products set category_id = k_herr, updated_at = now()
   where deleted_at is null and sku in ('ES.MPU60-40','ES.SPT020-25','PRO12439','PRO12596','PRO12597',
         'PRO12598','PRO12599','PRO12601','PRO12604','PRO12606','PRO12608');

  -- Lo que quede va a Otros, marcado para revisar. Son 14, y seis de ellos son
  -- códigos sin descripción —DXSK2M15L, AK32H, EA48H…— donde el nombre ES el
  -- código: no hay con qué clasificarlos.
  update products set category_id = k_otros, needs_review = true, updated_at = now()
   where deleted_at is null and category_id = k_stel;

  -- La categoría queda vacía y se desactiva: un chip con cero productos no
  -- informa, estorba.
  update product_categories set is_active = false where id = k_stel;
end $$;

-- ── El bug que esto destapó ───────────────────────────────────────────────
--
-- `search_products` y `catalog_facets` NO filtraban `deleted_at`. O sea que
-- dar de baja un producto no lo sacaba del catálogo: seguía listándose y
-- contándose en las facetas.
--
-- No se notaba porque casi nadie daba de baja productos… salvo que el dedup de
-- la migración había fundido 53, y esos 53 duplicados seguían a la vista. Al
-- dar de baja estos 18 habrían seguido apareciendo también.
do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='search_products';
  if position('p.deleted_at' in d) = 0 then
    execute replace(d, '    WHERE p.company_id = p_company',
                       '    WHERE p.company_id = p_company' || E'\n' || '      AND p.deleted_at IS NULL');
  end if;

  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='catalog_facets';
  if position('p.deleted_at' in d) = 0 then
    execute replace(d, '    WHERE p.company_id = p_company',
                       '    WHERE p.company_id = p_company' || E'\n' || '      AND p.deleted_at IS NULL');
  end if;
end $$;

-- Comprobación: el total del catálogo tiene que ser EXACTAMENTE la cantidad de
-- productos vivos. Antes daba 21.825 contra 21.754 vivos: 71 de diferencia.
--   select (public.catalog_facets('<empresa>') ->> 'total')::int,
--          (select count(*) from products where company_id='<empresa>' and deleted_at is null);
