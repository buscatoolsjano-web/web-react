/**
 * Fase 20 · E2 — Auditoría y dry run del historial de servicio de STEL.
 *
 * **NO ESCRIBE NADA.** No tiene `--aplicar` ni ninguna otra bandera que
 * inserte: STEL se lee con GET y la base sólo con SELECT. Lo único que produce
 * es un informe en `scripts/output/fase20-e2-auditoria.json` y el bloque de
 * números por consola.
 *
 *   set -a; . ./.env; . ./.env.migration; . ./.env.stel.local; set +a
 *   node scripts/fase20-e2-auditar-servicios.mjs
 *
 * Las decisiones viven en `lib/fase20-e2-servicios.mjs` y se prueban con
 * fixtures en `fase20-e2-servicios-tests.mjs`. Acá queda la orquestación:
 * leer, medir y contar lo que se crearía.
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { crearCliente } from './lib/stel-api.mjs'
import {
  activosDe,
  armarCadenas,
  claseDeCadena,
  claveDeServicio,
  clasificarLinea,
  documentosDe,
  estadoDeServicio,
  importesAtribuibles,
  nombreEstado,
  raizDe,
  textoTecnico,
} from './lib/fase20-e2-servicios.mjs'

const SALIDA_DIR = path.resolve('scripts/output')
const SALIDA = path.join(SALIDA_DIR, 'fase20-e2-auditoria.json')

/** Lo que midió E0. Si hoy no da lo mismo, el informe lo dice bien fuerte. */
const ESPERADO = { workEstimates: 31, workOrders: 21, workDeliveryNotes: 30 }

const c = crearCliente({ maxLlamadas: 20, usarCache: !process.argv.includes('--sin-cache') })

console.log('═'.repeat(74))
console.log('  FASE 20 · E2 — HISTORIAL DE SERVICIO DE STEL (AUDITORÍA · NO ESCRIBE)')
console.log('═'.repeat(74))

// ── 1 · STEL (GET) ─────────────────────────────────────────────────────────
const estimates = await c.todos('workEstimates', {}, { limite: 200, maxPaginas: 5 })
const orders = await c.todos('workOrders', {}, { limite: 200, maxPaginas: 5 })
const deliveryNotes = await c.todos('workDeliveryNotes', {}, { limite: 200, maxPaginas: 5 })

console.log(`\n1 · STEL: ${estimates.length} presupuestos · ${orders.length} órdenes · ${deliveryNotes.length} remitos`)
for (const [k, n] of Object.entries(ESPERADO)) {
  const hoy = { workEstimates: estimates, workOrders: orders, workDeliveryNotes: deliveryNotes }[k].length
  if (hoy !== n) console.log(`    ⚠ ${k}: E0 contó ${n} y hoy hay ${hoy}`)
}

// ── 2 · Cadenas ────────────────────────────────────────────────────────────
const cadenas = armarCadenas({ estimates, orders, deliveryNotes })
const docsCubiertos = cadenas.reduce((n, ch) => n + documentosDe(ch).length, 0)
const clases = {}
for (const ch of cadenas) clases[claseDeCadena(ch)] = (clases[claseDeCadena(ch)] ?? 0) + 1

console.log(`\n2 · Cadenas: ${cadenas.length} (cubren ${docsCubiertos} de ${estimates.length + orders.length + deliveryNotes.length} documentos)`)
for (const [k, n] of Object.entries(clases).sort()) console.log(`    ${String(n).padStart(3)} · ${k}`)

// Un padre con dos hijos sería una cadena ambigua: se cuenta aparte.
const ambiguas = cadenas.filter((ch) => ch.ordenes.length > 1 || ch.remitos.length > 1)
console.log(`    cadenas con más de una orden o más de un remito: ${ambiguas.length}`)

// ── 3 · React (SELECT) ─────────────────────────────────────────────────────
const BASE = process.env.VITE_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !SECRET) throw new Error('Faltan VITE_SUPABASE_URL y SUPABASE_SECRET_KEY')
const sb = createClient(BASE, SECRET, { auth: { persistSession: false } })

async function traerTodo(tabla, columnas) {
  const filas = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb.from(tabla).select(columnas).range(desde, desde + 999)
    if (error) throw new Error(`${tabla}: ${error.message}`)
    filas.push(...data)
    if (data.length < 1000) return filas
  }
}

const activosBase = await traerTodo('maintenance_assets', 'id, company_id, external_source, external_id, owner_customer_id, reference, serial_number')
const productos = await traerTodo('products', 'id, company_id, sku, deleted_at')

// `maintenance_orders` todavía no tiene columnas de procedencia —es uno de los
// cambios de esquema que esta auditoría propone—. Si no están, no hay nada
// importado que reconocer, y decirlo es parte del informe.
let ordenesBase = []
let hayProcedencia = true
try {
  ordenesBase = await traerTodo('maintenance_orders', 'id, external_source, external_id')
} catch (e) {
  if (!/external_source/.test(e.message)) throw e
  hayProcedencia = false
  ordenesBase = (await traerTodo('maintenance_orders', 'id')).map((o) => ({ ...o, external_source: null, external_id: null }))
}

