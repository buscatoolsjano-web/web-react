/**
 * Fase 14 — preflight de cutover (SÓLO LECTURA, no escribe nada nunca).
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase14-cutover-preflight.mjs                      (lee STEL: ~60 llamadas)
 *   node scripts/fase14-cutover-preflight.mjs --snapshot <hash>    (reusa una lectura guardada: 1 llamada)
 *
 * Responde READY / NOT_READY con el detalle de cada criterio. READY no autoriza
 * nada: el corte lo decide una persona y se ejecuta con el checklist del freeze.
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { leerReactEmpresa, leerStel, reconciliar } from './fase14-stel-api-auditoria.mjs'
import { crearCliente, limpiar } from './lib/stel-api.mjs'

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null }
const SALIDA = path.resolve('scripts/output/e4')
const EMPRESA = arg('--empresa') ?? 'buscatools'
const DOC_ROLLBACK = path.resolve('docs/PHASE_14_ENTREGA_4_SYNC_Y_PRE_CUTOVER.md')

const BASE = process.env.VITE_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !SECRET) { console.error('✗ Faltan variables'); process.exit(1) }
const sb = createClient(BASE, SECRET, { auth: { persistSession: false } })

/** Excepciones aprobadas que NO cuentan como mismatch (§ 4 del pedido de E4). */
export const EXCEPCIONES_APROBADAS = {
  quote: { REACT_ONLY: ['COTI02499'] },
  productosBloqueados: ['SP.2007VPM/80'],
}

/** next = max(secuencia actual, último de STEL + 1, mayor de React + 1). Nunca baja. */
export function proximoNumero({ actual, ultimoStel, mayorReact }) {
  const n = (x) => { const m = /(\d+)\s*$/.exec(x ?? ''); return m ? Number(m[1]) : 0 }
  const propuesto = Math.max(Number(actual) || 1, n(ultimoStel) + 1, n(mayorReact) + 1)
  return { propuesto, sube: propuesto > (Number(actual) || 0), desde: Number(actual) || 0 }
}

/**
 * Números de STEL que comparten prefijo y ancho con una serie pero pertenecen a
 * otro bloque de numeración del propio STEL. Hoy: los 9 `PDV11xxx`, que conviven
 * con los `PDV01xxx` sin ser su continuación (E3 § 11). Se informan aparte y no
 * empujan la secuencia: el ERP seguiría la serie real. La unicidad de
 * (company_id, number) impide que dentro de ~10.000 documentos se repita uno.
 */
export const ES_ATIPICO = {
  sales_order: (n) => n >= 11000,
}

/** El mayor número de una serie, ignorando los que no tienen su mismo ancho. */
export function mayorDeSerie(numeros, prefijo, padding, esAtipico = null) {
  const re = new RegExp(`^${prefijo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d{${padding}})$`)
  // Otro ancho, pero todo dígitos después del prefijo: mismo bloque, forma rara.
  const otroAncho = new RegExp(`^${prefijo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`)
  let mayor = null
  let mayorNum = -1
  const atipicos = []
  for (const x of numeros) {
    const m = re.exec(x)
    if (!m) { if (otroAncho.test(x)) atipicos.push(x); continue }
    const n = Number(m[1])
    if (esAtipico?.(n)) { atipicos.push(x); continue }
    if (n > mayorNum) { mayorNum = n; mayor = x }
  }
  return { mayor, atipicos: [...new Set(atipicos)].sort() }
}

