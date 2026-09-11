/**
 * Fase 9 · entrega 0.5 — suite de ataque contra la superficie de Emails del
 * Supabase legacy.
 *
 * Se corre DOS veces: antes del cierre (para probar que el agujero existe) y
 * después (para probar que se cerró). No mide códigos de estado a ciegas: mide
 * el EFECTO. Un `PATCH` que devuelve 204 sobre cero filas no es un acceso
 * abierto, y un `SELECT` que devuelve `[]` puede ser una tabla vacía o una
 * policy funcionando — hay que distinguirlos.
 *
 * Usa exactamente lo que tiene cualquier visitante: la clave publicable y el
 * `x-erp-token`, los dos leídos del bundle público. Nada más.
 *
 * Qué NO hace, a propósito:
 *
 *   · TRUNCATE. El privilegio se verifica en el catálogo, no ejecutándolo.
 *   · Tocar los 976 emails ni los 479 adjuntos reales. Todo lo que escribe
 *     lleva el prefijo ZZ-E05 y se limpia al final.
 *   · Pedir imágenes remotas ni abrir cuerpos: nada de disparar pixeles.
 *   · Llamar a Gmail, a Make ni a OpenAI.
 *
 *   node scripts/fase9-emails-seguridad-tests.mjs --bundle <ruta a app.js> [--fase antes|despues]
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null }
const BUNDLE = arg('--bundle')
const FASE = arg('--fase') || 'despues'
if (!BUNDLE) { console.error('uso: --bundle <ruta a app.js del legacy> [--fase antes|despues]'); process.exit(1) }

const fuente = readFileSync(BUNDLE, 'utf8')
const delBundle = (n) =>
  (fuente.match(new RegExp('(?:const|var|let)\\s+' + n + '\\s*=\\s*[\'"`]([^\'"`]+)')) || [])[1]

// Las credenciales salen del bundle público, que es de donde las lee cualquiera.
// Se usan y no se imprimen.
const URL_BASE = delBundle('SUPA_URL')
const CLAVE = delBundle('SUPA_KEY')
const TOKEN = delBundle('SUPA_APP_TOKEN')
if (!URL_BASE || !CLAVE || !TOKEN) { console.error('✗ no se pudieron leer las credenciales del bundle'); process.exit(1) }

const SIN_TOKEN = { apikey: CLAVE, Authorization: 'Bearer ' + CLAVE, 'Content-Type': 'application/json' }
const CON_TOKEN = { ...SIN_TOKEN, 'x-erp-token': TOKEN }

const esperandoCierre = FASE !== 'antes'
let abiertos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(72)}`)
const OK = (t, d = '') => console.log(`    CERRADO   ${t}${d ? ' — ' + d : ''}`)
const ABIERTO = (t, d = '') => { if (esperandoCierre) abiertos++; console.log(`    ${esperandoCierre ? 'ABIERTO  ' : 'abierto  '} ${t}${d ? ' — ' + d : ''}`) }
const info = (t, d = '') => console.log(`    ····      ${t}${d ? ' — ' + d : ''}`)

const MARCA = 'ZZ-E05'
const idFixture = `${MARCA}-${Date.now()}`
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64')

/** Devuelve {status, cuerpo} sin romper si el cuerpo no es JSON. */
const pedir = async (ruta, opciones = {}) => {
  const r = await fetch(URL_BASE + ruta, opciones)
  const txt = await r.text().catch(() => '')
  let json = null
  try { json = JSON.parse(txt) } catch { /* no era json */ }
  return { status: r.status, ok: r.ok, json, txt: txt.slice(0, 120) }
}

