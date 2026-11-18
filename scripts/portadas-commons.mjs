/*
 * Portadas de categoría desde Wikimedia Commons (SÓLO dominio público o CC0:
 * se usan sin atribución ni condiciones), para las categorías sin ningún
 * producto con foto.
 *
 *   node scripts/portadas-commons.mjs
 *     baja hasta 4 candidatas por categoría y arma revision/portadas/hoja.jpg
 *     para elegir a ojo.
 *   node --env-file=.env.migration scripts/portadas-commons.mjs --subir slug=N slug=N …
 *     sube la candidata N (1-4) de cada categoría a catalogo-publico/portadas/<empresa>/
 *     y la fija como portada (product_categories.portada_url), sólo en Buscatools.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'

const RAIZ = resolve(import.meta.dirname, '..')
const DIR = join(RAIZ, 'revision', 'portadas')
const UA = 'buscatools-erp-fotos/1.0 (catálogo interno)'
const LIBRES = /^(public domain|cc0|pd|cc-zero)/i

/** [slug de la categoría, búsquedas en inglés] */
const CATEGORIAS = [
  ['mechas', ['twist drill bits', 'drill bit set']],
  ['amoladora', ['angle grinder', 'grinder power tool']],
  ['taladro', ['cordless drill', 'electric drill']],
  ['sierra', ['circular saw', 'jigsaw power tool']],
  ['elevacion', ['chain hoist', 'electric hoist']],
  ['electrico', ['electrical switchboard circuit breakers', 'electrical cable terminals']],
  ['fijaciones', ['bolts and nuts', 'screws assortment']],
  ['pintureria', ['paint brush roller', 'paint cans']],
  ['mobiliario', ['workbench', 'tool cart']],
  ['limpieza', ['broom', 'cleaning supplies']],
  ['conduccion', ['pipe fittings', 'plumbing fittings']],
  ['abrasivos', ['grinding disc', 'sandpaper']],
  ['quimicos', ['lubricant oil can', 'grease gun']],
  ['neumatica', ['pneumatic fittings', 'air compressor']],
  ['almacenamiento', ['storage bins', 'plastic storage boxes shelf']],
  ['soldadura', ['welding', 'welding electrodes']],
]

async function candidatas(q) {
  const url =
    'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=30' +
    `&gsrsearch=${encodeURIComponent(`filetype:bitmap ${q}`)}` +
    '&prop=imageinfo&iiprop=url|extmetadata|mime|size&iiurlwidth=900'
  // Commons frena las ráfagas: se espera entre búsquedas y se reintenta.
  let r
  for (let intento = 0; intento < 4; intento++) {
    await new Promise((ok) => setTimeout(ok, 1500 * (intento + 1)))
    r = await fetch(url, { headers: { 'user-agent': UA } })
    if (r.ok) break
  }
  if (!r.ok) return []
  const d = await r.json()
  return Object.values(d?.query?.pages ?? {})
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((p) => ({ p, ii: p.imageinfo?.[0] }))
    .filter(({ ii }) => ii?.thumburl && LIBRES.test(ii?.extmetadata?.LicenseShortName?.value ?? '') && /image\/(jpeg|png|webp)/.test(ii.mime ?? '') && (ii.width ?? 0) >= 500)
    .map(({ p, ii }) => ({ titulo: p.title, src: ii.thumburl, licencia: ii.extmetadata.LicenseShortName.value }))
}

const archivo = (slug, n) => join(DIR, `${slug}-${n}.webp`)

// --solo slug=q1|q2 …: vuelve a buscar sólo esas categorías, con esas palabras.
const SOLO = new Map(process.argv.filter((a) => a.startsWith('--solo=')).map((a) => a.slice(7)).map((a) => [a.split(':')[0], a.split(':')[1].split('|')]))
if (SOLO.size > 0) for (let i = CATEGORIAS.length - 1; i >= 0; i--) {
  const [slug] = CATEGORIAS[i]
  if (SOLO.has(slug)) CATEGORIAS[i] = [slug, SOLO.get(slug)]
  else CATEGORIAS.splice(i, 1)
}

if (!process.argv.includes('--subir')) {
  mkdirSync(DIR, { recursive: true })
  const elegibles = {}
  for (const [slug, busquedas] of CATEGORIAS) {
    const vistas = new Set()
    const lista = []
    for (const q of busquedas) for (const c of await candidatas(q)) if (!vistas.has(c.titulo) && lista.length < 4) { vistas.add(c.titulo); lista.push(c) }
    elegibles[slug] = []
    for (const [i, c] of lista.entries()) {
      const r = await fetch(c.src, { headers: { 'user-agent': UA } })
      if (!r.ok) continue
      // Se recodifica desde cero: una imagen nueva, 800×600, fondo blanco.
      await sharp(Buffer.from(await r.arrayBuffer())).resize(800, 600, { fit: 'cover' }).webp({ quality: 80 }).toFile(archivo(slug, i + 1))
      elegibles[slug].push({ n: i + 1, ...c })
    }
    console.log(slug, elegibles[slug].length, 'candidatas')
  }
  writeFileSync(join(DIR, 'candidatas.json'), JSON.stringify(elegibles, null, 2))
  // Hoja de contacto: una fila por categoría, 4 columnas.
  const w = 240, h = 180, top = 22
  const filas = CATEGORIAS.map(([s]) => s)
  const piezas = []
  let svg = ''
  for (const [fi, slug] of filas.entries()) {
    svg += `<text x="4" y="${fi * (h + top) + 16}" font-size="14" font-family="Arial" font-weight="bold">${slug}</text>`
    for (const c of elegibles[slug]) {
      piezas.push({ input: await sharp(archivo(slug, c.n)).resize(w, h).toBuffer(), left: (c.n - 1) * (w + 6), top: fi * (h + top) + top })
      svg += `<text x="${(c.n - 1) * (w + 6) + w - 18}" y="${fi * (h + top) + top + 18}" font-size="16" font-family="Arial" fill="red" font-weight="bold">${c.n}</text>`
    }
  }
  const ancho = 4 * (w + 6), alto = filas.length * (h + top)
  await sharp({ create: { width: ancho, height: alto, channels: 3, background: '#ffffff' } })
    .composite([...piezas, { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}">${svg}</svg>`), left: 0, top: 0 }])
    .jpeg({ quality: 72 })
    .toFile(join(DIR, 'hoja.jpg'))
  console.log('hoja: revision/portadas/hoja.jpg')
} else {
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(process.env.SUPABASE_URL ?? 'https://jiudqbusyknubonpedde.supabase.co', process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
  const { data: emp, error: e0 } = await sb.from('companies').select('id').eq('name', 'Buscatools').single()
  if (e0) throw e0
  for (const arg of process.argv.filter((a) => /^[a-z-]+=\d$/.test(a))) {
    const [slug, n] = arg.split('=')
    const ruta = `portadas/${emp.id}/${randomUUID()}.webp`
    const { error } = await sb.storage.from('catalogo-publico').upload(ruta, readFileSync(archivo(slug, n)), { contentType: 'image/webp' })
    if (error) throw new Error(`${slug}: ${error.message}`)
    const url = sb.storage.from('catalogo-publico').getPublicUrl(ruta).data.publicUrl
    const { error: e2, count } = await sb.from('product_categories').update({ portada_url: url }, { count: 'exact' }).eq('company_id', emp.id).eq('slug', slug)
    if (e2) throw new Error(`${slug}: ${e2.message}`)
    console.log(slug, '←', n, count === 1 ? 'ok' : `(${count} filas)`)
  }
}
