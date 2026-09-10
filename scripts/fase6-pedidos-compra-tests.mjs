/**
 * Fase 6 · Compras — entrega 3: los pedidos de compra, contra la base real.
 *
 * Prueba lo que la entrega 3 promete y, sobre todo, lo que NO puede quedar en
 * un botón deshabilitado: qué se edita en cada estado, qué transiciones
 * existen, que confirmar no mueve stock, y que la numeración aguanta veinte
 * altas simultáneas.
 *
 * Cada prohibición se prueba con un INTENTO REAL y se mira el EFECTO además
 * del código: con PostgREST una operación prohibida puede devolver «éxito»
 * con cero filas.
 *
 * Se limpia sola: todo lo que crea lleva el prefijo `ZZ-C3` y la limpieza
 * borra también por prefijo, por si una corrida muere a mitad.
 *
 *   set -a; source .env; source .env.migration; source .env.rls.txt; set +a
 *   node scripts/fase6-pedidos-compra-tests.mjs
 */
import crypto from 'node:crypto'
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

const MARCA = 'ZZ-C3'
const HOY = new Date().toISOString().slice(0, 10)
const creados = { pedidos: [], proveedores: [], adjuntos: [], objetos: [], recepciones: [] }

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
    .in('doc_type', ['purchase_order', 'supplier', 'goods_receipt'])
  const numeroSeq = (t) => seqAntes.find((x) => x.doc_type === t).next_number

  const { count: movAntes } = await s.from('stock_movements')
    .select('*', { count: 'exact', head: true })
  const { count: balAntes } = await s.from('stock_balances')
    .select('*', { count: 'exact', head: true })
  const { count: auditAntes } = await s.from('purchases_audit')
    .select('*', { count: 'exact', head: true })

  const { data: dep } = await s.from('warehouses')
    .select('id').eq('company_id', BT).eq('is_default', true).single()
  const { data: prods } = await s.from('products')
    .select('id, sku, name').eq('company_id', BT).order('sku').limit(3)

  console.log('='.repeat(74))
  console.log('  COMPRAS · entrega 3 — pedidos de compra')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(74))

  /** Un proveedor de prueba, con la referencia que da el servidor. */
  const nuevoProveedor = async (nombre, extra = {}) => {
    const { data: ref } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'supplier' })
    const { data } = await c.from('suppliers').insert({
      company_id: BT, legacy_ref: ref, legal_name: nombre, ...extra,
    }).select('id, payment_terms, default_currency').single()
    if (data) creados.proveedores.push(data.id)
    return data
  }

  /** Un pedido, con el número que da el servidor. Nunca MAX+1. */
  const nuevoPedido = async (cliente, empresa, proveedorId, extra = {}) => {
    const { data: numero, error: eN } = await cliente.rpc('next_document_number',
      { p_company: empresa, p_doc_type: 'purchase_order' })
    if (eN) return { error: eN }
    const { data, error } = await cliente.from('purchase_orders').insert({
      company_id: empresa, supplier_id: proveedorId, number: numero, series_code: 'PC',
      currency_code: 'USD', order_date: HOY, ...extra,
    }).select('id, number, status, receipt_status, subtotal, tax_amount, total, created_by').single()
    if (data) creados.pedidos.push(data.id)
    return { data, error, numero }
  }

  const agregarLinea = async (pedidoId, lineNo, l) => {
    const { data, error } = await c.from('purchase_order_lines').insert({
      company_id: BT, purchase_order_id: pedidoId, line_no: lineNo,
      line_type: 'product', quantity: 1, discount_pct: 0, tax_treatment: 'vat_21',
      ...l,
    }).select('id, line_total, tax_rate_snapshot').single()
    return { data, error }
  }

  const leerPedido = async (id) => {
    const { data } = await s.from('purchase_orders')
      .select('status, receipt_status, subtotal, tax_amount, total, expected_date, payment_terms, notes, updated_at')
      .eq('id', id).single()
    return data
  }

  try {
    // ── 1 · Alta ───────────────────────────────────────────────────────────
    seccion('1 · ALTA')

    const prov = await nuevoProveedor(`${MARCA} Proveedor`, {
      payment_terms: '30 DIAS F/F', default_currency: 'USD',
    })
    prov ? PASS('proveedor de prueba creado') : FAIL('no se pudo crear el proveedor')

    cmp('la serie de pedidos está donde la dejó la entrega 1', 2, numeroSeq('purchase_order'))

    const p1 = await nuevoPedido(c, BT, prov.id, { payment_terms: prov.payment_terms })
    p1.data ? PASS('alta de pedido', p1.data.number) : FAIL('no se pudo crear', p1.error?.message)
    cmp('nace en borrador', 'draft', p1.data?.status)
    cmp('y sin recibir', 'pending', p1.data?.receipt_status)
    cmp('el número lo asigna el servidor con formato PC00000', true,
      /^PC\d{5}$/.test(p1.data?.number ?? ''))
    cmp('created_by lo sella el servidor, no el navegador', true, p1.data?.created_by !== null)

    // La condición de pago es una COPIA, no una referencia.
    cmp('la condición de pago quedó guardada en el pedido', '30 DIAS F/F', p1.data
      ? (await leerPedido(p1.data.id)).payment_terms : null)
    await c.from('suppliers').update({ payment_terms: 'CONTADO' }).eq('id', prov.id)
    cmp('y si cambia la del proveedor, el pedido NO cambia', '30 DIAS F/F',
      (await leerPedido(p1.data.id)).payment_terms)

    // ── 2 · Obligatorios ───────────────────────────────────────────────────
    seccion('2 · PROVEEDOR Y MONEDA OBLIGATORIOS')

    const { data: nRef } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'purchase_order' })
    const { error: eSinProv } = await c.from('purchase_orders').insert({
      company_id: BT, number: nRef, currency_code: 'USD', order_date: HOY,
    })
    cmp('un pedido sin proveedor es rechazado', '23502', eSinProv?.code)

    const { data: nRef2 } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'purchase_order' })
    const { error: eSinMon } = await c.from('purchase_orders').insert({
      company_id: BT, number: nRef2, supplier_id: prov.id, order_date: HOY,
    })
    cmp('un pedido sin moneda es rechazado', '23502', eSinMon?.code)

    const { data: nRef3 } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'purchase_order' })
    const { error: eMonMala } = await c.from('purchase_orders').insert({
      company_id: BT, number: nRef3, supplier_id: prov.id, currency_code: 'BTC', order_date: HOY,
    })
    cmp('una moneda que no existe es rechazada', '23503', eMonMala?.code)

    // ── 3 · Líneas ─────────────────────────────────────────────────────────
    seccion('3 · LÍNEAS: CATÁLOGO, LIBRE Y CAPÍTULO')

    const lCat = await agregarLinea(p1.data.id, 1, {
      product_id: prods[0].id, sku_snapshot: prods[0].sku, name_snapshot: prods[0].name,
      quantity: 10, unit_price: 100,
    })
    lCat.data ? PASS('línea de producto del catálogo', prods[0].sku)
              : FAIL('no se pudo agregar', lCat.error?.message)

    const lLibre = await agregarLinea(p1.data.id, 2, {
      product_id: null, sku_snapshot: 'FLETE', name_snapshot: 'Flete internacional',
      quantity: 1, unit_price: 250, tax_treatment: 'exempt',
    })
    lLibre.data ? PASS('línea libre, sin producto del catálogo')
                : FAIL('no se pudo agregar la línea libre', lLibre.error?.message)

    const lCap = await agregarLinea(p1.data.id, 3, {
      line_type: 'chapter', name_snapshot: 'Accesorios', quantity: 1, unit_price: 0,
      tax_treatment: 'not_taxed',
    })
    cmp('un capítulo no suma', 0, Number(lCap.data?.line_total))

    // Cada línea tiene su propio uuid: la identidad no es la posición.
    const { data: lineas } = await s.from('purchase_order_lines')
      .select('id, line_no').eq('purchase_order_id', p1.data.id)
    cmp('cada línea tiene su propio id', 3, new Set((lineas ?? []).map((l) => l.id)).size)
    cmp('y su número de línea', '1,2,3',
      (lineas ?? []).map((l) => l.line_no).sort().join(','))

    // ── 4 · IVA y totales del servidor ─────────────────────────────────────
    seccion('4 · IVA Y TOTALES DEL SERVIDOR')

    cmp('la alícuota la deriva el servidor del tratamiento', 21,
      Number(lCat.data?.tax_rate_snapshot))
    cmp('un exento va en 0, no en 21', 0, Number(lLibre.data?.tax_rate_snapshot))
    cmp('el neto de la línea lo calcula la base', 1000, Number(lCat.data?.line_total))

    let pedido = await leerPedido(p1.data.id)
    cmp('subtotal del servidor', 1250, Number(pedido.subtotal))
    // 1000 × 21 % + 250 × 0 % — no un 21 % parejo sobre el subtotal.
    cmp('IVA por línea, con la alícuota de cada una', 210, Number(pedido.tax_amount))
    cmp('total', 1460, Number(pedido.total))

    // El bug del 1 % del legacy: la alícuota no se escribe a mano.
    const { data: nRef4 } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'purchase_order' })
    const pBug = await c.from('purchase_orders').insert({
      company_id: BT, supplier_id: prov.id, number: nRef4, currency_code: 'USD', order_date: HOY,
    }).select('id').single()
    creados.pedidos.push(pBug.data.id)
    const lBug = await agregarLinea(pBug.data.id, 1, {
      name_snapshot: `${MARCA} intento 1%`, quantity: 1, unit_price: 1000,
      tax_treatment: 'vat_21', tax_rate_snapshot: 1,
    })
    // El trigger sólo deriva cuando viene null: mandarla explícita es el
    // camino por el que el legacy metía el 1 %. Se comprueba qué pasa.
    const { data: pBugTot } = await s.from('purchase_orders')
      .select('tax_amount').eq('id', pBug.data.id).single()
    Number(pBugTot.tax_amount) === 210
      ? PASS('mandar la alícuota a mano no cambia nada: manda el tratamiento', '210')
      : FAIL('SE PUDO METER UNA ALÍCUOTA INVENTADA',
             `IVA quedó en ${pBugTot.tax_amount} con tax_rate_snapshot=${lBug.data?.tax_rate_snapshot}`)

    const { error: eTrat } = await agregarLinea(pBug.data.id, 2, {
      name_snapshot: 'x', quantity: 1, unit_price: 1, tax_treatment: 'iva_del_1_por_ciento',
    })
    cmp('un tratamiento inventado es rechazado', '23514', eTrat?.code)

    // La aplicación no escribe los totales.
    await c.from('purchase_orders').update({ total: 999999 }).eq('id', p1.data.id)
    cmp('la aplicación NO puede escribir el total', 1460,
      Number((await leerPedido(p1.data.id)).total))

    // ── 5 · ETA ────────────────────────────────────────────────────────────
    seccion('5 · ETA')

    cmp('un pedido puede no tener fecha estimada', null, pedido.expected_date)
    await c.from('purchase_orders').update({ expected_date: '2026-12-01' }).eq('id', p1.data.id)
    cmp('y se le puede poner una', '2026-12-01', (await leerPedido(p1.data.id)).expected_date)
    await c.from('purchase_orders').update({ expected_date: null }).eq('id', p1.data.id)
    cmp('y volver a sacársela: «no se sabe» es un dato', null,
      (await leerPedido(p1.data.id)).expected_date)
    await c.from('purchase_orders').update({ expected_date: '2026-12-01' }).eq('id', p1.data.id)

    // ── 6 · Estados ────────────────────────────────────────────────────────
    seccion('6 · ESTADOS Y TRANSICIONES')

    // receipt_status es derivado: la aplicación no lo escribe.
    await c.from('purchase_orders').update({ receipt_status: 'received' }).eq('id', p1.data.id)
    cmp('la aplicación NO puede escribir receipt_status', 'pending',
      (await leerPedido(p1.data.id)).receipt_status)

    // El número no se cambia en ningún estado.
    const { error: eNum } = await c.from('purchase_orders')
      .update({ number: 'PC99999' }).eq('id', p1.data.id)
    cmp('el número del pedido no se cambia', '23001', eNum?.code)

    // Confirmar.
    const { data: conf } = await c.from('purchase_orders')
      .update({ status: 'confirmed' }).eq('id', p1.data.id).eq('status', 'draft').select('id')
    cmp('confirmar un borrador', 1, (conf ?? []).length)
    cmp('y queda confirmado', 'confirmed', (await leerPedido(p1.data.id)).status)

    // Confirmado: la identidad se congela.
    const { error: eProv } = await c.from('purchase_orders')
      .update({ supplier_id: prov.id, currency_code: 'ARS' }).eq('id', p1.data.id)
    cmp('confirmado: no se cambia la moneda', '23001', eProv?.code)
    const { error: eFecha } = await c.from('purchase_orders')
      .update({ order_date: '2020-01-01' }).eq('id', p1.data.id)
    cmp('confirmado: no se cambia la fecha del pedido', '23001', eFecha?.code)

    // Pero la logística sí.
    const { error: eEta } = await c.from('purchase_orders')
      .update({ expected_date: '2027-01-15', notes: `${MARCA} demora del proveedor` })
      .eq('id', p1.data.id)
    eEta ? FAIL('confirmado: no se pudo ajustar la ETA', eEta.message)
         : cmp('confirmado: la ETA y las notas sí se ajustan', '2027-01-15',
               (await leerPedido(p1.data.id)).expected_date)

    // Reabrir no está previsto.
    const { error: eReabrir } = await c.from('purchase_orders')
      .update({ status: 'draft' }).eq('id', p1.data.id)
    cmp('un pedido confirmado no se reabre', '23001', eReabrir?.code)

    // ── 7 · Confirmar NO mueve stock ───────────────────────────────────────
    seccion('7 · CONFIRMAR NO MUEVE STOCK')

    const { count: movAhora } = await s.from('stock_movements')
      .select('*', { count: 'exact', head: true })
    cmp('después de confirmar, el stock no se movió', movAntes, movAhora)
    const { count: balAhora } = await s.from('stock_balances')
      .select('*', { count: 'exact', head: true })
    cmp('ni se creó ningún saldo', balAntes, balAhora)
    const { count: movDelPedido } = await s.from('stock_movements')
      .select('*', { count: 'exact', head: true })
      .eq('source_type', 'purchase_order')
    cmp('ningún movimiento tiene origen purchase_order', 0, movDelPedido)

    // ── 8 · Cancelar ───────────────────────────────────────────────────────
    seccion('8 · CANCELAR')

    const p2 = await nuevoPedido(c, BT, prov.id)
    await agregarLinea(p2.data.id, 1, {
      name_snapshot: `${MARCA} algo`, quantity: 5, unit_price: 10,
    })
    const { data: cancBorrador } = await c.from('purchase_orders')
      .update({ status: 'cancelled' }).eq('id', p2.data.id).select('id')
    cmp('un borrador se puede cancelar', 1, (cancBorrador ?? []).length)

    // Cancelado: congelado.
    const { error: eCong } = await c.from('purchase_orders')
      .update({ notes: 'algo' }).eq('id', p2.data.id)
    cmp('un pedido cancelado está congelado', '23001', eCong?.code)
    const { error: eCongL } = await c.from('purchase_order_lines')
      .update({ quantity: 99 }).eq('purchase_order_id', p2.data.id)
    cmp('y sus líneas tampoco se tocan', '23001', eCongL?.code)
    const { error: eCongIns } = await agregarLinea(p2.data.id, 2, {
      name_snapshot: 'nueva', quantity: 1, unit_price: 1,
    })
    cmp('ni se le agregan líneas nuevas', '23001', eCongIns?.code)

    // Confirmado sin recepción: se puede cancelar.
    const p3 = await nuevoPedido(c, BT, prov.id)
    await agregarLinea(p3.data.id, 1, {
      product_id: prods[1].id, sku_snapshot: prods[1].sku, name_snapshot: prods[1].name,
      quantity: 20, unit_price: 50,
    })
    await c.from('purchase_orders').update({ status: 'confirmed' }).eq('id', p3.data.id)
    const { data: cancConf } = await c.from('purchase_orders')
      .update({ status: 'cancelled' }).eq('id', p3.data.id).select('id')
    cmp('un confirmado SIN recepción se puede cancelar', 1, (cancConf ?? []).length)

    // ── 9 · Con recepción: congelado ───────────────────────────────────────
    seccion('9 · CON MERCADERÍA RECIBIDA')

    const p4 = await nuevoPedido(c, BT, prov.id)
    const l4 = await agregarLinea(p4.data.id, 1, {
      product_id: prods[2].id, sku_snapshot: prods[2].sku, name_snapshot: prods[2].name,
      quantity: 30, unit_price: 20,
    })
    await c.from('purchase_orders').update({ status: 'confirmed' }).eq('id', p4.data.id)

    const { data: nRec } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'goods_receipt' })
    const { data: rec } = await c.from('goods_receipts').insert({
      company_id: BT, supplier_id: prov.id, purchase_order_id: p4.data.id,
      warehouse_id: dep.id, number: nRec, receipt_date: HOY,
    }).select('id').single()
    creados.recepciones.push(rec.id)
    await c.from('goods_receipt_lines').insert({
      company_id: BT, goods_receipt_id: rec.id, purchase_order_line_id: l4.data.id,
      product_id: prods[2].id, quantity: 30,
    })
    const { error: eConfRec } = await c.rpc('confirmar_recepcion', { p_receipt: rec.id })
    eConfRec ? FAIL('no se pudo confirmar la recepción', eConfRec.message)
             : PASS('recepción confirmada: ahora sí entra el stock')

    cmp('el pedido pasa a recibido', 'received', (await leerPedido(p4.data.id)).receipt_status)

    const { error: eLineaCong } = await c.from('purchase_order_lines')
      .update({ quantity: 99 }).eq('id', l4.data.id)
    cmp('con mercadería recibida las líneas se congelan', '23001', eLineaCong?.code)
    const { data: cantidadReal } = await s.from('purchase_order_lines')
      .select('quantity').eq('id', l4.data.id).single()
    cmp('  y la cantidad no cambió', 30, Number(cantidadReal.quantity))

    const { error: eCancRec } = await c.from('purchase_orders')
      .update({ status: 'cancelled' }).eq('id', p4.data.id)
    cmp('y el pedido no se puede cancelar', '23001', eCancRec?.code)
    cmp('  y sigue confirmado', 'confirmed', (await leerPedido(p4.data.id)).status)

    // La logística sigue editable aunque haya recepción.
    const { error: eEtaRec } = await c.from('purchase_orders')
      .update({ expected_date: '2027-02-02' }).eq('id', p4.data.id)
    eEtaRec ? FAIL('con recepción no se pudo ajustar la ETA', eEtaRec.message)
            : PASS('pero la ETA se sigue pudiendo ajustar')

    // ── 10 · Duplicar ──────────────────────────────────────────────────────
    seccion('10 · DUPLICAR')

    const { data: dupId, error: eDup } = await c.rpc('duplicar_pedido_compra',
      { p_order: p4.data.id })
    if (eDup) FAIL('no se pudo duplicar', eDup.message)
    else {
      creados.pedidos.push(dupId)
      const { data: dup } = await s.from('purchase_orders')
        .select('id, number, status, receipt_status, supplier_id, currency_code, subtotal, total')
        .eq('id', dupId).single()
      cmp('el duplicado tiene uuid nuevo', true, dup.id !== p4.data.id)
      cmp('número nuevo', true, dup.number !== p4.data.number)
      cmp('nace en borrador', 'draft', dup.status)
      cmp('y sin recibir', 'pending', dup.receipt_status)
      cmp('conserva el proveedor', p4.data ? prov.id : null, dup.supplier_id)
      cmp('y la moneda', 'USD', dup.currency_code)
      cmp('copia las líneas: subtotal', 600, Number(dup.subtotal))
      cmp('  y el total, con su IVA', 726, Number(dup.total))

      const { count: recDup } = await s.from('goods_receipts')
        .select('*', { count: 'exact', head: true }).eq('purchase_order_id', dupId)
      cmp('NO copia las recepciones', 0, recDup)

      const { data: audDup } = await s.from('purchases_audit')
        .select('action').eq('entity_id', dupId)
      cmp('NO copia la auditoría del original: sólo su propia alta', 'create',
        (audDup ?? []).map((a) => a.action).join(','))
    }

    // ── 11 · Auditoría ─────────────────────────────────────────────────────
    seccion('11 · AUDITORÍA')

    const { data: audP1 } = await s.from('purchases_audit')
      .select('action, from_status, to_status, diff')
      .eq('entity_id', p1.data.id).order('id')
    const acciones = (audP1 ?? []).map((a) => a.action)
    cmp('el alta se audita', true, acciones[0] === 'create')
    cmp('la confirmación se audita como confirm', true, acciones.includes('confirm'))
    const upd = (audP1 ?? []).find((a) => a.action === 'update')
    upd ? PASS('un cambio después de confirmar queda auditado con su diff',
               Object.keys(upd.diff ?? {}).join(', '))
        : FAIL('no se auditó el cambio posterior a la confirmación')

    const { data: audP2 } = await s.from('purchases_audit')
      .select('action').eq('entity_id', p2.data.id).order('id')
    cmp('cancelar se audita como cancel', 'create,cancel',
      (audP2 ?? []).map((a) => a.action).join(','))

    // Editar un BORRADOR no deja rastro: todavía no salió de la empresa.
    const p5 = await nuevoPedido(c, BT, prov.id)
    await c.from('purchase_orders').update({ notes: `${MARCA} nota 1` }).eq('id', p5.data.id)
    await c.from('purchase_orders').update({ notes: `${MARCA} nota 2` }).eq('id', p5.data.id)
    await agregarLinea(p5.data.id, 1, { name_snapshot: 'x', quantity: 1, unit_price: 1 })
    const { data: audP5 } = await s.from('purchases_audit')
      .select('action').eq('entity_id', p5.data.id)
    cmp('editar un borrador NO llena la auditoría de ruido', 'create',
      (audP5 ?? []).map((a) => a.action).join(','))

    // ── 12 · Concurrencia ──────────────────────────────────────────────────
    seccion('12 · CONCURRENCIA')

    const N = 20
    const conReintento = async (fn) => {
      for (let i = 0; i < 5; i += 1) {
        const r = await fn()
        if (!r.error) return r
        if (!String(r.error.message ?? '').includes('fetch failed')) return r
        await new Promise((z) => setTimeout(z, 200 * (i + 1)))
      }
      return { error: { message: 'fetch failed tras 5 intentos' } }
    }

    const altas = await Promise.all(
      Array.from({ length: N }, () =>
        conReintento(() => nuevoPedido(c, BT, prov.id, { notes: `${MARCA} concurrente` }))),
    )
    const conError = altas.filter((a) => a.error)
    cmp(`${N} altas simultáneas sin error`, 0, conError.length)
    const numeros = altas.filter((a) => a.data).map((a) => a.data.number)
    cmp('todos los números distintos', N, new Set(numeros).size)
    const enteros = numeros.map((n) => Number(n.slice(2))).sort((a, b) => a - b)
    const sinHuecos = enteros.every((v, i) => i === 0 || v === enteros[i - 1] + 1)
    cmp('sin huecos por carrera', true, sinHuecos)
    if (enteros.length > 0) {
      console.log(`          rango ${enteros[0]}…${enteros[enteros.length - 1]}`)
    }

    // Dos confirmaciones simultáneas: una sola transición real.
    const pConc = await nuevoPedido(c, BT, prov.id)
    await agregarLinea(pConc.data.id, 1, { name_snapshot: 'x', quantity: 1, unit_price: 100 })
    const dos = await Promise.all([
      c.from('purchase_orders').update({ status: 'confirmed' })
        .eq('id', pConc.data.id).eq('status', 'draft').select('id'),
      c.from('purchase_orders').update({ status: 'confirmed' })
        .eq('id', pConc.data.id).eq('status', 'draft').select('id'),
    ])
    const ganadoras = dos.filter((r) => (r.data ?? []).length > 0).length
    cmp('dos confirmaciones simultáneas: una sola escribe', 1, ganadoras)
    cmp('y el pedido quedó confirmado una vez', 'confirmed',
      (await leerPedido(pConc.data.id)).status)
    const { count: confirms } = await s.from('purchases_audit')
      .select('*', { count: 'exact', head: true })
      .eq('entity_id', pConc.data.id).eq('action', 'confirm')
    cmp('  y hay un solo evento de confirmación', 1, confirms)

    // ── 13 · RLS ───────────────────────────────────────────────────────────
    seccion('13 · RLS POR ROL')

    for (const [rol, email] of [
      ['customer', 'cliente.test@buscatools.com.ar'],
      ['distributor', 'distribuidor.test@buscatools.com.ar'],
    ]) {
      const ext = sesion()
      const { error } = await ext.auth.signInWithPassword({ email, password: process.env.BT_PW_TEST })
      if (error) { FAIL(`${rol}: no se pudo iniciar sesión`, error.message); continue }
      const { data: lista } = await ext.from('purchase_orders').select('id')
      cmp(`${rol}: no ve ningún pedido`, 0, (lista ?? []).length)
      const { data: porId } = await ext.from('purchase_orders').select('id').eq('id', p1.data.id)
      cmp(`${rol}: tampoco por id exacto`, 0, (porId ?? []).length)
      const { data: porNum } = await ext.from('purchase_orders')
        .select('id').eq('number', p1.data.number)
      cmp(`${rol}: tampoco por número`, 0, (porNum ?? []).length)
      const { data: porProv } = await ext.from('purchase_orders')
        .select('id').eq('supplier_id', prov.id)
      cmp(`${rol}: tampoco por proveedor`, 0, (porProv ?? []).length)
      const { data: lineasExt } = await ext.from('purchase_order_lines').select('id')
      cmp(`${rol}: ni las líneas`, 0, (lineasExt ?? []).length)
      const { error: eIns } = await ext.from('purchase_orders').insert({
        company_id: BT, supplier_id: prov.id, number: `${MARCA}-x`,
        currency_code: 'USD', order_date: HOY,
      })
      eIns ? PASS(`${rol}: no puede crear`, eIns.code ?? '')
           : FAIL(`${rol.toUpperCase()} CREÓ UN PEDIDO`)
    }

    const anon = sesion()
    const { data: nadaAnon } = await anon.from('purchase_orders').select('id')
    cmp('anónimo: no ve nada', 0, (nadaAnon ?? []).length)
    const { data: anonId } = await anon.from('purchase_orders').select('id').eq('id', p1.data.id)
    cmp('anónimo: tampoco por id exacto', 0, (anonId ?? []).length)

    // Jano es salesperson en Torquetools.
    const { data: provTT } = await s.from('suppliers').insert({
      company_id: TT, legal_name: `${MARCA} Proveedor TT`,
    }).select('id').single()
    creados.proveedores.push(provTT.id)
    const { data: pTT } = await s.from('purchase_orders').insert({
      company_id: TT, supplier_id: provTT.id, number: 'PC00001', series_code: 'PC',
      currency_code: 'USD', order_date: HOY,
    }).select('id').single()
    creados.pedidos.push(pTT.id)
    const { data: veTT } = await c.from('purchase_orders').select('id').eq('id', pTT.id)
    cmp('salesperson: no ve los pedidos de su propia empresa', 0, (veTT ?? []).length)
    const { data: listaTT } = await c.from('purchase_orders').select('id').eq('company_id', TT)
    cmp('salesperson: el listado de su empresa le vuelve vacío', 0, (listaTT ?? []).length)
    const eIntentoTT = await nuevoPedido(c, TT, provTT.id)
    eIntentoTT.error ? PASS('salesperson: no puede crear', eIntentoTT.error.code ?? '')
                     : FAIL('EL SALESPERSON CREÓ UN PEDIDO')

    // ── 14 · Adjuntos ──────────────────────────────────────────────────────
    seccion('14 · ADJUNTOS')

    const contenido = new Blob(['OC enviada al proveedor'], { type: 'text/plain' })
    const ruta = `${BT}/purchase_order/${p1.data.id}/${crypto.randomUUID()}-zz-c3.txt`
    const { error: eSub } = await c.storage.from('ventas').upload(ruta, contenido, {
      contentType: 'text/plain', upsert: false,
    })
    if (eSub) FAIL('no se pudo subir el archivo', eSub.message)
    else {
      creados.objetos.push(ruta)
      PASS('el archivo entra al bucket privado que ya existía')
      const { data: adj, error: eAdj } = await c.from('attachments').insert({
        company_id: BT, entity_type: 'purchase_order', entity_id: p1.data.id,
        storage_path: ruta, file_name: 'zz-c3.txt', mime_type: 'text/plain',
        bytes: 23, kind: 'quote_pdf',
      }).select('id').single()
      if (eAdj) FAIL('no se pudo registrar el adjunto', eAdj.message)
      else {
        creados.adjuntos.push(adj.id)
        PASS('y se registra con entity_type purchase_order')
        const { data: firmada } = await c.storage.from('ventas').createSignedUrl(ruta, 60)
        firmada?.signedUrl ? PASS('la descarga usa una URL firmada')
                           : FAIL('no se pudo firmar la URL')

        const ext = sesion()
        await ext.auth.signInWithPassword({
          email: 'cliente.test@buscatools.com.ar', password: process.env.BT_PW_TEST,
        })
        const { data: veAdj } = await ext.from('attachments').select('id')
          .eq('entity_type', 'purchase_order')
        cmp('un externo no ve los adjuntos del pedido', 0, (veAdj ?? []).length)
      }
    }
  } catch (e) {
    FAIL('excepción', e.message)
    console.error(e)
  } finally {
    // ── Limpieza ───────────────────────────────────────────────────────────
    seccion('LIMPIEZA')

    for (const id of creados.adjuntos) await s.from('attachments').delete().eq('id', id)
    await s.from('attachments').delete().like('file_name', 'zz-c3%')
    if (creados.objetos.length > 0) await s.storage.from('ventas').remove(creados.objetos)

    // El stock que movió la recepción vuelve atrás: primero los movimientos,
    // después los saldos que la corrida creó de cero.
    for (const id of creados.recepciones) {
      await s.from('stock_movements').delete().eq('source_type', 'goods_receipt').eq('source_id', id)
      await s.from('goods_receipt_lines').delete().eq('goods_receipt_id', id)
      await s.from('goods_receipts').delete().eq('id', id)
    }
    // Los saldos se recalculan desde los movimientos que quedaron.
    const { data: saldos } = await s.from('stock_balances').select('product_id, warehouse_id, on_hand')
    for (const b of saldos ?? []) {
      const { data: movs } = await s.from('stock_movements')
        .select('quantity').eq('product_id', b.product_id).eq('warehouse_id', b.warehouse_id)
      const total = (movs ?? []).reduce((a, m) => a + Number(m.quantity), 0)
      if (Number(b.on_hand) !== total) {
        if ((movs ?? []).length === 0) {
          await s.from('stock_balances').delete()
            .eq('product_id', b.product_id).eq('warehouse_id', b.warehouse_id)
        } else {
          await s.from('stock_balances').update({ on_hand: total })
            .eq('product_id', b.product_id).eq('warehouse_id', b.warehouse_id)
        }
      }
    }

    // Las líneas primero: el trigger de congelado mira el estado del pedido,
    // y borrar el pedido en cascada lo evita, pero ser explícito es más claro.
    for (const id of creados.pedidos) {
      await s.from('purchase_order_lines').delete().eq('purchase_order_id', id)
      await s.from('purchase_orders').delete().eq('id', id)
    }
    await s.from('purchase_orders').delete().like('notes', `${MARCA}%`)
    for (const id of creados.proveedores) {
      await s.from('suppliers').delete().eq('id', id)
    }
    await s.from('suppliers').delete().like('legal_name', `${MARCA}%`)

    // La auditoría, AL FINAL y no antes. Borrar una línea de un pedido
    // confirmado dispara `trg_pol_auditar`, que escribe un evento nuevo: si se
    // limpiara primero, esos eventos quedarían apuntando a un pedido que ya no
    // existe. Es el bug que dejó doce filas huérfanas en la primera corrida.
    const entidades = [...creados.pedidos, ...creados.proveedores, ...creados.recepciones]
    if (entidades.length > 0) {
      await s.from('purchases_audit').delete().in('entity_id', entidades)
    }

    for (const q of seqAntes ?? []) {
      await s.from('document_sequences').update({ next_number: q.next_number })
        .eq('company_id', BT).eq('doc_type', q.doc_type)
    }

    const { count: movFin } = await s.from('stock_movements')
      .select('*', { count: 'exact', head: true })
    const { count: balFin } = await s.from('stock_balances')
      .select('*', { count: 'exact', head: true })
    const { count: pedFin } = await s.from('purchase_orders')
      .select('*', { count: 'exact', head: true })
    const { count: provFin } = await s.from('suppliers')
      .select('*', { count: 'exact', head: true })
    const { count: audFin } = await s.from('purchases_audit')
      .select('*', { count: 'exact', head: true })

    cmp('los movimientos de stock vuelven a su número', movAntes, movFin)
    cmp('y los saldos también', balAntes, balFin)
    cmp('no queda ningún pedido', 0, pedFin)
    cmp('los proveedores vuelven a los 142 migrados', 142, provFin)
    cmp('la auditoría vuelve a su número', auditAntes, audFin)
    console.log(`    series repuestas: ${(seqAntes ?? []).map((x) => x.doc_type + '=' + x.next_number).join(' · ')}`)
  }

  console.log('\n' + '='.repeat(74))
  console.log(`  RESULTADO: ${fallos} fallo(s)`)
  console.log('='.repeat(74))
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch((e) => { console.error('\n✗', e); process.exit(1) })
