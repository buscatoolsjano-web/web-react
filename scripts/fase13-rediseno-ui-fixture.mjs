/**
 * Fase 13 · Rediseño — fixture visual para capturas antes/después.
 *
 * Crea UNA empresa `zz-f13ui` con datos representativos para mirar las
 * pantallas que cambian con los tokens y las primitivas: listados y detalles
 * de Ventas (cotizaciones y pedidos en cada estado), Compras (proveedores y
 * pedidos), Mantenimiento (equipos y órdenes), Clientes (más de una página),
 * Catálogo (marcas, categorías, productos con precio) y Configuración.
 *
 * No toca Buscatools ni Torquetools, no envía correos (el usuario se crea
 * confirmado y el enlace se genera sin mandar nada) y `limpiar` no deja
 * residuo: se verifica contando filas al final.
 *
 *   set -a; source .env; source .env.migration; set +a
 *   node scripts/fase13-rediseno-ui-fixture.mjs preparar <salida.json> [origen]
 *   node scripts/fase13-rediseno-ui-fixture.mjs limpiar
 *
 * <salida.json> debe estar en una ruta ignorada: guarda un magic link de un
 * solo uso y no se imprime.
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const BASE = process.env.VITE_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !SECRET) { console.error('✗ Faltan variables'); process.exit(1) }
const s = createClient(BASE, SECRET, { auth: { persistSession: false } })
const MARCA = 'zz-f13ui'

// Orden de borrado: hijos antes que padres; los guards de borrado dejan pasar
// a la clave de servicio sobre documentos no importados. Las líneas de venta no
// se borran a mano (su guard las bloquea si el documento no es borrador): caen
// en cascada con la cotización o el pedido.
const TABLAS_EMPRESA = [
  'maintenance_order_checks', 'maintenance_measurements', 'maintenance_order_parts', 'maintenance_quote_lines',
  'maintenance_orders', 'maintenance_assets', 'maintenance_audit',
  'sales_orders', 'sales_quotes',
  'purchase_order_lines', 'purchase_orders', 'purchases_audit', 'suppliers',
  'customer_contacts', 'customer_addresses', 'customers',
  'company_memberships', 'product_prices', 'price_lists', 'products',
  'product_attribute_categories', 'product_attribute_definitions', 'product_categories', 'brands',
  'users_audit', 'company_audit', 'catalog_audit', 'document_numbering_authority', 'document_numbering_authority_audit',
  'document_sequences',
]

async function limpiar() {
  const { data: emp } = await s.from('companies').select('id').like('slug', `${MARCA}-%`)
  const ids = (emp ?? []).map((x) => x.id)
  if (ids.length) {
    for (const t of TABLAS_EMPRESA) {
      const r = await s.from(t).delete().in('company_id', ids)
      if (r.error && !/does not exist|schema cache/.test(r.error.message)) console.log(`    aviso ${t}: ${r.error.message}`)
    }
  }
  const { data: us } = await s.auth.admin.listUsers({ perPage: 1000 })
  for (const u of us?.users ?? []) if (u.email?.startsWith(`${MARCA}-`)) await s.auth.admin.deleteUser(u.id)
  if (ids.length) {
    const r = await s.from('companies').delete().in('id', ids)
    if (r.error) throw new Error(`empresa: ${r.error.message}`)
  }
  const { count } = await s.from('companies').select('id', { count: 'exact', head: true }).like('slug', `${MARCA}-%`)
  const usuarios = (us?.users ?? []).filter((u) => u.email?.startsWith(`${MARCA}-`)).length
  console.log(`    limpio: ${ids.length} empresa(s) y ${usuarios} usuario(s) ${MARCA} borrados; quedan ${count ?? '?'} empresa(s)`)
}

const cmd = process.argv[2]
if (cmd === 'limpiar') { await limpiar(); process.exit(0) }
if (cmd !== 'preparar') { console.error('uso: preparar <salida.json> [origen] | limpiar'); process.exit(1) }
const salida = process.argv[3]
const origen = process.argv[4] ?? 'http://localhost:5173'
if (!salida) { console.error('✗ falta salida'); process.exit(1) }
await limpiar()

const ok = (r, t) => { if (r.error) throw new Error(`${t}: ${r.error.message}`); return r.data }
const dia = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)

const { id } = ok(await s.from('companies').insert({ slug: `${MARCA}-${Date.now()}`, name: 'ZZ Rediseño UI', legal_name: 'ZZ Rediseño SA', default_currency: 'USD' }).select('id').single(), 'empresa')
ok(await s.from('document_sequences').insert([
  ['quote', 'COTI'], ['sales_order', 'PED'], ['delivery', 'REM'], ['purchase_order', 'OC'], ['customer', 'CLI'], ['supplier', 'PRV'], ['maintenance_order', 'OS'],
].map(([doc_type, prefix]) => ({ company_id: id, doc_type, prefix, padding: 5, next_number: 20, series_code: prefix, is_default: true }))), 'secuencias')

// Catálogo
const marcas = ok(await s.from('brands').insert(['ZZ Torero', 'ZZ Atlas', 'ZZ Desoutter'].map((name) => ({ company_id: id, name, is_active: true }))).select('id, name'), 'marcas')
const cat = ok(await s.from('product_categories').insert({ company_id: id, name: 'ZZ Atornilladores', slug: 'zz-atornilladores', position: 1, needs_review: false }).select('id').single(), 'categoría')
const productos = ok(await s.from('products').insert(Array.from({ length: 8 }, (_, i) => ({
  company_id: id, sku: `ZZF13-${String(i + 1).padStart(3, '0')}`, name: `ZZ Atornillador neumático ${i + 1} con embrague de corte y nombre largo para probar el truncado`,
  category_id: cat.id, brand_id: marcas[i % 3].id, status: i === 7 ? 'discontinued' : 'active', attributes: {},
}))).select('id, sku, name'), 'productos')
const lista = ok(await s.from('price_lists').insert({ company_id: id, name: 'ZZ Lista general', currency_code: 'USD', is_default: true }).select('id').single(), 'lista')
ok(await s.from('product_prices').insert(productos.map((p, i) => ({ company_id: id, price_list_id: lista.id, product_id: p.id, amount: 120 + i * 37.5, valid_from: '2026-01-01' }))), 'precios')

// Clientes: 23 para que haya más de una página en mobile y en listados cortos
const clientes = ok(await s.from('customers').insert(Array.from({ length: 23 }, (_, i) => ({
  company_id: id, legal_name: `ZZ Cliente ${String(i + 1).padStart(2, '0')} Industrias Metalúrgicas SA`, trade_name: i % 4 === 0 ? `ZZ Metal ${i + 1}` : null,
  tax_id: `30-7${String(1000000 + i).slice(1)}-${i % 10}`, phone: '011 5555-0000', status: i === 22 ? 'inactive' : 'active', needs_review: i === 3,
  review_reason: i === 3 ? 'ZZ: CUIT a revisar' : null,
}))).select('id'), 'clientes')

// Ventas: cotizaciones en todos los estados y pedidos en los tres comerciales
const estadosCoti = ['draft', 'sent', 'accepted', 'rejected', 'expired', 'draft', 'sent']
const cotis = ok(await s.from('sales_quotes').insert(estadosCoti.map((status, i) => ({
  company_id: id, customer_id: clientes[i].id, number: `COTI-${String(i + 1).padStart(5, '0')}`, series_code: 'COTI', quote_date: dia(i * 3),
  valid_until: dia(i * 3 - 15), currency_code: 'USD', title: `ZZ Provisión de herramientas ${i + 1}`,
}))).select('id'), 'cotizaciones')
for (const [i, q] of cotis.entries()) {
  ok(await s.from('sales_quote_lines').insert(productos.slice(0, 2 + (i % 3)).map((p, n) => ({
    company_id: id, quote_id: q.id, line_no: n + 1, product_id: p.id, sku_snapshot: p.sku, name_snapshot: p.name, quantity: 1 + n, unit_price: 150 + n * 20,
  }))), 'líneas cotización')
  // Las líneas sólo se cargan en borrador; el estado se aplica después.
  if (estadosCoti[i] !== 'draft') ok(await s.from('sales_quotes').update({ status: estadosCoti[i] }).eq('id', q.id), 'estado cotización')
}
const estadosPed = ['draft', 'confirmed', 'confirmed', 'cancelled']
const pedidos = []
for (const [i, commercial_status] of estadosPed.entries()) {
  const p = ok(await s.from('sales_orders').insert({
    company_id: id, customer_id: clientes[i].id, number: `PED-${String(i + 1).padStart(5, '0')}`, series_code: 'PED', order_date: dia(i * 2), currency_code: 'USD', origin: 'manual',
  }).select('id').single(), 'pedido')
  ok(await s.from('sales_order_lines').insert(productos.slice(0, 3).map((pr, n) => ({
    company_id: id, order_id: p.id, line_no: n + 1, product_id: pr.id, sku_snapshot: pr.sku, name_snapshot: pr.name, quantity_ordered: 2 + n, unit_price: 180 + n * 15,
  }))), 'líneas pedido')
  if (commercial_status !== 'draft') ok(await s.from('sales_orders').update({ commercial_status }).eq('id', p.id), 'estado pedido')
  pedidos.push(p)
}

// Compras
const proveedores = ok(await s.from('suppliers').insert(Array.from({ length: 6 }, (_, i) => ({
  company_id: id, legal_name: `ZZ Proveedor ${i + 1} Importadora SRL`, country_code: i % 2 ? 'CN' : 'AR', email: `compras${i + 1}@zz-proveedor.test`, status: i === 5 ? 'inactive' : 'active',
}))).select('id'), 'proveedores')
for (const [i, status] of ['draft', 'confirmed', 'draft'].entries()) {
  const oc = ok(await s.from('purchase_orders').insert({
    company_id: id, supplier_id: proveedores[i].id, number: `OC-${String(i + 1).padStart(5, '0')}`, series_code: 'OC', order_date: dia(i * 4), currency_code: 'USD',
  }).select('id').single(), 'pedido compra')
  ok(await s.from('purchase_order_lines').insert(productos.slice(2, 5).map((p, n) => ({
    company_id: id, purchase_order_id: oc.id, line_no: n + 1, product_id: p.id, sku_snapshot: p.sku, name_snapshot: p.name, quantity: 5 + n, unit_price: 80 + n * 10,
  }))), 'líneas compra')
  if (status !== 'draft') ok(await s.from('purchase_orders').update({ status }).eq('id', oc.id), 'confirmar compra')
}

// Mantenimiento
const equipos = ok(await s.from('maintenance_assets').insert(Array.from({ length: 4 }, (_, i) => ({
  company_id: id, reference: `ZZ-EQ-${i + 1}`, brand_text: 'ZZ Atlas', model_text: `ZZ Tensor ${i + 1}`, serial_number: `ZZSN${1000 + i}`,
  owner_customer_id: clientes[i].id, asset_type: 'atornillador',
}))).select('id, owner_customer_id'), 'equipos')
for (const [i, eq] of equipos.slice(0, 3).entries()) {
  ok(await s.from('maintenance_orders').insert({
    company_id: id, asset_id: eq.id, customer_id: eq.owner_customer_id, number: `OS-${String(i + 1).padStart(5, '0')}`, series_code: 'OS',
    entry_reason: 'ZZ: pierde torque al final del ciclo', on_hold: i === 2,
  }), 'orden mantenimiento')
}

// Usuario admin del fixture (contraseña aleatoria que no se guarda)
const email = `${MARCA}-admin-${Date.now()}@buscatools.test`
const { data: u, error: eu } = await s.auth.admin.createUser({ email, password: `Zz${randomUUID()}!`, email_confirm: true, user_metadata: { full_name: 'ZZ Admin Rediseño' } })
if (eu) throw new Error(`usuario: ${eu.message}`)
await s.from('profiles').update({ full_name: 'ZZ Admin Rediseño' }).eq('id', u.user.id)
ok(await s.from('company_memberships').insert({ company_id: id, user_id: u.user.id, role: 'admin', status: 'active' }), 'membresía')

// E2: segunda empresa zz donde el mismo usuario es VENDEDOR, para probar el
// selector de empresa y que la navegación cambie con el rol de la membresía.
const { id: idB } = ok(await s.from('companies').insert({ slug: `${MARCA}-b-${Date.now()}`, name: 'ZZ Rediseño B', legal_name: 'ZZ Rediseño B SA', default_currency: 'USD' }).select('id').single(), 'empresa B')
ok(await s.from('company_memberships').insert({ company_id: idB, user_id: u.user.id, role: 'salesperson', status: 'active' }), 'membresía B')

const link = (await s.auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo: `${origen}/` } })).data.properties.action_link

// E3: empresa zz con numeración STEL en cotizaciones, pedidos y remitos, para ver
// la emisión bloqueada. Los borradores se crean ANTES de fijar la autoridad
// (el guard de E2.5 impide emitir después); el admin es el mismo usuario.
const { id: idS } = ok(await s.from('companies').insert({ slug: `${MARCA}-stel-${Date.now()}`, name: 'ZZ Rediseño STEL', legal_name: 'ZZ Rediseño STEL SA', default_currency: 'USD' }).select('id').single(), 'empresa STEL')
ok(await s.from('document_sequences').insert(['quote', 'sales_order', 'delivery'].map((doc_type) => ({ company_id: idS, doc_type, prefix: doc_type.slice(0, 3).toUpperCase(), padding: 5, next_number: 5, series_code: doc_type.slice(0, 3).toUpperCase(), is_default: true }))), 'secuencias STEL')
const cliS = ok(await s.from('customers').insert({ company_id: idS, legal_name: 'ZZ Cliente STEL SA', status: 'active' }).select('id').single(), 'cliente STEL')
const cotS = ok(await s.from('sales_quotes').insert({ company_id: idS, customer_id: cliS.id, number: 'QUO-00001', series_code: 'QUO', quote_date: dia(1), currency_code: 'USD', title: 'ZZ Cotización bajo STEL' }).select('id').single(), 'cotización STEL')
ok(await s.from('sales_quote_lines').insert({ company_id: idS, quote_id: cotS.id, line_no: 1, sku_snapshot: 'ZZ-LIBRE', name_snapshot: 'ZZ Servicio', quantity: 1, unit_price: 100 }), 'línea cotización STEL')
const pedS = ok(await s.from('sales_orders').insert({ company_id: idS, customer_id: cliS.id, number: 'SAL-00001', series_code: 'SAL', order_date: dia(1), currency_code: 'USD', origin: 'manual' }).select('id').single(), 'pedido STEL')
ok(await s.from('sales_order_lines').insert({ company_id: idS, order_id: pedS.id, line_no: 1, sku_snapshot: 'ZZ-LIBRE', name_snapshot: 'ZZ Servicio', quantity_ordered: 2, unit_price: 100 }), 'línea pedido STEL')
ok(await s.from('document_numbering_authority').insert(['quote', 'sales_order', 'delivery'].map((doc_type) => ({ company_id: idS, doc_type, authority: 'STEL', reason: 'ZZ rediseño: emisión bloqueada' }))), 'autoridad STEL')
ok(await s.from('company_memberships').insert({ company_id: idS, user_id: u.user.id, role: 'admin', status: 'active' }), 'membresía STEL')

// E2: un usuario zz SIN membresía, para ver el estado «sin empresa activa» del shell.
const emailSin = `${MARCA}-sinempresa-${Date.now()}@buscatools.test`
const { error: es } = await s.auth.admin.createUser({ email: emailSin, password: `Zz${randomUUID()}!`, email_confirm: true, user_metadata: { full_name: 'ZZ Sin Empresa' } })
if (es) throw new Error(`usuario sin empresa: ${es.message}`)
const linkSin = (await s.auth.admin.generateLink({ type: 'magiclink', email: emailSin, options: { redirectTo: `${origen}/` } })).data.properties.action_link

writeFileSync(salida, JSON.stringify({ empresa: id, empresaStel: idS, admin: link, sinEmpresa: linkSin, cotizacion: cotis[1].id, cotizacionBorrador: cotis[0].id, pedido: pedidos[1].id, pedidoBorrador: pedidos[0].id, cotizacionStel: cotS.id, pedidoStel: pedS.id, cliente: clientes[0].id }))
console.log(`    preparado: ${productos.length} productos, ${clientes.length} clientes, ${cotis.length} cotizaciones, ${pedidos.length} pedidos, ${proveedores.length} proveedores, 3 compras, ${equipos.length} equipos, 3 órdenes (el enlace quedó en el archivo, no se imprime)`)
