/*
 * Fase 92 · alojar las fotos de SPEEDRILL en nuestro bucket. ESCRIBE.
 *
 * SPEEDRILL ya tiene foto REAL de producto, pero hotlinkeada desde el sitio
 * propio (www.buscatool.com/wp-content/uploads/...). Esto las baja y las sube a
 * `catalogo-publico`, igual que se hizo con APEX (Fase 89): estabilidad —que el
 * catálogo no dependa del WordPress— y nombre propio del archivo.
 *
 * Idempotente: una fila que ya apunta a nuestro bucket se saltea. Se puede
 * cortar y reanudar. Reversible desde fase92.speedrill_images_bak.
 *
 *   node scripts/fase92-speedrill-hostear-fotos.mjs [--limit N]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const rd = (f) => Object.fromEntries(readFileSync(f, 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '').trim()]))
const env = rd('.env'), mig = rd('.env.migration')
const sb = createClient(env.VITE_SUPABASE_URL, mig.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
const BUCKET = 'catalogo-publico'
const PUBBASE = `${env.VITE_SUPABASE_URL}/storage/v1/object/public/${BUCKET}`
const LIMIT = process.argv.includes('--limit') ? Number(process.argv[process.argv.indexOf('--limit') + 1]) : Infinity
const CONC = 8
const slugify = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100)

const { data: marca } = await sb.from('brands').select('id').ilike('name', 'speedrill').single()

let desde = 0, filas = []
for (;;) {
  const { data, error } = await sb.from('products')
    .select('id, company_id, product_images(id, source_url, storage_path, is_primary, position)')
    .eq('brand_id', marca.id).is('deleted_at', null).range(desde, desde + 499)
  if (error) throw error
  filas.push(...data)
  if (data.length < 500) break
  desde += 500
}

const trabajos = []
for (const p of filas) {
  const imgs = p.product_images || []
  if (imgs.some((i) => (i.storage_path || '').startsWith(BUCKET + '/'))) continue
  const buscatool = imgs.filter((i) => /buscatool\.com/i.test(i.source_url || ''))
  if (!buscatool.length) continue
  const elegida = buscatool.find((i) => i.is_primary) || buscatool.sort((a, b) => (a.position ?? 9) - (b.position ?? 9))[0]
  const base = slugify(decodeURIComponent((elegida.source_url.split('/').pop() || '').replace(/\.(jpe?g|png|webp)$/i, '')))
  trabajos.push({ id: p.id, company_id: p.company_id, url: elegida.source_url, path: `speedrill/${base}.jpg` })
}
console.log(`[speedrill] ${filas.length} productos · a hostear: ${trabajos.length}`)

const lote = trabajos.slice(0, LIMIT)
const subidas = new Set()
let ok = 0, falló = 0, bajas = 0
const fallidos = []
async function procesar(t) {
  try {
    if (!subidas.has(t.path)) {
      const r = await fetch(t.url, { headers: { 'user-agent': 'buscatools-catalog' } })
      if (!r.ok) { bajas++; fallidos.push({ id: t.id, url: t.url, status: r.status }); return }
      const buf = Buffer.from(await r.arrayBuffer())
      if (buf.length < 1200) { bajas++; fallidos.push({ id: t.id, url: t.url, status: 'vacía' }); return }
      const up = await sb.storage.from(BUCKET).upload(t.path, buf, { contentType: 'image/jpeg', upsert: true })
      if (up.error) { falló++; fallidos.push({ id: t.id, err: up.error.message }); return }
      subidas.add(t.path)
    }
    await sb.from('product_images').update({ is_primary: false }).eq('product_id', t.id)
    await sb.from('product_images').delete().eq('product_id', t.id).like('storage_path', `${BUCKET}/%`)
    const { error } = await sb.from('product_images').insert({
      company_id: t.company_id, product_id: t.id, source_url: `${PUBBASE}/${t.path}`, storage_path: `${BUCKET}/${t.path}`,
      kind: 'product_image', position: 0, is_primary: true, checked_at: new Date().toISOString(), http_status: 200,
    })
    if (error) { falló++; fallidos.push({ id: t.id, err: error.message }); return }
    ok++
  } catch (e) { falló++; fallidos.push({ id: t.id, err: String(e).slice(0, 100) }) }
}
for (let i = 0; i < lote.length; i += CONC) {
  await Promise.all(lote.slice(i, i + CONC).map(procesar))
  if ((i + CONC) % 400 < CONC) console.log(`[speedrill] ${Math.min(i + CONC, lote.length)}/${lote.length} · ok ${ok} · 404 ${bajas} · err ${falló}`)
}
writeFileSync('scripts/.apex/speedrill-fallidos.json', JSON.stringify(fallidos, null, 0))
console.log(`[speedrill] LISTO · ok ${ok} · 404 ${bajas} · err ${falló}`)
