/**
 * Fase 4 · Stage 3 · entrega 4 — pedidos y conversión desde cotización.
 *
 * Hace lo mismo que la pantalla, con sesión real. Todo lo que crea, lo borra.
 *
 *   set -a; source .env; source .env.migration; source .env.rls; set +a
 *   node scripts/stage3-pedidos-tests.mjs
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

const cots = []
const peds = []

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
  // Un producto CON saldo, para que el panel de stock tenga algo que mostrar.
  const { data: conSaldo } = await c.from('stock_balances')
    .select('product_id').eq('company_id', BT).gt('on_hand', 0).limit(1).maybeSingle()
  const { data: prod } = await c.from('products')
    .select('id, sku, name').eq('company_id', BT)
    .eq('id', conSaldo?.product_id ?? '00000000-0000-0000-0000-000000000000')
    .maybeSingle()
    .then(async (r) => r.data ? r : await c.from('products')
      .select('id, sku, name').eq('company_id', BT).order('sku').limit(1).single())

  const s = admin()
  const estadoPrevio = async () => ({
    cot: (await s.from('sales_quotes').select('*', { count: 'exact', head: true })).count,
    ped: (await s.from('sales_orders').select('*', { count: 'exact', head: true })).count,
    aud: (await s.from('sales_audit').select('*', { count: 'exact', head: true })).count,
    mov: (await s.from('stock_movements').select('*', { count: 'exact', head: true })).count,
    res: (await s.from('stock_reservations').select('*', { count: 'exact', head: true })).count,
    seqQ: (await s.from('document_sequences').select('next_number')
      .eq('company_id', BT).eq('doc_type', 'quote').single()).data.next_number,
    seqP: (await s.from('document_sequences').select('next_number')
      .eq('company_id', BT).eq('doc_type', 'sales_order').single()).data.next_number,
  })
  const antes = await estadoPrevio()

  console.log('='.repeat(74))
  console.log('  PEDIDOS · manual, desde cotización, estados y stock')
  console.log('='.repeat(74))

  // ── Helpers ─────────────────────────────────────────────────────────────
  const nuevaCot = async (moneda = 'USD', extra = {}) => {
    const { data: numero } = await c.rpc('next_document_number', { p_company: BT, p_doc_type: 'quote' })
    const { data, error } = await c.from('sales_quotes').insert({
      company_id: BT, number: numero, series_code: 'COTI', customer_id: cli.id,
      quote_date: '2026-09-09', currency_code: moneda, status: 'draft', ...extra,
    }).select('id, number').single()
    if (error) throw new Error('cot: ' + error.message)
    cots.push(data.id)
    return data
  }
  const nuevoPed = async (extra = {}) => {
    const { data: numero, error: eN } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'sales_order' })
    if (eN) throw new Error('numeración: ' + eN.message)
    const { data, error } = await c.from('sales_orders').insert({
      company_id: BT, number: numero, series_code: 'PDV', customer_id: cli.id,
      order_date: '2026-09-09', currency_code: 'USD', commercial_status: 'draft',
      origin: 'manual', ...extra,
    }).select('id, number').single()
    if (error) throw new Error('ped: ' + error.message)
    peds.push(data.id)
    await c.rpc('registrar_evento_venta',
      { p_entity_type: 'sales_order', p_entity_id: data.id, p_action: 'created', p_to_status: 'draft' })
    return data
  }
  const totales = async (tabla, id) => {
    const { data } = await c.from(tabla).select('subtotal, tax_amount, total').eq('id', id).single()
    return [data.subtotal, data.tax_amount, data.total].map(Number).join('/')
  }

  // ── 1 · Pedido manual ───────────────────────────────────────────────────
  seccion('PEDIDO MANUAL')
  const p1 = await nuevoPed()
  const formatoOk = /^PDV\d{5}$/.test(p1.number)
  formatoOk ? PASS('el número vino del servidor', p1.number)
            : FAIL('formato de número', p1.number)

  const { error: e1 } = await c.from('sales_order_lines').insert({
    company_id: BT, order_id: p1.id, line_no: 1, line_type: 'item',
    product_id: prod.id, sku_snapshot: prod.sku, name_snapshot: prod.name,
    quantity_ordered: 10, unit_price: 100, discount_pct: 0,
    tax_treatment: 'vat_21', tax_rate_snapshot: 21,
  })
  e1 ? FAIL('línea de catálogo', e1.message) : PASS('línea de producto del catálogo', prod.sku)
  cmp('totales calculados por el servidor', '1000/210/1210', await totales('sales_orders', p1.id))

  await c.from('sales_order_lines').insert({
    company_id: BT, order_id: p1.id, line_no: 2, line_type: 'chapter',
    name_snapshot: 'Accesorios', quantity_ordered: 1, unit_price: 0,
    discount_pct: 0, tax_treatment: 'not_taxed', tax_rate_snapshot: 0,
  })
  cmp('el capítulo NO suma', '1000/210/1210', await totales('sales_orders', p1.id))

  await c.from('sales_order_lines').insert({
    company_id: BT, order_id: p1.id, line_no: 3, line_type: 'item',
    sku_snapshot: 'FLETE', name_snapshot: 'Flete', quantity_ordered: 1, unit_price: 200,
    discount_pct: 0, tax_treatment: 'not_taxed', tax_rate_snapshot: 0,
  })
  cmp('línea libre', '1200/210/1410', await totales('sales_orders', p1.id))

  await c.from('sales_orders').update({ discount_pct: 10, perception_pct: 2.5 }).eq('id', p1.id)
  cmp('descuento global y percepción', '1080/216/1296', await totales('sales_orders', p1.id))

  await c.from('sales_orders').update({ total: 1 }).eq('id', p1.id)
  cmp('un total mandado desde el cliente se ignora', '1080/216/1296', await totales('sales_orders', p1.id))

  // ── 2 · Conversión desde cotización ─────────────────────────────────────
  seccion('COTIZACIÓN → PEDIDO')
  const q1 = await nuevaCot('ARS', { exchange_rate: 1450, discount_pct: 5, perception_pct: 2.5 })
  await c.from('sales_quote_lines').insert([
    { company_id: BT, quote_id: q1.id, line_no: 1, line_type: 'item', product_id: prod.id,
      sku_snapshot: prod.sku, name_snapshot: prod.name, quantity: 4, unit_price: 2500,
      discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21 },
    { company_id: BT, quote_id: q1.id, line_no: 2, line_type: 'chapter',
      name_snapshot: 'Servicios', quantity: 1, unit_price: 0, discount_pct: 0,
      tax_treatment: 'not_taxed', tax_rate_snapshot: 0 },
    { company_id: BT, quote_id: q1.id, line_no: 3, line_type: 'item', sku_snapshot: 'INSTAL',
      name_snapshot: 'Instalación', quantity: 1, unit_price: 1000, discount_pct: 20,
      tax_treatment: 'not_taxed', tax_rate_snapshot: 0 },
  ])
  const totalCot = await totales('sales_quotes', q1.id)

  // La conversión, tal como la hace el service.
  const convertir = async (quoteId) => {
    const { data: cot } = await c.from('sales_quotes')
      .select(`id, customer_id, contact_id, title, currency_code, exchange_rate,
               payment_terms, notes, discount_pct, perception_pct, status`)
      .eq('company_id', BT).eq('id', quoteId).maybeSingle()
    const { data: ls } = await c.from('sales_quote_lines')
      .select(`line_no, line_type, product_id, sku_snapshot, name_snapshot,
               description_snapshot, quantity, unit_price, list_price_snapshot,
               discount_pct, tax_treatment, tax_rate_snapshot`)
      .eq('company_id', BT).eq('quote_id', quoteId).order('line_no')
    const { data: numero } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'sales_order' })
    const { data: ped, error } = await c.from('sales_orders').insert({
      company_id: BT, number: numero, series_code: 'PDV', customer_id: cot.customer_id,
      contact_id: cot.contact_id, quote_id: quoteId, origin: 'quote', title: cot.title,
      order_date: '2026-09-09', currency_code: cot.currency_code,
      exchange_rate: cot.exchange_rate, payment_terms: cot.payment_terms, notes: cot.notes,
      discount_pct: cot.discount_pct, perception_pct: cot.perception_pct,
      commercial_status: 'draft',
    }).select('id, number').single()
    if (error) return { error }
    peds.push(ped.id)
    await c.from('sales_order_lines').insert(ls.map((l, i) => ({
      company_id: BT, order_id: ped.id, line_no: i + 1, line_type: l.line_type,
      product_id: l.product_id, sku_snapshot: l.sku_snapshot, name_snapshot: l.name_snapshot,
      description_snapshot: l.description_snapshot, quantity_ordered: l.quantity,
      unit_price: l.unit_price, list_price_snapshot: l.list_price_snapshot,
      discount_pct: l.discount_pct, tax_treatment: l.tax_treatment,
      tax_rate_snapshot: l.tax_rate_snapshot,
    })))
    await c.rpc('registrar_evento_venta',
      { p_entity_type: 'sales_order', p_entity_id: ped.id, p_action: 'created', p_to_status: 'draft' })
    return { data: ped }
  }

  const { data: p2, error: eConv } = await convertir(q1.id)
  eConv ? FAIL('convertir', eConv.message) : PASS('pedido generado desde la cotización', p2.number)

  const { data: dp2 } = await c.from('sales_orders')
    .select('quote_id, origin, currency_code, exchange_rate, discount_pct, perception_pct, customer_id')
    .eq('id', p2.id).single()
  cmp('quote_id apunta a la cotización', q1.id, dp2.quote_id)
  cmp('origin = quote', 'quote', dp2.origin)
  cmp('la moneda se copia', 'ARS', dp2.currency_code)
  cmp('el tipo de cambio se copia', 1450, Number(dp2.exchange_rate))
  cmp('el descuento global se copia', 5, Number(dp2.discount_pct))
  cmp('el cliente es el mismo', cli.id, dp2.customer_id)
  cmp('los totales coinciden con la cotización', totalCot, await totales('sales_orders', p2.id))

  const { data: lp } = await c.from('sales_order_lines')
    .select('line_no, line_type, product_id, sku_snapshot, name_snapshot, quantity_ordered, unit_price, discount_pct, tax_rate_snapshot')
    .eq('order_id', p2.id).order('line_no')
  cmp('se copiaron las 3 líneas', 3, lp.length)
  const l1 = lp[0]
  l1.product_id === prod.id && l1.sku_snapshot === prod.sku &&
    Number(l1.quantity_ordered) === 4 && Number(l1.unit_price) === 2500 &&
    Number(l1.tax_rate_snapshot) === 21
    ? PASS('el snapshot de la línea es idéntico', `${l1.sku_snapshot} ${l1.quantity_ordered}×${l1.unit_price}`)
    : FAIL('snapshot de la línea', JSON.stringify(l1))
  lp[1].line_type === 'chapter'
    ? PASS('el capítulo se copia como capítulo')
    : FAIL('el capítulo', lp[1].line_type)
  Number(lp[2].discount_pct) === 20
    ? PASS('el descuento de línea se copia', '20 %')
    : FAIL('descuento de línea', String(lp[2].discount_pct))

  // La cotización original NO se toca.
  const { data: cotDespues } = await c.from('sales_quotes')
    .select('status, total, subtotal').eq('id', q1.id).single()
  cotDespues.status === 'draft' && [cotDespues.subtotal, null, cotDespues.total]
    ? PASS('la cotización original no se modificó', `status ${cotDespues.status}`)
    : FAIL('la cotización cambió', JSON.stringify(cotDespues))

  // ── 3 · No se convierte dos veces ───────────────────────────────────────
  seccion('UNA COTIZACIÓN, UN PEDIDO')
  const r2 = await convertir(q1.id)
  r2.error && r2.error.code === '23505'
    ? PASS('convertir dos veces la misma cotización es rechazado', r2.error.code)
    : FAIL('se creó un segundo pedido para la misma cotización')

  // Dos conversiones SIMULTÁNEAS de cotizaciones distintas.
  const qa = await nuevaCot()
  const qb = await nuevaCot()
  for (const q of [qa, qb]) {
    await c.from('sales_quote_lines').insert({
      company_id: BT, quote_id: q.id, line_no: 1, line_type: 'item',
      sku_snapshot: 'X', name_snapshot: 'X', quantity: 1, unit_price: 10,
      discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21,
    })
  }
  const paralelas = await Promise.all([convertir(qa.id), convertir(qb.id)])
  const okParalelas = paralelas.filter((r) => !r.error)
  cmp('dos conversiones simultáneas crean dos pedidos', 2, okParalelas.length)
  const nums = okParalelas.map((r) => r.data.number)
  new Set(nums).size === 2
    ? PASS('con números distintos', nums.join(' · '))
    : FAIL('números repetidos', nums.join(' · '))

  // Y dos conversiones simultáneas de LA MISMA cotización dejan una sola.
  const qc = await nuevaCot()
  await c.from('sales_quote_lines').insert({
    company_id: BT, quote_id: qc.id, line_no: 1, line_type: 'item',
    sku_snapshot: 'Y', name_snapshot: 'Y', quantity: 1, unit_price: 10,
    discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21,
  })
  const choque = await Promise.all([convertir(qc.id), convertir(qc.id)])
  const ganaron = choque.filter((r) => !r.error).length
  cmp('dos pestañas convirtiendo a la vez dejan UN pedido', 1, ganaron)

  // ── 4 · Estados y bloqueo ───────────────────────────────────────────────
  seccion('ESTADOS')
  await c.from('sales_orders').update({ commercial_status: 'confirmed' }).eq('id', p1.id)
  const { error: e5 } = await c.from('sales_order_lines')
    .update({ unit_price: 90 }).eq('order_id', p1.id).eq('line_no', 1)
  e5 ? FAIL('editar un confirmado sin entregas', e5.message)
     : PASS('un pedido confirmado sin entregas todavía se edita')

  // Con una entrega, las líneas se congelan.
  const { data: wh } = await c.from('warehouses').select('id').eq('company_id', BT).limit(1).single()
  const { data: numeroRT } = await c.rpc('next_document_number',
    { p_company: BT, p_doc_type: 'delivery' })
  const { data: ent, error: eEnt } = await c.from('deliveries').insert({
    company_id: BT, number: numeroRT, series_code: 'RT', order_id: p1.id,
    customer_id: cli.id, delivery_date: '2026-09-09', status: 'draft',
  }).select('id').single()
  if (eEnt) FAIL('crear entrega de prueba', eEnt.message)
  const { error: e6 } = await c.from('sales_order_lines')
    .update({ unit_price: 80 }).eq('order_id', p1.id).eq('line_no', 1)
  e6 ? PASS('con entregas, las líneas del pedido se congelan', e6.code)
     : FAIL('se editó una línea de un pedido con entregas')
  await s.from('deliveries').delete().eq('id', ent.id)
  await s.from('document_sequences').update({ next_number: Number(numeroRT.replace('RT', '')) })
    .eq('company_id', BT).eq('doc_type', 'delivery').eq('series_code', 'RT')

  await c.from('sales_orders').update({ commercial_status: 'cancelled' }).eq('id', p1.id)
  const { error: e7 } = await c.from('sales_orders').update({ total: 1 }).eq('id', p1.id)
  e7 ? PASS('un pedido cancelado NO se modifica', e7.code) : FAIL('se modificó un cancelado')
  const { error: e8 } = await c.from('sales_order_lines')
    .update({ unit_price: 1 }).eq('order_id', p1.id).eq('line_no', 1)
  e8 ? PASS('tampoco sus líneas', e8.code) : FAIL('se modificó una línea de un cancelado')

  // ── 5 · Stock: leer no es reservar ──────────────────────────────────────
  seccion('STOCK — el pedido no lo altera')
  const ahora = await estadoPrevio()
  cmp('stock_movements sin cambios', antes.mov, ahora.mov)
  cmp('stock_reservations sin cambios', antes.res, ahora.res)
  const { data: saldos, error: eS } = await c.from('stock_balances')
    .select('product_id, on_hand, reserved').eq('company_id', BT).eq('product_id', prod.id)
  eS ? FAIL('leer stock', eS.message)
     : PASS('el interno puede leer la disponibilidad', `${saldos.length} depósito(s)`)

  // ── 6 · Histórico intacto ───────────────────────────────────────────────
  seccion('HISTÓRICO')
  const { data: hist } = await c.from('sales_orders')
    .select('subtotal, tax_amount, total, imported_at')
    .eq('company_id', BT).eq('original_number', 'PDV01295').maybeSingle()
  const antesHist = [hist.subtotal, hist.tax_amount, hist.total].join('/')
  await c.from('sales_orders').update({ notes: 'toque técnico' }).eq('original_number', 'PDV01295')
  const { data: hist2 } = await c.from('sales_orders')
    .select('subtotal, tax_amount, total').eq('company_id', BT)
    .eq('original_number', 'PDV01295').maybeSingle()
  cmp('un pedido histórico NO se recalcula', antesHist,
      [hist2.subtotal, hist2.tax_amount, hist2.total].join('/'))
  await s.from('sales_orders').update({ notes: null }).eq('original_number', 'PDV01295')

  await c.auth.signOut()

  // ── 7 · RLS ─────────────────────────────────────────────────────────────
  seccion('RLS')
  for (const [rol, email] of [
    ['CUSTOMER', 'cliente.test@buscatools.com.ar'],
    ['DISTRIBUTOR', 'distribuidor.test@buscatools.com.ar'],
  ]) {
    const e = sesion()
    const { error } = await e.auth.signInWithPassword({ email, password: process.env.BT_PW_TEST })
    if (error) { FAIL(`login ${rol}`, error.message); continue }
    const r1 = await e.from('sales_orders').insert({
      company_id: BT, number: 'ZZ-HACK-' + Date.now(), customer_id: cli.id,
      order_date: '2026-09-09', currency_code: 'USD',
    }).select('id')
    r1.error ? PASS(`${rol} NO puede crear un pedido`, r1.error.code)
             : FAIL(`${rol} creó un pedido`)
    const r2b = await e.from('sales_orders').update({ title: 'x' }).eq('id', p2.id).select('id')
    !r2b.error && r2b.data?.length === 0
      ? PASS(`${rol} NO puede editar un pedido ajeno`, 'RLS filtró todo')
      : r2b.error ? PASS(`${rol} NO puede editar un pedido ajeno`, r2b.error.code)
                  : FAIL(`${rol} editó un pedido ajeno`)
    const r3 = await e.rpc('next_document_number', { p_company: BT, p_doc_type: 'sales_order' })
    r3.error ? PASS(`${rol} NO puede numerar`, r3.error.code) : FAIL(`${rol} obtuvo un número`)
    const r4 = await e.from('stock_balances').select('on_hand').limit(1)
    !r4.error && (r4.data?.length ?? 0) === 0
      ? PASS(`${rol} NO ve el stock`, 'RLS filtró todo')
      : r4.error ? PASS(`${rol} NO ve el stock`, r4.error.code) : FAIL(`${rol} vio el stock`)
    // No alcanza con que vea MENOS: hay que comprobar que cada fila es suya.
    const { data: mios } = await e.from('company_memberships').select('customer_id')
    const propios = new Set((mios ?? []).map((m) => m.customer_id).filter(Boolean))
    const { data: ve, count } = await e.from('sales_orders').select('customer_id', { count: 'exact' })
    const ajenos = (ve ?? []).filter((r) => !propios.has(r.customer_id)).length
    count < antes.ped && ajenos === 0
      ? PASS(`${rol} sólo ve los suyos`, `${count} de ${antes.ped}, 0 ajenos`)
      : FAIL(`${rol} ve pedidos ajenos`, `${count} de ${antes.ped}, ${ajenos} ajenos`)
    await e.auth.signOut()
  }
  const anon = sesion()
  const ra = await anon.from('sales_orders').insert({
    company_id: BT, number: 'ZZ-ANON', customer_id: cli.id,
    order_date: '2026-09-09', currency_code: 'USD',
  }).select('id')
  ra.error ? PASS('anon NO puede crear', ra.error.code) : FAIL('anon creó un pedido')

  // ── 8 · Limpieza ────────────────────────────────────────────────────────
  seccion('LIMPIEZA')
  await s.from('sales_audit').delete().in('entity_id', [...cots, ...peds])
  await s.from('sales_orders').update({ commercial_status: 'draft' }).in('id', peds)
  await s.from('sales_order_lines').delete().in('order_id', peds)
  await s.from('sales_orders').delete().in('id', peds)
  await s.from('sales_quotes').update({ status: 'draft' }).in('id', cots)
  await s.from('sales_quote_lines').delete().in('quote_id', cots)
  await s.from('sales_quotes').delete().in('id', cots)
  await s.from('document_sequences').update({ next_number: antes.seqQ })
    .eq('company_id', BT).eq('doc_type', 'quote').eq('series_code', 'COTI')
  await s.from('document_sequences').update({ next_number: antes.seqP })
    .eq('company_id', BT).eq('doc_type', 'sales_order').eq('series_code', 'PDV')

  const fin = await estadoPrevio()
  for (const k of ['cot', 'ped', 'aud', 'mov', 'res', 'seqQ', 'seqP']) {
    cmp(`${k} vuelve a su estado previo`, antes[k], fin[k])
  }

  console.log(`\n${'='.repeat(74)}\n  RESULTADO: ${fallos} fallo(s)\n${'='.repeat(74)}`)
  process.exit(fallos ? 1 : 0)
}

main().catch(async (e) => {
  console.error('✗ ' + e.message)
  try {
    const s = admin()
    await s.from('sales_audit').delete().in('entity_id', [...cots, ...peds])
    await s.from('sales_orders').update({ commercial_status: 'draft' }).in('id', peds)
    await s.from('sales_order_lines').delete().in('order_id', peds)
    await s.from('sales_orders').delete().in('id', peds)
    await s.from('sales_quotes').update({ status: 'draft' }).in('id', cots)
    await s.from('sales_quote_lines').delete().in('quote_id', cots)
    await s.from('sales_quotes').delete().in('id', cots)
    console.error(`  (se limpiaron ${cots.length} cotizaciones y ${peds.length} pedidos)`)
  } catch { /* nada que hacer */ }
  process.exit(1)
})
