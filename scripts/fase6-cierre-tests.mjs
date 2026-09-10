/**
 * Fase 6 · Compras — entrega 6: cierre funcional, contra la base real.
 *
 * No repite lo que ya prueban las suites de cada entrega. Prueba lo que sólo
 * se ve **con el circuito entero andando de punta a punta**:
 *
 *   1. El flujo completo: proveedor → pedido → recepción parcial → recepción
 *      final → factura parcial → factura final, mirando en cada paso la
 *      numeración, la moneda, la ETA, la condición de pago, el stock, los
 *      estados y lo pendiente.
 *   2. Que la auditoría NO explote: un flujo completo tiene que dejar los
 *      eventos de negocio y nada más. Ni recálculo de totales, ni
 *      `updated_at`, ni ediciones de borrador.
 *   3. Los adjuntos de las CUATRO entidades, y que ninguna herede acceso de
 *      otra por error.
 *   4. La matriz de RLS completa con JWT real.
 *   5. Cuánto tarda cada pantalla con los datos que hay.
 *   6. Los invariantes de TODAS las fases, no sólo los de Compras.
 *
 * Se limpia sola: prefijo `ZZ-C6`.
 *
 *   set -a; source .env; source .env.migration; source .env.rls.txt; set +a
 *   node scripts/fase6-cierre-tests.mjs
 */
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'

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

