/**
 * Fase 20 · E2 — Importar el historial de servicio de STEL (opción C).
 *
 * STEL se lee **sólo de la cache** (`.stel-cache`): este script no hace ni una
 * llamada nueva, y no existe método para escribir en STEL. En la base escribe
 * únicamente en las cuatro tablas del historial, y sólo con `--aplicar`:
 *
 *   maintenance_service_chains            41 filas — el evento de STEL
 *   maintenance_service_source_documents  82 filas — los papeles que lo prueban
 *   maintenance_service_history          200 filas — el evento por equipo
 *   maintenance_service_source_lines     285 filas — lo que decía cada documento
 *
 * NO toca `maintenance_orders`, ni cotizaciones, ni repuestos operativos, ni
 * chequeos, ni mediciones, ni stock, ni reservas.
 *
 *   set -a; . ./.env; . ./.env.migration; . ./.env.stel.local; set +a
 *   node scripts/fase20-e2-importar-historial.mjs            # dry run
 *   node scripts/fase20-e2-importar-historial.mjs --aplicar  # inserta
 *
 * Es idempotente por construcción: antes de insertar lee las claves que ya
 * están y manda sólo las que faltan. La segunda corrida inserta 0.
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { crearCliente } from './lib/stel-api.mjs'
import {
  aFilaDeCadena,
  aFilaDeDocumento,
  aFilaDeLinea,
  aFilaDeServicio,
  activosDe,
  armarCadenas,
  clasificarLinea,
  claveDeCadena,
  claveDeDocumento,
  claveDeServicio,
  documentosDe,
  estadoDeServicio,
} from './lib/fase20-e2-servicios.mjs'

const APLICAR = process.argv.includes('--aplicar')
const SALIDA_DIR = path.resolve('scripts/output')
const SALIDA = path.join(SALIDA_DIR, 'fase20-e2-import.json')

/**
 * Lo que se espera insertar. Si hoy no da lo mismo, no se escribe nada.
 *
 * Ojo con la diferencia entre lo que STEL tiene y lo que entra: STEL tiene 41
 * cadenas y 82 documentos, pero 5 cadenas (6 documentos, 22 líneas) no tienen
 * ningún equipo vinculado. Entran 36 y 76.
 *
 * No es un descarte por comodidad: la historia se ve desde el equipo, y una
 * cadena sin equipo no aparece en ninguna ficha —la policy de lectura pide que
 * exista al menos un servicio—. Insertarla sería dejar seis documentos que
 * nadie puede abrir desde ninguna parte. Quedan documentados, uno por uno, en
 * la lista de excluidos.
 */
const ESPERADO = { cadenas: 36, documentos: 76, servicios: 200, equipos: 132, excluidos: 6 }

const TABLAS = {
  cadenas: 'maintenance_service_chains',
  documentos: 'maintenance_service_source_documents',
  servicios: 'maintenance_service_history',
  lineas: 'maintenance_service_source_lines',
}

console.log('═'.repeat(74))
console.log(`  FASE 20 · E2 — HISTORIAL DE SERVICIO ${APLICAR ? '(APLICA)' : '(DRY RUN)'}`)
console.log('═'.repeat(74))

// ── 1 · STEL, sólo de la cache ─────────────────────────────────────────────
const c = crearCliente({ maxLlamadas: 0, usarCache: true, log: () => {} })
const estimates = await c.todos('workEstimates', {}, { limite: 200, maxPaginas: 5 })
const orders = await c.todos('workOrders', {}, { limite: 200, maxPaginas: 5 })
const deliveryNotes = await c.todos('workDeliveryNotes', {}, { limite: 200, maxPaginas: 5 })
const empleados = await c.todos('employees', {}, { limite: 200, maxPaginas: 1 })
const nombrePorEmpleado = new Map(empleados.map((e) => [e.id, e.name ?? e['full-name'] ?? null]).filter(([, n]) => n))
console.log(`\n1 · STEL (cache): ${estimates.length} + ${orders.length} + ${deliveryNotes.length} documentos · ${nombrePorEmpleado.size} empleados · ${c.llamadas()} llamadas nuevas`)

const cadenas = armarCadenas({ estimates, orders, deliveryNotes })

// ── 2 · Base (SELECT) ──────────────────────────────────────────────────────
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

const activos = await traerTodo('maintenance_assets', 'id, company_id, external_source, external_id, owner_customer_id')
const productos = await traerTodo('products', 'id, company_id, sku, deleted_at')

const activoPorStel = new Map(
  activos.filter((a) => a.external_source === 'stel' && a.external_id).map((a) => [String(a.external_id), a]),
)
const productoPorSku = new Map()
for (const p of productos) {
  if (p.deleted_at) continue
  const k = (p.sku ?? '').trim().toUpperCase()
  if (!k) continue
  productoPorSku.set(k, [...(productoPorSku.get(k) ?? []), p])
}

