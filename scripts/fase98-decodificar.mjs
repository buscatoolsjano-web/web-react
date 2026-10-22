/*
 * Fase 98 · Decodificador AMPLIO del resto de «Otros» de Buscatools.
 * Corre sobre el otros.json actual (ya reducido). SECO por defecto; «apply» escribe.
 *   node fase98-decodificar.mjs           → reporte
 *   node fase98-decodificar.mjs apply     → aplica categoría + atributos
 *
 * Suma lo que faltaba: seguridad (guantes/zapatos), mobiliario (armarios),
 * herramientas manuales (llaves combinadas, pinzas), y afina repuestos (partes
 * Mercedes/Ingersoll: cylinder, rotor, head, assembly) vs herramientas.
 */
import { readFileSync } from 'node:fs'

const APLICAR = process.argv[2] === 'apply'
const P = JSON.parse(readFileSync('scripts/.otros/otros.json', 'utf8'))

const CAT = {
  punta: 'eff7ce37-309a-4c5e-b821-2a35171e466f',
  balanceador: 'b2fc8c6a-c7a3-4347-9db1-436810a2c110',
  atornillador: '7b4e3c20-6a62-40f5-b1f1-0d083e220909',
  accesorio: '60cd4c62-fa25-43e8-9f31-97dc6879e553',
  'llave-de-impacto': '72adcdc5-0d13-4c68-9076-bf64affac200',
  remachadora: 'e52b14a7-8193-429b-b0e8-4c0d5b20a46a',
  'llave-dinamometrica': 'b15b463a-4f6a-40ad-a7bd-a15e29ce856b',
  repuestos: 'dfb8fb9d-8941-49ce-9843-bbcc60cc175a',
  seguridad: '2b741519-0a68-4559-93e3-ef7c3bace0c4',
  automatizacion: 'd91b5f87-7ec1-427b-b9a7-4ed2ac7caf5c',
  'herramientas-manuales': 'e48e845a-6952-4b0c-871d-f117b698d5be',
  mobiliario: '44e7f647-6249-479c-86d1-1e8cca828328',
}

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
function num(s) { if (s == null) return null; let x = String(s).trim().replace(/[^\d.,]/g, ''); if (x === '') return null; if (x.includes(',')) { const m = x.match(/,(\d+)$/); if (m && m[1].length === 3) return parseInt(x.replace(/[.,]/g, ''), 10); return parseFloat(x.replace(/\./g, '').replace(',', '.')) } const mi = x.match(/^(\d{1,3})\.(\d{3})$/); if (mi) return parseInt(mi[1] + mi[2], 10); const n = parseFloat(x); return Number.isFinite(n) ? n : null }
function encastre(raw) { if (!raw) return null; const f = String(raw).match(/(\d+(?:\/\d+)?)/); if (!f) return null; const tipo = /hex/i.test(raw) ? 'HEX' : 'SQ'; return `${f[1]} ${tipo}` }
function medida(raw) { if (!raw) return null; raw = raw.trim().replace(/\s*de\s*\d+\s*puntos.*/i, ''); const mm = raw.match(/^(\d+(?:[.,]\d+)?)\s*mm/i); if (mm) return mm[1].replace(',', '.'); const tok = raw.match(/^(tx\s*\d+|t\d+|\d+\/\d+"?|#?\d+(?:[.,]\d+)?|[\d.]+"?)/i); return tok ? tok[1].replace(/\s+/g, '').replace(',', '.') : null }
const largoMm = (raw) => { const n = num(raw); return n == null ? null : String(n) }

