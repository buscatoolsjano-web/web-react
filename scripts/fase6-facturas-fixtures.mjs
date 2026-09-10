/**
 * Fase 6 · Compras — entrega 5: datos temporales para la revisión mobile.
 *
 * Deja armado lo que hace falta para mirar las cuatro pantallas de facturas
 * con contenido de verdad: un proveedor, un pedido confirmado con tres líneas
 * —dos productos y un flete—, una recepción confirmada de todo, una factura
 * registrada y otra en borrador.
 *
 * Todo lleva la marca `ZZ-M5` y se borra con `--limpiar`. **No queda nada**:
 * la revisión no puede dejar residuo en la base real.
 *
 *   set -a; source .env; source .env.migration; set +a
 *   node scripts/fase6-facturas-fixtures.mjs            # crear
 *   node scripts/fase6-facturas-fixtures.mjs --limpiar  # borrar
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET) { console.error('✗ Faltan variables de entorno'); process.exit(1) }

/**
 * Dos clientes, y no es un detalle.
 *
 * `s` es la clave de servicio y sirve para LIMPIAR: es la única que puede
 * borrar una factura registrada o una recepción confirmada.
 *
 * `c` es una sesión de admin de verdad, y es la que CREA. Confirmar una
 * recepción y registrar una factura pasan por funciones que exigen un rol de
 * la empresa —`app.current_role()`—, y la clave de servicio no tiene ninguno:
 * con ella las dos fallan en silencio y los fixtures quedan a medias. Pasó.
 */
const s = createClient(BASE, SECRET, { auth: { persistSession: false } })
const c = createClient(BASE, PUB, { auth: { persistSession: false } })
const MARCA = 'ZZ-M5'
const HOY = new Date().toISOString().slice(0, 10)
const LIMPIAR = process.argv.includes('--limpiar')
/** Un uuid que no es de nadie: `.in()` con lista vacía no filtra nada. */
const NADIE = '00000000-0000-0000-0000-000000000000'

/**
 * Dónde se guarda el estado de las series antes de crear los fixtures.
 *
 * Crear y limpiar son dos corridas distintas, así que el número de dónde
 * arrancaba cada serie tiene que sobrevivir entre las dos. Sin esto la
 * limpieza borraba las filas pero dejaba las series corridas, y las suites que
 * verifican que `supplier` arranca en 146 empezaban a fallar. Pasó.
 */
const SERIES = new URL('./.fase6-fixtures-series.json', import.meta.url)
const TIPOS = ['supplier', 'purchase_order', 'goods_receipt', 'supplier_invoice']

