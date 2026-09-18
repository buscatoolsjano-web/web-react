/**
 * Fase 17 · E1 — la edición del cliente contra la base.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase17-e1-clientes-tests.mjs
 *
 * Lo que prueba, midiendo el EFECTO:
 *   1. guardar_cliente: una llamada, campos válidos, testigo nuevo
 *   2. whitelist: lo que no se edita, se rechaza (no se filtra en silencio)
 *   3. concurrencia: dos actores, la versión vieja pierde y NO pisa
 *   4. no-op: guardar sin cambios no toca updated_at ni audita
 *   5. auditoría: un evento por guardado, con el antes y el después
 *   6. CUIT: opcional, validado sólo si cambia, único por empresa
 *   7. vendedor: misma empresa, membresía activa, y el vendedor no se reasigna
 *   8. permisos: anon, técnico, portal, vendedor ajeno, admin de otra empresa
 *   9. alta y baja: quedan auditadas; las importaciones no
 *  10. limpieza e invariantes de producción
 *
 * Todo lleva el prefijo zz-e1c y se borra al final. No toca Ventas ni WhatsApp.
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

const MARCA = 'zz-e1c'
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
    await borrar('customer_addresses')
    await borrar('customer_contacts')
    await borrar('company_memberships')
    // Los clientes antes que las listas de precios: `default_price_list_id`
    // apunta a ellas y la FK no deja borrarlas mientras haya un cliente.
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
  console.log('  FASE 17 · CLIENTES E1 — edición atómica, concurrencia y auditoría')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(78))

  await barrerRestos()

  const { data: prodEmpresas } = await s.from('companies').select('id, slug').in('slug', PRODUCCION)
  const prodIds = prodEmpresas.map((e) => e.id)
  const baselineProd = async () => ({
    clientes: await cuenta('customers', (q) => q.in('company_id', prodIds)),
    contactos: await cuenta('customer_contacts', (q) => q.in('company_id', prodIds)),
    direcciones: await cuenta('customer_addresses', (q) => q.in('company_id', prodIds)),
    cotizaciones: await cuenta('sales_quotes', (q) => q.in('company_id', prodIds)),
    pedidos: await cuenta('sales_orders', (q) => q.in('company_id', prodIds)),
    remitos: await cuenta('deliveries', (q) => q.in('company_id', prodIds)),
    auditoria: await cuenta('sales_audit', (q) => q.in('company_id', prodIds)),
    conVendedor: await cuenta('customers', (q) => q.in('company_id', prodIds).not('salesperson_id', 'is', null)),
    conTarifa: await cuenta('customers', (q) => q.in('company_id', prodIds).not('default_price_list_id', 'is', null)),
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
    ok(await s.from('document_sequences').insert({
      company_id: e.id, doc_type: 'customer', series_code: `ZC${k.toUpperCase()}`,
      prefix: `ZC${k.toUpperCase()}`, padding: 5, next_number: 1, is_default: true,
    }), `secuencia ${k}`)
    return e.id
  }
  const A = await empresa('a', 'ZZ E1C Alfa')
  const B = await empresa('b', 'ZZ E1C Beta')

  const listaA = ok(await s.from('price_lists').insert({
    company_id: A, name: 'ZZ Lista E1C', currency_code: 'USD', is_default: true, valid_from: '2026-01-01',
  }).select('id').single(), 'lista A')
  const listaB = ok(await s.from('price_lists').insert({
    company_id: B, name: 'ZZ Lista de B', currency_code: 'USD', is_default: true, valid_from: '2026-01-01',
  }).select('id').single(), 'lista B')

  const admin = await usuarioTemporal(A, 'admin')
  const employee = await usuarioTemporal(A, 'employee')
  const vendedor = await usuarioTemporal(A, 'salesperson')
  const otroVendedor = await usuarioTemporal(A, 'salesperson')
  const tecnico = await usuarioTemporal(A, 'technician')
  const adminB = await usuarioTemporal(B, 'admin')
  const anon = sesion()

  /** Un cliente de fixture creado con la clave de servicio (sin auditoría). */
  const clienteDe = async (empresaId, nombre, extra = {}) =>
    ok(await s.from('customers').insert({
      company_id: empresaId, legal_name: nombre, status: 'active', ...extra,
    }).select('*').single(), `cliente ${nombre}`)

  const leer = async (id) => (await s.from('customers').select('*').eq('id', id).single()).data
  const guardar = (c, id, esperado, datos) =>
    c.rpc('guardar_cliente', { p_customer: id, p_esperado: esperado, p_datos: datos })
  const auditoriaDe = async (id, accion = null) => {
    let q = s.from('sales_audit').select('*').eq('entity_id', id)
    if (accion) q = q.eq('action', accion)
    return (await q).data ?? []
  }

  // ── 1 · Guardar de verdad ────────────────────────────────────────────────
  seccion('1 · Una llamada guarda todo y devuelve el testigo nuevo')

  const c1 = await clienteDe(A, 'ZZ E1C Cliente uno')
  const r1 = ok(await guardar(admin.c, c1.id, c1.updated_at, {
    legal_name: 'ZZ E1C Cliente uno SA',
    trade_name: 'Uno',
    phone: '11 5555 5555',
    emails: ['Compras@UNO.com', 'compras@uno.com ', ''],
    email_domains: ['UNO.com'],
    payment_terms: '30 días',
    default_currency: 'USD',
    notes: 'ZZ nota',
  }), 'guardar 1')
  cmp('devuelve cuántos campos cambiaron', 8, r1.campos)
  cmp('no dice «sin cambios»', false, r1.sin_cambios)

  const d1 = await leer(c1.id)
  cmp('guarda razón social y nombre comercial', 'ZZ E1C Cliente uno SA/Uno', `${d1.legal_name}/${d1.trade_name}`)
  cmp('normaliza los emails: minúscula, sin vacíos y sin repetidos', 'compras@uno.com', (d1.emails ?? []).join(','))
  cmp('normaliza los dominios', 'uno.com', (d1.email_domains ?? []).join(','))
  cmp('el testigo nuevo es el que devolvió la RPC', r1.actualizado_en, d1.updated_at)
  cmp('y avanzó respecto del anterior', true, new Date(d1.updated_at) > new Date(c1.updated_at))

  // ── 2 · Whitelist ────────────────────────────────────────────────────────
  seccion('2 · Lo que no se edita, se rechaza')

  const d1b = await leer(c1.id)
  for (const [campo, valor] of [
    ['id', randomUUID()],
    ['company_id', B],
    ['created_at', '2020-01-01T00:00:00Z'],
    ['updated_at', '2020-01-01T00:00:00Z'],
    ['created_by', randomUUID()],
    ['imported_at', '2020-01-01T00:00:00Z'],
    ['legacy_source', 'inventado'],
    ['legacy_ref', 'ZC99999'],
    ['needs_review', false],
    ['review_reason', null],
    ['deleted_at', '2020-01-01T00:00:00Z'],
    ['status', 'inactive'],
    ['discount_pct', 50],
    ['credit_limit', 999999],
  ]) {
    rechaza(`inyectar ${campo}`, await guardar(admin.c, c1.id, d1b.updated_at, { [campo]: valor }), 'CAMPO_NO_EDITABLE')
  }
  const d1c = await leer(c1.id)
  cmp('ningún intento cambió nada', d1b.updated_at, d1c.updated_at)

  // ── 3 · Concurrencia ─────────────────────────────────────────────────────
  seccion('3 · Dos actores, una versión: el viejo pierde y no pisa')

  const c2 = await clienteDe(A, 'ZZ E1C Cliente dos', { phone: '11 0000 0000', notes: 'original' })
  const version = c2.updated_at

  // A guarda primero.
  ok(await guardar(admin.c, c2.id, version, { phone: '11 1111 1111' }), 'A guarda')
  // B guarda con la versión vieja.
  const rB = await guardar(employee.c, c2.id, version, { notes: 'lo de B' })
  rechaza('el segundo recibe CONFLICTO_DE_EDICION', rB, 'CONFLICTO_DE_EDICION')

  const d2 = await leer(c2.id)
  cmp('lo de A quedó', '11 1111 1111', d2.phone)
  cmp('y lo de B NO pisó nada', 'original', d2.notes)

  const [x1, x2] = await Promise.all([
    guardar(admin.c, c2.id, d2.updated_at, { notes: 'simultáneo A' }),
    guardar(employee.c, c2.id, d2.updated_at, { notes: 'simultáneo B' }),
  ])
  cmp('dos guardados a la vez: gana uno solo', 1, [x1, x2].filter((r) => !r.error).length)

  // ── 4 · No-op ────────────────────────────────────────────────────────────
  seccion('4 · Guardar sin cambios no es un cambio')

  const d3 = await leer(c2.id)
  const auditAntes = (await auditoriaDe(c2.id, 'updated')).length
  const rNoop = ok(await guardar(admin.c, c2.id, d3.updated_at, {
    legal_name: d3.legal_name, phone: d3.phone, notes: d3.notes,
  }), 'no-op')
  cmp('contesta «sin cambios»', 'true/0', `${rNoop.sin_cambios}/${rNoop.campos}`)
  const d3b = await leer(c2.id)
  cmp('no movió el testigo', d3.updated_at, d3b.updated_at)
  cmp('no inventó un evento de auditoría', auditAntes, (await auditoriaDe(c2.id, 'updated')).length)
  cmp('un payload vacío tampoco', 'true', String(ok(await guardar(admin.c, c2.id, d3.updated_at, {}), 'vacío').sin_cambios))

  // ── 5 · Auditoría ────────────────────────────────────────────────────────
  seccion('5 · Qué queda registrado')

  const c3 = await clienteDe(A, 'ZZ E1C Cliente tres', { phone: 'viejo', notes: 'nota vieja', industry: 'Metal' })
  ok(await guardar(admin.c, c3.id, c3.updated_at, {
    phone: 'nuevo', notes: 'nota nueva', industry: 'Plástico',
  }), 'guardar 3')

  const ev = await auditoriaDe(c3.id, 'updated')
  cmp('tres campos en UN solo evento', 1, ev.length)
  cmp('el evento es del cliente', 'customer/updated', `${ev[0]?.entity_type}/${ev[0]?.action}`)
  cmp('con el actor', admin.id, ev[0]?.actor_id)
  cmp('guarda el antes y el después', 'viejo→nuevo', `${ev[0]?.diff?.phone?.from}→${ev[0]?.diff?.phone?.to}`)
  cmp('y sólo los campos que cambiaron', 'industry,notes,phone',
    Object.keys(ev[0]?.diff ?? {}).sort().join(','))
  cmp('leer el cliente no audita nada', 1, (await auditoriaDe(c3.id, 'updated')).length)

  // ── 6 · CUIT ─────────────────────────────────────────────────────────────
  seccion('6 · El CUIT no es obligatorio, pero si se informa se valida')

  const d4 = await leer(c3.id)
  rechaza('un CUIT de 8 dígitos', await guardar(admin.c, c3.id, d4.updated_at, { tax_id: '30-1234-5' }), 'CUIT_INVALIDO')
  const rCuit = ok(await guardar(admin.c, c3.id, d4.updated_at, { tax_id: '30-71098422-7' }), 'CUIT válido')
  cmp('un CUIT de 11 dígitos entra', 1, rCuit.campos)

  const c4 = await clienteDe(A, 'ZZ E1C Cliente cuatro')
  rechaza('el mismo CUIT en otro cliente de la empresa',
    await guardar(admin.c, c4.id, c4.updated_at, { tax_id: '30710984227' }), 'uq_customers_cuit_norm')

  const d5 = await leer(c4.id)
  const rSinCuit = ok(await guardar(admin.c, c4.id, d5.updated_at, { trade_name: 'Sin CUIT' }), 'sin CUIT')
  cmp('un cliente sin CUIT se edita igual', 1, rSinCuit.campos)

  // Un cliente viejo con un CUIT que no cumple hoy se puede seguir editando.
  const c5 = await clienteDe(A, 'ZZ E1C Cliente cinco', { tax_id: 'EXT-99' })
  const rViejo = ok(await guardar(admin.c, c5.id, c5.updated_at, { notes: 'sigue editable' }), 'cuit viejo')
  cmp('un CUIT viejo raro no bloquea editar otro campo', 1, rViejo.campos)

  // ── 7 · Vendedor y tarifa ────────────────────────────────────────────────
  seccion('7 · Vendedor y tarifa: de esta empresa y de verdad')

  const d6 = await leer(c5.id)
  const rVend = ok(await guardar(admin.c, c5.id, d6.updated_at, {
    salesperson_id: vendedor.id, default_price_list_id: listaA.id,
  }), 'asignar vendedor')
  cmp('el admin asigna vendedor y tarifa', 2, rVend.campos)
  const d6b = await leer(c5.id)
  cmp('quedaron guardados', `${vendedor.id}/${listaA.id}`, `${d6b.salesperson_id}/${d6b.default_price_list_id}`)

  rechaza('un vendedor de otra empresa',
    await guardar(admin.c, c5.id, d6b.updated_at, { salesperson_id: adminB.id }), 'VENDEDOR_INVALIDO')
  rechaza('un vendedor inventado',
    await guardar(admin.c, c5.id, d6b.updated_at, { salesperson_id: randomUUID() }), 'VENDEDOR_INVALIDO')
  rechaza('una tarifa de otra empresa',
    await guardar(admin.c, c5.id, d6b.updated_at, { default_price_list_id: listaB.id }), 'TARIFA_INVALIDA')
  rechaza('una moneda que no existe',
    await guardar(admin.c, c5.id, d6b.updated_at, { default_currency: 'XYZ' }), 'MONEDA_INVALIDA')

  const rQuitar = ok(await guardar(admin.c, c5.id, d6b.updated_at, { salesperson_id: null }), 'quitar vendedor')
  cmp('se puede dejar sin vendedor', 1, rQuitar.campos)

  // ── 8 · Permisos ─────────────────────────────────────────────────────────
  seccion('8 · Quién puede guardar')

  const propio = await clienteDe(A, 'ZZ E1C Del vendedor', { salesperson_id: vendedor.id })
  const ajeno = await clienteDe(A, 'ZZ E1C De otro', { salesperson_id: otroVendedor.id })

  rechaza('anónimo', await guardar(anon, propio.id, propio.updated_at, { notes: 'x' }))
  rechaza('técnico', await guardar(tecnico.c, propio.id, propio.updated_at, { notes: 'x' }), 'SIN_PERMISO')
  rechaza('admin de otra empresa', await guardar(adminB.c, propio.id, propio.updated_at, { notes: 'x' }), 'SIN_PERMISO')
  rechaza('vendedor sobre un cliente ajeno', await guardar(vendedor.c, ajeno.id, ajeno.updated_at, { notes: 'x' }), 'SIN_PERMISO')

  const rPropio = ok(await guardar(vendedor.c, propio.id, propio.updated_at, { notes: 'lo edito yo' }), 'vendedor propio')
  cmp('el vendedor sí edita el suyo', 1, rPropio.campos)

  const d7 = await leer(propio.id)
  rechaza('pero no se reasigna el cliente',
    await guardar(vendedor.c, propio.id, d7.updated_at, { salesperson_id: otroVendedor.id }), 'VENDEDOR_NO_EDITABLE')
  cmp('el cliente sigue siendo suyo', vendedor.id, (await leer(propio.id)).salesperson_id)

  // ── 9 · Alta, baja y reactivación ────────────────────────────────────────
  seccion('9 · El alta y la baja también quedan registradas')

  const nuevo = ok(await admin.c.from('customers').insert({
    company_id: A, legal_name: 'ZZ E1C Alta auditada', status: 'active',
  }).select('id, updated_at').single(), 'alta desde sesión')
  cmp('el alta deja un evento created', 1, (await auditoriaDe(nuevo.id, 'created')).length)

  ok(await admin.c.from('customers').update({ deleted_at: new Date().toISOString(), status: 'inactive' }).eq('id', nuevo.id), 'baja')
  cmp('la baja deja su evento', 1, (await auditoriaDe(nuevo.id, 'deactivated')).length)

  const dBaja = await leer(nuevo.id)
  rechaza('un cliente dado de baja no se edita',
    await guardar(admin.c, nuevo.id, dBaja.updated_at, { notes: 'x' }), 'CLIENTE_DADO_DE_BAJA')

  ok(await admin.c.from('customers').update({ deleted_at: null, status: 'active' }).eq('id', nuevo.id), 'reactivar')
  cmp('la reactivación también', 1, (await auditoriaDe(nuevo.id, 'reactivated')).length)

  const importado = await clienteDe(A, 'ZZ E1C Importado', { imported_at: new Date().toISOString(), legacy_source: 'zz' })
  cmp('una importación NO se audita como si fuera una persona', 0, (await auditoriaDe(importado.id)).length)

  rechaza('un cliente que no existe', await guardar(admin.c, randomUUID(), new Date().toISOString(), { notes: 'x' }), 'CLIENTE_INEXISTENTE')

  // ── 10 · Limpieza e invariantes ──────────────────────────────────────────
  seccion('10 · Limpieza e invariantes')

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
