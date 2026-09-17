/**
 * Fase 15 · E5 — el remito contra la base.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase15-e5-remitos-tests.mjs
 *
 * Lo que prueba, midiendo el EFECTO:
 *   1. crear_remito_desde_pedido: número, serie, estado, líneas, snapshots
 *   2. entregas parciales: 4 + 6 sobre 10, pendiente recalculado por el servidor
 *   3. sobreentrega: por línea, por pedido entregado y por línea de otro pedido
 *   4. concurrencia: dos remitos simultáneos del mismo pendiente → uno solo
 *   5. guardar_remito: cabecera con whitelist, cantidades, alta y baja de líneas
 *   6. stock: crear y editar un remito NO mueve nada; despachar sí, una vez
 *   7. reservas: se liberan al despachar y sólo entonces
 *   8. autoridad: STEL bloquea; la serie marcada STEL bloquea aunque el tipo sea ERP
 *   9. permisos: anon, vendedor, técnico, portal y admin de otra empresa
 *  10. borrado y cancelación: lo que movió stock no se borra
 *  11. line_no y description_snapshot
 *  12. limpieza e invariantes de producción
 *
 * Todo lleva el prefijo zz-e5 y se borra al final. No toca WhatsApp.
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET) { console.error('✗ Faltan variables de entorno'); process.exit(1) }

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(70)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const cmp = (t, esperado, real) =>
  String(esperado) === String(real) ? PASS(t, String(real)) : FAIL(t, `esperaba ${esperado}, dio ${real}`)
const rechaza = (t, r, codigo) => {
  if (!r.error) return FAIL(`SE PERMITIÓ: ${t}`)
  if (codigo && !String(r.error.message).includes(codigo)) {
    return FAIL(t, `esperaba ${codigo}, dio «${String(r.error.message).slice(0, 70)}»`)
  }
  PASS(t, codigo ?? String(r.error.message).slice(0, 50))
}

const sesion = () => createClient(BASE, PUB, { auth: { persistSession: false } })
const s = createClient(BASE, SECRET, { auth: { persistSession: false } })

const MARCA = 'zz-e5'
const creados = { usuarios: [], empresas: [] }
const ok = (r, q) => { if (r.error) throw new Error(`${q}: ${r.error.message}`); return r.data }
const cuenta = async (t, filtro = (q) => q) => (await filtro(s.from(t).select('*', { count: 'exact', head: true }))).count

const usuarioTemporal = async (companyId, rol, customerId = null) => {
  const email = `${MARCA}-${rol}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@buscatools.test`
  const password = `Zz${randomUUID()}!`
  const { data, error } = await s.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`crear ${rol}: ${error.message}`)
  creados.usuarios.push(data.user.id)
  const fila = { company_id: companyId, user_id: data.user.id, role: rol, status: 'active' }
  if (customerId) fila.customer_id = customerId
  ok(await s.from('company_memberships').insert(fila), `membresía ${rol}`)
  const c = sesion()
  const { error: eL } = await c.auth.signInWithPassword({ email, password })
  if (eL) throw new Error(`login ${rol}: ${eL.message}`)
  return { id: data.user.id, rol, c }
}

const limpiar = async () => {
  const ids = creados.empresas
  if (ids.length) {
    const borrar = async (t) => {
      const r = await s.from(t).delete().in('company_id', ids)
      if (r.error) console.log(`    aviso ${t}: ${r.error.message.slice(0, 110)}`)
    }
    await s.from('sales_audit').delete().in('company_id', ids)
    await borrar('stock_movements')
    await borrar('stock_reservations')
    await borrar('stock_balances')
    await borrar('delivery_lines')
    await borrar('deliveries')
    await borrar('sales_orders')
    await borrar('sales_quotes')
    await borrar('warehouses')
    await borrar('products')
    await borrar('product_categories')
    await borrar('document_numbering_authority_series')
    await borrar('document_numbering_authority')
    await borrar('document_sequences')
    await borrar('company_memberships')
    await borrar('customer_contacts')
    await borrar('customers')
  }
  for (const u of creados.usuarios) await s.auth.admin.deleteUser(u)
  creados.usuarios = []
  if (ids.length) {
    const r = await s.from('companies').delete().in('id', ids)
    if (r.error) console.log(`    aviso companies: ${r.error.message.slice(0, 120)}`)
  }
}

const barrerRestos = async () => {
  const { data: viejas } = await s.from('companies').select('id').like('slug', `${MARCA}-%`)
  creados.empresas = (viejas ?? []).map((x) => x.id)
  const { data: us } = await s.auth.admin.listUsers({ perPage: 1000 })
  creados.usuarios = (us?.users ?? []).filter((u) => u.email?.startsWith(`${MARCA}-`)).map((u) => u.id)
  await limpiar()
  creados.empresas = []
}

const PRODUCCION = ['buscatools', 'torquetools']

async function main() {
  console.log('='.repeat(78))
  console.log('  FASE 15 · VENTAS E5 — remitos: alta atómica, parciales y stock')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(78))

  await barrerRestos()

  const { data: prodEmpresas } = await s.from('companies').select('id, slug').in('slug', PRODUCCION)
  const prodIds = prodEmpresas.map((e) => e.id)
  const baselineProd = async () => ({
    orders: await cuenta('sales_orders', (q) => q.in('company_id', prodIds)),
    lineasO: await cuenta('sales_order_lines', (q) => q.in('company_id', prodIds)),
    entregas: await cuenta('deliveries', (q) => q.in('company_id', prodIds)),
    lineasE: await cuenta('delivery_lines', (q) => q.in('company_id', prodIds)),
    stock: await cuenta('stock_movements', (q) => q.in('company_id', prodIds)),
    reservas: await cuenta('stock_reservations', (q) => q.in('company_id', prodIds)),
    auditoria: await cuenta('sales_audit', (q) => q.in('company_id', prodIds)),
    saldos: (await s.from('stock_balances').select('on_hand').in('company_id', prodIds)).data
      ?.reduce((t, x) => t + Number(x.on_hand), 0) ?? 0,
    secuencias: (await s.from('document_sequences').select('next_number').in('company_id', prodIds)).data?.map((x) => x.next_number).join(',') ?? '',
    autoridad: (await s.from('document_numbering_authority').select('doc_type, authority').in('company_id', prodIds)).data?.map((x) => `${x.doc_type}:${x.authority}`).sort().join(',') ?? '',
    autoridadSerie: (await s.from('document_numbering_authority_series').select('doc_type, series_code, authority').in('company_id', prodIds)).data?.map((x) => `${x.doc_type}/${x.series_code}:${x.authority}`).sort().join(',') ?? '',
  })
  const antesProd = await baselineProd()
  console.log(`  baseline producción: ${JSON.stringify(antesProd)}`)

  // ── Fixture ──────────────────────────────────────────────────────────────
  const sello = Date.now()
  const empresa = async (k, nombre) => {
    const e = ok(await s.from('companies').insert({
      slug: `${MARCA}-${k}-${sello}`, name: nombre, legal_name: `${nombre} SA`, default_currency: 'USD',
    }).select('id').single(), `empresa ${k}`)
    creados.empresas.push(e.id)
    for (const [doc, code] of [['quote', 'ZQ'], ['sales_order', 'ZP'], ['delivery', 'ZR']]) {
      ok(await s.from('document_sequences').insert({
        company_id: e.id, doc_type: doc, series_code: `${code}${k.toUpperCase()}`, prefix: `${code}${k.toUpperCase()}`,
        padding: 5, next_number: 1, is_default: true,
      }), `secuencia ${doc} ${k}`)
    }
    return e.id
  }
  const A = await empresa('a', 'ZZ E5 Alfa')
  const B = await empresa('b', 'ZZ E5 Beta')

  const deposito = ok(await s.from('warehouses').insert({
    company_id: A, code: `ZZ${sello % 1000}`, name: 'ZZ Depósito E5',
  }).select('id').single(), 'depósito')
  ok(await s.from('warehouses').insert({
    company_id: B, code: `ZB${sello % 1000}`, name: 'ZZ Depósito de B',
  }).select('id').single(), 'depósito B')

  const categoria = ok(await s.from('product_categories').insert({
    company_id: A, name: 'ZZ E5 Cat', slug: `${MARCA}-cat-${sello}`, position: 1, needs_review: false,
  }).select('id').single(), 'categoría')
  const categoriaB = ok(await s.from('product_categories').insert({
    company_id: B, name: 'ZZ E5 Cat B', slug: `${MARCA}-cat-b-${sello}`, position: 1, needs_review: false,
  }).select('id').single(), 'categoría B')
  const producto = ok(await s.from('products').insert({
    company_id: A, category_id: categoria.id, sku: `${MARCA}-P-${sello}`, name: 'ZZ Producto E5', status: 'active', attributes: {},
  }).select('id').single(), 'producto')
  const producto2 = ok(await s.from('products').insert({
    company_id: A, category_id: categoria.id, sku: `${MARCA}-P2-${sello}`, name: 'ZZ Producto E5 dos', status: 'active', attributes: {},
  }).select('id').single(), 'producto 2')
  const productoB = ok(await s.from('products').insert({
    company_id: B, category_id: categoriaB.id, sku: `${MARCA}-PB-${sello}`, name: 'ZZ Producto de B', status: 'active', attributes: {},
  }).select('id').single(), 'producto B')

  // Stock de apertura: 20 y 20, todo en el depósito de la empresa de fixture.
  ok(await s.from('stock_movements').insert([
    { company_id: A, product_id: producto.id, warehouse_id: deposito.id, movement_type: 'opening_balance', quantity: 20, source_type: 'test', notes: 'ZZ E5' },
    { company_id: A, product_id: producto2.id, warehouse_id: deposito.id, movement_type: 'opening_balance', quantity: 20, source_type: 'test', notes: 'ZZ E5' },
  ]), 'stock inicial')

  const cliente = ok(await s.from('customers').insert({
    company_id: A, legal_name: 'ZZ E5 Cliente SA', status: 'active',
  }).select('id').single(), 'cliente')
  const otroCliente = ok(await s.from('customers').insert({
    company_id: A, legal_name: 'ZZ E5 Otro SA', status: 'active',
  }).select('id').single(), 'otro cliente')
  const contacto = ok(await s.from('customer_contacts').insert({
    company_id: A, customer_id: cliente.id, full_name: 'ZZ Contacto E5', role: 'Compras',
  }).select('id').single(), 'contacto')
  const contactoAjeno = ok(await s.from('customer_contacts').insert({
    company_id: A, customer_id: otroCliente.id, full_name: 'ZZ Contacto ajeno', role: 'Compras',
  }).select('id').single(), 'contacto ajeno')
  const clienteB = ok(await s.from('customers').insert({
    company_id: B, legal_name: 'ZZ E5 Cliente B SA', status: 'active',
  }).select('id').single(), 'cliente B')

  const admin = await usuarioTemporal(A, 'admin')
  const employee = await usuarioTemporal(A, 'employee')
  const vendedor = await usuarioTemporal(A, 'salesperson')
  const tecnico = await usuarioTemporal(A, 'technician')
  const portal = await usuarioTemporal(A, 'customer', cliente.id)
  const adminB = await usuarioTemporal(B, 'admin')
  const anon = sesion()

  const LINEA = (over = {}) => ({
    line_type: 'item', product_id: producto.id, sku_snapshot: 'ZZ-1', name_snapshot: 'ZZ Producto E5',
    description_snapshot: 'ZZ texto comercial', quantity: 10, unit_price: 100, discount_pct: 0,
    tax_treatment: 'vat_21', tax_rate_snapshot: 21, ...over,
  })

  /** Un pedido CONFIRMADO con las líneas que se le pidan. */
  const pedidoConfirmado = async (lineas = [LINEA()], empresaId = A, clienteId = cliente.id) => {
    const c = empresaId === A ? admin.c : adminB.c
    const p = ok(await c.rpc('crear_pedido', {
      p_company: empresaId, p_cabecera: { customer_id: clienteId, currency_code: 'USD' }, p_lineas: lineas,
    }), 'crear pedido')
    ok(await s.from('sales_orders').update({ commercial_status: 'confirmed' }).eq('id', p.id), 'confirmar pedido')
    return p
  }

  const remitar = (c, orderId, lineas, fecha = null, esperado = null) =>
    c.rpc('crear_remito_desde_pedido', {
      p_order: orderId, p_lineas: lineas, p_fecha: fecha, p_esperado: esperado,
    })
  const guardar = (c, deliveryId, esperado, cab = {}, lineas = null) =>
    c.rpc('guardar_remito', {
      p_delivery: deliveryId, p_esperado: esperado, p_cabecera: cab, p_lineas: lineas,
    })
  const remito = async (id) => (await s.from('deliveries').select('*').eq('id', id).single()).data
  const lineasDe = async (id) => (await s.from('delivery_lines').select('*').eq('delivery_id', id).order('line_no')).data
  const lineasPedido = async (id) => (await s.from('sales_order_lines').select('*').eq('order_id', id).order('line_no')).data
  const movimientos = async (deliveryId) =>
    (await s.from('stock_movements').select('*').eq('source_type', 'delivery').eq('source_id', deliveryId)).data
  /** El pendiente real de una línea de pedido, como lo ve la base. */
  const pendienteDe = async (orderLineId) => {
    const pedida = Number((await s.from('sales_order_lines').select('quantity_ordered').eq('id', orderLineId).single()).data.quantity_ordered)
    const { data } = await s.from('delivery_lines')
      .select('quantity, deliveries!inner(status)')
      .eq('order_line_id', orderLineId)
      .neq('deliveries.status', 'cancelled')
    return pedida - (data ?? []).reduce((t, x) => t + Number(x.quantity), 0)
  }
  const saldo = async (productId) =>
    Number((await s.from('stock_balances').select('on_hand, reserved').eq('company_id', A).eq('product_id', productId).maybeSingle()).data?.on_hand ?? 0)

  // ── 1 · Pedido → remito, atómico ─────────────────────────────────────────
  seccion('1 · Pedido → remito en una transacción')

  const ped1 = await pedidoConfirmado()
  const lp1 = await lineasPedido(ped1.id)
  const stockAntes = await saldo(producto.id)

  const r1 = ok(await remitar(admin.c, ped1.id, [{ order_line_id: lp1[0].id, quantity: 4 }], '2026-09-18'), 'remito 1')
  cmp('devuelve id, número y líneas', true, !!r1.id && r1.number === 'ZRA00001' && r1.lineas === 1)

  const d1 = await remito(r1.id)
  cmp('nace en borrador', 'draft', d1.status)
  cmp('serie del servidor, la por defecto de la empresa', 'ZRA', d1.series_code)
  cmp('queda atado al pedido', ped1.id, d1.order_id)
  cmp('hereda cliente y moneda del pedido', `${cliente.id}/USD`, `${d1.customer_id}/${d1.currency_code}`)
  cmp('fecha del remito, la que se pidió', '2026-09-18', d1.delivery_date)

  const l1 = await lineasDe(r1.id)
  cmp('la línea apunta a la del pedido', lp1[0].id, l1[0].order_line_id)
  cmp('line_no desde 1', '1', l1.map((l) => l.line_no).join(','))
  cmp('copia el snapshot de la línea del pedido', 'ZZ texto comercial/100.00',
    `${l1[0].description_snapshot}/${Number(l1[0].unit_price).toFixed(2)}`)
  cmp('depósito de la empresa', deposito.id, l1[0].warehouse_id)

  cmp('crear un remito NO mueve stock', `${stockAntes}/0`, `${await saldo(producto.id)}/${(await movimientos(r1.id)).length}`)

  const audit1 = ok(await s.from('sales_audit').select('*').eq('entity_id', r1.id), 'auditoría')
  cmp('un evento created con el pedido de origen', true,
    audit1.length === 1 && audit1[0].action === 'created' && audit1[0].diff.pedido === ped1.number)

  // ── 2 · Entregas parciales ───────────────────────────────────────────────
  seccion('2 · Entregas parciales, con el pendiente del servidor')

  cmp('sobre 10 pedidas y 4 entregadas, quedan 6', 6, await pendienteDe(lp1[0].id))
  rechaza('un segundo remito por más que el pendiente',
    await remitar(admin.c, ped1.id, [{ order_line_id: lp1[0].id, quantity: 7 }]), 'SOBREENTREGA')

  const r2 = ok(await remitar(admin.c, ped1.id, [{ order_line_id: lp1[0].id, quantity: 6 }]), 'remito 2')
  // El intento rechazado NO quemó un número: todo pasa en una transacción, así
  // que la secuencia vuelve atrás con el resto.
  cmp('el segundo remito entrega el resto, sin saltear números', 'ZRA00002', r2.number)
  cmp('el pedido queda sin pendiente', 0, await pendienteDe(lp1[0].id))

  rechaza('un tercer remito sobre un pedido entregado',
    await remitar(admin.c, ped1.id, [{ order_line_id: lp1[0].id, quantity: 1 }]), 'PEDIDO_TOTALMENTE_ENTREGADO')

  // ── 3 · Cantidades ───────────────────────────────────────────────────────
  seccion('3 · Cantidades: nada de sobreentrega ni de valores imposibles')

  const ped2 = await pedidoConfirmado([LINEA({ quantity: 5 })])
  const lp2 = await lineasPedido(ped2.id)

  rechaza('cantidad 0', await remitar(admin.c, ped2.id, [{ order_line_id: lp2[0].id, quantity: 0 }]), 'CANTIDAD_INVALIDA')
  rechaza('cantidad negativa', await remitar(admin.c, ped2.id, [{ order_line_id: lp2[0].id, quantity: -3 }]), 'CANTIDAD_INVALIDA')
  rechaza('más que lo pedido', await remitar(admin.c, ped2.id, [{ order_line_id: lp2[0].id, quantity: 6 }]), 'SOBREENTREGA')
  rechaza('sin líneas', await remitar(admin.c, ped2.id, []), 'SIN_LINEAS')
  rechaza('línea de otro pedido', await remitar(admin.c, ped2.id, [{ order_line_id: lp1[0].id, quantity: 1 }]), 'LINEA_DE_OTRO_PEDIDO')
  rechaza('línea sin pedido', await remitar(admin.c, ped2.id, [{ quantity: 1 }]), 'LINEA_SIN_PEDIDO')
  cmp('ningún remito quedó a medias', 0,
    await cuenta('deliveries', (q) => q.eq('order_id', ped2.id)))

  const ped3 = await pedidoConfirmado([LINEA({ quantity: 2 })])
  const lp3 = await lineasPedido(ped3.id)
  ok(await s.from('sales_orders').update({ commercial_status: 'draft' }).eq('id', ped3.id), 'volver a borrador')
  rechaza('pedido sin confirmar', await remitar(admin.c, ped3.id, [{ order_line_id: lp3[0].id, quantity: 1 }]), 'PEDIDO_NO_CONFIRMADO')
  ok(await s.from('sales_orders').update({ commercial_status: 'cancelled' }).eq('id', ped3.id), 'cancelar')
  rechaza('pedido cancelado', await remitar(admin.c, ped3.id, [{ order_line_id: lp3[0].id, quantity: 1 }]), 'PEDIDO_CANCELADO')

  // ── 4 · Concurrencia ─────────────────────────────────────────────────────
  seccion('4 · Dos remitos a la vez no entregan dos veces lo mismo')

  const ped4 = await pedidoConfirmado([LINEA({ quantity: 5 })])
  const lp4 = await lineasPedido(ped4.id)
  const [c1, c2] = await Promise.all([
    remitar(admin.c, ped4.id, [{ order_line_id: lp4[0].id, quantity: 5 }]),
    remitar(employee.c, ped4.id, [{ order_line_id: lp4[0].id, quantity: 5 }]),
  ])
  cmp('gana uno solo', 1, [c1, c2].filter((r) => !r.error).length)
  cmp('el otro recibe un motivo, no un remito a medias', true,
    [c1, c2].some((r) => r.error && /SOBREENTREGA|PEDIDO_TOTALMENTE_ENTREGADO/.test(r.error.message)))
  cmp('un solo remito para ese pedido', 1, await cuenta('deliveries', (q) => q.eq('order_id', ped4.id)))
  const entregado4 = (await s.from('delivery_lines').select('quantity').eq('order_line_id', lp4[0].id)).data
    .reduce((t, x) => t + Number(x.quantity), 0)
  cmp('nunca se entregó más que lo pedido', 5, entregado4)

  // ── 5 · Guardar un remito en borrador ────────────────────────────────────
  seccion('5 · Guardar un remito en borrador')

  const ped5 = await pedidoConfirmado([LINEA({ quantity: 10 }), LINEA({ product_id: producto2.id, sku_snapshot: 'ZZ-2', quantity: 4 })])
  const lp5 = await lineasPedido(ped5.id)
  const r5 = ok(await remitar(admin.c, ped5.id, [{ order_line_id: lp5[0].id, quantity: 3 }]), 'remito 5')
  const d5 = await remito(r5.id)

  const g5 = ok(await guardar(admin.c, r5.id, d5.updated_at,
    { title: 'ZZ Remito editado', notes: 'ZZ nota', carrier: 'ZZ Transporte', tracking: 'ZZ-123', contact_id: contacto.id },
    [
      { id: (await lineasDe(r5.id))[0].id, quantity: 5, description_snapshot: 'ZZ texto del remito' },
      { order_line_id: lp5[1].id, quantity: 2 },
    ]), 'guardar remito')
  cmp('una llamada: 5 campos de cabecera y 2 líneas tocadas', '5/2', `${g5.cambios_cabecera}/${g5.lineas_tocadas}`)

  const d5b = await remito(r5.id)
  cmp('guarda transporte y seguimiento', 'ZZ Transporte/ZZ-123', `${d5b.carrier}/${d5b.tracking}`)
  const l5 = await lineasDe(r5.id)
  cmp('dos líneas, renumeradas 1 y 2', '1,2', l5.map((l) => l.line_no).join(','))
  cmp('la cantidad subió a 5', 5, Number(l5[0].quantity))
  cmp('el texto del remito es propio, no el del catálogo', 'ZZ texto del remito', l5[0].description_snapshot)
  cmp('guardar un remito NO mueve stock', 0, (await movimientos(r5.id)).length)

  rechaza('un campo fuera de la whitelist', await guardar(admin.c, r5.id, d5b.updated_at, { status: 'shipped' }), 'CAMPO_NO_EDITABLE')
  rechaza('el número, tampoco', await guardar(admin.c, r5.id, d5b.updated_at, { number: 'ZRA09999' }), 'CAMPO_NO_EDITABLE')
  rechaza('la empresa, menos', await guardar(admin.c, r5.id, d5b.updated_at, { company_id: B }), 'CAMPO_NO_EDITABLE')
  rechaza('el pedido de origen, tampoco', await guardar(admin.c, r5.id, d5b.updated_at, { order_id: ped1.id }), 'CAMPO_NO_EDITABLE')
  rechaza('los campos de importación, menos', await guardar(admin.c, r5.id, d5b.updated_at, { imported_at: '2020-01-01' }), 'CAMPO_NO_EDITABLE')
  rechaza('un contacto de otro cliente', await guardar(admin.c, r5.id, d5b.updated_at, { contact_id: contactoAjeno.id }), 'CONTACTO_DE_OTRO_CLIENTE')
  rechaza('sobreentrega al editar', await guardar(admin.c, r5.id, d5b.updated_at, {},
    [{ id: l5[0].id, quantity: 11 }]), 'SOBREENTREGA')
  rechaza('línea de otro remito', await guardar(admin.c, r5.id, d5b.updated_at, {},
    [{ id: (await lineasDe(r1.id))[0].id, quantity: 1 }]), 'LINEA_DE_OTRO_REMITO')
  rechaza('quedarse sin líneas', await guardar(admin.c, r5.id, d5b.updated_at, {}, []), 'SIN_LINEAS')

  const d5c = await remito(r5.id)
  const [w1, w2] = await Promise.all([
    guardar(admin.c, r5.id, d5c.updated_at, { title: 'ZZ uno' }),
    guardar(employee.c, r5.id, d5c.updated_at, { title: 'ZZ dos' }),
  ])
  cmp('dos guardados a la vez: gana uno solo', 1, [w1, w2].filter((r) => !r.error).length)
  cmp('el otro recibe CONFLICTO_DE_EDICION', true,
    [w1, w2].some((r) => r.error && r.error.message.includes('CONFLICTO_DE_EDICION')))

  // Bajar una línea y borrar la otra, en la misma llamada.
  const d5d = await remito(r5.id)
  const l5d = await lineasDe(r5.id)
  const g5b = ok(await guardar(admin.c, r5.id, d5d.updated_at, {}, [{ id: l5d[0].id, quantity: 1 }]), 'bajar y borrar')
  cmp('bajar una y borrar otra: 2 líneas tocadas', 2, g5b.lineas_tocadas)
  cmp('queda una sola línea', 1, (await lineasDe(r5.id)).length)
  const auditBorrada = ok(await s.from('sales_audit').select('*').eq('entity_id', r5.id).eq('action', 'line_removed'), 'auditoría línea')
  cmp('la línea borrada queda auditada con su número real', true,
    auditBorrada.length === 1 && auditBorrada[0].diff.line_no === 2)

  // ── 6 · Stock al despachar ───────────────────────────────────────────────
  seccion('6 · Despachar: el único momento en que se mueve stock')

  const saldoAntes = await saldo(producto.id)
  const d5e = await remito(r5.id)
  const conf = ok(await admin.c.rpc('confirmar_entrega', { p_delivery: r5.id }), 'confirmar')
  cmp('un movimiento por línea', `false/shipped/1`, `${conf.ya_confirmada}/${conf.status}/${conf.movimientos}`)
  cmp('descuenta exactamente lo entregado', saldoAntes - 1, await saldo(producto.id))
  const mov5 = await movimientos(r5.id)
  cmp('el movimiento apunta al remito', 'delivery/sale_delivery/-1',
    `${mov5[0].source_type}/${mov5[0].movement_type}/${Number(mov5[0].quantity)}`)

  const conf2 = ok(await admin.c.rpc('confirmar_entrega', { p_delivery: r5.id }), 'confirmar de nuevo')
  cmp('confirmar dos veces NO repite el movimiento', 'true/1', `${conf2.ya_confirmada}/${(await movimientos(r5.id)).length}`)
  cmp('el saldo tampoco se toca dos veces', saldoAntes - 1, await saldo(producto.id))

  const d5f = await remito(r5.id)
  rechaza('un remito despachado ya no se edita', await guardar(admin.c, r5.id, d5f.updated_at, { title: 'ZZ tarde' }), 'REMITO_DESPACHADO')
  cmp('el pedido queda parcialmente entregado', 'partially_delivered',
    (await s.from('sales_orders').select('fulfillment_status').eq('id', ped5.id).single()).data.fulfillment_status)

  // Dos confirmaciones simultáneas del mismo remito.
  const ped6 = await pedidoConfirmado([LINEA({ quantity: 2 })])
  const lp6 = await lineasPedido(ped6.id)
  const r6 = ok(await remitar(admin.c, ped6.id, [{ order_line_id: lp6[0].id, quantity: 2 }]), 'remito 6')
  const [k1, k2] = await Promise.all([
    admin.c.rpc('confirmar_entrega', { p_delivery: r6.id }),
    employee.c.rpc('confirmar_entrega', { p_delivery: r6.id }),
  ])
  cmp('dos confirmaciones a la vez: UN movimiento', 1, (await movimientos(r6.id)).length)
  cmp('las dos contestan sin error', 2, [k1, k2].filter((r) => !r.error).length)

  // ── 7 · Reservas ─────────────────────────────────────────────────────────
  seccion('7 · Reservas: se liberan al despachar, y sólo entonces')

  const ped7 = await pedidoConfirmado([LINEA({ product_id: producto2.id, sku_snapshot: 'ZZ-2', quantity: 3 })])
  const lp7 = await lineasPedido(ped7.id)
  ok(await s.from('stock_reservations').insert({
    company_id: A, product_id: producto2.id, warehouse_id: deposito.id, quantity: 3,
    source_type: 'sales_order', source_id: ped7.id, notes: 'ZZ reserva E5',
  }), 'reserva')

  const r7 = ok(await remitar(admin.c, ped7.id, [{ order_line_id: lp7[0].id, quantity: 3 }]), 'remito 7')
  cmp('crear el remito NO toca la reserva', 1, await cuenta('stock_reservations', (q) => q.eq('source_id', ped7.id)))

  const conf7 = ok(await admin.c.rpc('confirmar_entrega', { p_delivery: r7.id }), 'confirmar 7')
  cmp('al despachar se libera la reserva', '1/1', `${conf7.movimientos}/${conf7.reservas_liberadas}`)
  cmp('no queda reserva viva', 0, await cuenta('stock_reservations', (q) => q.eq('source_id', ped7.id)))

  // ── 8 · Autoridad de numeración ──────────────────────────────────────────
  seccion('8 · Autoridad: por tipo y por serie')

  const ped8 = await pedidoConfirmado([LINEA({ quantity: 1 })])
  const lp8 = await lineasPedido(ped8.id)
  ok(await s.from('document_numbering_authority').insert({ company_id: A, doc_type: 'delivery', authority: 'STEL', reason: 'ZZ E5: prueba de autoridad' }), 'autoridad STEL')
  rechaza('con la numeración en STEL no se emite remito',
    await remitar(admin.c, ped8.id, [{ order_line_id: lp8[0].id, quantity: 1 }]), 'external_numbering_authority')
  ok(await s.from('document_numbering_authority').update({ authority: 'ERP' }).eq('company_id', A).eq('doc_type', 'delivery'), 'volver a ERP')
  const r8 = ok(await remitar(admin.c, ped8.id, [{ order_line_id: lp8[0].id, quantity: 1 }]), 'remito 8')
  cmp('con autoridad ERP vuelve a emitirse', true, !!r8.id)

  // La excepción RT-ML: una serie marcada STEL aunque el TIPO sea ERP.
  ok(await s.from('document_sequences').insert({
    company_id: A, doc_type: 'delivery', series_code: 'RT-ML', prefix: 'RTML', padding: 5, next_number: 1, is_default: false,
  }), 'secuencia RT-ML')
  ok(await s.from('document_numbering_authority_series').insert({
    company_id: A, doc_type: 'delivery', series_code: 'RT-ML', authority: 'STEL',
    reason: 'ZZ E5: RT-ML es sólo importación',
  }), 'autoridad de serie RT-ML')

  rechaza('numerar en la serie RT-ML desde el ERP',
    await admin.c.rpc('next_document_number', { p_company: A, p_doc_type: 'delivery', p_series: 'RT-ML' }),
    'external_numbering_authority')
  rechaza('insertar un remito con serie RT-ML',
    await admin.c.from('deliveries').insert({
      company_id: A, number: `RTML-${sello}`, series_code: 'RT-ML', customer_id: cliente.id,
      delivery_date: '2026-09-18', currency_code: 'USD', status: 'draft',
    }),
    'external_numbering_authority')
  const d8 = await remito(r8.id)
  cmp('el remito del ERP nunca sale en RT-ML', 'ZRA', d8.series_code)
  cmp('la secuencia de RT-ML sigue sin consumirse', 1,
    (await s.from('document_sequences').select('next_number').eq('company_id', A).eq('series_code', 'RT-ML').single()).data.next_number)

  // ── 9 · Permisos ─────────────────────────────────────────────────────────
  seccion('9 · Permisos: quién puede remitar')

  const ped9 = await pedidoConfirmado([LINEA({ quantity: 4 })])
  const lp9 = await lineasPedido(ped9.id)
  const payload9 = [{ order_line_id: lp9[0].id, quantity: 1 }]

  rechaza('anónimo', await remitar(anon, ped9.id, payload9))
  rechaza('vendedor', await remitar(vendedor.c, ped9.id, payload9), 'SIN_PERMISO_EMPRESA')
  rechaza('técnico', await remitar(tecnico.c, ped9.id, payload9), 'SIN_PERMISO_EMPRESA')
  rechaza('cliente del portal', await remitar(portal.c, ped9.id, payload9), 'SIN_PERMISO_EMPRESA')
  rechaza('admin de otra empresa', await remitar(adminB.c, ped9.id, payload9), 'SIN_PERMISO_EMPRESA')
  const r9 = ok(await remitar(employee.c, ped9.id, payload9), 'employee remite')
  cmp('admin y employee sí', true, !!r9.id)

  const d9 = await remito(r9.id)
  rechaza('el vendedor tampoco guarda', await guardar(vendedor.c, r9.id, d9.updated_at, { title: 'ZZ' }), 'SIN_PERMISO_EMPRESA')
  rechaza('ni el admin de otra empresa', await guardar(adminB.c, r9.id, d9.updated_at, { title: 'ZZ' }), 'SIN_PERMISO_EMPRESA')
  rechaza('ni confirma quien no escribe', await vendedor.c.rpc('confirmar_entrega', { p_delivery: r9.id }))

  // ── 10 · Borrar y cancelar ───────────────────────────────────────────────
  seccion('10 · Borrar y cancelar: lo que movió stock no se toca')

  const borradoBorrador = await admin.c.from('deliveries').delete().eq('id', r9.id)
  cmp('un remito en borrador se borra', true, !borradoBorrador.error)
  cmp('y se lleva sus líneas', 0, await cuenta('delivery_lines', (q) => q.eq('delivery_id', r9.id)))

  rechaza('un remito despachado NO se borra', await admin.c.from('deliveries').delete().eq('id', r5.id), 'movió stock')
  rechaza('un remito despachado NO se cancela', await admin.c.from('deliveries').update({ status: 'cancelled' }).eq('id', r5.id), 'DELIVERY_ALREADY_DISPATCHED')

  const ped10 = await pedidoConfirmado([LINEA({ quantity: 3 })])
  const lp10 = await lineasPedido(ped10.id)
  const r10 = ok(await remitar(admin.c, ped10.id, [{ order_line_id: lp10[0].id, quantity: 3 }]), 'remito 10')
  ok(await admin.c.from('deliveries').update({ status: 'cancelled' }).eq('id', r10.id), 'cancelar borrador')
  cmp('cancelar un borrador devuelve el pendiente', 3, await pendienteDe(lp10[0].id))
  const r10b = ok(await remitar(admin.c, ped10.id, [{ order_line_id: lp10[0].id, quantity: 3 }]), 'remito tras cancelar')
  cmp('se puede volver a remitar lo cancelado', true, !!r10b.id)
  cmp('el remito cancelado no movió stock', 0, (await movimientos(r10.id)).length)

  // ── 11 · Estado del pedido y cumplimiento ────────────────────────────────
  seccion('11 · Cumplimiento del pedido')

  ok(await admin.c.rpc('confirmar_entrega', { p_delivery: r10b.id }), 'despachar 10b')
  cmp('entregado por completo', 'delivered',
    (await s.from('sales_orders').select('fulfillment_status').eq('id', ped10.id).single()).data.fulfillment_status)

  // ── 12 · Limpieza e invariantes ──────────────────────────────────────────
  seccion('12 · Limpieza e invariantes')

  await limpiar()
  cmp('sin empresas de fixture', 0,
    (await s.from('companies').select('id', { count: 'exact', head: true }).like('slug', `${MARCA}-%`)).count)

  const despues = await baselineProd()
  cmp('producción idéntica al baseline', JSON.stringify(antesProd), JSON.stringify(despues))

  console.log('\n' + '='.repeat(78))
  console.log(`  RESULTADO: ${fallos === 0 ? '0 FALLOS' : fallos + ' FALLO(S)'}`)
  console.log('='.repeat(78))
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('\n✗ ERROR:', e.message)
  try { await limpiar() } catch (x) { console.error('  y la limpieza falló:', x.message) }
  process.exit(1)
})