const activoPorStel = new Map(
  activosBase.filter((a) => a.external_source === 'stel' && a.external_id).map((a) => [String(a.external_id), a]),
)
const productoPorSku = new Map()
for (const p of productos) {
  if (p.deleted_at) continue
  const k = (p.sku ?? '').trim().toUpperCase()
  if (k) productoPorSku.set(k, [...(productoPorSku.get(k) ?? []), p])
}
console.log(`\n3 · React: ${activosBase.length} equipos (${activoPorStel.size} con procedencia STEL) · ${ordenesBase.length} órdenes ya cargadas · ${productoPorSku.size} SKUs`)
if (!hayProcedencia) console.log('    ⚠ maintenance_orders NO tiene external_source/external_id: hace falta agregarlas antes de importar')

// ── 4 · Servicios propuestos: una cadena por cada equipo que toca ──────────
const servicios = []
const rechazos = []
for (const ch of cadenas) {
  const e = estadoDeServicio(ch)
  const raiz = raizDe(ch)
  const act = activosDe(ch)
  const etiqueta = raiz.doc['full-reference'] ?? String(raiz.doc.id)

  if (!e.importable) {
    rechazos.push({ cadena: etiqueta, activos: act.length, motivo: e.motivo })
    continue
  }
  if (act.length === 0) {
    rechazos.push({ cadena: etiqueta, activos: 0, motivo: 'la cadena no tiene ningún equipo vinculado en STEL' })
    continue
  }
  for (const idStel of act) {
    const equipo = activoPorStel.get(String(idStel))
    if (!equipo) {
      rechazos.push({ cadena: etiqueta, activos: act.length, motivo: `el equipo STEL ${idStel} no está importado` })
      continue
    }
    servicios.push({
      clave: claveDeServicio(ch, idStel),
      cadena: etiqueta,
      clase: claseDeCadena(ch),
      documentos: documentosDe(ch).map((d) => ({
        tipo: d['parent-document-path'] === undefined ? 'workEstimates' : d === ch.estimate ? 'workEstimates' : ch.ordenes.includes(d) ? 'workOrders' : 'workDeliveryNotes',
        id: d.id,
        referencia: d['full-reference'],
        fecha: (d.date ?? '').slice(0, 10),
        estadoStel: nombreEstado(d['document-state-id']),
        moneda: d['currency-code'] ?? null,
        total: d['total-amount'] ?? null,
        pdf: Boolean(d['pdf-path']),
      })),
      equipo: { id: equipo.id, referencia: equipo.reference, serie: equipo.serial_number, cliente: equipo.owner_customer_id },
      estado: e,
      importes: importesAtribuibles(ch),
      textos: textoTecnico(ch).length,
    })
  }
}

// Invariantes de fecha que la base va a exigir igual (chk_mo_fechas).
const fechasMalas = servicios.filter((s) => s.estado.delivered_at && s.estado.received_at && s.estado.delivered_at < s.estado.received_at)
const sinCliente = servicios.filter((s) => !s.equipo.cliente)
const yaImportados = servicios.filter((s) => ordenesBase.some((o) => o.external_source === 'stel' && o.external_id === s.clave))

console.log(`\n4 · Servicios propuestos (cadena × equipo): ${servicios.length}`)
console.log(`    equipos distintos con historial: ${new Set(servicios.map((s) => s.equipo.id)).size}`)
console.log(`    ya importados (segunda corrida insertaría 0): ${yaImportados.length}`)
console.log(`    con fecha de entrega anterior al ingreso: ${fechasMalas.length}`)
console.log(`    cuyo equipo no tiene cliente (customer_id es NOT NULL): ${sinCliente.length}`)
console.log(`    descartados: ${rechazos.length}`)
for (const r of rechazos) console.log(`      · ${r.cadena}: ${r.motivo}`)

// ── 5 · Estados propuestos ─────────────────────────────────────────────────
const mapa = new Map()
for (const s of servicios) {
  const stel = s.documentos.map((d) => `${d.tipo.replace('work', '')} ${d.estadoStel}`).join(' + ')
  const react = `${s.estado.status} / ${s.estado.stage} / cotización ${s.estado.quote_status}`
  const k = `${stel} → ${react}`
  const v = mapa.get(k) ?? { servicios: 0, cadenas: new Set(), confianza: s.estado.confianza, razon: s.estado.razon }
  v.servicios++
  v.cadenas.add(s.cadena)
  mapa.set(k, v)
}
console.log('\n5 · Estados: STEL → mantenimiento')
for (const [k, v] of [...mapa].sort()) {
  console.log(`    ${String(v.servicios).padStart(3)} servicios · ${String(v.cadenas.size).padStart(2)} cadenas · confianza ${v.confianza}`)
  console.log(`        ${k}`)
}

