-- Fase 46 · TOHNICHI: 23 referencias en minúscula y 11 que no son productos
--
-- APLICADA el 2026-10-08 (`fase46_tohnichi_mayusculas_y_titulos`). Se deja el
-- archivo por el motivo de siempre: el QUÉ se lee en la base, el POR QUÉ sólo
-- acá.
--
-- Son los 23 que la Fase 45 dejó sin poder cumplir la regla.
--
--
-- ── 1 · LAS MAYÚSCULAS ───────────────────────────────────────────────────
--
-- En TODO el catálogo había 23 referencias con alguna minúscula, y las 23 eran
-- de TOHNICHI. Los otros 21.793 productos estaban en mayúscula.
--
-- No es una preferencia estética: la base estaba desalineada CONSIGO MISMA. El
-- nombre del producto ya lo escribe en mayúscula —«TOHNICHI CLE400FX27D TORQUE
-- WRENCH»— mientras la referencia decía `TC.CLE400Fx27D`. Y la regla de la
-- referencia pasa el modelo a mayúsculas, así que estas 23 eran las únicas que
-- no podían cumplirla nunca.
--
-- Al pasarlas, las 23 cumplen —espacios incluidos, porque la regla también
-- deja el espacio: `TC.CSPLD100N3X15D W/CD5`—.
--
-- Los ESPACIOS no se tocan. Hay 74 referencias con espacio en el catálogo y
-- sólo 13 son de esta marca, así que sacarlos es otra limpieza, con sus
-- propias decisiones, y no se mezcla con ésta.
--
-- El campo `model_code` se deja como lo escribe el fabricante: `CLE400Fx27D`
-- es como Tohnichi llama a ese modelo, y el modelo es un dato de ellos. La
-- referencia es nuestra; el modelo, no.

do $$
declare
  v_empresa uuid := (select id from companies where slug = 'buscatools');
  v_choques text;
begin
  -- Primero se comprueba, después se escribe. Si al pasar a mayúscula alguna
  -- referencia chocara con otra que ya existe no se toca nada: sería fundir
  -- dos productos sin querer, que es exactamente lo que casi pasa con los
  -- ESTIC en la Fase 45.
  select string_agg(x.sku || ' -> ' || x.nueva, '; ') into v_choques
    from (select pr.sku, upper(pr.sku) as nueva
            from products pr join brands b on b.id = pr.brand_id
           where pr.company_id = v_empresa and pr.deleted_at is null
             and b.name = 'TOHNICHI' and pr.sku ~ '[a-z]') x
   where exists (select 1 from products o
                  where o.company_id = v_empresa and o.deleted_at is null
                    and o.sku = x.nueva and o.sku <> x.sku);
  if v_choques is not null then
    raise exception 'fase46: pasar a mayuscula chocaria con referencias que ya existen: %', v_choques;
  end if;

  update products pr
     set sku = upper(pr.sku), updated_at = now()
    from brands b
   where b.id = pr.brand_id and pr.company_id = v_empresa and pr.deleted_at is null
     and b.name = 'TOHNICHI' and pr.sku ~ '[a-z]';
end $$;


-- ── 2 · LAS ONCE QUE NO SON PRODUCTOS ────────────────────────────────────
--
-- Títulos de sección de una lista de precios que entraron como productos:
-- sin precio, sin un solo atributo, sin stock, sin renglones en ningún
-- documento y sin id de STEL. Alguien que buscaba en el catálogo veía un
-- producto llamado «TOHNICHI Socket» que no dice nada y no se puede cotizar.
--
-- BAJA LÓGICA, no borrado: mismo criterio que la Fase 38 con los servicios.
-- La fila queda y se vuelve atrás con un update.
--
-- Se listan una por una y NO por «las que no tienen precio»: un producto real
-- puede quedarse sin precio en cualquier momento —pasó con la CINTA PAPEL que
-- entró el mismo día desde STEL— y una regla así lo retiraría solo.

update products set deleted_at = now(), updated_at = now()
 where company_id = (select id from companies where slug = 'buscatools')
   and deleted_at is null
   and sku in (
     'TC.ACCESSORIES',
     'TC.ACCESSORIES FOR DOTE4-MD2',
     'TC.ACCESSORY FOR MCSP',
     'TC.ACCESSORY FOR MPQL',
     'TC.RECEIVER & MODULES',
     'TC.SETTING BOX',
     'TC.SOCKET',
     'TC.TIQL',
     'TC.TIQLLS',
     'TC.TRANSMITTER',
     'TC.WEIGHT');

do $$
declare n int;
begin
  select count(*) into n from products
   where company_id = (select id from companies where slug = 'buscatools')
     and deleted_at is null and sku ~ '[a-z]';
  if n > 0 then
    raise exception 'fase46: quedaron % referencias con minuscula', n;
  end if;
end $$;


-- ── RESULTADO ────────────────────────────────────────────────────────────
--
--   referencias con minúscula    23 → 0   (en todo el catálogo)
--   cumplen la regla         17.220 → 17.232
--   no coinciden                 28 → 3
--   total que ve el catálogo 21.816 → 21.805
--
-- Los 3 que quedan son los duplicados de la Fase 45 —`ET.EH2-CVS05-SS`,
-- `ET.EH2-R1016-S` y `RV.RIV503`— que no se tocan porque renombrarlos
-- fusionaría productos distintos. Esperan una decisión.
--
-- Para deshacer el punto 2:
--   update products set deleted_at = null where sku in ('TC.ACCESSORIES', …);
