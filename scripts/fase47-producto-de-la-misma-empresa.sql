-- Fase 47 · 11 productos estaban en la categoría de OTRA empresa
--
-- APLICADA el 2026-10-08 (`fase47_producto_en_categoria_de_otra_empresa`).
--
--
-- ── QUÉ PASÓ ─────────────────────────────────────────────────────────────
--
-- La Fase 38 quiso clasificar 11 productos como «Herramientas» y escribió:
--
--     select id into k_herr from product_categories where slug = 'herramientas';
--
-- Sin `company_id`. Buscatools no tiene esa categoría; torquetools sí. Así que
-- los 11 quedaron apuntando a una categoría de la otra empresa, y nadie se
-- enteró durante semanas.
--
-- No es teórico. Están en uso —24 renglones entre cotizaciones, pedidos y
-- remitos, el último COTI02547, y `PRO12599` con 3 remitos— y el catálogo los
-- contaba pero **no se podían filtrar por categoría**, porque esa categoría no
-- aparece entre las de Buscatools. Un producto que existe, que se vende, y que
-- no se puede encontrar por donde uno lo buscaría.
--
-- Es exactamente el error que casi repito en la Fase 43: updates sin acotar
-- por empresa en una base multiempresa. Ahí lo cacé antes de aplicar. Acá ya
-- estaba hecho.
--
-- Se revisaron las otras relaciones y están limpias: 0 productos con marca de
-- otra empresa, 0 precios en lista ajena, 0 atributos cruzados. Era un
-- incidente aislado — lo que faltaba, y eso sí era sistémico, era el guard.
--
--
-- ── 1 · LOS ONCE, A «OTROS» ──────────────────────────────────────────────
--
-- Decisión del dueño con la lista a la vista: dos press units de ESTIC
-- (descatalogados, sin precio) y nueve herramientas de ferretería —alicates,
-- pinzas, llaves, un malacate, manómetros, un taladro Milwaukee—.
--
-- NO se marca `needs_review`: no quedan pendientes de clasificar, se decidió
-- dónde van. Marcarlos contradiría una decisión recién tomada.

update products p
   set category_id = (select id from product_categories
                       where slug = 'otros' and company_id = p.company_id),
       updated_at = now()
  from product_categories c
 where c.id = p.category_id
   and p.deleted_at is null
   and c.company_id <> p.company_id;


-- ── 2 · QUE NO SE PUEDA VOLVER A HACER ───────────────────────────────────
--
-- Lo que falló no fue el criterio: fue que **la base aceptó la fila**. Una
-- clave foránea a `product_categories(id)` no alcanza en una base multiempresa,
-- porque el id existe — es de otro.
--
-- No se puede expresar con un CHECK (mira otra tabla) ni con una FK simple,
-- así que va como trigger, al lado de los otros dos que ya protegen `products`:
-- `validate_product_attributes` y `proteger_campos_importacion`.
--
-- Vale para la marca también, aunque hoy no haya ninguna cruzada: el día que
-- la haya sería el mismo problema y nadie lo estaría mirando.

create or replace function public.validar_producto_de_la_misma_empresa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_otra uuid;
begin
  if new.category_id is not null then
    select company_id into v_otra from product_categories where id = new.category_id;
    if v_otra is distinct from new.company_id then
      raise exception 'categoria_de_otra_empresa'
        using errcode = '23514',
              detail = format('la categoria %s es de la empresa %s y el producto de la %s',
                              new.category_id, v_otra, new.company_id),
              hint = 'buscar la categoria por slug Y company_id, no solo por slug';
    end if;
  end if;

  if new.brand_id is not null then
    select company_id into v_otra from brands where id = new.brand_id;
    if v_otra is distinct from new.company_id then
      raise exception 'marca_de_otra_empresa'
        using errcode = '23514',
              detail = format('la marca %s es de la empresa %s y el producto de la %s',
                              new.brand_id, v_otra, new.company_id),
              hint = 'buscar la marca por nombre Y company_id, no solo por nombre';
    end if;
  end if;

  return new;
end $$;

comment on function public.validar_producto_de_la_misma_empresa() is
  'Fase 47: un producto no puede apuntar a la categoria ni a la marca de OTRA empresa. Una FK no alcanza: el id existe, es de otro. Paso de verdad —11 productos quedaron en la categoria Herramientas de torquetools porque la Fase 38 la busco por slug sin company_id— y nadie se entero por semanas.';

drop trigger if exists trg_products_misma_empresa on products;
create trigger trg_products_misma_empresa
  before insert or update of company_id, category_id, brand_id on products
  for each row execute function public.validar_producto_de_la_misma_empresa();


-- ── COMPROBACIÓN ─────────────────────────────────────────────────────────
--
-- Se probó que frena, con un update que no escribió nada:
--
--   update products set category_id = '<la de torquetools>'
--    where sku = 'PRO12608' and company_id = <buscatools>;
--
--   ERROR: categoria_de_otra_empresa
--   DETALLE: la categoria 445a5203… es de la empresa 492a0ee9… y el producto
--            de la bbcb2cee…
--   PISTA: buscar la categoria por slug Y company_id, no solo por slug
--
-- Y que lo legítimo sigue pasando: el producto quedó en «Otros» de Buscatools.
--
--   productos en categoria de otra empresa   11 → 0
