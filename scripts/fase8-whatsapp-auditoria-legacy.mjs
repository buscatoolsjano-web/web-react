/**
 * Fase 8 · WhatsApp — entrega 0: medición del Supabase legacy.
 *
 * **SÓLO LECTURA.** Este script hace exclusivamente peticiones `GET` contra
 * PostgREST. No hay POST, PATCH, DELETE ni RPC: una RPC podría escribir, y
 * acá no se escribe nada.
 *
 * Las credenciales salen del bundle público del propio sitio legacy
 * (`app.js`, que se sirve desde GitHub Pages), o sea del mismo lugar del que
 * las lee cualquier visitante. **No se imprimen**: se leen del archivo y se
 * usan en los headers, nada más.
 *
 * Tampoco se imprime contenido de conversaciones. De los mensajes sólo se
 * miden formas: cuántos, de qué tipo, en qué estado, en qué rango de fechas.
 *
 *   node scripts/fase8-whatsapp-auditoria-legacy.mjs <ruta-a-app.js>
 */
import { readFileSync } from 'node:fs'

const RUTA = process.argv[2]
if (!RUTA) { console.error('uso: node scripts/fase8-whatsapp-auditoria-legacy.mjs <ruta-a-app.js>'); process.exit(1) }

const fuente = readFileSync(RUTA, 'utf8')
const leer = (nombre) => {
  const m = fuente.match(new RegExp(`(?:const|var|let)\\s+${nombre}\\s*=\\s*['"\`]([^'"\`]+)`))
  return m ? m[1] : null
}
const URL_BASE = leer('SUPA_URL')
const CLAVE = leer('SUPA_KEY')
const APP_TOKEN = leer('SUPA_APP_TOKEN')
if (!URL_BASE || !CLAVE) { console.error('✗ No se pudieron leer SUPA_URL / SUPA_KEY del bundle'); process.exit(1) }

const headers = {
  apikey: CLAVE,
  Authorization: 'Bearer ' + CLAVE,
  ...(APP_TOKEN ? { 'x-suite-key': APP_TOKEN } : {}),
}

