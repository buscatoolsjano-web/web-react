/**
 * Fase 14 · Entrega 1 — Auditoría de Ventas contra la API de STEL Order.
 *
 * SÓLO LECTURA en los dos lados:
 *   · STEL: únicamente GET (scripts/lib/stel-api.mjs no tiene otro método);
 *   · React: únicamente SELECT con la clave de servicio (no hay insert/update/
 *     delete/rpc en este archivo).
 *
 * Qué hace:
 *   1. lee de STEL cotizaciones, pedidos y remitos desde el inicio del período
 *      migrado, con líneas; los clientes y productos que usan; estados; tarifas
 *      y medidas del maestro de productos (U-B-2);
 *   2. lee lo mismo de React (Buscatools);
 *   3. compara documento por documento, línea por línea, moneda, totales,
 *      relaciones, clientes, productos y numeración;
 *   4. escribe el detalle en scripts/output/ (IGNORADO: tiene razones sociales)
 *      y un resumen sin datos personales por consola.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase14-stel-api-auditoria.mjs [--desde 2026-01-01] [--max-llamadas 150] [--sin-cache]
 *
 * La clave de STEL se lee de .env.stel.local y nunca se imprime.
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { crearCliente, fechaStel, limpiar } from './lib/stel-api.mjs'

const arg = (n, def) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : def }
const DESDE = arg('--desde', '2026-01-01')
const MAX_LLAMADAS = Number(arg('--max-llamadas', '150'))
const USAR_CACHE = !process.argv.includes('--sin-cache')
const SALIDA_DIR = path.resolve('scripts/output')
const SALIDA = path.join(SALIDA_DIR, 'fase14-stel-reconciliacion.json')
const SNAPSHOT = path.join(SALIDA_DIR, 'fase14-stel-snapshot.json')


/** Tolerancia de montos: un centavo. */
export const TOL = 0.01

