/**
 * Fase 14 · E5 — absorber los documentos que STEL emitió después del freeze.
 *
 *   node scripts/fase14-e5-absorber-delta.mjs dryrun --documentos COTI02556,PDV01319,RT0000001433
 *   node scripts/fase14-e5-absorber-delta.mjs aplicar --documentos … --plan-hash <sha256> --autorizo-absorcion
 *   node scripts/fase14-e5-absorber-delta.mjs secuencias            (calcula, no escribe)
 *   node scripts/fase14-e5-absorber-delta.mjs secuencias --aplicar --autorizo-secuencias
 *
 * Después del cutover, un documento de STEL en una serie que ya emite el ERP es
 * una colisión, no una importación: la base lo rechaza con
 * `serie_emitida_por_el_erp`. Este script abre esa puerta SÓLO para los números
 * que se pasan por `--documentos`, y se detiene si el plan toca cualquier otra
 * cosa.
 *
 * No consume secuencias, no mueve stock y no genera eventos comerciales: todo
 * pasa por las RPC de reconciliación, que sólo escriben documentos históricos.
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { leerReactEmpresa, leerStel } from './fase14-stel-api-auditoria.mjs'
import { crearCliente, limpiar } from './lib/stel-api.mjs'
import { CATEGORIA_REVISION, ejecutarPlan, hashPlan, huellaEmpresa, planificarE2, resumirPlan } from './lib/stel-reconciliacion.mjs'

const [, , comando] = process.argv
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null }
const bandera = (n) => process.argv.includes(n)
const SALIDA = path.resolve('scripts/output/e5')
const EMPRESA = 'buscatools'

const BASE = process.env.VITE_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !SECRET) { console.error('✗ Faltan VITE_SUPABASE_URL / SUPABASE_SECRET_KEY'); process.exit(1) }
const sb = createClient(BASE, SECRET, { auth: { persistSession: false } })
const guardar = (nombre, datos) => { fs.mkdirSync(SALIDA, { recursive: true }); const f = path.join(SALIDA, nombre); fs.writeFileSync(f, JSON.stringify(datos, null, 1)); return path.relative(process.cwd(), f) }

const documentos = () => {
  const lista = (arg('--documentos') ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  if (!lista.length) { console.error('✗ falta --documentos COTI…,PDV…,RT…'); process.exit(2) }
  return lista
}

/** El próximo seguro de una serie: nunca baja. */
export function proximoSeguro({ actual, ultimoStel, mayorReact }) {
  const n = (x) => { const m = /(\d+)\s*$/.exec(x ?? ''); return m ? Number(m[1]) : 0 }
  return Math.max(Number(actual) || 1, n(ultimoStel) + 1, n(mayorReact) + 1)
}

async function leerStelAhora(maxLlamadas) {
  const cacheDir = path.resolve(`.stel-cache/e5-${Date.now()}`)
  const c = crearCliente({ maxLlamadas, usarCache: true, cacheDir, log: () => {} })
  try {
    return { stel: await leerStel(c, { conMaestro: false, loteReferencias: 80 }), llamadas: c.llamadas() }
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true })
  }
}

async function armarPlan(stel, aprobados) {
  const react = await leerReactEmpresa(sb, EMPRESA)
  const { data: cat } = await sb.from('product_categories').select('id, needs_review').eq('company_id', react.BT).eq('slug', CATEGORIA_REVISION.slug).maybeSingle()
  const { data: listas } = await sb.from('price_lists').select('id, is_default').eq('company_id', react.BT)
  const base = (listas ?? []).filter((l) => l.is_default)
  if (base.length !== 1) throw new Error('la empresa no tiene exactamente una lista de precios por defecto')
  const { plan, reco } = planificarE2(stel, react, { categoriaRevisionId: cat?.id ?? null, listaBaseId: base[0].id, aprobados })
  return { plan, reco, react }
}

