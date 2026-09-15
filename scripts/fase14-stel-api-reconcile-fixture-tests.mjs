/**
 * Fase 14 · Entrega 1 — prueba de la reconciliación STEL en una empresa FIXTURE.
 *
 * No llama a la API de STEL: arma un snapshot STEL sintético con la misma forma
 * que devuelve la API y una empresa `zz-f14e1-*` con los problemas reales que
 * encontró la auditoría:
 *
 *   · cotización importada SIN moneda, con el subtotal ANTES del descuento global
 *     y las líneas en otro orden (STEL la tiene Cerrada);
 *   · cotización aceptada sin moneda (el trigger la congela: debe quedar BLOQUEADA);
 *   · pedido sin vínculo a su cotización y con una línea sin product_id;
 *   · remito histórico sin vínculo al pedido y con líneas sin precio;
 *   · cotización → pedido → remito que STEL tiene y React no, con un producto que
 *     React no tiene y moneda ARS;
 *   · cotización que sólo está en React (no se toca).
 *
 * Corre: auditoría → plan → aplicar (sólo zz) → auditoría → plan. La segunda
 * corrida tiene que dar 0 acciones aplicables. Verifica además que no se
 * crearon movimientos de stock ni eventos de ventas, que las secuencias y la
 * autoridad no se movieron, y que los datos reales quedan intactos.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase14-stel-api-reconcile-fixture-tests.mjs
 *
 * NO correrla en paralelo con otra suite de base.
 */
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { leerReactEmpresa } from './fase14-stel-api-auditoria.mjs'
import { aplicarPlan, planificar } from './fase14-stel-api-reconcile-dryrun.mjs'

const BASE = process.env.VITE_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !SECRET) { console.error('✗ Faltan variables'); process.exit(1) }
const s = createClient(BASE, SECRET, { auth: { persistSession: false } })
const MARCA = 'zz-f14e1'
const AHORA = new Date().toISOString()

