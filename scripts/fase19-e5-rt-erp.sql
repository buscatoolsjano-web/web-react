-- ════════════════════════════════════════════════════════════════════════
-- Fase 19 · E5 — Serie piloto de REMITO: `RT-ERP`
--
--   ⚠  PROPUESTA. NO APLICADA. Necesita autorización explícita.
--
-- Son las mismas dos filas que COT-ERP y PDV-ERP. Lo que cambia es lo que
-- viene DESPUÉS: un remito no sólo se numera, se despacha, y despachar mueve
-- stock real. Por eso acá van las filas **y** el cambio de RPC que hace falta
-- para que la serie sirva de algo; sin ese cambio, `RT-ERP` crearía borradores
-- que nadie podría confirmar.
-- ════════════════════════════════════════════════════════════════════════

-- ── PARTE 1 · las dos filas ─────────────────────────────────────────────
do $$
declare
  v_empresa    constant uuid := 'bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c';  -- Buscatools
  v_rt_antes   int;
  v_gen_antes  text;
  v_remitos    int;
  v_stock      int;
  v_reservas   int;
begin
  select next_number into v_rt_antes from document_sequences
   where company_id = v_empresa and doc_type = 'delivery' and series_code = 'RT';
  select authority into v_gen_antes from document_numbering_authority
   where company_id = v_empresa and doc_type = 'delivery';
  select count(*) into v_remitos  from deliveries where company_id = v_empresa;
  select count(*) into v_stock    from stock_movements where company_id = v_empresa;
  select count(*) into v_reservas from stock_reservations where company_id = v_empresa;

  -- Invariantes de entrada
  if v_gen_antes is distinct from 'STEL' then
    raise exception 'la autoridad general de delivery no es STEL (es %)', coalesce(v_gen_antes, '(ninguna)');
  end if;
  if v_rt_antes is distinct from 1434 then
    raise exception 'RT no está en 1434 (está en %)', coalesce(v_rt_antes::text, '(no existe)');
  end if;
  if exists (select 1 from document_sequences
              where company_id = v_empresa and doc_type = 'delivery' and series_code = 'RT-ERP') then
    raise exception 'RT-ERP ya existe';
  end if;
  if (select count(*) from document_sequences
       where company_id = v_empresa and doc_type = 'delivery' and is_default) <> 1 then
    raise exception 'delivery no tiene exactamente una serie por defecto';
  end if;
  if v_remitos <> 193 or v_stock <> 381 or v_reservas <> 0 then
    raise exception 'la foto de entrada no cuadra: % remitos, % movimientos, % reservas',
      v_remitos, v_stock, v_reservas;
  end if;

  -- `padding` 5 y no 10: RT usa 10 por herencia de STEL (`RT0000001433`), pero
  -- la serie nueva no arrastra ese formato. `RT-ERP00001` se lee mejor y es el
  -- mismo criterio que COT-ERP y PDV-ERP.
  insert into document_sequences (company_id, doc_type, series_code, prefix, padding, next_number, is_default)
  values (v_empresa, 'delivery', 'RT-ERP', 'RT-ERP', 5, 1, false);

  insert into document_numbering_authority_series (company_id, doc_type, series_code, authority, reason)
  values (v_empresa, 'delivery', 'RT-ERP', 'ERP',
          'Serie piloto de la Fase 19 E5: habilita emitir remitos desde el ERP SOLO en esta serie. '
          'La autoridad general de delivery sigue en STEL; RT y RT-ML no se tocan.');

  -- Invariantes de salida
  if app.autoridad_efectiva(v_empresa, 'delivery', 'RT-ERP') <> 'ERP' then
    raise exception 'RT-ERP no resuelve ERP';
  end if;
  if app.autoridad_efectiva(v_empresa, 'delivery', 'RT') <> 'STEL'
     or app.autoridad_efectiva(v_empresa, 'delivery', 'RT-ML') <> 'STEL'
     or app.autoridad_efectiva(v_empresa, 'delivery', '') <> 'STEL' then
    raise exception 'se movió la autoridad de los remitos';
  end if;
  if (select next_number from document_sequences
       where company_id = v_empresa and doc_type = 'delivery' and series_code = 'RT') <> 1434 then
    raise exception 'se movió el contador de RT';
  end if;
  if (select count(*) from document_sequences
       where company_id = v_empresa and doc_type = 'delivery' and is_default) <> 1
     or (select is_default from document_sequences
          where company_id = v_empresa and doc_type = 'delivery' and series_code = 'RT-ERP') then
    raise exception 'RT-ERP quedó como serie por defecto';
  end if;
  if (select count(*) from deliveries where company_id = v_empresa) <> v_remitos
     or (select count(*) from stock_movements where company_id = v_empresa) <> v_stock
     or (select count(*) from stock_reservations where company_id = v_empresa) <> v_reservas then
    raise exception 'cambió algo de stock o de remitos';
  end if;

  raise notice 'RT-ERP creada. RT sigue en %, general %, remitos %, stock %',
    v_rt_antes, v_gen_antes, v_remitos, v_stock;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- PARTE 2 · el cambio de RPC, sin el cual la serie no sirve