// La empresa sale de los equipos, no de una constante: si hubiera más de una,
// esto se detiene antes de escribir en la equivocada.
const empresas = [...new Set(activos.map((a) => a.company_id))]
if (empresas.length !== 1) throw new Error(`Los equipos son de ${empresas.length} empresas: revisar a mano`)
const companyId = empresas[0]
console.log(`2 · Base: ${activos.length} equipos (${activoPorStel.size} de STEL) · empresa ${companyId.slice(0, 8)}…`)

// ¿Existen las tablas? Sin ellas no hay nada que hacer, ni siquiera dry run
// completo: el informe lo dice y no se inventa un esquema.
const faltantes = []
for (const tabla of Object.values(TABLAS)) {
  const { error } = await sb.from(tabla).select('id', { head: true, count: 'exact' })
  if (error) faltantes.push(tabla)
}
if (faltantes.length > 0) {
  console.log(`\n⚠ Faltan las tablas: ${faltantes.join(', ')}`)
  console.log('  Aplicar primero scripts/fase20-e2-historial-stel.sql. El dry run sigue: cuenta lo que se insertaría.')
}
if (faltantes.length > 0 && APLICAR) {
  throw new Error('No se puede aplicar: falta el esquema del historial')
}

// ── 3 · Armar las filas ────────────────────────────────────────────────────
const filasCadenas = []
const filasDocumentos = []
const filasServicios = []
const filasLineas = []
const excluidos = []

for (const ch of cadenas) {
  const e = estadoDeServicio(ch)
  const etiqueta = claveDeCadena(ch)

  if (!e.importable) {
    excluidos.push({ cadena: etiqueta, motivo: e.motivo })
    continue
  }

  const ids = activosDe(ch)
  const equipos = ids.map((id) => [id, activoPorStel.get(String(id)) ?? null])
  for (const [id, equipo] of equipos) {
    if (!equipo) excluidos.push({ cadena: etiqueta, motivo: `el equipo STEL ${id} no está importado` })
  }
  const emparejados = equipos.filter(([, equipo]) => equipo)
  if (emparejados.length === 0) {
    excluidos.push({ cadena: etiqueta, motivo: 'la cadena no tiene ningún equipo vinculado en STEL' })
    continue
  }

  // El cliente de la cadena es el del primer equipo emparejado. Los documentos
  // de una cadena comparten cliente —se midió: 0 discrepancias—, así que no hay
  // nada que elegir, y el emparejamiento de clientes ya lo hizo E1.
  const customerId = emparejados[0][1].owner_customer_id ?? null

  filasCadenas.push(aFilaDeCadena(ch, { companyId, customerId, nombrePorEmpleado }))

  for (const d of documentosDe(ch)) {
    filasDocumentos.push({ ...aFilaDeDocumento(ch, d, { companyId }), _cadena: etiqueta })
    const moneda = d['currency-code'] ?? null
    let n = 0
    for (const l of d.lines ?? []) {
      if (clasificarLinea(l) === 'borrada') continue
      n += 1
      const sku = (l['item-reference'] ?? '').trim().toUpperCase()
      const candidatos = clasificarLinea(l) === 'producto' ? (productoPorSku.get(sku) ?? []) : []
      filasLineas.push({
        ...aFilaDeLinea(l, n, {
          companyId,
          matchedProductId: candidatos.length === 1 ? candidatos[0].id : null,
          monedaDelDocumento: moneda,
        }),
        _documento: claveDeDocumento(ch, d),
      })
    }
  }

  for (const [id, equipo] of emparejados) {
    filasServicios.push({
      ...aFilaDeServicio(ch, id, {
        companyId,
        assetId: equipo.id,
        customerId: equipo.owner_customer_id ?? null,
        nombrePorEmpleado,
      }),
      _cadena: claveDeCadena(ch),
      _clave: claveDeServicio(ch, id),
    })
  }
}

const equiposConHistorial = new Set(filasServicios.map((s) => s.asset_id)).size
const lineasProducto = filasLineas.filter((l) => l.line_type === 'product')
const conMatch = lineasProducto.filter((l) => l.matched_product_id).length

console.log(`\n3 · Filas armadas`)
console.log(`    cadenas:    ${filasCadenas.length}`)
console.log(`    documentos: ${filasDocumentos.length}`)
console.log(`    servicios:  ${filasServicios.length} sobre ${equiposConHistorial} equipos`)
console.log(`    líneas:     ${filasLineas.length} (${lineasProducto.length} de producto · ${conMatch} emparejadas · ${lineasProducto.length - conMatch} sin match)`)
console.log(`    excluidos:  ${excluidos.length}`)
for (const x of excluidos) console.log(`      · ${x.cadena}: ${x.motivo}`)

// ── 4 · Invariantes: si los números cambiaron, no se escribe ────────────────
const medido = {
  cadenas: filasCadenas.length,
  documentos: filasDocumentos.length,
  servicios: filasServicios.length,
  equipos: equiposConHistorial,
  excluidos: excluidos.length,
}
const difieren = Object.entries(ESPERADO).filter(([k, v]) => medido[k] !== v)
if (difieren.length > 0) {
  console.log('\n⚠ Los números no son los auditados:')
  for (const [k, v] of difieren) console.log(`    ${k}: la auditoría midió ${v} y hoy da ${medido[k]}`)
  if (APLICAR) throw new Error('No se escribe nada con los números cambiados: volver a auditar')
}

