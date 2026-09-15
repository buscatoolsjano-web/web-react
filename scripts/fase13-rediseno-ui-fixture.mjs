/**
 * Fase 13 · Rediseño — fixture visual para capturas antes/después.
 *
 * Crea UNA empresa `zz-f13ui` con datos representativos para mirar las
 * pantallas que cambian con los tokens y las primitivas: listados y detalles
 * de Ventas (cotizaciones y pedidos en cada estado), Compras (proveedores y
 * pedidos), Mantenimiento (equipos y órdenes), Clientes (más de una página),
 * Catálogo (marcas, categorías, productos con precio), Configuración y, desde
 * E5, metadata de Emails (sin Gmail) y paneles de Mantenimiento.
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
  'email_events', 'email_send_requests', 'email_thread_state', 'email_threads',
  'maintenance_order_checks', 'maintenance_measurements', 'maintenance_order_parts', 'maintenance_quote_lines',
  'maintenance_orders', 'maintenance_assets', 'maintenance_check_points', 'maintenance_audit',
  'sales_orders', 'sales_quotes',
  'purchase_order_lines', 'purchase_orders', 'purchases_audit', 'suppliers',
  // Las membresías de portal apuntan a un cliente: se borran antes que customers.
  'company_memberships',
  'customer_product_aliases', 'customer_contacts', 'customer_addresses', 'customers', 'email_accounts', 'warehouses',
  'product_prices', 'price_lists', 'product_images', 'products',
  'product_attribute_categories', 'product_attribute_definitions', 'product_categories', 'brands',
  'users_audit', 'company_audit', 'catalog_audit', 'document_numbering_authority', 'document_numbering_authority_audit',
  'document_sequences',
]

async function limpiar() {
  const { data: emp } = await s.from('companies').select('id').like('slug', `${MARCA}-%`)
  const ids = (emp ?? []).map((x) => x.id)
  if (ids.length) {
    // email_thread_reads y email_sync_log no tienen company_id: se borran por cuenta.
    const { data: cuentas } = await s.from('email_accounts').select('id').in('company_id', ids)
    const idsCuentas = (cuentas ?? []).map((c) => c.id)
    if (idsCuentas.length) {
      for (const t of ['email_thread_reads', 'email_sync_log']) {
        const r = await s.from(t).delete().in('account_id', idsCuentas)
        if (r.error && !/does not exist|schema cache/.test(r.error.message)) console.log(`    aviso ${t}: ${r.error.message}`)
      }
    }
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

// E4 · Catálogo: segunda categoría con subtipos y atributos filtrables, 22
// productos más (paginado de 25), fotos propias del sitio, una rota, una
// galería con diagrama, kits, a revisar y sin precio.
const defs = ok(await s.from('product_attribute_definitions').insert([
  { company_id: id, key: 'zz_torque', label: 'ZZ Torque máximo', data_type: 'number', unit: 'Nm', is_filterable: true, position: 1 },
  { company_id: id, key: 'zz_encastre', label: 'ZZ Encastre', data_type: 'text', unit: null, is_filterable: true, position: 2 },
]).select('id, key'), 'atributos')
const cat2 = ok(await s.from('product_categories').insert({ company_id: id, name: 'ZZ Llaves de torque', slug: 'zz-llaves-torque', position: 2, needs_review: false }).select('id').single(), 'categoría 2')
ok(await s.from('product_attribute_categories').insert(defs.map((d) => ({ company_id: id, attribute_definition_id: d.id, category_id: cat2.id }))), 'atributos por categoría')
const TIPOS = ['ZZ Click', 'ZZ Digital', 'ZZ Dial']
const ENCASTRES = ['1/4 HEX', '3/8 cuadrado', '1/2 cuadrado']
const productos2 = ok(await s.from('products').insert(Array.from({ length: 22 }, (_, i) => ({
  company_id: id, sku: `ZZF13-L${String(i + 1).padStart(2, '0')}`, name: i === 0 ? 'ZZ Llave' : `ZZ Llave de torque ${TIPOS[i % 3]} ${10 + i * 5} Nm`,
  category_id: cat2.id, brand_id: i % 5 === 4 ? null : marcas[i % 3].id, status: 'active', product_type: TIPOS[i % 3], series: i % 4 === 0 ? `ZZS-${i}` : null,
  is_kit: i === 2, needs_review: i === 5, attributes: { zz_torque: 10 + i * 5, zz_encastre: ENCASTRES[i % 3] },
  model_code: i === 1 ? 'ZZ-M1' : null, description: i === 1 ? 'ZZ Llave de torque con escala doble y certificado de calibración.' : null,
  origin_country: i === 1 ? 'DE' : null, weight_g: i === 1 ? 850 : null,
}))).select('id, sku'), 'productos E4')
ok(await s.from('product_prices').insert(productos2.filter((_, i) => i % 3 !== 2).map((p, i) => ({ company_id: id, price_list_id: lista.id, product_id: p.id, amount: 95.5 + i * 41.25, valid_from: '2026-01-01' }))), 'precios E4')
const foto = `${origen}/brand/buscatools-logo.png`
ok(await s.from('product_images').insert([
  ...productos2.filter((_, i) => i % 2 === 1).map((p) => ({ company_id: id, product_id: p.id, source_url: foto, kind: 'product_image', position: 0, is_primary: true })),
  { company_id: id, product_id: productos2[1].id, source_url: `${foto}?vista=2`, kind: 'product_image', position: 1, is_primary: false },
  { company_id: id, product_id: productos2[1].id, source_url: `${foto}?diagrama=1`, kind: 'shared_diagram', position: 2, is_primary: false },
  { company_id: id, product_id: productos2[4].id, source_url: `${origen}/brand/zz-no-existe.png`, kind: 'product_image', position: 0, is_primary: true },
]), 'imágenes E4')

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

// E4 · Clientes: el 01 con ficha completa (emails, dominios, rubro, condiciones,
// notas, contactos, direcciones y equivalencias) y uno mínimo, sólo razón social.
ok(await s.from('customers').update({
  trade_name: 'ZZ Metalúrgica Uno', emails: ['compras@zz-cliente.test', 'pagos@zz-cliente.test'], email_domains: ['zz-cliente.test'],
  industry: 'ZZ Metalmecánica', payment_terms: '30 días fecha factura', default_currency: 'USD', notes: 'ZZ: recibe mercadería de 8 a 14 h.',
}).eq('id', clientes[0].id), 'cliente completo')
ok(await s.from('customer_contacts').insert([
  { company_id: id, customer_id: clientes[0].id, full_name: 'ZZ Ana Compras', role: 'Jefa de compras', email: 'ana@zz-cliente.test', phone: '011 5555-0101', is_default: true },
  { company_id: id, customer_id: clientes[0].id, full_name: 'ZZ Bruno Planta', role: 'Mantenimiento', phone: '011 5555-0102', is_default: false, notes: 'ZZ: turno tarde' },
]), 'contactos')
ok(await s.from('customer_addresses').insert([
  { company_id: id, customer_id: clientes[0].id, kind: 'both', is_default: true, street: 'ZZ Av. Siempre Viva 742', city: 'ZZ Ciudad', state: 'ZZ Provincia', postal_code: '1000', country_code: 'AR' },
  { company_id: id, customer_id: clientes[0].id, kind: 'shipping', is_default: false, street: 'ZZ Calle Depósito 100', city: 'ZZ Parque Industrial', country_code: 'AR' },
]), 'direcciones')
ok(await s.from('customer_product_aliases').insert([
  { company_id: id, customer_id: clientes[0].id, customer_code: 'ZZ-A1', customer_description: 'ZZ atornillador chico', normalized_key: 'zz-a1', product_id: productos[0].id, status: 'confirmed', source: 'manual' },
  { company_id: id, customer_id: clientes[0].id, customer_code: 'ZZ-A2', customer_description: 'ZZ llave dial', normalized_key: 'zz-a2', product_id: productos2[0].id, status: 'suggested', source: 'ai' },
  { company_id: id, customer_id: clientes[0].id, customer_code: 'ZZ-A3', customer_description: 'ZZ repuesto viejo', normalized_key: 'zz-a3', product_id: productos[1].id, status: 'rejected', source: 'legacy' },
]), 'equivalencias')
const clienteMinimo = ok(await s.from('customers').insert({ company_id: id, legal_name: 'ZZ Cliente Mínimo SA', status: 'active' }).select('id').single(), 'cliente mínimo')

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
// E5 · Mantenimiento: una orden con torque y datos en cada panel (revisión,
// cotización y un repuesto SIN consumir: no mueve stock).
const puntos = ok(await s.from('maintenance_check_points').insert(['ZZ Embrague', 'ZZ Motor neumático', 'ZZ Carcasa'].map((label, i) => ({
  company_id: id, key: `zz_punto_${i + 1}`, label, sort_order: i + 1, active: true,
}))).select('id'), 'puntos de revisión')
const os4 = ok(await s.from('maintenance_orders').insert({
  company_id: id, asset_id: equipos[3].id, customer_id: equipos[3].owner_customer_id, number: 'OS-00004', series_code: 'OS',
  entry_reason: 'ZZ: calibración anual con informe de torque', service_type: 'preventive', torque_required: true,
  visual_condition: 'ZZ: carcasa con marcas de uso, sin golpes.', quote_currency_code: 'USD',
}).select('id').single(), 'orden con torque')
ok(await s.from('maintenance_order_checks').insert(puntos.slice(0, 2).map((p, i) => ({
  company_id: id, maintenance_order_id: os4.id, check_point_id: p.id, phase: 'diagnosis', result: i === 0 ? 'ok' : 'nok',
}))), 'revisiones')
ok(await s.from('maintenance_quote_lines').insert([
  { company_id: id, maintenance_order_id: os4.id, line_no: 1, line_type: 'labour', description_snapshot: 'ZZ Mano de obra de calibración', quantity: 2, unit_price: 45 },
  { company_id: id, maintenance_order_id: os4.id, line_no: 2, line_type: 'part', product_id: productos[0].id, sku_snapshot: productos[0].sku, description_snapshot: 'ZZ Kit de embrague', quantity: 1, unit_price: 120 },
]), 'cotización')
ok(await s.from('maintenance_measurements').insert([1, 2, 3].map((row_no) => ({
  company_id: id, maintenance_order_id: os4.id, row_no, min_value: 9.5, max_value: 10.5, target_value: 10,
}))), 'mediciones')
const deposito = ok(await s.from('warehouses').insert({ company_id: id, code: 'ZZ-DEP', name: 'ZZ Depósito', is_default: true, is_active: true }).select('id').single(), 'depósito')
ok(await s.from('maintenance_order_parts').insert({
  company_id: id, maintenance_order_id: os4.id, product_id: productos[0].id, warehouse_id: deposito.id, quantity: 1, sku_snapshot: productos[0].sku, name_snapshot: productos[0].name,
}), 'repuesto')

// Usuario admin del fixture (contraseña aleatoria que no se guarda)
const email = `${MARCA}-admin-${Date.now()}@buscatools.test`
const { data: u, error: eu } = await s.auth.admin.createUser({ email, password: `Zz${randomUUID()}!`, email_confirm: true, user_metadata: { full_name: 'ZZ Admin Rediseño' } })
if (eu) throw new Error(`usuario: ${eu.message}`)
await s.from('profiles').update({ full_name: 'ZZ Admin Rediseño' }).eq('id', u.user.id)
ok(await s.from('company_memberships').insert({ company_id: id, user_id: u.user.id, role: 'admin', status: 'active' }), 'membresía')

// E5 · Emails: SÓLO metadata local. La cuenta usa un dominio .test que no está en
// ALLOWED_GMAIL_MAILBOXES ni en el Workspace: el backend no puede delegar en ella
// y nada llega a Gmail. No se crean borradores ni envíos.
const cuentaMail = ok(await s.from('email_accounts').insert({
  company_id: id, provider: 'gmail', email_address: `${MARCA}-buzon-${Date.now()}@buscatools.test`, display_name: 'ZZ Buzón', auth_mode: 'dwd', active: true,
}).select('id').single(), 'cuenta de correo')
const HILOS = [
  { asunto: 'ZZ Pedido de cotización: atornilladores neumáticos para línea 3', de: 'ZZ Ana Compras <ana@zz-cliente.test>', dir: 'in', msgs: 3, adj: true, estado: 'pendiente', leido: false, cliente: true },
  { asunto: 'ZZ Re: Envío de la orden de compra 4512', de: 'ZZ Buzón <buzon@zz.test>', dir: 'out', msgs: 5, adj: false, estado: 'en_proceso', leido: true, cliente: true, asignado: true },
  { asunto: '', de: 'ZZ Proveedor <ventas@zz-proveedor.test>', dir: 'in', msgs: 1, adj: false, estado: 'pendiente', leido: false },
  { asunto: 'ZZ Consulta por calibración con un asunto bastante largo para ver cómo se recorta en la bandeja en mobile', de: 'ZZ Bruno Planta <bruno@zz-cliente.test>', dir: 'in', msgs: 2, adj: true, estado: 'resuelto', leido: true },
  { asunto: 'ZZ Factura de marzo', de: 'ZZ Contabilidad <pagos@zz-cliente.test>', dir: 'in', msgs: 1, adj: true, estado: 'pendiente', leido: false, asignado: true },
]
const hilosCreados = ok(await s.from('email_threads').insert(HILOS.map((h, i) => ({
  company_id: id, account_id: cuentaMail.id, gmail_thread_id: `zz-hilo-${i + 1}`, subject: h.asunto || null,
  snippet: `ZZ extracto del mensaje ${i + 1}: gracias por la respuesta, quedamos atentos.`,
  last_message_at: new Date(Date.now() - i * 5 * 3600000).toISOString(), last_message_from: h.de, last_message_dir: h.dir,
  participants: [h.de, 'ZZ Buzón <buzon@zz.test>'], gmail_labels: ['INBOX'], message_count: h.msgs, has_attachments: h.adj,
}))).select('id, gmail_thread_id'), 'hilos')
ok(await s.from('email_thread_state').insert(HILOS.map((h, i) => ({
  company_id: id, account_id: cuentaMail.id, gmail_thread_id: `zz-hilo-${i + 1}`, workflow_status: h.estado,
  assigned_to: h.asignado ? u.user.id : null, customer_id: h.cliente ? clientes[0].id : null, vinculo_origen: h.cliente ? 'exacto' : null,
}))), 'estado de hilos')
ok(await s.from('email_thread_reads').insert(HILOS.flatMap((h, i) => (h.leido ? [{
  account_id: cuentaMail.id, gmail_thread_id: `zz-hilo-${i + 1}`, user_id: u.user.id, last_read_at: new Date().toISOString(),
}] : []))), 'leídos')

// E5 · Configuración → Auditoría: eventos de ejemplo en la empresa zz (uno de
// usuarios y cuatro de catálogo) para ver el listado, los filtros y el plural.
const { data: membresia } = await s.from('company_memberships').select('id').eq('company_id', id).eq('user_id', u.user.id).single()
ok(await s.from('users_audit').insert({ company_id: id, membership_id: membresia.id, target_user_id: u.user.id, action: 'MEMBERSHIP_ADDED', to_role: 'admin', to_status: 'active', actor_id: u.user.id }), 'auditoría usuarios')
ok(await s.from('catalog_audit').insert([
  ...marcas.map((m) => ({ company_id: id, entity_type: 'brand', entity_id: m.id, entity_name: m.name, action: 'BRAND_CREATED', actor_id: u.user.id })),
  { company_id: id, entity_type: 'category', entity_id: cat2.id, entity_name: 'ZZ Llaves de torque', action: 'CATEGORY_CREATED', actor_id: u.user.id },
]), 'auditoría catálogo')

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

// E6: el Inicio por rol. Tres empresas zz sin datos donde el mismo usuario es
// admin (empresa vacía), técnico y cliente: el selector de empresa cambia el rol.
for (const [sufijo, nombre, role] of [['vacia', 'ZZ Rediseño Vacía', 'admin'], ['tecnico', 'ZZ Rediseño Técnico', 'technician'], ['cliente', 'ZZ Rediseño Portal', 'customer']]) {
  const { id: idR } = ok(await s.from('companies').insert({ slug: `${MARCA}-${sufijo}-${Date.now()}`, name: nombre, legal_name: `${nombre} SA`, default_currency: 'USD' }).select('id').single(), `empresa ${sufijo}`)
  // Un cliente tiene que estar vinculado a un cliente de la empresa (chk_external_link).
  const externo = role === 'customer' ? { customer_id: ok(await s.from('customers').insert({ company_id: idR, legal_name: 'ZZ Cliente del portal SA', status: 'active' }).select('id').single(), 'cliente portal').id } : {}
  ok(await s.from('company_memberships').insert({ company_id: idR, user_id: u.user.id, role, status: 'active', ...externo }), `membresía ${sufijo}`)
}

// E6: otro usuario zz para ver «Elegí una contraseña nueva». `generateLink` no
// manda correo; es un usuario aparte para no invalidar el enlace del admin.
const emailRec = `${MARCA}-recupero-${Date.now()}@buscatools.test`
const { error: er } = await s.auth.admin.createUser({ email: emailRec, password: `Zz${randomUUID()}!`, email_confirm: true, user_metadata: { full_name: 'ZZ Recupero' } })
if (er) throw new Error(`usuario recupero: ${er.message}`)
const linkRec = (await s.auth.admin.generateLink({ type: 'recovery', email: emailRec, options: { redirectTo: `${origen}/` } })).data.properties.action_link

// E2: un usuario zz SIN membresía, para ver el estado «sin empresa activa» del shell.
const emailSin = `${MARCA}-sinempresa-${Date.now()}@buscatools.test`
const { error: es } = await s.auth.admin.createUser({ email: emailSin, password: `Zz${randomUUID()}!`, email_confirm: true, user_metadata: { full_name: 'ZZ Sin Empresa' } })
if (es) throw new Error(`usuario sin empresa: ${es.message}`)
const linkSin = (await s.auth.admin.generateLink({ type: 'magiclink', email: emailSin, options: { redirectTo: `${origen}/` } })).data.properties.action_link

writeFileSync(salida, JSON.stringify({ empresa: id, ordenTorque: os4.id, hilo: hilosCreados[0].id, hiloSinAsunto: hilosCreados[2].id, clienteCompleto: clientes[0].id, clienteMinimo: clienteMinimo.id, skuGaleria: productos2[1].sku, skuSinImagen: productos2[0].sku, skuImagenRota: productos2[4].sku, empresaStel: idS, admin: link, sinEmpresa: linkSin, recuperacion: linkRec, cotizacion: cotis[1].id, cotizacionBorrador: cotis[0].id, pedido: pedidos[1].id, pedidoBorrador: pedidos[0].id, cotizacionStel: cotS.id, pedidoStel: pedS.id, cliente: clientes[0].id }))
console.log(`    preparado: ${productos.length + productos2.length} productos, ${clientes.length + 1} clientes, ${cotis.length} cotizaciones, ${pedidos.length} pedidos, ${proveedores.length} proveedores, 3 compras, ${equipos.length} equipos, 3 órdenes (el enlace quedó en el archivo, no se imprime)`)