/** El plan no puede hacer nada que no sea insertar exactamente esos documentos. */
function fueraDeAlcance(plan, permitidos) {
  const fuera = []
  for (const d of plan.documentos) {
    if (!permitidos.includes(d.numero)) { fuera.push(`${d.numero}:${d.operacion}`); continue }
    if (d.operacion !== 'insert') fuera.push(`${d.numero}:no es insert`)
    if (d.lineas.actualizar.length || d.lineas.borrar.length) fuera.push(`${d.numero}:toca líneas existentes`)
    if (!d.aprobar_serie_del_erp) fuera.push(`${d.numero}:sin aprobación de serie`)
  }
  for (const p of plan.productos) fuera.push(`producto:${p.op}:${p.sku}`)
  for (const c of plan.clientes ?? []) fuera.push(`cliente:${c.customer_id}`)
  if (plan.pendientesBorrado.length) fuera.push(`borrados pendientes: ${plan.pendientesBorrado.length}`)
  return fuera
}

async function dryrun() {
  const permitidos = documentos()
  const { stel, llamadas } = await leerStelAhora(Number(arg('--max-llamadas') ?? 70))
  const { plan, reco } = await armarPlan(stel, { borrados: [], seriesDelErp: permitidos })
  const hash = hashPlan(plan)
  const fuera = fueraDeAlcance(plan, permitidos)
  const informe = {
    generado: new Date().toISOString(), llamadasStel: llamadas, stelLeidoEn: plan.stelLeidoEn, planHash: hash,
    aAbsorber: permitidos,
    documentos: plan.documentos.map((d) => ({
      numero: d.numero, tipo: d.tipo, operacion: d.operacion, stel_id: d.stel_id, estado_stel: d.estado_stel,
      aprobadoPorSerie: Boolean(d.aprobar_serie_del_erp), lineas: d.lineas.insertar.length,
      cliente: d.cabecera.customer_id, moneda: d.cabecera.currency_code, total: d.cabecera.total,
      padre: d.depende, serie: d.cabecera.series_code,
    })),
    resumen: plan.resumen, excepciones: plan.excepciones, bloqueados: plan.bloqueados,
    pendientesBorrado: plan.pendientesBorrado.length, fueraDeAlcance: fuera,
    auditoria: reco.resumen,
  }
  guardar(`plan-absorcion-${hash.slice(0, 12)}.json`, plan)
  guardar(`dryrun-absorcion-${hash.slice(0, 12)}.json`, informe)
  console.log(JSON.stringify(informe, null, 1))
  console.log(`\n  PLAN HASH: ${hash}`)
  if (fuera.length) { console.error(`\n  ✗ fuera de alcance: ${fuera.join(', ')}`); process.exit(3) }
}

async function aplicar() {
  const permitidos = documentos()
  const autorizado = arg('--plan-hash')
  if (!bandera('--autorizo-absorcion') || !/^[0-9a-f]{64}$/.test(autorizado ?? '')) {
    console.error('✗ falta --plan-hash <sha256> --autorizo-absorcion')
    process.exit(2)
  }
  const { stel, llamadas } = await leerStelAhora(Number(arg('--max-llamadas') ?? 70))
  const { plan, react } = await armarPlan(stel, { borrados: [], seriesDelErp: permitidos })
  const hash = hashPlan(plan)
  console.log(`  llamadas a STEL: ${llamadas} · plan de ahora ${hash}`)
  if (hash !== autorizado) {
    guardar(`plan-rechazado-${hash.slice(0, 12)}.json`, plan)
    console.error(`✗ GATE: el plan cambió desde el dry run (${autorizado.slice(0, 12)}… ≠ ${hash.slice(0, 12)}…). No se escribió nada.`)
    process.exit(3)
  }
  const fuera = fueraDeAlcance(plan, permitidos)
  if (fuera.length) { console.error(`✗ fuera de alcance: ${fuera.join(', ')}. No se escribió nada.`); process.exit(3) }
  console.log('  GATE OK: el plan sólo inserta los documentos autorizados')

  const corto = hash.slice(0, 12)
  const huellaAntes = await huellaEmpresa(sb, react.BT)
  guardar(`stel-absorcion-${corto}.json`, { leidoEn: stel.leidoEn, stel })
  guardar(`huella-antes-${corto}.json`, huellaAntes)
  plan.resumen = resumirPlan(plan)
  const hechos = await ejecutarPlan(sb, plan, {
    autorizacion: { planHash: hash, confirmado: true },
    alIniciar: (run) => console.log(`  ABSORCION_RUN_ID: ${run}`),
    log: (m) => console.log(m),
  })
  const huellaDespues = await huellaEmpresa(sb, react.BT)
  // Lo único que puede cambiar son los documentos y sus líneas.
  const permitidasQueCambien = ['sales_quotes', 'sales_quote_lines', 'sales_orders', 'sales_order_lines', 'deliveries', 'delivery_lines']
  const cambiadas = Object.keys(huellaAntes).filter((t) => huellaAntes[t].hash !== huellaDespues[t].hash)
  const indebidas = cambiadas.filter((t) => !permitidasQueCambien.includes(t))
  const informe = { run: hechos.run, planHash: hash, hechos, cambiadas, indebidas, huellaAntes, huellaDespues }
  guardar(`aplicado-${hechos.run}.json`, informe)
  console.log(JSON.stringify({ run: hechos.run, hechos, cambiadas, indebidas }, null, 1))
  if (indebidas.length || hechos.fallidos.length) { console.error(`✗ cambió algo que no debía: ${indebidas.join(', ')}`); process.exit(4) }
}