// ── Normalización ───────────────────────────────────────────────────────────
const num = (v) => { const n = Number(v); return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n }
const r2 = (v) => (v === null ? null : Math.round(v * 100) / 100)
const r4 = (v) => (v === null ? null : Math.round(v * 10000) / 10000)
const iguales = (a, b, tol = TOL) => (a === null && b === null) || (a !== null && b !== null && Math.abs(a - b) <= tol + 1e-9)
const normTexto = (s) => (s ?? '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const normNombre = (s) => normTexto(s)
  .replace(/\b([a-z]) (?=[a-z]\b)/g, '$1').replace(/\b([a-z]) (?=[a-z]\b)/g, '$1')
  .replace(/\b(s\s?a\s?u|s\s?a\s?c\s?i|s\s?a\s?i\s?c|srl|s\s?r\s?l|sa|sas|sac|ltda|ltd|inc|llc|cia|y\s?cia)\b/g, ' ')
  .replace(/\s+/g, ' ').trim()
const normCuit = (s) => (s ?? '').toString().replace(/\D/g, '') || null
const normSku = (s) => (s ?? '').toString().trim()
/** Clave numérica de un número de documento: prefijo + entero, sin ceros. */
export function claveNumero(ref) {
  const m = (ref ?? '').toString().trim().match(/^([A-Za-z]+)0*(\d+)$/)
  return m ? `${m[1].toUpperCase()}${Number(m[2])}` : null
}
const partesNumero = (ref) => {
  const m = (ref ?? '').toString().trim().match(/^([A-Za-z]+)(\d+)$/)
  return m ? { prefijo: m[1], digitos: m[2].length, n: Number(m[2]) } : null
}
/** Proporción de palabras (≥2 letras) del nombre más corto que aparecen en el otro. */
export function similitud(a, b) {
  if (normTexto(a) === normTexto(b)) return 1
  const pa = new Set(normTexto(a).split(' ').filter((w) => w.length >= 2))
  const pb = new Set(normTexto(b).split(' ').filter((w) => w.length >= 2))
  if (!pa.size || !pb.size) return 0
  const [chico, grande] = pa.size <= pb.size ? [pa, pb] : [pb, pa]
  return Math.min(0.99, [...chico].filter((w) => grande.has(w)).length / chico.size)
}
const dia = (s) => (s ?? '').toString().slice(0, 10) || null

// ── Recálculo de un documento STEL ─────────────────────────────────────────
/**
 * Líneas: `total-amount` es el neto de la línea (unidades × precio base ×
 * (1 − descuento)), sin impuestos — así lo muestra el contrato y lo verifica
 * `lineaCierra`. Documento: subtotal = Σ neto × (1 − descuento global);
 * impuestos = Σ tax-breakdown; total = subtotal + impuestos.
 */
export function recalcularStel(doc) {
  const lineas = (doc.lines ?? []).filter((l) => !l.deleted)
  const items = lineas.filter((l) => l['line-type'] === 'ITEM')
  const sumaNeto = items.reduce((s, l) => s + (num(l['total-amount']) ?? 0), 0)
  const descDoc = num(doc['discount-percentage']) ?? 0
  const subtotalCalc = sumaNeto * (1 - descDoc / 100)
  const desglose = Array.isArray(doc['tax-breakdown']) ? doc['tax-breakdown'] : []
  const impuestosDesglose = desglose.reduce((s, t) => s + (num(t['total-amount']) ?? 0), 0)
  const lineasQueNoCierran = items.filter((l) => !lineaCierra(l)).length
  return {
    sumaNeto: r4(sumaNeto),
    descuentoDoc: descDoc,
    descuentoMonto: r4(sumaNeto - subtotalCalc),
    subtotalCalc: r4(subtotalCalc),
    impuestosDesglose: r4(impuestosDesglose),
    totalCalc: r4(subtotalCalc + impuestosDesglose),
    lineasQueNoCierran,
  }
}

export function lineaCierra(l) {
  const u = num(l.units) ?? 0
  const p = num(l['item-base-price']) ?? 0
  const d = num(l['discount-percentage']) ?? 0
  const t = num(l['total-amount']) ?? 0
  return Math.abs(u * p * (1 - d / 100) - t) <= Math.max(TOL, Math.abs(t) * 1e-6)
}

/** Clasificación de totales (orden de prioridad documentado en el reporte). */
export function clasificarTotales(stel, calc, react) {
  const out = []
  const sub = num(stel['subtotal-amount'])
  const tax = num(stel['tax-total-amount'])
  const tot = num(stel['total-amount'])
  if (calc.lineasQueNoCierran > 0) out.push('LINE_MISMATCH')
  if (!iguales(r2(calc.subtotalCalc), sub)) {
    out.push(Math.abs((calc.subtotalCalc ?? 0) - (sub ?? 0)) <= 0.05 ? 'ROUNDING_ONLY' : 'DISCOUNT_MISMATCH')
  }
  if (!iguales(r2(calc.impuestosDesglose), tax)) out.push(Math.abs(calc.impuestosDesglose - (tax ?? 0)) <= 0.05 ? 'ROUNDING_ONLY' : 'TAX_MISMATCH')
  if (!iguales(r2((sub ?? 0) + (tax ?? 0)), tot)) out.push('TOTAL_MISMATCH')
  const reactVsStel = {
    subtotal: react ? iguales(num(react.subtotal), sub) : null,
    tax: react ? iguales(num(react.tax_amount), tax) : null,
    total: react ? iguales(num(react.total), tot) : null,
  }
  return { stelInterno: [...new Set(out)], reactVsStel }
}

// ── STEL: lectura ───────────────────────────────────────────────────────────
const TIPOS = [
  { tipo: 'quote', stel: 'salesEstimates', tabla: 'sales_quotes', lineas: 'sales_quote_lines', fk: 'quote_id', fecha: 'quote_date', prefijo: 'COTI', secuencia: 'quote' },
  { tipo: 'order', stel: 'salesOrders', tabla: 'sales_orders', lineas: 'sales_order_lines', fk: 'order_id', fecha: 'order_date', prefijo: 'PDV', secuencia: 'sales_order' },
  { tipo: 'delivery', stel: 'salesDeliveryNotes', tabla: 'deliveries', lineas: 'delivery_lines', fk: 'delivery_id', fecha: 'delivery_date', prefijo: 'RT', secuencia: 'delivery' },
]

/** Tipo de documento según el path que devuelve STEL (`app.stelorder.com/app/salesEstimates/123`). */
export function tipoDePath(ruta) {
  if (/\/salesEstimates\//.test(ruta ?? '')) return 'quote'
  if (/\/salesOrders\//.test(ruta ?? '')) return 'order'
  if (/\/salesDeliveryNotes\//.test(ruta ?? '')) return 'delivery'
  return ruta ? 'otro' : null
}

/** Sólo los campos que usa la reconciliación: nada de emails, direcciones ni firmas. */
function recortarDoc(d) {
  return {
    id: d.id, 'full-reference': d['full-reference'], reference: d.reference, date: d.date,
    'creation-date': d['creation-date'], 'utc-last-modification-date': d['utc-last-modification-date'],
    'account-id': d['account-id'], 'agent-id': d['agent-id'], 'creator-id': d['creator-id'],
    'document-state-id': d['document-state-id'], 'serial-number-id': d['serial-number-id'],
    'parent-document-id': d['parent-document-id'] ?? null, 'parent-document-path': d['parent-document-path'] ?? null, title: d.title ?? null,
    'currency-code': d['currency-code'] ?? null, 'currency-rate': d['currency-rate'] ?? null,
    'discount-percentage': d['discount-percentage'], 'discount-total-amount': d['discount-total-amount'],
    'subtotal-amount': d['subtotal-amount'], 'tax-total-amount': d['tax-total-amount'], 'total-amount': d['total-amount'],
    'tax-breakdown': d['tax-breakdown'] ?? [], 'primary-tax-enabled': d['primary-tax-enabled'],
    'secondary-tax-enabled': d['secondary-tax-enabled'], 'income-tax-enabled': d['income-tax-enabled'],
    'income-tax-percentage': d['income-tax-percentage'] ?? null, 'payment-option-id': d['payment-option-id'] ?? null,
    'validity-date': d['validity-date'] ?? null, deleted: d.deleted ?? false,
    comentarios: Boolean(d.comments), 'external-id': d['external-id'] ?? null,
    lines: (d.lines ?? []).map((l) => ({
      id: l.id, order: l.order, 'line-type': l['line-type'], deleted: l.deleted, 'item-id': l['item-id'],
      'item-path': l['item-path'], 'item-reference': l['item-reference'], 'item-name': l['item-name'],
      'item-description': l['item-description'], 'item-deleted': l['item-deleted'], units: l.units,
      'item-base-price': l['item-base-price'], 'discount-percentage': l['discount-percentage'],
      'total-amount': l['total-amount'], 'primary-tax-percentage': l['primary-tax-percentage'],
      'secondary-tax-percentage': l['secondary-tax-percentage'], 'income-tax-enabled': l['income-tax-enabled'],
      'parent-document-id': l['parent-document-id'] ?? null, 'warehouse-id': l['warehouse-id'],
    })),
  }
}

async function leerStel(c) {
  const t0 = Date.now()
  const docs = {}
  for (const t of TIPOS) {
    // Orden estable por fecha de creación (`id` no es un campo de orden admitido).
    const lista = await c.todos(t.stel, { 'start-date': fechaStel(`${DESDE}T00:00:00Z`), sort: 'creation-date:asc' }, { limite: 200, maxPaginas: 10 })
    docs[t.tipo] = lista.map(recortarDoc)
  }

  // Padres fuera del período: se piden por id (sólo si son pocos).
  const idsPorTipo = Object.fromEntries(TIPOS.map((t) => [t.tipo, new Set(docs[t.tipo].map((d) => d.id))]))
  const padresFuera = { quote: new Set(), order: new Set() }
  for (const d of [...docs.order, ...docs.delivery]) {
    const pid = d['parent-document-id']
    if (!pid) continue
    const tipoPadre = tipoDePath(d['parent-document-path'])
    if (tipoPadre && idsPorTipo[tipoPadre] && !idsPorTipo[tipoPadre].has(pid)) padresFuera[tipoPadre]?.add(pid)
  }
  const padresExternos = { quote: [], order: [], noEncontrados: [] }
  for (const [tipo, ids] of Object.entries(padresFuera)) {
    const ruta = tipo === 'quote' ? 'salesEstimates' : 'salesOrders'
    for (const id of [...ids].slice(0, 25)) {
      try {
        const r = await c.get(`${ruta}/${id}`)
        const d = Array.isArray(r) ? r[0] : r
        if (d) padresExternos[tipo].push(recortarDoc(d))
      } catch (e) {
        padresExternos.noEncontrados.push({ tipo, id, error: limpiar(e.message).slice(0, 120) })
      }
    }
    if (ids.size > 25) padresExternos.noEncontrados.push({ tipo, sinConsultar: ids.size - 25 })
  }

  // Estados de documento.
  const estados = await c.todos('documentStates', {}, { limite: 200, maxPaginas: 3 })

  // Clientes: el maestro completo (la API no filtra por id en el listado).
  const clientesCrudos = await c.todos('clients', { sort: 'creation-date:asc' }, { limite: 200, maxPaginas: 20 })
  const clientes = clientesCrudos.map((x) => ({
    id: x.id, 'full-reference': x['full-reference'], 'legal-name': x['legal-name'], name: x.name,
    'tax-identification-number': x['tax-identification-number'] ?? x['identification-number'] ?? null,
    'currency-code': x['currency-code'] ?? x.currency ?? null, deleted: x.deleted ?? false,
  }))

  // Productos y servicios usados en las líneas, por referencia completa.
  const usados = { products: new Map(), services: new Map() }
  for (const tipo of ['quote', 'order', 'delivery']) {
    for (const d of [...docs[tipo], ...(padresExternos[tipo] ?? [])]) {
      for (const l of d.lines) {
        if (l.deleted || l['line-type'] !== 'ITEM') continue
        const clase = /\/services\//.test(l['item-path'] ?? '') ? 'services' : /\/products\//.test(l['item-path'] ?? '') ? 'products' : null
        if (!clase || !l['item-reference']) continue
        usados[clase].set(l['item-id'], l['item-reference'])
      }
    }
  }
  const items = { products: [], services: [] }
  for (const clase of ['products', 'services']) {
    const refs = [...new Set(usados[clase].values())]
    for (let i = 0; i < refs.length; i += 40) {
      const lote = refs.slice(i, i + 40)
      // `in:` usa la coma como separador: una referencia con coma se pide sola.
      const conComa = lote.filter((r) => r.includes(','))
      const sinComa = lote.filter((r) => !r.includes(','))
      if (sinComa.length) items[clase].push(...await c.todos(clase, { 'full-reference': `in:${sinComa.join(',')}` }, { limite: 200, maxPaginas: 2 }))
      for (const r of conComa) items[clase].push(...await c.todos(clase, { 'full-reference': r }, { limite: 50, maxPaginas: 1 }))
    }
    const encontrados = new Set(items[clase].map((p) => p.id))
    // Los borrados sólo salen por id.
    for (const [id] of usados[clase]) {
      if (encontrados.has(id)) continue
      try {
        const r = await c.get(`${clase}/${id}`)
        const p = Array.isArray(r) ? r[0] : r
        if (p) items[clase].push(p)
      } catch { /* queda como no encontrado */ }
    }
  }
  const recortarItem = (p, clase) => ({
    clase, id: p.id, 'full-reference': p['full-reference'], reference: p.reference, name: p.name,
    description: (p.description ?? '').slice(0, 300), 'product-category-id': p['product-category-id'] ?? null,
    'sales-price': p['sales-price'] ?? null, inactive: p.inactive ?? false, deleted: p.deleted ?? false,
    'utc-last-modification-date': p['utc-last-modification-date'] ?? null, 'creation-date': p['creation-date'] ?? null,
    'item-rates': (p['item-rates'] ?? []).map((r) => ({ 'rate-id': r['rate-id'], price: r.price })),
  })
  const productos = [...items.products.map((p) => recortarItem(p, 'products')), ...items.services.map((p) => recortarItem(p, 'services'))]

  // U-B-2: tamaño y actividad del maestro de productos en STEL.
  const maestro = await medirMaestro(c)

  return { docs, padresExternos, estados: estados.map((e) => ({ id: e.id, name: e.name, type: e.type, deleted: e.deleted })), clientes, productos, usados: { products: usados.products.size, services: usados.services.size }, maestro, duracionMs: Date.now() - t0 }
}

/** Cuenta con búsqueda binaria sobre `start` (limit=1): ~16 llamadas en vez de ~75 páginas. */
async function contar(c, ruta, params = {}) {
  let lo = 0
  let hi = 1
  const existe = async (i) => (await c.get(ruta, { ...params, sort: 'creation-date:asc', limit: 1, start: i })).length > 0
  if (!(await existe(0))) return 0
  while (await existe(hi)) { lo = hi; hi *= 2 }
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (await existe(mid)) lo = mid; else hi = mid }
  return lo + 1
}

async function medirMaestro(c) {
  const out = {}
  try {
    out.productosTotal = await contar(c, 'products')
    const recientes = await c.get('products', { sort: 'utc-last-modification-date:desc', limit: 200 })
    out.productosModificados = {
      ultimaModificacion: recientes[0]?.['utc-last-modification-date'] ?? null,
      enLosUltimos30Dias: recientes.filter((p) => Date.parse(p['utc-last-modification-date']) > Date.now() - 30 * 864e5).length,
      muestraTope200: recientes.length,
      conPrecioVenta: recientes.filter((p) => num(p['sales-price']) !== null && num(p['sales-price']) > 0).length,
      conTarifas: recientes.filter((p) => (p['item-rates'] ?? []).length > 0).length,
    }
    const creados = await c.get('products', { sort: 'creation-date:desc', limit: 50 })
    out.ultimoProductoCreado = creados[0]?.['creation-date'] ?? null
    out.productosCreadosUltimos30Dias = creados.filter((p) => Date.parse(p['creation-date']) > Date.now() - 30 * 864e5).length
    const tarifas = await c.todos('rates', {}, { limite: 200, maxPaginas: 2 })
    out.tarifas = tarifas.map((t) => ({ id: t.id, name: t.name, deleted: t.deleted }))
    out.categorias = (await c.todos('productCategories', {}, { limite: 200, maxPaginas: 5 })).length
  } catch (e) {
    out.error = limpiar(e.message)
  }
  return out
}

// ── React: lectura ──────────────────────────────────────────────────────────
async function traerTodo(sb, tabla, columnas, filtro, orden = 'id') {
  const out = []
  for (let desde = 0; ; desde += 1000) {
    let q = sb.from(tabla).select(columnas).order(orden).range(desde, desde + 999)
    q = filtro(q)
    const { data, error } = await q
    if (error) throw new Error(`${tabla}: ${error.message}`)
    out.push(...data)
    if (data.length < 1000) return out
  }
}

/** Lee Ventas, clientes, productos, secuencias y autoridad de UNA empresa. Sólo SELECT. */
export async function leerReactEmpresa(sb, slug) {
  const { data: emp, error } = await sb.from('companies').select('id, slug').eq('slug', slug).single()
  if (error) throw new Error('empresa: ' + error.message)
  const BT = emp.id
  const deBT = (q) => q.eq('company_id', BT)
  const docs = {
    quote: await traerTodo(sb, 'sales_quotes', 'id, number, original_number, suspected_normalized_number, number_outlier, customer_id, quote_date, currency_code, exchange_rate, status, title, subtotal, tax_amount, total, discount_pct, perception_pct, external_source, external_id, imported_at, legacy_source, series_code, created_by, needs_review, review_reason', deBT),
    order: await traerTodo(sb, 'sales_orders', 'id, number, original_number, suspected_normalized_number, number_outlier, customer_id, order_date, quote_id, origin, currency_code, exchange_rate, commercial_status, fulfillment_status, title, subtotal, tax_amount, total, discount_pct, perception_pct, external_source, external_id, imported_at, legacy_source, series_code, created_by, needs_review, review_reason', deBT),
    delivery: await traerTodo(sb, 'deliveries', 'id, number, original_number, suspected_normalized_number, number_outlier, customer_id, delivery_date, order_id, status, currency_code, exchange_rate, title, subtotal, tax_amount, total, external_source, external_id, imported_at, legacy_source, series_code, created_by, needs_review, review_reason', deBT),
  }
  const lineas = {
    quote: await traerTodo(sb, 'sales_quote_lines', 'id, quote_id, line_no, product_id, sku_snapshot, name_snapshot, quantity, unit_price, discount_pct, tax_treatment, tax_rate_snapshot, line_type', deBT),
    order: await traerTodo(sb, 'sales_order_lines', 'id, order_id, line_no, product_id, quote_line_id, sku_snapshot, name_snapshot, quantity_ordered, unit_price, discount_pct, tax_treatment, tax_rate_snapshot, line_type', deBT),
    delivery: await traerTodo(sb, 'delivery_lines', 'id, delivery_id, order_line_id, product_id, sku_snapshot, name_snapshot, quantity, unit_price, discount_pct', deBT),
  }
  const clientes = await traerTodo(sb, 'customers', 'id, legal_name, trade_name, legacy_name, tax_id, legacy_ref, status, deleted_at', deBT)
  const productos = await traerTodo(sb, 'products', 'id, sku, name, status, deleted_at, needs_review, legacy_ref', deBT)
  const { data: secuencias } = await sb.from('document_sequences').select('doc_type, prefix, padding, next_number, series_code, is_default').eq('company_id', BT)
  const { data: autoridad } = await sb.from('document_numbering_authority').select('doc_type, authority').eq('company_id', BT)
  return { BT, docs, lineas, clientes, productos, secuencias: secuencias ?? [], autoridad: autoridad ?? [] }
}

/** Estado STEL → estado React. Sólo nombres inequívocos; el resto queda null (revisión). */
export function mapearEstado(tipo, nombre) {
  const n = normTexto(nombre)
  if (tipo === 'quote') return { pendiente: 'sent', 'en curso': 'sent', cerrada: 'accepted', cerrado: 'accepted', aceptada: 'accepted', rechazada: 'rejected' }[n] ?? null
  if (tipo === 'order') return n === 'rechazado' ? 'cancelled' : n ? 'confirmed' : null
  if (tipo === 'delivery') return n ? 'delivered' : null
  return null
}

// ── Comparación ─────────────────────────────────────────────────────────────
export function reconciliar(stel, react) {
  const estadoPorId = new Map(stel.estados.map((e) => [e.id, e.name]))
  const clienteStel = new Map(stel.clientes.map((c) => [c.id, c]))
  const clientesReactPorCuit = new Map()
  const clientesReactPorNombre = new Map()
  for (const c of react.clientes) {
    const cuit = normCuit(c.tax_id)
    if (cuit) clientesReactPorCuit.set(cuit, [...(clientesReactPorCuit.get(cuit) ?? []), c])
    for (const n of new Set([c.legal_name, c.trade_name, c.legacy_name].map(normNombre).filter(Boolean))) {
      clientesReactPorNombre.set(n, [...(clientesReactPorNombre.get(n) ?? []), c])
    }
  }
  const clienteReactPorId = new Map(react.clientes.map((c) => [c.id, c]))

  // Productos
  const prodReactPorSku = new Map()
  const prodReactPorSkuCi = new Map()
  for (const p of react.productos) {
    prodReactPorSku.set(normSku(p.sku), [...(prodReactPorSku.get(normSku(p.sku)) ?? []), p])
    prodReactPorSkuCi.set(normSku(p.sku).toLowerCase(), [...(prodReactPorSkuCi.get(normSku(p.sku).toLowerCase()) ?? []), p])
  }
  const prodReactPorId = new Map(react.productos.map((p) => [p.id, p]))
  const itemStelPorId = new Map(stel.productos.map((p) => [p.id, p]))

  const usosProducto = new Map() // item-id → { referencia, nombre, docs:Set, usos }
  const resolverProducto = (l) => {
    const sku = normSku(l['item-reference'])
    const exactos = prodReactPorSku.get(sku) ?? []
    if (exactos.length === 1) return { clase: 'MATCHED_BY_SKU', producto: exactos[0] }
    if (exactos.length > 1) return { clase: 'AMBIGUOUS_SKU', producto: null }
    const ci = prodReactPorSkuCi.get(sku.toLowerCase()) ?? []
    if (ci.length === 1) return { clase: 'AMBIGUOUS_SKU', producto: null, nota: 'sólo coincide sin distinguir mayúsculas' }
    if (ci.length > 1) return { clase: 'AMBIGUOUS_SKU', producto: null }
    return { clase: 'MISSING_IN_REACT', producto: null }
  }

  const resultado = { documentos: {}, resumen: {}, productos: null, clientes: null, numeracion: {}, relaciones: [], monedas: {} }
  const stelPorId = {}
  const reactPorId = {}
  const matchStelAReact = {} // tipo → Map(stelId → reactDoc)

  for (const t of TIPOS) {
    const docsStel = stel.docs[t.tipo].filter((d) => !d.deleted)
    const docsReact = react.docs[t.tipo]
    stelPorId[t.tipo] = new Map([...docsStel, ...(stel.padresExternos[t.tipo] ?? [])].map((d) => [d.id, d]))
    reactPorId[t.tipo] = new Map(docsReact.map((d) => [d.id, d]))
    const reactPorClave = new Map()
    for (const d of docsReact) {
      const k = claveNumero(d.original_number ?? d.number)
      reactPorClave.set(k, [...(reactPorClave.get(k) ?? []), d])
    }
    const lineasReact = new Map()
    for (const l of react.lineas[t.tipo]) lineasReact.set(l[t.fk], [...(lineasReact.get(l[t.fk]) ?? []), l])

    const filas = []
    const reactUsados = new Set()
    const m = new Map()
    for (const s of docsStel) {
      const ref = s['full-reference']
      const candidatos = (reactPorClave.get(claveNumero(ref)) ?? []).filter((d) => !reactUsados.has(d.id))
      let r = null
      let via = null
      const exacto = candidatos.find((d) => (d.original_number ?? d.number) === ref)
      if (exacto) { r = exacto; via = 'NUMERO_EXACTO' } else if (candidatos.length === 1) { r = candidatos[0]; via = 'NUMERO_SIN_CEROS' }
      if (!r) {
        // Número atípico de la importación (PDV11xxx): sólo si la sospecha coincide
        // Y la fecha, el cliente y el total confirman.
        const sosp = docsReact.filter((d) => d.number_outlier && !reactUsados.has(d.id) && claveNumero(d.suspected_normalized_number) === claveNumero(ref))
        if (sosp.length === 1 && dia(sosp[0][t.fecha]) === dia(s.date) && iguales(num(sosp[0].total), num(s['total-amount']))) { r = sosp[0]; via = 'NUMERO_SOSPECHADO_CONFIRMADO' }
      }
      if (r) { reactUsados.add(r.id); m.set(s.id, r) }
      filas.push(compararDoc(t, s, r, via, lineasReact.get(r?.id) ?? []))
    }
    matchStelAReact[t.tipo] = m
    for (const d of docsReact) {
      if (reactUsados.has(d.id)) continue
      filas.push({ numero: d.original_number ?? d.number, clase: 'REACT_ONLY', react: { id: d.id, fecha: d[t.fecha], moneda: d.currency_code, total: num(d.total), origen: d.legacy_source ?? d.external_source ?? (d.created_by ? 'manual' : 'desconocido'), importado: Boolean(d.imported_at), atipico: d.number_outlier } })
    }
    resultado.documentos[t.tipo] = filas
  }

  // Relaciones quote → order → delivery según STEL (parent-document-id).
  for (const [hijo, padreEsperado, campo] of [['order', 'quote', 'quote_id'], ['delivery', 'order', 'order_id']]) {
    for (const s of stel.docs[hijo].filter((d) => !d.deleted)) {
      const fila = resultado.documentos[hijo].find((f) => f.stel?.id === s.id)
      const pid = s['parent-document-id']
      const tipoPadre = pid ? (tipoDePath(s['parent-document-path']) ?? padreEsperado) : padreEsperado
      // Un remito que en STEL sale directo de una cotización: React no tiene dónde guardarlo.
      if (pid && tipoPadre !== padreEsperado) {
        const pq = stelPorId[tipoPadre]?.get(pid) ?? null
        const rel = { tipo: `${tipoPadre}→${hijo}`, hijo: s['full-reference'], padre: pq?.['full-reference'] ?? `${tipoPadre}:${pid}`, estado: 'PADRE_DE_OTRO_TIPO_SIN_CAMPO_EN_REACT', monedaPadreStel: pq?.['currency-code'] ?? null, monedaHijoStel: s['currency-code'] ?? null, cambiaMonedaEnStel: Boolean(pq && pq['currency-code'] !== s['currency-code']), reactPadreActual: null, reactPadreEsperado: null, reactHijoId: matchStelAReact[hijo].get(s.id)?.id ?? null, reactPadreEsperadoId: null, padreFueraDePeriodo: false }
        resultado.relaciones.push(rel)
        if (fila) fila.relacion = { estado: rel.estado, padre: rel.padre, cambiaMonedaEnStel: rel.cambiaMonedaEnStel }
        continue
      }
      const padre = padreEsperado
      const padreStel = pid ? stelPorId[padre].get(pid) : null
      const rHijo = matchStelAReact[hijo].get(s.id) ?? null
      const rPadreEsperado = padreStel ? (matchStelAReact[padre].get(padreStel.id) ?? null) : null
      let estado
      if (!pid) estado = rHijo?.[campo] ? 'REACT_TIENE_VINCULO_QUE_STEL_NO' : 'SIN_PADRE_EN_STEL'
      else if (!padreStel) estado = 'PADRE_NO_LEIDO'
      else if (!matchStelAReact[padre].get(padreStel.id) && !(stel.docs[padre] ?? []).some((d) => d.id === padreStel.id)) estado = 'PADRE_ANTERIOR_AL_PERIODO'
      else if (!rHijo) estado = 'HIJO_FALTA_EN_REACT'
      else if (!rPadreEsperado) estado = 'PADRE_FALTA_EN_REACT'
      else if (rHijo[campo] === rPadreEsperado.id) estado = 'OK'
      else if (!rHijo[campo]) estado = 'FALTA_VINCULO_EN_REACT'
      else estado = 'VINCULO_DISTINTO_EN_REACT'
      const monedaHijo = s['currency-code'] ?? null
      const monedaPadre = padreStel?.['currency-code'] ?? null
      const rel = {
        tipo: `${padre}→${hijo}`, hijo: s['full-reference'], padre: padreStel?.['full-reference'] ?? (pid ? `id:${pid}` : null), estado,
        monedaPadreStel: monedaPadre, monedaHijoStel: monedaHijo, cambiaMonedaEnStel: Boolean(padreStel && monedaPadre !== monedaHijo),
        reactPadreActual: rHijo?.[campo] ? (reactPorId[padre].get(rHijo[campo])?.original_number ?? rHijo[campo]) : null,
        reactPadreEsperado: rPadreEsperado?.original_number ?? null,
        reactHijoId: rHijo?.id ?? null, reactPadreEsperadoId: rPadreEsperado?.id ?? null,
        padreFueraDePeriodo: Boolean(padreStel && !(stel.docs[padre] ?? []).some((d) => d.id === padreStel.id)),
      }
      resultado.relaciones.push(rel)
      if (fila) fila.relacion = { estado, padre: rel.padre, cambiaMonedaEnStel: rel.cambiaMonedaEnStel }
    }
  }

  // Clientes por documento.
  const resumenClientes = { POR_CUIT_OK: 0, POR_NOMBRE_OK: 0, VINCULO_DISTINTO: 0, AMBIGUO: 0, SIN_MATCH: 0, CLIENTE_STEL_NO_LEIDO: 0 }
  const detalleClientes = new Map()
  for (const t of TIPOS) {
    for (const f of resultado.documentos[t.tipo]) {
      if (!f.stel) continue
      const cs = clienteStel.get(f.stel.accountId)
      let clase
      let candidato = null
      if (!cs) clase = 'CLIENTE_STEL_NO_LEIDO'
      else {
        const porCuit = clientesReactPorCuit.get(normCuit(cs['tax-identification-number'])) ?? []
        const porNombre = [...new Map([...(clientesReactPorNombre.get(normNombre(cs['legal-name'])) ?? []), ...(clientesReactPorNombre.get(normNombre(cs.name)) ?? [])].map((c) => [c.id, c])).values()]
        if (porCuit.length === 1) { candidato = porCuit[0]; clase = 'POR_CUIT' } else if (porCuit.length > 1) clase = 'AMBIGUO'
        else if (porNombre.length === 1) { candidato = porNombre[0]; clase = 'POR_NOMBRE' } else if (porNombre.length > 1) clase = 'AMBIGUO'
        else clase = 'SIN_MATCH'
        if (candidato && f.react) clase = f.react.customerId === candidato.id ? `${clase}_OK` : 'VINCULO_DISTINTO'
        else if (candidato && !f.react) clase = `${clase}_OK`
      }
      resumenClientes[clase] = (resumenClientes[clase] ?? 0) + 1
      f.cliente = { clase, stelClienteId: f.stel.accountId, reactCustomerIdPropuesto: candidato?.id ?? null }
      if (cs && clase !== 'POR_CUIT_OK' && clase !== 'POR_NOMBRE_OK') {
        detalleClientes.set(cs.id, { stelId: cs.id, stelRef: cs['full-reference'], razonSocial: cs['legal-name'], cuit: normCuit(cs['tax-identification-number']), clase, reactActual: f.react ? clienteReactPorId.get(f.react.customerId)?.legal_name ?? null : null, candidato: candidato?.legal_name ?? null })
      }
    }
  }
  resultado.clientes = { resumen: resumenClientes, aRevisar: [...detalleClientes.values()] }

  // Productos por línea.
  const resumenLineasProducto = { MATCHED_BY_SKU: 0, MISSING_IN_REACT: 0, AMBIGUOUS_SKU: 0, WRONG_LINK: 0, NAME_MISMATCH: 0, NAME_VARIANT: 0, SIN_PRODUCTO_EN_REACT_CON_SKU_RESUELTO: 0, INACTIVE: 0, SERVICIO: 0, SIN_REFERENCIA: 0 }
  for (const t of TIPOS) {
    for (const f of resultado.documentos[t.tipo]) {
      if (!f.stel) continue
      for (const ls of f.lineasStel) {
        if (!ls.sku) { resumenLineasProducto.SIN_REFERENCIA++; ls.producto = { clase: 'SIN_REFERENCIA' }; continue }
        const res = resolverProducto({ 'item-reference': ls.sku })
        const item = itemStelPorId.get(ls.itemId)
        const clases = [res.clase]
        if (ls.esServicio) clases.push('SERVICIO')
        if (res.producto) { const sim = similitud(res.producto.name, ls.nombre); if (sim < 1) clases.push(sim < 0.34 ? 'NAME_MISMATCH' : 'NAME_VARIANT') }
        if ((item && (item.inactive || item.deleted)) || ls.itemBorrado || (res.producto && (res.producto.status !== 'active' || res.producto.deleted_at))) clases.push('INACTIVE')
        if (ls.reactLinea?.product_id && res.producto && ls.reactLinea.product_id !== res.producto.id) clases.push('WRONG_LINK')
        if (ls.reactLinea?.product_id && !res.producto) clases.push('WRONG_LINK')
        if (ls.reactLinea && !ls.reactLinea.product_id && res.producto) clases.push('SIN_PRODUCTO_EN_REACT_CON_SKU_RESUELTO')
        for (const c of new Set(clases)) resumenLineasProducto[c] = (resumenLineasProducto[c] ?? 0) + 1
        ls.producto = { clases: [...new Set(clases)], reactProductId: res.producto?.id ?? null, reactProductIdActual: ls.reactLinea?.product_id ?? null, nota: res.nota ?? null }
        const u = usosProducto.get(ls.itemId) ?? { stelId: ls.itemId, sku: ls.sku, descripcion: ls.nombre, clase: ls.esServicio ? 'services' : 'products', resolucion: res.clase, docs: new Set(), usos: 0, stel: item ?? null, reactProductId: res.producto?.id ?? null, reactNombre: res.producto?.name ?? null }
        u.docs.add(f.numero)
        u.usos++
        usosProducto.set(ls.itemId, u)
      }
    }
  }
  const productos = [...usosProducto.values()].map((u) => ({
    ...u, docs: [...u.docs].sort(),
    similitudNombre: u.reactNombre ? similitud(u.reactNombre, u.stel?.name ?? u.descripcion) : null,
    nameMismatch: Boolean(u.reactNombre && similitud(u.reactNombre, u.stel?.name ?? u.descripcion) < 0.34),
    nameVariant: Boolean(u.reactNombre && similitud(u.reactNombre, u.stel?.name ?? u.descripcion) < 1 && similitud(u.reactNombre, u.stel?.name ?? u.descripcion) >= 0.34),
    inactivoEnStel: Boolean(u.stel?.inactive || u.stel?.deleted), noLeidoDeStel: !u.stel,
  }))
  resultado.productos = {
    resumenPorLinea: resumenLineasProducto,
    distintos: productos.length,
    porResolucion: productos.reduce((a, p) => ({ ...a, [p.resolucion]: (a[p.resolucion] ?? 0) + 1 }), {}),
    faltantes: productos.filter((p) => p.resolucion === 'MISSING_IN_REACT').map((p) => ({ STEL_ID: p.stelId, SKU: p.sku, DESCRIPCION: p.stel?.name ?? p.descripcion, CLASE: p.clase, DOCUMENTOS: p.docs, USOS: p.usos, INACTIVO_EN_STEL: p.inactivoEnStel, CATEGORIA_STEL: p.stel?.['product-category-id'] ?? null, PRECIO_STEL: p.stel?.['sales-price'] ?? null })),
    ambiguos: productos.filter((p) => p.resolucion === 'AMBIGUOUS_SKU'),
    nombreDistinto: productos.filter((p) => p.nameMismatch).map((p) => ({ STEL_ID: p.stelId, SKU: p.sku, STEL: p.stel?.name ?? p.descripcion, REACT: p.reactNombre, USOS: p.usos, SIMILITUD: p.similitudNombre })),
    nombreVariante: productos.filter((p) => p.nameVariant).length,
    inactivosEnStel: productos.filter((p) => p.inactivoEnStel).map((p) => ({ STEL_ID: p.stelId, SKU: p.sku, RESOLUCION: p.resolucion, USOS: p.usos })),
  }

  // Monedas.
  const monedas = { MATCH: 0, MISSING_IN_REACT: 0, DIFFERENT: 0, MISSING_IN_STEL: 0, sinMonedaEnReact: [] }
  for (const t of TIPOS) {
    for (const f of resultado.documentos[t.tipo]) {
      if (f.clase === 'REACT_ONLY') { if (!f.react.moneda) monedas.sinMonedaEnReact.push({ tipo: t.tipo, numero: f.numero, stel: 'DOCUMENTO_NO_ESTA_EN_STEL' }); continue }
      if (f.moneda) monedas[f.moneda.clase]++
      if (f.react && !f.react.moneda) monedas.sinMonedaEnReact.push({ tipo: t.tipo, numero: f.numero, stel: f.stel.moneda })
    }
  }
  resultado.monedas = monedas

  // Resumen por tipo.
  for (const t of TIPOS) {
    const filas = resultado.documentos[t.tipo]
    const cuenta = (fn) => filas.filter(fn).length
    resultado.resumen[t.tipo] = {
      STEL_COUNT: stel.docs[t.tipo].filter((d) => !d.deleted).length,
      REACT_COUNT: react.docs[t.tipo].length,
      MATCHED: cuenta((f) => f.clase === 'MATCHED'),
      STEL_ONLY: cuenta((f) => f.clase === 'STEL_ONLY'),
      REACT_ONLY: cuenta((f) => f.clase === 'REACT_ONLY'),
      HEADER_MISMATCH: cuenta((f) => f.cabecera?.length > 0),
      LINE_MISMATCH: cuenta((f) => f.lineas?.difieren),
      TOTAL_MISMATCH: cuenta((f) => f.totales?.reactVsStel.total === false),
      SUBTOTAL_TAX_MISMATCH: cuenta((f) => f.totales && f.totales.reactVsStel.total !== false && (f.totales.reactVsStel.subtotal === false || f.totales.reactVsStel.tax === false)),
      EXCHANGE_RATE_INFO: cuenta((f) => f.cabeceraInformativa?.some((c) => c.campo === 'tipo_cambio')),
      LINE_ORDER_ONLY: cuenta((f) => f.ordenLineasDistinto && !f.lineas?.difieren),
      STEL_TOTALES_INTERNOS: cuenta((f) => f.totales?.stelInterno.length > 0),
      CURRENCY_MISMATCH: cuenta((f) => f.moneda && f.moneda.clase !== 'MATCH'),
      CUSTOMER_MISMATCH: cuenta((f) => f.cliente && !['POR_CUIT_OK', 'POR_NOMBRE_OK'].includes(f.cliente.clase)),
      RELATION_MISMATCH: t.tipo === 'quote' ? null : cuenta((f) => f.relacion && ['FALTA_VINCULO_EN_REACT', 'VINCULO_DISTINTO_EN_REACT', 'REACT_TIENE_VINCULO_QUE_STEL_NO'].includes(f.relacion.estado)),
      STATUS_DIFFERENT: cuenta((f) => f.estadoMapeado && f.react && f.estadoMapeado !== f.react.estado),
    }
  }

  // Numeración.
  for (const t of TIPOS) {
    const seriesStel = stel.docs[t.tipo].filter((d) => !d.deleted).map((d) => ({ ...partesNumero(d['full-reference']), ref: d['full-reference'], id: d.id, fecha: d.date, creacion: d['creation-date'] })).filter((x) => x.prefijo)
    const principal = seriesStel.filter((x) => x.prefijo === t.prefijo)
    const todosOrdenados = [...principal].sort((a, b) => a.n - b.n)
    // Atípicos: todo lo que queda después del primer salto de más de 1000 números.
    const corte = todosOrdenados.findIndex((x, i) => i > 0 && x.n - todosOrdenados[i - 1].n > 1000)
    const ordenados = corte > 0 ? todosOrdenados.slice(0, corte) : todosOrdenados
    const atipicos = corte > 0 ? todosOrdenados.slice(corte).map((x) => x.ref) : []
    const max = ordenados.at(-1) ?? null
    const ultimoCreado = [...seriesStel].sort((a, b) => Date.parse(b.creacion) - Date.parse(a.creacion))[0] ?? null
    const duplicados = [...principal.reduce((mm, x) => mm.set(x.n, (mm.get(x.n) ?? 0) + 1), new Map())].filter(([, c]) => c > 1).map(([n]) => n)
    const huecos = []
    for (let i = 1; i < ordenados.length; i++) for (let n = ordenados[i - 1].n + 1; n < ordenados[i].n && huecos.length < 200; n++) huecos.push(n)
    const reactMax = react.docs[t.tipo].map((d) => ({ ...partesNumero(d.original_number ?? d.number), ref: d.original_number ?? d.number, atipico: d.number_outlier })).filter((x) => x.prefijo === t.prefijo && !x.atipico).sort((a, b) => a.n - b.n).at(-1) ?? null
    const seq = react.secuencias.filter((s) => s.doc_type === t.secuencia)
    const colisiones = seq.map((s) => ({ serie: s.series_code, prefijo: s.prefix, proximo: s.next_number, proximoFormateado: `${s.prefix}${String(s.next_number).padStart(s.padding, '0')}`, yaUsadoEnStel: principal.some((x) => x.n === Number(s.next_number) && s.prefix === t.prefijo), numerosReactQueYaUsoStel: max ? Math.max(0, max.n + 1 - Number(s.next_number)) : null, stelMayor: max?.n ?? null, proximoSeguroMinimo: max ? `${s.prefix}${String(max.n + 1).padStart(s.padding, '0')}` : null }))
    resultado.numeracion[t.tipo] = {
      stelMayor: max ? { ref: max.ref, id: max.id, fecha: max.fecha, creacion: max.creacion } : null,
      stelUltimoCreado: ultimoCreado ? { ref: ultimoCreado.ref, id: ultimoCreado.id, creacion: ultimoCreado.creacion } : null,
      stelAtipicos: atipicos,
      stelFueraDePatron: seriesStel.filter((x) => x.prefijo !== t.prefijo).map((x) => x.ref),
      stelSinPatron: stel.docs[t.tipo].filter((d) => !partesNumero(d['full-reference'])).map((d) => d['full-reference']),
      stelDuplicados: duplicados, stelHuecosEnPeriodo: huecos,
      reactMayorNoAtipico: reactMax?.ref ?? null, secuencias: colisiones,
      autoridad: react.autoridad.find((a) => a.doc_type === t.secuencia)?.authority ?? null,
      reactNumerosUsadosPorOtroDocEnStel: resultado.documentos[t.tipo].filter((f) => f.clase === 'MATCHED' && f.identidad === 'DISTINTO_DOCUMENTO').map((f) => f.numero),
    }
  }

  // Delta: lo que STEL tiene y React no, desde el último documento realmente sincronizado.
  resultado.delta = {}
  for (const t of TIPOS) {
    const emparejados = resultado.documentos[t.tipo].filter((f) => f.clase === 'MATCHED')
    const ultimo = emparejados.map((f) => f.stel.creacion).sort().at(-1) ?? null
    const solo = resultado.documentos[t.tipo].filter((f) => f.clase === 'STEL_ONLY')
    resultado.delta[t.tipo] = {
      ultimoSincronizadoCreacion: ultimo,
      posteriores: solo.filter((f) => !ultimo || f.stel.creacion > ultimo).map((f) => f.numero),
      anterioresFaltantes: solo.filter((f) => ultimo && f.stel.creacion <= ultimo).map((f) => f.numero),
    }
  }

  function compararDoc(t, s, r, via, lineasR) {
    const calc = recalcularStel(s)
    const lineasS = (s.lines ?? []).filter((l) => !l.deleted)
    const noItems = lineasS.filter((l) => l['line-type'] !== 'ITEM')
    const items = lineasS.filter((l) => l['line-type'] === 'ITEM').sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    const fila = {
      numero: s['full-reference'], clase: r ? 'MATCHED' : 'STEL_ONLY', via,
      stel: {
        id: s.id, fecha: dia(s.date), creacion: s['creation-date'], modificacion: s['utc-last-modification-date'],
        accountId: s['account-id'], agenteId: s['agent-id'], estado: estadoPorId.get(s['document-state-id']) ?? s['document-state-id'],
        moneda: s['currency-code'], tipoCambio: num(s['currency-rate']), titulo: s.title,
        descuentoPct: num(s['discount-percentage']), descuentoMonto: num(s['discount-total-amount']),
        subtotal: num(s['subtotal-amount']), impuestos: num(s['tax-total-amount']), total: num(s['total-amount']),
        percepcionPct: num(s['income-tax-percentage']), padreId: s['parent-document-id'],
        lineasItem: items.length, lineasNoItem: noItems.map((l) => l['line-type']), lineasCantidadCero: items.filter((l) => (num(l.units) ?? 0) === 0).length,
      },
      calculo: calc,
      react: r ? { id: r.id, customerId: r.customer_id, fecha: r[t.fecha], moneda: r.currency_code, tipoCambio: num(r.exchange_rate), subtotal: num(r.subtotal), impuestos: num(r.tax_amount), total: num(r.total), estado: r.status ?? r.commercial_status, titulo: r.title, lineas: lineasR.length } : null,
    }
    fila.estadoMapeado = mapearEstado(t.tipo, fila.stel.estado)
    fila.totales = clasificarTotales(s, calc, r)
    fila.moneda = {
      stel: s['currency-code'] ?? null, react: r?.currency_code ?? null,
      clase: !s['currency-code'] ? 'MISSING_IN_STEL' : !r ? 'MISSING_IN_REACT' : !r.currency_code ? 'MISSING_IN_REACT' : r.currency_code === s['currency-code'] ? 'MATCH' : 'DIFFERENT',
    }
    if (!r) { fila.moneda.clase = s['currency-code'] ? 'MISSING_IN_REACT' : 'MISSING_IN_STEL'; fila.moneda.documentoFaltante = true }

    // Líneas: en orden, sin cantidad 0 (la importación las descartó a propósito).
    const itemsComparables = items.filter((l) => (num(l.units) ?? 0) !== 0)
    const lr = t.tipo === 'delivery' ? [...lineasR] : [...lineasR].sort((a, b) => a.line_no - b.line_no)
    fila.lineasStel = itemsComparables.map((l, i) => ({
      stelLineaId: l.id, orden: l.order, itemId: l['item-id'], sku: normSku(l['item-reference']), nombre: l['item-name'],
      esServicio: /\/services\//.test(l['item-path'] ?? ''), itemBorrado: Boolean(l['item-deleted']),
      cantidad: num(l.units), precio: num(l['item-base-price']), descuento: num(l['discount-percentage']) ?? 0,
      neto: num(l['total-amount']), iva: num(l['primary-tax-percentage']), cierra: lineaCierra(l), padreLineaId: l['parent-document-id'],
      reactLinea: null, _i: i,
    }))
    if (r) {
      const difs = []
      if (t.tipo === 'delivery') {
        // Remitos React sin line_no: multiconjunto SKU+cantidad.
        const pendientes = [...lr]
        for (const ls of fila.lineasStel) {
          const j = pendientes.findIndex((x) => normSku(x.sku_snapshot) === ls.sku && iguales(num(x.quantity), ls.cantidad, 0.0001))
          if (j >= 0) { ls.reactLinea = pendientes[j]; pendientes.splice(j, 1) } else difs.push({ stelLinea: ls.stelLineaId, sku: ls.sku, motivo: 'SIN_LINEA_REACT_EQUIVALENTE', stelCantidad: ls.cantidad })
        }
        for (const x of pendientes) difs.push({ reactLinea: x.id, sku: x.sku_snapshot, motivo: 'LINEA_SOLO_EN_REACT', reactCantidad: num(x.quantity) })
      } else {
        // Emparejado por contenido: el sync guardaba el orden del arreglo, no el campo `order`.
        const cantR = (x) => num(t.tipo === 'order' ? x.quantity_ordered : x.quantity)
        const libres = new Set(lr.map((x) => x.id))
        const tomar = (pred, ls, i) => {
          const candidatos = lr.filter((x) => libres.has(x.id) && pred(x))
          const x = candidatos.find((c) => c.line_no === i + 1) ?? candidatos[0]
          if (x) { libres.delete(x.id); ls.reactLinea = x }
        }
        fila.lineasStel.forEach((ls, i) => tomar((x) => normSku(x.sku_snapshot) === ls.sku && iguales(cantR(x), ls.cantidad, 0.0001) && iguales(num(x.unit_price), ls.precio, 0.05), ls, i))
        fila.lineasStel.forEach((ls, i) => { if (!ls.reactLinea) tomar((x) => normSku(x.sku_snapshot) === ls.sku, ls, i) })
        fila.lineasStel.forEach((ls, i) => { if (!ls.reactLinea && lr.length === fila.lineasStel.length) tomar((x) => x.line_no === i + 1, ls, i) })
        let ordenDistinto = false
        for (const [i, ls] of fila.lineasStel.entries()) {
          const x = ls.reactLinea
          if (!x) { difs.push({ posicion: i + 1, stelLinea: ls.stelLineaId, sku: ls.sku, motivo: 'LINEA_SOLO_EN_STEL' }); continue }
          if (x.line_no !== i + 1) ordenDistinto = true
          const campos = []
          if (normSku(x.sku_snapshot) !== ls.sku) campos.push({ campo: 'sku', react: x.sku_snapshot, stel: ls.sku })
          const cant = cantR(x)
          if (!iguales(cant, ls.cantidad, 0.0001)) campos.push({ campo: 'cantidad', react: cant, stel: ls.cantidad })
          if (!iguales(num(x.unit_price), ls.precio)) campos.push({ campo: 'precio', react: num(x.unit_price), stel: ls.precio, soloRedondeo: iguales(num(x.unit_price), ls.precio, 0.05) })
          if (!iguales(num(x.discount_pct), ls.descuento, 0.001)) campos.push({ campo: 'descuento', react: num(x.discount_pct), stel: ls.descuento })
          if (campos.length) difs.push({ posicion: i + 1, stelLinea: ls.stelLineaId, reactLinea: x.id, sku: ls.sku, campos })
        }
        for (const x of lr.filter((y) => libres.has(y.id))) difs.push({ reactLinea: x.id, sku: x.sku_snapshot, motivo: 'LINEA_SOLO_EN_REACT', posicionReact: x.line_no })
        fila.ordenLineasDistinto = ordenDistinto
      }
      fila.lineas = { stel: fila.lineasStel.length, react: lr.length, difieren: difs.length > 0, diferencias: difs, soloPrecioRedondeo: difs.length > 0 && difs.every((d) => d.campos && d.campos.every((c) => c.campo === 'precio' && c.soloRedondeo)) }

      const cab = []
      if (dia(r[t.fecha]) !== dia(s.date)) cab.push({ campo: 'fecha', react: dia(r[t.fecha]), stel: dia(s.date) })
      if ((r.currency_code ?? null) !== (s['currency-code'] ?? null)) cab.push({ campo: 'moneda', react: r.currency_code, stel: s['currency-code'] })
      if (s['currency-code'] && s['currency-code'] !== 'USD' && !iguales(num(r.exchange_rate), num(s['currency-rate']), 0.000001)) cab.push({ campo: 'tipo_cambio', react: num(r.exchange_rate), stel: num(s['currency-rate']), informativo: true, nota: 'STEL: unidades de USD por unidad de la moneda del documento; React: campo libre sin semántica fijada' })
      if (!iguales(num(r.subtotal), num(s['subtotal-amount']))) cab.push({ campo: 'subtotal', react: num(r.subtotal), stel: num(s['subtotal-amount']) })
      if (!iguales(num(r.tax_amount), num(s['tax-total-amount']))) cab.push({ campo: 'impuestos', react: num(r.tax_amount), stel: num(s['tax-total-amount']) })
      if (!iguales(num(r.total), num(s['total-amount']))) cab.push({ campo: 'total', react: num(r.total), stel: num(s['total-amount']) })
      if (normTexto(r.title) !== normTexto(s.title)) cab.push({ campo: 'titulo', react: r.title, stel: s.title, informativo: true })
      fila.cabecera = cab.filter((c) => !c.informativo)
      fila.cabeceraInformativa = cab.filter((c) => c.informativo)
      // ¿Mismo número, otro documento? Fecha distinta Y total distinto.
      fila.identidad = dia(r[t.fecha]) !== dia(s.date) && !iguales(num(r.total), num(s['total-amount'])) ? 'DISTINTO_DOCUMENTO' : 'MISMO_DOCUMENTO'
    }
    for (const ls of fila.lineasStel) delete ls._i
    return fila
  }

  return resultado
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const BASE = process.env.VITE_SUPABASE_URL
  const SECRET = process.env.SUPABASE_SECRET_KEY
  if (!BASE || !SECRET) { console.error('✗ Faltan VITE_SUPABASE_URL / SUPABASE_SECRET_KEY'); process.exit(1) }
  const sb = createClient(BASE, SECRET, { auth: { persistSession: false } })
  console.log('═'.repeat(74))
  console.log('  FASE 14 · E1 — AUDITORÍA STEL API vs REACT (SÓLO LECTURA)')
  console.log('═'.repeat(74))
  console.log(`  período desde ${DESDE} · presupuesto ${MAX_LLAMADAS} llamadas · cache ${USAR_CACHE ? 'sí' : 'no'}`)
  const c = crearCliente({ maxLlamadas: MAX_LLAMADAS, usarCache: USAR_CACHE })

  console.log('\n── STEL ──')
  const stel = await leerStel(c)
  console.log(`  cotizaciones ${stel.docs.quote.length} · pedidos ${stel.docs.order.length} · remitos ${stel.docs.delivery.length} · clientes ${stel.clientes.length} · ítems ${stel.productos.length} · llamadas ${c.llamadas()} · ${Math.round(stel.duracionMs / 1000)} s`)

  console.log('\n── REACT ──')
  const react = await leerReactEmpresa(sb, 'buscatools')
  console.log(`  cotizaciones ${react.docs.quote.length} · pedidos ${react.docs.order.length} · remitos ${react.docs.delivery.length} · clientes ${react.clientes.length} · productos ${react.productos.length}`)

  const res = reconciliar(stel, react)
  fs.mkdirSync(SALIDA_DIR, { recursive: true })
  const meta = { generado: new Date().toISOString(), desde: DESDE, tolerancia: TOL, llamadasStel: c.llamadas(), registroLlamadas: c.registro.map((x) => ({ ruta: x.ruta.replace(/\/\d+$/, '/{id}'), estado: x.estado, ms: x.ms, n: x.n })) }
  fs.writeFileSync(SALIDA, JSON.stringify({ meta, stelMaestro: stel.maestro, stelUsados: stel.usados, padresNoEncontrados: stel.padresExternos.noEncontrados, ...res }, null, 1))
  fs.writeFileSync(SNAPSHOT, JSON.stringify({ meta, stel, reactBT: react.BT }, null, 0))

  console.log('\n── RESUMEN ──')
  console.table(res.resumen)
  console.log('  productos por línea:', res.productos.resumenPorLinea)
  console.log('  productos distintos:', res.productos.distintos, res.productos.porResolucion)
  console.log('  clientes por documento:', res.clientes.resumen)
  const { sinMonedaEnReact, ...mon } = res.monedas
  console.log('  monedas:', mon, '· sin moneda en React:', sinMonedaEnReact.length)
  console.log('  relaciones:', res.relaciones.reduce((a, r) => ({ ...a, [r.estado]: (a[r.estado] ?? 0) + 1 }), {}), '· cambian de moneda en STEL:', res.relaciones.filter((r) => r.cambiaMonedaEnStel).length)
  for (const t of TIPOS) {
    const n = res.numeracion[t.tipo]
    console.log(`  numeración ${t.tipo}: STEL mayor ${n.stelMayor?.ref} (${n.stelMayor?.fecha?.slice(0, 10)}) · último creado ${n.stelUltimoCreado?.ref} ${n.stelUltimoCreado?.creacion} · React mayor ${n.reactMayorNoAtipico} · huecos ${n.stelHuecosEnPeriodo.length} · duplicados ${n.stelDuplicados.length}`)
  }
  console.log('  delta:', Object.fromEntries(Object.entries(res.delta).map(([k, v]) => [k, v.posteriores.length])))
  console.log('  maestro STEL:', { total: stel.maestro.productosTotal, ...stel.maestro.productosModificados, tarifas: stel.maestro.tarifas?.length, categorias: stel.maestro.categorias, error: stel.maestro.error })
  console.log(`\n  llamadas a STEL: ${c.llamadas()} · detalle: ${path.relative(process.cwd(), SALIDA)} (ignorado por git)`)
}

if (import.meta.url.endsWith(path.basename(process.argv[1] ?? ''))) {
  main().catch((e) => { console.error('✗', limpiar(e.message)); process.exit(1) })
}
