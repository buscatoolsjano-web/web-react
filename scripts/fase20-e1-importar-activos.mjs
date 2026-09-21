/**
 * Fase 20 · E1 — Importación controlada de los activos de STEL.
 *
 * STEL: **sólo GET** (`scripts/lib/stel-api.mjs` no tiene otro método).
 * React: SELECT siempre; INSERT en `maintenance_assets` **sólo con
 * `--aplicar`**, y sólo en esa tabla.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase20-e1-importar-activos.mjs            # dry run
 *   node scripts/fase20-e1-importar-activos.mjs --aplicar  # inserta
 *
 * Es **idempotente**: la identidad es `(company_id, 'stel', assets.id)` y la
 * segunda corrida inserta 0. La referencia `ACTxxxxx` NO es la clave: si STEL
 * renumerara, se duplicarían los activos sin que nadie se entere.
 *
 * Reglas que no se negocian, y que el script verifica antes de escribir:
 *   · el emparejamiento de clientes es por CUIT o por `legacy_ref`, **nunca
 *     por nombre**, y si los números cambian respecto de la auditoría, no
 *     inserta nada;
 *   · los activos sin cliente entran igual, con `owner_customer_id` nulo;
 *   · los que no tienen serie, o la repiten, entran igual: la identidad es el
 *     id de STEL;
 *   · el modelo y la marca entran **tal cual vienen**. No se normaliza, no se
 *     fusiona y no se crean marcas nuevas.
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { crearCliente } from './lib/stel-api.mjs'
import { aFilaDeActivo, claseDe, elegirCliente, fecha, limpio, normSerie } from './lib/fase20-mapeo.mjs'

const APLICAR = process.argv.includes('--aplicar')
const SALIDA_DIR = path.resolve('scripts/output')
const SALIDA = path.join(SALIDA_DIR, 'fase20-e1-import.json')

/** Lo que la auditoría E0 midió. Si hoy no da lo mismo, algo cambió: STOP. */
const ESPERADO = { activos: 358, conCliente: 356, sinCliente: 2, ambiguos: 0 }

/**
 * Las reglas que deciden a qué cliente va un equipo y qué se guarda de cada
 * campo viven en `lib/fase20-mapeo.mjs` y se prueban con fixtures en
 * `fase20-e1-import-tests.mjs`. Acá queda la orquestación: leer, verificar,
 * escribir.
 */
const normCuit = (s) => (s ?? '').toString().replace(/\D/g, '') || null

async function traerTodo(sb, tabla, columnas) {
  const filas = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb.from(tabla).select(columnas).range(desde, desde + 999)
    if (error) throw new Error(`${tabla}: ${error.message}`)
    filas.push(...data)
    if (data.length < 1000) return filas
  }
}

const c = crearCliente({ maxLlamadas: 40, usarCache: !process.argv.includes('--sin-cache') })

console.log('═'.repeat(74))
console.log(`  FASE 20 · E1 — IMPORTAR ACTIVOS DE STEL ${APLICAR ? '(APLICA)' : '(DRY RUN)'}`)
console.log('═'.repeat(74))

// ── 1 · STEL (GET) ─────────────────────────────────────────────────────────
const activos = await c.todos('assets', {}, { limite: 200, maxPaginas: 20 })
const clientesStel = await c.todos('clients', {}, { limite: 200, maxPaginas: 20 })
const direcciones = await c.todos('addresses', {}, { limite: 200, maxPaginas: 30 })
console.log(`\n1 · STEL: ${activos.length} activos · ${clientesStel.length} clientes · ${direcciones.length} direcciones`)

// ── 2 · React (SELECT) ─────────────────────────────────────────────────────
const BASE = process.env.VITE_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !SECRET) throw new Error('Faltan VITE_SUPABASE_URL y SUPABASE_SECRET_KEY')
const sb = createClient(BASE, SECRET, { auth: { persistSession: false } })

