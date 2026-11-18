/**
 * Aplica revision/categorias/propuesta-Torquetools-final.json (de
 * torquetools-categorias.mjs). TODO acotado a la empresa Torquetools: las
 * categorías y marcas se buscan en Torquetools y cada update filtra por su
 * company_id. Respaldo: app.respaldo_torquetools_20261118.
 *
 *   node --env-file=.env.migration scripts/aplicar-categorias-torquetools.mjs           (simula)
 *   node --env-file=.env.migration scripts/aplicar-categorias-torquetools.mjs --apply   (aplica)
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const APLICAR = process.argv.includes('--apply')
const sb = createClient(
  process.env.SUPABASE_URL ?? 'https://jiudqbusyknubonpedde.supabase.co',
  process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })

const { data: emp, error: e0 } = await sb.from('companies').select('id').eq('name', 'Torquetools').single()
if (e0) throw e0
const [{ data: cats, error: e1 }, { data: marcas, error: e2 }] = await Promise.all([
  sb.from('product_categories').select('id, slug').eq('company_id', emp.id),
  sb.from('brands').select('id, name').eq('company_id', emp.id),
])
if (e1 || e2) throw e1 ?? e2
const catDe = new Map(cats.map((c) => [c.slug, c.id]))
const marcaDe = new Map(marcas.map((m) => [m.name.toLowerCase(), m.id]))

const propuesta = JSON.parse(readFileSync('revision/categorias/propuesta-Torquetools-final.json', 'utf8'))

// Un update por combinación (categoría, tipo, marca), en tandas de 200 ids.
const grupos = new Map()
for (const x of propuesta) {
  const cat = catDe.get(x.a)
  if (!cat) throw new Error(`Torquetools no tiene la categoría «${x.a}»`)
  const marca = x.marca ? marcaDe.get(x.marca.toLowerCase()) : undefined
  if (x.marca && !marca) throw new Error(`Torquetools no tiene la marca «${x.marca}»`)
  const k = `${cat}|${x.tipoA ?? ''}|${marca ?? ''}`
  if (!grupos.has(k)) grupos.set(k, { cambios: { category_id: cat, product_type: x.tipoA ?? null, ...(marca ? { brand_id: marca } : {}) }, ids: [] })
  grupos.get(k).ids.push(x.id)
}

let hechos = 0
for (const g of grupos.values()) {
  for (let i = 0; i < g.ids.length; i += 200) {
    const ids = g.ids.slice(i, i + 200)
    if (!APLICAR) { hechos += ids.length; continue }
    const { error, count } = await sb.from('products').update(g.cambios, { count: 'exact' }).eq('company_id', emp.id).in('id', ids)
    if (error) throw new Error(error.message)
    hechos += count ?? 0
  }
}
console.log(APLICAR ? 'Aplicados:' : 'Se aplicarían:', hechos, 'de', propuesta.length, `(${grupos.size} grupos)`)
