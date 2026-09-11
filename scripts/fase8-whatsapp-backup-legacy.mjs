/**
 * Fase 8 · entrega 0.5 — respaldo de sólo lectura de las tablas de WhatsApp
 * del Supabase legacy, ANTES de cerrarles el acceso.
 *
 * Lee con la clave de servicio y escribe **fuera del repositorio**. No
 * modifica ni una fila.
 *
 * De cada tabla guarda el contenido íntegro —hace falta que el respaldo sirva
 * para restaurar— salvo dos excepciones deliberadas:
 *
 *   · `suite_wa_media.datos`: el base64 se guarda en su propio archivo, uno
 *     por fila, para que el JSON principal siga siendo legible.
 *   · `suite_wa_sesion`: son las credenciales de Baileys. **No se respaldan**:
 *     un backup de un secreto es otro lugar del que se puede filtrar. Se
 *     anota cuántas filas tenía.
 *
 * El índice registra tabla, filas, bytes y sha256 de cada archivo.
 *
 *   set -a; source .env.legacy; set +a
 *   node scripts/fase8-whatsapp-backup-legacy.mjs --out <carpeta-fuera-del-repo>
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

/**
 * Las credenciales salen del bundle público del propio sitio legacy, que es
 * de donde las lee cualquier visitante. Se usan y no se imprimen.
 *
 * Que esta clave alcance para leer TODO es exactamente el agujero que esta
 * entrega viene a cerrar: por eso el respaldo se hace ahora, antes del fix.
 * Cuando el fix esté aplicado, este mismo script debe dejar de funcionar — y
 * esa es la prueba de que funcionó.
 */
const fuente = readFileSync(BUNDLE, 'utf8')
const delBundle = (n) =>
  (fuente.match(new RegExp('(?:const|var|let)\\s+' + n + '\\s*=\\s*[\'"`]([^\'"`]+)')) || [])[1]
const URL_BASE = delBundle('SUPA_URL')
const CLAVE = delBundle('SUPA_KEY')
if (!URL_BASE || !CLAVE) { console.error('✗ no se pudieron leer SUPA_URL / SUPA_KEY del bundle'); process.exit(1) }

if (!existsSync(SALIDA)) mkdirSync(SALIDA, { recursive: true })

const H = { apikey: CLAVE, Authorization: 'Bearer ' + CLAVE }
const get = async (ruta) => {
  const r = await fetch(`${URL_BASE}/rest/v1/${ruta}`, { headers: { ...H, Prefer: 'count=exact' } })
  if (!r.ok) throw new Error(`${ruta}: HTTP ${r.status} · ${(await r.text()).slice(0, 120)}`)
  return r.json()
}

const sha = (s) => createHash('sha256').update(s).digest('hex')
const indice = []

const guardar = (nombre, contenido) => {
  const ruta = join(SALIDA, nombre)
  writeFileSync(ruta, contenido, 'utf8')
  return { archivo: nombre, bytes: Buffer.byteLength(contenido, 'utf8'), sha256: sha(contenido) }
}

const main = async () => {
  const sello = new Date().toISOString()
  console.log('Respaldo de WhatsApp legacy · ' + sello)
  console.log('Destino: ' + SALIDA)
  console.log('')

  // ── Tablas completas ─────────────────────────────────────────────────
  for (const tabla of ['suite_wa_conversaciones', 'suite_wa_mensajes', 'suite_wa_estado', 'suite_wa_reglas']) {
    const filas = await get(`${tabla}?select=*`)
    const j = guardar(`${tabla}.json`, JSON.stringify(filas, null, 2))
    indice.push({ tabla, filas: filas.length, ...j })
    console.log(`  ${tabla.padEnd(26)} ${String(filas.length).padStart(4)} filas · ${String(j.bytes).padStart(9)} B · ${j.sha256.slice(0, 16)}…`)
  }

  // ── Media: metadata aparte del binario ───────────────────────────────
  const media = await get('suite_wa_media?select=*')
  const meta = media.map(({ datos, ...resto }) => ({ ...resto, datos_bytes: datos ? String(datos).length : 0 }))
  const jm = guardar('suite_wa_media.metadata.json', JSON.stringify(meta, null, 2))
  indice.push({ tabla: 'suite_wa_media (metadata)', filas: media.length, ...jm })
  console.log(`  ${'suite_wa_media (metadata)'.padEnd(26)} ${String(media.length).padStart(4)} filas · ${String(jm.bytes).padStart(9)} B · ${jm.sha256.slice(0, 16)}…`)

  const dirMedia = join(SALIDA, 'media')
  if (!existsSync(dirMedia)) mkdirSync(dirMedia, { recursive: true })
  let bytesMedia = 0
  const hashes = []
  for (const m of media) {
    if (!m.datos) continue
    const nombre = `media/${m.id}.b64`
    const r = guardar(nombre, String(m.datos))
    bytesMedia += r.bytes
    hashes.push({ id: m.id, mime: m.mime, bytes_declarados: m.bytes, ...r })
  }
  const jh = guardar('suite_wa_media.archivos.json', JSON.stringify(hashes, null, 2))
  indice.push({ tabla: 'suite_wa_media (archivos)', filas: hashes.length, archivo: 'media/*.b64', bytes: bytesMedia, sha256: jh.sha256 })
  console.log(`  ${'suite_wa_media (archivos)'.padEnd(26)} ${String(hashes.length).padStart(4)} archivos · ${String(bytesMedia).padStart(9)} B base64`)

  // ── Sesión: se cuenta, NO se respalda ────────────────────────────────
  const sesion = await get('suite_wa_sesion?select=linea')
  indice.push({
    tabla: 'suite_wa_sesion', filas: sesion.length, archivo: '(no respaldada a propósito)',
    bytes: 0, sha256: null,
    nota: 'credenciales de Baileys: un backup de un secreto es otro lugar del que se puede filtrar',
  })
  console.log(`  ${'suite_wa_sesion'.padEnd(26)} ${String(sesion.length).padStart(4)} filas · NO se respalda (secreto)`)

  // ── Índice ───────────────────────────────────────────────────────────
  const cabecera = {
    generado: sello,
    proyecto: URL_BASE.replace(/^https:\/\//, '').split('.')[0],
    motivo: 'Respaldo previo a la contención de seguridad de la entrega 0.5',
    advertencia: 'Contiene conversaciones reales. Fuera del repositorio. No commitear.',
    tablas: indice,
  }
  const ji = guardar('INDICE.json', JSON.stringify(cabecera, null, 2))
  console.log('')
  console.log(`  INDICE.json · ${ji.bytes} B · sha256 ${ji.sha256}`)
  console.log('')
  console.log('  Ninguna escritura sobre la base: sólo GET.')
}

main().catch((e) => { console.error('\n✗', e.message); process.exit(1) })
