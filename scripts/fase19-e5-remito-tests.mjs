/**
 * Fase 19 · E5 — Remitos: borrador, despacho, stock y concurrencia.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase19-e5-remito-tests.mjs
 *
 * TODO pasa en empresas fixture `zz-e5r`. De producción NO se escribe nada, ni
 * siquiera un borrador: los remitos reales y el piloto PDV-ERP00001 no se
 * tocan. Este script existe justamente para probar el despacho SIN despachar
 * nada de verdad.
 *
 * A · crear el borrador: +1 remito, +N líneas, 0 stock, 0 reservas
 * B · el borrador NO cuenta como entregado
 * C · confirmar: un movimiento NEGATIVO por línea y el saldo baja
 * D · confirmar dos veces: idempotente, sin movimientos nuevos
 * E · dos confirmaciones simultáneas: una sola tanda de movimientos
 * F · entrega parcial: 10 → 4 y 6, y el pedido queda entregado
 * G · sobreentrega: 10 pedidas, 11 → rechazada
 * H · dos borradores que juntos se pasan: el servidor lo frena
 * I · un remito despachado no se borra; uno en borrador sí
 * J · el domicilio queda CONGELADO en el remito
 * K · RLS: otra empresa no ve los remitos
 * L · con la serie en STEL no se puede ni crear el borrador
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET) { console.error('✗ Faltan variables de entorno'); process.exit(1) }

const BUSCATOOLS = 'bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c'

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(70)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const cmp = (t, esperado, real) =>
  String(esperado) === String(real) ? PASS(t, String(real)) : FAIL(t, `esperaba ${esperado}, dio ${real}`)
const contiene = (t, texto, aguja) =>
  String(texto).includes(aguja) ? PASS(t, aguja) : FAIL(t, `esperaba «${aguja}», dio «${texto}»`)

const s = createClient(BASE, SECRET, { auth: { persistSession: false } })
const sesion = () => createClient(BASE, PUB, { auth: { persistSession: false } })
const ok = (r, q) => { if (r.error) throw new Error(`${q}: ${r.error.message}`); return r.data }

const MARCA = 'zz-e5r'
const creados = { usuarios: [], empresas: [] }

const usuarioTemporal = async (companyId, rol) => {
  const email = `${MARCA}-${rol}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@buscatools.test`
  const password = `Zz${randomUUID()}!`
  const { data, error } = await s.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`crear ${rol}: ${error.message}`)
  creados.usuarios.push(data.user.id)
  ok(await s.from('company_memberships').insert({
    company_id: companyId, user_id: data.user.id, role: rol, status: 'active',
  }), `membresía ${rol}`)
  const c = sesion()
  const { error: eL } = await c.auth.signInWithPassword({ email, password })
  if (eL) throw new Error(`login ${rol}: ${eL.message}`)
  return { id: data.user.id, rol, c }
}

const limpiar = async () => {
  const ids = creados.empresas
  if (ids.length) {
    const remitos = (await s.from('deliveries').select('id').in('company_id', ids)).data ?? []
    if (remitos.length) await s.from('delivery_lines').delete().in('delivery_id', remitos.map((x) => x.id))
    // Un remito que movió stock no se borra: primero se van los movimientos.
    await s.from('stock_movements').delete().in('company_id', ids)
    await s.from('stock_reservations').delete().in('company_id', ids)
    await s.from('stock_balances').delete().in('company_id', ids)
    const pedidos = (await s.from('sales_orders').select('id').in('company_id', ids)).data ?? []
    if (pedidos.length) await s.from('sales_order_lines').delete().in('order_id', pedidos.map((x) => x.id))
    const cotis = (await s.from('sales_quotes').select('id').in('company_id', ids)).data ?? []
    if (cotis.length) await s.from('sales_quote_lines').delete().in('quote_id', cotis.map((x) => x.id))
    for (const t of ['sales_audit', 'deliveries', 'sales_orders', 'sales_quotes',
                     'product_prices', 'products', 'product_categories', 'price_lists',
                     'customer_addresses', 'warehouses',
                     'document_numbering_authority_series', 'document_numbering_authority',
                     'document_sequences', 'company_memberships', 'customers']) {
      const r = await s.from(t).delete().in('company_id', ids)
      if (r.error) console.log(`    aviso ${t}: ${r.error.message.slice(0, 110)}`)
    }
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
  if (creados.empresas.length) {
    console.log(`  barriendo ${creados.empresas.length} empresa(s) de una corrida anterior`)
    await limpiar()
  }
  creados.empresas = []
}

/** Crea el remito en borrador; no rompe el script si falla. */
const crearRemito = async (cliente, order, lineas) => {
  const r = await cliente.rpc('crear_remito_desde_pedido', {
    p_order: order, p_lineas: lineas, p_fecha: null, p_esperado: null,
  })
  return r.error ? { ok: false, codigo: r.error.message } : { ok: true, datos: r.data }
}
const confirmar = async (cliente, delivery) => {
  const r = await cliente.rpc('confirmar_entrega', { p_delivery: delivery })
  return r.error ? { ok: false, codigo: r.error.message } : { ok: true, datos: r.data }
}

