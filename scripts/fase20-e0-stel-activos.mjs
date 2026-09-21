/**
 * Fase 20 · E0 — ¿De dónde salen los activos de Mantenimiento?
 *
 * SÓLO LECTURA en los dos lados:
 *   · STEL: únicamente GET (`scripts/lib/stel-api.mjs` no tiene otro método);
 *   · React: únicamente SELECT con la clave de servicio.
 *
 * NO escribe nada, en ningún lado. Es el DRY RUN de la importación: dice qué
 * pasaría, con números, y no pasa nada.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase20-e0-stel-activos.mjs [--max-llamadas 40] [--sin-cache]
 *
 * La clave de STEL se lee de `.env.stel.local` y nunca se imprime.
 * El detalle con nombres va a `scripts/output/` (ignorado por git); por
 * consola sale sólo el resumen, sin razones sociales ni series completas.
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { crearCliente, limpiar } from './lib/stel-api.mjs'

const arg = (n, def) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : def }
const MAX_LLAMADAS = Number(arg('--max-llamadas', '40'))
const USAR_CACHE = !process.argv.includes('--sin-cache')
const SALIDA_DIR = path.resolve('scripts/output')
const SALIDA = path.join(SALIDA_DIR, 'fase20-e0-activos.json')

// ── Normalización, la misma que usa el resto de la migración ───────────────
const normCuit = (s) => (s ?? '').toString().replace(/\D/g, '') || null
const normSerie = (s) => (s ?? '').toString().toUpperCase().replace(/[\s-]/g, '') || null
const normTexto = (s) => (s ?? '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const claseDe = (path) => (path ?? '').includes('/potentialClients/') ? 'potentialClients'
  : (path ?? '').includes('/clients/') ? 'clients' : null

async function traerTodo(sb, tabla, columnas) {
  const filas = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb.from(tabla).select(columnas).range(desde, desde + 999)
    if (error) throw new Error(`${tabla}: ${error.message}`)
    filas.push(...data)
    if (data.length < 1000) return filas
  }
}

const c = crearCliente({ maxLlamadas: MAX_LLAMADAS, usarCache: USAR_CACHE })

console.log('═'.repeat(74))
console.log('  FASE 20 · E0 — ACTIVOS DE MANTENIMIENTO (SÓLO LECTURA, DRY RUN)')
console.log('═'.repeat(74))

// ── 1 · STEL ───────────────────────────────────────────────────────────────
console.log('\n1 · STEL Order (GET)')
const activos = await c.todos('assets', {}, { limite: 200, maxPaginas: 20 })
console.log(`  activos: ${activos.length}`)

// Las incidencias son el historial de servicio del legacy comercial.
let incidencias = []
try {
  incidencias = await c.todos('incidents', {}, { limite: 200, maxPaginas: 10 })
  console.log(`  incidencias: ${incidencias.length}`)
} catch (e) {
  console.log(`  incidencias: no se pudieron leer (${limpiar(e.message)})`)
}

let ordenesTrabajo = []
try {
  ordenesTrabajo = await c.todos('workOrders', {}, { limite: 200, maxPaginas: 10 })
  console.log(`  órdenes de trabajo: ${ordenesTrabajo.length}`)
} catch (e) {
  console.log(`  órdenes de trabajo: no se pudieron leer (${limpiar(e.message)})`)
}

// Los clientes de STEL, para resolver `account-id` → CUIT/referencia.
const clientesStel = await c.todos('clients', {}, { limite: 200, maxPaginas: 20 })
console.log(`  clientes: ${clientesStel.length}`)

// ── 2 · React ──────────────────────────────────────────────────────────────
console.log('\n2 · React (SELECT)')
const BASE = process.env.VITE_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !SECRET) throw new Error('Faltan VITE_SUPABASE_URL y SUPABASE_SECRET_KEY')
const sb = createClient(BASE, SECRET, { auth: { persistSession: false } })

const clientes = await traerTodo(sb, 'customers', 'id, legal_name, trade_name, legacy_name, tax_id, legacy_ref, deleted_at')
const productos = await traerTodo(sb, 'products', 'id, sku, name, brand_id, status, deleted_at')
const { count: activosReact } = await sb.from('maintenance_assets').select('id', { count: 'exact', head: true })
console.log(`  clientes: ${clientes.length} · productos: ${productos.length} · activos ya cargados: ${activosReact}`)

// ── 3 · Índices de emparejamiento ──────────────────────────────────────────
const clienteStelPorId = new Map(clientesStel.map((x) => [x.id, x]))

const porCuit = new Map()
const porRef = new Map()
const porNombre = new Map()
for (const cl of clientes) {
  if (cl.deleted_at) continue
  const cuit = normCuit(cl.tax_id)
  if (cuit) porCuit.set(cuit, [...(porCuit.get(cuit) ?? []), cl])
  if (cl.legacy_ref) porRef.set(cl.legacy_ref.trim().toUpperCase(), [...(porRef.get(cl.legacy_ref.trim().toUpperCase()) ?? []), cl])
  for (const n of new Set([cl.legal_name, cl.trade_name, cl.legacy_name].map(normTexto).filter(Boolean))) {
    porNombre.set(n, [...(porNombre.get(n) ?? []), cl])
  }
}

const prodPorSku = new Map()
const prodPorNombre = new Map()
for (const p of productos) {
  if (p.deleted_at) continue
  if (p.sku) prodPorSku.set(p.sku.trim().toUpperCase(), [...(prodPorSku.get(p.sku.trim().toUpperCase()) ?? []), p])
  const n = normTexto(p.name)
  if (n) prodPorNombre.set(n, [...(prodPorNombre.get(n) ?? []), p])
}

// ── 4 · El dry run ─────────────────────────────────────────────────────────
const incidenciasPorActivo = new Map()
for (const i of incidencias) {
  for (const a of i.assets ?? []) {
    incidenciasPorActivo.set(a.id, (incidenciasPorActivo.get(a.id) ?? 0) + 1)
  }
}

const porSerie = new Map()
for (const a of activos) {
  const s = normSerie(a['serial-number'])
  if (s) porSerie.set(s, [...(porSerie.get(s) ?? []), a])
}

const filas = activos.map((a) => {
  const clase = claseDe(a['account-path'])
  const cl = clase === 'clients' ? clienteStelPorId.get(a['account-id']) : null

  // Cliente: CUIT primero, después la referencia legacy, y nunca por nombre.
  let cliente = null
  let via = null
  let ambiguo = false
  if (cl) {
    const cuit = normCuit(cl['tax-identification-number'])
    const candidatosCuit = cuit ? (porCuit.get(cuit) ?? []) : []
    const ref = (cl['full-reference'] ?? '').trim().toUpperCase()
    const candidatosRef = ref ? (porRef.get(ref) ?? []) : []
    if (candidatosCuit.length === 1) { cliente = candidatosCuit[0]; via = 'cuit' }
    else if (candidatosCuit.length > 1) { ambiguo = true; via = 'cuit-ambiguo' }
    else if (candidatosRef.length === 1) { cliente = candidatosRef[0]; via = 'legacy_ref' }
    else if (candidatosRef.length > 1) { ambiguo = true; via = 'ref-ambigua' }
    else {
      // Sólo se REPORTA la coincidencia por nombre; no se usa para importar.
      const n = normTexto(cl['legal-name'] ?? cl.name)
      via = (porNombre.get(n) ?? []).length === 1 ? 'sólo-por-nombre' : null
    }
  }

  // Modelo: SKU exacto, después nombre exacto. Nunca aproximado.
  const modelo = (a.model ?? '').trim()
  const porSku = modelo ? (prodPorSku.get(modelo.toUpperCase()) ?? []) : []
  const porNom = modelo ? (prodPorNombre.get(normTexto(modelo)) ?? []) : []
  const producto = porSku.length === 1 ? porSku[0] : porNom.length === 1 ? porNom[0] : null
  const modeloAmbiguo = porSku.length > 1 || (porSku.length === 0 && porNom.length > 1)

  const serie = normSerie(a['serial-number'])
  return {
    stelId: a.id,
    referencia: a['full-reference'],
    nombre: a.name,
    identificador: a.identifier,
    marca: a.brand,
    modelo: modelo || null,
    serie: a['serial-number'],
    serieDuplicada: serie ? (porSerie.get(serie) ?? []).length > 1 : false,
    borradoEnStel: a.deleted === true,
    bajoMantenimiento: a['subject-to-maintenance'] === true,
    garantiaDesde: a['warranty-start-date'] ?? null,
    garantiaHasta: a['warranty-end-date'] ?? null,
    cuenta: { id: a['account-id'], clase },
    clienteReact: cliente?.id ?? null,
    clienteVia: via,
    clienteAmbiguo: ambiguo,
    productoReact: producto?.id ?? null,
    modeloAmbiguo,
    incidencias: incidenciasPorActivo.get(a.id) ?? 0,
    ultimaModificacion: a['utc-last-modification-date'] ?? null,
  }
})

const cuenta = (p) => filas.filter(p).length
const resumen = {
  STEL_ASSETS_FOUND: filas.length,
  BORRADOS_EN_STEL: cuenta((f) => f.borradoEnStel),
  VIVOS: cuenta((f) => !f.borradoEnStel),
  MATCHED_CUSTOMERS: cuenta((f) => f.clienteReact !== null),
  MATCHED_POR_CUIT: cuenta((f) => f.clienteVia === 'cuit'),
  MATCHED_POR_REF: cuenta((f) => f.clienteVia === 'legacy_ref'),
  UNMATCHED_CUSTOMERS: cuenta((f) => f.clienteReact === null),
  SOLO_POR_NOMBRE: cuenta((f) => f.clienteVia === 'sólo-por-nombre'),
  CUENTA_ES_POTENCIAL: cuenta((f) => f.cuenta.clase === 'potentialClients'),
  SIN_CUENTA: cuenta((f) => f.cuenta.id === null || f.cuenta.id === undefined),
  MATCHED_MODELS: cuenta((f) => f.productoReact !== null),
  UNMATCHED_MODELS: cuenta((f) => f.productoReact === null && f.modelo !== null),
  SIN_MODELO: cuenta((f) => f.modelo === null),
  MODELOS_DISTINTOS: new Set(filas.map((f) => f.modelo).filter(Boolean)).size,
  MARCAS_DISTINTAS: new Set(filas.map((f) => f.marca).filter(Boolean)).size,
  MISSING_SERIAL: cuenta((f) => !normSerie(f.serie)),
  DUPLICATE_SERIALS: cuenta((f) => f.serieDuplicada),
  AMBIGUOUS: cuenta((f) => f.clienteAmbiguo || f.modeloAmbiguo),
  CON_INCIDENCIAS: cuenta((f) => f.incidencias > 0),
  INCIDENCIAS_TOTALES: incidencias.length,
  ORDENES_DE_TRABAJO: ordenesTrabajo.length,
  ACTIVOS_YA_EN_REACT: activosReact,
}

console.log('\n3 · Dry run — qué pasaría si se importara hoy')
for (const [k, v] of Object.entries(resumen)) console.log(`  ${k.padEnd(24)} ${v}`)

// Con la tabla vacía, todo sería alta. Si algún día no lo está, esto cambia.
console.log('\n  WOULD_INSERT             ' + cuenta((f) => !f.borradoEnStel))
console.log('  WOULD_UPDATE             0  (no hay activos previos que actualizar)')
console.log('  WOULD_SKIP               ' + cuenta((f) => f.borradoEnStel) + '  (borrados en STEL)')

fs.mkdirSync(SALIDA_DIR, { recursive: true })
fs.writeFileSync(SALIDA, JSON.stringify({ resumen, filas, llamadas: c.llamadas() }, null, 2))
console.log(`\n  detalle → ${path.relative(process.cwd(), SALIDA)} (ignorado por git)`)
console.log(`  llamadas a STEL: ${c.llamadas()} · escrituras: 0`)
