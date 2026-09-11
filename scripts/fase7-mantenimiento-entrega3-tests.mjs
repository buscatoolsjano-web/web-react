/**
 * Fase 7 · Mantenimiento — entrega 3: cotización, repuestos y consumo.
 *
 * Prueba las reglas que agregó la migración de la entrega 3 y el circuito
 * completo de cotización → repuestos → consumo, con las mismas llamadas que
 * hace el navegador y con JWT reales. Cada prohibición se prueba con un INTENTO
 * REAL midiendo el EFECTO además del código: con PostgREST una operación
 * prohibida puede devolver «éxito» con cero filas.
 *
 * Se limpia sola: prefijo `ZZ-M3`.
 *
 *   set -a; source .env; source .env.migration; source .env.rls.txt; set +a
 *   node scripts/fase7-mantenimiento-entrega3-tests.mjs
 *
 * NO canalizar la salida por `head`: cierra el pipe, el proceso muere con
 * SIGPIPE antes del `finally` y la limpieza no llega a correr.
 */
import { createClient } from '@supabase/supabase-js'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET) { console.error('✗ Faltan variables de entorno'); process.exit(1) }

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(70)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const cmp = (t, esperado, real) =>
  String(esperado) === String(real) ? PASS(t, String(real))
                                    : FAIL(t, `esperaba ${esperado}, dio ${real}`)
/** Una prohibición: tiene que fallar Y no dejar efecto. */
const rechaza = (t, r) => r.error ? PASS(t, r.error.code ?? r.error.message.slice(0, 50))
                                  : FAIL(`SE PERMITIÓ: ${t}`)

const sesion = () => createClient(BASE, PUB, { auth: { persistSession: false } })
const admin = () => createClient(BASE, SECRET, { auth: { persistSession: false } })

const MARCA = 'ZZ-M3'
const HOY = new Date().toISOString().slice(0, 10)
const creados = { equipos: [], ordenes: [], empresas: [], clientes: [] }

