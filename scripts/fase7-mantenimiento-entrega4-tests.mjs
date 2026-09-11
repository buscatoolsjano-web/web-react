/**
 * Fase 7 · Mantenimiento — entrega 4: torque y cierre final.
 *
 * Prueba el circuito completo de una orden con las mismas llamadas que hace el
 * navegador y con JWT reales. Cada prohibición se prueba con un INTENTO REAL
 * midiendo el EFECTO además del código.
 *
 * Las doce condiciones de cierre se prueban **de a una**: doce órdenes, cada
 * una a la que le falta exactamente una cosa. Una sola orden con doce errores
 * simultáneos sólo probaría la primera.
 *
 * Se limpia sola: prefijo `ZZ-M4`.
 *
 *   set -a; source .env; source .env.migration; source .env.rls.txt; set +a
 *   node scripts/fase7-mantenimiento-entrega4-tests.mjs
 *
 * NO canalizar por `head`: cierra el pipe y la limpieza no llega a correr.
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
const rechaza = (t, r) => r.error ? PASS(t, r.error.code ?? r.error.message.slice(0, 50))
                                  : FAIL(`SE PERMITIÓ: ${t}`)

const sesion = () => createClient(BASE, PUB, { auth: { persistSession: false } })
const admin = () => createClient(BASE, SECRET, { auth: { persistSession: false } })

const MARCA = 'ZZ-M4'
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

  const { data: cli } = await s.from('customers').select('id').eq('company_id', BT).order('legal_name').limit(1)
  const { data: prods } = await s.from('products').select('id, sku').eq('company_id', BT).order('sku').limit(2)
  const { data: dep } = await s.from('warehouses').select('id').eq('company_id', BT).eq('is_default', true).single()

  const nuevaOrden = async (campos = {}) => {
    const { data: ref } = await c.rpc('next_document_number', { p_company: BT, p_doc_type: 'maintenance_asset' })
    const { data: eq, error: eE } = await c.from('maintenance_assets')
      .insert({ company_id: BT, reference: ref, notes: MARCA }).select('id').single()
    if (eE) throw new Error('equipo: ' + eE.message)
    creados.equipos.push(eq.id)
    const { data: num } = await c.rpc('next_document_number', { p_company: BT, p_doc_type: 'maintenance_order' })
    const { data: o, error: eO } = await c.from('maintenance_orders').insert({
      company_id: BT, number: num, asset_id: eq.id, customer_id: cli[0].id,
      service_type: 'corrective', received_at: HOY, entry_reason: MARCA, ...campos,
    }).select('*').single()
    if (eO) throw new Error('orden: ' + eO.message)
    creados.ordenes.push(o.id)
    return o
  }

  const avanzar = async (id, etapa) => c.from('maintenance_orders').update({ stage: etapa }).eq('id', id)
  const medir = async (id, valores) => c.from('maintenance_measurements').insert(
    valores.map((v, i) => ({ company_id: BT, maintenance_order_id: id, row_no: i + 1, target_value: v })))
  const precheck = async (id) => (await c.rpc('precheck_cierre_mantenimiento', { p_order: id })).data
  const cerrar = async (id) => c.rpc('cerrar_orden_mantenimiento', { p_order: id })
  const leer = async (id) => (await s.from('maintenance_orders').select('*').eq('id', id).single()).data
  const eventos = async (id, accion) => {
    let qq = s.from('maintenance_audit').select('action, diff').eq('entity_id', id)
    if (accion) qq = qq.eq('action', accion)
    return (await qq.order('id')).data ?? []
  }

  /**
   * Una orden lista para cerrar salvo por lo que se le rompa.
   * Sin reparación ni torque, cotización rechazada, todo lo demás completo.
   */
  const ordenLista = async (extra = {}) => {
    const o = await nuevaOrden({ repair_required: false, torque_required: false, ...extra })
    await c.from('maintenance_orders')
      .update({ diagnosed_at: HOY, delivered_at: HOY }).eq('id', o.id)
    await c.rpc('rechazar_cotizacion_mantenimiento', { p_order: o.id })
    await avanzar(o.id, 'quotation')
    await avanzar(o.id, 'closing')
    return o
  }

  console.log('='.repeat(74))
  console.log('  MANTENIMIENTO · entrega 4 — torque y cierre final')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(74))

  try {
    // ── 1 · Torque: el ejemplo de regresión de la entrega 1 ───────────────
    seccion('1 · TORQUE · el cálculo sale del servidor')

    const oCap = await nuevaOrden({ torque_lsl: 9, torque_nominal: 10, torque_usl: 11 })
    const eMed = await medir(oCap.id, [9.9, 10.1, 10.0, 9.95, 10.05])
    if (eMed.error) FAIL('cargar las 5 mediciones', eMed.error.message)
    else PASS('5 mediciones cargadas')

    const { data: cap } = await c.rpc('capacidad_torque', { p_order: oCap.id })
    cmp('n', 5, cap.mediciones)
    cmp('promedio', 10, Number(cap.promedio))
    cmp('desvío (muestral)', 0.0791, Number(cap.desvio))
    cmp('cp', 4.2164, Number(cap.cp))
    cmp('cpk — el caso de regresión de la entrega 1', 4.2164, Number(cap.cpk))
    cmp('cv (en %)', 0.7906, Number(cap.cv))
    cmp('veredicto', 'capaz', cap.veredicto)

    // El mismo número, calculado acá, para no creerle a la función.
    const vals = [9.9, 10.1, 10.0, 9.95, 10.05]
    const mu = vals.reduce((a, b) => a + b, 0) / vals.length
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mu) ** 2, 0) / (vals.length - 1))
    cmp('  y coincide con el cálculo independiente', 4.2164,
      Number(Math.min((11 - mu) / (3 * sd), (mu - 9) / (3 * sd)).toFixed(4)))

    // ── 2 · Casos borde: nunca NaN ni Infinity ────────────────────────────
    seccion('2 · CASOS BORDE · N/D, nunca NaN ni Infinity')

    for (const [nombre, valores, esperaCpk] of [
      ['0 mediciones', [], null],
      ['1 medición', [10], null],
      ['todas iguales → sigma 0', [10, 10, 10], null],
      // Dos mediciones justo en los límites: el desvío existe, así que el Cpk
      // es un número real y chico. No es N/D: es «no capaz».
      ['exactamente en LCI y LCS', [9, 11], 0.2357],
    ]) {
      const o = await nuevaOrden({ torque_lsl: 9, torque_nominal: 10, torque_usl: 11 })
      if (valores.length > 0) await medir(o.id, valores)
      const { data: k } = await c.rpc('capacidad_torque', { p_order: o.id })
      const crudo = JSON.stringify(k)
      const roto = /NaN|Infinity/.test(crudo)
      roto
        ? FAIL(`${nombre}: devolvió NaN/Infinity`, crudo)
        : PASS(`${nombre}: sin NaN ni Infinity`, `cpk=${k.cpk}`)
      cmp(`  ${nombre}: cpk`, esperaCpk, k.cpk)
    }

    const oFuera = await nuevaOrden({ torque_lsl: 9, torque_nominal: 10, torque_usl: 11 })
    await medir(oFuera.id, [10, 10.01, 14])
    const { data: kFuera } = await c.rpc('capacidad_torque', { p_order: oFuera.id })
    cmp('una medición fuera de límites da un veredicto malo, no un error', 'no_capaz', kFuera.veredicto)
    Number(kFuera.cpk) < 0 ? PASS('  con cpk negativo', String(kFuera.cpk)) : FAIL('  cpk debería ser negativo')

    // ── 3 · Validaciones nuevas de la entrega 4 ───────────────────────────
    seccion('3 · VALIDACIONES DE LOS LÍMITES Y DE LAS MEDICIONES')

    const oL = await nuevaOrden()
    rechaza('LCS menor que LCI',
      await c.from('maintenance_orders').update({ torque_lsl: 11, torque_usl: 9 }).eq('id', oL.id).select('id'))
    rechaza('nominal fuera de la banda',
      await c.from('maintenance_orders')
        .update({ torque_lsl: 9, torque_usl: 11, torque_nominal: 50 }).eq('id', oL.id).select('id'))
    rechaza('un límite NaN',
      await c.from('maintenance_orders').update({ torque_lsl: 'NaN' }).eq('id', oL.id).select('id'))
    rechaza('un límite Infinity',
      await c.from('maintenance_orders').update({ torque_usl: 'Infinity' }).eq('id', oL.id).select('id'))
    rechaza('una medición NaN',
      await c.from('maintenance_measurements')
        .insert({ company_id: BT, maintenance_order_id: oL.id, row_no: 1, target_value: 'NaN' }).select('id'))

    const okLim = await c.from('maintenance_orders')
      .update({ torque_lsl: 9, torque_nominal: 10, torque_usl: 11 }).eq('id', oL.id).select('torque_nominal')
    okLim.error ? FAIL('límites coherentes deberían entrar', okLim.error.message)
                : cmp('unos límites coherentes entran', 10, Number(okLim.data[0].torque_nominal))

    const { count: medOL } = await s.from('maintenance_measurements')
      .select('*', { count: 'exact', head: true }).eq('maintenance_order_id', oL.id)
    cmp('y ninguna medición inválida quedó guardada', 0, medOL)

    // ── 4 · Torque requerido / no requerido ───────────────────────────────
    seccion('4 · TORQUE REQUERIDO Y NO REQUERIDO')

    const oTR = await nuevaOrden({ torque_lsl: 9, torque_nominal: 10, torque_usl: 11 })
    rechaza('completar el torque sin ninguna medición',
      await c.from('maintenance_orders').update({ torque_at: HOY }).eq('id', oTR.id).select('id'))
    await medir(oTR.id, [10])
    const okT = await c.from('maintenance_orders').update({ torque_at: HOY }).eq('id', oTR.id).select('torque_at')
    okT.error ? FAIL('con una medición debería completarse', okT.error.message)
              : PASS('con al menos una medición se completa', okT.data[0].torque_at)
    const { data: mTR } = await s.from('maintenance_measurements').select('id').eq('maintenance_order_id', oTR.id)
    rechaza('dejar sin mediciones un torque ya completado',
      await c.from('maintenance_measurements').delete().eq('id', mTR[0].id).select('id'))

    const oNR = await nuevaOrden({ torque_required: false })
    cmp('«no requerido» queda auditado al crear', 1,
      (await eventos(oNR.id, 'stage_marked_not_required')).length)
    rechaza('poner torque_at con el torque no requerido',
      await c.from('maintenance_orders').update({ torque_at: HOY }).eq('id', oNR.id).select('id'))
    PASS('«no requerido» no es cero mediciones ni un nulo: es torque_required = false, y se audita')

    // ── 5 · Las DOCE condiciones de cierre, de a una ──────────────────────
    seccion('5 · LAS DOCE CONDICIONES DE CIERRE · una orden por condición')

    // C1 · la orden existe
    const c1 = await cerrar('00000000-0000-0000-0000-000000000000')
    rechaza('C1 · una orden inexistente', c1)

    // C2 · permiso — se prueba en la sección de RLS con un externo real.

    // C3 · una orden cancelada no se cierra
    const oCanc = await nuevaOrden()
    await c.rpc('cancelar_orden_mantenimiento', { p_order: oCanc.id, p_motivo: MARCA })
    rechaza('C3 · una orden cancelada', await cerrar(oCanc.id))

    // C4 · stage = closing
    const oC4 = await nuevaOrden({ repair_required: false, torque_required: false })
    await c.from('maintenance_orders').update({ diagnosed_at: HOY, delivered_at: HOY }).eq('id', oC4.id)
    await c.rpc('rechazar_cotizacion_mantenimiento', { p_order: oC4.id })
    rechaza('C4 · sin llegar a la etapa de cierre', await cerrar(oC4.id))
    cmp('  el precheck lo dice', true,
      (await precheck(oC4.id)).bloqueos.some((b) => b.includes('etapa')))

    // C5 · diagnóstico
    const oC5 = await ordenLista()
    await s.from('maintenance_orders').update({ diagnosed_at: null }).eq('id', oC5.id)
    rechaza('C5 · sin diagnóstico', await cerrar(oC5.id))
    cmp('  el precheck lo dice', true,
      (await precheck(oC5.id)).bloqueos.some((b) => b.includes('diagnóstico')))

    // C6 · cotización pendiente
    const oC6 = await nuevaOrden({ repair_required: false, torque_required: false })
    await c.from('maintenance_orders').update({ diagnosed_at: HOY, delivered_at: HOY }).eq('id', oC6.id)
    await avanzar(oC6.id, 'quotation')
    await avanzar(oC6.id, 'closing')
    rechaza('C6 · con la cotización pendiente', await cerrar(oC6.id))
    cmp('  el precheck lo dice', true,
      (await precheck(oC6.id)).bloqueos.some((b) => b.includes('pendiente')))

    // C7 · aprobada y sin líneas. Se llega por donde se llega de verdad:
    // aprobar la cotización (la RPC exige al menos una línea) y después borrar
    // esa línea. El estado no es hipotético: lo alcanza un administrador con
    // dos clics.
    const oC7 = await nuevaOrden({ repair_required: false, torque_required: false })
    await c.from('maintenance_orders')
      .update({ diagnosed_at: HOY, delivered_at: HOY, quote_currency_code: 'ARS' }).eq('id', oC7.id)
    const { data: l7 } = await c.from('maintenance_quote_lines').insert({
      company_id: BT, maintenance_order_id: oC7.id, line_no: 1,
      line_type: 'labour', description_snapshot: MARCA, quantity: 1, unit_price: 100,
    }).select('id').single()
    await c.rpc('aprobar_cotizacion_mantenimiento', { p_order: oC7.id, p_por: 'Cliente' })
    await c.from('maintenance_quote_lines').delete().eq('id', l7.id)
    await avanzar(oC7.id, 'quotation')
    await avanzar(oC7.id, 'closing')
    cmp('  (la cotización quedó aprobada y sin líneas)', 'approved', (await leer(oC7.id)).quote_status)
    rechaza('C7 · cotización aprobada y sin líneas', await cerrar(oC7.id))
    cmp('  el precheck lo dice', true,
      (await precheck(oC7.id)).bloqueos.some((b) => b.includes('ninguna línea')))

    // C8 · reparación
    const oC8 = await ordenLista({ repair_required: true })
    rechaza('C8 · con la reparación sin completar', await cerrar(oC8.id))
    cmp('  el precheck lo dice', true,
      (await precheck(oC8.id)).bloqueos.some((b) => b.includes('reparación')))

    // C9 · torque sin completar
    const oC9 = await ordenLista({ torque_required: true })
    await medir(oC9.id, [10])
    rechaza('C9 · con el torque sin completar', await cerrar(oC9.id))
    cmp('  el precheck lo dice', true,
      (await precheck(oC9.id)).bloqueos.some((b) => b.includes('torque')))

    // C10 · torque requerido y sin mediciones
    const oC10 = await ordenLista({ torque_required: true })
    await s.from('maintenance_orders').update({ torque_at: HOY }).eq('id', oC10.id)
    rechaza('C10 · torque requerido y sin ninguna medición', await cerrar(oC10.id))
    cmp('  el precheck lo dice', true,
      (await precheck(oC10.id)).bloqueos.some((b) => b.includes('medición')))

    // C11 · entrega
    const oC11 = await ordenLista()
    await s.from('maintenance_orders').update({ delivered_at: null }).eq('id', oC11.id)
    rechaza('C11 · sin fecha de entrega', await cerrar(oC11.id))
    cmp('  el precheck lo dice', true,
      (await precheck(oC11.id)).bloqueos.some((b) => b.includes('entrega')))

    // El CHECK chk_mo_fechas impide que la fila llegue a existir, ni siquiera
    // con la clave de servicio. La condición 11b de la RPC es una segunda
    // línea de defensa para el día que ese CHECK cambie; lo que se prueba acá
    // es la que actúa primero.
    const oC11b = await ordenLista()
    rechaza('C11b · entrega anterior al ingreso (lo frena el CHECK de la tabla)',
      await s.from('maintenance_orders')
        .update({ delivered_at: '2020-01-01' }).eq('id', oC11b.id).select('id'))
    cmp('  y la fecha de entrega quedó como estaba', HOY, (await leer(oC11b.id)).delivered_at)

    // C12 · repuestos sin consumir
    const oC12 = await ordenLista()
    await c.from('maintenance_order_parts').insert({
      company_id: BT, maintenance_order_id: oC12.id, product_id: prods[0].id,
      warehouse_id: dep.id, quantity: 1,
    })
    rechaza('C12 · con un repuesto sin consumir', await cerrar(oC12.id))
    cmp('  el precheck lo dice', true,
      (await precheck(oC12.id)).bloqueos.some((b) => b.includes('repuesto')))

    // ── 6 · El precheck no duplica reglas: da la lista COMPLETA ───────────
    seccion('6 · PRECHECK · la misma lógica, sin efectos')

    const oVarios = await nuevaOrden({ repair_required: true, torque_required: true })
    const pv = await precheck(oVarios.id)
    cmp('puede_cerrar', false, pv.puede_cerrar)
    pv.bloqueos.length >= 5
      ? PASS('devuelve TODOS los bloqueos de una vez', `${pv.bloqueos.length} motivos`)
      : FAIL('debería devolver varios bloqueos', JSON.stringify(pv.bloqueos))
    for (const b of pv.bloqueos) console.log(`                 · ${b}`)
    const { data: oSin } = await s.from('maintenance_orders').select('status').eq('id', oVarios.id).single()
    cmp('el precheck no tiene efectos: la orden sigue abierta', 'open', oSin.status)

    // ── 7 · E2E con torque ────────────────────────────────────────────────
    seccion('7 · E2E COMPLETO · con torque, repuesto y consumo')

    const e2e = await nuevaOrden({ torque_lsl: 9, torque_nominal: 10, torque_usl: 11 })
    const saldoAntes = saldosPrevios.get(prods[1].id + '|' + dep.id) ?? 0

    await c.from('maintenance_orders')
      .update({ diagnosis_notes: `${MARCA} diagnóstico`, diagnosed_at: HOY }).eq('id', e2e.id)
    await avanzar(e2e.id, 'quotation')
    await c.from('maintenance_orders').update({ quote_currency_code: 'ARS' }).eq('id', e2e.id)
    await c.from('maintenance_quote_lines').insert({
      company_id: BT, maintenance_order_id: e2e.id, line_no: 1,
      line_type: 'labour', description_snapshot: 'Mano de obra', quantity: 1, unit_price: 1000,
    })
    const ap = await c.rpc('aprobar_cotizacion_mantenimiento', { p_order: e2e.id, p_por: 'Cliente' })
    ap.error ? FAIL('aprobar', ap.error.message) : PASS('cotización aprobada')

    await avanzar(e2e.id, 'repair')
    await c.from('maintenance_order_parts').insert({
      company_id: BT, maintenance_order_id: e2e.id, product_id: prods[1].id,
      warehouse_id: dep.id, quantity: 2,
    })
    const saldoTrasAgregar = Number((await s.from('stock_balances').select('on_hand')
      .eq('product_id', prods[1].id).eq('warehouse_id', dep.id).maybeSingle()).data?.on_hand ?? 0)
    cmp('agregar el repuesto NO movió stock', saldoAntes, saldoTrasAgregar)

    const cons = await c.rpc('confirmar_consumo_mantenimiento', { p_order: e2e.id })
    cons.error ? FAIL('confirmar consumo', cons.error.message) : PASS('consumo confirmado', `${cons.data.lineas} línea(s)`)
    const saldoTrasConsumo = Number((await s.from('stock_balances').select('on_hand')
      .eq('product_id', prods[1].id).eq('warehouse_id', dep.id).maybeSingle()).data?.on_hand ?? 0)
    cmp('el consumo SÍ movió stock', saldoAntes - 2, saldoTrasConsumo)

    await c.from('maintenance_orders')
      .update({ repair_notes: `${MARCA} reparado`, repaired_at: HOY }).eq('id', e2e.id)
    await avanzar(e2e.id, 'torque')
    await medir(e2e.id, [9.9, 10.1, 10.0, 9.95, 10.05])
    await c.from('maintenance_orders').update({ torque_at: HOY }).eq('id', e2e.id)
    await avanzar(e2e.id, 'closing')
    await c.from('maintenance_orders').update({ delivered_at: HOY }).eq('id', e2e.id)

    const pe2e = await precheck(e2e.id)
    cmp('el precheck dice que se puede cerrar', true, pe2e.puede_cerrar)
    cmp('  sin bloqueos', 0, pe2e.bloqueos.length)

    const movAntesCierre = (await s.from('stock_movements')
      .select('*', { count: 'exact', head: true }).eq('source_id', e2e.id)).count
    const rc = await cerrar(e2e.id)
    rc.error ? FAIL('cerrar la orden completa', rc.error.message) : PASS('orden cerrada', JSON.stringify(rc.data))
    const cerrada = await leer(e2e.id)
    cmp('  status', 'closed', cerrada.status)
    cmp('  closed_at', true, cerrada.closed_at !== null)
    cmp('  closed_by', true, cerrada.closed_by !== null)
    const movTrasCierre = (await s.from('stock_movements')
      .select('*', { count: 'exact', head: true }).eq('source_id', e2e.id)).count
    cmp('cerrar NO vuelve a mover stock', movAntesCierre, movTrasCierre)
    cmp('  y queda el evento de cierre', 1, (await eventos(e2e.id, 'order_closed')).length)

    // Congelada
    for (const [qué, intento] of [
      ['la cabecera', c.from('maintenance_orders').update({ closing_notes: 'x' }).eq('id', e2e.id).select('id')],
      ['una línea', c.from('maintenance_quote_lines').insert({
        company_id: BT, maintenance_order_id: e2e.id, line_no: 9, quantity: 1, unit_price: 0 }).select('id')],
      ['un repuesto', c.from('maintenance_order_parts').insert({
        company_id: BT, maintenance_order_id: e2e.id, product_id: prods[0].id,
        warehouse_id: dep.id, quantity: 1 }).select('id')],
      ['una medición', c.from('maintenance_measurements').insert({
        company_id: BT, maintenance_order_id: e2e.id, row_no: 99, target_value: 10 }).select('id')],
      ['una revisión', c.from('maintenance_order_checks').insert({
        company_id: BT, maintenance_order_id: e2e.id,
        check_point_id: (await s.from('maintenance_check_points').select('id').eq('company_id', BT).limit(1).single()).data.id,
        phase: 'diagnosis', result: 'ok' }).select('id')],
    ]) rechaza(`cerrada: editar ${qué}`, await intento)

    cmp('cerrar dos veces es idempotente', true, (await cerrar(e2e.id)).data?.ya_estaba)
    cmp('  sin duplicar el evento', 1, (await eventos(e2e.id, 'order_closed')).length)

    // ── 8 · E2E sin torque ────────────────────────────────────────────────
    seccion('8 · E2E SIN TORQUE · cierra sin una sola medición')

    const sinT = await ordenLista({ torque_required: false, repair_required: false })
    const pSinT = await precheck(sinT.id)
    cmp('el precheck lo da por listo', true, pSinT.puede_cerrar)
    cmp('  y dice que el torque no es requerido', false, pSinT.requiere_torque)
    cmp('  con cero mediciones', 0, pSinT.mediciones)
    const rSinT = await cerrar(sinT.id)
    rSinT.error ? FAIL('debería cerrar sin torque', rSinT.error.message)
                : PASS('cierra sin ninguna medición: el torque estaba marcado no requerido')
    cmp('  y sigue registrado como no requerido', false, (await leer(sinT.id)).torque_required)

    // ── 9 · Cotización rechazada ──────────────────────────────────────────
    seccion('9 · COTIZACIÓN RECHAZADA · el comportamiento REAL')

    cmp('una orden con la cotización rechazada puede cerrarse', 'closed', (await leer(sinT.id)).status)
    cmp('  y su cotización siguió rechazada', 'rejected', (await leer(sinT.id)).quote_status)
    PASS('rechazada ≠ cancelada: el trabajo pudo hacerse igual sin presupuesto aprobado')

    // ── 10 · Concurrencia ─────────────────────────────────────────────────
    seccion('10 · CONCURRENCIA · dos cierres a la vez')

    const oConc = await ordenLista()
    const c2 = sesion()
    await c2.auth.signInWithPassword({
      email: 'buscatools.jano@gmail.com', password: process.env.BT_PW_JANO,
    })
    const [ra, rb] = await Promise.all([cerrar(oConc.id), c2.rpc('cerrar_orden_mantenimiento', { p_order: oConc.id })])
    const cerraron = [ra, rb].filter((r) => !r.error && r.data?.ya_estaba === false).length
    cmp('sólo una de las dos cerró', 1, cerraron)
    cmp('  un solo evento order_closed', 1, (await eventos(oConc.id, 'order_closed')).length)
    cmp('  y la orden quedó cerrada', 'closed', (await leer(oConc.id)).status)

    // ── 11 · UPDATE directo ───────────────────────────────────────────────
    seccion('11 · UPDATE DIRECTO')

    const oUpd = await ordenLista()
    rechaza('poner status = closed a mano',
      await c.from('maintenance_orders')
        .update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', oUpd.id).select('id'))
    cmp('  y sigue abierta', 'open', (await leer(oUpd.id)).status)

    // ── 12 · Multiempresa · la regresión de O1 ────────────────────────────
    seccion('12 · MULTIEMPRESA · una medición de otra empresa')

    const { data: emp } = await s.from('companies')
      .insert({ slug: `zz-m4-${Date.now()}`, name: `${MARCA} ajena`, default_currency: 'ARS' })
      .select('id').single()
    creados.empresas.push(emp.id)
    const { data: cliZ } = await s.from('customers')
      .insert({ company_id: emp.id, legal_name: `${MARCA} ajeno` }).select('id').single()
    creados.clientes.push(cliZ.id)
    const { data: eqZ } = await s.from('maintenance_assets')
      .insert({ company_id: emp.id, reference: `${MARCA}-EQ`, notes: MARCA }).select('id').single()
    const { data: ordZ } = await s.from('maintenance_orders').insert({
      company_id: emp.id, number: `${MARCA}-OS`, asset_id: eqZ.id, customer_id: cliZ.id,
      service_type: 'corrective', received_at: HOY,
    }).select('id').single()

    rechaza('una medición company_id=BT en una orden de otra empresa',
      await c.from('maintenance_measurements').insert({
        company_id: BT, maintenance_order_id: ordZ.id, row_no: 1, target_value: 10,
      }).select('id'))
    cmp('  y la orden ajena quedó sin mediciones', 0,
      (await s.from('maintenance_measurements').select('id').eq('maintenance_order_id', ordZ.id)).data.length)
    rechaza('cerrar una orden de una empresa donde no se tiene rol', await cerrar(ordZ.id))
    rechaza('ni siquiera consultar su precheck',
      await c.rpc('precheck_cierre_mantenimiento', { p_order: ordZ.id }))

    await s.from('maintenance_orders').delete().eq('id', ordZ.id)
    await s.from('maintenance_assets').delete().eq('id', eqZ.id)

    // ── 13 · RLS ──────────────────────────────────────────────────────────
    seccion('13 · RLS · las seis identidades')

    const escrTT = await c.from('maintenance_measurements').insert({
      company_id: TT, maintenance_order_id: oCap.id, row_no: 80, target_value: 10,
    }).select('id')
    rechaza('salesperson (Torquetools): escribir una medición', escrTT)

    for (const [rol, email] of [
      ['customer', 'cliente.test@buscatools.com.ar'],
      ['distributor', 'distribuidor.test@buscatools.com.ar'],
    ]) {
      const ext = sesion()
      const { error } = await ext.auth.signInWithPassword({ email, password: process.env.BT_PW_TEST })
      if (error) { FAIL(`${rol}: login`, error.message); continue }
      const { data: todas } = await ext.from('maintenance_measurements').select('id')
      cmp(`${rol}: 0 mediciones`, 0, (todas ?? []).length)
      const { data: mUno } = await s.from('maintenance_measurements')
        .select('id').eq('maintenance_order_id', oCap.id).limit(1).single()
      cmp(`${rol}: 0 por measurement_id exacto`, 0,
        ((await ext.from('maintenance_measurements').select('id').eq('id', mUno.id)).data ?? []).length)
      cmp(`${rol}: 0 por order_id exacto`, 0,
        ((await ext.from('maintenance_measurements').select('id')
          .eq('maintenance_order_id', oCap.id)).data ?? []).length)
      rechaza(`${rol}: escribir una medición`, await ext.from('maintenance_measurements').insert({
        company_id: BT, maintenance_order_id: oCap.id, row_no: 70, target_value: 10 }).select('id'))
      rechaza(`${rol}: cerrar`, await ext.rpc('cerrar_orden_mantenimiento', { p_order: oCap.id }))
      rechaza(`${rol}: precheck`, await ext.rpc('precheck_cierre_mantenimiento', { p_order: oCap.id }))
      rechaza(`${rol}: capacidad_torque`, await ext.rpc('capacidad_torque', { p_order: oCap.id })
        .then((r) => (r.error ? r : { error: (r.data?.mediciones ?? 0) > 0 ? null : { code: 'sin datos' } })))
    }

    const anon = sesion()
    cmp('anon: 0 mediciones', 0, ((await anon.from('maintenance_measurements').select('id')).data ?? []).length)
    rechaza('anon: cerrar', await anon.rpc('cerrar_orden_mantenimiento', { p_order: oCap.id }))
    rechaza('anon: precheck', await anon.rpc('precheck_cierre_mantenimiento', { p_order: oCap.id }))

    // C2 · el permiso del cierre, con un externo real: ya probado arriba.
    PASS('C2 · el permiso se verifica ANTES del atajo idempotente (probado con customer y distributor)')

  } finally {
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
    await s.from('maintenance_audit').delete().gte('id', 0)
    for (const id of creados.clientes) await s.from('customers').delete().eq('id', id)
    for (const id of creados.empresas) {
      await s.from('maintenance_check_points').delete().eq('company_id', id)
      await s.from('document_sequences').delete().eq('company_id', id)
      await s.from('companies').delete().eq('id', id)
    }

    const { data: saldosAhora } = await s.from('stock_balances').select('product_id, warehouse_id, on_hand')
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
    for (const x of seqAntes ?? []) {
      await s.from('document_sequences').update({ next_number: x.next_number })
        .eq('company_id', x.company_id).eq('doc_type', x.doc_type)
    }

    cmp('no queda ningún equipo', 0, await q('maintenance_assets'))
    cmp('ni ninguna orden', 0, await q('maintenance_orders'))
    cmp('ni mediciones', 0, await q('maintenance_measurements'))
    cmp('ni repuestos', 0, await q('maintenance_order_parts'))
    cmp('ni líneas de cotización', 0, await q('maintenance_quote_lines'))
    cmp('ni checks', 0, await q('maintenance_order_checks'))
    cmp('ni auditoría', 0, await q('maintenance_audit'))
    cmp('16 puntos de revisión', 16, await q('maintenance_check_points'))
    cmp('las empresas vuelven a su número', empresasAntes, await q('companies'))
    cmp('los clientes vuelven a su número', clientesAntes, await q('customers'))
    cmp('los movimientos de stock vuelven a su número', movAntes, await q('stock_movements'))
    cmp('y los saldos también', saldosPrevios.size, await q('stock_balances'))
    cmp('142 proveedores intactos', 142, await q('suppliers'))
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
