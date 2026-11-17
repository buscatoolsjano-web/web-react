/*
 * Fotos genéricas para los botones de la guía sin foto propia (EPP,
 * herramientas manuales…), desde Wikimedia Commons, SÓLO con licencia de
 * dominio público o CC0: se pueden usar sin atribución ni condiciones.
 *
 * Se achican a 400 px en WebP y se guardan en `public/opciones/`.
 *
 * Uso:  node scripts/fotos-de-opcion-commons.mjs [--aplicar]
 *   sin --aplicar: baja y arma la hoja de contacto para revisarlas a ojo.
 *   con --aplicar: escribe las rutas en fotosDeOpcion.generated.json (sólo
 *   donde no había foto).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'

const RAIZ = resolve(import.meta.dirname, '..')
const DESTINO = join(RAIZ, 'public/opciones')
const RUTA_JSON = join(RAIZ, 'src/modules/publico/lib/fotosDeOpcion.generated.json')
const APLICAR = process.argv.includes('--aplicar')
const UA = 'buscatools-erp-fotos/1.0 (catálogo interno)'

/** [rubro (slug), tipo, búsqueda en inglés (Commons tiene más en inglés)] */
const BUSQUEDAS = [
  ['epp', 'Calzado de seguridad', 'safety boots'],
  ['epp', 'Guantes', 'work gloves'],
  ['epp', 'Ropa de trabajo', 'high visibility vest'],
  ['epp', 'Protección respiratoria', 'respirator mask'],
  ['epp', 'Protección general', 'protective gloves'],
  ['epp', 'Casco', 'hard hat'],
  ['epp', 'Protección facial y visual', 'safety glasses'],
  ['epp', 'Protección contra caídas', 'safety harness'],
  ['herramientas-manuales', 'Alicate', 'pliers'],
  ['herramientas-manuales', 'Alicate y pinza', 'locking pliers'],
  ['herramientas-manuales', 'Llave', 'allen key'],
  ['herramientas-manuales', 'Llave combinada', 'combination wrench'],
  ['herramientas-manuales', 'Llave ajustable', 'adjustable spanner'],
  ['herramientas-manuales', 'Martillo', 'mallet'],
  ['herramientas-manuales', 'Morsa y prensa', 'bench vise'],
  ['herramientas-manuales', 'Lima', 'metal file tool'],
  ['herramientas-manuales', 'Cincel y punzón', 'center punch'],
  ['herramientas-manuales', 'Sierra', 'hacksaw'],
  ['puntas-y-tubos', 'Destornillador Manual', 'screwdriver'],
  ['llaves-dinamometricas', 'Destornillador Dinamométrico', 'torque screwdriver'],
  ['llaves-dinamometricas', 'Cabezal', 'ratchet head'],
  ['repuestos', 'Repuesto', 'spare parts'],
]

const LIBRES = /^(public domain|cc0|pd|cc-zero)/i
const slugDe = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

async function buscar(q) {
  const url =
    'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=25' +
    `&gsrsearch=${encodeURIComponent(`filetype:bitmap ${q}`)}` +
    '&prop=imageinfo&iiprop=url|extmetadata|mime&iiurlwidth=480'
  const r = await fetch(url, { headers: { 'user-agent': UA } })
  if (!r.ok) return null
  const d = await r.json()
  const paginas = Object.values(d?.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  for (const p of paginas) {
    const ii = p.imageinfo?.[0]
    const licencia = ii?.extmetadata?.LicenseShortName?.value ?? ''
    if (!ii?.thumburl || !LIBRES.test(licencia)) continue
    if (!/image\/(jpeg|png|webp)/.test(ii.mime ?? '')) continue
    return { titulo: p.title, src: ii.thumburl, licencia }
  }
  return null
}

mkdirSync(DESTINO, { recursive: true })
const resultado = []
for (const [rubro, tipo, q] of BUSQUEDAS) {
  const h = await buscar(q)
  if (!h || !h.src.startsWith('https://upload.wikimedia.org/')) {
    console.log(`  (nada libre) ${rubro} / ${tipo} ← «${q}»`)
    continue
  }
  const r = await fetch(h.src, { headers: { 'user-agent': UA } })
  if (!r.ok) continue
  const archivo = `${rubro}--${slugDe(tipo)}.webp`
  // Se recodifica desde cero: se guarda una imagen nueva, no el archivo bajado.
  await sharp(Buffer.from(await r.arrayBuffer()))
    .resize(400, 400, { fit: 'contain', background: '#ffffff' })
    .flatten({ background: '#ffffff' })
    .webp({ quality: 78 })
    .toFile(join(DESTINO, archivo))
  resultado.push({ rubro, tipo, archivo, titulo: h.titulo, licencia: h.licencia })
  console.log(`${rubro} / ${tipo} ← ${h.titulo} [${h.licencia}]`)
}

const lado = 160
const columnas = 6
const filas = Math.max(1, Math.ceil(resultado.length / columnas))
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
await sharp({ create: { width: columnas * lado, height: filas * (lado + 24), channels: 3, background: '#ffffff' } })
  .composite([...piezas, { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${columnas * lado}" height="${filas * (lado + 24)}">${rotulos}</svg>`), left: 0, top: 0 }])
  .jpeg({ quality: 80 })
  .toFile(join(RAIZ, 'revision', 'fotos-commons.jpg'))
writeFileSync(join(RAIZ, 'revision', 'fotos-commons.json'), JSON.stringify(resultado, null, 2))
console.log(`hoja de contacto: revision/fotos-commons.jpg (${resultado.length} fotos)`)

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
