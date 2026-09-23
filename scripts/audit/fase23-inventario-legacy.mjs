/**
 * Fase 23 · Inventario del legacy, extraído del código.
 *
 * El legacy es un `app.js` de 45.345 líneas. Recorrer la UI a ojo encuentra
 * lo que uno ya sabe que existe; para encontrar lo que NO sabemos hay que
 * leer el código. Esto extrae, con número de línea, todo lo que puede ser una
 * capacidad del usuario: pantallas, handlers, impresiones, exportaciones,
 * búsquedas, almacenamiento, llamadas a Supabase y a Firebase.
 *
 * No juzga: cuenta y ubica. La clasificación va en la matriz.
 *
 *   node scripts/audit/fase23-inventario-legacy.mjs <ruta-al-legacy> [--json out.json]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Los banners `// ==== NOMBRE ====` dividen el archivo en secciones. */
export function secciones(src) {
  const lineas = src.split('\n')
  const esBarra = (l) => /^\/\/\s*[=─━]{6,}\s*$/.test(l ?? '')
  const esComentario = (l) => /^\/\/\s*\S/.test(l ?? '')
  const out = []
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i] ?? ''

    // Banner de una línea: «// ===== TITULO =====». El título NO puede llevar
    // «=», o una barra pura calza contra sí misma y el título queda en «=».
    if (!esBarra(l)) {
      const enLinea = /^\/\/\s*[=]{5,}\s*([^=].*?)\s*[=]{5,}\s*$/.exec(l)
      if (enLinea) { out.push({ linea: i + 1, titulo: (enLinea[1] ?? '').trim() }); continue }
    }

    // Banner de tres líneas: barra, título, barra. Hay que exigir la barra de
    // CIERRE: sin eso, la barra de cierre de un banner se leía como apertura
    // del siguiente y el «título» terminaba siendo la línea de código que
    // venía abajo.
    if (!esBarra(l)) continue
    if (!esComentario(lineas[i + 1]) || esBarra(lineas[i + 1])) continue
    if (!esBarra(lineas[i + 2])) continue
    out.push({ linea: i + 2, titulo: (lineas[i + 1] ?? '').replace(/^\/\/\s?/, '').trim() })
    i += 2 // saltar el título y la barra de cierre
  }
  return out
}

/** A qué sección pertenece una línea. */
function seccionDe(secs, linea) {
  let actual = '(sin sección)'
  for (const s of secs) {
    if (s.linea <= linea) actual = s.titulo
    else break
  }
  return actual
}

/** Declaraciones de función de primer nivel. */
export function funciones(src) {
  const out = []
  const re = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm
  for (const m of src.matchAll(re)) {
    out.push({ nombre: m[1], linea: src.slice(0, m.index).split('\n').length })
  }
  return out
}

/**
 * Lo que puede disparar una acción del usuario.
 *
 * Tres formas conviven en el legacy: `addEventListener`, atributos `on*` en
 * HTML generado por string, y atributos `data-*` que después se cablean en
 * las funciones `wire*`. Las tres cuentan.
 */
