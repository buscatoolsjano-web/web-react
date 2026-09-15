/**
 * Fase 14 · Entrega 1 — Plan de reconciliación con STEL (DRY RUN).
 *
 * Lee la auditoría (scripts/output/fase14-stel-snapshot.json, que generó
 * fase14-stel-api-auditoria.mjs) y el estado ACTUAL de React, y propone cada
 * cambio con documento, campo, valor viejo, valor nuevo y fuente = STEL.
 * No llama a la API de STEL y NO ESCRIBE en productivo:
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase14-stel-api-reconcile-dryrun.mjs            # Buscatools, sólo plan
 *
 * `aplicarPlan` existe para la prueba en fixture y se niega a tocar cualquier
 * empresa cuyo slug no empiece con `zz-` (ver fase14-stel-api-reconcile-fixture-tests.mjs).
 *
 * Reglas (PHASE_14_ENTREGA_1_STEL_API_RECONCILIACION.md):
 *   · moneda, totales, descuento, estado, líneas y vínculos salen de STEL; nada se infiere;
 *   · el tipo de cambio NO se copia (STEL guarda USD por unidad; React no tiene semántica fijada);
 *   · una línea se corrige campo por campo; sólo se inserta o borra lo que no tiene par;
 *   · nada consume secuencias, nada inserta stock_movements, nada escribe bitácoras;
 *   · lo que un trigger actual rechazaría se marca BLOQUEADO con el motivo, no se fuerza.
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { reconciliar, tipoDePath } from './fase14-stel-api-auditoria.mjs'

export const FUENTE = 'STEL'
export const MARCA_IMPORTACION = 'stel_reconciliation'
const CERRADAS = ['accepted', 'rejected', 'expired']

const num = (v) => { const n = Number(v); return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n }
const igual = (a, b, tol = 0.01) => (a === null && b === null) || (a !== null && b !== null && Math.abs(a - b) <= tol + 1e-9)
const dia = (s) => (s ?? '').toString().slice(0, 10) || null

const TIPOS = {
  quote: { tabla: 'sales_quotes', lineas: 'sales_quote_lines', fk: 'quote_id', fecha: 'quote_date', cantidad: 'quantity', estado: 'status' },
  order: { tabla: 'sales_orders', lineas: 'sales_order_lines', fk: 'order_id', fecha: 'order_date', cantidad: 'quantity_ordered', estado: 'commercial_status' },
  delivery: { tabla: 'deliveries', lineas: 'delivery_lines', fk: 'delivery_id', fecha: 'delivery_date', cantidad: 'quantity', estado: 'status' },
}

/** Tratamiento fiscal de una línea STEL (alícuota de la línea; sin IVA si el documento no lo aplica). */
export function tratamiento(docStel, linea) {
  if (docStel['primary-tax-enabled'] === false) return { tax_treatment: 'not_taxed', tax_rate_snapshot: 0 }
  const pct = num(linea['primary-tax-percentage']) ?? 0
  if (Math.abs(pct - 21) < 0.001) return { tax_treatment: 'vat_21', tax_rate_snapshot: 21 }
  if (Math.abs(pct - 10.5) < 0.001) return { tax_treatment: 'vat_105', tax_rate_snapshot: 10.5 }
  if (pct === 0) return { tax_treatment: 'vat_0', tax_rate_snapshot: 0 }
  return { tax_treatment: 'other', tax_rate_snapshot: pct }
}

/**
 * Plan puro: (stel, react) → acciones. No lee ni escribe nada.
 * `react` es lo que devuelve leerReact (con external_source/external_id).
 */