const SEGURIDAD = /guante|zapato|calzado|\bbota\b|\bbotas\b|casco|antiparra|gafas de seg|protector auditivo|protector facial|\bmascara\b|respirador|\barnes\b|chaleco|mameluco|protector ocular|tapon(?:es)? auditivo|barbijo/i
const MOBILIARIO = /armario|estanteria|gabinete|carro (?:de |porta)|banco de trabajo|perchero|organizador de|porta herramienta|tool ?cabinet|workbench/i
const MANUAL = /llave combinada|llave fija|llave ajustable|llave estria|llave inglesa|llave allen set|juego de llaves|\bpinza\b|alicate|tenaza|\bmartillo\b|\bmaza\b|\bcrique\b|manija de fuerza|\bcincel\b|\blima\b|formon|destornillador manual|\bllave de tubo\b|llave corona/i
const PARTE = /ratchet head|\blever\b|plug-?in|para\s+qsp|para\s+riv|o-?ring|\bmordaza\b|\bresorte\b|repuesto|rivit\.rep|\brep\b\.?|empaque|sufridera|boquilla|\bmuela\b|\bjaw\b|\bseal\b|\bgasket\b|\bpos\b\.? ?\d|washer|arandela|\bspring\b|\bcono\b|\bcollar\b|conector|connector|\bcylinder\b|\brotor\b|\bpiston\b|\bvalve\b|\bsleeve\b|backcap|assembly|bushing|bearing|rodamiento|front plate|\bwiper\b|parte nro|part no|spare/i
const TOOLPOWER = /nutrunner|atornillador|aprietatuerca|transducerized|\b(pistol|angle|straight|inline)\s+tool\b|power (?:nutrunner|screwdriver)/i

