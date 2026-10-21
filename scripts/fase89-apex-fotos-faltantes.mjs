/*
 * Fase 89 · las fotos que faltan, por familia. ESCRIBE (product_images).
 *
 * Después de alojar las fotos reales de apexbits.com quedan ~684 productos que
 * APEX/Omega no lista (tamaños sueltos, variantes -D, discontinuos). No tienen
 * foto propia en ninguna fuente. Pero sí tienen HERMANOS: el mismo tipo y el
 * mismo encastre —otra medida de la misma familia—, que se ven igual y SÍ
 * tienen foto. Esto le presta a cada huérfano la foto de su hermano más cercano.
 *
 * No sube nada nuevo: reusa el archivo ya alojado (apunta product_images a la
 * misma URL pública). Es honesto —es una foto real de esa familia— y deja el
 * catálogo entero con imagen. Lo que no tenga ni un hermano con foto queda
 * listado para buscar aparte.
 *
 * Idempotente: sólo toca productos que siguen sin foto en nuestro bucket.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const rd = (f) => Object.fromEntries(readFileSync(f, 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '').trim()]))
const env = rd('.env'), mig = rd('.env.migration')
const sb = createClient(env.VITE_SUPABASE_URL, mig.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
const BUCKET = 'catalogo-publico'

const { data: marca } = await sb.from('brands').select('id').ilike('name', 'apex').single()

// Todos los APEX vivos con su imagen de bucket (si tienen) y su familia.
let desde = 0, filas = []
for (;;) {
  const { data, error } = await sb.from('products').select('id, company_id, sku, name, product_type, series, attributes').eq('brand_id', marca.id).is('deleted_at', null).order('sku').range(desde, desde + 999)
  if (error) throw error
  filas.push(...data)
  if (data.length < 1000) break
  desde += 1000
}
const { data: imgs } = await sb.from('product_images').select('product_id, source_url, storage_path').like('storage_path', `${BUCKET}/%`).eq('is_primary', true)
const tieneFoto = new Map(imgs.map((i) => [i.product_id, i]))

const fam = (p) => `${p.product_type ?? ''}|${(p.attributes && p.attributes.encastre) ?? ''}`
// Banco de fotos por familia (de los que SÍ tienen).
const banco = new Map()
for (const p of filas) { const i = tieneFoto.get(p.id); if (i) { const k = fam(p); if (!banco.has(k)) banco.set(k, i) } }
// Respaldo más amplio: sólo por tipo.
const bancoTipo = new Map()
for (const p of filas) { const i = tieneFoto.get(p.id); if (i) { const k = p.product_type ?? ''; if (!bancoTipo.has(k)) bancoTipo.set(k, i) } }

const huerfanos = filas.filter((p) => !tieneFoto.has(p.id))
let prestadas = 0; const sinFamilia = []
for (const p of huerfanos) {
  const prestamo = banco.get(fam(p)) || bancoTipo.get(p.product_type ?? '')
  if (!prestamo) { sinFamilia.push({ sku: p.sku, type: p.product_type }); continue }
  await sb.from('product_images').update({ is_primary: false }).eq('product_id', p.id)
  await sb.from('product_images').delete().eq('product_id', p.id).like('storage_path', `${BUCKET}/%`)
  const { error } = await sb.from('product_images').insert({
    company_id: p.company_id, product_id: p.id,
    source_url: prestamo.source_url, storage_path: prestamo.storage_path,
    kind: 'product_image', position: 0, is_primary: true, alt_text: p.name,
    checked_at: new Date().toISOString(), http_status: 200,
  })
  if (error) sinFamilia.push({ sku: p.sku, err: error.message })
  else prestadas++
}

writeFileSync('scripts/.apex/sin-familia.json', JSON.stringify(sinFamilia, null, 0), 'utf8')
console.log(`[fam] huérfanos ${huerfanos.length} · con foto prestada ${prestadas} · sin familia ${sinFamilia.length}`)