const main = async () => {
  const { data: comps } = await s.from('companies').select('id, slug')
  const BT = comps.find((x) => x.slug === 'buscatools').id

  if (LIMPIAR) {
    const { data: provs } = await s.from('suppliers')
      .select('id').like('legal_name', `${MARCA}%`)
    const pids = (provs ?? []).map((x) => x.id)

    // Por PROVEEDOR, no por la marca en las notas: lo que se cree a mano
    // desde la pantalla durante la revisión no lleva ninguna marca, y filtrar
    // por notas lo dejaba atrás —y con él la recepción y el pedido, que ya no
    // se podían borrar—. Pasó.
    const { data: facs } = await s.from('supplier_invoices')
      .select('id').in('supplier_id', pids.length > 0 ? pids : [NADIE])
    const fids = (facs ?? []).map((x) => x.id)
    for (const id of fids) {
      await s.from('supplier_invoice_lines').delete().eq('supplier_invoice_id', id)
      await s.from('supplier_invoices').delete().eq('id', id)
    }

    const { data: recs } = await s.from('goods_receipts')
      .select('id').in('supplier_id', pids.length > 0 ? pids : [NADIE])
    const rids = (recs ?? []).map((x) => x.id)
    for (const id of rids) {
      await s.from('stock_movements').delete().eq('source_id', id)
      await s.from('goods_receipt_lines').delete().eq('goods_receipt_id', id)
      await s.from('goods_receipts').delete().eq('id', id)
    }

    const { data: pos } = await s.from('purchase_orders')
      .select('id').in('supplier_id', pids.length > 0 ? pids : [NADIE])
    for (const p of pos ?? []) {
      await s.from('purchase_order_lines').delete().eq('purchase_order_id', p.id)
      await s.from('purchase_orders').delete().eq('id', p.id)
    }

    // Los saldos que la revisión movió vuelven a lo que digan los movimientos
    // que quedaron; los que nacieron acá se borran.
    const { data: saldos } = await s.from('stock_balances')
      .select('product_id, warehouse_id, on_hand')
    for (const b of saldos ?? []) {
      const { data: movs } = await s.from('stock_movements')
        .select('quantity').eq('product_id', b.product_id).eq('warehouse_id', b.warehouse_id)
      const total = (movs ?? []).reduce((a, m) => a + Number(m.quantity), 0)
      if ((movs ?? []).length === 0) {
        await s.from('stock_balances').delete()
          .eq('product_id', b.product_id).eq('warehouse_id', b.warehouse_id)
      } else if (Number(b.on_hand) !== total) {
        await s.from('stock_balances').update({ on_hand: total })
          .eq('product_id', b.product_id).eq('warehouse_id', b.warehouse_id)
      }
    }

    await s.from('attachments').delete().like('file_name', `${MARCA}%`)
    for (const id of [...fids, ...rids, ...(pos ?? []).map((x) => x.id)]) {
      await s.from('attachments').delete().eq('entity_id', id)
    }
    for (const id of pids) await s.from('suppliers').delete().eq('id', id)

    // La auditoría, al final.
    const entidades = [...fids, ...rids, ...(pos ?? []).map((x) => x.id), ...pids]
    if (entidades.length > 0) {
      await s.from('purchases_audit').delete().in('entity_id', entidades)
    }

    let repuestas = 'no había snapshot'
    try {
      const previas = JSON.parse(fs.readFileSync(SERIES, 'utf8'))
      for (const x of previas) {
        await s.from('document_sequences').update({ next_number: x.next_number })
          .eq('company_id', BT).eq('doc_type', x.doc_type)
      }
      fs.unlinkSync(SERIES)
      repuestas = previas.map((x) => x.doc_type + '=' + x.next_number).join(' · ')
    } catch {
      /* sin snapshot no se toca nada: mejor dejarlas como están que adivinar */
    }

    const q = async (t) => (await s.from(t).select('*', { count: 'exact', head: true })).count
    console.log('Limpieza:')
    console.log(`  facturas ............. ${await q('supplier_invoices')}`)
    console.log(`  líneas de factura .... ${await q('supplier_invoice_lines')}`)
    console.log(`  recepciones .......... ${await q('goods_receipts')}`)
    console.log(`  pedidos .............. ${await q('purchase_orders')}`)
    console.log(`  proveedores .......... ${await q('suppliers')}`)
    console.log(`  movimientos de stock . ${await q('stock_movements')}`)
    console.log(`  saldos ............... ${await q('stock_balances')}`)
    console.log(`  auditoría ............ ${await q('purchases_audit')}`)
    console.log(`  series repuestas ..... ${repuestas}`)
    return
  }

  const { error: eLogin } = await c.auth.signInWithPassword({
    email: 'buscatools.jano@gmail.com',
    password: process.env.BT_PW_JANO,
  })
  if (eLogin) { console.error('✗ login: ' + eLogin.message); process.exit(1) }

  const { data: dep } = await c.from('warehouses')
    .select('id').eq('company_id', BT).eq('is_default', true).single()
  const { data: prods } = await c.from('products')
    .select('id, sku, name').eq('company_id', BT).order('sku').limit(2)

  const { data: seqAntes } = await s.from('document_sequences')
    .select('doc_type, next_number').eq('company_id', BT).in('doc_type', TIPOS)
  fs.writeFileSync(SERIES, JSON.stringify(seqAntes ?? [], null, 2))

  const numero = async (tipo) =>
    (await c.rpc('next_document_number', { p_company: BT, p_doc_type: tipo })).data

  const { data: prov } = await c.from('suppliers').insert({
    company_id: BT, legacy_ref: await numero('supplier'),
    legal_name: `${MARCA} Herramientas del Sur S.A.`,
    trade_name: 'Herramientas del Sur',
    phone: '11 4444 5555', email: 'compras@ejemplo.test',
    address_text: 'Av. Siempreviva 742 · Buenos Aires · AR',
    payment_terms: '30 días fecha factura',
  }).select('id').single()

  const { data: po } = await c.from('purchase_orders').insert({
    company_id: BT, supplier_id: prov.id, number: await numero('purchase_order'),
    series_code: 'PC', currency_code: 'USD', order_date: HOY,
    status: 'confirmed', notes: `${MARCA} pedido de revisión`,
  }).select('id, number').single()

  const lineas = []
  const defs = [
    { productId: prods[0].id, sku: prods[0].sku, nombre: prods[0].name, cantidad: 40, precio: 128.5 },
    { productId: prods[1].id, sku: prods[1].sku, nombre: prods[1].name, cantidad: 12, precio: 2340.75 },
    { productId: null, sku: null, nombre: 'Flete marítimo Shanghái–Buenos Aires', cantidad: 1, precio: 1850 },
  ]
  for (let i = 0; i < defs.length; i += 1) {
    const d = defs[i]
    const { data, error } = await c.from('purchase_order_lines').insert({
      company_id: BT, purchase_order_id: po.id, line_no: i + 1, line_type: 'product',
      product_id: d.productId, sku_snapshot: d.sku, name_snapshot: d.nombre,
      quantity: d.cantidad, unit_price: d.precio, discount_pct: i === 0 ? 5 : 0,
      tax_treatment: i === 2 ? 'exempt' : 'vat_21',
    }).select('id').single()
    if (error) { console.error('✗ línea del pedido: ' + error.message); process.exit(1) }
    lineas.push(data.id)
  }

  const { data: rec } = await c.from('goods_receipts').insert({
    company_id: BT, supplier_id: prov.id, purchase_order_id: po.id,
    warehouse_id: dep.id, number: await numero('goods_receipt'), series_code: 'NEP',
    receipt_date: HOY, notes: `${MARCA} recepción de revisión`,
  }).select('id, number').single()

  for (let i = 0; i < defs.length; i += 1) {
    const d = defs[i]
    const { error } = await c.from('goods_receipt_lines').insert({
      company_id: BT, goods_receipt_id: rec.id, purchase_order_line_id: lineas[i],
      product_id: d.productId, sku_snapshot: d.sku, name_snapshot: d.nombre,
      quantity: d.cantidad,
    })
    if (error) { console.error('✗ línea de recepción: ' + error.message); process.exit(1) }
  }
  // Por la RPC, que es la única puerta: un UPDATE del estado lo rechaza el
  // trigger, y con razón —sería mercadería recibida sin stock—.
  const { error: eConf } = await c.rpc('confirmar_recepcion', { p_receipt: rec.id })
  if (eConf) { console.error('✗ confirmar recepción: ' + eConf.message); process.exit(1) }

  // Una factura registrada: parcial sobre la primera línea.
  const { data: fReg } = await c.from('supplier_invoices').insert({
    company_id: BT, supplier_id: prov.id, number: await numero('supplier_invoice'),
    series_code: 'FP', supplier_number: 'A-0001-00012345', currency_code: 'USD',
    invoice_date: HOY, due_date: HOY, payment_terms: '30 días',
    notes: `${MARCA} factura registrada`,
  }).select('id, number').single()
  const { data: recLineas } = await c.from('goods_receipt_lines')
    .select('id, purchase_order_line_id').eq('goods_receipt_id', rec.id).order('created_at')
  const { error: eLinReg } = await c.from('supplier_invoice_lines').insert({
    company_id: BT, supplier_invoice_id: fReg.id, line_no: 1, line_type: 'product',
    goods_receipt_line_id: recLineas[0].id, quantity: 15, unit_price: 128.5,
    discount_pct: 5, tax_treatment: 'vat_21',
    sku_snapshot: defs[0].sku, description_snapshot: defs[0].nombre,
  })
  if (eLinReg) { console.error('✗ línea de la factura registrada: ' + eLinReg.message); process.exit(1) }
  const { error: eReg } = await c.rpc('registrar_factura_proveedor', { p_invoice: fReg.id })
  if (eReg) { console.error('✗ registrar factura: ' + eReg.message); process.exit(1) }

  // Y una en borrador, con una línea de mercadería y un gasto suelto.
  const { data: fDraft } = await c.from('supplier_invoices').insert({
    company_id: BT, supplier_id: prov.id, number: await numero('supplier_invoice'),
    series_code: 'FP', supplier_number: 'A-0001-00012346', currency_code: 'USD',
    invoice_date: HOY, notes: `${MARCA} factura en borrador`,
  }).select('id, number').single()
  const { error: eLinDraft } = await c.from('supplier_invoice_lines').insert([
    {
      company_id: BT, supplier_invoice_id: fDraft.id, line_no: 1, line_type: 'product',
      goods_receipt_line_id: recLineas[1].id, quantity: 12, unit_price: 2415,
      discount_pct: 0, tax_treatment: 'vat_21',
      sku_snapshot: defs[1].sku, description_snapshot: defs[1].nombre,
    },
    {
      company_id: BT, supplier_invoice_id: fDraft.id, line_no: 2, line_type: 'product',
      quantity: 1, unit_price: 240, discount_pct: 0, tax_treatment: 'vat_21',
      description_snapshot: 'Gastos de despacho y sellado',
    },
  ])
  if (eLinDraft) { console.error('✗ líneas del borrador: ' + eLinDraft.message); process.exit(1) }

  console.log('Fixtures ZZ-M5 creados:')
  console.log(`  proveedor ..... ${prov.id}`)
  console.log(`  pedido ........ ${po.number} (${po.id})`)
  console.log(`  recepción ..... ${rec.number} (${rec.id})`)
  console.log(`  factura reg. .. ${fReg.number} (${fReg.id})`)
  console.log(`  factura borr. . ${fDraft.number} (${fDraft.id})`)
  console.log('')
  console.log(`  #/compras/facturas`)
  console.log(`  #/compras/facturas/${fReg.id}`)
  console.log(`  #/compras/facturas/${fDraft.id}`)
  console.log(`  #/compras/facturas/nueva?recepcion=${rec.id}&proveedor=${prov.id}`)
}

main().catch((e) => { console.error('\n✗', e); process.exit(1) })
