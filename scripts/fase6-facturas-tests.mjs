/**
 * Fase 6 · Compras — entrega 5: facturas de proveedor, contra la base real.
 *
 * Una factura de proveedor NO es una recepción. Puede ser parcial, puede
 * cubrir varias recepciones, pueden ser varias sobre un mismo pedido, y puede
 * traer conceptos que no salen de ninguna mercadería. Lo que se prueba acá es
 * que la BASE sostenga todo eso aunque la escritura venga de otro lado.
 *
 * Y sobre todo: **una factura no mueve stock**. El stock entró con la
 * recepción. Se mide antes y después, movimiento por movimiento y saldo por
 * saldo.
 *
 * Cada prohibición se prueba con un INTENTO REAL y se mira el EFECTO además
 * del código: con PostgREST una operación prohibida puede devolver «éxito»
 * con cero filas.
 *
 * Se limpia sola: prefijo `ZZ-C5`. Una factura registrada no se borra desde la
 * aplicación; la limpieza usa la clave de servicio, que es la única salida y
 * existe justamente para esto.
 *
 *   set -a; source .env; source .env.migration; source .env.rls.txt; set +a
 *   node scripts/fase6-facturas-tests.mjs
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

const MARCA = 'ZZ-C5'
const HOY = new Date().toISOString().slice(0, 10)
const creados = { pedidos: [], proveedores: [], recepciones: [], facturas: [], adjuntos: [] }

const main = async () => {
  const c = sesion()
  const { error: eL } = await c.auth.signInWithPassword({
    email: 'buscatools.jano@gmail.com',
    password: process.env.BT_PW_JANO,
  })
  if (eL) { console.error('✗ login: ' + eL.message); process.exit(1) }

  const s = admin()
  const { data: comps } = await s.from('companies').select('id, slug')
  const BT = comps.find((x) => x.slug === 'buscatools').id
  const TT = comps.find((x) => x.slug === 'torquetools').id

  const { data: seqAntes } = await s.from('document_sequences')
    .select('doc_type, next_number').eq('company_id', BT)
    .in('doc_type', ['purchase_order', 'supplier', 'goods_receipt', 'supplier_invoice'])

  const { count: movAntes } = await s.from('stock_movements')
    .select('*', { count: 'exact', head: true })
  const { data: balAntes } = await s.from('stock_balances')
    .select('product_id, warehouse_id, on_hand')
  const saldosPrevios = new Map(
    (balAntes ?? []).map((b) => [b.product_id + '|' + b.warehouse_id, Number(b.on_hand)]))
  const { count: auditAntes } = await s.from('purchases_audit')
    .select('*', { count: 'exact', head: true })
  const { count: adjAntes } = await s.from('attachments')
    .select('*', { count: 'exact', head: true })

  const { data: dep } = await s.from('warehouses')
    .select('id, name').eq('company_id', BT).eq('is_default', true).single()
  const { data: prods } = await s.from('products')
    .select('id, sku, name').eq('company_id', BT).order('sku').limit(6)

  console.log('='.repeat(74))
  console.log('  COMPRAS · entrega 5 — facturas de proveedor')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(74))

  // ── Andamios ───────────────────────────────────────────────────────────

  const nuevoProveedor = async (nombre) => {
    const { data: ref } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'supplier' })
    const { data } = await c.from('suppliers').insert({
      company_id: BT, legacy_ref: ref, legal_name: nombre,
    }).select('id').single()
    if (data) creados.proveedores.push(data.id)
    return data
  }

  /** Un pedido confirmado con las líneas que se le pidan. */
  const pedidoConfirmado = async (proveedorId, lineas, moneda = 'USD') => {
    const { data: numero } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'purchase_order' })
    const { data: po } = await c.from('purchase_orders').insert({
      company_id: BT, supplier_id: proveedorId, number: numero, series_code: 'PC',
      currency_code: moneda, order_date: HOY, notes: `${MARCA} pedido`,
    }).select('id, number, currency_code').single()
    creados.pedidos.push(po.id)

    const ids = []
    for (let i = 0; i < lineas.length; i += 1) {
      const l = lineas[i]
      const { data, error } = await c.from('purchase_order_lines').insert({
        company_id: BT, purchase_order_id: po.id, line_no: i + 1,
        line_type: 'product',
        product_id: l.productId ?? null,
        sku_snapshot: l.sku ?? null, name_snapshot: l.nombre ?? 'Línea libre',
        quantity: l.cantidad, unit_price: l.precio ?? 10, discount_pct: 0,
        tax_treatment: l.tratamiento ?? 'vat_21',
      }).select('id').single()
      if (error) { FAIL('no se pudo crear la línea del pedido', error.message); return null }
      ids.push(data.id)
    }
    await c.from('purchase_orders').update({ status: 'confirmed' }).eq('id', po.id)
    return { ...po, lineas: ids }
  }

  /** Una recepción ya confirmada: es lo único que se puede facturar. */
  const recepcionConfirmada = async (po, proveedorId, cantidades) => {
    const { data: numero } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'goods_receipt' })
    const { data: r, error } = await c.from('goods_receipts').insert({
      company_id: BT, supplier_id: proveedorId, purchase_order_id: po?.id ?? null,
      warehouse_id: dep.id, number: numero, series_code: 'NEP', receipt_date: HOY,
      notes: `${MARCA} recepción`,
    }).select('id, number').single()
    if (error) { FAIL('no se pudo crear la recepción', error.message); return null }
    creados.recepciones.push(r.id)

    const lineas = []
    for (const q of cantidades) {
      const { data, error: eLin } = await c.from('goods_receipt_lines').insert({
        company_id: BT, goods_receipt_id: r.id,
        purchase_order_line_id: q.lineaId ?? null, product_id: q.productId ?? null,
        sku_snapshot: q.sku ?? null, name_snapshot: q.nombre ?? null, quantity: q.cantidad,
      }).select('id').single()
      if (eLin) { FAIL('no se pudo crear la línea de recepción', eLin.message); return null }
      lineas.push(data.id)
    }
    const { error: eConf } = await c.rpc('confirmar_recepcion', { p_receipt: r.id })
    if (eConf) { FAIL('no se pudo confirmar la recepción', eConf.message); return null }
    return { ...r, lineas }
  }

  /** Una factura en borrador con sus líneas. Devuelve `{ data, error }`. */
  const nuevaFactura = async (cliente, proveedorId, lineas, extra = {}) => {
    const empresa = extra.company_id ?? BT
    const { data: numero, error: eN } = await cliente.rpc('next_document_number',
      { p_company: empresa, p_doc_type: 'supplier_invoice' })
    if (eN) return { error: eN }
    const { data, error } = await cliente.from('supplier_invoices').insert({
      company_id: BT, supplier_id: proveedorId, number: numero, series_code: 'FP',
      currency_code: 'USD', invoice_date: HOY, notes: `${MARCA} factura`, ...extra,
    }).select('id, number, status, subtotal, tax_amount, total').single()
    if (error) return { error }
    creados.facturas.push(data.id)

    for (let i = 0; i < lineas.length; i += 1) {
      const l = lineas[i]
      const { error: eLin } = await cliente.from('supplier_invoice_lines').insert({
        company_id: BT, supplier_invoice_id: data.id, line_no: i + 1,
        line_type: 'product',
        goods_receipt_line_id: l.recepcionLineaId ?? null,
        purchase_order_line_id: l.pedidoLineaId ?? null,
        product_id: l.productId ?? null,
        sku_snapshot: l.sku ?? null,
        description_snapshot: l.descripcion ?? 'Concepto',
        quantity: l.cantidad, unit_price: l.precio ?? 10,
        discount_pct: l.descuento ?? 0,
        tax_treatment: l.tratamiento ?? 'vat_21',
        tax_rate_snapshot: l.tasa ?? null,
      })
      if (eLin) return { data, error: eLin }
    }
    return { data }
  }

  const factura = async (id) => {
    const { data } = await s.from('supplier_invoices')
      .select('status, subtotal, tax_amount, total, supplier_number, notes').eq('id', id).single()
    return data
  }

  /** Lo pendiente de facturar de una línea de recepción, según el servidor. */
  const pendiente = async (recepcionLineaId, recepcionId, excluir = null) => {
    const { data, error } = await c.rpc('pendiente_de_facturar',
      { p_company: BT, p_receipts: [recepcionId], p_supplier: null, p_excluir_factura: excluir })
    if (error) { FAIL('no se pudo leer lo pendiente', error.message); return null }
    return (data ?? []).find((x) => x.goods_receipt_line_id === recepcionLineaId) ?? null
  }

  const registrar = (cliente, id) => cliente.rpc('registrar_factura_proveedor', { p_invoice: id })

  try {
    const prov = await nuevoProveedor(`${MARCA} Proveedor`)
    const otro = await nuevoProveedor(`${MARCA} Otro proveedor`)

    // ── 1 · De la recepción a la factura, en parciales ──────────────────────
    seccion('1 · FACTURA DESDE RECEPCIÓN · PARCIAL · SEGUNDA PARCIAL · COMPLETA')

    const po1 = await pedidoConfirmado(prov.id, [
      { productId: prods[0].id, sku: prods[0].sku, nombre: prods[0].name, cantidad: 100, precio: 50 },
    ])
    const r1 = await recepcionConfirmada(po1, prov.id, [
      { lineaId: po1.lineas[0], productId: prods[0].id, sku: prods[0].sku, nombre: prods[0].name, cantidad: 100 },
    ])

    const p0 = await pendiente(r1.lineas[0], r1.id)
    cmp('recibidas 100', 100, Number(p0.recibido))
    cmp('  pendientes de facturar 100', 100, Number(p0.pendiente))
    cmp('  facturado arranca en cero', 0, Number(p0.facturado))
    cmp('  el precio del pedido viaja como sugerencia', 50, Number(p0.precio_pedido))

    const fA = await nuevaFactura(c, prov.id, [
      { recepcionLineaId: r1.lineas[0], cantidad: 30, precio: 50 },
    ], { supplier_number: `${MARCA}-A-0001` })
    if (fA.error) FAIL('no se pudo crear la primera factura', fA.error.message)

    const pBorrador = await pendiente(r1.lineas[0], r1.id)
    cmp('un BORRADOR no reserva: siguen pendientes 100', 100, Number(pBorrador.pendiente))
    cmp('  pero se informa aparte que hay 30 en borrador', 30, Number(pBorrador.en_borrador))

    const { data: regA, error: eRegA } = await registrar(c, fA.data.id)
    eRegA ? FAIL('no se pudo registrar la primera factura', eRegA.message)
          : cmp('se registra la primera parcial de 30', 1, regA.lineas)
    cmp('  y queda registered', 'registered', (await factura(fA.data.id)).status)

    const p1 = await pendiente(r1.lineas[0], r1.id)
    cmp('facturadas 30, pendientes 70', 70, Number(p1.pendiente))

    const fB = await nuevaFactura(c, prov.id, [
      { recepcionLineaId: r1.lineas[0], cantidad: 40, precio: 50 },
    ], { supplier_number: `${MARCA}-A-0002` })
    await registrar(c, fB.data.id)
    const p2 = await pendiente(r1.lineas[0], r1.id)
    cmp('segunda parcial de 40: pendientes 30', 30, Number(p2.pendiente))

    const fC = await nuevaFactura(c, prov.id, [
      { recepcionLineaId: r1.lineas[0], cantidad: 30, precio: 50 },
    ], { supplier_number: `${MARCA}-A-0003` })
    await registrar(c, fC.data.id)
    const p3 = await pendiente(r1.lineas[0], r1.id)
    cmp('se completa la facturación: pendientes 0', 0, Number(p3.pendiente))
    cmp('  y facturadas 100', 100, Number(p3.facturado))

    // ── 2 · Sobre-facturación ──────────────────────────────────────────────
    seccion('2 · SOBRE-FACTURACIÓN: SE RECHAZA, NO SE RECORTA')

    const po2 = await pedidoConfirmado(prov.id, [
      { productId: prods[1].id, sku: prods[1].sku, nombre: prods[1].name, cantidad: 30, precio: 10 },
    ])
    const r2 = await recepcionConfirmada(po2, prov.id, [
      { lineaId: po2.lineas[0], productId: prods[1].id, sku: prods[1].sku, nombre: prods[1].name, cantidad: 30 },
    ])

    const fSobre = await nuevaFactura(c, prov.id, [
      { recepcionLineaId: r2.lineas[0], cantidad: 31, precio: 10 },
    ])
    const { error: eSobre } = await registrar(c, fSobre.data.id)
    eSobre ? PASS('facturar 31 sobre 30 recibidas: rechazado', eSobre.code ?? '')
           : FAIL('SE FACTURARON 31 SOBRE 30 RECIBIDAS')
    cmp('  la factura sigue en borrador: no se recortó', 'draft',
      (await factura(fSobre.data.id)).status)
    const pSobre = await pendiente(r2.lineas[0], r2.id)
    cmp('  y no se facturó nada', 0, Number(pSobre.facturado))

    // Y el mismo rechazo acumulando: 20 registradas + 20 = 40 sobre 30.
    await c.from('supplier_invoice_lines').update({ quantity: 20 })
      .eq('supplier_invoice_id', fSobre.data.id)
    await registrar(c, fSobre.data.id)
    cmp('  bajada a 20, se registra', 'registered', (await factura(fSobre.data.id)).status)

    const fSobre2 = await nuevaFactura(c, prov.id, [
      { recepcionLineaId: r2.lineas[0], cantidad: 20, precio: 10 },
    ])
    const { error: eSobre2 } = await registrar(c, fSobre2.data.id)
    eSobre2 ? PASS('otras 20 sobre las 10 que quedan: rechazado', eSobre2.code ?? '')
            : FAIL('SE FACTURARON 40 SOBRE 30 RECIBIDAS')

    // ── 3 · Concurrencia ───────────────────────────────────────────────────
    seccion('3 · DOS FACTURAS PELEANDO POR LA MISMA CANTIDAD PENDIENTE')

    const po3 = await pedidoConfirmado(prov.id, [
      { productId: prods[2].id, sku: prods[2].sku, nombre: prods[2].name, cantidad: 30, precio: 10 },
    ])
    const r3 = await recepcionConfirmada(po3, prov.id, [
      { lineaId: po3.lineas[0], productId: prods[2].id, sku: prods[2].sku, nombre: prods[2].name, cantidad: 30 },
    ])

    const fX = await nuevaFactura(c, prov.id, [{ recepcionLineaId: r3.lineas[0], cantidad: 20 }])
    const fY = await nuevaFactura(c, prov.id, [{ recepcionLineaId: r3.lineas[0], cantidad: 20 }])

    const [rX, rY] = await Promise.all([registrar(c, fX.data.id), registrar(c, fY.data.id)])
    const ok = [rX, rY].filter((r) => !r.error).length
    cmp('de dos que intentan 20 sobre 30, entra UNA', 1, ok)
    const pConc = await pendiente(r3.lineas[0], r3.id)
    cmp('  se facturaron 20, no 40', 20, Number(pConc.facturado))
    const perdedora = rX.error ?? rY.error
    perdedora ? PASS('  la otra falla con un error de verdad', perdedora.code ?? perdedora.message)
              : FAIL('  las dos entraron')

    // ── 4 · Una factura sobre varias recepciones ───────────────────────────
    seccion('4 · UNA FACTURA SOBRE VARIAS RECEPCIONES')

    const po4 = await pedidoConfirmado(prov.id, [
      { productId: prods[3].id, sku: prods[3].sku, nombre: prods[3].name, cantidad: 50, precio: 20 },
    ])
    const r4a = await recepcionConfirmada(po4, prov.id, [
      { lineaId: po4.lineas[0], productId: prods[3].id, sku: prods[3].sku, nombre: prods[3].name, cantidad: 20 },
    ])
    const r4b = await recepcionConfirmada(po4, prov.id, [
      { lineaId: po4.lineas[0], productId: prods[3].id, sku: prods[3].sku, nombre: prods[3].name, cantidad: 30 },
    ])

    const fMulti = await nuevaFactura(c, prov.id, [
      { recepcionLineaId: r4a.lineas[0], cantidad: 20, precio: 20 },
      { recepcionLineaId: r4b.lineas[0], cantidad: 30, precio: 20 },
    ], { supplier_number: `${MARCA}-MULTI-1` })
    const { data: regM, error: eRegM } = await registrar(c, fMulti.data.id)
    eRegM ? FAIL('no se pudo registrar la factura multi-recepción', eRegM.message)
          : cmp('una factura cubre dos recepciones', 2, regM.lineas)

    const { data: relM } = await s.from('supplier_invoice_lines')
      .select('goods_receipt_line_id').eq('supplier_invoice_id', fMulti.data.id)
    const { data: recsM } = await s.from('goods_receipt_lines')
      .select('goods_receipt_id').in('id', relM.map((x) => x.goods_receipt_line_id))
    cmp('  y se le derivan dos recepciones distintas', 2,
      new Set(recsM.map((x) => x.goods_receipt_id)).size)

    const { data: cabMulti } = await s.from('supplier_invoices')
      .select('*').eq('id', fMulti.data.id).single()
    cmp('  sin ninguna FK de cabecera al pedido ni a la recepción', 0,
      Object.keys(cabMulti).filter((k) => /goods_receipt|purchase_order/.test(k)).length)

    // ── 5 · Varias facturas sobre un mismo pedido ──────────────────────────
    seccion('5 · VARIAS FACTURAS SOBRE UN MISMO PEDIDO')

    const { data: lineasPo1 } = await s.from('supplier_invoice_lines')
      .select('supplier_invoice_id, purchase_order_line_id')
      .eq('purchase_order_line_id', po1.lineas[0])
    cmp('el pedido del punto 1 terminó con tres facturas', 3,
      new Set(lineasPo1.map((x) => x.supplier_invoice_id)).size)
    cmp('  y la línea del pedido la derivó el servidor en todas', true,
      lineasPo1.every((x) => x.purchase_order_line_id === po1.lineas[0]))

    // ── 6 · Líneas libres ──────────────────────────────────────────────────
    seccion('6 · LÍNEAS LIBRES: FLETE, SEGURO, UN GASTO')

    const { count: movAntesLibre } = await s.from('stock_movements')
      .select('*', { count: 'exact', head: true })

    const fLibre = await nuevaFactura(c, prov.id, [
      { descripcion: 'Flete internacional', cantidad: 1, precio: 350, tratamiento: 'vat_21' },
      { descripcion: 'Seguro', cantidad: 1, precio: 120, tratamiento: 'exempt' },
    ], { supplier_number: `${MARCA}-GASTOS-1` })
    if (fLibre.error) FAIL('no se pudo crear la factura de gastos', fLibre.error.message)

    const { data: libres } = await s.from('supplier_invoice_lines')
      .select('goods_receipt_line_id, purchase_order_line_id, product_id, line_total')
      .eq('supplier_invoice_id', fLibre.data.id).order('line_no')
    cmp('una factura puede ser toda de conceptos sueltos', 2, (libres ?? []).length)
    cmp('  sin línea de recepción', true, libres.every((l) => l.goods_receipt_line_id === null))
    cmp('  sin línea de pedido', true, libres.every((l) => l.purchase_order_line_id === null))
    cmp('  y sin producto', true, libres.every((l) => l.product_id === null))

    await registrar(c, fLibre.data.id)
    cmp('  se registra igual', 'registered', (await factura(fLibre.data.id)).status)

    const { count: movDespuesLibre } = await s.from('stock_movements')
      .select('*', { count: 'exact', head: true })
    cmp('  y NO mueve un solo movimiento de stock', movAntesLibre, movDespuesLibre)

    const totLibre = await factura(fLibre.data.id)
    // 350 × 21 % = 73,50. El seguro exento no suma impuesto.
    cmp('  subtotal de la factura de gastos', 470, Number(totLibre.subtotal))
    cmp('  impuesto', 73.5, Number(totLibre.tax_amount))
    cmp('  total', 543.5, Number(totLibre.total))

    // ── 7 · El precio de la factura puede diferir del pedido ────────────────
    seccion('7 · PRECIO DISTINTO DEL PEDIDO: PERMITIDO, Y LA OC NO SE TOCA')

    const po7 = await pedidoConfirmado(prov.id, [
      { productId: prods[4].id, sku: prods[4].sku, nombre: prods[4].name, cantidad: 10, precio: 100 },
    ])
    const r7 = await recepcionConfirmada(po7, prov.id, [
      { lineaId: po7.lineas[0], productId: prods[4].id, sku: prods[4].sku, nombre: prods[4].name, cantidad: 10 },
    ])
    const { data: poAntes } = await s.from('purchase_order_lines')
      .select('unit_price, tax_treatment, quantity, updated_at').eq('id', po7.lineas[0]).single()
    const { data: poCab } = await s.from('purchase_orders')
      .select('subtotal, tax_amount, total').eq('id', po7.id).single()

    const f7 = await nuevaFactura(c, prov.id, [
      { recepcionLineaId: r7.lineas[0], cantidad: 10, precio: 115, tratamiento: 'vat_105' },
    ], { supplier_number: `${MARCA}-PRECIO-1` })
    const { error: e7 } = await registrar(c, f7.data.id)
    e7 ? FAIL('el proveedor no pudo facturar a otro precio', e7.message)
       : PASS('el proveedor factura 115 donde la OC decía 100')

    const { data: poDespues } = await s.from('purchase_order_lines')
      .select('unit_price, tax_treatment, quantity, updated_at').eq('id', po7.lineas[0]).single()
    cmp('  el precio de la OC sigue en 100', 100, Number(poDespues.unit_price))
    cmp('  su tratamiento tampoco cambió', poAntes.tax_treatment, poDespues.tax_treatment)
    cmp('  ni su cantidad', poAntes.quantity, poDespues.quantity)
    cmp('  ni la tocó nadie', poAntes.updated_at, poDespues.updated_at)
    const { data: poCabDespues } = await s.from('purchase_orders')
      .select('subtotal, tax_amount, total').eq('id', po7.id).single()
    cmp('  y los totales del pedido siguen iguales',
      `${poCab.subtotal}|${poCab.tax_amount}|${poCab.total}`,
      `${poCabDespues.subtotal}|${poCabDespues.tax_amount}|${poCabDespues.total}`)

    const { data: l7 } = await s.from('supplier_invoice_lines')
      .select('unit_price, tax_treatment, tax_rate_snapshot')
      .eq('supplier_invoice_id', f7.data.id).single()
    cmp('  la factura guarda SU snapshot: 115', 115, Number(l7.unit_price))
    cmp('  y su propia alícuota: 10,5', 10.5, Number(l7.tax_rate_snapshot))

    // ── 8 · Moneda ─────────────────────────────────────────────────────────
    seccion('8 · MONEDA: OBLIGATORIA, ÚNICA, Y SIN MEZCLAR')

    const { data: numSinMoneda } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'supplier_invoice' })
    const { error: eSinMoneda } = await c.from('supplier_invoices').insert({
      company_id: BT, supplier_id: prov.id, number: numSinMoneda, series_code: 'FP',
      invoice_date: HOY, notes: `${MARCA} sin moneda`,
    })
    eSinMoneda ? PASS('sin moneda no entra', eSinMoneda.code ?? '')
               : FAIL('ENTRÓ UNA FACTURA SIN MONEDA')

    const { data: numMonedaMala } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'supplier_invoice' })
    const { error: eMonedaMala } = await c.from('supplier_invoices').insert({
      company_id: BT, supplier_id: prov.id, number: numMonedaMala, series_code: 'FP',
      currency_code: 'XXX', invoice_date: HOY, notes: `${MARCA} moneda inventada`,
    })
    eMonedaMala ? PASS('una moneda inventada tampoco', eMonedaMala.code ?? '')
                : FAIL('ENTRÓ UNA FACTURA CON UNA MONEDA QUE NO EXISTE')

    const poEur = await pedidoConfirmado(prov.id, [
      { productId: prods[5].id, sku: prods[5].sku, nombre: prods[5].name, cantidad: 5, precio: 10 },
    ], 'EUR')
    const rEur = await recepcionConfirmada(poEur, prov.id, [
      { lineaId: poEur.lineas[0], productId: prods[5].id, sku: prods[5].sku, nombre: prods[5].name, cantidad: 5 },
    ])
    const fMezcla = await nuevaFactura(c, prov.id, [
      { recepcionLineaId: rEur.lineas[0], cantidad: 5, precio: 10 },
    ])
    fMezcla.error
      ? PASS('una recepción en EUR no entra en una factura en USD', fMezcla.error.code ?? '')
      : FAIL('SE MEZCLARON EUR Y USD EN UNA MISMA FACTURA')

    const fEur = await nuevaFactura(c, prov.id, [
      { recepcionLineaId: rEur.lineas[0], cantidad: 5, precio: 10 },
    ], { currency_code: 'EUR', supplier_number: `${MARCA}-EUR-1` })
    fEur.error ? FAIL('no se pudo facturar en EUR', fEur.error.message)
               : PASS('la misma recepción sí entra en una factura en EUR')

    // ── 9 · Proveedor cruzado ──────────────────────────────────────────────
    seccion('9 · PROVEEDOR CRUZADO')

    const fCruzada = await nuevaFactura(c, otro.id, [
      { recepcionLineaId: r7.lineas[0], cantidad: 1, precio: 10 },
    ])
    fCruzada.error
      ? PASS('la recepción de un proveedor no entra en la factura de otro', fCruzada.error.code ?? '')
      : FAIL('SE FACTURÓ LA MERCADERÍA DE UN PROVEEDOR A OTRO')

    // ── 10 · Número real del proveedor ─────────────────────────────────────
    seccion('10 · EL NÚMERO REAL DEL PROVEEDOR NO SE REPITE')

    const fDup = await nuevaFactura(c, prov.id, [{ descripcion: 'Gasto', cantidad: 1, precio: 1 }],
      { supplier_number: `${MARCA}-A-0001` })
    fDup.error ? PASS('el mismo número para el mismo proveedor: rechazado', fDup.error.code ?? '')
               : FAIL('SE CARGÓ DOS VECES LA MISMA FACTURA DEL MISMO PROVEEDOR')

    const fOtroProv = await nuevaFactura(c, otro.id, [{ descripcion: 'Gasto', cantidad: 1, precio: 1 }],
      { supplier_number: `${MARCA}-A-0001` })
    fOtroProv.error
      ? FAIL('el mismo número de OTRO proveedor debería poder cargarse', fOtroProv.error.message)
      : PASS('el mismo número de otro proveedor sí entra: no es único global')

    const fSinNum1 = await nuevaFactura(c, otro.id, [{ descripcion: 'Gasto', cantidad: 1, precio: 1 }])
    const fSinNum2 = await nuevaFactura(c, otro.id, [{ descripcion: 'Gasto', cantidad: 1, precio: 1 }])
    !fSinNum1.error && !fSinNum2.error
      ? PASS('dos facturas sin número del proveedor conviven: el único es parcial')
      : FAIL('el único parcial no deja cargar dos facturas sin número')

    // La referencia interna FP es otra cosa y también es única.
    const { data: refFP } = await s.from('supplier_invoices')
      .select('number').eq('id', fA.data.id).single()
    const { error: eRefDup } = await c.from('supplier_invoices').insert({
      company_id: BT, supplier_id: prov.id, number: refFP.number, series_code: 'FP',
      currency_code: 'USD', invoice_date: HOY, notes: `${MARCA} ref repetida`,
    })
    eRefDup ? PASS('la referencia interna FP tampoco se repite', eRefDup.code ?? '')
            : FAIL('SE REPITIÓ LA REFERENCIA INTERNA')

    // ── 11 · Numeración concurrente ────────────────────────────────────────
    seccion('11 · NUMERACIÓN CONCURRENTE DE LA REFERENCIA INTERNA')

    const numeros = await Promise.all(Array.from({ length: 15 }, () =>
      c.rpc('next_document_number', { p_company: BT, p_doc_type: 'supplier_invoice' })))
    const dados = numeros.map((n) => n.data).filter(Boolean)
    cmp('15 pedidos simultáneos devuelven 15 referencias', 15, dados.length)
    cmp('  y todas distintas', 15, new Set(dados).size)

    // ── 12 · Totales e IVA del lado del servidor ────────────────────────────
    seccion('12 · TOTALES E IVA: LOS CALCULA EL SERVIDOR')

    const fTot = await nuevaFactura(c, prov.id, [
      { descripcion: 'Con 21', cantidad: 2, precio: 100, tratamiento: 'vat_21' },
      { descripcion: 'Con 10,5', cantidad: 1, precio: 1000, tratamiento: 'vat_105' },
      { descripcion: 'Exento', cantidad: 1, precio: 500, tratamiento: 'exempt' },
      { descripcion: 'Con descuento', cantidad: 1, precio: 1000, descuento: 10, tratamiento: 'vat_21' },
    ], { supplier_number: `${MARCA}-TOT-1` })

    const t = await factura(fTot.data.id)
    // 200 + 1000 + 500 + 900 = 2600. IVA: 42 + 105 + 0 + 189 = 336.
    cmp('subtotal', 2600, Number(t.subtotal))
    cmp('impuesto por línea, cada una con su alícuota', 336, Number(t.tax_amount))
    cmp('total', 2936, Number(t.total))

    const { error: eTotal } = await c.from('supplier_invoices')
      .update({ subtotal: 1, tax_amount: 1, total: 1 }).eq('id', fTot.data.id)
    const tDespues = await factura(fTot.data.id)
    cmp('un total mandado por el cliente se ignora: sigue 2936', 2936, Number(tDespues.total))
    if (eTotal) PASS('  (además el update dio error)', eTotal.code ?? '')

    // El bug legacy del 1 %: mandar la alícuota a mano no sirve de nada.
    const fIva = await nuevaFactura(c, prov.id, [
      { descripcion: 'IVA forzado', cantidad: 1, precio: 1000, tratamiento: 'vat_21', tasa: 1 },
    ])
    const { data: lIva } = await s.from('supplier_invoice_lines')
      .select('tax_rate_snapshot').eq('supplier_invoice_id', fIva.data.id).single()
    cmp('vat_21 con tasa 1 mandada a mano queda en 21', 21, Number(lIva.tax_rate_snapshot))
    cmp('  y el impuesto es 210, no 10', 210, Number((await factura(fIva.data.id)).tax_amount))

    const fOther = await nuevaFactura(c, prov.id, [
      { descripcion: 'Percepción rara', cantidad: 1, precio: 1000, tratamiento: 'other', tasa: 3 },
    ])
    const { data: lOther } = await s.from('supplier_invoice_lines')
      .select('tax_rate_snapshot').eq('supplier_invoice_id', fOther.data.id).single()
    cmp('`other` sí respeta la alícuota que se le da', 3, Number(lOther.tax_rate_snapshot))

    // ── 13 · Estados ───────────────────────────────────────────────────────
    seccion('13 · ESTADOS: BORRADOR → REGISTRADA → ANULADA')

    const { data: idem } = await registrar(c, fA.data.id)
    cmp('registrar dos veces es idempotente', true, idem.ya_estaba)

    const notasOriginales = (await factura(fA.data.id)).notes
    const { error: eEditReg } = await c.from('supplier_invoices')
      .update({ notes: `${MARCA} editada` }).eq('id', fA.data.id)
    eEditReg ? PASS('una registrada no se edita', eEditReg.code ?? '')
             : FAIL('SE EDITÓ UNA FACTURA REGISTRADA')
    cmp('  y las notas quedaron como estaban', notasOriginales, (await factura(fA.data.id)).notes)

    const { error: eLinReg } = await c.from('supplier_invoice_lines')
      .insert({
        company_id: BT, supplier_invoice_id: fA.data.id, line_no: 99, line_type: 'product',
        description_snapshot: 'Colada', quantity: 1, unit_price: 1, tax_treatment: 'vat_21',
      })
    eLinReg ? PASS('  ni se le agregan líneas', eLinReg.code ?? '')
            : FAIL('SE LE AGREGÓ UNA LÍNEA A UNA FACTURA REGISTRADA')

    const { data: borradaReg } = await c.from('supplier_invoices')
      .delete().eq('id', fA.data.id).select('id')
    cmp('  ni se borra', 0, (borradaReg ?? []).length)

    const { data: refCambio } = await c.from('supplier_invoices')
      .update({ number: 'FP-9999' }).eq('id', fTot.data.id).select('id')
    cmp('la referencia interna no se cambia nunca', 0, (refCambio ?? []).length)

    // Anular libera lo facturado.
    const pAntesAnular = await pendiente(r1.lineas[0], r1.id)
    const { data: anulada } = await c.from('supplier_invoices')
      .update({ status: 'cancelled' }).eq('id', fA.data.id).select('id')
    cmp('una registrada sí se anula', 1, (anulada ?? []).length)
    const pDespuesAnular = await pendiente(r1.lineas[0], r1.id)
    cmp('anular LIBERA lo facturado: quedan 30 pendientes otra vez',
      Number(pAntesAnular.pendiente) + 30, Number(pDespuesAnular.pendiente))

    const { data: revive } = await c.from('supplier_invoices')
      .update({ status: 'draft' }).eq('id', fA.data.id).select('id')
    cmp('una anulada no vuelve a borrador', 0, (revive ?? []).length)
    const { error: eRegAnulada } = await registrar(c, fA.data.id)
    eRegAnulada ? PASS('ni se registra', eRegAnulada.code ?? '')
                : FAIL('SE REGISTRÓ UNA FACTURA ANULADA')

    // Un borrador sí se descarta.
    const fDescartar = await nuevaFactura(c, prov.id, [{ descripcion: 'X', cantidad: 1, precio: 1 }])
    const { data: descartada } = await c.from('supplier_invoices')
      .delete().eq('id', fDescartar.data.id).select('id')
    cmp('un borrador sí se descarta', 1, (descartada ?? []).length)

    // Una factura sin líneas no se registra.
    const { data: numVacia } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'supplier_invoice' })
    const { data: fVacia } = await c.from('supplier_invoices').insert({
      company_id: BT, supplier_id: prov.id, number: numVacia, series_code: 'FP',
      currency_code: 'USD', invoice_date: HOY, notes: `${MARCA} vacía`,
    }).select('id').single()
    creados.facturas.push(fVacia.id)
    const { error: eVacia } = await registrar(c, fVacia.id)
    eVacia ? PASS('una factura sin líneas no se registra', eVacia.code ?? '')
           : FAIL('SE REGISTRÓ UNA FACTURA VACÍA')

    // Sólo se factura lo que llegó.
    const { data: numNep } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'goods_receipt' })
    const { data: rDraft } = await c.from('goods_receipts').insert({
      company_id: BT, supplier_id: prov.id, purchase_order_id: null,
      warehouse_id: dep.id, number: numNep, series_code: 'NEP', receipt_date: HOY,
      notes: `${MARCA} recepción en borrador`,
    }).select('id').single()
    creados.recepciones.push(rDraft.id)
    const { data: lDraft } = await c.from('goods_receipt_lines').insert({
      company_id: BT, goods_receipt_id: rDraft.id, product_id: prods[0].id,
      sku_snapshot: prods[0].sku, name_snapshot: prods[0].name, quantity: 5,
    }).select('id').single()
    const fDraftRec = await nuevaFactura(c, prov.id, [
      { recepcionLineaId: lDraft.id, cantidad: 5, precio: 1 },
    ])
    fDraftRec.error
      ? PASS('una recepción en BORRADOR no se puede facturar', fDraftRec.error.code ?? '')
      : FAIL('SE FACTURÓ MERCADERÍA QUE TODAVÍA NO LLEGÓ')

    // ── 14 · Stock ─────────────────────────────────────────────────────────
    seccion('14 · UNA FACTURA NO MUEVE STOCK')

    const { count: movDeFacturas } = await s.from('stock_movements')
      .select('*', { count: 'exact', head: true }).in('source_id', creados.facturas)
    cmp('ni un movimiento de stock sale de una factura', 0, movDeFacturas)
    const { count: movTipo } = await s.from('stock_movements')
      .select('*', { count: 'exact', head: true }).eq('source_type', 'supplier_invoice')
    cmp('ni uno con `source_type` de factura', 0, movTipo)

    // ── 15 · RLS ───────────────────────────────────────────────────────────
    seccion('15 · RLS POR ROL')

    for (const [rol, email] of [
      ['customer', 'cliente.test@buscatools.com.ar'],
      ['distributor', 'distribuidor.test@buscatools.com.ar'],
    ]) {
      const ext = sesion()
      const { error } = await ext.auth.signInWithPassword({ email, password: process.env.BT_PW_TEST })
      if (error) { FAIL(`${rol}: no se pudo iniciar sesión`, error.message); continue }
      const { data: lista } = await ext.from('supplier_invoices').select('id')
      cmp(`${rol}: no ve ninguna factura`, 0, (lista ?? []).length)
      const { data: porId } = await ext.from('supplier_invoices').select('id').eq('id', fMulti.data.id)
      cmp(`${rol}: tampoco por id exacto`, 0, (porId ?? []).length)
      const { data: porNum } = await ext.from('supplier_invoices')
        .select('id').eq('supplier_number', `${MARCA}-MULTI-1`)
      cmp(`${rol}: tampoco por el número del proveedor`, 0, (porNum ?? []).length)
      const { data: porProv } = await ext.from('supplier_invoices')
        .select('id').eq('supplier_id', prov.id)
      cmp(`${rol}: tampoco por proveedor`, 0, (porProv ?? []).length)
      const { data: lineasExt } = await ext.from('supplier_invoice_lines').select('id')
      cmp(`${rol}: ni las líneas`, 0, (lineasExt ?? []).length)
      const { data: porRecLinea } = await ext.from('supplier_invoice_lines')
        .select('id').eq('goods_receipt_line_id', r4a.lineas[0])
      cmp(`${rol}: ni buscando por línea de recepción`, 0, (porRecLinea ?? []).length)
      const { data: porPoLinea } = await ext.from('supplier_invoice_lines')
        .select('id').eq('purchase_order_line_id', po4.lineas[0])
      cmp(`${rol}: ni por línea de pedido`, 0, (porPoLinea ?? []).length)
      const { error: eReg } = await registrar(ext, fVacia.id)
      eReg ? PASS(`${rol}: no puede registrar`, eReg.code ?? '')
           : FAIL(`${rol.toUpperCase()} REGISTRÓ UNA FACTURA`)
      const { data: pendExt, error: ePend } = await ext.rpc('pendiente_de_facturar',
        { p_company: BT, p_receipts: null, p_supplier: null, p_excluir_factura: null })
      ePend || (pendExt ?? []).length === 0
        ? PASS(`${rol}: no le sale nada pendiente de facturar`, ePend?.code ?? '0 filas')
        : FAIL(`${rol.toUpperCase()} VE LO PENDIENTE DE FACTURAR`)
      const { data: adjExt } = await ext.from('attachments')
        .select('id').eq('entity_type', 'supplier_invoice')
      cmp(`${rol}: ni los adjuntos de facturas`, 0, (adjExt ?? []).length)
    }

    const anon = sesion()
    const { data: nadaAnon } = await anon.from('supplier_invoices').select('id')
    cmp('anónimo: no ve nada', 0, (nadaAnon ?? []).length)
    const { error: eAnonReg } = await registrar(anon, fVacia.id)
    eAnonReg ? PASS('anónimo: no puede ni ejecutar la función', eAnonReg.code ?? '')
             : FAIL('ANÓNIMO EJECUTÓ registrar_factura_proveedor')

    // Jano es salesperson en Torquetools.
    const { data: veTT } = await c.from('supplier_invoices').select('id').eq('company_id', TT)
    cmp('salesperson: no ve las facturas de su empresa', 0, (veTT ?? []).length)
    const fTT = await nuevaFactura(c, prov.id, [], { company_id: TT })
    fTT.error ? PASS('salesperson: no puede crear en su empresa', fTT.error.code ?? '')
              : FAIL('EL SALESPERSON CREÓ UNA FACTURA')

    // ── 16 · Adjuntos ──────────────────────────────────────────────────────
    seccion('16 · ADJUNTOS DE LA FACTURA')

    const { data: adj, error: eAdj } = await c.from('attachments').insert({
      company_id: BT, entity_type: 'supplier_invoice', entity_id: fMulti.data.id,
      storage_path: `${BT}/supplier_invoice/${fMulti.data.id}/${MARCA}-factura.pdf`,
      file_name: `${MARCA}-factura.pdf`, mime_type: 'application/pdf', bytes: 1024, kind: 'invoice',
    }).select('id').single()
    if (eAdj) FAIL('no se pudo adjuntar el PDF de la factura', eAdj.message)
    else { creados.adjuntos.push(adj.id); PASS('el PDF de la factura entra en `attachments`') }

    const { data: adjVe } = await c.from('attachments')
      .select('id').eq('entity_id', fMulti.data.id)
    cmp('  y el admin lo ve', 1, (adjVe ?? []).length)

    const { data: adjTT } = await c.from('attachments')
      .select('id').eq('entity_type', 'supplier_invoice').eq('company_id', TT)
    cmp('  la empresa donde es vendedor no le muestra ninguno', 0, (adjTT ?? []).length)

    // ── 17 · Auditoría ─────────────────────────────────────────────────────
    seccion('17 · AUDITORÍA')

    const { data: audA } = await s.from('purchases_audit')
      .select('action, from_status, to_status').eq('entity_type', 'supplier_invoice')
      .eq('entity_id', fA.data.id).order('id')
    cmp('alta, registro y anulación quedan auditados', 'create,confirm,cancel',
      (audA ?? []).map((a) => a.action).join(','))
    cmp('  con la transición completa', 'draft→registered',
      `${(audA ?? [])[1]?.from_status}→${(audA ?? [])[1]?.to_status}`)

    const antesEdicion = (await s.from('purchases_audit')
      .select('*', { count: 'exact', head: true }).eq('entity_id', fVacia.id)).count
    await c.from('supplier_invoices').update({ notes: `${MARCA} vacía editada` }).eq('id', fVacia.id)
    const despuesEdicion = (await s.from('purchases_audit')
      .select('*', { count: 'exact', head: true }).eq('entity_id', fVacia.id)).count
    cmp('editar un borrador NO se audita', antesEdicion, despuesEdicion)

    const { data: autor } = await s.from('supplier_invoices')
      .select('created_by').eq('id', fMulti.data.id).single()
    autor.created_by ? PASS('la factura queda sellada con su autor')
                     : FAIL('LA FACTURA NO GUARDÓ QUIÉN LA CARGÓ')

    const { data: sellado } = await c.from('supplier_invoices')
      .update({ created_by: null }).eq('id', fVacia.id).select('created_by').single()
    sellado && sellado.created_by
      ? PASS('  y el autor no se puede borrar a mano')
      : FAIL('SE PUDO BORRAR EL AUTOR DE UNA FACTURA')

  } finally {
    // ── Limpieza ───────────────────────────────────────────────────────────
    seccion('LIMPIEZA')

    for (const id of creados.adjuntos) await s.from('attachments').delete().eq('id', id)
    await s.from('attachments').delete().like('file_name', `${MARCA}%`)

    for (const id of creados.facturas) {
      await s.from('supplier_invoice_lines').delete().eq('supplier_invoice_id', id)
      await s.from('supplier_invoices').delete().eq('id', id)
    }
    await s.from('supplier_invoices').delete().like('notes', `${MARCA}%`)

    for (const id of creados.recepciones) {
      await s.from('stock_movements').delete().eq('source_id', id)
      await s.from('goods_receipt_lines').delete().eq('goods_receipt_id', id)
      await s.from('goods_receipts').delete().eq('id', id)
    }
    await s.from('goods_receipts').delete().like('notes', `${MARCA}%`)

    // Los saldos vuelven a lo que había: se recalculan desde los movimientos
    // que quedaron, y los que la corrida creó de cero se borran.
    const { data: saldosAhora } = await s.from('stock_balances')
      .select('product_id, warehouse_id, on_hand')
    for (const b of saldosAhora ?? []) {
      const clave = b.product_id + '|' + b.warehouse_id
      const { data: movs } = await s.from('stock_movements')
        .select('quantity').eq('product_id', b.product_id).eq('warehouse_id', b.warehouse_id)
      const total = (movs ?? []).reduce((a, m) => a + Number(m.quantity), 0)
      if (!saldosPrevios.has(clave) && (movs ?? []).length === 0) {
        await s.from('stock_balances').delete()
          .eq('product_id', b.product_id).eq('warehouse_id', b.warehouse_id)
      } else if (Number(b.on_hand) !== total) {
        await s.from('stock_balances').update({ on_hand: total })
          .eq('product_id', b.product_id).eq('warehouse_id', b.warehouse_id)
      }
    }

    for (const id of creados.pedidos) {
      await s.from('purchase_order_lines').delete().eq('purchase_order_id', id)
      await s.from('purchase_orders').delete().eq('id', id)
    }
    await s.from('purchase_orders').delete().like('notes', `${MARCA}%`)

    for (const id of creados.proveedores) await s.from('suppliers').delete().eq('id', id)
    await s.from('suppliers').delete().like('legal_name', `${MARCA}%`)

    // La auditoría, al final: borrar líneas y documentos dispara triggers que
    // escriben eventos nuevos.
    const entidades = [
      ...creados.facturas, ...creados.recepciones, ...creados.pedidos, ...creados.proveedores,
    ]
    if (entidades.length > 0) {
      await s.from('purchases_audit').delete().in('entity_id', entidades)
    }

    for (const q of seqAntes ?? []) {
      await s.from('document_sequences').update({ next_number: q.next_number })
        .eq('company_id', BT).eq('doc_type', q.doc_type)
    }

    const q = async (t) => (await s.from(t).select('*', { count: 'exact', head: true })).count
    cmp('no queda ninguna factura', 0, await q('supplier_invoices'))
    cmp('ni una línea de factura', 0, await q('supplier_invoice_lines'))
    cmp('no queda ninguna recepción', 0, await q('goods_receipts'))
    cmp('ni ningún pedido', 0, await q('purchase_orders'))
    cmp('los proveedores vuelven a los 142 migrados', 142, await q('suppliers'))
    cmp('los movimientos de stock vuelven a su número', movAntes, await q('stock_movements'))
    cmp('y los saldos también', saldosPrevios.size, await q('stock_balances'))
    cmp('los adjuntos vuelven a su número', adjAntes, await q('attachments'))
    cmp('la auditoría vuelve a su número', auditAntes, await q('purchases_audit'))
    console.log(`    series repuestas: ${(seqAntes ?? []).map((x) => x.doc_type + '=' + x.next_number).join(' · ')}`)
  }

  console.log('\n' + '='.repeat(74))
  console.log(`  RESULTADO: ${fallos} fallo(s)`)
  console.log('='.repeat(74))
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch((e) => { console.error('\n✗', e); process.exit(1) })
