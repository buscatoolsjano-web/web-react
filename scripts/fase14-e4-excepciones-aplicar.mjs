/**
 * Fase 14 · Entrega 4 — aplicación de las excepciones autorizadas.
 *
 * Sólo entra lo que el GATE (`fase14-e4-gate-excepciones.mjs`) marcó APLICAR:
 *   A · COTI02530 vuelve a «sent» (estado de STEL) y queda vinculada por id
 *   B · SP.2008VP/100 se vincula al artículo de STEL
 *   C · las 8 líneas que sobran se borran (la fila entera queda en la bitácora)
 *   D · el cliente de COTI02452 recibe el CUIT que STEL tiene
 *   E · SP.2007VPM/80 NO se toca
 *
 *   node scripts/fase14-e4-excepciones-aplicar.mjs dryrun --gate <hash del dry run de E2>
 *   node scripts/fase14-e4-excepciones-aplicar.mjs aplicar --gate <hash> --plan-hash <sha256> --autorizo-excepciones
 *
 * La segunda lee STEL de nuevo, rearma el plan y se detiene sin escribir si el
 * hash no es exactamente el autorizado. Todo pasa por las RPC de reconciliación:
 * cada cambio es atómico, queda en bitácora y se puede revertir por run.
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { leerReactEmpresa, leerStel } from './fase14-stel-api-auditoria.mjs'
import { crearCliente, limpiar } from './lib/stel-api.mjs'
import { CATEGORIA_REVISION, ejecutarPlan, hashPlan, huellaEmpresa, planificarE2, respaldoAfectado, resumirPlan } from './lib/stel-reconciliacion.mjs'

const [, , comando] = process.argv
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null }
const bandera = (n) => process.argv.includes(n)
const SALIDA = path.resolve('scripts/output/e4')
const EMPRESA = 'buscatools'

const BASE = process.env.VITE_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !SECRET) { console.error('✗ Faltan VITE_SUPABASE_URL / SUPABASE_SECRET_KEY'); process.exit(1) }
const sb = createClient(BASE, SECRET, { auth: { persistSession: false } })
const guardar = (nombre, datos) => { fs.mkdirSync(SALIDA, { recursive: true }); const f = path.join(SALIDA, nombre); fs.writeFileSync(f, JSON.stringify(datos, null, 1)); return path.relative(process.cwd(), f) }

/** Las excepciones que el gate dejó pasar, en el formato que entiende el planificador. */
export function aprobadosDesdeGate(gate) {
  const a = { borrados: [], vinculosProducto: [], estadosRegresivos: [], clientes: [] }
  if (gate.casos.coti02530?.decision === 'APLICAR') a.estadosRegresivos.push('COTI02530')
  if (gate.casos.sp2008?.decision === 'APLICAR') a.vinculosProducto.push(gate.casos.sp2008.evidencia.stelId)
  if (gate.casos.sp2007?.decision === 'APLICAR') throw new Error('SP.2007VPM/80 no se aplica nunca en E4')
  for (const l of gate.casos.lineas?.detalle ?? []) if (l.decision === 'APLICAR') a.borrados.push(l.id)
  if (gate.casos.coti02452?.decision === 'APLICAR') {
    a.clientes.push({
      customer_id: gate.casos.coti02452.evidencia.clienteReact,
      stel_account_id: gate.casos.coti02452.evidencia.cuentaStel,
      tax_id: gate.casos.coti02452.evidencia.cuitStel,
    })
  }
  return a
}

async function leerStelAhora(maxLlamadas) {
  const cacheDir = path.resolve(`.stel-cache/e4-${Date.now()}`)
  const c = crearCliente({ maxLlamadas, usarCache: true, cacheDir, log: () => {} })
  try {
    const stel = await leerStel(c, { conMaestro: false, loteReferencias: 80 })
    return { stel, llamadas: c.llamadas() }
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true })
  }
}