const clientes = await traerTodo(sb, 'customers', 'id, company_id, legal_name, tax_id, legacy_ref, deleted_at')
const marcas = await traerTodo(sb, 'brands', 'id, company_id, name')
const yaImportados = await traerTodo(sb, 'maintenance_assets', 'id, company_id, reference, external_source, external_id')
console.log(`2 · React: ${clientes.length} clientes · ${marcas.length} marcas · ${yaImportados.length} activos ya cargados`)

// ── 3 · Emparejamiento ─────────────────────────────────────────────────────
const clienteStelPorId = new Map(clientesStel.map((x) => [x.id, x]))
const direccionPorId = new Map(direcciones.map((d) => [d.id, d]))

const porCuit = new Map()
const porRef = new Map()
for (const cl of clientes) {
  if (cl.deleted_at) continue
  const cuit = normCuit(cl.tax_id)
  if (cuit) porCuit.set(cuit, [...(porCuit.get(cuit) ?? []), cl])
  const ref = (cl.legacy_ref ?? '').trim().toUpperCase()
  if (ref) porRef.set(ref, [...(porRef.get(ref) ?? []), cl])
}

const filas = activos.map((a) => {
  const cl = claseDe(a['account-path']) === 'clients' ? clienteStelPorId.get(a['account-id']) : null
  const { cliente, via, ambiguo } = elegirCliente(cl, { porCuit, porRef })
  const dir = direccionPorId.get(a['address-id'])
  return { stel: a, cliente, via, ambiguo, dir }
})

const conCliente = filas.filter((f) => f.cliente).length
const sinCliente = filas.filter((f) => !f.cliente).length
const ambiguos = filas.filter((f) => f.ambiguo).length
console.log(`3 · Emparejamiento: ${conCliente} con cliente · ${sinCliente} sin cliente · ${ambiguos} ambiguos`)
console.log(`   por CUIT: ${filas.filter((f) => f.via === 'cuit').length} · por legacy_ref: ${filas.filter((f) => f.via === 'legacy_ref').length}`)

// ── 4 · Los portones ───────────────────────────────────────────────────────
const problemas = []
if (activos.length !== ESPERADO.activos) problemas.push(`STEL devolvió ${activos.length} activos y la auditoría contó ${ESPERADO.activos}`)
if (conCliente !== ESPERADO.conCliente) problemas.push(`clientes emparejados: ${conCliente} ≠ ${ESPERADO.conCliente}`)
if (sinCliente !== ESPERADO.sinCliente) problemas.push(`activos sin cliente: ${sinCliente} ≠ ${ESPERADO.sinCliente}`)
if (ambiguos !== ESPERADO.ambiguos) problemas.push(`ambiguos: ${ambiguos} ≠ ${ESPERADO.ambiguos}`)

const empresas = new Set(filas.map((f) => f.cliente?.company_id).filter(Boolean))
if (empresas.size !== 1) problemas.push(`los clientes emparejados son de ${empresas.size} empresas distintas`)
const COMPANY = [...empresas][0]

if (problemas.length > 0) {
  console.log('\n✖ STOP — los números no son los auditados:')
  for (const p of problemas) console.log(`   · ${p}`)
  process.exit(1)
}
console.log(`4 · Portones: OK · empresa ${COMPANY}`)

// ── 5 · Las filas a insertar ───────────────────────────────────────────────
const marcaPorNombre = new Map(
  marcas.filter((m) => m.company_id === COMPANY).map((m) => [m.name.trim().toUpperCase(), m.id]),
)
const yaPorExterno = new Map(
  yaImportados.filter((x) => x.external_id).map((x) => [`${x.external_source}:${x.external_id}`, x]),
)
const yaPorReferencia = new Map(yaImportados.map((x) => [x.reference, x]))

const ahora = new Date().toISOString()
const aInsertar = []
const saltados = []