export function planificar(stel, react, { almacenPorDefecto = null } = {}) {
  const reco = reconciliar(stel, react)
  const acciones = []
  const agregar = (a) => acciones.push({ source: FUENTE, ...a })
  const reactPorId = Object.fromEntries(Object.keys(TIPOS).map((t) => [t, new Map(react.docs[t].map((d) => [d.id, d]))]))
  const stelPorId = Object.fromEntries(Object.keys(TIPOS).map((t) => [t, new Map([...(stel.docs[t] ?? []), ...(stel.padresExternos?.[t] ?? [])].map((d) => [d.id, d]))]))
  const prodPorSku = new Map(react.productos.map((p) => [p.sku.trim(), p]))
  const entregasPorPedido = react.docs.delivery.reduce((m, d) => (d.order_id ? m.set(d.order_id, (m.get(d.order_id) ?? 0) + 1) : m), new Map())

  const bloqueoCabecera = (tipo, r, campos) => {
    if (tipo === 'quote' && CERRADAS.includes(r.status)) {
      const vigilados = ['customer_id', 'currency_code', 'exchange_rate', 'quote_date', 'discount_pct', 'perception_pct', 'subtotal', 'tax_amount', 'total', 'status']
      if (campos.some((c) => vigilados.includes(c))) return 'TRIGGER_COTIZACION_CERRADA'
    }
    if (tipo === 'order' && r.commercial_status === 'cancelled') return 'TRIGGER_PEDIDO_CANCELADO'
    return null
  }
  const bloqueoLineas = (tipo, r) => {
    if (tipo === 'quote' && CERRADAS.includes(r.status)) return 'TRIGGER_LINEAS_COTIZACION_CERRADA'
    if (tipo === 'order' && r.commercial_status === 'cancelled') return 'TRIGGER_LINEAS_PEDIDO_CANCELADO'
    if (tipo === 'order' && (entregasPorPedido.get(r.id) ?? 0) > 0) return 'TRIGGER_LINEAS_PEDIDO_CON_ENTREGAS'
    return null
  }

  for (const [tipo, conf] of Object.entries(TIPOS)) {
    for (const f of reco.documentos[tipo]) {
      if (f.clase === 'REACT_ONLY') continue
      const s = stelPorId[tipo].get(f.stel.id)

      // ── Documentos que faltan en React ────────────────────────────────────
      if (f.clase === 'STEL_ONLY') {
        const bloqueos = []
        if (!f.cliente?.reactCustomerIdPropuesto) bloqueos.push(`CLIENTE_${f.cliente?.clase ?? 'SIN_MATCH'}`)
        if (tipo === 'delivery' && !almacenPorDefecto) bloqueos.push('SIN_DEPOSITO_POR_DEFECTO')
        const rel = reco.relaciones.find((x) => x.hijo === f.numero)
        const padre = rel && rel.estado !== 'PADRE_DE_OTRO_TIPO_SIN_CAMPO_EN_REACT' ? rel.padre : null
        const lineas = f.lineasStel.map((ls, i) => {
          const lineaStel = s.lines.find((l) => l.id === ls.stelLineaId)
          const prod = prodPorSku.get(ls.sku) ?? null
          return {
            stelLineaId: ls.stelLineaId, line_no: i + 1, sku_snapshot: ls.sku || null, name_snapshot: ls.nombre ?? null,
            product_id: prod?.id ?? null, productoFaltante: !prod, [conf.cantidad]: ls.cantidad,
            unit_price: ls.precio ?? 0, discount_pct: ls.descuento ?? 0, line_type: ls.esServicio ? 'service' : 'item',
            ...tratamiento(s, lineaStel ?? {}),
          }
        })
        const estadoFinal = f.estadoMapeado
        agregar({
          action: 'INSERT', tipo, document: f.numero, stelId: s.id, field: '*', old: null,
          new: {
            number: f.numero, original_number: f.numero, series_code: f.numero.replace(/[0-9]+$/, ''), [conf.fecha]: dia(s.date),
            currency_code: s['currency-code'] ?? null, exchange_rate: null, title: s.title ?? null,
            subtotal: num(s['subtotal-amount']), tax_amount: num(s['tax-total-amount']), total: num(s['total-amount']),
            ...(tipo !== 'delivery' ? { discount_pct: num(s['discount-percentage']) ?? 0, perception_pct: num(s['income-tax-percentage']) ?? 0 } : {}),
            customer_id: f.cliente?.reactCustomerIdPropuesto ?? null, external_source: 'stel', external_id: String(s.id),
            legacy_source: MARCA_IMPORTACION, needs_review: lineas.some((l) => l.productoFaltante),
            review_reason: lineas.some((l) => l.productoFaltante) ? `STEL_RECONCILIATION: ${lineas.filter((l) => l.productoFaltante).length} línea(s) con producto que React no tiene` : null,
          },
          padre, estadoFinal, lineas, lineasSeccionOmitidas: f.stel.lineasNoItem.length,
          bloqueado: bloqueos.length ? bloqueos.join('+') : null,
        })
        continue
      }

      // ── Documentos emparejados ───────────────────────────────────────────
      const r = reactPorId[tipo].get(f.react.id)
      const cambios = []
      const poner = (field, old, nuevo, action) => cambios.push({ field, old, new: nuevo, action })
      if (r.external_source !== 'stel' || r.external_id !== String(s.id)) {
        poner('external_source', r.external_source, 'stel', 'SET_EXTERNAL_ID')
        poner('external_id', r.external_id, String(s.id), 'SET_EXTERNAL_ID')
      }
      if (!r.currency_code && s['currency-code']) poner('currency_code', null, s['currency-code'], 'SET_CURRENCY')
      for (const [campo, clave] of [['subtotal', 'subtotal-amount'], ['tax_amount', 'tax-total-amount'], ['total', 'total-amount']]) {
        if (!igual(num(r[campo]), num(s[clave]))) poner(campo, num(r[campo]), num(s[clave]), 'FIX_TOTAL')
      }
      if (tipo !== 'delivery' && !igual(num(r.discount_pct) ?? 0, num(s['discount-percentage']) ?? 0, 0.0001)) poner('discount_pct', num(r.discount_pct), num(s['discount-percentage']) ?? 0, 'FIX_TOTAL')
      if (tipo === 'quote' && f.estadoMapeado && f.estadoMapeado !== r.status) poner('status', r.status, f.estadoMapeado, 'UPDATE')
      if (f.cliente?.clase === 'VINCULO_DISTINTO' && f.cliente.reactCustomerIdPropuesto) poner('customer_id', r.customer_id, f.cliente.reactCustomerIdPropuesto, 'LINK_CUSTOMER')
      const rel = reco.relaciones.find((x) => x.hijo === f.numero)
      if (rel?.estado === 'FALTA_VINCULO_EN_REACT' || rel?.estado === 'VINCULO_DISTINTO_EN_REACT') {
        const campo = tipo === 'order' ? 'quote_id' : 'order_id'
        poner(campo, r[campo], rel.reactPadreEsperadoId, tipo === 'order' ? 'LINK_QUOTE' : 'LINK_ORDER')
      }
      // Estado antes que el resto sólo si no cierra: con la cotización todavía abierta, los montos pasan.
      for (const c of cambios) {
        const soloEste = [c.field]
        const bloqueoPorEstado = tipo === 'quote' && c.field !== 'status' && CERRADAS.includes(r.status) ? bloqueoCabecera(tipo, r, soloEste) : null
        agregar({ action: c.action, tipo, document: f.numero, reactId: r.id, stelId: s.id, table: conf.tabla, field: c.field, old: c.old, new: c.new, bloqueado: bloqueoPorEstado ?? (c.field === 'status' ? bloqueoCabecera(tipo, r, ['status']) : bloqueoCabecera(tipo, r, soloEste)) })
      }

      // Líneas
      const bl = bloqueoLineas(tipo, r)
      for (const ls of f.lineasStel) {
        const x = ls.reactLinea
        if (!x) {
          const prod = prodPorSku.get(ls.sku) ?? null
          const lineaStel = s.lines.find((l) => l.id === ls.stelLineaId)
          agregar({ action: 'FIX_LINE', op: 'insert', tipo, document: f.numero, reactId: r.id, table: conf.lineas, field: '*', old: null, new: { sku_snapshot: ls.sku, name_snapshot: ls.nombre, product_id: prod?.id ?? null, [conf.cantidad]: ls.cantidad, unit_price: ls.precio ?? 0, discount_pct: ls.descuento ?? 0, line_type: ls.esServicio ? 'service' : 'item', ...(tipo === 'delivery' ? {} : tratamiento(s, lineaStel ?? {})) }, stelLineaId: ls.stelLineaId, bloqueado: bl ?? (tipo === 'delivery' && !almacenPorDefecto ? 'SIN_DEPOSITO_POR_DEFECTO' : null) })
          continue
        }
        const prod = prodPorSku.get(ls.sku) ?? null
        if (prod && x.product_id !== prod.id) agregar({ action: 'LINK_PRODUCT', tipo, document: f.numero, reactId: r.id, lineId: x.id, table: conf.lineas, field: 'product_id', old: x.product_id, new: prod.id, sku: ls.sku, bloqueado: bl })
        const campos = []
        if ((x.sku_snapshot ?? '').trim() !== ls.sku) campos.push(['sku_snapshot', x.sku_snapshot, ls.sku], ['name_snapshot', x.name_snapshot, ls.nombre])
        const cant = num(x[conf.cantidad])
        if (!igual(cant, ls.cantidad, 0.0001)) campos.push([conf.cantidad, cant, ls.cantidad])
        if (tipo === 'delivery') {
          // Remitos históricos sin precio: STEL lo devuelve.
          if (x.unit_price === null && ls.precio !== null) campos.push(['unit_price', null, ls.precio])
          else if (x.unit_price !== null && !igual(num(x.unit_price), ls.precio)) campos.push(['unit_price', num(x.unit_price), ls.precio])
          if ((x.discount_pct === null && (ls.descuento ?? 0) !== 0) || (x.discount_pct !== null && !igual(num(x.discount_pct), ls.descuento, 0.0001))) campos.push(['discount_pct', num(x.discount_pct), ls.descuento])
          if (x.discount_pct === null && (ls.descuento ?? 0) === 0 && x.unit_price === null) campos.push(['discount_pct', null, 0])
        } else {
          if (!igual(num(x.unit_price), ls.precio)) campos.push(['unit_price', num(x.unit_price), ls.precio])
          if (!igual(num(x.discount_pct), ls.descuento, 0.0001)) campos.push(['discount_pct', num(x.discount_pct), ls.descuento])
        }
        for (const [field, old, nuevo] of campos) agregar({ action: 'FIX_LINE', op: 'update', tipo, document: f.numero, reactId: r.id, lineId: x.id, table: conf.lineas, field, old, new: nuevo, sku: ls.sku, bloqueado: bl })
      }
      for (const d of f.lineas?.diferencias ?? []) {
        if (d.motivo !== 'LINEA_SOLO_EN_REACT') continue
        agregar({ action: 'FIX_LINE', op: 'delete', tipo, document: f.numero, reactId: r.id, lineId: d.reactLinea, table: conf.lineas, field: '*', old: { sku: d.sku }, new: null, destructivo: true, bloqueado: bl ?? 'REQUIERE_APROBACION_BORRADO' })
      }
    }
  }

  const cuenta = (fn) => acciones.filter(fn).length
  const libres = (fn) => cuenta((a) => fn(a) && !a.bloqueado)
  const resumen = {
    insert: cuenta((a) => a.action === 'INSERT'),
    insertLineas: acciones.filter((a) => a.action === 'INSERT').reduce((n, a) => n + a.lineas.length, 0),
    update: cuenta((a) => ['UPDATE', 'SET_EXTERNAL_ID', 'SET_CURRENCY', 'FIX_TOTAL', 'LINK_CUSTOMER', 'LINK_QUOTE', 'LINK_ORDER'].includes(a.action)),
    updateDocumentos: new Set(acciones.filter((a) => ['UPDATE', 'SET_EXTERNAL_ID', 'SET_CURRENCY', 'FIX_TOTAL', 'LINK_CUSTOMER', 'LINK_QUOTE', 'LINK_ORDER'].includes(a.action)).map((a) => `${a.tipo}:${a.document}`)).size,
    setExternalId: cuenta((a) => a.action === 'SET_EXTERNAL_ID' && a.field === 'external_id'),
    productLink: cuenta((a) => a.action === 'LINK_PRODUCT'),
    currencyFix: cuenta((a) => a.action === 'SET_CURRENCY'),
    totalFix: cuenta((a) => a.action === 'FIX_TOTAL'),
    statusUpdate: cuenta((a) => a.action === 'UPDATE' && a.field === 'status'),
    lineFix: cuenta((a) => a.action === 'FIX_LINE'),
    lineFixPorOp: { update: cuenta((a) => a.action === 'FIX_LINE' && a.op === 'update'), insert: cuenta((a) => a.action === 'FIX_LINE' && a.op === 'insert'), delete: cuenta((a) => a.action === 'FIX_LINE' && a.op === 'delete') },
    relationshipFix: cuenta((a) => ['LINK_QUOTE', 'LINK_ORDER', 'LINK_CUSTOMER'].includes(a.action)),
    bloqueadas: cuenta((a) => a.bloqueado),
    bloqueosPorMotivo: acciones.filter((a) => a.bloqueado).reduce((m, a) => ({ ...m, [a.bloqueado]: (m[a.bloqueado] ?? 0) + 1 }), {}),
    aplicablesHoy: libres(() => true),
  }
  return { resumen, acciones, reco }
}

