/**
 * Fase 6 · Compras — entrega 4: recepciones y stock, contra la base real.
 *
 * Lo que se prueba acá no es la pantalla: es que la BASE haga lo que hay que
 * hacer aunque la escritura venga de otro lado. Parciales, sobre-recepción,
 * idempotencia, dos recepciones peleando por la misma línea, atomicidad
 * multilínea y congelado de lo confirmado.
 *
 * Cada prohibición se prueba con un INTENTO REAL y se mira el EFECTO además
 * del código: con PostgREST una operación prohibida puede devolver «éxito»
 * con cero filas.
 *
 * Se limpia sola: prefijo `ZZ-C4`. Una recepción confirmada no se borra desde
 * la aplicación; la limpieza usa la clave de servicio, que es la única salida
 * y existe justamente para esto.
 *
 *   set -a; source .env; source .env.migration; source .env.rls.txt; set +a
 *   node scripts/fase6-recepciones-tests.mjs
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

const MARCA = 'ZZ-C4'
const HOY = new Date().toISOString().slice(0, 10)
const creados = { pedidos: [], proveedores: [], recepciones: [], depositos: [] }

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

  const { count: movAntes } = await s.from('stock_movements')
    .select('*', { count: 'exact', head: true })
  const { data: balAntes } = await s.from('stock_balances')
    .select('product_id, warehouse_id, on_hand')
  const saldosPrevios = new Map(
    (balAntes ?? []).map((b) => [b.product_id + '|' + b.warehouse_id, Number(b.on_hand)]))
  const { count: auditAntes } = await s.from('purchases_audit')
    .select('*', { count: 'exact', head: true })

  const { data: dep } = await s.from('warehouses')
    .select('id, name').eq('company_id', BT).eq('is_default', true).single()
  const { data: prods } = await s.from('products')
    .select('id, sku, name').eq('company_id', BT).order('sku').limit(4)

  const saldo = async (productId, warehouseId = dep.id) => {
    const { data } = await s.from('stock_balances').select('on_hand')
      .eq('product_id', productId).eq('warehouse_id', warehouseId).maybeSingle()
    return data ? Number(data.on_hand) : 0
  }

  console.log('='.repeat(74))
  console.log('  COMPRAS · entrega 4 — recepciones y stock')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(74))

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
  const pedidoConfirmado = async (proveedorId, lineas) => {
    const { data: numero } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'purchase_order' })
    const { data: po } = await c.from('purchase_orders').insert({
      company_id: BT, supplier_id: proveedorId, number: numero, series_code: 'PC',
      currency_code: 'USD', order_date: HOY, notes: `${MARCA} pedido`,
    }).select('id, number').single()
    creados.pedidos.push(po.id)

    const ids = []
    for (let i = 0; i < lineas.length; i += 1) {
      const l = lineas[i]
      const { data, error } = await c.from('purchase_order_lines').insert({
        company_id: BT, purchase_order_id: po.id, line_no: i + 1, line_type: 'product',
        product_id: l.productId ?? null,
        sku_snapshot: l.sku ?? 'LIBRE', name_snapshot: l.nombre ?? 'Línea libre',
        quantity: l.cantidad, unit_price: 10, discount_pct: 0, tax_treatment: 'vat_21',
      }).select('id').single()
      if (error) { FAIL('no se pudo crear la línea del pedido', error.message); return null }
      ids.push(data.id)
    }
    await c.from('purchase_orders').update({ status: 'confirmed' }).eq('id', po.id)
    return { ...po, lineas: ids }
  }

  /** Una recepción en borrador. */
  const nuevaRecepcion = async (cliente, po, proveedorId, cantidades, extra = {}) => {
    const { data: numero, error: eN } = await cliente.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'goods_receipt' })
    if (eN) return { error: eN }
    const { data, error } = await cliente.from('goods_receipts').insert({
      company_id: BT, supplier_id: proveedorId, purchase_order_id: po?.id ?? null,
      warehouse_id: dep.id, number: numero, series_code: 'NEP', receipt_date: HOY,
      notes: `${MARCA} recepción`, ...extra,
    }).select('id, number, status').single()
    if (error) return { error }
    creados.recepciones.push(data.id)

    for (const q of cantidades) {
      const { error: eLin } = await cliente.from('goods_receipt_lines').insert({
        company_id: BT, goods_receipt_id: data.id,
        purchase_order_line_id: q.lineaId, product_id: q.productId ?? null,
        sku_snapshot: q.sku ?? null, name_snapshot: q.nombre ?? null, quantity: q.cantidad,
      })
      if (eLin) return { data, error: eLin }
    }
    return { data }
  }

  const estadoPedido = async (id) => {
    const { data } = await s.from('purchase_orders').select('receipt_status').eq('id', id).single()
    return data.receipt_status
  }

  try {
    const prov = await nuevoProveedor(`${MARCA} Proveedor`)

    // ── 1 · Parciales: 100 → 30 → 40 → 30 ──────────────────────────────────
    seccion('1 · PARCIALES: 100 → 30 → 40 → 30')

    const po1 = await pedidoConfirmado(prov.id, [
      { productId: prods[0].id, sku: prods[0].sku, nombre: prods[0].name, cantidad: 100 },
    ])
    const stockInicial = await saldo(prods[0].id)
    cmp('el pedido arranca sin recibir', 'pending', await estadoPedido(po1.id))

    const paso = async (cantidad, esperado) => {
      const r = await nuevaRecepcion(c, po1, prov.id, [{
        lineaId: po1.lineas[0], productId: prods[0].id,
        sku: prods[0].sku, nombre: prods[0].name, cantidad,
      }])
      if (r.error) { FAIL(`no se pudo crear la recepción de ${cantidad}`, r.error.message); return null }
      const { data: conf, error } = await c.rpc('confirmar_recepcion', { p_receipt: r.data.id })
      if (error) { FAIL(`no se pudo confirmar la recepción de ${cantidad}`, error.message); return null }
      cmp(`recibe ${cantidad}: el pedido queda ${esperado}`, esperado, await estadoPedido(po1.id))
      return conf
    }

    await paso(30, 'partially_received')
    const { data: pend1 } = await c.rpc('pendiente_de_pedido', { p_order: po1.id })
    cmp('  y quedan 70 pendientes', 70, Number(pend1[0].pendiente))

    await paso(40, 'partially_received')
    const { data: pend2 } = await c.rpc('pendiente_de_pedido', { p_order: po1.id })
    cmp('  y quedan 30 pendientes', 30, Number(pend2[0].pendiente))

    await paso(30, 'received')
    const { data: pend3 } = await c.rpc('pendiente_de_pedido', { p_order: po1.id })
    cmp('  y no queda nada pendiente', 0, Number(pend3[0].pendiente))

    cmp('el stock subió exactamente 100', stockInicial + 100, await saldo(prods[0].id))
    const { count: movs1 } = await s.from('stock_movements')
      .select('*', { count: 'exact', head: true })
      .eq('product_id', prods[0].id).eq('movement_type', 'purchase_receipt')
      .in('source_id', creados.recepciones)
    cmp('con tres movimientos, uno por recepción', 3, movs1)

    // ── 2 · Sobre-recepción ────────────────────────────────────────────────
    seccion('2 · SOBRE-RECEPCIÓN')

    const po2 = await pedidoConfirmado(prov.id, [
      { productId: prods[1].id, sku: prods[1].sku, nombre: prods[1].name, cantidad: 30 },
    ])
    const stock2 = await saldo(prods[1].id)

    const rSobre = await nuevaRecepcion(c, po2, prov.id, [{
      lineaId: po2.lineas[0], productId: prods[1].id,
      sku: prods[1].sku, nombre: prods[1].name, cantidad: 31,
    }])
    const { error: eSobre } = await c.rpc('confirmar_recepcion', { p_receipt: rSobre.data.id })
    eSobre ? PASS('recibir 31 sobre 30 es rechazado', String(eSobre.message).slice(0, 60))
           : FAIL('SE ACEPTÓ UNA SOBRE-RECEPCIÓN')
    const { data: sigueBorrador } = await s.from('goods_receipts')
      .select('status').eq('id', rSobre.data.id).single()
    cmp('  la recepción sigue en borrador', 'draft', sigueBorrador.status)
    cmp('  y no se recortó a 30 en silencio', 31, Number(
      (await s.from('goods_receipt_lines').select('quantity')
        .eq('goods_receipt_id', rSobre.data.id).single()).data.quantity))
    cmp('  el stock no se movió', stock2, await saldo(prods[1].id))

    // ── 3 · El borrador no mueve stock ─────────────────────────────────────
    seccion('3 · UN BORRADOR NO MUEVE STOCK')

    const po3 = await pedidoConfirmado(prov.id, [
      { productId: prods[2].id, sku: prods[2].sku, nombre: prods[2].name, cantidad: 50 },
    ])
    const stock3 = await saldo(prods[2].id)
    const rDraft = await nuevaRecepcion(c, po3, prov.id, [{
      lineaId: po3.lineas[0], productId: prods[2].id,
      sku: prods[2].sku, nombre: prods[2].name, cantidad: 20,
    }])
    cmp('la recepción nace en borrador', 'draft', rDraft.data.status)
    cmp('y el stock no se movió', stock3, await saldo(prods[2].id))
    const { count: movDraft } = await s.from('stock_movements')
      .select('*', { count: 'exact', head: true }).eq('source_id', rDraft.data.id)
    cmp('ni se creó ningún movimiento', 0, movDraft)
    cmp('el pedido sigue sin recibir', 'pending', await estadoPedido(po3.id))

    // Los borradores NO reservan: lo pendiente sigue siendo todo.
    const { data: pendDraft } = await c.rpc('pendiente_de_pedido', { p_order: po3.id })
    cmp('un borrador NO reserva: lo pendiente sigue en 50', 50, Number(pendDraft[0].pendiente))
    cmp('  pero se informa cuánto hay anotado en borradores', 20,
      Number(pendDraft[0].en_borrador))
    cmp('  y en cuáles', rDraft.data.number, (pendDraft[0].borradores ?? []).join(','))

    // ── 4 · Idempotencia ───────────────────────────────────────────────────
    seccion('4 · IDEMPOTENCIA')

    const dos = await Promise.all([
      c.rpc('confirmar_recepcion', { p_receipt: rDraft.data.id }),
      c.rpc('confirmar_recepcion', { p_receipt: rDraft.data.id }),
    ])
    cmp('dos confirmaciones simultáneas responden bien', 2, dos.filter((r) => !r.error).length)
    cmp('el stock subió UNA sola vez', stock3 + 20, await saldo(prods[2].id))
    const { count: movIdem } = await s.from('stock_movements')
      .select('*', { count: 'exact', head: true }).eq('source_id', rDraft.data.id)
    cmp('y hay UN solo movimiento', 1, movIdem)

    const { data: tercera } = await c.rpc('confirmar_recepcion', { p_receipt: rDraft.data.id })
    cmp('una tercera avisa que ya estaba', true, tercera.ya_estaba)
    cmp('  y el stock sigue igual', stock3 + 20, await saldo(prods[2].id))

    // ── 5 · Dos recepciones distintas sobre la misma línea ─────────────────
    seccion('5 · DOS RECEPCIONES SOBRE LA MISMA LÍNEA')

    const po5 = await pedidoConfirmado(prov.id, [
      { productId: prods[3].id, sku: prods[3].sku, nombre: prods[3].name, cantidad: 30 },
    ])
    const stock5 = await saldo(prods[3].id)
    const rA = await nuevaRecepcion(c, po5, prov.id, [{
      lineaId: po5.lineas[0], productId: prods[3].id,
      sku: prods[3].sku, nombre: prods[3].name, cantidad: 20,
    }])
    const rB = await nuevaRecepcion(c, po5, prov.id, [{
      lineaId: po5.lineas[0], productId: prods[3].id,
      sku: prods[3].sku, nombre: prods[3].name, cantidad: 20,
    }])

    const carrera = await Promise.all([
      c.rpc('confirmar_recepcion', { p_receipt: rA.data.id }),
      c.rpc('confirmar_recepcion', { p_receipt: rB.data.id }),
    ])
    const ok = carrera.filter((r) => !r.error).length
    const mal = carrera.filter((r) => r.error).length
    cmp('20 + 20 sobre 30: una entra y la otra falla', '1/1', `${ok}/${mal}`)
    cmp('  el stock subió 20, no 40', stock5 + 20, await saldo(prods[3].id))
    cmp('  y el pedido quedó parcial', 'partially_received', await estadoPedido(po5.id))
    const { data: confirmadas } = await s.from('goods_receipts')
      .select('status').in('id', [rA.data.id, rB.data.id])
    cmp('  hay una sola recepción confirmada', 1,
      (confirmadas ?? []).filter((x) => x.status === 'confirmed').length)

    // ── 6 · Atomicidad multilínea ──────────────────────────────────────────
    seccion('6 · ATOMICIDAD MULTILÍNEA')

    const po6 = await pedidoConfirmado(prov.id, [
      { productId: prods[0].id, sku: prods[0].sku, nombre: prods[0].name, cantidad: 10 },
      { productId: prods[1].id, sku: prods[1].sku, nombre: prods[1].name, cantidad: 10 },
    ])
    const stockA6 = await saldo(prods[0].id)
    const stockB6 = await saldo(prods[1].id)

    const r6 = await nuevaRecepcion(c, po6, prov.id, [
      { lineaId: po6.lineas[0], productId: prods[0].id, sku: prods[0].sku, nombre: prods[0].name, cantidad: 10 },
      { lineaId: po6.lineas[1], productId: prods[1].id, sku: prods[1].sku, nombre: prods[1].name, cantidad: 11 },
    ])
    const { error: e6 } = await c.rpc('confirmar_recepcion', { p_receipt: r6.data.id })
    e6 ? PASS('la línea B inválida hace fallar todo', String(e6.message).slice(0, 60))
       : FAIL('SE CONFIRMÓ UNA RECEPCIÓN CON UNA LÍNEA INVÁLIDA')
    cmp('  la línea A tampoco entró', stockA6, await saldo(prods[0].id))
    cmp('  ni la B', stockB6, await saldo(prods[1].id))
    const { count: mov6 } = await s.from('stock_movements')
      .select('*', { count: 'exact', head: true }).eq('source_id', r6.data.id)
    cmp('  0 movimientos', 0, mov6)
    const { data: est6 } = await s.from('goods_receipts').select('status').eq('id', r6.data.id).single()
    cmp('  y la recepción no quedó confirmada', 'draft', est6.status)

    // ── 7 · Línea libre: se recibe, no mueve stock ─────────────────────────
    seccion('7 · LÍNEA LIBRE')

    const po7 = await pedidoConfirmado(prov.id, [
      { productId: prods[2].id, sku: prods[2].sku, nombre: prods[2].name, cantidad: 5 },
      { productId: null, sku: 'FLETE', nombre: 'Flete internacional', cantidad: 1 },
    ])
    const stock7 = await saldo(prods[2].id)
    const r7 = await nuevaRecepcion(c, po7, prov.id, [
      { lineaId: po7.lineas[0], productId: prods[2].id, sku: prods[2].sku, nombre: prods[2].name, cantidad: 5 },
      { lineaId: po7.lineas[1], productId: null, sku: 'FLETE', nombre: 'Flete internacional', cantidad: 1 },
    ])
    r7.error ? FAIL('no se pudo cargar una línea libre en la recepción', r7.error.message)
             : PASS('una línea libre se puede recibir documentalmente')
    const { data: conf7, error: eConf7 } = await c.rpc('confirmar_recepcion', { p_receipt: r7.data.id })
    eConf7 ? FAIL('no se pudo confirmar', eConf7.message)
           : cmp('y genera UN movimiento, el del producto', 1, conf7.movimientos)
    cmp('  el stock del producto subió 5', stock7 + 5, await saldo(prods[2].id))
    cmp('  y el pedido llega a recibido igual', 'received', await estadoPedido(po7.id))

    // ── 8 · Depósito ───────────────────────────────────────────────────────
    seccion('8 · DEPÓSITO')

    const { data: nDep } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'goods_receipt' })
    const { error: eSinDep } = await c.from('goods_receipts').insert({
      company_id: BT, supplier_id: prov.id, number: nDep, receipt_date: HOY,
    })
    cmp('una recepción sin depósito es rechazada', '23502', eSinDep?.code)

    // El depósito de OTRA empresa: no se puede recibir ahí.
    const { data: depTT } = await s.from('warehouses').insert({
      company_id: TT, code: `${MARCA}-TT`, name: `${MARCA} depósito de Torquetools`,
    }).select('id').single()
    creados.depositos.push(depTT.id)
    const rAjeno = await nuevaRecepcion(c, po3, prov.id, [], { warehouse_id: depTT.id })
    rAjeno.error ? PASS('el depósito de otra empresa es rechazado',
                        String(rAjeno.error.message).slice(0, 50))
                 : FAIL('SE RECIBIÓ EN EL DEPÓSITO DE OTRA EMPRESA')

    // ── 9 · Confirmada = congelada ─────────────────────────────────────────
    seccion('9 · UNA RECEPCIÓN CONFIRMADA ESTÁ CONGELADA')

    const confirmada = r7.data.id
    const { error: eEdit } = await c.from('goods_receipts')
      .update({ notes: 'cambio' }).eq('id', confirmada)
    cmp('no se edita', '23001', eEdit?.code)

    const { error: eVolver } = await c.from('goods_receipts')
      .update({ status: 'draft' }).eq('id', confirmada)
    cmp('no vuelve a borrador', '23001', eVolver?.code)

    await c.from('goods_receipts').delete().eq('id', confirmada)
    const { data: sobrevive } = await s.from('goods_receipts')
      .select('id').eq('id', confirmada).maybeSingle()
    sobrevive ? PASS('y no se borra desde la aplicación')
              : FAIL('SE BORRÓ UNA RECEPCIÓN CONFIRMADA')

    const { error: eLinea } = await c.from('goods_receipt_lines')
      .update({ quantity: 99 }).eq('goods_receipt_id', confirmada)
    cmp('sus líneas tampoco se tocan', '23001', eLinea?.code)

    // Un borrador sí se borra.
    const rBorrable = await nuevaRecepcion(c, po3, prov.id, [{
      lineaId: po3.lineas[0], productId: prods[2].id,
      sku: prods[2].sku, nombre: prods[2].name, cantidad: 1,
    }])
    await c.from('goods_receipts').delete().eq('id', rBorrable.data.id)
    const { data: seFue } = await s.from('goods_receipts')
      .select('id').eq('id', rBorrable.data.id).maybeSingle()
    seFue ? FAIL('un borrador no se pudo borrar') : PASS('un borrador sí se borra')

    // ── 10 · Coherencia ────────────────────────────────────────────────────
    seccion('10 · COHERENCIA')

    // Contra un pedido en borrador no se recibe.
    const { data: numBorr } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'purchase_order' })
    const { data: poBorrador } = await c.from('purchase_orders').insert({
      company_id: BT, supplier_id: prov.id, number: numBorr, series_code: 'PC',
      currency_code: 'USD', order_date: HOY, notes: `${MARCA} sin confirmar`,
    }).select('id').single()
    creados.pedidos.push(poBorrador.id)
    const rBorr = await nuevaRecepcion(c, { id: poBorrador.id }, prov.id, [])
    rBorr.error ? PASS('no se recibe contra un pedido en borrador',
                       String(rBorr.error.message).slice(0, 50))
                : FAIL('SE RECIBIÓ CONTRA UN PEDIDO SIN CONFIRMAR')

    // Una línea de OTRO pedido no entra en esta recepción.
    const rMezcla = await nuevaRecepcion(c, po5, prov.id, [])
    const { error: eMezcla } = await c.from('goods_receipt_lines').insert({
      company_id: BT, goods_receipt_id: rMezcla.data.id,
      purchase_order_line_id: po1.lineas[0], product_id: prods[0].id, quantity: 1,
    })
    eMezcla ? PASS('una línea de otro pedido es rechazada', eMezcla.code ?? '')
            : FAIL('SE MEZCLARON LÍNEAS DE DOS PEDIDOS')

    // El producto no se elige: es el de la línea del pedido.
    const { error: eProd } = await c.from('goods_receipt_lines').insert({
      company_id: BT, goods_receipt_id: rMezcla.data.id,
      purchase_order_line_id: po5.lineas[0], product_id: prods[0].id, quantity: 1,
    })
    eProd ? PASS('cambiar el producto de la línea es rechazado', eProd.code ?? '')
          : FAIL('SE PUDO RECIBIR OTRO PRODUCTO')

    // ── 11 · Numeración concurrente ────────────────────────────────────────
    seccion('11 · NUMERACIÓN NEP')

    const N = 15
    const conReintento = async (fn) => {
      for (let i = 0; i < 5; i += 1) {
        const r = await fn()
        if (!r.error) return r
        if (!String(r.error.message ?? '').includes('fetch failed')) return r
        await new Promise((z) => setTimeout(z, 200 * (i + 1)))
      }
      return { error: { message: 'fetch failed tras 5 intentos' } }
    }
    const numeros = await Promise.all(
      Array.from({ length: N }, () => conReintento(() =>
        c.rpc('next_document_number', { p_company: BT, p_doc_type: 'goods_receipt' })
          .then((r) => ({ data: r.data, error: r.error })))),
    )
    const vals = numeros.filter((r) => r.data).map((r) => r.data)
    cmp(`${N} números simultáneos sin error`, 0, numeros.filter((r) => r.error).length)
    cmp('todos distintos', N, new Set(vals).size)
    cmp('con formato NEP00000', N, vals.filter((v) => /^NEP\d{5}$/.test(v)).length)
    const ent = vals.map((v) => Number(v.slice(3))).sort((a, b) => a - b)
    cmp('sin huecos por carrera', true, ent.every((v, i) => i === 0 || v === ent[i - 1] + 1))

    // ── 12 · RLS ───────────────────────────────────────────────────────────
    seccion('12 · RLS POR ROL')

    for (const [rol, email] of [
      ['customer', 'cliente.test@buscatools.com.ar'],
      ['distributor', 'distribuidor.test@buscatools.com.ar'],
    ]) {
      const ext = sesion()
      const { error } = await ext.auth.signInWithPassword({ email, password: process.env.BT_PW_TEST })
      if (error) { FAIL(`${rol}: no se pudo iniciar sesión`, error.message); continue }
      const { data: lista } = await ext.from('goods_receipts').select('id')
      cmp(`${rol}: no ve ninguna recepción`, 0, (lista ?? []).length)
      const { data: porId } = await ext.from('goods_receipts').select('id').eq('id', confirmada)
      cmp(`${rol}: tampoco por id exacto`, 0, (porId ?? []).length)
      const { data: porNum } = await ext.from('goods_receipts').select('id').eq('number', r7.data.number)
      cmp(`${rol}: tampoco por número NEP`, 0, (porNum ?? []).length)
      const { data: porPo } = await ext.from('goods_receipts').select('id').eq('purchase_order_id', po7.id)
      cmp(`${rol}: tampoco por pedido`, 0, (porPo ?? []).length)
      const { data: porProv } = await ext.from('goods_receipts').select('id').eq('supplier_id', prov.id)
      cmp(`${rol}: tampoco por proveedor`, 0, (porProv ?? []).length)
      const { data: porDep } = await ext.from('goods_receipts').select('id').eq('warehouse_id', dep.id)
      cmp(`${rol}: tampoco por depósito`, 0, (porDep ?? []).length)
      const { data: lineasExt } = await ext.from('goods_receipt_lines').select('id')
      cmp(`${rol}: ni las líneas`, 0, (lineasExt ?? []).length)
      const { error: eConf } = await ext.rpc('confirmar_recepcion', { p_receipt: confirmada })
      eConf ? PASS(`${rol}: no puede confirmar`, eConf.code ?? '')
            : FAIL(`${rol.toUpperCase()} CONFIRMÓ UNA RECEPCIÓN`)
    }

    const anon = sesion()
    const { data: nadaAnon } = await anon.from('goods_receipts').select('id')
    cmp('anónimo: no ve nada', 0, (nadaAnon ?? []).length)

    // Jano es salesperson en Torquetools.
    const { data: veTT } = await c.from('goods_receipts').select('id').eq('company_id', TT)
    cmp('salesperson: no ve las recepciones de su empresa', 0, (veTT ?? []).length)
    const rTT = await nuevaRecepcion(c, null, prov.id, [], { company_id: TT })
    rTT.error ? PASS('salesperson: no puede crear en su empresa', rTT.error.code ?? '')
              : FAIL('EL SALESPERSON CREÓ UNA RECEPCIÓN')

    // ── 13 · Auditoría ─────────────────────────────────────────────────────
    seccion('13 · AUDITORÍA')

    const { data: audR } = await s.from('purchases_audit')
      .select('action').eq('entity_type', 'goods_receipt').eq('entity_id', r7.data.id).order('id')
    cmp('el alta, la confirmación y el stock quedan auditados',
      'create,confirm,stock_applied', (audR ?? []).map((a) => a.action).join(','))

    const { data: audPo } = await s.from('purchases_audit')
      .select('action, to_status').eq('entity_type', 'purchase_order').eq('entity_id', po7.id)
      .eq('action', 'receive')
    cmp('y el pedido registra la recepción con su estado nuevo', 'received',
      (audPo ?? [])[0]?.to_status)

    // Un solo evento de stock por recepción, no uno por línea.
    const { count: stockEventos } = await s.from('purchases_audit')
      .select('*', { count: 'exact', head: true })
      .eq('entity_id', r7.data.id).eq('action', 'stock_applied')
    cmp('un solo evento de stock por recepción, no uno por línea', 1, stockEventos)

    // Editar un borrador no deja ruido.
    const rRuido = await nuevaRecepcion(c, po5, prov.id, [{
      lineaId: po5.lineas[0], productId: prods[3].id,
      sku: prods[3].sku, nombre: prods[3].name, cantidad: 1,
    }])
    await c.from('goods_receipts').update({ notes: `${MARCA} nota 1` }).eq('id', rRuido.data.id)
    await c.from('goods_receipts').update({ notes: `${MARCA} nota 2` }).eq('id', rRuido.data.id)
    const { data: audRuido } = await s.from('purchases_audit')
      .select('action').eq('entity_id', rRuido.data.id)
    cmp('editar un borrador NO llena la auditoría', 'create',
      (audRuido ?? []).map((a) => a.action).join(','))
  } catch (e) {
    FAIL('excepción', e.message)
    console.error(e)
  } finally {
    // ── Limpieza ───────────────────────────────────────────────────────────
    seccion('LIMPIEZA')

    for (const id of creados.recepciones) {
      await s.from('stock_movements').delete().eq('source_type', 'goods_receipt').eq('source_id', id)
      await s.from('goods_receipt_lines').delete().eq('goods_receipt_id', id)
      const { error } = await s.from('goods_receipts').delete().eq('id', id)
      if (error) console.log(`    ----  no se pudo borrar la recepción: ${error.message}`)
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

    for (const id of creados.depositos) await s.from('warehouses').delete().eq('id', id)
    await s.from('warehouses').delete().like('name', `${MARCA}%`)

    for (const id of creados.proveedores) await s.from('suppliers').delete().eq('id', id)
    await s.from('suppliers').delete().like('legal_name', `${MARCA}%`)

    // La auditoría, al final: borrar líneas y documentos dispara triggers que
    // escriben eventos nuevos.
    const entidades = [...creados.recepciones, ...creados.pedidos, ...creados.proveedores]
    if (entidades.length > 0) {
      await s.from('purchases_audit').delete().in('entity_id', entidades)
    }

    for (const q of seqAntes ?? []) {
      await s.from('document_sequences').update({ next_number: q.next_number })
        .eq('company_id', BT).eq('doc_type', q.doc_type)
    }

    const q = async (t) => (await s.from(t).select('*', { count: 'exact', head: true })).count
    cmp('los movimientos de stock vuelven a su número', movAntes, await q('stock_movements'))
    cmp('y los saldos también', saldosPrevios.size, await q('stock_balances'))
    cmp('no queda ninguna recepción', 0, await q('goods_receipts'))
    cmp('ni ningún pedido', 0, await q('purchase_orders'))
    cmp('los proveedores vuelven a los 142 migrados', 142, await q('suppliers'))
    cmp('la auditoría vuelve a su número', auditAntes, await q('purchases_audit'))
    console.log(`    series repuestas: ${(seqAntes ?? []).map((x) => x.doc_type + '=' + x.next_number).join(' · ')}`)
  }

  console.log('\n' + '='.repeat(74))
  console.log(`  RESULTADO: ${fallos} fallo(s)`)
  console.log('='.repeat(74))
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch((e) => { console.error('\n✗', e); process.exit(1) })
