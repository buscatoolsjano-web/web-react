-- =====================================================================
-- Fase 19 · E3B — CUIT del sistema anterior como evidencia de migración
--
--   *** PREPARADO, NO EJECUTADO. Requiere aprobación explícita. ***
--
-- Qué hace: agrega una columna aditiva a `customers` y escribe en ella el
-- CUIT que el sistema anterior tenía para 31 clientes, tal cual venía.
--
-- Qué NO hace: no toca `tax_id`, no resuelve ninguna revisión, no cambia
-- `needs_review` ni `review_reason`, no mueve `updated_at`, no genera
-- auditoría, no toca el sistema anterior.
--
-- Fuente: el maestro del sistema anterior, campo `cif`, cruzado por `ref`
-- contra `customers.legacy_ref`. Es la misma fuente y la misma clave que usó
-- `scripts/fase5-migrar-clientes.mjs`. Detalle en
-- docs/PHASE_19_CLIENTES_LEGACY_CUIT_AUDIT.md
-- =====================================================================


-- ── PASO 0 · BASELINE (correr ANTES, guardar la salida) ───────────────
--
-- Los cuatro md5 y el max(updated_at) tienen que ser IDÉNTICOS después.

select 'customers_total'      k, count(*)::text v from customers
union all select 'needs_review',       count(*)::text from customers where needs_review
union all select 'con_tax_id',         count(*)::text from customers where tax_id is not null
union all select 'max_updated_at',     max(updated_at)::text from customers
union all select 'md5_review_reason',  md5(string_agg(coalesce(review_reason,'~'), '|' order by id)) from customers
union all select 'md5_tax_id',         md5(string_agg(coalesce(tax_id,'~'), '|' order by id)) from customers
union all select 'md5_updated_at',     md5(string_agg(updated_at::text, '|' order by id)) from customers
union all select 'sales_audit_total',  count(*)::text from sales_audit
union all select 'sales_quotes',       count(*)::text from sales_quotes
union all select 'sales_orders',       count(*)::text from sales_orders
union all select 'deliveries',         count(*)::text from deliveries;

-- Valores medidos el 20/09/2026, antes de nada:
--   customers_total     1010
--   needs_review          40
--   con_tax_id           565
--   max_updated_at       2026-09-16 00:01:50.325964+00
--   md5_review_reason    661ba49eefdabf55fbf640c4f3a54535
--   md5_tax_id           d47cdbe6a6fad70a30dd71a18a6b2a18
--   md5_updated_at       accded6d2617819116efcf4141be66fc
--   sales_audit_total      2
--   sales_quotes         306   sales_orders 172   deliveries 193


-- ── PASO 1 · LA COLUMNA ──────────────────────────────────────────────
--
-- Nullable, sin default, sin unique, sin FK, sin NOT NULL, sin trigger.
-- `add column` de una columna nullable sin default NO reescribe la tabla y
-- NO dispara ningún trigger de fila: `updated_at` no se mueve.
--
-- El comentario no es decoración: es lo único que impide que dentro de seis
-- meses alguien la copie a `tax_id`.

alter table customers
  add column if not exists legacy_tax_id_raw text;