// ── Aplicación: SÓLO fixture ────────────────────────────────────────────────
/**
 * Aplica las acciones no bloqueadas. Se niega si la empresa no es `zz-*`.
 * Sin transacción de PostgREST: el orden por documento es cabecera → líneas →
 * estado final, y un INSERT que falla en las líneas borra su cabecera. La
 * corrida productiva necesita la RPC atómica documentada en
 * PHASE_14_ENTREGA_1_STEL_API_RECONCILIACION.md (§ 16.1).
 */
export async function aplicarPlan(sb, empresaId, plan, { almacenPorDefecto }) {
  const { data: emp, error } = await sb.from('companies').select('slug').eq('id', empresaId).single()
  if (error || !emp) throw new Error('empresa no encontrada')
  if (!emp.slug.startsWith('zz-')) throw new Error(`aplicarPlan se niega: la empresa ${emp.slug} no es fixture`)
  const ahora = new Date().toISOString()
  const hechos = { aplicadas: 0, fallidas: [] }
  const idPorNumero = async (tabla, numero) => (await sb.from(tabla).select('id').eq('company_id', empresaId).eq('number', numero).maybeSingle()).data?.id ?? null
  const libres = plan.acciones.filter((a) => !a.bloqueado)

  for (const tipo of ['quote', 'order', 'delivery']) {
    const conf = TIPOS[tipo]
    // Inserciones
    for (const a of libres.filter((x) => x.tipo === tipo && x.action === 'INSERT')) {
      const cab = { ...a.new, company_id: empresaId, imported_at: ahora }
      if (tipo === 'quote') cab.status = a.estadoFinal === 'accepted' || a.estadoFinal === 'rejected' ? 'sent' : (a.estadoFinal ?? 'sent')
      if (tipo === 'order') {
        cab.quote_id = a.padre ? await idPorNumero('sales_quotes', a.padre) : null
        cab.origin = 'migration'
        cab.commercial_status = a.estadoFinal ?? 'confirmed'
        cab.fulfillment_status = 'pending'
      }
      if (tipo === 'delivery') { cab.order_id = a.padre ? await idPorNumero('sales_orders', a.padre) : null; cab.status = 'delivered' }
      const { data: ins, error: e1 } = await sb.from(conf.tabla).insert(cab).select('id').single()
      if (e1) { hechos.fallidas.push({ a: a.document, error: e1.message }); continue }
      const filas = a.lineas.map((l) => {
        const { stelLineaId, productoFaltante, ...resto } = l
        const fila = { ...resto, company_id: empresaId, [conf.fk]: ins.id }
        if (tipo === 'delivery') { delete fila.line_no; delete fila.line_type; fila.warehouse_id = almacenPorDefecto }
        return fila
      })
      const { error: e2 } = filas.length ? await sb.from(conf.lineas).insert(filas) : { error: null }
      if (e2) {
        // Compensación: un documento importado no se borra (proteger_borrado_*);
        // se le quita la marca y se borra por la puerta de mantenimiento.
        await sb.from(conf.tabla).update({ imported_at: null }).eq('id', ins.id)
        await sb.from(conf.tabla).delete().eq('id', ins.id)
        hechos.fallidas.push({ a: a.document, error: e2.message })
        continue
      }
      if (tipo === 'quote' && a.estadoFinal && a.estadoFinal !== cab.status) {
        const { error: e3 } = await sb.from(conf.tabla).update({ status: a.estadoFinal }).eq('id', ins.id)
        if (e3) { hechos.fallidas.push({ a: a.document, error: e3.message }); continue }
      }
      hechos.aplicadas++
    }
    // Cabeceras: una sola actualización por documento; el estado va último.
    const porDoc = new Map()
    for (const a of libres.filter((x) => x.tipo === tipo && x.reactId && x.table === conf.tabla)) porDoc.set(a.reactId, [...(porDoc.get(a.reactId) ?? []), a])
    for (const [id, acc] of porDoc) {
      const campos = Object.fromEntries(acc.filter((a) => a.field !== 'status').map((a) => [a.field, a.new]))
      if (Object.keys(campos).length) {
        const { error: e } = await sb.from(conf.tabla).update(campos).eq('id', id).eq('company_id', empresaId)
        if (e) { hechos.fallidas.push({ a: acc[0].document, error: e.message }); continue }
        hechos.aplicadas += acc.filter((a) => a.field !== 'status').length
      }
    }
    // Líneas
    for (const a of libres.filter((x) => x.tipo === tipo && x.table === conf.lineas)) {
      let e = null
      if (a.op === 'insert') {
        const { data: ult } = await sb.from(conf.lineas).select(tipo === 'delivery' ? 'id' : 'line_no').eq(conf.fk, a.reactId).order(tipo === 'delivery' ? 'id' : 'line_no', { ascending: false }).limit(1)
        const fila = { ...a.new, company_id: empresaId, [conf.fk]: a.reactId }
        if (tipo === 'delivery') { delete fila.line_type; fila.warehouse_id = almacenPorDefecto } else fila.line_no = (ult?.[0]?.line_no ?? 0) + 1
        ;({ error: e } = await sb.from(conf.lineas).insert(fila))
      } else if (a.op === 'delete') {
        ;({ error: e } = await sb.from(conf.lineas).delete().eq('id', a.lineId).eq('company_id', empresaId))
      } else {
        ;({ error: e } = await sb.from(conf.lineas).update({ [a.field]: a.new }).eq('id', a.lineId).eq('company_id', empresaId))
      }
      if (e) hechos.fallidas.push({ a: a.document, campo: a.field, error: e.message }); else hechos.aplicadas++
    }
    // Estados al final (cotizaciones que pasan a aceptadas/rechazadas).
    for (const a of libres.filter((x) => x.tipo === tipo && x.field === 'status' && x.table === conf.tabla)) {
      const { error: e } = await sb.from(conf.tabla).update({ status: a.new }).eq('id', a.reactId).eq('company_id', empresaId)
      if (e) hechos.fallidas.push({ a: a.document, campo: 'status', error: e.message }); else hechos.aplicadas++
    }
  }
  return hechos
}

