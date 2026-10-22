/* Fase 99 · Bajar productos de categorías de herramienta SIN atributos. SÓLO LEE. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const rd = (f) => Object.fromEntries(readFileSync(f, 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '').trim()]))
const env = rd('.env'), mig = rd('.env.migration')
const sb = createClient(env.VITE_SUPABASE_URL, mig.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
const CID = 'bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c'
const CATS = { punta: 'eff7ce37-309a-4c5e-b821-2a35171e466f', atornillador: '7b4e3c20-6a62-40f5-b1f1-0d083e220909', 'llave-dinamometrica': 'b15b463a-4f6a-40ad-a7bd-a15e29ce856b', 'llave-de-impacto': '72adcdc5-0d13-4c68-9076-bf64affac200', balanceador: 'b2fc8c6a-c7a3-4347-9db1-436810a2c110', remachadora: 'e52b14a7-8193-429b-b0e8-4c0d5b20a46a', 'herramientas-manuales': 'e48e845a-6952-4b0c-871d-f117b698d5be' }
mkdirSync('scripts/.otros', { recursive: true })
const out = []
for (const [slug, cid] of Object.entries(CATS)) {
  for (let d = 0; ; d += 1000) {
    const { data, error } = await sb.from('products').select('id, sku, model_code, name, description, brands(name)').eq('company_id', CID).eq('category_id', cid).eq('status', 'active').is('deleted_at', null).eq('attributes', '{}').range(d, d + 999)
    if (error) throw error
    out.push(...data.map((p) => ({ id: p.id, sku: p.sku, model_code: p.model_code, name: p.name, description: p.description, marca: p.brands?.name ?? null, cat: slug })))
    if (data.length < 1000) break
  }
}
writeFileSync('scripts/.otros/sin-attrs.json', JSON.stringify(out))
const porCat = {}; for (const p of out) porCat[p.cat] = (porCat[p.cat] || 0) + 1
console.log('[99] sin atributos:', out.length, JSON.stringify(porCat))
