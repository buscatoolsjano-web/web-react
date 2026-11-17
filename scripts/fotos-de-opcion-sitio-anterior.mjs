/*
 * Fotos de los botones de la guía que no tienen ninguna foto de producto en
 * el catálogo (Llaves dinamométricas, Repuestos, EPP, Herramientas manuales y
 * tipos sueltos). Salen del sitio anterior de Buscatools (buscatool.com, la
 * tienda WooCommerce): son fotos propias. Se buscan por una palabra que
 * describe el tipo, se achican a 400 px en WebP y se guardan en
 * `public/opciones/`, que se sirve con el sitio.
 *
 * Uso:  node scripts/fotos-de-opcion-sitio-anterior.mjs [--aplicar]
 *   sin --aplicar: baja y arma una hoja de contacto para revisarlas a ojo.
 *   con --aplicar: además escribe las rutas en fotosDeOpcion.generated.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'

const RAIZ = resolve(import.meta.dirname, '..')
const DESTINO = join(RAIZ, 'public/opciones')
const RUTA_JSON = join(RAIZ, 'src/modules/publico/lib/fotosDeOpcion.generated.json')
const APLICAR = process.argv.includes('--aplicar')

/** [rubro (slug), tipo, búsqueda en el sitio anterior] */
const BUSQUEDAS = [
  ['llaves-dinamometricas', 'Llave dinamométrica', 'torquimetro ajustable'],
  ['llaves-dinamometricas', 'Destornillador Dinamométrico', 'destornillador de torque'],
  ['llaves-dinamometricas', 'Cabezal', 'cabezal intercambiable'],
  ['repuestos', 'Repuesto', 'repuesto'],
  ['repuestos', 'Cabezal', 'cabezal intercambiable'],
  ['epp', 'Calzado de seguridad', 'botin'],
  ['epp', 'Guantes', 'guante'],
  ['epp', 'Ropa de trabajo', 'mameluco'],
  ['epp', 'Protección respiratoria', 'mascara'],
  ['epp', 'Protección general', 'manga anticorte'],
  ['epp', 'Casco', 'casco'],
  ['epp', 'Protección facial y visual', 'antiparras'],
  ['epp', 'Protección contra caídas', 'arnes'],
  ['herramientas-manuales', 'Alicate', 'alicate'],
  ['herramientas-manuales', 'Alicate y pinza', 'pinza'],
  ['herramientas-manuales', 'Llave', 'llave allen'],
  ['herramientas-manuales', 'Llave combinada', 'llave combinada'],
  ['herramientas-manuales', 'Llave ajustable', 'llave ajustable'],
  ['herramientas-manuales', 'Martillo', 'martillo'],
  ['herramientas-manuales', 'Morsa y prensa', 'morsa'],
  ['herramientas-manuales', 'Lima', 'lima'],
  ['herramientas-manuales', 'Cincel y punzón', 'punzon'],
  ['herramientas-manuales', 'Sierra', 'arco de sierra'],
  ['puntas-y-tubos', 'Destornillador Manual', 'destornillador'],
  ['puntas-y-tubos', 'Husillo', 'husillo'],
]

const slugDe = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

async function buscar(q) {
  const url = `https://www.buscatool.com/wp-json/wc/store/v1/products?search=${encodeURIComponent(q)}&per_page=10`
  const r = await fetch(url, { headers: { 'user-agent': 'buscatools-erp-fotos/1.0' } })
  if (!r.ok) return null
  const productos = await r.json()
  const con = (Array.isArray(productos) ? productos : []).find((p) => p.images?.[0]?.src)
  return con ? { nombre: con.name, src: con.images[0].src } : null
}

mkdirSync(DESTINO, { recursive: true })
const resultado = []
for (const [rubro, tipo, q] of BUSQUEDAS) {
  const hallado = await buscar(q)
  if (!hallado) {
    console.log(`  (nada) ${rubro} / ${tipo} ← «${q}»`)
    continue
  }
  // Sólo imágenes del propio sitio: nunca se sigue un enlace a otro dominio.
  if (!hallado.src.startsWith('https://www.buscatool.com/wp-content/uploads/')) {
    console.log(`  (otro dominio, se saltea) ${rubro} / ${tipo}`)
    continue
  }
  const r = await fetch(hallado.src)
  if (!r.ok) continue
  const archivo = `${rubro}--${slugDe(tipo)}.webp`
  // Se vuelve a codificar desde cero: lo que se guarda es una imagen nueva,
  // nunca el archivo bajado tal cual.
  await sharp(Buffer.from(await r.arrayBuffer()))
    .resize(400, 400, { fit: 'contain', background: '#ffffff' })
    .flatten({ background: '#ffffff' })
    .webp({ quality: 78 })
    .toFile(join(DESTINO, archivo))
  resultado.push({ rubro, tipo, archivo, producto: hallado.nombre })
  console.log(`${rubro} / ${tipo} ← ${hallado.nombre}`)
}

// Hoja de contacto: todas juntas, con su rótulo, para revisarlas de un vistazo.
const lado = 160
const columnas = 6
const filas = Math.ceil(resultado.length / columnas)
const piezas = await Promise.all(
  resultado.map(async (x, i) => ({
    input: await sharp(join(DESTINO, x.archivo)).resize(lado, lado).toBuffer(),
    left: (i % columnas) * lado,
    top: Math.floor(i / columnas) * (lado + 24),
  })),
)
const rotulos = resultado
  .map((x, i) => `<text x="${(i % columnas) * lado + 4}" y="${Math.floor(i / columnas) * (lado + 24) + lado + 16}" font-size="11" font-family="Arial">${x.tipo.replace(/&/g, '&amp;')}</text>`)
  .join('')
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${columnas * lado}" height="${filas * (lado + 24)}">${rotulos}</svg>`)
await sharp({ create: { width: columnas * lado, height: filas * (lado + 24), channels: 3, background: '#ffffff' } })
  .composite([...piezas, { input: svg, left: 0, top: 0 }])
  .jpeg({ quality: 80 })
  .toFile(join(RAIZ, 'revision', 'fotos-de-opcion.jpg'))
console.log(`hoja de contacto: revision/fotos-de-opcion.jpg (${resultado.length} fotos)`)

if (APLICAR) {
  const fotos = JSON.parse(readFileSync(RUTA_JSON, 'utf8'))
  for (const x of resultado) {
    fotos[x.rubro] ??= {}
    fotos[x.rubro].tipo ??= {}
    if (!fotos[x.rubro].tipo[x.tipo]) fotos[x.rubro].tipo[x.tipo] = `/opciones/${x.archivo}`
  }
  writeFileSync(RUTA_JSON, `${JSON.stringify(fotos, null, 2)}\n`)
  console.log('fotosDeOpcion.generated.json actualizado')
}
