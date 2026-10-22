/*
 * Fase 97 · Decodificador por marca/descripción para lo que quedó en «Otros».
 * Por defecto SECO (reporte); con «apply» ESCRIBE categoría + atributos.
 *   node fase97-decodificar.mjs           → reporte
 *   node fase97-decodificar.mjs apply     → aplica a la base
 *
 * Los pendientes (TOHNICHI, FIAM, APEX, sin-marca) SÍ traen los datos, pero en
 * formatos que el parser general no leía: APEX usa «Tipo:»/«Encastre:», FIAM
 * «Rango de par (Nm) 3 - 8» y «Velocidad en vacío (rpm)», y TOHNICHI codifica el
 * torque en el modelo (CEM50N3 = 50 Nm) y tiene muchos «RATCHET HEAD» (repuestos).
 */
import { readFileSync } from 'node:fs'

const APLICAR = process.argv[2] === 'apply'
const P = JSON.parse(readFileSync('scripts/.otros/otros.json', 'utf8'))
const plan = JSON.parse(readFileSync('scripts/.otros/plan.json', 'utf8'))
const planDe = Object.fromEntries(plan.map((p) => [p.id, p]))
// Pendientes: los que NO se aplicaron (no están en plan, o quedaron en 'baja')
const pend = P.filter((p) => !planDe[p.id] || planDe[p.id].conf === 'baja')