// ── 6 · Líneas: repuestos y servicios ──────────────────────────────────────
const lineas = { producto: 0, servicio: 0, seccion: 0, 'sin-item': 0, borrada: 0 }
const porSku = new Map()
for (const ch of cadenas) {
  for (const d of documentosDe(ch)) {
    for (const l of d.lines ?? []) {
      const clase = clasificarLinea(l)
      lineas[clase]++
      if (clase !== 'producto') continue
      const ref = (l['item-reference'] ?? '').trim().toUpperCase()
      const v = porSku.get(ref) ?? { ref: l['item-reference'], nombre: l['item-name'], lineas: 0 }
      v.lineas++
      porSku.set(ref, v)
    }
  }
}
let skusOk = 0
let skusAmbiguos = 0
const skusSinMatch = []
for (const [ref, v] of porSku) {
  const m = productoPorSku.get(ref) ?? []
  if (m.length === 1) skusOk++
  else if (m.length > 1) skusAmbiguos++
  else skusSinMatch.push(v)
}
const lineasDeSkusOk = [...porSku].filter(([ref]) => (productoPorSku.get(ref) ?? []).length === 1).reduce((n, [, v]) => n + v.lineas, 0)

console.log(`\n6 · Líneas: ${lineas.producto} de producto · ${lineas.servicio} de servicio · ${lineas.seccion} secciones · ${lineas['sin-item']} sin item · ${lineas.borrada} borradas`)
console.log(`    SKUs distintos en las líneas de producto: ${porSku.size}`)
console.log(`    con un único producto en el catálogo: ${skusOk} (${lineasDeSkusOk} líneas)`)
console.log(`    ambiguos (más de un producto con ese SKU): ${skusAmbiguos}`)
console.log(`    sin match: ${skusSinMatch.length}`)
for (const v of skusSinMatch) console.log(`      · ${v.ref} — ${String(v.nombre).slice(0, 56)}`)

// ── 7 · Importes atribuibles ───────────────────────────────────────────────
const conImporte = servicios.filter((s) => s.importes.atribuible)
console.log(`\n7 · Importes: ${conImporte.length} servicios con importe atribuible (un solo equipo en la cadena)`)
console.log(`    ${servicios.length - conImporte.length} servicios comparten un documento con otros equipos: su importe NO se reparte`)

// ── 8 · Informe ────────────────────────────────────────────────────────────
fs.mkdirSync(SALIDA_DIR, { recursive: true })
fs.writeFileSync(
  SALIDA,
  JSON.stringify(
    {
      generado: new Date().toISOString(),
      fuente: { workEstimates: estimates.length, workOrders: orders.length, workDeliveryNotes: deliveryNotes.length },
      cadenas: { total: cadenas.length, clases, documentosCubiertos: docsCubiertos, ambiguas: ambiguas.length },
      servicios: servicios.length,
      equiposConHistorial: new Set(servicios.map((s) => s.equipo.id)).size,
      rechazos,
      lineas,
      skus: { distintos: porSku.size, conMatch: skusOk, ambiguos: skusAmbiguos, sinMatch: skusSinMatch },
      importesAtribuibles: conImporte.length,
      fechasMalas: fechasMalas.length,
      sinCliente: sinCliente.length,
      detalle: servicios,
    },
    null,
    1,
  ),
)

// ── 9 · Dry run: qué se crearía ────────────────────────────────────────────
console.log('\n' + '─'.repeat(74))
console.log('  DRY RUN — nada de esto se escribió')
console.log('─'.repeat(74))
console.log(`  WOULD_CREATE_ORDERS       = ${servicios.length}`)
console.log(`  WOULD_CREATE_QUOTES       = ${conImporte.reduce((n, s) => n + s.importes.lineas, 0)}  (sólo cadenas de un equipo)`)
console.log('  WOULD_CREATE_PARTS        = 0  (consumir repuestos movería stock: fuera de alcance)')
console.log('  WOULD_CREATE_CHECKS       = 0  (STEL no trae puntos de chequeo)')
console.log('  WOULD_CREATE_MEASUREMENTS = 0  (STEL no trae mediciones de torque)')
console.log(`  UNMATCHED_ASSETS          = ${rechazos.filter((r) => /no está importado/.test(r.motivo)).length}`)
console.log(`  AMBIGUOUS_CHAINS          = ${ambiguas.length}`)
console.log(`  UNMATCHED_PRODUCTS        = ${skusSinMatch.length}`)
console.log(`  INVALID_DATES             = ${fechasMalas.length}`)
console.log(`  INVALID_STATES            = ${rechazos.filter((r) => /estado STEL desconocido/.test(r.motivo)).length}`)
console.log(`\n  escrituras en STEL: 0 · escrituras en la base: 0`)
console.log(`  informe: ${path.relative(process.cwd(), SALIDA)}`)
console.log(`  llamadas a STEL: ${c.llamadas()}\n`)
