/*
 * Fase 102 · Deduplicar APEX en el catálogo público. Dos importaciones se
 * superponen: una con SKU AP.<número-STEL> o modelo sin guiones (malformada) y
 * una canónica con SKU AP.<modelo> y el número de parte APEX real (con guiones,
 * ej. 315-5MM, EX-376-8). Se agrupa por modelo "pelado" (sólo alfanumérico);
 * dentro de cada grupo queda el canónico (con guión + SKU limpio) y al resto se
 * le pone public_slug=null (REVERSIBLE: no se borra nada). Antes se le copian al
 * que queda los atributos que le falten.
 *
 * Guarda decimal: si dentro de un grupo un modelo tiene decimal (\d.\d) y otro
 * no (2.2MM13 vs 22MM13 = 2,2 mm vs 22 mm, productos DISTINTOS), no se toca y se
 * lista para revisar. Igual ante empate de "mejor".
 *   node fase102-dedup-apex.mjs          → reporte (SECO)
 *   node fase102-dedup-apex.mjs apply
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const rd = (f) => Object.fromEntries(readFileSync(f, 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '').trim()]))
const env = rd('.env'), mig = rd('.env.migration')
const sb = createClient(env.VITE_SUPABASE_URL, mig.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
const CID = 'bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c'
const APLICAR = process.argv[2] === 'apply'
mkdirSync('scripts/.otros', { recursive: true })

const { data: apexB } = await sb.from('brands').select('id, sku_prefix').eq('company_id', CID).eq('name', 'APEX').single()
const PRE = apexB.sku_prefix // 'AP'
const pelado = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const skuLimpio = (model) => `${PRE}.${(model || '').trim().replace(/\s+/g, '')}`.toUpperCase()
const tieneDecimal = (s) => /\d\.\d/.test(s || '')
const esPlaceholder = (k) => !k || ['', '?', '*', 'NA', 'SN'].includes(k)
const nAttrs = (p) => Object.keys(p.attributes || {}).length
// Puntaje del "mejor" (canónico): con guión manda, después SKU limpio, después más atributos
const puntaje = (p) => ((p.model_code || '').includes('-') ? 1000 : 0) + ((p.sku || '').toUpperCase() === skuLimpio(p.model_code) ? 100 : 0) + nAttrs(p)

const todos = []
for (let d = 0; ; d += 1000) {
  const { data } = await sb.from('products').select('id, sku, model_code, name, series, product_type, attributes, public_slug')
    .eq('company_id', CID).eq('brand_id', apexB.id).eq('status', 'active').is('deleted_at', null).not('public_slug', 'is', null).range(d, d + 999)
  todos.push(...data); if (data.length < 1000) break
}

const grupos = new Map()
for (const p of todos) { const k = pelado(p.model_code); if (esPlaceholder(k)) continue; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(p) }

const esconder = [], revisar = [], copiasAttr = []
for (const [k, miembros] of grupos) {
  if (miembros.length < 2) continue
  // Guarda decimal: no mezclar 2.2 con 22
  const conDec = miembros.some((p) => tieneDecimal(p.model_code)), sinDec = miembros.some((p) => !tieneDecimal(p.model_code))
  if (conDec && sinDec) { revisar.push({ modelo: k, motivo: 'decimal', skus: miembros.map((m) => `${m.sku}(${m.model_code})`) }); continue }
  const ord = [...miembros].sort((a, b) => puntaje(b) - puntaje(a))
  if (puntaje(ord[0]) === puntaje(ord[1])) { revisar.push({ modelo: k, motivo: 'empate', skus: miembros.map((m) => `${m.sku}(${m.model_code})`) }); continue }
  const keeper = ord[0], perdedores = ord.slice(1)
  const attrs = { ...(keeper.attributes || {}) }; const patch = {}; let camb = false
  for (const pd of perdedores) {
    for (const [ak, av] of Object.entries(pd.attributes || {})) if (!(ak in attrs) && av != null && av !== '') { attrs[ak] = av; camb = true }
    if (!keeper.series && pd.series) patch.series = pd.series
    if (!keeper.product_type && pd.product_type) patch.product_type = pd.product_type
  }
  if (camb) patch.attributes = attrs
  if (Object.keys(patch).length) copiasAttr.push({ id: keeper.id, sku: keeper.sku, patch })
  for (const pd of perdedores) esconder.push({ id: pd.id, sku: pd.sku, modelo: pd.model_code, keeper: keeper.sku })
}

console.log(`grupos APEX con >1: ${[...grupos.values()].filter((m) => m.length > 1).length}`)
console.log(`a esconder: ${esconder.length} · keepers a completar: ${copiasAttr.length} · a revisar a mano: ${revisar.length}`)
console.log('muestra esconder:'); for (const e of esconder.slice(0, 16)) console.log(`  ${e.sku} (${e.modelo}) → queda ${e.keeper}`)
if (revisar.length) { console.log('revisar:'); for (const r of revisar) console.log(`  [${r.motivo}] ${r.skus.join('  ')}`) }
writeFileSync('scripts/.otros/dedup-apex-revisar.json', JSON.stringify(revisar, null, 2))
writeFileSync('scripts/.otros/dedup-apex-escondidos.json', JSON.stringify(esconder, null, 2))

if (APLICAR) {
  let c = 0
  for (const f of copiasAttr) { const { error } = await sb.from('products').update(f.patch).eq('id', f.id); if (error) throw new Error(`keeper ${f.sku}: ${error.message}`); c++ }
  let n = 0
  for (const e of esconder) { const { error } = await sb.from('products').update({ public_slug: null }).eq('id', e.id); if (error) throw new Error(`${e.sku}: ${error.message}`); if (++n % 20 === 0) process.stdout.write(`\r  ${n}/${esconder.length}   `) }
  console.log(`\n[102] keepers completados ${c} · escondidos ${n} (public_slug=null, reversible)`)
}
