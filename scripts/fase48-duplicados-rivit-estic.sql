-- Fase 48 · Los tres «duplicados» eran tres cosas distintas
--
-- APLICADA el 2026-10-08 (`fase48_duplicados_rivit_y_estic`).
--
-- Son los tres que la Fase 45 no pudo renombrar porque el destino ya existía.
-- Al mirarlos de cerca, ninguno era lo que parecía.
--
--
-- ── 1 · RIVIT: NO ERA UN DUPLICADO ───────────────────────────────────────
--
-- `RI.RIV503` tenía las MORDAZAS («JAWS (x3pz) Cod.1250100 Morsetti / Muelas»)
-- y la REMACHADORA había quedado exiliada en `RV.RIV503`.
--
-- Se ve mirando la familia: `RI.RIV504` y `RI.RIV506` son remachadoras, así
-- que `RI.RIV<n>` son las máquinas. La anomalía no era el prefijo `RV`: era
-- que el repuesto ocupaba el lugar de la máquina.
--
-- Las mordazas tienen código propio —1250100, escrito en su nombre Y en su
-- descripción— y `RIV503` es la máquina a la que entran, no su modelo. Tener
-- el modelo del padre es exactamente lo que las puso en su lugar.
--
-- No se fusiona ni se borra nada: son dos renombres, y el orden importa porque
-- hay que liberar `RI.RIV503` antes de ocuparlo. La máquina tiene 18 de stock
-- y una cotización.

do $$
declare
  v_empresa uuid := (select id from companies where slug = 'buscatools');
  n int;
begin
  -- Todo se comprueba antes de escribir nada.
  select count(*) into n from products
   where company_id = v_empresa and deleted_at is null and sku = 'RI.1250100';
  if n <> 0 then raise exception 'fase48: RI.1250100 ya existe'; end if;

  select count(*) into n from products
   where company_id = v_empresa and deleted_at is null and sku in ('RI.RIV503', 'RV.RIV503');
  if n <> 2 then raise exception 'fase48: esperaba las dos filas de RIV503 y hay %', n; end if;

  -- a) las mordazas, a su propio código
  update products
     set sku = 'RI.1250100', model_code = '1250100', updated_at = now()
   where company_id = v_empresa and deleted_at is null and sku = 'RI.RIV503';

  -- b) la máquina, a la familia que le corresponde
  update products
     set sku = 'RI.RIV503', updated_at = now()
   where company_id = v_empresa and deleted_at is null and sku = 'RV.RIV503';
end $$;


-- ── 2 · ESTIC EH2-R1016-S: UN FANTASMA DEL LEGACY ────────────────────────
--
-- Dos filas del mismo atornillador:
--
--   ES.EH2-R1016-S   sin id de STEL, 0 documentos, precio    478,38
--   ET.EH2-R1016-S   STEL 44699755,  1 cotización, precio  8.313,00
--
-- La familia EH2-R está entre 9.335 y 10.500 USD, así que el precio de la
-- primera está ~17 veces por debajo del real. Esa fila vino de la migración
-- del legacy (9 de septiembre) y nunca se vinculó con STEL.
--
-- Baja lógica. No va a volver: no tiene id de STEL y nada la recrea. No tiene
-- documentos, así que no rompe ningún histórico. Y saca del catálogo un precio
-- con el que se podría haber vendido a 478 algo que cuesta 8.313.
--
-- NO se le copia la descripción técnica a la que queda, aunque la suya es
-- mucho mejor («TORQUE MIN 3.2 / MAX 16 Nm, RPM 1871, junta rígida, pulso
-- eléctrico sin reacción» contra «STRAIGHT TOOL 16NM»).
--
-- El sync de STEL pisa `name`, `description`, `status` y `product_type` en
-- cada corrida —se comprueba con `app.stel_campos('products','sync')`— así que
-- copiarla sería trabajo que se deshace solo esa misma noche. Esa descripción
-- hay que arreglarla EN STEL.

update products set deleted_at = now(), updated_at = now()
 where company_id = (select id from companies where slug = 'buscatools')
   and deleted_at is null
   and sku = 'ES.EH2-R1016-S'
   and external_id is null;

do $$
declare n int;
begin
  select count(*) into n from products
   where company_id = (select id from companies where slug = 'buscatools')
     and deleted_at is null and sku in ('ES.EH2-R1016-S', 'RV.RIV503');
  if n <> 0 then raise exception 'fase48: quedaron % filas que debian irse', n; end if;
end $$;


-- ── 3 · LO QUE NO SE TOCA, Y POR QUÉ ─────────────────────────────────────
--
-- `ET.EH2-CVS05-SS` (cable de 5 m) sigue duplicando a `ES.EH2-CVS05-SS`, y las
-- DOS tienen id de STEL: 44699746 y 20282866. El duplicado está DENTRO de
-- STEL, no acá. Si se retira la fila de STEL vuelve en el próximo sync: el
-- planificador no encontraría producto para esa referencia y la recrearía.
-- Mismo caso que `SP.2007VPM/80`: se resuelve allá.
--
-- Y las dos `ET.*` que quedan no se pueden renombrar a `ES.*`:
--
--   · `ET.EH2-R1016-S`: su destino lo ocupa la fila recién retirada, y el
--     índice único es `(company_id, sku)` SIN excluir las dadas de baja.
--   · `ET.EH2-CVS05-SS`: su destino lo ocupa la otra fila, que está viva.
--
-- El prefijo `ET` viene del `full-reference` de STEL, así que también es algo
-- a corregir allá. El sync NO pisa el `sku` —no está en
-- `app.stel_campos('products','sync')`— así que si en STEL se corrige, acá hay
-- que renombrarlo a mano.
--
--
-- ── Y ALGO MÁS GRANDE QUE APARECIÓ MIRANDO ESTO ──────────────────────────
--
-- 7 de los 33 productos ESTIC EH2-R tienen precio por debajo de 2.000 USD
-- cuando la MEDIANA de la familia es 14.730:
--
--   ES.EH2-R3200-S      90      ES.EH2-R2080-A-PP   446
--   ES.EH2-R1016-S     478      ES.EH2-R2180-A-PP   601
--   PRO04858         1.386      ES.EH2-R3270-A-PP 1.400
--   ES.EH2-R1030-A-PP 1.495
--
-- Ninguno tiene renglones todavía, así que no se vendió nada a ese precio.
-- Esta migración retira uno de los siete por ser duplicado; los otros seis
-- siguen en el catálogo y NO se tocan: cuál es el precio correcto es dato del
-- proveedor, no algo que se pueda deducir de acá.
--
--
-- ── RESULTADO ────────────────────────────────────────────────────────────
--
--   no coinciden con la regla   3 → 2   (las dos ET., que vienen de STEL)
