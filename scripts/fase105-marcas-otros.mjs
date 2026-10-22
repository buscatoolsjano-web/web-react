/*
 * Fase 105 · Dar brand_id a los productos clasificados de "Otros" (survey104.json)
 * para que puedan publicarse (la vista pública exige brand_id). Matchea contra
 * marcas existentes; crea las marcas nuevas frecuentes y limpias (≥UMBRAL); el
 * resto va a la marca "Genérico". SECO por defecto; «apply» crea y asigna.
 *   node fase105-marcas-otros.mjs          → plan
 *   node fase105-marcas-otros.mjs apply
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const rd = (f) => Object.fromEntries(readFileSync(f, 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '').trim()]))
const env = rd('.env'), mig = rd('.env.migration')
const sb = createClient(env.VITE_SUPABASE_URL, mig.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
const CID = 'bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c'
const APLICAR = process.argv[2] === 'apply'
const UMBRAL = 3

const sinAcento = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
const normM = (s) => sinAcento(s).toUpperCase().replace(/[^A-Z0-9]/g, '')
const titulo = (s) => s.trim().replace(/\s+/g, ' ').split(' ').map((w) => (w.length <= 4 && w === w.toUpperCase()) || /\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
const ALIAS = new Map([['CP', 'Chicago Pneumatic'], ['SIEMMENS', 'Siemens']]) // norm → nombre canónico
const BLOQUEADAS = new Set(['GENERICO', 'GENERICA', 'GENERIC', 'SINMARCA', 'VARIOS', 'NA', 'SM', 'SN',
  'CEPILLO', 'ESPONJA', 'CINTA', 'PLUMERO', 'TORNILLO', 'GUANTE', 'DISCO', 'LIJA', 'BALDE', 'TRAPO', 'REJILLA', 'PA', 'PANO',
  'STORAGECOMPAT', 'STORAGECOMPATFAMI', 'REPUESTO', 'ACCESORIO', 'TORQUETOOLS'])
const esValida = (s) => {
  const t = (s || '').trim()
  if (t.length < 2 || t.length > 28 || /^\d+$/.test(t) || /disponibilidad/i.test(t) || BLOQUEADAS.has(normM(t))) return false
  if (/^[a-zñ]{2}$/i.test(sinAcento(t))) return false // 2 letras sin dígito: demasiado ambiguo (BS, TP)
  return true
}

const { data: marcasEx } = await sb.from('brands').select('id, name').eq('company_id', CID)
const idPorNorm = new Map(marcasEx.map((b) => [normM(b.name), b.id]))

const clasif = JSON.parse(readFileSync('scripts/.otros/survey104.json', 'utf8'))
const ids = clasif.map((c) => c.id)
const prods = []
for (let i = 0; i < ids.length; i += 300) {
  const { data } = await sb.from('products').select('id, name, description, brand_id, attributes').in('id', ids.slice(i, i + 300))
  prods.push(...data)
}
const marcaLine = (d) => { const m = (d || '').match(/(?:^|\n)\s*marca\s*:?\s*([^\n]+)/i); return m ? m[1].trim() : null }

// Señal de marca por producto
const senal = new Map()
for (const p of prods) {
  if (p.brand_id) { senal.set(p.id, { brandId: p.brand_id }); continue }
  let raw = (p.attributes && p.attributes.marca_disp) || marcaLine(p.description)
  if (!raw || !esValida(raw)) { senal.set(p.id, { generico: true }); continue }
  let canon = titulo(raw)
  if (ALIAS.has(normM(canon))) canon = ALIAS.get(normM(canon))
  senal.set(p.id, { canon, norm: normM(canon) })
}

// Frecuencia de canónicos que NO existen (candidatos a crear)
const freq = new Map(), display = new Map()
for (const s of senal.values()) {
  if (!s.canon || idPorNorm.has(s.norm)) continue
  freq.set(s.norm, (freq.get(s.norm) || 0) + 1)
  if (!display.has(s.norm)) display.set(s.norm, s.canon)
}
const aCrear = [...freq.entries()].filter(([, n]) => n >= UMBRAL).map(([k]) => display.get(k)).sort()

// Plan de asignación
let asignaExist = 0, asignaNueva = 0, generico = 0
const porMarca = {}
const normCrear = new Set(aCrear.map(normM))
for (const [pid, s] of senal) {
  if (s.brandId) continue // ya tenía
  let destino
  if (s.canon && idPorNorm.has(s.norm)) { destino = s.canon; asignaExist++ }
  else if (s.canon && normCrear.has(s.norm)) { destino = s.canon; asignaNueva++ }
  else { destino = 'Genérico'; generico++ }
  porMarca[destino] = (porMarca[destino] || 0) + 1
}

console.log(`clasificados: ${prods.length} · ya con brand_id: ${prods.filter((p) => p.brand_id).length}`)
console.log(`marcas NUEVAS a crear (≥${UMBRAL}): ${aCrear.length}`)
console.log('  ' + aCrear.join(', '))
console.log(`asignaciones → a marca existente: ${asignaExist} · a marca nueva: ${asignaNueva} · a Genérico: ${generico}`)
console.log('top destinos:', Object.entries(porMarca).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${k}:${v}`).join('  '))

if (APLICAR) {
  // Crear marcas nuevas + Genérico
  const crear = [...new Set([...aCrear, 'Genérico'])].filter((n) => !idPorNorm.has(normM(n)))
  for (const n of crear) {
    const { data, error } = await sb.from('brands').insert({ company_id: CID, name: n, is_active: true }).select('id').single()
    if (error) throw new Error(`crear ${n}: ${error.message}`)
    idPorNorm.set(normM(n), data.id)
  }
  console.log(`[105] marcas creadas: ${crear.length}`)
  // Asignar brand_id
  let n = 0
  for (const [pid, s] of senal) {
    if (s.brandId) continue
    let bid
    if (s.canon && idPorNorm.has(s.norm)) bid = idPorNorm.get(s.norm)
    else bid = idPorNorm.get(normM('Genérico'))
    const { error } = await sb.from('products').update({ brand_id: bid }).eq('id', pid)
    if (error) throw new Error(`${pid}: ${error.message}`)
    if (++n % 200 === 0) process.stdout.write(`\r  ${n}   `)
  }
  console.log(`\n[105] brand_id asignados: ${n}`)
}
