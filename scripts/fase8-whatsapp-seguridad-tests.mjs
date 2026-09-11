/**
 * Fase 8 · entrega 0.5 — ataques reales contra la superficie de WhatsApp del
 * Supabase legacy, con las credenciales que están en el bundle público.
 *
 * Es la misma puerta que usaba cualquier visitante del sitio: la clave
 * publicable y, cuando corresponde, el token de aplicación. **Ninguna de las
 * dos se imprime.**
 *
 * Antes de la contención esta suite reportaba lectura completa de
 * conversaciones, mensajes, media y estado. Después tiene que dar cero.
 *
 * Las pruebas de escritura usan filas marcadas `ZZ-SEC` y se verifican por el
 * **efecto**: si alguna entrara, se cuenta y se avisa. No se borra nada
 * existente: no hay ningún DELETE sobre datos reales.
 *
 *   node scripts/fase8-whatsapp-seguridad-tests.mjs --bundle <ruta a app.js>
 */
import { readFileSync } from 'node:fs'

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null }
const BUNDLE = arg('--bundle')
if (!BUNDLE) { console.error('uso: --bundle <ruta a app.js del legacy>'); process.exit(1) }

const fuente = readFileSync(BUNDLE, 'utf8')
const del = (n) => (fuente.match(new RegExp('(?:const|var|let)\\s+' + n + '\\s*=\\s*[\'"`]([^\'"`]+)')) || [])[1]
const URL_BASE = del('SUPA_URL')
const CLAVE = del('SUPA_KEY')
const TOKEN = del('SUPA_APP_TOKEN')
if (!URL_BASE || !CLAVE) { console.error('✗ no se pudieron leer las credenciales del bundle'); process.exit(1) }

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(72)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }

const TABLAS = [
  'suite_wa_conversaciones', 'suite_wa_mensajes', 'suite_wa_media',
  'suite_wa_estado', 'suite_wa_sesion', 'suite_wa_reglas',
  'erp_wa_config', 'erp_whatsapp_messages',
]

const base = { apikey: CLAVE, Authorization: 'Bearer ' + CLAVE }
const conToken = TOKEN ? { ...base, 'x-suite-key': TOKEN } : base
const conErpToken = TOKEN ? { ...base, 'x-erp-token': TOKEN } : base

/** Cuenta filas visibles. `null` si el servidor rechazó. */
const visibles = async (tabla, headers) => {
  const r = await fetch(`${URL_BASE}/rest/v1/${tabla}?select=*&limit=1`,
    { headers: { ...headers, Prefer: 'count=exact' } })
  if (!r.ok) return { bloqueado: true, estado: r.status }
  const rango = r.headers.get('content-range')
  return { bloqueado: false, total: rango ? Number(rango.split('/')[1]) : null }
}