let fallos = 0
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const INFO = (t, d = '') => console.log(`    INFO  ${t}${d ? ' — ' + d : ''}`)
const cmp = (t, esp, real) => (JSON.stringify(esp) === JSON.stringify(real) ? PASS(t, JSON.stringify(real).slice(0, 150)) : FAIL(t, `esperaba ${JSON.stringify(esp)}, dio ${JSON.stringify(real)}`))
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(72)}`)
const num = (v) => (v === null || v === undefined ? null : Number(v))
const hash = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16)
const ok = (r, que) => { if (r.error) throw new Error(`${que}: ${r.error.message}`); return r.data }

async function huellaReal() {
  const { data: c } = await s.from('companies').select('id').not('slug', 'like', 'zz-%')
  const ids = c.map((x) => x.id)
  const todo = async (t, orden) => {
    const filas = []
    for (let desde = 0; ; desde += 1000) {
      let q = s.from(t).select('*').in('company_id', ids)
      for (const o of orden) q = q.order(o)
      const { data } = await q.range(desde, desde + 999)
      filas.push(...(data ?? []))
      if ((data ?? []).length < 1000) break
    }
    return hash(filas)
  }
  const cuenta = async (t) => (await s.from(t).select('*', { count: 'exact', head: true }).in('company_id', ids)).count
  return {
    secuencias: await todo('document_sequences', ['company_id', 'doc_type', 'series_code']),
    autoridad: await todo('document_numbering_authority', ['company_id', 'doc_type']),
    cotizaciones: await todo('sales_quotes', ['id']),
    lineasCot: await todo('sales_quote_lines', ['id']),
    pedidos: await todo('sales_orders', ['id']),
    lineasPed: await todo('sales_order_lines', ['id']),
    remitos: await todo('deliveries', ['id']),
    lineasRem: await todo('delivery_lines', ['id']),
    movimientos: await cuenta('stock_movements'),
    eventos: await cuenta('sales_audit'),
  }
}

async function barrer() {
  const { data: emp } = await s.from('companies').select('id').like('slug', `${MARCA}-%`)
  for (const { id } of emp ?? []) {
    // Un documento importado no se borra: primero se le quita la marca.
    for (const t of ['deliveries', 'sales_orders', 'sales_quotes']) await s.from(t).update({ imported_at: null }).eq('company_id', id)
    await s.from('delivery_lines').delete().eq('company_id', id)
    for (const t of ['deliveries', 'sales_orders', 'sales_quotes']) {
      const r = await s.from(t).delete().eq('company_id', id)
      if (r.error) throw new Error(`limpiar ${t}: ${r.error.message}`)
    }
    for (const t of ['sales_audit', 'stock_movements', 'products', 'product_categories', 'customers', 'warehouses', 'document_numbering_authority', 'document_numbering_authority_audit', 'document_sequences']) {
      const r = await s.from(t).delete().eq('company_id', id)
      if (r.error) throw new Error(`limpiar ${t}: ${r.error.message}`)
    }
    ok(await s.from('companies').delete().eq('id', id), 'limpiar empresa')
  }
}

// ── Snapshot STEL sintético (misma forma que recortarDoc) ───────────────────
const ESTADOS = [
  { id: 1, name: 'Pendiente', type: 'SALESESTIMATE' }, { id: 2, name: 'Cerrada', type: 'SALESESTIMATE' },
  { id: 3, name: 'Cerrado', type: 'SALESORDER' }, { id: 4, name: 'Facturada', type: 'SALESDELIVERYNOTE' },
]
const linea = (id, orden, sku, nombre, units, precio, dto = 0, extra = {}) => ({
  id, order: orden, 'line-type': 'ITEM', deleted: false, 'item-id': 900 + id, 'item-path': `app.stelorder.com/app/products/${900 + id}`,
  'item-reference': sku, 'item-name': nombre, 'item-description': '', 'item-deleted': false, units, 'item-base-price': precio,
  'discount-percentage': dto, 'total-amount': Math.round(units * precio * (1 - dto / 100) * 100) / 100, 'primary-tax-percentage': 21,
  'secondary-tax-percentage': 0, 'income-tax-enabled': false, 'parent-document-id': null, 'warehouse-id': -2, ...extra,
})
const doc = (id, ref, fecha, accountId, estado, moneda, desc, lineas, extra = {}) => {
  const neto = lineas.reduce((a, l) => a + l['total-amount'], 0)
  const sub = Math.round(neto * (1 - desc / 100) * 100) / 100
  const tax = Math.round(sub * 0.21 * 100) / 100
  return {
    id, 'full-reference': ref, reference: ref.replace(/^[A-Z]+/, ''), date: `${fecha}T00:00:00+0000`, 'creation-date': `${fecha}T12:00:00+0000`,
    'utc-last-modification-date': `${fecha}T12:00:00+0000`, 'account-id': accountId, 'agent-id': 1, 'creator-id': 1, 'document-state-id': estado,
    'serial-number-id': 1, 'parent-document-id': null, 'parent-document-path': null, title: `ZZ E1 ${ref}`, 'currency-code': moneda,
    'currency-rate': moneda === 'USD' ? 1 : 0.001, 'discount-percentage': desc, 'discount-total-amount': Math.round((neto - sub) * 100) / 100,
    'subtotal-amount': sub, 'tax-total-amount': tax, 'total-amount': Math.round((sub + tax) * 100) / 100,
    'tax-breakdown': [{ 'subtotal-amount': sub, 'tax-percentage': 21, 'tax-name': 'IVA', type: 'PRIMARY', 'total-amount': tax }],
    'primary-tax-enabled': true, 'secondary-tax-enabled': false, 'income-tax-enabled': false, 'income-tax-percentage': 0,
    deleted: false, lines: lineas, ...extra,
  }
}

async function main() {
  await barrer()
  const huellaAntes = await huellaReal()
  INFO('huella real antes', JSON.stringify(huellaAntes))

  seccion('0 · Fixture')
  const E = ok(await s.from('companies').insert({ slug: `${MARCA}-${Date.now()}`, name: 'ZZ F14 E1 Reconciliación', default_currency: 'USD' }).select('id').single(), 'empresa').id
  ok(await s.from('document_sequences').insert([
    { company_id: E, doc_type: 'quote', series_code: 'COTI', prefix: 'COTI', padding: 5, next_number: 100, is_default: true },
    { company_id: E, doc_type: 'sales_order', series_code: 'PDV', prefix: 'PDV', padding: 5, next_number: 50, is_default: true },
    { company_id: E, doc_type: 'delivery', series_code: 'RT', prefix: 'RT', padding: 10, next_number: 30, is_default: true },
  ]), 'secuencias')
  ok(await s.from('document_numbering_authority').insert(['quote', 'sales_order', 'delivery'].map((d) => ({ company_id: E, doc_type: d, authority: 'STEL', reason: 'ZZ F14 E1: STEL numera' }))), 'autoridad')
  const C1 = ok(await s.from('customers').insert({ company_id: E, legal_name: 'ZZ E1 Metalúrgica SA', tax_id: '30-99999991-1', status: 'active' }).select('id').single(), 'cliente 1').id
  const C2 = ok(await s.from('customers').insert({ company_id: E, legal_name: 'ZZ E1 Distribuidora SRL', status: 'active' }).select('id').single(), 'cliente 2').id
  const cat = ok(await s.from('product_categories').insert({ company_id: E, name: 'ZZ E1 rubro', slug: `${MARCA}-rubro-${Date.now()}` }).select('id').single(), 'rubro').id
  const prods = ok(await s.from('products').insert([
    { company_id: E, category_id: cat, sku: 'ZZE1-A', name: 'ZZ E1 Atornillador A' },
    { company_id: E, category_id: cat, sku: 'ZZE1-B', name: 'ZZ E1 Llave B' },
  ]).select('id, sku'), 'productos')
  const A = prods.find((p) => p.sku === 'ZZE1-A').id
  const B = prods.find((p) => p.sku === 'ZZE1-B').id
  const W = ok(await s.from('warehouses').insert({ company_id: E, code: 'ZZE1', name: 'ZZ E1 depósito', is_default: true }).select('id').single(), 'depósito').id

  // React "importado del legacy", con los defectos de la auditoría.
  const base = { company_id: E, imported_at: AHORA, legacy_source: 'erp_store' }
  const Q1 = ok(await s.from('sales_quotes').insert({ ...base, number: 'COTI00090', original_number: 'COTI00090', series_code: 'COTI', customer_id: C1, quote_date: '2026-09-01', currency_code: null, status: 'sent', subtotal: 250, tax_amount: 47.25, total: 297.25, discount_pct: 0 }).select('id').single(), 'Q1').id
  ok(await s.from('sales_quote_lines').insert([
    { company_id: E, quote_id: Q1, line_no: 1, product_id: B, sku_snapshot: 'ZZE1-B', name_snapshot: 'ZZ E1 Llave B', quantity: 1, unit_price: 50, discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21, line_type: 'item' },
    { company_id: E, quote_id: Q1, line_no: 2, product_id: A, sku_snapshot: 'ZZE1-A', name_snapshot: 'ZZ E1 Atornillador A', quantity: 2, unit_price: 100, discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21, line_type: 'item' },
  ]), 'Q1 líneas')
  const Q2 = ok(await s.from('sales_quotes').insert({ ...base, number: 'COTI00091', original_number: 'COTI00091', series_code: 'COTI', customer_id: C2, quote_date: '2026-09-02', currency_code: null, status: 'sent', subtotal: 100, tax_amount: 21, total: 121, discount_pct: 0 }).select('id').single(), 'Q2').id
  ok(await s.from('sales_quote_lines').insert({ company_id: E, quote_id: Q2, line_no: 1, product_id: A, sku_snapshot: 'ZZE1-A', name_snapshot: 'ZZ E1 Atornillador A', quantity: 1, unit_price: 100, discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21, line_type: 'item' }), 'Q2 línea')
  ok(await s.from('sales_quotes').update({ status: 'accepted' }).eq('id', Q2), 'Q2 aceptada')
  const Q4 = ok(await s.from('sales_quotes').insert({ ...base, number: 'COTI00089', original_number: 'COTI00089', series_code: 'COTI', customer_id: C1, quote_date: '2026-08-30', currency_code: 'USD', status: 'sent', subtotal: 10, tax_amount: 2.1, total: 12.1, discount_pct: 0 }).select('id').single(), 'Q4').id
  const O1 = ok(await s.from('sales_orders').insert({ ...base, number: 'PDV00040', original_number: 'PDV00040', series_code: 'PDV', customer_id: C1, order_date: '2026-09-03', quote_id: null, origin: 'migration', currency_code: 'USD', commercial_status: 'confirmed', fulfillment_status: 'delivered', subtotal: 225, tax_amount: 47.25, total: 272.25, discount_pct: 10 }).select('id').single(), 'O1').id
  const lO1 = ok(await s.from('sales_order_lines').insert([
    { company_id: E, order_id: O1, line_no: 1, product_id: null, sku_snapshot: 'ZZE1-A', name_snapshot: 'ZZ E1 Atornillador A', quantity_ordered: 2, unit_price: 100, discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21, line_type: 'item' },
    { company_id: E, order_id: O1, line_no: 2, product_id: B, sku_snapshot: 'ZZE1-B', name_snapshot: 'ZZ E1 Llave B', quantity_ordered: 1, unit_price: 50, discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21, line_type: 'item' },
  ]).select('id, line_no'), 'O1 líneas')
  const D0 = ok(await s.from('deliveries').insert({ ...base, number: 'RT0000000020', original_number: 'RT0000000020', series_code: 'RT', customer_id: C1, delivery_date: '2026-09-04', order_id: null, status: 'delivered', currency_code: null, subtotal: 225, tax_amount: 47.25, total: 272.25 }).select('id').single(), 'D0').id
  ok(await s.from('delivery_lines').insert([
    { company_id: E, delivery_id: D0, product_id: A, sku_snapshot: 'ZZE1-A', name_snapshot: 'ZZ E1 Atornillador A', quantity: 2, warehouse_id: W },
    { company_id: E, delivery_id: D0, product_id: B, sku_snapshot: 'ZZE1-B', name_snapshot: 'ZZ E1 Llave B', quantity: 1, warehouse_id: W },
  ]), 'D0 líneas')
  const seqAntes = ok(await s.from('document_sequences').select('doc_type, next_number').eq('company_id', E).order('doc_type'), 'seq')
  const autAntes = ok(await s.from('document_numbering_authority').select('doc_type, authority').eq('company_id', E).order('doc_type'), 'aut')
  PASS('fixture creada', 'Q1 sin moneda/desc., Q2 aceptada sin moneda, Q4 sólo React, O1 sin vínculo, D0 sin precios')

  const stel = {
    estados: ESTADOS,
    clientes: [
      { id: 501, 'full-reference': 'CLI00501', 'legal-name': 'ZZ E1 METALURGICA S.A.', name: 'Metalúrgica', 'tax-identification-number': '30999999911', 'currency-code': 'USD', deleted: false },
      { id: 502, 'full-reference': 'CLI00502', 'legal-name': 'ZZ E1 Distribuidora SRL', name: null, 'tax-identification-number': null, 'currency-code': 'ARS', deleted: false },
    ],
    productos: [],
    padresExternos: { quote: [], order: [], noEncontrados: [] },
    docs: {
      quote: [
        doc(7001, 'COTI00090', '2026-09-01', 501, 2, 'USD', 10, [linea(1, 0, 'ZZE1-A', 'ZZ E1 Atornillador A', 2, 100), linea(2, 1, 'ZZE1-B', 'ZZ E1 Llave B', 1, 50)]),
        doc(7002, 'COTI00091', '2026-09-02', 502, 2, 'ARS', 0, [linea(3, 0, 'ZZE1-A', 'ZZ E1 Atornillador A', 1, 100)]),
        doc(7003, 'COTI00092', '2026-09-10', 502, 1, 'ARS', 0, [linea(4, 0, 'ZZE1-A', 'ZZ E1 Atornillador A', 3, 1000), linea(5, 1, 'ZZE1-NUEVO', 'ZZ E1 Producto nuevo en STEL', 1, 500)]),
      ],
      order: [
        doc(8001, 'PDV00040', '2026-09-03', 501, 3, 'USD', 10, [linea(6, 0, 'ZZE1-A', 'ZZ E1 Atornillador A', 2, 100), linea(7, 1, 'ZZE1-B', 'ZZ E1 Llave B', 1, 50)], { 'parent-document-id': 7001, 'parent-document-path': 'app.stelorder.com/app/salesEstimates/7001' }),
        doc(8002, 'PDV00041', '2026-09-11', 502, 3, 'ARS', 0, [linea(8, 0, 'ZZE1-A', 'ZZ E1 Atornillador A', 3, 1000), linea(9, 1, 'ZZE1-NUEVO', 'ZZ E1 Producto nuevo en STEL', 1, 500)], { 'parent-document-id': 7003, 'parent-document-path': 'app.stelorder.com/app/salesEstimates/7003' }),
      ],
      delivery: [
        doc(9001, 'RT0000000020', '2026-09-04', 501, 4, 'USD', 10, [linea(10, 0, 'ZZE1-A', 'ZZ E1 Atornillador A', 2, 100), linea(11, 1, 'ZZE1-B', 'ZZ E1 Llave B', 1, 50)], { 'parent-document-id': 8001, 'parent-document-path': 'app.stelorder.com/app/salesOrders/8001' }),
        doc(9002, 'RT0000000021', '2026-09-12', 502, 4, 'ARS', 0, [linea(12, 0, 'ZZE1-A', 'ZZ E1 Atornillador A', 3, 1000), linea(13, 1, 'ZZE1-NUEVO', 'ZZ E1 Producto nuevo en STEL', 1, 500)], { 'parent-document-id': 8002, 'parent-document-path': 'app.stelorder.com/app/salesOrders/8002' }),
      ],
    },
  }
  const slug = ok(await s.from('companies').select('slug').eq('id', E).single(), 'slug').slug

  seccion('1 · Auditoría y plan (antes)')
  const react1 = await leerReactEmpresa(s, slug)
  const plan1 = planificar(stel, react1, { almacenPorDefecto: W })
  const r1 = plan1.reco.resumen
  cmp('cotizaciones: 2 matched, 1 STEL_ONLY, 1 REACT_ONLY', [2, 1, 1], [r1.quote.MATCHED, r1.quote.STEL_ONLY, r1.quote.REACT_ONLY])
  cmp('pedidos y remitos: 1 matched + 1 STEL_ONLY cada uno', [1, 1, 1, 1], [r1.order.MATCHED, r1.order.STEL_ONLY, r1.delivery.MATCHED, r1.delivery.STEL_ONLY])
  cmp('orden de líneas distinto en Q1 NO es mismatch de líneas', [0, 1], [r1.quote.LINE_MISMATCH, r1.quote.LINE_ORDER_ONLY])
  const acc = (fn) => plan1.acciones.filter(fn)
  cmp('Q1: moneda USD desde STEL', ['USD'], acc((a) => a.document === 'COTI00090' && a.action === 'SET_CURRENCY').map((a) => a.new))
  cmp('Q1: totales STEL (subtotal, IVA, total, descuento)', [['discount_pct', 10], ['subtotal', 225], ['total', 272.25]], acc((a) => a.document === 'COTI00090' && a.action === 'FIX_TOTAL').map((a) => [a.field, a.new]).sort())
  cmp('Q1: Cerrada → accepted', ['sent→accepted'], acc((a) => a.document === 'COTI00090' && a.field === 'status').map((a) => `${a.old}→${a.new}`))
  cmp('Q2 aceptada: moneda BLOQUEADA por el trigger, id externo sí', ['TRIGGER_COTIZACION_CERRADA', null], [acc((a) => a.document === 'COTI00091' && a.action === 'SET_CURRENCY')[0]?.bloqueado, acc((a) => a.document === 'COTI00091' && a.field === 'external_id')[0]?.bloqueado])
  cmp('Q4 sólo React: ninguna acción', 0, acc((a) => a.document === 'COTI00089').length)
  cmp('O1: LINK_QUOTE y LINK_PRODUCT', [Q1, A], [acc((a) => a.document === 'PDV00040' && a.action === 'LINK_QUOTE')[0]?.new, acc((a) => a.document === 'PDV00040' && a.action === 'LINK_PRODUCT')[0]?.new])
  cmp('D0: LINK_ORDER, moneda y precios de línea', [O1, 'USD', [100, 50]], [acc((a) => a.document === 'RT0000000020' && a.action === 'LINK_ORDER')[0]?.new, acc((a) => a.document === 'RT0000000020' && a.action === 'SET_CURRENCY')[0]?.new, acc((a) => a.document === 'RT0000000020' && a.field === 'unit_price').map((a) => a.new).sort((x, y) => y - x)])
  const insQ3 = acc((a) => a.action === 'INSERT' && a.document === 'COTI00092')[0]
  cmp('Q3 a insertar: ARS, cliente por nombre, producto faltante marcado', ['ARS', C2, [false, true], true], [insQ3?.new.currency_code, insQ3?.new.customer_id, insQ3?.lineas.map((l) => l.productoFaltante), insQ3?.new.needs_review])
  cmp('ninguna acción toca secuencias ni stock', 0, plan1.acciones.filter((a) => /sequence|stock/.test(`${a.table}`)).length)
  INFO('plan antes', JSON.stringify(plan1.resumen))

  seccion('2 · Aplicar (sólo fixture)')
  const hechos = await aplicarPlan(s, E, plan1, { almacenPorDefecto: W })
  cmp('sin fallas al aplicar', [], hechos.fallidas)
  INFO('acciones aplicadas', String(hechos.aplicadas))
  const real = ok(await s.from('companies').select('id').eq('slug', 'buscatools').single(), 'empresa real').id
  // Plan vacío: aunque la guarda fallara, no hay nada que escribir.
  const negado = await aplicarPlan(s, real, { acciones: [] }, { almacenPorDefecto: W }).then(() => 'aplicó').catch((e) => (/no es fixture/.test(e.message) ? 'NEGADO' : e.message))
  cmp('aplicarPlan se niega a una empresa real', 'NEGADO', negado)

  seccion('3 · Segunda corrida: idempotencia')
  const react2 = await leerReactEmpresa(s, slug)
  const plan2 = planificar(stel, react2, { almacenPorDefecto: W })
  cmp('0 acciones aplicables en la segunda corrida', 0, plan2.resumen.aplicablesHoy)
  cmp('lo bloqueado sigue reportado (Q2 moneda)', ['COTI00091:SET_CURRENCY:TRIGGER_COTIZACION_CERRADA'], plan2.acciones.map((a) => `${a.document}:${a.action}:${a.bloqueado}`))
  const r2 = plan2.reco.resumen
  cmp('todo emparejado salvo Q4 (sólo React)', [3, 0, 1, 2, 0, 2, 0], [r2.quote.MATCHED, r2.quote.STEL_ONLY, r2.quote.REACT_ONLY, r2.order.MATCHED, r2.order.STEL_ONLY, r2.delivery.MATCHED, r2.delivery.STEL_ONLY])
  const q1 = ok(await s.from('sales_quotes').select('currency_code, subtotal, tax_amount, total, discount_pct, status, external_source, external_id, imported_at').eq('id', Q1).single(), 'Q1')
  cmp('Q1 final', ['USD', 225, 47.25, 272.25, 10, 'accepted', 'stel', '7001', true], [q1.currency_code, num(q1.subtotal), num(q1.tax_amount), num(q1.total), num(q1.discount_pct), q1.status, q1.external_source, q1.external_id, Boolean(q1.imported_at)])
  const lq1 = ok(await s.from('sales_quote_lines').select('id, line_no, sku_snapshot').eq('quote_id', Q1).order('line_no'), 'Q1 líneas')
  cmp('Q1: líneas conservan ids y orden (no se reemplazaron)', ['ZZE1-B', 'ZZE1-A'], lq1.map((l) => l.sku_snapshot))
  const o1 = ok(await s.from('sales_orders').select('quote_id').eq('id', O1).single(), 'O1')
  const lo1 = ok(await s.from('sales_order_lines').select('id, product_id').eq('id', lO1.find((l) => l.line_no === 1).id).single(), 'O1 línea')
  cmp('O1: vínculo y producto', [Q1, A], [o1.quote_id, lo1.product_id])
  const d0 = ok(await s.from('deliveries').select('order_id, currency_code, total').eq('id', D0).single(), 'D0')
  const ld0 = ok(await s.from('delivery_lines').select('sku_snapshot, unit_price, discount_pct').eq('delivery_id', D0).order('sku_snapshot'), 'D0 líneas')
  cmp('D0: vínculo, moneda, total histórico preservado y precios', [O1, 'USD', 272.25, [['ZZE1-A', 100, 0], ['ZZE1-B', 50, 0]]], [d0.order_id, d0.currency_code, num(d0.total), ld0.map((l) => [l.sku_snapshot, num(l.unit_price), num(l.discount_pct)])])
  const q3 = ok(await s.from('sales_quotes').select('id, status, currency_code, total, needs_review, imported_at, legacy_source').eq('company_id', E).eq('number', 'COTI00092').single(), 'Q3')
  const lq3 = ok(await s.from('sales_quote_lines').select('sku_snapshot, product_id').eq('quote_id', q3.id).order('line_no'), 'Q3 líneas')
  cmp('Q3 insertada (importada, ARS, revisión) con producto faltante en NULL', ['sent', 'ARS', 4235, true, true, 'stel_reconciliation', [['ZZE1-A', A], ['ZZE1-NUEVO', null]]], [q3.status, q3.currency_code, num(q3.total), q3.needs_review, Boolean(q3.imported_at), q3.legacy_source, lq3.map((l) => [l.sku_snapshot, l.product_id])])
  const o2 = ok(await s.from('sales_orders').select('id, quote_id').eq('company_id', E).eq('number', 'PDV00041').single(), 'O2')
  const d1 = ok(await s.from('deliveries').select('order_id, status').eq('company_id', E).eq('number', 'RT0000000021').single(), 'D1')
  cmp('O2 → Q3 y D1 → O2 vinculados', [q3.id, o2.id, 'delivered'], [o2.quote_id, d1.order_id, d1.status])

  seccion('4 · Efectos laterales')
  cmp('0 movimientos de stock en la empresa', 0, (await s.from('stock_movements').select('*', { count: 'exact', head: true }).eq('company_id', E)).count)
  cmp('0 eventos de ventas (no se simula acción de usuario)', 0, (await s.from('sales_audit').select('*', { count: 'exact', head: true }).eq('company_id', E)).count)
  cmp('secuencias sin consumir', seqAntes, ok(await s.from('document_sequences').select('doc_type, next_number').eq('company_id', E).order('doc_type'), 'seq'))
  cmp('autoridad STEL intacta', autAntes, ok(await s.from('document_numbering_authority').select('doc_type, authority').eq('company_id', E).order('doc_type'), 'aut'))
  cmp('Q4 (sólo React) intacta', ['USD', 12.1, null], Object.values(ok(await s.from('sales_quotes').select('currency_code, total, external_id').eq('id', Q4).single(), 'Q4')).map((v, i) => (i === 1 ? num(v) : v)))

  seccion('5 · Limpieza y datos reales')
  await barrer()
  cmp('0 empresas zz-f14e1', 0, (await s.from('companies').select('*', { count: 'exact', head: true }).like('slug', `${MARCA}-%`)).count)
  const huellaDespues = await huellaReal()
  cmp('datos reales intactos', huellaAntes, huellaDespues)

  console.log(`\n  ${fallos === 0 ? 'ALL PASS' : `${fallos} FALLA(S)`}`)
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('✗', e.message)
  try { await barrer() } catch (e2) { console.error('✗ limpieza:', e2.message) }
  process.exit(1)
})
