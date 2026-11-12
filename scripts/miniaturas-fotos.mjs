/**
 * Miniaturas WebP de las fotos de producto.
 *
 * «Optimizá todas las imágenes para que pesen menos.» Las fotos pesan ~40 KB
 * y en los listados se ven de 60–250 px: se arma, UNA vez, una versión de
 * 400 px como máximo en WebP y se guarda en el bucket público, al lado de las
 * demás. No hay costo por uso (la alternativa, que Supabase las achique al
 * vuelo, se cobra por foto y por mes).
 *
 * Dónde queda cada una: `catalogo-publico/miniaturas/<md5(source_url)>.webp`.
 * El nombre sale del md5 de la URL de origen, así la base lo puede calcular
 * sola (`md5(source_url)`): un trigger apunta a la miniatura cuando entra una
 * foto que ya la tiene.
 *
 * IDEMPOTENTE: sólo mira las fotos cuyo `thumb_url` todavía no es una
 * miniatura, arma la que falta y completa `thumb_url`. Lo corre
 * `.github/workflows/miniaturas.yml` cada 15 minutos, así las fotos que sube
 * Grok por el MCP tienen su miniatura enseguida.
 *
 *   set -a; source .env.migration; set +a
 *   node scripts/miniaturas-fotos.mjs            # todo lo que falta
 *   node scripts/miniaturas-fotos.mjs --prueba 20 # sólo 20, para medir
 */
import crypto from 'node:crypto'
import sharp from 'sharp'
import { createClient } from '@supabase/supabase-js'

const BUCKET = 'catalogo-publico'
const CARPETA = 'miniaturas'
const LADO = 400
const CALIDAD = 72
const EN_PARALELO = 8

const prueba = process.argv.includes('--prueba') ? Number(process.argv[process.argv.indexOf('--prueba') + 1] ?? 20) : null

if (!process.env.SUPABASE_SECRET_KEY) {
  console.error('Falta SUPABASE_SECRET_KEY (set -a; source .env.migration; set +a)')
  process.exit(1)
}
const sb = createClient(process.env.SUPABASE_URL ?? 'https://jiudqbusyknubonpedde.supabase.co', process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
})

export const nombreDeMiniatura = (url) => `${CARPETA}/${crypto.createHash('md5').update(url).digest('hex')}.webp`

const BASE_PUBLICA = `${process.env.SUPABASE_URL ?? 'https://jiudqbusyknubonpedde.supabase.co'}/storage/v1/object/public/${BUCKET}/`

/**
 * Las URLs de origen distintas de las fotos que TODAVÍA NO apuntan a su
 * miniatura, con orden total (sin ORDER BY .range() repite y omite). Así cada
 * corrida programada sólo mira lo nuevo —lo que subió Grok por el MCP, un
 * import—, no las 24.000 filas.
 */
async function urlsDeFotos() {
  const vistas = new Set()
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb
      .from('product_images')
      .select('id, source_url')
      .not('source_url', 'is', null)
      // Las que suben desde el editor ya traen la suya (`.mini.webp`).
      .or('thumb_url.is.null,and(thumb_url.not.like.*/miniaturas/*,thumb_url.not.like.*.mini.webp)')
      .order('id')
      .range(desde, desde + 999)
    if (error) throw new Error(error.message)
    for (const f of data) vistas.add(f.source_url)
    if (data.length < 1000) break
  }
  return [...vistas]
}

async function yaHechas() {
  const hechas = new Set()
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.storage.from(BUCKET).list(CARPETA, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw new Error(error.message)
    for (const o of data) hechas.add(`${CARPETA}/${o.name}`)
    if (data.length < 1000) break
  }
  return hechas
}

async function bajar(url) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 20_000)
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (miniaturas)' } })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return Buffer.from(await r.arrayBuffer())
  } finally {
    clearTimeout(t)
  }
}

/** Todas las filas con esa foto pasan a mostrar la miniatura. */
async function apuntar(url) {
  const { error } = await sb
    .from('product_images')
    .update({ thumb_url: BASE_PUBLICA + nombreDeMiniatura(url) })
    .eq('source_url', url)
  if (error) throw new Error(`no se pudo guardar thumb_url: ${error.message}`)
}

const urls = await urlsDeFotos()
if (urls.length === 0) {
  console.log('Todas las fotos tienen su miniatura.')
  process.exit(0)
}
const hechas = await yaHechas()
// La miniatura ya existe (otra fila con la misma foto): sólo falta apuntarla.
const yaEstaban = urls.filter((u) => hechas.has(nombreDeMiniatura(u)))
for (const u of yaEstaban) await apuntar(u)
let pendientes = urls.filter((u) => !hechas.has(nombreDeMiniatura(u)))
if (prueba) pendientes = pendientes.slice(0, prueba)
console.log(`${urls.length} fotos sin miniatura en la base · ${yaEstaban.length} ya estaban hechas (apuntadas) · ${pendientes.length} por hacer`)

let ok = 0
let fallas = 0
let antes = 0
let despues = 0
const errores = []

async function una(url) {
  try {
    const original = await bajar(url)
    const mini = await sharp(original, { failOn: 'none' })
      .rotate()
      .resize({ width: LADO, height: LADO, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: CALIDAD, effort: 5 })
      .toBuffer()
    const { error } = await sb.storage.from(BUCKET).upload(nombreDeMiniatura(url), mini, {
      contentType: 'image/webp',
      // El nombre depende del origen: si la foto cambia, cambia la URL y el
      // nombre. Se puede guardar para siempre.
      cacheControl: '31536000',
      upsert: true,
    })
    if (error) throw new Error(error.message)
    await apuntar(url)
    ok += 1
    antes += original.length
    despues += mini.length
  } catch (e) {
    fallas += 1
    errores.push(`${url} → ${e instanceof Error ? e.message : e}`)
  }
  const n = ok + fallas
  if (n % 200 === 0) console.log(`  ${n}/${pendientes.length} · ${ok} ok · ${fallas} fallas`)
}

const cola = [...pendientes]
await Promise.all(
  Array.from({ length: EN_PARALELO }, async () => {
    while (cola.length) await una(cola.shift())
  }),
)

console.log(`Listo: ${ok} miniaturas, ${fallas} fallas.`)
if (ok) {
  console.log(
    `Peso promedio: ${(antes / ok / 1024).toFixed(1)} KB → ${(despues / ok / 1024).toFixed(1)} KB (${((1 - despues / antes) * 100).toFixed(0)} % menos)`,
  )
}
if (errores.length) console.log('Fallas (primeras 15):\n' + errores.slice(0, 15).join('\n'))
