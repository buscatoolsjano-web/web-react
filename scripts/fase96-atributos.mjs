/*
 * Fase 96 · Extraer atributos de la descripción para los productos
 * recategorizados de «Otros» (Buscatools). Por defecto SECO (reporte); con
 * «apply» ESCRIBE products.attributes.
 *   node fase96-atributos.mjs           → reporte + scripts/.otros/attrs.json
 *   node fase96-atributos.mjs apply     → además actualiza la base
 *
 * La mayoría de las descripciones traen los atributos ETIQUETADOS
 * («Encastre:», «Torque Min:», «Max. Par - Nm», «Square Drive», «Capacidad min
 * (kg):»), así que se extraen por etiqueta y se normalizan al formato que ya
 * usa el catálogo (encastre «1/2 SQ», largo en mm, torque en Nm).
 */
import { readFileSync } from 'node:fs'

const APLICAR = process.argv[2] === 'apply'
const P = JSON.parse(readFileSync('scripts/.otros/otros.json', 'utf8'))
const plan = JSON.parse(readFileSync('scripts/.otros/plan.json', 'utf8'))
const catDe = Object.fromEntries(plan.map((p) => [p.id, p.cat]))

// ── Helpers de parseo ────────────────────────────────────────────────────────
const linea = (t, re) => { const m = t.match(re); return m ? m[1].trim() : null }
function num(s) {
  if (s == null) return null
  let x = String(s).trim().replace(/[^\d.,]/g, '')
  if (x === '') return null
  if (x.includes(',')) {
    const m = x.match(/,(\d+)$/)
    if (m && m[1].length === 3) return parseInt(x.replace(/[.,]/g, ''), 10) // «2,000» = 2000 (coma de miles)
    return parseFloat(x.replace(/\./g, '').replace(',', '.'))                // «2,5» = 2.5 (coma decimal)
  }
  const miles = x.match(/^(\d{1,3})\.(\d{3})$/) // «1.350» = 1350
  if (miles) return parseInt(miles[1] + miles[2], 10)
  const n = parseFloat(x); return Number.isFinite(n) ? n : null
}
function encastre(raw) {
  if (!raw) return null
  const f = String(raw).match(/(\d+(?:\/\d+)?)/); if (!f) return null
  const tipo = /hex/i.test(raw) ? 'HEX' : /sq|cuadrad|square|\bdr\b/i.test(raw) ? 'SQ' : 'SQ'
  return `${f[1]} ${tipo}`
}
function medida(raw) {
  if (!raw) return null
  raw = raw.trim().replace(/\s*de\s*\d+\s*puntos.*/i, '')
  const mm = raw.match(/^(\d+(?:[.,]\d+)?)\s*mm/i); if (mm) return mm[1].replace(',', '.')
  const tok = raw.match(/^(tx\s*\d+|t\d+|\d+\/\d+"?|#?\d+(?:[.,]\d+)?|[\d.]+"?)/i)
  return tok ? tok[1].replace(/\s+/g, '').replace(',', '.') : null
}
const largoMm = (raw) => { const n = num(raw); return n == null ? null : String(n) }

