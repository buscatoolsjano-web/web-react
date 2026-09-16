/**
 * Fase 14 · Entrega 3 — invariantes de workflow previas al cutover (DB real, fixture).
 *
 *   1  moneda: cotización sin moneda → DOCUMENT_CURRENCY_REQUIRED; con moneda OK;
 *      no se puede vaciar; pedido desde cotización conserva la moneda (otra →
 *      DOCUMENT_CURRENCY_MISMATCH); remito conserva la del pedido; los importados
 *      (históricos STEL) quedan fuera de la regla;
 *   2  remito: borrador → cancelar OK sin stock; borrador → despachar OK, stock
 *      una sola vez; despachado → cancelar BLOQUEADO (REST admin, REST service
 *      role, reintento), sin tocar stock ni cumplimiento; volver a borrador,
 *      marcar entregado o editar/borrar líneas de un despachado → BLOQUEADO;
 *      pasar a despachado por REST o insertar ya despachado → BLOQUEADO;
 *      cancelado es terminal; re-despachar idempotente;
 *   3  red team: salesperson, technician, customer, distributor, anon y admin de
 *      otra empresa no cancelan, no despachan, no fuerzan estados;
 *   4  STEL: Buscatools sigue con autoridad STEL en las tres series; la empresa
 *      fixture (sin filas de autoridad = ERP) ejecuta el workflow futuro;
 *   5  limpieza total y datos reales intactos.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase14-e3-cutover-readiness-tests.mjs
 *
 * Empresas zz-f14e3-* y usuarios zz-f14e3-*@buscatools.test. NO correr en paralelo con otra suite de base.
 */
import { createClient } from '@supabase/supabase-js'
import { createHash, randomUUID } from 'node:crypto'
import { huellaEmpresa } from './lib/stel-reconciliacion.mjs'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET) { console.error('✗ Faltan variables'); process.exit(1) }
const s = createClient(BASE, SECRET, { auth: { persistSession: false } })
const anon = createClient(BASE, PUB, { auth: { persistSession: false } })
const MARCA = 'zz-f14e3'
const HOY = new Date().toISOString().slice(0, 10)

