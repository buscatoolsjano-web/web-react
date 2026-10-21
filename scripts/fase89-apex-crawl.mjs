/*
 * Índice del catálogo APEX desde apexbits.com (Fase 89). SÓLO LEE la web.
 *
 * El usuario pidió basarse en apexbits.com (Omega Technologies, distribuidor
 * oficial de APEX): es la fuente con FOTO REAL por producto —alojada en
 * mrotools.de— y descripción con specs. No hay sitemap de máquina ni se puede
 * usar /search.aspx (lo prohíbe robots.txt), así que se recorre el árbol de
 * categorías, que sí está permitido, juntando las páginas de producto.
 *
 * Cada producto es una `.aspx` cuyo slug EMPIEZA con el modelo:
 *   /440-TX-05X-Apex-1-4-Torx-Hex-Insert-Bits.aspx
 *   imagen: mrotools.de/products/apex-fastener-tools/display/<slug>.jpg
 *
 * Salida: scripts/.apex/apexbits-index.json = [{model, slug, url, image, title}].
 * No escribe en la base. El match con nuestro catálogo y las fotos van después.
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const BASE = 'https://apexbits.com'
const SALIDA = process.argv[2] || 'scripts/.apex'
const CONCURRENCIA = 5
const MAX_PAGINAS = 2000 // tope de seguridad

const esProducto = (href) => /-apex-[a-z0-9-]*\.aspx$/i.test(href)
const UTIL = /cart|login|account|checkout|contact|shipping|about|register|password|wishlist|list-|search|index\.aspx|email|quote|review|profile|catalog|\.pdf|facebook|twitter|constantcontact|omegatec|dotco|mrotools|cleco|jacobs|lufkin/i

const normUrl = (href) => {
  try {
    const u = new URL(href, BASE)
    if (u.hostname !== 'apexbits.com') return null
    return u.origin + u.pathname // sin query ni hash
  } catch {
    return null
  }
}

const slugDe = (url) => url.replace(/^https?:\/\/apexbits\.com\//i, '').replace(/\.aspx$/i, '')
const modeloDeSlug = (slug) => {
  const m = slug.match(/^(.*?)-apex-/i)
  return (m ? m[1] : slug).toUpperCase()
}
const imagenDeSlug = (slug) =>
  `https://mrotools.de/products/apex-fastener-tools/display/${slug.toLowerCase()}.jpg`

async function bajar(url) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 buscatools-catalog-sync' } })
    if (!r.ok) return null
    return await r.text()
  } catch {
    return null
  }
}

// Enlaces de una página: separa productos de subcategorías.
function enlacesDe(html) {
  const productos = new Set()
  const categorias = new Set()
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+\.aspx)["']/gi)) {
    const url = normUrl(m[1])
    if (!url) continue
    const path = url.replace(BASE, '')
    if (esProducto(path)) productos.add(url)
    else if (!UTIL.test(path)) categorias.add(url)
  }
  return { productos, categorias }
}

// Título visible de cada producto, para leer specs después (del texto del <a>).
function titulosDe(html) {
  const map = new Map()
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+-apex-[^"']+\.aspx)["'][^>]*>([^<]*)</gi)) {
    const url = normUrl(m[1])
    const txt = m[2].replace(/\s+/g, ' ').trim()
    if (url && txt) map.set(url, txt)
  }
  return map
}

async function main() {
  console.log('[crawl] categorías desde la portada…')
  const home = await bajar(BASE + '/')
  if (!home) throw new Error('no se pudo leer la portada')
  const seed = [...enlacesDe(home).categorias]
  console.log(`[crawl] ${seed.length} categorías semilla`)

  const visto = new Set()
  const cola = [...seed]
  const productos = new Map() // url -> title

  let procesadas = 0
  while (cola.length && procesadas < MAX_PAGINAS) {
    const lote = cola.splice(0, CONCURRENCIA).filter((u) => !visto.has(u))
    lote.forEach((u) => visto.add(u))
    if (!lote.length) continue
    const htmls = await Promise.all(lote.map(bajar))
    procesadas += lote.length
    for (const html of htmls) {
      if (!html) continue
      const { productos: prod, categorias: cat } = enlacesDe(html)
      const titulos = titulosDe(html)
      for (const p of prod) if (!productos.has(p) || titulos.get(p)) productos.set(p, titulos.get(p) || productos.get(p) || '')
      for (const c of cat) if (!visto.has(c) && !cola.includes(c)) cola.push(c)
    }
    if (procesadas % 25 === 0) console.log(`[crawl] páginas: ${procesadas} · productos: ${productos.size} · cola: ${cola.length}`)
  }

  const indice = [...productos.entries()].map(([url, title]) => {
    const slug = slugDe(url)
    return { model: modeloDeSlug(slug), slug, url, image: imagenDeSlug(slug), title }
  })

  mkdirSync(SALIDA, { recursive: true })
  writeFileSync(`${SALIDA}/apexbits-index.json`, JSON.stringify(indice, null, 0), 'utf8')
  console.log(`[crawl] LISTO: ${indice.length} productos · ${procesadas} páginas → ${SALIDA}/apexbits-index.json`)
}

main().catch((e) => {
  console.error('[crawl]', e)
  process.exit(1)
})
