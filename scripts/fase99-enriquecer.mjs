/*
 * Fase 99 · Enriquecer atributos (serie, tipo, medida, largo, encastre, torque)
 * de los recategorizados que quedaron sin atributos. SECO por defecto; «apply» escribe.
 *
 * Fuentes, sin navegar en vivo:
 *   · APEX  → cruce por modelo con el crawl de apexbits (scripts/.apex/apexbits-index.json),
 *             del que se parsea el título descriptivo; + parseo del propio nombre.
 *   · resto de puntas (NORMECO/OHMI/NAC/SPEEDRILL) → parseo del nombre
 *             («3/8" SQ. A 10MM X 55», «PH2x51x1/4" HEX»).
 *   · TOHNICHI dinamométricas → el número del modelo = torque N·m (CL/QL/CEM/CLLS…).
 *   · atornilladores → «X NM», rpm del nombre/desc.
 *   · herramientas manuales → tipo (alicate/pinza/llave) + medida del nombre.
 */
import { readFileSync } from 'node:fs'

const APLICAR = process.argv[2] === 'apply'
const P = JSON.parse(readFileSync('scripts/.otros/sin-attrs.json', 'utf8'))
const apexIdx = JSON.parse(readFileSync('scripts/.apex/apexbits-index.json', 'utf8'))

