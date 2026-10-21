/*
 * Fase 89 · aloja las fotos reales de APEX en NUESTRO bucket y las deja como
 * imagen principal de cada producto. ESCRIBE (storage + product_images).
 *
 * Fuentes, en orden (lo que pidió el usuario): apexbits.com (foto real por
 * producto, en mrotools.de) y, sólo si ahí no está, la foto de familia de
 * apexbits.com.ar. Lo que no tiene foto en ninguna queda listado para ir a
 * buscarlo aparte.
 *
 * Por qué a nuestro bucket y no hotlink: estabilidad (que no dependa de un
 * tercero) y control del NOMBRE del archivo —se sube como `apex/<slug>.jpg`,
 * un nombre descriptivo, que es parte del SEO que se pidió—. El bucket es
 * `catalogo-publico`, PÚBLICO y dedicado sólo a esto: no expone nada más.
 *
 * Idempotente: una foto ya subida no se vuelve a subir, y una fila ya apuntada
 * a nuestro bucket no se duplica. Se puede cortar y reanudar.
 *
 *   node scripts/fase89-apex-aplicar-imagenes.mjs [--limit N]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const rd = (f) => Object.fromEntries(readFileSync(f, 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '').trim()]))
const env = rd('.env'), mig = rd('.env.migration')
const sb = createClient(env.VITE_SUPABASE_URL, mig.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
const BUCKET = 'catalogo-publico'
const PUBBASE = `${env.VITE_SUPABASE_URL}/storage/v1/object/public/${BUCKET}`
const DIR = 'scripts/.apex'
const LIMIT = process.argv.includes('--limit') ? Number(process.argv[process.argv.indexOf('--limit') + 1]) : Infinity
const CONC = 8

const nid = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const nidZ = (s) => nid(s).replace(/^0+(\d)/, '$1').replace(/\b0+(\d)/g, '$1')
const slugify = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90)

// Fuentes.
const idx = JSON.parse(readFileSync(`${DIR}/apexbits-index.json`, 'utf8'))
const apx = new Map(); for (const p of idx) for (const k of [nid(p.model), nidZ(p.model)]) if (k && !apx.has(k)) apx.set(k, p)
const ar = await (await fetch('https://apexbits.com.ar/buscador/products.json')).json()
const arMap = new Map(); for (const p of ar) for (const k of [nid(p.modelo), nid(p.sku), nidZ(p.modelo)]) if (k && !arMap.has(k)) arMap.set(k, p)

// Bucket (idempotente).
const { data: buckets } = await sb.storage.listBuckets()
if (!buckets.some((b) => b.name === BUCKET)) {
  const { error } = await sb.storage.createBucket(BUCKET, { public: true, fileSizeLimit: 5242880, allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] })
  if (error) throw error
  console.log('[img] bucket creado:', BUCKET)
} else console.log('[img] bucket ya existe:', BUCKET)

// Productos APEX vivos.
const { data: marca } = await sb.from('brands').select('id').ilike('name', 'apex').single()
let desde = 0, filas = []
for (;;) {
  const { data, error } = await sb.from('products').select('id, company_id, sku, name, model_code').eq('brand_id', marca.id).is('deleted_at', null).order('sku').range(desde, desde + 999)
  if (error) throw error
  filas.push(...data)
  if (data.length < 1000) break
  desde += 1000
}

// Decidir foto + nombre de archivo por producto.
const trabajos = []
const sinFoto = []
for (const f of filas) {
  const base = (f.model_code || f.sku.replace(/^AP\.|^PRO/i, '')).replace(/\*/g, '')
  const k = nid(base), kz = nidZ(base)
  const a = apx.get(k) || apx.get(kz)
  const b = arMap.get(k) || arMap.get(kz)
  let url = null, nombre = null
  if (a) { url = a.image; nombre = a.slug }
  else if (b && b._raw && b._raw.img_url_original) { url = b._raw.img_url_original; nombre = slugify(`${base}-apex`) }
  if (!url) { sinFoto.push({ id: f.id, sku: f.sku }); continue }
  trabajos.push({ ...f, url, path: `apex/${nombre}.jpg` })
}
console.log(`[img] ${filas.length} productos · con foto a subir: ${trabajos.length} · sin foto: ${sinFoto.length}`)
mkdirSync(DIR, { recursive: true })
writeFileSync(`${DIR}/sin-foto.json`, JSON.stringify(sinFoto, null, 0), 'utf8')

const lote = trabajos.slice(0, LIMIT)
const subidas = new Set() // paths ya subidos esta corrida
let ok = 0, falló = 0, img404 = 0
const fallidos = []

async function procesar(t) {
  try {
    // ¿ya está apuntado a nuestro bucket? (idempotencia)
    const { data: ya } = await sb.from('product_images').select('id').eq('product_id', t.id).like('storage_path', `${BUCKET}/%`).limit(1)
    if (ya && ya.length) { ok++; return }

    // Subir la foto si no está en el bucket.
    if (!subidas.has(t.path)) {
      const r = await fetch(t.url, { headers: { 'user-agent': 'buscatools-catalog' } })
      if (!r.ok) { img404++; fallidos.push({ sku: t.sku, url: t.url, status: r.status }); return }
      const buf = Buffer.from(await r.arrayBuffer())
      if (buf.length < 1500) { img404++; fallidos.push({ sku: t.sku, url: t.url, status: 'vacía' }); return }
      const up = await sb.storage.from(BUCKET).upload(t.path, buf, { contentType: 'image/jpeg', upsert: true })
      if (up.error) { falló++; fallidos.push({ sku: t.sku, err: up.error.message }); return }
      subidas.add(t.path)
    }

    // Repuntar product_images: demote lo viejo, inserta la nueva principal.
    await sb.from('product_images').update({ is_primary: false }).eq('product_id', t.id)
    await sb.from('product_images').delete().eq('product_id', t.id).like('storage_path', `${BUCKET}/%`)
    const { error } = await sb.from('product_images').insert({
      company_id: t.company_id, product_id: t.id,
      source_url: `${PUBBASE}/${t.path}`, storage_path: `${BUCKET}/${t.path}`,
      kind: 'product_image', position: 0, is_primary: true,
      alt_text: t.name, checked_at: new Date().toISOString(), http_status: 200,
    })
    if (error) { falló++; fallidos.push({ sku: t.sku, err: error.message }); return }
    ok++
  } catch (e) {
    falló++; fallidos.push({ sku: t.sku, err: String(e).slice(0, 120) })
  }
}

for (let i = 0; i < lote.length; i += CONC) {
  await Promise.all(lote.slice(i, i + CONC).map(procesar))
  if ((i + CONC) % 200 < CONC) console.log(`[img] ${Math.min(i + CONC, lote.length)}/${lote.length} · ok ${ok} · 404 ${img404} · err ${falló}`)
}

writeFileSync(`${DIR}/img-fallidos.json`, JSON.stringify(fallidos, null, 0), 'utf8')
console.log(`[img] LISTO: ok ${ok} · 404 ${img404} · err ${falló} · sinFoto ${sinFoto.length} (→ ${DIR}/sin-foto.json, img-fallidos.json)`)
