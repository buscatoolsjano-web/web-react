/**
 * Fase 4 · Stage 2.5 — reconstrucción de delivery_lines.order_line_id.
 *
 * El legacy nunca guardó la relación línea-de-entrega ↔ línea-de-pedido: sólo
 * `fromPedido` a nivel documento. Este script la reconstruye SÓLO donde la
 * evidencia es inequívoca, y deja constancia de lo demás.
 *
 * Reglas (no negociables, en este orden):
 *   1. Los candidatos se buscan EXCLUSIVAMENTE dentro del sales_order enlazado.
 *   2. product_id exacto, cuando ambos lados están resueltos.
 *   3. sku_snapshot exacto (btrim), sólo si (2) no encontró ninguno.
 *   4. Se enlaza sólo con EXACTAMENTE 1 candidata. 0 → UNRESOLVED. 2+ → AMBIGUOUS.
 *
 * Nada de fuzzy, nada de nombres parecidos, nada de posición de array, y la
 * cantidad NUNCA decide el match: se usa después, sólo para validar.
 *
 *   set -a; source .env.migration; set +a
 *   node scripts/backfill-order-line-id.mjs            # dry run
 *   node scripts/backfill-order-line-id.mjs --apply
 */
import { createClient } from '@supabase/supabase-js'

const APLICAR = process.argv.includes('--apply')

const sb = createClient(
  process.env.SUPABASE_URL ?? 'https://uaxcfufvapzulqvynanp.supabase.co',
  process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })

