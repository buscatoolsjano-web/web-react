/**
 * Fase 25 · E6 — Sacar del legacy el mapeo de «hoja del catálogo».
 *
 * **SÓLO LECTURA sobre el legacy. No escribe en ninguna base.** Produce dos
 * cosas en disco y nada más:
 *
 *   1. `scripts/output/fase25-hojas-catalogo.json` — el mapeo SKU → catálogo +
 *      página, que `fase25-e6-hojas-aplicar.mjs` es el que después escribe.
 *   2. `public/catalogos/durofix-NN.jpg` — las 12 páginas del catálogo DUROFIX,
 *      que en el legacy viven embebidas en base64 dentro del propio `app.js`
 *      (2,25 MB de literal) y que **no están** en el GitHub Pages donde sí
 *      están las otras cinco. Sin esto, los 48 productos DUROFIX —los únicos
 *      que ya tenían el dato en la base— siguen mostrando «la hoja escaneada
 *      no está cargada».
 *
 * De dónde sale cada cosa en el legacy:
 *
 *   · `_CATALOGOS_INFO`            (`app.js:16654`) — los 6 catálogos y su cantidad de páginas
 *   · `_SPEEDRILL_SKU_TO_PAGE`     (`app.js:29`)    — 1.418 SKU → página
 *   · `_TECNA_SKU_TO_PAGE`         (`app.js:79`)    — 285 SKU → catálogo + página
 *   · `_asignarCatalogoTorero`     (`app.js:45`)    — TORERO serie LTR/LTU → torero, página 1
 *   · `_asignarCatalogoTecna`      (`app.js:80`)    — el respaldo por serie de TECNA
 *   · `_DUROFIX_PAGES`             (`app.js:16813`) — las 12 páginas en base64
 *   · `renderCatalogoVisor`        (`app.js:16814`) — cómo arma la URL de la imagen
 *
 *   node scripts/fase25-e6-hojas-legacy-extraer.mjs <ruta-al-legacy> [--sin-imagenes]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * El literal de objeto de `const <nombre>= {…}`, contando llaves.
 *
 * Contar llaves y no usar una expresión regular es a propósito: los literales
 * tienen 2,25 MB de base64 con todo tipo de caracteres adentro, y cualquier
 * regex no anclada se vuelve una bomba de retroceso.
 */
export function literalDe(src, nombre) {
  const i = src.indexOf(`const ${nombre}`)
  if (i < 0) return null
  const abre = src.indexOf('{', i)
  if (abre < 0) return null
  let nivel = 0
  for (let j = abre; j < src.length; j++) {
    if (src[j] === '{') nivel++
    else if (src[j] === '}') {
      nivel--
      if (nivel === 0) return src.slice(abre, j + 1)
    }
  }
  return null
}

/**
 * La URL de la página, tal como la arma el legacy (`app.js:16830`).
 *
 * SPEEDRILL rellena a 3 dígitos porque su catálogo tiene 168 páginas; el resto
 * a 2. Es el nombre del archivo en el repo de imágenes, no una convención que
 * podamos elegir.
 */
export function urlDePagina(catalogo, pagina) {
  const ancho = catalogo === 'speedrill' ? 3 : 2
  return `https://janoguarini.github.io/catalogos-buscatools/${catalogo}-${String(pagina).padStart(ancho, '0')}.jpg`
}

/** El respaldo por serie de TECNA, cuando el SKU no está en el mapeo (`app.js:89`). */
export function catalogoTecnaPorSerie(serie, sku) {
  const s = (serie ?? '').toUpperCase()
  const k = (sku ?? '').toUpperCase()
  if (s === 'NO GRAVITY' || k.includes('X-LIGHT')) return 'nogravity'
  if (s === 'FOOD INDUSTRY' || /(IL|RL)$/.test(k)) return 'food'
  return 'generale'
}

