/**
 * Fase 7 · Mantenimiento — entrega 2: equipos, órdenes y configuración base.
 *
 * Prueba **exactamente lo que hace la UI de esta entrega**, con las mismas
 * llamadas que hace el navegador y con JWT reales. Cada prohibición se prueba
 * con un INTENTO REAL midiendo el EFECTO además del código: con PostgREST una
 * operación prohibida puede devolver «éxito» con cero filas.
 *
 * Se limpia sola: prefijo `ZZ-M2`.
 *
 *   set -a; source .env; source .env.migration; source .env.rls.txt; set +a
 *   node scripts/fase7-mantenimiento-entrega2-tests.mjs
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

const MARCA = 'ZZ-M2'
const HOY = new Date().toISOString().slice(0, 10)
const creados = { equipos: [], ordenes: [], puntos: [], empresas: [], membresias: [] }

const main = async () => {
  const c = sesion()
  const { data: login, error: eL } = await c.auth.signInWithPassword({
    email: 'buscatools.jano@gmail.com',
    password: process.env.BT_PW_JANO,
  })
  if (eL) { console.error('✗ login: ' + eL.message); process.exit(1) }
  const JANO = login.user.id

  const s = admin()
  const { data: comps } = await s.from('companies').select('id, slug')
  const BT = comps.find((x) => x.slug === 'buscatools').id
  const TT = comps.find((x) => x.slug === 'torquetools').id

  // Estado previo, para devolver todo exactamente a su número.
  const { data: seqAntes } = await s.from('document_sequences')
    .select('company_id, doc_type, next_number')
    .in('doc_type', ['maintenance_asset', 'maintenance_order'])
  const q = async (t) => (await s.from(t).select('*', { count: 'exact', head: true })).count
  const puntosAntes = await q('maintenance_check_points')
  const empresasAntes = await q('companies')

  const { data: prods } = await s.from('products')
    .select('id, sku').eq('company_id', BT).order('sku').limit(1)
  const { data: cli } = await s.from('customers')
    .select('id, legal_name').eq('company_id', BT).order('legal_name').limit(2)
  const CLI_A = cli[0]
  const CLI_B = cli[1]

  console.log('='.repeat(74))
  console.log('  MANTENIMIENTO · entrega 2 — equipos, órdenes y configuración')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(74))

  // Alta de equipo con las MISMAS dos llamadas que hace `crearActivo()`.
  const nuevoEquipo = async (campos = {}) => {
    const { data: ref, error: eN } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'maintenance_asset' })
    if (eN) return { error: eN }
    const r = await c.from('maintenance_assets').insert({
      company_id: BT, reference: ref, notes: `${MARCA} equipo`, ...campos,
    }).select('*').single()
    if (r.data) creados.equipos.push(r.data.id)
    return r
  }

  const nuevaOrden = async (campos = {}) => {
    const { data: num, error: eN } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'maintenance_order' })
    if (eN) return { error: eN }
    const r = await c.from('maintenance_orders').insert({
      company_id: BT, number: num, service_type: 'corrective', received_at: HOY,
      entry_reason: `${MARCA} FALLA DE CORTE`, ...campos,
    }).select('*').single()
    if (r.data) creados.ordenes.push(r.data.id)
    return r
  }

  const auditoriaDe = async (id) => {
    const { data } = await s.from('maintenance_audit')
      .select('action, from_status, to_status, diff').eq('entity_id', id).order('id')
    return data ?? []
  }

  try {
    // ── 1 · Alta de equipo con cliente y producto ─────────────────────────
    seccion('1 · ALTA DE EQUIPO CON CLIENTE Y PRODUCTO')

    const e1 = await nuevoEquipo({
      owner_customer_id: CLI_A.id, product_id: prods[0].id,
      serial_number: `${MARCA}-SERIE-001`, model_text: 'ASCD 12-150',
      brand_text: 'FEIN', asset_type: 'Atornillador', city: 'Córdoba',
    })
    if (e1.error) FAIL('alta con cliente y producto', e1.error.message)
    else {
      PASS('alta con cliente y producto', e1.data.reference)
      cmp('la referencia la emitió la numeración, no un MAX+1',
        true, /^EQ\d{5}$/.test(e1.data.reference))
      cmp('el dueño quedó guardado', CLI_A.id, e1.data.owner_customer_id)
      cmp('y el producto también', prods[0].id, e1.data.product_id)
      cmp('el serial se normalizó del lado del servidor',
        `${MARCA}-SERIE-001`.toUpperCase().replace(/[\s-]/g, ''), e1.data.serial_normalized)
      const a = await auditoriaDe(e1.data.id)
      cmp('quedó auditada el alta del equipo', 1, a.filter((x) => x.action === 'create').length)
    }

    // ── 2 · Equipo sin serial ─────────────────────────────────────────────
    seccion('2 · EQUIPO SIN SERIAL')

    const e2 = await nuevoEquipo({ owner_customer_id: CLI_A.id, model_text: 'Sin serie' })
    if (e2.error) FAIL('un equipo sin serial tiene que entrar', e2.error.message)
    else {
      PASS('un equipo sin serial entra', e2.data.reference)
      cmp('el serial queda nulo, no en blanco', null, e2.data.serial_number)
      cmp('y el normalizado también', null, e2.data.serial_normalized)
    }

    // ── 3 · Equipo sin dueño ──────────────────────────────────────────────
    seccion('3 · EQUIPO SIN DUEÑO')

    const e3 = await nuevoEquipo({ serial_number: `${MARCA}-SERIE-003` })
    if (e3.error) FAIL('un equipo sin dueño tiene que entrar', e3.error.message)
    else {
      PASS('un equipo sin dueño entra', e3.data.reference)
      cmp('el dueño queda nulo', null, e3.data.owner_customer_id)
    }

    // ── 4 · Serial duplicado: avisa, no bloquea ───────────────────────────
    seccion('4 · SERIAL DUPLICADO')

    const e4 = await nuevoEquipo({
      owner_customer_id: CLI_B.id, serial_number: `${MARCA}-SERIE-001`,
      model_text: 'El repetido',
    })
    if (e4.error) FAIL('un serial repetido NO tiene que bloquear el alta', e4.error.message)
    else PASS('un serial repetido entra igual: la base no lo bloquea', e4.data.reference)

    // La RPC es la que usa el formulario para avisar.
    const { data: dup, error: eDup } = await c.rpc('duplicados_de_serial', {
      p_company: BT, p_serial: `${MARCA}-SERIE-001`, p_excluir: null,
    })
    if (eDup) FAIL('duplicados_de_serial', eDup.message)
    else cmp('duplicados_de_serial encuentra los dos', 2, (dup ?? []).length)

    const { data: dupEx } = await c.rpc('duplicados_de_serial', {
      p_company: BT, p_serial: `${MARCA}-SERIE-001`, p_excluir: e4.data?.id ?? null,
    })
    cmp('excluyendo uno, encuentra el otro', 1, (dupEx ?? []).length)

    // Escrito distinto es el mismo serial: lo decide la normalización.
    const { data: dupNorm } = await c.rpc('duplicados_de_serial', {
      p_company: BT, p_serial: `${MARCA.toLowerCase()} serie 001`, p_excluir: null,
    })
    cmp('con espacios y minúsculas encuentra los mismos', 2, (dupNorm ?? []).length)

    const { data: dupOtra } = await c.rpc('duplicados_de_serial', {
      p_company: TT, p_serial: `${MARCA}-SERIE-001`, p_excluir: null,
    })
    cmp('y no cruza empresas', 0, (dupOtra ?? []).length)

    // ── 5 · Alta de orden: el cliente es obligatorio ──────────────────────
    seccion('5 · LA ORDEN EXIGE CLIENTE')

    const oSinCliente = await nuevaOrden({ asset_id: e3.data.id })
    cmp('una orden sin cliente se rechaza', true, oSinCliente.error !== null)
    if (oSinCliente.error) PASS('el motivo', oSinCliente.error.code ?? oSinCliente.error.message)

    const { count: tras } = await s.from('maintenance_orders')
      .select('*', { count: 'exact', head: true }).is('customer_id', null)
    cmp('y no quedó ninguna fila sin cliente', 0, tras)

    // ── 6 · La orden nace abierta y en la primera etapa ───────────────────
    seccion('6 · TRANSICIÓN INICIAL')

    const o1 = await nuevaOrden({ asset_id: e1.data.id, customer_id: CLI_A.id })
    if (o1.error) { FAIL('alta de orden', o1.error.message); throw new Error('sin orden no sigue') }
    PASS('alta de orden', o1.data.number)
    cmp('nace abierta', 'open', o1.data.status)
    cmp('y en diagnóstico, la primera etapa real del circuito', 'diagnosis', o1.data.stage)
    cmp('sin espera', false, o1.data.on_hold)
    cmp('el número lo emitió la numeración', true, /^OS\d{5}$/.test(o1.data.number))

    const a1 = await auditoriaDe(o1.data.id)
    cmp('quedó auditada el alta de la orden', 1, a1.filter((x) => x.action === 'create').length)

    // ── 7 · El cliente de la orden queda congelado ────────────────────────
    seccion('7 · CLIENTE CONGELADO')

    const upCliente = await c.from('maintenance_orders')
      .update({ customer_id: CLI_B.id }).eq('id', o1.data.id).select('id')
    const { data: trasUp } = await s.from('maintenance_orders')
      .select('customer_id').eq('id', o1.data.id).single()
    cmp('un UPDATE directo del cliente no cambia nada', CLI_A.id, trasUp.customer_id)
    if (upCliente.error) PASS('y además lo rechaza', upCliente.error.code ?? '')

    // ── 8 · Cambiar el dueño del equipo NO toca la orden ──────────────────
    seccion('8 · CAMBIAR EL DUEÑO NO REESCRIBE LA HISTORIA')

    const upDueno = await c.from('maintenance_assets')
      .update({ owner_customer_id: CLI_B.id }).eq('id', e1.data.id).select('owner_customer_id')
    if (upDueno.error) FAIL('el dueño del equipo tiene que poder cambiar', upDueno.error.message)
    else cmp('el equipo cambió de dueño', CLI_B.id, upDueno.data[0].owner_customer_id)

    const { data: ordenTras } = await s.from('maintenance_orders')
      .select('customer_id').eq('id', o1.data.id).single()
    cmp('la orden histórica sigue diciendo el cliente original',
      CLI_A.id, ordenTras.customer_id)

    const a8 = await auditoriaDe(e1.data.id)
    const cambio = a8.find((x) => x.action === 'owner_changed')
    cmp('el cambio de dueño quedó auditado', true, cambio !== undefined)
    if (cambio) {
      cmp('con el de dónde', CLI_A.id, cambio.diff?.de)
      cmp('y el a dónde', CLI_B.id, cambio.diff?.a)
    }

    // ── 9 · Las etapas: de a una, sin saltos ──────────────────────────────
    seccion('9 · ETAPAS')

    const salto = await c.from('maintenance_orders')
      .update({ stage: 'repair' }).eq('id', o1.data.id).select('id')
    cmp('saltar de diagnóstico a reparación se rechaza', true, salto.error !== null)
    const { data: trasSalto } = await s.from('maintenance_orders')
      .select('stage').eq('id', o1.data.id).single()
    cmp('y la etapa no se movió', 'diagnosis', trasSalto.stage)

    const paso1 = await c.from('maintenance_orders')
      .update({ stage: 'quotation' }).eq('id', o1.data.id).select('stage')
    if (paso1.error) FAIL('avanzar una etapa', paso1.error.message)
    else cmp('avanzar de a una funciona', 'quotation', paso1.data[0].stage)

    const atras = await c.from('maintenance_orders')
      .update({ stage: 'diagnosis' }).eq('id', o1.data.id).select('stage')
    if (atras.error) FAIL('volver atrás', atras.error.message)
    else cmp('volver atrás funciona', 'diagnosis', atras.data[0].stage)

    const a9 = await auditoriaDe(o1.data.id)
    cmp('el avance quedó auditado como stage_changed',
      1, a9.filter((x) => x.action === 'stage_changed').length)
    cmp('y la vuelta atrás como stage_reverted',
      1, a9.filter((x) => x.action === 'stage_reverted').length)

    // Una etapa no requerida se saltea, y queda dicho.
    const o2 = await nuevaOrden({
      asset_id: e2.data.id, customer_id: CLI_A.id,
      repair_required: false, torque_required: false,
    })
    if (o2.error) FAIL('orden sin reparación ni torque', o2.error.message)
    else {
      PASS('una orden puede nacer sin reparación ni torque')
      const a2 = await auditoriaDe(o2.data.id)
      const noReq = a2.filter((x) => x.action === 'stage_marked_not_required')
      cmp('y queda auditado al crear, no deducido de un booleano', 1, noReq.length)
      cmp('el diff dice que fue al crear', true, noReq[0]?.diff?.al_crear === true)

      await c.from('maintenance_orders').update({ stage: 'quotation' }).eq('id', o2.data.id)
      const salteo = await c.from('maintenance_orders')
        .update({ stage: 'closing' }).eq('id', o2.data.id).select('stage')
      if (salteo.error) FAIL('de cotización a cierre salteando las dos', salteo.error.message)
      else cmp('saltea las dos no requeridas de una', 'closing', salteo.data[0].stage)

      const aRepair = await c.from('maintenance_orders')
        .update({ stage: 'repair' }).eq('id', o2.data.id).select('id')
      cmp('y a una etapa no requerida no se entra', true, aRepair.error !== null)
    }

    // ── 10 · La espera es ortogonal y queda auditada ──────────────────────
    seccion('10 · ESPERA')

    const pausa = await c.from('maintenance_orders')
      .update({ on_hold: true, on_hold_since: new Date().toISOString() })
      .eq('id', o1.data.id).select('on_hold, stage')
    if (pausa.error) FAIL('poner en espera', pausa.error.message)
    else {
      cmp('la orden queda en espera', true, pausa.data[0].on_hold)
      cmp('y la etapa NO se movió: son dos ejes distintos',
        'diagnosis', pausa.data[0].stage)
    }

    const reanuda = await c.from('maintenance_orders')
      .update({ on_hold: false, on_hold_since: null }).eq('id', o1.data.id).select('on_hold')
    cmp('y se puede reanudar', false, reanuda.data?.[0]?.on_hold)

    const a10 = await auditoriaDe(o1.data.id)
    cmp('la puesta en espera quedó auditada',
      1, a10.filter((x) => x.action === 'order_put_on_hold').length)
    cmp('y la reanudación también',
      1, a10.filter((x) => x.action === 'order_resumed').length)

    // ── 11 · Puntos de revisión: CRUD ─────────────────────────────────────
    seccion('11 · PUNTOS DE REVISIÓN · CRUD')

    const { data: puntosBT, error: ePts } = await c.from('maintenance_check_points')
      .select('id, key, label, sort_order, active').eq('company_id', BT).order('sort_order')
    if (ePts) FAIL('leer los puntos', ePts.message)
    else {
      cmp('la empresa tiene sus 8 puntos sembrados', 8, (puntosBT ?? []).length)
      cmp('y son los del sistema anterior', 'carcasa,tornillos,conectores,reversa,software,embrague,cabezal,rotor',
        (puntosBT ?? []).map((p) => p.key).join(','))
    }

    const pNuevo = await c.from('maintenance_check_points').insert({
      company_id: BT, key: `${MARCA.toLowerCase()}_rodamiento`,
      label: `${MARCA} RODAMIENTO`, sort_order: 900, active: true,
    }).select('id').single()
    if (pNuevo.error) FAIL('crear un punto', pNuevo.error.message)
    else { creados.puntos.push(pNuevo.data.id); PASS('se puede crear un punto nuevo') }

    const pRep = await c.from('maintenance_check_points').insert({
      company_id: BT, key: `${MARCA.toLowerCase()}_rodamiento`,
      label: 'otro', sort_order: 901, active: true,
    }).select('id')
    cmp('una clave repetida en la misma empresa se rechaza', true, pRep.error !== null)

    const pEdit = await c.from('maintenance_check_points')
      .update({ label: `${MARCA} RODAMIENTO TRASERO`, sort_order: 910 })
      .eq('id', pNuevo.data.id).select('label, sort_order')
    if (pEdit.error) FAIL('editar un punto', pEdit.error.message)
    else cmp('se puede editar', `${MARCA} RODAMIENTO TRASERO`, pEdit.data[0].label)

    const pOff = await c.from('maintenance_check_points')
      .update({ active: false }).eq('id', pNuevo.data.id).select('active')
    cmp('se puede desactivar', false, pOff.data?.[0]?.active)
    await c.from('maintenance_check_points').update({ active: true }).eq('id', pNuevo.data.id)

    // ── 12 · Checks de la orden: filas, no un blob JSON ───────────────────
    seccion('12 · CHECKS DE LA ORDEN')

    const punto = puntosBT[0]
    const ch1 = await c.from('maintenance_order_checks').insert({
      company_id: BT, maintenance_order_id: o1.data.id,
      check_point_id: punto.id, phase: 'diagnosis', result: 'nok',
    }).select('id, result').single()
    if (ch1.error) FAIL('marcar un punto', ch1.error.message)
    else PASS('se marca un punto', `${punto.key} = nok`)

    // El upsert del servicio: volver a marcar corrige, no duplica.
    const ch2 = await c.from('maintenance_order_checks').upsert({
      company_id: BT, maintenance_order_id: o1.data.id,
      check_point_id: punto.id, phase: 'diagnosis', result: 'ok',
    }, { onConflict: 'maintenance_order_id,check_point_id,phase' }).select('id, result').single()
    if (ch2.error) FAIL('volver a marcar', ch2.error.message)
    else {
      cmp('volver a marcar corrige el valor', 'ok', ch2.data.result)
      cmp('sin duplicar la fila', ch1.data.id, ch2.data.id)
    }

    const ch3 = await c.from('maintenance_order_checks').insert({
      company_id: BT, maintenance_order_id: o1.data.id,
      check_point_id: punto.id, phase: 'repair', result: 'ok',
    }).select('id').single()
    if (ch3.error) FAIL('el mismo punto en la otra fase', ch3.error.message)
    else PASS('el mismo punto convive en las dos fases')

    const chMal = await c.from('maintenance_order_checks').insert({
      company_id: BT, maintenance_order_id: o1.data.id,
      check_point_id: punto.id, phase: 'lo_que_sea', result: 'ok',
    }).select('id')
    cmp('una fase inventada se rechaza', true, chMal.error !== null)

    const chRes = await c.from('maintenance_order_checks').insert({
      company_id: BT, maintenance_order_id: o1.data.id,
      check_point_id: puntosBT[1].id, phase: 'diagnosis', result: 'quizas',
    }).select('id')
    cmp('un resultado inventado también', true, chRes.error !== null)

    const { count: nChecks } = await s.from('maintenance_order_checks')
      .select('*', { count: 'exact', head: true }).eq('maintenance_order_id', o1.data.id)
    cmp('quedan dos filas, una por fase', 2, nChecks)

    // Un punto ya usado no se borra: dejaría revisiones huérfanas.
    const pBorrarUsado = await c.from('maintenance_check_points').delete().eq('id', punto.id)
    cmp('un punto ya usado no se puede borrar', true, pBorrarUsado.error !== null)
    const { count: sigue } = await s.from('maintenance_check_points')
      .select('*', { count: 'exact', head: true }).eq('id', punto.id)
    cmp('y sigue ahí', 1, sigue)

    const borrarCheck = await c.from('maintenance_order_checks').delete().eq('id', ch3.data.id)
    if (borrarCheck.error) FAIL('desmarcar', borrarCheck.error.message)
    else PASS('desmarcar un punto funciona: «no revisado» vuelve a ser posible')

    // ── 13 · Baja lógica del equipo ───────────────────────────────────────
    seccion('13 · BAJA LÓGICA')

    const baja = await c.from('maintenance_assets')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', e4.data.id).is('deleted_at', null).select('id')
    cmp('se puede dar de baja', 1, (baja.data ?? []).length)

    const { data: bajaSigue } = await s.from('maintenance_assets')
      .select('id, deleted_at').eq('id', e4.data.id).single()
    cmp('la fila sigue existiendo: la baja es lógica', true, bajaSigue.deleted_at !== null)

    const reactiva = await c.from('maintenance_assets')
      .update({ deleted_at: null, deleted_by: null }).eq('id', e4.data.id).select('deleted_at')
    cmp('y se puede reactivar', null, reactiva.data?.[0]?.deleted_at)

    // ── 14 · Los listados que pide la UI ──────────────────────────────────
    seccion('14 · LOS LISTADOS DE LA PANTALLA')

    const { data: lista, count: total, error: eLista } = await c
      .from('maintenance_assets')
      .select('id, reference, serial_number, owner_customer_id, dueno:customers!owner_customer_id ( legal_name ), producto:products!product_id ( sku ), maintenance_orders ( id )',
        { count: 'exact' })
      .eq('company_id', BT).order('created_at', { ascending: false }).range(0, 24)
    if (eLista) FAIL('la consulta del listado de equipos', eLista.message)
    else {
      PASS('el listado de equipos resuelve en una consulta', `${(lista ?? []).length} filas`)
      cmp('con el total exacto del servidor', true, typeof total === 'number')
      const conDueno = (lista ?? []).find((x) => x.owner_customer_id !== null)
      cmp('y trae el nombre del dueño embebido', true, !!conDueno?.dueno?.legal_name)
    }

    const { error: eOrd } = await c.from('maintenance_orders')
      .select('id, number, equipo:maintenance_assets!asset_id ( reference ), cliente:customers!customer_id ( legal_name ), tecnico:profiles!technician_id ( full_name )',
        { count: 'exact' })
      .eq('company_id', BT).order('received_at', { ascending: false }).range(0, 24)
    if (eOrd) FAIL('la consulta del listado de órdenes', eOrd.message)
    else PASS('el listado de órdenes también')

    const { data: busq } = await c.from('maintenance_assets')
      .select('id')
      .eq('company_id', BT)
      .or(`reference.ilike.%${MARCA}%,serial_number.ilike.%${MARCA}%,identifier.ilike.%${MARCA}%`)
    cmp('el buscador encuentra por serial', 3, (busq ?? []).length)

    // ── 15 · RLS con JWT real, las seis identidades ───────────────────────
    seccion('15 · RLS · SEIS IDENTIDADES CON JWT REAL')

    const TABLAS = ['maintenance_assets', 'maintenance_orders', 'maintenance_check_points',
      'maintenance_order_checks', 'maintenance_audit']

    // admin — la identidad con la que se corrió todo lo de arriba.
    cmp('admin (Buscatools): ve sus equipos', true, (lista ?? []).length > 0)

    // salesperson — jano es vendedor en Torquetools. Misma persona, otro rol,
    // otra empresa: es la prueba de que el rol manda y no el usuario.
    const { data: vTT } = await c.from('maintenance_check_points').select('id').eq('company_id', TT)
    cmp('salesperson (Torquetools): 0 puntos de su propia empresa', 0, (vTT ?? []).length)
    const escrTT = await c.from('maintenance_assets').insert({
      company_id: TT, reference: `${MARCA}-TT`, notes: `${MARCA} no debería entrar`,
    }).select('id')
    cmp('salesperson: no puede crear un equipo en su empresa', true, escrTT.error !== null)
    const { count: nTT } = await s.from('maintenance_assets')
      .select('*', { count: 'exact', head: true }).eq('company_id', TT)
    cmp('y no quedó ninguna fila en Torquetools', 0, nTT)

    // employee y technician — no hay usuarios con esos roles, así que se le
    // dan a jano en dos empresas de prueba. El helper de RLS lee
    // `company_memberships`, no el JWT, así que su sesión ya vale.
    const empresaDe = async (slug, rol) => {
      const { data: emp, error } = await s.from('companies')
        .insert({ slug, name: `${MARCA} ${rol}`, default_currency: 'ARS' })
        .select('id').single()
      if (error) { FAIL(`crear empresa de prueba ${rol}`, error.message); return null }
      creados.empresas.push(emp.id)
      const { data: m, error: eM } = await s.from('company_memberships')
        .insert({ user_id: JANO, company_id: emp.id, role: rol, status: 'active' })
        .select('id').single()
      if (eM) { FAIL(`membresía ${rol}`, eM.message); return null }
      creados.membresias.push(m.id)
      await s.from('document_sequences').insert({
        company_id: emp.id, doc_type: 'maintenance_asset', series_code: 'EQ',
        prefix: 'EQ', padding: 5, next_number: 1, is_default: true,
      })
      return emp.id
    }

    const EMP = await empresaDe(`zz-m2-emp-${Date.now()}`, 'employee')
    const TEC = await empresaDe(`zz-m2-tec-${Date.now()}`, 'technician')

    if (EMP) {
      const { data: refE } = await c.rpc('next_document_number',
        { p_company: EMP, p_doc_type: 'maintenance_asset' })
      const rE = await c.from('maintenance_assets').insert({
        company_id: EMP, reference: refE, notes: `${MARCA} employee`,
      }).select('id').single()
      if (rE.error) FAIL('employee: tiene que poder crear un equipo', rE.error.message)
      else { creados.equipos.push(rE.data.id); PASS('employee: crea un equipo en su empresa') }

      const { data: vE } = await c.from('maintenance_assets').select('id').eq('company_id', EMP)
      cmp('employee: y lo ve', 1, (vE ?? []).length)
    }

    if (TEC) {
      const { data: refT } = await c.rpc('next_document_number',
        { p_company: TEC, p_doc_type: 'maintenance_asset' })
      const rT = await c.from('maintenance_assets').insert({
        company_id: TEC, reference: refT ?? 'EQ00001', notes: `${MARCA} technician`,
      }).select('id')
      cmp('technician: NO puede crear un equipo', true, rT.error !== null)
      const { count: nT } = await s.from('maintenance_assets')
        .select('*', { count: 'exact', head: true }).eq('company_id', TEC)
      cmp('y no quedó ninguna fila', 0, nT)
      const { data: vT } = await c.from('maintenance_assets').select('id').eq('company_id', TEC)
      cmp('technician: 0 filas visibles', 0, (vT ?? []).length)
    }

    // customer y distributor.
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
      cmp(`${rol}: 0 filas en las cinco tablas`, 0, visto)

      const { data: porId } = await ext.from('maintenance_orders')
        .select('id').eq('id', o1.data.id)
      const { data: porSerie } = await ext.from('maintenance_assets')
        .select('id').eq('serial_number', `${MARCA}-SERIE-001`)
      cmp(`${rol}: ni por id ni por serie`, 0, (porId ?? []).length + (porSerie ?? []).length)

      const escr = await ext.from('maintenance_assets').insert({
        company_id: BT, reference: `${MARCA}-${rol}`, notes: `${MARCA} intruso`,
      }).select('id')
      cmp(`${rol}: no puede escribir`, true, escr.error !== null)

      const { data: dupExt, error: eDupExt } = await ext.rpc('duplicados_de_serial', {
        p_company: BT, p_serial: `${MARCA}-SERIE-001`, p_excluir: null,
      })
      cmp(`${rol}: duplicados_de_serial no le devuelve nada`,
        0, eDupExt ? 0 : (dupExt ?? []).length)
    }

    // anónimo.
    const anon = sesion()
    let vistoAnon = 0
    for (const t of TABLAS) {
      const { data } = await anon.from(t).select('id')
      vistoAnon += (data ?? []).length
    }
    cmp('anónimo: 0 filas', 0, vistoAnon)
    const escrAnon = await anon.from('maintenance_assets').insert({
      company_id: BT, reference: `${MARCA}-ANON`, notes: `${MARCA} intruso`,
    }).select('id')
    cmp('anónimo: no puede escribir', true, escrAnon.error !== null)
    const rAnon = await anon.rpc('duplicados_de_serial',
      { p_company: BT, p_serial: `${MARCA}-SERIE-001`, p_excluir: null })
    cmp('anónimo: no puede ejecutar duplicados_de_serial', true, rAnon.error !== null)

    // ── 16 · Rendimiento de las consultas de la pantalla ──────────────────
    seccion('16 · RENDIMIENTO')

    // Se mide el RÉGIMEN, no el arranque en frío: la primera llamada a una
    // función paga el plan y la conexión —`search_products` midió 2.611 ms en
    // frío contra ~500 ms estables— y ese número no dice nada sobre si la
    // consulta está bien escrita. Se descarta una corrida de calentamiento y
    // se cronometra la siguiente.
    const cronometrar = async (etiqueta, fn, tope) => {
      await fn()
      const t0 = Date.now()
      await fn()
      const ms = Date.now() - t0
      if (ms <= tope) PASS(etiqueta, `${ms} ms`)
      else FAIL(etiqueta, `${ms} ms (tope ${tope})`)
    }

    await cronometrar('listado de equipos, página de 25', () =>
      c.from('maintenance_assets')
        .select('id, reference, dueno:customers!owner_customer_id ( legal_name )', { count: 'exact' })
        .eq('company_id', BT).range(0, 24), 1500)
    await cronometrar('búsqueda de productos (no trae los 21.772)', () =>
      c.rpc('search_products',
        { p_company: BT, p_query: 'atornillador', p_limit: 20, p_offset: 0, p_orden: 'nombre' }), 2000)
    await cronometrar('búsqueda de clientes (no trae los 1.010)', () =>
      c.from('customers').select('id, legal_name').eq('company_id', BT)
        .is('deleted_at', null).ilike('legal_name', '%s%').limit(20), 1500)

  } finally {
    // ── Limpieza ───────────────────────────────────────────────────────────
    seccion('LIMPIEZA')

    for (const id of creados.ordenes) {
      await s.from('maintenance_order_checks').delete().eq('maintenance_order_id', id)
      await s.from('maintenance_quote_lines').delete().eq('maintenance_order_id', id)
      await s.from('maintenance_measurements').delete().eq('maintenance_order_id', id)
      await s.from('maintenance_order_parts').delete().eq('maintenance_order_id', id)
      await s.from('maintenance_orders').delete().eq('id', id)
    }
    await s.from('maintenance_orders').delete().like('entry_reason', `${MARCA}%`)

    for (const id of creados.equipos) await s.from('maintenance_assets').delete().eq('id', id)
    await s.from('maintenance_assets').delete().like('notes', `${MARCA}%`)

    for (const id of creados.puntos) await s.from('maintenance_check_points').delete().eq('id', id)
    await s.from('maintenance_check_points').delete().like('label', `${MARCA}%`)

    const entidades = [...creados.ordenes, ...creados.equipos]
    if (entidades.length > 0) {
      await s.from('maintenance_audit').delete().in('entity_id', entidades)
    }
    await s.from('maintenance_audit').delete().in('company_id', creados.empresas)

    for (const id of creados.membresias) await s.from('company_memberships').delete().eq('id', id)
    for (const id of creados.empresas) {
      await s.from('document_sequences').delete().eq('company_id', id)
      await s.from('companies').delete().eq('id', id)
    }

    for (const q of seqAntes ?? []) {
      await s.from('document_sequences').update({ next_number: q.next_number })
        .eq('company_id', q.company_id).eq('doc_type', q.doc_type)
    }

    cmp('no queda ningún equipo', 0, await q('maintenance_assets'))
    cmp('ni ninguna orden', 0, await q('maintenance_orders'))
    cmp('ni checks', 0, await q('maintenance_order_checks'))
    cmp('ni líneas de cotización', 0, await q('maintenance_quote_lines'))
    cmp('ni repuestos', 0, await q('maintenance_order_parts'))
    cmp('ni mediciones', 0, await q('maintenance_measurements'))
    cmp('ni auditoría de mantenimiento', 0, await q('maintenance_audit'))
    cmp('los puntos de revisión vuelven a su número', puntosAntes, await q('maintenance_check_points'))
    cmp('las empresas vuelven a su número', empresasAntes, await q('companies'))
    cmp('1010 clientes intactos', 1010, await q('customers'))
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
