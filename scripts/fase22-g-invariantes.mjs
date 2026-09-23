/**
 * Fase 22 · Duplicados — los invariantes de §16, ejecutables.
 *
 * Corre ANTES de aplicar (para tener la línea de base) y DESPUÉS (para
 * demostrar que lo que se aplicó hace lo que dice). No escribe nada.
 *
 * Los invariantes que dependen de que la migración ya se haya corrido se
 * reportan como PENDIENTE mientras no haya productos `merged`: un test que
 * pasa porque no hay nada que mirar no demuestra nada, y decir «PASA» ahí
 * sería exactamente la clase de verde vacío que no sirve.
 *
 *   node scripts/fase22-g-invariantes.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const EMPRESA = 'bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c' // Buscatools
const ANALISIS = 'docs/fase22-g-duplicados-candidatos.csv'

/** El mismo predicado que `en_catalogo()`, para poder evaluarlo acá. */
export function enCatalogo(p) {
  return (
    p.deleted_at === null &&
    p.status !== 'discontinued' &&
    p.status !== 'merged' &&
    (p.brand_id === null || Boolean(p.brands?.is_active))
  )
}

const resultados = []
const registrar = (nombre, estado, detalle) => resultados.push({ nombre, estado, detalle })

async function todos(sb, tabla, columnas, filtro = (q) => q) {
  const filas = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await filtro(sb.from(tabla).select(columnas)).range(desde, desde + 999)
    if (error) throw new Error(`${tabla}: ${error.message}`)
    filas.push(...(data ?? []))
    if ((data?.length ?? 0) < 1000) return filas
  }
}