// ── Main: plan de Buscatools ────────────────────────────────────────────────
async function main() {
  const BASE = process.env.VITE_SUPABASE_URL
  const SECRET = process.env.SUPABASE_SECRET_KEY
  if (!BASE || !SECRET) { console.error('✗ Faltan VITE_SUPABASE_URL / SUPABASE_SECRET_KEY'); process.exit(1) }
  const sb = createClient(BASE, SECRET, { auth: { persistSession: false } })
  const SNAP = path.resolve('scripts/output/fase14-stel-snapshot.json')
  if (!fs.existsSync(SNAP)) { console.error('✗ Falta el snapshot: correr antes fase14-stel-api-auditoria.mjs'); process.exit(1) }
  const { stel, meta } = JSON.parse(fs.readFileSync(SNAP, 'utf8'))
  const { leerReactEmpresa } = await import('./fase14-stel-api-auditoria.mjs')
  const react = await leerReactEmpresa(sb, 'buscatools')
  const { data: wh } = await sb.from('warehouses').select('id').eq('company_id', react.BT).eq('is_default', true).maybeSingle()

  console.log('═'.repeat(74))
  console.log('  FASE 14 · E1 — DRY RUN DE RECONCILIACIÓN (no escribe)')
  console.log('═'.repeat(74))
  console.log(`  snapshot STEL ${meta.generado} · React leído ahora`)
  const plan = planificar(stel, react, { almacenPorDefecto: wh?.id ?? null })
  const salida = path.resolve('scripts/output/fase14-stel-dryrun.json')
  fs.writeFileSync(salida, JSON.stringify({ generado: new Date().toISOString(), snapshot: meta.generado, resumen: plan.resumen, acciones: plan.acciones }, null, 1))
  console.log(plan.resumen)
  console.log(`  detalle acción por acción: ${path.relative(process.cwd(), salida)} (ignorado por git)`)
}

if (import.meta.url.endsWith(path.basename(process.argv[1] ?? ''))) {
  main().catch((e) => { console.error('✗', e.message); process.exit(1) })
}

export { tipoDePath }
