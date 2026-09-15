/**
 * Fase 14 · Entrega 2 — reconciliación productiva controlada STEL → React (Buscatools).
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *
 *   node scripts/fase14-stel-e2-reconciliacion.mjs dryrun
 *       A snapshot (huella) · B STEL leído AHORA (sin cache previa) · plan · Gate 1.
 *       No escribe nada. Deja en scripts/output/e2/ (ignorado): plan, huella,
 *       respaldo de las filas afectadas y el reporte del gate.
 *
 *   node scripts/fase14-stel-e2-reconciliacion.mjs aplicar --plan-hash <sha256> --autorizo-reconciliacion-productiva [--aprobar-borrados <json>]
 *       SÓLO con autorización explícita del usuario. Vuelve a leer STEL, rearma el
 *       plan y si el hash no es EXACTAMENTE el autorizado, se detiene sin escribir.
 *       Después: verifica stock, secuencias y autoridad (idénticos) y que un
 *       segundo plan dé 0 acciones.
 *
 *   node scripts/fase14-stel-e2-reconciliacion.mjs revertir --run <uuid> --autorizo-reversion
 *
 * La clave de STEL sale de .env.stel.local y nunca se imprime. Cupo de la API
 * compartido con Make: el dryrun usa ~25 llamadas.
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { leerReactEmpresa, leerStel } from './fase14-stel-api-auditoria.mjs'
import { crearCliente, limpiar } from './lib/stel-api.mjs'
import { CATEGORIA_REVISION, ejecutarPlan, hashPlan, huellaEmpresa, planificarE2, respaldoAfectado, revertirRun } from './lib/stel-reconciliacion.mjs'

const [, , comando] = process.argv
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null }
const bandera = (n) => process.argv.includes(n)
const SALIDA = path.resolve('scripts/output/e2')
const EMPRESA = 'buscatools'
const E1_SNAPSHOT = path.resolve('scripts/output/fase14-stel-snapshot.json')

const BASE = process.env.VITE_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !SECRET) { console.error('✗ Faltan VITE_SUPABASE_URL / SUPABASE_SECRET_KEY'); process.exit(1) }
const sb = createClient(BASE, SECRET, { auth: { persistSession: false } })
const guardar = (nombre, datos) => { fs.mkdirSync(SALIDA, { recursive: true }); const f = path.join(SALIDA, nombre); fs.writeFileSync(f, JSON.stringify(datos, null, 1)); return path.relative(process.cwd(), f) }

/** STEL leído ahora, con cache temporal propia de esta corrida (borrada al final). */
async function leerStelAhora(maxLlamadas) {
  const cacheDir = path.resolve(`.stel-cache/e2-${Date.now()}`)
  const c = crearCliente({ maxLlamadas, usarCache: true, cacheDir, log: () => {} })
  try {
    const stel = await leerStel(c, { conMaestro: false, loteReferencias: 80 })
    return { stel, llamadas: c.llamadas() }
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true })
  }
}

/** Qué cambió en STEL desde el snapshot de E1. */
function cambiosDesdeE1(stel) {
  if (!fs.existsSync(E1_SNAPSHOT)) return { sinSnapshotE1: true }
  const e1 = JSON.parse(fs.readFileSync(E1_SNAPSHOT, 'utf8')).stel
  const out = {}
  for (const t of ['quote', 'order', 'delivery']) {
    const antes = new Map(e1.docs[t].map((d) => [d.id, d]))
    const ahora = stel.docs[t]
    out[t] = {
      e1: e1.docs[t].length,
      ahora: ahora.length,
      nuevos: ahora.filter((d) => !antes.has(d.id)).map((d) => d['full-reference']),
      modificados: ahora.filter((d) => antes.has(d.id) && antes.get(d.id)['utc-last-modification-date'] !== d['utc-last-modification-date']).map((d) => d['full-reference']),
      yaNoEstan: e1.docs[t].filter((d) => !ahora.some((x) => x.id === d.id)).map((d) => d['full-reference']),
    }
  }
  const idsE1 = new Set(e1.productos.map((p) => p.id))
  out.productosUsadosNuevos = stel.productos.filter((p) => !idsE1.has(p.id)).map((p) => p['full-reference'])
  return out
}

