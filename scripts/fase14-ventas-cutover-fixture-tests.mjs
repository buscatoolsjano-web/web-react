/**
 * Fase 14 · Entrega 0 — readiness del cutover STEL → ERP (Ventas).
 * Pruebas REALES contra la base, con JWT reales, SÓLO en empresas fixture.
 *
 *   1  cotización completa (USD): cliente, 4 líneas (producto con IVA 21,
 *      producto con IVA 10,5, capítulo, servicio sin producto exento),
 *      descuento de línea y global, percepción, notas; guardar → reabrir →
 *      editar (borrador) → los totales del servidor coinciden con la cuenta;
 *   2  cotización ARS con tipo de cambio; cotización SIN moneda (qué pasa al
 *      convertirla: la vía de la UI pone USD);
 *   3  enviar y aceptar: auditoría, y la cotización aceptada queda congelada;
 *   4  cotización → pedido: quote_id, mismas líneas, precios, cantidades,
 *      moneda y total; segunda conversión rechazada;
 *   5  pedido confirmado → remito parcial (borrador: 0 movimientos) →
 *      despacho (movimientos y saldo) → remito del resto → cumplimiento;
 *      sobreentrega rechazada; cancelar borrador (0 movimientos); cancelar
 *      un remito despachado (comportamiento documentado, sin compensación);
 *   6  secuencias: avanzan exactamente una vez por documento guardado;
 *   7  permisos: admin, employee, salesperson, technician, customer,
 *      distributor, anon × numerar, crear, editar, emitir, confirmar, despachar;
 *   8  limpieza y datos reales intactos.
 *
 * Replica las operaciones de `src/modules/ventas/services/*` (mismas tablas,
 * RPC y columnas). No toca Buscatools ni Torquetools: empresas zz-f14-* y
 * usuarios zz-f14-*@buscatools.test, borrados al final.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase14-ventas-cutover-fixture-tests.mjs
 *
 * NO correrla en paralelo con otra suite de base.
 */
import { createClient } from '@supabase/supabase-js'
import { createHash, randomUUID } from 'node:crypto'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET) { console.error('✗ Faltan variables'); process.exit(1) }

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(72)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const INFO = (t, d = '') => console.log(`    INFO  ${t}${d ? ' — ' + d : ''}`)
const cmp = (t, esp, real) => (JSON.stringify(esp) === JSON.stringify(real) ? PASS(t, String(JSON.stringify(real)).slice(0, 160)) : FAIL(t, `esperaba ${JSON.stringify(esp)}, dio ${JSON.stringify(real)}`))

const s = createClient(BASE, SECRET, { auth: { persistSession: false } })
const anon = createClient(BASE, PUB, { auth: { persistSession: false } })
const MARCA = 'zz-f14'
const HOY = new Date().toISOString().slice(0, 10)
const r2 = (n) => Math.round(n * 100) / 100
const num = (v) => (v === null || v === undefined ? null : Number(v))

const login = async (email, password) => {
  const c = createClient(BASE, PUB, { auth: { persistSession: false } })
  const { data, error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`login: ${error.message}`)
  return { c, id: data.user.id }
}
const usuario = async (companyId, rol, customerId = null) => {
  const email = `${MARCA}-${rol}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@buscatools.test`
  const password = `Zz${randomUUID()}!`
  const { data, error } = await s.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`crear ${rol}: ${error.message}`)
  const fila = { company_id: companyId, user_id: data.user.id, role: rol, status: 'active' }
  if (customerId) fila.customer_id = customerId
  const { error: eM } = await s.from('company_memberships').insert(fila)
  if (eM) throw new Error(`membresía ${rol}: ${eM.message}`)
  return login(email, password)
}

/** 'OK', 'STEL', 'PERMISO', 'VACIO' (RLS filtró: 0 filas) u 'OTRO(...)'. */
const clase = (r) => {
  if (!r.error) return Array.isArray(r.data) && r.data.length === 0 ? 'VACIO' : 'OK'
  const m = `${r.error.message ?? ''}`
  if (m === 'external_numbering_authority') return 'STEL'
  if (/permission denied|Sin permiso|sin_permiso|42501|row-level security/i.test(`${m} ${r.error.code}`)) return 'PERMISO'
  return `OTRO(${r.error.code}: ${m.slice(0, 90)})`
}
const hash = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16)
const cuenta = async (tabla, filtro) => {
  let q = s.from(tabla).select('*', { count: 'exact', head: true })
  if (filtro) q = filtro(q)
  return (await q).count
}
const seqDe = async (companyId) => {
  const { data } = await s.from('document_sequences').select('doc_type, next_number').eq('company_id', companyId).order('doc_type')
  return Object.fromEntries((data ?? []).map((x) => [x.doc_type, Number(x.next_number)]))
}