// Y una comprobación que no se puede delegar: ningún importe atribuido a un
// equipo cuando el documento se comparte.
const importeMalAtribuido = filasServicios.filter((s) => s.amount !== null && s.amount_attribution !== 'asset')
if (importeMalAtribuido.length > 0) throw new Error(`${importeMalAtribuido.length} servicios con importe no atribuible`)

fs.mkdirSync(SALIDA_DIR, { recursive: true })
fs.writeFileSync(
  SALIDA,
  JSON.stringify({ generado: new Date().toISOString(), medido, excluidos, cadenas: filasCadenas, documentos: filasDocumentos, servicios: filasServicios, lineas: filasLineas }, null, 1),
)

// ── 5 · Escribir, sólo con --aplicar ───────────────────────────────────────
const sinAuxiliares = (fila) => Object.fromEntries(Object.entries(fila).filter(([k]) => !k.startsWith('_')))

/** Inserta sólo las claves que todavía no están: la segunda corrida inserta 0. */
async function insertarFaltantes(tabla, filas, clave) {
  if (filas.length === 0) return { insertadas: 0, existentes: 0 }
  const existentes = new Set(
    (await traerTodo(tabla, `${clave}`)).map((f) => String(f[clave])),
  )
  const nuevas = filas.filter((f) => !existentes.has(String(f[clave])))
  if (nuevas.length === 0) return { insertadas: 0, existentes: filas.length }
  for (let i = 0; i < nuevas.length; i += 200) {
    const lote = nuevas.slice(i, i + 200).map(sinAuxiliares)
    const { error } = await sb.from(tabla).insert(lote)
    if (error) throw new Error(`${tabla}: ${error.message}`)
  }
  return { insertadas: nuevas.length, existentes: filas.length - nuevas.length }
}

if (!APLICAR) {
  console.log('\n' + '─'.repeat(74))
  console.log('  DRY RUN — no se escribió nada')
  console.log('─'.repeat(74))
  console.log(`  WOULD_INSERT_CHAINS  = ${filasCadenas.length}`)
  console.log(`  WOULD_INSERT_DOCS    = ${filasDocumentos.length}`)
  console.log(`  WOULD_INSERT_HISTORY = ${filasServicios.length}`)
  console.log(`  WOULD_INSERT_LINES   = ${filasLineas.length}`)
  console.log(`  EXCLUDED             = ${excluidos.length}`)
  console.log('  MAINTENANCE_ORDERS_TOUCHED = 0 · STOCK_TOUCHED = 0 · STEL_WRITES = 0')
  console.log(`  informe: ${path.relative(process.cwd(), SALIDA)}\n`)
  process.exit(0)
}

console.log('\n4 · Escribiendo…')
const rc = await insertarFaltantes(TABLAS.cadenas, filasCadenas, 'external_id')
console.log(`    cadenas: ${rc.insertadas} nuevas · ${rc.existentes} ya estaban`)

// Los hijos necesitan el id que generó la base, y se lo piden por la clave externa.
const idDeCadena = new Map((await traerTodo(TABLAS.cadenas, 'id, external_id')).map((f) => [f.external_id, f.id]))
const rd = await insertarFaltantes(
  TABLAS.documentos,
  filasDocumentos.map((f) => ({ ...f, chain_id: idDeCadena.get(f._cadena) })),
  'external_id',
)
console.log(`    documentos: ${rd.insertadas} nuevos · ${rd.existentes} ya estaban`)

const rs = await insertarFaltantes(
  TABLAS.servicios,
  filasServicios.map((f) => ({ ...f, chain_id: idDeCadena.get(f._cadena) })),
  'external_id',
)
console.log(`    servicios: ${rs.insertadas} nuevos · ${rs.existentes} ya estaban`)

const idDeDocumento = new Map((await traerTodo(TABLAS.documentos, 'id, external_id')).map((f) => [f.external_id, f.id]))
const yaHayLineas = new Set(
  (await traerTodo(TABLAS.lineas, 'source_document_id, external_id')).map((f) => `${f.source_document_id}|${f.external_id}`),
)
const lineasNuevas = filasLineas
  .map((f) => ({ ...f, source_document_id: idDeDocumento.get(f._documento) }))
  .filter((f) => f.source_document_id && !yaHayLineas.has(`${f.source_document_id}|${f.external_id}`))
for (let i = 0; i < lineasNuevas.length; i += 200) {
  const { error } = await sb.from(TABLAS.lineas).insert(lineasNuevas.slice(i, i + 200).map(sinAuxiliares))
  if (error) throw new Error(`${TABLAS.lineas}: ${error.message}`)
}
console.log(`    líneas: ${lineasNuevas.length} nuevas · ${filasLineas.length - lineasNuevas.length} ya estaban`)
console.log('\n  escrituras en STEL: 0 · maintenance_orders: 0 · stock: 0\n')
