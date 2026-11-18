/**
 * Corrige medida, largo y tipo de los productos de scripts/datos/medidas-correcciones.json
 * (las 172 que habían quedado «a revisar»), en Buscatools y en Torquetools
 * (mismo SKU, cada empresa por separado). Guarda el estado anterior en
 * revision/medidas-respaldo-<fecha>.json para poder volver atrás.
 *
 *   node --env-file=.env.migration scripts/aplicar-medidas.mjs           (simula)
 *   node --env-file=.env.migration scripts/aplicar-medidas.mjs --apply   (aplica)
 *
 * medida/largo en null = la característica no aplica y se quita. Los valores
 * van como texto, igual que el resto del catálogo («32», «TS1/4»).
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'

const APLICAR = process.argv.includes('--apply')
const sb = createClient(
  process.env.SUPABASE_URL ?? 'https://jiudqbusyknubonpedde.supabase.co',
  process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })

const correcciones = JSON.parse(readFileSync('scripts/datos/medidas-correcciones.json', 'utf8'))
delete correcciones._fuente
const skus = Object.keys(correcciones)

const respaldo = []
let cambios = 0
for (const empresa of ['Buscatools', 'Torquetools']) {
  const { data: emp, error: e0 } = await sb.from('companies').select('id').eq('name', empresa).single()
  if (e0) throw e0
  const { data: prods, error } = await sb.from('products').select('id, sku, product_type, attributes').eq('company_id', emp.id).in('sku', skus)
  if (error) throw error
  const faltan = skus.filter((s) => !prods.some((p) => p.sku === s))
  if (faltan.length) console.log(empresa, 'sin estos SKU:', faltan.join(', '))
  for (const p of prods) {
    const c = correcciones[p.sku]
    const attrs = { ...(p.attributes ?? {}) }
    if ('medida' in c) { if (c.medida === null) delete attrs.medida; else attrs.medida = c.medida }
    if ('largo' in c) { if (c.largo === null) delete attrs.largo; else attrs.largo = String(c.largo) }
    const tipo = c.tipo ?? p.product_type
    if (JSON.stringify(attrs) === JSON.stringify(p.attributes ?? {}) && tipo === p.product_type) continue
    respaldo.push({ empresa, id: p.id, sku: p.sku, product_type: p.product_type, attributes: p.attributes })
    cambios++
    if (!APLICAR) continue
    const { error: e2 } = await sb.from('products').update({ attributes: attrs, product_type: tipo }).eq('id', p.id).eq('company_id', emp.id)
    if (e2) throw new Error(`${empresa} ${p.sku}: ${e2.message}`)
  }
}
if (APLICAR) writeFileSync(`revision/medidas-respaldo-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, JSON.stringify(respaldo, null, 1))
console.log(APLICAR ? 'Corregidos:' : 'Se corregirían:', cambios)
