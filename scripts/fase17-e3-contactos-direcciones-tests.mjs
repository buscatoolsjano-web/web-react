/**
 * Fase 17 · E3 — contactos, direcciones y la dirección de entrega del pedido.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase17-e3-contactos-direcciones-tests.mjs
 *
 * Lo que prueba, midiendo el EFECTO:
 *   1. guardar_contacto: alta, edición, whitelist, concurrencia y no-op
 *   2. principal: queda UNO solo, y se resuelve dentro de la misma transacción
 *   3. desactivar en vez de borrar lo que ya nombra un documento
 *   4. permisos: el vendedor administra SUS clientes, no los ajenos
 *   5. direcciones: lo mismo, con principal por tipo y validaciones propias
 *   6. el pedido elige dirección de entrega, validada contra el cliente
 *   7. el remito la congela al emitirse (el snapshot de E6, de punta a punta)
 *   8. auditoría de todo lo anterior, contra el cliente
 *   9. limpieza e invariantes de producción
 *
 * Todo lleva el prefijo zz-e3c y se borra al final. No toca WhatsApp.
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

const MARCA = 'zz-e3c'
const creados = { usuarios: [], empresas: [] }
const ok = (r, q) => { if (r.error) throw new Error(`${q}: ${r.error.message}`); return r.data }
const cuenta = async (t, filtro = (q) => q) => (await filtro(s.from(t).select('*', { count: 'exact', head: true }))).count

const usuarioTemporal = async (companyId, rol) => {
  const email = `${MARCA}-${rol}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@buscatools.test`
  const password = `Zz${randomUUID()}!`
  const { data, error } = await s.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`crear ${rol}: ${error.message}`)
  creados.usuarios.push(data.user.id)
  ok(await s.from('company_memberships').insert({
    company_id: companyId, user_id: data.user.id, role: rol, status: 'active',
  }), `membresía ${rol}`)
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
    await borrar('stock_movements')
    await borrar('stock_balances')
    await borrar('delivery_lines')
    await borrar('deliveries')
    await borrar('sales_orders')
    await borrar('sales_quotes')
    await borrar('warehouses')
    await borrar('products')
    await borrar('product_categories')
    await borrar('customer_addresses')
    await borrar('customer_contacts')
    await borrar('company_memberships')
    await borrar('customers')
    await borrar('price_lists')
    await borrar('document_sequences')
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
  console.log('  FASE 17 · CLIENTES E3 — contactos, direcciones y entrega')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(78))

  await barrerRestos()

  const { data: prodEmpresas } = await s.from('companies').select('id, slug').in('slug', PRODUCCION)
  const prodIds = prodEmpresas.map((e) => e.id)
  const baselineProd = async () => ({
    clientes: await cuenta('customers', (q) => q.in('company_id', prodIds)),
    contactos: await cuenta('customer_contacts', (q) => q.in('company_id', prodIds)),
    contactosPrincipales: await cuenta('customer_contacts', (q) => q.in('company_id', prodIds).eq('is_default', true)),
    contactosInactivos: await cuenta('customer_contacts', (q) => q.in('company_id', prodIds).eq('active', false)),
    direcciones: await cuenta('customer_addresses', (q) => q.in('company_id', prodIds)),
    pedidos: await cuenta('sales_orders', (q) => q.in('company_id', prodIds)),
    pedidosConDireccion: await cuenta('sales_orders', (q) => q.in('company_id', prodIds).not('shipping_address_id', 'is', null)),
    remitos: await cuenta('deliveries', (q) => q.in('company_id', prodIds)),
    auditoria: await cuenta('sales_audit', (q) => q.in('company_id', prodIds)),
  })
  const antesProd = await baselineProd()
  console.log(`  baseline producción: ${JSON.stringify(antesProd)}`)

  // ── Fixture ──────────────────────────────────────────────────────────────
  const sello = Date.now()
  const A = ok(await s.from('companies').insert({
    slug: `${MARCA}-a-${sello}`, name: 'ZZ E3C Alfa', legal_name: 'ZZ E3C Alfa SA', default_currency: 'USD',
  }).select('id').single(), 'empresa').id
  creados.empresas.push(A)
  const B = ok(await s.from('companies').insert({
    slug: `${MARCA}-b-${sello}`, name: 'ZZ E3C Beta', legal_name: 'ZZ E3C Beta SA', default_currency: 'USD',
  }).select('id').single(), 'empresa B').id
  creados.empresas.push(B)

  for (const [doc, code] of [['quote', 'ZQ'], ['sales_order', 'ZP'], ['delivery', 'ZR']]) {
    ok(await s.from('document_sequences').insert({
      company_id: A, doc_type: doc, series_code: code, prefix: code, padding: 5, next_number: 1, is_default: true,
    }), `secuencia ${doc}`)
  }
  const deposito = ok(await s.from('warehouses').insert({
    company_id: A, code: `ZD${sello % 1000}`, name: 'ZZ Depósito E3C',
  }).select('id').single(), 'depósito')
  const categoria = ok(await s.from('product_categories').insert({
    company_id: A, name: 'ZZ E3C Cat', slug: `${MARCA}-cat-${sello}`, position: 1, needs_review: false,
  }).select('id').single(), 'categoría')
  const producto = ok(await s.from('products').insert({
    company_id: A, category_id: categoria.id, sku: `${MARCA}-P-${sello}`, name: 'ZZ Producto E3C',
    status: 'active', attributes: {},
  }).select('id').single(), 'producto')

  const admin = await usuarioTemporal(A, 'admin')
  const vendedor = await usuarioTemporal(A, 'salesperson')
  const tecnico = await usuarioTemporal(A, 'technician')
  const adminB = await usuarioTemporal(B, 'admin')
  const anon = sesion()

  const cliente = async (nombre, empresaId = A, extra = {}) =>
    ok(await s.from('customers').insert({
      company_id: empresaId, legal_name: nombre, status: 'active', ...extra,
    }).select('*').single(), `cliente ${nombre}`)

  const propio = await cliente('ZZ E3C Del vendedor', A, { salesperson_id: vendedor.id })
  const ajeno = await cliente('ZZ E3C De nadie')
  const clienteB = await cliente('ZZ E3C De la empresa B', B)

  const guardarContacto = (c, customer, contacto, esperado, datos) =>
    c.rpc('guardar_contacto', { p_customer: customer, p_contacto: contacto, p_esperado: esperado, p_datos: datos })
  const guardarDireccion = (c, customer, direccion, esperado, datos) =>
    c.rpc('guardar_direccion', { p_customer: customer, p_direccion: direccion, p_esperado: esperado, p_datos: datos })
  const leerContacto = async (id) => (await s.from('customer_contacts').select('*').eq('id', id).single()).data
  const leerDireccion = async (id) => (await s.from('customer_addresses').select('*').eq('id', id).single()).data
  const contactosDe = async (customer) =>
    (await s.from('customer_contacts').select('*').eq('customer_id', customer).order('full_name')).data ?? []
  const auditoriaDe = async (customer, accion) =>
    (await s.from('sales_audit').select('*').eq('entity_id', customer).eq('action', accion)).data ?? []

  // ── 1 · Contactos ────────────────────────────────────────────────────────
  seccion('1 · Alta, edición y whitelist de contactos')

  const k1 = ok(await guardarContacto(admin.c, ajeno.id, null, null, {
    full_name: 'ZZ Ana Pérez', role: 'Compras', email: 'ANA@zz.test', phone: '11 5555', is_default: true,
  }), 'alta de contacto')
  const c1 = await leerContacto(k1.id)
  cmp('el contacto se crea con sus datos', 'ZZ Ana Pérez/Compras/ana@zz.test', `${c1.full_name}/${c1.role}/${c1.email}`)
  cmp('nace principal y activo', 'true/true', `${c1.is_default}/${c1.active}`)
  cmp('el alta queda auditada contra el cliente', 1, (await auditoriaDe(ajeno.id, 'contact_added')).length)

  rechaza('un contacto sin nombre', await guardarContacto(admin.c, ajeno.id, null, null, { role: 'Compras' }), 'NOMBRE_REQUERIDO')
  for (const campo of ['company_id', 'customer_id', 'id', 'created_at', 'updated_at']) {
    rechaza(`inyectar ${campo}`, await guardarContacto(admin.c, ajeno.id, null, null, { full_name: 'x', [campo]: randomUUID() }), 'CAMPO_NO_EDITABLE')
  }

  const g1 = ok(await guardarContacto(admin.c, ajeno.id, k1.id, c1.updated_at, { role: 'Gerencia' }), 'editar')
  cmp('editar cuenta los campos que cambiaron', 1, g1.campos)
  const sinCambios = ok(await guardarContacto(admin.c, ajeno.id, k1.id, g1.actualizado_en, { role: 'Gerencia' }), 'no-op')
  cmp('guardar sin cambios no es un cambio', 'true/0', `${sinCambios.sin_cambios}/${sinCambios.campos}`)
  rechaza('con la versión vieja, conflicto',
    await guardarContacto(admin.c, ajeno.id, k1.id, c1.updated_at, { role: 'Otro' }), 'CONFLICTO_DE_EDICION')

  // ── 2 · Principal ────────────────────────────────────────────────────────
  seccion('2 · El principal es UNO, y se resuelve en la misma transacción')

  const k2 = ok(await guardarContacto(admin.c, ajeno.id, null, null, {
    full_name: 'ZZ Beto Gómez', is_default: true,
  }), 'segundo contacto principal')

  const lista = await contactosDe(ajeno.id)
  cmp('hay dos contactos', 2, lista.length)
  cmp('y un solo principal', 1, lista.filter((c) => c.is_default).length)
  cmp('el principal es el último marcado', k2.id, lista.find((c) => c.is_default)?.id)

  // Desactivar al principal le quita la marca: no se ofrece a quien no atiende.
  const c2 = await leerContacto(k2.id)
  ok(await guardarContacto(admin.c, ajeno.id, k2.id, c2.updated_at, { active: false }), 'desactivar')
  const c2b = await leerContacto(k2.id)
  cmp('un contacto desactivado deja de ser principal', 'false/false', `${c2b.active}/${c2b.is_default}`)
  cmp('y el cliente queda sin principal, no con uno inventado', 0,
    (await contactosDe(ajeno.id)).filter((c) => c.is_default).length)

  // ── 3 · Borrar sólo lo que nadie nombra ──────────────────────────────────
  seccion('3 · Lo que un documento nombra se desactiva, no se borra')

  const q1 = ok(await admin.c.rpc('crear_cotizacion', {
    p_company: A,
    p_cabecera: { customer_id: ajeno.id, currency_code: 'USD', contact_id: k1.id },
    p_lineas: [{ line_type: 'item', product_id: producto.id, sku_snapshot: 'ZZ-1', name_snapshot: 'ZZ',
                 quantity: 1, unit_price: 100, discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21 }],
  }), 'cotización con contacto')

  rechaza('borrar un contacto que figura en un documento',
    await admin.c.rpc('borrar_contacto', { p_contacto: k1.id }), 'CONTACTO_REFERENCIADO')
  cmp('el contacto sigue ahí', true, (await leerContacto(k1.id)) !== null)

  const c1b = await leerContacto(k1.id)
  ok(await guardarContacto(admin.c, ajeno.id, k1.id, c1b.updated_at, { active: false }), 'desactivar el referenciado')
  cmp('pero se puede desactivar', false, (await leerContacto(k1.id)).active)
  cmp('y la cotización lo sigue nombrando', k1.id,
    (await s.from('sales_quotes').select('contact_id').eq('id', q1.id).single()).data.contact_id)

  const borrable = ok(await guardarContacto(admin.c, ajeno.id, null, null, { full_name: 'ZZ Borrable' }), 'contacto suelto')
  ok(await admin.c.rpc('borrar_contacto', { p_contacto: borrable.id }), 'borrar el suelto')
  cmp('un contacto que nadie nombra sí se borra', 0,
    await cuenta('customer_contacts', (q) => q.eq('id', borrable.id)))
  cmp('y queda auditado', 1, (await auditoriaDe(ajeno.id, 'contact_removed')).length)

  // ── 4 · Permisos ─────────────────────────────────────────────────────────
  seccion('4 · El vendedor administra SUS clientes')

  const delVendedor = ok(await guardarContacto(vendedor.c, propio.id, null, null, {
    full_name: 'ZZ Contacto del vendedor',
  }), 'el vendedor carga un contacto de su cliente')
  cmp('el vendedor carga contactos de su cliente', true, !!delVendedor.id)

  rechaza('pero no de un cliente ajeno',
    await guardarContacto(vendedor.c, ajeno.id, null, null, { full_name: 'ZZ No' }), 'SIN_PERMISO')
  rechaza('el técnico, de ninguno',
    await guardarContacto(tecnico.c, propio.id, null, null, { full_name: 'ZZ No' }), 'SIN_PERMISO')
  rechaza('el admin de otra empresa, tampoco',
    await guardarContacto(adminB.c, propio.id, null, null, { full_name: 'ZZ No' }), 'SIN_PERMISO')
  rechaza('anónimo', await guardarContacto(anon, propio.id, null, null, { full_name: 'ZZ No' }))
  rechaza('ni un cliente de otra empresa',
    await guardarContacto(admin.c, clienteB.id, null, null, { full_name: 'ZZ No' }), 'SIN_PERMISO')

  // ── 5 · Direcciones ──────────────────────────────────────────────────────
  seccion('5 · Direcciones: principal por tipo y validaciones propias')

  const d1 = ok(await guardarDireccion(admin.c, ajeno.id, null, null, {
    kind: 'shipping', street: 'Av. Siempreviva 742', city: 'Springfield', state: 'Buenos Aires',
    postal_code: 'B1636', country_code: 'ar', is_default: true,
  }), 'dirección de entrega')
  const dir1 = await leerDireccion(d1.id)
  cmp('guarda la dirección y normaliza el país', 'Av. Siempreviva 742/AR', `${dir1.street}/${dir1.country_code}`)

  const d2 = ok(await guardarDireccion(admin.c, ajeno.id, null, null, {
    kind: 'billing', street: 'Calle Falsa 123', is_default: true,
  }), 'dirección de facturación')
  cmp('cada tipo tiene su principal', 2,
    (await s.from('customer_addresses').select('id').eq('customer_id', ajeno.id).eq('is_default', true)).data.length)

  const d3 = ok(await guardarDireccion(admin.c, ajeno.id, null, null, {
    kind: 'shipping', street: 'Otra entrega 999', is_default: true,
  }), 'segunda de entrega')
  const entregas = (await s.from('customer_addresses').select('*').eq('customer_id', ajeno.id).eq('kind', 'shipping')).data
  cmp('pero una sola principal por tipo', 1, entregas.filter((x) => x.is_default).length)
  cmp('y es la última marcada', d3.id, entregas.find((x) => x.is_default)?.id)

  rechaza('un tipo inventado', await guardarDireccion(admin.c, ajeno.id, null, null, { kind: 'galpon', street: 'x' }), 'TIPO_INVALIDO')
  rechaza('sin calle', await guardarDireccion(admin.c, ajeno.id, null, null, { kind: 'other' }), 'CALLE_REQUERIDA')
  rechaza('un país de tres letras', await guardarDireccion(admin.c, ajeno.id, null, null, { kind: 'other', street: 'x', country_code: 'ARG' }), 'PAIS_INVALIDO')

  // ── 6 · La dirección de entrega del pedido ───────────────────────────────
  seccion('6 · El pedido elige la dirección; el remito la congela')

  const LINEA = { line_type: 'item', product_id: producto.id, sku_snapshot: 'ZZ-1', name_snapshot: 'ZZ',
                  quantity: 3, unit_price: 100, discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21 }

  const ped = ok(await admin.c.rpc('crear_pedido', {
    p_company: A,
    p_cabecera: { customer_id: ajeno.id, currency_code: 'USD', shipping_address_id: d1.id },
    p_lineas: [LINEA],
  }), 'pedido con dirección')
  cmp('el pedido guarda la dirección elegida', d1.id,
    (await s.from('sales_orders').select('shipping_address_id').eq('id', ped.id).single()).data.shipping_address_id)

  rechaza('una dirección de otro cliente',
    await admin.c.rpc('crear_pedido', {
      p_company: A,
      p_cabecera: { customer_id: propio.id, currency_code: 'USD', shipping_address_id: d1.id },
      p_lineas: [LINEA],
    }), 'DIRECCION_INVALIDA')

  rechaza('una dirección de facturación como dirección de entrega',
    await admin.c.rpc('crear_pedido', {
      p_company: A,
      p_cabecera: { customer_id: ajeno.id, currency_code: 'USD', shipping_address_id: d2.id },
      p_lineas: [LINEA],
    }), 'DIRECCION_INVALIDA')

  const dir3 = await leerDireccion(d3.id)
  ok(await guardarDireccion(admin.c, ajeno.id, d3.id, dir3.updated_at, { active: false }), 'desactivar dirección')
  rechaza('una dirección desactivada',
    await admin.c.rpc('crear_pedido', {
      p_company: A,
      p_cabecera: { customer_id: ajeno.id, currency_code: 'USD', shipping_address_id: d3.id },
      p_lineas: [LINEA],
    }), 'DIRECCION_INVALIDA')

  // De punta a punta: el remito congela la dirección del pedido (E6).
  ok(await s.from('sales_orders').update({ commercial_status: 'confirmed' }).eq('id', ped.id), 'confirmar pedido')
  const lineasPed = (await s.from('sales_order_lines').select('id').eq('order_id', ped.id)).data
  const rem = ok(await admin.c.rpc('crear_remito_desde_pedido', {
    p_order: ped.id, p_lineas: [{ order_line_id: lineasPed[0].id, quantity: 1 }],
  }), 'remito')
  const snapshot = (await s.from('deliveries').select('delivery_address_snapshot').eq('id', rem.id).single()).data
  cmp('el remito congela la dirección del pedido', 'Av. Siempreviva 742/Springfield',
    `${snapshot.delivery_address_snapshot?.street}/${snapshot.delivery_address_snapshot?.city}`)

  // Y si después se corrige la dirección del cliente, el remito no cambia.
  const dir1b = await leerDireccion(d1.id)
  ok(await guardarDireccion(admin.c, ajeno.id, d1.id, dir1b.updated_at, { street: 'Mudanza 1' }), 'mudanza')
  const snapshot2 = (await s.from('deliveries').select('delivery_address_snapshot').eq('id', rem.id).single()).data
  cmp('mudarse no cambia el remito', 'Av. Siempreviva 742', snapshot2.delivery_address_snapshot?.street)

  rechaza('borrar una dirección que un documento nombra',
    await admin.c.rpc('borrar_direccion', { p_direccion: d1.id }), 'DIRECCION_REFERENCIADA')

  // ── 7 · Auditoría ────────────────────────────────────────────────────────
  seccion('7 · Qué quedó registrado')

  cmp('altas de dirección', 3, (await auditoriaDe(ajeno.id, 'address_added')).length)
  // Dos ediciones propias: la baja de d3 y la mudanza de d1. Reasignar el
  // principal NO es una edición: es el efecto de otra.
  cmp('ediciones de dirección', 2, (await auditoriaDe(ajeno.id, 'address_updated')).length)
  cmp('ediciones de contacto', 3, (await auditoriaDe(ajeno.id, 'contact_updated')).length)
  const evento = (await auditoriaDe(ajeno.id, 'address_updated'))[0]
  cmp('con el antes y el después', true, evento?.diff !== null && typeof evento?.diff === 'object')
  cmp('y contra el cliente, no contra la tabla', 'customer', evento?.entity_type)

  // ── 8 · Limpieza e invariantes ───────────────────────────────────────────
  seccion('8 · Limpieza e invariantes')

  await limpiar()
  cmp('sin empresas de fixture', 0,
    (await s.from('companies').select('id', { count: 'exact', head: true }).like('slug', `${MARCA}-%`)).count)

  const despues = await baselineProd()
  cmp('producción idéntica al baseline', JSON.stringify(antesProd), JSON.stringify(despues))

  console.log('\n' + '='.repeat(78))
  console.log(`  RESULTADO: ${fallos === 0 ? '0 FALLOS' : fallos + ' FALLO(S)'}`)
  console.log('='.repeat(78))
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('\n✗ ERROR:', e.message)
  try { await limpiar() } catch (x) { console.error('  y la limpieza falló:', x.message) }
  process.exit(1)
})
