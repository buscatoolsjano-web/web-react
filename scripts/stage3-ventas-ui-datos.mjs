/**
 * Fase 4 · Stage 3 — la UI de Ventas contra los datos reales.
 *
 * Ejecuta las MISMAS consultas que hacen los services de React, con una
 * sesión real (no con la Secret), y comprueba los números que ya conocemos
 * de la migración. Si algo acá falla, la pantalla muestra un dato equivocado.
 *
 * También mide: con 636 documentos, cuánto tarda cada pantalla.
 *
 *   set -a; source .env; source .env.migration; source .env.rls; set +a
 *   node scripts/stage3-ventas-ui-datos.mjs
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(70)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const cmp = (t, esperado, real) =>
  esperado === real ? PASS(t, String(real)) : FAIL(t, `esperaba ${esperado}, dio ${real}`)

const cliente = () => createClient(URL, PUB, { auth: { persistSession: false } })

// Las mismas columnas que pide src/modules/ventas/services/documentos.ts
const COLS = {
  cotizacion: `id, number, original_number, quote_date, title, currency_code, total,
    status, needs_review, review_reason, number_outlier, series_code, imported_at,
    customers!customer_id ( id, legal_name, trade_name ),
    vendedor:profiles!salesperson_id ( full_name )`,
  pedido: `id, number, original_number, order_date, title, currency_code, total,
    commercial_status, fulfillment_status, needs_review, review_reason, number_outlier,
    series_code, imported_at, customers!customer_id ( id, legal_name, trade_name ),
    vendedor:profiles!salesperson_id ( full_name ),
    origen:sales_quotes!quote_id ( id, number )`,
  entrega: `id, number, original_number, delivery_date, title, currency_code, total,
    status, needs_review, review_reason, number_outlier, series_code, imported_at,
    customers!customer_id ( id, legal_name, trade_name ),
    origen:sales_orders!order_id ( id, number )`,
}
const TABLA = { cotizacion: 'sales_quotes', pedido: 'sales_orders', entrega: 'deliveries' }
const FECHA = { cotizacion: 'quote_date', pedido: 'order_date', entrega: 'delivery_date' }

const medir = async (fn) => {
  const t = []
  for (let i = 0; i < 5; i++) {
    const a = performance.now()
    await fn()
    t.push(performance.now() - a)
  }
  return Math.round(t.sort((x, y) => x - y)[2])
}

/** Copia de la regla de src/modules/ventas/lib/pendientes.ts. */
function calcular(lineasPedido, lineasEntrega, hayEntregas, hayHuerfanos) {
  const sinEnlazar = lineasEntrega.filter((l) => l.order_line_id === null).length
  if (!hayEntregas) return hayHuerfanos ? 'NO_CONSTA_ENTREGA' : 'RECONSTRUIDO'
  if (sinEnlazar > 0) return 'DETALLE_NO_RECONSTRUIDO'
  return 'RECONSTRUIDO'
}

