/**
 * Fase 14 · Entrega 2 — pruebas del camino de reconciliación STEL (RPC server-side).
 *
 * Todo en una empresa FIXTURE `zz-f14e2-*` con autoridad STEL y un snapshot STEL
 * sintético con la forma real de la API. No llama a STEL. Cubre:
 *
 *   product import · idempotent product sync · document insert · document update ·
 *   closed quote reconciliation · currencies · relationships · quote-direct-delivery ·
 *   historical delivery without stock movement · idempotency · partial failure ·
 *   retry · second run zero changes · approved line delete · rollback ·
 *   unauthorized execution blocked · red team (anon, admin, employee, salesperson,
 *   technician, customer, distributor) · campos de importación desde la app.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase14-stel-e2-tests.mjs
 *
 * NO correrla en paralelo con otra suite de base.
 */
import { createClient } from '@supabase/supabase-js'
import { createHash, randomUUID } from 'node:crypto'
import { leerReactEmpresa } from './fase14-stel-api-auditoria.mjs'
import { ejecutarPlan, hashPlan, huellaEmpresa, planificarE2, revertirRun } from './lib/stel-reconciliacion.mjs'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET) { console.error('✗ Faltan variables'); process.exit(1) }
const s = createClient(BASE, SECRET, { auth: { persistSession: false } })
const MARCA = 'zz-f14e2'
const AHORA = new Date().toISOString()

