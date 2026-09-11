/**
 * Fix de las policies de SELECT que no autorizaban por sí mismas.
 *
 * Seis tablas hijas tenían la forma:
 *
 *   EXISTS (SELECT 1 FROM <padre> p
 *            WHERE p.id = <hija>.<fk> AND p.company_id = <hija>.company_id)
 *
 * que comprueba CONSISTENCIA INTERNA, no permiso.
 *
 * **Importante y medido:** hoy no filtraban. Postgres aplica RLS también
 * dentro de la subconsulta de una policy, así que la cadena terminaba en la
 * policy del padre, que está bien. Lo que se corrige es la FRAGILIDAD: la
 * garantía era implícita y ahora cada policy se defiende sola.
 *
 * Por eso esta suite no busca «antes filtraba y ahora no»: busca que **la
 * visibilidad sea exactamente la correcta**, caso por caso, con documentos
 * de verdad en cuatro situaciones distintas.
 *
 * Se limpia sola: prefijo `ZZ-RLS`.
 *
 *   set -a; source .env; source .env.migration; source .env.rls.txt; set +a
 *   node scripts/fix-rls-tautologicas-tests.mjs
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

const MARCA = 'ZZ-RLS'
const HOY = new Date().toISOString().slice(0, 10)
const CLI_DEMO = '61e194f4-6b8c-410c-974b-d7f5dd817da4'   // el del usuario customer
const creados = { empresas: [], clientes: [], productos: [], rubros: [], depositos: [],
                  entregas: [], cotizaciones: [], pedidos: [], facturas: [], ocs: [], imagenes: [] }

const main = async () => {
  const s = admin()
  const { data: comps } = await s.from('companies').select('id, slug')
  const BT = comps.find((x) => x.slug === 'buscatools').id
  const TT = comps.find((x) => x.slug === 'torquetools').id

  const cuenta = async (t) => (await s.from(t).select('*', { count: 'exact', head: true })).count
  const antes = {}
  for (const t of ['companies', 'customers', 'products', 'product_categories', 'warehouses',
    'deliveries', 'delivery_lines', 'sales_quotes', 'sales_quote_lines', 'sales_orders',
    'sales_order_lines', 'sales_invoices', 'sales_invoice_lines', 'customer_purchase_orders',
    'customer_purchase_order_lines', 'product_images']) antes[t] = await cuenta(t)

  console.log('='.repeat(74))
  console.log('  FIX RLS · seis policies que no autorizaban por sí mismas')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(74))

  // ── Andamios ───────────────────────────────────────────────────────────

  const nuevaEmpresa = async () => {
    const { data, error } = await s.from('companies').insert({
      slug: `${MARCA.toLowerCase()}-ajena`, name: `${MARCA} Empresa ajena`,
    }).select('id').single()
    if (error) { FAIL('empresa ajena', error.message); return null }
    creados.empresas.push(data.id)
    return data.id
  }

  const nuevoCliente = async (companyId, etiqueta) => {
    const { data, error } = await s.from('customers').insert({
      company_id: companyId, legal_name: `${MARCA} cliente ${etiqueta}`,
    }).select('id').single()
    if (error) { FAIL(`cliente ${etiqueta}`, error.message); return null }
    creados.clientes.push(data.id)
    return data.id
  }

  const infra = async (companyId, etiqueta) => {
    let { data: rubro } = await s.from('product_categories')
      .select('id').eq('company_id', companyId).limit(1).maybeSingle()
    if (!rubro) {
      const { data, error } = await s.from('product_categories').insert({
        company_id: companyId, name: `${MARCA} rubro`, slug: `${MARCA.toLowerCase()}-rubro`,
      }).select('id').single()
      if (error) { FAIL(`rubro ${etiqueta}`, error.message); return null }
      rubro = data; creados.rubros.push(data.id)
    }
    const { data: prod, error: eP } = await s.from('products').insert({
      company_id: companyId, category_id: rubro.id,
      sku: `${MARCA}-${etiqueta}`, name: `${MARCA} producto ${etiqueta}`, status: 'active',
    }).select('id').single()
    if (eP) { FAIL(`producto ${etiqueta}`, eP.message); return null }
    creados.productos.push(prod.id)

    let { data: dep } = await s.from('warehouses')
      .select('id').eq('company_id', companyId).limit(1).maybeSingle()
    if (!dep) {
      const { data, error } = await s.from('warehouses').insert({
        company_id: companyId, code: `${MARCA}${etiqueta}`.slice(0, 10), name: `${MARCA} dep`,
      }).select('id').single()
      if (error) { FAIL(`depósito ${etiqueta}`, error.message); return null }
      dep = data; creados.depositos.push(data.id)
    }
    return { productId: prod.id, warehouseId: dep.id }
  }

  /** Un documento de cada tipo con su línea, para un cliente de una empresa. */
  const armarDocs = async (companyId, customerId, etiqueta, inf) => {
    const r = {}

    const { data: ent, error: eE } = await s.from('deliveries').insert({
      company_id: companyId, number: `${MARCA}-RT-${etiqueta}`, customer_id: customerId,
      delivery_date: HOY,
    }).select('id').single()
    if (eE) { FAIL(`entrega ${etiqueta}`, eE.message); return null }
    creados.entregas.push(ent.id)
    const { data: eL, error: eEL } = await s.from('delivery_lines').insert({
      company_id: companyId, delivery_id: ent.id, product_id: inf.productId,
      warehouse_id: inf.warehouseId, quantity: 1,
    }).select('id').single()
    if (eEL) { FAIL(`línea de entrega ${etiqueta}`, eEL.message); return null }
    r.delivery_lines = { id: eL.id, parent: ent.id, parentCol: 'delivery_id' }

    const { data: cot, error: eC } = await s.from('sales_quotes').insert({
      company_id: companyId, number: `${MARCA}-COTI-${etiqueta}`, customer_id: customerId,
      quote_date: HOY,
    }).select('id').single()
    if (eC) { FAIL(`cotización ${etiqueta}`, eC.message); return null }
    creados.cotizaciones.push(cot.id)
    const { data: cL, error: eCL } = await s.from('sales_quote_lines').insert({
      company_id: companyId, quote_id: cot.id, product_id: inf.productId,
      quantity: 1, unit_price: 10, line_no: 1,
    }).select('id').single()
    if (eCL) { FAIL(`línea de cotización ${etiqueta}`, eCL.message); return null }
    r.sales_quote_lines = { id: cL.id, parent: cot.id, parentCol: 'quote_id' }

    const { data: ped, error: eO } = await s.from('sales_orders').insert({
      company_id: companyId, number: `${MARCA}-PDV-${etiqueta}`, customer_id: customerId,
      order_date: HOY,
    }).select('id').single()
    if (eO) { FAIL(`pedido ${etiqueta}`, eO.message); return null }
    creados.pedidos.push(ped.id)
    const { data: oL, error: eOL } = await s.from('sales_order_lines').insert({
      company_id: companyId, order_id: ped.id, product_id: inf.productId,
      quantity_ordered: 1, unit_price: 10, line_no: 1,
    }).select('id').single()
    if (eOL) { FAIL(`línea de pedido ${etiqueta}`, eOL.message); return null }
    r.sales_order_lines = { id: oL.id, parent: ped.id, parentCol: 'order_id' }

    const { data: img, error: eI } = await s.from('product_images').insert({
      company_id: companyId, product_id: inf.productId,
      storage_path: `${companyId}/${MARCA}-${etiqueta}.jpg`, position: 1,
    }).select('id').single()
    if (eI) { FAIL(`imagen ${etiqueta}`, eI.message); return null }
    creados.imagenes.push(img.id)
    r.product_images = { id: img.id, parent: inf.productId, parentCol: 'product_id' }

    return r
  }

  try {
    // ── Fixtures ───────────────────────────────────────────────────────────
    seccion('FIXTURES · cuatro situaciones')

    const ajena = await nuevaEmpresa()
    if (!ajena) throw new Error('sin empresa ajena')

    const infBT = await infra(BT, 'BT')
    const infTT = await infra(TT, 'TT')
    const infAJ = await infra(ajena, 'AJ')
    if (!infBT || !infTT || !infAJ) throw new Error('sin infraestructura')

    const otroCliente = await nuevoCliente(BT, 'otro')
    if (!otroCliente) throw new Error('sin otro cliente')

    // 1 · del cliente de prueba, en Buscatools  → él SÍ debe verlo
    const propio = await armarDocs(BT, CLI_DEMO, 'PROPIO', infBT)
    // 2 · de OTRO cliente, misma empresa       → él NO debe verlo
    const ajenoMismaEmpresa = await armarDocs(BT, otroCliente, 'OTROCLI', infBT)
    // 3 · en Torquetools                       → Jano (salesperson) SÍ
    const { data: cliTT } = await s.from('customers')
      .select('id').eq('company_id', TT).limit(1).maybeSingle()
    const enTT = cliTT ? await armarDocs(TT, cliTT.id, 'TT', infTT)
                       : await armarDocs(TT, await nuevoCliente(TT, 'tt'), 'TT', infTT)
    // 4 · en la empresa ajena                  → NADIE
    const enAjena = await armarDocs(ajena, await nuevoCliente(ajena, 'aj'), 'AJ', infAJ)
    if (!propio || !ajenoMismaEmpresa || !enTT || !enAjena) throw new Error('sin documentos')
    PASS('documentos armados en las cuatro situaciones')

    // Las tres tablas de LÍNEAS DE DOCUMENTO, que sí tienen cliente.
    // `product_images` se prueba aparte: sigue a `products`, que no tiene
    // cliente y deja ver el catálogo activo a todo miembro de la empresa.
    const TABLAS = ['delivery_lines', 'sales_quote_lines', 'sales_order_lines']

    // ── La matriz, tabla por tabla ─────────────────────────────────────────
    const revisar = async (cliente, etiqueta, esperado) => {
      seccion(`${etiqueta}`)
      for (const t of TABLAS) {
        const casos = [
          ['propio', propio[t], esperado.propio],
          ['de otro cliente, misma empresa', ajenoMismaEmpresa[t], esperado.otroCliente],
          ['de Torquetools', enTT[t], esperado.tt],
          ['de la empresa ajena', enAjena[t], esperado.ajena],
        ]
        for (const [nombre, fx, deberia] of casos) {
          // por id exacto
          const { data: porId } = await cliente.from(t).select('id').eq('id', fx.id)
          const veId = (porId ?? []).length === 1
          // por el id del padre exacto
          const { data: porPadre } = await cliente.from(t).select('id').eq(fx.parentCol, fx.parent)
          const vePadre = (porPadre ?? []).some((x) => x.id === fx.id)

          veId === deberia && vePadre === deberia
            ? PASS(`${t} · ${nombre}: ${deberia ? 've' : 'NO ve'}`)
            : FAIL(`${t} · ${nombre}: por id ${veId}, por padre ${vePadre}, debería ${deberia}`)
        }
      }
    }

    // Jano: admin en BT, salesperson en TT. Interno en las dos, ajeno a la tercera.
    const jano = sesion()
    const { error: eJ } = await jano.auth.signInWithPassword({
      email: 'buscatools.jano@gmail.com', password: process.env.BT_PW_JANO })
    if (eJ) FAIL('login jano', eJ.message)
    else await revisar(jano, 'ADMIN Buscatools / SALESPERSON Torquetools',
      { propio: true, otroCliente: true, tt: true, ajena: false })

    // Customer: sólo lo suyo, y sólo en su empresa.
    const cust = sesion()
    const { error: eC2 } = await cust.auth.signInWithPassword({
      email: 'cliente.test@buscatools.com.ar', password: process.env.BT_PW_TEST })
    if (eC2) FAIL('login customer', eC2.message)
    else await revisar(cust, 'CUSTOMER (Cliente Demo S.A.)',
      // Las imágenes son otra cosa: el catálogo activo lo ve todo miembro de
      // la empresa, y eso es de `products_select`, no de este fix.
      { propio: true, otroCliente: false, tt: false, ajena: false })

    // Distributor: es otro cliente de la misma empresa. No ve nada de éstos.
    const dist = sesion()
    const { error: eD } = await dist.auth.signInWithPassword({
      email: 'distribuidor.test@buscatools.com.ar', password: process.env.BT_PW_TEST })
    if (eD) FAIL('login distributor', eD.message)
    else await revisar(dist, 'DISTRIBUTOR (Distribuidor Demo S.R.L.)',
      { propio: false, otroCliente: false, tt: false, ajena: false })

    const anon = sesion()
    await revisar(anon, 'ANÓNIMO', { propio: false, otroCliente: false, tt: false, ajena: false })

    // ── product_images: su propia semántica ────────────────────────────────
    seccion('PRODUCT_IMAGES · sigue a products, no a un documento')

    const verImagen = async (cliente, etiqueta, esperado) => {
      const casos = [
        ['de su empresa (producto activo)', propio.product_images, esperado.propia],
        ['de otro cliente, misma empresa', ajenoMismaEmpresa.product_images, esperado.mismaEmpresa],
        ['de Torquetools', enTT.product_images, esperado.tt],
        ['de la empresa ajena', enAjena.product_images, esperado.ajena],
      ]
      for (const [nombre, fx, deberia] of casos) {
        const { data: porId } = await cliente.from('product_images').select('id').eq('id', fx.id)
        const { data: porProd } = await cliente.from('product_images')
          .select('id').eq('product_id', fx.parent)
        const veId = (porId ?? []).length === 1
        const veProd = (porProd ?? []).some((x) => x.id === fx.id)
        veId === deberia && veProd === deberia
          ? PASS(`${etiqueta} · ${nombre}: ${deberia ? 've' : 'NO ve'}`)
          : FAIL(`${etiqueta} · ${nombre}: por id ${veId}, por producto ${veProd}, debería ${deberia}`)
      }
    }

    // Las imágenes NO tienen cliente: el catálogo activo lo ve todo miembro de
    // la empresa. Que un customer vea la imagen de un producto activo NO es un
    // agujero, es `products_select` funcionando.
    await verImagen(jano, 'ADMIN BT / SALESPERSON TT',
      { propia: true, mismaEmpresa: true, tt: true, ajena: false })
    await verImagen(cust, 'CUSTOMER',
      { propia: true, mismaEmpresa: true, tt: false, ajena: false })
    await verImagen(dist, 'DISTRIBUTOR',
      { propia: true, mismaEmpresa: true, tt: false, ajena: false })
    await verImagen(anon, 'ANÓNIMO',
      { propia: false, mismaEmpresa: false, tt: false, ajena: false })

    seccion('PRODUCT_IMAGES · el catálogo sigue en pie')

    const { count: imgCust } = await cust.from('product_images')
      .select('*', { count: 'exact', head: true }).eq('company_id', BT)
    const { count: imgJano } = await jano.from('product_images')
      .select('*', { count: 'exact', head: true }).eq('company_id', BT)
    cmp('el customer sigue viendo las imágenes del catálogo activo de su empresa',
      true, imgCust > 8000)
    cmp('  y el interno ve al menos lo mismo', true, imgJano >= imgCust)

    const { data: imgAjena } = await cust.from('product_images')
      .select('id').eq('company_id', ajena)
    cmp('  pero ninguna de la empresa ajena', 0, (imgAjena ?? []).length)
    const { data: imgTT } = await cust.from('product_images')
      .select('id').eq('company_id', TT)
    cmp('  ni de Torquetools', 0, (imgTT ?? []).length)

    // Un producto inactivo: el interno lo ve, el customer no.
    // `inactive` no existe: el CHECK admite active | discontinued | draft.
    const { error: eDisc } = await s.from('products')
      .update({ status: 'discontinued' }).eq('id', infBT.productId)
    if (eDisc) FAIL('no se pudo discontinuar el producto', eDisc.message)
    const { data: imgInactivaCust } = await cust.from('product_images')
      .select('id').eq('id', propio.product_images.id)
    const { data: imgInactivaJano } = await jano.from('product_images')
      .select('id').eq('id', propio.product_images.id)
    cmp('un producto DISCONTINUADO: el customer no ve su imagen', 0, (imgInactivaCust ?? []).length)
    cmp('  y el interno sí', 1, (imgInactivaJano ?? []).length)
    await s.from('products').update({ status: 'active' }).eq('id', infBT.productId)

    // ── Las policies de escritura no se tocaron ────────────────────────────
    seccion('ESCRITURA · sin cambios')

    const { error: eEscribe } = await cust.from('sales_quote_lines')
      .update({ quantity: 99 }).eq('id', propio.sales_quote_lines.id)
    const { data: sigue } = await s.from('sales_quote_lines')
      .select('quantity').eq('id', propio.sales_quote_lines.id).single()
    cmp('un customer no puede editar la línea de su propia cotización', 1, Number(sigue.quantity))
    if (eEscribe) PASS('  (y el intento devolvió error)', eEscribe.code ?? '')

  } finally {
    // ── Limpieza ───────────────────────────────────────────────────────────
    seccion('LIMPIEZA')

    for (const id of creados.imagenes) await s.from('product_images').delete().eq('id', id)
    for (const id of creados.entregas) {
      await s.from('delivery_serials').delete().eq('delivery_id', id)
      await s.from('delivery_lines').delete().eq('delivery_id', id)
      await s.from('deliveries').delete().eq('id', id)
    }
    for (const id of creados.cotizaciones) {
      await s.from('sales_quote_lines').delete().eq('quote_id', id)
      await s.from('sales_quotes').delete().eq('id', id)
    }
    for (const id of creados.pedidos) {
      await s.from('sales_order_lines').delete().eq('order_id', id)
      await s.from('sales_orders').delete().eq('id', id)
    }
    for (const id of creados.productos) {
      await s.from('product_images').delete().eq('product_id', id)
      await s.from('products').delete().eq('id', id)
    }
    for (const id of creados.rubros) await s.from('product_categories').delete().eq('id', id)
    for (const id of creados.depositos) await s.from('warehouses').delete().eq('id', id)
    for (const id of creados.clientes) await s.from('customers').delete().eq('id', id)
    for (const id of creados.empresas) await s.from('companies').delete().eq('id', id)

    let dif = 0
    for (const t of Object.keys(antes)) {
      const ahora = await cuenta(t)
      if (String(antes[t]) !== String(ahora)) { dif++; FAIL(`${t} no volvió`, `${antes[t]} → ${ahora}`) }
    }
    if (dif === 0) PASS(`las ${Object.keys(antes).length} tablas vuelven a su número exacto`)
  }

  console.log('\n' + '='.repeat(74))
  console.log(`  RESULTADO: ${fallos} fallo(s)`)
  console.log('='.repeat(74))
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch((e) => { console.error('\n✗', e); process.exit(1) })
