/**
 * Verificación OFFLINE de las imágenes del catálogo legacy.
 *
 * Sólo LEE. No descarga imágenes completas (usa HEAD), no toca WordPress,
 * no migra nada a Storage. Su única salida es un informe.
 *
 * Para cada URL distinta registra:
 *   original_url · status · bytes_original · host
 *   thumbnail_exists · thumbnail_url · bytes_thumbnail
 *   clasificacion · productos_que_la_usan
 *
 * La regla de miniaturas es la que aprobaste: NUNCA reescribir a ciegas.
 * Este script existe justamente para saber cuáles existen de verdad.
 *
 *   node scripts/verificar-imagenes-legacy.mjs <productos-data.json> <salida.json>
 */
import fs from 'node:fs'
import path from 'node:path'

const [, , ENTRADA, SALIDA] = process.argv
if (!ENTRADA || !SALIDA) {
  console.error('Uso: node scripts/verificar-imagenes-legacy.mjs <productos-data.json> <salida.json>')
  process.exit(1)
}

// El informe NO va dentro del repositorio.
const repo = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
if (path.resolve(SALIDA).startsWith(repo)) {
  console.error('✗ La salida no puede quedar dentro del repositorio: ' + SALIDA)
  process.exit(1)
}

/** WordPress genera estos tamaños; 300x300 es el que sirve para el listado. */
const SUFIJO_MINIATURA = '-300x300'
const CONCURRENCIA = 8      // amable con los dos sitios
const TIMEOUT_MS = 15000

const urlMiniatura = (u) => u.replace(/(\.[A-Za-z0-9]+)(\?.*)?$/, `${SUFIJO_MINIATURA}$1$2`)

async function cabecera(url) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const r = await fetch(url, { method: 'HEAD', signal: ctl.signal, redirect: 'follow' })
    const len = r.headers.get('content-length')
    return {
      status: r.status,
      bytes: len === null ? null : Number(len),
      tipo: r.headers.get('content-type'),
    }
  } catch (e) {
    return { status: e.name === 'AbortError' ? 'TIMEOUT' : 'ERROR', bytes: null, tipo: null }
  } finally {
    clearTimeout(t)
  }
}

/**
 * Clasificación pedida en el punto 12.
 *
 * Los 327 archivos de apexbits viven en /images/diagrams/ y se repiten en
 * hasta 77 productos: son páginas del catálogo, no fotos. Distinguimos el
 * diagrama compartido del que aparece en un solo producto.
 */
function clasificar(url, usos) {
  let host
  try { host = new URL(url).hostname } catch { return { host: '(inválida)', clase: 'UNKNOWN' } }
  const esDiagrama = /\/diagrams?\//i.test(url) || /page-\d+/i.test(url)
  if (esDiagrama) return { host, clase: usos > 1 ? 'SHARED_DIAGRAM' : 'TECHNICAL_DIAGRAM' }
  if (host === 'www.buscatool.com' && /\/wp-content\/uploads\//.test(url))
    return { host, clase: 'PRODUCT_IMAGE' }
  return { host, clase: 'UNKNOWN' }
}

const main = async () => {
  const bruto = JSON.parse(fs.readFileSync(ENTRADA, 'utf8'))
  const productos = Array.isArray(bruto) ? bruto : Object.values(bruto).find(Array.isArray)

  /** url → cantidad de productos que la referencian. */
  const usos = new Map()
  for (const p of productos) {
    for (const u of p.imgs ?? []) {
      if (typeof u === 'string' && u.trim() !== '') {
        const k = u.trim()
        usos.set(k, (usos.get(k) ?? 0) + 1)
      }
    }
  }

  const urls = [...usos.keys()]
  console.log(`  URLs distintas a verificar: ${urls.length}`)
  console.log(`  concurrencia ${CONCURRENCIA} · HEAD · sin descargar cuerpos\n`)

  const filas = []
  let hechas = 0
  const t0 = Date.now()

  // Cola simple con N trabajadores.
  let siguiente = 0
  const trabajador = async () => {
    for (;;) {
      const i = siguiente++
      if (i >= urls.length) return
      const url = urls[i]
      const o = await cabecera(url)
      // La miniatura sólo se prueba si el original responde.
      const m = o.status === 200 ? await cabecera(urlMiniatura(url)) : { status: null, bytes: null }
      const { host, clase } = clasificar(url, usos.get(url))
      filas.push({
        original_url: url,
        status: o.status,
        bytes_original: o.bytes,
        content_type: o.tipo,
        thumbnail_exists: m.status === 200,
        thumbnail_url: m.status === 200 ? urlMiniatura(url) : null,
        bytes_thumbnail: m.status === 200 ? m.bytes : null,
        host,
        clasificacion: clase,
        productos: usos.get(url),
      })
      if (++hechas % 250 === 0) {
        const seg = ((Date.now() - t0) / 1000).toFixed(0)
        console.log(`    ${hechas}/${urls.length}  (${seg}s)`)
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCIA }, trabajador))

  fs.writeFileSync(SALIDA, JSON.stringify(filas, null, 2))

  // Resumen.
  const n = (f) => filas.filter(f).length
  const suma = (f, c) => filas.filter(f).reduce((s, r) => s + (r[c] ?? 0), 0)
  const vivas = filas.filter((r) => r.status === 200)
  const conMin = filas.filter((r) => r.thumbnail_exists)

  console.log('\n' + '═'.repeat(70))
  console.log(`  URLs verificadas          ${filas.length}`)
  console.log(`  responden 200             ${vivas.length}`)
  console.log(`  NO responden 200          ${filas.length - vivas.length}`)
  console.log(`  con miniatura verificada  ${conMin.length}  (${((conMin.length / filas.length) * 100).toFixed(1)}%)`)
  console.log()
  console.log('  por clasificación:')
  for (const c of ['PRODUCT_IMAGE', 'SHARED_DIAGRAM', 'TECHNICAL_DIAGRAM', 'UNKNOWN'])
    console.log(`    ${c.padEnd(20)}${String(n((r) => r.clasificacion === c)).padStart(6)}`)
  console.log()
  console.log('  por host:')
  for (const h of new Set(filas.map((r) => r.host)))
    console.log(`    ${h.padEnd(24)}${String(n((r) => r.host === h)).padStart(6)}` +
      `  miniaturas ${n((r) => r.host === h && r.thumbnail_exists)}`)
  console.log()
  const mbO = suma((r) => r.status === 200, 'bytes_original') / 1048576
  const mbT = suma((r) => r.thumbnail_exists, 'bytes_thumbnail') / 1048576
  console.log(`  peso total originales     ${mbO.toFixed(1)} MB`)
  console.log(`  peso total miniaturas     ${mbT.toFixed(1)} MB  (sobre las ${conMin.length} que existen)`)
  const estados = new Map()
  for (const r of filas) if (r.status !== 200) estados.set(r.status, (estados.get(r.status) ?? 0) + 1)
  if (estados.size) console.log('  estados no-200:', [...estados].map(([k, v]) => `${k}=${v}`).join(', '))
  console.log('═'.repeat(70))
  console.log(`  informe: ${SALIDA}`)
}

main().catch((e) => { console.error('✗ ' + e.message); process.exit(1) })
