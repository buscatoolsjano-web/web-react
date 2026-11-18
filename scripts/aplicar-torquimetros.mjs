/**
 * Aplica revision/torquimetros.json (de torquimetros.mjs): torq_min / torq_max
 * en N·m, como número. Cada empresa por su company_id. Guarda el estado
 * anterior en revision/torquimetros-respaldo-<fecha>.json.
 *
 *   node --env-file=.env.migration scripts/aplicar-torquimetros.mjs           (simula)
 *   node --env-file=.env.migration scripts/aplicar-torquimetros.mjs --apply   (aplica)
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'

const APLICAR = process.argv.includes('--apply')
const sb = createClient(
  process.env.SUPABASE_URL ?? 'https://jiudqbusyknubonpedde.supabase.co',
  process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })

// El nombre de las dos Torcoflex dice «5-25 Nm» en ambas (copiado): se deja lo cargado.
const NO_TOCAR = new Set(['GE.3549-00', 'GE.3549-02'])
const propuesta = JSON.parse(readFileSync('revision/torquimetros.json', 'utf8')).propuesta.filter((x) => !NO_TOCAR.has(x.sku))
const empresas = {}
for (const nombre of ['Buscatools', 'Torquetools']) {
  const { data, error } = await sb.from('companies').select('id').eq('name', nombre).single()
  if (error) throw error
  empresas[nombre] = data.id
}

const respaldo = []
let hechos = 0
for (let i = 0; i < propuesta.length; i += 200) {
  const lote = propuesta.slice(i, i + 200)
  const { data, error } = await sb.from('products').select('id, company_id, attributes').in('id', lote.map((x) => x.id))
  if (error) throw error
  const porId = new Map(data.map((p) => [p.id, p]))
  for (const x of lote) {
    const p = porId.get(x.id)
    if (!p || p.company_id !== empresas[x.empresa]) throw new Error(`${x.sku}: no es de ${x.empresa}`)
    respaldo.push({ empresa: x.empresa, id: p.id, sku: x.sku, attributes: p.attributes })
    if (!APLICAR) { hechos++; continue }
    const attributes = { ...(p.attributes ?? {}), torq_min: x.a.min, torq_max: x.a.max }
    const { error: e } = await sb.from('products').update({ attributes }).eq('id', p.id).eq('company_id', p.company_id)
    if (e) throw new Error(`${x.empresa} ${x.sku}: ${e.message}`)
    hechos++
  }
}
if (APLICAR) writeFileSync(`revision/torquimetros-respaldo-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, JSON.stringify(respaldo))
console.log(APLICAR ? 'Aplicados:' : 'Se aplicarían:', hechos)