const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(72)}`)
const linea = (a, b) => console.log(`    ${String(a).padEnd(40)} ${b}`)

/** Un GET y nada más. Devuelve { filas, total, estado }. */
const get = async (tabla, query = '') => {
  const url = `${URL_BASE}/rest/v1/${tabla}${query ? '?' + query : ''}`
  const r = await fetch(url, { headers: { ...headers, Prefer: 'count=exact' } })
  const rango = r.headers.get('content-range')
  const total = rango ? Number(rango.split('/')[1]) : null
  let filas = null
  try { filas = await r.json() } catch { filas = null }
  return { ok: r.ok, estado: r.status, total, filas }
}

const contar = async (tabla) => {
  const r = await get(tabla, 'select=*&limit=0')
  return r.ok ? r.total : `HTTP ${r.estado}`
}

const main = async () => {
  console.log('='.repeat(78))
  console.log('  FASE 8 · WHATSAPP — auditoría del Supabase legacy (sólo lectura)')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(78))
  linea('proyecto', URL_BASE.replace(/^https:\/\//, '').split('.')[0])
  linea('clave', 'presente, no se imprime')
  linea('x-suite-key', APP_TOKEN ? 'presente, no se imprime' : 'ausente')

  // ── 1 · Qué tablas responden ──────────────────────────────────────────
  seccion('1 · TABLAS · cuáles existen y cuántas filas tienen')

  const candidatas = [
    'suite_wa_conversaciones', 'suite_wa_mensajes', 'suite_wa_media',
    'suite_wa_estado', 'suite_wa_sesion', 'suite_wa_reglas',
    // Nombres plausibles que NO están en el código, para descartarlos:
    'suite_wa_contactos', 'suite_wa_plantillas', 'suite_wa_etiquetas',
    'wa_messages', 'wa_chats', 'whatsapp_messages', 'chats', 'messages',
  ]
  const existen = []
  for (const t of candidatas) {
    const n = await contar(t)
    if (typeof n === 'number') { existen.push(t); linea(t, `${n} filas`) }
    else linea(t, n === 'HTTP 404' ? 'no existe' : n)
  }

  // ── 2 · Conversaciones ────────────────────────────────────────────────
  if (existen.includes('suite_wa_conversaciones')) {
    seccion('2 · CONVERSACIONES · forma, no contenido')
    const muestra = await get('suite_wa_conversaciones', 'select=*&limit=1')
    const cols = muestra.filas?.[0] ? Object.keys(muestra.filas[0]) : []
    linea('columnas', cols.join(', ') || '(sin filas)')

    for (const [etiq, q] of [
      ['archivadas', 'archivada=is.true'],
      ['con cliente vinculado', 'cli_ref=not.is.null'],
      ['sin cliente vinculado', 'cli_ref=is.null'],
      ['con no leídos', 'no_leidos=gt.0'],
      ['asignadas', 'asignado=not.is.null'],
      ['IA en automático', 'ia_modo=eq.auto'],
      ['chat_id de grupo (@g.us)', 'chat_id=like.*@g.us'],
      ['chat_id @lid', 'chat_id=like.*@lid'],
      ['chat_id @s.whatsapp.net', 'chat_id=like.*@s.whatsapp.net'],
      ['sin teléfono', 'telefono=is.null'],
    ]) {
      const r = await get('suite_wa_conversaciones', `select=chat_id&limit=0&${q}`)
      linea(etiq, r.ok ? r.total : `HTTP ${r.estado}`)
    }

    const lineas = await get('suite_wa_conversaciones', 'select=linea&limit=1000')
    if (lineas.ok && Array.isArray(lineas.filas)) {
      const porLinea = {}
      for (const f of lineas.filas) porLinea[f.linea ?? '(null)'] = (porLinea[f.linea ?? '(null)'] ?? 0) + 1
      linea('líneas distintas', JSON.stringify(porLinea))
    }

    const prim = await get('suite_wa_conversaciones', 'select=ult_ts&order=ult_ts.asc.nullslast&limit=1')
    const ult = await get('suite_wa_conversaciones', 'select=ult_ts&order=ult_ts.desc.nullslast&limit=1')
    linea('actividad más vieja', prim.filas?.[0]?.ult_ts ?? '—')
    linea('actividad más nueva', ult.filas?.[0]?.ult_ts ?? '—')
  }

  // ── 3 · Mensajes ──────────────────────────────────────────────────────
  if (existen.includes('suite_wa_mensajes')) {
    seccion('3 · MENSAJES · forma, no contenido')
    const muestra = await get('suite_wa_mensajes', 'select=*&limit=1')
    const cols = muestra.filas?.[0] ? Object.keys(muestra.filas[0]) : []
    linea('columnas', cols.join(', ') || '(sin filas)')

    for (const [etiq, q] of [
      ['entrantes (dir=in)', 'dir=eq.in'],
      ['salientes (dir=out)', 'dir=eq.out'],
      ['con media', 'media_id=not.is.null'],
      ['con error', 'error=not.is.null'],
      ['autor = ia', 'autor=eq.ia'],
      ['autor = celular', 'autor=eq.celular'],
    ]) {
      const r = await get('suite_wa_mensajes', `select=id&limit=0&${q}`)
      linea(etiq, r.ok ? r.total : `HTTP ${r.estado}`)
    }

    for (const campo of ['estado', 'tipo']) {
      const r = await get('suite_wa_mensajes', `select=${campo}&limit=5000`)
      if (r.ok && Array.isArray(r.filas)) {
        const c = {}
        for (const f of r.filas) c[f[campo] ?? '(null)'] = (c[f[campo] ?? '(null)'] ?? 0) + 1
        linea(`valores de ${campo}`, JSON.stringify(c))
      }
    }

    const prim = await get('suite_wa_mensajes', 'select=ts&order=ts.asc&limit=1')
    const ult = await get('suite_wa_mensajes', 'select=ts&order=ts.desc&limit=1')
    linea('mensaje más viejo', prim.filas?.[0]?.ts ?? '—')
    linea('mensaje más nuevo', ult.filas?.[0]?.ts ?? '—')
  }

  // ── 4 · Media ─────────────────────────────────────────────────────────
  if (existen.includes('suite_wa_media')) {
    seccion('4 · MEDIA · cuánto pesa y de qué tipo')
    const muestra = await get('suite_wa_media', 'select=id,chat_id,mime,nombre,bytes,creado&limit=1')
    linea('columnas visibles', muestra.filas?.[0] ? Object.keys(muestra.filas[0]).join(', ') : '(sin filas o sin esas columnas)')

    const todos = await get('suite_wa_media', 'select=mime,bytes&limit=5000')
    if (todos.ok && Array.isArray(todos.filas)) {
      const porMime = {}
      let suma = 0, max = 0
      for (const f of todos.filas) {
        const b = Number(f.bytes) || 0
        suma += b; if (b > max) max = b
        const fam = String(f.mime || '?').split('/')[0]
        porMime[fam] = (porMime[fam] ?? 0) + 1
      }
      linea('archivos', todos.filas.length)
      linea('bytes declarados (suma)', `${suma} (${(suma / 1024 / 1024).toFixed(2)} MB)`)
      linea('archivo más grande', `${max} (${(max / 1024 / 1024).toFixed(2)} MB)`)
      linea('por familia de mime', JSON.stringify(porMime))
    }
  }

  // ── 5 · Estado del puente ─────────────────────────────────────────────
  if (existen.includes('suite_wa_estado')) {
    seccion('5 · PUENTE · una fila por línea conectada')
    const r = await get('suite_wa_estado', 'select=*&limit=20')
    for (const f of r.filas ?? []) {
      // El QR es un data: URI: se reporta su largo, no su contenido.
      const qr = f.qr ? `presente (${String(f.qr).length} car.)` : 'ausente'
      linea(`línea «${f.linea}»`,
        `conectado=${f.conectado} · número=${f.numero ? 'presente' : 'ausente'} · qr=${qr} · último latido=${f.ult_latido ?? '—'}`)
    }
    linea('columnas', r.filas?.[0] ? Object.keys(r.filas[0]).join(', ') : '(sin filas)')
  }

  // ── 6 · Reglas y sesión ───────────────────────────────────────────────
  for (const t of ['suite_wa_reglas', 'suite_wa_sesion']) {
    if (!existen.includes(t)) continue
    seccion(`6 · ${t.toUpperCase()}`)
    const r = await get(t, 'select=*&limit=3')
    linea('filas', r.total)
    linea('columnas', r.filas?.[0] ? Object.keys(r.filas[0]).join(', ') : '(sin filas)')
  }

  // ── 7 · Qué ve alguien SIN la clave de aplicación ─────────────────────
  seccion('7 · ¿QUÉ APORTA x-suite-key? · la misma consulta sin ese header')
  for (const t of existen.filter((x) => x.startsWith('suite_wa_'))) {
    const r = await fetch(`${URL_BASE}/rest/v1/${t}?select=*&limit=0`, {
      headers: { apikey: CLAVE, Authorization: 'Bearer ' + CLAVE, Prefer: 'count=exact' },
    })
    const rango = r.headers.get('content-range')
    linea(t, r.ok ? `HTTP ${r.status} · ${rango ? rango.split('/')[1] : '?'} filas` : `HTTP ${r.status}`)
  }

  console.log('\n' + '='.repeat(78))
  console.log('  Fin. Ninguna escritura: sólo GET.')
  console.log('='.repeat(78))
}

main().catch((e) => { console.error('\n✗', e); process.exit(1) })
