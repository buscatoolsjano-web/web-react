-- =============================================================================
-- Fase 14 · Entrega 0 — prefijo de la nota de entrega de proveedor: NEP → NTEP.
--
-- Pedido del negocio (2026-09-15). Prefijos confirmados:
--   proveedor PROV · nota de entrega de proveedor NTEP · cotización COTI ·
--   pedido de venta PDV · nota de entrega RT.
-- Sólo la nota de entrega de proveedor (goods_receipt) difería: NEP.
--
-- Estado previo verificado: 0 recepciones en goods_receipts (ninguna empresa);
-- secuencias goods_receipt de Buscatools y Torquetools en NEP/NEP, next_number 1;
-- ninguna función de la base menciona NEP; único default: goods_receipts.series_code.
--
-- Cambios:
--   1. document_sequences (goods_receipt, NEP) → series_code y prefix NTEP
--      (misma padding 5, mismo next_number: el primer número será NTEP00001);
--   2. goods_receipts.series_code default 'NTEP'.
-- Guarda: aborta si ya existe alguna recepción, para no dejar números de dos series.
-- El frontend deja de mandar series_code al crear la recepción: usa el default.
--
-- Aplicada como migración `fase14_e0_prefijo_ntep`.
--
-- Rollback (sólo mientras no haya recepciones NTEP):
--   update public.document_sequences set series_code = 'NEP', prefix = 'NEP'
--    where doc_type = 'goods_receipt' and series_code = 'NTEP';
--   alter table public.goods_receipts alter column series_code set default 'NEP';
-- =============================================================================

do $$
begin
  if exists (select 1 from public.goods_receipts) then
    raise exception 'ya hay recepciones: el cambio de prefijo necesita un plan de datos';
  end if;
end
$$;

update public.document_sequences
   set series_code = 'NTEP',
       prefix = 'NTEP'
 where doc_type = 'goods_receipt'
   and series_code = 'NEP'
   and prefix = 'NEP';

alter table public.goods_receipts alter column series_code set default 'NTEP';
