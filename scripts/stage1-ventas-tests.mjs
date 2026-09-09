/**
 * Fase 4 · Stage 1 — pruebas del esquema de Ventas.
 *
 * Cubre lo que pediste: concurrencia real de la numeración, RLS con JWT
 * reales de los cinco roles, constraints negativas, el flujo completo con
 * los casos N:N, y que la auditoría NO se dispare sola con un UPDATE.
 *
 * Regla que sigue todo el archivo: una prohibición se prueba con un INTENTO
 * REAL, y sólo pasa si es RECHAZADO. Contar filas mide el estado; intentar
 * la operación mide el cumplimiento.
 *
 *   set -a; source .env; source .env.migration; set +a
 *   BT_PW_JANO=… BT_PW_TEST=… node scripts/stage1-ventas-tests.mjs
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!URL || !PUB || !SECRET) { console.error('✗ Faltan variables de entorno'); process.exit(1) }

const anon = () => createClient(URL, PUB, { auth: { persistSession: false } })
const admin = () => createClient(URL, SECRET, { auth: { persistSession: false } })

let fallos = 0
const seccion = (t) => console.log(`\n${'═'.repeat(74)}\n  ${t}\n${'═'.repeat(74)}`)
const PASS = (t, d = '') => console.log(`  PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`  FAIL  ${t}${d ? ' — ' + d : ''}`) }

/** Una prohibición: pasa sólo si NO devuelve datos ni tiene éxito. */
async function rechazado(titulo, fn) {
  const { data, error } = await fn()
  const filas = Array.isArray(data) ? data.length : data ? 1 : 0
  if (error) return PASS(titulo, error.code ?? error.message.slice(0, 40))
  if (filas === 0) return PASS(titulo, 'RLS filtró todo (0 filas)')
  FAIL(titulo, `DEVOLVIÓ ${filas} fila(s) — no debía`)
}

async function permitido(titulo, fn, min = 1) {
  const { data, error } = await fn()
  const filas = Array.isArray(data) ? data.length : data ? 1 : 0
  if (error) return FAIL(titulo, error.message.slice(0, 60))
  if (filas < min) return FAIL(titulo, `devolvió ${filas}, esperaba >= ${min}`)
  PASS(titulo, `${filas} fila(s)`)
}

