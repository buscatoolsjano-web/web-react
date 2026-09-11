/**
 * Fixtures de la entrega 2 para la revisión visual.
 *
 * Crea equipos y órdenes con **la sesión autenticada de un admin**, igual que
 * lo haría la pantalla: con la clave de servicio no hay membresía de empresa,
 * así que `auth.uid()` sería nulo y la auditoría quedaría sin autor. Se crean
 * con las mismas dos llamadas que hacen `crearActivo()` y `crearOrden()`.
 *
 * Limpia con la clave de servicio, por id y por el prefijo `ZZ-UI`, y
 * restaura la numeración a su valor previo.
 *
 *   node scripts/fase7-mantenimiento-entrega2-fixtures.mjs crear
 *   node scripts/fase7-mantenimiento-entrega2-fixtures.mjs limpiar
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET) { console.error('✗ Faltan variables de entorno'); process.exit(1) }

const MARCA = 'ZZ-UI'
const HOY = new Date().toISOString().slice(0, 10)
const SERIES = 'scripts/.fase7-entrega2-series.json'

const s = createClient(BASE, SECRET, { auth: { persistSession: false } })

const empresas = async () => {
  const { data } = await s.from('companies').select('id, slug')
  return { BT: data.find((x) => x.slug === 'buscatools').id }
}

const crear = async () => {
  const c = createClient(BASE, PUB, { auth: { persistSession: false } })
  const { error: eL } = await c.auth.signInWithPassword({
    email: 'buscatools.jano@gmail.com', password: process.env.BT_PW_JANO,
  })
  if (eL) { console.error('✗ login: ' + eL.message); process.exit(1) }

  const { BT } = await empresas()

  const { data: seq } = await s.from('document_sequences')
    .select('doc_type, next_number').eq('company_id', BT)
    .in('doc_type', ['maintenance_asset', 'maintenance_order'])
  writeFileSync(SERIES, JSON.stringify(seq, null, 2))

  const { data: cli } = await s.from('customers')
    .select('id, legal_name').eq('company_id', BT).order('legal_name').limit(3)
  const { data: prod } = await s.from('products')
    .select('id, sku').eq('company_id', BT).ilike('name', '%atornillador%').limit(1)

  const equipo = async (campos) => {
    const { data: ref, error: eN } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'maintenance_asset' })
    if (eN) throw new Error('numeración: ' + eN.message)
    const { data, error } = await c.from('maintenance_assets')
      .insert({ company_id: BT, reference: ref, notes: `${MARCA} fixture`, ...campos })
      .select('id, reference').single()
    if (error) throw new Error('equipo: ' + error.message)
    console.log('  equipo', data.reference)
    return data
  }

  const orden = async (campos) => {
    const { data: num, error: eN } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'maintenance_order' })
    if (eN) throw new Error('numeración: ' + eN.message)
    const { data, error } = await c.from('maintenance_orders')
      .insert({ company_id: BT, number: num, received_at: HOY, ...campos })
      .select('id, number').single()
    if (error) throw new Error('orden: ' + error.message)
    console.log('  orden', data.number)
    return data
  }

  // Uno completo, uno sin serial, uno sin dueño y uno con el serial repetido:
  // las cuatro situaciones que la pantalla tiene que saber mostrar.
  const e1 = await equipo({
    owner_customer_id: cli[0].id, product_id: prod?.[0]?.id ?? null,
    serial_number: 'FEIN-88231-A', model_text: 'ASCD 12-150 W8',
    brand_text: 'FEIN', asset_type: 'Atornillador de pistola',
    city: 'Córdoba', state: 'Córdoba', under_contract: true,
    warranty_start: '2026-01-15', warranty_end: '2027-01-15',
  })
  const e2 = await equipo({
    owner_customer_id: cli[1].id, model_text: 'ASCD 18-1000 W34',
    brand_text: 'FEIN', asset_type: 'Atornillador angular',
  })
  const e3 = await equipo({
    serial_number: 'GEDORE-40021', model_text: 'DREMOMETER A',
    brand_text: 'Gedore', asset_type: 'Llave dinamométrica',
  })
  await equipo({
    owner_customer_id: cli[2].id, serial_number: 'fein 88231 a',
    model_text: 'ASCD 12-150 W8', brand_text: 'FEIN',
    asset_type: 'Atornillador de pistola',
  })

  const o1 = await orden({
    asset_id: e1.id, customer_id: cli[0].id, service_type: 'corrective',
    entry_reason: 'FALLA DE CORTE', visual_condition: 'Carcasa con golpe en el lateral derecho. Viene con batería y cargador.',
    diagnosis_notes: 'No corta el torque programado. Se sospecha del embrague.',
  })
  const o2 = await orden({
    asset_id: e2.id, customer_id: cli[1].id, service_type: 'preventive',
    entry_reason: 'MANTENIMIENTO PREVENTIVO', repair_required: false,
  })
  await orden({
    asset_id: e3.id, customer_id: cli[0].id, service_type: 'general_review',
    entry_reason: 'CALIBRACIÓN TORQUE', repair_required: false, torque_required: true,
  })

  // Una cotización de verdad, para ver el panel con líneas de los dos tipos y
  // un total calculado por el servidor.
  await c.from('maintenance_orders')
    .update({ quote_currency_code: 'ARS' }).eq('id', o1.id)
  const lineas = [
    { line_no: 1, line_type: 'diagnosis', description_snapshot: 'Diagnóstico y desarme', quantity: 1, unit_price: 0 },
    { line_no: 2, line_type: 'labour', description_snapshot: 'Mano de obra: cambio de embrague', quantity: 2.5, unit_price: 18000 },
    { line_no: 3, line_type: 'part', product_id: prod?.[0]?.id ?? null, sku_snapshot: prod?.[0]?.sku ?? null, description_snapshot: 'Embrague de repuesto', quantity: 1, unit_price: 94500 },
    { line_no: 4, line_type: 'freight', description_snapshot: 'Envío a Córdoba', quantity: 1, unit_price: 12000 },
  ]
  for (const l of lineas) {
    const { error } = await c.from('maintenance_quote_lines')
      .insert({ company_id: BT, maintenance_order_id: o1.id, ...l })
    if (error) throw new Error('línea: ' + error.message)
  }
  console.log('  cotización con', lineas.length, 'líneas')

  // Repuestos: uno con costo y moneda, otro sin costo. Ninguno consumido: el
  // panel tiene que mostrar el stock de antes y la proyección.
  const { data: prodsRep } = await s.from('products')
    .select('id, sku, name').eq('company_id', BT).order('sku').limit(2)
  const { data: dep } = await s.from('warehouses')
    .select('id').eq('company_id', BT).eq('is_default', true).single()
  for (const [i, pr] of (prodsRep ?? []).entries()) {
    const { error } = await c.from('maintenance_order_parts').insert({
      company_id: BT, maintenance_order_id: o1.id, product_id: pr.id,
      warehouse_id: dep.id, quantity: i === 0 ? 3 : 1,
      sku_snapshot: pr.sku, name_snapshot: pr.name,
      unit_cost_snapshot: i === 0 ? 41200 : null,
      unit_cost_currency_code: i === 0 ? 'ARS' : null,
    })
    if (error) throw new Error('repuesto: ' + error.message)
  }
  console.log('  repuestos:', (prodsRep ?? []).length)

  // Una cotización ya rechazada, para ver el panel en sólo lectura y el motivo
  // en el historial.
  const { error: eRe } = await c.rpc('rechazar_cotizacion_mantenimiento', {
    p_order: o2.id, p_motivo: 'El cliente prefiere reparar en otro taller',
  })
  if (eRe) throw new Error('rechazo: ' + eRe.message)
  console.log('  cotización rechazada en', o2.number)

  // Una orden con revisiones marcadas y en espera, para ver los dos paneles
  // con datos reales y no vacíos.
  const { data: puntos } = await c.from('maintenance_check_points')
    .select('id, key').eq('company_id', BT).eq('active', true).order('sort_order')
  for (const [i, p] of (puntos ?? []).entries()) {
    await c.from('maintenance_order_checks').insert({
      company_id: BT, maintenance_order_id: o1.id, check_point_id: p.id,
      phase: 'diagnosis', result: i % 3 === 0 ? 'nok' : i % 3 === 1 ? 'ok' : 'na',
    })
  }
  await c.from('maintenance_orders').update({ stage: 'quotation' }).eq('id', o1.id)
  await c.from('maintenance_orders')
    .update({ on_hold: true, on_hold_since: new Date().toISOString() }).eq('id', o1.id)

  console.log('\n✓ fixtures creadas')
}

const limpiar = async () => {
  const { BT } = await empresas()

  const { data: eqs } = await s.from('maintenance_assets')
    .select('id').eq('company_id', BT).like('notes', `${MARCA}%`)
  const ids = (eqs ?? []).map((x) => x.id)

  const { data: ords } = await s.from('maintenance_orders')
    .select('id').eq('company_id', BT).in('asset_id', ids.length ? ids : [BT])
  const oids = (ords ?? []).map((x) => x.id)

  for (const id of oids) {
    await s.from('maintenance_order_checks').delete().eq('maintenance_order_id', id)
    await s.from('maintenance_quote_lines').delete().eq('maintenance_order_id', id)
    await s.from('maintenance_measurements').delete().eq('maintenance_order_id', id)
    // Los repuestos van ANTES que sus movimientos: tienen FK a
    // `stock_movements` y si no, el DELETE del movimiento falla en silencio y
    // los saldos quedan corridos.
    await s.from('maintenance_order_parts').delete().eq('maintenance_order_id', id)
    await s.from('stock_movements').delete().eq('source_id', id)
    await s.from('maintenance_orders').delete().eq('id', id)
  }

  // Un consumo confirmado en una corrida anterior deja su movimiento aunque la
  // orden ya no esté: se barren los de servicio cuya orden no existe. En la
  // base productiva no hay ninguno, así que el barrido es seguro.
  const { data: consumos } = await s.from('stock_movements')
    .select('id, source_id')
    .eq('movement_type', 'service_consumption')
    .eq('source_type', 'maintenance_order')
  const { data: vivas } = await s.from('maintenance_orders').select('id')
  const existentes = new Set((vivas ?? []).map((o) => o.id))
  for (const m of consumos ?? []) {
    if (!existentes.has(m.source_id)) await s.from('stock_movements').delete().eq('id', m.id)
  }

  // Confirmar un consumo mueve stock, así que los saldos se recalculan desde
  // los movimientos que quedaron. Una fila de saldo que nació con estas
  // fixtures —sin ningún movimiento detrás— se borra.
  const { data: saldos } = await s.from('stock_balances')
    .select('product_id, warehouse_id, on_hand')
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
  for (const id of ids) await s.from('maintenance_assets').delete().eq('id', id)

  const entidades = [...oids, ...ids]
  if (entidades.length > 0) {
    await s.from('maintenance_audit').delete().in('entity_id', entidades)
  }

  if (existsSync(SERIES)) {
    for (const q of JSON.parse(readFileSync(SERIES, 'utf8'))) {
      await s.from('document_sequences').update({ next_number: q.next_number })
        .eq('company_id', BT).eq('doc_type', q.doc_type)
    }
    unlinkSync(SERIES)
  }

  const q = async (t) => (await s.from(t).select('*', { count: 'exact', head: true })).count
  console.log('  equipos      ', await q('maintenance_assets'))
  console.log('  órdenes      ', await q('maintenance_orders'))
  console.log('  checks       ', await q('maintenance_order_checks'))
  console.log('  auditoría    ', await q('maintenance_audit'))
  console.log('  puntos       ', await q('maintenance_check_points'))
  console.log('  repuestos    ', await q('maintenance_order_parts'))
  console.log('  cotización   ', await q('maintenance_quote_lines'))
  console.log('  movimientos  ', await q('stock_movements'))
  console.log('  saldos       ', await q('stock_balances'))
  console.log('\n✓ limpio')
}

const modo = process.argv[2]
if (modo === 'crear') await crear()
else if (modo === 'limpiar') await limpiar()
else { console.error('uso: crear | limpiar'); process.exit(1) }