--
-- Medido en el fixture `zz-e5r`: con la autoridad general en STEL **no se
-- puede crear ni el borrador** (`crear_remito_desde_pedido` llama a
-- `app.exigir_emision_erp(company, 'delivery', serie)` antes de numerar). Y
-- aunque se pudiera, `confirmar_entrega` llama a la versión de DOS argumentos
-- —`app.exigir_emision_erp(company, 'delivery')`—, que mira la autoridad
-- GENERAL y no la de la serie del remito. O sea: harían falta los dos cambios.
-- ════════════════════════════════════════════════════════════════════════

-- 2.a · `crear_remito_desde_pedido`: serie explícita opcional.
--
--   · firma nueva:  (p_order, p_lineas, p_fecha, p_esperado, p_serie text default null)
--     El default deja intactos a los llamadores de hoy —la UI manda cuatro
--     argumentos— y no crea ambigüedad: no hay otra función con ese nombre.
--   · sin serie  → la de por defecto, exactamente como ahora;
--   · con serie  → se resuelve con `company_id` y `doc_type = 'delivery'`
--     FIJADOS en el where, y si no aparece: `SERIE_INVALIDA`;
--   · el número se pide con la serie ya resuelta;
--   · la autoridad se sigue exigiendo ANTES de numerar, con esa misma serie;
--   · `series_code` entra en el diff de auditoría.
--
-- El resto del cuerpo no se toca: el pedido tiene que estar confirmado, el
-- pendiente se valida línea por línea contra `app.pendiente_de_pedido`, el
-- domicilio se congela igual y el remito sigue naciendo en `draft`.
--
--   -- fragmento propuesto, en el lugar donde hoy resuelve la serie:
--   v_serie_pedida := nullif(btrim(coalesce(p_serie, '')), '');
--   if v_serie_pedida is null then
--     select series_code into v_serie from document_sequences
--      where company_id = v_company and doc_type = 'delivery' and is_default;
--     if v_serie is null then raise exception 'SIN_SERIE' using errcode = '42704'; end if;
--   else
--     select series_code into v_serie from document_sequences
--      where company_id = v_company and doc_type = 'delivery'
--        and series_code = v_serie_pedida;
--     if v_serie is null then
--       raise exception 'SERIE_INVALIDA' using errcode = '42501', detail = v_serie_pedida;
--     end if;
--   end if;
--   perform app.exigir_emision_erp(v_company, 'delivery', v_serie);
--   v_numero := next_document_number(v_company, 'delivery', v_serie);

-- 2.b · `confirmar_entrega`: mirar la serie DEL REMITO, no la general.
--
--   hoy:       perform app.exigir_emision_erp(v_company, 'delivery');
--   propuesto: perform app.exigir_emision_erp(v_company, 'delivery', v_serie);
--              -- con v_serie leída del propio remito en el mismo `select ... for update`
--
-- Es el mismo criterio que ya se aplicó en la cotización y en el pedido: lo
-- que gobierna un documento es la autoridad de SU serie. Un remito de RT
-- seguiría bloqueado; uno de RT-ERP se podría despachar.
--
-- ⚠ Este cambio es el que habilita MOVER STOCK. No se aplica junto con la
--   Parte 1 salvo autorización explícita y separada.

-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK de la Parte 1 (antes de emitir nada con la serie)
--
--   delete from document_numbering_authority_series
--    where company_id = 'bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c'
--      and doc_type = 'delivery' and series_code = 'RT-ERP';
--   delete from document_sequences
--    where company_id = 'bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c'
--      and doc_type = 'delivery' and series_code = 'RT-ERP'
--      and next_number = 1;   -- si ya numeró, NO se borra: hay un documento.
--
-- Un remito despachado NO tiene rollback de stock en este sistema: el trigger
-- `proteger_borrado_entrega` lo impide («ya movió stock: borrarlo no devolvería
-- las unidades»). Por eso el STOP antes de confirmar es duro.
-- ════════════════════════════════════════════════════════════════════════
