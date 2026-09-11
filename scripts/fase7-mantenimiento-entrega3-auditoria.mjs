/**
 * Fase 7 · Mantenimiento — entrega 3: AUDITORÍA PREVIA, sólo medición.
 *
 * No cambia nada de forma permanente: crea fixtures con el prefijo `ZZ-A3`,
 * mide qué permite HOY la base, y devuelve todo a su número exacto —incluidos
 * los saldos de stock y las secuencias—.
 *
 * No propone ni aplica ningún cambio. Sólo responde «qué está permitido hoy».
 *
 *   set -a; source .env; source .env.migration; source .env.rls.txt; set +a
 *   node scripts/fase7-mantenimiento-entrega3-auditoria.mjs
 *
 * NO canalizar la salida por `head`: cierra el pipe, el proceso muere con
 * SIGPIPE antes del `finally` y la limpieza no llega a correr. Usá `| tee` o
 * redirigí a un archivo.
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

const MARCA = 'ZZ-A3'
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
  const TT = comps.find((x) => x.slug === 'torquetools').id

  const { data: seqAntes } = await s.from('document_sequences')
    .select('company_id, doc_type, next_number').in('doc_type', ['maintenance_asset', 'maintenance_order'])
  const { count: movAntes } = await s.from('stock_movements').select('*', { count: 'exact', head: true })
  const { data: balAntes } = await s.from('stock_balances').select('product_id, warehouse_id, on_hand')
  const saldosPrevios = new Map((balAntes ?? []).map((b) => [b.product_id + '|' + b.warehouse_id, Number(b.on_hand)]))

  const { data: depBT } = await s.from('warehouses').select('id, name')
    .eq('company_id', BT).eq('is_default', true).single()
  const { data: depTT } = await s.from('warehouses').select('id, name')
    .eq('company_id', TT).eq('is_default', true).single()
  const { data: prods } = await s.from('products').select('id, sku, name').eq('company_id', BT).order('sku').limit(2)
  const { data: prodTT } = await s.from('products').select('id, sku').eq('company_id', TT).limit(1).maybeSingle()
  const { data: cli } = await s.from('customers').select('id').eq('company_id', BT).order('legal_name').limit(1)

  const saldo = async (productId, warehouseId) => {
    const { data } = await s.from('stock_balances').select('on_hand')
      .eq('product_id', productId).eq('warehouse_id', warehouseId).maybeSingle()
    return data ? Number(data.on_hand) : 0
  }

  const nuevaOrden = async (campos = {}) => {
    const { data: ref } = await c.rpc('next_document_number', { p_company: BT, p_doc_type: 'maintenance_asset' })
    const { data: eq, error: eE } = await c.from('maintenance_assets')
      .insert({ company_id: BT, reference: ref, notes: `${MARCA} auditoría` }).select('id').single()
    if (eE) throw new Error('equipo: ' + eE.message)
    creados.equipos.push(eq.id)
    const { data: num } = await c.rpc('next_document_number', { p_company: BT, p_doc_type: 'maintenance_order' })
    const { data: o, error: eO } = await c.from('maintenance_orders').insert({
      company_id: BT, number: num, asset_id: eq.id, customer_id: cli[0].id,
      service_type: 'corrective', received_at: HOY, entry_reason: `${MARCA}`, ...campos,
    }).select('*').single()
    if (eO) throw new Error('orden: ' + eO.message)
    creados.ordenes.push(o.id)
    return o
  }

  console.log('='.repeat(76))
  console.log('  MANTENIMIENTO · entrega 3 — AUDITORÍA PREVIA (sólo medición)')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(76))

  try {
    // ── §4 · quote_status: qué transiciones permite hoy ────────────────────
    seccion('§4 · QUOTE_STATUS · transiciones por UPDATE directo de PostgREST')

    const oq = await nuevaOrden()
    DATO('estado inicial', oq.quote_status)

    const mover = async (id, destino) => {
      const { error } = await c.from('maintenance_orders')
        .update({ quote_status: destino }).eq('id', id).select('quote_status')
      const { data: real } = await s.from('maintenance_orders').select('quote_status').eq('id', id).single()
      return { error, real: real.quote_status }
    }

    for (const [desde, hasta] of [
      ['pending', 'approved'], ['approved', 'pending'], ['pending', 'rejected'],
      ['rejected', 'approved'], ['approved', 'rejected'], ['rejected', 'pending'],
    ]) {
      await s.from('maintenance_orders').update({ quote_status: desde }).eq('id', oq.id)
      const r = await mover(oq.id, hasta)
      if (r.error) NO(`${desde} → ${hasta}`, r.error.code ?? r.error.message)
      else if (r.real === hasta) OK(`${desde} → ${hasta}`, 'sin ninguna validación de transición')
      else NO(`${desde} → ${hasta}`, `quedó en ${r.real}`)
    }

    const inventado = await c.from('maintenance_orders')
      .update({ quote_status: 'lo_que_sea' }).eq('id', oq.id).select('id')
    inventado.error ? NO('un valor inventado', inventado.error.code) : OK('un valor inventado')

    await s.from('maintenance_orders').update({ quote_status: 'pending' }).eq('id', oq.id)
    const { data: audQ } = await s.from('maintenance_audit')
      .select('action').eq('entity_id', oq.id).in('action', ['quote_approved', 'quote_rejected'])
    DATO('eventos quote_* auditados en esas 6 transiciones', (audQ ?? []).length)
    GAP('approved → pending y rejected → pending NO quedan auditados (el trigger sólo audita al entrar a approved/rejected)')

    // ── §5 · Cotización y etapa ────────────────────────────────────────────
    seccion('§5 · COTIZACIÓN × ETAPA')

    const avance = await c.from('maintenance_orders')
      .update({ stage: 'quotation' }).eq('id', oq.id).select('stage')
    avance.error
      ? NO('avanzar de etapa con la cotización pendiente', avance.error.message)
      : OK('avanzar de etapa con la cotización pendiente')

    const av2 = await c.from('maintenance_orders')
      .update({ stage: 'repair' }).eq('id', oq.id).select('stage')
    av2.error
      ? NO('pasar de cotización a reparación con la cotización pendiente', av2.error.message)
      : OK('pasar de cotización a reparación con la cotización pendiente')
    DATO('conclusión', 'quote_status NO condiciona ninguna etapa; sólo el cierre lo mira')
    DATO('no existe la columna', 'quote_required — una cotización no se puede marcar «no requerida»')

    // ── §6 · Totales ───────────────────────────────────────────────────────
    seccion('§6 · TOTALES DE COTIZACIÓN')

    const linea = async (orden, campos) =>
      c.from('maintenance_quote_lines').insert({
        company_id: BT, maintenance_order_id: orden, ...campos,
      }).select('*').single()

    const l1 = await linea(oq.id, { line_no: 1, line_type: 'labour', description_snapshot: `${MARCA} mano de obra`, quantity: 1, unit_price: 100 })
    if (l1.error) NO('línea libre de mano de obra', l1.error.message)
    else {
      OK('línea libre (sin product_id)', `line_total = ${l1.data.line_total}`)
      DATO('line_total lo calcula el servidor', `${l1.data.quantity} × ${l1.data.unit_price} = ${l1.data.line_total}`)
    }

    const l2 = await linea(oq.id, { line_no: 2, line_type: 'part', product_id: prods[0].id, sku_snapshot: prods[0].sku, description_snapshot: prods[0].name, quantity: 2, unit_price: 50, line_total: 999999 })
    if (l2.error) NO('línea con producto', l2.error.message)
    else {
      OK('línea vinculada a producto', `line_total = ${l2.data.line_total}`)
      // Comparar numéricamente: PostgREST devuelve numeric como número o como
      // cadena según el caso, y comparar textos daba un falso positivo.
      Number(l2.data.line_total) === 100
        ? NO('un line_total manipulado (999999)', 'el trigger lo recalculó a 100')
        : GAP(`un line_total manipulado quedó como ${l2.data.line_total}`)
    }

    const { data: tot } = await s.from('maintenance_orders')
      .select('quote_subtotal, quote_total').eq('id', oq.id).single()
    DATO('totales de la orden tras 2 líneas', `subtotal ${tot.quote_subtotal} · total ${tot.quote_total}`)

    const totMan = await c.from('maintenance_orders')
      .update({ quote_total: 1, quote_subtotal: 1 }).eq('id', oq.id).select('quote_total')
    const { data: totTras } = await s.from('maintenance_orders').select('quote_total').eq('id', oq.id).single()
    String(totTras.quote_total) === String(tot.quote_total)
      ? NO('un total manipulado por UPDATE', `el trigger lo devolvió a ${totTras.quote_total}`)
      : GAP(`un total manipulado quedó en ${totTras.quote_total}`)
    if (totMan.error) DATO('además devolvió error', totMan.error.code)

    DATO('impuestos', 'no existe ninguna columna de impuesto: total = subtotal = suma de líneas')
    DATO('moneda', `quote_currency de la orden = ${oq.quote_currency ?? 'NULL'} (nullable, sin default)`)

    // ── §7/§22 · Repuestos, y su independencia de la cotización ────────────
    seccion('§7 y §22 · REPUESTOS · independencia entre cotizado y consumido')

    const saldoAntes = await saldo(prods[0].id, depBT.id)
    DATO('saldo del producto antes de todo', saldoAntes)

    const p1 = await c.from('maintenance_order_parts').insert({
      company_id: BT, maintenance_order_id: oq.id, product_id: prods[0].id,
      warehouse_id: depBT.id, quantity: 3, sku_snapshot: prods[0].sku,
      name_snapshot: prods[0].name, unit_cost_snapshot: null,
    }).select('*').single()
    if (p1.error) NO('agregar un repuesto', p1.error.message)
    else {
      OK('agregar un repuesto', `cantidad ${p1.data.quantity}, costo ${p1.data.unit_cost_snapshot ?? 'NULL'}`)
      DATO('unit_cost_snapshot acepta NULL', p1.data.unit_cost_snapshot === null ? 'sí' : 'no')
      DATO('consumed_at al agregar', p1.data.consumed_at ?? 'NULL')
    }

    const saldoTrasAgregar = await saldo(prods[0].id, depBT.id)
    saldoTrasAgregar === saldoAntes
      ? NO('agregar un repuesto mueva stock', `el saldo sigue en ${saldoTrasAgregar}`)
      : GAP(`agregar movió el stock de ${saldoAntes} a ${saldoTrasAgregar}`)

    const { data: totTrasParte } = await s.from('maintenance_orders')
      .select('quote_total').eq('id', oq.id).single()
    String(totTrasParte.quote_total) === String(tot.quote_total)
      ? NO('agregar un repuesto altere la cotización', `total sigue en ${totTrasParte.quote_total}`)
      : GAP('agregar un repuesto cambió el total de la cotización')

    await s.from('maintenance_orders').update({ quote_status: 'approved' }).eq('id', oq.id)
    const saldoTrasAprobar = await saldo(prods[0].id, depBT.id)
    saldoTrasAprobar === saldoAntes
      ? NO('aprobar la cotización mueva stock', `el saldo sigue en ${saldoTrasAprobar}`)
      : GAP('aprobar la cotización movió stock')

    const { count: partesDeLinea } = await s.from('maintenance_order_parts')
      .select('*', { count: 'exact', head: true }).eq('maintenance_order_id', oq.id)
    DATO('líneas de cotización / repuestos', `2 / ${partesDeLinea} — son independientes, sin FK entre sí`)

    // ── §10 · Depósito ─────────────────────────────────────────────────────
    seccion('§10 · DEPÓSITO')

    const sinDep = await c.from('maintenance_order_parts').insert({
      company_id: BT, maintenance_order_id: oq.id, product_id: prods[0].id, quantity: 1,
    }).select('id')
    sinDep.error
      ? NO('un repuesto sin depósito', sinDep.error.code)
      : OK('un repuesto sin depósito')
    DATO('cuándo se exige', 'al AGREGAR: warehouse_id es NOT NULL en la tabla')

    const depAjeno = await c.from('maintenance_order_parts').insert({
      company_id: BT, maintenance_order_id: oq.id, product_id: prods[0].id,
      warehouse_id: depTT.id, quantity: 1,
    }).select('id').single()
    if (depAjeno.error) NO('un depósito de OTRA empresa', depAjeno.error.code ?? depAjeno.error.message)
    else {
      OK('un depósito de OTRA empresa', depAjeno.data.id)
      GAP('nada valida que warehouse_id pertenezca a la empresa de la orden')
      await s.from('maintenance_order_parts').delete().eq('id', depAjeno.data.id)
    }

    if (prodTT) {
      const prodAjeno = await c.from('maintenance_order_parts').insert({
        company_id: BT, maintenance_order_id: oq.id, product_id: prodTT.id,
        warehouse_id: depBT.id, quantity: 1,
      }).select('id').single()
      if (prodAjeno.error) NO('un producto de OTRA empresa', prodAjeno.error.code ?? prodAjeno.error.message)
      else {
        OK('un producto de OTRA empresa', prodAjeno.data.id)
        GAP('nada valida que product_id pertenezca a la empresa de la orden')
        await s.from('maintenance_order_parts').delete().eq('id', prodAjeno.data.id)
      }

      const qlAjena = await c.from('maintenance_quote_lines').insert({
        company_id: BT, maintenance_order_id: oq.id, line_no: 90,
        line_type: 'part', product_id: prodTT.id, quantity: 1, unit_price: 1,
      }).select('id').single()
      if (qlAjena.error) NO('una línea de cotización con producto de otra empresa', qlAjena.error.code)
      else {
        OK('una línea de cotización con producto de otra empresa', qlAjena.data.id)
        GAP('lo mismo en maintenance_quote_lines.product_id')
        await s.from('maintenance_quote_lines').delete().eq('id', qlAjena.data.id)
      }
    }

    DATO('depósitos activos por empresa', `1 (${depBT.name}, is_default=true). No hay columna de baja lógica`)

    // ── §13 · UPDATE directo para simular consumo ──────────────────────────
    seccion('§13 · UPDATE DIRECTO DE consumed_at / stock_movement_id')

    const upd1 = await c.from('maintenance_order_parts')
      .update({ consumed_at: new Date().toISOString() }).eq('id', p1.data.id).select('id')
    upd1.error
      ? NO('marcar consumed_at a mano', upd1.error.code + ' — ' + upd1.error.message.slice(0, 70))
      : GAP('¡se pudo marcar consumed_at a mano!')

    const { data: mov0 } = await s.from('stock_movements').select('id').limit(1).maybeSingle()
    if (mov0) {
      const upd2 = await c.from('maintenance_order_parts')
        .update({ consumed_at: new Date().toISOString(), stock_movement_id: mov0.id })
        .eq('id', p1.data.id).select('id')
      upd2.error
        ? NO('marcar consumed_at + stock_movement_id a mano', upd2.error.code)
        : GAP('¡se pudo simular un consumo apuntando a un movimiento existente!')
    }

    const { data: p1Tras } = await s.from('maintenance_order_parts')
      .select('consumed_at, stock_movement_id').eq('id', p1.data.id).single()
    DATO('estado real de la línea tras los dos intentos',
      `consumed_at=${p1Tras.consumed_at ?? 'NULL'} movimiento=${p1Tras.stock_movement_id ?? 'NULL'}`)

    const movDirecto = await c.from('stock_movements').insert({
      company_id: BT, product_id: prods[0].id, warehouse_id: depBT.id,
      movement_type: 'service_consumption', quantity: -1,
      source_type: 'maintenance_order', source_id: oq.id,
    }).select('id').single()
    if (movDirecto.error) NO('insertar un stock_movement a mano', movDirecto.error.code)
    else {
      OK('insertar un stock_movement service_consumption a mano', `id ${movDirecto.data.id}`)
      GAP('`authenticated` tiene INSERT sobre stock_movements: se puede mover stock sin pasar por ninguna RPC')
      await s.from('stock_movements').delete().eq('id', movDirecto.data.id)
      const v = await saldo(prods[0].id, depBT.id)
      await s.from('stock_balances').update({ on_hand: v + 1 })
        .eq('product_id', prods[0].id).eq('warehouse_id', depBT.id)
    }

    // ── §11/§14/§15 · Confirmar consumo ────────────────────────────────────
    seccion('§11, §14 y §15 · CONFIRMAR_CONSUMO_MANTENIMIENTO()')

    const saldoPre = await saldo(prods[0].id, depBT.id)
    DATO('saldo antes de confirmar', saldoPre)
    DATO('cantidad a consumir', p1.data.quantity)

    const r1 = await c.rpc('confirmar_consumo_mantenimiento', { p_order: oq.id })
    if (r1.error) NO('confirmar el consumo', r1.error.message)
    else OK('confirmar el consumo', JSON.stringify(r1.data))

    const saldoPost = await saldo(prods[0].id, depBT.id)
    DATO('saldo después', `${saldoPre} → ${saldoPost}  (Δ ${saldoPost - saldoPre})`)
    saldoPost < 0
      ? OK('saldo NEGATIVO', `quedó en ${saldoPost} y el consumo NO se rechazó`)
      : DATO('el saldo no quedó negativo', 'había existencia suficiente')

    const { data: movs } = await s.from('stock_movements')
      .select('id, movement_type, quantity, source_type, source_id')
      .eq('source_id', oq.id)
    DATO('movimientos generados', (movs ?? []).length)
    for (const m of movs ?? []) {
      DATO('  movimiento', `${m.movement_type} · cantidad ${m.quantity} · source ${m.source_type}`)
    }

    const r2 = await c.rpc('confirmar_consumo_mantenimiento', { p_order: oq.id })
    const { data: movs2 } = await s.from('stock_movements')
      .select('id', { count: 'exact' }).eq('source_id', oq.id)
    r2.error
      ? NO('confirmar dos veces', r2.error.message)
      : OK('confirmar dos veces', JSON.stringify(r2.data))
    DATO('movimientos tras la segunda confirmación', (movs2 ?? []).length)
    ;(movs2 ?? []).length === (movs ?? []).length
      ? NO('que la segunda confirmación duplique el movimiento', 'idempotente')
      : GAP('la segunda confirmación generó movimientos de más')

    // ── §16 · Concurrencia real: dos llamadas en paralelo ──────────────────
    seccion('§16 · CONCURRENCIA · dos confirmaciones simultáneas')

    const oc = await nuevaOrden()
    await c.from('maintenance_order_parts').insert({
      company_id: BT, maintenance_order_id: oc.id, product_id: prods[1].id,
      warehouse_id: depBT.id, quantity: 2,
    })
    const saldoConc = await saldo(prods[1].id, depBT.id)

    // Dos clientes distintos, dos conexiones, disparadas a la vez.
    const c2 = sesion()
    await c2.auth.signInWithPassword({
      email: 'buscatools.jano@gmail.com', password: process.env.BT_PW_JANO,
    })
    const [ra, rb] = await Promise.all([
      c.rpc('confirmar_consumo_mantenimiento', { p_order: oc.id }),
      c2.rpc('confirmar_consumo_mantenimiento', { p_order: oc.id }),
    ])
    DATO('llamada A', ra.error ? 'ERROR ' + ra.error.message : JSON.stringify(ra.data))
    DATO('llamada B', rb.error ? 'ERROR ' + rb.error.message : JSON.stringify(rb.data))

    const { count: movsConc } = await s.from('stock_movements')
      .select('*', { count: 'exact', head: true }).eq('source_id', oc.id)
    movsConc === 1
      ? NO('que dos llamadas simultáneas dupliquen el consumo', '1 solo movimiento')
      : GAP(`dos llamadas simultáneas generaron ${movsConc} movimientos`)
    DATO('saldo', `${saldoConc} → ${await saldo(prods[1].id, depBT.id)}`)

    const { data: audC } = await s.from('maintenance_audit')
      .select('action').eq('entity_id', oc.id).eq('action', 'consumption_confirmed')
    DATO('eventos consumption_confirmed', (audC ?? []).length)

    // ── §17 · Atomicidad / granularidad ────────────────────────────────────
    seccion('§17 · ATOMICIDAD Y GRANULARIDAD')

    const oa = await nuevaOrden()
    await c.from('maintenance_order_parts').insert([
      { company_id: BT, maintenance_order_id: oa.id, product_id: prods[0].id, warehouse_id: depBT.id, quantity: 1 },
      { company_id: BT, maintenance_order_id: oa.id, product_id: prods[1].id, warehouse_id: depBT.id, quantity: 1 },
    ])
    const ra2 = await c.rpc('confirmar_consumo_mantenimiento', { p_order: oa.id })
    const { count: movsA } = await s.from('stock_movements')
      .select('*', { count: 'exact', head: true }).eq('source_id', oa.id)
    const { count: pendA } = await s.from('maintenance_order_parts')
      .select('*', { count: 'exact', head: true }).eq('maintenance_order_id', oa.id).is('consumed_at', null)
    DATO('resultado', ra2.error ? 'ERROR' : JSON.stringify(ra2.data))
    DATO('movimientos / líneas sin consumir', `${movsA} / ${pendA}`)
    DATO('firma de la RPC', 'confirmar_consumo_mantenimiento(p_order uuid) — consume TODAS las pendientes')
    GAP('no hay granularidad por línea: no se puede confirmar sólo una parte')
    DATO('atomicidad', 'plpgsql = una transacción: un error en cualquier línea revierte todas')

    // ── §18 · Auditoría ────────────────────────────────────────────────────
    seccion('§18 · AUDITORÍA · qué eventos existen hoy')

    const { data: todos } = await s.from('maintenance_audit')
      .select('action').in('entity_id', creados.ordenes)
    const cuenta = {}
    for (const a of todos ?? []) cuenta[a.action] = (cuenta[a.action] ?? 0) + 1
    for (const [k, v] of Object.entries(cuenta).sort()) DATO('evento', `${k} × ${v}`)
    DATO('quote_approved / quote_rejected', 'los escribe el trigger al ENTRAR a ese estado')
    DATO('consumption_confirmed', 'lo escribe la RPC, UNO por confirmación, no por línea')
    GAP('no existe ningún evento para el alta de un repuesto (part_added)')
    GAP('no existe ningún evento para las líneas de cotización (quote_created/updated)')

    // ── §19 · RLS de las dos tablas ────────────────────────────────────────
    seccion('§19 · RLS · maintenance_quote_lines y maintenance_order_parts')

    const TABLAS = ['maintenance_quote_lines', 'maintenance_order_parts']

    const vistoAdmin = {}
    for (const t of TABLAS) {
      const { data } = await c.from(t).select('id')
      vistoAdmin[t] = (data ?? []).length
    }
    DATO('admin (Buscatools) ve', JSON.stringify(vistoAdmin))

    const escrTT = await c.from('maintenance_quote_lines').insert({
      company_id: TT, maintenance_order_id: oq.id, line_no: 80, quantity: 1, unit_price: 1,
    }).select('id')
    escrTT.error
      ? NO('salesperson (Torquetools): escribir en su empresa', escrTT.error.code)
      : GAP('salesperson pudo escribir')

    for (const [rol, email] of [
      ['customer', 'cliente.test@buscatools.com.ar'],
      ['distributor', 'distribuidor.test@buscatools.com.ar'],
    ]) {
      const ext = sesion()
      const { error } = await ext.auth.signInWithPassword({ email, password: process.env.BT_PW_TEST })
      if (error) { console.log('    ?          ' + rol + ': login ' + error.message); continue }
      let visto = 0
      for (const t of TABLAS) {
        const { data } = await ext.from(t).select('id')
        visto += (data ?? []).length
      }
      const porId = await ext.from('maintenance_quote_lines').select('id').eq('id', l1.data.id)
      const porPadre = await ext.from('maintenance_order_parts').select('id').eq('maintenance_order_id', oq.id)
      const escr = await ext.from('maintenance_order_parts').insert({
        company_id: BT, maintenance_order_id: oq.id, product_id: prods[0].id,
        warehouse_id: depBT.id, quantity: 1,
      }).select('id')
      const rpc = await ext.rpc('confirmar_consumo_mantenimiento', { p_order: oq.id })
      DATO(rol, `filas ${visto} · por id ${(porId.data ?? []).length} · por parent_id ${(porPadre.data ?? []).length}` +
        ` · escritura ${escr.error ? 'RECHAZADA (' + escr.error.code + ')' : '¡PERMITIDA!'}` +
        ` · RPC ${rpc.error ? 'RECHAZADA' : '¡PERMITIDA!'}`)
    }

    const anon = sesion()
    let vAnon = 0
    for (const t of TABLAS) { const { data } = await anon.from(t).select('id'); vAnon += (data ?? []).length }
    const escrAnon = await anon.from('maintenance_quote_lines').insert({
      company_id: BT, maintenance_order_id: oq.id, line_no: 81, quantity: 1, unit_price: 1,
    }).select('id')
    const rpcAnon = await anon.rpc('confirmar_consumo_mantenimiento', { p_order: oq.id })
    DATO('anon', `filas ${vAnon} · escritura ${escrAnon.error ? 'RECHAZADA (' + escrAnon.error.code + ')' : '¡PERMITIDA!'}` +
      ` · RPC ${rpcAnon.error ? 'RECHAZADA' : '¡PERMITIDA!'}`)

    // ── §12 · El fast-path idempotente y el permiso ────────────────────────
    seccion('§12 · SEGURIDAD DEL FAST-PATH')

    const ext = sesion()
    await ext.auth.signInWithPassword({
      email: 'cliente.test@buscatools.com.ar', password: process.env.BT_PW_TEST,
    })
    const fp = await ext.rpc('confirmar_consumo_mantenimiento', { p_order: oq.id })
    fp.error
      ? NO('un customer llame la RPC sobre una orden YA consumida', fp.error.message.slice(0, 60))
      : GAP('¡un customer obtuvo respuesta del atajo idempotente! ' + JSON.stringify(fp.data))
    DATO('en el código', 'el permiso se verifica ANTES del `if v_pend = 0 then return ...`')

    const inexistente = await ext.rpc('confirmar_consumo_mantenimiento',
      { p_order: '00000000-0000-0000-0000-000000000000' })
    DATO('orden inexistente vs. sin permiso',
      `inexistente: "${(inexistente.error?.message ?? '').slice(0, 30)}" · sin permiso: "${(fp.error?.message ?? '').slice(0, 30)}"`)

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
    for (const id of creados.equipos) await s.from('maintenance_assets').delete().eq('id', id)
    const ent = [...creados.ordenes, ...creados.equipos]
    if (ent.length) await s.from('maintenance_audit').delete().in('entity_id', ent)

    // Los saldos se recalculan desde los movimientos que quedaron.
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

    for (const q of seqAntes ?? []) {
      await s.from('document_sequences').update({ next_number: q.next_number })
        .eq('company_id', q.company_id).eq('doc_type', q.doc_type)
    }

    const q = async (t) => (await s.from(t).select('*', { count: 'exact', head: true })).count
    const chk = async (t, esperado) => {
      const v = await q(t)
      console.log(`    ${String(v) === String(esperado) ? 'OK ' : 'DIF'}        ${t}: ${v} (esperado ${esperado})`)
    }
    await chk('maintenance_assets', 0)
    await chk('maintenance_orders', 0)
    await chk('maintenance_quote_lines', 0)
    await chk('maintenance_order_parts', 0)
    await chk('maintenance_measurements', 0)
    await chk('maintenance_audit', 0)
    await chk('maintenance_check_points', 16)
    await chk('stock_movements', movAntes)
    await chk('stock_balances', saldosPrevios.size)
    await chk('customers', 1010)
    await chk('suppliers', 142)
  }

  console.log('\n' + '='.repeat(76))
  console.log('  FIN DE LA AUDITORÍA — no se modificó nada de forma permanente')
  console.log('='.repeat(76))
}

main().catch((e) => { console.error('\n✗', e); process.exit(1) })