async function main() {
  const snapshot = arg('--snapshot')
  const out = { generado: new Date().toISOString(), empresa: EMPRESA, criterios: {}, detalle: {} }
  const c = crearCliente({ maxLlamadas: Number(arg('--max-llamadas') ?? 70), usarCache: false, log: () => {} })

  // ── STEL ───────────────────────────────────────────────────────────────────
  let stel = null
  try {
    if (snapshot) {
      const f = path.resolve(`scripts/output/e4/stel-aplicar-${snapshot.slice(0, 12)}.json`)
      const f2 = path.resolve(`scripts/output/e2/stel-dryrun-${snapshot.slice(0, 12)}.json`)
      const elegido = fs.existsSync(f) ? f : f2
      if (!fs.existsSync(elegido)) throw new Error(`no encuentro la lectura guardada ${snapshot.slice(0, 12)}`)
      stel = JSON.parse(fs.readFileSync(elegido, 'utf8')).stel
      await c.get('documentStates', { limit: 1 }) // sigue respondiendo
      out.detalle.stelDesdeSnapshot = { archivo: path.relative(process.cwd(), elegido), leidoEn: stel.leidoEn }
    } else {
      stel = await leerStel(c, { conMaestro: false, loteReferencias: 80 })
    }
    out.criterios.STEL_REACHABLE = true
  } catch (e) {
    out.criterios.STEL_REACHABLE = false
    out.detalle.stelError = limpiar(e.message).slice(0, 200)
  }
  out.detalle.llamadasStel = c.llamadas()

  const react = await leerReactEmpresa(sb, EMPRESA)
  const BT = react.BT

  // ── Últimos números ────────────────────────────────────────────────────────
  const { data: seqs } = await sb.from('document_sequences').select('doc_type, series_code, prefix, padding, next_number, is_default').eq('company_id', BT).in('doc_type', ['quote', 'sales_order', 'delivery'])
  const tipos = [['quote', 'quote'], ['order', 'sales_order'], ['delivery', 'delivery']]
  const secuencias = []
  let colisiones = 0
  for (const [tipo, docType] of tipos) {
    const numsStel = (stel?.docs?.[tipo] ?? []).map((d) => d['full-reference']).filter(Boolean)
    const numsReact = react.docs[tipo].map((d) => d.number)
    for (const s of (seqs ?? []).filter((x) => x.doc_type === docType)) {
      const st = mayorDeSerie(numsStel, s.prefix, s.padding, ES_ATIPICO[docType])
      const re = mayorDeSerie(numsReact, s.prefix, s.padding, ES_ATIPICO[docType])
      const p = proximoNumero({ actual: s.next_number, ultimoStel: st.mayor, mayorReact: re.mayor })
      const existe = new Set([...numsStel, ...numsReact])
      const siguiente = s.prefix + String(s.next_number).padStart(s.padding, '0')
      // Hoy la secuencia todavía emitiría un número ya usado: eso lo arregla la
      // alineación del corte (T7), no es un defecto del plan.
      if (existe.has(siguiente)) colisiones++
      const propuestoTexto = s.prefix + String(p.propuesto).padStart(s.padding, '0')
      secuencias.push({
        doc_type: docType, serie: s.series_code, prefijo: s.prefix, padding: s.padding,
        next_actual: Number(s.next_number), ultimoStel: st.mayor, mayorReact: re.mayor,
        next_propuesto: p.propuesto, propuestoTexto, sube: p.sube,
        colisionaHoy: existe.has(siguiente), planLibre: !existe.has(propuestoTexto), bajaria: p.propuesto < Number(s.next_number),
        atipicosStel: st.atipicos, atipicosReact: re.atipicos,
      })
    }
    const conf = (seqs ?? []).find((x) => x.doc_type === docType && x.is_default)
    const ultimo = mayorDeSerie(numsStel, conf?.prefix ?? '', conf?.padding ?? 0, ES_ATIPICO[docType])
    out.criterios[`LAST_${tipo === 'order' ? 'ORDER' : tipo.toUpperCase()}`] = ultimo.mayor
  }
  out.detalle.secuencias = secuencias
  // Antes de alinear es normal que colisione; lo que tiene que estar sano es el plan.
  out.criterios.SEQUENCE_COLLISIONS = colisiones
  out.criterios.SEQUENCE_PLAN_SAFE = secuencias.every((s) => s.planLibre && !s.bajaria)

  // ── Delta y reconciliación ─────────────────────────────────────────────────
  if (stel) {
    const reco = reconciliar(stel, react)
    const mismatches = {}
    let total = 0
    // Después del cutover el ERP emite documentos que STEL no tiene ni va a
    // tener: eso no es un faltante, es el corte funcionando. El reconciliador ya
    // los separa en ERP_ISSUED; acá sólo se informan.
    const emitidosPorElErp = Object.fromEntries(tipos.map(([t]) => [t, reco.resumen[t].ERP_ISSUED ?? 0]))
    out.detalle.emitidosPorElErp = emitidosPorElErp
    for (const [tipo] of tipos) {
      const r = reco.resumen[tipo]
      const permitidas = (EXCEPCIONES_APROBADAS[tipo]?.REACT_ONLY ?? []).length
      const m = {
        STEL_ONLY: r.STEL_ONLY, REACT_ONLY: Math.max(0, r.REACT_ONLY - permitidas),
        HEADER_MISMATCH: r.HEADER_MISMATCH, LINE_MISMATCH: r.LINE_MISMATCH,
        CURRENCY_MISMATCH: r.CURRENCY_MISMATCH, TOTAL_MISMATCH: r.TOTAL_MISMATCH,
        SUBTOTAL_TAX_MISMATCH: r.SUBTOTAL_TAX_MISMATCH, STATUS_DIFFERENT: r.STATUS_DIFFERENT,
        CUSTOMER_MISMATCH: r.CUSTOMER_MISMATCH, RELATION_MISMATCH: r.RELATION_MISMATCH ?? 0,
      }
      mismatches[tipo] = m
      total += Object.values(m).reduce((a, b) => a + (Number(b) || 0), 0)
    }
    out.criterios.RECONCILIATION_MISMATCHES = total
    out.criterios.DELTA_PENDING = tipos.reduce((n, [t]) => n + reco.resumen[t].STEL_ONLY, 0)
    out.detalle.mismatches = mismatches
    out.detalle.productosBloqueados = reco.productos?.porResolucion?.BLOQUEADO ?? null
  } else {
    out.criterios.RECONCILIATION_MISMATCHES = null
    out.criterios.DELTA_PENDING = null
  }

  // ── Sync ───────────────────────────────────────────────────────────────────
  const { data: sync } = await sb.from('stel_sync_state').select('*').eq('company_id', BT)
  const prod = (sync ?? []).find((s) => s.entity === 'products')
  const docs = (sync ?? []).find((s) => s.entity === 'documents')
  out.criterios.PRODUCT_SYNC_OK = Boolean(prod && prod.last_status === 'finished' && prod.cursor_modified_at && !prod.locked_at)
  out.detalle.sync = {
    productos: prod ? { estado: prod.last_status, checkpoint: prod.cursor_modified_at, llamadas: prod.last_calls, bloqueado: Boolean(prod.locked_at) } : null,
    documentos: docs ? { estado: docs.last_status, checkpoint: docs.cursor_modified_at, llamadas: docs.last_calls, bloqueado: Boolean(docs.locked_at) } : null,
  }

  // Precio: el mapeo está definido (catálogo STEL → lista por defecto) pero no
  // alcanza con eso: hace falta que los precios estén efectivamente alineados.
  const { data: lista } = await sb.from('price_lists').select('id, name, currency_code').eq('company_id', BT).eq('is_default', true).single()
  let desalineados = null
  if (stel) {
    const porStel = new Map(stel.productos.map((p) => [String(p.id), p]))
    const vinculados = react.productos.filter((p) => p.external_source === 'stel')
    const ids = vinculados.map((p) => p.id)
    const precios = new Map()
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await sb.from('product_prices').select('product_id, amount').eq('price_list_id', lista.id).is('valid_to', null).in('product_id', ids.slice(i, i + 200))
      for (const x of data ?? []) precios.set(x.product_id, Number(x.amount))
    }
    // Un producto cuenta como desalineado sólo si STEL tiene hoy un precio de
    // catálogo aplicable: si el ítem está inactivo, borrado, sin precio, o lo
    // clasificó E4.5 como no alineable, se informa aparte con el motivo.
    const excepciones = new Map()
    const fExc = path.resolve(arg('--excepciones-precios') ?? 'scripts/output/e45/verificacion.json')
    if (fs.existsSync(fExc)) {
      const v = JSON.parse(fs.readFileSync(fExc, 'utf8'))
      for (const f of v.filas ?? v.casosNoTriple ?? []) {
        if (['DATA_CONFLICT', 'MULTIPLE_PRICE_SOURCE', 'HUMAN_REVIEW', 'NO_STEL_PRICE'].includes(f.clase)) excepciones.set(f.productId ?? f.product_id, f.clase)
      }
    }
    desalineados = 0
    let sinPrecio = 0
    const noAlineables = { inactivoEnStel: 0, sinPrecioEnStel: 0, clasificadoEnE45: 0 }
    for (const p of vinculados) {
      if (excepciones.has(p.id)) { noAlineables.clasificadoEnE45++; continue }
      const item = porStel.get(p.external_id)
      const st = item ? Number(item['sales-price']) : NaN
      if (item && (item.inactive || item.deleted)) { noAlineables.inactivoEnStel++; continue }
      if (!Number.isFinite(st) || st <= 0) { noAlineables.sinPrecioEnStel++; continue }
      const re = precios.get(p.id)
      if (re === undefined) { sinPrecio++; continue }
      if (Math.abs(re - st) > 0.01) desalineados++
    }
    out.detalle.precios = {
      lista: lista.name, moneda: lista.currency_code, vinculados: vinculados.length,
      desalineados, sinPrecioEnReact: sinPrecio, noAlineables,
      excepcionesDeclaradas: excepciones.size, archivoExcepciones: fs.existsSync(fExc) ? path.relative(process.cwd(), fExc) : null,
    }
  }
  out.criterios.PRICE_SYNC_OK = desalineados === 0 && (out.detalle.precios?.sinPrecioEnReact ?? 0) === 0
  out.criterios.PRICE_MAPPING_DEFINED = true

  // ── RT-ML y autoridad por serie ────────────────────────────────────────────
  const { data: seqMl } = await sb.from('document_sequences').select('series_code').eq('company_id', BT).eq('series_code', 'RT-ML')
  const { data: serieAut } = await sb.from('document_numbering_authority_series').select('doc_type, series_code, authority').eq('company_id', BT)
  const { data: aut } = await sb.from('document_numbering_authority').select('doc_type, authority').eq('company_id', BT)
  const rtmlFila = (serieAut ?? []).find((s) => s.doc_type === 'delivery' && s.series_code === 'RT-ML')
  out.criterios.RTML_POLICY_OK = (seqMl ?? []).length === 0 && (rtmlFila ? rtmlFila.authority === 'STEL' : true)
  out.criterios.RTML_SERIES_ROW = Boolean(rtmlFila)
  out.criterios.AUTHORITY_CURRENT = Object.fromEntries((aut ?? []).map((a) => [a.doc_type, a.authority]))
  out.detalle.autoridadPorSerie = serieAut ?? []

  // ── Invariantes de stock y moneda ──────────────────────────────────────────
  const { count: reservas } = await sb.from('stock_reservations').select('*', { count: 'exact', head: true }).eq('company_id', BT)
  const { count: negativos } = await sb.from('stock_balances').select('*', { count: 'exact', head: true }).eq('company_id', BT).lt('quantity', 0)
  out.criterios.STOCK_INVARIANTS = { reservas: reservas ?? 0, saldosNegativos: negativos ?? 0, ok: (reservas ?? 0) === 0 && (negativos ?? 0) === 0 }

  const sinMoneda = { quote: 0, order: 0, delivery: 0 }
  for (const [tipo] of tipos) sinMoneda[tipo] = react.docs[tipo].filter((d) => !d.currency_code).length
  const monedasOk = Object.values(sinMoneda).every((n) => n === 0)
  const { data: triggers } = await sb.rpc('stel_sync_estado', { p_company: BT }).then(() => ({ data: null })).catch(() => ({ data: null }))
  out.criterios.CURRENCY_INVARIANTS = { documentosSinMoneda: sinMoneda, listaPorDefectoConMoneda: Boolean(lista?.currency_code), ok: monedasOk && Boolean(lista?.currency_code) }
  void triggers

  // ── Ensayo y rollback ──────────────────────────────────────────────────────
  const ensayo = fs.existsSync(path.join(SALIDA, 'ensayo.json')) ? JSON.parse(fs.readFileSync(path.join(SALIDA, 'ensayo.json'), 'utf8')) : null
  out.criterios.CUTOVER_REHEARSAL = ensayo ? { resultado: ensayo.resultado, fecha: ensayo.generado, pasos: ensayo.pasos?.length ?? 0 } : null
  out.criterios.ROLLBACK_DOCUMENTED = fs.existsSync(DOC_ROLLBACK) && fs.readFileSync(DOC_ROLLBACK, 'utf8').includes('ROLLBACK DEL CORTE')

  // ── Veredicto ──────────────────────────────────────────────────────────────
  const fallan = []
  if (!out.criterios.STEL_REACHABLE) fallan.push('STEL_REACHABLE')
  if (out.criterios.DELTA_PENDING !== 0) fallan.push('DELTA_PENDING')
  if (out.criterios.RECONCILIATION_MISMATCHES !== 0) fallan.push('RECONCILIATION_MISMATCHES')
  if (!out.criterios.PRODUCT_SYNC_OK) fallan.push('PRODUCT_SYNC_OK')
  if (!out.criterios.PRICE_SYNC_OK) fallan.push('PRICE_SYNC_OK')
  if (!out.criterios.CURRENCY_INVARIANTS.ok) fallan.push('CURRENCY_INVARIANTS')
  if (!out.criterios.STOCK_INVARIANTS.ok) fallan.push('STOCK_INVARIANTS')
  if (!out.criterios.RTML_POLICY_OK) fallan.push('RTML_POLICY_OK')
  if (!out.criterios.SEQUENCE_PLAN_SAFE) fallan.push('SEQUENCE_PLAN_SAFE')
  if (out.criterios.CUTOVER_REHEARSAL?.resultado !== 'PASS') fallan.push('CUTOVER_REHEARSAL')
  if (!out.criterios.ROLLBACK_DOCUMENTED) fallan.push('ROLLBACK_DOCUMENTED')
  out.FINAL = fallan.length ? 'NOT_READY' : 'READY'
  out.faltan = fallan

  fs.mkdirSync(SALIDA, { recursive: true })
  fs.writeFileSync(path.join(SALIDA, 'preflight.json'), JSON.stringify(out, null, 1))
  console.log(JSON.stringify(out, null, 1))
  console.log(`\n  ${out.FINAL}${fallan.length ? `: falta ${fallan.join(', ')}` : ''}`)
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  main().catch((e) => { console.error('✗', limpiar(e.message)); process.exit(1) })
}