async function armarPlan(stel, aprobados) {
  const react = await leerReactEmpresa(sb, EMPRESA)
  const { data: cat } = await sb.from('product_categories').select('id, needs_review').eq('company_id', react.BT).eq('slug', CATEGORIA_REVISION.slug).maybeSingle()
  if (cat && cat.needs_review !== true) throw new Error('existe una categoría con el slug de revisión que no está marcada como revisión: se detiene')
  const { data: listas } = await sb.from('price_lists').select('id, name, currency_code, is_default').eq('company_id', react.BT)
  const base = (listas ?? []).filter((l) => l.is_default)
  if (base.length !== 1) throw new Error('la empresa no tiene exactamente una lista de precios por defecto')
  const { plan, reco } = planificarE2(stel, react, { categoriaRevisionId: cat?.id ?? null, listaBaseId: base[0].id, aprobados })
  return { plan, reco, react, listaBase: base[0] }
}

function reporteGate(plan, reco, extra) {
  const r = plan.resumen
  return {
    generado: new Date().toISOString(),
    stelLeidoEn: plan.stelLeidoEn,
    planHash: hashPlan(plan),
    ...extra,
    GATE_1: {
      PRODUCTS_TO_CREATE: r.PRODUCTS_TO_CREATE, PRODUCTS_TO_CREATE_SERVICES: r.PRODUCTS_TO_CREATE_SERVICES, PRODUCTS_TO_LINK: r.PRODUCTS_TO_LINK, PRODUCTS_BLOCKED: r.PRODUCTS_BLOCKED,
      CATEGORY_TO_CREATE: r.CATEGORY_TO_CREATE,
      DOCUMENTS_TO_INSERT: r.DOCUMENTS_TO_INSERT, DOCUMENTS_TO_INSERT_BY_TYPE: r.DOCUMENTS_TO_INSERT_BY_TYPE, DOCUMENTS_TO_UPDATE: r.DOCUMENTS_TO_UPDATE,
      HEADER_FIELD_CHANGES: r.HEADER_FIELD_CHANGES, EXTERNAL_ID_LINKS: r.EXTERNAL_ID_LINKS,
      LINES_TO_INSERT: r.LINES_TO_INSERT, LINES_TO_INSERT_IN_NEW_DOCS: r.LINES_TO_INSERT_IN_NEW_DOCS, LINES_TO_UPDATE: r.LINES_TO_UPDATE, LINE_FIELD_CHANGES: r.LINE_FIELD_CHANGES, LINE_PRODUCT_LINKS: r.LINE_PRODUCT_LINKS,
      LINES_TO_DELETE_PENDING_APPROVAL: r.LINES_TO_DELETE_PENDING_APPROVAL,
      CURRENCY_FIXES: r.CURRENCY_FIXES, TOTAL_FIELD_FIXES: r.TOTAL_FIELD_FIXES, STATUS_FIXES: r.STATUS_FIXES,
      RELATION_FIXES: r.RELATION_FIXES, QUOTE_DIRECT_DELIVERIES: r.QUOTE_DIRECT_DELIVERIES,
      BLOCKED: r.BLOCKED, BLOCKED_BY_REASON: r.BLOCKED_BY_REASON,
    },
    auditoriaActual: reco.resumen,
    bloqueados: plan.bloqueados,
    pendientesBorrado: plan.pendientesBorrado,
    info: plan.info,
  }
}