function main() {
  const base = process.argv[2]
  if (!base) throw new Error('uso: fase25-e6-hojas-legacy-extraer.mjs <ruta-al-legacy> [--sin-imagenes]')
  const src = readFileSync(join(base, 'app.js'), 'utf8')

  const catalogos = JSON.parse(
    (literalDe(src, '_CATALOGOS_INFO') ?? '{}')
      // El literal es JS, no JSON: claves sin comillas y comillas simples.
      .replace(/([{,]\s*)([a-z_]+)\s*:/gi, '$1"$2":')
      .replace(/'/g, '"'),
  )
  const speedrill = JSON.parse(literalDe(src, '_SPEEDRILL_SKU_TO_PAGE') ?? '{}')
  const tecna = JSON.parse(literalDe(src, '_TECNA_SKU_TO_PAGE') ?? '{}')

  /** Una entrada por SKU: qué catálogo y qué página le corresponde. */
  const porSku = {}
  for (const [sku, pagina] of Object.entries(speedrill)) {
    porSku[sku] = { catalogo: 'speedrill', pagina, regla: 'mapeo SPEEDRILL' }
  }
  for (const [sku, v] of Object.entries(tecna)) {
    porSku[sku] = { catalogo: v.catalogo, pagina: v.pagina, regla: 'mapeo TECNA' }
  }

  // Cuántas páginas de cada catálogo se usan, para cruzarlas con `total`: una
  // página 200 en un catálogo de 168 sería un dato roto, y es mejor verlo acá
  // que descubrirlo con un 404 en la pantalla.
  const fuera = []
  for (const [sku, v] of Object.entries(porSku)) {
    const info = catalogos[v.catalogo]
    if (!info) fuera.push({ sku, motivo: `catálogo desconocido: ${v.catalogo}` })
    else if (v.pagina < 1 || v.pagina > info.total) fuera.push({ sku, motivo: `página ${v.pagina} fuera de 1..${info.total}` })
  }

  mkdirSync('scripts/output', { recursive: true })
  const salida = 'scripts/output/fase25-hojas-catalogo.json'
  writeFileSync(salida, JSON.stringify({ generado: new Date().toISOString(), catalogos, porSku, fuera }, null, 0))

  const porCatalogo = {}
  for (const v of Object.values(porSku)) porCatalogo[v.catalogo] = (porCatalogo[v.catalogo] ?? 0) + 1

  console.log('catálogos:', Object.entries(catalogos).map(([k, v]) => `${k}(${v.total}p)`).join(' '))
  console.log('SKU mapeados:', Object.keys(porSku).length, JSON.stringify(porCatalogo))
  console.log('páginas fuera de rango:', fuera.length)
  for (const f of fuera.slice(0, 10)) console.log('  ·', f.sku, f.motivo)
  console.log(`\n${salida}`)
  console.log('TORERO (serie LTR/LTU → torero p.1) lo resuelve el script que aplica: es una regla, no un mapeo.')

  if (process.argv.includes('--sin-imagenes')) return

  // ── Las 12 páginas de DUROFIX, que sólo existen embebidas ────────────────
  const durofix = literalDe(src, '_DUROFIX_PAGES')
  if (!durofix) {
    console.log('\nNo encontré _DUROFIX_PAGES: nada que extraer.')
    return
  }
  mkdirSync('public/catalogos', { recursive: true })
  let bytes = 0
  let cuantas = 0
  // Cada entrada es `<n>:"data:image/jpeg;base64,…"`. Se recorre buscando el
  // prefijo y cortando en la comilla de cierre: sin regex sobre 2,25 MB.
  const re = /(\d+)\s*:\s*"data:image\/(jpeg|png);base64,/g
  for (let m = re.exec(durofix); m !== null; m = re.exec(durofix)) {
    const desde = m.index + m[0].length
    const hasta = durofix.indexOf('"', desde)
    if (hasta < 0) break
    const datos = Buffer.from(durofix.slice(desde, hasta), 'base64')
    const archivo = `public/catalogos/durofix-${String(m[1]).padStart(2, '0')}.${m[2] === 'png' ? 'png' : 'jpg'}`
    writeFileSync(archivo, datos)
    bytes += datos.length
    cuantas++
  }
  console.log(`\nDUROFIX: ${cuantas} páginas en public/catalogos/ (${(bytes / 1024 / 1024).toFixed(2)} MB)`)
  console.log('Van al repo porque no están publicadas en ninguna parte: el legacy las llevaba adentro del app.js.')
}

const esteArchivo = import.meta.url.replace(/^file:\/\/\/?/, '').replace(/\\/g, '/').toLowerCase()
const invocado = String(process.argv[1] ?? '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
if (invocado && esteArchivo.endsWith(invocado)) {
  main()
}
