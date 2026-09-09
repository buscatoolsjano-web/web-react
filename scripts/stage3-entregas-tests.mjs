/**
 * Fase 4 · Stage 3 · entrega 5 — remitos, parciales y stock.
 *
 * El circuito completo con sesión real: pedido 100 → 30 → 40 → 30, sobreentrega
 * rechazada, stock que baja exactamente una vez, reservas que se consumen una
 * vez, doble submit y confirmación concurrente. Todo lo que crea, lo borra.
 *
 *   set -a; source .env; source .env.migration; source .env.rls; set +a
 *   node scripts/stage3-entregas-tests.mjs
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(70)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const cmp = (t, esperado, real) =>
  String(esperado) === String(real) ? PASS(t, String(real))
                                    : FAIL(t, `esperaba ${esperado}, dio ${real}`)

const sesion = () => createClient(URL, PUB, { auth: { persistSession: false } })
const admin = () => createClient(URL, SECRET, { auth: { persistSession: false } })

const peds = []
const ents = []
const reservas = []

const main = async () => {
  const c = sesion()
  const { error: eL } = await c.auth.signInWithPassword({
    email: 'buscatools.jano@gmail.com',
    password: process.env.BT_PW_JANO,
  })
  if (eL) { console.error('✗ login: ' + eL.message); process.exit(1) }

  const { data: mem } = await c.from('company_memberships').select('company_id, companies ( slug )')
  const BT = mem.find((m) => m.companies.slug === 'buscatools').company_id
  const { data: cli } = await c.from('customers').select('id').eq('company_id', BT).limit(1).single()
  const { data: wh } = await c.from('warehouses').select('id').eq('company_id', BT).limit(1).single()
  const { data: saldo } = await c.from('stock_balances')
    .select('product_id, on_hand, reserved').eq('company_id', BT).gt('on_hand', 0).limit(1).single()
  const PROD = saldo.product_id
  const { data: prod } = await c.from('products').select('sku, name').eq('id', PROD).single()

  const s = admin()
  const contar = async (t) => (await s.from(t).select('*', { count: 'exact', head: true })).count
  const seq = async (tipo) => (await s.from('document_sequences').select('next_number')
    .eq('company_id', BT).eq('doc_type', tipo).single()).data.next_number
  const antes = {
    ent: await contar('deliveries'), lin: await contar('delivery_lines'),
    mov: await contar('stock_movements'), res: await contar('stock_reservations'),
    aud: await contar('sales_audit'), ped: await contar('sales_orders'),
    seqP: await seq('sales_order'), seqD: await seq('delivery'),
  }
  const stockDe = async () => {
    const { data } = await s.from('stock_balances')
      .select('on_hand, reserved').eq('company_id', BT).eq('product_id', PROD).single()
    return { on: Number(data.on_hand), res: Number(data.reserved) }
  }
  const stock0 = await stockDe()

  console.log('='.repeat(74))
  console.log('  ENTREGAS · parciales, stock, reservas y concurrencia')
  console.log('='.repeat(74))
  console.log(`  producto de prueba: ${prod.sku} · stock ${stock0.on} · reservado ${stock0.res}`)

  // ── Helpers ─────────────────────────────────────────────────────────────
  const nuevoPedido = async (cantidad) => {
    const { data: numero } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'sales_order' })
    const { data, error } = await c.from('sales_orders').insert({
      company_id: BT, number: numero, series_code: 'PDV', customer_id: cli.id,
      order_date: '2026-09-09', currency_code: 'USD', commercial_status: 'confirmed',
      origin: 'manual',
    }).select('id, number').single()
    if (error) throw new Error('pedido: ' + error.message)
    peds.push(data.id)
    const { data: linea, error: eLin } = await c.from('sales_order_lines').insert({
      company_id: BT, order_id: data.id, line_no: 1, line_type: 'item', product_id: PROD,
      sku_snapshot: prod.sku, name_snapshot: prod.name, quantity_ordered: cantidad,
      unit_price: 100, discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21,
    }).select('id').single()
    if (eLin) throw new Error('línea: ' + eLin.message)
    return { ...data, lineaId: linea.id }
  }

  const nuevaEntrega = async (orderId, lineaId, cantidad) => {
    const { data: numero, error: eN } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'delivery' })
    if (eN) return { error: eN }
    const { data, error } = await c.from('deliveries').insert({
      company_id: BT, number: numero, series_code: 'RT', order_id: orderId,
      customer_id: cli.id, delivery_date: '2026-09-09', currency_code: 'USD', status: 'draft',
    }).select('id, number, series_code').single()
    if (error) return { error }
    ents.push(data.id)
    const { error: eLin } = await c.from('delivery_lines').insert({
      company_id: BT, delivery_id: data.id, order_line_id: lineaId, product_id: PROD,
      sku_snapshot: prod.sku, name_snapshot: prod.name, quantity: cantidad,
      warehouse_id: wh.id, unit_price: 100, discount_pct: 0,
      tax_treatment: 'vat_21', tax_rate_snapshot: 21,
    })
    if (eLin) { await s.from('deliveries').delete().eq('id', data.id); return { error: eLin } }
    return { data }
  }

  const pendienteDe = async (lineaId, pedida) => {
    const { data: es } = await c.from('deliveries').select('id').eq('order_id', peds.at(-1))
      .neq('status', 'cancelled')
    const { data: dl } = await c.from('delivery_lines').select('quantity')
      .eq('order_line_id', lineaId).in('delivery_id', (es ?? []).map((e) => e.id))
    const entregada = (dl ?? []).reduce((n, l) => n + Number(l.quantity), 0)
    return pedida - entregada
  }

  // ── 1 · Pedido 100 → 30 → 40 → 30 ───────────────────────────────────────
  seccion('ENTREGAS PARCIALES — 100 → 30 → 40 → 30')
  const ped = await nuevoPedido(100)
  PASS('pedido de 100 creado', ped.number)

  const e1 = await nuevaEntrega(ped.id, ped.lineaId, 30)
  e1.error ? FAIL('primera entrega de 30', e1.error.message)
           : PASS('primera entrega de 30', `${e1.data.number} · serie ${e1.data.series_code}`)
  cmp('pendiente tras entregar 30', 70, await pendienteDe(ped.lineaId, 100))
  const { data: t1 } = await c.from('deliveries')
    .select('subtotal, tax_amount, total').eq('id', e1.data.id).single()
  cmp('el remito valorizado calcula sus totales', '3000/630/3630',
      [t1.subtotal, t1.tax_amount, t1.total].map(Number).join('/'))

  const e2 = await nuevaEntrega(ped.id, ped.lineaId, 40)
  e2.error ? FAIL('segunda entrega de 40', e2.error.message) : PASS('segunda entrega de 40', e2.data.number)
  cmp('pendiente tras entregar 40 más', 30, await pendienteDe(ped.lineaId, 100))

  // ── 2 · Sobreentrega ────────────────────────────────────────────────────
  seccion('SOBREENTREGA')
  const eX = await nuevaEntrega(ped.id, ped.lineaId, 31)
  eX.error ? PASS('entregar 31 sobre un pendiente de 30 es rechazado', eX.error.code ?? '')
           : FAIL('se aceptó una sobreentrega')

  const e3 = await nuevaEntrega(ped.id, ped.lineaId, 30)
  e3.error ? FAIL('entrega final de 30', e3.error.message) : PASS('entrega final de 30', e3.data.number)
  cmp('pendiente final', 0, await pendienteDe(ped.lineaId, 100))

  const eY = await nuevaEntrega(ped.id, ped.lineaId, 1)
  eY.error ? PASS('con el pedido completo, una entrega más se rechaza', eY.error.code ?? '')
           : FAIL('se entregó de más sobre un pedido completo')

  // ── 3 · Línea de OTRO pedido ────────────────────────────────────────────
  seccion('INTEGRIDAD')
  const otro = await nuevoPedido(5)
  const { data: numeroX } = await c.rpc('next_document_number', { p_company: BT, p_doc_type: 'delivery' })
  const { data: entMix } = await c.from('deliveries').insert({
    company_id: BT, number: numeroX, series_code: 'RT', order_id: otro.id,
    customer_id: cli.id, delivery_date: '2026-09-09', status: 'draft',
  }).select('id').single()
  ents.push(entMix.id)
  // La línea apunta a la línea del PRIMER pedido, que ya está completo.
  const { error: eMix } = await c.from('delivery_lines').insert({
    company_id: BT, delivery_id: entMix.id, order_line_id: ped.lineaId, product_id: PROD,
    quantity: 1, warehouse_id: wh.id, unit_price: 100, discount_pct: 0,
    tax_treatment: 'vat_21', tax_rate_snapshot: 21,
  })
  eMix ? PASS('no se puede entregar contra la línea de otro pedido ya completo', eMix.code)
       : FAIL('se entregó contra una línea ajena al remito')

  // ── 4 · Reserva ─────────────────────────────────────────────────────────
  seccion('RESERVAS')
  const { data: reserva, error: eR } = await c.from('stock_reservations').insert({
    company_id: BT, product_id: PROD, warehouse_id: wh.id, quantity: 30,
    source_type: 'sales_order', source_id: ped.id, notes: 'prueba',
  }).select('id').single()
  if (eR) FAIL('crear reserva', eR.message)
  else { reservas.push(reserva.id); PASS('reserva de 30 creada sobre el pedido') }
  const stockConReserva = await stockDe()
  cmp('el saldo reservado sube', stock0.res + 30, stockConReserva.res)

  // ── 5 · Confirmar: stock baja UNA vez ───────────────────────────────────
  seccion('CONFIRMACIÓN — el stock baja exactamente una vez')
  const movAntes = await contar('stock_movements')
  const r1 = await c.rpc('confirmar_entrega', { p_delivery: e1.data.id })
  r1.error ? FAIL('confirmar', r1.error.message)
           : PASS('remito despachado', `${r1.data.movimientos} movimiento(s), ${r1.data.reservas_liberadas} reserva(s)`)
  const stockTras1 = await stockDe()
  cmp('on_hand baja 30', stock0.on - 30, stockTras1.on)
  cmp('reserved vuelve a su valor original', stock0.res, stockTras1.res)
  cmp('se generó UN movimiento', movAntes + 1, await contar('stock_movements'))

  // Doble submit / reintento.
  const r2 = await c.rpc('confirmar_entrega', { p_delivery: e1.data.id })
  r2.data?.ya_confirmada === true
    ? PASS('confirmar de nuevo no repite nada', 'ya_confirmada')
    : FAIL('la segunda confirmación no fue idempotente', JSON.stringify(r2.data ?? r2.error))
  cmp('sigue habiendo UN solo movimiento', movAntes + 1, await contar('stock_movements'))
  cmp('el stock no bajó dos veces', stock0.on - 30, (await stockDe()).on)

  // Dos pestañas confirmando a la vez.
  const movAntes2 = await contar('stock_movements')
  const paralelo = await Promise.all([
    c.rpc('confirmar_entrega', { p_delivery: e2.data.id }),
    c.rpc('confirmar_entrega', { p_delivery: e2.data.id }),
  ])
  const hicieron = paralelo.filter((r) => r.data && r.data.ya_confirmada === false).length
  cmp('de dos confirmaciones simultáneas, sólo una actúa', 1, hicieron)
  cmp('y generó UN solo movimiento', movAntes2 + 1, await contar('stock_movements'))
  cmp('on_hand bajó 40 más', stock0.on - 70, (await stockDe()).on)

  // ── 6 · Estado de cumplimiento derivado ─────────────────────────────────
  seccion('ESTADO DEL PEDIDO')
  const cumplimiento = async () => (await c.from('sales_orders')
    .select('fulfillment_status').eq('id', ped.id).single()).data.fulfillment_status
  cmp('con 70 de 100 entregadas', 'partially_delivered', await cumplimiento())
  await c.rpc('confirmar_entrega', { p_delivery: e3.data.id })
  cmp('con las 100 entregadas', 'delivered', await cumplimiento())
  cmp('on_hand bajó las 100', stock0.on - 100, (await stockDe()).on)

  // ── 7 · Serie ───────────────────────────────────────────────────────────
  seccion('SERIE')
  const { data: series } = await c.from('deliveries').select('series_code').in('id', ents)
  series.every((x) => x.series_code === 'RT')
    ? PASS('las entregas nuevas salen en serie RT')
    : FAIL('alguna entrega salió en otra serie', JSON.stringify(series))
  const rML = await c.rpc('next_document_number',
    { p_company: BT, p_doc_type: 'delivery', p_series: 'RT-ML' })
  rML.error ? PASS('RT-ML no es emitible desde la web', rML.error.code)
            : FAIL('se emitió un número RT-ML', String(rML.data))

  // ── 8 · Auditoría ───────────────────────────────────────────────────────
  seccion('AUDITORÍA')
  const { data: ev } = await c.from('sales_audit')
    .select('action').eq('entity_id', e1.data.id).order('id')
  const acciones = ev.map((x) => x.action)
  acciones.includes('shipped') && acciones.includes('stock_consumed') &&
    acciones.includes('reservation_released')
    ? PASS('se registran las acciones de negocio', acciones.join(' · '))
    : FAIL('acciones registradas', acciones.join(' · '))
  const { count: evTras } = await c.from('sales_audit')
    .select('*', { count: 'exact', head: true }).eq('entity_id', e1.data.id)
  await c.from('deliveries').update({ notes: 'nota técnica' }).eq('id', e1.data.id)
  const { count: evDespues } = await c.from('sales_audit')
    .select('*', { count: 'exact', head: true }).eq('entity_id', e1.data.id)
  cmp('un UPDATE técnico no genera auditoría', evTras, evDespues)

  // ── 9 · Histórico intacto ───────────────────────────────────────────────
  seccion('HISTÓRICO')
  const { data: h1 } = await c.from('deliveries')
    .select('subtotal, tax_amount, total').eq('original_number', 'RT0000001406').single()
  const hAntes = [h1.subtotal, h1.tax_amount, h1.total].join('/')
  await c.from('deliveries').update({ notes: 'toque' }).eq('original_number', 'RT0000001406')
  const { data: h2 } = await c.from('deliveries')
    .select('subtotal, tax_amount, total').eq('original_number', 'RT0000001406').single()
  cmp('un remito histórico NO se recalcula', hAntes, [h2.subtotal, h2.tax_amount, h2.total].join('/'))
  await s.from('deliveries').update({ notes: null }).eq('original_number', 'RT0000001406')

  await c.auth.signOut()

  // ── 10 · RLS ────────────────────────────────────────────────────────────
  seccion('RLS')
  for (const [rol, email] of [
    ['CUSTOMER', 'cliente.test@buscatools.com.ar'],
    ['DISTRIBUTOR', 'distribuidor.test@buscatools.com.ar'],
  ]) {
    const e = sesion()
    const { error } = await e.auth.signInWithPassword({ email, password: process.env.BT_PW_TEST })
    if (error) { FAIL(`login ${rol}`, error.message); continue }
    const a = await e.from('deliveries').insert({
      company_id: BT, number: 'ZZ-' + Date.now(), customer_id: cli.id,
      delivery_date: '2026-09-09',
    }).select('id')
    a.error ? PASS(`${rol} NO puede crear un remito`, a.error.code) : FAIL(`${rol} creó un remito`)
    const b = await e.rpc('confirmar_entrega', { p_delivery: e3.data.id })
    b.error ? PASS(`${rol} NO puede confirmar`, b.error.code) : FAIL(`${rol} confirmó un remito`)
    const d = await e.from('stock_movements').insert({
      company_id: BT, product_id: PROD, warehouse_id: wh.id,
      movement_type: 'adjustment', quantity: -1, source_type: 'hack',
    }).select('id')
    d.error ? PASS(`${rol} NO puede mover stock`, d.error.code) : FAIL(`${rol} movió stock`)
    const f = await e.rpc('next_document_number', { p_company: BT, p_doc_type: 'delivery' })
    f.error ? PASS(`${rol} NO puede numerar`, f.error.code) : FAIL(`${rol} obtuvo un número`)
    const { data: mios } = await e.from('company_memberships').select('customer_id')
    const propios = new Set((mios ?? []).map((m) => m.customer_id).filter(Boolean))
    const { data: ve, count } = await e.from('deliveries').select('customer_id', { count: 'exact' })
    const ajenos = (ve ?? []).filter((r) => !propios.has(r.customer_id)).length
    count < antes.ent && ajenos === 0
      ? PASS(`${rol} sólo ve las suyas`, `${count} de ${antes.ent}, 0 ajenas`)
      : FAIL(`${rol} ve entregas ajenas`, `${count} de ${antes.ent}, ${ajenos} ajenas`)
    await e.auth.signOut()
  }
  const anon = sesion()
  const ran = await anon.rpc('confirmar_entrega', { p_delivery: e3.data.id })
  ran.error ? PASS('anon NO puede confirmar', ran.error.code) : FAIL('anon confirmó')

  // ── 11 · Limpieza ───────────────────────────────────────────────────────
  seccion('LIMPIEZA')
  // Los movimientos se compensan: borrarlos NO revierte el saldo, porque el
  // trigger es AFTER INSERT. Es la advertencia de la sección 9 del diseño.
  const { data: movs } = await s.from('stock_movements')
    .select('id, product_id, warehouse_id, quantity').in('source_id', ents)
  for (const m of movs ?? []) {
    await s.from('stock_movements').insert({
      company_id: BT, product_id: m.product_id, warehouse_id: m.warehouse_id,
      movement_type: 'adjustment', quantity: -Number(m.quantity),
      source_type: 'test', notes: 'compensación de limpieza',
    })
  }
  const { data: compens } = await s.from('stock_movements')
    .select('id').eq('source_type', 'test').eq('notes', 'compensación de limpieza')
  await s.from('stock_movements').delete().in('id', (compens ?? []).map((x) => x.id))
  await s.from('stock_movements').delete().in('source_id', ents)

  await s.from('stock_reservations').delete().in('id', reservas)
  await s.from('sales_audit').delete().in('entity_id', [...ents, ...peds])
  await s.from('delivery_lines').delete().in('delivery_id', ents)
  await s.from('deliveries').delete().in('id', ents)
  await s.from('sales_orders').update({ commercial_status: 'draft' }).in('id', peds)
  await s.from('sales_order_lines').delete().in('order_id', peds)
  await s.from('sales_orders').delete().in('id', peds)
  await s.from('document_sequences').update({ next_number: antes.seqP })
    .eq('company_id', BT).eq('doc_type', 'sales_order').eq('series_code', 'PDV')
  await s.from('document_sequences').update({ next_number: antes.seqD })
    .eq('company_id', BT).eq('doc_type', 'delivery').eq('series_code', 'RT')

  const fin = {
    ent: await contar('deliveries'), lin: await contar('delivery_lines'),
    mov: await contar('stock_movements'), res: await contar('stock_reservations'),
    aud: await contar('sales_audit'), ped: await contar('sales_orders'),
    seqP: await seq('sales_order'), seqD: await seq('delivery'),
  }
  for (const k of Object.keys(antes)) cmp(`${k} vuelve a su estado previo`, antes[k], fin[k])
  const stockFin = await stockDe()
  cmp('on_hand vuelve a su valor original', stock0.on, stockFin.on)
  cmp('reserved vuelve a su valor original', stock0.res, stockFin.res)

  console.log(`\n${'='.repeat(74)}\n  RESULTADO: ${fallos} fallo(s)\n${'='.repeat(74)}`)
  process.exit(fallos ? 1 : 0)
}

main().catch(async (e) => {
  console.error('✗ ' + e.message)
  try {
    const s = admin()
    await s.from('stock_movements').delete().in('source_id', ents)
    await s.from('stock_reservations').delete().in('id', reservas)
    await s.from('sales_audit').delete().in('entity_id', [...ents, ...peds])
    await s.from('delivery_lines').delete().in('delivery_id', ents)
    await s.from('deliveries').delete().in('id', ents)
    await s.from('sales_orders').update({ commercial_status: 'draft' }).in('id', peds)
    await s.from('sales_order_lines').delete().in('order_id', peds)
    await s.from('sales_orders').delete().in('id', peds)
    console.error(`  (se limpiaron ${ents.length} entregas y ${peds.length} pedidos)`)
  } catch { /* nada que hacer */ }
  process.exit(1)
})