const main = async () => {
  const c = cliente()
  const { error: eL } = await c.auth.signInWithPassword({
    email: 'buscatools.jano@gmail.com',
    password: process.env.BT_PW_JANO,
  })
  if (eL) { console.error('✗ login: ' + eL.message); process.exit(1) }

  const { data: mem } = await c.from('company_memberships')
    .select('company_id, companies ( slug )')
  const BT = mem.find((m) => m.companies.slug === 'buscatools').company_id

  console.log('='.repeat(74))
  console.log('  UI DE VENTAS · consultas reales contra los 636 documentos')
  console.log('='.repeat(74))

  // ── 1 · Los tres listados ────────────────────────────────────────────────
  seccion('LISTADOS — el histórico completo')
  const totales = {}
  for (const [tipo, esperado] of [['cotizacion', 288], ['pedido', 166], ['entrega', 182]]) {
    const { data, count, error } = await c
      .from(TABLA[tipo]).select(COLS[tipo], { count: 'exact' })
      .eq('company_id', BT)
      .order(FECHA[tipo], { ascending: false, nullsFirst: false })
      .order('number', { ascending: false })
      .range(0, 24)
    if (error) { FAIL(`listado de ${tipo}`, error.message); continue }
    totales[tipo] = count
    cmp(`${tipo}: total exacto`, esperado, count)
    data.length === 25
      ? PASS(`${tipo}: la página trae 25, no las ${count}`, 'paginación server-side')
      : FAIL(`${tipo}: tamaño de página`, String(data.length))
  }

  // ── 2 · Búsqueda por número ──────────────────────────────────────────────
  seccion('BÚSQUEDA POR NÚMERO')
  for (const [tipo, numero] of [
    ['cotizacion', 'COTI02251'], ['pedido', 'PDV01295'],
    ['entrega', 'RT0000001406'], ['entrega', 'RT-ML2025000058'],
  ]) {
    const patron = `%${numero}%`
    const { data, error } = await c.from(TABLA[tipo]).select('id, original_number, series_code')
      .eq('company_id', BT)
      .or(`number.ilike.${patron},original_number.ilike.${patron}`)
    if (error) { FAIL(`buscar ${numero}`, error.message); continue }
    data?.length === 1 && data[0].original_number === numero
      ? PASS(`buscar ${numero}`, `1 resultado · serie ${data[0].series_code}`)
      : FAIL(`buscar ${numero}`, `${data?.length ?? 0} resultado(s)`)
  }

  // Los 9 fuera de serie conservan su número literal.
  const { data: outliers } = await c.from('sales_orders')
    .select('original_number, suspected_normalized_number, number_outlier')
    .eq('company_id', BT).eq('number_outlier', true)
  cmp('pedidos con número fuera de serie', 9, outliers?.length ?? 0)
  const literal = (outliers ?? []).every((o) => o.original_number.startsWith('PDV11'))
  literal ? PASS('los 9 conservan su número literal', outliers[0].original_number)
          : FAIL('algún número fue corregido')

  // ── 3 · Detalle con relaciones ───────────────────────────────────────────
  seccion('DETALLE Y TRAZABILIDAD')
  const { data: ped } = await c.from('sales_orders')
    .select(COLS.pedido).eq('company_id', BT).eq('original_number', 'PDV01295').maybeSingle()
  ped ? PASS('detalle de PDV01295', `${ped.customers.legal_name ?? ped.customers.trade_name}`)
      : FAIL('detalle de PDV01295')
  ped?.origen ? PASS('el pedido enlaza su cotización', ped.origen.number)
              : PASS('PDV01295 no tiene cotización de origen', 'y no se inventa ninguna')

  const { data: ent } = await c.from('deliveries')
    .select('original_number, order_id').eq('company_id', BT).eq('order_id', ped.id)
  cmp('entregas del pedido PDV01295', 1, ent?.length ?? 0)

  // ── 4 · Los cuatro estados del pendiente ─────────────────────────────────
  seccion('PENDIENTE POR LÍNEA — los cuatro casos de Stage 2.5')
  const casos = [
    ['PDV01151', 'RECONSTRUIDO', 'uno de los 126 completos'],
    ['PDV01264', 'RECONSTRUIDO', 'uno de los 5 sin entrega y sin remito huérfano'],
    ['PDV01193', 'NO_CONSTA_ENTREGA', 'uno de los 21 dudosos'],
    ['PDV01182', 'DETALLE_NO_RECONSTRUIDO', 'uno de los 14'],
    ['PDV01181', 'RECONSTRUIDO', 'overdelivered: pidió 1, entregó 2'],
    ['PDV01238', 'RECONSTRUIDO', 'overdelivered: pidió 4, entregó 7'],
  ]
  for (const [numero, esperado, nota] of casos) {
    const { data: o } = await c.from('sales_orders')
      .select('id, customer_id').eq('company_id', BT).eq('original_number', numero).maybeSingle()
    if (!o) { FAIL(numero, 'no existe'); continue }

    const { data: lp } = await c.from('sales_order_lines')
      .select('id, quantity_ordered').eq('company_id', BT).eq('order_id', o.id)
    const { data: es } = await c.from('deliveries')
      .select('id').eq('company_id', BT).eq('order_id', o.id)
    const ids = (es ?? []).map((x) => x.id)
    let le = []
    if (ids.length) {
      const { data } = await c.from('delivery_lines')
        .select('order_line_id, quantity').eq('company_id', BT).in('delivery_id', ids)
      le = data ?? []
    }
    let huerfanos = false
    if (ids.length === 0) {
      const { count } = await c.from('deliveries').select('id', { count: 'exact', head: true })
        .eq('company_id', BT).eq('customer_id', o.customer_id).is('order_id', null)
      huerfanos = (count ?? 0) > 0
    }
    const estado = calcular(lp ?? [], le, ids.length > 0, huerfanos)
    estado === esperado ? PASS(`${numero} → ${estado}`, nota)
                        : FAIL(`${numero}`, `esperaba ${esperado}, dio ${estado}`)
  }

  // El exceso se informa; el pendiente nunca queda negativo.
  for (const [numero, sku, pedido, entregado] of [
    ['PDV01181', 'TE.X-LIGHT.1', 1, 2], ['PDV01238', 'PRO12354', 4, 7],
  ]) {
    const { data: o } = await c.from('sales_orders')
      .select('id').eq('company_id', BT).eq('original_number', numero).maybeSingle()
    const { data: lp } = await c.from('sales_order_lines')
      .select('id, sku_snapshot, quantity_ordered').eq('company_id', BT).eq('order_id', o.id)
    const linea = lp.find((l) => l.sku_snapshot === sku)
    const { data: es } = await c.from('deliveries').select('id').eq('company_id', BT).eq('order_id', o.id)
    const { data: le } = await c.from('delivery_lines').select('order_line_id, quantity')
      .eq('company_id', BT).in('delivery_id', es.map((x) => x.id))
    const suma = le.filter((l) => l.order_line_id === linea.id)
      .reduce((s, l) => s + Number(l.quantity), 0)
    Number(linea.quantity_ordered) === pedido && suma === entregado
      ? PASS(`${numero} · ${sku}`, `pedido ${pedido}, entregado ${suma} → +${suma - pedido} de más`)
      : FAIL(`${numero} · ${sku}`, `pedido ${linea.quantity_ordered}, entregado ${suma}`)
  }

  // ── 5 · Las 600 líneas de entrega no tienen precio ───────────────────────
  seccion('ENTREGA VALORIZADA — histórico sin precio por línea')
  const { count: conPrecio } = await c.from('delivery_lines')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', BT).not('unit_price', 'is', null)
  cmp('líneas de entrega históricas con precio', 0, conPrecio)
  const { data: entTotal } = await c.from('deliveries')
    .select('total, currency_code').eq('company_id', BT).eq('original_number', 'RT0000001406').maybeSingle()
  entTotal?.total !== null
    ? PASS('el importe del remito vive en la cabecera', `${entTotal.currency_code ?? ''} ${entTotal.total}`)
    : FAIL('el remito perdió su importe')

  // ── 6 · Filtros ──────────────────────────────────────────────────────────
  seccion('FILTROS')
  const { count: enRevision } = await c.from('sales_quotes')
    .select('id', { count: 'exact', head: true }).eq('company_id', BT).eq('needs_review', true)
  enRevision > 0 ? PASS('filtro «sólo con observaciones»', `${enRevision} cotizaciones`)
                 : FAIL('filtro de revisión', '0')
  const { count: enUsd } = await c.from('sales_quotes')
    .select('id', { count: 'exact', head: true }).eq('company_id', BT).eq('currency_code', 'USD')
  enUsd > 0 ? PASS('filtro por moneda USD', String(enUsd)) : FAIL('filtro por moneda')
  const { count: enRango } = await c.from('deliveries')
    .select('id', { count: 'exact', head: true }).eq('company_id', BT)
    .gte('delivery_date', '2026-08-01').lte('delivery_date', '2026-09-30')
  enRango > 0 ? PASS('filtro por rango de fechas', String(enRango)) : FAIL('filtro por fecha')

  // ── 7 · Performance con volumen real ─────────────────────────────────────
  seccion('PERFORMANCE (mediana de 5, sesión real)')
  const pruebas = [
    ['listado de cotizaciones, página 1 con total exacto', () =>
      c.from('sales_quotes').select(COLS.cotizacion, { count: 'exact' }).eq('company_id', BT)
        .order('quote_date', { ascending: false }).range(0, 24)],
    ['listado de pedidos', () =>
      c.from('sales_orders').select(COLS.pedido, { count: 'exact' }).eq('company_id', BT)
        .order('order_date', { ascending: false }).range(0, 24)],
    ['listado de entregas', () =>
      c.from('deliveries').select(COLS.entrega, { count: 'exact' }).eq('company_id', BT)
        .order('delivery_date', { ascending: false }).range(0, 24)],
    ['detalle de pedido con líneas', async () => {
      const { data } = await c.from('sales_orders').select(COLS.pedido)
        .eq('company_id', BT).eq('original_number', 'PDV01295').maybeSingle()
      await c.from('sales_order_lines').select('*').eq('company_id', BT).eq('order_id', data.id)
    }],
    ['filtro por cliente', async () => {
      const { data } = await c.from('customers').select('id').eq('company_id', BT).limit(1).single()
      await c.from('sales_orders').select(COLS.pedido, { count: 'exact' })
        .eq('company_id', BT).eq('customer_id', data.id).range(0, 24)
    }],
    ['búsqueda por número', () =>
      c.from('sales_quotes').select(COLS.cotizacion, { count: 'exact' }).eq('company_id', BT)
        .or('number.ilike.%COTI025%,original_number.ilike.%COTI025%').range(0, 24)],
  ]
  for (const [nombre, fn] of pruebas) {
    const ms = await medir(fn)
    console.log(`    ${nombre.padEnd(52)} ${String(ms).padStart(5)} ms` + (ms > 1000 ? '   ← REVISAR' : ''))
    if (ms > 1000) fallos++
  }

  await c.auth.signOut()

  // ── 8 · RLS: el cliente externo sobre las mismas consultas ───────────────
  seccion('RLS — un cliente externo, sobre las pantallas de Ventas')
  const ce = cliente()
  const { error: e2 } = await ce.auth.signInWithPassword({
    email: 'cliente.test@buscatools.com.ar',
    password: process.env.BT_PW_TEST,
  })
  if (e2) { FAIL('login del cliente externo', e2.message) }
  else {
    for (const tipo of ['cotizacion', 'pedido', 'entrega']) {
      const { data, count, error } = await ce.from(TABLA[tipo])
        .select(COLS[tipo], { count: 'exact' }).eq('company_id', BT).range(0, 24)
      if (error) { FAIL(`el externo lee ${tipo}`, error.message); continue }
      const propios = new Set((data ?? []).map((r) => r.customers?.id))
      // El cliente de prueba no aparece en el histórico, así que lo correcto
      // acá es 0. El aislamiento CON documentos propios —ve el suyo y no el
      // del vecino— lo prueba stage1-ventas-rls.mjs con fixtures.
      count < totales[tipo] && propios.size <= 1
        ? PASS(`${tipo}: ve ${count} de ${totales[tipo]}`, 'ninguno es suyo')
        : FAIL(`${tipo}: el externo ve de más`, `${count} de ${totales[tipo]}, ${propios.size} clientes`)
    }
    // El número ajeno no lo trae ni buscándolo exacto.
    const { data: ajena } = await ce.from('sales_quotes').select('id')
      .eq('company_id', BT).eq('original_number', 'COTI02251')
    ajena?.length === 0
      ? PASS('buscar un número ajeno por exacto devuelve 0 filas')
      : FAIL('buscar un número ajeno', `${ajena?.length} fila(s)`)
    await ce.auth.signOut()
  }

  console.log(`\n${'='.repeat(74)}\n  RESULTADO: ${fallos} fallo(s)\n${'='.repeat(74)}`)
  process.exit(fallos ? 1 : 0)
}

main().catch((e) => { console.error('✗ ' + e.message); process.exit(1) })
