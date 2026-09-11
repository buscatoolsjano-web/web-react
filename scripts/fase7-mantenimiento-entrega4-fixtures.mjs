/**
 * Fixtures de la entrega 4 para la revisión visual del torque y del cierre.
 *
 * Tres órdenes, cada una detenida en un punto distinto del circuito, para
 * poder mirar en pantalla las tres situaciones que importan:
 *
 *   ZZ-T4 A · torque con las 5 mediciones del caso de regresión → veredicto capaz
 *   ZZ-T4 B · en la etapa de cierre y BLOQUEADA por varias cosas a la vez
 *   ZZ-T4 C · torque NO REQUERIDO, lista para cerrar sin una sola medición
 *
 * Se crean con la sesión de un admin, igual que lo haría la pantalla: con la
 * clave de servicio `auth.uid()` sería nulo y la auditoría quedaría sin autor.
 *
 *   node scripts/fase7-mantenimiento-entrega4-fixtures.mjs crear
 *   node scripts/fase7-mantenimiento-entrega4-fixtures.mjs limpiar
 *
 * NO canalizar por `head`: cierra el pipe y la limpieza no llega a correr.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET) { console.error('✗ Faltan variables de entorno'); process.exit(1) }

const MARCA = 'ZZ-T4'
const HOY = new Date().toISOString().slice(0, 10)
const SERIES = 'scripts/.fase7-entrega4-series.json'

const s = createClient(BASE, SECRET, { auth: { persistSession: false } })

const crear = async () => {
  const c = createClient(BASE, PUB, { auth: { persistSession: false } })
  const { error: eL } = await c.auth.signInWithPassword({
    email: 'buscatools.jano@gmail.com', password: process.env.BT_PW_JANO,
  })
  if (eL) { console.error('✗ login: ' + eL.message); process.exit(1) }

  const { data: comps } = await s.from('companies').select('id, slug')
  const BT = comps.find((x) => x.slug === 'buscatools').id

  // El baseline se guarda UNA vez. Si un `crear` anterior falló después de
  // pedir un número —y pedirlo ya mueve la secuencia—, el valor de ahora no es
  // el original: sobrescribir el archivo enterraría el bueno y `limpiar`
  // restauraría a un número ya corrido.
  if (!existsSync(SERIES)) {
    const { data: seq } = await s.from('document_sequences')
      .select('doc_type, next_number').eq('company_id', BT)
      .in('doc_type', ['maintenance_asset', 'maintenance_order'])
    writeFileSync(SERIES, JSON.stringify(seq, null, 2))
  } else {
    console.log('(hay un baseline de numeración guardado: se conserva)')
  }

  const { data: cli } = await s.from('customers')
    .select('id, legal_name').eq('company_id', BT).order('legal_name').limit(1)
  const { data: prod } = await s.from('products')
    .select('id, sku').eq('company_id', BT).order('sku').limit(1)
  const { data: dep } = await s.from('warehouses')
    .select('id').eq('company_id', BT).eq('is_default', true).single()

  const orden = async (etiqueta, campos) => {
    const { data: ref } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'maintenance_asset' })
    const { data: eq, error: eE } = await c.from('maintenance_assets')
      .insert({ company_id: BT, reference: ref, notes: `${MARCA} fixture`,
                brand_text: 'Fein', model_text: 'ASCD 18-1000 W34' })
      .select('id, reference').single()
    if (eE) throw new Error('equipo: ' + eE.message)

    const { data: num } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'maintenance_order' })
    const { data: o, error: eO } = await c.from('maintenance_orders').insert({
      company_id: BT, number: num, asset_id: eq.id, customer_id: cli[0].id,
      service_type: 'corrective', received_at: HOY,
      entry_reason: `${MARCA} ${etiqueta}`, ...campos,
    }).select('id, number').single()
    if (eO) throw new Error('orden: ' + eO.message)
    return o
  }

  // A · torque cargado con el caso de regresión: Cpk 4,2164, veredicto capaz.
  const a = await orden('A · torque con mediciones', {
    torque_lsl: 9, torque_nominal: 10, torque_usl: 11, repair_required: false,
  })
  await c.from('maintenance_orders').update({
    diagnosis_notes: 'Par de apriete fuera de especificación según el cliente.',
    diagnosed_at: HOY,
  }).eq('id', a.id)
  await c.rpc('rechazar_cotizacion_mantenimiento', { p_order: a.id })
  await c.from('maintenance_measurements').insert(
    [9.9, 10.1, 10.0, 9.95, 10.05].map((v, i) => ({
      company_id: BT, maintenance_order_id: a.id, row_no: i + 1, target_value: v,
    })))
  await c.from('maintenance_orders').update({ stage: 'quotation' }).eq('id', a.id)
  await c.from('maintenance_orders').update({ stage: 'torque' }).eq('id', a.id)

  // B · en la etapa de cierre y bloqueada por varias cosas a la vez, para ver
  //     que la pantalla enumera TODO lo que falta y no sólo lo primero.
  const b = await orden('B · cierre bloqueado', {
    torque_lsl: 40, torque_nominal: 45, torque_usl: 50,
  })
  await c.from('maintenance_orders').update({ stage: 'quotation' }).eq('id', b.id)
  await c.from('maintenance_orders').update({ quote_currency_code: 'ARS' }).eq('id', b.id)
  await c.from('maintenance_quote_lines').insert({
    company_id: BT, maintenance_order_id: b.id, line_no: 1, line_type: 'labour',
    description_snapshot: 'Mano de obra de taller', quantity: 2, unit_price: 18000,
  })
  await c.rpc('aprobar_cotizacion_mantenimiento', { p_order: b.id, p_por: 'Cliente' })
  await c.from('maintenance_orders').update({ stage: 'repair' }).eq('id', b.id)
  await c.from('maintenance_order_parts').insert({
    company_id: BT, maintenance_order_id: b.id, product_id: prod[0].id,
    warehouse_id: dep.id, quantity: 1,
  })

  // C · torque no requerido: cierra sin una sola medición.
  const cc = await orden('C · lista para cerrar, sin torque', {
    torque_required: false, repair_required: false,
  })
  await c.from('maintenance_orders').update({
    diagnosis_notes: 'Revisión general. Sin trabajo de reparación.',
    diagnosed_at: HOY, delivered_at: HOY,
  }).eq('id', cc.id)
  await c.rpc('rechazar_cotizacion_mantenimiento', { p_order: cc.id })
  await c.from('maintenance_orders').update({ stage: 'quotation' }).eq('id', cc.id)
  await c.from('maintenance_orders').update({ stage: 'closing' }).eq('id', cc.id)

  console.log(`A · torque con mediciones        ${a.number}  ${a.id}`)
  console.log(`B · cierre bloqueado             ${b.number}  ${b.id}`)
  console.log(`C · lista para cerrar sin torque ${cc.number}  ${cc.id}`)
}

const limpiar = async () => {
  const { data: ordenes } = await s.from('maintenance_orders')
    .select('id').like('entry_reason', `${MARCA}%`)
  const ids = (ordenes ?? []).map((o) => o.id)

  for (const id of ids) {
    await s.from('maintenance_order_parts').delete().eq('maintenance_order_id', id)
    await s.from('stock_movements').delete().eq('source_id', id)
    await s.from('maintenance_quote_lines').delete().eq('maintenance_order_id', id)
    await s.from('maintenance_measurements').delete().eq('maintenance_order_id', id)
    await s.from('maintenance_order_checks').delete().eq('maintenance_order_id', id)
    await s.from('maintenance_orders').delete().eq('id', id)
  }
  await s.from('maintenance_assets').delete().like('notes', `${MARCA}%`)
  await s.from('maintenance_audit').delete().gte('id', 0)

  // Los saldos vuelven a ser la suma de los movimientos que quedan, y una fila
  // de saldo que nació con un fixture y se quedó sin movimientos se borra.
  const { data: saldos } = await s.from('stock_balances').select('product_id, warehouse_id, on_hand')
  for (const b of saldos ?? []) {
    const { data: ms } = await s.from('stock_movements').select('quantity')
      .eq('product_id', b.product_id).eq('warehouse_id', b.warehouse_id)
    const total = (ms ?? []).reduce((a, m) => a + Number(m.quantity), 0)
    if ((ms ?? []).length === 0) {
      await s.from('stock_balances').delete()
        .eq('product_id', b.product_id).eq('warehouse_id', b.warehouse_id)
    } else if (Number(b.on_hand) !== total) {
      await s.from('stock_balances').update({ on_hand: total })
        .eq('product_id', b.product_id).eq('warehouse_id', b.warehouse_id)
    }
  }

  if (existsSync(SERIES)) {
    const { data: comps } = await s.from('companies').select('id, slug')
    const BT = comps.find((x) => x.slug === 'buscatools').id
    for (const x of JSON.parse(readFileSync(SERIES, 'utf8'))) {
      await s.from('document_sequences').update({ next_number: x.next_number })
        .eq('company_id', BT).eq('doc_type', x.doc_type)
    }
    unlinkSync(SERIES)
  }

  const q = async (t) => (await s.from(t).select('*', { count: 'exact', head: true })).count
  console.log(`equipos ${await q('maintenance_assets')} · órdenes ${await q('maintenance_orders')}` +
    ` · mediciones ${await q('maintenance_measurements')} · auditoría ${await q('maintenance_audit')}` +
    ` · movimientos ${await q('stock_movements')} · saldos ${await q('stock_balances')}`)
}

const accion = process.argv[2]
if (accion === 'crear') crear().catch((e) => { console.error('✗', e); process.exit(1) })
else if (accion === 'limpiar') limpiar().catch((e) => { console.error('✗', e); process.exit(1) })
else { console.error('uso: crear | limpiar'); process.exit(1) }