let fallos = 0
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const INFO = (t, d = '') => console.log(`    INFO  ${t}${d ? ' — ' + d : ''}`)
const cmp = (t, esp, real) => (JSON.stringify(esp) === JSON.stringify(real) ? PASS(t, JSON.stringify(real).slice(0, 140)) : FAIL(t, `esperaba ${JSON.stringify(esp)}, dio ${JSON.stringify(real)}`))
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(72)}`)
const num = (v) => (v === null || v === undefined ? null : Number(v))
const ok = (r, que) => { if (r.error) throw new Error(`${que}: ${r.error.message}`); return r.data }
const hash = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16)

// ── Usuarios de la fixture ──────────────────────────────────────────────────
const login = async (email, password) => {
  const c = createClient(BASE, PUB, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`login: ${error.message}`)
  return c
}
const usuario = async (companyId, rol, customerId = null) => {
  const email = `${MARCA}-${rol}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@buscatools.test`
  const password = `Zz${randomUUID()}!`
  const { data, error } = await s.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`crear ${rol}: ${error.message}`)
  const fila = { company_id: companyId, user_id: data.user.id, role: rol, status: 'active' }
  if (customerId) fila.customer_id = customerId
  ok(await s.from('company_memberships').insert(fila), `membresía ${rol}`)
  return login(email, password)
}

async function huellaReal() {
  const { data: c } = await s.from('companies').select('id').not('slug', 'like', 'zz-%')
  const out = {}
  for (const { id } of c) {
    const h = await huellaEmpresa(s, id)
    for (const [t, v] of Object.entries(h)) out[`${id.slice(0, 4)}.${t}`] = v.hash
  }
  return hash(out)
}

async function barrer() {
  const { data: emp } = await s.from('companies').select('id').like('slug', `${MARCA}-%`)
  for (const { id } of emp ?? []) {
    await s.from('stel_reconciliation_log').delete().eq('company_id', id)
    await s.from('stel_reconciliation_runs').delete().eq('company_id', id)
    for (const t of ['deliveries', 'sales_orders', 'sales_quotes']) await s.from(t).update({ imported_at: null }).eq('company_id', id)
    await s.from('delivery_lines').delete().eq('company_id', id)
    for (const t of ['deliveries', 'sales_orders', 'sales_quotes']) {
      const r = await s.from(t).delete().eq('company_id', id)
      if (r.error) throw new Error(`limpiar ${t}: ${r.error.message}`)
    }
    for (const t of ['sales_audit', 'stock_reservations', 'stock_movements', 'stock_balances', 'product_prices', 'price_lists', 'products', 'product_categories', 'company_memberships', 'customers', 'warehouses', 'document_numbering_authority', 'document_numbering_authority_audit', 'document_sequences']) {
      const r = await s.from(t).delete().eq('company_id', id)
      if (r.error) throw new Error(`limpiar ${t}: ${r.error.message}`)
    }
    ok(await s.from('companies').delete().eq('id', id), 'limpiar empresa')
  }
  for (let page = 1; ; page++) {
    const { data: us } = await s.auth.admin.listUsers({ page, perPage: 1000 })
    for (const u of us?.users ?? []) if (u.email?.startsWith(`${MARCA}-`)) { await s.from('company_memberships').delete().eq('user_id', u.id); await s.auth.admin.deleteUser(u.id) }
    if ((us?.users ?? []).length < 1000) break
  }
}

// ── STEL sintético ──────────────────────────────────────────────────────────
const ITEMS = {
  'ZZE2-A': { id: 9001, clase: 'products', name: 'ZZ E2 Atornillador A' },
  'ZZE2-B': { id: 9002, clase: 'products', name: 'ZZ E2 Llave B' },
  'ZZE2-N': { id: 9003, clase: 'products', name: 'Taladro industrial XR' },
  'ZZE2-NUEVO': { id: 9004, clase: 'products', name: 'ZZ E2 Producto nuevo en STEL', description: 'Alta en STEL', price: 500 },
  'ZZE2-SER': { id: 9005, clase: 'services', name: 'ZZ E2 Servicio de calibración', price: 0 },
}
let idLinea = 1
const linea = (orden, sku, units, precio, dto = 0) => ({
  id: idLinea++, order: orden, 'line-type': 'ITEM', deleted: false, 'item-id': ITEMS[sku].id,
  'item-path': `app.stelorder.com/app/${ITEMS[sku].clase}/${ITEMS[sku].id}`, 'item-reference': sku, 'item-name': ITEMS[sku].name,
  'item-description': '', 'item-deleted': false, units, 'item-base-price': precio, 'discount-percentage': dto,
  'total-amount': Math.round(units * precio * (1 - dto / 100) * 100) / 100, 'primary-tax-percentage': 21,
  'secondary-tax-percentage': 0, 'income-tax-enabled': false, 'parent-document-id': null, 'warehouse-id': -2,
})
const doc = (id, ref, fecha, cuenta, estado, moneda, desc, lineas, padre = null) => {
  const neto = lineas.reduce((a, l) => a + l['total-amount'], 0)
  const sub = Math.round(neto * (1 - desc / 100) * 100) / 100
  const tax = Math.round(sub * 0.21 * 100) / 100
  return {
    id, 'full-reference': ref, reference: ref.replace(/^[A-Z-]+/, ''), date: `${fecha}T00:00:00+0000`, 'creation-date': `${fecha}T12:00:00+0000`,
    'utc-last-modification-date': `${fecha}T12:00:00+0000`, 'account-id': cuenta, 'agent-id': 1, 'creator-id': 1, 'document-state-id': estado,
    'serial-number-id': 1, 'parent-document-id': padre?.id ?? null, 'parent-document-path': padre ? `app.stelorder.com/app/${padre.ruta}/${padre.id}` : null,
    title: `ZZ E2 ${ref}`, 'currency-code': moneda, 'currency-rate': moneda === 'USD' ? 1 : 0.001, 'discount-percentage': desc,
    'discount-total-amount': Math.round((neto - sub) * 100) / 100, 'subtotal-amount': sub, 'tax-total-amount': tax, 'total-amount': Math.round((sub + tax) * 100) / 100,
    'tax-breakdown': [{ 'subtotal-amount': sub, 'tax-percentage': 21, 'tax-name': 'IVA', type: 'PRIMARY', 'total-amount': tax }],
    'primary-tax-enabled': true, 'secondary-tax-enabled': false, 'income-tax-enabled': false, 'income-tax-percentage': 0, deleted: false, lines: lineas,
  }
}
const Q = (id) => ({ id, ruta: 'salesEstimates' })
const O = (id) => ({ id, ruta: 'salesOrders' })
const stelSintetico = () => ({
  leidoEn: AHORA,
  estados: [
    { id: 1, name: 'Pendiente', type: 'SALESESTIMATE' }, { id: 2, name: 'Cerrada', type: 'SALESESTIMATE' },
    { id: 3, name: 'Cerrado', type: 'SALESORDER' }, { id: 4, name: 'Facturada', type: 'SALESDELIVERYNOTE' },
  ],
  clientes: [
    { id: 501, 'full-reference': 'CLI00501', 'legal-name': 'ZZ E2 METALURGICA S.A.', name: null, 'tax-identification-number': '30999999921', deleted: false },
    { id: 502, 'full-reference': 'CLI00502', 'legal-name': 'ZZ E2 Distribuidora SRL', name: null, 'tax-identification-number': null, deleted: false },
    { id: 503, 'full-reference': 'CLI00503', 'legal-name': 'ZZ E2 Otro SA', name: null, 'tax-identification-number': null, deleted: false },
  ],
  productos: Object.entries(ITEMS).map(([sku, it]) => ({ clase: it.clase, id: it.id, 'full-reference': sku, reference: sku, name: it.name, description: it.description ?? '', 'product-category-id': null, 'sales-price': it.price ?? 10, inactive: false, deleted: false, 'item-rates': [] })),
  padresExternos: { quote: [], order: [], noEncontrados: [] },
  docs: {
    quote: [
      doc(7001, 'COTI00090', '2026-09-01', 501, 2, 'USD', 10, [linea(0, 'ZZE2-A', 2, 100), linea(1, 'ZZE2-B', 1, 50)]),
      doc(7002, 'COTI00091', '2026-09-02', 502, 2, 'ARS', 0, [linea(0, 'ZZE2-A', 1, 120)]),
      doc(7003, 'COTI00092', '2026-09-10', 502, 1, 'ARS', 0, [linea(0, 'ZZE2-A', 3, 1000), linea(1, 'ZZE2-NUEVO', 1, 500), linea(2, 'ZZE2-SER', 1, 80)]),
      doc(7005, 'COTI00093', '2026-09-05', 501, 1, 'USD', 0, [linea(0, 'ZZE2-N', 2, 30)]),
      doc(7006, 'COTI00094', '2026-09-12', 503, 1, 'USD', 0, [linea(0, 'ZZE2-A', 1, 100)]),
    ],
    order: [
      doc(8001, 'PDV00040', '2026-09-03', 501, 3, 'USD', 10, [linea(0, 'ZZE2-A', 2, 100), linea(1, 'ZZE2-B', 1, 50)], Q(7001)),
      doc(8002, 'PDV00041', '2026-09-11', 502, 3, 'ARS', 0, [linea(0, 'ZZE2-A', 3, 1000), linea(1, 'ZZE2-NUEVO', 1, 500)], Q(7003)),
      doc(8003, 'PDV00042', '2026-09-06', 501, 3, 'USD', 0, [linea(0, 'ZZE2-N', 2, 30)], Q(7005)),
    ],
    delivery: [
      doc(9101, 'RT0000000020', '2026-09-04', 501, 4, 'USD', 10, [linea(0, 'ZZE2-A', 2, 100), linea(1, 'ZZE2-B', 1, 50)], O(8001)),
      doc(9102, 'RT0000000021', '2026-09-12', 502, 4, 'ARS', 0, [linea(0, 'ZZE2-A', 3, 1000), linea(1, 'ZZE2-NUEVO', 1, 500)], O(8002)),
      doc(9103, 'RT0000000022', '2026-09-05', 501, 4, 'USD', 10, [linea(0, 'ZZE2-A', 2, 100), linea(1, 'ZZE2-B', 1, 50)], Q(7001)),
      doc(9104, 'RT-ML2025000001', '2026-09-13', 502, 4, 'ARS', 0, [linea(0, 'ZZE2-SER', 1, 80)], Q(7003)),
    ],
  },
})

async function main() {
  await barrer()
  const huellaRealAntes = await huellaReal()
  INFO('huella real antes', huellaRealAntes)

  seccion('0 · Fixture')
  const slug = `${MARCA}-${Date.now()}`
  const E = ok(await s.from('companies').insert({ slug, name: 'ZZ F14 E2 Reconciliación', default_currency: 'USD' }).select('id').single(), 'empresa').id
  ok(await s.from('document_sequences').insert([
    { company_id: E, doc_type: 'quote', series_code: 'COTI', prefix: 'COTI', padding: 5, next_number: 100, is_default: true },
    { company_id: E, doc_type: 'sales_order', series_code: 'PDV', prefix: 'PDV', padding: 5, next_number: 50, is_default: true },
    { company_id: E, doc_type: 'delivery', series_code: 'RT', prefix: 'RT', padding: 10, next_number: 30, is_default: true },
  ]), 'secuencias')
  ok(await s.from('document_numbering_authority').insert(['quote', 'sales_order', 'delivery'].map((d) => ({ company_id: E, doc_type: d, authority: 'STEL', reason: 'ZZ F14 E2' }))), 'autoridad')
  const C1 = ok(await s.from('customers').insert({ company_id: E, legal_name: 'ZZ E2 Metalúrgica SA', tax_id: '30-99999992-1', status: 'active' }).select('id').single(), 'c1').id
  const C2 = ok(await s.from('customers').insert({ company_id: E, legal_name: 'ZZ E2 Distribuidora SRL', status: 'active' }).select('id').single(), 'c2').id
  ok(await s.from('customers').insert({ company_id: E, legal_name: 'ZZ E2 Otro SA', status: 'active' }).select('id').single(), 'c3')
  const cat = ok(await s.from('product_categories').insert({ company_id: E, name: 'ZZ E2 rubro', slug: `${MARCA}-rubro-${Date.now()}` }).select('id').single(), 'rubro').id
  const prods = ok(await s.from('products').insert([
    { company_id: E, category_id: cat, sku: 'ZZE2-A', name: 'ZZ E2 Atornillador A' },
    { company_id: E, category_id: cat, sku: 'ZZE2-B', name: 'ZZ E2 Llave B' },
    { company_id: E, category_id: cat, sku: 'ZZE2-N', name: 'Llave fija N' },
  ]).select('id, sku'), 'productos')
  const P = Object.fromEntries(prods.map((p) => [p.sku, p.id]))
  const W = ok(await s.from('warehouses').insert({ company_id: E, code: 'ZZE2', name: 'ZZ E2 depósito', is_default: true }).select('id').single(), 'depósito').id
  const LISTA = ok(await s.from('price_lists').insert({ company_id: E, name: 'ZZ E2 Lista base', currency_code: 'USD', is_default: true }).select('id').single(), 'lista').id
  const cli = C2

  const base = { company_id: E, imported_at: AHORA, legacy_source: 'erp_store' }
  const lq = (quote, no, sku, qty, price, prod = P[sku]) => ({ company_id: E, quote_id: quote, line_no: no, product_id: prod, sku_snapshot: sku, name_snapshot: ITEMS[sku].name, quantity: qty, unit_price: price, discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21, line_type: 'item' })
  const Q1 = ok(await s.from('sales_quotes').insert({ ...base, number: 'COTI00090', original_number: 'COTI00090', series_code: 'COTI', customer_id: C1, quote_date: '2026-09-01', currency_code: null, status: 'sent', subtotal: 250, tax_amount: 47.25, total: 297.25, discount_pct: 0 }).select('id').single(), 'Q1').id
  ok(await s.from('sales_quote_lines').insert([lq(Q1, 1, 'ZZE2-B', 1, 50), lq(Q1, 2, 'ZZE2-A', 2, 100)]), 'Q1 líneas')
  const Q2 = ok(await s.from('sales_quotes').insert({ ...base, number: 'COTI00091', original_number: 'COTI00091', series_code: 'COTI', customer_id: C2, quote_date: '2026-09-02', currency_code: null, status: 'sent', subtotal: 120, tax_amount: 25.2, total: 145.2, discount_pct: 0 }).select('id').single(), 'Q2').id
  const lQ2 = ok(await s.from('sales_quote_lines').insert([lq(Q2, 1, 'ZZE2-A', 1, 100), lq(Q2, 2, 'ZZE2-B', 5, 50)]).select('id, line_no'), 'Q2 líneas')
  ok(await s.from('sales_quotes').update({ status: 'accepted' }).eq('id', Q2), 'Q2 aceptada')
  const Q4 = ok(await s.from('sales_quotes').insert({ ...base, number: 'COTI00089', original_number: 'COTI00089', series_code: 'COTI', customer_id: C1, quote_date: '2026-08-30', currency_code: 'USD', status: 'sent', subtotal: 10, tax_amount: 2.1, total: 12.1, discount_pct: 0 }).select('id').single(), 'Q4').id
  const Q5 = ok(await s.from('sales_quotes').insert({ ...base, number: 'COTI00093', original_number: 'COTI00093', series_code: 'COTI', customer_id: C1, quote_date: '2026-09-05', currency_code: null, status: 'sent', subtotal: 60, tax_amount: 12.6, total: 72.6, discount_pct: 0 }).select('id').single(), 'Q5').id
  ok(await s.from('sales_quote_lines').insert(lq(Q5, 1, 'ZZE2-N', 2, 29)), 'Q5 línea')
  const O1 = ok(await s.from('sales_orders').insert({ ...base, number: 'PDV00040', original_number: 'PDV00040', series_code: 'PDV', customer_id: C1, order_date: '2026-09-03', origin: 'migration', currency_code: 'USD', commercial_status: 'confirmed', fulfillment_status: 'delivered', subtotal: 225, tax_amount: 47.25, total: 272.25, discount_pct: 10 }).select('id').single(), 'O1').id
  const lO1 = ok(await s.from('sales_order_lines').insert([
    { company_id: E, order_id: O1, line_no: 1, product_id: null, sku_snapshot: 'ZZE2-A', name_snapshot: 'ZZ E2 Atornillador A', quantity_ordered: 2, unit_price: 100, discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21, line_type: 'item' },
    { company_id: E, order_id: O1, line_no: 2, product_id: P['ZZE2-B'], sku_snapshot: 'ZZE2-B', name_snapshot: 'ZZ E2 Llave B', quantity_ordered: 1, unit_price: 50, discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21, line_type: 'item' },
  ]).select('id, line_no'), 'O1 líneas')
  const O3 = ok(await s.from('sales_orders').insert({ ...base, number: 'PDV00042', original_number: 'PDV00042', series_code: 'PDV', customer_id: C1, order_date: '2026-09-06', origin: 'migration', currency_code: 'USD', commercial_status: 'confirmed', fulfillment_status: 'pending', subtotal: 60, tax_amount: 12.6, total: 72.6, discount_pct: 0 }).select('id').single(), 'O3').id
  ok(await s.from('sales_order_lines').insert({ company_id: E, order_id: O3, line_no: 1, product_id: P['ZZE2-N'], sku_snapshot: 'ZZE2-N', name_snapshot: 'x', quantity_ordered: 2, unit_price: 30, discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21, line_type: 'item' }), 'O3 línea')
  const dl = (del, sku, qty) => ({ company_id: E, delivery_id: del, product_id: P[sku], sku_snapshot: sku, name_snapshot: ITEMS[sku].name, quantity: qty, warehouse_id: W })
  const D0 = ok(await s.from('deliveries').insert({ ...base, number: 'RT0000000020', original_number: 'RT0000000020', series_code: 'RT', customer_id: C1, delivery_date: '2026-09-04', status: 'delivered', currency_code: null, subtotal: 225, tax_amount: 47.25, total: 272.25 }).select('id').single(), 'D0').id
  ok(await s.from('delivery_lines').insert([dl(D0, 'ZZE2-A', 2), dl(D0, 'ZZE2-B', 1)]), 'D0 líneas')
  const D2 = ok(await s.from('deliveries').insert({ ...base, number: 'RT0000000022', original_number: 'RT0000000022', series_code: 'RT', customer_id: C1, delivery_date: '2026-09-05', status: 'delivered', currency_code: 'USD', subtotal: 225, tax_amount: 47.25, total: 272.25 }).select('id').single(), 'D2').id
  ok(await s.from('delivery_lines').insert([dl(D2, 'ZZE2-A', 2), dl(D2, 'ZZE2-B', 1)]), 'D2 líneas')
  const seqAntes = ok(await s.from('document_sequences').select('doc_type, next_number').eq('company_id', E).order('doc_type'), 'seq')
  PASS('fixture creada', `${slug}`)

  seccion('1 · Red team: nadie de la app llega al camino de reconciliación')
  const roles = {
    anon: createClient(BASE, PUB, { auth: { persistSession: false } }),
    admin: await usuario(E, 'admin'), employee: await usuario(E, 'employee'), salesperson: await usuario(E, 'salesperson'),
    technician: await usuario(E, 'technician'), customer: await usuario(E, 'customer', cli), distributor: await usuario(E, 'distributor', cli),
  }
  const rpcs = [
    ['stel_reconciliacion_iniciar', { p_company: E, p_plan_hash: 'a'.repeat(64), p_stel_read_at: AHORA }],
    ['stel_reconciliar_documento', { p_run: randomUUID(), p: { tipo: 'quote', stel_id: '7001', numero: 'COTI00090', operacion: 'update', react_id: Q1, cabecera: { total: { old: 297.25, new: 1 } } } }],
    ['stel_reconciliar_producto', { p_run: randomUUID(), p: { op: 'vincular', stel_id: '9001', sku: 'ZZE2-A', product_id: P['ZZE2-A'] } }],
    ['stel_asegurar_categoria_revision', { p_run: randomUUID(), p_nombre: 'x', p_slug: 'x' }],
    ['stel_revertir_reconciliacion', { p_run: randomUUID(), p_limite: 1 }],
    ['stel_reconciliacion_cerrar', { p_run: randomUUID(), p_estado: 'finished', p_resumen: {} }],
  ]
  for (const [rol, c] of Object.entries(roles)) {
    const res = []
    for (const [fn, args] of rpcs) {
      const r = await c.rpc(fn, args)
      res.push(r.error && /permission denied|42501/i.test(`${r.error.message} ${r.error.code}`) ? 'DENEGADO' : `OTRO(${r.error?.code ?? 'ok'})`)
    }
    cmp(`${rol}: las 6 RPC de reconciliación → permiso denegado`, Array(6).fill('DENEGADO'), res)
    const log = await c.from('stel_reconciliation_log').select('id').limit(1)
    const runs = await c.from('stel_reconciliation_runs').select('id').limit(1)
    cmp(`${rol}: no lee la bitácora ni los runs`, [true, true], [Boolean(log.error) || (log.data ?? []).length === 0, Boolean(runs.error) || (runs.data ?? []).length === 0])
  }
  const intentos = [
    ['cambiar la marca de importación', roles.admin.from('sales_quotes').update({ imported_at: '2020-01-01T00:00:00Z' }).eq('id', Q4).select('id')],
    ['quitar la marca de importación', roles.admin.from('sales_quotes').update({ imported_at: null }).eq('id', Q4).select('id')],
    ['poner id externo STEL', roles.admin.from('sales_quotes').update({ external_source: 'stel', external_id: '1' }).eq('id', Q4).select('id')],
    ['poner source_quote_id', roles.admin.from('deliveries').update({ source_quote_id: Q1 }).eq('id', D0).select('id')],
    ['crear cotización importada', roles.admin.from('sales_quotes').insert({ company_id: E, number: 'COTI09999', series_code: 'COTI', customer_id: C1, quote_date: '2026-09-15', status: 'draft', imported_at: AHORA }).select('id')],
    ['vincular producto a STEL', roles.admin.from('products').update({ external_source: 'stel', external_id: '9001' }).eq('id', P['ZZE2-A']).select('id')],
  ]
  for (const [que, q] of intentos) {
    const r = await q
    const bloqueado = Boolean(r.error) && /campo_de_importacion|permission|row-level|42501|external_numbering_authority/i.test(`${r.error.message} ${r.error.code}`)
    const vacio = !r.error && (r.data ?? []).length === 0
    cmp(`admin por REST no puede ${que}`, true, bloqueado || vacio)
  }
  cmp('Q4 sigue sin id externo ni cambios', [null, true], Object.values(ok(await s.from('sales_quotes').select('external_id, imported_at').eq('id', Q4).single(), 'Q4')).map((v, i) => (i === 1 ? Boolean(v) : v)))

  seccion('2 · Plan inicial')
  const stel = stelSintetico()
  const plan1 = planificarE2(stel, await leerReactEmpresa(s, slug), { listaBaseId: LISTA }).plan
  const r1 = plan1.resumen
  cmp('productos: 2 a crear (1 servicio), 2 a vincular, 1 bloqueado por nombre', [2, 1, 2, 1], [r1.PRODUCTS_TO_CREATE, r1.PRODUCTS_TO_CREATE_SERVICES, r1.PRODUCTS_TO_LINK, r1.PRODUCTS_BLOCKED])
  cmp('bloqueados: NAME_MISMATCH y cliente sólo por nombre (COTI00094)', { NAME_MISMATCH: 1, CLIENTE_SOLO_POR_NOMBRE_SIN_CONFIRMAR: 1 }, r1.BLOCKED_BY_REASON)
  cmp('documentos a insertar: Q3, O2, D1, RT-ML directo de cotización', { quote: 1, order: 1, delivery: 2 }, r1.DOCUMENTS_TO_INSERT_BY_TYPE)
  cmp('borrado pendiente de aprobación: 1 línea sobrante en Q2', 1, r1.LINES_TO_DELETE_PENDING_APPROVAL)
  cmp('Q4 sólo en React: se conserva', ['COTI00089'], plan1.info.soloEnReact.map((x) => x.numero))
  const doc1 = (n) => plan1.documentos.find((d) => d.numero === n)
  cmp('Q1: moneda, totales STEL, estado Cerrada→accepted, id externo', ['currency_code', 'discount_pct', 'external_id', 'external_source', 'status', 'subtotal', 'total'], Object.keys(doc1('COTI00090').cabecera).sort())
  cmp('Q1: el orden distinto de líneas NO genera cambios de línea', 0, doc1('COTI00090').lineas.actualizar.length)
  cmp('D2: remito directo de cotización → source_quote_id', Q1, doc1('RT0000000022').cabecera.source_quote_id?.new)
  cmp('RT-ML insertado con source_quote_id del Q3 que también se inserta', { depende: 'COTI00092' }, doc1('RT-ML2025000001').cabecera.source_quote_id)
  cmp('O3 depende de Q5 (si Q5 falla, no se relinkea)', ['quote:COTI00093'], doc1('PDV00042').depende)
  cmp('el hash del plan es estable', hashPlan(plan1), hashPlan(structuredClone(plan1)))

  seccion('3 · Ejecución sin autorización')
  const real = ok(await s.from('companies').select('id').eq('slug', 'buscatools').single(), 'real').id
  const planReal = { ...structuredClone(plan1), empresa: real }
  const runsRealAntes = (await s.from('stel_reconciliation_runs').select('id', { count: 'exact', head: true }).eq('company_id', real)).count
  const neg = await ejecutarPlan(s, planReal, {}).then(() => 'EJECUTÓ').catch((e) => (/sin autorización/.test(e.message) ? 'NEGADO' : e.message))
  const negHash = await ejecutarPlan(s, planReal, { autorizacion: { confirmado: true, planHash: 'f'.repeat(64) } }).then(() => 'EJECUTÓ').catch((e) => (/sin autorización/.test(e.message) ? 'NEGADO' : e.message))
  cmp('empresa real sin autorización / con hash de otro plan → negado antes de tocar la base', ['NEGADO', 'NEGADO', runsRealAntes], [neg, negHash, (await s.from('stel_reconciliation_runs').select('id', { count: 'exact', head: true }).eq('company_id', real)).count])

  seccion('4 · Fallo parcial')
  // Alguien cambia Q5 entre el plan y la ejecución: su cabecera no coincide con el `old` del plan.
  ok(await s.from('sales_quotes').update({ title: 'cambio concurrente', currency_code: 'EUR' }).eq('id', Q5), 'conflicto Q5')
  const huellaPreRun = await huellaEmpresa(s, E, { soloNegocio: true })
  const h1 = await ejecutarPlan(s, plan1, { log: () => {} })
  cmp('Q5 falla por conflicto y O3 se saltea por dependencia', [['quote:COTI00093'], ['order:PDV00042']], [h1.fallidos.map((f) => f.item), h1.salteados.map((f) => f.item)])
  cmp('el run queda failed', 'failed', ok(await s.from('stel_reconciliation_runs').select('status').eq('id', h1.run).single(), 'run').status)
  const q5 = ok(await s.from('sales_quotes').select('currency_code, subtotal, external_id').eq('id', Q5).single(), 'Q5')
  const lq5 = ok(await s.from('sales_quote_lines').select('unit_price').eq('quote_id', Q5).single(), 'Q5 línea')
  cmp('Q5 atómico: ni cabecera ni línea cambiaron', ['EUR', 60, null, 29], [q5.currency_code, num(q5.subtotal), q5.external_id, num(lq5.unit_price)])
  cmp('O3 sin vínculo', null, ok(await s.from('sales_orders').select('quote_id').eq('id', O3).single(), 'O3').quote_id)

  seccion('5 · Lo que sí se aplicó')
  const nuevo = ok(await s.from('products').select('id, sku, status, needs_review, product_type, external_id, category_id').eq('company_id', E).eq('sku', 'ZZE2-NUEVO').single(), 'NUEVO')
  const ser = ok(await s.from('products').select('product_type, external_id').eq('company_id', E).eq('sku', 'ZZE2-SER').single(), 'SER')
  const catRev = ok(await s.from('product_categories').select('id, name, needs_review').eq('id', nuevo.category_id).single(), 'categoría')
  const precio = ok(await s.from('product_prices').select('amount, price_list_id').eq('product_id', nuevo.id), 'precio')
  cmp('product import: producto nuevo con id STEL, en revisión, categoría técnica y precio STEL en lista base', ['9004', true, 'active', 'Pendiente de clasificación STEL', true, [[500, LISTA]]], [nuevo.external_id, nuevo.needs_review, nuevo.status, catRev.name, catRev.needs_review, precio.map((p) => [num(p.amount), p.price_list_id])])
  cmp('servicio importado como tipo Servicio', ['Servicio', '9005'], [ser.product_type, ser.external_id])
  cmp('categorías existentes intactas (la de la fixture sigue sin revisión)', false, ok(await s.from('product_categories').select('needs_review').eq('id', cat).single(), 'cat').needs_review)
  const vinc = ok(await s.from('products').select('sku, external_id').eq('company_id', E).in('sku', ['ZZE2-A', 'ZZE2-B', 'ZZE2-N']).order('sku'), 'vinc')
  cmp('vincular por SKU único; el de nombre incompatible NO', [['ZZE2-A', '9001'], ['ZZE2-B', '9002'], ['ZZE2-N', null]], vinc.map((p) => [p.sku, p.external_id]))
  const q1 = ok(await s.from('sales_quotes').select('currency_code, subtotal, tax_amount, total, discount_pct, status, external_id').eq('id', Q1).single(), 'Q1')
  cmp('document update: Q1 moneda, totales oficiales STEL, estado, id externo', ['USD', 225, 47.25, 272.25, 10, 'accepted', '7001'], [q1.currency_code, num(q1.subtotal), num(q1.tax_amount), num(q1.total), num(q1.discount_pct), q1.status, q1.external_id])
  const q2 = ok(await s.from('sales_quotes').select('status, currency_code, external_id').eq('id', Q2).single(), 'Q2')
  const lq2 = ok(await s.from('sales_quote_lines').select('id, line_no, unit_price').eq('quote_id', Q2).order('line_no'), 'Q2 líneas')
  cmp('closed quote reconciliation: Q2 aceptada recibe moneda y precio de línea; la línea sobrante sigue (pendiente)', ['accepted', 'ARS', '7002', [[1, 120], [2, 50]]], [q2.status, q2.currency_code, q2.external_id, lq2.map((l) => [l.line_no, num(l.unit_price)])])
  const directo = await s.from('sales_quotes').update({ total: 1 }).eq('id', Q2).select('id')
  cmp('fuera de la RPC, el trigger sigue congelando la cotización aceptada (sin bypass general)', true, Boolean(directo.error) && /no se puede modificar/.test(directo.error.message))
  const o1 = ok(await s.from('sales_orders').select('quote_id').eq('id', O1).single(), 'O1')
  const lo1 = ok(await s.from('sales_order_lines').select('product_id').eq('id', lO1.find((l) => l.line_no === 1).id).single(), 'O1 l1')
  const d0 = ok(await s.from('deliveries').select('order_id, currency_code, total').eq('id', D0).single(), 'D0')
  const ld0 = ok(await s.from('delivery_lines').select('sku_snapshot, unit_price, discount_pct').eq('delivery_id', D0).order('sku_snapshot'), 'D0 l')
  cmp('relationships: O1→Q1, D0→O1; línea de O1 vinculada al producto', [Q1, O1, P['ZZE2-A']], [o1.quote_id, d0.order_id, lo1.product_id])
  cmp('currencies + precios de remito histórico, total preservado', ['USD', 272.25, [['ZZE2-A', 100, 0], ['ZZE2-B', 50, 0]]], [d0.currency_code, num(d0.total), ld0.map((l) => [l.sku_snapshot, num(l.unit_price), num(l.discount_pct)])])
  const d2 = ok(await s.from('deliveries').select('order_id, source_quote_id').eq('id', D2).single(), 'D2')
  cmp('quote-direct-delivery: D2 con source_quote_id y sin pedido inventado', [null, Q1], [d2.order_id, d2.source_quote_id])
  const q3 = ok(await s.from('sales_quotes').select('id, status, currency_code, total, imported_at, legacy_source, external_source, external_id').eq('company_id', E).eq('number', 'COTI00092').single(), 'Q3')
  const lq3 = ok(await s.from('sales_quote_lines').select('sku_snapshot, product_id, line_type').eq('quote_id', q3.id).order('line_no'), 'Q3 l')
  const serId = ok(await s.from('products').select('id').eq('company_id', E).eq('sku', 'ZZE2-SER').single(), 'SER id').id
  cmp('document insert: Q3 importada ARS con id STEL y líneas vinculadas (incl. producto y servicio creados)', ['sent', 'ARS', 4331.8, true, 'stel_reconciliation', 'stel', '7003', [['ZZE2-A', P['ZZE2-A'], 'item'], ['ZZE2-NUEVO', nuevo.id, 'item'], ['ZZE2-SER', serId, 'service']]],
    [q3.status, q3.currency_code, num(q3.total), Boolean(q3.imported_at), q3.legacy_source, q3.external_source, q3.external_id, lq3.map((l) => [l.sku_snapshot, l.product_id, l.line_type])])
  const o2 = ok(await s.from('sales_orders').select('id, quote_id, origin, fulfillment_status').eq('company_id', E).eq('number', 'PDV00041').single(), 'O2')
  const d1 = ok(await s.from('deliveries').select('order_id, status').eq('company_id', E).eq('number', 'RT0000000021').single(), 'D1')
  const ml = ok(await s.from('deliveries').select('order_id, source_quote_id, series_code, status').eq('company_id', E).eq('number', 'RT-ML2025000001').single(), 'ML')
  cmp('O2→Q3 (pedido con remito en STEL = delivered), D1→O2, RT-ML→Q3 sin pedido', [q3.id, 'migration', 'delivered', o2.id, 'delivered', null, q3.id, 'RT-ML'], [o2.quote_id, o2.origin, o2.fulfillment_status, d1.order_id, d1.status, ml.order_id, ml.source_quote_id, ml.series_code])
  const nota = ok(await s.from('stel_reconciliation_log').select('detail').eq('run_id', h1.run).eq('action', 'note').eq('entity_id', Q1).single(), 'nota')
  cmp('auditoría de totales en la bitácora (bruto, descuento, STEL, calculado)', [250, 10, 272.25], [nota.detail.subtotal_bruto, nota.detail.descuento_pct, nota.detail.total_stel])
  const logs = ok(await s.from('stel_reconciliation_log').select('source, run_id').eq('company_id', E), 'logs')
  cmp('toda la bitácora con source STEL_RECONCILIATION y run id', true, logs.length > 0 && logs.every((l) => l.source === 'STEL_RECONCILIATION' && l.run_id === h1.run))

  seccion('6 · Reintento')
  const plan2 = planificarE2(stel, await leerReactEmpresa(s, slug), { listaBaseId: LISTA }).plan
  cmp('el plan de reintento sólo trae Q5 y O3 (lo aplicado no se repite)', ['COTI00093', 'PDV00042'], plan2.documentos.map((d) => d.numero))
  cmp('Q5 ahora ve la moneda EUR ≠ USD de STEL: bloqueado para revisión, no pisado', 'MONEDA_DISTINTA_REVISAR', plan2.bloqueados.find((b) => b.numero === 'COTI00093')?.motivo)
  ok(await s.from('sales_quotes').update({ currency_code: null }).eq('id', Q5), 'resolver conflicto Q5')
  const plan2b = planificarE2(stel, await leerReactEmpresa(s, slug), { listaBaseId: LISTA }).plan
  const h2 = await ejecutarPlan(s, plan2b, { log: () => {} })
  cmp('retry: Q5 y O3 aplicados, run finished', [[], [], 'finished'], [h2.fallidos, h2.salteados, ok(await s.from('stel_reconciliation_runs').select('status').eq('id', h2.run).single(), 'run2').status])
  cmp('O3 → Q5', Q5, ok(await s.from('sales_orders').select('quote_id').eq('id', O3).single(), 'O3').quote_id)

  seccion('7 · Segunda corrida y borrado aprobado')
  const plan3 = planificarE2(stel, await leerReactEmpresa(s, slug), { listaBaseId: LISTA }).plan
  cmp('second run: 0 productos y 0 documentos a tocar', [0, 0, 0], [plan3.productos.length, plan3.documentos.length, plan3.resumen.CATEGORY_TO_CREATE])
  cmp('idempotent product sync: crear y vincular otra vez → 0 cambios', [0, 0], await (async () => {
    const run = ok(await s.rpc('stel_reconciliacion_iniciar', { p_company: E, p_plan_hash: 'b'.repeat(64), p_stel_read_at: AHORA }), 'run idem')
    const a = ok(await s.rpc('stel_reconciliar_producto', { p_run: run, p: { op: 'crear', stel_id: '9004', sku: 'ZZE2-NUEVO', name: 'x', status: 'active', category_id: nuevo.category_id } }), 'crear')
    const b = ok(await s.rpc('stel_reconciliar_producto', { p_run: run, p: { op: 'vincular', stel_id: '9001', sku: 'ZZE2-A', product_id: P['ZZE2-A'] } }), 'vincular')
    ok(await s.rpc('stel_reconciliacion_cerrar', { p_run: run, p_estado: 'finished', p_resumen: {} }), 'cerrar idem')
    return [a.cambios, b.cambios]
  })())
  const pendiente = plan3.pendientesBorrado[0]
  cmp('el borrado sigue pendiente y es la línea sobrante de Q2', [1, lQ2.find((l) => l.line_no === 2).id], [plan3.pendientesBorrado.length, pendiente?.react_linea_id])
  const sinAprob = ok(await s.rpc('stel_reconciliacion_iniciar', { p_company: E, p_plan_hash: 'c'.repeat(64), p_stel_read_at: AHORA }), 'run sin aprob')
  const rNo = await s.rpc('stel_reconciliar_documento', { p_run: sinAprob, p: { tipo: 'quote', stel_id: '7002', numero: 'COTI00091', operacion: 'update', react_id: Q2, cabecera: {}, lineas: { borrar: [{ id: pendiente.react_linea_id }] } } })
  ok(await s.rpc('stel_reconciliacion_cerrar', { p_run: sinAprob, p_estado: 'failed', p_resumen: {} }), 'cerrar')
  cmp('la RPC rechaza un borrado sin aprobación explícita', true, Boolean(rNo.error) && /borrado_sin_aprobacion/.test(rNo.error.message))
  const plan4 = planificarE2(stel, await leerReactEmpresa(s, slug), { listaBaseId: LISTA, aprobados: { borrados: [pendiente.react_linea_id] } }).plan
  const h3 = await ejecutarPlan(s, plan4, { log: () => {}, })
  const borrada = ok(await s.from('stel_reconciliation_log').select('old_value').eq('run_id', h3.run).eq('action', 'delete').single(), 'log borrado')
  cmp('borrado aprobado: la línea sale y queda entera en la bitácora', [0, 'ZZE2-B', 5], [(await s.from('sales_quote_lines').select('id').eq('id', pendiente.react_linea_id)).data.length, borrada.old_value.sku_snapshot, num(borrada.old_value.quantity)])
  const plan5 = planificarE2(stel, await leerReactEmpresa(s, slug), { listaBaseId: LISTA }).plan
  cmp('tercera corrida: 0 documentos, 0 productos, 0 borrados pendientes', [0, 0, 0], [plan5.documentos.length, plan5.productos.length, plan5.pendientesBorrado.length])

  seccion('8 · Efectos laterales')
  const cuenta = async (t) => (await s.from(t).select('*', { count: 'exact', head: true }).eq('company_id', E)).count
  cmp('historical delivery without stock movement: 0 movimientos, 0 reservas, 0 saldos', [0, 0, 0], [await cuenta('stock_movements'), await cuenta('stock_reservations'), await cuenta('stock_balances')])
  cmp('0 eventos de venta (no se finge un usuario)', 0, await cuenta('sales_audit'))
  cmp('secuencias sin consumir', seqAntes, ok(await s.from('document_sequences').select('doc_type, next_number').eq('company_id', E).order('doc_type'), 'seq'))
  cmp('autoridad STEL intacta', ['STEL', 'STEL', 'STEL'], ok(await s.from('document_numbering_authority').select('authority').eq('company_id', E).order('doc_type'), 'aut').map((a) => a.authority))
  cmp('Q4 (sólo React) intacta', ['USD', 12.1, null], Object.values(ok(await s.from('sales_quotes').select('currency_code, total, external_id').eq('id', Q4).single(), 'Q4')).map((v, i) => (i === 1 ? num(v) : v)))

  seccion('9 · Rollback desde la bitácora')
  for (const run of [h3.run, h2.run, h1.run]) await revertirRun(s, run)
  // El único cambio hecho a mano entre la huella y los runs (resolver el conflicto de Q5) se deshace a mano.
  ok(await s.from('sales_quotes').update({ currency_code: 'EUR' }).eq('id', Q5), 'volver Q5')
  const huellaPostRollback = await huellaEmpresa(s, E, { soloNegocio: true })
  const distintas = Object.keys(huellaPreRun).filter((t) => huellaPreRun[t].hash !== huellaPostRollback[t].hash)
  cmp('headers, líneas, relaciones, productos, precios y categorías vuelven exactamente a antes de los runs', [], distintas)
  cmp('los runs quedan rolled_back', ['rolled_back', 'rolled_back', 'rolled_back'], await Promise.all([h1.run, h2.run, h3.run].map(async (id) => ok(await s.from('stel_reconciliation_runs').select('status').eq('id', id).single(), 'st').status)))

  seccion('10 · Limpieza y datos reales')
  await barrer()
  cmp('0 empresas zz-f14e2', 0, (await s.from('companies').select('*', { count: 'exact', head: true }).like('slug', `${MARCA}-%`)).count)
  cmp('datos reales intactos (huella de todas las tablas de Ventas, catálogo, stock y secuencias)', huellaRealAntes, await huellaReal())

  console.log(`\n  ${fallos === 0 ? 'ALL PASS' : `${fallos} FALLA(S)`}`)
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('✗', e.message)
  try { await barrer() } catch (e2) { console.error('✗ limpieza:', e2.message) }
  process.exit(1)
})