const CAT = {
  punta: 'eff7ce37-309a-4c5e-b821-2a35171e466f',
  balanceador: 'b2fc8c6a-c7a3-4347-9db1-436810a2c110',
  atornillador: '7b4e3c20-6a62-40f5-b1f1-0d083e220909',
  accesorio: '60cd4c62-fa25-43e8-9f31-97dc6879e553',
  'llave-de-impacto': '72adcdc5-0d13-4c68-9076-bf64affac200',
  remachadora: 'e52b14a7-8193-429b-b0e8-4c0d5b20a46a',
  'llave-dinamometrica': 'b15b463a-4f6a-40ad-a7bd-a15e29ce856b',
  repuestos: 'dfb8fb9d-8941-49ce-9843-bbcc60cc175a',
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
function num(s) {
  if (s == null) return null
  let x = String(s).trim().replace(/[^\d.,]/g, ''); if (x === '') return null
  if (x.includes(',')) { const m = x.match(/,(\d+)$/); if (m && m[1].length === 3) return parseInt(x.replace(/[.,]/g, ''), 10); return parseFloat(x.replace(/\./g, '').replace(',', '.')) }
  const miles = x.match(/^(\d{1,3})\.(\d{3})$/); if (miles) return parseInt(miles[1] + miles[2], 10)
  const n = parseFloat(x); return Number.isFinite(n) ? n : null
}
function encastre(raw) { if (!raw) return null; const f = String(raw).match(/(\d+(?:\/\d+)?)/); if (!f) return null; const tipo = /hex/i.test(raw) ? 'HEX' : /sq|cuadrad|square|\bdr\b/i.test(raw) ? 'SQ' : 'SQ'; return `${f[1]} ${tipo}` }
function medida(raw) { if (!raw) return null; raw = raw.trim().replace(/\s*de\s*\d+\s*puntos.*/i, ''); const mm = raw.match(/^(\d+(?:[.,]\d+)?)\s*mm/i); if (mm) return mm[1].replace(',', '.'); const tok = raw.match(/^(tx\s*\d+|t\d+|\d+\/\d+"?|#?\d+(?:[.,]\d+)?|[\d.]+"?)/i); return tok ? tok[1].replace(/\s+/g, '').replace(',', '.') : null }
const largoMm = (raw) => { const n = num(raw); return n == null ? null : String(n) }

const PARTE = /ratchet head|\blever\b|plug-?in|para\s+qsp|para\s+riv|o-?ring|\bmordaza\b|\bresorte\b|repuesto|rivit\.rep|\brep\b\.?|empaque|sufridera|boquilla|\bmuela\b|\bjaw\b|\bseal\b|\bgasket\b|\bpos\b\.? ?\d|washer|arandela|\bspring\b|\bcono\b|\bcollar\b|conector|connector/i
const HERRAMIENTA = /\b(pistol|angle|straight|inline)\s+tool\b|nutrunner|atornillador|aprietatuerca/i

function procesar(p) {
  const desc = p.description || ''
  const t = norm(p.name + ' ' + desc)
  const m = (p.marca || '').toUpperCase()
  const L = (re) => { const mm = desc.match(re); return mm ? mm[1].trim() : null }
  let cat = null

  // 1 · Herramienta por frase clara (antes que repuestos, para no confundir un
  //     nutrunner con un repuesto por una palabra suelta de la descripción)
  if (HERRAMIENTA.test(t) && !/\bpara\s|repuesto|rivit\.rep/i.test(t)) cat = 'atornillador'

  // 2 · Partes / repuestos (fuerte)
  if (!cat && PARTE.test(t)) cat = 'repuestos'

  // 2 · «Tipo:» declarado en la descripción
  if (!cat) {
    const tipo = norm(L(/tipo\s*:?\s*([^\n]+)/i) || '')
    if (/allen|torx|phillips|pozidriv|plana|hexagonal|cuadrad|embocadura|\btubo\b|\bbit\b|\bpunta\b|nutsetter|cardan|adaptador|extension|holder/.test(tipo)) cat = 'punta'
    else if (/dinamom|torque wrench|torquimetro/.test(tipo)) cat = 'llave-dinamometrica'
    else if (/atornillador|nutrunner|destornillador|aprietatuerca/.test(tipo)) cat = 'atornillador'
    else if (/impacto|impact/.test(tipo)) cat = 'llave-de-impacto'
    else if (/remachadora/.test(tipo)) cat = 'remachadora'
    else if (/balanceador|balancer|equilibrador/.test(tipo)) cat = 'balanceador'
  }

  // 3 · Decodificar por marca
  const modelo = (p.model_code || p.name || '')
  if (!cat && m === 'TOHNICHI') {
    cat = /\b(cem|cl|ql|qle|qsp|csp|rtd|rsp|mtqln|ltd|at|cmt|ful|f|fh|n)\d/i.test(modelo) || /torque\s*max/i.test(desc) ? 'llave-dinamometrica' : 'repuestos'
  }
  if (!cat && m === 'FIAM') {
    if (/socket/i.test(t)) cat = 'punta'
    else if (/rango de par|velocidad en vac|atornillador|screwdriver|nm\)/i.test(desc)) cat = 'atornillador'
  }
  if (!cat && m === 'APEX') cat = 'punta'
  if (!cat && m === 'ESTIC') {
    if (/charger|cargador|battery|bateria|power cord|\bcable\b/i.test(t)) cat = 'accesorio'
    else if (/\btool\b|\bnm\b|torque|angular|pistol|straight/i.test(t)) cat = 'atornillador'
  }
  if (!cat) return null

  // 4 · Atributos
  const a = {}
  const enc = encastre(L(/encastre\s*:?\s*([^\n]+)/i) || L(/(?:square|output)\s*drive[^\n]*?(\d+(?:\/\d+)?)/i))
  if (enc) a.encastre = enc
  if (cat === 'punta') {
    const me = medida(L(/medida\s*:?\s*([^\n]+)/i)); if (me) a.medida = me
    const la = largoMm(L(/(?:largo|longitud(?:\s+total)?)\s*:?\s*([^\n]+)/i)); if (la) a.largo = la
  }
  if (cat === 'atornillador' || cat === 'llave-dinamometrica' || cat === 'llave-de-impacto') {
    // Rango de par (FIAM): «Rango de par (Nm) 3 - 8»
    const rp = desc.match(/rango de par[^\n]*?([\d.,]+)\s*[-a]\s*([\d.,]+)/i)
    if (rp) { a.torq_min = num(rp[1]); a.torq_max = num(rp[2]) }
    const mn = num(L(/torque\s*min\s*:?\s*([\d.,]+)/i)); if (mn != null) a.torq_min = mn
    const mx = num(L(/torque\s*max\s*:?\s*([\d.,]+)/i)); if (mx != null) a.torq_max = mx
    // Rango en el nombre o texto: «DE 3 A 8 NM», «5-25 Nm»
    if (a.torq_max == null) { const r2 = (p.name + ' ' + desc).match(/([\d.,]+)\s*[-a]\s*([\d.,]+)\s*nm/i); if (r2) { a.torq_min = num(r2[1]); a.torq_max = num(r2[2]) } }
    // Modelo TOHNICHI: CEM50N3 → 50 Nm
    if (a.torq_max == null && m === 'TOHNICHI') { const md = modelo.match(/[a-z]{2,}(\d+)n\d/i); if (md) a.torq_max = num(md[1]) }
    // RPM: «Velocidad en vacío (rpm) 2000», «rpm 840», «7000rpm»
    const rpm = num(L(/velocidad[^\n]*?\(?\s*rpm\s*\)?\s*[:\-]?\s*([\d.,]+)/i) || L(/(?:free speed|velocidad libre)\s*[:\-]?\s*(?:rpm\s*)?([\d.,]+)/i) || L(/([\d.,]+)\s*rpm/i))
    if (rpm != null) a.rpm = String(rpm)
    if (/neumatic|pneumatic|\bair\b|\baire\b|\bcfm\b|rpm/i.test(t) && m === 'FIAM') a.alimentacion = 'Neumático'
    else if (/neumatic|pneumatic|\bcfm\b/i.test(t)) a.alimentacion = 'Neumático'
    else if (/bateria|battery|litio|li-?ion|cordless|inalambric/i.test(t)) a.alimentacion = 'Batería'
  }
  if (cat === 'balanceador') {
    const mn = num(L(/capacidad\s*min[^\n:]*:?\s*([\d.,]+)/i)); if (mn != null) a.min_kg = mn
    const mx = num(L(/capacidad\s*max[^\n:]*:?\s*([\d.,]+)/i)); if (mx != null) a.max_kg = mx
  }
  if (cat === 'remachadora') { const cap = L(/(?:hasta|mayor a)\s*d?\s*([\d.,]+)\s*mm/i); if (cap) a.medida = cap.replace(',', '.') }

  return { cat, attributes: a }
}