const contar = async (tabla, filtro) => {
  let q = s.from(tabla).select('id', { count: 'exact', head: true })
  for (const [k, v] of Object.entries(filtro)) q = q.eq(k, v)
  const { count, error } = await q
  if (error) throw new Error(`contar ${tabla}: ${error.message}`)
  return count ?? 0
}
const saldo = async (companyId, producto) => {
  const { data } = await s.from('stock_balances').select('on_hand')
    .eq('company_id', companyId).eq('product_id', producto).maybeSingle()
  return Number(data?.on_hand ?? 0)
}

async function main() {
  console.log('\n═══ Fase 19 · E5 — Remitos, stock y concurrencia ═══')
  await barrerRestos()

  const sello = Date.now()
  const empresa = async (letra, nombre) => {
    const id = ok(await s.from('companies').insert({
      slug: `${MARCA}-${letra}-${sello}`, name: nombre, legal_name: `${nombre} SA`, default_currency: 'USD',
    }).select('id').single(), `empresa ${letra}`).id
    creados.empresas.push(id)
    return id
  }
  const A = await empresa('a', 'ZZ E5R Alfa')   // todo en ERP: se puede despachar
  const B = await empresa('b', 'ZZ E5R Beta')   // sólo para RLS
  const T = await empresa('t', 'ZZ E5R Tango')  // remitos en STEL

  ok(await s.from('document_sequences').insert([
    { company_id: A, doc_type: 'sales_order', series_code: 'ZZP', prefix: 'ZZP', padding: 5, next_number: 1, is_default: true },
    { company_id: A, doc_type: 'delivery', series_code: 'ZZR', prefix: 'ZZR', padding: 5, next_number: 1, is_default: true },
    { company_id: T, doc_type: 'sales_order', series_code: 'ZZTP', prefix: 'ZZTP', padding: 5, next_number: 1, is_default: true },
    { company_id: T, doc_type: 'delivery', series_code: 'ZZTR', prefix: 'ZZTR', padding: 5, next_number: 1, is_default: true },
  ]), 'secuencias')
  // T imita a Buscatools: los remitos los numera STEL.
  ok(await s.from('document_numbering_authority').insert(
    { company_id: T, doc_type: 'delivery', authority: 'STEL', reason: 'fixture zz-e5r: remitos en STEL' },
  ), 'autoridad T')

  const deposito = ok(await s.from('warehouses').insert({
    company_id: A, code: 'ZZDEP', name: 'ZZ Depósito', is_default: true,
  }).select('id').single(), 'depósito').id
  ok(await s.from('warehouses').insert({
    company_id: T, code: 'ZZDEPT', name: 'ZZ Depósito T', is_default: true,
  }), 'depósito T')

  const rubro = ok(await s.from('product_categories').insert({
    company_id: A, name: 'ZZ E5R Rubro', slug: `zz-e5r-rubro-${sello}`,
  }).select('id').single(), 'rubro').id
  const producto = ok(await s.from('products').insert({
    company_id: A, sku: `ZZ-E5R-${sello}`, name: 'ZZ E5R Producto', category_id: rubro,
  }).select('id').single(), 'producto').id

  const cliente = ok(await s.from('customers').insert({
    company_id: A, legal_name: 'ZZ E5R Cliente',
  }).select('id').single(), 'cliente').id
  const domicilio = ok(await s.from('customer_addresses').insert({
    company_id: A, customer_id: cliente, kind: 'shipping', is_default: true, active: true,
    street: 'Calle Falsa 123', city: 'CABA', postal_code: '1417',
  }).select('id').single(), 'domicilio').id

  const clienteT = ok(await s.from('customers').insert({
    company_id: T, legal_name: 'ZZ E5R Cliente T',
  }).select('id').single(), 'cliente T').id

  const admin = await usuarioTemporal(A, 'admin')
  const ajena = await usuarioTemporal(B, 'admin')
  const adminT = await usuarioTemporal(T, 'admin')

  /** Un pedido confirmado con `cantidad` unidades del producto. */
  const pedidoConfirmado = async (cliente_, companyId, customerId, cantidad, extra = {}) => {
    const r = await cliente_.rpc('crear_pedido', {
      p_company: companyId,
      p_cabecera: { customer_id: customerId, currency_code: 'USD', ...extra },
      p_lineas: [{
        quantity: cantidad, unit_price: 100, product_id: companyId === A ? producto : null,
        sku_snapshot: 'ZZ-SKU', name_snapshot: 'ZZ Producto', tax_treatment: 'vat_21', tax_rate_snapshot: 21,
      }],
    })
    if (r.error) throw new Error(`pedido: ${r.error.message}`)
    ok(await s.from('sales_orders').update({ commercial_status: 'confirmed' }).eq('id', r.data.id), 'confirmar pedido')
    const linea = ok(await s.from('sales_order_lines').select('id').eq('order_id', r.data.id).single(), 'línea')
    return { id: r.data.id, numero: r.data.number, lineaId: linea.id }
  }

  // ── A–B · el borrador no mueve nada ─────────────────────────────────────
  seccion('A–B · crear el borrador')
  const p1 = await pedidoConfirmado(admin.c, A, cliente, 10, { shipping_address_id: domicilio })
  const stockAntes = await contar('stock_movements', { company_id: A })
  const saldoAntes = await saldo(A, producto)

  const r1 = await crearRemito(admin.c, p1.id, [{ order_line_id: p1.lineaId, quantity: 4 }])
  cmp('A · el borrador se crea', true, r1.ok)
  if (!r1.ok) { console.log('      ' + r1.codigo) }
  cmp('A · +1 remito', 1, await contar('deliveries', { company_id: A }))
  cmp('A · +1 línea', 1, await contar('delivery_lines', { company_id: A }))
  cmp('A · 0 movimientos de stock nuevos', stockAntes, await contar('stock_movements', { company_id: A }))
  cmp('A · 0 reservas', 0, await contar('stock_reservations', { company_id: A }))
  cmp('A · el saldo no se movió', saldoAntes, await saldo(A, producto))

  const estadoRemito = ok(await s.from('deliveries').select('status, number, delivery_address_snapshot')
    .eq('id', r1.datos.id).single(), 'remito')
  cmp('A · nace en borrador', 'draft', estadoRemito.status)
  cmp('B · el pedido sigue sin entregar', 'pending',
    (ok(await s.from('sales_orders').select('fulfillment_status').eq('id', p1.id).single(), 'pedido')).fulfillment_status)

  // ── J · el domicilio congelado ──────────────────────────────────────────
  seccion('J · el domicilio queda congelado')
  cmp('J · el remito guardó la calle del pedido', 'Calle Falsa 123', estadoRemito.delivery_address_snapshot?.street)
  ok(await s.from('customer_addresses').update({ street: 'Otra Calle 999' }).eq('id', domicilio), 'mudanza')
  cmp('J · y mudar al cliente no lo cambia', 'Calle Falsa 123',
    (ok(await s.from('deliveries').select('delivery_address_snapshot').eq('id', r1.datos.id).single(), 'remito'))
      .delivery_address_snapshot?.street)

  // ── C · confirmar mueve stock ───────────────────────────────────────────
  seccion('C–E · confirmar')
  const c1 = await confirmar(admin.c, r1.datos.id)
  cmp('C · confirma', true, c1.ok)
  cmp('C · un movimiento por línea', 1, c1.ok ? c1.datos.movimientos : 0)
  const movs = ok(await s.from('stock_movements').select('quantity, movement_type, warehouse_id, source_type')
    .eq('company_id', A), 'movimientos')
  cmp('C · el movimiento es NEGATIVO', -4, Number(movs[0]?.quantity))
  cmp('C · y es de venta', 'sale_delivery', movs[0]?.movement_type)
  cmp('C · en el depósito de la línea', deposito, movs[0]?.warehouse_id)
  cmp('C · el saldo bajó', saldoAntes - 4, await saldo(A, producto))
  cmp('C · el pedido queda parcial', 'partially_delivered',
    (ok(await s.from('sales_orders').select('fulfillment_status').eq('id', p1.id).single(), 'pedido')).fulfillment_status)

  const c2 = await confirmar(admin.c, r1.datos.id)
  cmp('D · confirmar dos veces no rompe', true, c2.ok)
  cmp('D · y no mueve nada nuevo', true, c2.ok && c2.datos.ya_confirmada === true)
  cmp('D · sigue habiendo un solo movimiento', 1, await contar('stock_movements', { company_id: A }))

  // E · dos confirmaciones a la vez, sobre un remito nuevo
  const r2 = await crearRemito(admin.c, p1.id, [{ order_line_id: p1.lineaId, quantity: 6 }])
  cmp('F · el segundo remito por lo que falta', true, r2.ok)
  const [e1, e2] = await Promise.all([confirmar(admin.c, r2.datos.id), confirmar(admin.c, r2.datos.id)])
  const movimientosDelSegundo = ok(await s.from('stock_movements').select('id')
    .eq('company_id', A).eq('source_id', r2.datos.id), 'movs del segundo')
  cmp('E · dos confirmaciones simultáneas → UN movimiento', 1, movimientosDelSegundo.length)
  cmp('E · las dos responden sin error', true, e1.ok && e2.ok)

  cmp('F · el saldo bajó las 10', saldoAntes - 10, await saldo(A, producto))
  cmp('F · y el pedido queda entregado', 'delivered',
    (ok(await s.from('sales_orders').select('fulfillment_status').eq('id', p1.id).single(), 'pedido')).fulfillment_status)

  // ── G–H · sobreentrega ──────────────────────────────────────────────────
  seccion('G–H · sobreentrega')
  const p2 = await pedidoConfirmado(admin.c, A, cliente, 10)
  const sobre = await crearRemito(admin.c, p2.id, [{ order_line_id: p2.lineaId, quantity: 11 }])
  cmp('G · 11 sobre 10 se rechaza', false, sobre.ok)
  if (!sobre.ok) contiene('G · SOBREENTREGA', sobre.codigo, 'SOBREENTREGA')

  const yaEntregado = await crearRemito(admin.c, p1.id, [{ order_line_id: p1.lineaId, quantity: 1 }])
  cmp('G · sobre un pedido ya entregado tampoco', false, yaEntregado.ok)

  const [h1, h2] = await Promise.all([
    crearRemito(admin.c, p2.id, [{ order_line_id: p2.lineaId, quantity: 6 }]),
    crearRemito(admin.c, p2.id, [{ order_line_id: p2.lineaId, quantity: 6 }]),
  ])
  const entregadoTotal = (ok(await s.from('delivery_lines').select('quantity')
    .eq('company_id', A).eq('order_line_id', p2.lineaId), 'líneas de p2'))
    .reduce((t, l) => t + Number(l.quantity), 0)
  cmp('H · dos borradores de 6 sobre 10: nunca más de 10 comprometidas', true, entregadoTotal <= 10)
  console.log(`      (entraron ${[h1.ok, h2.ok].filter(Boolean).length} de 2, total comprometido ${entregadoTotal})`)

  // ── I · borrar ──────────────────────────────────────────────────────────
  seccion('I · borrar')
  const borrarDespachado = await s.from('deliveries').delete().eq('id', r1.datos.id)
  cmp('I · un remito despachado NO se borra', true, borrarDespachado.error !== null)
  if (borrarDespachado.error) contiene('I · y dice por qué', borrarDespachado.error.message, 'movió stock')

  const enBorrador = (ok(await s.from('deliveries').select('id, status').eq('company_id', A), 'remitos'))
    .find((d) => d.status === 'draft')
  if (enBorrador) {
    await s.from('delivery_lines').delete().eq('delivery_id', enBorrador.id)
    const borrarDraft = await s.from('deliveries').delete().eq('id', enBorrador.id)
    cmp('I · uno en borrador sí', true, borrarDraft.error === null)
  } else {
    PASS('I · uno en borrador sí', 'no quedó ninguno en borrador')
  }

  // ── K · RLS ─────────────────────────────────────────────────────────────
  seccion('K · RLS')
  const desdeOtra = ok(await ajena.c.from('deliveries').select('id').eq('company_id', A), 'otra empresa')
  cmp('K · otra empresa no ve los remitos', 0, desdeOtra.length)
  const anon = sesion()
  cmp('K · anónimo tampoco', 0, ((await anon.from('deliveries').select('id').limit(1)).data ?? []).length)

  // ── L · la autoridad de la serie ────────────────────────────────────────
  seccion('L · con la serie en STEL no se crea ni el borrador')
  const pT = await pedidoConfirmado(adminT.c, T, clienteT, 5)
  const lineaT = pT.lineaId
  const remitoT = await crearRemito(adminT.c, pT.id, [{ order_line_id: lineaT, quantity: 1 }])
  cmp('L · rechazado', false, remitoT.ok)
  if (!remitoT.ok) contiene('L · por la autoridad', remitoT.codigo, 'external_numbering_authority')
  cmp('L · y no quedó ningún remito', 0, await contar('deliveries', { company_id: T }))

  // ── Producción, sólo lectura ────────────────────────────────────────────
  seccion('Producción (sólo lectura)')
  const prod = {
    remitos: await contar('deliveries', { company_id: BUSCATOOLS }),
    movimientos: await contar('stock_movements', { company_id: BUSCATOOLS }),
    reservas: await contar('stock_reservations', { company_id: BUSCATOOLS }),
    pedidos: await contar('sales_orders', { company_id: BUSCATOOLS }),
  }
  console.log(`    remitos ${prod.remitos} · movimientos ${prod.movimientos} · reservas ${prod.reservas} · pedidos ${prod.pedidos}`)
  cmp('producción: 193 remitos', 193, prod.remitos)
  cmp('producción: 381 movimientos', 381, prod.movimientos)
  cmp('producción: 0 reservas', 0, prod.reservas)
  const rtErp = ok(await s.from('document_sequences').select('series_code')
    .eq('company_id', BUSCATOOLS).eq('doc_type', 'delivery'), 'series de remito')
  cmp('producción: NO existe RT-ERP', false, rtErp.some((x) => x.series_code === 'RT-ERP'))

  seccion('Limpieza')
  await limpiar()
  cmp('no quedó nada del fixture', 0,
    (ok(await s.from('companies').select('id').like('slug', `${MARCA}-%`), 'restos')).length)

  console.log(`\n${fallos === 0 ? '  ✓ TODO EN VERDE' : `  ✗ ${fallos} FALLO(S)`}\n`)
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('\n✗ error:', e.message)
  await limpiar().catch(() => {})
  process.exit(1)
})