function atributosDe(p) {
  const cat = catDe[p.id]
  const d = (p.name || '') + '\n' + (p.description || '')
  const a = {}

  if (cat === 'punta') {
    const e = encastre(linea(d, /encastre\s*:?\s*([^\n]+)/i) || linea(d, /square drive[^\n]*?(\d+(?:\/\d+)?)/i))
    if (e) a.encastre = e
    const me = medida(linea(d, /medida\s*:?\s*([^\n]+)/i))
    if (me) a.medida = me
    const la = largoMm(linea(d, /(?:largo|longitud(?:\s+total)?)\s*:?\s*([^\n]+)/i))
    if (la) a.largo = la
  } else if (cat === 'atornillador' || cat === 'llave-de-impacto') {
    const max = num(linea(d, /(?:max\.?\s*(?:par|torque)[^\n]*?-?\s*nm|torque\s*max|torque)\s*:?\s*-?\s*([\d.,]+)/i))
    if (max != null) a.torq_max = max
    const rango = d.match(/torque\s*range[^\n]*?nm\s*([\d.,]+)\s*-\s*([\d.,]+)/i)
    if (rango) { a.torq_min = num(rango[1]); a.torq_max = num(rango[2]) }
    const mn = num(linea(d, /torque\s*min\s*:?\s*([\d.,]+)/i)); if (mn != null) a.torq_min = mn
    if (a.torq_max == null) { const nm = (p.name || '').match(/([\d.,]+)\s*nm\b/i); if (nm) a.torq_max = num(nm[1]) }
    const rpm = num(linea(d, /(?:free speed|velocidad libre|velocidad)\s*[:\-]?\s*(?:rpm\s*)?([\d.,]+)/i) || linea(d, /([\d.,]+)\s*rpm/i))
    if (rpm != null) a.rpm = String(rpm)
    const e = encastre(linea(d, /(?:square drive|output drive)[^\n]*?(\d+(?:\/\d+)?)/i) || linea(d, /encastre\s*:?\s*([^\n]+)/i))
    if (e) a.encastre = e
    if (/neumatic|pneumatic|\bair\b|\baire\b|\bcfm\b/i.test(d)) a.alimentacion = 'Neumático'
    else if (/bateria|battery|litio|li-?ion|cordless|inalambric/i.test(d)) a.alimentacion = 'Batería'
    else if (/electric|electric|\bac\b|\d{2,3}\s*v\b/i.test(d)) a.alimentacion = 'Eléctrico'
  } else if (cat === 'llave-dinamometrica') {
    const mn = num(linea(d, /torque\s*min\s*:?\s*([\d.,]+)/i)); if (mn != null) a.torq_min = mn
    const mx = num(linea(d, /torque\s*max\s*:?\s*([\d.,]+)/i)); if (mx != null) a.torq_max = mx
    const rango = d.match(/(?:de\s*)?([\d.,]+)\s*(?:a|-)\s*([\d.,]+)\s*nm/i)
    if (rango && a.torq_min == null && a.torq_max == null) { a.torq_min = num(rango[1]); a.torq_max = num(rango[2]) }
    const e = encastre(linea(d, /encastre\s*:?\s*([^\n]+)/i)); if (e) a.encastre = e
  } else if (cat === 'balanceador') {
    const mn = num(linea(d, /capacidad\s*min[^\n:]*:?\s*([\d.,]+)/i)); if (mn != null) a.min_kg = mn
    const mx = num(linea(d, /capacidad\s*max[^\n:]*:?\s*([\d.,]+)/i)); if (mx != null) a.max_kg = mx
    const rango = d.match(/([\d.,]+)\s*a\s*([\d.,]+)\s*kg/i)
    if (rango && a.min_kg == null) { a.min_kg = num(rango[1]); a.max_kg = num(rango[2]) }
  } else if (cat === 'remachadora') {
    const cap = linea(d, /(?:hasta|mayor a)\s*d?\s*([\d.,]+)\s*mm/i)
    if (cap) a.medida = cap.replace(',', '.')
  }
  return a
}

const TOOLS = new Set(['punta', 'atornillador', 'llave-dinamometrica', 'llave-de-impacto', 'balanceador', 'remachadora'])
const cob = {}, muestras = {}
const filas = []
for (const p of P) {
  const cat = catDe[p.id]
  if (!TOOLS.has(cat)) continue
  const a = atributosDe(p)
  cob[cat] ??= { total: 0, con: 0, claves: {} }
  cob[cat].total++
  if (Object.keys(a).length) {
    cob[cat].con++
    for (const k of Object.keys(a)) cob[cat].claves[k] = (cob[cat].claves[k] || 0) + 1
    filas.push({ id: p.id, attributes: a })
    ;(muestras[cat] ??= []).push(`${(p.name || '').slice(0, 48)} → ${JSON.stringify(a)}`)
  }
}

console.log('\n══ COBERTURA DE ATRIBUTOS ══')
for (const [c, v] of Object.entries(cob)) {
  console.log(`  ${c}: ${v.con}/${v.total} con atributos · claves ${JSON.stringify(v.claves)}`)
}
console.log('\n══ MUESTRAS ══')
for (const c of Object.keys(muestras)) {
  console.log(`\n-- ${c} --`)
  for (const s of muestras[c].slice(0, 4)) console.log('   ' + s)
}
console.log(`\n[96] productos con atributos: ${filas.length}`)

if (APLICAR) {
  const { createClient } = await import('@supabase/supabase-js')
  const rd = (f) => Object.fromEntries(readFileSync(f, 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '').trim()]))
  const env = rd('.env'), mig = rd('.env.migration')
  const sb = createClient(env.VITE_SUPABASE_URL, mig.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
  let n = 0
  for (const f of filas) {
    const { error } = await sb.from('products').update({ attributes: f.attributes }).eq('id', f.id)
    if (error) throw new Error(`${f.id}: ${error.message}`)
    if (++n % 200 === 0) process.stdout.write(`\r  ${n}/${filas.length}   `)
  }
  console.log(`\n[96] atributos aplicados a ${n} productos`)
}