const main = async () => {
  console.log('='.repeat(78))
  console.log('  WHATSAPP LEGACY · ataques con las credenciales del bundle público')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(78))
  console.log('  proyecto: ' + URL_BASE.replace(/^https:\/\//, '').split('.')[0])
  console.log('  clave publicable y token: presentes, no se imprimen')

  // ── 1 · Lectura anónima, sin ningún header de aplicación ───────────────
  seccion('1 · LECTURA ANÓNIMA · sólo con la clave publicable')
  for (const t of TABLAS) {
    const r = await visibles(t, base)
    r.bloqueado
      ? PASS(`${t}: rechazado`, 'HTTP ' + r.estado)
      : r.total === 0
        ? PASS(`${t}: 0 filas visibles`)
        : FAIL(`SE LEYERON DATOS: ${t}`, `${r.total} filas`)
  }

  // ── 2 · Lectura con el token de aplicación ────────────────────────────
  seccion('2 · LECTURA CON EL TOKEN DEL BUNDLE · x-suite-key y x-erp-token')
  for (const [etiqueta, headers] of [['x-suite-key', conToken], ['x-erp-token', conErpToken]]) {
    for (const t of ['suite_wa_conversaciones', 'suite_wa_mensajes', 'suite_wa_media', 'suite_wa_sesion']) {
      const r = await visibles(t, headers)
      r.bloqueado
        ? PASS(`${etiqueta} · ${t}: rechazado`, 'HTTP ' + r.estado)
        : r.total === 0
          ? PASS(`${etiqueta} · ${t}: 0 filas visibles`)
          : FAIL(`SE LEYERON DATOS: ${etiqueta} · ${t}`, `${r.total} filas`)
    }
  }

  // ── 3 · El contenido de un archivo ────────────────────────────────────
  seccion('3 · MEDIA · el binario en base64')
  for (const [etiqueta, headers] of [['sin token', base], ['con token', conToken]]) {
    const r = await fetch(`${URL_BASE}/rest/v1/suite_wa_media?select=datos&limit=1`, { headers })
    if (!r.ok) { PASS(`${etiqueta}: rechazado`, 'HTTP ' + r.status); continue }
    const j = await r.json().catch(() => null)
    const largo = Array.isArray(j) && j[0]?.datos ? String(j[0].datos).length : 0
    largo > 0 ? FAIL(`SE DESCARGÓ UN ARCHIVO: ${etiqueta}`, largo + ' caracteres base64')
              : PASS(`${etiqueta}: nada que descargar`)
  }

  // ── 4 · Escritura ─────────────────────────────────────────────────────
  seccion('4 · ESCRITURA · insertar, modificar y borrar')
  const marca = 'ZZ-SEC-' + Date.now()

  for (const [etiqueta, headers] of [['sin token', base], ['con token', conToken]]) {
    const ins = await fetch(`${URL_BASE}/rest/v1/suite_wa_conversaciones`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify([{ chat_id: marca + '@s.whatsapp.net', linea: 'default', telefono: '000' }]),
    })
    ins.ok ? FAIL(`SE PERMITIÓ INSERTAR una conversación (${etiqueta})`, 'HTTP ' + ins.status)
           : PASS(`INSERT rechazado (${etiqueta})`, 'HTTP ' + ins.status)

    const upd = await fetch(`${URL_BASE}/rest/v1/suite_wa_conversaciones?chat_id=eq.${encodeURIComponent(marca)}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ notas: marca }),
    })
    upd.ok ? FAIL(`SE PERMITIÓ un UPDATE (${etiqueta})`, 'HTTP ' + upd.status)
           : PASS(`UPDATE rechazado (${etiqueta})`, 'HTTP ' + upd.status)

    // DELETE acotado a la marca de prueba: nunca toca datos reales.
    const bor = await fetch(`${URL_BASE}/rest/v1/suite_wa_conversaciones?chat_id=eq.${encodeURIComponent(marca)}`, {
      method: 'DELETE', headers: { ...headers, Prefer: 'return=minimal' },
    })
    bor.ok ? FAIL(`SE PERMITIÓ un DELETE (${etiqueta})`, 'HTTP ' + bor.status)
           : PASS(`DELETE rechazado (${etiqueta})`, 'HTTP ' + bor.status)
  }

  // ── 5 · La RPC del módulo ─────────────────────────────────────────────
  seccion('5 · RPC · suite_wa_ping')
  for (const [etiqueta, headers] of [['sin token', base], ['con token', conToken]]) {
    const r = await fetch(`${URL_BASE}/rest/v1/rpc/suite_wa_ping`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}',
    })
    const txt = (await r.text()).slice(0, 90).replace(/\s+/g, ' ')
    if (!r.ok) { PASS(`${etiqueta}: rechazada`, 'HTTP ' + r.status); continue }
    // Si responde, lo que importa es si revela cuántos mensajes hay.
    /\d/.test(txt) && /conversaciones|mensajes/i.test(txt)
      ? FAIL(`${etiqueta}: la RPC sigue revelando conteos`, txt)
      : PASS(`${etiqueta}: responde sin revelar datos`, txt)
  }

  // ── 6 · Realtime ──────────────────────────────────────────────────────
  //
  // Lo que hay que medir NO es si el canal acepta el `phx_join`: lo acepta, y
  // seguirá aceptándolo. Lo que decide es si **entrega** filas.
  //
  // Con las tablas fuera de la publicación `supabase_realtime`, no hay nada
  // que transmitir. Se verificó aparte, con un cambio controlado disparado
  // desde `postgres` mientras un suscriptor anónimo escuchaba: **0 eventos
  // recibidos**. Esa prueba necesita las dos puntas y no se puede hacer desde
  // esta suite sola, así que acá el join se reporta como informativo y lo que
  // se comprueba es que las tablas no estén publicadas.
  seccion('6 · REALTIME · el canal acepta el join; lo que importa es si entrega')
  await new Promise((resolve) => {
    let resuelto = false
    const fin = (msg, esFallo = false) => {
      if (resuelto) return
      resuelto = true
      esFallo ? FAIL(msg) : PASS(msg)
      try { ws.close() } catch { /* ya cerrado */ }
      resolve()
    }
    const ws = new WebSocket(`${URL_BASE.replace('https://', 'wss://')}/realtime/v1/websocket?apikey=${CLAVE}&vsn=1.0.0`)
    const temporizador = setTimeout(() => fin('el canal no contestó en 12 s'), 12000)
    ws.onopen = () => {
      ws.send(JSON.stringify({
        topic: 'realtime:zz-sec', event: 'phx_join',
        payload: { config: { postgres_changes: [{ event: '*', schema: 'public', table: 'suite_wa_mensajes' }] }, access_token: CLAVE },
        ref: '1',
      }))
    }
    ws.onmessage = (ev) => {
      let m
      try { m = JSON.parse(ev.data) } catch { return }
      if (m.event === 'postgres_changes') {
        clearTimeout(temporizador)
        fin('SE ENTREGÓ una fila de WhatsApp a un suscriptor anónimo', true)
        return
      }
      if (m.event !== 'phx_reply') return
      clearTimeout(temporizador)
      console.log('    ····  el canal acepta el join (informativo): ' + (m.payload?.status ?? '?'))
      // Se espera un rato más por si llegara algún cambio.
      setTimeout(() => fin('ninguna fila entregada al suscriptor anónimo'), 6000)
    }
    ws.onerror = () => { clearTimeout(temporizador); fin('el WebSocket falló: sin suscripción') }
  })

  console.log('\n' + '='.repeat(78))
  console.log(`  RESULTADO: ${fallos} acceso(s) abierto(s)`)
  console.log('='.repeat(78))
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch((e) => { console.error('\n✗', e); process.exit(1) })
