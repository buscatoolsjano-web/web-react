/**
 * Atornilladores: torque, encastre, ergonomía, alimentación y tipo, sacados
 * del nombre, la descripción y el código del fabricante. Completa lo que falta
 * y normaliza el tipo; si lo cargado contradice lo que dice el producto, lo
 * deja y lo anota para revisar. Cada empresa por su company_id.
 *
 *   node --env-file=.env.migration scripts/atornilladores.mjs           (escribe revision/atornilladores.json)
 *   node --env-file=.env.migration scripts/atornilladores.mjs --apply   (aplica, con respaldo)
 *
 * Convenciones: encastre «1/4 HEX», «3/8 SQ»; ergonomía Pistola/Angular/Recto;
 * alimentación Neumático/Batería/Eléctrico; tipo «Atornillador Pistola|Angular|Recto»
 * (la alimentación va en su atributo, no en el tipo).
 */
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'

const APLICAR = process.argv.includes('--apply')
const sb = createClient(
  process.env.SUPABASE_URL ?? 'https://jiudqbusyknubonpedde.supabase.co',
  process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })

const num = (s) => Number(String(s).replace(',', '.'))
const FRAC = { '04': '1/4', '06': '3/8', '08': '1/2', '12': '3/4', '16': '1' }

function torque(t) {
  const pares = [
    /RANGO DE (?:PAR|TORQUE)[^\d]{0,12}([\d.,]+)\s*-\s*([\d.,]+)/,
    // «TORQUE MIN», y las erratas de las fichas («TOQUE MIN», «TORQEU MIN»).
    /TO[A-Z]{1,4}\s*MIN(?:IMO)?(?: \(NM\))?:?\s*([\d.,]+)\s*(?:NM)?.{0,40}?TORQUE MAX(?:IMO)?(?: \(NM\))?:?\s*([\d.,]+)/,
    /TORQUE RANGE\s*-?\s*NM\s*([\d.,]+)\s*-\s*([\d.,]+)/,
    /(?:DE\s+)?([\d.,]+)\s*(?:A|-|–)\s*([\d.,]+)\s*(?:NM|N·M|N\.M)\b/,
  ]
  for (const re of pares) {
    const m = t.match(re)
    if (m && num(m[1]) < num(m[2])) return { min: num(m[1]), max: num(m[2]) }
  }
  // Un solo valor: «20V PISTOL 12 NM», «1350NM TWO SPEED» → sólo el máximo.
  const uno = t.match(/(?:^|[\s,(])(\d+(?:[.,]\d+)?)\s?NM\b/)
  return uno ? { min: null, max: num(uno[1]) } : null
}

function encastre(t, codigo, marca) {
  if (/QUICK[- ]?(CHANGE|CONNECT)|1\/4"?\s*(INCH\s*)?HEX|HEX(AGONAL)?\s*1\/4|1\/4 HEX/.test(t)) return '1/4 HEX'
  const sq = t.match(/(?:SQUARE|SQ\.?|CUADRADO|ENCASTRE:?)\s*(1\/4|3\/8|1\/2|3\/4|1)\s*(?:"|INCH|IN\b|SQ)?/) ?? t.match(/(1\/4|3\/8|1\/2|3\/4|1)\s*(?:"|INCH)?\s*(?:SQUARE|SQ\b)/)
  if (sq) return `${sq[1]} SQ`
  // Ingersoll Rand QX: …PS06 = cuadrado 3/8", …PQ04 = hexagonal 1/4" de cambio rápido.
  if (marca === 'INGERSOLL RAND') {
    const m = codigo.match(/[PE]([SMQ])(04|06|08|12|16)(?:-[A-Z0-9]+)?$/)
    if (m) return m[1] === 'Q' ? '1/4 HEX' : `${FRAC[m[2]]} SQ`
  }
  return null
}

function ergonomia(t) {
  if (/PISTOL|PISTOLA|GATILLO/.test(t)) return 'Pistola'
  if (/\bANGLE\b|ANGULAR|CABEZA A/.test(t)) return 'Angular'
  if (/STRAIGHT|RECT[OA]\b|EN L[ÍI]NEA|INLINE/.test(t)) return 'Recto'
  return null
}

function alimentacion(t, marca, codigo) {
  const ex = t.match(/ALIMENTACI[ÓO]N:\s*(NEUM[ÁA]TICO|BATER[ÍI]A|EL[ÉE]CTRICO)/)
  if (ex) return { N: 'Neumático', B: 'Batería', E: 'Eléctrico' }[ex[1][0]]
  if (/BATER[ÍI]A|CORDLESS|LI-ION|\b(12|14\.4|18|20|36|40)V\b/.test(t)) return 'Batería'
  if (/NEUM[ÁA]TIC|PNEUMATIC|\bAIR\b|AIRE|IMPULSO|PULSE/.test(t)) return 'Neumático'
  if (marca === 'INGERSOLL RAND' && /^(QX|QC)/.test(codigo)) return 'Batería'
  return null
}

const TIPO = { Pistola: 'Atornillador Pistola', Angular: 'Atornillador Angular', Recto: 'Atornillador Recto' }
const MANUAL = /\bDESTORNILLADOR(ES)?\b/

async function todos(companyId) {
  const { data: cat } = await sb.from('product_categories').select('id').eq('company_id', companyId).eq('slug', 'atornillador')
  const out = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb.from('products').select('id, sku, name, description, attributes, product_type, brands(name)')
      .eq('company_id', companyId).in('category_id', cat.map((c) => c.id)).range(desde, desde + 999).order('id')
    if (error) throw error
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

const cambios = []
const conflictos = []
const respaldo = []
for (const empresa of ['Buscatools', 'Torquetools']) {
  const { data: emp } = await sb.from('companies').select('id').eq('name', empresa).single()
  for (const p of await todos(emp.id)) {
    const marca = (p.brands?.name ?? '').toUpperCase()
    const codigo = p.sku.replace(/^[A-Z]{2,3}\./, '').toUpperCase()
    const t = `${p.name ?? ''} · ${p.description ?? ''}`.toUpperCase().replace(/\s+/g, ' ')
    const a = { ...(p.attributes ?? {}) }
    const nuevo = { ...a }
    const manual = MANUAL.test(t) && !/ATORNILLADOR/.test(t)
    const motivo = []
    const completar = (k, v) => {
      if (v === null || v === undefined) return
      if (a[k] === undefined || a[k] === null || a[k] === '') { nuevo[k] = v; motivo.push(`${k}=${v}`) }
      else if (String(a[k]) !== String(v) && !(typeof v === 'number' && Number(a[k]) === v)) conflictos.push({ empresa, sku: p.sku, campo: k, cargado: a[k], dice: v, nombre: p.name })
      else if (typeof v === 'number' && typeof a[k] === 'string') { nuevo[k] = v; motivo.push(`${k} como número`) }
    }
    if (!manual) {
      const tq = torque(t)
      // Se había cargado el mínimo como máximo (Sumake «0,3-2,5» → torq_max 0.3): se corrige el par.
      if (tq?.min !== null && tq && a.torq_max != null && Number(a.torq_max) === tq.min && a.torq_min == null) {
        nuevo.torq_min = tq.min; nuevo.torq_max = tq.max; motivo.push(`torque ${a.torq_max} → ${tq.min}-${tq.max}`)
      } else if (tq) { completar('torq_max', tq.max); completar('torq_min', tq.min) }
      completar('encastre', encastre(t, codigo, marca))
      completar('ergonomia', ergonomia(t))
      completar('alimentacion', alimentacion(t, marca, codigo))
    } else if (a.alimentacion === 'Eléctrico') {
      // «aislado 1000V» se había leído como eléctrico: es un destornillador de mano.
      delete nuevo.alimentacion; motivo.push('sin alimentación (manual)')
    }
    let tipo = p.product_type
    const erg = nuevo.ergonomia
    if (manual) tipo = tipo ?? null
    else if (/^(Atornillador (Angular|Recto) Neumático|Gatillo|PISTOLA|ANGULAR)$/.test(tipo ?? '') || (!tipo && erg)) tipo = erg ? TIPO[erg] : tipo
    if (tipo === 'Atornillador Angular Neumático') tipo = 'Atornillador Angular'
    if (tipo === 'Atornillador Recto Neumático') tipo = 'Atornillador Recto'
    if (tipo !== p.product_type) motivo.push(`tipo: ${p.product_type ?? '—'} → ${tipo}`)
    if (!motivo.length) continue
    cambios.push({ empresa, sku: p.sku, nombre: p.name, motivo: motivo.join(' · ') })
    respaldo.push({ empresa, id: p.id, sku: p.sku, attributes: p.attributes, product_type: p.product_type })
    if (!APLICAR) continue
    const { error } = await sb.from('products').update({ attributes: nuevo, product_type: tipo }).eq('id', p.id).eq('company_id', emp.id)
    if (error) throw new Error(`${empresa} ${p.sku}: ${error.message}`)
  }
}

writeFileSync('revision/atornilladores.json', JSON.stringify({ cambios, conflictos }, null, 1))
if (APLICAR) writeFileSync(`revision/atornilladores-respaldo-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, JSON.stringify(respaldo))
const r = {}
for (const c of cambios) for (const m of c.motivo.split(' · ')) { const k = `${c.empresa} ${m.replace(/=.*/, '').replace(/tipo: .*→/, 'tipo →')}`; r[k] = (r[k] ?? 0) + 1 }
console.log(APLICAR ? 'Aplicados:' : 'Se cambiarían:', cambios.length, '· conflictos:', conflictos.length)
for (const [k, v] of Object.entries(r).sort((x, y) => y[1] - x[1])) console.log(String(v).padStart(5), k)
