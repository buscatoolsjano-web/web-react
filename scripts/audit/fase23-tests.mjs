/**
 * Fase 23 · Tests de la auditoría.
 *
 * No testean el producto: testean que la auditoría sea consistente y
 * reproducible (§27). Lo que protegen es que el resumen y la matriz no digan
 * cosas distintas — en F22 conté 58 estados para 57 filas y el error sólo
 * apareció al sumar a mano.
 *
 *   node scripts/audit/fase23-tests.mjs <ruta-al-legacy>
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MATRIZ, resumen, aCsv } from './fase23-matriz.mjs'
import { secciones, funciones, pantallas } from './fase23-inventario-legacy.mjs'

let ok = 0
const fallos = []
const cmp = (titulo, esperado, real) => {
  const a = JSON.stringify(esperado)
  const b = JSON.stringify(real)
  if (a === b) ok++
  else fallos.push(`${titulo}\n    esperado: ${a}\n    real:     ${b}`)
}
const verdad = (titulo, cond, detalle = '') => cmp(titulo + (detalle ? ` (${detalle})` : ''), true, Boolean(cond))

// ── La matriz cierra ───────────────────────────────────────────────────────
const r = resumen()
cmp(
  'los estados suman exactamente las filas activas',
  r.TOTAL_ACTIVE_LEGACY_CAPABILITIES,
  r.PARITY + r.PARTIAL + r.MISSING + r.INTENTIONALLY_DIFFERENT + r.UNKNOWN,
)
cmp('las activas más el código muerto son todas las filas', r.FILAS_TOTALES, r.TOTAL_ACTIVE_LEGACY_CAPABILITIES + r.LEGACY_DEAD_CODE)
cmp('la suma por módulo da el total', r.TOTAL_ACTIVE_LEGACY_CAPABILITIES, Object.values(r.POR_MODULO).reduce((n, m) => n + m.total, 0))
cmp(
  'cada módulo cierra por dentro',
  [],
  Object.entries(r.POR_MODULO)
    .filter(([, m]) => m.PARITY + m.PARTIAL + m.MISSING + m.INTENTIONALLY_DIFFERENT + m.UNKNOWN !== m.total)
    .map(([k]) => k),
)
cmp(
  'las severidades suman los gaps',
  r.PARTIAL + r.MISSING,
  r.BLOCKERS + r.HIGH + r.MEDIUM + r.LOW,
)

// ── Reglas de la matriz ────────────────────────────────────────────────────
cmp('no hay IDs repetidos', MATRIZ.length, new Set(MATRIZ.map((f) => f.id)).size)
cmp(
  'todo PARTIAL o MISSING tiene severidad',
  [],
  MATRIZ.filter((f) => (f.paridad === 'PARTIAL' || f.paridad === 'MISSING') && !f.sev).map((f) => f.id),
)
cmp(
  'nada que NO sea PARTIAL ni MISSING lleva severidad',
  [],
  MATRIZ.filter((f) => f.sev && f.paridad !== 'PARTIAL' && f.paridad !== 'MISSING').map((f) => f.id),
)
cmp(
  'toda fila tiene evidencia de los dos lados',
  [],
  MATRIZ.filter((f) => !f.legacyEv?.trim() || !f.reactEv?.trim()).map((f) => f.id),
)
cmp(
  'los estados de paridad son de la lista permitida',
  [],
  MATRIZ.filter((f) => !['PARITY', 'PARTIAL', 'MISSING', 'INTENTIONALLY_DIFFERENT', 'LEGACY_DEAD_CODE', 'UNKNOWN'].includes(f.paridad)).map((f) => f.id),
)
cmp(
  'los estados del legacy son de la lista permitida',
  [],
  MATRIZ.filter((f) => !['ACTIVE', 'CONDITIONAL', 'UNREACHABLE', 'DEAD_CODE', 'UNKNOWN'].includes(f.legacySt)).map((f) => f.id),
)
cmp(
  'todo UNKNOWN explica cómo verificarlo',
  [],
  MATRIZ.filter((f) => f.paridad === 'UNKNOWN' && !/preguntar|confirmar|verifica|dato necesario|mirar/i.test(f.notas)).map((f) => f.id),
)
cmp(
  'todo código muerto justifica por qué',
  [],
  MATRIZ.filter((f) => f.paridad === 'LEGACY_DEAD_CODE' && !f.notas?.trim()).map((f) => f.id),
)

// Un BLOCKER que no esté MISSING o PARTIAL sería una contradicción.
cmp(
  'los BLOCKER son gaps de verdad',
  [],
  MATRIZ.filter((f) => f.sev === 'BLOCKER' && f.paridad !== 'MISSING' && f.paridad !== 'PARTIAL').map((f) => f.id),
)

// ── El CSV ─────────────────────────────────────────────────────────────────
const csv = aCsv()
const filasCsv = csv.split('\r\n')
cmp('el CSV tiene una fila por capacidad más la cabecera', MATRIZ.length + 1, filasCsv.length)
verdad('el separador es ; como el resto de los CSV del proyecto', filasCsv[0].includes(';'))
verdad('la cabecera trae las 11 columnas pedidas', filasCsv[0].split(';').length === 11, filasCsv[0].split(';').length + ' columnas')

/**
 * Cada fila tiene que parsearse en 11 campos.
 *
 * El chequeo anterior buscaba `;` fuera de comillas con un regex y daba falso
 * negativo contra la propia cabecera, que no lleva comillas. Parsear de
 * verdad es lo único que prueba que un `;` o una comilla dentro de una nota
 * no parten la fila.
 */
