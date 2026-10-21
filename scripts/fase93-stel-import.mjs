/*
 * Fase 93 · importar el histórico de Torquetools a la base. ESCRIBE.
 *
 * Lee el JSON bajado por fase93-stel-pull.mjs y carga:
 *   · proveedores (de suppliers.json),
 *   · facturas de VENTA (ordinaryInvoices + refundInvoices) → sales_invoices
 *     + líneas, relacionadas al CLIENTE (por full-reference = legacy_ref) y al
 *     PRODUCTO (por SKU = item-reference),
 *   · facturas de COMPRA (purchaseInvoices) → supplier_invoices + líneas,
 *     relacionadas al PROVEEDOR y al PRODUCTO.
 *
 * Las líneas de producto son line-type ITEM; SECTION/DOCUMENT se saltean (en
 * ventas) o van como 'chapter' sin producto (en compras, que sí tiene line_type).
 * Lo que no matchea un producto va con product_id null + sku_snapshot (no rompe).
 * Idempotente: filtra lo ya cargado por external_id / number. Moneda: la de
 * cada factura (EUR/USD/…).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const rd = (f) => Object.fromEntries(readFileSync(f, 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '').trim()]))
const env = rd('.env'), mig = rd('.env.migration')
const sb = createClient(env.VITE_SUPABASE_URL, mig.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
const CID = '492a0ee9-220f-4dc8-9eaa-ec914ea10907'
const CREATED_BY = 'e9844579-f700-4255-83a8-d9580e1024ee'
const DIR = process.argv[2] || 'scripts/.stel-tt'
const L = (f) => JSON.parse(readFileSync(join(DIR, f + '.json'), 'utf8'))

const fecha = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null)
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const txt = (v) => { const s = String(v ?? '').trim(); return s === '' ? null : s }
const tax = (p) => { const n = num(p); return n === 21 ? 'vat_21' : n === 10.5 ? 'vat_105' : n === 0 ? 'vat_0' : 'other' }
const normCuit = (s) => String(s ?? '').replace(/\D/g, '')

async function paginar(tabla, sel, filtro) {
  const out = []; let d = 0
  for (;;) { let q = sb.from(tabla).select(sel).eq('company_id', CID).range(d, d + 999); if (filtro) q = filtro(q); const { data, error } = await q; if (error) throw error; out.push(...data); if (data.length < 1000) break; d += 1000 }
  return out
}
async function enLotes(filas, tam, fn) { for (let i = 0; i < filas.length; i += tam) await fn(filas.slice(i, i + tam)) }

async function main() {
  const clients = L('clients'), suppliersJson = L('suppliers')
  const refFromAccount = new Map(clients.map((c) => [c.id, c['full-reference']]))
  const supRefFromAccount = new Map(suppliersJson.map((s) => [s.id, s['full-reference']]))

  // ── Proveedores ─────────────────────────────────────────────────────────────
  const existSup = await paginar('suppliers', 'id, legacy_ref', (q) => q)
  const supIdByRef = new Map(existSup.filter((s) => s.legacy_ref).map((s) => [s.legacy_ref, s.id]))
  const taxVistos = new Set(existSup.map((s) => s.legacy_ref).filter(Boolean))
  const nuevosSup = []
  const cuitVistos = new Set()
  for (const s of suppliersJson) {
    const ref = s['full-reference']; if (!ref || supIdByRef.has(ref)) continue
    let tid = txt(s['tax-identification-number']); const cn = normCuit(tid)
    if (cn.length === 11 && (cuitVistos.has(cn))) tid = null; else if (cn.length === 11) cuitVistos.add(cn)
    nuevosSup.push({ company_id: CID, legacy_ref: ref, legal_name: txt(s['legal-name']) ?? txt(s.name) ?? ref, trade_name: txt(s.name), tax_id: tid, status: 'active', default_currency: 'USD', legacy_source: 'stel', created_by: CREATED_BY })
  }
  if (nuevosSup.length) { const { data, error } = await sb.from('suppliers').insert(nuevosSup).select('id, legacy_ref'); if (error) throw error; for (const s of data) supIdByRef.set(s.legacy_ref, s.id) }
  console.log(`[stel] proveedores: ${supIdByRef.size} (+${nuevosSup.length})`)

  // ── Mapas de cliente y producto ─────────────────────────────────────────────
  const custByRef = new Map((await paginar('customers', 'id, legacy_ref', (q) => q)).filter((c) => c.legacy_ref).map((c) => [c.legacy_ref, c.id]))
  const prodBySku = new Map((await paginar('products', 'id, sku', (q) => q)).map((p) => [p.sku, p.id]))
  console.log(`[stel] clientes ${custByRef.size} · productos ${prodBySku.size}`)

  // ── VENTAS ──────────────────────────────────────────────────────────────────
  const ventas = [...L('ordinaryInvoices'), ...L('refundInvoices')]
  const yaVenta = new Set((await paginar('sales_invoices', 'external_id', (q) => q.eq('external_source', 'stel'))).map((r) => r.external_id))
  const cabVenta = [], sinCliente = []
  for (const o of ventas) {
    const eid = String(o.id); if (yaVenta.has(eid)) continue
    const cust = custByRef.get(refFromAccount.get(o['account-id']))
    if (!cust) { sinCliente.push(o['full-reference']); continue }
    const rem = num(o['remaining-total-amount']), tot = num(o['total-amount'])
    cabVenta.push({
      company_id: CID, customer_id: cust, number: txt(o['full-reference']), external_source: 'stel', external_id: eid,
      external_number: txt(o['full-reference']), invoice_date: fecha(o.date), currency_code: txt(o['currency-code']) ?? 'USD',
      subtotal: num(o['subtotal-amount']), tax_amount: num(o['tax-total-amount']), total: tot,
      status: o.deleted ? 'cancelled' : (tot > 0 && rem <= 0 ? 'paid' : 'issued'), created_by: CREATED_BY,
    })
  }
  await enLotes(cabVenta, 300, async (lote) => { const { error } = await sb.from('sales_invoices').insert(lote); if (error) throw error })
  // Mapa COMPLETO (nuevas + ya existentes) y líneas desde cero, para que una
  // reanudación no deje facturas sin líneas.
  const invIdByEid = new Map((await paginar('sales_invoices', 'id, external_id', (q) => q.eq('external_source', 'stel'))).map((r) => [r.external_id, r.id]))
  await sb.from('sales_invoice_lines').delete().eq('company_id', CID)
  const lineasVenta = []
  for (const o of ventas) {
    const invId = invIdByEid.get(String(o.id)); if (!invId) continue
    for (const l of o.lines || []) {
      if (l['line-type'] !== 'ITEM' || num(l.units) <= 0) continue
      lineasVenta.push({ company_id: CID, invoice_id: invId, product_id: prodBySku.get(txt(l['item-reference'])) ?? null, sku_snapshot: txt(l['item-reference']), name_snapshot: txt(l['item-name']), quantity: num(l.units), unit_price: Math.max(0, num(l['item-base-price'])), discount_pct: Math.min(100, Math.max(0, num(l['discount-percentage']))), tax_treatment: tax(l['primary-tax-percentage']), tax_rate_snapshot: num(l['primary-tax-percentage']) })
    }
  }
  await enLotes(lineasVenta, 500, async (lote) => { const { error } = await sb.from('sales_invoice_lines').insert(lote); if (error) throw error })
  console.log(`[stel] VENTAS: ${cabVenta.length} facturas · ${lineasVenta.length} líneas · sin cliente: ${sinCliente.length}`)

  // ── COMPRAS ─────────────────────────────────────────────────────────────────
  const compras = L('purchaseInvoices')
  const yaCompra = new Set((await paginar('supplier_invoices', 'number', (q) => q)).map((r) => r.number))
  const supNroVistos = new Set((await paginar('supplier_invoices', 'supplier_id, supplier_number', (q) => q)).filter((r) => r.supplier_number).map((r) => `${r.supplier_id}|${r.supplier_number}`))
  const cabCompra = [], sinProv = []
  for (const o of compras) {
    const nro = txt(o['full-reference']); if (!nro || yaCompra.has(nro)) continue
    const sup = supIdByRef.get(supRefFromAccount.get(o['account-id']))
    if (!sup) { sinProv.push(nro); continue }
    yaCompra.add(nro) // dedupe también DENTRO del lote (hay full-reference repetidos)
    // El nº de factura del proveedor es único por proveedor: si se repite, se
    // deja null (igual entra, con el nº nuestro `number`).
    let supNro = txt(o['extra-reference'])
    if (supNro) { const k = `${sup}|${supNro}`; if (supNroVistos.has(k)) supNro = null; else supNroVistos.add(k) }
    cabCompra.push({
      company_id: CID, supplier_id: sup, number: nro, supplier_number: supNro,
      currency_code: txt(o['currency-code']) ?? 'USD', invoice_date: fecha(o.date),
      subtotal: num(o['subtotal-amount']), tax_amount: num(o['tax-total-amount']), total: num(o['total-amount']),
      status: 'draft', created_by: CREATED_BY, // borrador para poder cargar líneas; se cierra al final
    })
  }
  // Una factura `registered` tiene las líneas bloqueadas: se destraban a draft
  // antes de reconstruirlas.
  await sb.from('supplier_invoices').update({ status: 'draft' }).eq('company_id', CID).neq('status', 'cancelled')
  await enLotes(cabCompra, 300, async (lote) => { const { error } = await sb.from('supplier_invoices').insert(lote); if (error) throw error })
  const siIdByNro = new Map((await paginar('supplier_invoices', 'id, number', (q) => q)).map((r) => [r.number, r.id]))
  await sb.from('supplier_invoice_lines').delete().eq('company_id', CID)
  const lineasCompra = []
  const siHechos = new Set()
  for (const o of compras) {
    const siId = siIdByNro.get(txt(o['full-reference'])); if (!siId || siHechos.has(siId)) continue
    siHechos.add(siId)
    let n = 0
    for (const l of o.lines || []) {
      const esItem = l['line-type'] === 'ITEM'
      if (l['line-type'] === 'DOCUMENT' || num(l.units) <= 0) continue
      n++
      lineasCompra.push({ company_id: CID, supplier_invoice_id: siId, line_no: n, line_type: esItem ? 'product' : 'chapter', product_id: esItem ? (prodBySku.get(txt(l['item-reference'])) ?? null) : null, sku_snapshot: txt(l['item-reference']), description_snapshot: txt(l['item-name']), quantity: num(l.units), unit_price: Math.max(0, num(l['item-base-price'])), discount_pct: Math.min(100, Math.max(0, num(l['discount-percentage']))), tax_treatment: tax(l['primary-tax-percentage']), line_total: num(l['total-amount']) })
    }
  }
  await enLotes(lineasCompra, 500, async (lote) => { const { error } = await sb.from('supplier_invoice_lines').insert(lote); if (error) throw error })
  // Cerrar: con las líneas puestas, pasan a registered; las anuladas a cancelled.
  await sb.from('supplier_invoices').update({ status: 'registered' }).eq('company_id', CID).eq('status', 'draft')
  const anuladas = [...new Set(compras.filter((o) => o.deleted).map((o) => txt(o['full-reference'])).filter(Boolean))]
  await enLotes(anuladas, 200, async (lote) => { await sb.from('supplier_invoices').update({ status: 'cancelled' }).eq('company_id', CID).in('number', lote) })
  console.log(`[stel] COMPRAS: ${cabCompra.length} facturas · ${lineasCompra.length} líneas · sin proveedor: ${sinProv.length}`)
  console.log('[stel] LISTO')
}
main().catch((e) => { console.error('[stel]', e.message || e); process.exit(1) })
