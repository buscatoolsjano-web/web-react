/**
 * Fase 4 · Stage 2 — importación del histórico de Ventas.
 *
 * REGLA CENTRAL: la migración no corrige la historia. Ningún total se
 * recalcula, ningún tipo de cambio se inventa, ningún número se arregla,
 * ninguna relación se deduce. Lo que no se puede afirmar queda con
 * `needs_review` y su motivo.
 *
 * IDEMPOTENTE: la clave estable es (company_id, original_number), que es el
 * `ref` del legacy. Sirve también para los 9 "PDV11xxx", porque el número
 * original se preserva literal.
 *
 * No toca stock: no genera movimientos ni reservas. El histórico comercial se
 * migra para consulta; el stock actual sigue siendo la fuente del presente.
 *
 *   set -a; source .env.migration; set +a
 *   node scripts/import-ventas-legacy.mjs <erp_store-completo.json> [--dry-run]
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const [, , ENTRADA, ...flags] = process.argv
const DRY = flags.includes('--dry-run')
if (!ENTRADA) {
  console.error('Uso: node scripts/import-ventas-legacy.mjs <erp_store-completo.json> [--dry-run]')
  process.exit(1)
}

const sb = createClient(
  process.env.SUPABASE_URL ?? 'https://uaxcfufvapzulqvynanp.supabase.co',
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } },
)

const LOTE = 400
const AHORA = new Date().toISOString()

// ── Utilidades ──────────────────────────────────────────────────────────────

/** Paginación con orden TOTAL. Sin ORDER BY, .range() repite y omite filas. */
async function traerTodo(tabla, select, filtro = (q) => q, orden = ['id']) {
  const filas = []
  for (let desde = 0; ; desde += 1000) {
    let q = filtro(sb.from(tabla).select(select))
    for (const c of orden) q = q.order(c, { ascending: true })
    const { data, error } = await q.range(desde, desde + 999)
    if (error) throw new Error(`${tabla}: ${error.message}`)
    filas.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return filas
}

async function insertarEnLotes(tabla, filas) {
  if (DRY || filas.length === 0) return filas.length
  for (let i = 0; i < filas.length; i += LOTE) {
    const { error } = await sb.from(tabla).insert(filas.slice(i, i + LOTE))
    if (error) throw new Error(`${tabla} lote ${i}: ${error.message}`)
  }
  return filas.length
}

const norm = (s) =>
  (s ?? '').toString().trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim()

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const sumaLineas = (d) =>
  (d.items ?? []).reduce(
    (s, it) => s + (num(it.qty) ?? 0) * (num(it.price) ?? 0) * (1 - (num(it.dto) ?? 0) / 100), 0)

/**
 * Alícuota efectiva del documento y su tratamiento.
 *
 * El legacy NO tiene impuesto por línea: sólo un flag `iva` y un `ivaAmount`
 * a nivel documento. Se representa lo que realmente se aplicó, sin inventar
 * un desglose que nunca existió.
 */
function tratamientoFiscal(d) {
  if (d.iva === false) return { treatment: 'not_taxed', rate: 0 }
  const base = num(d.base) ?? 0
  const iva = num(d.ivaAmount) ?? 0
  if (base === 0) return { treatment: 'other', rate: 0 }
  const pct = Math.round((iva / base) * 1000) / 10
  if (Math.abs(pct - 21) < 0.5) return { treatment: 'vat_21', rate: 21 }
  if (Math.abs(pct - 10.5) < 0.5) return { treatment: 'vat_105', rate: 10.5 }
  if (pct === 0) return { treatment: 'vat_0', rate: 0 }
  return { treatment: 'other', rate: pct }
}

/** Motivos de revisión de un documento. Cada uno es una afirmación verificable. */
function motivos(d, tipo, skusConocidos) {
  const m = []
  if (!d.moneda) m.push('MISSING_CURRENCY')
  if (d.moneda && d.moneda !== 'USD' && (d.tc == null || d.tc === '')) m.push('NO_EXCHANGE_RATE')
  const sinSku = (d.items ?? []).filter((i) => !skusConocidos.has((i.sku ?? '').trim())).length
  if (sinSku > 0) m.push(`UNRESOLVED_SKU:${sinSku}`)
  const base = num(d.base) ?? 0
  if (Math.abs(sumaLineas(d) - base) > Math.max(0.5, base * 0.005)) m.push('TOTALS_DO_NOT_CLOSE')
  if (tipo === 'order' && !d.fromCotizacion) m.push('NO_QUOTE_LINK')
  if (tipo === 'delivery' && !d.fromPedido) m.push('NO_ORDER_LINK')
  if (tipo === 'order' && d.entregado) m.push('DELIVERED_BY_ARRAY_INDEX')
  const n = (d.ref ?? '').match(/PDV(\d+)/)
  if (tipo === 'order' && n && Number(n[1]) > 2000) m.push('NUMBER_OUTLIER')
  return m
}

function clasificar(m) {
  if (m.length === 0) return 'MIGRABLE_AUTOMATIC'
  if (m.some((x) => x === 'MISSING_CURRENCY' || x === 'TOTALS_DO_NOT_CLOSE')) return 'UNRESOLVED'
  return 'MIGRABLE_WITH_REVIEW'
}

// ── Importación ─────────────────────────────────────────────────────────────

const main = async () => {
  console.log('═'.repeat(74))
  console.log(`  IMPORTACIÓN DEL HISTÓRICO DE VENTAS${DRY ? '  ·  DRY RUN' : ''}`)
  console.log('═'.repeat(74))

  const store = JSON.parse(fs.readFileSync(ENTRADA, 'utf8'))
  const clave = (k) => store.find((r) => r.key === k)?.value
  const cots = clave('erp_cotizaciones') ?? []
  const peds = clave('erp_pedidos') ?? []
  const nes = clave('erp_notas_entrega') ?? []
  const memoria = clave('spd_client_memory_v1') ?? {}
  const contactos = clave('erp_contactos') ?? []
  console.log(`  legacy: ${cots.length} cotizaciones · ${peds.length} pedidos · ${nes.length} entregas`)

  const { data: empresa, error: eE } = await sb
    .from('companies').select('id').eq('slug', 'buscatools').single()
  if (eE) throw new Error('empresa: ' + eE.message)
  const BT = empresa.id

  // ── Catálogo y clientes existentes ────────────────────────────────────────
  const productos = await traerTodo('products', 'id, sku', (q) => q.eq('company_id', BT), ['sku'])
  const idPorSku = new Map(productos.map((p) => [p.sku, p.id]))
  const skus = new Set(idPorSku.keys())
  console.log(`  catálogo: ${skus.size} SKU`)

  // ══ 1 · CLIENTES ══════════════════════════════════════════════════════════
  console.log('\n── 1 · CLIENTES ──')
  const existentes = await traerTodo('customers', 'id, legal_name, trade_name, legacy_name',
    (q) => q.eq('company_id', BT), ['legal_name'])
  const porNombre = new Map()
  for (const c of existentes) {
    for (const n of [c.legal_name, c.trade_name, c.legacy_name].filter(Boolean)) {
      porNombre.set(norm(n), c.id)
    }
  }

  const nombresLegacy = new Map()
  for (const d of [...cots, ...peds, ...nes]) {
    const n = (d.cliente ?? '').trim()
    if (n) nombresLegacy.set(norm(n), n)
  }

  const nuevosClientes = []
  for (const [k, original] of nombresLegacy) {
    if (porNombre.has(k)) continue
    nuevosClientes.push({
      company_id: BT, legal_name: original, legacy_name: original, status: 'active',
    })
  }
  await insertarEnLotes('customers', nuevosClientes)
  console.log(`  existentes ${existentes.length} · creados ${nuevosClientes.length}`)

  const todosClientes = await traerTodo('customers', 'id, legal_name, trade_name, legacy_name',
    (q) => q.eq('company_id', BT), ['legal_name'])
  const clienteId = new Map()
  for (const c of todosClientes) {
    for (const n of [c.legal_name, c.trade_name, c.legacy_name].filter(Boolean)) {
      clienteId.set(norm(n), c.id)
    }
  }

  // ══ 2 · DOCUMENTOS ════════════════════════════════════════════════════════
  const resumen = {}

  /** Construye la cabecera común a los tres tipos de documento. */
  const cabecera = (d, tipo) => {
    const m = motivos(d, tipo, skus)
    const clase = clasificar(m)
    const outlier = m.includes('NUMBER_OUTLIER')
    const n = (d.ref ?? '').match(/^([A-Z]+)(\d+)$/)
    return {
      base: {
        company_id: BT,
        number: d.ref,
        original_number: d.ref,
        // Sólo una SOSPECHA, nunca aplicada: los 9 PDV11xxx parecen el número
        // correcto con un 1 de más, y 7 de los 8 huecos de la serie los llena
        // exactamente uno de ellos.
        suspected_normalized_number: outlier && n ? n[1] + String(n[2]).slice(1) : null,
        number_outlier: outlier,
        customer_id: clienteId.get(norm(d.cliente)) ?? null,
        title: d.titulo ?? null,
        // NULL cuando el dato no existe. No se asume ninguna moneda.
        currency_code: d.moneda ?? null,
        // NULL cuando no se registró. No se inventa el tipo de cambio.
        exchange_rate: num(d.tc),
        // Totales ORIGINALES. No se recalculan ni cuando no cierran.
        subtotal: num(d.base),
        tax_amount: num(d.ivaAmount),
        total: num(d.total),
        notes: d.formaPago ? `Forma de pago legacy: ${d.formaPago}` : null,
        needs_review: m.length > 0,
        review_reason: m.length > 0 ? m.join(' | ') : null,
        imported_at: AHORA,
        legacy_source: 'erp_store',
      },
      motivos: m, clase,
    }
  }

  const lineas = (d, fkNombre, fkValor) => {
    const { treatment, rate } = tratamientoFiscal(d)
    return (d.items ?? []).map((it, i) => {
      const sku = (it.sku ?? '').trim()
      return {
        company_id: BT,
        [fkNombre]: fkValor,
        line_no: i + 1,
        // NULL cuando el SKU no resuelve: la línea histórica se conserva
        // entera por snapshot y el documento se puede leer igual.
        product_id: idPorSku.get(sku) ?? null,
        sku_snapshot: sku || null,
        name_snapshot: it.nombre ?? null,
        description_snapshot: it.desc ?? null,
        unit_price: num(it.price) ?? 0,
        discount_pct: num(it.dto) ?? 0,
        // El legacy no tiene impuesto por línea: se registra el tratamiento
        // efectivo del documento, sin inventar un desglose.
        tax_treatment: treatment,
        tax_rate_snapshot: rate,
        line_type: 'item',
      }
    })
  }

  // ── 2a · Cotizaciones ─────────────────────────────────────────────────────
  console.log('\n── 2 · COTIZACIONES ──')
  const yaCot = new Set((await traerTodo('sales_quotes', 'original_number',
    (q) => q.eq('company_id', BT), ['original_number'])).map((r) => r.original_number))
  const clasesCot = { MIGRABLE_AUTOMATIC: 0, MIGRABLE_WITH_REVIEW: 0, UNRESOLVED: 0 }
  const filasCot = []
  for (const d of cots) {
    const { base, clase } = cabecera(d, 'quote')
    clasesCot[clase]++
    if (yaCot.has(d.ref)) continue
    filasCot.push({ ...base, quote_date: d.fecha ?? null,
      status: d.estado === 'cerrada' ? 'accepted' : d.estado === 'rechazada' ? 'rejected' : 'sent' })
  }
  await insertarEnLotes('sales_quotes', filasCot)
  console.log(`  insertadas ${filasCot.length} (ya estaban ${yaCot.size})`)

  const cotPorRef = new Map((await traerTodo('sales_quotes', 'id, original_number',
    (q) => q.eq('company_id', BT), ['original_number'])).map((r) => [r.original_number, r.id]))

  const yaLineasCot = new Set((await traerTodo('sales_quote_lines', 'quote_id, line_no',
    (q) => q.eq('company_id', BT), ['quote_id', 'line_no'])).map((r) => `${r.quote_id}|${r.line_no}`))
  const filasLinCot = []
  for (const d of cots) {
    const qid = cotPorRef.get(d.ref)
    if (!qid) continue
    for (const l of lineas(d, 'quote_id', qid)) {
      if (yaLineasCot.has(`${qid}|${l.line_no}`)) continue
      filasLinCot.push({ ...l, quantity: num(d.items[l.line_no - 1].qty) ?? 0 })
    }
  }
  await insertarEnLotes('sales_quote_lines', filasLinCot.filter((l) => l.quantity !== 0))
  console.log(`  líneas insertadas ${filasLinCot.filter((l) => l.quantity !== 0).length}` +
    `  (descartadas por cantidad 0: ${filasLinCot.filter((l) => l.quantity === 0).length})`)
  resumen.cotizaciones = clasesCot

  // ── 2b · Pedidos ──────────────────────────────────────────────────────────
  console.log('\n── 3 · PEDIDOS ──')
  const yaPed = new Set((await traerTodo('sales_orders', 'original_number',
    (q) => q.eq('company_id', BT), ['original_number'])).map((r) => r.original_number))
  const clasesPed = { MIGRABLE_AUTOMATIC: 0, MIGRABLE_WITH_REVIEW: 0, UNRESOLVED: 0 }
  const filasPed = []
  for (const d of peds) {
    const { base, clase } = cabecera(d, 'order')
    clasesPed[clase]++
    if (yaPed.has(d.ref)) continue
    // El vínculo con la cotización sólo cuando el legacy lo dice. No se deduce.
    const quoteId = d.fromCotizacion ? (cotPorRef.get(d.fromCotizacion) ?? null) : null
    filasPed.push({ ...base,
      order_date: d.fecha ?? null,
      quote_id: quoteId,
      origin: 'migration',
      commercial_status: d.estado === 'cancelado' ? 'cancelled' : 'confirmed',
      fulfillment_status: d.estado === 'entregado' || d.estado === 'cerrada' ? 'delivered' : 'pending',
    })
  }
  await insertarEnLotes('sales_orders', filasPed)
  console.log(`  insertados ${filasPed.length} (ya estaban ${yaPed.size})`)

  const pedPorRef = new Map((await traerTodo('sales_orders', 'id, original_number',
    (q) => q.eq('company_id', BT), ['original_number'])).map((r) => [r.original_number, r.id]))

  const yaLinPed = new Set((await traerTodo('sales_order_lines', 'order_id, line_no',
    (q) => q.eq('company_id', BT), ['order_id', 'line_no'])).map((r) => `${r.order_id}|${r.line_no}`))
  const filasLinPed = []
  for (const d of peds) {
    const oid = pedPorRef.get(d.ref)
    if (!oid) continue
    for (const l of lineas(d, 'order_id', oid)) {
      if (yaLinPed.has(`${oid}|${l.line_no}`)) continue
      const q = num(d.items[l.line_no - 1].qty) ?? 0
      if (q <= 0) continue
      filasLinPed.push({ ...l, quantity_ordered: q })
    }
  }
  await insertarEnLotes('sales_order_lines', filasLinPed)
  console.log(`  líneas insertadas ${filasLinPed.length}`)
  resumen.pedidos = clasesPed

  // ── 2c · Entregas ─────────────────────────────────────────────────────────
  console.log('\n── 4 · ENTREGAS ──')
  const yaNE = new Set((await traerTodo('deliveries', 'original_number',
    (q) => q.eq('company_id', BT), ['original_number'])).map((r) => r.original_number))
  const clasesNE = { MIGRABLE_AUTOMATIC: 0, MIGRABLE_WITH_REVIEW: 0, UNRESOLVED: 0 }
  const filasNE = []
  for (const d of nes) {
    const { base, clase } = cabecera(d, 'delivery')
    clasesNE[clase]++
    if (yaNE.has(d.ref)) continue
    filasNE.push({ ...base,
      delivery_date: d.fecha ?? null,
      order_id: d.fromPedido ? (pedPorRef.get(d.fromPedido) ?? null) : null,
      status: d.estado === 'cancelada' ? 'cancelled' : 'delivered',
    })
  }
  await insertarEnLotes('deliveries', filasNE)
  console.log(`  insertadas ${filasNE.length} (ya estaban ${yaNE.size})`)

  const nePorRef = new Map((await traerTodo('deliveries', 'id, original_number',
    (q) => q.eq('company_id', BT), ['original_number'])).map((r) => [r.original_number, r.id]))

  // Depósito por defecto: la línea de entrega lo exige. No mueve stock.
  const { data: wh } = await sb.from('warehouses')
    .select('id').eq('company_id', BT).eq('is_default', true).single()

  const yaLinNE = new Set((await traerTodo('delivery_lines', 'delivery_id, id',
    (q) => q.eq('company_id', BT), ['delivery_id', 'id'])).map((r) => r.delivery_id))
  const filasLinNE = []
  for (const d of nes) {
    const did = nePorRef.get(d.ref)
    if (!did || yaLinNE.has(did)) continue
    ;(d.items ?? []).forEach((it, i) => {
      const q = num(it.qty) ?? 0
      if (q <= 0) return
      const sku = (it.sku ?? '').trim()
      filasLinNE.push({
        company_id: BT, delivery_id: did,
        // La entrega histórica NO se enlaza a una línea de pedido: el legacy
        // no guarda esa relación. Deducirla por posición sería inventarla.
        order_line_id: null,
        product_id: idPorSku.get(sku) ?? null,
        sku_snapshot: sku || null, name_snapshot: it.nombre ?? null,
        quantity: q, warehouse_id: wh.id,
        notes: 'Importación histórica: sin vínculo a línea de pedido en el legacy',
      })
    })
  }
  await insertarEnLotes('delivery_lines', filasLinNE)
  console.log(`  líneas insertadas ${filasLinNE.length}`)
  resumen.entregas = clasesNE

  // ══ 3 · EQUIVALENCIAS ═════════════════════════════════════════════════════
  console.log('\n── 5 · EQUIVALENCIAS PRODUCTO ↔ CLIENTE ──')
  const yaAlias = new Set((await traerTodo('customer_product_aliases', 'customer_id, normalized_key',
    (q) => q.eq('company_id', BT), ['customer_id', 'normalized_key']))
    .map((r) => `${r.customer_id}|${r.normalized_key}`))
  const filasAlias = []
  let aliasSinCliente = 0, aliasSinProducto = 0
  for (const [claveCliente, aliases] of Object.entries(memoria)) {
    // Las claves del legacy vienen inconsistentes: unas ya normalizadas
    // ("integra services") y otras no ("grupo mirgor s.a."). Se normalizan
    // acá o el 75 % no matchearía.
    const cid = clienteId.get(norm(claveCliente))
    if (!cid) { aliasSinCliente += Object.keys(aliases).length; continue }
    for (const [texto, sku] of Object.entries(aliases)) {
      const pid = idPorSku.get((sku ?? '').trim())
      if (!pid) { aliasSinProducto++; continue }
      const k = norm(texto)
      if (yaAlias.has(`${cid}|${k}`)) continue
      filasAlias.push({
        company_id: BT, customer_id: cid,
        customer_description: texto, normalized_key: k,
        product_id: pid, status: 'confirmed', source: 'legacy', confidence: 1,
      })
    }
  }
  await insertarEnLotes('customer_product_aliases', filasAlias)
  console.log(`  migrados ${filasAlias.length}` +
    `  (sin cliente resoluble ${aliasSinCliente} · sin producto ${aliasSinProducto})`)

  // ══ 4 · CANDIDATOS DE OC ══════════════════════════════════════════════════
  console.log('\n── 6 · CANDIDATOS DE OC ──')
  const re = /\bOC\s*[:#\-]?\s*([A-Za-z0-9][A-Za-z0-9._\/-]{3,})/i
  const cand = new Map()
  const fuentes = [['quote', cots], ['order', peds], ['delivery', nes]]
  for (const [tipo, arr] of fuentes) {
    for (const d of arr) {
      const campos = [['titulo', d.titulo], ...(d.items ?? []).map((it) => ['item_description', it.desc])]
      for (const [campo, txt] of campos) {
        if (!txt) continue
        const m = txt.match(re)
        if (!m) continue
        const valor = m[1].trim()
        const k = `${valor}|${norm(d.cliente)}`
        const e = cand.get(k) ?? {
          company_id: BT, customer_id: clienteId.get(norm(d.cliente)) ?? null,
          source_type: tipo, source_ref: d.ref, source_field: campo,
          raw_text: txt.slice(0, 500), candidate: valor,
          confidence: /^\d{6,}$/.test(valor) ? 'high'
            : (/^[0-9][0-9A-Za-z._\/-]{5,}$/.test(valor) && /\d/.test(valor)) ? 'medium' : 'low',
          doc_count: 0, status: 'pending',
        }
        e.doc_count++
        cand.set(k, e)
      }
    }
  }
  const yaCand = new Set((await traerTodo('customer_po_candidates', 'candidate, customer_id',
    (q) => q.eq('company_id', BT), ['candidate']))
    .map((r) => `${r.candidate}|${r.customer_id}`))
  const filasCand = [...cand.values()]
    .filter((c) => !yaCand.has(`${c.candidate}|${c.customer_id}`))
  await insertarEnLotes('customer_po_candidates', filasCand)
  const porConf = filasCand.reduce((a, c) => ({ ...a, [c.confidence]: (a[c.confidence] ?? 0) + 1 }), {})
  console.log(`  candidatos ${filasCand.length}   ` +
    `alta ${porConf.high ?? 0} · media ${porConf.medium ?? 0} · baja ${porConf.low ?? 0}`)
  console.log('  NINGUNO se convierte en OC automáticamente')

  // ══ 5 · CONTACTOS ═════════════════════════════════════════════════════════
  console.log('\n── 7 · CONTACTOS ──')
  const yaCont = new Set((await traerTodo('customer_contacts', 'customer_id, full_name',
    (q) => q.eq('company_id', BT), ['customer_id', 'full_name']))
    .map((r) => `${r.customer_id}|${norm(r.full_name)}`))
  const filasCont = []
  let contSinCliente = 0
  for (const c of contactos) {
    const cid = clienteId.get(norm(c.cliente))
    if (!cid) { contSinCliente++; continue }
    const nombre = (c.nombre ?? '').trim()
    if (!nombre || yaCont.has(`${cid}|${norm(nombre)}`)) continue
    filasCont.push({
      company_id: BT, customer_id: cid, full_name: nombre,
      role: c.cargo ?? null, email: c.email ?? null,
      phone: c.telefono ?? null, fax: c.fax ?? null, notes: c.observaciones ?? null,
    })
  }
  await insertarEnLotes('customer_contacts', filasCont)
  console.log(`  migrados ${filasCont.length}  (sin cliente en el histórico: ${contSinCliente})`)
  if (contSinCliente > 0) {
    // No se crean clientes desde los contactos: el alcance aprobado son los
    // que aparecen en documentos de venta. Estos quedan reportados para que
    // se decida, no descartados en silencio.
    const huerfanos = [...new Set(contactos
      .filter((c) => !clienteId.get(norm(c.cliente)))
      .map((c) => (c.cliente ?? '').trim()))]
    console.log(`  clientes nombrados sólo en contactos (${huerfanos.length}): ` +
      huerfanos.slice(0, 8).join(' · ') + (huerfanos.length > 8 ? ' …' : ''))
  }

  // ── Resumen ───────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(74))
  console.log('  CLASIFICACIÓN')
  const tot = { MIGRABLE_AUTOMATIC: 0, MIGRABLE_WITH_REVIEW: 0, UNRESOLVED: 0 }
  for (const [k, v] of Object.entries(resumen)) {
    console.log(`    ${k.padEnd(14)}auto ${String(v.MIGRABLE_AUTOMATIC).padStart(4)}` +
      `   revisión ${String(v.MIGRABLE_WITH_REVIEW).padStart(4)}` +
      `   sin resolver ${String(v.UNRESOLVED).padStart(4)}`)
    for (const c of Object.keys(tot)) tot[c] += v[c]
  }
  console.log(`    ${'TOTAL'.padEnd(14)}auto ${String(tot.MIGRABLE_AUTOMATIC).padStart(4)}` +
    `   revisión ${String(tot.MIGRABLE_WITH_REVIEW).padStart(4)}` +
    `   sin resolver ${String(tot.UNRESOLVED).padStart(4)}`)
  console.log('═'.repeat(74))
  console.log(`  Stock: NO se generó ningún movimiento ni reserva.`)
  console.log(`  Facturas y pagos: NO se migró nada (dataset no disponible).`)
  console.log(`  sales_audit: NO se escribió ninguna fila por la migración.`)
}

main().catch((e) => { console.error('✗ ' + e.message); process.exit(1) })