const parseCsv = (linea) => {
  const campos = []
  let campo = ''
  let entre = false
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i]
    if (entre) {
      if (c === '"') { if (linea[i + 1] === '"') { campo += '"'; i++ } else entre = false }
      else campo += c
    } else if (c === '"') entre = true
    else if (c === ';') { campos.push(campo); campo = '' }
    else campo += c
  }
  campos.push(campo)
  return campos
}
cmp(
  'cada fila del CSV parsea en 11 campos',
  [],
  filasCsv.slice(1).map((l, i) => [i, parseCsv(l).length]).filter(([, n]) => n !== 11).map(([i, n]) => `fila ${i + 2}: ${n}`),
)
// Y el contenido tiene que sobrevivir al viaje de ida y vuelta.
const primera = parseCsv(filasCsv[1] ?? '')
cmp('el id del CSV es el de la matriz', MATRIZ[0]?.id, primera[0])
cmp('la nota del CSV es la de la matriz', MATRIZ[0]?.notas, primera[10])

// ── El inventario del legacy ───────────────────────────────────────────────
const base = process.argv[2]
if (base) {
  const src = readFileSync(join(base, 'app.js'), 'utf8')
  const secs = secciones(src)
  const fns = funciones(src)
  const p = pantallas(fns)

  verdad('el app.js del legacy tiene el tamaño esperado', src.split('\n').length > 45000, src.split('\n').length + ' líneas')
  verdad('se encontraron secciones con título, no barras', secs.length > 30 && !secs.some((s) => /^[=─━]+$/.test(s.titulo)), secs.length + ' secciones')
  verdad('ninguna sección tiene título vacío', !secs.some((s) => !s.titulo.trim()))
  verdad('se encontraron más de mil funciones', fns.length > 1000, fns.length)
  verdad('se encontraron más de cien pantallas', p.render.length > 100, p.render.length)

  // Las anclas del router tienen que existir de verdad en el archivo. Si el
  // legacy cambia de nombre una pantalla, esto falla antes que la matriz
  // quede citando una línea que ya no dice lo que decía.
  const nombres = new Set(fns.map((f) => f.nombre))
  const anclas = ['renderMain', 'renderCatalogoProductos', 'renderCotEditor', 'renderFacturasList',
    'renderCRMLeads', 'renderFinanzasTC', 'renderImportacion', 'renderClienteCotizacion',
    'openCatCompare', '_descSplitLink', 'getPermsFor']
  cmp('las funciones que cita la matriz existen', [], anclas.filter((n) => !nombres.has(n)))

  // Y las líneas citadas tienen que caer donde se dice.
  const lineas = src.split('\n')
  const citas = [
    [27095, 'renderFacturasList'], [27366, 'renderFacturaEditor'], [28362, 'renderFinanzasTC'],
    [15308, 'renderCatalogoProductos'], [17048, 'openCatCompare'], [28648, '_descSplitLink'],
    [2088, 'renderClienteCotizacion'], [34575, 'renderMain'],
  ]
  cmp(
    'cada línea citada en la matriz contiene esa función',
    [],
    citas.filter(([n, f]) => !(lineas[n - 1] ?? '').includes(f)).map(([n, f]) => `${f}@${n}`),
  )
} else {
  console.error('  (sin ruta al legacy: se saltean los tests del inventario)')
}

console.log(`${ok} OK, ${fallos.length} fallos`)
for (const f of fallos) console.error('  ✗ ' + f)
process.exit(fallos.length === 0 ? 0 : 1)
