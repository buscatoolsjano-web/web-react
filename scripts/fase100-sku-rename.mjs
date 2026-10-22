/*
 * Fase 100 · Renombrar los SKU «PRO…» a la convención <prefijo-marca>.<modelo>.
 * SECO por defecto; «apply» escribe. Sólo productos CON marca (los sin marca no
 * tienen prefijo). Seguro: el sync STEL matchea por external_id y no toca el SKU.
 *   node fase100-sku-rename.mjs          → reporte + colisiones
 *   node fase100-sku-rename.mjs apply
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const rd = (f) => Object.fromEntries(readFileSync(f, 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '').trim()]))
const env = rd('.env'), mig = rd('.env.migration')
const sb = createClient(env.VITE_SUPABASE_URL, mig.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
const CID = 'bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c'
const APLICAR = process.argv[2] === 'apply'

// Todos los SKU existentes (para detectar colisiones)
const todos = new Set()
for (let d = 0; ; d += 1000) { const { data } = await sb.from('products').select('sku').eq('company_id', CID).range(d, d + 999); data.forEach((p) => todos.add((p.sku || '').toUpperCase())); if (data.length < 1000) break }

// Marcas → prefijo
const { data: marcas } = await sb.from('brands').select('id, sku_prefix').eq('company_id', CID)
const prefijo = new Map(marcas.map((b) => [b.id, b.sku_prefix]))

// PRO con marca
const pro = []
for (let d = 0; ; d += 1000) { const { data } = await sb.from('products').select('id, sku, model_code, brand_id').eq('company_id', CID).eq('status', 'active').is('deleted_at', null).ilike('sku', 'PRO%').not('brand_id', 'is', null).range(d, d + 999); pro.push(...data); if (data.length < 1000) break }

const limpio = (s) => (s || '').trim().replace(/\s+/g, '')
const filas = [], colisiones = [], sinModelo = []
const nuevosVistos = new Set()
for (const p of pro) {
  const pre = prefijo.get(p.brand_id)
  // El modelo a veces viene con el «PRO» pegado (es la referencia STEL): se saca.
  const modelo = limpio(p.model_code).replace(/^PRO(?=\d)/i, '') || limpio(p.sku).replace(/^PRO(?=\d)/i, '')
  if (!pre || !modelo) { sinModelo.push(p.sku); continue }
  const nuevo = `${pre}.${modelo}`
  if (nuevo.toUpperCase() === (p.sku || '').toUpperCase()) continue
  if (todos.has(nuevo.toUpperCase()) || nuevosVistos.has(nuevo.toUpperCase())) { colisiones.push(`${p.sku} → ${nuevo}`); continue }
  nuevosVistos.add(nuevo.toUpperCase())
  filas.push({ id: p.id, sku: nuevo, modelo, viejo: p.sku })
}

console.log(`PRO con marca: ${pro.length} · a renombrar: ${filas.length} · colisiones: ${colisiones.length} · sin modelo: ${sinModelo.length}`)
console.log('muestra:', filas.slice(0, 10).map((f) => `${f.viejo}→${f.sku}`).join('  '))
if (colisiones.length) console.log('colisiones (muestra):', colisiones.slice(0, 8).join('  '))

if (APLICAR) {
  let n = 0
  for (const f of filas) { const { error } = await sb.from('products').update({ sku: f.sku, model_code: f.modelo }).eq('id', f.id); if (error) throw new Error(`${f.viejo}: ${error.message}`); if (++n % 200 === 0) process.stdout.write(`\r  ${n}/${filas.length}   `) }
  console.log(`\n[100] SKU renombrados ${n}`)
}
