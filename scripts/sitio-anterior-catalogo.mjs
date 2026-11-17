/*
 * Baja el catálogo del sitio anterior (buscatool.com, WooCommerce) por su API
 * pública de tienda: nombre, SKU, enlace y fotos de cada producto. Sólo lee.
 * Deja revision/sitio-anterior.json para cruzarlo con el catálogo del ERP.
 *
 * Uso:  node scripts/sitio-anterior-catalogo.mjs
 */
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const RAIZ = resolve(import.meta.dirname, '..')
const BASE = 'https://www.buscatool.com/wp-json/wc/store/v1/products'
const UA = 'buscatools-erp-fotos/1.0'

const productos = []
for (let pagina = 1; ; pagina++) {
  const r = await fetch(`${BASE}?per_page=100&page=${pagina}`, { headers: { 'user-agent': UA } })
  if (!r.ok) {
    if (r.status === 400) break // pasado el final
    throw new Error(`página ${pagina}: HTTP ${r.status}`)
  }
  const lote = await r.json()
  if (!Array.isArray(lote) || lote.length === 0) break
  for (const p of lote) {
    productos.push({
      id: p.id,
      nombre: (p.name ?? '').replace(/&#8211;/g, '–').replace(/&amp;/g, '&').replace(/&#8243;/g, '"'),
      sku: p.sku ?? '',
      enlace: p.permalink ?? '',
      categorias: (p.categories ?? []).map((c) => c.name),
      fotos: (p.images ?? []).map((i) => i.src).filter((s) => typeof s === 'string' && s.startsWith('https://www.buscatool.com/wp-content/uploads/')),
    })
  }
  const total = r.headers.get('x-wp-totalpages')
  process.stdout.write(`\rpágina ${pagina}/${total ?? '?'} · ${productos.length} productos`)
  if (total && pagina >= Number(total)) break
}
writeFileSync(join(RAIZ, 'revision', 'sitio-anterior.json'), JSON.stringify(productos))
const conFoto = productos.filter((p) => p.fotos.length > 0).length
console.log(`\nlisto: ${productos.length} productos, ${conFoto} con foto, ${productos.filter((p) => p.sku).length} con SKU`)
