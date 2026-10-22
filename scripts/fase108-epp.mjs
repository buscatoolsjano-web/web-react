/*
 * Fase 108 · Unificar seguridad industrial en una sola categoría pública «EPP».
 * Renombra la categoría «Seguridad» → «EPP» (pública), le pone product_type a
 * cada producto (el subfiltro «Tipo»), les da brand_id para que se publiquen
 * (marca existente por el nombre, o «Genérico»), y suma los de EPP sueltos en
 * «Otros». SECO por defecto; «apply» escribe.
 *   node fase108-epp.mjs          → plan
 *   node fase108-epp.mjs apply
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const rd = (f) => Object.fromEntries(readFileSync(f, 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '').trim()]))
const env = rd('.env'), mig = rd('.env.migration')
const sb = createClient(env.VITE_SUPABASE_URL, mig.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
const CID = 'bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c', OTROS = '9cac370c-7193-43d1-b775-8faff36dd27b'
const APLICAR = process.argv[2] === 'apply'

const TIPO = [
  [/\bzapato|calzado|bot[ií]n|\bbota|borcegu/i, 'Calzado de seguridad'],
  [/guante/i, 'Guantes'],
  [/lente|antiparra|gafas|visor|protecci[oó]n facial|\bfacial/i, 'Protección facial y visual'],
  [/\bcasco/i, 'Casco'],
  [/auditiv|tapones|protector de o[ií]do|orejera|endaural/i, 'Protección auditiva'],
  [/respirador|barbijo|m[aá]scara|mascarilla|filtro resp|semim[aá]scara/i, 'Protección respiratoria'],
  [/arn[eé]s|antica[ií]da|l[ií]nea de vida|eslinga de vida|cabo de vida/i, 'Protección contra caídas'],
  [/mameluco|camisa|pantal[oó]n|\bbuzo|delantal|\bcapa\b|\btraje|campera|chaleco|ropa/i, 'Ropa de trabajo'],
  [/faja/i, 'Faja lumbar'],
  [/.*/, 'Protección general'],
]
const tipoDe = (n) => { for (const [re, t] of TIPO) if (re.test(n || '')) return t; return 'Protección general' }
// «protección» a secas es demasiado amplio («caja de protección para
// termostato» no es EPP); los guantes/mangas reales igual caen por anticorte.
const esEpp = (n) => /\b(guante|lente|antiparra|casco|auditiv|tapones|arn[eé]s|barbijo|respirador|m[aá]scara|mascarilla|zapato|calzado|bot[ií]n|botines|chaleco|mameluco|borcegu|anticorte|antica[ií]da)/i.test(n || '')

const { data: marcas } = await sb.from('brands').select('id, name').eq('company_id', CID)
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const bn = marcas.map((b) => ({ id: b.id, re: new RegExp(`(^|[^A-Za-z0-9])${esc(b.name)}([^A-Za-z0-9]|$)`, 'i') }))
const genericoId = marcas.find((b) => b.name.toUpperCase() === 'GENÉRICO')?.id
if (!genericoId) throw new Error('Falta la marca «Genérico» (correr fase105 primero)')
const marcaDe = (n) => { for (const b of bn) if (b.re.test(n || '')) return b.id; return genericoId }

const { data: cat } = await sb.from('product_categories').select('id, name, publica, slug_publico').eq('company_id', CID).eq('slug', 'seguridad').single()

// Productos: los de Seguridad + los de EPP sueltos en Otros
const prods = []
for (const catId of [cat.id, OTROS]) {
  for (let o = 0; ; o += 1000) {
    const { data } = await sb.from('products').select('id, name, brand_id, product_type, category_id, attributes').eq('company_id', CID).eq('category_id', catId).eq('status', 'active').is('deleted_at', null).range(o, o + 999)
    for (const p of data) { if (catId === cat.id || esEpp(p.name)) prods.push(p) }
    if (data.length < 1000) break
  }
}

const porTipo = {}, filas = []
let desdeOtros = 0, aMarca = 0, aGenerico = 0
for (const p of prods) {
  const patch = {}
  const t = tipoDe(p.name)
  if (p.product_type !== t) patch.product_type = t
  if (p.category_id !== cat.id) { patch.category_id = cat.id; desdeOtros++ }
  if (!p.brand_id) { const bid = marcaDe((p.attributes?.marca_disp ? p.attributes.marca_disp + ' ' : '') + p.name); patch.brand_id = bid; if (bid === genericoId) aGenerico++; else aMarca++ }
  porTipo[t] = (porTipo[t] || 0) + 1
  if (Object.keys(patch).length) filas.push({ id: p.id, patch })
}
console.log(`EPP: ${prods.length} productos (desde Otros: ${desdeOtros}) · a escribir: ${filas.length}`)
console.log(`brand_id nuevos → a marca real: ${aMarca} · a Genérico: ${aGenerico}`)
console.log('tipos:', Object.entries(porTipo).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}(${n})`).join(', '))
console.log(`categoría: «${cat.name}» publica=${cat.publica} slug_publico=${cat.slug_publico} → «EPP» publica=true slug_publico=epp`)

if (APLICAR) {
  const { error: ec } = await sb.from('product_categories').update({ name: 'EPP', publica: true, slug_publico: 'epp', is_active: true }).eq('id', cat.id)
  if (ec) throw new Error(`categoría: ${ec.message}`)
  let n = 0
  for (const f of filas) { const { error } = await sb.from('products').update(f.patch).eq('id', f.id); if (error) throw new Error(`${f.id}: ${error.message}`); if (++n % 100 === 0) process.stdout.write(`\r  ${n}/${filas.length}   `) }
  console.log(`\n[108] categoría EPP lista · productos actualizados ${n}`)
}
