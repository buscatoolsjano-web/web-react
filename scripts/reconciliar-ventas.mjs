/**
 * Fase 4 · Stage 2 — reconciliación del histórico de Ventas.
 *
 * Compara legacy contra la base nueva documento por documento. Un delta
 * distinto de cero no se explica: se lista con los documentos concretos.
 *
 * La reconciliación monetaria NO suma monedas distintas: informa USD, ARS y
 * SIN MONEDA por separado, y dentro de cada una, con y sin tipo de cambio.
 *
 *   set -a; source .env.migration; set +a
 *   node scripts/reconciliar-ventas.mjs <erp_store-completo.json>
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const ENTRADA = process.argv[2]
if (!ENTRADA) { console.error('Falta el archivo del legacy'); process.exit(1) }

const sb = createClient(
  process.env.SUPABASE_URL ?? 'https://uaxcfufvapzulqvynanp.supabase.co',
  process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })

let fallos = 0
const OK = (t, d = '') => console.log(`  OK    ${t}${d ? ' — ' + d : ''}`)
const KO = (t, d = '') => { fallos++; console.log(`  DELTA ${t}${d ? ' — ' + d : ''}`) }
const cmp = (t, legacy, nuevo, extra = '') =>
  legacy === nuevo ? OK(t, `${legacy}`) : KO(t, `legacy ${legacy} · nuevo ${nuevo} · Δ ${nuevo - legacy} ${extra}`)

async function traerTodo(tabla, select, filtro = (q) => q, orden = ['id']) {
  const filas = []
  for (let d = 0; ; d += 1000) {
    let q = filtro(sb.from(tabla).select(select))
    for (const c of orden) q = q.order(c, { ascending: true })
    const { data, error } = await q.range(d, d + 999)
    if (error) throw new Error(`${tabla}: ${error.message}`)
    filas.push(...(data ?? [])); if (!data || data.length < 1000) break
  }
  return filas
}

const main = async () => {
  const store = JSON.parse(fs.readFileSync(ENTRADA, 'utf8'))
  const v = (k) => store.find((r) => r.key === k)?.value ?? []
  const cots = v('erp_cotizaciones'), peds = v('erp_pedidos'), nes = v('erp_notas_entrega')
  const { data: emp } = await sb.from('companies').select('id').eq('slug', 'buscatools').single()
  const BT = emp.id
  const f = (q) => q.eq('company_id', BT)

  console.log('═'.repeat(74))
  console.log('  RECONCILIACIÓN · legacy vs base nueva')
  console.log('═'.repeat(74))

  // ── Documentos y líneas ───────────────────────────────────────────────────
  const nq = await traerTodo('sales_quotes', 'id, original_number, currency_code, exchange_rate, total, customer_id, needs_review', f, ['original_number'])
  const nqL = await traerTodo('sales_quote_lines', 'quote_id, line_no, product_id, quantity, unit_price, sku_snapshot', f, ['quote_id', 'line_no'])
  const no = await traerTodo('sales_orders', 'id, original_number, currency_code, exchange_rate, total, customer_id, quote_id, needs_review, number_outlier, suspected_normalized_number', f, ['original_number'])
  const noL = await traerTodo('sales_order_lines', 'order_id, line_no, product_id, quantity_ordered, sku_snapshot', f, ['order_id', 'line_no'])
  const nd = await traerTodo('deliveries', 'id, original_number, currency_code, exchange_rate, total, customer_id, order_id, needs_review', f, ['original_number'])
  const ndL = await traerTodo('delivery_lines', 'delivery_id, product_id, quantity, sku_snapshot', f, ['delivery_id'])

  console.log('\n── DOCUMENTOS ──')
  cmp('cotizaciones', cots.length, nq.length)
  cmp('pedidos', peds.length, no.length)
  cmp('entregas', nes.length, nd.length)
  cmp('TOTAL', cots.length + peds.length + nes.length, nq.length + no.length + nd.length)

  console.log('\n── LÍNEAS ──')
  const lineasLegacy = (arr) => arr.reduce((s, d) => s + (d.items ?? []).filter((i) => Number(i.qty) > 0).length, 0)
  cmp('líneas de cotización', lineasLegacy(cots), nqL.length)
  cmp('líneas de pedido', lineasLegacy(peds), noL.length)
  cmp('líneas de entrega', lineasLegacy(nes), ndL.length)
  cmp('TOTAL de líneas', lineasLegacy(cots) + lineasLegacy(peds) + lineasLegacy(nes),
      nqL.length + noL.length + ndL.length)

  // ── Números: uno a uno ────────────────────────────────────────────────────
  console.log('\n── NÚMEROS ORIGINALES ──')
  for (const [t, leg, nue] of [['cotizaciones', cots, nq], ['pedidos', peds, no], ['entregas', nes, nd]]) {
    const L = new Set(leg.map((d) => d.ref)), N = new Set(nue.map((r) => r.original_number))
    const faltan = [...L].filter((x) => !N.has(x)), sobran = [...N].filter((x) => !L.has(x))
    faltan.length === 0 && sobran.length === 0
      ? OK(`${t}: los ${L.size} números coinciden`)
      : KO(`${t}`, `faltan ${faltan.slice(0, 5).join(',')} · sobran ${sobran.slice(0, 5).join(',')}`)
  }

  // ── Vínculos ──────────────────────────────────────────────────────────────
  console.log('\n── VÍNCULOS ──')
  cmp('pedidos con cotización', peds.filter((p) => p.fromCotizacion).length,
      no.filter((r) => r.quote_id).length)
  cmp('entregas con pedido', nes.filter((n) => n.fromPedido).length,
      nd.filter((r) => r.order_id).length)
  const sinCli = [...nq, ...no, ...nd].filter((r) => !r.customer_id).length
  sinCli === 0 ? OK('todos los documentos tienen cliente resuelto')
               : KO('documentos sin cliente', String(sinCli))

  // ── Totales, por moneda, SIN sumar entre monedas ─────────────────────────
  console.log('\n── TOTALES POR MONEDA (nunca sumados entre sí) ──')
  const grupos = {}
  const acumular = (moneda, tc, total, dest) => {
    const k = moneda ?? 'SIN MONEDA'
    grupos[k] ??= { legacy: { n: 0, t: 0, conTC: 0 }, nuevo: { n: 0, t: 0, conTC: 0 } }
    grupos[k][dest].n++
    grupos[k][dest].t += Number(total) || 0
    if (tc != null && tc !== '') grupos[k][dest].conTC++
  }
  for (const d of [...cots, ...peds, ...nes]) acumular(d.moneda, d.tc, d.total, 'legacy')
  for (const r of [...nq, ...no, ...nd]) acumular(r.currency_code, r.exchange_rate, r.total, 'nuevo')

  console.log('  moneda        docs legacy / nuevo    total legacy        total nuevo         con TC')
  for (const [m, g] of Object.entries(grupos)) {
    const igualN = g.legacy.n === g.nuevo.n
    const igualT = Math.abs(g.legacy.t - g.nuevo.t) < 0.01
    if (!igualN || !igualT) fallos++
    console.log(`  ${m.padEnd(12)}${String(g.legacy.n).padStart(6)} / ${String(g.nuevo.n).padEnd(6)}` +
      `${g.legacy.t.toLocaleString('es-AR', { maximumFractionDigits: 2 }).padStart(20)}` +
      `${g.nuevo.t.toLocaleString('es-AR', { maximumFractionDigits: 2 }).padStart(20)}` +
      `${String(g.nuevo.conTC).padStart(8)}` +
      (igualN && igualT ? '   OK' : '   *** DELTA ***'))
  }
  console.log('  (no se presenta ningún total global: sumar ARS con USD no significa nada)')

  // ── SKU ───────────────────────────────────────────────────────────────────
  console.log('\n── RESOLUCIÓN DE PRODUCTO ──')
  const todasL = [...nqL.map((l) => ({ p: l.product_id, s: l.sku_snapshot })),
                  ...noL.map((l) => ({ p: l.product_id, s: l.sku_snapshot })),
                  ...ndL.map((l) => ({ p: l.product_id, s: l.sku_snapshot }))]
  const resueltas = todasL.filter((l) => l.p).length
  const sinResolver = todasL.filter((l) => !l.p)
  console.log(`  líneas totales      ${todasL.length}`)
  console.log(`  con product_id      ${resueltas}  (${(100 * resueltas / todasL.length).toFixed(1)}%)`)
  console.log(`  sin resolver        ${sinResolver.length}  → conservan sku_snapshot`)
  const sinSnapshot = sinResolver.filter((l) => !l.s).length
  sinSnapshot === 0
    ? OK('todas las líneas sin producto conservan su SKU original')
    : KO('líneas sin producto NI snapshot', String(sinSnapshot))
  const prefijos = {}
  for (const l of sinResolver) { const p = (l.s ?? '').match(/^[A-Z]+/)?.[0] ?? '?'; prefijos[p] = (prefijos[p] ?? 0) + 1 }
  console.log('  prefijos sin resolver: ' + Object.entries(prefijos).sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}=${n}`).join('  '))

  // ── Cola de revisión ──────────────────────────────────────────────────────
  console.log('\n── COLA DE REVISIÓN ──')
  const conRev = [...nq, ...no, ...nd].filter((r) => r.needs_review)
  const porMotivo = {}
  for (const t of ['sales_quotes', 'sales_orders', 'deliveries']) {
    const filas = await traerTodo(t, 'original_number, review_reason', (q) => f(q).eq('needs_review', true), ['original_number'])
    for (const r of filas) {
      for (const m of (r.review_reason ?? '').split(' | ')) {
        const k = m.split(':')[0]
        porMotivo[k] ??= { docs: 0, ejemplos: [] }
        porMotivo[k].docs++
        if (porMotivo[k].ejemplos.length < 3) porMotivo[k].ejemplos.push(r.original_number)
      }
    }
  }
  console.log(`  documentos con needs_review: ${conRev.length} de ${nq.length + no.length + nd.length}`)
  console.log('\n  motivo                        docs   ejemplos')
  for (const [m, v2] of Object.entries(porMotivo).sort((a, b) => b[1].docs - a[1].docs)) {
    console.log(`  ${m.padEnd(30)}${String(v2.docs).padStart(5)}   ${v2.ejemplos.join(', ')}`)
  }

  // ── Outliers ──────────────────────────────────────────────────────────────
  console.log('\n── NÚMEROS FUERA DE SERIE ──')
  const out = no.filter((r) => r.number_outlier)
  console.log(`  pedidos marcados: ${out.length}`)
  for (const r of out.slice(0, 10)) {
    console.log(`    ${r.original_number}  →  sospecha ${r.suspected_normalized_number}` +
      `   (el número original NO se modificó)`)
  }

  // ── Lo que NO se migró ────────────────────────────────────────────────────
  console.log('\n── LO QUE NO SE MIGRÓ, Y POR QUÉ ──')
  for (const [t, motivo] of [
    ['sales_invoices', 'histórico NO DISPONIBLE / NO ENCONTRADO — no se reconstruye desde entregas'],
    ['payments', 'ídem'],
    ['payment_allocations', 'ídem'],
    ['stock_movements', 'la migración no altera el stock actual'],
    ['stock_reservations', 'no se reserva stock por pedidos históricos'],
    ['sales_audit', 'no se llena por migración'],
    ['customer_purchase_orders', 'ninguna OC se crea automáticamente desde texto'],
  ]) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true })
    const esperado = t === 'stock_movements' ? 381 : 0
    console.log(`  ${t.padEnd(28)}${String(count).padStart(5)}   ${count === esperado ? '' : '← REVISAR   '}${motivo}`)
    if (count !== esperado) fallos++
  }

  console.log('\n' + '═'.repeat(74))
  console.log(`  RESULTADO: ${fallos} delta(s)`)
  console.log('═'.repeat(74))
  process.exit(fallos ? 1 : 0)
}

main().catch((e) => { console.error('✗ ' + e.message); process.exit(1) })
