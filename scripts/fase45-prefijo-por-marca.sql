-- Fase 45 · El prefijo de la referencia es un dato de la marca
--
-- APLICADA el 2026-10-08, en dos partes (`fase45_prefijo_de_referencia_por_marca`
-- y `fase45b_alinear_siete_referencias`). Se deja el archivo por el motivo de
-- siempre: el QUÉ se lee en la base, el POR QUÉ sólo acá.
--
--
-- ── LA REGLA NO ERA LA REGLA ─────────────────────────────────────────────
--
-- «Las dos primeras letras de la marca, un punto, el modelo». Sobre los 21.816
-- productos del catálogo: 13.390 la cumplían y 3.824 no. Pero esos 3.824 **no
-- estaban mal**: siete marcas usan un prefijo propio, en el 100 % de sus
-- productos.
--
--   TOHNICHI → TC   INGERSOLL RAND → IR   BREMEN → BM   NAC → NC
--   CHICAGO PNEUMATIC → CP   URYU → UY   RED ROOSTER → RR
--
-- Y las excepciones tienen dos motivos, los dos buenos:
--
--   COLISIÓN. TORERO ya ocupa `TO`, así que TOHNICHI no puede ser `TO`.
--   BROPPE ya ocupa `BR`, así que BREMEN no puede ser `BR`. La regla de dos
--   letras **choca sola** en esos dos casos. La cicatriz está en los datos.
--
--   LA ABREVIATURA DE LA PROPIA MARCA. `IR` es Ingersoll Rand, `CP` es
--   Chicago Pneumatic —sus productos se llaman CP9911—, `RR` es Red Rooster.
--   Son las iniciales de las dos palabras, no las dos primeras letras.
--
-- El problema real: ese prefijo **no estaba guardado en ningún lado**. `brands`
-- tenía id, nombre, logo e is_active. Así que el formulario de alta proponía
-- `CH.9958` para un Chicago Pneumatic nuevo contra los 73 existentes que son
-- `CP.*`, y `TO.*` para un Tohnichi, pisando el espacio de Torero. La regla no
-- sólo describía mal lo que había: **generaba mal lo que venía**.
--
--
-- ── 1 · LA COLUMNA ───────────────────────────────────────────────────────

alter table brands add column if not exists sku_prefix text;

alter table brands drop constraint if exists brands_sku_prefix_formato;
alter table brands add constraint brands_sku_prefix_formato
  check (sku_prefix is null or sku_prefix ~ '^[A-Z]{2,4}$');

comment on column brands.sku_prefix is
  'Fase 45: el prefijo de la referencia de esta marca (SP.VPPH2 -> SP). Normalmente las dos primeras letras del nombre, pero no siempre: TOHNICHI es TC porque TORERO ya ocupa TO, y CHICAGO PNEUMATIC es CP porque es como se llama la marca a si misma. NO lleva unique: que dos marcas compartan prefijo es raro y se avisa al cargar, pero no se prohibe.';

-- Se siembra con el prefijo que CADA MARCA YA USA, leído de sus propios SKU, y
-- no con una lista escrita a mano: el dato está en los datos, y una lista a
-- mano envejece. Se ignoran los códigos PROxxxxx, que son el comodín del
-- legacy y no dicen nada de la marca.
update brands b
   set sku_prefix = (
     select split_part(p.sku, '.', 1)
       from products p
      where p.brand_id = b.id and p.deleted_at is null
        and position('.' in p.sku) > 0 and p.sku !~ '^PRO[0-9]'
      group by split_part(p.sku, '.', 1)
      order by count(*) desc
      limit 1)
 where b.company_id = (select id from companies where slug = 'buscatools')
   and b.sku_prefix is null;

-- MACSI es la única marca con productos y sin un solo SKU con prefijo: sus 96
-- productos son todos códigos PRO. Le toca el de la regla por defecto, que
-- además está libre (MERCEDES BENZ es ME y MILWAUKEE es MI).
update brands set sku_prefix = 'MA'
 where company_id = (select id from companies where slug = 'buscatools')
   and name = 'MACSI' and sku_prefix is null;

do $$
declare n int; marcas text;
begin
  select count(*), string_agg(b.name, ', ') into n, marcas
    from brands b
   where b.company_id = (select id from companies where slug = 'buscatools')
     and b.sku_prefix is null
     and exists (select 1 from products p where p.brand_id = b.id and p.deleted_at is null);
  if n > 0 then
    raise exception 'fase45: % marca(s) con productos quedaron sin prefijo: %', n, marcas;
  end if;
end $$;


