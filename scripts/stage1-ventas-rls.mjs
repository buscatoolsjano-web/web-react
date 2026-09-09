/**
 * Fase 4 · Stage 1 — RLS del módulo de Ventas, con JWT reales.
 *
 * Cada prohibición se prueba con un INTENTO REAL y sólo pasa si es
 * RECHAZADO. Contar filas mide el estado; intentar la operación mide el
 * cumplimiento — la distinción que ya nos costó un falso PASS en la Fase 3.5.
 *
 * El caso central: un cliente externo NO puede leer los pedidos de OTRO
 * cliente de la misma empresa. Se intenta por listado, por id exacto, por
 * número de documento y filtrando por el customer_id ajeno.
 *
 *   set -a; source .env; source .env.migration; set +a
 *   BT_PW_JANO=… BT_PW_TEST=… node scripts/stage1-ventas-rls.mjs
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY

const anon = () => createClient(URL, PUB, { auth: { persistSession: false } })
const admin = () => createClient(URL, SECRET, { auth: { persistSession: false } })

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(70)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }

async function rechazado(t, fn) {
  const { data, error } = await fn()
  const n = Array.isArray(data) ? data.length : data ? 1 : 0
  if (error) return PASS(t, error.code ?? error.message.slice(0, 38))
  if (n === 0) return PASS(t, 'RLS filtró todo (0 filas)')
  FAIL(t, `DEVOLVIÓ ${n} fila(s)`)
}
async function permitido(t, fn, min = 1) {
  const { data, error } = await fn()
  const n = Array.isArray(data) ? data.length : data ? 1 : 0
  if (error) return FAIL(t, error.message.slice(0, 55))
  if (n < min) return FAIL(t, `devolvió ${n}, esperaba >= ${min}`)
  PASS(t, `${n} fila(s)`)
}

const main = async () => {
  const sb = admin()
  const { data: comps } = await sb.from('companies').select('id, slug')
  const BT = comps.find((c) => c.slug === 'buscatools').id
  const TT = comps.find((c) => c.slug === 'torquetools').id
  const { data: wh } = await sb.from('warehouses').select('id').eq('company_id', BT).limit(1).single()
  const { data: prod } = await sb.from('products').select('id').eq('company_id', BT).limit(1).single()
  const { data: mem } = await sb.from('company_memberships')
    .select('role, customer_id').not('customer_id', 'is', null)
  const CLIENTE = mem.find((m) => m.role === 'customer').customer_id
  const DISTRI = mem.find((m) => m.role === 'distributor').customer_id

  // Empresa a la que NO pertenece nadie. Jano está en las dos existentes, así
  // que sin esto no habría forma de probar el aislamiento para un interno.
  await sb.from('companies').delete().eq('slug', 'zz-rls-ventas')
  const { data: ajena } = await sb.from('companies')
    .insert({ slug: 'zz-rls-ventas', name: 'ZZ Empresa ajena (prueba)' }).select('id').single()
  const { data: cliAjeno } = await sb.from('customers')
    .insert({ company_id: ajena.id, legal_name: 'ZZ Cliente de empresa ajena' }).select('id').single()

  const hechos = { pedidos: [], entregas: [], facturas: [], pagos: [] }
  // Estado previo: la limpieza compara contra esto, no contra cero. Con el
  // histórico migrado hay 166 pedidos legítimos que no son fixtures.
  const { count: pedidosPrevios } = await sb.from('sales_orders')
    .select('*', { count: 'exact', head: true })
  const nuevoPedido = async (companyId, customerId, numero, productId = prod.id) => {
    const { data } = await sb.from('sales_orders').insert({
      company_id: companyId, number: numero, customer_id: customerId,
      order_date: '2026-09-09', currency_code: 'USD', commercial_status: 'confirmed',
    }).select('id, number').single()
    hechos.pedidos.push(data.id)
    await sb.from('sales_order_lines').insert({
      company_id: companyId, order_id: data.id, line_no: 1, product_id: productId,
      quantity_ordered: 10, unit_price: 5,
    })
    return data
  }

  // Un pedido de cada uno: del cliente, del distribuidor, de Torquetools —para
  // poder probar la multiempresa de Jano— y de la empresa ajena.
  const { data: prodTT } = await sb.from('products')
    .select('id').eq('company_id', TT).limit(1).single()
  const { data: cliTT } = await sb.from('customers')
    .insert({ company_id: TT, legal_name: 'ZZ Cliente Torquetools (prueba)' }).select('id').single()
  const pedCliente = await nuevoPedido(BT, CLIENTE, 'ZZ-RLS-CLI')
  const pedDistri = await nuevoPedido(BT, DISTRI, 'ZZ-RLS-DIS')
  const pedTT = await nuevoPedido(TT, cliTT.id, 'ZZ-RLS-TT', prodTT.id)
  const pedAjeno = await nuevoPedido(ajena.id, cliAjeno.id, 'ZZ-RLS-AJE')

  // Factura y pago del cliente, para probar el resto de las tablas.
  const { data: facCliente } = await sb.from('sales_invoices').insert({
    company_id: BT, number: 'ZZ-RLS-FAC-1', customer_id: CLIENTE,
    invoice_date: '2026-09-09', currency_code: 'USD', total: 100, status: 'issued',
  }).select('id').single()
  hechos.facturas.push(facCliente.id)
  const { data: pagoCliente } = await sb.from('payments').insert({
    company_id: BT, customer_id: CLIENTE, payment_date: '2026-09-09',
    amount: 100, currency_code: 'USD',
  }).select('id').single()
  hechos.pagos.push(pagoCliente.id)

  try {
    console.log('═'.repeat(74))
    console.log('  RLS DE VENTAS · 5 roles · intentos prohibidos reales')
    console.log('  ' + new Date().toISOString())
    console.log('═'.repeat(74))

    const escenarios = [
      { rol: 'ADMIN · Buscatools', email: 'buscatools.jano@gmail.com',
        pw: process.env.BT_PW_JANO, propia: BT, interno: true, tambienVe: TT },
      { rol: 'SALESPERSON · Torquetools', email: 'buscatools.jano@gmail.com',
        pw: process.env.BT_PW_JANO, propia: TT, interno: true, tambienVe: BT },
      { rol: 'DISTRIBUTOR · Buscatools', email: 'distribuidor.test@buscatools.com.ar',
        pw: process.env.BT_PW_TEST, propia: BT, interno: false,
        suCliente: DISTRI, otroCliente: CLIENTE, suPedido: pedDistri, ajenoPedido: pedCliente },
      { rol: 'CUSTOMER · Buscatools', email: 'cliente.test@buscatools.com.ar',
        pw: process.env.BT_PW_TEST, propia: BT, interno: false,
        suCliente: CLIENTE, otroCliente: DISTRI, suPedido: pedCliente, ajenoPedido: pedDistri },
    ]

    for (const e of escenarios) {
      seccion(e.rol)
      const c = anon()
      const { error: eL } = await c.auth.signInWithPassword({ email: e.email, password: e.pw })
      if (eL) { FAIL('login', eL.message); continue }

      if (e.interno) {
        await permitido('lee pedidos de su empresa', () =>
          c.from('sales_orders').select('id').eq('company_id', e.propia).limit(5))
        await permitido('multiempresa: ve también su otra empresa', () =>
          c.from('sales_orders').select('id').eq('company_id', e.tambienVe).limit(5))
        await permitido('interno ve pagos', () =>
          c.from('payments').select('id').limit(5))
        await permitido('interno ve equivalencias y discrepancias', () =>
          c.from('customer_product_aliases').select('id').limit(5), 0)
      } else {
        // ── El caso central ────────────────────────────────────────────────
        await permitido('ve SU propio pedido', () =>
          c.from('sales_orders').select('id').eq('id', e.suPedido.id))

        await rechazado('NO lee el pedido de otro cliente (por id exacto)', () =>
          c.from('sales_orders').select('id, number').eq('id', e.ajenoPedido.id))
        await rechazado('NO lo encuentra por NÚMERO de documento', () =>
          c.from('sales_orders').select('id').eq('number', e.ajenoPedido.number))
        await rechazado('NO lo encuentra filtrando por el customer_id ajeno', () =>
          c.from('sales_orders').select('id').eq('customer_id', e.otroCliente))
        const { data: listado } = await c.from('sales_orders').select('id, customer_id')
        const ajenas = (listado ?? []).filter((r) => r.customer_id !== e.suCliente).length
        ajenas === 0
          ? PASS('el listado completo sólo trae los suyos', `${(listado ?? []).length} fila(s)`)
          : FAIL('el listado trae documentos ajenos', String(ajenas))

        await rechazado('NO lee líneas del pedido ajeno', () =>
          c.from('sales_order_lines').select('id').eq('order_id', e.ajenoPedido.id))
        await rechazado('NO lee la factura de otro cliente', () =>
          c.from('sales_invoices').select('id').eq('customer_id', e.otroCliente))

        // ── Tablas prohibidas para externos ───────────────────────────────
        await rechazado('externo NO lee pagos', () => c.from('payments').select('id').limit(3))
        await rechazado('externo NO lee asignaciones de pago', () =>
          c.from('payment_allocations').select('id').limit(3))
        await rechazado('externo NO lee equivalencias de producto', () =>
          c.from('customer_product_aliases').select('id').limit(3))
        await rechazado('externo NO lee discrepancias de OC', () =>
          c.from('purchase_order_discrepancies').select('id').limit(3))
        await rechazado('externo NO lee candidatos de OC', () =>
          c.from('customer_po_candidates').select('id').limit(3))
        await rechazado('externo NO lee la auditoría', () =>
          c.from('sales_audit').select('id').limit(3))
        await rechazado('externo NO lee adjuntos', () =>
          c.from('attachments').select('id').limit(3))

        // ── Escrituras prohibidas: intento real ───────────────────────────
        await rechazado('externo NO puede crear un pedido', () =>
          c.from('sales_orders').insert({ company_id: e.propia, number: 'ZZ-HACK-' + Date.now(),
            customer_id: e.suCliente, order_date: '2026-09-09' }).select('id'))
        await rechazado('externo NO puede modificar su propio pedido', () =>
          c.from('sales_orders').update({ notes: 'hackeado' }).eq('id', e.suPedido.id).select('id'))
        await rechazado('externo NO puede numerar documentos', () =>
          c.rpc('next_document_number', { p_company: e.propia, p_doc_type: 'quote' }))
      }

      // ── Empresa ajena: para todos ──────────────────────────────────────
      await rechazado('NO lee el pedido de una empresa ajena', () =>
        c.from('sales_orders').select('id').eq('id', pedAjeno.id))
      await rechazado('NO puede insertar en una empresa ajena', () =>
        c.from('sales_orders').insert({ company_id: ajena.id, number: 'ZZ-CROSS-' + Date.now(),
          customer_id: cliAjeno.id, order_date: '2026-09-09' }).select('id'))
      await rechazado('NO puede numerar en una empresa ajena', () =>
        c.rpc('next_document_number', { p_company: ajena.id, p_doc_type: 'quote' }))

      await c.auth.signOut()
    }

    // ── ANON ─────────────────────────────────────────────────────────────
    seccion('ANON (sin sesión)')
    const a = anon()
    for (const t of ['sales_quotes','sales_quote_lines','customer_purchase_orders',
      'customer_purchase_order_lines','purchase_order_discrepancies','customer_po_candidates',
      'customer_product_aliases','sales_orders','sales_order_lines','deliveries',
      'delivery_lines','delivery_serials','sales_invoices','sales_invoice_lines',
      'payments','payment_allocations','attachments','sales_audit',
      'customer_addresses','customer_contacts','document_sequences']) {
      await rechazado(`anon NO lee ${t}`, () => a.from(t).select('*').limit(1))
    }
    await rechazado('anon NO puede numerar', () =>
      a.rpc('next_document_number', { p_company: BT, p_doc_type: 'quote' }))
  } finally {
    seccion('LIMPIEZA')
    const s = admin()
    await s.from('payment_allocations').delete().in('payment_id', hechos.pagos)
    await s.from('payments').delete().in('id', hechos.pagos)
    await s.from('sales_invoices').delete().in('id', hechos.facturas)
    await s.from('sales_order_lines').delete().in('order_id', hechos.pedidos)
    await s.from('sales_orders').delete().in('id', hechos.pedidos)
    await s.from('customers').delete().eq('id', cliAjeno.id)
    await s.from('customers').delete().eq('id', cliTT.id)
    await s.from('companies').delete().eq('id', ajena.id)
    const { count: pedidos } = await s.from('sales_orders').select('*', { count: 'exact', head: true })
    const { count: empresas } = await s.from('companies').select('*', { count: 'exact', head: true })
    pedidos === pedidosPrevios && empresas === 2
      ? PASS('sin residuos', `sales_orders vuelve a ${pedidosPrevios}  companies=${empresas}`)
      : FAIL('quedaron residuos', `sales_orders=${pedidos} (previos ${pedidosPrevios})  companies=${empresas}`)
  }

  console.log(`\n${'═'.repeat(74)}\n  RESULTADO: ${fallos} fallo(s)\n${'═'.repeat(74)}`)
  process.exit(fallos ? 1 : 0)
}

main().catch((e) => { console.error('✗ ' + e.message); process.exit(1) })