comment on column customers.legacy_tax_id_raw is
  'EVIDENCIA DE MIGRACIÓN. El CUIT que el sistema anterior tenía para este '
  'cliente, exactamente como venía escrito (con guiones o sin ellos, incluso '
  'mal formado). NO es el CUIT vigente: el vigente es tax_id. No valida, no '
  'numera, no identifica y no alimenta documentos. Sólo existe para que la '
  'cola de revisión pueda mostrar qué CUIT estaba repetido y entre qué fichas. '
  'Normalizar para comparar: regexp_replace(legacy_tax_id_raw, ''\D'', '''', ''g'').';


-- ── PASO 2 · CONTROL PREVIO (correr ANTES del update) ────────────────
--
-- Tiene que devolver 31 / 31 / 0 / 0. Si `ya_escritos_distinto` no es 0,
-- NO seguir: alguien escribió otro valor y hay que mirarlo.

with propuesto(id, ref, raw) as (values
    ('3639aa66-f1b0-4f4e-a425-00b7f0de61c3'::uuid, 'CLI00124', '30-70945325-0'),
    ('7eb8b934-fe66-451e-9352-49cd86c32d98'::uuid, 'CLI00127', '30-50215968-9'),
    ('7905d260-b36f-4015-ae80-6e88c9f52f81'::uuid, 'CLI00153', '20-21669342-7'),
    ('135874bb-ef45-4b2d-ac5b-9e20c51ad790'::uuid, 'CLI00166', '33-70731251-9'),
    ('d38d266d-a900-4711-ba40-21f4fe5e36f0'::uuid, 'CLI00200', '30-64261755-5'),
    ('1731a1a1-e544-40d2-b7f4-3976e6970937'::uuid, 'CLI00222', '30708603879'),
    ('85f33430-cfe1-49da-a964-0185f704d634'::uuid, 'CLI00224', '30-70945325-0'),
    ('10c7b5d5-4cb7-40fd-8da0-55398442d44a'::uuid, 'CLI00243', '30-52913594-3'),
    ('ed8652a7-1aa3-41ea-8baf-c1f3ce4b95c1'::uuid, 'CLI00244', '30-71187148-5'),
    ('b8eea9ac-6933-474a-92be-fe7a8b2fc3e3'::uuid, 'CLI00270', '30711871485'),
    ('bfe8cd82-60e0-4c55-8fd9-85c3e1e2813c'::uuid, 'CLI00282', '30-66916066-2'),
    ('c4888b1d-c68a-4a90-b046-fcb993742fa5'::uuid, 'CLI00298', '30502680478'),
    ('d14c34f0-ebc2-44d8-ab9c-18063370912f'::uuid, 'CLI00307', '30-50215968-9'),
    ('09c4b993-45ac-413c-9fde-031bb0ce42d9'::uuid, 'CLI00336', '2024652303-8'),
    ('7c9904cf-4feb-42cb-b4d5-5a76f80e5cb7'::uuid, 'CLI00340', '20-24652303-8'),
    ('7b8411ad-b442-4233-b1b5-3a1dac27cf96'::uuid, 'CLI00341', '30606552390'),
    ('0a6334f0-6b00-4966-9da0-9324e7faaca6'::uuid, 'CLI00527', '30-50268047-8'),
    ('da9eebce-5af5-403f-8fac-2ff6c6970284'::uuid, 'CLI00556', '33-70731251-9'),
    ('4b366975-ccd0-4b6c-b6dd-fb262ba0e23d'::uuid, 'CLI00605', '20216693427'),
    ('1329055d-2458-462d-ae9e-d106a5f87404'::uuid, 'CLI00728', '33-71159029-9'),
    ('af4b824d-cb50-4db7-aa4b-f11b59b06bcc'::uuid, 'CLI00810', '20-27089205-2'),
    ('caecf5dc-e837-4b1a-9220-976728f86d63'::uuid, 'CLI00824', '30-64261755-5'),
    ('6edee18c-3cb1-4945-83f3-023a52aab6eb'::uuid, 'CLI00834', '20-27089205-2'),
    ('80111092-05df-4e24-82b5-fd4e193370c8'::uuid, 'CLI00837', '30-60655239-0'),
    ('8b6cfc0f-262c-4a09-981f-be772006c3e8'::uuid, 'CLI01072', '33-71159029-9'),
    ('b53776df-4ec2-48e3-9c71-b893b1399042'::uuid, 'CLI01073', '30-70860387-9'),
    ('1f35c31b-1b24-4951-8180-57019d3fbed3'::uuid, 'CLI01077', '30529135943'),
    ('3c6cf45a-69c7-4c03-9e26-0fa7c6570d92'::uuid, 'CLI01097', '30-71750919-2'),
    ('943dc954-03ac-4f5e-afa2-b584c44202ac'::uuid, 'CLI01118', '20-27089205-2'),
    ('19d75809-d97d-4174-a21b-f62d7500d296'::uuid, 'CLI01136', '30669160662'),
    ('e9e8cb17-3a42-462f-b326-5c35e9cf8811'::uuid, 'CLI01193', '30717509192')
)
select
  (select count(*) from propuesto)                                          as propuestos,
  (select count(*) from propuesto p join customers c on c.id = p.id
     where c.legacy_ref is not distinct from p.ref)                         as coinciden_id_y_ref,
  (select count(*) from propuesto p join customers c on c.id = p.id
     where c.tax_id is not null)                                            as con_cuit_vigente_ojo,
  (select count(*) from propuesto p join customers c on c.id = p.id
     where c.legacy_tax_id_raw is not null
       and c.legacy_tax_id_raw is distinct from p.raw)                      as ya_escritos_distinto;


-- ── PASO 3 · EL BACKFILL ─────────────────────────────────────────────
--
-- `session_replication_role = replica` apaga los triggers de fila SÓLO EN
-- ESTA SESIÓN y SÓLO hasta el commit (`set local`). No es `disable trigger`:
-- no es DDL, no toma lock exclusivo y no afecta a nadie más conectado.
-- Sin esto, `trg_customers_touch` movería `updated_at` de los 31.
--
-- Los otros tres triggers de UPDATE son inocuos igual (ver la auditoría),
-- pero apagarlos todos deja el efecto en exactamente una columna.
--
-- Idempotente por `legacy_tax_id_raw is null`: volver a correrlo escribe 0.

begin;

set local session_replication_role = replica;

update customers c
   set legacy_tax_id_raw = p.raw
  from (values
    ('3639aa66-f1b0-4f4e-a425-00b7f0de61c3'::uuid, '30-70945325-0'),
    ('7eb8b934-fe66-451e-9352-49cd86c32d98'::uuid, '30-50215968-9'),
    ('7905d260-b36f-4015-ae80-6e88c9f52f81'::uuid, '20-21669342-7'),
    ('135874bb-ef45-4b2d-ac5b-9e20c51ad790'::uuid, '33-70731251-9'),
    ('d38d266d-a900-4711-ba40-21f4fe5e36f0'::uuid, '30-64261755-5'),
    ('1731a1a1-e544-40d2-b7f4-3976e6970937'::uuid, '30708603879'),
    ('85f33430-cfe1-49da-a964-0185f704d634'::uuid, '30-70945325-0'),
    ('10c7b5d5-4cb7-40fd-8da0-55398442d44a'::uuid, '30-52913594-3'),
    ('ed8652a7-1aa3-41ea-8baf-c1f3ce4b95c1'::uuid, '30-71187148-5'),
    ('b8eea9ac-6933-474a-92be-fe7a8b2fc3e3'::uuid, '30711871485'),
    ('bfe8cd82-60e0-4c55-8fd9-85c3e1e2813c'::uuid, '30-66916066-2'),
    ('c4888b1d-c68a-4a90-b046-fcb993742fa5'::uuid, '30502680478'),
    ('d14c34f0-ebc2-44d8-ab9c-18063370912f'::uuid, '30-50215968-9'),
    ('09c4b993-45ac-413c-9fde-031bb0ce42d9'::uuid, '2024652303-8'),
    ('7c9904cf-4feb-42cb-b4d5-5a76f80e5cb7'::uuid, '20-24652303-8'),
    ('7b8411ad-b442-4233-b1b5-3a1dac27cf96'::uuid, '30606552390'),
    ('0a6334f0-6b00-4966-9da0-9324e7faaca6'::uuid, '30-50268047-8'),
    ('da9eebce-5af5-403f-8fac-2ff6c6970284'::uuid, '33-70731251-9'),
    ('4b366975-ccd0-4b6c-b6dd-fb262ba0e23d'::uuid, '20216693427'),
    ('1329055d-2458-462d-ae9e-d106a5f87404'::uuid, '33-71159029-9'),
    ('af4b824d-cb50-4db7-aa4b-f11b59b06bcc'::uuid, '20-27089205-2'),
    ('caecf5dc-e837-4b1a-9220-976728f86d63'::uuid, '30-64261755-5'),
    ('6edee18c-3cb1-4945-83f3-023a52aab6eb'::uuid, '20-27089205-2'),
    ('80111092-05df-4e24-82b5-fd4e193370c8'::uuid, '30-60655239-0'),
    ('8b6cfc0f-262c-4a09-981f-be772006c3e8'::uuid, '33-71159029-9'),
    ('b53776df-4ec2-48e3-9c71-b893b1399042'::uuid, '30-70860387-9'),
    ('1f35c31b-1b24-4951-8180-57019d3fbed3'::uuid, '30529135943'),
    ('3c6cf45a-69c7-4c03-9e26-0fa7c6570d92'::uuid, '30-71750919-2'),
    ('943dc954-03ac-4f5e-afa2-b584c44202ac'::uuid, '20-27089205-2'),
    ('19d75809-d97d-4174-a21b-f62d7500d296'::uuid, '30669160662'),
    ('e9e8cb17-3a42-462f-b326-5c35e9cf8811'::uuid, '30717509192')
  ) as p(id, raw)
 where c.id = p.id
   and c.legacy_tax_id_raw is null;
-- Esperado en la primera corrida: UPDATE 31. En cualquier otra: UPDATE 0.


-- ── PASO 4 · VERIFICACIÓN ANTES DE COMMIT ────────────────────────────
--
-- Correr ESTO con la transacción todavía abierta. Si algo no da, `rollback`.
-- Tiene que dar: escritos 31 · resto_no_nulo 0 · updated_at y motivos con
-- los mismos md5 del PASO 0 · sales_audit igual.

select 'escritos'            k, count(*)::text v from customers where legacy_tax_id_raw is not null
union all select 'de_esos_en_revision', count(*)::text from customers
         where legacy_tax_id_raw is not null and needs_review
union all select 'needs_review',        count(*)::text from customers where needs_review
union all select 'con_tax_id',          count(*)::text from customers where tax_id is not null
union all select 'max_updated_at',      max(updated_at)::text from customers
union all select 'md5_review_reason',   md5(string_agg(coalesce(review_reason,'~'), '|' order by id)) from customers
union all select 'md5_tax_id',          md5(string_agg(coalesce(tax_id,'~'), '|' order by id)) from customers
union all select 'md5_updated_at',      md5(string_agg(updated_at::text, '|' order by id)) from customers
union all select 'sales_audit_total',   count(*)::text from sales_audit;

-- commit;    -- descomentar SÓLO si los md5 coinciden con el PASO 0
-- rollback;  -- si no


-- ── PASO 5 · LOS GRUPOS, YA CON EVIDENCIA (read-only) ────────────────
--
-- Lo que la cola de revisión va a poder mostrar. La comparación se hace
-- sobre el normalizado; el crudo se conserva y se muestra tal cual.

select regexp_replace(legacy_tax_id_raw, '\D', '', 'g') as cuit_normalizado,
       count(*)                                          as fichas,
       string_agg(legacy_ref || ' · ' || legal_name, ' || ' order by legacy_ref) as clientes,
       string_agg(distinct legacy_tax_id_raw, ' / ')      as escrituras_distintas
  from customers
 where legacy_tax_id_raw is not null
 group by 1
 having count(*) > 1
 order by 1;


-- ── ROLLBACK ─────────────────────────────────────────────────────────
--
-- Sólo mientras NADA de la interfaz lea la columna. Si la cola de revisión
-- ya la muestra, primero se revierte la interfaz y recién después esto.
-- Es un `drop column`: se pierde la evidencia y hay que volver a correr el
-- backfill desde el HTML del sistema anterior para recuperarla.
--
-- alter table customers drop column legacy_tax_id_raw;