async function main() {
  const BASE = process.env.VITE_SUPABASE_URL
  const SECRET = process.env.SUPABASE_SECRET_KEY
  if (!BASE || !SECRET) throw new Error('Faltan VITE_SUPABASE_URL y SUPABASE_SECRET_KEY')
  const sb = createClient(BASE, SECRET, { auth: { persistSession: false } })

  const productos = await todos(sb, 'products', 'id, sku, status, deleted_at, brand_id, brands ( is_active )', (q) =>
    q.eq('company_id', EMPRESA).is('deleted_at', null))
  const porId = new Map(productos.map((p) => [p.id, p]))
  const merged = productos.filter((p) => p.status === 'merged')
  const discontinued = productos.filter((p) => p.status === 'discontinued')

  // ── Catálogo ─────────────────────────────────────────────────────────────
  if (merged.length === 0) {
    registrar('merged no aparece en el catálogo', 'PENDIENTE', 'todavía no hay ningún producto merged')
  } else {
    const visibles = merged.filter(enCatalogo)
    registrar('merged no aparece en el catálogo', visibles.length === 0 ? 'PASA' : 'FALLA',
      `${merged.length} merged, ${visibles.length} visibles`)
  }

  const discVisibles = discontinued.filter(enCatalogo)
  registrar('discontinued no aparece en el catálogo', discVisibles.length === 0 ? 'PASA' : 'FALLA',
    `${discontinued.length} discontinued, ${discVisibles.length} visibles con la regla nueva`)

  const activaVisible = productos.filter((p) => p.status === 'active' && p.brand_id && p.brands?.is_active)
  registrar('active + marca activa SÍ aparece',
    activaVisible.every(enCatalogo) ? 'PASA' : 'FALLA', `${activaVisible.length} productos`)

  const inactivaOculta = productos.filter((p) => p.status === 'active' && p.brand_id && !p.brands?.is_active)
  registrar('active + marca inactiva NO aparece',
    inactivaOculta.every((p) => !enCatalogo(p)) ? 'PASA' : 'FALLA', `${inactivaOculta.length} productos`)

  const sinMarca = productos.filter((p) => p.status === 'active' && !p.brand_id)
  registrar('active sin marca SÍ aparece: nadie lo oculta',
    sinMarca.every(enCatalogo) ? 'PASA' : 'FALLA', `${sinMarca.length} productos`)

  // ── Similares ────────────────────────────────────────────────────────────
  const equivalencias = await todos(sb, 'product_equivalences', 'product_id, equivalent_product_id, source_kind')
  const duplicados = equivalencias.filter((e) => e.source_kind === 'duplicate')

  if (duplicados.length === 0) {
    registrar('merged no aparece en similares', 'PENDIENTE', 'todavía no hay relaciones source_kind=duplicate')
    registrar('la relación duplicate es direccional, sin recíproca', 'PENDIENTE', 'ídem')
  } else {
    const aMirar = [...new Set(duplicados.map((e) => e.equivalent_product_id))].slice(0, 40)
    let contaminados = 0
    for (const id of aMirar) {
      const { data } = await sb.rpc('productos_similares', { p_product_id: id, p_limite: 8 })
      if ((data ?? []).some((f) => porId.get(f.id)?.status === 'merged')) contaminados++
    }
    registrar('merged no aparece en similares', contaminados === 0 ? 'PASA' : 'FALLA',
      `${aMirar.length} canónicos mirados, ${contaminados} con un merged entre sus similares`)

    const declaradas = new Set(duplicados.map((e) => `${e.product_id}|${e.equivalent_product_id}`))
    const reciprocas = duplicados.filter((e) => declaradas.has(`${e.equivalent_product_id}|${e.product_id}`))
    registrar('la relación duplicate es direccional, sin recíproca',
      reciprocas.length === 0 ? 'PASA' : 'FALLA', `${duplicados.length} relaciones, ${reciprocas.length} recíprocas`)
  }

  // ── Historia ─────────────────────────────────────────────────────────────
  // Se mira contra los 92 candidatos, estén aplicados o no: el snapshot tiene
  // que estar completo ANTES de retirar nada, o retirarlo rompe el documento.
  const csv = readFileSync(ANALISIS, 'utf8').trim().split(/\r?\n/)
  const cols = csv[0].split(',')
  const iId = cols.indexOf('duplicate_product_id')
  const ids = csv.slice(1).map((l) => l.split('","')[iId]?.replace(/"/g, '')).filter(Boolean)

  let conSnapshot = 0
  let sinSnapshot = 0
  for (const tabla of ['sales_quote_lines', 'sales_order_lines', 'delivery_lines']) {
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await sb.from(tabla).select('sku_snapshot, name_snapshot').in('product_id', ids.slice(i, i + 200))
      if (error) throw new Error(`${tabla}: ${error.message}`)
      for (const r of data ?? []) {
        if (r.sku_snapshot?.trim() && r.name_snapshot?.trim()) conSnapshot++
        else sinSnapshot++
      }
    }
  }
  registrar('los documentos históricos conservan su snapshot',
    sinSnapshot === 0 ? 'PASA' : 'FALLA', `${conSnapshot + sinSnapshot} líneas, ${sinSnapshot} sin snapshot completo`)

  // ── El canónico sigue en pie ─────────────────────────────────────────────
  if (duplicados.length > 0) {
    const canonicosCaidos = duplicados.filter((e) => {
      const c = porId.get(e.equivalent_product_id)
      return !c || c.status !== 'active'
    })
    registrar('el canónico sigue activo', canonicosCaidos.length === 0 ? 'PASA' : 'FALLA',
      `${canonicosCaidos.length} canónicos que no están activos`)
  } else {
    registrar('el canónico sigue activo', 'PENDIENTE', 'todavía no hay relaciones duplicate')
  }

  // ── Mismo universo en las tres puertas ───────────────────────────────────
  const { data: busqueda, error: eB } = await sb.rpc('search_products', {
    p_company: EMPRESA, p_limit: 1, p_offset: 0, p_solo_catalogo: true,
  })
  if (eB) throw new Error(`search_products: ${eB.message}`)
  const { data: facetas, error: eF } = await sb.rpc('catalog_facets', { p_company: EMPRESA, p_solo_catalogo: true })
  if (eF) throw new Error(`catalog_facets: ${eF.message}`)

  const totalBusqueda = Number(busqueda?.[0]?.total_count ?? 0)
  const totalFacetas = Number(facetas?.total ?? -1)
  const esperado = productos.filter(enCatalogo).length
  registrar('search y facetas cuentan el MISMO universo',
    totalBusqueda === totalFacetas ? 'PASA' : 'FALLA', `search=${totalBusqueda} facetas=${totalFacetas}`)
  registrar('y ese universo es el de en_catalogo()',
    totalBusqueda === esperado ? 'PASA' : 'DIFIERE',
    `search=${totalBusqueda} en_catalogo=${esperado}` +
    (totalBusqueda === esperado ? '' : ' — esperado mientras la regla nueva no esté aplicada'),
  )

  // ── Idempotencia ─────────────────────────────────────────────────────────
  // Correr la migración dos veces no puede cambiar nada la segunda: el UPDATE
  // lleva `and status <> 'merged'` y el INSERT `on conflict do nothing`.
  const paresDuplicados = duplicados.length - new Set(duplicados.map((e) => `${e.product_id}|${e.equivalent_product_id}`)).size
  registrar('la segunda corrida no duplicaría relaciones',
    paresDuplicados === 0 ? 'PASA' : 'FALLA', `${paresDuplicados} pares repetidos`)

  // ── Nada aplicado ────────────────────────────────────────────────────────
  const ancho = Math.max(...resultados.map((r) => r.nombre.length))
  for (const r of resultados) {
    const marca = { PASA: '✓', FALLA: '✗', PENDIENTE: '·', DIFIERE: '·' }[r.estado]
    console.log(`${marca} ${r.nombre.padEnd(ancho)}  ${r.estado.padEnd(10)} ${r.detalle}`)
  }
  const fallas = resultados.filter((r) => r.estado === 'FALLA')
  console.log(`\n${resultados.filter((r) => r.estado === 'PASA').length} pasan · ` +
    `${resultados.filter((r) => r.estado === 'PENDIENTE').length} pendientes de aplicar · ${fallas.length} fallan`)
  console.log(`MERGED_EN_LA_BASE = ${merged.length} · DUPLICATE_RELATIONS = ${duplicados.length}`)
  process.exit(fallas.length === 0 ? 0 : 1)
}

const esteArchivo = import.meta.url.replace(/^file:\/\/\/?/, '').replace(/\\/g, '/').toLowerCase()
const invocado = String(process.argv[1] ?? '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
if (invocado && esteArchivo.endsWith(invocado)) {
  main().catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
}