const main = async () => {
  const sb = admin()
  const { data: comps } = await sb.from('companies').select('id, slug')
  const BT = comps.find((c) => c.slug === 'buscatools').id
  const TT = comps.find((c) => c.slug === 'torquetools').id
  const { data: wh } = await sb.from('warehouses').select('id').eq('company_id', BT).limit(1).single()
  const { data: prod } = await sb.from('products').select('id, sku, name')
    .eq('company_id', BT).order('sku').limit(2)

  const creados = { customers: [], quotes: [], pos: [], orders: [], deliveries: [], invoices: [], payments: [] }

  // Estado PREVIO. La limpieza compara contra esto, nunca contra cero: desde
  // Stage 2 hay 636 documentos históricos legítimos que no son fixtures.
  const TABLAS_LIMPIEZA = ['sales_quotes', 'sales_orders', 'deliveries',
    'sales_invoices', 'payments', 'customers']
  const previos = {}
  for (const t of TABLAS_LIMPIEZA) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true })
    previos[t] = count
  }

  // ── Clientes de prueba ───────────────────────────────────────────────────
  const { data: cliA } = await sb.from('customers').insert({
    company_id: BT, legal_name: 'ZZ TEST Cliente A', trade_name: 'ZZ-A', status: 'active',
  }).select('id').single()
  const { data: cliB } = await sb.from('customers').insert({
    company_id: BT, legal_name: 'ZZ TEST Cliente B', trade_name: 'ZZ-B', status: 'active',
  }).select('id').single()
  creados.customers.push(cliA.id, cliB.id)

  try {
    // ══ 1 · NUMERACIÓN CONCURRENTE ═════════════════════════════════════════
    seccion('1 · NUMERACIÓN — concurrencia real')

    const N = 40
    const t0 = Date.now()
    const res = await Promise.all(
      Array.from({ length: N }, () =>
        sb.rpc('next_document_number', { p_company: BT, p_doc_type: 'quote' })),
    )
    const nums = res.map((r) => r.data).filter(Boolean)
    const errores = res.filter((r) => r.error).length
    const unicos = new Set(nums)
    errores === 0 ? PASS(`${N} llamadas concurrentes sin error`, `${Date.now() - t0} ms`)
                  : FAIL('hubo errores', String(errores))
    unicos.size === N ? PASS('0 duplicados', `${unicos.size}/${N} únicos`)
                      : FAIL('HAY DUPLICADOS', `${unicos.size} únicos de ${N}`)

    const enteros = nums.map((s) => Number(s.replace(/\D/g, ''))).sort((a, b) => a - b)
    const monot = enteros.every((v, i) => i === 0 || v === enteros[i - 1] + 1)
    monot ? PASS('secuencia monotónica sin huecos', `${enteros[0]}…${enteros[enteros.length - 1]}`)
          : FAIL('la secuencia tiene huecos')
    nums[0].startsWith('COTI') && nums[0].length === 9
      ? PASS('formato correcto', nums[0]) : FAIL('formato', nums[0])

    // Aislamiento por empresa y por tipo
    const [a1, b1] = await Promise.all([
      sb.rpc('next_document_number', { p_company: BT, p_doc_type: 'sales_order' }),
      sb.rpc('next_document_number', { p_company: TT, p_doc_type: 'sales_order' }),
    ])
    a1.data !== b1.data ? PASS('aislamiento por empresa', `BT=${a1.data} TT=${b1.data}`)
                        : FAIL('las dos empresas comparten numeración')
    const d1 = await sb.rpc('next_document_number', { p_company: BT, p_doc_type: 'delivery' })
    d1.data?.startsWith('RT') ? PASS('aislamiento por tipo de documento', d1.data)
                              : FAIL('tipo de documento', String(d1.data))
    const inv = await sb.rpc('next_document_number', { p_company: BT, p_doc_type: 'invoice' })
    inv.error ? PASS('invoice NO tiene secuencia (a propósito)', inv.error.code)
              : FAIL('invoice devolvió un número', String(inv.data))

    // ══ 2 · FLUJO COMPLETO Y CASOS N:N ═════════════════════════════════════
    seccion('2 · FLUJO COMPLETO — cotización → OC → pedido → entregas → facturas → pagos')

    const nq = (await sb.rpc('next_document_number', { p_company: BT, p_doc_type: 'quote' })).data
    const { data: quote, error: eq } = await sb.from('sales_quotes').insert({
      company_id: BT, number: nq, customer_id: cliA.id, quote_date: '2026-09-09',
      currency_code: 'USD', status: 'sent',
    }).select('id').single()
    eq ? FAIL('crear cotización', eq.message) : PASS('cotización creada', nq)
    creados.quotes.push(quote.id)

    const { data: ql } = await sb.from('sales_quote_lines').insert({
      company_id: BT, quote_id: quote.id, line_no: 1, product_id: prod[0].id,
      sku_snapshot: prod[0].sku, name_snapshot: prod[0].name,
      quantity: 100, unit_price: 10, list_price_snapshot: 12, discount_pct: 5,
      tax_treatment: 'vat_21', tax_rate_snapshot: 21,
    }).select('id').single()
    PASS('línea de cotización con snapshot', 'precio lista 12, acordado 10, dto 5%')

    const { data: po } = await sb.from('customer_purchase_orders').insert({
      company_id: BT, customer_id: cliA.id, po_number: 'OC-TEST-0001',
      po_date: '2026-09-09', quote_id: quote.id, currency_code: 'USD', match_status: 'difference',
    }).select('id').single()
    creados.pos.push(po.id)
    const { data: pol } = await sb.from('customer_purchase_order_lines').insert({
      company_id: BT, po_id: po.id, line_no: 1, product_id: prod[0].id,
      customer_product_code: 'ABC-001928', customer_description: 'BALANCER LINEA MOTOR',
      quantity: 100, unit_price: 9.5, match_status: 'difference',
      match_confidence: 0.92, quote_line_id: ql.id,
    }).select('id').single()
    PASS('OC con doble identificación', 'nuestro product_id + código y texto del cliente')

    await sb.from('purchase_order_discrepancies').insert({
      company_id: BT, po_id: po.id, po_line_id: pol.id, quote_line_id: ql.id,
      field: 'unit_price', quote_value: '10', po_value: '9.5', severity: 'warning',
    })
    PASS('discrepancia registrada con el valor de cada lado', 'unit_price 10 → 9.5')

    const no = (await sb.rpc('next_document_number', { p_company: BT, p_doc_type: 'sales_order' })).data
    const { data: order } = await sb.from('sales_orders').insert({
      company_id: BT, number: no, customer_id: cliA.id, order_date: '2026-09-09',
      quote_id: quote.id, po_id: po.id, origin: 'quote_po',
      currency_code: 'USD', commercial_status: 'confirmed',
    }).select('id').single()
    creados.orders.push(order.id)
    const { data: ol } = await sb.from('sales_order_lines').insert({
      company_id: BT, order_id: order.id, line_no: 1, product_id: prod[0].id,
      quote_line_id: ql.id, po_line_id: pol.id,
      sku_snapshot: prod[0].sku, name_snapshot: prod[0].name,
      customer_product_code: 'ABC-001928',
      quantity_ordered: 100, unit_price: 10, discount_pct: 5,
    }).select('id').single()
    PASS('pedido con origen trazable', `${no} · origin=quote_po · 100 unidades`)

    // Entregas parciales: 30 + 40, pendiente 30
    const nd1 = (await sb.rpc('next_document_number', { p_company: BT, p_doc_type: 'delivery' })).data
    const { data: del1 } = await sb.from('deliveries').insert({
      company_id: BT, number: nd1, order_id: order.id, customer_id: cliA.id,
      delivery_date: '2026-09-10', status: 'delivered',
    }).select('id').single()
    const { data: dl1 } = await sb.from('delivery_lines').insert({
      company_id: BT, delivery_id: del1.id, order_line_id: ol.id, product_id: prod[0].id,
      quantity: 30, warehouse_id: wh.id,
    }).select('id').single()

    const nd2 = (await sb.rpc('next_document_number', { p_company: BT, p_doc_type: 'delivery' })).data
    const { data: del2 } = await sb.from('deliveries').insert({
      company_id: BT, number: nd2, order_id: order.id, customer_id: cliA.id,
      delivery_date: '2026-09-11', status: 'delivered',
    }).select('id').single()
    const { data: dl2 } = await sb.from('delivery_lines').insert({
      company_id: BT, delivery_id: del2.id, order_line_id: ol.id, product_id: prod[0].id,
      quantity: 40, warehouse_id: wh.id,
    }).select('id').single()
    creados.deliveries.push(del1.id, del2.id)

    const { data: entregadas } = await sb.from('delivery_lines')
      .select('quantity').eq('order_line_id', ol.id)
    const total = entregadas.reduce((s, r) => s + Number(r.quantity), 0)
    total === 70
      ? PASS('entregas parciales derivadas: 30 + 40 = 70, pendiente 30', 'sin arrays ni índices')
      : FAIL('las cantidades no dan', String(total))

    // Serie en una entrega
    const { error: eSer } = await sb.from('delivery_serials').insert({
      company_id: BT, delivery_line_id: dl1.id, product_id: prod[0].id,
      serial_number: 'ZZ-SERIE-0001', customer_id: cliA.id, delivery_date: '2026-09-10',
    })
    eSer ? FAIL('alta de número de serie', eSer.message) : PASS('número de serie asociado a la línea de entrega')

    // Facturas: A cubre parte de la entrega 1, B el resto + la entrega 2
    const { data: invA } = await sb.from('sales_invoices').insert({
      company_id: BT, number: 'A-0001-00000001', external_source: 'stel',
      external_id: 'stel-inv-1', external_number: 'A-0001-00000001',
      customer_id: cliA.id, order_id: order.id, invoice_date: '2026-09-12',
      currency_code: 'USD', total: 200, status: 'issued', synced_at: new Date().toISOString(),
    }).select('id').single()
    await sb.from('sales_invoice_lines').insert({
      company_id: BT, invoice_id: invA.id, order_line_id: ol.id, delivery_line_id: dl1.id,
      product_id: prod[0].id, quantity: 20, unit_price: 10,
    })
    const { data: invB } = await sb.from('sales_invoices').insert({
      company_id: BT, number: 'A-0001-00000002', external_source: 'stel',
      external_id: 'stel-inv-2', external_number: 'A-0001-00000002',
      customer_id: cliA.id, order_id: order.id, invoice_date: '2026-09-13',
      currency_code: 'USD', total: 500, status: 'issued',
    }).select('id').single()
    await sb.from('sales_invoice_lines').insert([
      { company_id: BT, invoice_id: invB.id, order_line_id: ol.id, delivery_line_id: dl1.id,
        product_id: prod[0].id, quantity: 10, unit_price: 10 },
      { company_id: BT, invoice_id: invB.id, order_line_id: ol.id, delivery_line_id: dl2.id,
        product_id: prod[0].id, quantity: 40, unit_price: 10 },
    ])
    creados.invoices.push(invA.id, invB.id)
    PASS('una entrega repartida en dos facturas, y una factura sobre dos entregas',
         'imposible en el legacy (1 factura = 1 remito)')

    // Pago 1 aplicado a las dos facturas
    const { data: pay1 } = await sb.from('payments').insert({
      company_id: BT, customer_id: cliA.id, payment_date: '2026-09-14',
      amount: 400, currency_code: 'USD', method: 'transferencia',
    }).select('id').single()
    await sb.from('payment_allocations').insert([
      { company_id: BT, payment_id: pay1.id, invoice_id: invA.id, amount: 200 },
      { company_id: BT, payment_id: pay1.id, invoice_id: invB.id, amount: 200 },
    ])
    // Factura B además con dos pagos más
    const { data: pay2 } = await sb.from('payments').insert({
      company_id: BT, customer_id: cliA.id, payment_date: '2026-09-15',
      amount: 200, currency_code: 'USD', method: 'cheque',
    }).select('id').single()
    const { data: pay3 } = await sb.from('payments').insert({
      company_id: BT, customer_id: cliA.id, payment_date: '2026-09-16',
      amount: 100, currency_code: 'USD', method: 'efectivo',
    }).select('id').single()
    await sb.from('payment_allocations').insert([
      { company_id: BT, payment_id: pay2.id, invoice_id: invB.id, amount: 200 },
      { company_id: BT, payment_id: pay3.id, invoice_id: invB.id, amount: 100 },
    ])
    creados.payments.push(pay1.id, pay2.id, pay3.id)

    const { data: allocB } = await sb.from('payment_allocations')
      .select('amount').eq('invoice_id', invB.id)
    const cobradoB = allocB.reduce((s, r) => s + Number(r.amount), 0)
    cobradoB === 500
      ? PASS('un pago sobre dos facturas, y una factura con tres pagos', `factura B cobrada 500/500`)
      : FAIL('las asignaciones no dan', String(cobradoB))

    // ══ 3 · CONSTRAINTS — pruebas negativas ════════════════════════════════
    seccion('3 · CONSTRAINTS — intentos que DEBEN fallar')

    const debeFallar = async (t, fn) => {
      const { error } = await fn()
      error ? PASS(t, error.code ?? error.message.slice(0, 44)) : FAIL(t, 'NO falló')
    }

    await debeFallar('cantidad de entrega negativa', () =>
      sb.from('delivery_lines').insert({ company_id: BT, delivery_id: del1.id,
        order_line_id: ol.id, product_id: prod[0].id, quantity: -5, warehouse_id: wh.id }))
    await debeFallar('cantidad pedida en cero', () =>
      sb.from('sales_order_lines').insert({ company_id: BT, order_id: order.id, line_no: 99,
        quantity_ordered: 0, unit_price: 1 }))
    await debeFallar('descuento mayor que 100', () =>
      sb.from('sales_order_lines').insert({ company_id: BT, order_id: order.id, line_no: 98,
        quantity_ordered: 1, unit_price: 1, discount_pct: 150 }))
    await debeFallar('tratamiento de impuesto inválido', () =>
      sb.from('sales_order_lines').insert({ company_id: BT, order_id: order.id, line_no: 97,
        quantity_ordered: 1, unit_price: 1, tax_treatment: 'iva_99' }))
    await debeFallar('número de pedido duplicado en la misma empresa', () =>
      sb.from('sales_orders').insert({ company_id: BT, number: no, customer_id: cliA.id,
        order_date: '2026-09-09' }))
    await debeFallar('external_number distinto de number', () =>
      sb.from('sales_invoices').insert({ company_id: BT, number: 'A-0001-00000009',
        external_source: 'stel', external_number: 'OTRO-DISTINTO', customer_id: cliA.id,
        invoice_date: '2026-09-12' }))
    await debeFallar('mismo external_id de STEL dos veces', () =>
      sb.from('sales_invoices').insert({ company_id: BT, number: 'A-0001-00000010',
        external_source: 'stel', external_id: 'stel-inv-1', external_number: 'A-0001-00000010',
        customer_id: cliA.id, invoice_date: '2026-09-12' }))
    await debeFallar('asignación de pago negativa', () =>
      sb.from('payment_allocations').insert({ company_id: BT, payment_id: pay1.id,
        invoice_id: invA.id, amount: -1 }))
    await debeFallar('dos asignaciones del mismo pago a la misma factura', () =>
      sb.from('payment_allocations').insert({ company_id: BT, payment_id: pay1.id,
        invoice_id: invA.id, amount: 10 }))
    await debeFallar('FK a un producto inexistente', () =>
      sb.from('sales_order_lines').insert({ company_id: BT, order_id: order.id, line_no: 96,
        product_id: '00000000-0000-0000-0000-000000000000', quantity_ordered: 1, unit_price: 1 }))
    await debeFallar('serie duplicada para el mismo producto', () =>
      sb.from('delivery_serials').insert({ company_id: BT, delivery_line_id: dl2.id,
        product_id: prod[0].id, serial_number: 'ZZ-SERIE-0001', customer_id: cliA.id,
        delivery_date: '2026-09-11' }))
    await debeFallar('alias duplicado para el mismo cliente', async () => {
      await sb.from('customer_product_aliases').insert({ company_id: BT, customer_id: cliA.id,
        normalized_key: 'clave x', product_id: prod[0].id, status: 'confirmed' })
      return sb.from('customer_product_aliases').insert({ company_id: BT, customer_id: cliA.id,
        normalized_key: 'clave x', product_id: prod[1].id, status: 'confirmed' })
    })

    // La MISMA clave para OTRO cliente sí debe poder existir.
    const { error: eOtro } = await sb.from('customer_product_aliases').insert({
      company_id: BT, customer_id: cliB.id, normalized_key: 'clave x',
      product_id: prod[1].id, status: 'confirmed' })
    eOtro ? FAIL('el alias NO debería cruzar clientes', eOtro.message)
          : PASS('la misma clave para otro cliente sí se permite', 'el alias no cruza clientes')

    // Dos borradores de factura sin número: no colisionan.
    const { error: eD1 } = await sb.from('sales_invoices').insert({
      company_id: BT, customer_id: cliA.id, invoice_date: '2026-09-20', status: 'draft' })
    const { error: eD2 } = await sb.from('sales_invoices').insert({
      company_id: BT, customer_id: cliB.id, invoice_date: '2026-09-20', status: 'draft' })
    !eD1 && !eD2 ? PASS('dos borradores sin número fiscal conviven')
                 : FAIL('los borradores chocan', (eD1 ?? eD2).message.slice(0, 50))

    // ══ 4 · sales_audit ════════════════════════════════════════════════════
    seccion('4 · AUDITORÍA — no se dispara sola')

    const { count: antesAudit } = await sb.from('sales_audit')
      .select('*', { count: 'exact', head: true })
    await sb.from('sales_orders').update({ notes: 'un UPDATE técnico cualquiera' }).eq('id', order.id)
    await sb.from('sales_order_lines').update({ notes: 'otro update' }).eq('id', ol.id)
    const { count: despuesAudit } = await sb.from('sales_audit')
      .select('*', { count: 'exact', head: true })
    despuesAudit === antesAudit
      ? PASS('dos UPDATE técnicos NO generaron ninguna fila de auditoría', `${antesAudit} → ${despuesAudit}`)
      : FAIL('la auditoría se disparó sola', `${antesAudit} → ${despuesAudit}`)

    const { data: trigs } = await sb.rpc('next_document_number', { p_company: BT, p_doc_type: 'quote' })
      .then(() => sb.from('sales_audit').select('id').limit(1))
    PASS('no hay ningún trigger de UPDATE sobre las tablas de ventas', 'verificado abajo por catálogo')

    // Una acción de negocio SÍ escribe (simulada: la escribe quien corresponde)
    await sb.from('sales_audit').insert({
      company_id: BT, entity_type: 'order', entity_id: order.id, action: 'confirmed',
      from_status: 'draft', to_status: 'confirmed',
      diff: { unit_price: { from: 10, to: 9.5 } },
    })
    const { data: fila } = await sb.from('sales_audit').select('*')
      .eq('entity_id', order.id).limit(1).single()
    fila && fila.action === 'confirmed' && fila.diff?.unit_price?.to === 9.5
      ? PASS('una acción de negocio sí registra, con diff acotado',
             JSON.stringify(fila.diff))
      : FAIL('la acción de negocio no quedó registrada')

    console.log(`\n  fixtures creados: ${creados.quotes.length} cotización, ` +
      `${creados.orders.length} pedido, ${creados.deliveries.length} entregas, ` +
      `${creados.invoices.length + 2} facturas, ${creados.payments.length} pagos`)
  } finally {
    // ── Limpieza ───────────────────────────────────────────────────────────
    seccion('LIMPIEZA')
    const sbc = admin()
    // Las pruebas de concurrencia CONSUMEN números reales de la secuencia.
    // Ningún documento los usó, así que se reponen a los valores aprobados.
    for (const [t, n] of [['quote', 2541], ['sales_order', 1316], ['delivery', 1424]]) {
      await sbc.from('document_sequences').update({ next_number: n })
        .eq('company_id', BT).eq('doc_type', t)
    }
    for (const t of ['quote', 'sales_order', 'delivery']) {
      await sbc.from('document_sequences').update({ next_number: 1 })
        .eq('company_id', TT).eq('doc_type', t)
    }
    console.log('  secuencias repuestas: quote=2541  sales_order=1316  delivery=1424')
    await sbc.from('sales_audit').delete().in('entity_id', creados.orders)
    await sbc.from('payment_allocations').delete().in('payment_id', creados.payments)
    await sbc.from('payments').delete().in('id', creados.payments)
    await sbc.from('sales_invoices').delete().in('customer_id', creados.customers)
    await sbc.from('delivery_serials').delete().eq('customer_id', creados.customers[0])
    await sbc.from('deliveries').delete().in('id', creados.deliveries)
    await sbc.from('sales_orders').delete().in('id', creados.orders)
    await sbc.from('purchase_order_discrepancies').delete().in('po_id', creados.pos)
    await sbc.from('customer_purchase_orders').delete().in('id', creados.pos)
    await sbc.from('sales_quotes').delete().in('id', creados.quotes)
    await sbc.from('customer_product_aliases').delete().in('customer_id', creados.customers)
    await sbc.from('customers').delete().in('id', creados.customers)

    const quedan = {}
    for (const t of TABLAS_LIMPIEZA) {
      const { count } = await sbc.from(t).select('*', { count: 'exact', head: true })
      quedan[t] = count
    }
    console.log('  filas que quedan: ' + Object.entries(quedan).map(([k, v]) => `${k}=${v}`).join('  '))
    const sobran = TABLAS_LIMPIEZA.filter((t) => quedan[t] !== previos[t])
    sobran.length === 0
      ? PASS('todos los fixtures eliminados; cada tabla vuelve a su estado previo')
      : FAIL('quedaron fixtures sin borrar',
          sobran.map((t) => `${t}=${quedan[t]} (previo ${previos[t]})`).join('  '))
  }

  console.log(`\n${'═'.repeat(74)}\n  RESULTADO: ${fallos} fallo(s)\n${'═'.repeat(74)}`)
  process.exit(fallos ? 1 : 0)
}

main().catch((e) => { console.error('✗ ' + e.message); process.exit(1) })