/** Huella de lo real: empresas que no son zz-*. */
async function huellaReal() {
  const { data: c } = await s.from('companies').select('id').not('slug', 'like', 'zz-%').order('slug')
  const ids = c.map((x) => x.id)
  const f = (q) => q.in('company_id', ids)
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
  return {
    secuencias: await todo('document_sequences', ['company_id', 'doc_type', 'series_code']),
    autoridad: await todo('document_numbering_authority', ['company_id', 'doc_type']),
    saldos: await todo('stock_balances', ['product_id', 'warehouse_id']),
    cotizaciones: await todo('sales_quotes', ['id']),
    pedidos: await todo('sales_orders', ['id']),
    remitos: await todo('deliveries', ['id']),
    movimientos: await cuenta('stock_movements', f),
    reservas: await cuenta('stock_reservations', f),
    eventos: await cuenta('sales_audit', f),
  }
}

const barrer = async () => {
  const { data: emp } = await s.from('companies').select('id').like('slug', `${MARCA}-%`)
  const ids = (emp ?? []).map((x) => x.id)
  if (ids.length) {
    await s.from('stock_reservations').delete().in('company_id', ids)
    await s.from('stock_movements').delete().in('company_id', ids)
    await s.from('stock_balances').delete().in('company_id', ids)
    const { data: dels } = await s.from('deliveries').select('id').in('company_id', ids)
    for (const d of dels ?? []) await s.from('delivery_lines').delete().eq('delivery_id', d.id)
    await s.from('deliveries').delete().in('company_id', ids)
    await s.from('sales_order_lines').delete().in('company_id', ids)
    await s.from('sales_orders').delete().in('company_id', ids)
    await s.from('sales_quote_lines').delete().in('company_id', ids)
    await s.from('sales_quotes').delete().in('company_id', ids)
    await s.from('sales_audit').delete().in('company_id', ids)
    await s.from('company_memberships').delete().in('company_id', ids)
    await s.from('product_prices').delete().in('company_id', ids)
    await s.from('price_lists').delete().in('company_id', ids)
    await s.from('products').delete().in('company_id', ids)
    await s.from('product_categories').delete().in('company_id', ids)
    await s.from('customers').delete().in('company_id', ids)
    await s.from('warehouses').delete().in('company_id', ids)
  }
  for (let page = 1; ; page++) {
    const { data: us } = await s.auth.admin.listUsers({ page, perPage: 1000 })
    for (const u of us?.users ?? []) if (u.email?.startsWith(`${MARCA}-`)) { await s.from('company_memberships').delete().eq('user_id', u.id); await s.auth.admin.deleteUser(u.id) }
    if ((us?.users ?? []).length < 1000) break
  }
  if (ids.length) {
    await s.from('document_sequences').delete().in('company_id', ids)
    await s.from('companies').delete().in('id', ids)
  }
}

/** Neto → descuento global → IVA por línea → percepción (la cuenta de lib/totales.ts). */
function totalesEsperados(lineas, descuentoGlobal, percepcion) {
  const factor = 1 - (descuentoGlobal ?? 0) / 100
  let neto = 0
  let iva = 0
  for (const l of lineas) {
    if (l.line_type === 'chapter') continue
    const n = l.qty * l.price * (1 - (l.dto ?? 0) / 100)
    neto += n
    iva += n * factor * ((l.rate ?? 0) / 100)
  }
  const subtotal = r2(neto * factor)
  const impuesto = r2(r2(iva) + (subtotal * (percepcion ?? 0)) / 100)
  return { subtotal, impuesto, total: r2(subtotal + impuesto) }
}

