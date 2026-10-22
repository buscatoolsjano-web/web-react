/*
 * Fase 96 · Bajar todos los productos de la categoría «Otros» de Buscatools.
 * SÓLO LEE. Escribe scripts/.otros/otros.json para clasificarlos después.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const rd = (f) => Object.fromEntries(readFileSync(f, 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '').trim()]))
const env = rd('.env'), mig = rd('.env.migration')
const sb = createClient(env.VITE_SUPABASE_URL, mig.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
const CID = 'bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c'          // Buscatools
const OTROS = '9cac370c-7193-43d1-b775-8faff36dd27b'        // categoría Otros

mkdirSync('scripts/.otros', { recursive: true })
const out = []
for (let d = 0; ; d += 1000) {
  const { data, error } = await sb
    .from('products')
    .select('id, sku, model_code, name, description, product_type, brand_id, brands(name)')
    .eq('company_id', CID).eq('category_id', OTROS).eq('status', 'active').is('deleted_at', null)
    .order('sku').range(d, d + 999)
  if (error) throw error
  out.push(...data.map((p) => ({ id: p.id, sku: p.sku, model_code: p.model_code, name: p.name, description: p.description, product_type: p.product_type, brand_id: p.brand_id, marca: p.brands?.name ?? null })))
  process.stdout.write(`\r  ${out.length}   `)
  if (data.length < 1000) break
}
writeFileSync('scripts/.otros/otros.json', JSON.stringify(out))
console.log(`\n[96] ${out.length} productos → scripts/.otros/otros.json`)