async function armarPlan(stel, aprobados) {
  const react = await leerReactEmpresa(sb, EMPRESA)
  const { data: cat } = await sb.from('product_categories').select('id, needs_review').eq('company_id', react.BT).eq('slug', CATEGORIA_REVISION.slug).maybeSingle()
  if (cat && cat.needs_review !== true) throw new Error('la categoría de revisión no está marcada como revisión')
  const { data: listas } = await sb.from('price_lists').select('id, is_default').eq('company_id', react.BT)
  const base = (listas ?? []).filter((l) => l.is_default)
  if (base.length !== 1) throw new Error('la empresa no tiene exactamente una lista de precios por defecto')
  const { plan, reco } = planificarE2(stel, react, { categoriaRevisionId: cat?.id ?? null, listaBaseId: base[0].id, aprobados })
  return { plan, reco, react }
}

function leerGate() {
  const g = arg('--gate')
  if (!/^[0-9a-f]{12,64}$/.test(g ?? '')) { console.error('✗ falta --gate <hash del dry run que auditó el gate>'); process.exit(2) }
  const f = path.resolve(`scripts/output/e4/gate-${g.slice(0, 12)}.json`)
  if (!fs.existsSync(f)) { console.error(`✗ falta ${path.relative(process.cwd(), f)}: correr primero fase14-e4-gate-excepciones.mjs`); process.exit(2) }
  return JSON.parse(fs.readFileSync(f, 'utf8'))
}

/** Lo que el plan hace de más respecto de las excepciones autorizadas. */
function fueraDeAlcance(plan, aprobados) {
  const numerosPermitidos = new Set([...aprobados.estadosRegresivos, 'COTI02530'])
  const fuera = []
  for (const d of plan.documentos) {
    if (d.operacion === 'insert') { fuera.push(`insert:${d.numero}`); continue }
    const campos = Object.keys(d.cabecera)
    const permitidos = campos.every((c) => ['external_source', 'external_id', 'status'].includes(c))
    const borra = d.lineas.borrar.every((l) => aprobados.borrados.includes(l.id))
    const insertaLineas = d.lineas.insertar.length > 0
    const actualiza = d.lineas.actualizar.every((l) => Object.keys(l.campos).every((c) => c === 'product_id'))
    if (campos.includes('status') && !numerosPermitidos.has(d.numero)) fuera.push(`estado:${d.numero}`)
    if (!permitidos || !borra || insertaLineas || !actualiza) fuera.push(`${d.numero}:${campos.join('+')}|+${d.lineas.insertar.length}|~${d.lineas.actualizar.length}|-${d.lineas.borrar.length}`)
  }
  for (const p of plan.productos) if (p.op !== 'vincular' || !aprobados.vinculosProducto.includes(p.stel_id)) fuera.push(`producto:${p.op}:${p.sku}`)
  return fuera
}

async function dryrun() {
  const gate = leerGate()
  const aprobados = aprobadosDesdeGate(gate)
  console.log('  excepciones que el gate deja pasar:', JSON.stringify({
    estadosRegresivos: aprobados.estadosRegresivos, vinculosProducto: aprobados.vinculosProducto,
    borrados: aprobados.borrados.length, clientes: aprobados.clientes.length,
  }))
  const { stel, llamadas } = await leerStelAhora(Number(arg('--max-llamadas') ?? 70))
  const { plan, reco } = await armarPlan(stel, aprobados)
  const hash = hashPlan(plan)
  const fuera = fueraDeAlcance(plan, aprobados)
  const informe = {
    generado: new Date().toISOString(), stelLeidoEn: plan.stelLeidoEn, llamadasStel: llamadas,
    planHash: hash, resumen: plan.resumen, excepciones: plan.excepciones,
    documentos: plan.documentos.map((d) => ({ numero: d.numero, operacion: d.operacion, cabecera: Object.keys(d.cabecera), lineas: { insertar: d.lineas.insertar.length, actualizar: d.lineas.actualizar.length, borrar: d.lineas.borrar.length }, regresivoAprobado: Boolean(d.aprobar_estado_regresivo) })),
    productos: plan.productos.map((p) => `${p.op}:${p.sku}`),
    clientes: plan.clientes.length,
    bloqueadosQueQuedan: plan.bloqueados,
    pendientesBorradoQueQuedan: plan.pendientesBorrado.length,
    fueraDeAlcance: fuera,
    auditoria: reco.resumen,
  }
  guardar(`plan-excepciones-${hash.slice(0, 12)}.json`, plan)
  guardar(`dryrun-excepciones-${hash.slice(0, 12)}.json`, informe)
  console.log(JSON.stringify(informe, null, 1))
  console.log(`\n  PLAN HASH: ${hash}`)
  if (fuera.length) console.error(`\n  ✗ el plan hace cosas fuera de las excepciones autorizadas: ${fuera.join(', ')}`)
}