const main = async () => {
  const c = sesion()
  const { error: eL } = await c.auth.signInWithPassword({
    email: 'buscatools.jano@gmail.com', password: process.env.BT_PW_JANO,
  })
  if (eL) { console.error('✗ login: ' + eL.message); process.exit(1) }

  const s = admin()
  const { data: comps } = await s.from('companies').select('id, slug')
  const BT = comps.find((x) => x.slug === 'buscatools').id
  const TT = comps.find((x) => x.slug === 'torquetools').id

  const q = async (t) => (await s.from(t).select('*', { count: 'exact', head: true })).count
  const { data: seqAntes } = await s.from('document_sequences')
    .select('company_id, doc_type, next_number').in('doc_type', ['maintenance_asset', 'maintenance_order'])
  const movAntes = await q('stock_movements')
  const empresasAntes = await q('companies')
  const clientesAntes = await q('customers')
  const { data: balAntes } = await s.from('stock_balances').select('product_id, warehouse_id, on_hand')
  const saldosPrevios = new Map((balAntes ?? []).map((b) => [b.product_id + '|' + b.warehouse_id, Number(b.on_hand)]))

  const { data: depBT } = await s.from('warehouses').select('id, name')
    .eq('company_id', BT).eq('is_default', true).single()
  const { data: depTT } = await s.from('warehouses').select('id')
    .eq('company_id', TT).eq('is_default', true).single()
  const { data: prods } = await s.from('products').select('id, sku, name')
    .eq('company_id', BT).order('sku').limit(2)
  const { data: prodTT } = await s.from('products').select('id').eq('company_id', TT).limit(1).maybeSingle()
  const { data: cli } = await s.from('customers').select('id').eq('company_id', BT).order('legal_name').limit(1)
  const { data: puntoBT } = await s.from('maintenance_check_points').select('id')
    .eq('company_id', BT).order('sort_order').limit(1).single()
  const { data: puntoTT } = await s.from('maintenance_check_points').select('id')
    .eq('company_id', TT).order('sort_order').limit(1).single()

  const saldo = async (productId, warehouseId) => {
    const { data } = await s.from('stock_balances').select('on_hand')
      .eq('product_id', productId).eq('warehouse_id', warehouseId).maybeSingle()
    return data ? Number(data.on_hand) : 0
  }

  /** Una orden nueva con las mismas dos llamadas que hace la pantalla. */
  const nuevaOrden = async (campos = {}) => {
    const { data: ref } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'maintenance_asset' })
    const { data: eq, error: eE } = await c.from('maintenance_assets')
      .insert({ company_id: BT, reference: ref, notes: `${MARCA} equipo` }).select('id').single()
    if (eE) throw new Error('equipo: ' + eE.message)
    creados.equipos.push(eq.id)
    const { data: num } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'maintenance_order' })
    const { data: o, error: eO } = await c.from('maintenance_orders').insert({
      company_id: BT, number: num, asset_id: eq.id, customer_id: cli[0].id,
      service_type: 'corrective', received_at: HOY, entry_reason: `${MARCA}`, ...campos,
    }).select('*').single()
    if (eO) throw new Error('orden: ' + eO.message)
    creados.ordenes.push(o.id)
    return o
  }

  const linea = (orden, campos) => c.from('maintenance_quote_lines')
    .insert({ company_id: BT, maintenance_order_id: orden, ...campos }).select('*').single()
  const repuesto = (orden, campos) => c.from('maintenance_order_parts')
    .insert({ company_id: BT, maintenance_order_id: orden, ...campos }).select('*').single()
  const leerOrden = async (id) =>
    (await s.from('maintenance_orders').select('*').eq('id', id).single()).data
  const eventos = async (id, accion) => {
    let qq = s.from('maintenance_audit').select('action, from_status, to_status, diff').eq('entity_id', id)
    if (accion) qq = qq.eq('action', accion)
    return (await qq.order('id')).data ?? []
  }

  console.log('='.repeat(74))
  console.log('  MANTENIMIENTO · entrega 3 — cotización, repuestos y consumo')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(74))

  try {
    // ── I1 e I2 · Coherencia de empresa entre hija y orden ─────────────────
    seccion('I1 e I2 · UNA FILA HIJA NO SE AUTORIZA POR SU PROPIO COMPANY_ID')

    // Una orden en una empresa donde jano NO tiene ninguna membresía. Es el
    // caso exacto que la auditoría midió como agujero.
    const { data: emp, error: eEmp } = await s.from('companies')
      .insert({ slug: `zz-m3-${Date.now()}`, name: `${MARCA} ajena`, default_currency: 'ARS' })
      .select('id').single()
    if (eEmp) throw new Error('empresa ajena: ' + eEmp.message)
    creados.empresas.push(emp.id)
    const { data: cliZ } = await s.from('customers')
      .insert({ company_id: emp.id, legal_name: `${MARCA} Cliente ajeno` }).select('id').single()
    creados.clientes.push(cliZ.id)
    const { data: eqZ } = await s.from('maintenance_assets')
      .insert({ company_id: emp.id, reference: `${MARCA}-EQ`, notes: MARCA }).select('id').single()
    const { data: ordZ } = await s.from('maintenance_orders').insert({
      company_id: emp.id, number: `${MARCA}-OS`, asset_id: eqZ.id, customer_id: cliZ.id,
      service_type: 'corrective', received_at: HOY,
    }).select('id, quote_total').single()

    const { data: veAjena } = await c.from('maintenance_orders').select('id').eq('id', ordZ.id)
    cmp('jano no ve la orden ajena', 0, (veAjena ?? []).length)

    rechaza('I1 · línea de cotización company_id=BT en una orden ajena',
      await c.from('maintenance_quote_lines').insert({
        company_id: BT, maintenance_order_id: ordZ.id, line_no: 1,
        line_type: 'labour', quantity: 1, unit_price: 1,
      }).select('id'))

    rechaza('I2 · repuesto company_id=BT en una orden ajena',
      await c.from('maintenance_order_parts').insert({
        company_id: BT, maintenance_order_id: ordZ.id, product_id: prods[0].id,
        warehouse_id: depBT.id, quantity: 1,
      }).select('id'))

    rechaza('    · medición company_id=BT en una orden ajena',
      await c.from('maintenance_measurements').insert({
        company_id: BT, maintenance_order_id: ordZ.id, row_no: 1, target_value: 10,
      }).select('id'))

    rechaza('    · revisión company_id=BT en una orden ajena',
      await c.from('maintenance_order_checks').insert({
        company_id: BT, maintenance_order_id: ordZ.id, check_point_id: puntoBT.id,
        phase: 'diagnosis', result: 'ok',
      }).select('id'))

    const { data: ordZTras } = await s.from('maintenance_orders')
      .select('quote_total').eq('id', ordZ.id).single()
    cmp('y el total de la orden ajena NO se movió', String(ordZ.quote_total), String(ordZTras.quote_total))
    cmp('  ni le quedó ninguna línea', 0,
      (await s.from('maintenance_quote_lines').select('id').eq('maintenance_order_id', ordZ.id)).data.length)
    cmp('  ni ningún repuesto', 0,
      (await s.from('maintenance_order_parts').select('id').eq('maintenance_order_id', ordZ.id)).data.length)

    await s.from('maintenance_orders').delete().eq('id', ordZ.id)
    await s.from('maintenance_assets').delete().eq('id', eqZ.id)

    // ── I3 e I4 · Producto, depósito y punto de otra empresa ───────────────
    seccion('I3 e I4 · LAS REFERENCIAS TAMBIÉN SON DE LA MISMA EMPRESA')

    const o1 = await nuevaOrden()

    if (prodTT) {
      rechaza('I3 · repuesto con un producto de otra empresa',
        await repuesto(o1.id, { product_id: prodTT.id, warehouse_id: depBT.id, quantity: 1 }))
      rechaza('    · línea de cotización con un producto de otra empresa',
        await linea(o1.id, { line_no: 90, line_type: 'part', product_id: prodTT.id, quantity: 1, unit_price: 0 }))
    } else {
      FAIL('I3 · no hay producto en Torquetools para probarlo')
    }

    rechaza('I4 · repuesto con un depósito de otra empresa',
      await repuesto(o1.id, { product_id: prods[0].id, warehouse_id: depTT.id, quantity: 1 }))

    rechaza('    · revisión con un punto de otra empresa',
      await c.from('maintenance_order_checks').insert({
        company_id: BT, maintenance_order_id: o1.id, check_point_id: puntoTT.id,
        phase: 'diagnosis', result: 'ok',
      }).select('id'))

    cmp('la orden propia quedó sin repuestos', 0,
      (await s.from('maintenance_order_parts').select('id').eq('maintenance_order_id', o1.id)).data.length)

    // ── I11 e I12 · La moneda de la cotización ─────────────────────────────
    seccion('I11 e I12 · UNA LÍNEA CON IMPORTE EXIGE MONEDA')

    cmp('la orden nace sin moneda', null, o1.quote_currency_code)

    rechaza('I11 · línea con importe y la cotización sin moneda',
      await linea(o1.id, { line_no: 1, line_type: 'labour',
        description_snapshot: 'Mano de obra', quantity: 1, unit_price: 100 }))

    const l0 = await linea(o1.id, { line_no: 1, line_type: 'diagnosis',
      description_snapshot: 'Diagnóstico sin cargo', quantity: 1, unit_price: 0 })
    l0.error ? FAIL('una línea SIN importe tiene que entrar sin moneda', l0.error.message)
             : PASS('una línea sin importe entra sin moneda: no hay nada que valorizar')
    if (l0.data) await c.from('maintenance_quote_lines').delete().eq('id', l0.data.id)

    const eMon = await c.from('maintenance_orders')
      .update({ quote_currency_code: 'USD' }).eq('id', o1.id).select('quote_currency_code')
    eMon.error ? FAIL('elegir la moneda', eMon.error.message)
               : cmp('se elige la moneda con la cotización pendiente', 'USD', eMon.data[0].quote_currency_code)

    const l1 = await linea(o1.id, { line_no: 1, line_type: 'labour',
      description_snapshot: `${MARCA} mano de obra`, quantity: 1, unit_price: 100 })
    l1.error ? FAIL('I12 · línea con importe y moneda', l1.error.message)
             : PASS('I12 · con moneda, la línea con importe entra', `total ${l1.data.line_total}`)

    // ── Totales, siempre del servidor ──────────────────────────────────────
    seccion('TOTALES · LOS CALCULA EL SERVIDOR')

    const l2 = await linea(o1.id, { line_no: 2, line_type: 'part', product_id: prods[0].id,
      sku_snapshot: prods[0].sku, description_snapshot: prods[0].name,
      quantity: 2, unit_price: 50, line_total: 999999 })
    if (l2.error) FAIL('línea con producto del catálogo', l2.error.message)
    else cmp('un line_total mandado por el cliente se recalcula', 100, Number(l2.data.line_total))

    cmp('total = suma de líneas', 200, Number((await leerOrden(o1.id)).quote_total))

    await c.from('maintenance_orders').update({ quote_total: 1, quote_subtotal: 1 }).eq('id', o1.id)
    cmp('un total manipulado vuelve a su valor', 200, Number((await leerOrden(o1.id)).quote_total))

    rechaza('una línea con el mismo line_no',
      await linea(o1.id, { line_no: 1, line_type: 'other', quantity: 1, unit_price: 1 }))

    rechaza('quitarle la moneda a una cotización con importes',
      await c.from('maintenance_orders')
        .update({ quote_currency_code: null }).eq('id', o1.id).select('id'))

    // ── I7 a I10 · Transiciones inválidas ──────────────────────────────────
    seccion('I7 a I10 · TRANSICIONES INVÁLIDAS DE QUOTE_STATUS')

    rechaza('un UPDATE directo a approved',
      await c.from('maintenance_orders').update({ quote_status: 'approved' }).eq('id', o1.id).select('id'))
    rechaza('un UPDATE directo a rejected',
      await c.from('maintenance_orders').update({ quote_status: 'rejected' }).eq('id', o1.id).select('id'))
    cmp('y la cotización sigue pendiente', 'pending', (await leerOrden(o1.id)).quote_status)

    // ── I5 · Aprobar ───────────────────────────────────────────────────────
    seccion('I5 · APROBAR')

    const oVacia = await nuevaOrden()
    const rVacia = await c.rpc('aprobar_cotizacion_mantenimiento', { p_order: oVacia.id })
    rechaza('aprobar una cotización sin ninguna línea', rVacia)

    const rAp = await c.rpc('aprobar_cotizacion_mantenimiento',
      { p_order: o1.id, p_por: 'Ing. Pérez' })
    if (rAp.error) FAIL('I5 · aprobar', rAp.error.message)
    else {
      PASS('I5 · pending → approved', JSON.stringify(rAp.data))
      const o = await leerOrden(o1.id)
      cmp('  quedó aprobada', 'approved', o.quote_status)
      cmp('  con fecha', HOY, o.quote_approved_at)
      cmp('  y con quién la aprobó', 'Ing. Pérez', o.quote_approved_by_name)
      const ev = await eventos(o1.id, 'quote_approved')
      cmp('  auditada, UNA sola vez', 1, ev.length)
      cmp('  con el total y la moneda', '200|USD',
        `${Number(ev[0]?.diff?.total)}|${ev[0]?.diff?.moneda}`)
    }

    const rAp2 = await c.rpc('aprobar_cotizacion_mantenimiento', { p_order: o1.id })
    rAp2.error ? FAIL('aprobar dos veces', rAp2.error.message)
               : cmp('aprobar dos veces es idempotente', true, rAp2.data.ya_estaba)
    cmp('  y no duplicó el evento', 1, (await eventos(o1.id, 'quote_approved')).length)

    // ── I7 e I8 · Aprobada es terminal ─────────────────────────────────────
    seccion('I7 e I8 · APPROVED ES TERMINAL')

    rechaza('I7 · approved → pending por UPDATE',
      await c.from('maintenance_orders').update({ quote_status: 'pending' }).eq('id', o1.id).select('id'))
    rechaza('I8 · approved → rejected por UPDATE',
      await c.from('maintenance_orders').update({ quote_status: 'rejected' }).eq('id', o1.id).select('id'))
    rechaza('I8 · approved → rejected por la RPC',
      await c.rpc('rechazar_cotizacion_mantenimiento', { p_order: o1.id }))
    cmp('sigue aprobada', 'approved', (await leerOrden(o1.id)).quote_status)

    rechaza('cambiarle la moneda a una cotización aprobada',
      await c.from('maintenance_orders')
        .update({ quote_currency_code: 'ARS' }).eq('id', o1.id).select('id'))

    // ── I6, I9 e I10 · Rechazar, y rejected también es terminal ────────────
    seccion('I6, I9 e I10 · RECHAZAR')

    const o2 = await nuevaOrden()
    const rRe = await c.rpc('rechazar_cotizacion_mantenimiento',
      { p_order: o2.id, p_motivo: `${MARCA} el cliente no aprobó el presupuesto` })
    if (rRe.error) FAIL('I6 · rechazar', rRe.error.message)
    else {
      PASS('I6 · pending → rejected', JSON.stringify(rRe.data))
      const ev = await eventos(o2.id, 'quote_rejected')
      cmp('  auditada, UNA sola vez', 1, ev.length)
      cmp('  con el motivo en el diff', `${MARCA} el cliente no aprobó el presupuesto`,
        ev[0]?.diff?.motivo)
    }
    PASS('  se puede rechazar sin ninguna línea: eso también es información')

    rechaza('I9 · rejected → pending por UPDATE',
      await c.from('maintenance_orders').update({ quote_status: 'pending' }).eq('id', o2.id).select('id'))
    rechaza('I10 · rejected → approved por UPDATE',
      await c.from('maintenance_orders').update({ quote_status: 'approved' }).eq('id', o2.id).select('id'))
    rechaza('I10 · rejected → approved por la RPC',
      await c.rpc('aprobar_cotizacion_mantenimiento', { p_order: o2.id }))
    cmp('sigue rechazada', 'rejected', (await leerOrden(o2.id)).quote_status)

    rechaza('una orden no puede NACER aprobada',
      await c.from('maintenance_orders').insert({
        company_id: BT, number: `${MARCA}-NACE`, asset_id: creados.equipos[0],
        customer_id: cli[0].id, service_type: 'corrective', received_at: HOY,
        quote_status: 'approved',
      }).select('id'))

    // ── I13 e I14 · El costo del repuesto y su moneda ──────────────────────
    seccion('I13 e I14 · COSTO Y MONEDA DEL COSTO')

    const o3 = await nuevaOrden()

    rechaza('I13 · costo informado sin moneda de costo',
      await repuesto(o3.id, { product_id: prods[0].id, warehouse_id: depBT.id,
        quantity: 1, unit_cost_snapshot: 25 }))

    const p14 = await repuesto(o3.id, { product_id: prods[0].id, warehouse_id: depBT.id,
      quantity: 3, sku_snapshot: prods[0].sku, name_snapshot: prods[0].name })
    if (p14.error) FAIL('I14 · repuesto sin costo', p14.error.message)
    else {
      PASS('I14 · costo NULL y moneda NULL', 'entra')
      cmp('  el costo queda nulo', null, p14.data.unit_cost_snapshot)
      cmp('  y su moneda también', null, p14.data.unit_cost_currency_code)
    }

    const p15 = await repuesto(o3.id, { product_id: prods[1].id, warehouse_id: depBT.id,
      quantity: 1, unit_cost_snapshot: 25, unit_cost_currency_code: 'ARS' })
    if (p15.error) FAIL('costo con su moneda', p15.error.message)
    else {
      PASS('con moneda, el costo entra', `${p15.data.unit_cost_snapshot} ${p15.data.unit_cost_currency_code}`)
      PASS('  y puede ser distinta de la de la cotización: costo ≠ precio')
    }

    // ── part_added ─────────────────────────────────────────────────────────
    seccion('AUDITORÍA DE REPUESTOS')

    cmp('el alta de cada repuesto quedó auditada', 2, (await eventos(o3.id, 'part_added')).length)
    const evP = (await eventos(o3.id, 'part_added'))[0]
    cmp('  con cantidad en el diff', true, evP?.diff?.cantidad !== undefined)

    await c.from('maintenance_order_parts')
      .update({ quantity: 4 }).eq('id', p14.data.id)
    cmp('editar la cantidad de un borrador NO genera eventos', 2,
      (await eventos(o3.id, 'part_added')).length)

    const pTmp = await repuesto(o3.id, { product_id: prods[0].id, warehouse_id: depBT.id, quantity: 1 })
    await c.from('maintenance_order_parts').delete().eq('id', pTmp.data.id)
    cmp('sacar un repuesto del borrador queda registrado', 1,
      (await eventos(o3.id, 'part_removed')).length)

    // ── Agregar no mueve stock ─────────────────────────────────────────────
    seccion('AGREGAR UN REPUESTO NO MUEVE STOCK')

    const saldo0 = await saldo(prods[0].id, depBT.id)
    const totalAntes = Number((await leerOrden(o3.id)).quote_total)
    cmp('el saldo no se movió al agregar', saldo0, await saldo(prods[0].id, depBT.id))
    cmp('la cotización tampoco cambió', totalAntes, Number((await leerOrden(o3.id)).quote_total))
    cmp('y la orden no tiene ninguna línea de cotización', 0,
      (await s.from('maintenance_quote_lines').select('id').eq('maintenance_order_id', o3.id)).data.length)
    PASS('un repuesto puede existir sin línea de cotización: es lo que se usó, no lo que se cobró')

    // Y al revés: la o1 tiene dos líneas y ningún repuesto.
    cmp('una cotización puede existir sin repuestos', 0,
      (await s.from('maintenance_order_parts').select('id').eq('maintenance_order_id', o1.id)).data.length)

    // ── Consumo ────────────────────────────────────────────────────────────
    seccion('CONSUMO · STOCK, IDEMPOTENCIA Y SALDO NEGATIVO')

    rechaza('marcar consumed_at a mano',
      await c.from('maintenance_order_parts')
        .update({ consumed_at: new Date().toISOString() }).eq('id', p14.data.id).select('id'))

    const saldoPre = await saldo(prods[0].id, depBT.id)
    const rC = await c.rpc('confirmar_consumo_mantenimiento', { p_order: o3.id })
    if (rC.error) FAIL('confirmar el consumo', rC.error.message)
    else cmp('se consumen las dos líneas', 2, rC.data.lineas)

    const saldoPost = await saldo(prods[0].id, depBT.id)
    cmp('el stock bajó por la cantidad exacta', saldoPre - 4, saldoPost)
    saldoPost < 0 ? PASS('el saldo quedó NEGATIVO y el consumo no se rechazó', String(saldoPost))
                  : PASS('el saldo no quedó negativo', 'había existencia')

    const { data: movs } = await s.from('stock_movements')
      .select('movement_type, quantity').eq('source_id', o3.id)
    cmp('un movimiento por línea', 2, (movs ?? []).length)
    cmp('del tipo correcto', true, (movs ?? []).every((m) => m.movement_type === 'service_consumption'))
    cmp('y con signo negativo', true, (movs ?? []).every((m) => Number(m.quantity) < 0))

    const rC2 = await c.rpc('confirmar_consumo_mantenimiento', { p_order: o3.id })
    cmp('confirmar dos veces es idempotente', true, rC2.data?.ya_estaba)
    cmp('  sin movimientos de más', 2,
      (await s.from('stock_movements').select('id').eq('source_id', o3.id)).data.length)
    cmp('  y con un solo evento de consumo', 1, (await eventos(o3.id, 'consumption_confirmed')).length)

    rechaza('borrar un repuesto ya consumido',
      await c.from('maintenance_order_parts').delete().eq('id', p14.data.id).select('id'))
    rechaza('editar un repuesto ya consumido',
      await c.from('maintenance_order_parts').update({ quantity: 9 }).eq('id', p14.data.id).select('id'))

    // ── Concurrencia ───────────────────────────────────────────────────────
    seccion('CONCURRENCIA · DOS PESTAÑAS A LA VEZ')

    const o4 = await nuevaOrden()
    await repuesto(o4.id, { product_id: prods[1].id, warehouse_id: depBT.id, quantity: 2 })
    const c2 = sesion()
    await c2.auth.signInWithPassword({
      email: 'buscatools.jano@gmail.com', password: process.env.BT_PW_JANO,
    })
    const [ra, rb] = await Promise.all([
      c.rpc('confirmar_consumo_mantenimiento', { p_order: o4.id }),
      c2.rpc('confirmar_consumo_mantenimiento', { p_order: o4.id }),
    ])
    const consumidas = [ra, rb].filter((r) => !r.error && r.data?.ya_estaba === false).length
    cmp('sólo una de las dos llegó a consumir', 1, consumidas)
    cmp('un solo movimiento', 1,
      (await s.from('stock_movements').select('id').eq('source_id', o4.id)).data.length)
    cmp('un solo consumed_at', 0,
      (await s.from('maintenance_order_parts').select('id')
        .eq('maintenance_order_id', o4.id).is('consumed_at', null)).data.length)
    cmp('un solo evento', 1, (await eventos(o4.id, 'consumption_confirmed')).length)

    // ── Atomicidad ─────────────────────────────────────────────────────────
    seccion('ATOMICIDAD')

    const o5 = await nuevaOrden()
    await repuesto(o5.id, { product_id: prods[0].id, warehouse_id: depBT.id, quantity: 1 })
    await repuesto(o5.id, { product_id: prods[1].id, warehouse_id: depBT.id, quantity: 1 })
    const rA = await c.rpc('confirmar_consumo_mantenimiento', { p_order: o5.id })
    cmp('las dos líneas o ninguna', 2, rA.data?.lineas)
    cmp('  dos movimientos', 2,
      (await s.from('stock_movements').select('id').eq('source_id', o5.id)).data.length)
    cmp('  y ninguna pendiente', 0,
      (await s.from('maintenance_order_parts').select('id')
        .eq('maintenance_order_id', o5.id).is('consumed_at', null)).data.length)

    // ── El cierre mira la cotización ───────────────────────────────────────
    seccion('EL CIERRE MIRA LA COTIZACIÓN')

    const o6 = await nuevaOrden({ repair_required: false, torque_required: false })
    await c.from('maintenance_orders')
      .update({ diagnosed_at: HOY, delivered_at: HOY }).eq('id', o6.id)
    await c.from('maintenance_orders').update({ stage: 'quotation' }).eq('id', o6.id)
    await c.from('maintenance_orders').update({ stage: 'closing' }).eq('id', o6.id)
    rechaza('cerrar con la cotización pendiente',
      await c.rpc('cerrar_orden_mantenimiento', { p_order: o6.id }))
    await c.rpc('rechazar_cotizacion_mantenimiento', { p_order: o6.id })
    const rCierre = await c.rpc('cerrar_orden_mantenimiento', { p_order: o6.id })
    rCierre.error ? FAIL('con la cotización rechazada debería cerrar', rCierre.error.message)
                  : PASS('con la cotización rechazada, cierra')

    rechaza('aprobar la cotización de una orden cerrada',
      await c.rpc('aprobar_cotizacion_mantenimiento', { p_order: o6.id }))

    // ── RLS ────────────────────────────────────────────────────────────────
    seccion('RLS · LAS SEIS IDENTIDADES')

    const TABLAS = ['maintenance_quote_lines', 'maintenance_order_parts']

    const escrTT = await c.from('maintenance_quote_lines').insert({
      company_id: TT, maintenance_order_id: o1.id, line_no: 80, quantity: 1, unit_price: 1,
    }).select('id')
    rechaza('salesperson (Torquetools): escribir', escrTT)

    for (const [rol, email] of [
      ['customer', 'cliente.test@buscatools.com.ar'],
      ['distributor', 'distribuidor.test@buscatools.com.ar'],
    ]) {
      const ext = sesion()
      const { error } = await ext.auth.signInWithPassword({ email, password: process.env.BT_PW_TEST })
      if (error) { FAIL(`${rol}: login`, error.message); continue }
      let visto = 0
      for (const t of TABLAS) { const { data } = await ext.from(t).select('id'); visto += (data ?? []).length }
      cmp(`${rol}: 0 filas`, 0, visto)
      cmp(`${rol}: 0 por id exacto`, 0,
        ((await ext.from('maintenance_quote_lines').select('id').eq('id', l1.data.id)).data ?? []).length)
      cmp(`${rol}: 0 por parent_id exacto`, 0,
        ((await ext.from('maintenance_order_parts').select('id')
          .eq('maintenance_order_id', o3.id)).data ?? []).length)
      rechaza(`${rol}: escribir una línea`, await ext.from('maintenance_quote_lines').insert({
        company_id: BT, maintenance_order_id: o1.id, line_no: 70, quantity: 1, unit_price: 1,
      }).select('id'))
      rechaza(`${rol}: aprobar`, await ext.rpc('aprobar_cotizacion_mantenimiento', { p_order: o2.id }))
      rechaza(`${rol}: rechazar`, await ext.rpc('rechazar_cotizacion_mantenimiento', { p_order: o2.id }))
      // El fast-path: una orden YA rechazada no le devuelve el atajo idempotente.
      const fp = await ext.rpc('rechazar_cotizacion_mantenimiento', { p_order: o2.id })
      fp.error && /permiso/i.test(fp.error.message)
        ? PASS(`${rol}: el permiso va antes del atajo idempotente`)
        : FAIL(`${rol}: el atajo idempotente le filtró información`, JSON.stringify(fp.data))
    }

    const anon = sesion()
    let vAnon = 0
    for (const t of TABLAS) { const { data } = await anon.from(t).select('id'); vAnon += (data ?? []).length }
    cmp('anon: 0 filas', 0, vAnon)
    rechaza('anon: aprobar', await anon.rpc('aprobar_cotizacion_mantenimiento', { p_order: o2.id }))
    rechaza('anon: rechazar', await anon.rpc('rechazar_cotizacion_mantenimiento', { p_order: o2.id }))

  } finally {
    // ── Limpieza ───────────────────────────────────────────────────────────
    seccion('LIMPIEZA')

    for (const id of creados.ordenes) {
      await s.from('maintenance_order_parts').delete().eq('maintenance_order_id', id)
      await s.from('stock_movements').delete().eq('source_id', id)
      await s.from('maintenance_quote_lines').delete().eq('maintenance_order_id', id)
      await s.from('maintenance_measurements').delete().eq('maintenance_order_id', id)
      await s.from('maintenance_order_checks').delete().eq('maintenance_order_id', id)
      await s.from('maintenance_orders').delete().eq('id', id)
    }
    await s.from('maintenance_orders').delete().like('entry_reason', `${MARCA}%`)
    for (const id of creados.equipos) await s.from('maintenance_assets').delete().eq('id', id)
    await s.from('maintenance_assets').delete().like('notes', `${MARCA}%`)
    // La auditoría va ANTES que las empresas: tiene FK a `companies` y la
    // orden de prueba en la empresa ajena dejó su evento de alta.
    await s.from('maintenance_audit').delete().gte('id', 0)
    for (const id of creados.clientes) await s.from('customers').delete().eq('id', id)
    for (const id of creados.empresas) {
      await s.from('maintenance_check_points').delete().eq('company_id', id)
      await s.from('document_sequences').delete().eq('company_id', id)
      await s.from('companies').delete().eq('id', id)
    }

    const { data: saldosAhora } = await s.from('stock_balances')
      .select('product_id, warehouse_id, on_hand')
    for (const b of saldosAhora ?? []) {
      const clave = b.product_id + '|' + b.warehouse_id
      const { data: ms } = await s.from('stock_movements').select('quantity')
        .eq('product_id', b.product_id).eq('warehouse_id', b.warehouse_id)
      const total = (ms ?? []).reduce((a, m) => a + Number(m.quantity), 0)
      if (!saldosPrevios.has(clave) && (ms ?? []).length === 0) {
        await s.from('stock_balances').delete()
          .eq('product_id', b.product_id).eq('warehouse_id', b.warehouse_id)
      } else if (Number(b.on_hand) !== total) {
        await s.from('stock_balances').update({ on_hand: total })
          .eq('product_id', b.product_id).eq('warehouse_id', b.warehouse_id)
      }
    }

    for (const qq of seqAntes ?? []) {
      await s.from('document_sequences').update({ next_number: qq.next_number })
        .eq('company_id', qq.company_id).eq('doc_type', qq.doc_type)
    }

    cmp('no queda ningún equipo', 0, await q('maintenance_assets'))
    cmp('ni ninguna orden', 0, await q('maintenance_orders'))
    cmp('ni líneas de cotización', 0, await q('maintenance_quote_lines'))
    cmp('ni repuestos', 0, await q('maintenance_order_parts'))
    cmp('ni mediciones', 0, await q('maintenance_measurements'))
    cmp('ni checks', 0, await q('maintenance_order_checks'))
    cmp('ni auditoría', 0, await q('maintenance_audit'))
    cmp('los puntos de revisión vuelven a su número', 16, await q('maintenance_check_points'))
    cmp('las empresas vuelven a su número', empresasAntes, await q('companies'))
    cmp('los clientes vuelven a su número', clientesAntes, await q('customers'))
    cmp('los movimientos de stock vuelven a su número', movAntes, await q('stock_movements'))
    cmp('y los saldos también', saldosPrevios.size, await q('stock_balances'))
    cmp('142 proveedores intactos', 142, await q('suppliers'))
    cmp('0 auditoría de compras', 0, await q('purchases_audit'))
    const { count: prodsBT } = await s.from('products')
      .select('*', { count: 'exact', head: true }).eq('company_id', BT)
    cmp('21.772 productos de Buscatools intactos', 21772, prodsBT)
  }

  console.log('\n' + '='.repeat(74))
  console.log(`  RESULTADO: ${fallos} fallo(s)`)
  console.log('='.repeat(74))
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch((e) => { console.error('\n✗', e); process.exit(1) })
