/**
 * Fase 6 · Compras — entrega 1: el schema, contra la base real.
 *
 * Compras es funcionalidad nueva, así que esta suite prueba que el modelo hace
 * lo que dice: RLS por rol, numeración concurrente, moneda obligatoria,
 * tratamiento de IVA real, sobre-recepción rechazada, confirmación idempotente
 * y estado derivado.
 *
 * Cada prohibición se prueba con un INTENTO REAL. Se limpia sola: todo lo que
 * crea lleva el prefijo `ZZ-C1` y la limpieza borra también por prefijo, por si
 * una corrida muere a mitad.
 *
 *   set -a; source .env; source .env.migration; source .env.rls; set +a
 *   node scripts/fase6-compras-schema-tests.mjs
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!URL || !PUB || !SECRET) { console.error('✗ Faltan variables de entorno'); process.exit(1) }

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(70)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const cmp = (t, esperado, real) =>
  String(esperado) === String(real) ? PASS(t, String(real))
                                    : FAIL(t, `esperaba ${esperado}, dio ${real}`)

const sesion = () => createClient(URL, PUB, { auth: { persistSession: false } })
const admin = () => createClient(URL, SECRET, { auth: { persistSession: false } })

const MARCA = 'ZZ-C1'
const creados = { proveedores: [], pedidos: [], recepciones: [], facturas: [] }

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
  const { data: dep } = await s.from('warehouses')
    .select('id, code').eq('company_id', BT).eq('is_default', true).single()
  const { data: prods } = await s.from('products')
    .select('id, sku').eq('company_id', BT).order('sku').limit(3)

  const { data: seqAntes } = await s.from('document_sequences')
    .select('doc_type, next_number').eq('company_id', BT)
    .in('doc_type', ['supplier', 'purchase_order', 'goods_receipt', 'supplier_invoice'])
  const { count: movAntes } = await s.from('stock_movements')
    .select('*', { count: 'exact', head: true })
  const { data: balAntes } = await s.from('stock_balances').select('product_id, warehouse_id')
  const balacesPrevios = new Set((balAntes ?? []).map((b) => b.product_id + '|' + b.warehouse_id))

  console.log('='.repeat(74))
  console.log('  COMPRAS · entrega 1 — el schema contra la base real')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(74))

  /** Alta de proveedor con referencia del servidor. */
  const nuevoProveedor = async (nombre, extra = {}) => {
    const { data: ref, error: eN } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'supplier' })
    if (eN) return { error: eN }
    const { data, error } = await c.from('suppliers').insert({
      company_id: BT, legacy_ref: ref, legal_name: nombre, ...extra,
    }).select('id, legacy_ref').single()
    if (data) creados.proveedores.push(data.id)
    return { data, error, ref }
  }

  try {
    // ── RLS ────────────────────────────────────────────────────────────────
    seccion('1 · RLS POR ROL')

    const p0 = await nuevoProveedor(`${MARCA} Proveedor base`)
    p0.data ? PASS('admin crea un proveedor', p0.data.legacy_ref)
            : FAIL('el admin no pudo crear un proveedor', p0.error?.message)

    for (const [rol, email] of [
      ['customer', 'cliente.test@buscatools.com.ar'],
      ['distributor', 'distribuidor.test@buscatools.com.ar'],
    ]) {
      const ext = sesion()
      const { error } = await ext.auth.signInWithPassword({ email, password: process.env.BT_PW_TEST })
      if (error) { FAIL(`${rol}: no se pudo iniciar sesión`, error.message); continue }
      for (const tabla of ['suppliers', 'purchase_orders', 'goods_receipts', 'supplier_invoices']) {
        const { data } = await ext.from(tabla).select('id')
        cmp(`${rol}: no ve ${tabla}`, 0, (data ?? []).length)
      }
      const { error: eIns } = await ext.from('suppliers')
        .insert({ company_id: BT, legal_name: `${MARCA} intento ${rol}` })
      eIns ? PASS(`${rol}: no puede crear proveedores`, eIns.code ?? '')
           : FAIL(`${rol.toUpperCase()} CREÓ UN PROVEEDOR`)
    }

    const anon = sesion()
    const { data: nadaAnon } = await anon.from('suppliers').select('id')
    cmp('anónimo: no ve proveedores', 0, (nadaAnon ?? []).length)
    const { error: eAnon } = await anon.from('suppliers')
      .insert({ company_id: BT, legal_name: `${MARCA} anon` })
    eAnon ? PASS('anónimo: no escribe', eAnon.code ?? '') : FAIL('ANÓNIMO ESCRIBIÓ')

    // Jano es salesperson en Torquetools: ahí no tiene que ver nada de compras.
    const TT = comps.find((x) => x.slug === 'torquetools').id
    const { data: provTT } = await s.from('suppliers').insert({
      company_id: TT, legal_name: `${MARCA} Proveedor de Torquetools`,
    }).select('id').single()
    creados.proveedores.push(provTT.id)
    const { data: veTT } = await c.from('suppliers').select('id').eq('id', provTT.id)
    cmp('salesperson: no ve los proveedores de su empresa', 0, (veTT ?? []).length)
    const { error: eSp } = await c.from('suppliers')
      .insert({ company_id: TT, legal_name: `${MARCA} intento salesperson` })
    eSp ? PASS('salesperson: no puede crear proveedores', eSp.code ?? '')
        : FAIL('EL SALESPERSON CREÓ UN PROVEEDOR')

    // ── Numeración ─────────────────────────────────────────────────────────
    seccion('2 · NUMERACIÓN')

    cmp('la serie de proveedores arranca donde quedó el legacy', 146,
      seqAntes.find((x) => x.doc_type === 'supplier').next_number)
    cmp('la de pedidos arranca en 2, sin reutilizar PC00001', 2,
      seqAntes.find((x) => x.doc_type === 'purchase_order').next_number)

    const N = 10
    const conReintento = async (fn) => {
      for (let i = 0; i < 5; i += 1) {
        const r = await fn()
        if (!r.error) return r
        if (!String(r.error.message ?? '').includes('fetch failed')) return r
        await new Promise((z) => setTimeout(z, 200 * (i + 1)))
      }
      return { error: { message: 'fetch failed tras 5 intentos' } }
    }
    const altas = await Promise.all(Array.from({ length: N }, (_, i) =>
      conReintento(() => nuevoProveedor(`${MARCA} Concurrente ${i}`))))
    cmp(`${N} altas simultáneas sin error`, 0, altas.filter((a) => a.error).length)
    const refs = altas.map((a) => a.data?.legacy_ref).filter(Boolean)
    cmp('todas las referencias distintas', refs.length, new Set(refs).size)
    const nums = refs.map((r) => Number(r.replace(/\D/g, ''))).sort((a, b) => a - b)
    const sinHuecos = nums.every((v, i) => i === 0 || v === nums[i - 1] + 1)
    sinHuecos ? PASS('sin huecos por carrera', `${nums[0]}…${nums[nums.length - 1]}`)
              : FAIL('la numeración dejó huecos', nums.join(','))
    const formatoRef = /^PROV\d{5}$/
    formatoRef.test(refs[0] ?? '') ? PASS('formato PROV00000', refs[0])
                                   : FAIL('formato de referencia', String(refs[0]))

    // ── Pedido de compra ───────────────────────────────────────────────────
    seccion('3 · PEDIDO DE COMPRA')

    const { data: numPC } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'purchase_order' })
    const { data: pc, error: ePC } = await c.from('purchase_orders').insert({
      company_id: BT, supplier_id: p0.data.id, number: numPC,
      currency_code: 'USD', order_date: '2026-09-10', expected_date: '2026-10-15',
      payment_terms: 'FOB 180 DIAS',
    }).select('id, number, status, receipt_status, total').single()
    if (ePC) FAIL('no se pudo crear el pedido', ePC.message)
    else { creados.pedidos.push(pc.id); PASS('crea un pedido de compra', pc.number) }
    cmp('nace en borrador', 'draft', pc.status)
    cmp('y sin recibir', 'pending', pc.receipt_status)

    const { error: eSinMoneda } = await c.from('purchase_orders').insert({
      company_id: BT, supplier_id: p0.data.id, number: `${MARCA}-SIN-MONEDA`,
      order_date: '2026-09-10',
    })
    eSinMoneda ? PASS('un pedido sin moneda es rechazado', eSinMoneda.code ?? '')
               : FAIL('SE CREÓ UN PEDIDO SIN MONEDA')

    const { error: eMonedaMala } = await c.from('purchase_orders').insert({
      company_id: BT, supplier_id: p0.data.id, number: `${MARCA}-MONEDA-MALA`,
      currency_code: 'XXX', order_date: '2026-09-10',
    })
    eMonedaMala ? PASS('una moneda que no existe es rechazada', eMonedaMala.code ?? '')
                : FAIL('SE ACEPTÓ UNA MONEDA INEXISTENTE')

    const { error: eSinProv } = await c.from('purchase_orders').insert({
      company_id: BT, number: `${MARCA}-SIN-PROV`, currency_code: 'USD', order_date: '2026-09-10',
    })
    eSinProv ? PASS('un pedido sin proveedor es rechazado', eSinProv.code ?? '')
             : FAIL('SE CREÓ UN PEDIDO SIN PROVEEDOR')

    // ── Líneas, IVA y totales ──────────────────────────────────────────────
    seccion('4 · LÍNEAS, IVA Y TOTALES')

    const { data: l1 } = await c.from('purchase_order_lines').insert({
      company_id: BT, purchase_order_id: pc.id, line_no: 1,
      product_id: prods[0].id, sku_snapshot: prods[0].sku, name_snapshot: `${MARCA} línea 1`,
      quantity: 100, unit_price: 10, tax_treatment: 'vat_21',
    }).select('id, tax_rate_snapshot, line_total').single()
    cmp('la alícuota se deriva del tratamiento, no se supone', 21, Number(l1.tax_rate_snapshot))
    cmp('el neto de la línea lo calcula la base', 1000, Number(l1.line_total))

    const { data: l2 } = await c.from('purchase_order_lines').insert({
      company_id: BT, purchase_order_id: pc.id, line_no: 2,
      product_id: prods[1].id, sku_snapshot: prods[1].sku, name_snapshot: `${MARCA} línea 2`,
      quantity: 10, unit_price: 50, discount_pct: 10, tax_treatment: 'vat_105',
    }).select('id, tax_rate_snapshot, line_total').single()
    cmp('otro tratamiento, otra alícuota', 10.5, Number(l2.tax_rate_snapshot))
    cmp('el descuento entra en el neto', 450, Number(l2.line_total))

    const { data: pcTot } = await c.from('purchase_orders')
      .select('subtotal, tax_amount, total').eq('id', pc.id).single()
    cmp('subtotal del servidor', 1450, Number(pcTot.subtotal))
    // 1000 × 21 % + 450 × 10,5 % = 210 + 47,25
    cmp('IVA del servidor, por línea', 257.25, Number(pcTot.tax_amount))
    cmp('total', 1707.25, Number(pcTot.total))
    Number(pcTot.tax_amount) !== Number(pcTot.subtotal) * 0.01
      ? PASS('el bug del 1 % del legacy no se puede reproducir')
      : FAIL('EL TOTAL PARECE CALCULADO AL 1 %')

    const { error: eTrat } = await c.from('purchase_order_lines').insert({
      company_id: BT, purchase_order_id: pc.id, line_no: 9,
      product_id: prods[0].id, quantity: 1, unit_price: 1, tax_treatment: 'iva_21',
    })
    eTrat ? PASS('un tratamiento inventado es rechazado', eTrat.code ?? '')
          : FAIL('SE ACEPTÓ UN TRATAMIENTO QUE NO ESTÁ EN EL CHECK')

    const { error: eQty } = await c.from('purchase_order_lines').insert({
      company_id: BT, purchase_order_id: pc.id, line_no: 8,
      product_id: prods[0].id, quantity: -5, unit_price: 1,
    })
    eQty ? PASS('una cantidad negativa es rechazada', eQty.code ?? '')
         : FAIL('SE ACEPTÓ UNA CANTIDAD NEGATIVA')

    const { error: eDto } = await c.from('purchase_order_lines').insert({
      company_id: BT, purchase_order_id: pc.id, line_no: 7,
      product_id: prods[0].id, quantity: 1, unit_price: 1, discount_pct: 120,
    })
    eDto ? PASS('un descuento mayor que 100 es rechazado', eDto.code ?? '')
         : FAIL('SE ACEPTÓ UN DESCUENTO DE 120 %')

    await c.from('purchase_orders').update({ status: 'confirmed' }).eq('id', pc.id)

    // ── Recepción parcial ──────────────────────────────────────────────────
    seccion('5 · RECEPCIÓN PARCIAL, POR LÍNEA')

    const nuevaRecepcion = async (lineas) => {
      const { data: num } = await c.rpc('next_document_number',
        { p_company: BT, p_doc_type: 'goods_receipt' })
      const { data: r, error } = await c.from('goods_receipts').insert({
        company_id: BT, supplier_id: p0.data.id, purchase_order_id: pc.id,
        warehouse_id: dep.id, number: num, receipt_date: '2026-09-10',
      }).select('id, number').single()
      if (error) return { error }
      creados.recepciones.push(r.id)
      const filas = lineas.map((x) => ({
        company_id: BT, goods_receipt_id: r.id, purchase_order_line_id: x.linea,
        product_id: x.producto, quantity: x.cantidad,
      }))
      const { error: eL2 } = await c.from('goods_receipt_lines').insert(filas)
      return { data: r, error: eL2 }
    }

    const r1 = await nuevaRecepcion([{ linea: l1.id, producto: prods[0].id, cantidad: 30 }])
    r1.data ? PASS('crea una recepción de 30 sobre 100', r1.data.number)
            : FAIL('no se pudo crear la recepción', r1.error?.message)

    const { count: movBorrador } = await s.from('stock_movements')
      .select('*', { count: 'exact', head: true })
      .eq('source_type', 'goods_receipt').eq('source_id', r1.data.id)
    cmp('un borrador de recepción NO toca stock', 0, movBorrador)

    const { data: conf1, error: eConf1 } = await c.rpc('confirmar_recepcion', { p_receipt: r1.data.id })
    if (eConf1) FAIL('no se pudo confirmar', eConf1.message)
    else {
      cmp('confirmar mueve una línea de stock', 1, conf1.movimientos)
      cmp('el pedido pasa a parcial', 'partially_received', conf1.receipt_status_pedido)
    }

    const { data: pcTras1 } = await c.from('purchase_orders')
      .select('receipt_status').eq('id', pc.id).single()
    cmp('y quedó guardado', 'partially_received', pcTras1.receipt_status)

    const r2 = await nuevaRecepcion([{ linea: l1.id, producto: prods[0].id, cantidad: 40 }])
    const { data: conf2 } = await c.rpc('confirmar_recepcion', { p_receipt: r2.data.id })
    cmp('segunda recepción de 40: sigue parcial', 'partially_received', conf2.receipt_status_pedido)

    // ── Sobre-recepción ────────────────────────────────────────────────────
    seccion('6 · SOBRE-RECEPCIÓN')

    const r3 = await nuevaRecepcion([{ linea: l1.id, producto: prods[0].id, cantidad: 31 }])
    const { error: eSobre } = await c.rpc('confirmar_recepcion', { p_receipt: r3.data.id })
    eSobre
      ? PASS('recibir 31 sobre 30 pendientes es rechazado', String(eSobre.message).slice(0, 58))
      : FAIL('SE PUDO RECIBIR MÁS DE LO PENDIENTE')

    const { data: r3estado } = await s.from('goods_receipts')
      .select('status').eq('id', r3.data.id).single()
    cmp('la recepción rechazada sigue en borrador', 'draft', r3estado.status)
    const { count: movR3 } = await s.from('stock_movements')
      .select('*', { count: 'exact', head: true })
      .eq('source_type', 'goods_receipt').eq('source_id', r3.data.id)
    cmp('y no movió nada de stock', 0, movR3)

    // ── Idempotencia ───────────────────────────────────────────────────────
    seccion('7 · CONFIRMACIÓN IDEMPOTENTE')

    const { data: antesDoble } = await s.from('stock_balances')
      .select('on_hand').eq('product_id', prods[0].id).eq('warehouse_id', dep.id).single()

    const r4 = await nuevaRecepcion([{ linea: l1.id, producto: prods[0].id, cantidad: 30 }])
    const dobles = await Promise.all([
      c.rpc('confirmar_recepcion', { p_receipt: r4.data.id }),
      c.rpc('confirmar_recepcion', { p_receipt: r4.data.id }),
    ])
    const okDobles = dobles.filter((x) => !x.error).length
    cmp('las dos llamadas simultáneas responden bien', 2, okDobles)
    const { count: movR4 } = await s.from('stock_movements')
      .select('*', { count: 'exact', head: true })
      .eq('source_type', 'goods_receipt').eq('source_id', r4.data.id)
    cmp('pero el movimiento de stock se hizo UNA sola vez', 1, movR4)

    const { data: despuesDoble } = await s.from('stock_balances')
      .select('on_hand').eq('product_id', prods[0].id).eq('warehouse_id', dep.id).single()
    cmp('el saldo subió exactamente 30', 30,
      Number(despuesDoble.on_hand) - Number(antesDoble?.on_hand ?? 0))

    const { data: conf4b } = await c.rpc('confirmar_recepcion', { p_receipt: r4.data.id })
    cmp('confirmar de nuevo avisa que ya estaba', true, conf4b.ya_estaba)

    // La línea 1 está completa (30+40+30 = 100) pero la 2 no se tocó: el
    // pedido sigue parcial. La derivación mira TODAS las líneas, no la primera.
    const { data: pcCasi } = await c.from('purchase_orders')
      .select('receipt_status').eq('id', pc.id).single()
    cmp('línea 1 completa y línea 2 pendiente: sigue parcial',
      'partially_received', pcCasi.receipt_status)

    const r5 = await nuevaRecepcion([{ linea: l2.id, producto: prods[1].id, cantidad: 10 }])
    const { data: conf5 } = await c.rpc('confirmar_recepcion', { p_receipt: r5.data.id })
    cmp('recibida también la línea 2, el pedido queda recibido',
      'received', conf5.receipt_status_pedido)

    // ── Estado derivado y bloqueos ─────────────────────────────────────────
    seccion('8 · ESTADO DERIVADO Y BLOQUEOS')

    await c.from('purchase_orders').update({ receipt_status: 'pending' }).eq('id', pc.id)
    const { data: pcTrasPisar } = await c.from('purchase_orders')
      .select('receipt_status').eq('id', pc.id).single()
    cmp('la aplicación NO puede escribir receipt_status', 'received', pcTrasPisar.receipt_status)

    const { error: eEditar } = await c.from('purchase_order_lines')
      .update({ quantity: 999 }).eq('id', l1.id)
    eEditar ? PASS('con mercadería recibida las líneas se congelan', eEditar.code ?? '')
            : FAIL('SE PUDO EDITAR UNA LÍNEA YA RECIBIDA')

    const { error: eCancelar } = await c.from('purchase_orders')
      .update({ status: 'cancelled' }).eq('id', pc.id)
    eCancelar ? PASS('y el pedido no se puede cancelar', eCancelar.code ?? '')
              : FAIL('SE CANCELÓ UN PEDIDO CON MERCADERÍA RECIBIDA')

    // ── Facturas ───────────────────────────────────────────────────────────
    seccion('9 · FACTURAS DE PROVEEDOR')

    const nuevaFactura = async (numeroProveedor, lineas) => {
      const { data: num } = await c.rpc('next_document_number',
        { p_company: BT, p_doc_type: 'supplier_invoice' })
      const { data: f, error } = await c.from('supplier_invoices').insert({
        company_id: BT, supplier_id: p0.data.id, number: num,
        supplier_number: numeroProveedor, currency_code: 'USD', invoice_date: '2026-09-10',
      }).select('id, number').single()
      if (error) return { error }
      creados.facturas.push(f.id)
      const { error: eL3 } = await c.from('supplier_invoice_lines').insert(
        lineas.map((x, i) => ({
          company_id: BT, supplier_invoice_id: f.id, line_no: i + 1,
          goods_receipt_line_id: x.lineaRecepcion ?? null,
          product_id: x.producto ?? null, description_snapshot: x.desc ?? `${MARCA} línea`,
          quantity: x.cantidad, unit_price: x.precio, tax_treatment: x.trat ?? 'vat_21',
        })))
      return { data: f, error: eL3 }
    }

    const { data: lineasR1 } = await s.from('goods_receipt_lines')
      .select('id').eq('goods_receipt_id', r1.data.id)
    const { data: lineasR2 } = await s.from('goods_receipt_lines')
      .select('id').eq('goods_receipt_id', r2.data.id)

    const f1 = await nuevaFactura(`${MARCA}-A-0001`, [
      { lineaRecepcion: lineasR1[0].id, producto: prods[0].id, cantidad: 30, precio: 10 },
    ])
    f1.data ? PASS('factura parcial: cubre una sola recepción', f1.data.number)
            : FAIL('no se pudo crear la factura parcial', f1.error?.message)

    const f2 = await nuevaFactura(`${MARCA}-A-0002`, [
      { lineaRecepcion: lineasR1[0].id, producto: prods[0].id, cantidad: 0.5, precio: 10 },
      { lineaRecepcion: lineasR2[0].id, producto: prods[0].id, cantidad: 40, precio: 10 },
      { desc: `${MARCA} flete`, cantidad: 1, precio: 120, trat: 'exempt' },
    ])
    f2.data
      ? PASS('una factura sobre varias recepciones, más una línea sin recepción')
      : FAIL('no se pudo crear la factura multi-recepción', f2.error?.message)

    const { count: facturasDeLaOC } = await s.from('supplier_invoice_lines')
      .select('*', { count: 'exact', head: true })
      .in('goods_receipt_line_id', [lineasR1[0].id, lineasR2[0].id])
    facturasDeLaOC >= 3
      ? PASS('varias facturas sobre la misma OC conviven', `${facturasDeLaOC} líneas enlazadas`)
      : FAIL('las líneas de factura no quedaron enlazadas')

    const { data: f2tot } = await c.from('supplier_invoices')
      .select('subtotal, tax_amount, total').eq('id', f2.data.id).single()
    // 5 + 400 al 21 % = 85,05 · 120 exento = 0
    cmp('el subtotal incluye el flete', 525, Number(f2tot.subtotal))
    cmp('y el IVA no lo grava, porque está exento', 85.05, Number(f2tot.tax_amount))

    const { error: eDupNum } = await c.from('supplier_invoices').insert({
      company_id: BT, supplier_id: p0.data.id, number: `${MARCA}-OTRO`,
      supplier_number: `${MARCA}-A-0001`, currency_code: 'USD', invoice_date: '2026-09-10',
    })
    eDupNum
      ? PASS('el mismo número del proveedor dos veces es rechazado', eDupNum.code ?? '')
      : FAIL('SE REPITIÓ EL NÚMERO DE FACTURA DEL PROVEEDOR')

    // ── Adjuntos, auditoría, depósito ──────────────────────────────────────
    seccion('10 · ADJUNTOS, AUDITORÍA Y DEPÓSITO')

    for (const tipo of ['purchase_order', 'goods_receipt', 'supplier_invoice']) {
      const { data: att, error } = await c.from('attachments').insert({
        company_id: BT, entity_type: tipo, entity_id: pc.id,
        storage_path: `${BT}/${tipo}/${MARCA}.pdf`, file_name: `${MARCA}.pdf`, kind: 'other',
      }).select('id').single()
      if (error) FAIL(`attachments acepta ${tipo}`, error.message)
      else { PASS(`attachments acepta ${tipo}`); await s.from('attachments').delete().eq('id', att.id) }
    }

    const { data: eventos } = await c.from('purchases_audit')
      .select('entity_type, action').eq('entity_id', r1.data.id)
    eventos?.length > 0
      ? PASS('la confirmación quedó auditada', eventos.map((x) => x.action).join(', '))
      : FAIL('no se auditó la confirmación')

    const { count: eventosPedido } = await s.from('purchases_audit')
      .select('*', { count: 'exact', head: true }).eq('entity_id', pc.id)
    eventosPedido > 0
      ? PASS('y el pedido también', `${eventosPedido} eventos`)
      : FAIL('el pedido no tiene eventos')

    const { count: sinRuido } = await s.from('purchases_audit')
      .select('*', { count: 'exact', head: true }).eq('action', 'update')
    cmp('no hay un trigger genérico llenando la auditoría de updates', 0, sinRuido)

    const { error: eDep } = await s.from('warehouses')
      .insert({ company_id: BT, code: `${MARCA}-DEP`, name: `${MARCA} segundo`, is_default: true })
    eDep ? PASS('no puede haber dos depósitos por defecto', eDep.code ?? '')
         : FAIL('SE CREÓ UN SEGUNDO DEPÓSITO POR DEFECTO')

    const { error: eSinDep } = await c.from('goods_receipts').insert({
      company_id: BT, supplier_id: p0.data.id, number: `${MARCA}-SIN-DEP`,
      receipt_date: '2026-09-10',
    })
    eSinDep ? PASS('una recepción sin depósito es rechazada', eSinDep.code ?? '')
            : FAIL('SE CREÓ UNA RECEPCIÓN SIN DEPÓSITO')
  } catch (e) {
    FAIL('la suite se cortó por una excepción', e.message)
    console.error(e)
  } finally {
    seccion('LIMPIEZA')
    const sc = admin()
    // También por prefijo, por si una corrida anterior murió a mitad.
    const { data: sobran } = await sc.from('suppliers').select('id').like('legal_name', `${MARCA}%`)
    for (const x of sobran ?? []) if (!creados.proveedores.includes(x.id)) creados.proveedores.push(x.id)

    if (creados.proveedores.length) {
      const { data: pedidos } = await sc.from('purchase_orders')
        .select('id').in('supplier_id', creados.proveedores)
      const ids = (pedidos ?? []).map((x) => x.id)
      const { data: recs } = await sc.from('goods_receipts')
        .select('id').in('supplier_id', creados.proveedores)
      const rids = (recs ?? []).map((x) => x.id)
      const { data: facs } = await sc.from('supplier_invoices')
        .select('id').in('supplier_id', creados.proveedores)

      if (rids.length) {
        await sc.from('stock_movements').delete().eq('source_type', 'goods_receipt').in('source_id', rids)
      }
      if (facs?.length) await sc.from('supplier_invoices').delete().in('id', facs.map((x) => x.id))
      if (rids.length) await sc.from('goods_receipts').delete().in('id', rids)
      if (ids.length) {
        await sc.from('attachments').delete().in('entity_id', ids)
        await sc.from('purchase_orders').delete().in('id', ids)
      }
      await sc.from('purchases_audit').delete().in('entity_id', [...ids, ...rids])
      await sc.from('suppliers').delete().in('id', creados.proveedores)
    }
    await sc.from('warehouses').delete().like('code', `${MARCA}%`)

    // El stock vuelve a como estaba. Sólo se tocan los saldos de los productos
    // que la suite movió: recalcular la tabla entera sería arreglar de más y
    // podría pisar un saldo legítimo.
    for (const p of prods ?? []) {
      const clave = p.id + '|' + dep.id
      const { data: movs } = await sc.from('stock_movements')
        .select('quantity').eq('product_id', p.id).eq('warehouse_id', dep.id)
      if (!balacesPrevios.has(clave)) {
        // La fila de saldo no existía antes de la suite: la creó el primer
        // movimiento de prueba y hay que sacarla, o queda un saldo en 0 que
        // desajusta el conteo de la reconciliación.
        await sc.from('stock_balances').delete()
          .eq('product_id', p.id).eq('warehouse_id', dep.id)
      } else {
        const total = (movs ?? []).reduce((a, m) => a + Number(m.quantity), 0)
        await sc.from('stock_balances').update({ on_hand: total })
          .eq('product_id', p.id).eq('warehouse_id', dep.id)
      }
    }

    for (const q of seqAntes ?? []) {
      await sc.from('document_sequences').update({ next_number: q.next_number })
        .eq('company_id', BT).eq('doc_type', q.doc_type)
    }

    const { count: movDespues } = await sc.from('stock_movements')
      .select('*', { count: 'exact', head: true })
    const { count: provDespues } = await sc.from('suppliers')
      .select('*', { count: 'exact', head: true })
    const { count: balDespues } = await sc.from('stock_balances')
      .select('*', { count: 'exact', head: true })
    cmp('los movimientos de stock vuelven a su número', movAntes, movDespues)
    cmp('y los saldos también', balacesPrevios.size, balDespues)
    cmp('no quedó ningún proveedor', 0, provDespues)
    console.log(`    series repuestas: ${(seqAntes ?? []).map((x) => x.doc_type + '=' + x.next_number).join(' · ')}`)

    console.log('\n' + '='.repeat(74))
    console.log(`  RESULTADO: ${fallos} fallo(s)`)
    console.log('='.repeat(74))
    process.exit(fallos === 0 ? 0 : 1)
  }
}

main().catch((e) => { console.error('✗', e.message); process.exit(1) })
