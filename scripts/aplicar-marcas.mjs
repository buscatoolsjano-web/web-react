/**
 * Aplica revision/categorias/propuesta-marcas.json (de marcas-sin-marca.mjs).
 * Sólo toca productos que siguen sin marca, así que se puede correr dos veces.
 * El respaldo está en app.respaldo_marcas_20261118.
 *
 *   node --env-file=.env.migration scripts/aplicar-marcas.mjs           (simula)
 *   node --env-file=.env.migration scripts/aplicar-marcas.mjs --apply   (aplica)
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const APLICAR = process.argv.includes('--apply')
const sb = createClient(
  process.env.SUPABASE_URL ?? 'https://jiudqbusyknubonpedde.supabase.co',
  process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })

const { data: emp, error: e0 } = await sb.from('companies').select('id').eq('name', 'Buscatools').single()
if (e0) throw e0
const { data: marcas, error: e1 } = await sb.from('brands').select('id, name').eq('company_id', emp.id)
if (e1) throw e1
const idDe = new Map(marcas.map((m) => [m.name.toLowerCase(), m.id]))

const { propuesta } = JSON.parse(readFileSync('revision/categorias/propuesta-marcas.json', 'utf8'))

// 1. La marca, agrupada.
const grupos = new Map()
for (const x of propuesta) {
  const id = idDe.get(x.marca.toLowerCase())
  if (!id) throw new Error(`No existe la marca «${x.marca}»`)
  if (!grupos.has(id)) grupos.set(id, { nombre: x.marca, ids: [] })
  grupos.get(id).ids.push(x.id)
}
let hechos = 0
for (const [brandId, g] of grupos) {
  for (let i = 0; i < g.ids.length; i += 200) {
    const ids = g.ids.slice(i, i + 200)
    if (APLICAR) {
      const { error, count } = await sb
        .from('products')
        .update({ brand_id: brandId }, { count: 'exact' })
        .eq('company_id', emp.id)
        .is('brand_id', null)
        .in('id', ids)
      if (error) throw new Error(`${g.nombre}: ${error.message}`)
      hechos += count ?? 0
    } else hechos += ids.length
  }
}
console.log(APLICAR ? 'Marca aplicada:' : 'Se aplicaría marca a:', hechos, 'de', propuesta.length)

// 2. En Genérico, el nombre de la marca detectada queda en la ficha (marca_disp).
const conDisp = propuesta.filter((x) => x.marca === 'Genérico' && x.detectada)
for (const x of conDisp) {
  if (!APLICAR) continue
  const { data: p, error } = await sb.from('products').select('attributes').eq('id', x.id).single()
  if (error) throw error
  const attributes = { ...(p.attributes ?? {}), marca_disp: x.marcaDisp }
  const { error: e2 } = await sb.from('products').update({ attributes }).eq('id', x.id)
  if (e2) throw new Error(`${x.sku}: ${e2.message}`)
}
console.log(APLICAR ? 'marca_disp cargada en:' : 'marca_disp se cargaría en:', conDisp.length)