let fallos = 0
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const cmp = (t, esp, real) => (JSON.stringify(esp) === JSON.stringify(real) ? PASS(t, JSON.stringify(real).slice(0, 140)) : FAIL(t, `esperaba ${JSON.stringify(esp)}, dio ${JSON.stringify(real)}`))
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(72)}`)
const ok = (r, que) => { if (r.error) throw new Error(`${que}: ${r.error.message}`); return r.data }
const num = (v) => (v === null || v === undefined ? null : Number(v))
const hash = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16)

/** OK · VACIO (RLS filtró) · PERMISO · STEL · o el código semántico de la base. */
const clase = (r) => {
  if (!r.error) return Array.isArray(r.data) && r.data.length === 0 ? 'VACIO' : 'OK'
  const m = `${r.error.message ?? ''}`
  for (const c of ['DELIVERY_ALREADY_DISPATCHED', 'DELIVERY_CANCELLED', 'DELIVERY_STATUS_REQUIRES_DISPATCH', 'DOCUMENT_CURRENCY_REQUIRED', 'DOCUMENT_CURRENCY_MISMATCH']) if (m.includes(c)) return c
  if (m === 'external_numbering_authority') return 'STEL'
  if (/permission denied|Sin permiso|42501|row-level security|insufficient_privilege/i.test(`${m} ${r.error.code}`)) return 'PERMISO'
  return `OTRO(${r.error.code}: ${m.slice(0, 80)})`
}

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
  for (const { id } of c) for (const [t, v] of Object.entries(await huellaEmpresa(s, id))) out[`${id.slice(0, 4)}.${t}`] = v.hash
  return hash(out)
}

async function barrer() {
  const { data: emp } = await s.from('companies').select('id').like('slug', `${MARCA}-%`)
  for (const { id } of emp ?? []) {
    for (const t of ['stock_reservations', 'stock_movements', 'stock_balances', 'sales_audit']) ok(await s.from(t).delete().eq('company_id', id), `limpiar ${t}`)
    // Históricos de la fixture (nacen con moneda): mientras siguen importados se les quita
    // el vínculo; recién ahí se les saca la marca, porque las reglas de E3 valen.
    ok(await s.from('sales_orders').update({ quote_id: null }).eq('company_id', id).not('imported_at', 'is', null), 'desvincular históricos')
    for (const t of ['deliveries', 'sales_orders', 'sales_quotes']) ok(await s.from(t).update({ imported_at: null }).eq('company_id', id).not('imported_at', 'is', null), `desmarcar ${t}`)
    ok(await s.from('delivery_lines').delete().eq('company_id', id), 'limpiar delivery_lines')
    for (const t of ['deliveries', 'sales_orders', 'sales_quotes']) ok(await s.from(t).delete().eq('company_id', id), `limpiar ${t}`)
    for (const t of ['product_prices', 'price_lists', 'products', 'product_categories', 'company_memberships', 'customers', 'warehouses', 'document_numbering_authority', 'document_numbering_authority_audit', 'document_sequences']) ok(await s.from(t).delete().eq('company_id', id), `limpiar ${t}`)
    ok(await s.from('companies').delete().eq('id', id), 'limpiar empresa')
  }
  for (let page = 1; ; page++) {
    const { data: us } = await s.auth.admin.listUsers({ page, perPage: 1000 })
    for (const u of us?.users ?? []) if (u.email?.startsWith(`${MARCA}-`)) { await s.from('company_memberships').delete().eq('user_id', u.id); await s.auth.admin.deleteUser(u.id) }
    if ((us?.users ?? []).length < 1000) break
  }
}

async function empresa(etiqueta) {
  const E = ok(await s.from('companies').insert({ slug: `${MARCA}-${etiqueta}-${Date.now()}`, name: `ZZ F14 E3 ${etiqueta}`, default_currency: 'USD' }).select('id').single(), 'empresa').id
  ok(await s.from('document_sequences').insert([
    { company_id: E, doc_type: 'quote', series_code: 'COTI', prefix: 'COTI', padding: 5, next_number: 1, is_default: true },
    { company_id: E, doc_type: 'sales_order', series_code: 'PDV', prefix: 'PDV', padding: 5, next_number: 1, is_default: true },
    { company_id: E, doc_type: 'delivery', series_code: 'RT', prefix: 'RT', padding: 10, next_number: 1, is_default: true },
  ]), 'secuencias')
  const cli = ok(await s.from('customers').insert({ company_id: E, legal_name: `ZZ E3 Cliente ${etiqueta}`, status: 'active' }).select('id').single(), 'cliente').id
  const cat = ok(await s.from('product_categories').insert({ company_id: E, name: 'ZZ E3 rubro', slug: `${MARCA}-rubro-${etiqueta}-${Date.now()}` }).select('id').single(), 'rubro').id
  const A = ok(await s.from('products').insert({ company_id: E, category_id: cat, sku: `ZZE3-A-${etiqueta}`, name: 'ZZ E3 Atornillador' }).select('id').single(), 'producto').id
  const W = ok(await s.from('warehouses').insert({ company_id: E, code: `ZZE3${etiqueta}`.slice(0, 10), name: 'ZZ E3 depósito', is_default: true }).select('id').single(), 'depósito').id
  ok(await s.from('stock_movements').insert({ company_id: E, product_id: A, warehouse_id: W, movement_type: 'adjustment', quantity: 50, source_type: MARCA, notes: 'ZZ E3 stock inicial' }), 'stock')
  return { E, cli, A, W }
}

async function main() {
  await barrer()
  const huellaAntes = await huellaReal()
  PASS('huella real tomada', huellaAntes)

  seccion('0 · Fixture: empresa ERP (sin filas de autoridad) y otra empresa')
  const F = await empresa('erp')
  const O = await empresa('otra')
  const id = {
    admin: await usuario(F.E, 'admin'), employee: await usuario(F.E, 'employee'), salesperson: await usuario(F.E, 'salesperson'),
    technician: await usuario(F.E, 'technician'), customer: await usuario(F.E, 'customer', F.cli), distributor: await usuario(F.E, 'distributor', F.cli),
    adminOtra: await usuario(O.E, 'admin'),
  }
  const c = id.admin
  const numero = async (t) => ok(await c.rpc('next_document_number', { p_company: F.E, p_doc_type: t }), `número ${t}`)
  const saldo = async () => num((await s.from('stock_balances').select('on_hand').eq('product_id', F.A).eq('warehouse_id', F.W).single()).data?.on_hand)
  const movs = async () => (await s.from('stock_movements').select('*', { count: 'exact', head: true }).eq('company_id', F.E)).count

  seccion('1 · Moneda obligatoria en el workflow nuevo')
  const qSin = await c.from('sales_quotes').insert({ company_id: F.E, number: await numero('quote'), series_code: 'COTI', customer_id: F.cli, quote_date: HOY, status: 'draft' }).select('id')
  cmp('cotización sin moneda → DOCUMENT_CURRENCY_REQUIRED', 'DOCUMENT_CURRENCY_REQUIRED', clase(qSin))
  const qSinSrv = await s.from('sales_quotes').insert({ company_id: F.E, number: 'COTI-SRV-SIN', series_code: 'COTI', customer_id: F.cli, quote_date: HOY, status: 'draft' }).select('id')
  cmp('tampoco por service role sin marca de importación', 'DOCUMENT_CURRENCY_REQUIRED', clase(qSinSrv))
  const q = ok(await c.from('sales_quotes').insert({ company_id: F.E, number: await numero('quote'), series_code: 'COTI', customer_id: F.cli, quote_date: HOY, currency_code: 'ARS', status: 'draft' }).select('id').single(), 'cotización ARS')
  ok(await c.from('sales_quote_lines').insert({ company_id: F.E, quote_id: q.id, line_no: 1, line_type: 'item', product_id: F.A, sku_snapshot: 'ZZE3-A', quantity: 5, unit_price: 1000, discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21 }), 'línea cotización')
  PASS('cotización con moneda explícita ARS: OK')
  cmp('vaciar la moneda de una cotización → DOCUMENT_CURRENCY_REQUIRED', 'DOCUMENT_CURRENCY_REQUIRED', clase(await c.from('sales_quotes').update({ currency_code: null }).eq('id', q.id).select('id')))
  cmp('enviar y aceptar la cotización con moneda', ['OK', 'OK'], [clase(await c.from('sales_quotes').update({ status: 'sent' }).eq('id', q.id).select('id')), clase(await c.from('sales_quotes').update({ status: 'accepted' }).eq('id', q.id).select('id'))])
  const oMal = await c.from('sales_orders').insert({ company_id: F.E, number: await numero('sales_order'), series_code: 'PDV', customer_id: F.cli, quote_id: q.id, origin: 'quote', order_date: HOY, currency_code: 'USD', commercial_status: 'draft' }).select('id')
  cmp('pedido desde cotización ARS con USD → DOCUMENT_CURRENCY_MISMATCH', 'DOCUMENT_CURRENCY_MISMATCH', clase(oMal))
  const oSin = await c.from('sales_orders').insert({ company_id: F.E, number: await numero('sales_order'), series_code: 'PDV', customer_id: F.cli, quote_id: q.id, origin: 'quote', order_date: HOY, commercial_status: 'draft' }).select('id')
  cmp('pedido desde cotización sin moneda → DOCUMENT_CURRENCY_REQUIRED (no cae en USD)', 'DOCUMENT_CURRENCY_REQUIRED', clase(oSin))
  const o = ok(await c.from('sales_orders').insert({ company_id: F.E, number: await numero('sales_order'), series_code: 'PDV', customer_id: F.cli, quote_id: q.id, origin: 'quote', order_date: HOY, currency_code: 'ARS', commercial_status: 'draft' }).select('id, currency_code').single(), 'pedido ARS')
  cmp('conversión: el pedido conserva la moneda de la cotización', 'ARS', o.currency_code)
  const ol = ok(await c.from('sales_order_lines').insert({ company_id: F.E, order_id: o.id, line_no: 1, line_type: 'item', product_id: F.A, sku_snapshot: 'ZZE3-A', quantity_ordered: 5, unit_price: 1000, discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21 }).select('id').single(), 'línea pedido')
  cmp('cambiar la moneda del pedido convertido → DOCUMENT_CURRENCY_MISMATCH', 'DOCUMENT_CURRENCY_MISMATCH', clase(await c.from('sales_orders').update({ currency_code: 'USD' }).eq('id', o.id).select('id')))
  cmp('confirmar pedido', 'OK', clase(await c.from('sales_orders').update({ commercial_status: 'confirmed' }).eq('id', o.id).select('id')))
  const oManual = await c.from('sales_orders').insert({ company_id: F.E, number: await numero('sales_order'), series_code: 'PDV', customer_id: F.cli, origin: 'manual', order_date: HOY, commercial_status: 'draft' }).select('id')
  cmp('pedido manual sin moneda → DOCUMENT_CURRENCY_REQUIRED', 'DOCUMENT_CURRENCY_REQUIRED', clase(oManual))
  const hist = await s.from('sales_quotes').insert({ company_id: F.E, number: 'COTI-HIST-1', series_code: 'COTI', customer_id: F.cli, quote_date: HOY, currency_code: 'ARS', status: 'accepted', imported_at: new Date().toISOString(), legacy_source: MARCA }).select('id').single()
  const histPed = await s.from('sales_orders').insert({ company_id: F.E, number: 'PDV-HIST-1', series_code: 'PDV', customer_id: F.cli, quote_id: hist.data?.id, origin: 'migration', order_date: HOY, currency_code: 'USD', commercial_status: 'confirmed', imported_at: new Date().toISOString(), legacy_source: MARCA }).select('id')
  cmp('histórico importado (service role): cotización ARS → pedido USD permitido, como en STEL', ['OK', 'OK'], [clase(hist), clase(histPed)])

  seccion('2 · Remito: cancelar, despachar y la invariante de despachado')
  const remito = async (moneda = 'ARS', cantidad = 1) => {
    const d = await c.from('deliveries').insert({ company_id: F.E, number: await numero('delivery'), series_code: 'RT', order_id: o.id, customer_id: F.cli, delivery_date: HOY, currency_code: moneda, status: 'draft' }).select('id').single()
    if (d.error) return { d, dl: null }
    const dl = await c.from('delivery_lines').insert({ company_id: F.E, delivery_id: d.data.id, order_line_id: ol.id, product_id: F.A, sku_snapshot: 'ZZE3-A', quantity: cantidad, warehouse_id: F.W }).select('id').single()
    return { d, dl }
  }
  cmp('remito en otra moneda que su pedido → DOCUMENT_CURRENCY_MISMATCH', 'DOCUMENT_CURRENCY_MISMATCH', clase((await remito('USD')).d))
  const insertadoDespachado = await c.from('deliveries').insert({ company_id: F.E, number: await numero('delivery'), series_code: 'RT', order_id: o.id, customer_id: F.cli, delivery_date: HOY, currency_code: 'ARS', status: 'shipped' }).select('id')
  cmp('insertar un remito ya despachado → DELIVERY_STATUS_REQUIRES_DISPATCH', 'DELIVERY_STATUS_REQUIRES_DISPATCH', clase(insertadoDespachado))
  const saldo0 = await saldo()
  const movs0 = await movs()

  const R0 = await remito('ARS', 1)
  cmp('draft → cancel: OK', 'OK', clase(await c.from('deliveries').update({ status: 'cancelled' }).eq('id', R0.d.data.id).select('id')))
  cmp('draft cancelado: stock y movimientos sin cambios', [saldo0, movs0], [await saldo(), await movs()])
  cmp('cancelado es terminal: volver a borrador → DELIVERY_CANCELLED', 'DELIVERY_CANCELLED', clase(await c.from('deliveries').update({ status: 'draft' }).eq('id', R0.d.data.id).select('id')))
  cmp('despachar un cancelado por RPC → rechazado sin stock', [true, saldo0], [Boolean((await c.rpc('confirmar_entrega', { p_delivery: R0.d.data.id })).error), await saldo()])

  const R1 = await remito('ARS', 2)
  cmp('forzar despachado por REST (admin) → DELIVERY_STATUS_REQUIRES_DISPATCH', 'DELIVERY_STATUS_REQUIRES_DISPATCH', clase(await c.from('deliveries').update({ status: 'shipped' }).eq('id', R1.d.data.id).select('id')))
  cmp('forzar entregado por REST (service role) → DELIVERY_STATUS_REQUIRES_DISPATCH', 'DELIVERY_STATUS_REQUIRES_DISPATCH', clase(await s.from('deliveries').update({ status: 'delivered' }).eq('id', R1.d.data.id).select('id')))
  cmp('los intentos no movieron stock', [saldo0, movs0], [await saldo(), await movs()])
  const desp = ok(await c.rpc('confirmar_entrega', { p_delivery: R1.d.data.id }), 'despachar')
  cmp('draft → dispatch: OK, 1 movimiento, stock −2 exactamente una vez', ['shipped', 1, saldo0 - 2, movs0 + 1], [desp.status, desp.movimientos, await saldo(), await movs()])
  cmp('cumplimiento del pedido: parcial (2 de 5)', 'partially_delivered', (await s.from('sales_orders').select('fulfillment_status').eq('id', o.id).single()).data.fulfillment_status)
  const re = ok(await c.rpc('confirmar_entrega', { p_delivery: R1.d.data.id }), 're-despachar')
  cmp('retry dispatch: idempotente, sin movimiento nuevo', [true, movs0 + 1, saldo0 - 2], [re.ya_confirmada, await movs(), await saldo()])

  const intentosDespachado = {
    'cancelar (admin, REST)': await c.from('deliveries').update({ status: 'cancelled' }).eq('id', R1.d.data.id).select('id'),
    'cancelar otra vez (retry)': await c.from('deliveries').update({ status: 'cancelled' }).eq('id', R1.d.data.id).select('id'),
    'cancelar (employee, REST)': await id.employee.from('deliveries').update({ status: 'cancelled' }).eq('id', R1.d.data.id).select('id'),
    'cancelar (service role, REST)': await s.from('deliveries').update({ status: 'cancelled' }).eq('id', R1.d.data.id).select('id'),
    'volver a borrador (admin)': await c.from('deliveries').update({ status: 'draft' }).eq('id', R1.d.data.id).select('id'),
    'marcar entregado (admin)': await c.from('deliveries').update({ status: 'delivered' }).eq('id', R1.d.data.id).select('id'),
    'cambiar cantidad de la línea (admin)': await c.from('delivery_lines').update({ quantity: 1 }).eq('id', R1.dl.data.id).select('id'),
    'agregar línea (admin)': await c.from('delivery_lines').insert({ company_id: F.E, delivery_id: R1.d.data.id, order_line_id: ol.id, product_id: F.A, sku_snapshot: 'ZZE3-A', quantity: 1, warehouse_id: F.W }).select('id'),
    'borrar línea (admin)': await c.from('delivery_lines').delete().eq('id', R1.dl.data.id).select('id'),
  }
  const esperado = {
    'cancelar (admin, REST)': 'DELIVERY_ALREADY_DISPATCHED', 'cancelar otra vez (retry)': 'DELIVERY_ALREADY_DISPATCHED', 'cancelar (employee, REST)': 'DELIVERY_ALREADY_DISPATCHED',
    'cancelar (service role, REST)': 'DELIVERY_ALREADY_DISPATCHED', 'volver a borrador (admin)': 'DELIVERY_ALREADY_DISPATCHED', 'marcar entregado (admin)': 'DELIVERY_ALREADY_DISPATCHED',
    'cambiar cantidad de la línea (admin)': 'DELIVERY_ALREADY_DISPATCHED', 'agregar línea (admin)': 'DELIVERY_ALREADY_DISPATCHED', 'borrar línea (admin)': 'DELIVERY_ALREADY_DISPATCHED',
  }
  cmp('dispatched: cancelar/retroceder/editar líneas → BLOCKED (admin, employee, service role)', esperado, Object.fromEntries(Object.entries(intentosDespachado).map(([k, v]) => [k, clase(v)])))
  const borrarDespachado = await c.from('deliveries').delete().eq('id', R1.d.data.id).select('id')
  cmp('borrar un remito despachado → rechazado', true, Boolean(borrarDespachado.error) || (borrarDespachado.data ?? []).length === 0)
  const r1 = (await s.from('deliveries').select('status').eq('id', R1.d.data.id).single()).data
  const l1 = (await s.from('delivery_lines').select('quantity').eq('delivery_id', R1.d.data.id)).data
  cmp('después de los intentos: sigue despachado, 1 línea de 2, stock y movimientos intactos', ['shipped', [2], saldo0 - 2, movs0 + 1], [r1.status, l1.map((x) => num(x.quantity)), await saldo(), await movs()])
  cmp('cumplimiento sigue correcto (parcial)', 'partially_delivered', (await s.from('sales_orders').select('fulfillment_status').eq('id', o.id).single()).data.fulfillment_status)
  const reservas = (await s.from('stock_reservations').select('*', { count: 'exact', head: true }).eq('company_id', F.E)).count
  cmp('0 reservas creadas por los intentos', 0, reservas)

  seccion('3 · Red team')
  const R3 = await remito('ARS', 1)
  const roles = { salesperson: id.salesperson, technician: id.technician, customer: id.customer, distributor: id.distributor, anon, 'admin de otra empresa': id.adminOtra }
  const matriz = {}
  for (const [rol, cli] of Object.entries(roles)) {
    matriz[rol] = {
      cancelarBorrador: clase(await cli.from('deliveries').update({ status: 'cancelled' }).eq('id', R3.d.data.id).select('id')),
      cancelarDespachado: clase(await cli.from('deliveries').update({ status: 'cancelled' }).eq('id', R1.d.data.id).select('id')),
      forzarDespachado: clase(await cli.from('deliveries').update({ status: 'shipped' }).eq('id', R3.d.data.id).select('id')),
      despacharRpc: (() => null)(),
    }
    const rpc = await cli.rpc('confirmar_entrega', { p_delivery: R3.d.data.id })
    matriz[rol].despacharRpc = rpc.error ? clase(rpc) : `OK(${rpc.data?.status})`
  }
  const nadie = Object.values(matriz).every((m) => ['VACIO', 'PERMISO'].includes(m.cancelarBorrador) && ['VACIO', 'PERMISO'].includes(m.cancelarDespachado) && ['VACIO', 'PERMISO'].includes(m.forzarDespachado) && m.despacharRpc === 'PERMISO')
  cmp('ningún rol sin escritura ni otra empresa cancela, fuerza estado o despacha', true, nadie)
  if (!nadie) console.log(JSON.stringify(matriz, null, 1))
  cmp('R3 sigue en borrador y R1 despachado; stock intacto', ['draft', 'shipped', saldo0 - 2], [(await s.from('deliveries').select('status').eq('id', R3.d.data.id).single()).data.status, (await s.from('deliveries').select('status').eq('id', R1.d.data.id).single()).data.status, await saldo()])

  seccion('4 · Autoridad')
  const { data: bt } = await s.from('companies').select('id').eq('slug', 'buscatools').single()
  const aut = (await s.from('document_numbering_authority').select('doc_type, authority').eq('company_id', bt.id).order('doc_type')).data
  // Desde el cutover (2026-09-16) Buscatools emite desde el ERP. La excepción
  // es la serie RT-ML, que sigue siendo de STEL: si alguien la moviera sin
  // querer, MercadoLibre pasaría a numerarse dos veces.
  cmp('Buscatools emite desde el ERP en delivery / quote / sales_order', [['delivery', 'ERP'], ['quote', 'ERP'], ['sales_order', 'ERP']], aut.map((a) => [a.doc_type, a.authority]))
  const series = (await s.from('document_numbering_authority_series').select('doc_type, series_code, authority').eq('company_id', bt.id).order('series_code')).data
  cmp('y RT-ML sigue siendo de STEL (import-only)', [['delivery', 'RT-ML', 'STEL']], (series ?? []).map((x) => [x.doc_type, x.series_code, x.authority]))
  cmp('RT-ML no tiene secuencia en el ERP', 0, (await s.from('document_sequences').select('*', { count: 'exact', head: true }).eq('company_id', bt.id).eq('series_code', 'RT-ML')).count)
  cmp('la fixture ERP ejecutó el workflow futuro (cotización → pedido → remito despachado)', ['accepted', 'confirmed', 'shipped'], [(await s.from('sales_quotes').select('status').eq('id', q.id).single()).data.status, (await s.from('sales_orders').select('commercial_status').eq('id', o.id).single()).data.commercial_status, r1.status])

  seccion('5 · Limpieza y datos reales')
  await barrer()
  cmp('0 empresas zz-f14e3', 0, (await s.from('companies').select('*', { count: 'exact', head: true }).like('slug', `${MARCA}-%`)).count)
  cmp('datos reales intactos (Ventas, catálogo, clientes, stock, secuencias, autoridad)', huellaAntes, await huellaReal())

  console.log(`\n  ${fallos === 0 ? 'ALL PASS' : `${fallos} FALLA(S)`}`)
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('✗', e.message)
  try { await barrer() } catch (e2) { console.error('✗ limpieza:', e2.message) }
  process.exit(1)
})
