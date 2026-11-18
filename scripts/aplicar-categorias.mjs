/**
 * Aplica la propuesta de clasificar-categorias.mjs (sin las del «cajón», que
 * quedan para revisar a mano). Necesita el respaldo de la migración
 * 20261117…_categorias_maquinas_y_respaldo: sin él, no corre.
 *
 *   node --env-file=.env.migration scripts/aplicar-categorias.mjs Buscatools          (simula)
 *   node --env-file=.env.migration scripts/aplicar-categorias.mjs Buscatools --apply  (aplica)
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const empresa = process.argv[2] ?? 'Buscatools'
const APLICAR = process.argv.includes('--apply')
const sb = createClient(
  process.env.SUPABASE_URL ?? 'https://jiudqbusyknubonpedde.supabase.co',
  process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })

const { data: emp, error: e0 } = await sb.from('companies').select('id').eq('name', empresa).single()
if (e0) throw e0
const { data: cats, error: e1 } = await sb.from('product_categories').select('id, slug').eq('company_id', emp.id)
if (e1) throw e1
const idDe = new Map(cats.map((c) => [c.slug, c.id]))

// --archivo=propuesta-cajon.json: la clasificación hecha a mano de «Otros».
const archivo = process.argv.find((a) => a.startsWith('--archivo='))?.slice(10) ?? `propuesta-${empresa}.json`
const propuesta = JSON.parse(readFileSync(`revision/categorias/${archivo}`, 'utf8')).filter((x) => x.origen !== 'cajon')

// Agrupado por (categoría, tipo): un update por grupo, en tandas de 200 ids.
const grupos = new Map()
for (const x of propuesta) {
  const cat = idDe.get(x.a)
  if (!cat) throw new Error(`No existe la categoría «${x.a}» en ${empresa}`)
  const k = `${x.a}\u0000${x.tipoA ?? ''}`
  if (!grupos.has(k)) grupos.set(k, { cat, slug: x.a, tipo: x.tipoA, ids: [] })
  grupos.get(k).ids.push(x.id)
}

let hechos = 0
for (const g of grupos.values()) {
  for (let i = 0; i < g.ids.length; i += 200) {
    const ids = g.ids.slice(i, i + 200)
    if (APLICAR) {
      const { error, count } = await sb
        .from('products')
        .update({ category_id: g.cat, product_type: g.tipo }, { count: 'exact' })
        .eq('company_id', emp.id)
        .in('id', ids)
      if (error) throw new Error(`${g.slug}/${g.tipo}: ${error.message}`)
      hechos += count ?? 0
    } else {
      hechos += ids.length
    }
  }
  console.log(String(g.ids.length).padStart(5), g.slug, '·', g.tipo ?? '(sin tipo)')
}
console.log(APLICAR ? 'Aplicados:' : 'Se aplicarían:', hechos, 'de', propuesta.length)
