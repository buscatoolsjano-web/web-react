/**
 * La imagen para compartir la portada (1200×630): la que aparece cuando
 * alguien pega el enlace del sitio en WhatsApp, LinkedIn o un correo.
 *
 * Logo y título a la izquierda, cuatro productos del catálogo a la derecha,
 * sobre blanco. Se arma UNA vez con sharp y queda en public/og/portada.jpg:
 * no depende de la base ni corre en el deploy.
 *
 *   node scripts/og-portada.mjs
 */
import sharp from 'sharp'

const ANCHO = 1200
const ALTO = 630
const BASE = 'https://jiudqbusyknubonpedde.supabase.co/storage/v1/object/public/catalogo-publico/medianas/'
// Medianas de productos representativos: una punta, un balanceador, un
// atornillador y una llave dinamométrica.
const FOTOS = process.argv.slice(2)

const bajar = async (url) => Buffer.from(await (await fetch(url)).arrayBuffer())

const texto = Buffer.from(`
<svg width="${ANCHO}" height="${ALTO}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .k { font: 600 22px Arial, Helvetica, sans-serif; fill: #c2410c; letter-spacing: 1px }
    .t { font: 700 52px Arial, Helvetica, sans-serif; fill: #111827 }
    .b { font: 400 26px Arial, Helvetica, sans-serif; fill: #4b5563 }
    .u { font: 600 24px Arial, Helvetica, sans-serif; fill: #c2410c }
  </style>
  <rect x="0" y="${ALTO - 14}" width="${ANCHO}" height="14" fill="#ea580c"/>
  <text x="64" y="232" class="k">HERRAMIENTAS INDUSTRIALES</text>
  <text x="64" y="300" class="t">Montaje y torque</text>
  <text x="64" y="362" class="t">para tu línea</text>
  <text x="64" y="424" class="t">de producción</text>
  <text x="64" y="488" class="b">Atornilladores · Balanceadores · Puntas y tubos</text>
  <text x="64" y="528" class="b">Llaves dinamométricas y de impacto</text>
  <text x="64" y="580" class="u">app.buscatools.com</text>
</svg>`)

const logo = await sharp('public/brand/buscatools-logo.png').resize({ height: 92 }).png().toBuffer()

const CELDA = 250
const capas = [{ input: texto, left: 0, top: 0 }, { input: logo, left: 64, top: 64 }]
const fotos = await Promise.all(FOTOS.slice(0, 4).map(bajar))
for (const [i, f] of fotos.entries()) {
  const celda = await sharp(f)
    .resize({ width: CELDA - 30, height: CELDA - 30, fit: 'contain', background: '#ffffff' })
    .extend({ top: 15, bottom: 15, left: 15, right: 15, background: '#ffffff' })
    .png()
    .toBuffer()
  const borde = Buffer.from(
    `<svg width="${CELDA}" height="${CELDA}"><rect x="1" y="1" width="${CELDA - 2}" height="${CELDA - 2}" rx="18" fill="none" stroke="#e5e7eb" stroke-width="2"/></svg>`,
  )
  const left = 640 + (i % 2) * (CELDA + 20)
  const top = 50 + Math.floor(i / 2) * (CELDA + 20)
  capas.push({ input: celda, left, top }, { input: borde, left, top })
}

await sharp({ create: { width: ANCHO, height: ALTO, channels: 3, background: '#ffffff' } })
  .composite(capas)
  .jpeg({ quality: 82, mozjpeg: true })
  .toFile('public/og/portada.jpg')
console.log('public/og/portada.jpg listo')