for (const f of filas) {
  const a = f.stel
  const clave = `stel:${a.id}`
  if (yaPorExterno.has(clave)) { saltados.push({ ref: a['full-reference'], motivo: 'ya importado' }); continue }

  const referencia = limpio(a['full-reference']) ?? `ACT-STEL-${a.id}`
  const previo = yaPorReferencia.get(referencia)
  if (previo) {
    // Misma referencia, otro origen: no se pisa nada y se reporta.
    saltados.push({ ref: referencia, motivo: 'la referencia ya existe con otro origen' })
    continue
  }

  aInsertar.push(
    aFilaDeActivo(a, {
      companyId: COMPANY,
      cliente: f.cliente,
      direccion: f.dir,
      marcaPorNombre,
      ahora,
    }),
  )
}

// La garantía con el CHECK en contra ya se resolvió fila por fila (arriba):
// se importa sin garantía y el valor original queda en las notas. Acá sólo se
// cuenta, para que el número salga en el informe y no pase inadvertido.
const garantiasTorcidas = filas.filter((f) => {
  const d = fecha(f.stel['warranty-start-date'])
  const h = fecha(f.stel['warranty-end-date'])
  return d && h && h < d
})

const series = new Map()
for (const r of aInsertar) { const s = normSerie(r.serial_number); if (s) series.set(s, (series.get(s) ?? 0) + 1) }
const resumen = {
  WOULD_INSERT: aInsertar.length,
  WOULD_SKIP: saltados.length,
  CON_CLIENTE: aInsertar.filter((r) => r.owner_customer_id).length,
  SIN_CLIENTE: aInsertar.filter((r) => !r.owner_customer_id).length,
  SIN_SERIE: aInsertar.filter((r) => !normSerie(r.serial_number)).length,
  SERIES_DUPLICADAS_ACTIVOS: aInsertar.filter((r) => { const s = normSerie(r.serial_number); return s && series.get(s) > 1 }).length,
  SERIES_DUPLICADAS_GRUPOS: [...series.values()].filter((n) => n > 1).length,
  MARCAS_TEXTO: new Set(aInsertar.map((r) => r.brand_text).filter(Boolean)).size,
  MARCAS_ENLAZADAS: aInsertar.filter((r) => r.brand_id).length,
  MODELOS_TEXTO: new Set(aInsertar.map((r) => r.model_text).filter(Boolean)).size,
  CON_CIUDAD: aInsertar.filter((r) => r.city).length,
  CON_GARANTIA: aInsertar.filter((r) => r.warranty_start || r.warranty_end).length,
  GARANTIA_INCOHERENTE_EN_STEL: garantiasTorcidas.length,
  BAJO_CONTRATO: aInsertar.filter((r) => r.under_contract).length,
}
console.log('\n5 · Qué se insertaría')
for (const [k, v] of Object.entries(resumen)) console.log(`   ${k.padEnd(26)} ${v}`)

fs.mkdirSync(SALIDA_DIR, { recursive: true })
fs.writeFileSync(SALIDA, JSON.stringify({ resumen, saltados, filas: aInsertar }, null, 2))

// ── 6 · Escribir ───────────────────────────────────────────────────────────
if (!APLICAR) {
  console.log('\n   DRY RUN: no se escribió nada. Con `--aplicar` inserta.')
  console.log(`   llamadas a STEL: ${c.llamadas()} · escrituras en STEL: 0`)
  process.exit(0)
}

console.log('\n6 · Insertando…')
let insertados = 0
for (let i = 0; i < aInsertar.length; i += 100) {
  const lote = aInsertar.slice(i, i + 100)
  const { data, error } = await sb.from('maintenance_assets').insert(lote).select('id')
  if (error) throw new Error(`insert ${i}: ${error.message}`)
  insertados += data.length
  console.log(`   ${insertados}/${aInsertar.length}`)
}

const { count } = await sb.from('maintenance_assets').select('id', { count: 'exact', head: true })
console.log(`\n   insertados: ${insertados} · total en la tabla: ${count}`)
console.log(`   llamadas a STEL: ${c.llamadas()} · escrituras en STEL: 0`)
