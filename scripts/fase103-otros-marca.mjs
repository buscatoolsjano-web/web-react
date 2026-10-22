/*
 * Fase 103 · Enriquecer "Otros" con la MARCA. La marca va a attributes.marca_disp
 * (texto, NO filtrable → no ensucia filtros) y, si coincide con una de las marcas
 * reales de la tabla brands, se setea además brand_id. Fuente: la línea «Marca:»
 * de la descripción; si no está, se busca una marca conocida como palabra en el
 * nombre. SECO por defecto; «apply» escribe.
 *   node fase103-otros-marca.mjs          → reporte
 *   node fase103-otros-marca.mjs apply
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const rd = (f) => Object.fromEntries(readFileSync(f, 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '').trim()]))
const env = rd('.env'), mig = rd('.env.migration')
const sb = createClient(env.VITE_SUPABASE_URL, mig.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
const CID = 'bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c'
const OTROS = '9cac370c-7193-43d1-b775-8faff36dd27b'
const APLICAR = process.argv[2] === 'apply'

const { data: marcas } = await sb.from('brands').select('id, name').eq('company_id', CID)
const normM = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const brandByNorm = new Map(marcas.map((b) => [normM(b.name), b.id]))
const brandNames = marcas.map((b) => ({ id: b.id, name: b.name, re: new RegExp(`(^|[^A-Za-z0-9])${b.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9]|$)`, 'i') }))

// Basura que NO es marca
const BLOQUEADAS = new Set(['GENERICO', 'GENERICA', 'GENERIC', 'SINMARCA', 'VARIOS', 'NA', 'SM', 'CEPILLO', 'ESPONJA', 'CINTA', 'PLUMERO', 'TORNILLO', 'GUANTE', 'REPUESTO', 'ACCESORIO'])
const esMarcaValida = (s) => {
  if (!s) return false
  const t = s.trim()
  if (t.length > 28 || t.length < 2) return false
  if (/\bseg[uú]n\b|disponibilidad|\b[ao]\/[ao]\b|\s+[oó]\s+\w+\s+(seg|segun)/i.test(t)) return false
  if (/^\d+$/.test(t)) return false
  if (BLOQUEADAS.has(normM(t))) return false
  return true
}
const titulo = (s) => s.trim().replace(/\s+/g, ' ').split(' ').map((w) => (w.length <= 4 && w === w.toUpperCase()) || /\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
const marcaDeDesc = (d) => { const m = (d || '').match(/(?:^|\n)\s*marca\s*:?\s*([^\n]+)/i); return m ? m[1].trim() : null }
const marcaDeNombre = (n) => { for (const b of brandNames) if (b.re.test(n || '')) return b; return null }

const prods = []
for (let o = 0; ; o += 1000) {
  const { data } = await sb.from('products').select('id, name, description, brand_id, attributes')
    .eq('company_id', CID).eq('category_id', OTROS).eq('status', 'active').is('deleted_at', null).range(o, o + 999)
  prods.push(...data); if (data.length < 1000) break
}

let nDisp = 0, nBrand = 0, descartadas = 0
const filas = [], muestra = []
for (const p of prods) {
  const a = { ...(p.attributes || {}) }
  const patch = {}
  let marcaTxt = null, brandId = p.brand_id
  const cru = marcaDeDesc(p.description)
  if (cru && esMarcaValida(cru)) marcaTxt = titulo(cru)
  else if (cru) descartadas++
  // Match contra marca real (por descripción o por nombre)
  if (marcaTxt && brandByNorm.has(normM(marcaTxt))) brandId = brandByNorm.get(normM(marcaTxt))
  if (!brandId) { const bn = marcaDeNombre(p.name); if (bn) { brandId = bn.id; if (!marcaTxt) marcaTxt = titulo(bn.name) } }
  if (marcaTxt && !a.marca_disp) { a.marca_disp = marcaTxt; patch.attributes = a; nDisp++ }
  if (brandId && brandId !== p.brand_id) { patch.brand_id = brandId; nBrand++ }
  if (Object.keys(patch).length) { filas.push({ id: p.id, patch }); if (muestra.length < 18) muestra.push(`${marcaTxt || ''}${patch.brand_id ? ' [brand_id]' : ''}  ← ${p.name.slice(0, 50)}`) }
}

console.log(`otros: ${prods.length} · a escribir: ${filas.length} · marca_disp nuevos: ${nDisp} · brand_id seteados: ${nBrand} · líneas Marca descartadas (basura): ${descartadas}`)
console.log('muestra:'); for (const m of muestra) console.log('  ', m)

if (APLICAR) {
  let n = 0
  for (const f of filas) { const { error } = await sb.from('products').update(f.patch).eq('id', f.id); if (error) throw new Error(`${f.id}: ${error.message}`); if (++n % 200 === 0) process.stdout.write(`\r  ${n}/${filas.length}   `) }
  console.log(`\n[103] actualizados ${n}`)
}
