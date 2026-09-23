/**
 * Fase 22 · Duplicados — genera el SQL preparado a partir del análisis.
 *
 * La whitelist de la migración se escribe desde el MISMO JSON que produjo el
 * CSV que revisa Juan. Escribirla a mano sería la forma más fácil de que la
 * lista aprobada y la lista aplicada no sean la misma, y eso en una migración
 * que cambia el status de productos no se arregla después.
 *
 * No ejecuta nada: escribe un archivo .sql.
 *
 *   node scripts/fase22-g-generar-sql.mjs <analisis.json> <salida.sql>
 */
import { readFileSync, writeFileSync } from 'node:fs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Nada entra al SQL sin ser un UUID. No hay interpolación de texto libre. */
export function uuid(v) {
  const s = String(v ?? '')
  if (!UUID.test(s)) throw new Error(`no es un uuid: ${s}`)
  return s
}

/** Un comentario SQL no puede llevar saltos ni cerrar la línea. */
export function comentario(v) {
  return String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, 120)
}

export function paresDe(analisis) {
  const safe = analisis.filas.filter((f) => f.recommended_action === 'SAFE_TO_MERGE')
  const pares = safe.map((f) => ({
    duplicado: uuid(f.duplicate_product_id),
    canonico: uuid(f.canonical_product_id),
    etiqueta: comentario(`${f.duplicate_sku} -> ${f.canonical_sku}`),
  }))

  // Invariantes de la lista, antes de escribirla.
  const dups = new Set(pares.map((p) => p.duplicado))
  const canons = new Set(pares.map((p) => p.canonico))
  if (dups.size !== pares.length) throw new Error('hay un duplicado repetido en la lista')
  if (pares.some((p) => p.duplicado === p.canonico)) throw new Error('un producto es su propio canónico')
  if (pares.some((p) => canons.has(p.duplicado))) {
    // Si un duplicado fuera además canónico de otro, retirarlo dejaría a ese
    // otro apuntando a un producto retirado: una cadena, no un reemplazo.
    throw new Error('hay una cadena: un duplicado es canónico de otro')
  }
  return pares
}

