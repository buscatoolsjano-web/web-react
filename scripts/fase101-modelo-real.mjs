/*
 * Fase 101 · Corregir el modelo mal cargado (quedó el número STEL en vez del
 * modelo real). El modelo REAL está en el campo «MODELO:» de la descripción.
 * Pone model_code = modelo real y, para los que tienen marca, SKU = <prefijo>.<modelo>.
 * SECO por defecto; «apply» escribe.
 *   node fase101-modelo-real.mjs           → reporte + colisiones
 *   node fase101-modelo-real.mjs apply
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const rd = (f) => Object.fromEntries(readFileSync(f, 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '').trim()]))
const env = rd('.env'), mig = rd('.env.migration')
const sb = createClient(env.VITE_SUPABASE_URL, mig.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
const CID = 'bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c'
const APLICAR = process.argv[2] === 'apply'

const norm = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
// El modelo del campo «MODELO:» de la descripción, hasta doble espacio o la próxima etiqueta.
const modeloDesc = (d) => { const m = (d || '').match(/modelo\s*:?\s*([^\n]+)/i); if (!m) return null; const v = m[1].trim().split(/\s{2,}|\s(?=codigo|cod\.|ncm|origen|tipo|descripcion|caracteristica|\/)/i)[0].trim(); return v && v.length <= 40 ? v : null }

const { data: marcas } = await sb.from('brands').select('id, sku_prefix').eq('company_id', CID)
const prefijo = new Map(marcas.map((b) => [b.id, b.sku_prefix]))
const todos = new Set()
const all = []
for (let d = 0; ; d += 1000) { const { data } = await sb.from('products').select('id, sku, model_code, name, description, brand_id').eq('company_id', CID).eq('status', 'active').is('deleted_at', null).range(d, d + 999); all.push(...data); data.forEach((p) => todos.add((p.sku || '').toUpperCase())); if (data.length < 1000) break }

const filas = [], colis = []
const vistos = new Set()
for (const p of all) {
  const mc = norm(p.model_code), nm = norm(p.name)
  if (mc && nm && nm.includes(mc)) continue // el modelo ya está bien (aparece en el nombre)
  const real = modeloDesc(p.description)
  if (!real || norm(real) === mc) continue  // sin fuente, o ya es el real
  const patch = { model_code: real }
  const pre = prefijo.get(p.brand_id)
  if (pre) {
    const nuevo = `${pre}.${real.replace(/\s+/g, '')}`
    if (nuevo.toUpperCase() !== (p.sku || '').toUpperCase()) {
      if (todos.has(nuevo.toUpperCase()) || vistos.has(nuevo.toUpperCase())) { colis.push(`${p.sku}→${nuevo}`) }
      else { vistos.add(nuevo.toUpperCase()); patch.sku = nuevo }
    }
  }
  filas.push({ id: p.id, patch, viejo: p.sku })
}

console.log(`a corregir: ${filas.length} (con nuevo SKU: ${filas.filter((f) => f.patch.sku).length}) · colisiones SKU: ${colis.length}`)
console.log('muestra:')
for (const f of filas.slice(0, 14)) console.log(`  ${f.viejo} → model:${f.patch.model_code}${f.patch.sku ? ' sku:' + f.patch.sku : ''}`)
if (colis.length) console.log('colisiones:', colis.slice(0, 10).join('  '))

if (APLICAR) {
  let n = 0
  for (const f of filas) { const { error } = await sb.from('products').update(f.patch).eq('id', f.id); if (error) throw new Error(`${f.viejo}: ${error.message}`); if (++n % 300 === 0) process.stdout.write(`\r  ${n}/${filas.length}   `) }
  console.log(`\n[101] corregidos ${n}`)
}
