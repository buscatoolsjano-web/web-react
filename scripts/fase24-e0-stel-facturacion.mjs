/**
 * Fase 24 · E0 — Qué existe en STEL para facturación y cobros.
 *
 * **SÓLO LECTURA.** El cliente de `scripts/lib/stel-api.mjs` no tiene ningún
 * método de escritura, y este archivo sólo lista y cuenta. No escribe en STEL
 * ni en Supabase.
 *
 * La pregunta que contesta: ¿STEL tiene facturas de venta, notas de crédito y
 * cobros, con qué campos, y con qué vínculos al pedido y al cliente? Sin eso
 * no se puede decidir si React registra o emite.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase24-e0-stel-facturacion.mjs [--desde 2026-01-01] [--max-llamadas 60]
 */
import { crearCliente, fechaStel, limpiar } from './lib/stel-api.mjs'
import { writeFileSync, mkdirSync } from 'node:fs'

const arg = (n, def) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : def }
const DESDE = arg('--desde', '2026-01-01')
const MAX = Number(arg('--max-llamadas', '60'))

/**
 * Los nombres de recurso que STEL Order usa para el circuito de cobranza.
 *
 * Se prueban de a uno: la especificación cambió de nombres entre versiones y
 * no queremos asumir. Un 404 es información —ese recurso no existe— y no un
 * error que tenga que frenar la auditoría.
 */
export const CANDIDATOS = [
  ['facturas de venta', 'salesInvoices'],
  ['facturas de venta (alt)', 'invoices'],
  ['notas de crédito', 'salesCreditNotes'],
  ['notas de crédito (alt)', 'creditNotes'],
  ['recibos', 'receipts'],
  ['cobros', 'payments'],
  ['cobros (alt)', 'collections'],
  ['remitos', 'deliveryNotes'],
  ['vencimientos', 'dueDates'],
]

/** Las claves de un objeto, en orden, para saber qué campos trae de verdad. */
export function camposDe(filas) {
  const claves = new Map()
  for (const f of filas) {
    for (const [k, v] of Object.entries(f ?? {})) {
      const info = claves.get(k) ?? { veces: 0, conValor: 0, ejemplo: null }
      info.veces++
      if (v !== null && v !== undefined && v !== '') {
        info.conValor++
        if (info.ejemplo === null) info.ejemplo = typeof v === 'object' ? '(objeto)' : String(v).slice(0, 40)
      }
      claves.set(k, info)
    }
  }
  return [...claves.entries()]
    .map(([k, i]) => ({ campo: k, conValor: i.conValor, de: filas.length, ejemplo: i.ejemplo }))
    .sort((a, b) => b.conValor - a.conValor)
}

async function main() {
  const api = crearCliente({ maxLlamadas: MAX, usarCache: true })
  const hallazgos = {}

  for (const [nombre, recurso] of CANDIDATOS) {
    try {
      const filas = await api.get(recurso, { limit: 50, start: 0, modifiedFrom: fechaStel(DESDE) })
      hallazgos[recurso] = {
        nombre,
        existe: true,
        filas: Array.isArray(filas) ? filas.length : 0,
        campos: Array.isArray(filas) ? camposDe(filas.slice(0, 50)) : [],
      }
      console.log(`✓ ${nombre.padEnd(26)} ${recurso.padEnd(18)} ${Array.isArray(filas) ? filas.length : 0} filas`)
    } catch (e) {
      const msg = limpiar(e.message ?? String(e))
      // Un 404 dice que el recurso no existe; cualquier otra cosa hay que
      // distinguirla, porque «no existe» y «no pude preguntar» no son lo mismo.
      const esNoExiste = /404|not found|E000001|no existe/i.test(msg)
      hallazgos[recurso] = { nombre, existe: false, motivo: esNoExiste ? 'no existe' : msg }
      console.log(`${esNoExiste ? '·' : '✗'} ${nombre.padEnd(26)} ${recurso.padEnd(18)} ${esNoExiste ? 'no existe' : msg.slice(0, 60)}`)
    }
  }

  mkdirSync('scripts/output', { recursive: true })
  const salida = 'scripts/output/fase24-stel-facturacion.json'
  writeFileSync(salida, JSON.stringify({ generado: new Date().toISOString(), desde: DESDE, hallazgos }, null, 2))
  console.error(`\nDetalle en ${salida} (ignorado por git: puede traer razones sociales).`)
  console.error('NADA escrito en STEL ni en Supabase.')
}

const esteArchivo = import.meta.url.replace(/^file:\/\/\/?/, '').replace(/\\/g, '/').toLowerCase()
const invocado = String(process.argv[1] ?? '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
if (invocado && esteArchivo.endsWith(invocado)) {
  main().catch((e) => { console.error(limpiar(e.message ?? String(e))); process.exit(1) })
}
