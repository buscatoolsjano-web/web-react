/**
 * Aplica revision/medidas-puntas.json (de medidas-puntas.mjs) en Buscatools y
 * Torquetools (mismo SKU, cada empresa por separado). Corrige también la
 * medida vieja escrita en la descripción («Medida: 76mm»). Guarda el estado
 * anterior en revision/medidas-puntas-respaldo-<fecha>.json.
 *
 *   node --env-file=.env.migration scripts/aplicar-medidas-puntas.mjs           (simula)
 *   node --env-file=.env.migration scripts/aplicar-medidas-puntas.mjs --apply   (aplica)
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'

const APLICAR = process.argv.includes('--apply')
const sb = createClient(
  process.env.SUPABASE_URL ?? 'https://jiudqbusyknubonpedde.supabase.co',
  process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })

// Excepciones revisadas a mano: la serie L es de tubos grandes; 1 5/16" es lo correcto.
const EXCEPCIONES = { 'SP.L23-15/16HL': '1 5/16"', 'SP.L23-15/16H': '1 5/16"' }

// Lo marcado «revisar» (había una medida plausible distinta) no se toca si no está en EXCEPCIONES.
const propuesta = JSON.parse(readFileSync('revision/medidas-puntas.json', 'utf8')).filter((x) => !x.revisar || x.sku in EXCEPCIONES)
const nueva = new Map(propuesta.map((x) => [x.sku, x.sku in EXCEPCIONES ? EXCEPCIONES[x.sku] : x.a]))

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const respaldo = []
let cambios = 0
let descripciones = 0
for (const empresa of ['Buscatools', 'Torquetools']) {
  const { data: emp, error: e0 } = await sb.from('companies').select('id').eq('name', empresa).single()
  if (e0) throw e0
  const skus = [...nueva.keys()]
  const prods = []
  for (let i = 0; i < skus.length; i += 300) {
    const { data, error } = await sb.from('products').select('id, sku, attributes, description').eq('company_id', emp.id).in('sku', skus.slice(i, i + 300))
    if (error) throw error
    prods.push(...data)
  }
  for (const p of prods) {
    const v = nueva.get(p.sku)
    const attrs = { ...(p.attributes ?? {}) }
    const vieja = attrs.medida ?? null
    if (v === null) delete attrs.medida
    else attrs.medida = v
    if ((vieja ?? null) === (v ?? null)) continue
    // La medida vieja escrita en la descripción, si estaba.
    let desc = p.description
    if (vieja && desc) {
      const re = new RegExp(`( · )?Medida: ${esc(vieja.replace(' mm', ''))}(?: ?mm)?(?=$| · |\\n)`)
      if (re.test(desc)) {
        desc = v ? desc.replace(re, (m, sep) => `${sep ?? ''}Medida: ${v}`) : desc.replace(re, '').replace(/^ · /, '')
        descripciones++
      }
    }
    respaldo.push({ empresa, id: p.id, sku: p.sku, attributes: p.attributes, description: p.description })
    cambios++
    if (!APLICAR) continue
    const { error } = await sb.from('products').update({ attributes: attrs, description: desc }).eq('id', p.id).eq('company_id', emp.id)
    if (error) throw new Error(`${empresa} ${p.sku}: ${error.message}`)
  }
  console.log(empresa, prods.length, 'productos encontrados')
}
if (APLICAR) writeFileSync(`revision/medidas-puntas-respaldo-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, JSON.stringify(respaldo))
console.log(APLICAR ? 'Corregidos:' : 'Se corregirían:', cambios, '· descripciones:', descripciones)
