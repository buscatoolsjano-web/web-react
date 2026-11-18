/**
 * Rango de torque de las llaves dinamométricas (torq_min / torq_max, en N·m).
 * SÓLO LEE: escribe revision/torquimetros.json con lo que cambiaría.
 *
 *   node --env-file=.env.migration scripts/torquimetros.mjs
 *
 * Fuente: Tohnichi Reference Guide 2025 (scripts/datos/tohnichi-catalogo-2025.txt,
 * pares «página|modelo|rango» sacados del PDF). Cada fila del catálogo trae el
 * modelo SI (N·m, cN·m, mN·m), el métrico (kgf·cm / kgf·m / gf·cm) y el
 * americano (lbf·in, lbf·ft, ozf·in) con su rango en SU unidad: acá todo se
 * pasa a N·m. La unidad sale del nombre (…N, …CN, …I, …F, …Z) y, cuando el
 * nombre no la dice (900QL4, 2800QL3, 1800QL4-A), de la que hace coincidir el
 * rango con el del modelo SI de la misma fila.
 *
 * Las otras marcas: el rango escrito en el nombre o la descripción («5-25 NM»).
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'

const sb = createClient(
  process.env.SUPABASE_URL ?? 'https://jiudqbusyknubonpedde.supabase.co',
  process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })

// ── Catálogo → mapa modelo → [min, max] en N·m ──
const U = { N: 1, CN: 0.01, MN: 0.001, Z: 0.00706155, I: 0.112985, F: 1.35582, KGCM: 0.0980665, KGM: 9.80665, GCM: 0.0000980665 }
const norm = (s) => s.replace(/×/g, 'X').toUpperCase()
const SI = /^\d*[A-Z]*?\d+(?:\.\d+)?(CN|MN|N)(?=\d|X|-|\+|$)/
// Filas que el texto del PDF desordena; revisadas a mano contra la tabla.
const FIJO = {
  'RSP8N2X8': [2, 9, 'N'], 'DBR4500N-S': [500, 4500, 'N'], 'DBR6000N-S': [600, 6000, 'N'],
  '45000DBR-S': [50, 450, 'KGM'], '60000DBR-S': [60, 600, 'KGM'], '8500CF': [10, 85, 'KGM'],
  'CPT20X10D-G': [4, 20, 'N'], 'CPT50X12D-G': [10, 50, 'N'], 'CPT100X15D-G': [20, 100, 'N'], 'CPT200X19D-G': [40, 200, 'N'], 'CPT280X22D-G': [56, 280, 'N'],
  'CSPFDD25N3-10NX10D': [2, 10, 'N'], 'CSPFDD25N3-10NX10D-AD': [2, 10, 'N'], 'CSPLDC25N3-10NX10D': [2, 10, 'N'],
  'A75F3-3/8': [15, 75, 'F'], 'AC75F3-3/8': [15, 75, 'F'], 'ACLS75F3-3/8': [15, 75, 'F'],
}
const r3 = (v) => (v === 0 ? 0 : Number(v.toPrecision(3)))
const catalogo = new Map()
const descartes = []
let ultimoSI = null
for (const linea of readFileSync('scripts/datos/tohnichi-catalogo-2025.txt', 'utf8').split('\n').filter(Boolean)) {
  const [pg, m0, r] = linea.split('|')
  const pagina = Number(pg)
  if (pagina < 10 || pagina > 56 || pagina === 53) continue // 53 = cabezas FH (el rango es la boca, no torque)
  const m = norm(m0)
  const [a, b] = r.split('-').map(Number)
  const poner = (min, max, u) => { if (!catalogo.has(m)) catalogo.set(m, { min: r3(min * U[u]), max: r3(max * U[u]), unidad: u, rango: `${min}-${max}`, pagina }) }
  if (FIJO[m]) { const [fa, fb, u] = FIJO[m]; poner(fa, fb, u); continue }
  if (/^\d+D(-AD)?$/.test(m) || m === 'QSP280N3-1/2') continue
  const si = m.match(SI)
  if (si && !/^\d/.test(m)) {
    const nominal = Number(m.match(/(\d+(?:\.\d+)?)(CN|MN|N)/)[1])
    if (b / nominal < 0.5 || b / nominal > 1.7) { descartes.push(linea); continue }
    ultimoSI = { pagina, max: b * U[si[1]] }
    poner(a, b, si[1])
    continue
  }
  let unica = null
  if (/^[A-Z]+\d+(\.\d+)?I/.test(m)) unica = 'I'
  else if (/^[A-Z]+\d+(\.\d+)?Z/.test(m)) unica = 'Z'
  else if (/^[A-Z]+\d+(\.\d+)?F\d?-\d*A/.test(m)) unica = 'F'
  if (unica) { poner(a, b, unica); continue }
  if (!ultimoSI || ultimoSI.pagina !== pagina) { descartes.push(linea); continue }
  const cands = /^[A-Z]+\d+(\.\d+)?F/.test(m) ? ['F', 'KGCM'] : /^[A-Z]+\d+(\.\d+)?M/.test(m) ? ['KGCM', 'KGM'] : /-A(-|$)/.test(m) ? ['I', 'F', 'Z'] : ['KGCM', 'KGM', 'GCM']
  let mejor = null
  for (const c of cands) { const e = Math.abs(Math.log((b * U[c]) / ultimoSI.max)); if (!mejor || e < mejor[1]) mejor = [c, e] }
  if (mejor[1] > Math.log(1.3)) { descartes.push(linea); continue }
  poner(a, b, mejor[0])
}

// ── Código del producto → modelo del catálogo ──
const SUFIJOS = /(-MH|-BTA|-BTD|-BT|-WF|-SET|#FUNDIDO|\.CONCERTIFICADO\.| W\/CD5)+$/
// Índice laxo: sin encastre (-3/8) ni número de cuadrante (-2A / -3AS).
const laxo = (k) => k.replace(/-(1\/4|3\/8|1\/2)(?=-|$)/, '').replace(/-\d(A|AS)$/, '-$1')
const catalogoLaxo = new Map()
for (const [k, v] of catalogo) if (!catalogoLaxo.has(laxo(k))) catalogoLaxo.set(laxo(k), { ...v, modelo: k })
function buscar(sku) {
  const crudo = norm(sku.replace(/^(TC|TOH|PRO)\./i, '')).trim()
  if (catalogo.has(crudo)) return { modelo: crudo, como: 'exacto', ...catalogo.get(crudo) }
  const base = crudo.replace(SUFIJOS, '').trim()
  const intentos = [
    [base, 'exacto'],
    [base.replace(/^A(C?)LS/, 'A$1'), 'variante LS'],
    [base.replace(/-(1\/4|3\/8|1\/2)(?=-|$)/, ''), 'sin encastre'],
    // LS = largo, MS = corto, FH/FHP = otra empuñadura: mismo rango.
    [base.replace(/^(\d*)(QL|CL|PQL|PCL|CSP|QSP|SP|RSP|YCL)(LS|MS|FHP|FH)/, '$1$2').replace(/^(\d+[A-Z]+\d?)(LS|MS)$/, '$1'), 'variante LS/MS/FH'],
    [base.replace(/^(\d+)(CL|PCL)MS$/, '$1$2'), 'variante MS'],
    [base.replace(/^(\d+)(CL|PCL)LS$/, '$1$2'), 'variante LS'],
  ]
  for (const [k, como] of intentos) if (catalogo.has(k)) return { modelo: k, como, ...catalogo.get(k) }
  for (const [k, como] of intentos) if (catalogoLaxo.has(laxo(k))) return { como: `${como}, sin encastre/cuadrante`, ...catalogoLaxo.get(laxo(k)) }
  // SP: el rango no depende de la boca (SP38N2X17 = SP38N2X16 = 8-38).
  const sp = base.replace(/^SP(LS|MS)/, 'SP').match(/^(SP\d+(?:\.\d+)?N2?(?:-\d)?)X[\d.]+N?$/)
  if (sp) for (const [k, v] of catalogo) if (k.startsWith(`${sp[1]}X`) && !/H$/.test(k)) return { modelo: k, como: 'SP otra boca', ...v }
  // CSP/CL/PCL con otra boca (CSP50N3X15D = CSP50N3X12D = 10-50); CSPL/CSPLD = CSP.
  const cab = base.replace(/^CSPLD?(?=\d)/, 'CSP').match(/^((?:CSP|CL|PCL)\d+(?:\.\d+)?N\d?)X\d+D$/)
  if (cab) for (const [k, v] of catalogo) if (k.startsWith(`${cab[1]}X`) && /X\d+D$/.test(k)) return { modelo: k, como: 'otra boca', ...v }
  return null
}

// ── Rango escrito en el nombre o la descripción ──
function rangoEscrito(texto) {
  const m = (texto ?? '').toUpperCase().match(/(\d+(?:[.,]\d+)?)\s*(?:-|–|A|~)\s*(\d+(?:[.,]\d+)?)\s*(CN\.?M|N\.?M|NM|N·M|N-M)\b/)
  if (!m) return null
  const f = m[3].startsWith('C') ? 0.01 : 1
  const [a, b] = [r3(Number(m[1].replace(',', '.')) * f), r3(Number(m[2].replace(',', '.')) * f)]
  return a < b ? { min: a, max: b } : null
}

// ── Productos ──
async function todos(companyId) {
  const { data: cat } = await sb.from('product_categories').select('id').eq('company_id', companyId).eq('slug', 'llave-dinamometrica')
  const ids = (cat ?? []).map((c) => c.id)
  const out = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb.from('products').select('id, sku, name, description, attributes, product_type, brands(name)')
      .eq('company_id', companyId).in('category_id', ids).range(desde, desde + 999).order('id')
    if (error) throw error
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

const propuesta = []
const sinDato = []
for (const empresa of ['Buscatools', 'Torquetools']) {
  const { data: emp } = await sb.from('companies').select('id').eq('name', empresa).single()
  for (const p of await todos(emp.id)) {
    const marca = p.brands?.name ?? ''
    const a = p.attributes ?? {}
    const actual = { min: a.torq_min ?? null, max: a.torq_max ?? null }
    let nuevo = null
    let fuente = null
    if (marca === 'TOHNICHI') {
      // El SKU (TC.QL50N) o, si es un PRO…, el modelo del nombre («TOHNICHI QL50N …»).
      const c = buscar(p.sku) ?? buscar((p.name ?? '').replace(/^TOHNICHI\s+/i, '').split(/\s+/)[0] ?? '')
      if (c) { nuevo = { min: c.min, max: c.max }; fuente = `Tohnichi 2025 p.${c.pagina} ${c.modelo} ${c.rango} ${c.unidad} (${c.como})` }
    }
    // En Tohnichi el modelo manda: la descripción sólo completa lo que falta
    // (TC.05445 «SP38NX19 - DE 3,5 A 19» trae el rango de otro modelo).
    if (!nuevo && !(marca === 'TOHNICHI' && actual.max !== null)) {
      const e = rangoEscrito(p.name) ?? rangoEscrito(p.description)
      if (e) { nuevo = e; fuente = 'nombre/descripción' }
    }
    if (!nuevo) { if (actual.max === null) sinDato.push({ empresa, sku: p.sku, marca, tipo: p.product_type, nombre: p.name }); continue }
    if (actual.min === nuevo.min && actual.max === nuevo.max) continue
    // «8» (texto) → 8 (número): mismo valor, sólo el tipo.
    const clase = actual.max === null ? 'nuevo' : Number(actual.min) === nuevo.min && Number(actual.max) === nuevo.max ? 'formato' : 'corrige'
    propuesta.push({ empresa, id: p.id, sku: p.sku, marca, nombre: p.name, de: actual, a: nuevo, fuente, clase })
  }
}

writeFileSync('revision/torquimetros.json', JSON.stringify({ propuesta, sinDato, descartes }, null, 1))
const porFuente = {}
for (const x of propuesta) { const k = `${x.empresa} ${x.fuente.replace(/ p\.\d+.*\((.*)\)$/, ' ($1)')} ${x.clase}`; porFuente[k] = (porFuente[k] ?? 0) + 1 }
console.log('catálogo:', catalogo.size, 'modelos · descartes:', descartes.length)
console.log('cambios:', propuesta.length, '· sin dato:', sinDato.length)
for (const [k, v] of Object.entries(porFuente).sort((x, y) => y[1] - x[1])) console.log(String(v).padStart(5), k)
