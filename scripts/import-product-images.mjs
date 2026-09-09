/**
 * Carga de `product_images` desde el catálogo legacy + la verificación offline.
 *
 * IDEMPOTENTE: lee lo que ya existe e inserta sólo lo que falta. No usa
 * `upsert` con `onConflict` porque `uq_product_images_origen` es un índice
 * PARCIAL y Postgres no lo puede inferir sin repetir el predicado — algo que
 * supabase-js no sabe expresar. Es el mismo bug que apareció con el índice de
 * apertura de stock en la Fase 3.5.
 *
 * Reglas que hace cumplir:
 *   · una fila por (producto, URL); 8.859 referencias sobre 3.317 archivos
 *   · thumb_url SÓLO si la verificación offline la encontró con HTTP 200
 *   · is_primary sólo para kind='product_image' y position 0
 *   · un diagrama NUNCA es principal (la base además lo impide con un CHECK)
 *
 *   set -a; source .env.migration; set +a
 *   node scripts/import-product-images.mjs <productos-data.json> <verificacion.json>
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const [, , LEGACY, VERIF] = process.argv
if (!LEGACY || !VERIF) {
  console.error('Uso: node scripts/import-product-images.mjs <productos-data.json> <verificacion.json>')
  process.exit(1)
}

const sb = createClient(
  process.env.SUPABASE_URL ?? 'https://uaxcfufvapzulqvynanp.supabase.co',
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } },
)

const LOTE = 500

/** Paginación con orden TOTAL. Sin ORDER BY, .range() devuelve filas repetidas
 *  y omite otras — el bug que costó 5.000 productos en la Fase 3.5. */
async function traerTodo(tabla, select, filtro = (q) => q, orden = ['id']) {
  const filas = []
  for (let desde = 0; ; desde += 1000) {
    let q = filtro(sb.from(tabla).select(select))
    for (const c of orden) q = q.order(c, { ascending: true })
    const { data, error } = await q.range(desde, desde + 999)
    if (error) throw new Error(`${tabla}: ${error.message}`)
    filas.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return filas
}

const main = async () => {
  console.log('═'.repeat(72))
  console.log('  IMPORTACIÓN DE IMÁGENES')
  console.log('═'.repeat(72))

  const { data: empresa, error: eE } = await sb
    .from('companies').select('id').eq('slug', 'buscatools').single()
  if (eE) throw new Error('empresa: ' + eE.message)

  // ── Fuentes ─────────────────────────────────────────────────────────────
  const bruto = JSON.parse(fs.readFileSync(LEGACY, 'utf8'))
  const legacy = Array.isArray(bruto) ? bruto : Object.values(bruto).find(Array.isArray)
  const verif = JSON.parse(fs.readFileSync(VERIF, 'utf8'))
  const porUrl = new Map(verif.map((v) => [v.original_url, v]))
  console.log(`  legacy: ${legacy.length} productos · verificación: ${verif.length} URLs`)

  // ── Mapa SKU → product_id ───────────────────────────────────────────────
  const productos = await traerTodo('products', 'id, sku', (q) =>
    q.eq('company_id', empresa.id), ['sku'])
  const idPorSku = new Map(productos.map((p) => [p.sku, p.id]))
  console.log(`  productos en la base: ${productos.length}`)

  // ── Construir las filas deseadas ────────────────────────────────────────
  const clase = { PRODUCT_IMAGE: 'product_image', SHARED_DIAGRAM: 'shared_diagram',
                  TECHNICAL_DIAGRAM: 'technical_diagram', UNKNOWN: 'unknown' }
  const deseadas = []
  const sinProducto = []
  const checked = new Date().toISOString()

  for (const p of legacy) {
    const pid = idPorSku.get(p.sku)
    if (!pid) { if ((p.imgs ?? []).length) sinProducto.push(p.sku); continue }
    const urls = (p.imgs ?? []).filter((u) => typeof u === 'string' && u.trim() !== '')
    // La primera FOTO (no diagrama) del producto es la principal.
    let yaHayPrincipal = false
    urls.forEach((raw, i) => {
      const url = raw.trim()
      const v = porUrl.get(url)
      const kind = clase[v?.clasificacion ?? 'UNKNOWN'] ?? 'unknown'
      const esPrincipal = !yaHayPrincipal && kind === 'product_image'
      if (esPrincipal) yaHayPrincipal = true
      deseadas.push({
        company_id: empresa.id,
        product_id: pid,
        source_url: url,
        thumb_url: v?.thumbnail_exists ? v.thumbnail_url : null,
        kind,
        position: i,
        is_primary: esPrincipal,
        checked_at: checked,
        http_status: v?.status ?? null,
        bytes: v?.bytes_original ?? null,
      })
    })
  }
  console.log(`  relaciones a cargar: ${deseadas.length}`)
  if (sinProducto.length) console.log(`  ⚠ SKUs con imagen sin producto en la base: ${sinProducto.length}`)

  // ── Qué existe ya (idempotencia) ────────────────────────────────────────
  const existentes = await traerTodo('product_images', 'product_id, source_url',
    (q) => q.eq('company_id', empresa.id), ['product_id', 'source_url'])
  const yaEsta = new Set(existentes.map((r) => `${r.product_id}|${r.source_url}`))
  console.log(`  ya en la base: ${existentes.length}`)

  const faltantes = deseadas.filter((d) => !yaEsta.has(`${d.product_id}|${d.source_url}`))
  console.log(`  a insertar: ${faltantes.length}`)

  if (faltantes.length === 0) {
    console.log('\n  nada que insertar — la carga ya estaba completa (idempotente)')
    return
  }

  let insertadas = 0
  for (let i = 0; i < faltantes.length; i += LOTE) {
    const lote = faltantes.slice(i, i + LOTE)
    const { error } = await sb.from('product_images').insert(lote)
    if (error) throw new Error(`insert lote ${i}: ${error.message}`)
    insertadas += lote.length
    if (insertadas % 2000 === 0 || insertadas === faltantes.length)
      console.log(`    ${insertadas}/${faltantes.length}`)
  }
  console.log(`\n  insertadas: ${insertadas}`)
}

main().catch((e) => { console.error('✗ ' + e.message); process.exit(1) })
