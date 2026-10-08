-- Fase 44 · Vaciar otra vez «Pendiente de clasificación STEL»
--
-- APLICADA el 2026-10-08. Se deja el archivo por el mismo motivo que los
-- demás: el QUÉ se lee en la base, el POR QUÉ sólo acá.
--
--
-- ── EL PROBLEMA, QUE ES RECURRENTE ───────────────────────────────────────
--
-- La Fase 38 vació esta categoría y la desactivó: «un chip con cero productos
-- no informa, estorba». Volvió a llenarse sola: 62 productos vivos, siete de
-- ellos de hoy mismo, de la reconciliación manual de STEL.
--
-- Y acá está lo feo: la categoría sigue en `is_active = false`, y un producto
-- en una categoría inactiva NO SE VE EN EL CATÁLOGO. Eran 21.880 productos en
-- la base contra 21.752 en pantalla.
--
-- O sea que el camino normal —STEL manda un artículo nuevo, el sync nocturno
-- lo crea con `--crear-nuevos`, cae en esta categoría porque STEL no manda
-- familia— termina en un producto que existe, tiene precio, se puede cotizar
-- por su referencia… y no aparece en el catálogo. Sin un cartel, sin un
-- conteo, sin nada. Se descubre cuando alguien lo busca y no está.
--
-- Esta migración limpia lo acumulado. NO arregla la causa: mientras los
-- productos nuevos sigan cayendo en una categoría inactiva, esto se va a
-- volver a llenar. Lo que haría falta es que la corrida avise cuántos dejó
-- ahí, o que caigan directamente en «Otros».
--
--
-- ── EL CRITERIO ──────────────────────────────────────────────────────────
--
-- El mismo de la Fase 38: lo que se puede reconocer va a su familia, el resto
-- a «Otros» marcado para revisar.
--
-- A diferencia de aquella vez NO se da de baja nada. En la Fase 38 había
-- siete servicios (fletes, alquileres) y once materiales de obra que el dueño
-- decidió retirar; acá no hay nada de eso.
do $$
declare k_punta uuid; k_bal uuid; k_otros uuid; k_stel uuid; n_otros int;
begin
  select id into k_punta from product_categories
   where slug = 'punta' and company_id = (select id from companies where slug = 'buscatools');
  select id into k_bal   from product_categories
   where slug = 'balanceador' and company_id = (select id from companies where slug = 'buscatools');
  select id into k_otros from product_categories
   where slug = 'otros' and company_id = (select id from companies where slug = 'buscatools');
  select id into k_stel  from product_categories
   where slug = 'pendiente-clasificacion-stel' and company_id = (select id from companies where slug = 'buscatools');

  -- BLD es una serie de balanceadores de Ingersoll Rand —está en la lista de
  -- series del catálogo, al lado de BSD, BSDL y BHD— y los dos traen la
  -- capacidad y el largo de linga escritos en el nombre:
  --   «BLD1 INGERSOLL RAND O,4 - 1. LINGA 1.60 MTRS»
  update products set category_id = k_bal, updated_at = now()
   where deleted_at is null and category_id = k_stel
     and sku in ('PRO12618', 'PRO12619');

  -- «Embocadura», «Punta» y «Adaptador» son series que ya existen dentro de
  -- Puntas y tubos, y los cinco lo dicen en el nombre.
  update products set category_id = k_punta, updated_at = now()
   where deleted_at is null and category_id = k_stel
     and sku in ('SP.J23M6XP1.0', 'SP.J23M8XP1.25', 'VPTP10/170', 'PRO12635', 'PRO12653');

  -- El resto son 55: ferretería y consumibles —tornillos, tarugos, discos,
  -- mechas, selladores, contenedores— e instrumentos de medición (cámara
  -- termográfica, telurómetro, luxómetro, manómetros WIKA). Ninguno pertenece
  -- a las familias que tiene el catálogo.
  --
  -- Tres de esos 55 son un código sin descripción —FI.26C12AL, FI.26C8AL y
  -- «ROTATING 6153977435»—. FIAM fabrica atornilladores, así que esos dos
  -- podrían ir a Atornilladores, pero el nombre ES el código y no hay con qué
  -- confirmarlo. Adivinar sería peor: quedarían con las columnas de torque y
  -- revoluciones vacías, afirmando una familia que nadie verificó.
  update products set category_id = k_otros, needs_review = true, updated_at = now()
   where deleted_at is null and category_id = k_stel;

  select count(*) into n_otros from products
   where deleted_at is null and category_id = k_stel;
  if n_otros > 0 then
    raise exception 'fase44: quedaron % productos sin clasificar', n_otros;
  end if;
end $$;

-- ── RESULTADO ────────────────────────────────────────────────────────────
--
--   Puntas y tubos   8.628 → 8.633
--   Balanceadores      376 →   378
--   Otros           12.550 → 12.605
--   Pendiente           62 →     0
--
--   total que ve el catálogo: 21.752 → 21.816
