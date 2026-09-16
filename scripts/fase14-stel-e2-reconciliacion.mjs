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
 *   node scripts/fase14-stel-e2-reconciliacion.mjs aplicar --plan-hash <sha256> --autorizo-reconciliacion-productiva [--excluir-documentos COTI1,COTI2] [--aprobar-borrados <json>]
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
import { CATEGORIA_REVISION, ejecutarPlan, hashPlan, huellaEmpresa, planificarE2, respaldoAfectado, resumirPlan, revertirRun } from './lib/stel-reconciliacion.mjs'

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
    // E4: la lectura de STEL de este dry run, para auditar excepciones sin volver a gastar cupo.
    stel: guardar(`stel-dryrun-${corto}.json`, { leidoEn: stel.leidoEn, stel }),
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
  const excluir = new Set((arg('--excluir-documentos') ?? '').split(',').map((x) => x.trim()).filter(Boolean))
  console.log('  GATE · STEL leído ahora…')
  const { stel, llamadas } = await leerStelAhora(Number(arg('--max-llamadas') ?? 80))
  const { plan: planCompleto, reco, react } = await armarPlan(stel, aprobados)
  const hash = hashPlan(planCompleto)
  console.log(`  llamadas a STEL: ${llamadas} · plan de ahora ${hash}`)
  if (hash !== autorizado) {
    const corto = hash.slice(0, 12)
    guardar(`plan-rechazado-${corto}.json`, planCompleto)
    guardar(`gate1-rechazado-${corto}.json`, reporteGate(planCompleto, reco, { cambiosDesdeE1: cambiosDesdeE1(stel), autorizado }))
    console.error(`✗ GATE: el plan de ahora (${corto}…) no es el autorizado (${autorizado.slice(0, 12)}…). No se escribió nada.`)
    console.error(JSON.stringify(planCompleto.resumen))
    process.exit(3)
  }
  console.log('  GATE OK: el plan de ahora es exactamente el autorizado')
  // Exclusión explícita del usuario: sólo quita acciones, nunca agrega.
  const plan = { ...planCompleto, documentos: planCompleto.documentos.filter((d) => !excluir.has(d.numero)) }
  const excluidos = planCompleto.documentos.filter((d) => excluir.has(d.numero))
  const faltan = [...excluir].filter((n) => !excluidos.some((d) => d.numero === n))
  if (faltan.length) { console.error(`✗ documentos a excluir que no están en el plan: ${faltan.join(', ')}`); process.exit(2) }
  const dependientes = plan.documentos.filter((d) => d.depende.some((k) => excluidos.some((e) => k === `${e.tipo}:${e.numero}`)))
  if (dependientes.length) { console.error(`✗ hay documentos que dependen de los excluidos: ${dependientes.map((d) => d.numero).join(', ')}`); process.exit(2) }
  plan.resumen = resumirPlan(plan)
  const hashEjecutado = hashPlan(plan)
  const corto = autorizado.slice(0, 12)
  guardar(`stel-aplicar-${corto}.json`, { leidoEn: stel.leidoEn, stel })
  const huellaAntes = await huellaEmpresa(sb, react.BT)
  const respaldo = await respaldoAfectado(sb, planCompleto)
  const archivoRespaldo = guardar(`respaldo-aplicar-${corto}.json`, { generado: new Date().toISOString(), planAutorizado: autorizado, planEjecutado: hashEjecutado, excluidos: [...excluir], huella: huellaAntes, filas: respaldo })
  const cuentaRespaldo = Object.fromEntries(Object.entries(respaldo).map(([t, f]) => [t, f.length]))
  console.log('  SNAPSHOT OK:', JSON.stringify(Object.fromEntries(Object.entries(huellaAntes).map(([t, v]) => [t, v.filas]))))
  console.log('  BACKUP OK:', archivoRespaldo, JSON.stringify(cuentaRespaldo))
  console.log('  ROLLBACK PREPARADO: public.stel_revertir_reconciliacion(run) desde la bitácora + respaldo local')
  console.log(`  EXCLUIDOS: ${[...excluir].join(', ') || 'ninguno'} · plan ejecutado ${hashEjecutado}`)
  const hechos = await ejecutarPlan(sb, plan, {
    autorizacion: { planHash: hashEjecutado, confirmado: true },
    alIniciar: (run) => { console.log(`  RECONCILIATION_RUN_ID: ${run}`); guardar(`run-en-curso-${corto}.json`, { run, planAutorizado: autorizado, planEjecutado: hashEjecutado, inicio: new Date().toISOString() }) },
    log: (m) => console.log(m),
  })
  const huellaDespues = await huellaEmpresa(sb, react.BT)
  const invariantes = ['document_sequences', 'document_numbering_authority', 'stock_balances', 'stock_movements', 'stock_reservations', 'sales_audit']
  const rotos = invariantes.filter((t) => huellaAntes[t].hash !== huellaDespues[t].hash)
  const segundo = (await armarPlan(stel, aprobados)).plan
  const informe = { run: hechos.run, planAutorizado: autorizado, planEjecutado: hashEjecutado, excluidos: [...excluir], resumenEjecutado: plan.resumen, hechos, invariantesRotos: rotos, huellaAntes, huellaDespues, segundaCorrida: { productos: segundo.productos.length, documentos: segundo.documentos.map((d) => d.numero), pendientesBorrado: segundo.pendientesBorrado.length, bloqueados: segundo.bloqueados.length } }
  console.log(JSON.stringify({ run: informe.run, planEjecutado: hashEjecutado, hechos: { productos: hechos.productos, documentos: hechos.documentos, cambios: hechos.cambios, fallidos: hechos.fallidos, salteados: hechos.salteados }, invariantesRotos: rotos, segundaCorrida: informe.segundaCorrida }, null, 1))
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

