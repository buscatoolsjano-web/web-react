/**
 * Fase 20 · E0 — El flujo de SERVICIO en STEL: qué documentos existen.
 *
 * SÓLO LECTURA (GET). Complementa a `fase20-e0-stel-activos.mjs`: ese contó
 * los activos, éste mira si existe un historial de servicio importable.
 *
 *   set -a; . ./.env.stel.local; set +a
 *   node scripts/fase20-e0-stel-servicio.mjs
 */
import { crearCliente, limpiar } from './lib/stel-api.mjs'

const c = crearCliente({ maxLlamadas: 12, usarCache: !process.argv.includes('--sin-cache') })

console.log('═'.repeat(74))
console.log('  FASE 20 · E0 — FLUJO DE SERVICIO EN STEL (SÓLO LECTURA)')
console.log('═'.repeat(74))

const estados = await c.todos('documentStates', {}, { limite: 200, maxPaginas: 2 })
const nombreEstado = new Map(estados.map((e) => [e.id, e.name]))

for (const coleccion of ['workOrders', 'workDeliveryNotes', 'workEstimates']) {
  let filas = []
  try {
    filas = await c.todos(coleccion, {}, { limite: 200, maxPaginas: 5 })
  } catch (e) {
    console.log(`\n${coleccion}: no se pudo leer (${limpiar(e.message)})`)
    continue
  }
  const conActivo = filas.filter((f) => (f.assets ?? []).length > 0).length
  const porEstado = {}
  const porAnio = {}
  for (const f of filas) {
    const e = nombreEstado.get(f['document-state-id']) ?? String(f['document-state-id'])
    porEstado[e] = (porEstado[e] ?? 0) + 1
    const a = (f.date ?? '').slice(0, 4)
    if (a) porAnio[a] = (porAnio[a] ?? 0) + 1
  }
  console.log(`\n${coleccion}: ${filas.length}`)
  console.log(`  con activo vinculado: ${conActivo}`)
  console.log(`  por estado: ${JSON.stringify(porEstado)}`)
  console.log(`  por año:    ${JSON.stringify(porAnio)}`)
  if (filas.length > 0) {
    const campos = new Set()
    filas.slice(0, 20).forEach((f) => Object.keys(f).forEach((k) => campos.add(k)))
    console.log(`  campos:     ${[...campos].sort().join(', ')}`)
  }
}

console.log(`\nllamadas a STEL: ${c.llamadas()} · escrituras: 0`)
