/**
 * Exporta los productos de una empresa con su marca, categoría, tipo y
 * atributos, para revisar la clasificación. SÓLO LEE.
 *
 *   node --env-file=.env.migration scripts/exportar-productos-categorias.mjs Buscatools
 */
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'

const empresa = process.argv[2] ?? 'Buscatools'
const sb = createClient(
  process.env.SUPABASE_URL ?? 'https://jiudqbusyknubonpedde.supabase.co',
  process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })

const { data: emp, error: e0 } = await sb.from('companies').select('id').eq('name', empresa).single()
if (e0) throw e0
const filas = []
for (let desde = 0; ; desde += 1000) {
  const { data, error } = await sb
    .from('products')
    .select('id, sku, name, description, product_type, attributes, public_slug, brands(name), product_categories!products_category_id_fkey(slug, name)')
    .eq('company_id', emp.id)
    .order('id')
    .range(desde, desde + 999)
  if (error) throw error
  filas.push(...data)
  if (data.length < 1000) break
}
const salida = filas.map((p) => ({
  id: p.id, sku: p.sku, marca: p.brands?.name ?? null, cat: p.product_categories?.slug ?? null,
  tipo: p.product_type, nombre: p.name, desc: p.description, attrs: p.attributes, publico: p.public_slug !== null,
}))
writeFileSync(`revision/categorias/productos-${empresa}.json`, JSON.stringify(salida))
console.log(empresa, salida.length, 'productos')