/** Próximo seguro por serie, con la regla max(actual, STEL+1, React+1). */
async function secuencias() {
  const { data: emp } = await sb.from('companies').select('id').eq('slug', EMPRESA).single()
  const { stel, llamadas } = await leerStelAhora(Number(arg('--max-llamadas') ?? 70))
  const react = await leerReactEmpresa(sb, EMPRESA)
  const { data: seqs } = await sb.from('document_sequences').select('doc_type, series_code, prefix, padding, next_number').eq('company_id', emp.id).in('doc_type', ['quote', 'sales_order', 'delivery'])
  const mayor = (nums, prefijo, padding) => {
    const re = new RegExp(`^${prefijo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d{${padding}})$`)
    let m = null
    for (const x of nums) { const g = re.exec(x); if (!g) continue; const n = Number(g[1]); if (n >= 11000) continue; if (m === null || n > m.n) m = { n, x } }
    return m?.x ?? null
  }
  const tipoDe = { quote: 'quote', sales_order: 'order', delivery: 'delivery' }
  const filas = (seqs ?? []).filter((s) => ['COTI', 'PDV', 'RT'].includes(s.series_code)).map((s) => {
    const t = tipoDe[s.doc_type]
    const st = mayor(stel.docs[t].map((d) => d['full-reference']), s.prefix, s.padding)
    const re = mayor(react.docs[t].map((d) => d.number), s.prefix, s.padding)
    const propuesto = proximoSeguro({ actual: s.next_number, ultimoStel: st, mayorReact: re })
    return { doc_type: s.doc_type, serie: s.series_code, actual: Number(s.next_number), ultimoStel: st, mayorReact: re, propuesto, sube: propuesto > Number(s.next_number), texto: s.prefix + String(propuesto).padStart(s.padding, '0') }
  })
  console.log(JSON.stringify({ llamadasStel: llamadas, filas }, null, 1))
  guardar('secuencias.json', { generado: new Date().toISOString(), filas })
  if (!bandera('--aplicar')) { console.log('\n  (sólo cálculo: agregar --aplicar --autorizo-secuencias para escribir)'); return }
  if (!bandera('--autorizo-secuencias')) { console.error('✗ falta --autorizo-secuencias'); process.exit(2) }
  for (const f of filas) {
    if (!f.sube) { console.log(`  ${f.serie}: queda en ${f.actual}`); continue }
    const { error } = await sb.from('document_sequences').update({ next_number: f.propuesto })
      .eq('company_id', emp.id).eq('doc_type', f.doc_type).eq('series_code', f.serie).lte('next_number', f.propuesto)
    if (error) throw new Error(`${f.serie}: ${error.message}`)
    console.log(`  ${f.serie}: ${f.actual} → ${f.propuesto}`)
  }
  const { data: despues } = await sb.from('document_sequences').select('doc_type, series_code, next_number').eq('company_id', emp.id).in('series_code', ['COTI', 'PDV', 'RT'])
  console.log('  después:', JSON.stringify(despues))
}

const acciones = { dryrun, aplicar, secuencias }
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  if (!acciones[comando]) { console.error('uso: dryrun | aplicar | secuencias'); process.exit(1) }
  acciones[comando]().catch((e) => { console.error('✗', limpiar(e.message)); process.exit(1) })
}