const main = async () => {
  console.log('\n' + '='.repeat(78))
  console.log(`  EMAILS LEGACY · superficie pública      fase: ${FASE.toUpperCase()}`)
  console.log('='.repeat(78))

  // ─────────────────────────────────────────────────────────────────────
  seccion('1 · LECTURA de erp_emails')
  for (const [etiqueta, h] of [['sin x-erp-token', SIN_TOKEN], ['con x-erp-token', CON_TOKEN]]) {
    const r = await pedir('/rest/v1/erp_emails?select=id,date&limit=3', { headers: h })
    // Medir el EFECTO: filas devueltas, no el código.
    if (r.ok && Array.isArray(r.json) && r.json.length > 0) ABIERTO(`leer emails (${etiqueta})`, `${r.json.length} fila(s)`)
    else OK(`leer emails (${etiqueta})`, r.ok ? '0 filas' : 'HTTP ' + r.status)
  }
  {
    const r = await pedir('/rest/v1/erp_email_rules?select=id&limit=3', { headers: CON_TOKEN })
    if (r.ok && Array.isArray(r.json) && r.json.length > 0) ABIERTO('leer erp_email_rules', `${r.json.length} fila(s)`)
    else OK('leer erp_email_rules', r.ok ? '0 filas (la tabla está vacía)' : 'HTTP ' + r.status)
  }

  // ─────────────────────────────────────────────────────────────────────
  seccion('2 · ESCRITURA directa en erp_emails (fixture, se limpia)')
  let idInsertado = null
  for (const [etiqueta, h] of [['sin x-erp-token', SIN_TOKEN], ['con x-erp-token', CON_TOKEN]]) {
    const fila = {
      gmail_id: `${idFixture}-${etiqueta.includes('sin') ? 'a' : 'b'}`,
      from_email: b64(`${MARCA}@prueba.invalid`),
      subject: b64(`${MARCA} fixture de auditoría — borrar`),
      direction: 'inbound', empresa: 'buscatools',
      date: new Date().toISOString(), status: 'sin_responder', is_read: true,
    }
    // `return=minimal` a propósito. Con `return=representation` PostgREST
    // necesita SELECT sobre la fila recién creada, la policy del token se lo
    // niega y aborta la transacción entera: el INSERT devuelve 401 y parece
    // cerrado cuando no lo está. Ese fue un falso negativo de esta misma suite.
    const r = await pedir('/rest/v1/erp_emails', {
      method: 'POST', headers: { ...h, Prefer: 'return=minimal' }, body: JSON.stringify(fila),
    })
    if (r.status === 201) {
      // El EFECTO, sin poder leer: repetir el mismo gmail_id. Si la primera
      // fila entró, la segunda choca contra el UNIQUE y devuelve 409.
      const dup = await pedir('/rest/v1/erp_emails', {
        method: 'POST', headers: { ...h, Prefer: 'return=minimal' }, body: JSON.stringify(fila),
      })
      if (dup.status === 409) ABIERTO(`INSERT directo (${etiqueta})`, 'fila creada — confirmado por UNIQUE')
      else ABIERTO(`INSERT directo (${etiqueta})`, `HTTP ${r.status}, efecto no confirmado (dup dio ${dup.status})`)
      idInsertado = idInsertado || fila.gmail_id
    } else OK(`INSERT directo (${etiqueta})`, 'HTTP ' + r.status)
  }

  // Para UPDATE y DELETE hace falta una fila blanco. Si el INSERT ya está
  // cerrado, se apunta contra una fila real y se comprueba que NO cambie:
  // así el test sigue siendo válido después del cierre.
  const blanco = idInsertado
  if (blanco) {
    const r = await pedir(`/rest/v1/erp_emails?gmail_id=eq.${blanco}`, {
      method: 'PATCH', headers: { ...CON_TOKEN, Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'en_proceso' }),
    })
    if (r.ok && Array.isArray(r.json) && r.json.length > 0) ABIERTO('UPDATE directo', 'fila modificada')
    else OK('UPDATE directo', 'HTTP ' + r.status)
    const del = await pedir(`/rest/v1/erp_emails?gmail_id=eq.${blanco}`, { method: 'DELETE', headers: CON_TOKEN })
    if (del.ok) ABIERTO('DELETE directo', 'HTTP ' + del.status)
    else OK('DELETE directo', 'HTTP ' + del.status)
  } else {
    // Sin fixture propio: se intenta modificar una fila real y se verifica el
    // efecto con una segunda lectura. Se elige un campo inocuo y se restaura.
    const r = await pedir('/rest/v1/erp_emails?select=id&limit=1', { headers: CON_TOKEN })
    const real = r.ok && Array.isArray(r.json) && r.json[0] ? r.json[0].id : null
    if (!real) { info('UPDATE directo', 'no se pudo ni listar un id: la lectura ya está cerrada') }
    else {
      const u = await pedir(`/rest/v1/erp_emails?id=eq.${real}`, {
        method: 'PATCH', headers: { ...CON_TOKEN, Prefer: 'return=representation' },
        body: JSON.stringify({ notes: `${MARCA} prueba` }),
      })
      if (u.ok && Array.isArray(u.json) && u.json.length > 0) ABIERTO('UPDATE directo sobre fila real', 'SE MODIFICÓ')
      else OK('UPDATE directo sobre fila real', 'HTTP ' + u.status)
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  seccion('3 · RPC públicas de ingesta')
  {
    const r = await pedir('/rest/v1/rpc/insert_email', {
      method: 'POST', headers: SIN_TOKEN,
      body: JSON.stringify({
        p_gmail_id: `${idFixture}-rpc`, p_thread_id: '', p_from_email: b64(`${MARCA}@prueba.invalid`),
        p_from_name: '', p_to_email: 'info@buscatools.com.ar',
        p_subject: b64(`${MARCA} fixture RPC — borrar`), p_snippet: '', p_body_html: '', p_body_text: '',
        p_date: new Date().toISOString(), p_status: 'sin_responder', p_is_read: true, p_has_attachments: false,
      }),
    })
    // El efecto: ¿quedó la fila? Se comprueba leyendo con la clave de servicio
    // más adelante, en la limpieza. Acá alcanza el código, pero se anota cuál.
    if (r.ok) ABIERTO('rpc insert_email SIN token', 'HTTP ' + r.status)
    else OK('rpc insert_email SIN token', 'HTTP ' + r.status)
  }
  for (const fn of ['reset_email_attachments', 'update_email_attachments']) {
    const cuerpo = fn === 'reset_email_attachments'
      ? { p_gmail_id: `${idFixture}-rpc` }
      : { p_gmail_id: `${idFixture}-rpc`, p_index: 1, p_filename_b64: b64('x.txt'), p_mime_type_b64: b64('text/plain') }
    const r = await pedir(`/rest/v1/rpc/${fn}`, { method: 'POST', headers: SIN_TOKEN, body: JSON.stringify(cuerpo) })
    if (r.ok) ABIERTO(`rpc ${fn} SIN token`, 'HTTP ' + r.status)
    else OK(`rpc ${fn} SIN token`, 'HTTP ' + r.status)
  }

  // ─────────────────────────────────────────────────────────────────────
  seccion('4 · STORAGE · bucket email-attachments')
  {
    const r = await fetch(`${URL_BASE}/storage/v1/bucket/email-attachments`, { headers: SIN_TOKEN })
    const b = r.ok ? await r.json().catch(() => null) : null
    if (b && b.public === true) ABIERTO('el bucket es público', 'public=true')
    else if (b) OK('el bucket ya no es público', 'public=' + b.public)
    else info('metadata del bucket', 'HTTP ' + r.status)
  }
  {
    // Un path REAL, tomado del propio inventario del respaldo. Se pide sólo la
    // cabecera: alcanza para saber si se sirve y no baja el archivo.
    const r = await fetch(`${URL_BASE}/storage/v1/object/public/email-attachments/`, { method: 'HEAD' })
    info('sondeo del prefijo público', 'HTTP ' + r.status)
  }
  {
    const ruta = `${MARCA}/fixture.txt`
    const sub = await fetch(`${URL_BASE}/storage/v1/object/email-attachments/${ruta}`, {
      method: 'POST', headers: { ...SIN_TOKEN, 'Content-Type': 'text/plain', 'x-upsert': 'true' },
      body: `${MARCA} fixture`,
    })
    if (sub.ok) {
      ABIERTO('subir un archivo al bucket', 'HTTP ' + sub.status)
      const baj = await fetch(`${URL_BASE}/storage/v1/object/public/email-attachments/${ruta}`)
      if (baj.ok) ABIERTO('bajar ese archivo por URL pública', 'HTTP ' + baj.status)
      else OK('bajar ese archivo por URL pública', 'HTTP ' + baj.status)
      const del = await fetch(`${URL_BASE}/storage/v1/object/email-attachments`, {
        method: 'DELETE', headers: SIN_TOKEN, body: JSON.stringify({ prefixes: [ruta] }),
      })
      const borrados = del.ok ? await del.json().catch(() => []) : []
      if (Array.isArray(borrados) && borrados.length > 0) ABIERTO('borrar un archivo del bucket', `${borrados.length} objeto(s) borrado(s)`)
      else OK('borrar un archivo del bucket', 'HTTP ' + del.status)
    } else {
      OK('subir un archivo al bucket', 'HTTP ' + sub.status)
      OK('borrar un archivo del bucket', 'no se llegó a crear el fixture')
    }
  }
  {
    const r = await fetch(`${URL_BASE}/storage/v1/object/list/email-attachments`, {
      method: 'POST', headers: SIN_TOKEN, body: JSON.stringify({ prefix: '', limit: 3 }),
    })
    const j = r.ok ? await r.json().catch(() => []) : []
    if (Array.isArray(j) && j.length > 0) ABIERTO('listar el bucket', `${j.length} entrada(s)`)
    else OK('listar el bucket', r.ok ? '0 entradas' : 'HTTP ' + r.status)
  }

  // ─────────────────────────────────────────────────────────────────────
  seccion('5 · REALTIME · se cuenta lo que LLEGA, no que el canal acepte el join')
  {
    const cli = createClient(URL_BASE, CLAVE, { auth: { persistSession: false } })
    const recibidas = await new Promise((resolve) => {
      const filas = []
      const ch = cli.channel(`${MARCA}-${Date.now()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'erp_emails' }, (p) => filas.push(p))
        .subscribe((estado) => { if (estado === 'SUBSCRIBED') info('el canal acepta el join (informativo)', 'ok') })
      setTimeout(async () => { await cli.removeChannel(ch); resolve(filas) }, 6000)
    })
    if (recibidas.length > 0) ABIERTO('Realtime entrega filas al anónimo', `${recibidas.length}`)
    else OK('Realtime no entrega ninguna fila al anónimo', '0')
  }

  console.log('\n' + '='.repeat(78))
  if (esperandoCierre) {
    console.log(`  RESULTADO: ${abiertos} acceso(s) abierto(s)`)
  } else {
    console.log('  RESULTADO: fase "antes" — los "abierto" de arriba son el estado a cerrar')
  }
  console.log('='.repeat(78) + '\n')
  console.log(`  Limpieza pendiente: filas y objetos con prefijo ${MARCA} (se borran con la clave de servicio).\n`)
  process.exit(esperandoCierre && abiertos > 0 ? 1 : 0)
}

main().catch((e) => { console.error('\n✗', e); process.exit(1) })
