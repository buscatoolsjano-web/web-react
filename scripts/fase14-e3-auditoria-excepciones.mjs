/**
 * Fase 14 · Entrega 3 — auditoría de las excepciones de la reconciliación (SÓLO LECTURA).
 *
 *   COTI02530 · SP.2007VPM/80 · SP.2008VP/100 · cliente de COTI02452 · las 8 líneas
 *   no autorizadas · serie RT-ML · últimos documentos de STEL y delta desde E2.
 *
 * STEL: ~10 llamadas GET (cupo compartido con Make). React: sólo SELECT.
 * Salida completa en scripts/output/e3/ (ignorado: tiene razones sociales);
 * por consola sólo números, SKUs, estados y clasificaciones.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase14-e3-auditoria-excepciones.mjs
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { crearCliente, fechaStel, limpiar } from './lib/stel-api.mjs'

const BASE = process.env.VITE_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !SECRET) { console.error('✗ Faltan variables'); process.exit(1) }
const sb = createClient(BASE, SECRET, { auth: { persistSession: false } })
const SALIDA = path.resolve('scripts/output/e3')
const E2_STEL = path.resolve('scripts/output/e2/stel-aplicar-e62de165c350.json')
const E2_PLAN = path.resolve('scripts/output/e2/plan-e62de165c350.json')
const E2_RESPALDO = path.resolve('scripts/output/e2/respaldo-aplicar-e62de165c350.json')

const normTexto = (s) => (s ?? '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const normCuit = (s) => (s ?? '').toString().replace(/\D/g, '') || null
const dia = (s) => (s ?? '').toString().slice(0, 10) || null

async function main() {
  for (const f of [E2_STEL, E2_PLAN, E2_RESPALDO]) if (!fs.existsSync(f)) throw new Error(`falta ${path.relative(process.cwd(), f)} (salida de E2)`)
  const { stel: e2 } = JSON.parse(fs.readFileSync(E2_STEL, 'utf8'))
  const plan = JSON.parse(fs.readFileSync(E2_PLAN, 'utf8'))
  const respaldo = JSON.parse(fs.readFileSync(E2_RESPALDO, 'utf8')).filas
  const cacheDir = path.resolve(`.stel-cache/e3-${Date.now()}`)
  const c = crearCliente({ maxLlamadas: 20, usarCache: true, cacheDir, log: () => {} })
  const { data: emp } = await sb.from('companies').select('id').eq('slug', 'buscatools').single()
  const BT = emp.id
  const out = {}

  try {
    // ── COTI02530 ────────────────────────────────────────────────────────
    const [q30] = await c.get('salesEstimates', { 'full-reference': 'COTI02530', limit: 5 })
    const estados = new Map(e2.estados.map((e) => [e.id, e.name]))
    const hijosStel = ['order', 'delivery'].flatMap((t) => e2.docs[t].filter((d) => d['parent-document-id'] === q30?.id).map((d) => ({ tipo: t, ref: d['full-reference'], estado: estados.get(d['document-state-id']) ?? d['document-state-id'], modificado: d['utc-last-modification-date'] })))
    const hijosLinea = ['order', 'delivery'].flatMap((t) => e2.docs[t].filter((d) => (d.lines ?? []).some((l) => l['parent-document-id'] === q30?.id)).map((d) => `${t}:${d['full-reference']}`))
    const { data: r30 } = await sb.from('sales_quotes').select('id, number, status, currency_code, total, external_id, imported_at, updated_at').eq('company_id', BT).eq('number', 'COTI02530').single()
    const { data: ped30 } = await sb.from('sales_orders').select('number, commercial_status').eq('quote_id', r30.id)
    const { data: rem30 } = await sb.from('deliveries').select('number, status').eq('source_quote_id', r30.id)
    const { count: ev30 } = await sb.from('sales_audit').select('*', { count: 'exact', head: true }).eq('entity_id', r30.id)
    const e2Doc = e2.docs.quote.find((d) => d['full-reference'] === 'COTI02530')
    out.coti02530 = {
      stel: q30 ? { id: q30.id, estado: estados.get(q30['document-state-id']) ?? q30['document-state-id'], fecha: dia(q30.date), creado: q30['creation-date'], modificado: q30['utc-last-modification-date'], moneda: q30['currency-code'], total: q30['total-amount'], lineas: (q30.lines ?? []).filter((l) => !l.deleted && l['line-type'] === 'ITEM').length } : null,
      stelEnE2: e2Doc ? { estado: estados.get(e2Doc['document-state-id']), modificado: e2Doc['utc-last-modification-date'] } : null,
      stelDocumentosHijos: hijosStel, stelLineasHijas: hijosLinea,
      react: { estado: r30.status, moneda: r30.currency_code, total: Number(r30.total), idStel: r30.external_id, importado: Boolean(r30.imported_at), pedidos: ped30, remitosDirectos: rem30, eventos: ev30 },
      historialStel: 'La API no expone historial de estados: sólo el estado actual y utc-last-modification-date.',
    }
    const sinHijos = hijosStel.length === 0 && hijosLinea.length === 0 && (ped30 ?? []).length === 0 && (rem30 ?? []).length === 0
    out.coti02530.clasificacion = sinHijos && out.coti02530.stel?.estado === 'Pendiente' ? 'SAFE_TO_RECONCILE' : 'KEEP_EXCEPTION'
    out.coti02530.motivo = sinHijos
      ? 'Sin pedidos ni remitos derivados en STEL ni en React: volver a sent no rompe invariantes; requiere autorización porque la RPC rechaza estados regresivos por diseño.'
      : 'Tiene documentos derivados: bajar el estado dejaría un hijo colgando de una cotización no aceptada.'

    // ── Productos bloqueados ─────────────────────────────────────────────
    const skus = ['SP.2007VPM/80', 'SP.2008VP/100']
    const itemsFrescos = await c.get('products', { 'full-reference': `in:${skus.join(',')}`, limit: 10 })
    out.productosBloqueados = []
    for (const sku of skus) {
      const it = itemsFrescos.find((p) => p['full-reference'] === sku) ?? null
      const { data: rp } = await sb.from('products').select('id, sku, name, description, status, needs_review, external_id, category_id, brand_id, product_type, model_code, legacy_ref').eq('company_id', BT).eq('sku', sku).maybeSingle()
      const { data: cat } = rp ? await sb.from('product_categories').select('name').eq('id', rp.category_id).maybeSingle() : { data: null }
      const { data: marca } = rp?.brand_id ? await sb.from('brands').select('name').eq('id', rp.brand_id).maybeSingle() : { data: null }
      const { count: precios } = rp ? await sb.from('product_prices').select('*', { count: 'exact', head: true }).eq('product_id', rp.id) : { count: 0 }
      const usos = {}
      for (const [t, tabla, fk, tablaDoc] of [['quote', 'sales_quote_lines', 'quote_id', 'sales_quotes'], ['order', 'sales_order_lines', 'order_id', 'sales_orders'], ['delivery', 'delivery_lines', 'delivery_id', 'deliveries']]) {
        const { data: ls } = await sb.from(tabla).select(`${fk}, product_id, sku_snapshot, name_snapshot`).eq('company_id', BT).eq('sku_snapshot', sku)
        const ids = [...new Set((ls ?? []).map((l) => l[fk]))]
        const { data: docs } = ids.length ? await sb.from(tablaDoc).select('number').in('id', ids) : { data: [] }
        usos[t] = { lineas: (ls ?? []).length, conProductoReact: (ls ?? []).filter((l) => l.product_id === rp?.id).length, documentos: (docs ?? []).map((d) => d.number).sort(), nombresEnLineas: [...new Set((ls ?? []).map((l) => l.name_snapshot))] }
      }
      const stelLineas = ['quote', 'order', 'delivery'].flatMap((t) => e2.docs[t].flatMap((d) => (d.lines ?? []).filter((l) => l['item-reference'] === sku && !l.deleted).map((l) => ({ doc: d['full-reference'], nombre: l['item-name'], itemId: l['item-id'] }))))
      const mismoId = new Set(stelLineas.map((l) => l.itemId))
      const nombreReact = normTexto(rp?.name)
      const nombreStel = normTexto(it?.name)
      // Clasificación factual, sin parecido de nombres: ¿el ítem STEL y el producto React describen la misma medida/modelo?
      const medidaStel = (it?.name ?? '').match(/(\d+)\s*(?:MM)?\s*(?:SIN IMAN|ENCASTRE|$)/i)
      out.productosBloqueados.push({
        sku,
        stel: it ? { id: it.id, nombre: it.name, descripcion: (it.description ?? '').slice(0, 200), inactivo: it.inactive, precio: it['sales-price'], categoriaId: it['product-category-id'] ?? null, modificado: it['utc-last-modification-date'] } : null,
        react: rp ? { id: rp.id, nombre: rp.name, descripcion: (rp.description ?? '').slice(0, 200), estado: rp.status, revision: rp.needs_review, idStel: rp.external_id, categoria: cat?.name ?? null, marca: marca?.name ?? null, tipo: rp.product_type, modelo: rp.model_code, precios } : null,
        usosReact: usos,
        usosStel: { lineas: stelLineas.length, idsDeItemEnLineas: [...mismoId], documentos: [...new Set(stelLineas.map((l) => l.doc))].sort() },
        nombresIguales: nombreReact === nombreStel,
        pistaMedidaStel: medidaStel?.[0] ?? null,
      })
    }

    // ── Cliente de COTI02452 ─────────────────────────────────────────────
    const q52 = e2.docs.quote.find((d) => d['full-reference'] === 'COTI02452')
    const cuenta = q52?.['account-id']
    const [cliStel] = cuenta ? [await c.get(`clients/${cuenta}`)].map((x) => (Array.isArray(x) ? x[0] : x)) : [null]
    const cuit = normCuit(cliStel?.['tax-identification-number'] ?? cliStel?.['identification-number'])
    const { data: r52 } = await sb.from('sales_quotes').select('customer_id').eq('company_id', BT).eq('number', 'COTI02452').single()
    const { data: todos } = await sb.from('customers').select('id, legal_name, trade_name, legacy_name, tax_id, emails, legacy_ref').eq('company_id', BT)
    const porCuit = (todos ?? []).filter((x) => cuit && normCuit(x.tax_id) === cuit)
    const nombre = normTexto(cliStel?.['legal-name'])
    const porNombre = (todos ?? []).filter((x) => [x.legal_name, x.trade_name, x.legacy_name].map(normTexto).includes(nombre))
    const docsCuenta = ['quote', 'order', 'delivery'].flatMap((t) => e2.docs[t].filter((d) => d['account-id'] === cuenta).map((d) => ({ tipo: t, ref: d['full-reference'] })))
    const tablas = { quote: 'sales_quotes', order: 'sales_orders', delivery: 'deliveries' }
    const vinculosPrevios = []
    for (const d of docsCuenta) {
      const { data } = await sb.from(tablas[d.tipo]).select('customer_id').eq('company_id', BT).eq('number', d.ref).maybeSingle()
      if (data) vinculosPrevios.push({ ...d, customerId: data.customer_id })
    }
    const idsPrevios = [...new Set(vinculosPrevios.map((v) => v.customerId))]
    const emailStel = (cliStel?.email ?? '').toLowerCase()
    const porEmail = emailStel ? (todos ?? []).filter((x) => (x.emails ?? []).map((e) => e.toLowerCase()).includes(emailStel)) : []
    out.cliente02452 = {
      stel: { id: cuenta, referencia: cliStel?.['full-reference'] ?? null, tieneCuit: Boolean(cuit), tieneEmail: Boolean(emailStel), externalId: cliStel?.['external-id'] ?? null },
      react: {
        vinculadoHoy: r52.customer_id,
        candidatosPorCuit: porCuit.map((x) => x.id),
        candidatosPorNombreExacto: porNombre.map((x) => ({ id: x.id, tieneCuit: Boolean(x.tax_id), cuitCoincide: Boolean(cuit) && normCuit(x.tax_id) === cuit })),
        candidatosPorEmailExacto: porEmail.map((x) => x.id),
        documentosDeLaCuentaEnStel: docsCuenta.length,
        clientesReactDeEsosDocumentos: idsPrevios,
      },
    }
    out.cliente02452.clasificacion = porCuit.length === 1 ? 'RESOLVABLE_BY_CUIT'
      : idsPrevios.length === 1 && idsPrevios[0] === r52.customer_id && docsCuenta.length > 1 ? 'RESOLVED_BY_PREVIOUS_EQUIVALENCE'
      : 'HUMAN_REVIEW'
    out.cliente02452.detalle = { razonSocialStel: cliStel?.['legal-name'] ?? null, candidatos: porNombre.map((x) => ({ id: x.id, razonSocial: x.legal_name, referenciaLegacy: x.legacy_ref })) }

    // ── 8 líneas ─────────────────────────────────────────────────────────
    out.lineas = []
    for (const p of plan.pendientesBorrado) {
      const tabla = p.tipo === 'quote' ? 'sales_quote_lines' : 'delivery_lines'
      const fila = respaldo[tabla].find((r) => r.id === p.react_linea_id)
      const { data: ahora } = await sb.from(tabla).select('*').eq('id', p.react_linea_id).maybeSingle()
      const stelDoc = e2.docs[p.tipo].find((d) => d['full-reference'] === p.numero)
      const stelItems = (stelDoc?.lines ?? []).filter((l) => !l.deleted && l['line-type'] === 'ITEM')
      const refsPedido = p.tipo === 'quote' ? (await sb.from('sales_order_lines').select('id', { count: 'exact', head: true }).eq('quote_line_id', p.react_linea_id)).count : null
      const { count: movs } = p.tipo === 'delivery' ? await sb.from('stock_movements').select('*', { count: 'exact', head: true }).eq('source_type', 'delivery').eq('source_id', ahora?.delivery_id ?? fila?.delivery_id) : { count: 0 }
      const docId = p.tipo === 'quote' ? (ahora ?? fila)?.quote_id : (ahora ?? fila)?.delivery_id
      const { count: eventos } = await sb.from('sales_audit').select('*', { count: 'exact', head: true }).eq('entity_id', docId)
      const { count: bitacora } = await sb.from('stel_reconciliation_log').select('*', { count: 'exact', head: true }).eq('entity_id', p.react_linea_id)
      const skuEnStel = stelItems.filter((l) => l['item-reference'] === p.sku)
      const mismoSkuEnReact = p.tipo === 'quote' ? (await sb.from('sales_quote_lines').select('id, quantity, unit_price').eq('quote_id', docId).eq('sku_snapshot', p.sku)).data : (await sb.from('delivery_lines').select('id, quantity').eq('delivery_id', docId).eq('sku_snapshot', p.sku)).data
      let clasificacion
      let motivo
      if (p.numero === 'RT0000001405') {
        clasificacion = movs === 0 && eventos === 0 ? 'SAFE_TO_DELETE' : 'REQUIRES_MANUAL_REVIEW'
        motivo = 'STEL tiene RT0000001405 con 1 línea; estas 5 son de COTI02499 (misma suma, cotización borrada en STEL). Sin movimientos de stock ni eventos; nada la referencia.'
      } else if (p.numero === 'COTI02516') {
        clasificacion = refsPedido === 0 && (mismoSkuEnReact ?? []).length === 2 && skuEnStel.length === 1 ? 'SAFE_TO_DELETE' : 'REQUIRES_MANUAL_REVIEW'
        motivo = 'React tiene PRO00238 dos veces; STEL una (la otra la reemplazó por GE.TSN125A, ya insertada en E2). Ningún pedido referencia la línea.'
      } else {
        clasificacion = refsPedido === 0 && skuEnStel.length === 0 ? 'SAFE_TO_DELETE' : 'REQUIRES_MANUAL_REVIEW'
        motivo = 'STEL quitó la línea al editar la cotización (1 línea hoy). La cotización está aceptada y tiene PDV01296, pero ninguna línea de pedido referencia ésta.'
      }
      out.lineas.push({
        documento: p.numero, reactLineaId: p.react_linea_id, sku: p.sku, producto: (ahora ?? fila)?.product_id ?? null,
        cantidad: Number((ahora ?? fila)?.quantity), precio: (ahora ?? fila)?.unit_price === null ? null : Number((ahora ?? fila)?.unit_price),
        intactaDesdeE2: JSON.stringify(Object.keys(fila ?? {}).sort().map((k) => [k, fila[k]])) === JSON.stringify(Object.keys(ahora ?? {}).sort().map((k) => [k, ahora[k]])),
        stel: { lineasItemEnElDocumento: stelItems.length, skuPresente: skuEnStel.length, modificado: stelDoc?.['utc-last-modification-date'] ?? null },
        referenciasAguasAbajo: { lineasDePedido: refsPedido }, impactoStock: { movimientosDelRemito: p.tipo === 'delivery' ? movs : 'no aplica (cotización)' },
        historial: { eventosDelDocumento: eventos, entradasEnBitacoraStel: bitacora },
        clasificacion, motivo,
      })
    }

    // ── RT-ML ────────────────────────────────────────────────────────────
    const ml = await c.todos('salesDeliveryNotes', { 'serial-number-id': 605003, sort: 'creation-date:asc' }, { limite: 200, maxPaginas: 5 })
    const nums = ml.map((d) => d['full-reference']).sort()
    const cuentas = new Map()
    for (const d of ml) cuentas.set(d['account-id'], (cuentas.get(d['account-id']) ?? 0) + 1)
    const clientesMl = e2.clientes.filter((x) => cuentas.has(x.id))
    const { data: mlReact } = await sb.from('deliveries').select('number, series_code, order_id, source_quote_id').eq('company_id', BT).like('number', 'RT-ML%')
    const { data: seqMl } = await sb.from('document_sequences').select('series_code').eq('company_id', BT).eq('series_code', 'RT-ML')
    const ultimo = [...ml].sort((a, b) => Date.parse(b['creation-date']) - Date.parse(a['creation-date']))[0]
    out.rtMl = {
      stelCantidadHistorica: ml.length, primero: nums[0] ?? null, ultimo: nums.at(-1) ?? null,
      ultimoCreado: ultimo ? { ref: ultimo['full-reference'], creado: ultimo['creation-date'], fecha: dia(ultimo.date) } : null,
      primeraFecha: dia(ml[0]?.date), monedas: [...new Set(ml.map((d) => d['currency-code']))],
      cuentasDistintas: cuentas.size, clientesConNombreMercadolibre: clientesMl.filter((x) => /mercado\s*libre|mercadolibre/i.test(`${x['legal-name']} ${x.name ?? ''}`)).length,
      conPedidoPadre: ml.filter((d) => /salesOrders/.test(d['parent-document-path'] ?? '')).length,
      conCotizacionPadre: ml.filter((d) => /salesEstimates/.test(d['parent-document-path'] ?? '')).length,
      diasDesdeUltimoUso: ultimo ? Math.floor((Date.now() - Date.parse(ultimo['creation-date'])) / 864e5) : null,
      react: { importados: (mlReact ?? []).length, numeros: (mlReact ?? []).map((d) => d.number).sort(), secuencia: (seqMl ?? []).length > 0 },
      decision: 'IMPORT_ONLY',
    }

    // ── Última lectura de STEL y delta desde E2 ──────────────────────────
    const tiposApi = { quote: 'salesEstimates', order: 'salesOrders', delivery: 'salesDeliveryNotes' }
    out.stelUltimos = {}
    for (const [t, ruta] of Object.entries(tiposApi)) {
      const recientes = await c.get(ruta, { 'start-date': fechaStel(new Date(Date.now() - 4 * 864e5)), sort: 'creation-date:desc', limit: 50 })
      const idsE2 = new Set(e2.docs[t].map((d) => d.id))
      const modE2 = new Map(e2.docs[t].map((d) => [d.id, d['utc-last-modification-date']]))
      out.stelUltimos[t] = {
        ultimo: recientes[0] ? { ref: recientes[0]['full-reference'], creado: recientes[0]['creation-date'], id: recientes[0].id } : null,
        nuevosDesdeE2: recientes.filter((d) => !idsE2.has(d.id)).map((d) => ({ ref: d['full-reference'], creado: d['creation-date'], moneda: d['currency-code'], total: d['total-amount'] })),
        modificadosDesdeE2: recientes.filter((d) => idsE2.has(d.id) && modE2.get(d.id) !== d['utc-last-modification-date']).map((d) => ({ ref: d['full-reference'], modificado: d['utc-last-modification-date'] })),
      }
    }
    out.llamadasStel = c.llamadas()
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true })
  }

  fs.mkdirSync(SALIDA, { recursive: true })
  const archivo = path.join(SALIDA, 'excepciones.json')
  fs.writeFileSync(archivo, JSON.stringify({ generado: new Date().toISOString(), ...out }, null, 1))
  const publico = structuredClone(out)
  delete publico.cliente02452.detalle
  console.log(JSON.stringify(publico, null, 1))
  console.log(`  detalle: ${path.relative(process.cwd(), archivo)} (ignorado)`)
}

main().catch((e) => { console.error('✗', limpiar(e.message)); process.exit(1) })
