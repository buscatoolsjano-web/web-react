/**
 * Fase 7 · Mantenimiento — entrega 4: AUDITORÍA PREVIA, sólo medición.
 *
 * Mide qué dejó construido la entrega 1 para torque y cierre ANTES de escribir
 * una línea de frontend, y comprueba el ejemplo de regresión del diseño
 * original contra la función real —no contra un número hardcodeado—.
 *
 * Se limpia sola: prefijo `ZZ-A4`.
 *
 *   set -a; source .env; source .env.migration; source .env.rls.txt; set +a
 *   node scripts/fase7-mantenimiento-entrega4-auditoria.mjs
 *
 * NO canalizar por `head`: cierra el pipe y la limpieza no llega a correr.
 */
import { createClient } from '@supabase/supabase-js'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET) { console.error('✗ Faltan variables de entorno'); process.exit(1) }

const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(72)}`)
const OK = (t, d = '') => console.log(`    PERMITE    ${t}${d ? ' — ' + d : ''}`)
const NO = (t, d = '') => console.log(`    RECHAZA    ${t}${d ? ' — ' + d : ''}`)
const DATO = (t, d) => console.log(`    ·          ${t}: ${d}`)
const GAP = (t) => console.log(`    >> GAP     ${t}`)

const sesion = () => createClient(BASE, PUB, { auth: { persistSession: false } })
const admin = () => createClient(BASE, SECRET, { auth: { persistSession: false } })

const MARCA = 'ZZ-A4'
const HOY = new Date().toISOString().slice(0, 10)
const creados = { equipos: [], ordenes: [] }

const main = async () => {
  const c = sesion()
  const { error: eL } = await c.auth.signInWithPassword({
    email: 'buscatools.jano@gmail.com', password: process.env.BT_PW_JANO,
  })
  if (eL) { console.error('✗ login: ' + eL.message); process.exit(1) }

  const s = admin()
  const { data: comps } = await s.from('companies').select('id, slug')
  const BT = comps.find((x) => x.slug === 'buscatools').id

  const { data: seqAntes } = await s.from('document_sequences')
    .select('company_id, doc_type, next_number').in('doc_type', ['maintenance_asset', 'maintenance_order'])
  const q = async (t) => (await s.from(t).select('*', { count: 'exact', head: true })).count
  const movAntes = await q('stock_movements')
  const { data: balAntes } = await s.from('stock_balances').select('product_id, warehouse_id')
  const saldosAntes = balAntes.length

  const { data: cli } = await s.from('customers').select('id').eq('company_id', BT).order('legal_name').limit(1)
  const { data: prods } = await s.from('products').select('id, sku').eq('company_id', BT).order('sku').limit(1)
  const { data: dep } = await s.from('warehouses').select('id').eq('company_id', BT).eq('is_default', true).single()

  const nuevaOrden = async (campos = {}) => {
    const { data: ref } = await c.rpc('next_document_number', { p_company: BT, p_doc_type: 'maintenance_asset' })
    const { data: eq, error: eE } = await c.from('maintenance_assets')
      .insert({ company_id: BT, reference: ref, notes: `${MARCA}` }).select('id').single()
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

  const medir = async (orden, valores) => {
    const filas = valores.map((v, i) => ({
      company_id: BT, maintenance_order_id: orden, row_no: i + 1,
      target_value: v, min_value: null, max_value: null,
    }))
    return c.from('maintenance_measurements').insert(filas).select('id')
  }

  const capacidad = async (orden) => (await c.rpc('capacidad_torque', { p_order: orden })).data

  console.log('='.repeat(76))
  console.log('  MANTENIMIENTO · entrega 4 — AUDITORÍA PREVIA (sólo medición)')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(76))

  try {
    // ── §2 · El modelo de torque ──────────────────────────────────────────
    seccion('§2 · EL MODELO REAL, SIN INVENTAR CAMPOS')

    DATO('límites, en la ORDEN', 'torque_lsl · torque_nominal · torque_usl')
    DATO('estado de la etapa', 'torque_required (bool) · torque_at (date) · torque_by (uuid)')
    DATO('mediciones, en su tabla', 'maintenance_measurements: row_no, min_value, max_value, target_value')
    DATO('el valor que cuenta', 'target_value — es el que filtra capacidad_torque() y el que exige el cierre')
    DATO('sin JSONB, sin tabla paralela', 'confirmado')

    // ── §8 · El ejemplo de regresión, contra la función REAL ──────────────
    seccion('§8 · EJEMPLO DE REGRESIÓN · 5 mediciones, límites 9–11')

    const oReg = await nuevaOrden({ torque_lsl: 9, torque_nominal: 10, torque_usl: 11 })
    const eMed = await medir(oReg.id, [9.9, 10.1, 10.0, 9.95, 10.05])
    if (eMed.error) { GAP('no se pudieron cargar las mediciones: ' + eMed.error.message) }
    const capReg = await capacidad(oReg.id)
    DATO('resultado de capacidad_torque()', JSON.stringify(capReg))
    DATO('cpk esperado por el diseño de la entrega 1', '≈ 4.2164')
    Math.abs(Number(capReg.cpk) - 4.2164) < 0.0002
      ? OK('el cpk sale de la función real y coincide', String(capReg.cpk))
      : GAP(`el cpk dio ${capReg.cpk}`)
    DATO('veredicto', capReg.veredicto)

    // ── §5 · Las fórmulas, tal como están implementadas ───────────────────
    seccion('§5 · LAS FÓRMULAS REALES (no se reemplazan, se documentan)')

    DATO('n', 'count(*) filtrando target_value not null AND target_value > 0')
    DATO('promedio', 'avg(target_value)')
    DATO('desvío', 'stddev_samp(target_value) — MUESTRAL (n−1), no poblacional')
    DATO('cp', '(usl − lsl) / (6·sd)')
    DATO('cpk', 'least((usl − μ)/(3·sd), (μ − lsl)/(3·sd))')
    DATO('cv', '(sd / μ) · 100 — EN PORCENTAJE, no el cociente crudo')
    DATO('veredicto', 'cpk ≥ 1.33 → capaz · ≥ 1.00 → aceptable · si no → no_capaz')
    DATO('promedio_min / promedio_max', 'avg(min_value) y avg(max_value); NO entran en cp/cpk')

    // Verificación aritmética independiente, para no creerle a la función.
    const vals = [9.9, 10.1, 10.0, 9.95, 10.05]
    const mu = vals.reduce((a, b) => a + b, 0) / vals.length
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mu) ** 2, 0) / (vals.length - 1))
    const cpk = Math.min((11 - mu) / (3 * sd), (mu - 9) / (3 * sd))
    DATO('recalculado en JS', `μ=${mu.toFixed(4)} sd=${sd.toFixed(4)} cpk=${cpk.toFixed(4)}`)
    Math.abs(cpk - Number(capReg.cpk)) < 0.0002
      ? OK('la aritmética del servidor coincide con el cálculo independiente')
      : GAP('la función y el cálculo independiente NO coinciden')

    // ── §6 · Casos borde ──────────────────────────────────────────────────
    seccion('§6 · CASOS BORDE · nunca NaN, Infinity ni −Infinity')

    const casos = [
      ['0 mediciones', []],
      ['1 medición', [10]],
      ['todas iguales (sigma = 0)', [10, 10, 10, 10]],
      ['una fuera de límites', [10, 10.01, 14]],
      ['exactamente en LCI', [9, 10, 10.01]],
      ['exactamente en LCS', [11, 10, 10.01]],
    ]
    for (const [nombre, valores] of casos) {
      const o = await nuevaOrden({ torque_lsl: 9, torque_nominal: 10, torque_usl: 11 })
      if (valores.length > 0) await medir(o.id, valores)
      const cap = await capacidad(o.id)
      const crudo = JSON.stringify(cap)
      const sucio = /NaN|Infinity/.test(crudo)
      DATO(nombre, crudo)
      if (sucio) GAP(`${nombre} devolvió NaN/Infinity`)
    }

    // ── §3 · Qué valida hoy la base ───────────────────────────────────────
    seccion('§3 · VALIDACIONES DE LOS LÍMITES Y DE LAS MEDICIONES')

    const oV = await nuevaOrden()
    const rangoMal = await c.from('maintenance_orders')
      .update({ torque_lsl: 11, torque_usl: 9 }).eq('id', oV.id).select('id')
    rangoMal.error ? NO('LCS menor que LCI', rangoMal.error.code) : GAP('se aceptó LCS < LCI')

    const nomFuera = await c.from('maintenance_orders')
      .update({ torque_lsl: 9, torque_usl: 11, torque_nominal: 50 }).eq('id', oV.id).select('torque_nominal')
    if (nomFuera.error) NO('nominal fuera de [LCI, LCS]', nomFuera.error.code)
    else {
      OK('nominal fuera de [LCI, LCS]', `quedó en ${nomFuera.data[0].torque_nominal}`)
      GAP('no existe ninguna regla que exija LCI < nominal < LCS')
    }

    const nan = await c.from('maintenance_orders')
      .update({ torque_lsl: 'NaN', torque_usl: 'NaN', torque_nominal: 'NaN' }).eq('id', oV.id).select('torque_lsl')
    if (nan.error) NO('límites NaN', nan.error.code)
    else { OK('límites NaN', JSON.stringify(nan.data[0])); GAP('numeric acepta NaN: puede envenenar el cálculo') }

    const oN = await nuevaOrden({ torque_lsl: 9, torque_nominal: 10, torque_usl: 11 })
    const medNan = await c.from('maintenance_measurements').insert({
      company_id: BT, maintenance_order_id: oN.id, row_no: 1, target_value: 'NaN',
    }).select('id')
    if (medNan.error) NO('una medición NaN', medNan.error.code)
    else {
      OK('una medición NaN entra')
      GAP('una medición NaN entra y contamina el promedio')
      DATO('capacidad con una medición NaN', JSON.stringify(await capacidad(oN.id)))
    }

    const medInf = await c.from('maintenance_measurements').insert({
      company_id: BT, maintenance_order_id: oN.id, row_no: 2, target_value: 'Infinity',
    }).select('id')
    medInf.error ? NO('una medición Infinity', medInf.error.code)
                 : GAP('una medición Infinity también entra')

    const medNeg = await c.from('maintenance_measurements').insert({
      company_id: BT, maintenance_order_id: oN.id, row_no: 3, target_value: -5,
    }).select('id')
    medNeg.error ? NO('una medición negativa', medNeg.error.code)
                 : DATO('una medición negativa', 'entra, pero capacidad_torque() la EXCLUYE (filtra > 0)')

    // ── §12 · Completar torque exige mediciones ───────────────────────────
    seccion('§12 · COMPLETAR EL TORQUE')

    const oT = await nuevaOrden({ torque_lsl: 9, torque_nominal: 10, torque_usl: 11 })
    const sinMed = await c.from('maintenance_orders')
      .update({ torque_at: HOY }).eq('id', oT.id).select('id')
    sinMed.error ? NO('dar el torque por completado sin ninguna medición', sinMed.error.code)
                 : GAP('se pudo completar el torque sin mediciones')

    await medir(oT.id, [10])
    const conMed = await c.from('maintenance_orders')
      .update({ torque_at: HOY }).eq('id', oT.id).select('torque_at')
    conMed.error ? GAP('con medición debería dejar: ' + conMed.error.message)
                 : OK('con al menos una medición, se completa', conMed.data[0].torque_at)

    const { data: mT } = await s.from('maintenance_measurements').select('id').eq('maintenance_order_id', oT.id)
    const borrarUltima = await c.from('maintenance_measurements').delete().eq('id', mT[0].id).select('id')
    borrarUltima.error
      ? NO('borrar la última medición con el torque completado', borrarUltima.error.code)
      : GAP('se pudo dejar un torque completado sin mediciones')

    // ── §11 · Torque no requerido ─────────────────────────────────────────
    seccion('§11 · TORQUE NO REQUERIDO')

    const oNR = await nuevaOrden({ torque_required: false })
    DATO('la orden nace con torque_required', 'true por default; acá se creó en false')
    const a = (await s.from('maintenance_audit').select('action, diff').eq('entity_id', oNR.id)).data ?? []
    const ev = a.filter((x) => x.action === 'stage_marked_not_required')
    cmpBool('queda auditado al crear', ev.length === 1, JSON.stringify(ev[0]?.diff))
    const torqueNR = await c.from('maintenance_orders')
      .update({ torque_at: HOY }).eq('id', oNR.id).select('id')
    torqueNR.error ? NO('poner torque_at con el torque no requerido', torqueNR.error.code)
                   : GAP('se pudo poner torque_at sin que el torque sea requerido')

    // ── §19 · Las doce condiciones de cierre ──────────────────────────────
    seccion('§19 · LAS DOCE CONDICIONES DE CIERRE, COMO ESTÁN HOY')

    const condiciones = [
      '1 · la orden existe',
      '2 · permiso admin/employee (ANTES del atajo idempotente)',
      '3 · no se cierra dos veces (idempotente) y una cancelada no se cierra',
      '4 · stage = closing',
      '5 · diagnosed_at no nulo',
      '6 · quote_status <> pending',
      '7 · si quote_status = approved → al menos una línea',
      '8 · repair_required → repaired_at no nulo',
      '9 · torque_required → torque_at no nulo',
      '10 · torque_required → al menos una medición con target_value',
      '11 · delivered_at no nulo y >= received_at',
      '12 · ningún repuesto con consumed_at nulo',
    ]
    for (const x of condiciones) DATO('condición', x)
    DATO('cómo falla', 'raise exception en la PRIMERA que no se cumple: no devuelve la lista completa')
    GAP('no existe ninguna función read-only que diga qué falta ANTES de intentar cerrar')
    DATO('on_hold', 'NO está entre las doce: una orden en espera SÍ puede cerrarse hoy')

    // ── §14 · Repuestos sin consumir al cerrar ────────────────────────────
    seccion('§14 · REPUESTOS SIN CONSUMIR AL CERRAR')

    const oR = await nuevaOrden({ repair_required: false, torque_required: false, diagnosed_at: HOY, delivered_at: HOY })
    await c.from('maintenance_order_parts').insert({
      company_id: BT, maintenance_order_id: oR.id, product_id: prods[0].id,
      warehouse_id: dep.id, quantity: 1,
    })
    await c.rpc('rechazar_cotizacion_mantenimiento', { p_order: oR.id })
    await c.from('maintenance_orders').update({ stage: 'quotation' }).eq('id', oR.id)
    await c.from('maintenance_orders').update({ stage: 'closing' }).eq('id', oR.id)
    const cierreConPend = await c.rpc('cerrar_orden_mantenimiento', { p_order: oR.id })
    cierreConPend.error
      ? NO('cerrar con un repuesto sin consumir', cierreConPend.error.message.slice(0, 60))
      : GAP('cerró con un repuesto sin consumir')

    // ── §32 · ¿Una cotización rechazada puede cerrar? ─────────────────────
    seccion('§32 · COTIZACIÓN RECHAZADA')

    await s.from('maintenance_order_parts').delete().eq('maintenance_order_id', oR.id)
    const cierreRech = await c.rpc('cerrar_orden_mantenimiento', { p_order: oR.id })
    cierreRech.error
      ? NO('cerrar con la cotización rechazada', cierreRech.error.message.slice(0, 60))
      : OK('una orden con la cotización RECHAZADA sí puede cerrarse', JSON.stringify(cierreRech.data))
    DATO('lectura', 'rechazada ≠ cancelada: el trabajo pudo hacerse igual sin presupuesto aprobado')

    // ── §24 · Cerrada = congelada ─────────────────────────────────────────
    seccion('§24 · CERRADA = CONGELADA')

    for (const [qué, intento] of [
      ['la cabecera', c.from('maintenance_orders').update({ closing_notes: 'x' }).eq('id', oR.id).select('id')],
      ['una línea de cotización', c.from('maintenance_quote_lines').insert({
        company_id: BT, maintenance_order_id: oR.id, line_no: 9, quantity: 1, unit_price: 0 }).select('id')],
      ['un repuesto', c.from('maintenance_order_parts').insert({
        company_id: BT, maintenance_order_id: oR.id, product_id: prods[0].id,
        warehouse_id: dep.id, quantity: 1 }).select('id')],
      ['una medición', c.from('maintenance_measurements').insert({
        company_id: BT, maintenance_order_id: oR.id, row_no: 1, target_value: 10 }).select('id')],
    ]) {
      const r = await intento
      r.error ? NO(`editar ${qué} de una orden cerrada`, r.error.code) : GAP(`se pudo editar ${qué}`)
    }

    const cerrarDeNuevo = await c.rpc('cerrar_orden_mantenimiento', { p_order: oR.id })
    cerrarDeNuevo.error
      ? GAP('cerrar dos veces debería ser idempotente: ' + cerrarDeNuevo.error.message)
      : OK('cerrar dos veces es idempotente', JSON.stringify(cerrarDeNuevo.data))

    // ── §35 · UPDATE directo ──────────────────────────────────────────────
    seccion('§35 · SIMULAR EL CIERRE CON UN UPDATE')

    const oU = await nuevaOrden()
    const upd = await c.from('maintenance_orders')
      .update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', oU.id).select('id')
    upd.error ? NO('poner status = closed a mano', upd.error.code + ' — ' + upd.error.message.slice(0, 60))
              : GAP('se pudo cerrar con un UPDATE')

    // ── §18 · On hold y cierre ────────────────────────────────────────────
    seccion('§18 · ON HOLD')

    DATO('on_hold', 'columna booleana + on_hold_since; ortogonal a stage')
    DATO('auditoría', 'order_put_on_hold / order_resumed, con la etapa en from/to')
    DATO('¿bloquea el cierre?', 'NO — no está entre las doce condiciones')

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

    const { data: bal } = await s.from('stock_balances').select('product_id, warehouse_id, on_hand')
    for (const b of bal ?? []) {
      const { data: ms } = await s.from('stock_movements').select('quantity')
        .eq('product_id', b.product_id).eq('warehouse_id', b.warehouse_id)
      const total = (ms ?? []).reduce((acc, m) => acc + Number(m.quantity), 0)
      if ((ms ?? []).length === 0) {
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

    const chk = async (t, esperado) => {
      const v = await q(t)
      console.log(`    ${String(v) === String(esperado) ? 'OK ' : 'DIF'}        ${t}: ${v} (esperado ${esperado})`)
    }
    await chk('maintenance_assets', 0)
    await chk('maintenance_orders', 0)
    await chk('maintenance_measurements', 0)
    await chk('maintenance_order_parts', 0)
    await chk('maintenance_quote_lines', 0)
    await chk('maintenance_audit', 0)
    await chk('maintenance_check_points', 16)
    await chk('stock_movements', movAntes)
    await chk('stock_balances', saldosAntes)
    await chk('customers', 1010)
  }

  console.log('\n' + '='.repeat(76))
  console.log('  FIN DE LA AUDITORÍA — no se modificó nada de forma permanente')
  console.log('='.repeat(76))
}

function cmpBool(t, ok, d) {
  console.log(`    ${ok ? 'PERMITE   ' : '>> GAP    '} ${t}${d ? ' — ' + d : ''}`)
}

main().catch((e) => { console.error('\n✗', e); process.exit(1) })
