/*
 * Fase 94 · importar el RESTO del circuito de Torquetools desde StelOrder. ESCRIBE.
 *
 * La fase 93 trajo las facturas. Ésta trae lo demás, como histórico puro para
 * que se vea en el ERP, SIN mover stock ni contabilidad:
 *
 *   VENTA    cotizaciones      salesEstimates       → sales_quotes      + sales_quote_lines
 *            pedidos           salesOrders          → sales_orders      + sales_order_lines
 *            albaranes/remitos salesDeliveryNotes   → deliveries        + delivery_lines
 *   COMPRA   pedidos a prov.   purchaseOrders       → purchase_orders   + purchase_order_lines
 *            notas de entrega  purchaseDeliveryNotes→ goods_receipts    + goods_receipt_lines
 *
 * Cómo NO disparar efectos operativos (lo que enseñaron los triggers):
 *   · corre con la clave de servicio → rol service_role, que saltea las
 *     protecciones que miran auth.role() y escribe los campos de importación;
 *   · deliveries nacen 'delivered' pero con imported_at puesto, que es la única
 *     forma en que proteger_estado_entrega admite un remito que no es borrador
 *     sin despacharlo — y NO hay trigger de stock en deliveries, así que el
 *     inventario no se toca;
 *   · goods_receipts quedan en 'draft': 'confirmed' mueve stock y sólo lo hace
 *     confirmar_recepcion(). Igual criterio que las facturas de compra;
 *   · purchase_orders entran en 'draft', se les cargan las líneas (una PO no
 *     cancelada admite líneas) y recién después pasan a 'confirmed'/'cancelled'.
 *
 * Relaciona por los mismos ejes que la fase 93: cliente/proveedor por
 * full-reference = legacy_ref, producto por SKU = item-reference. Lo que no
 * matchea un producto va con product_id null + sku_snapshot. Idempotente.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const rd = (f) => Object.fromEntries(readFileSync(f, 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '').trim()]))
const env = rd('.env'), mig = rd('.env.migration')
const sb = createClient(env.VITE_SUPABASE_URL, mig.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
const CID = '492a0ee9-220f-4dc8-9eaa-ec914ea10907'
const DIR = process.argv[2] || 'scripts/.stel-tt'
const L = (f) => JSON.parse(readFileSync(join(DIR, f + '.json'), 'utf8'))

const fecha = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null)
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const txt = (v) => { const s = String(v ?? '').trim(); return s === '' ? null : s }
const tax = (p) => { const n = num(p); return n === 21 ? 'vat_21' : n === 10.5 ? 'vat_105' : n === 0 ? 'vat_0' : 'other' }
const cur = (o) => txt(o['currency-code']) ?? 'EUR'
const esItem = (l) => l['line-type'] === 'ITEM' && num(l.units) > 0

async function paginar(tabla, sel, filtro) {
  const out = []; let d = 0
  for (;;) { let q = sb.from(tabla).select(sel).eq('company_id', CID).range(d, d + 999); if (filtro) q = filtro(q); const { data, error } = await q; if (error) throw error; out.push(...data); if (data.length < 1000) break; d += 1000 }
  return out
}
async function enLotes(filas, tam, fn) { for (let i = 0; i < filas.length; i += tam) await fn(filas.slice(i, i + tam)) }
async function insertar(tabla, filas) { await enLotes(filas, 300, async (lote) => { const { error } = await sb.from(tabla).insert(lote); if (error) throw new Error(`${tabla}: ${error.message}`) }) }

async function main() {
  const clients = L('clients'), suppliersJson = L('suppliers')
  const custRefFromAcct = new Map(clients.map((c) => [c.id, c['full-reference']]))
  const supRefFromAcct = new Map(suppliersJson.map((s) => [s.id, s['full-reference']]))
  const custById = new Map((await paginar('customers', 'id, legacy_ref', (q) => q)).filter((c) => c.legacy_ref).map((c) => [c.legacy_ref, c.id]))
  const supById = new Map((await paginar('suppliers', 'id, legacy_ref', (q) => q)).filter((s) => s.legacy_ref).map((s) => [s.legacy_ref, s.id]))
  const prodBySku = new Map((await paginar('products', 'id, sku', (q) => q)).map((p) => [p.sku, p.id]))
  const whs = await paginar('warehouses', 'id, is_active, created_at', (q) => q.order('created_at'))
  const WH = (whs.find((w) => w.is_active) ?? whs[0]).id
  const custDe = (o) => custById.get(custRefFromAcct.get(o['account-id']))
  const supDe = (o) => supById.get(supRefFromAcct.get(o['account-id']))
  const skuId = (l) => prodBySku.get(txt(l['item-reference'])) ?? null
  const lineasDe = (o) => (o.lines || []).filter(esItem)

  const stockAntes = (await sb.from('stock_movements').select('id', { count: 'exact', head: true }).eq('company_id', CID)).count
  console.log(`[94] clientes ${custById.size} · proveedores ${supById.size} · productos ${prodBySku.size} · depósito ${WH} · stock_movements al inicio ${stockAntes}`)

  // ── VENTA: cotizaciones ───────────────────────────────────────────────────
  {
    const docs = L('salesEstimates')
    const ya = new Set((await paginar('sales_quotes', 'external_id', (q) => q.eq('external_source', 'stel'))).map((r) => r.external_id))
    const nuevos = docs.filter((o) => !ya.has(String(o.id)) && custDe(o))
    const sinCli = docs.filter((o) => !ya.has(String(o.id)) && !custDe(o)).length
    await insertar('sales_quotes', nuevos.map((o) => ({
      company_id: CID, number: txt(o['full-reference']), external_source: 'stel', external_id: String(o.id),
      customer_id: custDe(o), quote_date: fecha(o.date), currency_code: cur(o),
      status: o.deleted ? 'rejected' : 'sent', subtotal: num(o['subtotal-amount']), tax_amount: num(o['tax-total-amount']),
      total: num(o['total-amount']), imported_at: new Date().toISOString(), legacy_source: 'stel',
    })))
    const idPorEid = new Map((await paginar('sales_quotes', 'id, external_id', (q) => q.eq('external_source', 'stel'))).map((r) => [r.external_id, r.id]))
    const lineas = []
    for (const o of nuevos) { let n = 0; for (const l of lineasDe(o)) { n++; lineas.push({ company_id: CID, quote_id: idPorEid.get(String(o.id)), line_no: n, product_id: skuId(l), sku_snapshot: txt(l['item-reference']), name_snapshot: txt(l['item-name']), description_snapshot: txt(l['item-description']), quantity: num(l.units), unit_price: Math.max(0, num(l['item-base-price'])), discount_pct: Math.min(100, Math.max(0, num(l['discount-percentage']))), tax_treatment: tax(l['primary-tax-percentage']), tax_rate_snapshot: num(l['primary-tax-percentage']) }) } }
    await insertar('sales_quote_lines', lineas)
    console.log(`[94] cotizaciones: +${nuevos.length} (${lineas.length} líneas) · sin cliente ${sinCli} · ya estaban ${ya.size}`)
  }

  // ── VENTA: pedidos ─────────────────────────────────────────────────────────
  {
    const docs = L('salesOrders')
    const ya = new Set((await paginar('sales_orders', 'external_id', (q) => q.eq('external_source', 'stel'))).map((r) => r.external_id))
    const nuevos = docs.filter((o) => !ya.has(String(o.id)) && custDe(o))
    const sinCli = docs.filter((o) => !ya.has(String(o.id)) && !custDe(o)).length
    await insertar('sales_orders', nuevos.map((o) => ({
      company_id: CID, number: txt(o['full-reference']), external_source: 'stel', external_id: String(o.id),
      customer_id: custDe(o), order_date: fecha(o.date), currency_code: cur(o), origin: 'manual',
      commercial_status: o.deleted ? 'cancelled' : 'confirmed', subtotal: num(o['subtotal-amount']),
      tax_amount: num(o['tax-total-amount']), total: num(o['total-amount']), imported_at: new Date().toISOString(), legacy_source: 'stel',
    })))
    const idPorEid = new Map((await paginar('sales_orders', 'id, external_id', (q) => q.eq('external_source', 'stel'))).map((r) => [r.external_id, r.id]))
    const lineas = []
    for (const o of nuevos) { let n = 0; for (const l of lineasDe(o)) { n++; lineas.push({ company_id: CID, order_id: idPorEid.get(String(o.id)), line_no: n, product_id: skuId(l), sku_snapshot: txt(l['item-reference']), name_snapshot: txt(l['item-name']), description_snapshot: txt(l['item-description']), quantity_ordered: num(l.units), unit_price: Math.max(0, num(l['item-base-price'])), discount_pct: Math.min(100, Math.max(0, num(l['discount-percentage']))), tax_treatment: tax(l['primary-tax-percentage']), tax_rate_snapshot: num(l['primary-tax-percentage']) }) } }
    await insertar('sales_order_lines', lineas)
    console.log(`[94] pedidos venta: +${nuevos.length} (${lineas.length} líneas) · sin cliente ${sinCli} · ya estaban ${ya.size}`)
  }

  // ── VENTA: albaranes / remitos ───────────────────────────────────────────
  {
    const docs = L('salesDeliveryNotes')
    const ya = new Set((await paginar('deliveries', 'external_id', (q) => q.eq('external_source', 'stel'))).map((r) => r.external_id))
    const nuevos = docs.filter((o) => !ya.has(String(o.id)) && custDe(o))
    const sinCli = docs.filter((o) => !ya.has(String(o.id)) && !custDe(o)).length
    await insertar('deliveries', nuevos.map((o) => ({
      company_id: CID, number: txt(o['full-reference']), external_source: 'stel', external_id: String(o.id),
      customer_id: custDe(o), delivery_date: fecha(o.date), currency_code: cur(o),
      status: o.deleted ? 'cancelled' : 'delivered', subtotal: num(o['subtotal-amount']), tax_amount: num(o['tax-total-amount']),
      total: num(o['total-amount']), imported_at: new Date().toISOString(), legacy_source: 'stel',
    })))
    const idPorEid = new Map((await paginar('deliveries', 'id, external_id', (q) => q.eq('external_source', 'stel'))).map((r) => [r.external_id, r.id]))
    const lineas = []
    for (const o of nuevos) { for (const l of lineasDe(o)) { lineas.push({ company_id: CID, delivery_id: idPorEid.get(String(o.id)), product_id: skuId(l), sku_snapshot: txt(l['item-reference']), name_snapshot: txt(l['item-name']), description_snapshot: txt(l['item-description']), quantity: num(l.units), warehouse_id: WH, unit_price: Math.max(0, num(l['item-base-price'])), discount_pct: Math.min(100, Math.max(0, num(l['discount-percentage']))), tax_treatment: tax(l['primary-tax-percentage']), tax_rate_snapshot: num(l['primary-tax-percentage']) }) } }
    await insertar('delivery_lines', lineas)
    console.log(`[94] albaranes venta: +${nuevos.length} (${lineas.length} líneas) · sin cliente ${sinCli} · ya estaban ${ya.size}`)
  }

  // ── COMPRA: pedidos a proveedor ────────────────────────────────────────────
  // Sin columnas de importación: idempotencia por number. Entran 'draft',
  // se cargan líneas, y recién después pasan a su estado final.
  {
    const docs = L('purchaseOrders')
    const ya = new Set((await paginar('purchase_orders', 'number', (q) => q)).map((r) => r.number))
    const nuevos = docs.filter((o) => txt(o['full-reference']) && !ya.has(txt(o['full-reference'])) && supDe(o))
    const sinProv = docs.filter((o) => txt(o['full-reference']) && !ya.has(txt(o['full-reference'])) && !supDe(o)).length
    await insertar('purchase_orders', nuevos.map((o) => ({
      company_id: CID, supplier_id: supDe(o), number: txt(o['full-reference']), currency_code: cur(o),
      order_date: fecha(o.date), status: 'draft', subtotal: num(o['subtotal-amount']), tax_amount: num(o['tax-total-amount']), total: num(o['total-amount']),
    })))
    const idPorNro = new Map((await paginar('purchase_orders', 'id, number', (q) => q)).map((r) => [r.number, r.id]))
    const lineas = []
    for (const o of nuevos) { let n = 0; for (const l of lineasDe(o)) { n++; lineas.push({ company_id: CID, purchase_order_id: idPorNro.get(txt(o['full-reference'])), line_no: n, line_type: 'product', product_id: skuId(l), sku_snapshot: txt(l['item-reference']), name_snapshot: txt(l['item-name']), description_snapshot: txt(l['item-description']), quantity: num(l.units), unit_price: Math.max(0, num(l['item-base-price'])), discount_pct: Math.min(100, Math.max(0, num(l['discount-percentage']))), tax_treatment: tax(l['primary-tax-percentage']) }) } }
    await insertar('purchase_order_lines', lineas)
    // Estado final: confirmados los vigentes, cancelados los borrados.
    const confirmar = nuevos.filter((o) => !o.deleted).map((o) => txt(o['full-reference']))
    const cancelar = nuevos.filter((o) => o.deleted).map((o) => txt(o['full-reference']))
    await enLotes(confirmar, 200, async (lote) => { const { error } = await sb.from('purchase_orders').update({ status: 'confirmed' }).eq('company_id', CID).in('number', lote); if (error) throw new Error(`PO confirmar: ${error.message}`) })
    await enLotes(cancelar, 200, async (lote) => { const { error } = await sb.from('purchase_orders').update({ status: 'cancelled' }).eq('company_id', CID).in('number', lote); if (error) throw new Error(`PO cancelar: ${error.message}`) })
    console.log(`[94] pedidos compra: +${nuevos.length} (${lineas.length} líneas) · confirmados ${confirmar.length} · cancelados ${cancelar.length} · sin proveedor ${sinProv} · ya estaban ${ya.size}`)
  }

  // ── COMPRA: notas de entrega de proveedor ──────────────────────────────────
  // Recepción standalone (sin purchase_order_id): queda 'draft', no mueve stock.
  {
    const docs = L('purchaseDeliveryNotes')
    const ya = new Set((await paginar('goods_receipts', 'number', (q) => q)).map((r) => r.number))
    const nuevos = docs.filter((o) => txt(o['full-reference']) && !ya.has(txt(o['full-reference'])) && supDe(o))
    const sinProv = docs.filter((o) => txt(o['full-reference']) && !ya.has(txt(o['full-reference'])) && !supDe(o)).length
    await insertar('goods_receipts', nuevos.map((o) => ({
      company_id: CID, supplier_id: supDe(o), number: txt(o['full-reference']), warehouse_id: WH,
      status: 'draft', receipt_date: fecha(o.date), supplier_document: txt(o['extra-reference']),
    })))
    const idPorNro = new Map((await paginar('goods_receipts', 'id, number', (q) => q)).map((r) => [r.number, r.id]))
    const lineas = []
    for (const o of nuevos) { for (const l of lineasDe(o)) { lineas.push({ company_id: CID, goods_receipt_id: idPorNro.get(txt(o['full-reference'])), product_id: skuId(l), sku_snapshot: txt(l['item-reference']), name_snapshot: txt(l['item-name']), quantity: num(l.units) }) } }
    await insertar('goods_receipt_lines', lineas)
    console.log(`[94] notas entrega compra: +${nuevos.length} (${lineas.length} líneas) · sin proveedor ${sinProv} · ya estaban ${ya.size}`)
  }

  const stockDespues = (await sb.from('stock_movements').select('id', { count: 'exact', head: true }).eq('company_id', CID)).count
  console.log(`[94] stock_movements al final ${stockDespues} (delta ${stockDespues - stockAntes}) — debe ser 0`)
  console.log('[94] LISTO')
}
main().catch((e) => { console.error('[94]', e.message || e); process.exit(1) })
