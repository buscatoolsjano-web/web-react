/**
 * Versiones optimizadas (WebP) de las fotos de producto: miniatura y mediana.
 *
 * «Optimizá todas las imágenes para que pesen menos» y «es importante que
 * estén todas bien comprimidas para que la web cargue mucho más rápido».
 * De cada foto distinta se arman, UNA vez, dos versiones en WebP y se guardan
 * en el bucket público:
 *
 *   miniatura · 400 px  · `miniaturas/<md5>.webp` → `thumb_url`
 *               listados, tarjetas, documentos.
 *   mediana   · 1200 px · `medianas/<md5>.webp`   → `medium_url`
 *               la ficha del producto, la galería, la web.
 *
 * Las fotos que están en sitios de terceros (apexbits, buscatool.com) quedan
 * COPIADAS en el bucket propio: la web deja de depender de que esos sitios
 * anden rápido —o de que sigan existiendo—.
 *
 * El nombre sale del md5 de la URL de origen (`md5(source_url)`), así la base
 * lo calcula sola: un trigger apunta a las versiones cuando entra una foto que
 * ya las tiene. No hay costo por uso (la alternativa, que Supabase las achique
 * al vuelo, se cobra por foto y por mes).
 *
 * IDEMPOTENTE: sólo mira las fotos a las que les falta alguna versión, arma
 * esa y completa la columna. Lo corre `.github/workflows/miniaturas.yml` cada
 * 15 minutos, así las fotos que sube Grok por el MCP quedan optimizadas solas.
 *
 *   set -a; source .env.migration; set +a
 *   node scripts/miniaturas-fotos.mjs                     # todo lo que falta
 *   node scripts/miniaturas-fotos.mjs --prueba 20         # sólo 20, para medir
 *   node scripts/miniaturas-fotos.mjs --prueba 20 --sin-base  # medir sin tocar la base
 */
import crypto from 'node:crypto'
import sharp from 'sharp'
import { createClient } from '@supabase/supabase-js'

const BUCKET = 'catalogo-publico'
const EN_PARALELO = 8

/**
 * Las dos versiones. `hecha` es el filtro de PostgREST de las filas que YA la
 * tienen; las demás son candidatas.
 */
const VERSIONES = [
  {
    nombre: 'miniatura',
    carpeta: 'miniaturas',
    lado: 400,
    calidad: 72,
    columna: 'thumb_url',
    // Las que suben desde el editor ya traen la suya (`.mini.webp`).
    falta: 'thumb_url.is.null,and(thumb_url.not.like.*/miniaturas/*,thumb_url.not.like.*.mini.webp)',
  },
  {
    nombre: 'mediana',
    carpeta: 'medianas',
    lado: 1200,
    calidad: 80,
    columna: 'medium_url',
    falta: 'medium_url.is.null',
  },
]

const arg = (n) => process.argv.includes(n)
const prueba = arg('--prueba') ? Number(process.argv[process.argv.indexOf('--prueba') + 1] ?? 20) : null
const sinBase = arg('--sin-base')

if (!process.env.SUPABASE_SECRET_KEY) {
  console.error('Falta SUPABASE_SECRET_KEY (set -a; source .env.migration; set +a)')
  process.exit(1)
}
const URL_BASE = process.env.SUPABASE_URL ?? 'https://jiudqbusyknubonpedde.supabase.co'
const sb = createClient(URL_BASE, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
const BASE_PUBLICA = `${URL_BASE}/storage/v1/object/public/${BUCKET}/`

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex')
export const nombreEn = (carpeta, url) => `${carpeta}/${md5(url)}.webp`

/** Las URLs de origen a las que les falta esta versión, con orden total. */
async function faltantes(v) {
  const vistas = new Set()
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb
      .from('product_images')
      .select('id, source_url')
      .not('source_url', 'is', null)
      .or(v.falta)
      .order('id')
      .range(desde, desde + 999)
    if (error) throw new Error(`${v.nombre}: ${error.message}`)
    for (const f of data) vistas.add(f.source_url)
    if (data.length < 1000) break
  }
  return vistas
}

async function yaHechas(carpeta) {
  const hechas = new Set()
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.storage.from(BUCKET).list(carpeta, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw new Error(error.message)
    for (const o of data) hechas.add(`${carpeta}/${o.name}`)
    if (data.length < 1000) break
  }
  return hechas
}

