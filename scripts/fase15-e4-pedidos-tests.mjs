/**
 * Fase 15 · E4 — el pedido de venta contra la base.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase15-e4-pedidos-tests.mjs
 *
 * Lo que prueba, midiendo el EFECTO:
 *   1. crear_pedido: número, estado, origen, líneas, totales y auditoría
 *   2. guardar_pedido: cabecera y líneas en una llamada, diff auditado
 *   3. concurrencia: dos guardados a la vez, uno gana
 *   4. convertir_cotizacion_en_pedido: copia el snapshot APROBADO, no recalcula
 *   5. idempotencia: dos conversiones simultáneas dejan UN pedido
 *   6. tarifa: se propaga, se valida y no cambia precios
 *   7. validaciones y campos inyectados, con los códigos de siempre
 *   8. permisos: anon, vendedor, técnico, portal y admin de otra empresa
 *   9. autoridad de numeración (STEL) en alta y conversión
 *  10. downstream: un pedido con entrega no se edita
 *  11. stock y reservas: no se mueven al crear ni editar
 *  12. limpieza e invariantes de producción
 *
 * Todo lleva el prefijo zz-e4 y se borra al final. No toca WhatsApp.
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET) { console.error('✗ Faltan variables de entorno'); process.exit(1) }

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(70)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const cmp = (t, esperado, real) =>
  String(esperado) === String(real) ? PASS(t, String(real)) : FAIL(t, `esperaba ${esperado}, dio ${real}`)
const rechaza = (t, r, codigo) => {
  if (!r.error) return FAIL(`SE PERMITIÓ: ${t}`)
  if (codigo && !String(r.error.message).includes(codigo)) {
    return FAIL(t, `esperaba ${codigo}, dio «${String(r.error.message).slice(0, 70)}»`)
  }
  PASS(t, codigo ?? String(r.error.message).slice(0, 50))
}

const sesion = () => createClient(BASE, PUB, { auth: { persistSession: false } })
const s = createClient(BASE, SECRET, { auth: { persistSession: false } })

const MARCA = 'zz-e4'
const creados = { usuarios: [], empresas: [] }
const ok = (r, q) => { if (r.error) throw new Error(`${q}: ${r.error.message}`); return r.data }
const cuenta = async (t, filtro = (q) => q) => (await filtro(s.from(t).select('*', { count: 'exact', head: true }))).count

const usuarioTemporal = async (companyId, rol, customerId = null) => {
  const email = `${MARCA}-${rol}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@buscatools.test`
  const password = `Zz${randomUUID()}!`
  const { data, error } = await s.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`crear ${rol}: ${error.message}`)
  creados.usuarios.push(data.user.id)
  const fila = { company_id: companyId, user_id: data.user.id, role: rol, status: 'active' }
  if (customerId) fila.customer_id = customerId
  ok(await s.from('company_memberships').insert(fila), `membresía ${rol}`)
  const c = sesion()
  const { error: eL } = await c.auth.signInWithPassword({ email, password })
  if (eL) throw new Error(`login ${rol}: ${eL.message}`)
  return { id: data.user.id, rol, c }
}

const limpiar = async () => {
  const ids = creados.empresas
  if (ids.length) {
    const borrar = async (t) => {
      const r = await s.from(t).delete().in('company_id', ids)
      if (r.error) console.log(`    aviso ${t}: ${r.error.message.slice(0, 110)}`)
    }
    await s.from('sales_audit').delete().in('company_id', ids)
    await borrar('delivery_lines')
    await borrar('deliveries')
    await borrar('sales_orders')
    await borrar('sales_quotes')
    await borrar('product_prices')
    await borrar('price_lists')
    await borrar('products')
    await borrar('product_categories')
    await borrar('document_numbering_authority')
    await borrar('document_sequences')
    await borrar('company_memberships')
    await borrar('customer_contacts')
    await borrar('customers')
  }
  for (const u of creados.usuarios) await s.auth.admin.deleteUser(u)
  creados.usuarios = []
  if (ids.length) {
    const r = await s.from('companies').delete().in('id', ids)
    if (r.error) console.log(`    aviso companies: ${r.error.message.slice(0, 120)}`)
  }
}

const barrerRestos = async () => {
  const { data: viejas } = await s.from('companies').select('id').like('slug', `${MARCA}-%`)
  creados.empresas = (viejas ?? []).map((x) => x.id)
  const { data: us } = await s.auth.admin.listUsers({ perPage: 1000 })
  creados.usuarios = (us?.users ?? []).filter((u) => u.email?.startsWith(`${MARCA}-`)).map((u) => u.id)
  await limpiar()
  creados.empresas = []
}

const PRODUCCION = ['buscatools', 'torquetools']

async function main() {
  console.log('='.repeat(78))
  console.log('  FASE 15 · VENTAS E4 — pedido: alta, edición y conversión atómicas')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(78))

  await barrerRestos()

  const { data: prodEmpresas } = await s.from('companies').select('id, slug').in('slug', PRODUCCION)
  const prodIds = prodEmpresas.map((e) => e.id)
  const baselineProd = async () => ({
    quotes: await cuenta('sales_quotes', (q) => q.in('company_id', prodIds)),
    lineasQ: await cuenta('sales_quote_lines', (q) => q.in('company_id', prodIds)),
    orders: await cuenta('sales_orders', (q) => q.in('company_id', prodIds)),
    lineasO: await cuenta('sales_order_lines', (q) => q.in('company_id', prodIds)),
    entregas: await cuenta('deliveries', (q) => q.in('company_id', prodIds)),
    lineasE: await cuenta('delivery_lines', (q) => q.in('company_id', prodIds)),
    stock: await cuenta('stock_movements', (q) => q.in('company_id', prodIds)),
    reservas: await cuenta('stock_reservations', (q) => q.in('company_id', prodIds)),
    auditoria: await cuenta('sales_audit', (q) => q.in('company_id', prodIds)),
    secuencias: (await s.from('document_sequences').select('next_number').in('company_id', prodIds)).data?.map((x) => x.next_number).join(',') ?? '',
    autoridad: (await s.from('document_numbering_authority').select('doc_type, authority').in('company_id', prodIds)).data?.map((x) => `${x.doc_type}:${x.authority}`).sort().join(',') ?? '',
  })
  const antesProd = await baselineProd()
  console.log(`  baseline producción: ${JSON.stringify(antesProd)}`)

  // ── Fixture ──────────────────────────────────────────────────────────────
  const sello = Date.now()
  const empresa = async (k, nombre) => {
    const e = ok(await s.from('companies').insert({
      slug: `${MARCA}-${k}-${sello}`, name: nombre, legal_name: `${nombre} SA`, default_currency: 'USD',
    }).select('id').single(), `empresa ${k}`)
    creados.empresas.push(e.id)
    for (const [doc, code] of [['quote', 'ZQ'], ['sales_order', 'ZP'], ['delivery', 'ZR']]) {
      ok(await s.from('document_sequences').insert({
        company_id: e.id, doc_type: doc, series_code: `${code}${k.toUpperCase()}`, prefix: `${code}${k.toUpperCase()}`,
        padding: 5, next_number: 1, is_default: true,
      }), `secuencia ${doc} ${k}`)
    }
    return e.id
  }
  const A = await empresa('a', 'ZZ E4 Alfa')
  const B = await empresa('b', 'ZZ E4 Beta')

  const lista = ok(await s.from('price_lists').insert({
    company_id: A, name: 'ZZ Base E4', currency_code: 'USD', is_default: true, valid_from: '2026-01-01',
  }).select('id').single(), 'lista')
  const listaMayorista = ok(await s.from('price_lists').insert({
    company_id: A, name: 'ZZ Mayorista E4', currency_code: 'USD', is_default: false, valid_from: '2026-01-01',
  }).select('id').single(), 'lista mayorista')
  const listaPesos = ok(await s.from('price_lists').insert({
    company_id: A, name: 'ZZ Pesos E4', currency_code: 'ARS', is_default: false, valid_from: '2026-01-01',
  }).select('id').single(), 'lista pesos')
  const listaB = ok(await s.from('price_lists').insert({
    company_id: B, name: 'ZZ Lista de B', currency_code: 'USD', is_default: true, valid_from: '2026-01-01',
  }).select('id').single(), 'lista B')

  const categoria = ok(await s.from('product_categories').insert({
    company_id: A, name: 'ZZ E4 Cat', slug: `${MARCA}-cat-${sello}`, position: 1, needs_review: false,
  }).select('id').single(), 'categoría')
  const categoriaB = ok(await s.from('product_categories').insert({
    company_id: B, name: 'ZZ E4 Cat B', slug: `${MARCA}-cat-b-${sello}`, position: 1, needs_review: false,
  }).select('id').single(), 'categoría B')
  const producto = ok(await s.from('products').insert({
    company_id: A, category_id: categoria.id, sku: `${MARCA}-P-${sello}`, name: 'ZZ Producto E4', status: 'active', attributes: {},
  }).select('id').single(), 'producto')
  const productoB = ok(await s.from('products').insert({
    company_id: B, category_id: categoriaB.id, sku: `${MARCA}-PB-${sello}`, name: 'ZZ Producto de B', status: 'active', attributes: {},
  }).select('id').single(), 'producto B')
  // El precio de la tarifa cambia DESPUÉS de cotizar: el pedido no debe verlo.
  ok(await s.from('product_prices').insert([
    { company_id: A, price_list_id: lista.id, product_id: producto.id, amount: 100, valid_from: '2026-01-01' },
    { company_id: A, price_list_id: listaMayorista.id, product_id: producto.id, amount: 80, valid_from: '2026-01-01' },
  ]), 'precios')

  const cliente = ok(await s.from('customers').insert({
    company_id: A, legal_name: 'ZZ E4 Cliente SA', status: 'active',
  }).select('id').single(), 'cliente')
  const otroCliente = ok(await s.from('customers').insert({
    company_id: A, legal_name: 'ZZ E4 Otro SA', status: 'active',
  }).select('id').single(), 'otro cliente')
  const clienteB = ok(await s.from('customers').insert({
    company_id: B, legal_name: 'ZZ E4 Cliente B SA', status: 'active',
  }).select('id').single(), 'cliente B')
  const contacto = ok(await s.from('customer_contacts').insert({
    company_id: A, customer_id: cliente.id, full_name: 'ZZ Contacto E4', role: 'Compras',
  }).select('id').single(), 'contacto')
  const contactoAjeno = ok(await s.from('customer_contacts').insert({
    company_id: A, customer_id: otroCliente.id, full_name: 'ZZ Contacto ajeno', role: 'Compras',
  }).select('id').single(), 'contacto ajeno')

  const admin = await usuarioTemporal(A, 'admin')
  const employee = await usuarioTemporal(A, 'employee')
  const vendedor = await usuarioTemporal(A, 'salesperson')
  const tecnico = await usuarioTemporal(A, 'technician')
  const portal = await usuarioTemporal(A, 'customer', cliente.id)
  const adminB = await usuarioTemporal(B, 'admin')
  const anon = sesion()

  const CAB = { customer_id: cliente.id, currency_code: 'USD' }
  const LINEA = {
    line_type: 'item', product_id: producto.id, sku_snapshot: 'ZZ-1', name_snapshot: 'ZZ Producto E4',
    quantity: 2, unit_price: 100, discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21,
  }
  const crearPedido = (c, cab = CAB, lineas = [LINEA], empresaId = A) =>
    c.rpc('crear_pedido', { p_company: empresaId, p_cabecera: cab, p_lineas: lineas })
  const guardarPedido = (c, id, esperado, cab = {}, lineas = []) =>
    c.rpc('guardar_pedido', { p_order: id, p_esperado: esperado, p_cabecera: cab, p_lineas: lineas })
  const convertir = (c, quoteId, esperado = null) =>
    c.rpc('convertir_cotizacion_en_pedido', { p_quote: quoteId, p_esperado: esperado })
  const pedido = async (id) => (await s.from('sales_orders').select('*').eq('id', id).single()).data
  const lineasDe = async (id) => (await s.from('sales_order_lines').select('*').eq('order_id', id).order('line_no')).data
  const secuencia = async (doc) => (await s.from('document_sequences').select('next_number').eq('company_id', A).eq('doc_type', doc).single()).data.next_number

  // ── 1 · Crear pedido manual ──────────────────────────────────────────────
  seccion('1 · Alta manual atómica')

  const p1 = ok(await crearPedido(admin.c, {
    ...CAB, contact_id: contacto.id, salesperson_id: employee.id, price_list_id: listaMayorista.id,
    title: 'ZZ Pedido', payment_terms: '30 días', notes: 'ZZ nota', order_date: '2026-09-17',
  }, [LINEA, { ...LINEA, sku_snapshot: 'ZZ-2', quantity: 1, unit_price: 50, discount_pct: 10 }]), 'crear pedido')
  cmp('devuelve id, número y total', true, !!p1.id && p1.number === 'ZPA00001' && Number(p1.total) > 0)

  const o1 = await pedido(p1.id)
  cmp('nace borrador y manual', 'draft/manual', `${o1.commercial_status}/${o1.origin}`)
  cmp('guarda contacto, vendedor y tarifa', `${contacto.id}/${employee.id}/${listaMayorista.id}`,
    `${o1.contact_id}/${o1.salesperson_id}/${o1.price_list_id}`)
  cmp('serie y empresa del servidor', `ZPA/${A}`, `${o1.series_code}/${o1.company_id}`)
  cmp('sin cotización de origen', 'null', String(o1.quote_id))
  // 2×100 + 1×50×0,9 = 245 · IVA 21 % = 51,45
  cmp('totales del servidor', '245.00/51.45/296.45',
    `${Number(o1.subtotal).toFixed(2)}/${Number(o1.tax_amount).toFixed(2)}/${Number(o1.total).toFixed(2)}`)
  cmp('líneas renumeradas', '1,2', (await lineasDe(p1.id)).map((l) => l.line_no).join(','))

  const auditCrear = ok(await s.from('sales_audit').select('*').eq('entity_id', p1.id), 'auditoría alta')
  cmp('un evento created con líneas y total', true,
    auditCrear.length === 1 && auditCrear[0].action === 'created' && auditCrear[0].diff.lineas.length === 2)

  // ── 2 · Guardar pedido ───────────────────────────────────────────────────
  seccion('2 · Guardado atómico de cabecera y líneas')

  const lineas1 = await lineasDe(p1.id)
  const g1 = ok(await guardarPedido(admin.c, p1.id, o1.updated_at,
    { title: 'ZZ Pedido editado', payment_terms: 'Contado' },
    [
      { id: lineas1[0].id, line_no: 1, line_type: 'item', product_id: producto.id, sku_snapshot: 'ZZ-1',
        name_snapshot: 'ZZ Producto E4', description_snapshot: 'ZZ detalle', quantity: 3, unit_price: 100,
        discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21 },
      { line_no: 2, line_type: 'item', product_id: producto.id, sku_snapshot: 'ZZ-3', name_snapshot: 'Nueva',
        quantity: 1, unit_price: 10, discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21 },
    ]), 'guardar')
  cmp('una llamada: 2 campos de cabecera y 3 líneas tocadas', '2/3', `${g1.cambios_cabecera}/${g1.lineas_tocadas}`)
  const o1b = await pedido(p1.id)
  cmp('la cabecera quedó guardada', 'ZZ Pedido editado/Contado', `${o1b.title}/${o1b.payment_terms}`)
  cmp('la línea borrada ya no está', 2, (await lineasDe(p1.id)).length)
  cmp('los totales se recalcularon solos', '310.00', Number(o1b.subtotal).toFixed(2))
  const auditEdit = ok(await s.from('sales_audit').select('*').eq('entity_id', p1.id).eq('action', 'updated_sensitive_fields'), 'auditoría edición')
  cmp('la auditoría guarda el antes y el después', true,
    auditEdit.length === 1 && auditEdit[0].diff.title.from === 'ZZ Pedido' && auditEdit[0].diff.lineas.length === 3)

  rechaza('guardar con el testigo viejo', await guardarPedido(admin.c, p1.id, o1.updated_at, { title: 'x' }), 'CONFLICTO_DE_EDICION')
  rechaza('guardar sin testigo', await guardarPedido(admin.c, p1.id, null, { title: 'x' }), 'CONFLICTO_DE_EDICION')
  const o1c = await pedido(p1.id)
  cmp('el rechazo no cambió nada', 'ZZ Pedido editado', o1c.title)

  // Concurrencia real: dos guardados con el mismo testigo.
  const [c1, c2] = await Promise.all([
    guardarPedido(admin.c, p1.id, o1c.updated_at, { title: 'ZZ primero' }),
    guardarPedido(employee.c, p1.id, o1c.updated_at, { title: 'ZZ segundo' }),
  ])
  const ganadores = [c1, c2].filter((r) => !r.error).length
  cmp('dos guardados a la vez: gana uno solo', 1, ganadores)
  cmp('el otro recibe conflicto', true, [c1, c2].some((r) => String(r.error?.message ?? '').includes('CONFLICTO_DE_EDICION')))

  // ── 3 · Validaciones y campos inyectados ─────────────────────────────────
  seccion('3 · Validaciones y payload cerrado')

  const o1d = await pedido(p1.id)
  rechaza('contacto de otro cliente', await guardarPedido(admin.c, p1.id, o1d.updated_at, { contact_id: contactoAjeno.id }), 'CONTACTO_DE_OTRO_CLIENTE')
  rechaza('vendedor de otra empresa', await guardarPedido(admin.c, p1.id, o1d.updated_at, { salesperson_id: adminB.id }), 'VENDEDOR_INVALIDO')
  rechaza('tarifa de otra empresa', await guardarPedido(admin.c, p1.id, o1d.updated_at, { price_list_id: listaB.id }), 'TARIFA_INVALIDA')
  rechaza('tarifa en otra moneda', await guardarPedido(admin.c, p1.id, o1d.updated_at, { price_list_id: listaPesos.id }), 'TARIFA_OTRA_MONEDA')
  rechaza('cliente de otra empresa', await guardarPedido(admin.c, p1.id, o1d.updated_at, { customer_id: clienteB.id }), 'CLIENTE_INVALIDO')
  for (const [campo, valor] of [
    ['company_id', B], ['number', 'ZZ-X'], ['series_code', 'ZZ'], ['commercial_status', 'confirmed'],
    ['status', 'confirmed'], ['created_by', adminB.id], ['imported_at', '2020-01-01T00:00:00Z'],
    ['external_id', 'zz'], ['quote_id', randomUUID()], ['id', randomUUID()], ['total', 1], ['subtotal', 1],
    ['fulfillment_status', 'delivered'],
  ]) {
    rechaza(`cabecera con ${campo}`, await guardarPedido(admin.c, p1.id, o1d.updated_at, { [campo]: valor }), 'CAMPO_NO_PERMITIDO')
  }
  rechaza('cantidad 0', await guardarPedido(admin.c, p1.id, o1d.updated_at, {}, [{ line_no: 1, quantity: 0, unit_price: 1 }]), 'CANTIDAD_INVALIDA')
  rechaza('precio negativo', await guardarPedido(admin.c, p1.id, o1d.updated_at, {}, [{ line_no: 1, quantity: 1, unit_price: -5 }]), 'PRECIO_INVALIDO')
  rechaza('descuento 150', await guardarPedido(admin.c, p1.id, o1d.updated_at, {}, [{ line_no: 1, quantity: 1, unit_price: 1, discount_pct: 150 }]), 'DESCUENTO_INVALIDO')
  rechaza('producto de otra empresa', await guardarPedido(admin.c, p1.id, o1d.updated_at, {}, [{ line_no: 1, quantity: 1, unit_price: 1, product_id: productoB.id }]), 'PRODUCTO_INVALIDO')
  rechaza('línea de otro pedido', await guardarPedido(admin.c, p1.id, o1d.updated_at, {}, [{ id: randomUUID(), line_no: 1, quantity: 1, unit_price: 1 }]), 'LINEA_AJENA')
  cmp('nada de eso cambió el pedido', o1d.updated_at, (await pedido(p1.id)).updated_at)

  rechaza('alta sin cliente', await crearPedido(admin.c, { currency_code: 'USD' }), 'CLIENTE_REQUERIDO')
  rechaza('alta sin moneda', await crearPedido(admin.c, { customer_id: cliente.id }), 'DOCUMENT_CURRENCY_REQUIRED')
  rechaza('alta con campo de sistema', await crearPedido(admin.c, { ...CAB, quote_id: randomUUID() }), 'CAMPO_NO_PERMITIDO')

  // ── 4 · Permisos ─────────────────────────────────────────────────────────
  seccion('4 · Permisos')

  const oActual = await pedido(p1.id)
  rechaza('anon no crea', await crearPedido(anon))
  rechaza('vendedor no crea', await crearPedido(vendedor.c), 'SIN_PERMISO')
  rechaza('técnico no crea', await crearPedido(tecnico.c), 'SIN_PERMISO')
  rechaza('cliente del portal no crea', await crearPedido(portal.c), 'SIN_PERMISO')
  rechaza('admin de otra empresa no crea acá', await crearPedido(adminB.c), 'SIN_PERMISO')
  rechaza('vendedor no guarda', await guardarPedido(vendedor.c, p1.id, oActual.updated_at, { title: 'x' }), 'SIN_PERMISO')
  rechaza('admin de otra empresa no guarda', await guardarPedido(adminB.c, p1.id, oActual.updated_at, { title: 'x' }), 'SIN_PERMISO')
  rechaza('anon no guarda', await guardarPedido(anon, p1.id, oActual.updated_at, { title: 'x' }))

  // ── 5 · Conversión ───────────────────────────────────────────────────────
  seccion('5 · Cotización → pedido: el snapshot aprobado')

  const q1 = ok(await admin.c.rpc('crear_cotizacion', {
    p_company: A,
    p_cabecera: {
      customer_id: cliente.id, currency_code: 'USD', contact_id: contacto.id,
      salesperson_id: employee.id, price_list_id: listaMayorista.id,
      payment_terms: '60 días', discount_pct: 5, perception_pct: 2.5, title: 'ZZ Cotizada',
    },
    p_lineas: [{ ...LINEA, unit_price: 80, description_snapshot: 'ZZ descripción aprobada' }],
  }), 'cotización origen')

  // La tarifa cambia DESPUÉS de cotizar: el pedido no tiene que enterarse.
  ok(await s.from('product_prices').update({ amount: 999 }).eq('price_list_id', listaMayorista.id).eq('product_id', producto.id), 'cambiar precio')

  const conv = ok(await convertir(admin.c, q1.id), 'convertir')
  const oConv = await pedido(conv.id)
  const lineasConv = await lineasDe(conv.id)
  cmp('el pedido nace de la cotización', `quote/${q1.id}`, `${oConv.origin}/${oConv.quote_id}`)
  cmp('copia cliente, contacto, vendedor y tarifa', `${cliente.id}/${contacto.id}/${employee.id}/${listaMayorista.id}`,
    `${oConv.customer_id}/${oConv.contact_id}/${oConv.salesperson_id}/${oConv.price_list_id}`)
  cmp('copia moneda, condiciones y descuentos', 'USD/60 días/5/2.50',
    `${oConv.currency_code}/${oConv.payment_terms}/${Number(oConv.discount_pct)}/${Number(oConv.perception_pct).toFixed(2)}`)
  cmp('conserva el PRECIO APROBADO, no el nuevo de la tarifa', '80.00', Number(lineasConv[0].unit_price).toFixed(2))
  cmp('conserva la descripción de la cotización', 'ZZ descripción aprobada', lineasConv[0].description_snapshot)
  cmp('deja el rastro de la línea de origen', true, lineasConv[0].quote_line_id !== null)
  cmp('el pedido nace borrador', 'draft', oConv.commercial_status)
  const qDespues = (await s.from('sales_quotes').select('status, updated_at').eq('id', q1.id).single()).data
  cmp('la cotización no cambia de estado al convertir', 'draft', qDespues.status)
  const auditConv = ok(await s.from('sales_audit').select('*').eq('entity_id', conv.id), 'auditoría conversión')
  cmp('un evento created que dice de qué cotización viene', true,
    auditConv.length === 1 && auditConv[0].diff.origen === 'quote' && auditConv[0].diff.cotizacion === q1.number)

  rechaza('convertir dos veces', await convertir(admin.c, q1.id), 'PEDIDO_YA_EXISTE')

  // Doble clic simultáneo sobre otra cotización.
  const q2 = ok(await admin.c.rpc('crear_cotizacion', {
    p_company: A, p_cabecera: { customer_id: cliente.id, currency_code: 'USD' }, p_lineas: [LINEA],
  }), 'cotización 2')
  const [x1, x2] = await Promise.all([convertir(admin.c, q2.id), convertir(employee.c, q2.id)])
  cmp('doble conversión simultánea: un solo pedido', 1, [x1, x2].filter((r) => !r.error).length)
  cmp('…y en la base hay uno solo', 1, await cuenta('sales_orders', (q) => q.eq('quote_id', q2.id)))

  const q3 = ok(await admin.c.rpc('crear_cotizacion', {
    p_company: A, p_cabecera: { customer_id: cliente.id, currency_code: 'USD' }, p_lineas: [LINEA],
  }), 'cotización 3')
  rechaza('convertir con testigo viejo', await convertir(admin.c, q3.id, '2020-01-01T00:00:00Z'), 'CONFLICTO_DE_EDICION')
  cmp('no se creó nada', 0, await cuenta('sales_orders', (q) => q.eq('quote_id', q3.id)))
  rechaza('un vendedor no convierte', await convertir(vendedor.c, q3.id), 'SIN_PERMISO')
  rechaza('el admin de otra empresa no convierte', await convertir(adminB.c, q3.id), 'SIN_PERMISO')

  // ── 6 · Autoridad ────────────────────────────────────────────────────────
  seccion('6 · Autoridad de numeración')

  ok(await s.from('document_numbering_authority').insert({
    company_id: A, doc_type: 'sales_order', authority: 'STEL', reason: 'ZZ E4 prueba',
  }), 'autoridad STEL')
  const antesStel = { orders: await cuenta('sales_orders', (q) => q.eq('company_id', A)), num: await secuencia('sales_order') }
  rechaza('con STEL no se crea el pedido', await crearPedido(admin.c), 'external_numbering_authority')
  rechaza('con STEL tampoco se convierte', await convertir(admin.c, q3.id), 'external_numbering_authority')
  cmp('ni se creó nada ni se consumió número',
    `${antesStel.orders}/${antesStel.num}`,
    `${await cuenta('sales_orders', (q) => q.eq('company_id', A))}/${await secuencia('sales_order')}`)
  ok(await s.from('document_numbering_authority').delete().eq('company_id', A).eq('doc_type', 'sales_order'), 'quitar autoridad')

  // ── 7 · Downstream ───────────────────────────────────────────────────────
  seccion('7 · Un pedido con entrega no se edita')

  const conEntrega = ok(await crearPedido(admin.c), 'pedido con entrega')
  const oEnt = await pedido(conEntrega.id)
  ok(await s.from('deliveries').insert({
    company_id: A, number: `ZRA${sello}`, series_code: 'ZRA', order_id: conEntrega.id,
    customer_id: cliente.id, delivery_date: '2026-09-17', status: 'draft', currency_code: 'USD',
  }), 'entrega')
  rechaza('con entregas, guardar se rechaza', await guardarPedido(admin.c, conEntrega.id, oEnt.updated_at, { title: 'ZZ no' }), 'PEDIDO_CON_ENTREGAS')
  cmp('el pedido quedó intacto', oEnt.updated_at, (await pedido(conEntrega.id)).updated_at)

  ok(await s.from('sales_orders').update({ commercial_status: 'cancelled' }).eq('id', p1.id), 'cancelar')
  const oCanc = await pedido(p1.id)
  rechaza('un pedido cancelado no se edita', await guardarPedido(admin.c, p1.id, oCanc.updated_at, { title: 'ZZ no' }), 'ESTADO_NO_EDITABLE')

  // ── 8 · Stock y reservas ─────────────────────────────────────────────────
  seccion('8 · Crear y editar pedidos no mueve stock ni reservas')

  cmp('sin movimientos de stock de la empresa de fixture', 0, await cuenta('stock_movements', (q) => q.eq('company_id', A)))
  cmp('sin reservas de la empresa de fixture', 0, await cuenta('stock_reservations', (q) => q.eq('company_id', A)))

  // ── 9 · Limpieza e invariantes ───────────────────────────────────────────
  seccion('9 · Limpieza e invariantes')

  await limpiar()
  creados.empresas = []
  cmp('sin empresas de fixture', 0, await cuenta('companies', (q) => q.like('slug', `${MARCA}-%`)))
  const despuesProd = await baselineProd()
  cmp('producción idéntica al baseline', JSON.stringify(antesProd), JSON.stringify(despuesProd))
}

main()
  .catch(async (e) => {
    fallos++
    console.log(`\n  EXCEPCIÓN: ${e.message}`)
    await limpiar().catch(() => {})
  })
  .finally(() => {
    console.log('\n' + '='.repeat(78))
    console.log(`  RESULTADO: ${fallos} FALLOS`)
    console.log('='.repeat(78))
    process.exit(fallos ? 1 : 0)
  })