const main = async () => {
  await barrer()
  const huellaAntes = await huellaReal()
  INFO('huella real antes', JSON.stringify(huellaAntes))

  // ── Empresa ERP (sin filas de autoridad = el ERP numera) ─────────────────
  const { data: emp, error: eE } = await s.from('companies').insert({ slug: `${MARCA}-erp-${Date.now()}`, name: 'ZZ F14 ERP', default_currency: 'USD' }).select('id').single()
  if (eE) throw new Error(`empresa: ${eE.message}`)
  const E = emp.id
  const { error: eS } = await s.from('document_sequences').insert([
    { company_id: E, doc_type: 'quote', series_code: 'COTI', prefix: 'COTI', padding: 5, next_number: 2629, is_default: true },
    { company_id: E, doc_type: 'sales_order', series_code: 'PDV', prefix: 'PDV', padding: 5, next_number: 1316, is_default: true },
    { company_id: E, doc_type: 'delivery', series_code: 'RT', prefix: 'RT', padding: 10, next_number: 1427, is_default: true },
    { company_id: E, doc_type: 'customer', series_code: 'CLI', prefix: 'CLI', padding: 5, next_number: 1, is_default: true },
  ])
  if (eS) throw new Error(`secuencias: ${eS.message}`)
  const { data: cli } = await s.from('customers').insert({ company_id: E, legal_name: 'ZZ F14 Metalúrgica SA', status: 'active' }).select('id').single()
  const { data: cliExt } = await s.from('customers').insert({ company_id: E, legal_name: 'ZZ F14 Cliente portal SA', status: 'active' }).select('id').single()
  const { data: rubro } = await s.from('product_categories').insert({ company_id: E, name: 'ZZ F14 rubro', slug: `${MARCA}-rubro` }).select('id').single()
  const { data: prods, error: eP } = await s.from('products').insert([
    { company_id: E, category_id: rubro.id, sku: 'ZZF14-A', name: 'ZZ F14 Atornillador A' },
    { company_id: E, category_id: rubro.id, sku: 'ZZF14-B', name: 'ZZ F14 Llave B' },
  ]).select('id, sku')
  if (eP) throw new Error(`productos: ${eP.message}`)
  const A = prods.find((p) => p.sku === 'ZZF14-A').id
  const B = prods.find((p) => p.sku === 'ZZF14-B').id
  const { data: lista, error: eLi } = await s.from('price_lists').insert({ company_id: E, name: 'ZZ F14 lista USD', currency_code: 'USD', is_default: true }).select('id').single()
  if (eLi) throw new Error(`lista: ${eLi.message}`)
  const { error: ePr } = await s.from('product_prices').insert([
    { company_id: E, price_list_id: lista.id, product_id: A, amount: 100 },
    { company_id: E, price_list_id: lista.id, product_id: B, amount: 250 },
  ])
  if (ePr) throw new Error(`precios: ${ePr.message}`)
  const { data: dep } = await s.from('warehouses').insert({ company_id: E, code: 'ZZF14', name: 'ZZ F14 depósito', is_default: true }).select('id').single()
  for (const p of [A, B]) {
    const { error } = await s.from('stock_movements').insert({ company_id: E, product_id: p, warehouse_id: dep.id, movement_type: 'adjustment', quantity: 50, source_type: MARCA, notes: 'ZZ F14 stock inicial' })
    if (error) throw new Error(`stock: ${error.message}`)
  }
  const saldo = async (p) => Number((await s.from('stock_balances').select('on_hand').eq('product_id', p).eq('warehouse_id', dep.id).single()).data?.on_hand)

  const id = {
    admin: await usuario(E, 'admin'),
    employee: await usuario(E, 'employee'),
    salesperson: await usuario(E, 'salesperson'),
    technician: await usuario(E, 'technician'),
    customer: await usuario(E, 'customer', cliExt.id),
    distributor: await usuario(E, 'distributor', cliExt.id),
  }
  const c = id.admin.c
  const seq0 = await seqDe(E)
  const evento = (tipo, docId, accion, de, a) => c.rpc('registrar_evento_venta', { p_entity_type: tipo, p_entity_id: docId, p_action: accion, p_from_status: de, p_to_status: a, p_diff: null })

  // ── 1 · Cotización completa ───────────────────────────────────────────────
  seccion('1 · Cotización USD completa: guardar, reabrir, editar')
  const LINEAS = [
    { line_type: 'item', product_id: A, sku: 'ZZF14-A', name: 'ZZ F14 Atornillador A', qty: 3, price: 100, dto: 5, treatment: 'vat_21', rate: 21 },
    { line_type: 'item', product_id: B, sku: 'ZZF14-B', name: 'ZZ F14 Llave B', qty: 2, price: 250, dto: 0, treatment: 'vat_105', rate: 10.5 },
    { line_type: 'chapter', product_id: null, sku: null, name: 'ZZ F14 Capítulo servicios', qty: 1, price: 0, dto: 0, treatment: 'not_taxed', rate: 0 },
    { line_type: 'service', product_id: null, sku: 'SER-ZZ', name: 'ZZ F14 Calibración', qty: 1, price: 80, dto: 10, treatment: 'exempt', rate: 0 },
  ]
  const fila = (docCol, docId, l, i) => ({
    company_id: E, [docCol]: docId, line_no: i + 1, line_type: l.line_type, product_id: l.product_id,
    sku_snapshot: l.sku, name_snapshot: l.name, description_snapshot: null, brand_snapshot: null,
    quantity: l.qty, unit_price: l.price, list_price_snapshot: null, discount_pct: l.dto, tax_treatment: l.treatment, tax_rate_snapshot: l.rate,
  })
  const nQ = await c.rpc('next_document_number', { p_company: E, p_doc_type: 'quote' })
  cmp('número de la cotización (formato COTI + 5)', 'COTI02629', nQ.data)
  const q = await c.from('sales_quotes').insert({
    company_id: E, number: nQ.data, series_code: 'COTI', customer_id: cli.id, title: 'ZZ F14 Cotización completa', quote_date: HOY,
    currency_code: 'USD', exchange_rate: null, payment_terms: '30 DIAS F/F con ECHEQ', notes: 'ZZ F14 notas de prueba', discount_pct: 2, perception_pct: 3, status: 'draft',
  }).select('id').single()
  cmp('insert cabecera', 'OK', clase(q))
  const ql = await c.from('sales_quote_lines').insert(LINEAS.map((l, i) => fila('quote_id', q.data.id, l, i)))
  cmp('insert 4 líneas', 'OK', clase(ql))
  cmp('evento created', 'OK', clase(await evento('sales_quote', q.data.id, 'created', null, 'draft')))
  const esperado1 = totalesEsperados(LINEAS, 2, 3)
  const leer = async (tabla, docId) => (await c.from(tabla).select('*').eq('id', docId).single()).data
  const r1 = await leer('sales_quotes', q.data.id)
  cmp('reabrir: totales del servidor = cuenta (neto→desc. global→IVA por línea→percepción)', esperado1, { subtotal: num(r1.subtotal), impuesto: num(r1.tax_amount), total: num(r1.total) })
  cmp('reabrir: cabecera guardada tal cual', ['USD', 'ZZ F14 notas de prueba', 2, 3, 'draft', cli.id], [r1.currency_code, r1.notes, num(r1.discount_pct), num(r1.perception_pct), r1.status, r1.customer_id])
  const { data: lin1 } = await c.from('sales_quote_lines').select('line_no, line_type, product_id, sku_snapshot, quantity, unit_price, discount_pct, tax_treatment, tax_rate_snapshot').eq('quote_id', q.data.id).order('line_no')
  cmp('reabrir: líneas idénticas a lo guardado', LINEAS.map((l, i) => [i + 1, l.line_type, l.product_id, l.sku, l.qty, l.price, l.dto, l.treatment, l.rate]),
    (lin1 ?? []).map((l) => [l.line_no, l.line_type, l.product_id, l.sku_snapshot, num(l.quantity), num(l.unit_price), num(l.discount_pct), l.tax_treatment, num(l.tax_rate_snapshot)]))
  // Editar el borrador: cantidad de una línea y descuento global.
  const ed1 = await c.from('sales_quote_lines').update({ quantity: 4 }).eq('quote_id', q.data.id).eq('line_no', 1).select('id')
  const ed2 = await c.from('sales_quotes').update({ discount_pct: 5, title: 'ZZ F14 Cotización editada' }).eq('id', q.data.id).select('id')
  cmp('editar borrador (línea y cabecera)', ['OK', 'OK'], [clase(ed1), clase(ed2)])
  const LINEAS_ED = LINEAS.map((l, i) => (i === 0 ? { ...l, qty: 4 } : l))
  const r1b = await leer('sales_quotes', q.data.id)
  cmp('tras editar: el servidor recalcula', totalesEsperados(LINEAS_ED, 5, 3), { subtotal: num(r1b.subtotal), impuesto: num(r1b.tax_amount), total: num(r1b.total) })
  const cliente = await c.from('sales_quotes').update({ total: 1, subtotal: 1 }).eq('id', q.data.id).select('total')
  cmp('totales enviados por el cliente se ignoran', totalesEsperados(LINEAS_ED, 5, 3).total, num((await leer('sales_quotes', q.data.id)).total))
  INFO('update de totales desde el cliente', clase(cliente))

  // ── 2 · ARS y sin moneda ─────────────────────────────────────────────────
  seccion('2 · Cotización ARS con tipo de cambio y cotización sin moneda')
  const nQ2 = await c.rpc('next_document_number', { p_company: E, p_doc_type: 'quote' })
  const q2 = await c.from('sales_quotes').insert({ company_id: E, number: nQ2.data, series_code: 'COTI', customer_id: cli.id, quote_date: HOY, currency_code: 'ARS', exchange_rate: 1250.5, status: 'draft' }).select('id').single()
  await c.from('sales_quote_lines').insert([fila('quote_id', q2.data.id, { ...LINEAS[0], price: 125000 }, 0)])
  const r2q = await leer('sales_quotes', q2.data.id)
  cmp('ARS: moneda, tipo de cambio y total en pesos (no se convierte)', ['ARS', 1250.5, totalesEsperados([{ ...LINEAS[0], price: 125000 }], 0, 0).total], [r2q.currency_code, num(r2q.exchange_rate), num(r2q.total)])
  const nQ3 = await c.rpc('next_document_number', { p_company: E, p_doc_type: 'quote' })
  const q3 = await c.from('sales_quotes').insert({ company_id: E, number: nQ3.data, series_code: 'COTI', customer_id: cli.id, quote_date: HOY, currency_code: null, status: 'draft' }).select('id').single()
  cmp('una cotización SIN moneda se puede guardar (currency_code es nullable)', 'OK', clase(q3))
  INFO('riesgo', 'convertirCotizacionEnPedido usa `currency_code ?? "USD"`: el pedido nacería en USD sin que nadie lo elija (ver sección 4)')

  // ── 3 · Enviar y aceptar ─────────────────────────────────────────────────
  seccion('3 · Enviar y aceptar; la aceptada queda congelada')
  const env = await c.from('sales_quotes').update({ status: 'sent' }).eq('id', q.data.id).select('id')
  const acc = await c.from('sales_quotes').update({ status: 'accepted' }).eq('id', q.data.id).select('id')
  cmp('draft → sent → accepted', ['OK', 'OK', 'OK', 'OK'], [clase(env), clase(await evento('sales_quote', q.data.id, 'sent', 'draft', 'sent')), clase(acc), clase(await evento('sales_quote', q.data.id, 'approved', 'sent', 'accepted'))])
  const congelada = await c.from('sales_quote_lines').update({ unit_price: 1 }).eq('quote_id', q.data.id).eq('line_no', 1).select('id')
  INFO('editar línea de una aceptada', clase(congelada))
  cmp('aceptada: el precio de la línea no cambió', 100, num((await c.from('sales_quote_lines').select('unit_price').eq('quote_id', q.data.id).eq('line_no', 1).single()).data?.unit_price))

  // ── 4 · Cotización → pedido ──────────────────────────────────────────────
  seccion('4 · Cotización → pedido')
  const { data: cot } = await c.from('sales_quotes').select('customer_id, contact_id, title, currency_code, exchange_rate, payment_terms, notes, discount_pct, perception_pct').eq('id', q.data.id).single()
  const { data: lineasCot } = await c.from('sales_quote_lines').select('line_no, line_type, product_id, sku_snapshot, name_snapshot, description_snapshot, quantity, unit_price, list_price_snapshot, discount_pct, tax_treatment, tax_rate_snapshot').eq('quote_id', q.data.id).order('line_no')
  const nO = await c.rpc('next_document_number', { p_company: E, p_doc_type: 'sales_order' })
  const o = await c.from('sales_orders').insert({
    company_id: E, number: nO.data, series_code: 'PDV', customer_id: cot.customer_id, contact_id: cot.contact_id, quote_id: q.data.id, origin: 'quote', title: cot.title, order_date: HOY,
    currency_code: cot.currency_code ?? 'USD', exchange_rate: cot.exchange_rate, payment_terms: cot.payment_terms, notes: cot.notes, discount_pct: cot.discount_pct, perception_pct: cot.perception_pct, commercial_status: 'draft',
  }).select('id').single()
  cmp('pedido creado con número PDV01316', ['OK', 'PDV01316'], [clase(o), nO.data])
  const ol = await c.from('sales_order_lines').insert(lineasCot.map((l, i) => ({
    company_id: E, order_id: o.data.id, line_no: i + 1, line_type: l.line_type, product_id: l.product_id, sku_snapshot: l.sku_snapshot, name_snapshot: l.name_snapshot,
    description_snapshot: l.description_snapshot, quantity_ordered: l.quantity, unit_price: l.unit_price, list_price_snapshot: l.list_price_snapshot, discount_pct: l.discount_pct,
    tax_treatment: l.tax_treatment, tax_rate_snapshot: l.tax_rate_snapshot,
  })))
  cmp('líneas del pedido insertadas', 'OK', clase(ol))
  const rO = await leer('sales_orders', o.data.id)
  const rQ = await leer('sales_quotes', q.data.id)
  cmp('quote_id, moneda y totales iguales a la cotización', [q.data.id, 'USD', num(rQ.subtotal), num(rQ.tax_amount), num(rQ.total)], [rO.quote_id, rO.currency_code, num(rO.subtotal), num(rO.tax_amount), num(rO.total)])
  const { data: lineasPed } = await c.from('sales_order_lines').select('id, line_no, line_type, product_id, sku_snapshot, quantity_ordered, unit_price, discount_pct, tax_treatment, tax_rate_snapshot').eq('order_id', o.data.id).order('line_no')
  cmp('mismas líneas, precios y cantidades', lineasCot.map((l) => [l.line_no, l.line_type, l.product_id, l.sku_snapshot, num(l.quantity), num(l.unit_price), num(l.discount_pct), l.tax_treatment, num(l.tax_rate_snapshot)]),
    lineasPed.map((l) => [l.line_no, l.line_type, l.product_id, l.sku_snapshot, num(l.quantity_ordered), num(l.unit_price), num(l.discount_pct), l.tax_treatment, num(l.tax_rate_snapshot)]))
  cmp('la cotización no cambió de estado al convertirla', 'accepted', rQ.status)
  const nOdup = await c.rpc('next_document_number', { p_company: E, p_doc_type: 'sales_order' })
  const dup = await c.from('sales_orders').insert({ company_id: E, number: nOdup.data, series_code: 'PDV', customer_id: cli.id, quote_id: q.data.id, origin: 'quote', order_date: HOY, currency_code: 'USD', commercial_status: 'draft' }).select('id')
  cmp('segunda conversión de la misma cotización: rechazada (uq_sales_orders_quote)', true, /uq_sales_orders_quote/.test(dup.error?.message ?? ''))
  INFO('número consumido por el intento duplicado', `${nOdup.data} (el número se pide antes del insert: un fallo quema un número)`)
  // Sin moneda → la vía de la UI la convierte en USD.
  const { data: cot3 } = await c.from('sales_quotes').select('currency_code').eq('id', q3.data.id).single()
  cmp('cotización sin moneda: la regla de la UI (`?? "USD"`) asigna USD al pedido', 'USD', cot3.currency_code ?? 'USD')

  // ── 5 · Pedido → remitos → stock ─────────────────────────────────────────
  seccion('5 · Pedido → remito parcial → despacho → resto; stock')
  cmp('confirmar pedido', 'OK', clase(await c.from('sales_orders').update({ commercial_status: 'confirmed' }).eq('id', o.data.id).select('id')))
  const lA = lineasPed.find((l) => l.product_id === A)
  const lB = lineasPed.find((l) => l.product_id === B)
  const lS = lineasPed.find((l) => l.line_type === 'service')
  const mov0 = await cuenta('stock_movements', (x) => x.eq('company_id', E))
  const saldoA0 = await saldo(A)
  const saldoB0 = await saldo(B)
  const crearRemito = async (cantidades) => {
    const n = await c.rpc('next_document_number', { p_company: E, p_doc_type: 'delivery' })
    const d = await c.from('deliveries').insert({ company_id: E, number: n.data, series_code: 'RT', order_id: o.data.id, customer_id: cli.id, title: rO.title, delivery_date: HOY, currency_code: rO.currency_code, exchange_rate: rO.exchange_rate, status: 'draft' }).select('id').single()
    const lineas = cantidades.map(([l, qty]) => ({ company_id: E, delivery_id: d.data?.id, order_line_id: l.id, product_id: l.product_id, sku_snapshot: l.sku_snapshot, name_snapshot: null, quantity: qty, warehouse_id: dep.id, unit_price: l.unit_price, discount_pct: l.discount_pct, tax_treatment: l.tax_treatment, tax_rate_snapshot: l.tax_rate_snapshot }))
    const dl = await c.from('delivery_lines').insert(lineas)
    return { numero: n.data, d, dl }
  }
  const R1 = await crearRemito([[lA, 1], [lB, 2]])
  cmp('remito parcial: número RT0000001427, borrador', ['OK', 'OK', 'RT0000001427'], [clase(R1.d), clase(R1.dl), R1.numero])
  cmp('borrador: 0 movimientos y saldo intacto', [mov0, saldoA0, saldoB0], [await cuenta('stock_movements', (x) => x.eq('company_id', E)), await saldo(A), await saldo(B)])
  const conf1 = await c.rpc('confirmar_entrega', { p_delivery: R1.d.data.id })
  cmp('despacho: 2 movimientos, estado shipped', ['OK', 2, 'shipped'], [clase(conf1), conf1.data?.movimientos, (await leer('deliveries', R1.d.data.id)).status])
  cmp('saldo: A 50−1, B 50−2', [saldoA0 - 1, saldoB0 - 2], [await saldo(A), await saldo(B)])
  cmp('cumplimiento del pedido: parcial', 'partially_delivered', (await leer('sales_orders', o.data.id)).fulfillment_status)
  const conf1b = await c.rpc('confirmar_entrega', { p_delivery: R1.d.data.id })
  cmp('re-despachar: idempotente, sin movimientos nuevos', [true, mov0 + 2], [conf1b.data?.ya_confirmada === true, await cuenta('stock_movements', (x) => x.eq('company_id', E))])
  const sobre = await crearRemito([[lA, 4]])
  cmp('sobreentrega (4 de 3 pendientes): la línea se rechaza', true, Boolean(sobre.dl.error))
  INFO('sobreentrega', `${sobre.dl.error?.message?.slice(0, 120)} · el remito vacío ${sobre.numero} quedó creado por este script (la UI lo borra)`)
  if (sobre.d.data?.id) await c.from('deliveries').delete().eq('id', sobre.d.data.id)
  const R2 = await crearRemito([[lA, 3]])
  const cancel = await c.from('deliveries').update({ status: 'cancelled' }).eq('id', R2.d.data.id).select('id')
  cmp('cancelar un remito en borrador: sin movimientos', ['OK', mov0 + 2], [clase(cancel), await cuenta('stock_movements', (x) => x.eq('company_id', E))])
  // El cumplimiento excluye sólo capítulos: la línea de servicio (sin producto) también se entrega.
  const R3a = await crearRemito([[lA, 3]])
  const conf3a = await c.rpc('confirmar_entrega', { p_delivery: R3a.d.data.id })
  cmp('todas las líneas con producto entregadas pero falta el servicio: sigue parcial', ['OK', 'partially_delivered'], [clase(conf3a), (await leer('sales_orders', o.data.id)).fulfillment_status])
  const R3 = await crearRemito([[lS, 1]])
  const conf3 = await c.rpc('confirmar_entrega', { p_delivery: R3.d.data.id })
  cmp('remito del servicio: 0 movimientos (sin producto) y pedido entregado', ['OK', 0, 'delivered'], [clase(conf3), conf3.data?.movimientos, (await leer('sales_orders', o.data.id)).fulfillment_status])
  cmp('saldo final: A 50−4, B 50−2', [saldoA0 - 4, saldoB0 - 2], [await saldo(A), await saldo(B)])
  const cancelShipped = await c.from('deliveries').update({ status: 'cancelled' }).eq('id', R3a.d.data.id).select('id')
  const movTrasCancel = await cuenta('stock_movements', (x) => x.eq('company_id', E))
  INFO('cancelar un remito YA despachado', `${clase(cancelShipped)} · movimientos ${movTrasCancel} (antes ${mov0 + 3}) · saldo A ${await saldo(A)} · cumplimiento ${(await leer('sales_orders', o.data.id)).fulfillment_status} — sin movimiento compensatorio ni recálculo`)
  const { data: movs } = await s.from('stock_movements').select('movement_type, quantity, source_type').eq('company_id', E).neq('source_type', MARCA).order('id')
  cmp('movimientos de venta: sale_delivery negativos con source delivery', [['sale_delivery', -1, 'delivery'], ['sale_delivery', -2, 'delivery'], ['sale_delivery', -3, 'delivery']],
    (movs ?? []).map((m) => [m.movement_type, Number(m.quantity), m.source_type]).sort((x, y) => x[1] - y[1]).reverse())

  // ── 6 · Secuencias ───────────────────────────────────────────────────────
  seccion('6 · Secuencias')
  cmp('quote +3, sales_order +2 (incluye el intento duplicado), delivery +5 (incluye el remito de sobreentrega)',
    { ...seq0, quote: seq0.quote + 3, sales_order: seq0.sales_order + 2, delivery: seq0.delivery + 5 }, await seqDe(E))
  const { data: nums } = await s.from('sales_quotes').select('number').eq('company_id', E).order('number')
  cmp('números de cotización únicos y correlativos', ['COTI02629', 'COTI02630', 'COTI02631'], (nums ?? []).map((x) => x.number))

  // ── 7 · Permisos ─────────────────────────────────────────────────────────
  seccion('7 · Permisos por rol (JWT reales)')
  const nQx = await c.rpc('next_document_number', { p_company: E, p_doc_type: 'quote' })
  const qx = await c.from('sales_quotes').insert({ company_id: E, number: nQx.data, series_code: 'COTI', customer_id: cliExt.id, quote_date: HOY, currency_code: 'USD', status: 'draft', title: 'ZZ F14 borrador para permisos' }).select('id').single()
  await c.from('sales_quote_lines').insert([fila('quote_id', qx.data.id, LINEAS[0], 0)])
  const nOx = await c.rpc('next_document_number', { p_company: E, p_doc_type: 'sales_order' })
  const ox = await c.from('sales_orders').insert({ company_id: E, number: nOx.data, series_code: 'PDV', customer_id: cliExt.id, order_date: HOY, currency_code: 'USD', commercial_status: 'draft', origin: 'manual' }).select('id').single()
  const { data: olx } = await c.from('sales_order_lines').insert([{ company_id: E, order_id: ox.data.id, line_no: 1, line_type: 'item', product_id: A, sku_snapshot: 'ZZF14-A', quantity_ordered: 5, unit_price: 100, discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21 }]).select('id')
  const nDx = await c.rpc('next_document_number', { p_company: E, p_doc_type: 'delivery' })
  const dx = await c.from('deliveries').insert({ company_id: E, number: nDx.data, series_code: 'RT', order_id: ox.data.id, customer_id: cliExt.id, delivery_date: HOY, currency_code: 'USD', status: 'draft' }).select('id').single()
  await c.from('delivery_lines').insert({ company_id: E, delivery_id: dx.data.id, order_line_id: olx[0].id, product_id: A, sku_snapshot: 'ZZF14-A', quantity: 1, warehouse_id: dep.id })
  const seqPerm = await seqDe(E)

  const matriz = {}
  const actores = { ...Object.fromEntries(Object.entries(id).map(([k, v]) => [k, v.c])), anon }
  for (const [rol, cl] of Object.entries(actores)) {
    const fila7 = {}
    fila7.leer = clase(await cl.from('sales_quotes').select('id').eq('id', qx.data.id))
    fila7.numerar = clase(await cl.rpc('next_document_number', { p_company: E, p_doc_type: 'quote' }))
    fila7.crear = clase(await cl.from('sales_quotes').insert({ company_id: E, number: `ZZF14-${rol}`, series_code: 'COTI', customer_id: cliExt.id, quote_date: HOY, currency_code: 'USD', status: 'draft' }).select('id'))
    fila7.editar = clase(await cl.from('sales_quotes').update({ title: `ZZ F14 editado por ${rol}` }).eq('id', qx.data.id).select('id'))
    fila7.emitir = clase(await cl.from('sales_quotes').update({ status: 'sent' }).eq('id', qx.data.id).eq('status', 'draft').select('id'))
    fila7.confirmar = clase(await cl.from('sales_orders').update({ commercial_status: 'confirmed' }).eq('id', ox.data.id).eq('commercial_status', 'draft').select('id'))
    fila7.despachar = clase(await cl.rpc('confirmar_entrega', { p_delivery: dx.data.id }))
    matriz[rol] = fila7
    // Devolver el estado para el siguiente rol (sólo si este lo cambió).
    await s.from('sales_quotes').update({ status: 'draft', title: 'ZZ F14 borrador para permisos' }).eq('id', qx.data.id)
    await s.from('sales_orders').update({ commercial_status: 'draft' }).eq('id', ox.data.id)
    await s.from('sales_quotes').delete().eq('company_id', E).like('number', 'ZZF14-%')
    if (fila7.despachar === 'OK') {
      // Deshacer el despacho del fixture: borrar movimientos del remito y volver a borrador.
      await s.from('stock_movements').delete().eq('source_id', dx.data.id)
      await s.from('deliveries').update({ status: 'draft' }).eq('id', dx.data.id)
    }
  }
  for (const [rol, f] of Object.entries(matriz)) INFO(rol.padEnd(12), JSON.stringify(f))
  const esperado = {
    admin: { leer: 'OK', numerar: 'OK', crear: 'OK', editar: 'OK', emitir: 'OK', confirmar: 'OK', despachar: 'OK' },
    employee: { leer: 'OK', numerar: 'OK', crear: 'OK', editar: 'OK', emitir: 'OK', confirmar: 'OK', despachar: 'OK' },
  }
  cmp('admin y employee: todo permitido', esperado, { admin: matriz.admin, employee: matriz.employee })
  const escribe = (f) => ['numerar', 'crear', 'editar', 'emitir', 'confirmar', 'despachar'].some((k) => f[k] === 'OK')
  cmp('salesperson, technician, customer, distributor y anon: ninguna escritura', [false, false, false, false, false],
    ['salesperson', 'technician', 'customer', 'distributor', 'anon'].map((r) => escribe(matriz[r])))
  cmp('lectura: internos ven; el cliente del documento lo ve; anon no', ['OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'VACIO'],
    ['admin', 'employee', 'salesperson', 'technician', 'customer', 'distributor', 'anon'].map((r) => matriz[r].leer))
  INFO('secuencia quote durante la matriz', `antes ${seqPerm.quote}, después ${(await seqDe(E)).quote} (admin y employee numeraron una vez cada uno)`)

  // ── 8 · Limpieza ─────────────────────────────────────────────────────────
  seccion('8 · Limpieza y datos reales intactos')
  await barrer()
  cmp('0 empresas zz-f14 residuales', 0, await cuenta('companies', (x) => x.like('slug', `${MARCA}-%`)))
  let residuales = 0
  for (let page = 1; ; page++) {
    const { data: us } = await s.auth.admin.listUsers({ page, perPage: 1000 })
    residuales += (us?.users ?? []).filter((u) => u.email?.startsWith(`${MARCA}-`)).length
    if ((us?.users ?? []).length < 1000) break
  }
  cmp('0 usuarios zz-f14 residuales', 0, residuales)
  cmp('secuencias, autoridad, saldos, documentos, movimientos, reservas y eventos reales idénticos', huellaAntes, await huellaReal())

  console.log(`\n  ${fallos === 0 ? '✓ TODO PASA' : `✗ ${fallos} FALLO(S)`}\n`)
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('\n✗ Error inesperado:', e.message)
  try { await barrer() } catch { /* ya informado */ }
  process.exit(1)
})