async function aplicar() {
  const autorizado = arg('--plan-hash')
  if (!bandera('--autorizo-excepciones') || !/^[0-9a-f]{64}$/.test(autorizado ?? '')) {
    console.error('✗ falta --plan-hash <sha256 del dry run> --autorizo-excepciones')
    process.exit(2)
  }
  const gate = leerGate()
  const aprobados = aprobadosDesdeGate(gate)
  const { stel, llamadas } = await leerStelAhora(Number(arg('--max-llamadas') ?? 70))
  const { plan, react } = await armarPlan(stel, aprobados)
  const hash = hashPlan(plan)
  console.log(`  llamadas a STEL: ${llamadas} · plan de ahora ${hash}`)
  if (hash !== autorizado) {
    guardar(`plan-rechazado-${hash.slice(0, 12)}.json`, plan)
    console.error(`✗ GATE: el plan de ahora no es el autorizado (${autorizado.slice(0, 12)}…). No se escribió nada.`)
    process.exit(3)
  }
  const fuera = fueraDeAlcance(plan, aprobados)
  if (fuera.length) {
    console.error(`✗ el plan hace cosas fuera de las excepciones autorizadas: ${fuera.join(', ')}. No se escribió nada.`)
    process.exit(3)
  }
  console.log('  GATE OK: plan idéntico al autorizado y dentro del alcance de las excepciones')

  const corto = hash.slice(0, 12)
  guardar(`stel-aplicar-${corto}.json`, { leidoEn: stel.leidoEn, stel })
  const huellaAntes = await huellaEmpresa(sb, react.BT)
  const respaldo = await respaldoAfectado(sb, plan)
  guardar(`respaldo-${corto}.json`, { generado: new Date().toISOString(), planHash: hash, huella: huellaAntes, filas: respaldo })
  console.log('  SNAPSHOT + BACKUP OK:', JSON.stringify(Object.fromEntries(Object.entries(respaldo).map(([t, f]) => [t, f.length]))))

  plan.resumen = resumirPlan(plan)
  const hechos = await ejecutarPlan(sb, plan, {
    autorizacion: { planHash: hash, confirmado: true },
    alIniciar: (run) => { console.log(`  RUN: ${run}`); guardar(`run-en-curso-${corto}.json`, { run, planHash: hash, inicio: new Date().toISOString() }) },
    log: (m) => console.log(m),
  })
  const huellaDespues = await huellaEmpresa(sb, react.BT)
  const invariantes = ['document_sequences', 'document_numbering_authority', 'stock_balances', 'stock_movements', 'stock_reservations', 'sales_audit']
  const rotos = invariantes.filter((t) => huellaAntes[t].hash !== huellaDespues[t].hash)
  const segundo = (await armarPlan(stel, aprobados)).plan
  const informe = {
    run: hechos.run, planHash: hash, hechos, invariantesRotos: rotos,
    segundaCorrida: { hash: hashPlan(segundo), productos: segundo.productos.length, clientes: segundo.clientes.length, documentos: segundo.documentos.map((d) => d.numero), pendientesBorrado: segundo.pendientesBorrado.length, bloqueados: segundo.bloqueados },
    huellaAntes, huellaDespues,
  }
  guardar(`aplicado-${hechos.run}.json`, informe)
  console.log(JSON.stringify({ run: informe.run, hechos: { productos: hechos.productos, clientes: hechos.clientes, documentos: hechos.documentos, cambios: hechos.cambios, fallidos: hechos.fallidos, salteados: hechos.salteados }, invariantesRotos: rotos, segundaCorrida: informe.segundaCorrida }, null, 1))
  if (rotos.length || hechos.fallidos.length) process.exit(4)
}

const acciones = { dryrun, aplicar }
if (!acciones[comando]) { console.error('uso: dryrun --gate H | aplicar --gate H --plan-hash P --autorizo-excepciones'); process.exit(1) }
acciones[comando]().catch((e) => { console.error('✗', limpiar(e.message)); process.exit(1) })
