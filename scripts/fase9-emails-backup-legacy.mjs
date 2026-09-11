/**
 * Fase 9 · entrega 0 — respaldo de sólo lectura de los emails del Supabase
 * legacy.
 *
 * Se hace ANTES de tocar nada y por un motivo concreto que la auditoría
 * encontró: hoy `anon` tiene `arwdDxtm` sobre `erp_emails` y las policies de
 * Storage sobre el bucket `email-attachments` no miran el rol, así que
 * cualquiera que tenga el bundle puede borrar la tabla y los 479 archivos.
 * Mientras eso siga así, conviene tener una copia propia.
 *
 * No modifica ni una fila. GET únicamente.
 *
 * Qué guarda:
 *
 *   · `erp_emails` íntegra, paginada, en JSON. Incluye body_html —que es el
 *     98 % del peso— porque sin el cuerpo el respaldo no sirve para nada.
 *   · El índice con filas, bytes y sha256 de cada archivo.
 *
 * Qué NO guarda, a propósito:
 *
 *   · Los adjuntos binarios del bucket. Son 89 MB y el original sigue en
 *     Gmail; lo que se respalda acá es lo que sólo existe en el legacy.
 *     Se anota el inventario (nombre, tamaño) sin bajar los archivos.
 *   · Ningún token. Las credenciales se leen del bundle, se usan y no se
 *     imprimen ni se escriben.
 *
 * El contenido tiene datos personales de clientes reales: la carpeta de
 * salida va FUERA del repositorio.
 *
 *   node scripts/fase9-emails-backup-legacy.mjs --out <carpeta-fuera-del-repo> --bundle <ruta a app.js>
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null }
const SALIDA = arg('--out')
const BUNDLE = arg('--bundle')
if (!SALIDA || !BUNDLE) {
  console.error('uso: --out <carpeta fuera del repo> --bundle <ruta a app.js del legacy>')
  process.exit(1)
}

// Las credenciales salen del bundle público del propio sitio legacy, que es de
// donde las lee cualquier visitante. Se usan y no se imprimen.
const fuente = readFileSync(BUNDLE, 'utf8')
const delBundle = (n) =>
  (fuente.match(new RegExp('(?:const|var|let)\\s+' + n + '\\s*=\\s*[\'"`]([^\'"`]+)')) || [])[1]

const URL_BASE = delBundle('SUPA_URL')
const CLAVE = delBundle('SUPA_KEY')
const TOKEN = delBundle('SUPA_APP_TOKEN')
if (!URL_BASE || !CLAVE || !TOKEN) {
  console.error('✗ No se pudieron leer las credenciales del bundle')
  process.exit(1)
}
const H = { apikey: CLAVE, Authorization: 'Bearer ' + CLAVE, 'x-erp-token': TOKEN }

if (!existsSync(SALIDA)) mkdirSync(SALIDA, { recursive: true })

const sha = (s) => createHash('sha256').update(s).digest('hex')
const kb = (n) => (n / 1024).toFixed(1) + ' kB'

/**
 * Trae una tabla entera, de a páginas, sin asumir el tamaño de página.
 *
 * La página es de 25 y no de 200 porque con `body_html` de 92 kB de promedio
 * una página de 200 son ~18 MB y PostgREST devuelve 500. El orden se pasa por
 * parámetro: `erp_email_rules` no tiene columna `date` y ordenar por ella da 400.
 */
const traer = async (tabla, orden) => {
  const PAGINA = 25
  let filas = []
  for (;;) {
    const q = new URLSearchParams({ select: '*', order: orden, limit: String(PAGINA), offset: String(filas.length) })
    const r = await fetch(`${URL_BASE}/rest/v1/${tabla}?${q}`, { headers: H })
    if (!r.ok) throw new Error(`${tabla}: HTTP ${r.status}`)
    const lote = await r.json()
    if (!lote.length) break        // se para con página vacía, nunca asumiendo
    filas = filas.concat(lote)     // que el servidor respetó el limit pedido
    process.stdout.write(`\r  ${tabla}: ${filas.length} filas…`)
  }
  process.stdout.write('\r')
  return filas
}

const main = async () => {
  console.log(`\n  Respaldo de emails legacy → ${SALIDA}\n`)
  const indice = []

  for (const [tabla, orden] of [['erp_emails', 'date.desc'], ['erp_email_rules', 'id.asc']]) {
    const filas = await traer(tabla, orden)
    const texto = JSON.stringify(filas, null, 2)
    const ruta = join(SALIDA, `${tabla}.json`)
    writeFileSync(ruta, texto)
    indice.push({ archivo: `${tabla}.json`, filas: filas.length, bytes: Buffer.byteLength(texto), sha256: sha(texto) })
    console.log(`  ${tabla.padEnd(18)} ${String(filas.length).padStart(5)} filas   ${kb(Buffer.byteLength(texto)).padStart(12)}`)
  }

  // Inventario del bucket, SIN bajar los archivos: el original sigue en Gmail.
  const r = await fetch(`${URL_BASE}/storage/v1/object/list/email-attachments`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: '', limit: 5000, sortBy: { column: 'name', order: 'asc' } }),
  })
  const objetos = r.ok ? await r.json() : []
  const invTexto = JSON.stringify(objetos, null, 2)
  writeFileSync(join(SALIDA, 'email-attachments-inventario.json'), invTexto)
  indice.push({
    archivo: 'email-attachments-inventario.json',
    filas: objetos.length, bytes: Buffer.byteLength(invTexto), sha256: sha(invTexto),
    nota: 'sólo el inventario: los binarios no se bajaron, siguen en Gmail y en el bucket',
  })
  console.log(`  ${'adjuntos (inventario)'.padEnd(18)} ${String(objetos.length).padStart(5)} objetos`)

  const meta = {
    generado: new Date().toISOString(),
    proyecto_legacy: URL_BASE,
    modo: 'sólo lectura — ninguna fila modificada',
    secretos_incluidos: 'ninguno',
    archivos: indice,
  }
  writeFileSync(join(SALIDA, 'INDICE.json'), JSON.stringify(meta, null, 2))

  console.log('\n  sha256:')
  for (const a of indice) console.log(`    ${a.sha256.slice(0, 16)}…  ${a.archivo}`)
  console.log(`\n  Listo. Índice en ${join(SALIDA, 'INDICE.json')}\n`)
}

main().catch((e) => { console.error('\n✗', e.message); process.exit(1) })
