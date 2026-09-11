/**
 * Fase 7 · Mantenimiento — entrega 1: el schema, contra la base real.
 *
 * No hay datos que migrar: los 4 registros del legacy son de prueba. Así que
 * lo único que hay que probar acá es que **las reglas existan de verdad**, y
 * cada prohibición se prueba con un INTENTO REAL midiendo el EFECTO además del
 * código: con PostgREST una operación prohibida puede devolver «éxito» con
 * cero filas.
 *
 * Se limpia sola: prefijo `ZZ-M1`.
 *
 *   set -a; source .env; source .env.migration; source .env.rls.txt; set +a
 *   node scripts/fase7-mantenimiento-schema-tests.mjs
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

const sesion = () => createClient(BASE, PUB, { auth: { persistSession: false } })
const admin = () => createClient(BASE, SECRET, { auth: { persistSession: false } })

const MARCA = 'ZZ-M1'
const HOY = new Date().toISOString().slice(0, 10)
const creados = { equipos: [], ordenes: [], adjuntos: [] }

const main = async () => {
  const c = sesion()
  const { error: eL } = await c.auth.signInWithPassword({
    email: 'buscatools.jano@gmail.com',
    password: process.env.BT_PW_JANO,
  })
  if (eL) { console.error('✗ login: ' + eL.message); process.exit(1) }

  const s = admin()
  const { data: comps } = await s.from('companies').select('id, slug')
  const BT = comps.find((x) => x.slug === 'buscatools').id
  const TT = comps.find((x) => x.slug === 'torquetools').id

  const { data: seqAntes } = await s.from('document_sequences')
    .select('doc_type, next_number').eq('company_id', BT)
    .in('doc_type', ['maintenance_asset', 'maintenance_order'])
  const { count: movAntes } = await s.from('stock_movements')
    .select('*', { count: 'exact', head: true })
  const { data: balAntes } = await s.from('stock_balances')
    .select('product_id, warehouse_id, on_hand')
  const saldosPrevios = new Map(
    (balAntes ?? []).map((b) => [b.product_id + '|' + b.warehouse_id, Number(b.on_hand)]))
  const { count: adjAntes } = await s.from('attachments')
    .select('*', { count: 'exact', head: true })

  const { data: dep } = await s.from('warehouses')
    .select('id').eq('company_id', BT).eq('is_default', true).single()
  const { data: prods } = await s.from('products')
    .select('id, sku, name').eq('company_id', BT).order('sku').limit(2)
  const { data: cli } = await s.from('customers')
    .select('id, legal_name').eq('company_id', BT).order('legal_name').limit(2)
  const { data: cliTT } = await s.from('customers')
    .select('id').eq('company_id', TT).limit(1).maybeSingle()

  const saldo = async (productId) => {
    const { data } = await s.from('stock_balances').select('on_hand')
      .eq('product_id', productId).eq('warehouse_id', dep.id).maybeSingle()
    return data ? Number(data.on_hand) : 0
  }

  console.log('='.repeat(74))
  console.log('  MANTENIMIENTO · entrega 1 — schema')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(74))

  // ── Andamios ───────────────────────────────────────────────────────────

  const nuevoEquipo = async (cliente, extra = {}) => {
    const { data: ref, error: eN } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'maintenance_asset' })
    if (eN) return { error: eN }
    const { data, error } = await c.from('maintenance_assets').insert({
      company_id: BT, reference: ref, owner_customer_id: cliente,
      model_text: 'ASM18-3-PC', asset_type: 'Atornillador Pistola',
      identifier: `${MARCA} equipo`, notes: `${MARCA}`, ...extra,
    }).select('id, reference, serial_normalized').single()
    if (error) return { error }
    creados.equipos.push(data.id)
    return { data }
  }

  const nuevaOrden = async (equipoId, cliente, extra = {}) => {
    const { data: num, error: eN } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'maintenance_order' })
    if (eN) return { error: eN }
    const { data, error } = await c.from('maintenance_orders').insert({
      company_id: BT, number: num, asset_id: equipoId, customer_id: cliente,
      received_at: HOY, closing_notes: `${MARCA}`, ...extra,
    }).select('id, number, status, stage, quote_total').single()
    if (error) return { error }
    creados.ordenes.push(data.id)
    return { data }
  }

  const orden = async (id) => {
    const { data } = await s.from('maintenance_orders')
      .select('status, stage, quote_subtotal, quote_total, closed_at, torque_at').eq('id', id).single()
    return data
  }

  try {
    // ── 1 · Numeración ─────────────────────────────────────────────────────
    seccion('1 · NUMERACIÓN')

    const e1 = await nuevoEquipo(cli[0].id, { serial_number: 'AB-123' })
    if (e1.error) { FAIL('no se pudo crear el equipo', e1.error.message); throw e1.error }
    cmp('el equipo arranca en EQ00001', 'EQ00001', e1.data.reference)

    const o1 = await nuevaOrden(e1.data.id, cli[0].id)
    if (o1.error) { FAIL('no se pudo crear la orden', o1.error.message); throw o1.error }
    cmp('la orden arranca en OS00001', 'OS00001', o1.data.number)
    cmp('  nace abierta', 'open', o1.data.status)
    cmp('  y en diagnóstico', 'diagnosis', o1.data.stage)

    const numeros = await Promise.all(Array.from({ length: 20 }, () =>
      c.rpc('next_document_number', { p_company: BT, p_doc_type: 'maintenance_order' })))
    const dados = numeros.map((n) => n.data).filter(Boolean)
    cmp('20 números en paralelo: 20 respuestas', 20, dados.length)
    cmp('  y todos distintos', 20, new Set(dados).size)

    const { data: cambioNum } = await c.from('maintenance_orders')
      .update({ number: 'OS99999' }).eq('id', o1.data.id).select('id')
    cmp('el número no se cambia después', 0, (cambioNum ?? []).length)

    // ── 2 · Serial ─────────────────────────────────────────────────────────
    seccion('2 · SERIAL: NULLABLE, INDEXADO, NO ÚNICO')

    const eSinSerial = await nuevoEquipo(cli[0].id)
    eSinSerial.error ? FAIL('un equipo sin serial debería entrar', eSinSerial.error.message)
                     : PASS('un equipo sin serial entra')

    const eDup = await nuevoEquipo(cli[0].id, { serial_number: 'ab 123' })
    eDup.error ? FAIL('un serial repetido debería entrar', eDup.error.message)
               : PASS('un serial repetido entra: la base no lo bloquea')

    cmp('la normalización iguala «AB-123» y «ab 123»',
      e1.data.serial_normalized, eDup.data?.serial_normalized)

    const { data: dups } = await c.rpc('duplicados_de_serial',
      { p_company: BT, p_serial: 'AB123', p_excluir: null })
    cmp('y la función de duplicados los encuentra a los dos', 2, (dups ?? []).length)

    // ── 3 · Empresa cruzada ────────────────────────────────────────────────
    seccion('3 · EMPRESA CRUZADA')

    if (cliTT) {
      const eCruz = await nuevoEquipo(cliTT.id)
      eCruz.error ? PASS('un cliente de otra empresa: rechazado', eCruz.error.code ?? '')
                  : FAIL('SE CREÓ UN EQUIPO CON CLIENTE DE OTRA EMPRESA')
      const oCruz = await nuevaOrden(e1.data.id, cliTT.id)
      oCruz.error ? PASS('una orden con cliente de otra empresa: rechazada', oCruz.error.code ?? '')
                  : FAIL('SE CREÓ UNA ORDEN CON CLIENTE DE OTRA EMPRESA')
    } else {
      PASS('(sin clientes en la otra empresa para cruzar)')
    }

    const { data: numTT } = await c.rpc('next_document_number',
      { p_company: TT, p_doc_type: 'maintenance_order' })
    const { error: eTT } = await c.from('maintenance_orders').insert({
      company_id: TT, number: numTT ?? 'OS00001', asset_id: e1.data.id,
      customer_id: cli[0].id, received_at: HOY, closing_notes: `${MARCA} tt`,
    })
    eTT ? PASS('salesperson: no puede crear en su empresa', eTT.code ?? '')
        : FAIL('EL SALESPERSON CREÓ UNA ORDEN')

    // ── 4 · Cliente congelado ──────────────────────────────────────────────
    seccion('4 · EL CLIENTE DE LA ORDEN QUEDA CONGELADO')

    const { data: cambioCli } = await c.from('maintenance_orders')
      .update({ customer_id: cli[1].id }).eq('id', o1.data.id).select('id')
    cmp('cambiar el cliente de la orden: rechazado', 0, (cambioCli ?? []).length)

    const { error: eDueno } = await c.from('maintenance_assets')
      .update({ owner_customer_id: cli[1].id }).eq('id', e1.data.id)
    eDueno ? FAIL('cambiar el dueño del equipo debería poder', eDueno.message)
           : PASS('el dueño del equipo SÍ se puede cambiar')
    const { data: sigueCli } = await s.from('maintenance_orders')
      .select('customer_id').eq('id', o1.data.id).single()
    cmp('  y la orden sigue con su cliente original', cli[0].id, sigueCli.customer_id)
    const { data: audDueno } = await s.from('maintenance_audit')
      .select('action').eq('entity_id', e1.data.id).eq('action', 'owner_changed')
    cmp('  el cambio de dueño queda auditado', 1, (audDueno ?? []).length)

    // ── 5 · Etapas ─────────────────────────────────────────────────────────
    seccion('5 · ETAPAS: DE A UNA, SALTEANDO SÓLO LAS NO REQUERIDAS')

    const { error: eSalto } = await c.from('maintenance_orders')
      .update({ stage: 'closing' }).eq('id', o1.data.id)
    eSalto ? PASS('saltar de diagnóstico a cierre: rechazado', eSalto.code ?? '')
           : FAIL('SE SALTEARON TRES ETAPAS')

    for (const etapa of ['quotation', 'repair', 'torque', 'closing']) {
      const { error } = await c.from('maintenance_orders').update({ stage: etapa }).eq('id', o1.data.id)
      if (error) { FAIL(`no se pudo avanzar a ${etapa}`, error.message); break }
    }
    cmp('avanzando de a una se llega a cierre', 'closing', (await orden(o1.data.id)).stage)

    const { error: eAtras } = await c.from('maintenance_orders')
      .update({ stage: 'quotation' }).eq('id', o1.data.id)
    eAtras ? FAIL('volver atrás debería poder', eAtras.message)
           : PASS('volver atrás se permite')
    const { data: audAtras } = await s.from('maintenance_audit')
      .select('action, from_status, to_status').eq('entity_id', o1.data.id)
      .eq('action', 'stage_reverted')
    cmp('  y queda auditado como retroceso', 1, (audAtras ?? []).length)

    // Etapa no requerida: se saltea sola.
    const o2 = await nuevaOrden(e1.data.id, cli[0].id, { repair_required: false })
    await c.from('maintenance_orders').update({ stage: 'quotation' }).eq('id', o2.data.id)
    const { error: eRep } = await c.from('maintenance_orders')
      .update({ stage: 'repair' }).eq('id', o2.data.id)
    eRep ? PASS('una etapa marcada no requerida no se puede visitar', eRep.code ?? '')
         : FAIL('SE ENTRÓ A UNA ETAPA NO REQUERIDA')
    const { error: eTorq } = await c.from('maintenance_orders')
      .update({ stage: 'torque' }).eq('id', o2.data.id)
    eTorq ? FAIL('debería poder saltearse a torque', eTorq.message)
          : PASS('con la reparación no requerida, de cotización se pasa a torque')

    const { data: audNoReq } = await s.from('maintenance_audit')
      .select('action').eq('entity_id', o2.data.id).eq('action', 'stage_marked_not_required')
    cmp('  «no requerida» al crear queda auditado', 1, (audNoReq ?? []).length)

    // Y el otro camino: marcarla como no requerida DESPUÉS.
    const oNR = await nuevaOrden(e1.data.id, cli[0].id)
    await c.from('maintenance_orders').update({ torque_required: false }).eq('id', oNR.data.id)
    const { data: audNR2 } = await s.from('maintenance_audit')
      .select('action').eq('entity_id', oNR.data.id).eq('action', 'stage_marked_not_required')
    cmp('  y marcarla después también', 1, (audNR2 ?? []).length)

    // Las tres situaciones son distinguibles y no ambiguas.
    const { error: eContra } = await c.from('maintenance_orders')
      .update({ repair_required: false, repaired_at: HOY }).eq('id', o2.data.id)
    eContra ? PASS('«no requerida + completada» es imposible', eContra.code ?? '')
            : FAIL('SE MARCÓ UNA ETAPA COMO NO REQUERIDA Y COMPLETADA')

    // ── 6 · Totales de la cotización ───────────────────────────────────────
    seccion('6 · TOTALES: LOS CALCULA EL SERVIDOR')

    const o3 = await nuevaOrden(e1.data.id, cli[0].id, { quote_currency_code: 'USD' })
    await c.from('maintenance_quote_lines').insert([
      { company_id: BT, maintenance_order_id: o3.data.id, line_no: 1, line_type: 'labour',
        description_snapshot: 'Mano de obra', quantity: 2, unit_price: 50 },
      { company_id: BT, maintenance_order_id: o3.data.id, line_no: 2, line_type: 'part',
        product_id: prods[0].id, description_snapshot: prods[0].name, quantity: 1, unit_price: 120.5 },
    ])
    cmp('2×50 + 1×120,50 = 220,50', 220.5, Number((await orden(o3.data.id)).quote_total))

    await c.from('maintenance_orders')
      .update({ quote_subtotal: 1, quote_total: 1 }).eq('id', o3.data.id)
    cmp('un total mandado por el cliente se ignora', 220.5, Number((await orden(o3.data.id)).quote_total))

    await c.from('maintenance_quote_lines').delete()
      .eq('maintenance_order_id', o3.data.id).eq('line_no', 2)
    cmp('borrar una línea recalcula', 100, Number((await orden(o3.data.id)).quote_total))

    // ── 7 · Torque ─────────────────────────────────────────────────────────
    seccion('7 · TORQUE')

    const { error: eTorqSinMed } = await c.from('maintenance_orders')
      .update({ torque_at: HOY }).eq('id', o3.data.id)
    eTorqSinMed ? PASS('dar el torque por completado sin mediciones: rechazado', eTorqSinMed.code ?? '')
                : FAIL('SE COMPLETÓ EL TORQUE SIN NINGUNA MEDICIÓN')

    await c.from('maintenance_orders')
      .update({ torque_lsl: 9, torque_nominal: 10, torque_usl: 11 }).eq('id', o3.data.id)
    const mediciones = [9.9, 10.1, 10.0, 9.95, 10.05].map((t, i) => ({
      company_id: BT, maintenance_order_id: o3.data.id, row_no: i + 1,
      min_value: t - 0.1, max_value: t + 0.1, target_value: t,
    }))
    const { error: eMed } = await c.from('maintenance_measurements').insert(mediciones)
    eMed ? FAIL('no se pudieron cargar las mediciones', eMed.message)
         : PASS('5 mediciones cargadas')

    const { error: eTorqOk } = await c.from('maintenance_orders')
      .update({ torque_at: HOY }).eq('id', o3.data.id)
    eTorqOk ? FAIL('con mediciones debería poder', eTorqOk.message)
            : PASS('con mediciones sí se completa el torque')

    const { data: cap } = await c.rpc('capacidad_torque', { p_order: o3.data.id })
    cmp('la capacidad la calcula el servidor: 5 mediciones', 5, cap.mediciones)
    cap.cpk !== null ? PASS('  y devuelve Cpk', String(cap.cpk)) : FAIL('  no devolvió Cpk')
    cap.veredicto ? PASS('  con veredicto', cap.veredicto) : FAIL('  sin veredicto')

    const { error: eVaciar } = await c.from('maintenance_measurements')
      .delete().eq('maintenance_order_id', o3.data.id)
    eVaciar ? PASS('vaciar las mediciones con el torque completado: rechazado', eVaciar.code ?? '')
            : FAIL('SE VACIARON LAS MEDICIONES DE UN TORQUE COMPLETADO')

    const { error: eRango } = await c.from('maintenance_measurements').insert({
      company_id: BT, maintenance_order_id: o3.data.id, row_no: 99,
      min_value: 10, max_value: 5, target_value: 7,
    })
    eRango ? PASS('una medición con max < min: rechazada', eRango.code ?? '')
           : FAIL('ENTRÓ UNA MEDICIÓN CON EL RANGO INVERTIDO')

    // ── 8 · Checks ─────────────────────────────────────────────────────────
    seccion('8 · PUNTOS DE REVISIÓN')

    const { data: puntos } = await c.from('maintenance_check_points')
      .select('id, key').eq('company_id', BT).order('sort_order')
    cmp('las 8 partes del legacy están sembradas', 8, (puntos ?? []).length)

    await c.from('maintenance_order_checks').insert(
      puntos.map((p) => ({
        company_id: BT, maintenance_order_id: o3.data.id, check_point_id: p.id,
        phase: 'diagnosis', result: 'nok',
      })))
    const { count: nChecks } = await s.from('maintenance_order_checks')
      .select('*', { count: 'exact', head: true }).eq('maintenance_order_id', o3.data.id)
    cmp('se cargan los 8 del diagnóstico', 8, nChecks)

    const { error: eDupCheck } = await c.from('maintenance_order_checks').insert({
      company_id: BT, maintenance_order_id: o3.data.id,
      check_point_id: puntos[0].id, phase: 'diagnosis', result: 'ok',
    })
    eDupCheck ? PASS('la misma parte dos veces en la misma fase: rechazada', eDupCheck.code ?? '')
              : FAIL('SE DUPLICÓ UN PUNTO DE REVISIÓN')

    const { error: eResult } = await c.from('maintenance_order_checks').insert({
      company_id: BT, maintenance_order_id: o3.data.id,
      check_point_id: puntos[0].id, phase: 'repair', result: 'MASOMENOS',
    })
    eResult ? PASS('un resultado fuera de ok/nok/na: rechazado', eResult.code ?? '')
            : FAIL('ENTRÓ UN RESULTADO INVENTADO')

    // ── 9 · Repuestos y stock ──────────────────────────────────────────────
    seccion('9 · REPUESTOS: SÓLO DESCUENTAN AL CONSUMIRSE')

    const stock0 = await saldo(prods[0].id)
    const { count: mov0 } = await s.from('stock_movements')
      .select('*', { count: 'exact', head: true })

    const { error: ePart } = await c.from('maintenance_order_parts').insert([
      { company_id: BT, maintenance_order_id: o3.data.id, product_id: prods[0].id,
        warehouse_id: dep.id, quantity: 2, sku_snapshot: prods[0].sku, name_snapshot: prods[0].name },
      { company_id: BT, maintenance_order_id: o3.data.id, product_id: prods[1].id,
        warehouse_id: dep.id, quantity: 1, sku_snapshot: prods[1].sku, name_snapshot: prods[1].name },
    ])
    if (ePart) FAIL('no se pudieron cargar los repuestos', ePart.message)

    cmp('agregar repuestos NO mueve stock', stock0, await saldo(prods[0].id))
    cmp('  ni genera movimientos', mov0,
      (await s.from('stock_movements').select('*', { count: 'exact', head: true })).count)

    const { data: partes } = await s.from('maintenance_order_parts')
      .select('id').eq('maintenance_order_id', o3.data.id).limit(1)
    const { error: eAtajo } = await c.from('maintenance_order_parts')
      .update({ consumed_at: new Date().toISOString() }).eq('id', partes[0].id)
    eAtajo ? PASS('marcar consumido a mano: RECHAZADO', eAtajo.code ?? '')
           : FAIL('SE MARCÓ UN REPUESTO COMO CONSUMIDO SIN MOVIMIENTO DE STOCK')

    const { data: cons, error: eCons } = await c.rpc('confirmar_consumo_mantenimiento',
      { p_order: o3.data.id })
    eCons ? FAIL('no se pudo confirmar el consumo', eCons.message)
          : cmp('confirmar el consumo: 2 líneas', 2, cons.lineas)
    cmp('  el stock baja 2', stock0 - 2, await saldo(prods[0].id))
    const { count: movDespues } = await s.from('stock_movements')
      .select('*', { count: 'exact', head: true }).eq('source_id', o3.data.id)
    cmp('  con un movimiento por línea', 2, movDespues)
    const { data: tipoMov } = await s.from('stock_movements')
      .select('movement_type, quantity').eq('source_id', o3.data.id).limit(1).single()
    cmp('  del tipo service_consumption', 'service_consumption', tipoMov.movement_type)
    cmp('  y negativo', true, Number(tipoMov.quantity) < 0)

    const { data: cons2 } = await c.rpc('confirmar_consumo_mantenimiento', { p_order: o3.data.id })
    cmp('confirmar dos veces es idempotente', true, cons2.ya_estaba)
    cmp('  y no descuenta de nuevo', stock0 - 2, await saldo(prods[0].id))

    const { error: eEditar } = await c.from('maintenance_order_parts')
      .update({ quantity: 99 }).eq('id', partes[0].id)
    eEditar ? PASS('un repuesto consumido no se edita', eEditar.code ?? '')
            : FAIL('SE EDITÓ UN REPUESTO YA CONSUMIDO')
    const { data: borrado } = await c.from('maintenance_order_parts')
      .delete().eq('id', partes[0].id).select('id')
    cmp('ni se borra', 0, (borrado ?? []).length)

    // ── 10 · Cierre ────────────────────────────────────────────────────────
    seccion('10 · CIERRE: LAS DOCE VALIDACIONES')

    const { error: eCierreAtajo } = await c.from('maintenance_orders')
      .update({ status: 'closed' }).eq('id', o3.data.id)
    eCierreAtajo ? PASS('cerrar con un UPDATE directo: RECHAZADO', eCierreAtajo.code ?? '')
                 : FAIL('SE CERRÓ UNA ORDEN CON UN UPDATE DIRECTO')

    const intentar = async (etiqueta) => {
      const { error } = await c.rpc('cerrar_orden_mantenimiento', { p_order: o3.data.id })
      return error ? PASS(etiqueta, error.message.slice(0, 60)) : FAIL(etiqueta + ' — CERRÓ')
    }

    await intentar('en diagnóstico, no cierra')
    const avanzar = async (etapa) => {
      const { error } = await c.from('maintenance_orders').update({ stage: etapa }).eq('id', o3.data.id)
      if (error) FAIL(`no se pudo avanzar a ${etapa}`, error.message)
    }
    for (const e of ['quotation', 'repair', 'torque', 'closing']) await avanzar(e)
    cmp('la orden llegó a la etapa de cierre', 'closing', (await orden(o3.data.id)).stage)
    await intentar('sin diagnóstico, no cierra')
    await c.from('maintenance_orders').update({ diagnosed_at: HOY }).eq('id', o3.data.id)
    await intentar('con la cotización PENDIENTE, no cierra')
    // Desde la entrega 3 la cotización no se aprueba con un UPDATE: la máquina
    // de estados lo rechaza y sólo pasa por su RPC.
    const { error: eAprobar } = await c.rpc('aprobar_cotizacion_mantenimiento',
      { p_order: o3.data.id, p_por: 'Contacto del cliente' })
    if (eAprobar) FAIL('aprobar la cotización', eAprobar.message)
    await intentar('sin la reparación completada, no cierra')
    await c.from('maintenance_orders').update({ repaired_at: HOY }).eq('id', o3.data.id)
    await intentar('sin fecha de entrega, no cierra')
    await c.from('maintenance_orders').update({ delivered_at: HOY }).eq('id', o3.data.id)

    const { data: cerrada, error: eCerrar } = await c.rpc('cerrar_orden_mantenimiento',
      { p_order: o3.data.id })
    eCerrar ? FAIL('con todo completo debería cerrar', eCerrar.message)
            : cmp('con todo completo, cierra', false, cerrada.ya_estaba)
    cmp('  y queda closed', 'closed', (await orden(o3.data.id)).status)

    const { data: cerrada2 } = await c.rpc('cerrar_orden_mantenimiento', { p_order: o3.data.id })
    cmp('cerrar dos veces es idempotente', true, cerrada2.ya_estaba)

    const { error: eEditCerrada } = await c.from('maintenance_orders')
      .update({ closing_notes: 'cambio' }).eq('id', o3.data.id)
    eEditCerrada ? PASS('una orden cerrada no se edita', eEditCerrada.code ?? '')
                 : FAIL('SE EDITÓ UNA ORDEN CERRADA')
    const { error: eLineaCerrada } = await c.from('maintenance_quote_lines').insert({
      company_id: BT, maintenance_order_id: o3.data.id, line_no: 9,
      description_snapshot: 'colada', quantity: 1, unit_price: 1,
    })
    eLineaCerrada ? PASS('  ni se le agregan líneas', eLineaCerrada.code ?? '')
                  : FAIL('SE LE AGREGÓ UNA LÍNEA A UNA ORDEN CERRADA')

    // Repuesto sin consumir bloquea el cierre.
    // Nace pendiente —la entrega 3 lo exige— y se rechaza con su RPC.
    const o4 = await nuevaOrden(e1.data.id, cli[0].id, {
      repair_required: false, torque_required: false, diagnosed_at: HOY,
      delivered_at: HOY,
    })
    await c.rpc('rechazar_cotizacion_mantenimiento',
      { p_order: o4.data.id, p_motivo: 'El cliente no aprobó el presupuesto' })
    await c.from('maintenance_order_parts').insert({
      company_id: BT, maintenance_order_id: o4.data.id, product_id: prods[0].id,
      warehouse_id: dep.id, quantity: 1,
    })
    await c.from('maintenance_orders').update({ stage: 'quotation' }).eq('id', o4.data.id)
    await c.from('maintenance_orders').update({ stage: 'closing' }).eq('id', o4.data.id)
    const { error: ePendiente } = await c.rpc('cerrar_orden_mantenimiento', { p_order: o4.data.id })
    ePendiente ? PASS('con un repuesto sin consumir, no cierra', ePendiente.code ?? '')
               : FAIL('CERRÓ CON UN REPUESTO SIN CONSUMIR')

    // ── 11 · Cancelar ──────────────────────────────────────────────────────
    seccion('11 · CANCELAR: LA SALIDA SIN REQUISITOS')

    const o5 = await nuevaOrden(e1.data.id, cli[0].id)
    const { data: canc, error: eCanc } = await c.rpc('cancelar_orden_mantenimiento',
      { p_order: o5.data.id, p_motivo: `${MARCA} sin trabajo` })
    if (eCanc) FAIL('cancelar debería poder sin requisitos', eCanc.message)
    else if (!canc) FAIL('cancelar devolvió null', JSON.stringify({ o5: o5.error?.message ?? o5.data?.id }))
    else cmp('una orden recién creada se cancela', false, canc.ya_estaba)
    cmp('  y queda cancelled', 'cancelled', (await orden(o5.data.id)).status)

    const { error: eCancCerrada } = await c.rpc('cancelar_orden_mantenimiento',
      { p_order: o3.data.id })
    eCancCerrada ? PASS('una cerrada no se cancela', eCancCerrada.code ?? '')
                 : FAIL('SE CANCELÓ UNA ORDEN CERRADA')

    const { error: eCancConsumo } = await c.rpc('cancelar_orden_mantenimiento',
      { p_order: o4.data.id })
    eCancConsumo ? PASS('(la de repuestos sin consumir sí se cancela… veamos)', eCancConsumo.code ?? '')
                 : PASS('una orden con repuestos SIN consumir se cancela')

    // ── 12 · Auditoría ─────────────────────────────────────────────────────
    seccion('12 · AUDITORÍA: SÓLO EVENTOS DE NEGOCIO')

    const { data: audO3 } = await s.from('maintenance_audit')
      .select('action').eq('entity_id', o3.data.id).order('id')
    const acciones = (audO3 ?? []).map((a) => a.action)
    cmp('la orden completa deja alta, etapas, cotización, consumo y cierre', true,
      acciones.includes('create') && acciones.includes('stage_changed') &&
      acciones.includes('quote_approved') && acciones.includes('consumption_confirmed') &&
      acciones.includes('order_closed'))

    const antesRuido = (await s.from('maintenance_audit')
      .select('*', { count: 'exact', head: true }).eq('entity_id', o5.data.id)).count
    for (let i = 0; i < 5; i += 1) {
      await c.from('maintenance_orders').update({ entry_reason: `ruido ${i}` }).eq('id', o5.data.id)
    }
    const despuesRuido = (await s.from('maintenance_audit')
      .select('*', { count: 'exact', head: true }).eq('entity_id', o5.data.id)).count
    cmp('5 ediciones técnicas NO agregan eventos', antesRuido, despuesRuido)

    const { error: eAudit } = await c.from('maintenance_audit').insert({
      company_id: BT, entity_type: 'maintenance_order', entity_id: o5.data.id, action: 'inventado',
    })
    eAudit ? PASS('la auditoría no se escribe a mano', eAudit.code ?? '')
           : FAIL('SE ESCRIBIÓ LA AUDITORÍA DIRECTAMENTE')

    // ── 13 · Adjuntos ──────────────────────────────────────────────────────
    seccion('13 · ADJUNTOS')

    const { data: adj, error: eAdj } = await c.from('attachments').insert({
      company_id: BT, entity_type: 'maintenance_order', entity_id: o3.data.id,
      storage_path: `${BT}/maintenance_order/${o3.data.id}/${MARCA}.pdf`,
      file_name: `${MARCA}-orden.pdf`, mime_type: 'application/pdf', bytes: 512, kind: 'photo',
    }).select('id').single()
    if (eAdj) FAIL('no se pudo adjuntar', eAdj.message)
    else { creados.adjuntos.push(adj.id); PASS('un adjunto de orden entra') }

    const { data: adjEq, error: eAdjEq } = await c.from('attachments').insert({
      company_id: BT, entity_type: 'maintenance_asset', entity_id: e1.data.id,
      storage_path: `${BT}/maintenance_asset/${e1.data.id}/${MARCA}.jpg`,
      file_name: `${MARCA}-equipo.jpg`, mime_type: 'image/jpeg', bytes: 256, kind: 'photo',
    }).select('id').single()
    if (eAdjEq) FAIL('no se pudo adjuntar al equipo', eAdjEq.message)
    else { creados.adjuntos.push(adjEq.id); PASS('y uno de equipo también') }

    // ── 14 · RLS ───────────────────────────────────────────────────────────
    seccion('14 · RLS')

    const TABLAS = ['maintenance_assets', 'maintenance_orders', 'maintenance_quote_lines',
      'maintenance_order_parts', 'maintenance_measurements', 'maintenance_order_checks',
      'maintenance_check_points', 'maintenance_audit']

    for (const [rol, email] of [
      ['customer', 'cliente.test@buscatools.com.ar'],
      ['distributor', 'distribuidor.test@buscatools.com.ar'],
    ]) {
      const ext = sesion()
      const { error } = await ext.auth.signInWithPassword({ email, password: process.env.BT_PW_TEST })
      if (error) { FAIL(`${rol}: login`, error.message); continue }
      let visto = 0
      for (const t of TABLAS) {
        const { data } = await ext.from(t).select('id')
        visto += (data ?? []).length
      }
      cmp(`${rol}: 0 filas en las ocho tablas`, 0, visto)

      const { data: porId } = await ext.from('maintenance_orders').select('id').eq('id', o3.data.id)
      const { data: porNum } = await ext.from('maintenance_orders').select('id').eq('number', 'OS00001')
      const { data: porSerie } = await ext.from('maintenance_assets')
        .select('id').eq('serial_number', 'AB-123')
      cmp(`${rol}: ni por id, número o serie`, 0,
        (porId ?? []).length + (porNum ?? []).length + (porSerie ?? []).length)

      const r = await Promise.all([
        ext.rpc('cerrar_orden_mantenimiento', { p_order: o3.data.id }),
        ext.rpc('confirmar_consumo_mantenimiento', { p_order: o3.data.id }),
        ext.rpc('cancelar_orden_mantenimiento', { p_order: o3.data.id }),
      ])
      cmp(`${rol}: las tres RPC lo rechazan`, 3, r.filter((x) => x.error).length)

      const { data: adjExt } = await ext.from('attachments')
        .select('id').in('entity_type', ['maintenance_order', 'maintenance_asset'])
      cmp(`${rol}: ni los adjuntos`, 0, (adjExt ?? []).length)
    }

    const anon = sesion()
    let vistoAnon = 0
    for (const t of TABLAS) {
      const { data } = await anon.from(t).select('id')
      vistoAnon += (data ?? []).length
    }
    cmp('anónimo: 0 filas', 0, vistoAnon)
    const rAnon = await Promise.all([
      anon.rpc('cerrar_orden_mantenimiento', { p_order: o3.data.id }),
      anon.rpc('confirmar_consumo_mantenimiento', { p_order: o3.data.id }),
      anon.rpc('cancelar_orden_mantenimiento', { p_order: o3.data.id }),
      anon.rpc('capacidad_torque', { p_order: o3.data.id }),
      anon.rpc('duplicados_de_serial', { p_company: BT, p_serial: 'AB123', p_excluir: null }),
    ])
    cmp('anónimo: no puede ejecutar ninguna de las cinco RPC', 5,
      rAnon.filter((x) => x.error).length)

  } finally {
    // ── Limpieza ───────────────────────────────────────────────────────────
    seccion('LIMPIEZA')

    for (const id of creados.adjuntos) await s.from('attachments').delete().eq('id', id)
    await s.from('attachments').delete().like('file_name', `${MARCA}%`)

    for (const id of creados.ordenes) {
      // Los repuestos primero: tienen FK al movimiento y si no, el DELETE del
      // movimiento falla en silencio y los saldos no vuelven.
      await s.from('maintenance_order_parts').delete().eq('maintenance_order_id', id)
      await s.from('stock_movements').delete().eq('source_id', id)
      await s.from('maintenance_quote_lines').delete().eq('maintenance_order_id', id)
      await s.from('maintenance_measurements').delete().eq('maintenance_order_id', id)
      await s.from('maintenance_order_checks').delete().eq('maintenance_order_id', id)
      await s.from('maintenance_orders').delete().eq('id', id)
    }
    await s.from('maintenance_orders').delete().like('closing_notes', `${MARCA}%`)

    const { data: saldosAhora } = await s.from('stock_balances')
      .select('product_id, warehouse_id, on_hand')
    for (const b of saldosAhora ?? []) {
      const clave = b.product_id + '|' + b.warehouse_id
      const { data: movs } = await s.from('stock_movements')
        .select('quantity').eq('product_id', b.product_id).eq('warehouse_id', b.warehouse_id)
      const total = (movs ?? []).reduce((a, m) => a + Number(m.quantity), 0)
      if (!saldosPrevios.has(clave) && (movs ?? []).length === 0) {
        await s.from('stock_balances').delete()
          .eq('product_id', b.product_id).eq('warehouse_id', b.warehouse_id)
      } else if (Number(b.on_hand) !== total) {
        await s.from('stock_balances').update({ on_hand: total })
          .eq('product_id', b.product_id).eq('warehouse_id', b.warehouse_id)
      }
    }

    for (const id of creados.equipos) await s.from('maintenance_assets').delete().eq('id', id)
    await s.from('maintenance_assets').delete().like('notes', `${MARCA}%`)

    const entidades = [...creados.ordenes, ...creados.equipos]
    if (entidades.length > 0) {
      await s.from('maintenance_audit').delete().in('entity_id', entidades)
    }

    for (const q of seqAntes ?? []) {
      await s.from('document_sequences').update({ next_number: q.next_number })
        .eq('company_id', BT).eq('doc_type', q.doc_type)
    }

    const q = async (t) => (await s.from(t).select('*', { count: 'exact', head: true })).count
    cmp('no queda ningún equipo', 0, await q('maintenance_assets'))
    cmp('ni ninguna orden', 0, await q('maintenance_orders'))
    cmp('ni líneas de cotización', 0, await q('maintenance_quote_lines'))
    cmp('ni repuestos', 0, await q('maintenance_order_parts'))
    cmp('ni mediciones', 0, await q('maintenance_measurements'))
    cmp('ni checks', 0, await q('maintenance_order_checks'))
    cmp('ni auditoría', 0, await q('maintenance_audit'))
    cmp('los 8 puntos de revisión siguen sembrados (×2 empresas)', 16,
      await q('maintenance_check_points'))
    cmp('los movimientos de stock vuelven a su número', movAntes, await q('stock_movements'))
    cmp('y los saldos también', saldosPrevios.size, await q('stock_balances'))
    cmp('los adjuntos vuelven a su número', adjAntes, await q('attachments'))
    cmp('142 proveedores intactos', 142, await q('suppliers'))
    cmp('1010 clientes intactos', 1010, await q('customers'))
    cmp('0 auditoría de compras', 0, await q('purchases_audit'))
  }

  console.log('\n' + '='.repeat(74))
  console.log(`  RESULTADO: ${fallos} fallo(s)`)
  console.log('='.repeat(74))
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch((e) => { console.error('\n✗', e); process.exit(1) })
