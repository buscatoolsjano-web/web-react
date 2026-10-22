/*
 * Fase 100 · Completar TODOS los atributos de la línea APEX desde el crawl de
 * apexbits (serie, tipo, encastre, medida, largo). SECO por defecto; «apply» escribe.
 *   node fase100-apex-enriquecer.mjs          → reporte + lista de sin-match (para web)
 *   node fase100-apex-enriquecer.mjs apply
 *
 * El título de apexbits trae todo: «30MM15-D Apex 30mm 12-Point … Socket, 1/2'' Square».
 * Se mergea: lo que ya está no se pisa, se completan los campos que faltan.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const rd = (f) => Object.fromEntries(readFileSync(f, 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '').trim()]))
const env = rd('.env'), mig = rd('.env.migration')
const sb = createClient(env.VITE_SUPABASE_URL, mig.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
const CID = 'bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c'
const APLICAR = process.argv[2] === 'apply'

const idx = JSON.parse(readFileSync('scripts/.apex/apexbits-index.json', 'utf8'))
const clave = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const html = (s) => (s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
const byModel = new Map()
for (const e of idx) if (e.model) byModel.set(clave(e.model), html(e.title || ''))

const TIPOS = [
  [/phillips|\bph-?\d/i, 'Phillips'], [/torx\s*plus|torxplus|\bip-?\d/i, 'Torx Plus'], [/\btorx\b|\btx-?\d/i, 'Torx'],
  [/pozidriv|\bpz-?\d/i, 'Pozidrive'], [/tri-?wing/i, 'Tri-Wing'], [/torq-?set/i, 'Torq-Set'],
  [/slotted|ranurad|\bplana\b|\bsl-?\d/i, 'Plana'], [/nut\s*setter|nutsetter/i, 'Nutsetter'],
  [/adapter|adaptor|adaptador/i, 'Adaptador'], [/extension|extensor/i, 'Extensión'], [/universal|u-?joint|cardan/i, 'Cardánico'],
  [/bit holder|\bholder\b|portapunta/i, 'Holder Bit'], [/\bsocket\b|embocadura/i, 'Embocadura'],
  [/robertson/i, 'Cuadrado'], [/bi-?hex|12-?point/i, 'Bi-hexagonal'], [/hex insert|b\.?n\.?a\.?e|\ballen\b|hexagonal|\bhex\b/i, 'Allen'],
]
const tipoDe = (t) => { for (const [re, v] of TIPOS) if (re.test(t)) return v; return null }
function encastreDe(txt) {
  txt = txt.replace(/[′’]/g, "'")
  let m = txt.match(/(\d+\/\d+|\d+)\s*'{0,2}"?\s*(?:\d+\s*pc\s*)?(square|hex)\s*drive/i); if (m) return `${m[1]} ${/hex/i.test(m[2]) ? 'HEX' : 'SQ'}`
  m = txt.match(/(\d+\/\d+|\d+)\s*'{1,2}"?\s*(hex|square|sq)\b/i) || txt.match(/(\d+\/\d+|\d+)\s*"\s*(hex|square|sq)\b/i); if (m) return `${m[1]} ${/hex/i.test(m[2]) ? 'HEX' : 'SQ'}`
  m = txt.match(/(\d+\/\d+)\s*'{1,2}"?/); if (m && /hex insert|insert bit|power drive|hex drive|hex shank/i.test(txt)) return `${m[1]} HEX`
  return null
}
function medidaDe(txt) {
  let m = txt.match(/\b(\d+(?:[.,]\d+)?)\s*mm\b/i); if (m) return `${m[1].replace(',', '.')} mm`
  m = txt.match(/\b(tx|t)-?\s*(\d+)\b/i); if (m) return `TX${m[2]}`
  m = txt.match(/\bph-?\s*(\d+)/i); if (m) return `PH${m[1]}`
  m = txt.match(/\bpz-?\s*(\d+)/i); if (m) return `PZ${m[1]}`
  m = txt.match(/#(\d+)/); if (m) return `#${m[1]}`
  m = txt.match(/\b(\d+\/\d+)\s*['"]/); if (m) return `${m[1]}"`
  return null
}
function largoDe(txt) {
  let m = txt.match(/\dx(\d{2,3})(?![\d.])/i); if (m) return m[1]
  m = txt.match(/\bx\s+(\d{2,3})\b/i); if (m) return m[1]
  m = txt.match(/longitud[^0-9]{0,8}(\d{2,3})\s*mm/i); if (m) return m[1]
  return null
}

const apex = []
const { data: apexB } = await sb.from('brands').select('id').eq('company_id', CID).eq('name', 'APEX').single()
for (let d = 0; ; d += 1000) { const { data } = await sb.from('products').select('id,sku,model_code,name,description,series,product_type,attributes').eq('company_id', CID).eq('brand_id', apexB.id).eq('status', 'active').is('deleted_at', null).range(d, d + 999); apex.push(...data); if (data.length < 1000) break }

function tituloDe(p) {
  for (const k of [clave(p.model_code), clave((p.sku || '').replace(/^(AP\.?|PRO)/i, '')), clave((p.model_code || '').replace(/^0+/, ''))]) { const t = byModel.get(k); if (t) return t }
  return null
}

let completos0 = 0, mejorados = 0
const filas = [], sinMatch = []
for (const p of apex) {
  const a = { ...(p.attributes || {}) }
  const antes5 = p.series && p.product_type && a.encastre && a.medida && a.largo
  if (antes5) completos0++
  const ti = tituloDe(p)
  const fuente = (ti ? ti + ' ' : '') + (p.name || '') + ' ' + (p.description || '')
  if (!ti && !(a.encastre && a.medida)) sinMatch.push(p.sku)
  const patch = {}
  const tipo = tipoDe(fuente); if (tipo && !p.product_type) patch.product_type = tipo
  if (tipo && !p.series) patch.series = tipo
  if (!a.encastre) { const e = encastreDe(fuente); if (e) a.encastre = e }
  if (!a.medida) { const me = medidaDe(fuente); if (me) a.medida = me }
  if (!a.largo) { const la = largoDe(fuente); if (la) a.largo = la }
  if (JSON.stringify(a) !== JSON.stringify(p.attributes || {})) patch.attributes = a
  if (Object.keys(patch).length) { filas.push({ id: p.id, patch }); mejorados++ }
}
writeFileSync('scripts/.otros/apex-sinmatch.json', JSON.stringify(sinMatch))
console.log(`APEX: ${apex.length} · completos(5) antes: ${completos0} · a mejorar: ${mejorados} · sin fuente (para web): ${sinMatch.length}`)
console.log('muestra sin match:', sinMatch.slice(0, 15).join(', '))
console.log('muestra a mejorar:')
for (const f of filas.slice(0, 6)) console.log('  ', JSON.stringify(f.patch))

if (APLICAR) {
  let n = 0
  for (const f of filas) { const { error } = await sb.from('products').update(f.patch).eq('id', f.id); if (error) throw new Error(`${f.id}: ${error.message}`); if (++n % 300 === 0) process.stdout.write(`\r  ${n}/${filas.length}   `) }
  console.log(`\n[100] APEX enriquecidos ${n}`)
}