const norm = (s) => (s ?? '').trim() || null

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
  const { data: emp } = await sb.from('companies').select('id').eq('slug', 'buscatools').single()
  const BT = emp.id
  const f = (q) => q.eq('company_id', BT)

  const entregas = await traerTodo('deliveries',
    'id, original_number, order_id, needs_review, review_reason', f, ['original_number'])
  const dl = await traerTodo('delivery_lines',
    'id, delivery_id, order_line_id, product_id, sku_snapshot, quantity', f, ['delivery_id', 'id'])
  const pedidos = await traerTodo('sales_orders', 'id, original_number', f, ['original_number'])
  const sol = await traerTodo('sales_order_lines',
    'id, order_id, line_no, product_id, sku_snapshot, quantity_ordered', f, ['order_id', 'line_no'])

  const entregaPorId = new Map(entregas.map((d) => [d.id, d]))
  const pedidoPorId = new Map(pedidos.map((o) => [o.id, o]))
  const solPorId = new Map(sol.map((l) => [l.id, l]))
  const solPorPedido = new Map()
  for (const l of sol) {
    if (!solPorPedido.has(l.order_id)) solPorPedido.set(l.order_id, [])
    solPorPedido.get(l.order_id).push(l)
  }

  // ── Clasificación ─────────────────────────────────────────────────────────
  const prop = []
  for (const l of dl) {
    const d = entregaPorId.get(l.delivery_id)
    const fila = { dl: l, entrega: d, pedido: null, sol: null, clase: '', razon: '' }
    if (!d?.order_id) { fila.clase = 'NO_ORDER'; prop.push(fila); continue }
    fila.pedido = pedidoPorId.get(d.order_id)
    const lineas = solPorPedido.get(d.order_id) ?? []

    const porPid = l.product_id ? lineas.filter((x) => x.product_id === l.product_id) : []
    const sku = norm(l.sku_snapshot)
    const porSku = sku ? lineas.filter((x) => norm(x.sku_snapshot) === sku) : []

    if (porPid.length === 1) { fila.sol = porPid[0]; fila.clase = 'UNIQUE_MATCH'; fila.razon = 'PRODUCT_ID_UNIQUE' }
    else if (porPid.length === 0 && porSku.length === 1) { fila.sol = porSku[0]; fila.clase = 'UNIQUE_MATCH'; fila.razon = 'SKU_UNIQUE' }
    else if (porPid.length > 1 || porSku.length > 1) {
      fila.clase = 'AMBIGUOUS'
      fila.razon = porPid.length > 1 ? `PRODUCT_ID_x${porPid.length}` : `SKU_x${porSku.length}`
    } else { fila.clase = 'UNRESOLVED'; fila.razon = 'SKU_NO_ESTA_EN_EL_PEDIDO' }
    prop.push(fila)
  }

  const enUniverso = prop.filter((p) => p.clase !== 'NO_ORDER')
  const unicos = prop.filter((p) => p.clase === 'UNIQUE_MATCH')
  const ambiguos = prop.filter((p) => p.clase === 'AMBIGUOUS')
  const noResueltos = prop.filter((p) => p.clase === 'UNRESOLVED')

  console.log('='.repeat(78))
  console.log(`  BACKFILL order_line_id  ·  ${APLICAR ? 'APLICAR' : 'DRY RUN (no escribe)'}`)
  console.log('='.repeat(78))
  const pct = (n) => `${(100 * n / enUniverso.length).toFixed(1)}%`
  console.log(`\n  delivery_lines totales           ${dl.length}`)
  console.log(`  ya vinculadas                    ${dl.filter((l) => l.order_line_id).length}`)
  console.log(`  sin pedido origen (fuera)        ${prop.filter((p) => p.clase === 'NO_ORDER').length}`)
  console.log(`  -- universo evaluable            ${enUniverso.length}`)
  console.log(`     UNIQUE_MATCH                  ${unicos.length}  (${pct(unicos.length)})`)
  console.log(`       · por product_id            ${unicos.filter((p) => p.razon === 'PRODUCT_ID_UNIQUE').length}`)
  console.log(`       · por sku_snapshot          ${unicos.filter((p) => p.razon === 'SKU_UNIQUE').length}`)
  console.log(`     AMBIGUOUS                     ${ambiguos.length}  (${pct(ambiguos.length)})`)
  console.log(`     UNRESOLVED                    ${noResueltos.length}  (${pct(noResueltos.length)})`)

  // ── Cobertura por pedido ──────────────────────────────────────────────────
  const porPedido = new Map()
  for (const p of enUniverso) {
    const k = p.pedido.id
    if (!porPedido.has(k)) porPedido.set(k, { num: p.pedido.original_number, n: 0, ok: 0 })
    const v = porPedido.get(k); v.n++; if (p.clase === 'UNIQUE_MATCH') v.ok++
  }
  const completos = [...porPedido.values()].filter((v) => v.ok === v.n)
  const parciales = [...porPedido.values()].filter((v) => v.ok > 0 && v.ok < v.n)
  const nulos = [...porPedido.values()].filter((v) => v.ok === 0)
  console.log(`\n  pedidos con entrega enlazada     ${porPedido.size}`)
  console.log(`     100% reconstruibles           ${completos.length}`)
  console.log(`     parciales                     ${parciales.length}   ${parciales.map((v) => v.num).join(' ')}`)
  console.log(`     sin ningún match              ${nulos.length}   ${nulos.map((v) => v.num).join(' ')}`)
  console.log(`  pedidos SIN entrega enlazada     ${pedidos.length - porPedido.size}`)

  // ── Validación por cantidad (nunca decide el match) ───────────────────────
  const entregadoPorSol = new Map()
  for (const p of unicos) {
    entregadoPorSol.set(p.sol.id, (entregadoPorSol.get(p.sol.id) ?? 0) + Number(p.dl.quantity))
  }
  const cant = { OK: 0, OVERDELIVERED: 0, UNDERDELIVERED: 0 }
  const sobre = []
  for (const [solId, q] of entregadoPorSol) {
    const l = solPorId.get(solId), pedido = Number(l.quantity_ordered)
    const d = Math.round((q - pedido) * 10000) / 10000
    if (d === 0) cant.OK++
    else if (d > 0) { cant.OVERDELIVERED++; sobre.push({ l, q, pedido }) }
    else cant.UNDERDELIVERED++
  }
  const solEnJuego = [...porPedido.keys()].flatMap((id) => solPorPedido.get(id) ?? [])
  const desconocidas = solEnJuego.filter((l) => !entregadoPorSol.has(l.id)).length
  console.log(`\n  -- validación por cantidad (sum(entrega) vs pedido) --`)
  console.log(`     order_lines alcanzadas        ${entregadoPorSol.size}`)
  console.log(`     OK                            ${cant.OK}`)
  console.log(`     UNDERDELIVERED (= pendiente)  ${cant.UNDERDELIVERED}`)
  console.log(`     OVERDELIVERED (revisar)       ${cant.OVERDELIVERED}`)
  console.log(`     UNKNOWN (sin ninguna entrega) ${desconocidas}`)
  for (const s of sobre) {
    const o = pedidoPorId.get(s.l.order_id)
    console.log(`       ! ${o.original_number}  línea ${s.l.line_no}  ${s.l.sku_snapshot}` +
      `  pedido ${s.pedido}  entregado ${s.q}`)
  }

  // ── Detalle de lo que NO se enlaza ────────────────────────────────────────
  if (ambiguos.length + noResueltos.length) {
    console.log('\n  -- NO se enlaza (queda order_line_id = NULL) --')
    console.log('     PEDIDO      ENTREGA         SKU                  QTY   CLASE       MOTIVO')
    for (const p of [...ambiguos, ...noResueltos]) {
      console.log(`     ${p.pedido.original_number.padEnd(11)} ${p.entrega.original_number.padEnd(15)} ` +
        `${(p.dl.sku_snapshot ?? '-').padEnd(20)} ${String(Number(p.dl.quantity)).padStart(5)}   ` +
        `${p.clase.padEnd(11)} ${p.razon}`)
    }
  }

  // ── Escritura ─────────────────────────────────────────────────────────────
  const aEscribir = unicos.filter((p) => p.dl.order_line_id !== p.sol.id)
  console.log(`\n  filas a actualizar               ${aEscribir.length}` +
    (aEscribir.length === 0 ? '   <- idempotente: ya estaba todo' : ''))

  if (!APLICAR) {
    console.log('\n  DRY RUN: no se escribió nada.')
    console.log('='.repeat(78))
    return
  }

  // Lotes chicos y con reintento: 200 updates en paralelo hacen fallar el fetch.
  const conReintento = async (fn, quien) => {
    for (let intento = 1; ; intento++) {
      try {
        const { error } = await fn()
        if (error) throw new Error(error.message)
        return
      } catch (e) {
        if (intento === 4) throw new Error(`${quien}: ${e.message}`)
        await new Promise((r) => setTimeout(r, 300 * intento))
      }
    }
  }

  let escritas = 0
  for (let i = 0; i < aEscribir.length; i += 25) {
    const lote = aEscribir.slice(i, i + 25)
    await Promise.all(lote.map(async (p) => {
      await conReintento(() => sb.from('delivery_lines')
        .update({ order_line_id: p.sol.id }).eq('id', p.dl.id), `delivery_lines ${p.dl.id}`)
      escritas++
    }))
  }
  console.log(`  actualizadas                     ${escritas}`)

  // ── Metadatos de revisión, sin tocar los ya existentes ────────────────────
  const motivosPorEntrega = new Map()
  const marcar = (entrega, token) => {
    if (!motivosPorEntrega.has(entrega.id)) motivosPorEntrega.set(entrega.id, { entrega, tokens: new Set() })
    motivosPorEntrega.get(entrega.id).tokens.add(token)
  }
  for (const p of ambiguos) marcar(p.entrega, 'ORDER_LINE_AMBIGUOUS')
  for (const p of noResueltos) marcar(p.entrega, 'ORDER_LINE_UNRESOLVED')
  for (const s of sobre) {
    for (const p of unicos.filter((x) => x.sol.id === s.l.id)) marcar(p.entrega, 'OVERDELIVERED')
  }

  let marcadas = 0
  for (const { entrega, tokens } of motivosPorEntrega.values()) {
    const actuales = (entrega.review_reason ?? '').split(' | ').filter(Boolean)
    const nuevos = [...tokens].filter((t) => !actuales.includes(t))
    if (nuevos.length === 0) continue
    const { error } = await sb.from('deliveries').update({
      needs_review: true,
      review_reason: [...actuales, ...nuevos].join(' | '),
    }).eq('id', entrega.id)
    if (error) throw new Error(`deliveries ${entrega.id}: ${error.message}`)
    marcadas++
  }
  console.log(`  entregas marcadas para revisión  ${marcadas}` +
    (marcadas === 0 ? '   <- idempotente: ya estaban marcadas' : ''))
  console.log('='.repeat(78))
}

main().catch((e) => { console.error('✗ ' + e.message); process.exit(1) })