function procesar(p) {
  const desc = p.description || ''
  const t = norm(p.name + ' ' + desc)
  const m = (p.marca || '').toUpperCase()
  const L = (re) => { const mm = desc.match(re); return mm ? mm[1].trim() : null }
  let cat = null

  if (/\bsoftware\b|license|activation|licencia/i.test(t)) return null // software → queda en otros
  if (SEGURIDAD.test(t)) cat = 'seguridad'
  else if (MOBILIARIO.test(t)) cat = 'mobiliario'
  else if (MANUAL.test(t)) cat = 'herramientas-manuales'
  else if (/\bremachadora\b|riveter/i.test(t)) cat = 'remachadora'
  else if (/balancer|balanceador|equilibrador/i.test(t)) cat = 'balanceador'
  else if (/impact wrench|llave de impacto/i.test(t)) cat = 'llave-de-impacto'
  else if (/torque wrench|llave dinamom|dinamom[ei]tric|torquimetro/i.test(t)) cat = 'llave-dinamometrica'
  else if (TOOLPOWER.test(t) && !/\bpara\s|repuesto/i.test(t)) cat = 'atornillador'
  else if (/(?:angular|pistola|recto|inline)\b/i.test(t) && /\d+\s*(?:a|-)\s*\d+\s*nm/i.test(t) && !/\bpara\s|repuesto/i.test(t)) cat = 'atornillador'
  else if (PARTE.test(t)) cat = 'repuestos'
  else if (/\bsocket\b|embocadura|nutsetter|\bvaso\b|\bdado\b|holder bit|\bbit holder\b|insert bit|magnet holder|\bbits?\b/i.test(t)) cat = 'punta'
  else if (/\bextension\b|\bcardan/i.test(t)) cat = 'punta'
  else if (/\badaptador\b|\badapter\b/i.test(t)) cat = 'punta'
  else if (/\bcable\b|cargador|charger|bateria|battery|power (?:cord|adapter|supply)|\bfuente\b|\bfunda\b|\bsoporte\b/i.test(t)) cat = 'accesorio'

  // «Tipo:» de la descripción como último recurso
  if (!cat) {
    const tipo = norm(L(/tipo\s*:?\s*([^\n]+)/i) || '')
    if (/allen|torx|phillips|pozidriv|plana|hexagonal|cuadrad|embocadura|\btubo\b|\bbit\b|nutsetter|cardan|adaptador|extension|holder/.test(tipo)) cat = 'punta'
    else if (/dinamom|torquimetro/.test(tipo)) cat = 'llave-dinamometrica'
    else if (/atornillador|nutrunner|aprietatuerca/.test(tipo)) cat = 'atornillador'
    else if (/impacto|impact/.test(tipo)) cat = 'llave-de-impacto'
  }
  if (!cat) return null

  // ── Atributos ──────────────────────────────────────────────────────────────
  const a = {}
  const enc = encastre(L(/encastre\s*:?\s*([^\n]+)/i) || L(/enc\.?\s*(\d+\/\d+)/i) || L(/(?:square|output)\s*drive[^\n]*?(\d+(?:\/\d+)?)/i))
  if (enc) a.encastre = enc
  if (cat === 'punta' || cat === 'herramientas-manuales') {
    const me = medida(L(/medida\s*:?\s*([^\n]+)/i) || L(/(\d+(?:[.,]\d+)?\s*mm)\b/i) || L(/\b(\d+\/\d+")/i))
    if (me) a.medida = me
    const la = largoMm(L(/(?:largo|longitud(?:\s+total)?)\s*:?\s*([^\n]+)/i)); if (la) a.largo = la
  }
  if (cat === 'atornillador' || cat === 'llave-dinamometrica' || cat === 'llave-de-impacto') {
    const rp = desc.match(/rango de par[^\n]*?([\d.,]+)\s*[-a]\s*([\d.,]+)/i); if (rp) { a.torq_min = num(rp[1]); a.torq_max = num(rp[2]) }
    const mn = num(L(/torque\s*min\s*:?\s*([\d.,]+)/i)); if (mn != null) a.torq_min = mn
    const mx = num(L(/torque\s*max\s*:?\s*([\d.,]+)/i)); if (mx != null) a.torq_max = mx
    if (a.torq_max == null) { const r2 = t.match(/([\d.,]+)\s*[-a]\s*([\d.,]+)\s*nm/i); if (r2) { a.torq_min = num(r2[1]); a.torq_max = num(r2[2]) } }
    if (a.torq_max == null) { const u = t.match(/([\d.,]+)\s*nm\b/i); if (u) a.torq_max = num(u[1]) }
    const rpm = num(L(/velocidad[^\n]*?\(?\s*rpm\s*\)?\s*[:\-]?\s*([\d.,]+)/i) || L(/(?:free speed|velocidad libre)\s*[:\-]?\s*(?:rpm\s*)?([\d.,]+)/i) || L(/([\d.,]+)\s*rpm/i))
    if (rpm != null) a.rpm = String(rpm)
    if (/neumatic|pneumatic|\bcfm\b|\baire\b/i.test(t)) a.alimentacion = 'Neumático'
    else if (/bateria|battery|litio|li-?ion|cordless|inalambric/i.test(t)) a.alimentacion = 'Batería'
  }
  if (cat === 'balanceador') { const mn = num(L(/capacidad\s*min[^\n:]*:?\s*([\d.,]+)/i)); if (mn != null) a.min_kg = mn; const mx = num(L(/capacidad\s*max[^\n:]*:?\s*([\d.,]+)/i)); if (mx != null) a.max_kg = mx }
  return { cat, attributes: a }
}

const porCat = {}, muestras = {}, filas = []
let conAttr = 0
for (const p of P) {
  const r = procesar(p)
  if (!r) { porCat['(sigue en otros)'] = (porCat['(sigue en otros)'] || 0) + 1; continue }
  porCat[r.cat] = (porCat[r.cat] || 0) + 1
  if (Object.keys(r.attributes).length) conAttr++
  filas.push({ id: p.id, cat: r.cat, attributes: r.attributes })
  ;(muestras[r.cat] ??= []).push(`${(p.name || '').slice(0, 44)} → ${JSON.stringify(r.attributes)}`)
}

console.log('\n══ DECODIFICADO FASE 98 (otros: ' + P.length + ') ══')
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
  console.log(`\n[98] aplicados ${n}`)
}
