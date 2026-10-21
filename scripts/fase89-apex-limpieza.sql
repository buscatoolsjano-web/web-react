-- ─────────────────────────────────────────────────────────────────────────────
-- Fase 89 · Limpieza del catálogo APEX
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Registro de las migraciones de DATOS aplicadas (vía el panel/MCP) sobre el
-- proyecto productivo. El trabajo pesado —alojar las fotos reales en nuestro
-- bucket y prestar la de familia a las faltantes— vive en los `.mjs` de esta
-- misma fase, porque baja y sube archivos y eso no es SQL:
--   · fase89-apex-crawl.mjs            índice de apexbits.com (foto + specs)
--   · fase89-apex-reconciliar.mjs      match contra nuestro catálogo (sólo lee)
--   · fase89-apex-aplicar-imagenes.mjs aloja la foto real en catalogo-publico
--   · fase89-apex-fotos-faltantes.mjs  presta la foto del hermano de familia
--
-- EL PROBLEMA
-- El catálogo APEX (3.887 productos) tenía el modelo con un `*` de basura de
-- importación, y las fotos eran recortes de página de catálogo compartidos por
-- familias enteras, no fotos de producto.
--
-- LA FUENTE
-- apexbits.com (Omega Technologies, distribuidor oficial de APEX): foto real
-- por producto —en mrotools.de— y descripción con specs. Con apexbits.com.ar
-- de respaldo. El slug de cada producto EMPIEZA con el modelo, que es lo que
-- permite el match.

-- ── 1. Backup reversible, en un esquema NO expuesto a PostgREST ──────────────
create schema if not exists fase89;
revoke all on schema fase89 from anon, authenticated;

drop table if exists fase89.products_bak;
create table fase89.products_bak as
  select p.* from public.products p
  join public.brands b on b.id = p.brand_id
  where b.name ilike 'apex';

drop table if exists fase89.product_images_bak;
create table fase89.product_images_bak as
  select i.* from public.product_images i
  join public.products p on p.id = i.product_id
  join public.brands b on b.id = p.brand_id
  where b.name ilike 'apex';

-- ── 2. El `*`: 35 se limpian; 12 son DUPLICADOS del modelo limpio ────────────
-- Los 12 no tenían NINGUNA referencia (ni ventas, ni stock, ni precios): el
-- limpio es el canónico, así que el que tiene `*` se da de baja lógica.
with apex as (
  select p.id, p.company_id, p.sku, p.name, p.model_code
  from public.products p
  join public.brands b on b.id = p.brand_id
  where b.name ilike 'apex' and p.deleted_at is null and p.sku like '%*%'
),
clasificado as (
  select a.*,
    exists (
      select 1 from public.products p2
      where p2.company_id = a.company_id
        and p2.sku = replace(a.sku,'*','')
        and p2.id <> a.id and p2.deleted_at is null
    ) as es_duplicado
  from apex a
),
bajas as (
  update public.products p set deleted_at = now()
  from clasificado c
  where p.id = c.id and c.es_duplicado
  returning p.id
),
limpiezas as (
  update public.products p set
    sku = replace(p.sku,'*',''),
    name = btrim(regexp_replace(replace(p.name,'*',''), '\s+', ' ', 'g')),
    model_code = nullif(replace(coalesce(p.model_code,''),'*',''), '')
  from clasificado c
  where p.id = c.id and not c.es_duplicado
  returning p.id
)
select (select count(*) from bajas) as duplicados_dados_de_baja,
       (select count(*) from limpiezas) as asteriscos_limpiados;

-- ── Rollback (si hiciera falta) ──────────────────────────────────────────────
--   update public.products p set sku=b.sku, name=b.name, model_code=b.model_code,
--     deleted_at=b.deleted_at from fase89.products_bak b where b.id=p.id;
--   -- y restaurar product_images desde fase89.product_images_bak.
