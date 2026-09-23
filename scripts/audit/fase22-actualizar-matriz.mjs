/**
 * Fase 22 · paridad — reescribe la Parte 3 del documento desde la tabla.
 *
 * El conteo se lee de la matriz, no se escribe a mano. En F22 conté 58
 * estados para 57 filas y en F23 me volvió a pasar: contar una tabla a ojo
 * es una forma confiable de que el resumen y la tabla digan cosas distintas.
 *
 *   node scripts/audit/fase22-actualizar-matriz.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'

const RUTA = 'docs/PHASE_22_PARIDAD_CATALOGO.md'

const SECCIONES = [
  ['Búsqueda y filtrado', 1, 12],
  ['Orden, paginación, listado', 13, 26],
  ['Ficha', 27, 38],
  ['Hover', 39, 41],
  ['Comparador', 42, 48],
  ['Acciones', 49, 53],
  ['Permisos', 54, 56],
  ['Fuera de alcance', 57, 57],
]

export function filasDe(markdown) {
  return markdown
    .split('\n')
    .filter((l) => /^\| \d+ \|/.test(l))
    .map((l) => {
      const c = l.split('|').map((x) => x.trim())
      return { n: Number(c[1]), estado: (c[5] ?? '').replace(/\*/g, '') }
    })
}

export function conteo(filas) {
  const de = (e, arr = filas) => arr.filter((f) => f.estado === e).length
  return {
    total: filas.length,
    PARITY: de('PARITY'),
    PARTIAL: de('PARTIAL'),
    MISSING: de('MISSING'),
    INTENTIONALLY_DIFFERENT: de('INTENTIONALLY_DIFFERENT'),
    porSeccion: SECCIONES.map(([nombre, a, b]) => {
      const f = filas.filter((x) => x.n >= a && x.n <= b)
      return {
        nombre, desde: a, hasta: b, total: f.length,
        PARITY: de('PARITY', f), PARTIAL: de('PARTIAL', f),
        MISSING: de('MISSING', f), INTENTIONALLY_DIFFERENT: de('INTENTIONALLY_DIFFERENT', f),
      }
    }),
  }
}

function main() {
  const md = readFileSync(RUTA, 'utf8')
  const filas = filasDe(md)
  const c = conteo(filas)

  if (c.total !== 57) throw new Error(`la matriz tiene ${c.total} filas, se esperaban 57`)
  const suma = c.PARITY + c.PARTIAL + c.MISSING + c.INTENTIONALLY_DIFFERENT
  if (suma !== c.total) throw new Error(`los estados suman ${suma} y las filas son ${c.total}`)
  const sumaSecciones = c.porSeccion.reduce((n, s) => n + s.total, 0)
  if (sumaSecciones !== c.total) throw new Error(`las secciones suman ${sumaSecciones}`)

  const tabla = [
    '| sección | filas | PARITY | PARTIAL | MISSING | INT. DIF. |',
    '|---|---:|---:|---:|---:|---:|',
    ...c.porSeccion.map((s) =>
      `| ${s.nombre} (#${s.desde}${s.hasta === s.desde ? '' : `–${s.hasta}`}) | ${s.total} | ${s.PARITY} | ${s.PARTIAL} | ${s.MISSING} | ${s.INTENTIONALLY_DIFFERENT} |`,
    ),
    `| **total** | **${c.total}** | **${c.PARITY}** | **${c.PARTIAL}** | **${c.MISSING}** | **${c.INTENTIONALLY_DIFFERENT}** |`,
  ].join('\n')

  console.log(tabla)
  console.log('')
  console.log(JSON.stringify({ PARITY: c.PARITY, PARTIAL: c.PARTIAL, MISSING: c.MISSING, INTENTIONALLY_DIFFERENT: c.INTENTIONALLY_DIFFERENT }))

  const salida = process.argv.includes('--escribir')
  if (!salida) return

  const inicio = md.indexOf('| sección | filas |')
  const fin = md.indexOf('\n', md.indexOf('| **total** |'))
  if (inicio < 0 || fin < 0) throw new Error('no encontré la tabla de conteo en el documento')
  writeFileSync(RUTA, md.slice(0, inicio) + tabla + md.slice(fin))
  console.error(`${RUTA} actualizado.`)
}

const esteArchivo = import.meta.url.replace(/^file:\/\/\/?/, '').replace(/\\/g, '/').toLowerCase()
const invocado = String(process.argv[1] ?? '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
if (invocado && esteArchivo.endsWith(invocado)) {
  try { main() } catch (e) { console.error(e.message); process.exit(1) }
}