const clave = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const html = (s) => (s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
const apexPorModelo = new Map()
for (const e of apexIdx) { if (e.model) apexPorModelo.set(clave(e.model), html(e.title || '')) }

// El TIPO de la punta: lo específico (Phillips/Torx/…) antes que «hex/allen»,
// porque muchas puntas son «Phillips … Hex Insert Bits» (hex = el vástago).
const TIPOS = [
  [/phillips|\bph-?\d/i, 'Phillips'],
  [/torx\s*plus|torxplus|\bip-?\d/i, 'Torx Plus'],
  [/\btorx\b|\btx-?\d/i, 'Torx'],
  [/pozidriv|\bpz-?\d/i, 'Pozidrive'],
  [/tri-?wing/i, 'Tri-Wing'],
  [/torq-?set/i, 'Torq-Set'],
  [/slotted|ranurad|\bplana\b|\bsl-?\d/i, 'Plana'],
  [/nut\s*setter|nutsetter/i, 'Nutsetter'],
  [/adapter|adaptor|adaptador/i, 'Adaptador'],
  [/extension|extensor/i, 'Extensión'],
  [/universal|u-?joint|cardan/i, 'Cardánico'],
  [/bit holder|\bholder\b|portapunta/i, 'Holder Bit'],
  [/\bsocket\b|embocadura/i, 'Embocadura'],
  [/robertson/i, 'Cuadrado'],
  [/bi-?hex|12-?point|doble hex/i, 'Bi-hexagonal'],
  [/hex insert|b\.?n\.?a\.?e|\ballen\b|hexagonal|\bhex\b/i, 'Allen'],
]
function tipoDe(txt) { for (const [re, t] of TIPOS) if (re.test(txt)) return t; return null }

function encastreDe(txt) {
  txt = txt.replace(/[′’]/g, "'")
  // fracción + (varias palabras) + «square/hex drive»: «3/8'' 8pc Square Drive»
  let m = txt.match(/(\d+\/\d+|\d+)\s*'{0,2}"?\s*(?:\d+\s*pc\s*)?(square|hex)\s*drive/i)
  if (m) return `${m[1]} ${/hex/i.test(m[2]) ? 'HEX' : 'SQ'}`
  // «1/4" Hex», «1/2'' Square», «3/8" SQ.»
  m = txt.match(/(\d+\/\d+|\d+)\s*'{1,2}"?\s*(hex|square|sq)\b/i) || txt.match(/(\d+\/\d+|\d+)\s*"\s*(hex|square|sq)\b/i)
  if (m) return `${m[1]} ${/hex/i.test(m[2]) ? 'HEX' : 'SQ'}`
  // Punta con vástago hex: «1/4'' Phillips … Hex Insert»
  m = txt.match(/(\d+\/\d+)\s*'{1,2}"?/)
  if (m && /hex insert|insert bit|power drive|hex drive|hex shank/i.test(txt)) return `${m[1]} HEX`
  // «Encastre: 1/4 HEX»
  m = txt.match(/enc(?:astre)?\.?\s*:?\s*(\d+\/\d+|\d+)\s*"?\s*(hex|sq|square)?/i)
  if (m) return `${m[1]} ${/hex/i.test(m[2] || '') ? 'HEX' : 'SQ'}`
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
  let m = txt.match(/\dx(\d{2,3})(?![\d.])/i); if (m) return m[1]      // «PH2x51» → 51
  m = txt.match(/\bx\s+(\d{2,3})\b/i); if (m) return m[1]              // «10MM X 55» → 55
  m = txt.match(/\bl\s*[:=]\s*(\d{2,3})/i); if (m) return m[1]
  m = txt.match(/largo\s*:?\s*(\d{2,3})/i); if (m) return m[1]
  m = txt.match(/longitud[^0-9]{0,8}(\d{2,3})\s*mm/i); if (m) return m[1]
  return null
}

function enriquecer(p) {
  const nom = p.name || ''; const desc = p.description || ''; const t = nom + ' ' + desc
  const m = (p.marca || '').toUpperCase()
  const patch = {}; const a = {}

  if (p.cat === 'punta') {
    let fuente = t
    if (m === 'APEX') { const ti = apexPorModelo.get(clave(p.model_code)) || apexPorModelo.get(clave(p.sku?.replace(/^AP\.?/i, ''))); if (ti) fuente = ti + ' ' + t }
    const tipo = tipoDe(fuente)
    const enc = encastreDe(fuente); const me = medidaDe(fuente); const la = largoDe(fuente)
    if (enc) a.encastre = enc
    if (me) a.medida = me
    if (la) a.largo = la
    if (tipo) { patch.series = tipo; patch.product_type = tipo }
  } else if (p.cat === 'llave-dinamometrica' && m === 'TOHNICHI') {
    // Confirmado (búsqueda web + datasheets): en las llaves TOHNICHI el número
    // del modelo es la capacidad MÁXIMA en N·m y el mínimo es ~1/5 (CEM100=20-100,
    // QL25=5-25, QL50=10-50). El número va antes o después de la serie.
    // Los DRIVERS (FTD/LTD/RTD/BTD) están en cN·m: no se decodifican (otra unidad).
    const md = (p.model_code || nom).toUpperCase().replace(/[^A-Z0-9]/g, '')
    const mx = (desc.match(/torque\s*max\s*:?\s*([\d.,]+)/i) || [])[1]
    const mn = (desc.match(/torque\s*min\s*:?\s*([\d.,]+)/i) || [])[1]
    if (mx) { a.torq_max = parseFloat(mx.replace(',', '.')); if (mn) a.torq_min = parseFloat(mn.replace(',', '.')) }
    else if (!/FTD|LTD|RTD|BTD/.test(md)) {
      const SER = 'CLLS|CLE|CLT|CLL|CL|QLE|QSP|QL|PCL|YCL|CEM|CDB|DOTE|DOT|CSP|DBE|DB|CMB|MTQL'
      const m1 = md.match(new RegExp('^(\\d{1,4})(' + SER + ')'))
      const m2 = md.match(new RegExp('(' + SER + ')(\\d{1,4})'))
      let n = null, serie = null
      if (m1) { n = parseInt(m1[1], 10); serie = m1[2] }
      else if (m2) { n = parseInt(m2[2], 10); serie = m2[1] }
      if (n && n > 0 && n <= 5000) { a.torq_max = n; if (/CL|QL|PCL|YCL/.test(serie)) a.torq_min = Math.round(n / 5 * 10) / 10 }
    }
  } else if (p.cat === 'atornillador' || p.cat === 'llave-de-impacto') {
    const rp = t.match(/([\d.,]+)\s*[-a]\s*([\d.,]+)\s*nm/i); if (rp) { a.torq_min = parseFloat(rp[1].replace(',', '.')); a.torq_max = parseFloat(rp[2].replace(',', '.')) }
    if (a.torq_max == null) { const u = t.match(/([\d.,]+)\s*nm\b/i); if (u) a.torq_max = parseFloat(u[1].replace(',', '.')) }
    const rpm = (t.match(/([\d.,]+)\s*rpm/i) || [])[1]; if (rpm) a.rpm = String(parseInt(rpm.replace(/[.,]/g, ''), 10))
    if (/neumatic|pneumatic|\bcfm\b/i.test(t)) a.alimentacion = 'Neumático'
    else if (/bateria|battery|litio|cordless|inalambric|\b\d{2}v\b/i.test(t)) a.alimentacion = 'Batería'
  } else if (p.cat === 'herramientas-manuales') {
    const tipo = /alicate|pinza/i.test(t) ? 'Alicate' : /llave ajustable/i.test(t) ? 'Llave ajustable' : /llave combinada/i.test(t) ? 'Llave combinada' : /martillo/i.test(t) ? 'Martillo' : /destornillador/i.test(t) ? 'Destornillador' : /\bmaza\b/i.test(t) ? 'Maza' : null
    if (tipo) { patch.series = tipo; patch.product_type = tipo }
    const me = (t.match(/\b(\d+(?:[.,]\d+)?)\s*(?:mm|")/i) || t.match(/\b(\d+)\s*pulgada/i) || [])[1]
    if (me) a.medida = /pulgada|"/.test(t) ? `${me}"` : `${me} mm`
  }
  if (Object.keys(a).length) patch.attributes = a
  return Object.keys(patch).length ? { id: p.id, patch } : null
}

const cob = {}, muestras = {}, filas = []
for (const p of P) {
  cob[p.cat] ??= { total: 0, enriq: 0 }; cob[p.cat].total++
  const r = enriquecer(p)
  if (r) { cob[p.cat].enriq++; filas.push(r); (muestras[p.cat] ??= []).push(`${(p.name || '').slice(0, 42)} → ${JSON.stringify(r.patch)}`) }
}
console.log('\n══ ENRIQUECIMIENTO ══')
for (const [c, v] of Object.entries(cob)) console.log(`  ${c}: ${v.enriq}/${v.total}`)
console.log('\n══ MUESTRAS ══')
for (const c of Object.keys(muestras)) { console.log(`\n-- ${c} --`); for (const s of muestras[c].slice(0, 5)) console.log('   ' + s) }
console.log(`\n[99] a enriquecer: ${filas.length}`)

if (APLICAR) {
  const { createClient } = await import('@supabase/supabase-js')
  const rd = (f) => Object.fromEntries(readFileSync(f, 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((mm) => [mm[1], mm[2].replace(/^["']|["']$/g, '').trim()]))
  const env = rd('.env'), mig = rd('.env.migration')
  const sb = createClient(env.VITE_SUPABASE_URL, mig.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
  let n = 0
  for (const f of filas) { const { error } = await sb.from('products').update(f.patch).eq('id', f.id); if (error) throw new Error(`${f.id}: ${error.message}`); if (++n % 200 === 0) process.stdout.write(`\r  ${n}/${filas.length}   `) }
  console.log(`\n[99] enriquecidos ${n}`)
}