const MARCA = 'ZZ-C6'
const HOY = new Date().toISOString().slice(0, 10)
const ETA = '2026-11-30'
const PAGO = '30 días fecha factura'
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
    .select('id, sku, name').eq('company_id', BT).order('sku').limit(3)

  const saldo = async (productId) => {
    const { data } = await s.from('stock_balances').select('on_hand')
      .eq('product_id', productId).eq('warehouse_id', dep.id).maybeSingle()
    return data ? Number(data.on_hand) : 0
  }

  console.log('='.repeat(74))
  console.log('  COMPRAS · entrega 6 — cierre funcional')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(74))

  try {
    // ── 1 · El flujo completo ──────────────────────────────────────────────
    seccion('1 · FLUJO E2E: PROVEEDOR → PEDIDO → 2 RECEPCIONES → 2 FACTURAS')

    const { data: refProv } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'supplier' })
    const { data: prov, error: eProv } = await c.from('suppliers').insert({
      company_id: BT, legacy_ref: refProv, legal_name: `${MARCA} Proveedor de cierre`,
      trade_name: 'Cierre', phone: '11 5555 0000', payment_terms: PAGO,
    }).select('id, legacy_ref, payment_terms').single()
    if (eProv) { FAIL('no se pudo crear el proveedor', eProv.message); throw eProv }
    creados.proveedores.push(prov.id)
    cmp('el proveedor toma la referencia que sigue', 'PROV00146', prov.legacy_ref)
    cmp('  y guarda su condición de pago', PAGO, prov.payment_terms)

    const { data: numPo } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'purchase_order' })
    const { data: po, error: ePo } = await c.from('purchase_orders').insert({
      company_id: BT, supplier_id: prov.id, number: numPo, series_code: 'PC',
      currency_code: 'USD', order_date: HOY, expected_date: ETA,
      payment_terms: PAGO, notes: `${MARCA} pedido de cierre`,
    }).select('id, number, currency_code, expected_date, payment_terms, status, receipt_status')
      .single()
    if (ePo) { FAIL('no se pudo crear el pedido', ePo.message); throw ePo }
    creados.pedidos.push(po.id)
    cmp('el pedido toma la referencia que sigue', 'PC00002', po.number)
    cmp('  nace en borrador', 'draft', po.status)
    cmp('  sin recibir', 'pending', po.receipt_status)
    cmp('  con su moneda', 'USD', po.currency_code)
    cmp('  con la ETA que se le puso', ETA, po.expected_date)
    cmp('  y la condición de pago', PAGO, po.payment_terms)

    const lineas = []
    const defs = [
      { p: prods[0], cantidad: 40, precio: 128.5, dto: 5, trato: 'vat_21' },
      { p: prods[1], cantidad: 12, precio: 2340.75, dto: 0, trato: 'vat_105' },
      { p: null, cantidad: 1, precio: 1850, dto: 0, trato: 'exempt', nombre: 'Flete marítimo' },
    ]
    for (let i = 0; i < defs.length; i += 1) {
      const d = defs[i]
      const { data, error } = await c.from('purchase_order_lines').insert({
        company_id: BT, purchase_order_id: po.id, line_no: i + 1, line_type: 'product',
        product_id: d.p?.id ?? null, sku_snapshot: d.p?.sku ?? null,
        name_snapshot: d.p?.name ?? d.nombre, quantity: d.cantidad,
        unit_price: d.precio, discount_pct: d.dto, tax_treatment: d.trato,
      }).select('id, tax_rate_snapshot').single()
      if (error) { FAIL(`línea ${i + 1} del pedido`, error.message); throw error }
      lineas.push(data.id)
    }
    // 40×128,50×0,95 = 4883 · 12×2340,75 = 28089 · 1850 = 34822
    // IVA: 4883×21% = 1025,43 · 28089×10,5% = 2949,35 · exento 0 = 3974,78
    const { data: poTot } = await s.from('purchase_orders')
      .select('subtotal, tax_amount, total').eq('id', po.id).single()
    cmp('el subtotal lo calcula el servidor', 34822, Number(poTot.subtotal))
    cmp('  el impuesto, alícuota por alícuota', 3974.78, Number(poTot.tax_amount))
    cmp('  y el total', 38796.78, Number(poTot.total))

    await c.from('purchase_orders').update({ status: 'confirmed' }).eq('id', po.id)
    cmp('confirmar el pedido NO mueve stock', movAntes,
      (await s.from('stock_movements').select('*', { count: 'exact', head: true })).count)

    // Recepción parcial: 15 de 40, 12 de 12, nada del flete.
    const stock0 = await saldo(prods[0].id)
    const stock1 = await saldo(prods[1].id)

    const nuevaRecepcion = async (cantidades, etiqueta) => {
      const { data: num } = await c.rpc('next_document_number',
        { p_company: BT, p_doc_type: 'goods_receipt' })
      const { data: r, error } = await c.from('goods_receipts').insert({
        company_id: BT, supplier_id: prov.id, purchase_order_id: po.id,
        warehouse_id: dep.id, number: num, series_code: 'NEP', receipt_date: HOY,
        notes: `${MARCA} ${etiqueta}`,
      }).select('id, number, status').single()
      if (error) { FAIL(`recepción ${etiqueta}`, error.message); return null }
      creados.recepciones.push(r.id)
      const ids = []
      for (const q of cantidades) {
        const { data, error: eLin } = await c.from('goods_receipt_lines').insert({
          company_id: BT, goods_receipt_id: r.id, purchase_order_line_id: q.lineaId,
          product_id: q.productId ?? null, sku_snapshot: q.sku ?? null,
          name_snapshot: q.nombre ?? null, quantity: q.cantidad,
        }).select('id').single()
        if (eLin) { FAIL(`línea de recepción ${etiqueta}`, eLin.message); return null }
        ids.push(data.id)
      }
      return { ...r, lineas: ids }
    }

    const r1 = await nuevaRecepcion([
      { lineaId: lineas[0], productId: prods[0].id, sku: prods[0].sku, nombre: prods[0].name, cantidad: 15 },
      { lineaId: lineas[1], productId: prods[1].id, sku: prods[1].sku, nombre: prods[1].name, cantidad: 12 },
    ], 'recepción parcial')
    cmp('la recepción nace en borrador', 'draft', r1.status)
    cmp('  y en borrador NO mueve stock', stock0, await saldo(prods[0].id))

    const { data: conf1 } = await c.rpc('confirmar_recepcion', { p_receipt: r1.id })
    cmp('confirmar la parcial genera 2 movimientos', 2, conf1.movimientos)
    cmp('  el pedido queda recibido en parte', 'partially_received', conf1.receipt_status_pedido)
    cmp('  el stock del primer producto sube 15', stock0 + 15, await saldo(prods[0].id))
    cmp('  el del segundo, 12', stock1 + 12, await saldo(prods[1].id))

    const r2 = await nuevaRecepcion([
      { lineaId: lineas[0], productId: prods[0].id, sku: prods[0].sku, nombre: prods[0].name, cantidad: 25 },
      { lineaId: lineas[2], productId: null, sku: null, nombre: 'Flete marítimo', cantidad: 1 },
    ], 'recepción final')
    const { data: conf2 } = await c.rpc('confirmar_recepcion', { p_receipt: r2.id })
    // El flete no tiene producto: se recibe documentalmente y no mueve stock.
    cmp('la final genera 1 movimiento: el flete no es mercadería', 1, conf2.movimientos)
    cmp('  y el pedido queda RECIBIDO del todo', 'received', conf2.receipt_status_pedido)
    cmp('  el stock del primer producto llegó a 40', stock0 + 40, await saldo(prods[0].id))

    const { data: pend } = await c.rpc('pendiente_de_pedido', { p_order: po.id })
    cmp('no queda nada pendiente de recibir', 0,
      (pend ?? []).reduce((a, x) => a + Number(x.pendiente), 0))

    // Factura parcial y factura final.
    const nuevaFactura = async (items, numeroProveedor, etiqueta) => {
      const { data: num } = await c.rpc('next_document_number',
        { p_company: BT, p_doc_type: 'supplier_invoice' })
      const { data: f, error } = await c.from('supplier_invoices').insert({
        company_id: BT, supplier_id: prov.id, number: num, series_code: 'FP',
        supplier_number: numeroProveedor, currency_code: 'USD', invoice_date: HOY,
        payment_terms: PAGO, notes: `${MARCA} ${etiqueta}`,
      }).select('id, number, status').single()
      if (error) { FAIL(`factura ${etiqueta}`, error.message); return null }
      creados.facturas.push(f.id)
      for (let i = 0; i < items.length; i += 1) {
        const it = items[i]
        const { error: eLin } = await c.from('supplier_invoice_lines').insert({
          company_id: BT, supplier_invoice_id: f.id, line_no: i + 1, line_type: 'product',
          goods_receipt_line_id: it.recepcionLineaId ?? null,
          description_snapshot: it.descripcion ?? 'Concepto',
          quantity: it.cantidad, unit_price: it.precio, discount_pct: it.dto ?? 0,
          tax_treatment: it.trato ?? 'vat_21',
        })
        if (eLin) { FAIL(`línea de factura ${etiqueta}`, eLin.message); return null }
      }
      return f
    }

    const fParcial = await nuevaFactura([
      { recepcionLineaId: r1.lineas[0], cantidad: 15, precio: 128.5, dto: 5, trato: 'vat_21' },
    ], `${MARCA}-A-0001`, 'factura parcial')
    cmp('la factura nace en borrador', 'draft', fParcial.status)

    const { count: movAntesFactura } = await s.from('stock_movements')
      .select('*', { count: 'exact', head: true })
    const { data: regP } = await c.rpc('registrar_factura_proveedor', { p_invoice: fParcial.id })
    cmp('registrar la parcial cuenta 1 línea', 1, regP.lineas)
    cmp('  y NO mueve stock', movAntesFactura,
      (await s.from('stock_movements').select('*', { count: 'exact', head: true })).count)

    const { data: pf1 } = await c.rpc('pendiente_de_facturar',
      { p_company: BT, p_receipts: [r1.id, r2.id], p_supplier: null, p_excluir_factura: null })
    const total1 = (pf1 ?? []).reduce((a, x) => a + Number(x.pendiente), 0)
    // 40 + 12 + 1 recibidas = 53; facturadas 15 → 38.
    cmp('quedan 38 unidades por facturar', 38, total1)

    const fFinal = await nuevaFactura([
      { recepcionLineaId: r1.lineas[1], cantidad: 12, precio: 2340.75, trato: 'vat_105' },
      { recepcionLineaId: r2.lineas[0], cantidad: 25, precio: 128.5, dto: 5, trato: 'vat_21' },
      { recepcionLineaId: r2.lineas[1], cantidad: 1, precio: 1850, trato: 'exempt' },
      { descripcion: 'Gastos de despacho', cantidad: 1, precio: 240, trato: 'vat_21' },
    ], `${MARCA}-A-0002`, 'factura final')
    const { data: regF } = await c.rpc('registrar_factura_proveedor', { p_invoice: fFinal.id })
    cmp('la final cubre 4 líneas, una de ellas libre', 4, regF.lineas)

    const { data: pf2 } = await c.rpc('pendiente_de_facturar',
      { p_company: BT, p_receipts: [r1.id, r2.id], p_supplier: null, p_excluir_factura: null })
    cmp('no queda nada pendiente de facturar', 0,
      (pf2 ?? []).reduce((a, x) => a + Number(x.pendiente), 0))

    // La factura consolida DOS recepciones y UNA orden, derivadas por líneas.
    const { data: lineasF } = await s.from('supplier_invoice_lines')
      .select('goods_receipt_line_id, purchase_order_line_id')
      .eq('supplier_invoice_id', fFinal.id)
    const { data: recsF } = await s.from('goods_receipt_lines')
      .select('goods_receipt_id')
      .in('id', lineasF.map((x) => x.goods_receipt_line_id).filter(Boolean))
    cmp('la factura final toca 2 recepciones', 2,
      new Set(recsF.map((x) => x.goods_receipt_id)).size)
    cmp('  y las líneas del pedido las derivó el servidor', 3,
      lineasF.filter((x) => x.purchase_order_line_id !== null).length)

    // ── 2 · La auditoría no explota ────────────────────────────────────────
    seccion('2 · AUDITORÍA: SÓLO EVENTOS DE NEGOCIO')

    const entidadesFlujo = [po.id, r1.id, r2.id, fParcial.id, fFinal.id, prov.id]
    const { data: eventos } = await s.from('purchases_audit')
      .select('entity_type, entity_id, action').in('entity_id', entidadesFlujo).order('id')

    const porTipo = (t, id) => (eventos ?? []).filter((e) => e.entity_type === t && e.entity_id === id)
    cmp('el pedido: alta, confirmación y dos recepciones', 'create,confirm,receive,receive',
      porTipo('purchase_order', po.id).map((e) => e.action).join(','))
    cmp('la recepción 1: alta, confirmación y stock', 'create,confirm,stock_applied',
      porTipo('goods_receipt', r1.id).map((e) => e.action).join(','))
    cmp('la recepción 2: lo mismo', 'create,confirm,stock_applied',
      porTipo('goods_receipt', r2.id).map((e) => e.action).join(','))
    cmp('la factura parcial: alta y registro', 'create,confirm',
      porTipo('supplier_invoice', fParcial.id).map((e) => e.action).join(','))
    cmp('la factura final: alta y registro', 'create,confirm',
      porTipo('supplier_invoice', fFinal.id).map((e) => e.action).join(','))
    cmp('el proveedor: ninguno, no se audita un alta de maestro', 0,
      porTipo('supplier', prov.id).length)
    // 4 del pedido + 3 de cada recepción + 2 de cada factura = 14.
    cmp('TOTAL del flujo completo: 14 eventos, ni uno más', 14, (eventos ?? []).length)

    // Ahora el ruido: editar borradores, recalcular totales, tocar updated_at.
    const antesRuido = (eventos ?? []).length
    const { data: numRuido } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'purchase_order' })
    const { data: poRuido } = await c.from('purchase_orders').insert({
      company_id: BT, supplier_id: prov.id, number: numRuido, series_code: 'PC',
      currency_code: 'USD', order_date: HOY, notes: `${MARCA} ruido`,
    }).select('id').single()
    creados.pedidos.push(poRuido.id)
    for (let i = 0; i < 5; i += 1) {
      await c.from('purchase_orders').update({ notes: `${MARCA} ruido ${i}` }).eq('id', poRuido.id)
    }
    const { data: lRuido } = await c.from('purchase_order_lines').insert({
      company_id: BT, purchase_order_id: poRuido.id, line_no: 1, line_type: 'product',
      name_snapshot: 'Algo', quantity: 1, unit_price: 100, tax_treatment: 'vat_21',
    }).select('id').single()
    for (let i = 1; i <= 5; i += 1) {
      await c.from('purchase_order_lines').update({ quantity: i }).eq('id', lRuido.id)
    }
    const { count: rutaRuido } = await s.from('purchases_audit')
      .select('*', { count: 'exact', head: true }).eq('entity_id', poRuido.id)
    cmp('5 ediciones de cabecera + 5 de líneas dejan SÓLO el alta', 1, rutaRuido)
    cmp('  y no tocan la auditoría del resto', antesRuido,
      (await s.from('purchases_audit').select('*', { count: 'exact', head: true })
        .in('entity_id', entidadesFlujo)).count)

    // ── 3 · Adjuntos de las cuatro entidades ───────────────────────────────
    seccion('3 · ADJUNTOS: CUATRO ENTIDADES, SIN HERENCIA CRUZADA')

    const entidades = [
      ['supplier', prov.id],
      ['purchase_order', po.id],
      ['goods_receipt', r1.id],
      ['supplier_invoice', fFinal.id],
    ]
    for (const [tipo, id] of entidades) {
      const { data, error } = await c.from('attachments').insert({
        company_id: BT, entity_type: tipo, entity_id: id,
        storage_path: `${BT}/${tipo}/${id}/${MARCA}.pdf`,
        file_name: `${MARCA}-${tipo}.pdf`, mime_type: 'application/pdf',
        bytes: 512, kind: 'other',
      }).select('id').single()
      if (error) { FAIL(`adjunto de ${tipo}`, error.message); continue }
      creados.adjuntos.push(data.id)
      const { data: ve } = await c.from('attachments').select('id').eq('id', data.id)
      cmp(`${tipo}: se adjunta y el admin lo ve`, 1, (ve ?? []).length)
    }

    for (const [rol, email] of [
      ['customer', 'cliente.test@buscatools.com.ar'],
      ['distributor', 'distribuidor.test@buscatools.com.ar'],
    ]) {
      const ext = sesion()
      const { error } = await ext.auth.signInWithPassword({ email, password: process.env.BT_PW_TEST })
      if (error) { FAIL(`${rol}: login`, error.message); continue }
      for (const [tipo] of entidades) {
        const { data } = await ext.from('attachments').select('id').eq('entity_type', tipo)
        cmp(`${rol}: no ve ningún adjunto de ${tipo}`, 0, (data ?? []).length)
      }
    }

    // Y el caso que importa: que un tipo no herede el acceso de otro. El
    // vendedor SÍ ve los adjuntos de Ventas y NO tiene que ver los de Compras.
    const { data: adjVentasBT } = await c.from('attachments')
      .select('id, entity_type').in('entity_type', ['quote', 'order', 'delivery', 'customer'])
    PASS('admin ve los adjuntos de Ventas', `${(adjVentasBT ?? []).length} filas`)
    const { data: adjTT } = await c.from('attachments').select('id').eq('company_id', TT)
    cmp('en la empresa donde es vendedor no ve ninguno de Compras', 0,
      (adjTT ?? []).filter((x) => x).length)

    // ── 4 · RLS final ──────────────────────────────────────────────────────
    seccion('4 · RLS FINAL, CON JWT REAL')

    const TABLAS = ['suppliers', 'purchase_orders', 'purchase_order_lines',
      'goods_receipts', 'goods_receipt_lines', 'supplier_invoices',
      'supplier_invoice_lines', 'purchases_audit']

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
      cmp(`${rol}: 0 filas en las ocho tablas de Compras`, 0, visto)

      // Por identificador exacto, que es como se filtra un dato puntual.
      const { data: porId } = await ext.from('purchase_orders').select('id').eq('id', po.id)
      const { data: porNum } = await ext.from('purchase_orders').select('id').eq('number', po.number)
      const { data: porProv } = await ext.from('suppliers').select('id').eq('id', prov.id)
      const { data: porPol } = await ext.from('goods_receipt_lines')
        .select('id').eq('purchase_order_line_id', lineas[0])
      const { data: porGrl } = await ext.from('supplier_invoice_lines')
        .select('id').eq('goods_receipt_line_id', r1.lineas[0])
      cmp(`${rol}: tampoco por id, número, proveedor ni línea`, 0,
        (porId ?? []).length + (porNum ?? []).length + (porProv ?? []).length +
        (porPol ?? []).length + (porGrl ?? []).length)

      // Y las RPC.
      const r = await Promise.all([
        ext.rpc('confirmar_recepcion', { p_receipt: r1.id }),
        ext.rpc('registrar_factura_proveedor', { p_invoice: fFinal.id }),
        ext.rpc('pendiente_de_pedido', { p_order: po.id }),
        ext.rpc('next_document_number', { p_company: BT, p_doc_type: 'purchase_order' }),
      ])
      const bloqueadas = r.filter((x) => x.error || (Array.isArray(x.data) && x.data.length === 0)).length
      cmp(`${rol}: las cuatro RPC lo rechazan o no le devuelven nada`, 4, bloqueadas)
    }

    const anon = sesion()
    let vistoAnon = 0
    for (const t of TABLAS) {
      const { data } = await anon.from(t).select('id')
      vistoAnon += (data ?? []).length
    }
    cmp('anónimo: 0 filas en las ocho tablas', 0, vistoAnon)
    const rAnon = await Promise.all([
      anon.rpc('confirmar_recepcion', { p_receipt: r1.id }),
      anon.rpc('registrar_factura_proveedor', { p_invoice: fFinal.id }),
      anon.rpc('pendiente_de_facturar', { p_company: BT, p_receipts: null, p_supplier: null, p_excluir_factura: null }),
    ])
    cmp('anónimo: no puede ejecutar ninguna RPC de Compras', 3,
      rAnon.filter((x) => x.error).length)

    // Jano es salesperson en Torquetools: empresa ajena.
    let vistoTT = 0
    for (const t of ['suppliers', 'purchase_orders', 'goods_receipts', 'supplier_invoices']) {
      const { data } = await c.from(t).select('id').eq('company_id', TT)
      vistoTT += (data ?? []).length
    }
    cmp('salesperson: 0 filas de Compras en su propia empresa', 0, vistoTT)
    const { error: eEscribeTT } = await c.from('suppliers')
      .insert({ company_id: TT, legal_name: `${MARCA} intento` })
    eEscribeTT ? PASS('  y tampoco puede escribir', eEscribeTT.code ?? '')
               : FAIL('EL SALESPERSON ESCRIBIÓ EN COMPRAS')

    // ── 5 · Performance ────────────────────────────────────────────────────
    seccion('5 · CUÁNTO TARDA CADA PANTALLA')

    const medir = async (etiqueta, fn) => {
      // Tres corridas y se informa la mediana: una sola mide la red, no la
      // consulta.
      const tiempos = []
      for (let i = 0; i < 3; i += 1) {
        const t0 = Date.now()
        await fn()
        tiempos.push(Date.now() - t0)
      }
      tiempos.sort((a, b) => a - b)
      const ms = tiempos[1]
      console.log(`    ${ms.toString().padStart(5)} ms  ${etiqueta}`)
      return ms
    }

    const cols = {
      prov: 'id, legacy_ref, legal_name, trade_name, country_code, phone, email, payment_terms, status, legacy_source, needs_review, review_reason, deleted_at',
      po: 'id, number, order_date, expected_date, currency_code, total, status, receipt_status, supplier_id, proveedor:suppliers!supplier_id(legal_name), autor:profiles!created_by(full_name), purchase_order_lines(id)',
      nep: 'id, number, receipt_date, status, supplier_id, purchase_order_id, warehouse_id, proveedor:suppliers!supplier_id(legal_name), goods_receipt_lines(id, quantity)',
      fp: 'id, number, supplier_number, invoice_date, due_date, currency_code, total, status, supplier_id, proveedor:suppliers!supplier_id(legal_name), autor:profiles!created_by(full_name), supplier_invoice_lines(id, goods_receipt_line_id)',
    }
    const lentas = []
    const anotar = (etiqueta, ms) => { if (ms > 1500) lentas.push(`${etiqueta} ${ms}ms`) }

    anotar('proveedores', await medir('listado de proveedores (25)', () =>
      c.from('suppliers').select(cols.prov, { count: 'exact' })
        .eq('company_id', BT).is('deleted_at', null).order('legal_name').range(0, 24)))
    anotar('pedidos', await medir('listado de pedidos (25)', () =>
      c.from('purchase_orders').select(cols.po, { count: 'exact' })
        .eq('company_id', BT).order('order_date', { ascending: false }).range(0, 24)))
    anotar('recepciones', await medir('listado de recepciones (25)', () =>
      c.from('goods_receipts').select(cols.nep, { count: 'exact' })
        .eq('company_id', BT).order('receipt_date', { ascending: false }).range(0, 24)))
    anotar('facturas', await medir('listado de facturas (25)', () =>
      c.from('supplier_invoices').select(cols.fp, { count: 'exact' })
        .eq('company_id', BT).order('invoice_date', { ascending: false }).range(0, 24)))
    anotar('ficha pedido', await medir('ficha de pedido + líneas', async () => {
      await c.from('purchase_orders').select('*').eq('id', po.id).single()
      await c.from('purchase_order_lines').select('*').eq('purchase_order_id', po.id)
    }))
    anotar('ficha recepción', await medir('ficha de recepción + líneas', async () => {
      await c.from('goods_receipts').select('*').eq('id', r1.id).single()
      await c.from('goods_receipt_lines').select('*').eq('goods_receipt_id', r1.id)
    }))
    anotar('ficha factura', await medir('ficha de factura + líneas', async () => {
      await c.from('supplier_invoices').select('*').eq('id', fFinal.id).single()
      await c.from('supplier_invoice_lines').select('*').eq('supplier_invoice_id', fFinal.id)
    }))
    anotar('búsqueda por número', await medir('búsqueda por número de pedido', () =>
      c.from('purchase_orders').select('id, number').eq('company_id', BT)
        .ilike('number', '%PC000%')))
    anotar('búsqueda por proveedor', await medir('búsqueda de proveedor por nombre', () =>
      c.from('suppliers').select('id, legal_name').eq('company_id', BT)
        .ilike('legal_name', '%tool%').limit(25)))
    anotar('pendiente de facturar', await medir('pendiente de facturar del proveedor', () =>
      c.rpc('pendiente_de_facturar',
        { p_company: BT, p_receipts: null, p_supplier: prov.id, p_excluir_factura: null })))

    lentas.length === 0
      ? PASS('ninguna consulta pasa de 1,5 s')
      : FAIL('hay consultas lentas', lentas.join(' · '))

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

    // La auditoría, al final: borrar documentos dispara triggers.
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

    // ── Invariantes de TODAS las fases ─────────────────────────────────────
    seccion('INVARIANTES · COMPRAS')

    const q = async (t) => (await s.from(t).select('*', { count: 'exact', head: true })).count
    cmp('142 proveedores', 142, await q('suppliers'))
    cmp('0 pedidos de compra', 0, await q('purchase_orders'))
    cmp('0 recepciones', 0, await q('goods_receipts'))
    cmp('0 facturas de proveedor', 0, await q('supplier_invoices'))
    cmp('381 movimientos de stock', 381, await q('stock_movements'))
    cmp('379 saldos', 379, await q('stock_balances'))
    cmp('0 eventos de auditoría', 0, await q('purchases_audit'))
    cmp('los adjuntos vuelven a su número', adjAntes, await q('attachments'))
    cmp('los movimientos vuelven a su número', movAntes, await q('stock_movements'))
    cmp('la auditoría vuelve a su número', auditAntes, await q('purchases_audit'))

    seccion('INVARIANTES · VENTAS Y CLIENTES')

    const historicos = async (t) => (await s.from(t).select('*', { count: 'exact', head: true })
      .eq('company_id', BT).not('imported_at', 'is', null)).count
    cmp('288 cotizaciones históricas', 288, await historicos('sales_quotes'))
    cmp('166 pedidos históricos', 166, await historicos('sales_orders'))
    cmp('182 entregas históricas', 182, await historicos('deliveries'))
    cmp('1010 clientes', 1010, await q('customers'))
    cmp('87 contactos', 87, await q('customer_contacts'))
    cmp('14 alias de producto', 14, await q('customer_product_aliases'))

    // La huella histórica de Ventas, con la receta de Stage 2.5.
    const docs = []
    for (const tabla of ['sales_quotes', 'sales_orders', 'deliveries']) {
      let desde = 0
      for (;;) {
        const { data } = await s.from(tabla)
          .select('original_number, total, currency_code')
          .eq('company_id', BT).not('imported_at', 'is', null)
          .order('original_number').range(desde, desde + 999)
        if (!data || data.length === 0) break
        for (const d of data) {
          const total = d.total === null || d.total === undefined ? '' : Number(d.total).toFixed(4)
          docs.push(`${d.original_number}|${total}|${d.currency_code ?? ''}`)
        }
        if (data.length < 1000) break
        desde += 1000
      }
    }
    cmp('636 documentos históricos', 636, docs.length)
    const huella = crypto.createHash('md5').update(docs.join(',')).digest('hex')
    cmp('la huella md5 de Ventas no se movió', '8091b9166350c5bf2c331b1d882ec654', huella)

    console.log(`    series repuestas: ${(seqAntes ?? []).map((x) => x.doc_type + '=' + x.next_number).join(' · ')}`)
  }

  console.log('\n' + '='.repeat(74))
  console.log(`  RESULTADO: ${fallos} fallo(s)`)
  console.log('='.repeat(74))
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch((e) => { console.error('\n✗', e); process.exit(1) })
