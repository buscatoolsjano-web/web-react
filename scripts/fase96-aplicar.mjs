/*
 * Fase 96 · Aplicar la recategorización de «Otros» de Buscatools. ESCRIBE.
 *   node fase96-aplicar.mjs [alta,media]   (por defecto alta,media)
 *
 * Lee el plan de fase96-clasificar.mjs y mueve cada producto a su categoría.
 * Idempotente y acotado: sólo toca productos que SIGUEN en «Otros» de Buscatools.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const rd = (f) => Object.fromEntries(readFileSync(f, 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '').trim()]))
const env = rd('.env'), mig = rd('.env.migration')
const sb = createClient(env.VITE_SUPABASE_URL, mig.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
const CID = 'bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c'
const OTROS = '9cac370c-7193-43d1-b775-8faff36dd27b'

const CAT = {
  punta: 'eff7ce37-309a-4c5e-b821-2a35171e466f',
  balanceador: 'b2fc8c6a-c7a3-4347-9db1-436810a2c110',
  atornillador: '7b4e3c20-6a62-40f5-b1f1-0d083e220909',
  accesorio: '60cd4c62-fa25-43e8-9f31-97dc6879e553',
  'llave-de-impacto': '72adcdc5-0d13-4c68-9076-bf64affac200',
  remachadora: 'e52b14a7-8193-429b-b0e8-4c0d5b20a46a',
  'llave-dinamometrica': 'b15b463a-4f6a-40ad-a7bd-a15e29ce856b',
  seguridad: '2b741519-0a68-4559-93e3-ef7c3bace0c4',
  automatizacion: 'd91b5f87-7ec1-427b-b9a7-4ed2ac7caf5c',
  repuestos: 'dfb8fb9d-8941-49ce-9843-bbcc60cc175a',
}

const CONF = (process.argv[2] || 'alta,media').split(',')
const plan = JSON.parse(readFileSync('scripts/.otros/plan.json', 'utf8')).filter((p) => CONF.includes(p.conf))
const porCat = {}
for (const p of plan) (porCat[p.cat] ??= []).push(p.id)

let total = 0
for (const [cat, ids] of Object.entries(porCat)) {
  const catId = CAT[cat]
  if (!catId) { console.log(`  [sin mapeo] ${cat} (${ids.length})`); continue }
  let n = 0
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    // Sin guard de categoría: los ids salen del pull de «otros», así que mover
    // por id al destino re-afirma lo ya movido y corrige accesorios→repuestos.
    const { error, count } = await sb.from('products')
      .update({ category_id: catId }, { count: 'exact' })
      .eq('company_id', CID).in('id', chunk)
    if (error) throw error
    n += count ?? 0
  }
  total += n
  console.log(`  ${cat}: ${n}`)
}
console.log(`[96] movidos ${total} (confianza ${CONF.join('+')})`)