const porCat = {}, muestras = {}, filas = []
let conAttr = 0
for (const p of pend) {
  const r = procesar(p)
  if (!r) { porCat['(sigue en otros)'] = (porCat['(sigue en otros)'] || 0) + 1; continue }
  porCat[r.cat] = (porCat[r.cat] || 0) + 1
  if (Object.keys(r.attributes).length) conAttr++
  filas.push({ id: p.id, cat: r.cat, attributes: r.attributes })
  ;(muestras[r.cat] ??= []).push(`${(p.name || '').slice(0, 46)} → ${JSON.stringify(r.attributes)}`)
}

console.log('\n══ DECODIFICADO (pendientes: ' + pend.length + ') ══')
for (const [c, n] of Object.entries(porCat).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${c}`)
console.log(`\n  A mover: ${filas.length} · con atributos: ${conAttr}`)
console.log('\n══ MUESTRAS ══')
for (const c of Object.keys(muestras)) { console.log(`\n-- ${c} --`); for (const s of muestras[c].slice(0, 4)) console.log('   ' + s) }

if (APLICAR) {
  const { createClient } = await import('@supabase/supabase-js')
  const rd = (f) => Object.fromEntries(readFileSync(f, 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((mm) => [mm[1], mm[2].replace(/^["']|["']$/g, '').trim()]))
  const env = rd('.env'), mig = rd('.env.migration')
  const sb = createClient(env.VITE_SUPABASE_URL, mig.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
  let n = 0
  for (const f of filas) {
    const patch = { category_id: CAT[f.cat] }
    if (Object.keys(f.attributes).length) patch.attributes = f.attributes
    const { error } = await sb.from('products').update(patch).eq('id', f.id)
    if (error) throw new Error(`${f.id}: ${error.message}`)
    if (++n % 300 === 0) process.stdout.write(`\r  ${n}/${filas.length}   `)
  }
  console.log(`\n[97] aplicados ${n} (categoría + atributos)`)
}