export function generar(analisis) {
  const pares = paresDe(analisis)
  const valores = pares.map((p) => `    ('${p.duplicado}', '${p.canonico}')  -- ${p.etiqueta}`).join(',\n')

  return `-- Fase 22 · Duplicados — SQL PREPARADO. **No ejecutado.**
--
-- Generado por scripts/fase22-g-generar-sql.mjs desde el análisis de los 92
-- candidatos. La whitelist de abajo son los ${pares.length} pares clasificados
-- SAFE_TO_MERGE en docs/fase22-g-duplicados-candidatos.csv, con sus UUID.
--
-- Qué hace y qué NO hace
-- ---------------------
-- Marca ${pares.length} productos como \`merged\` y registra a qué canónico fueron
-- absorbidos. No borra nada, no reescribe ninguna FK histórica, no toca
-- stock, no toca precios, no crea recíprocas.
--
-- La lista es EXPLÍCITA. La migración no vuelve a calcular candidatos: si se
-- recalcularan durante la migración, lo aprobado y lo aplicado podrían no ser
-- lo mismo.
--
-- Orden de ejecución: A, B, C, D, E, F. G es la vuelta atrás.

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- A. \`merged\` como estado posible de un producto
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Un producto \`merged\` existió de verdad, puede tener historia, no se borra,
-- no es el registro que hay que usar hacia adelante, y tiene un canónico que
-- lo reemplaza. Es distinto de \`discontinued\` —ese se dejó de vender pero
-- sigue siendo él mismo— y de \`deleted_at\`, que es borrado.
alter table public.products
  drop constraint products_status_check;

alter table public.products
  add constraint products_status_check
  check (status = any (array['active', 'discontinued', 'draft', 'merged']));

-- ═══════════════════════════════════════════════════════════════════════════
-- B. \`duplicate\` como tipo de relación
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Se reutiliza \`product_equivalences\` porque la forma es la misma: un
-- producto apunta a otro. Pero el significado NO es el mismo, y el nombre del
-- \`source_kind\` es lo único que los separa: los \`sim_*\` son equivalencias
-- comerciales —«en vez de esta, andá con esta otra»— y \`duplicate\` es
-- identidad: «esta ficha y aquélla son el mismo producto».
alter table public.product_equivalences
  drop constraint product_equivalences_kind_chk;

alter table public.product_equivalences
  add constraint product_equivalences_kind_chk
  check (source_kind = any (array['sim_sp', 'sim_tc', 'sim_cp', 'sim_ir', 'manual', 'duplicate']));

-- ═══════════════════════════════════════════════════════════════════════════
-- C. \`en_catalogo\`: una sola definición de qué se ve en el Catálogo
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Hoy la condición está escrita dentro de \`search_products\` y de
-- \`catalog_facets\`, repetida. Dos copias de una regla son dos reglas que van
-- a divergir: alcanza con que alguien arregle una.
--
-- Sobre el null de marca: un producto sin marca NO tiene quién lo oculte, así
-- que se ve. Escribirlo como \`b.is_active\` a secas lo escondería, porque el
-- LEFT JOIN da null y null no es true.
create or replace function public.en_catalogo(p public.products)
returns boolean
language sql
stable
set search_path to 'public', 'pg_temp'
as $fn$
  select p.deleted_at is null
     and p.status not in ('discontinued', 'merged')
     and (p.brand_id is null
          or exists (select 1 from brands b where b.id = p.brand_id and b.is_active));
$fn$;

comment on function public.en_catalogo(public.products) is
  'Fase 22: única definición de visibilidad en el Catálogo. La usan search_products, catalog_facets y productos_similares.';

-- Las tres funciones pasan a usarla. (Los cuerpos completos se reemplazan en
-- la migración real; acá queda anotado cuál es el cambio en cada una.)
--
--   search_products      AND (NOT p_solo_catalogo OR public.en_catalogo(p))
--   catalog_facets       ídem
--   productos_similares  los candidatos deben cumplir public.en_catalogo(q),
--                        en lugar del filtro suelto de marca activa. Eso saca
--                        de similares a los merged y a los discontinued.
--
-- Y en productos_similares, además (§3): las relaciones con
-- source_kind = 'duplicate' NO son equivalencias comerciales y quedan
-- excluidas de \`curadas_directas\` y \`curadas_inversas\`:
--
--   where e.source_kind <> 'duplicate'
--
-- Un duplicado no es una alternativa: es el mismo producto.

-- ═══════════════════════════════════════════════════════════════════════════
-- D. Los ${pares.length} productos que se retiran — lista explícita
-- ═══════════════════════════════════════════════════════════════════════════
create temporary table _merge_whitelist (
  duplicate_id uuid primary key,
  canonical_id uuid not null,
  check (duplicate_id <> canonical_id)
) on commit drop;

insert into _merge_whitelist (duplicate_id, canonical_id) values
${valores};

-- Nada de esto puede fallar en silencio.
do $$
declare
  n integer;
begin
  select count(*) into n from _merge_whitelist;
  if n <> ${pares.length} then
    raise exception 'la whitelist tiene % filas, se esperaban ${pares.length}', n;
  end if;

  -- Los dos lados tienen que existir y no estar borrados.
  select count(*) into n
    from _merge_whitelist w
   where not exists (select 1 from products p where p.id = w.duplicate_id and p.deleted_at is null)
      or not exists (select 1 from products p where p.id = w.canonical_id and p.deleted_at is null);
  if n > 0 then raise exception '% par(es) apuntan a un producto inexistente o borrado', n; end if;

  -- El canónico tiene que seguir activo: si dejó de estarlo desde el análisis,
  -- retirar el duplicado dejaría a los dos fuera.
  select count(*) into n
    from _merge_whitelist w join products p on p.id = w.canonical_id
   where p.status <> 'active';
  if n > 0 then raise exception '% canónico(s) ya no están activos', n; end if;

  -- Ningún duplicado puede tener saldo de stock. En el análisis eran 0; si
  -- alguno movió stock desde entonces, se frena todo.
  select count(*) into n
    from _merge_whitelist w join stock_balances s on s.product_id = w.duplicate_id
   where s.on_hand <> 0 or s.reserved <> 0;
  if n > 0 then raise exception '% duplicado(s) tienen saldo de stock: revisar antes de retirar', n; end if;
end $$;

-- El UPDATE. Idempotente: correrlo dos veces no cambia nada la segunda.
update public.products p
   set status = 'merged'
  from _merge_whitelist w
 where p.id = w.duplicate_id
   and p.status <> 'merged';

-- ═══════════════════════════════════════════════════════════════════════════
-- E. La evidencia: duplicado → canónico
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DIRECCIONAL, y en este sentido. El canónico no está fusionado con el viejo:
-- el viejo fue absorbido por el canónico. La recíproca sería falsa.
insert into public.product_equivalences
       (company_id, product_id, equivalent_product_id, source, source_kind)
select p.company_id, w.duplicate_id, w.canonical_id, 'manual', 'duplicate'
  from _merge_whitelist w
  join products p on p.id = w.duplicate_id
on conflict (product_id, equivalent_product_id, source_kind) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- F. Invariantes — si alguna falla, la transacción no se confirma
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  n integer;
begin
  select count(*) into n from products p
    join _merge_whitelist w on w.duplicate_id = p.id
   where p.status <> 'merged';
  if n <> 0 then raise exception '% duplicado(s) no quedaron merged', n; end if;

  select count(*) into n from _merge_whitelist w
   where not exists (select 1 from product_equivalences e
                      where e.product_id = w.duplicate_id
                        and e.equivalent_product_id = w.canonical_id
                        and e.source_kind = 'duplicate');
  if n <> 0 then raise exception '% par(es) sin evidencia registrada', n; end if;

  -- Ninguna recíproca.
  select count(*) into n from product_equivalences e
    join _merge_whitelist w on w.duplicate_id = e.equivalent_product_id
                           and w.canonical_id = e.product_id
   where e.source_kind = 'duplicate';
  if n <> 0 then raise exception 'se crearon % recíproca(s)', n; end if;

  -- Los canónicos siguen visibles si su marca lo permite.
  select count(*) into n from products p
    join _merge_whitelist w on w.canonical_id = p.id
   where p.status <> 'active';
  if n <> 0 then raise exception '% canónico(s) dejaron de estar activos', n; end if;

  -- Ningún merged en el catálogo.
  select count(*) into n from products p
    join _merge_whitelist w on w.duplicate_id = p.id
   where public.en_catalogo(p);
  if n <> 0 then raise exception '% merged siguen en el catálogo', n; end if;

  -- La historia sigue completa: ninguna línea perdió su snapshot.
  select count(*) into n from (
    select 1 from sales_quote_lines l join _merge_whitelist w on w.duplicate_id = l.product_id
      where coalesce(btrim(l.sku_snapshot),'') = '' or coalesce(btrim(l.name_snapshot),'') = ''
    union all
    select 1 from sales_order_lines l join _merge_whitelist w on w.duplicate_id = l.product_id
      where coalesce(btrim(l.sku_snapshot),'') = '' or coalesce(btrim(l.name_snapshot),'') = ''
    union all
    select 1 from delivery_lines l join _merge_whitelist w on w.duplicate_id = l.product_id
      where coalesce(btrim(l.sku_snapshot),'') = '' or coalesce(btrim(l.name_snapshot),'') = ''
  ) s;
  if n <> 0 then raise exception '% línea(s) históricas sin snapshot completo', n; end if;

  -- El stock no se tocó.
  select count(*) into n from stock_balances s
    join _merge_whitelist w on w.duplicate_id = s.product_id
   where s.on_hand <> 0 or s.reserved <> 0;
  if n <> 0 then raise exception 'el stock cambió en % fila(s)', n; end if;
end $$;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- G. Vuelta atrás
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Se deshace con la MISMA lista, no con \`where status = 'merged'\`: si más
-- adelante hay otros productos merged, ese where los revertiría también.
--
-- begin;
--   create temporary table _rollback (duplicate_id uuid primary key) on commit drop;
--   insert into _rollback values ${pares.length > 0 ? `('${pares[0].duplicado}')` : '(...)'}, ... ;  -- los mismos ${pares.length} ids
--
--   delete from public.product_equivalences e
--    using _rollback r
--    where e.product_id = r.duplicate_id
--      and e.source_kind = 'duplicate';
--
--   update public.products p
--      set status = 'active'
--     from _rollback r
--    where p.id = r.duplicate_id and p.status = 'merged';
-- commit;
--
-- Los CHECK de A y B no hace falta revertirlos: admitir un valor más no
-- rompe nada, y volver a angostarlos fallaría si quedara alguna fila con el
-- valor nuevo. Si aun así se quisiera, hay que correr el DELETE y el UPDATE
-- primero.
`
}

const esteArchivo = import.meta.url.replace(/^file:\/\/\/?/, '').replace(/\\/g, '/').toLowerCase()
const invocado = String(process.argv[1] ?? '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
if (invocado && esteArchivo.endsWith(invocado)) {
  const [entrada, salida] = process.argv.slice(2)
  if (!entrada || !salida) throw new Error('uso: fase22-g-generar-sql.mjs <analisis.json> <salida.sql>')
  const sql = generar(JSON.parse(readFileSync(entrada, 'utf8')))
  writeFileSync(salida, sql)
  console.error(`${salida} escrito. NADA ejecutado.`)
}