/**
 * Post-ejecución: documentos de STEL leídos AHORA (5 llamadas); clientes, ítems y
 * padres del gate de `aplicar` (minutos antes). Auditoría completa, segundo dry run
 * y comprobaciones puntuales contra el plan autorizado y el respaldo.
 */
async function verificar() {
  const autorizado = arg('--plan-hash')
  const corto = (autorizado ?? '').slice(0, 12)
  const archivoStel = path.join(SALIDA, `stel-aplicar-${corto}.json`)
  const archivoPlan = path.join(SALIDA, `plan-${corto}.json`)
  const archivoRespaldo = path.join(SALIDA, `respaldo-aplicar-${corto}.json`)
  for (const f of [archivoStel, archivoPlan, archivoRespaldo]) if (!fs.existsSync(f)) { console.error(`✗ falta ${path.relative(process.cwd(), f)}`); process.exit(2) }
  const { stel: stelGate } = JSON.parse(fs.readFileSync(archivoStel, 'utf8'))
  const planAutorizado = JSON.parse(fs.readFileSync(archivoPlan, 'utf8'))
  const respaldo = JSON.parse(fs.readFileSync(archivoRespaldo, 'utf8')).filas

  const cacheDir = path.resolve(`.stel-cache/e2-verificar-${Date.now()}`)
  const c = crearCliente({ maxLlamadas: 12, usarCache: true, cacheDir, log: () => {} })
  const docs = {}
  try {
    for (const [t, ruta] of [['quote', 'salesEstimates'], ['order', 'salesOrders'], ['delivery', 'salesDeliveryNotes']]) {
      const { fechaStel } = await import('./lib/stel-api.mjs')
      const lista = await c.todos(ruta, { 'start-date': fechaStel('2026-01-01T00:00:00Z'), sort: 'creation-date:asc' }, { limite: 200, maxPaginas: 10 })
      // Mismo recorte que la auditoría: se reutiliza su normalización por id.
      const porId = new Map([...stelGate.docs[t]].map((d) => [d.id, d]))
      docs[t] = lista.map((d) => ({ ...(porId.get(d.id) ?? {}), ...recortar(d) }))
    }
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true })
  }
  const stel = { ...stelGate, leidoEn: new Date().toISOString(), docs }
  const llamadas = c.llamadas()
  const { plan: segundo, reco, react } = await armarPlan(stel, { borrados: [] })

  const cuenta = (arr, fn) => arr.filter(fn).length
  const verif = {}
  // 32 monedas
  const monedas = planAutorizado.documentos.filter((d) => d.operacion === 'update' && d.cabecera.currency_code)
  const reactPorNumero = Object.fromEntries(['quote', 'order', 'delivery'].map((t) => [t, new Map(react.docs[t].map((d) => [d.number, d]))]))
  verif.monedas = { esperadas: monedas.length, corregidas: cuenta(monedas, (d) => reactPorNumero[d.tipo].get(d.numero)?.currency_code === d.cabecera.currency_code.new), sinMonedaReactHoy: ['quote', 'order', 'delivery'].reduce((n, t) => n + cuenta(react.docs[t], (d) => !d.currency_code), 0) }
  // 30 nuevos completos
  const lineasPorDoc = {}
  for (const [t, fk] of [['quote', 'quote_id'], ['order', 'order_id'], ['delivery', 'delivery_id']]) for (const l of react.lineas[t]) lineasPorDoc[`${t}:${l[fk]}`] = (lineasPorDoc[`${t}:${l[fk]}`] ?? 0) + 1
  const nuevos = planAutorizado.documentos.filter((d) => d.operacion === 'insert')
  const detalleNuevos = nuevos.map((d) => {
    const r = reactPorNumero[d.tipo].get(d.numero)
    const ok = Boolean(r) && r.external_id === d.stel_id && r.currency_code === d.cabecera.currency_code && Number(r.total) === d.cabecera.total && (lineasPorDoc[`${d.tipo}:${r.id}`] ?? 0) === d.lineas.insertar.length && Boolean(r.imported_at)
    return { numero: d.numero, ok, lineas: r ? lineasPorDoc[`${d.tipo}:${r.id}`] ?? 0 : null, esperadas: d.lineas.insertar.length }
  })
  verif.documentosNuevos = { esperados: nuevos.length, completos: cuenta(detalleNuevos, (x) => x.ok), incompletos: detalleNuevos.filter((x) => !x.ok) }
  // 595 renglones de remitos con precio
  const lineasRem = new Map(react.lineas.delivery.map((l) => [l.id, l]))
  const preciosRem = planAutorizado.documentos.filter((d) => d.tipo === 'delivery').flatMap((d) => d.lineas.actualizar.filter((l) => l.campos.unit_price))
  verif.preciosRemitos = { esperados: preciosRem.length, conPrecioStel: cuenta(preciosRem, (l) => Number(lineasRem.get(l.id)?.unit_price) === l.campos.unit_price.new && Number(lineasRem.get(l.id)?.discount_pct) === (l.campos.discount_pct?.new ?? Number(lineasRem.get(l.id)?.discount_pct))) }
  // 11 source_quote_id
  const quotePorId = new Map(react.docs.quote.map((q) => [q.id, q.number]))
  const directos = planAutorizado.documentos.filter((d) => d.operacion === 'update' && d.cabecera.source_quote_id)
  verif.remitosDirectos = { esperados: directos.length, correctos: cuenta(directos, (d) => reactPorNumero.delivery.get(d.numero)?.source_quote_id === d.cabecera.source_quote_id.new), detalle: directos.map((d) => `${d.numero}→${quotePorId.get(reactPorNumero.delivery.get(d.numero)?.source_quote_id) ?? 'null'}`) }
  // COTI02499
  verif.coti02499 = reactPorNumero.quote.has('COTI02499')
  // 8 renglones no autorizados
  const pendientes = planAutorizado.pendientesBorrado
  const tabla = { quote: 'sales_quote_lines', delivery: 'delivery_lines' }
  const intactos = []
  for (const p of pendientes) {
    const antes = respaldo[tabla[p.tipo]].find((r) => r.id === p.react_linea_id)
    const { data: ahora } = await sb.from(tabla[p.tipo]).select('*').eq('id', p.react_linea_id).maybeSingle()
    intactos.push({ numero: p.numero, sku: p.sku, intacta: Boolean(ahora) && canonicoSimple(antes) === canonicoSimple(ahora) })
  }
  verif.renglonesNoAutorizados = { esperados: pendientes.length, intactos: cuenta(intactos, (x) => x.intacta), detalle: intactos }

  const rp = reco.resumen
  const informe = {
    generado: new Date().toISOString(), llamadasStel: llamadas, stelDocumentosLeidosEn: stel.leidoEn,
    auditoria: rp,
    productos: { resumenPorLinea: reco.productos.resumenPorLinea, distintos: reco.productos.distintos, porResolucion: reco.productos.porResolucion, vinculadosPorIdStel: react.productos.filter((p) => p.external_source === 'stel').length },
    segundoDryRun: { hash: hashPlan(segundo), resumen: segundo.resumen, documentos: segundo.documentos.map((d) => ({ numero: d.numero, cabecera: Object.keys(d.cabecera), lineas: { insertar: d.lineas.insertar.length, actualizar: d.lineas.actualizar.length } })), productos: segundo.productos.map((p) => `${p.op}:${p.sku}`), bloqueados: segundo.bloqueados, pendientesBorrado: segundo.pendientesBorrado.map((p) => `${p.numero}:${p.sku}`) },
    verificaciones: verif,
  }
  const f = guardar(`verificacion-${corto}.json`, informe)
  console.log(JSON.stringify({ ...informe, productos: { ...informe.productos }, segundoDryRun: { ...informe.segundoDryRun, resumen: undefined } }, null, 1))
  console.log(`  detalle: ${f}`)
}

