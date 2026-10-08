/*
 * Carga la lista de precios de SPEEDRILL (Fase 49).
 *
 *   set -a; . ./.env.local; . ./.env.migration; set +a
 *   node scripts/fase49-cargar-speedrill.mjs
 *
 * ENTRADA: scripts/output/speedrill-parseado.json, que sale de leer el .xlsx
 * del Drive y parsearlo. El parseo ancla cada renglón al «USD» final del
 * anterior: partir por la primera coma perdía 878 de 3.630 filas —el 24 %—
 * porque 777 descripciones tienen comas. Si una carga da bastante menos de lo
 * esperado, mirar ahí antes que en ningún otro lado.
 *
 * El cruce con el catálogo es `prefijo de la marca + "." + referencia`, que es
 * la regla de la Fase 45. Una referencia que no cruza NO es un error: la lista
 * del fabricante trae cosas que Buscatools no tiene cargadas. Se guarda igual,
 * con product_id en null, porque el día que el producto exista el histórico ya
 * está.
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
const { data: emp } = await sb.from('companies').select('id').eq('slug', 'buscatools').single()
const { data: marca } = await sb.from('brands').select('id, name, sku_prefix').eq('company_id', emp.id).eq('name', 'SPEEDRILL').single()

const filas = JSON.parse(fs.readFileSync('scripts/output/speedrill-parseado.json', 'utf8'))
  .map((f) => ({ ...f, ref: f.ref.replace(/^\(Estimado\)\s*/, '').trim() }))
  .filter((f) => f.ref !== '' && Number.isFinite(f.pvpEur))

// 1 · la fuente
let { data: fuente } = await sb.from('price_list_sources').select('id')
  .eq('company_id', emp.id).eq('name', 'SPEEDRILL').maybeSingle()
if (!fuente) {
  const r = await sb.from('price_list_sources')
    .insert({ company_id: emp.id, name: 'SPEEDRILL', brand_id: marca.id, kind: 'marca' })
    .select('id').single()
  if (r.error) throw new Error(r.error.message)
  fuente = r.data
}

// 2 · la versión. La columna ancla es la ÚNICA independiente del archivo: las
//     otras tres salen de ella con factores fijos (0,50 · 1,50 · 1,75).
const version = await sb.from('price_list_versions').upsert({
  company_id: emp.id, source_id: fuente.id,
  issued_on: '2026-10-05', currency: 'EUR',
  anchor_column: 'PVP ESPANA EUR',
  factors: { costo_eur_sobre_pvp_eur: 0.50, pvp_usd_sobre_pvp_eur: 1.50, costo_usd_sobre_costo_eur: 1.75 },
  origin: 'drive',
  file_name: 'LISTA DE PRECIOS SPEEDRILL 2026.xlsx',
  file_ref: '1zs1zSPYqC_4oPDPaK6eItSkI8g8L8Eco',
  file_url: 'https://drive.google.com/file/d/1zs1zSPYqC_4oPDPaK6eItSkI8g8L8Eco/view',
  notes: 'Primera carga. El archivo trae 4 columnas; 3 son formula de la primera.',
}, { onConflict: 'source_id,issued_on,anchor_column' }).select('id').single()
if (version.error) throw new Error(version.error.message)

// 3 · los productos del ERP, para cruzar
const porSku = new Map()
for (let d = 0; ; d += 1000) {
  const { data } = await sb.from('products').select('id, sku').eq('company_id', emp.id).is('deleted_at', null).range(d, d + 999)
  for (const p of data) porSku.set(p.sku.toUpperCase(), p.id)
  if (data.length < 1000) break
}

let cruzan = 0
const items = filas.map((f) => {
  const id = porSku.get(`${marca.sku_prefix}.${f.ref.toUpperCase()}`) ?? null
  if (id) cruzan++
  return {
    company_id: emp.id, version_id: version.data.id,
    reference: f.ref, description: f.desc || null,
    anchor: f.pvpEur,
    prices: { pvp_eur: f.pvpEur, costo_eur: f.costoEur, pvp_usd: f.pvpUsd, costo_usd: f.costoUsd },
    product_id: id,
  }
})

await sb.from('price_list_items').delete().eq('version_id', version.data.id)
for (let i = 0; i < items.length; i += 500) {
  const r = await sb.from('price_list_items').insert(items.slice(i, i + 500))
  if (r.error) throw new Error(`fila ${i}: ${r.error.message}`)
}
console.log(`SPEEDRILL 2026 · ${items.length} renglones cargados`)
console.log(`  cruzan con el catálogo: ${cruzan} (${Math.round(cruzan / items.length * 100)} %)`)
console.log(`  sin producto en el ERP: ${items.length - cruzan}`)
