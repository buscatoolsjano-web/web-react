-- ════════════════════════════════════════════════════════════════════════
-- Fase 19 · E4 — Serie piloto de PEDIDO: `PDV-ERP`
--
--   ⚠  PROPUESTA. NO APLICADA. Necesita autorización explícita.
--
-- Es el equivalente exacto de lo que se aplicó para `COT-ERP` en E3: dos
-- filas, ninguna que toque lo que ya existe.
--
--   1 · `document_sequences`                     → la serie y su contador
--   2 · `document_numbering_authority_series`    → esa serie la numera el ERP
--
-- Lo que NO hace:
--   · no toca la autoridad general de `sales_order`, que sigue en STEL;
--   · no toca `PDV` ni su contador (1321);
--   · no la deja por defecto (`is_default = false`), así que un pedido que no
--     pide serie sigue saliendo en PDV;
--   · no crea ningún pedido;
--   · no toca stock, remitos ni STEL.
--
-- Por qué importa acá el `is_default = false`: la autoridad general de
-- `sales_order` está en STEL por el ROLLBACK de la Fase 14 —«PDV01320 quedó
-- duplicado entre los dos sistemas»—. Una serie aparte, con su propio
-- contador y su propio prefijo, es justamente lo que hace imposible repetir
-- esa colisión: `PDV-ERP00001` no puede chocar con ningún número de STEL.
-- ════════════════════════════════════════════════════════════════════════

do $$
declare
  v_empresa      constant uuid := 'bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c';  -- Buscatools
  v_pdv_antes    int;
  v_gen_antes    text;
  v_series_antes int;
  v_pedidos      int;
  v_remitos      int;
  v_stock        int;
  v_reservas     int;
begin
  -- ── Antes: se fotografía todo lo que NO debe cambiar ──────────────────
  select next_number into v_pdv_antes from document_sequences
   where company_id = v_empresa and doc_type = 'sales_order' and series_code = 'PDV';
  select authority into v_gen_antes from document_numbering_authority
   where company_id = v_empresa and doc_type = 'sales_order';
  select count(*) into v_series_antes from document_numbering_authority_series
   where company_id = v_empresa;
  select count(*) into v_pedidos from sales_orders where company_id = v_empresa;
  select count(*) into v_remitos from deliveries where company_id = v_empresa;
  select count(*) into v_stock   from stock_movements where company_id = v_empresa;
  select count(*) into v_reservas from stock_reservations where company_id = v_empresa;

  -- ── Invariantes de entrada ────────────────────────────────────────────
  if v_pdv_antes is null then
    raise exception 'PDV no existe: la foto de entrada no cuadra';
  end if;
  if v_gen_antes is distinct from 'STEL' then
    raise exception 'la autoridad general de sales_order no es STEL (es %)', v_gen_antes;
  end if;
  if exists (select 1 from document_sequences
              where company_id = v_empresa and doc_type = 'sales_order' and series_code = 'PDV-ERP') then
    raise exception 'PDV-ERP ya existe: nada que hacer';
  end if;
  if (select count(*) from document_sequences
       where company_id = v_empresa and doc_type = 'sales_order' and is_default) <> 1 then
    raise exception 'sales_order no tiene exactamente una serie por defecto';
  end if;

  -- ── Las dos filas ─────────────────────────────────────────────────────
  insert into document_sequences (company_id, doc_type, series_code, prefix, padding, next_number, is_default)
  values (v_empresa, 'sales_order', 'PDV-ERP', 'PDV-ERP', 5, 1, false);

  insert into document_numbering_authority_series (company_id, doc_type, series_code, authority, reason)
  values (v_empresa, 'sales_order', 'PDV-ERP', 'ERP',
          'Serie piloto de la Fase 19 E4: habilita emitir pedidos desde el ERP SOLO en esta serie. '
          'La autoridad general de sales_order sigue en STEL y PDV no se toca.');

  -- ── Invariantes de salida ─────────────────────────────────────────────
  if (select next_number from document_sequences
       where company_id = v_empresa and doc_type = 'sales_order' and series_code = 'PDV') <> v_pdv_antes then
    raise exception 'se movió el contador de PDV';
  end if;
  if (select authority from document_numbering_authority
       where company_id = v_empresa and doc_type = 'sales_order') is distinct from 'STEL' then
    raise exception 'cambió la autoridad general de sales_order';
  end if;
  if (select count(*) from document_numbering_authority_series where company_id = v_empresa) <> v_series_antes + 1 then
    raise exception 'la cantidad de filas por serie no es la esperada';
  end if;
  if (select is_default from document_sequences
       where company_id = v_empresa and doc_type = 'sales_order' and series_code = 'PDV-ERP') then
    raise exception 'PDV-ERP quedó como serie por defecto';
  end if;
  if (select count(*) from sales_orders where company_id = v_empresa) <> v_pedidos then
    raise exception 'cambió la cantidad de pedidos';
  end if;
  if (select count(*) from deliveries where company_id = v_empresa) <> v_remitos then
    raise exception 'cambió la cantidad de remitos';
  end if;
  if (select count(*) from stock_movements where company_id = v_empresa) <> v_stock then
    raise exception 'se movió stock';
  end if;
  if (select count(*) from stock_reservations where company_id = v_empresa) <> v_reservas then
    raise exception 'cambiaron las reservas';
  end if;

  raise notice 'PDV-ERP creada. PDV sigue en %, autoridad general %, pedidos %, stock %',
    v_pdv_antes, v_gen_antes, v_pedidos, v_stock;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK (si hiciera falta deshacerlo, y ANTES de emitir nada con la serie)
--
--   delete from document_numbering_authority_series
--    where company_id = 'bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c'
--      and doc_type = 'sales_order' and series_code = 'PDV-ERP';
--   delete from document_sequences
--    where company_id = 'bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c'
--      and doc_type = 'sales_order' and series_code = 'PDV-ERP'
--      and next_number = 1;   -- ← si ya numeró algo, NO se borra: hay un documento.
--
-- Después de emitir un pedido en la serie, el rollback deja de ser borrar la
-- serie: hay que decidir qué hacer con ese documento, como con COT-ERP00001.
-- ════════════════════════════════════════════════════════════════════════