function recortar(d) {
  return {
    id: d.id, 'full-reference': d['full-reference'], date: d.date, 'creation-date': d['creation-date'], 'utc-last-modification-date': d['utc-last-modification-date'],
    'account-id': d['account-id'], 'document-state-id': d['document-state-id'], 'parent-document-id': d['parent-document-id'] ?? null,
    'parent-document-path': d['parent-document-path'] ?? null, title: d.title ?? null, 'currency-code': d['currency-code'] ?? null,
    'currency-rate': d['currency-rate'] ?? null, 'discount-percentage': d['discount-percentage'], 'discount-total-amount': d['discount-total-amount'],
    'subtotal-amount': d['subtotal-amount'], 'tax-total-amount': d['tax-total-amount'], 'total-amount': d['total-amount'], 'tax-breakdown': d['tax-breakdown'] ?? [],
    'primary-tax-enabled': d['primary-tax-enabled'], 'income-tax-percentage': d['income-tax-percentage'] ?? null, deleted: d.deleted ?? false,
    lines: (d.lines ?? []).map((l) => ({
      id: l.id, order: l.order, 'line-type': l['line-type'], deleted: l.deleted, 'item-id': l['item-id'], 'item-path': l['item-path'],
      'item-reference': l['item-reference'], 'item-name': l['item-name'], 'item-deleted': l['item-deleted'], units: l.units,
      'item-base-price': l['item-base-price'], 'discount-percentage': l['discount-percentage'], 'total-amount': l['total-amount'],
      'primary-tax-percentage': l['primary-tax-percentage'], 'parent-document-id': l['parent-document-id'] ?? null,
    })),
  }
}
const canonicoSimple = (o) => JSON.stringify(Object.keys(o ?? {}).sort().map((k) => [k, o[k]]))

const acciones = { dryrun, aplicar, revertir, verificar }
if (!acciones[comando]) { console.error('uso: dryrun | aplicar --plan-hash H --autorizo-reconciliacion-productiva | revertir --run ID --autorizo-reversion'); process.exit(1) }
acciones[comando]().catch((e) => { console.error('✗', limpiar(e.message)); process.exit(1) })