export const PATRONES = {
  addEventListener: /\.addEventListener\(\s*['"]([a-z]+)['"]/g,
  onAtributo: /\son(click|change|submit|input|keydown|keyup|keypress|mouseenter|mouseleave|mouseover|mouseout|focus|blur|dblclick|contextmenu|dragstart|drop|dragover|paste|wheel|scroll)\s*=/gi,
  dataAtributo: /\bdata-([a-z][a-z0-9-]{2,})\s*=/gi,
  querySelectorData: /querySelectorAll?\(\s*['"`]\[data-([a-z][a-z0-9-]+)\]/g,
  idElemento: /\bid\s*=\s*["']([a-z][\w-]{2,})["']/gi,
}

export function ocurrencias(src, re) {
  const out = new Map()
  for (const m of src.matchAll(re)) {
    const k = m[1]
    const linea = src.slice(0, m.index).split('\n').length
    const v = out.get(k) ?? { veces: 0, primera: linea }
    v.veces++
    out.set(k, v)
  }
  return out
}

/** Capacidades transversales que el pedido nombra explícitamente (§4). */
export const SENALES = {
  imprimir: /window\.print\s*\(|\.print\s*\(\)|@media\s+print|html2pdf|jsPDF|printWindow|_printHtml/g,
  pdf: /html2pdf|jsPDF|\.pdf['"`)]|application\/pdf|pdf\.min\.js/gi,
  csv: /text\/csv|\.csv['"`]|csvContent|toCsv|_doExportCsv|Blob\(\[/g,
  descarga: /\.download\s*=|createObjectURL|URL\.createObjectURL/g,
  portapapeles: /navigator\.clipboard|execCommand\(\s*['"]copy/g,
  localStorage: /localStorage\.(getItem|setItem|removeItem)\(\s*['"`]([^'"`]+)/g,
  sessionStorage: /sessionStorage\.(getItem|setItem|removeItem)/g,
  supabaseRest: /SUPA_URL\s*\+\s*['"`]\/rest\/v1\/([a-z_]+)/g,
  supabaseRpc: /\/rest\/v1\/rpc\/([a-z_]+)/g,
  supabaseSdk: /supabase\s*\.\s*from\(\s*['"`]([a-z_]+)/g,
  firebase: /firebase\.|getMessaging|onMessage|firebase-messaging/g,
  fetch: /\bfetch\s*\(/g,
  whatsapp: /wa\.me|whatsapp|api\.whatsapp/gi,
  mailto: /mailto:/g,
  tel: /['"`]tel:/g,
  subidaArchivo: /type\s*=\s*["']file["']|FileReader|\.files\[/g,
  arrastrar: /dragstart|dragover|\bdrop\b|draggable/g,
  atajoTeclado: /e\.key\s*===|event\.key\s*===|ctrlKey|metaKey|altKey/g,
  menuContextual: /contextmenu/g,
  ia: /openai|anthropic|claude|gpt-|_aiCall|AI_CATS/gi,
  gridstack: /GridStack|gridstack/g,
}

/** Las funciones que dibujan una pantalla, y las que cablean sus eventos. */
export function pantallas(fns) {
  return {
    render: fns.filter((f) => /^render[A-Z_]/.test(f.nombre)),
    wire: fns.filter((f) => /^wire[A-Z_]/.test(f.nombre)),
    open: fns.filter((f) => /^(open|abrir|_abrir|show|mostrar)[A-Z_]/.test(f.nombre)),
    guardar: fns.filter((f) => /^(save|guardar|_guardar|create|crear|update|delete|borrar|eliminar|duplicar|anular)[A-Z_]/i.test(f.nombre)),
  }
}

/** Lo que el legacy chequea para mostrar u ocultar algo (§6, §16). */
export function condicionesDeRol(src) {
  const out = new Map()
  const re = /\b(isCatCliente|isDetCliente|_isCmpCliente|_isClienteExport|esUsuarioInterno|loadAuthUsers|state\.user|role\s*===\s*['"]([a-z]+)['"]|rol\s*===\s*['"]([a-z]+)['"])/g
  for (const m of src.matchAll(re)) {
    const k = m[0].trim()
    out.set(k, (out.get(k) ?? 0) + 1)
  }
  return out
}

function main() {
  const base = process.argv[2]
  if (!base) throw new Error('uso: fase23-inventario-legacy.mjs <ruta-al-legacy> [--json out.json]')
  const src = readFileSync(join(base, 'app.js'), 'utf8')
  const html = readFileSync(join(base, 'index.html'), 'utf8')
  const todo = src + '\n' + html

  const secs = secciones(src)
  const fns = funciones(src)
  const p = pantallas(fns)

  const contar = (re, texto = todo) => [...texto.matchAll(re)].length
  const senales = Object.fromEntries(
    Object.entries(SENALES).map(([k, re]) => [k, contar(new RegExp(re.source, re.flags))]),
  )

  const clavesLocalStorage = [...new Set(
    [...todo.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\(\s*['"`]([^'"`]+)/g)].map((m) => m[1]),
  )].sort()

  const tablasSupabase = [...new Set([
    ...[...todo.matchAll(/\/rest\/v1\/([a-z_]+)/g)].map((m) => m[1]),
    ...[...todo.matchAll(/supabase\s*\.\s*from\(\s*['"`]([a-z_]+)/g)].map((m) => m[1]),
  ])].filter((t) => t !== 'rpc').sort()

  const rpcsSupabase = [...new Set([...todo.matchAll(/\/rest\/v1\/rpc\/([a-z_]+)/g)].map((m) => m[1]))].sort()

  const eventos = [...ocurrencias(todo, new RegExp(PATRONES.addEventListener.source, 'g'))]
    .map(([k, v]) => [k, v.veces]).sort((a, b) => b[1] - a[1])
  const onAttrs = [...ocurrencias(todo, new RegExp(PATRONES.onAtributo.source, 'gi'))]
    .map(([k, v]) => [k.toLowerCase(), v.veces]).sort((a, b) => b[1] - a[1])
  const dataAttrs = [...ocurrencias(todo, new RegExp(PATRONES.dataAtributo.source, 'gi'))]
    .map(([k, v]) => [k, v.veces]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])

  const informe = {
    generado: new Date().toISOString(),
    fuente: base,
    LINEAS_APP_JS: src.split('\n').length,
    LINEAS_INDEX_HTML: html.split('\n').length,
    SECCIONES: secs.length,
    FUNCIONES_TOTALES: fns.length,
    PANTALLAS_RENDER: p.render.length,
    CABLEADOS_WIRE: p.wire.length,
    ABRIDORES: p.open.length,
    ESCRITORES: p.guardar.length,
    SENALES: senales,
    CLAVES_LOCALSTORAGE: clavesLocalStorage,
    TABLAS_SUPABASE: tablasSupabase,
    RPCS_SUPABASE: rpcsSupabase,
    EVENTOS_ADDEVENTLISTENER: eventos,
    ATRIBUTOS_ON: onAttrs,
    ATRIBUTOS_DATA_TOP: dataAttrs.slice(0, 60),
    ATRIBUTOS_DATA_TOTAL: dataAttrs.length,
    CONDICIONES_DE_ROL: [...condicionesDeRol(todo)].sort((a, b) => b[1] - a[1]),
    LISTA_SECCIONES: secs.map((s) => `${s.linea}: ${s.titulo}`),
    RENDER: p.render.map((f) => `${f.linea}: ${f.nombre} [${seccionDe(secs, f.linea)}]`),
    WIRE: p.wire.map((f) => `${f.linea}: ${f.nombre}`),
  }

  const salida = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null
  if (salida) {
    writeFileSync(salida, JSON.stringify({ informe, funciones: fns, secciones: secs }, null, 2))
    console.error(`${salida} escrito.`)
  }
  const { LISTA_SECCIONES, RENDER, WIRE, ...resumen } = informe
  console.log(JSON.stringify(resumen, null, 2))
}

const esteArchivo = import.meta.url.replace(/^file:\/\/\/?/, '').replace(/\\/g, '/').toLowerCase()
const invocado = String(process.argv[1] ?? '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
if (invocado && esteArchivo.endsWith(invocado)) {
  try { main() } catch (e) { console.error(e.message); process.exit(1) }
}
