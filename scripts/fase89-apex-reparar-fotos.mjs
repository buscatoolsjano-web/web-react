/*
 * Fase 89 · reparar el vínculo de fotos. ESCRIBE (product_images).
 *
 * La persecución de familia tenía un bug: la consulta de "quién ya tiene foto"
 * se topó con el tope de 1.000 filas de PostgREST, así que creyó huérfanos a
 * ~1.362 productos que SÍ tenían su foto propia y les prestó la del hermano,
 * pisando la propia. Los ARCHIVOS propios siguen en el bucket; sólo quedó mal
 * el vínculo.
 *
 * Esto re-apunta cada producto a SU foto propia cuando el archivo existe en el
 * bucket (no baja nada: el archivo ya está). Los que de verdad no tienen foto
 * propia quedan con la prestada de familia, que es lo correcto. Idempotente.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const rd = (f) => Object.fromEntries(readFileSync(f, 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '').trim()]))
const env = rd('.env'), mig = rd('.env.migration')
const sb = createClient(env.VITE_SUPABASE_URL, mig.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
const BUCKET = 'catalogo-publico'
const PUBBASE = `${env.VITE_SUPABASE_URL}/storage/v1/object/public/${BUCKET}`
const DIR = 'scripts/.apex'
const CONC = 10

const nid = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const nidZ = (s) => nid(s).replace(/^0+(\d)/, '$1').replace(/\b0+(\d)/g, '$1')
const slugify = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90)

const idx = JSON.parse(readFileSync(`${DIR}/apexbits-index.json`, 'utf8'))
const apx = new Map(); for (const p of idx) for (const k of [nid(p.model), nidZ(p.model)]) if (k && !apx.has(k)) apx.set(k, p)
const ar = await (await fetch('https://apexbits.com.ar/buscador/products.json')).json()
const arMap = new Map(); for (const p of ar) for (const k of [nid(p.modelo), nid(p.sku), nidZ(p.modelo)]) if (k && !arMap.has(k)) arMap.set(k, p)

// Archivos que REALMENTE están en el bucket.
const enBucket = new Set()
for (let off = 0; ; off += 1000) {
  const { data } = await sb.storage.from(BUCKET).list('apex', { limit: 1000, offset: off })
  if (!data || !data.length) break
  for (const o of data) enBucket.add(`apex/${o.name}`)
  if (data.length < 1000) break
}
console.log(`[rep] archivos en bucket: ${enBucket.size}`)

const { data: marca } = await sb.from('brands').select('id').ilike('name', 'apex').single()
let desde = 0, filas = []
for (;;) {
  const { data, error } = await sb.from('products').select('id, company_id, sku, name, model_code').eq('brand_id', marca.id).is('deleted_at', null).order('sku').range(desde, desde + 999)
  if (error) throw error
  filas.push(...data)
  if (data.length < 1000) break
  desde += 1000
}

// Productos cuyo archivo PROPIO existe.
const aReparar = []
for (const f of filas) {
  const base = (f.model_code || f.sku.replace(/^AP\.|^PRO/i, '')).replace(/\*/g, '')
  const a = apx.get(nid(base)) || apx.get(nidZ(base))
  const b = arMap.get(nid(base)) || arMap.get(nidZ(base))
  let path = null
  if (a) path = `apex/${a.slug}.jpg`
  else if (b && b._raw && b._raw.img_url_original) path = `apex/${slugify(`${base}-apex`)}.jpg`
  if (path && enBucket.has(path)) aReparar.push({ ...f, path })
}
console.log(`[rep] con foto propia en bucket: ${aReparar.length}`)

let ok = 0
async function fix(t) {
  const url = `${PUBBASE}/${t.path}`
  // ¿ya apunta a su propia foto? entonces nada.
  const { data: ya } = await sb.from('product_images').select('id').eq('product_id', t.id).eq('storage_path', `${BUCKET}/${t.path}`).eq('is_primary', true).limit(1)
  if (ya && ya.length) { ok++; return }
  await sb.from('product_images').update({ is_primary: false }).eq('product_id', t.id)
  await sb.from('product_images').delete().eq('product_id', t.id).like('storage_path', `${BUCKET}/%`)
  const { error } = await sb.from('product_images').insert({
    company_id: t.company_id, product_id: t.id, source_url: url, storage_path: `${BUCKET}/${t.path}`,
    kind: 'product_image', position: 0, is_primary: true, alt_text: t.name, checked_at: new Date().toISOString(), http_status: 200,
  })
  if (!error) ok++
  else console.error('err', t.sku, error.message)
}
for (let i = 0; i < aReparar.length; i += CONC) {
  await Promise.all(aReparar.slice(i, i + CONC).map(fix))
  if ((i + CONC) % 500 < CONC) console.log(`[rep] ${Math.min(i + CONC, aReparar.length)}/${aReparar.length} · ok ${ok}`)
}
console.log(`[rep] LISTO · reparados/ok ${ok}`)