async function dryrun() {
  console.log('═'.repeat(74))
  console.log('  FASE 14 · E2 — DRY RUN FINAL (no escribe)')
  console.log('═'.repeat(74))
  const react0 = await leerReactEmpresa(sb, EMPRESA)
  console.log('  A · snapshot de React…')
  const huella = await huellaEmpresa(sb, react0.BT)
  console.log('  B · STEL leído ahora…')
  const { stel, llamadas } = await leerStelAhora(Number(arg('--max-llamadas') ?? 60))
  const cambios = cambiosDesdeE1(stel)
  const { plan, reco, listaBase } = await armarPlan(stel, { borrados: [] })
  const respaldo = await respaldoAfectado(sb, plan)
  const hash = hashPlan(plan)
  const corto = hash.slice(0, 12)
  const archivos = {
    plan: guardar(`plan-${corto}.json`, plan),
    huella: guardar(`huella-antes-${corto}.json`, { generado: new Date().toISOString(), huella }),
    respaldo: guardar(`respaldo-${corto}.json`, { generado: new Date().toISOString(), filas: respaldo }),
  }
  const reporte = reporteGate(plan, reco, { llamadasStel: llamadas, cambiosDesdeE1: cambios, listaBase: { nombre: listaBase.name, moneda: listaBase.currency_code }, archivos })
  archivos.reporte = guardar(`gate1-${corto}.json`, reporte)
  console.log(`  llamadas a STEL: ${llamadas}`)
  console.log('  STEL ahora:', Object.fromEntries(['quote', 'order', 'delivery'].map((t) => [t, stel.docs[t].length])))
  console.log('  cambios desde E1:', JSON.stringify(Object.fromEntries(Object.entries(cambios).map(([k, v]) => [k, Array.isArray(v) ? v.length : { nuevos: v.nuevos?.length, modificados: v.modificados?.length, yaNoEstan: v.yaNoEstan?.length }]))))
  console.log('\n  GATE 1')
  console.log(reporte.GATE_1)
  console.log(`\n  PLAN HASH: ${hash}`)
  console.log('  archivos (ignorados por git):', archivos)
}

async function aplicar() {
  const autorizado = arg('--plan-hash')
  if (!bandera('--autorizo-reconciliacion-productiva') || !/^[0-9a-f]{64}$/.test(autorizado ?? '')) {
    console.error('✗ Falta la autorización explícita: --plan-hash <sha256 del dry run aprobado> --autorizo-reconciliacion-productiva')
    process.exit(2)
  }
  const aprobados = arg('--aprobar-borrados') ? { borrados: JSON.parse(fs.readFileSync(arg('--aprobar-borrados'), 'utf8')) } : { borrados: [] }
  const { stel } = await leerStelAhora(Number(arg('--max-llamadas') ?? 60))
  const { plan, react } = await armarPlan(stel, aprobados)
  const hash = hashPlan(plan)
  if (hash !== autorizado) {
    guardar(`plan-rechazado-${hash.slice(0, 12)}.json`, plan)
    console.error(`✗ STEL o React cambiaron desde el dry run autorizado: el plan de ahora (${hash.slice(0, 12)}…) no es el aprobado (${autorizado.slice(0, 12)}…). No se escribió nada; correr dryrun y volver a pedir autorización.`)
    process.exit(3)
  }
  const huellaAntes = await huellaEmpresa(sb, react.BT)
  guardar(`respaldo-aplicar-${hash.slice(0, 12)}.json`, { generado: new Date().toISOString(), huella: huellaAntes, filas: await respaldoAfectado(sb, plan) })
  const hechos = await ejecutarPlan(sb, plan, { autorizacion: { planHash: autorizado, confirmado: true }, log: (m) => console.log(m) })
  const huellaDespues = await huellaEmpresa(sb, react.BT)
  const invariantes = ['document_sequences', 'document_numbering_authority', 'stock_balances', 'stock_movements', 'stock_reservations', 'sales_audit']
  const rotos = invariantes.filter((t) => huellaAntes[t].hash !== huellaDespues[t].hash)
  const segundo = (await armarPlan(stel, aprobados)).plan
  const informe = { run: hechos.run, hechos, invariantesRotos: rotos, segundaCorrida: { productos: segundo.productos.length, documentos: segundo.documentos.length, pendientesBorrado: segundo.pendientesBorrado.length, bloqueados: segundo.bloqueados.length } }
  console.log(informe)
  guardar(`aplicado-${hechos.run}.json`, informe)
  if (rotos.length || hechos.fallidos.length) process.exit(4)
}

async function revertir() {
  const run = arg('--run')
  if (!bandera('--autorizo-reversion') || !/^[0-9a-f-]{36}$/.test(run ?? '')) {
    console.error('✗ Falta --run <uuid> --autorizo-reversion')
    process.exit(2)
  }
  const n = await revertirRun(sb, run)
  console.log(`  revertidas ${n} entradas del run ${run}`)
}

const acciones = { dryrun, aplicar, revertir }
if (!acciones[comando]) { console.error('uso: dryrun | aplicar --plan-hash H --autorizo-reconciliacion-productiva | revertir --run ID --autorizo-reversion'); process.exit(1) }
acciones[comando]().catch((e) => { console.error('✗', limpiar(e.message)); process.exit(1) })