-- ── 2 · LAS REFERENCIAS SIN PREFIJO ──────────────────────────────────────
--
-- Iban a ser diez. Son siete, y los tres que quedaron afuera son el hallazgo.
-- El bloque comprueba TODO antes de escribir nada, y ahí saltó:
--
--   ET.EH2-CVS05-SS → ES.EH2-CVS05-SS   el destino YA EXISTÍA
--   ET.EH2-R1016-S  → ES.EH2-R1016-S    ídem
--   RV.RIV503       → RI.RIV503         ídem
--
-- No eran errores de tipeo:
--
--   · Los dos ESTIC son el MISMO producto cargado dos veces, con dos ids de
--     STEL distintos (44699746 y 20282866 para el cable de 5 m). El duplicado
--     está dentro de STEL, no acá.
--   · RIV503 son DOS PRODUCTOS DISTINTOS que comparten modelo: `RV.RIV503` es
--     la remachadora hidroneumática y `RI.RIV503` son las jaws (x3), el
--     repuesto. El nombre de la primera dice «RIVIT.MAQ».
--
-- Renombrarlos los habría fusionado. Quedan para que los mire una persona.
--
-- Los siete de abajo son el caso limpio: el SKU ERA el modelo y sólo le
-- faltaba el prefijo. Es al revés de los 586 códigos PROxxxxx, donde el
-- «modelo» es el número del propio código —`PRO00017` tiene modelo `00017`— y
-- por eso NO se renombran: darían `GE.04377`, con la forma de la convención y
-- un modelo que no existe. Eso es peor que `PRO04377`, que al menos avisa que
-- es provisorio. Lo que les falta es el modelo de verdad, y eso es dato.

do $$
declare
  v_empresa uuid := (select id from companies where slug = 'buscatools');
  v_cambios constant text[][] := array[
    ['49-A-TX-25',        'AP.49-A-TX-25'],
    ['BPH10095',          'BM.BPH10095'],
    ['CP7748',            'CP.CP7748'],
    ['CP7748TL',          'CP.CP7748TL'],
    ['DC20EU26-C60UK',    'DU.DC20EU26-C60UK'],
    ['EH2-HT60-000NNN-E', 'ES.EH2-HT60-000NNN-E'],
    ['EH2-RA1000-SNL',    'ES.EH2-RA1000-SNL']
  ];
  v_par text[]; n int; v_falta text := '';
begin
  -- Todo se comprueba antes de escribir nada. Un rename a medias es peor que
  -- no empezar: quedarían cuatro referencias nuevas y tres viejas.
  foreach v_par slice 1 in array v_cambios loop
    select count(*) into n from products
     where company_id = v_empresa and deleted_at is null and sku = v_par[1];
    if n <> 1 then v_falta := v_falta || format(' origen %s=%s;', v_par[1], n); end if;
    select count(*) into n from products
     where company_id = v_empresa and deleted_at is null and sku = v_par[2];
    if n <> 0 then v_falta := v_falta || format(' destino %s YA EXISTE;', v_par[2]); end if;
  end loop;
  if v_falta <> '' then
    raise exception 'fase45b: no se toca nada.%', v_falta;
  end if;

  foreach v_par slice 1 in array v_cambios loop
    update products set sku = v_par[2], updated_at = now()
     where company_id = v_empresa and deleted_at is null and sku = v_par[1];
  end loop;
end $$;

-- Y dos modelos sucios de FIAM. Acá el SKU estaba BIEN; lo que estaba mal era
-- el campo modelo, que se quedó con el prefijo viejo adentro:
--   sku `FI.E8MCC5A-650`   modelo «FM.E8MCC5A-650»
-- Al limpiarlo los dos pasan a cumplir la regla sin tocar la referencia.
update products
   set model_code = regexp_replace(model_code, '^FM\.', ''), updated_at = now()
 where company_id = (select id from companies where slug = 'buscatools')
   and deleted_at is null
   and sku in ('FI.E8MCC5A-650', 'FI.REP.BC12_ST')
   and model_code like 'FM.%';


-- ── RESULTADO ────────────────────────────────────────────────────────────
--
--   cumplen la regla         13.390 → 17.220
--   sin modelo real (PRO)                586   esperan dato
--   sin marca cargada                  3.983   no se puede derivar
--   todavía no coinciden                  28
--
-- De esos 28: 23 son TOHNICHI que difieren SÓLO en mayúsculas —`TC.TiQL`,
-- `TC.Fcon-B`, `TC.CLE400Fx27D`—, y ocho de ésos ni siquiera son modelos sino
-- títulos de sección de una lista de precios, con espacios adentro
-- (`TC.Setting box`, `TC.Accessories for DOTE4-MD2`). Dos son INGERSOLL RAND
-- con el código en el campo modelo. Y tres son los duplicados de arriba.