async function bajar(url) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 30_000)
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (optimizar-fotos)' } })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return Buffer.from(await r.arrayBuffer())
  } finally {
    clearTimeout(t)
  }
}

/** Todas las filas con esa foto pasan a usar la versión. */
async function apuntar(v, url) {
  if (sinBase) return
  const { error } = await sb
    .from('product_images')
    .update({ [v.columna]: BASE_PUBLICA + nombreEn(v.carpeta, url) })
    .eq('source_url', url)
  if (error) throw new Error(`no se pudo guardar ${v.columna}: ${error.message}`)
}

/**
 * La versión comprimida. Si a la calidad elegida pesa casi lo mismo que el
 * original (una foto ya chica y bien comprimida), se baja un escalón: el
 * punto de esto es que pese MENOS.
 */
async function comprimir(original, v) {
  const base = () =>
    sharp(original, { failOn: 'none' })
      .rotate()
      .resize({ width: v.lado, height: v.lado, fit: 'inside', withoutEnlargement: true })
  let out = await base().webp({ quality: v.calidad, effort: 5 }).toBuffer()
  if (out.length > original.length * 0.9) {
    const otra = await base().webp({ quality: v.calidad - 14, effort: 6 }).toBuffer()
    if (otra.length < out.length) out = otra
  }
  return out
}

// ── qué falta ────────────────────────────────────────────────────────────────
const porUrl = new Map() // url → versiones que le faltan
for (const v of VERSIONES) {
  const urls = await faltantes(v)
  const hechas = urls.size ? await yaHechas(v.carpeta) : new Set()
  let apuntadas = 0
  for (const u of urls) {
    if (hechas.has(nombreEn(v.carpeta, u))) {
      // Ya existe (otra fila con la misma foto): sólo falta apuntarla.
      await apuntar(v, u)
      apuntadas += 1
    } else {
      if (!porUrl.has(u)) porUrl.set(u, [])
      porUrl.get(u).push(v)
    }
  }
  console.log(`${v.nombre}: ${urls.size} fotos sin ella en la base · ${apuntadas} ya estaban hechas (apuntadas)`)
}

let pendientes = [...porUrl.keys()]
if (prueba) pendientes = pendientes.slice(0, prueba)
if (pendientes.length === 0) {
  console.log('Todas las fotos tienen sus versiones optimizadas.')
  process.exit(0)
}
console.log(`${pendientes.length} fotos por procesar${sinBase ? ' (sin tocar la base)' : ''}`)

// ── a hacerlas ───────────────────────────────────────────────────────────────
const stats = Object.fromEntries(VERSIONES.map((v) => [v.nombre, { n: 0, antes: 0, despues: 0 }]))
let hechasN = 0
let fallas = 0
const errores = []

async function una(url) {
  try {
    const original = await bajar(url)
    for (const v of porUrl.get(url)) {
      const out = await comprimir(original, v)
      const { error } = await sb.storage.from(BUCKET).upload(nombreEn(v.carpeta, url), out, {
        contentType: 'image/webp',
        // El nombre depende del origen: si la foto cambia, cambia la URL y el
        // nombre. Se puede guardar para siempre.
        cacheControl: '31536000',
        upsert: true,
      })
      if (error) throw new Error(error.message)
      await apuntar(v, url)
      const s = stats[v.nombre]
      s.n += 1
      s.antes += original.length
      s.despues += out.length
    }
    hechasN += 1
  } catch (e) {
    fallas += 1
    errores.push(`${url} → ${e instanceof Error ? e.message : e}`)
  }
  const n = hechasN + fallas
  if (n % 200 === 0) console.log(`  ${n}/${pendientes.length} · ${fallas} fallas`)
}

const cola = [...pendientes]
await Promise.all(
  Array.from({ length: EN_PARALELO }, async () => {
    while (cola.length) await una(cola.shift())
  }),
)

console.log(`Listo: ${hechasN} fotos, ${fallas} fallas.`)
for (const [nombre, s] of Object.entries(stats)) {
  if (!s.n) continue
  console.log(
    `  ${nombre}: ${s.n} · original ${(s.antes / s.n / 1024).toFixed(1)} KB → ${(s.despues / s.n / 1024).toFixed(1)} KB (${((1 - s.despues / s.antes) * 100).toFixed(0)} % menos)`,
  )
}
if (errores.length) console.log('Fallas (primeras 15):\n' + errores.slice(0, 15).join('\n'))
