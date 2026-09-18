/**
 * Fase 17 · E2 — los defaults del cliente y la independencia del documento.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase17-e2-defaults-tests.mjs
 *
 * La pregunta que responde esta suite es una sola, y es la que importa:
 *
 *   **¿cambiar la ficha del cliente puede cambiar un documento ya emitido?**
 *
 * La respuesta tiene que ser NO, siempre. Lo demás —que el default se lea, que
 * se audite, que la conversión conserve el snapshot— es lo que sostiene esa
 * respuesta.
 *
 * Todo lleva el prefijo zz-e2d y se borra al final. No toca WhatsApp.
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

const MARCA = 'zz-e2d'
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
    await borrar('delivery_lines')
    await borrar('deliveries')
    await borrar('sales_orders')
    await borrar('sales_quotes')
    await borrar('product_prices')
    await borrar('products')
    await borrar('product_categories')
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
  console.log('  FASE 17 · CLIENTES E2 — defaults del cliente, documentos independientes')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(78))

  await barrerRestos()

  const { data: prodEmpresas } = await s.from('companies').select('id, slug').in('slug', PRODUCCION)
  const prodIds = prodEmpresas.map((e) => e.id)
  const baselineProd = async () => ({
    clientes: await cuenta('customers', (q) => q.in('company_id', prodIds)),
    cotizaciones: await cuenta('sales_quotes', (q) => q.in('company_id', prodIds)),
    pedidos: await cuenta('sales_orders', (q) => q.in('company_id', prodIds)),
    remitos: await cuenta('deliveries', (q) => q.in('company_id', prodIds)),
    auditoria: await cuenta('sales_audit', (q) => q.in('company_id', prodIds)),
    listas: await cuenta('price_lists', (q) => q.in('company_id', prodIds)),
    membresias: await cuenta('company_memberships', (q) => q.in('company_id', prodIds)),
    cotConTarifa: await cuenta('sales_quotes', (q) => q.in('company_id', prodIds).not('price_list_id', 'is', null)),
    pedConTarifa: await cuenta('sales_orders', (q) => q.in('company_id', prodIds).not('price_list_id', 'is', null)),
  })
  const antesProd = await baselineProd()
  console.log(`  baseline producción: ${JSON.stringify(antesProd)}`)

  // ── Fixture ──────────────────────────────────────────────────────────────
  const sello = Date.now()
  const A = ok(await s.from('companies').insert({
    slug: `${MARCA}-a-${sello}`, name: 'ZZ E2D Alfa', legal_name: 'ZZ E2D Alfa SA', default_currency: 'USD',
  }).select('id').single(), 'empresa').id
  creados.empresas.push(A)
  for (const [doc, code] of [['quote', 'ZQ'], ['sales_order', 'ZP'], ['delivery', 'ZR'], ['customer', 'ZC']]) {
    ok(await s.from('document_sequences').insert({
      company_id: A, doc_type: doc, series_code: code, prefix: code, padding: 5, next_number: 1, is_default: true,
    }), `secuencia ${doc}`)
  }

  const listaUsdA = ok(await s.from('price_lists').insert({
    company_id: A, name: 'ZZ USD A', currency_code: 'USD', is_default: true, valid_from: '2026-01-01',
  }).select('id').single(), 'lista USD A')
  const listaUsdB = ok(await s.from('price_lists').insert({
    company_id: A, name: 'ZZ USD B', currency_code: 'USD', is_default: false, valid_from: '2026-01-01',
  }).select('id').single(), 'lista USD B')
  const listaArs = ok(await s.from('price_lists').insert({
    company_id: A, name: 'ZZ ARS', currency_code: 'ARS', is_default: false, valid_from: '2026-01-01',
  }).select('id').single(), 'lista ARS')

  const admin = await usuarioTemporal(A, 'admin')
  const vendedor1 = await usuarioTemporal(A, 'salesperson')
  const vendedor2 = await usuarioTemporal(A, 'salesperson')

  const cliente = async (nombre, extra = {}) =>
    ok(await s.from('customers').insert({
      company_id: A, legal_name: nombre, status: 'active', ...extra,
    }).select('*').single(), `cliente ${nombre}`)

  const clienteA = await cliente('ZZ E2D Con defaults', {
    salesperson_id: vendedor1.id, default_price_list_id: listaUsdA.id,
    payment_terms: '30 días', default_currency: 'USD',
  })
  const clienteC = await cliente('ZZ E2D Sin defaults')
  const clienteD = await cliente('ZZ E2D Tarifa en pesos', {
    default_price_list_id: listaArs.id, default_currency: 'ARS',
  })

  const LINEA = {
    line_type: 'item', sku_snapshot: 'ZZ-1', name_snapshot: 'ZZ Producto',
    quantity: 2, unit_price: 100, discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21,
  }
  const leerDefaults = async (c, id) =>
    c.from('customers').select('salesperson_id, default_price_list_id, payment_terms, default_currency')
      .eq('company_id', A).eq('id', id).maybeSingle()
  const leerCliente = async (id) => (await s.from('customers').select('*').eq('id', id).single()).data
  const cotizacion = async (id) => (await s.from('sales_quotes').select('*').eq('id', id).single()).data
  const pedido = async (id) => (await s.from('sales_orders').select('*').eq('id', id).single()).data

  // ── 1 · Leer los defaults ────────────────────────────────────────────────
  seccion('1 · La pantalla lee los defaults en UNA consulta de cuatro columnas')

  const d1 = ok(await leerDefaults(admin.c, clienteA.id), 'defaults del cliente')
  cmp('trae vendedor, tarifa, condición de pago y moneda',
    `${vendedor1.id}/${listaUsdA.id}/30 días/USD`,
    `${d1.salesperson_id}/${d1.default_price_list_id}/${d1.payment_terms}/${d1.default_currency}`)

  const d2 = ok(await leerDefaults(admin.c, clienteC.id), 'cliente sin defaults')
  cmp('un cliente sin defaults devuelve todo en null', 'null/null/null/null',
    `${d2.salesperson_id}/${d2.default_price_list_id}/${d2.payment_terms}/${d2.default_currency}`)

  const d3 = ok(await leerDefaults(admin.c, clienteD.id), 'cliente con tarifa ARS')
  cmp('la tarifa en pesos se lee igual: quien decide si aplica es la pantalla', listaArs.id, d3.default_price_list_id)

  // ── 2 · El documento congela ─────────────────────────────────────────────
  seccion('2 · Lo que se guarda en el documento es del documento')

  const q1 = ok(await admin.c.rpc('crear_cotizacion', {
    p_company: A,
    p_cabecera: {
      customer_id: clienteA.id, currency_code: 'USD', price_list_id: listaUsdA.id,
      salesperson_id: vendedor1.id, payment_terms: '30 días',
    },
    p_lineas: [LINEA],
  }), 'cotización con defaults')

  const c1 = await cotizacion(q1.id)
  cmp('la cotización guarda lo sugerido', `${listaUsdA.id}/${vendedor1.id}/30 días/USD`,
    `${c1.price_list_id}/${c1.salesperson_id}/${c1.payment_terms}/${c1.currency_code}`)

  // Ahora el cliente cambia de tarifa, de vendedor y de condición de pago.
  const antesCliente = await leerCliente(clienteA.id)
  const g = ok(await admin.c.rpc('guardar_cliente', {
    p_customer: clienteA.id,
    p_esperado: antesCliente.updated_at,
    p_datos: {
      default_price_list_id: listaUsdB.id,
      salesperson_id: vendedor2.id,
      payment_terms: '60 días',
      default_currency: 'ARS',
    },
  }), 'cambiar defaults del cliente')
  cmp('el cambio de ficha es UN solo evento', 4, g.campos)

  const c1b = await cotizacion(q1.id)
  cmp('la cotización NO cambió', `${listaUsdA.id}/${vendedor1.id}/30 días/USD`,
    `${c1b.price_list_id}/${c1b.salesperson_id}/${c1b.payment_terms}/${c1b.currency_code}`)
  cmp('ni siquiera se tocó su updated_at', c1.updated_at, c1b.updated_at)

  const d4 = ok(await leerDefaults(admin.c, clienteA.id), 'defaults nuevos')
  cmp('pero un documento nuevo ya recibiría la tarifa nueva', listaUsdB.id, d4.default_price_list_id)

  const auditCliente = ok(await s.from('sales_audit').select('*')
    .eq('entity_id', clienteA.id).eq('action', 'updated'), 'auditoría del cliente')
  cmp('un evento, con el antes y el después de la tarifa', 1, auditCliente.length)
  cmp('con los cuatro campos', 'default_currency,default_price_list_id,payment_terms,salesperson_id',
    Object.keys(auditCliente[0]?.diff ?? {}).sort().join(','))
  cmp('y la tarifa vieja registrada', listaUsdA.id, auditCliente[0]?.diff?.default_price_list_id?.from)

  // ── 3 · La conversión conserva el snapshot ───────────────────────────────
  seccion('3 · Cotización → pedido: manda la cotización, no el cliente')

  const p1 = ok(await admin.c.rpc('convertir_cotizacion_en_pedido', { p_quote: q1.id, p_esperado: null }), 'convertir')
  const o1 = await pedido(p1.id)
  cmp('el pedido hereda la tarifa de la COTIZACIÓN', listaUsdA.id, o1.price_list_id)
  cmp('y su vendedor', vendedor1.id, o1.salesperson_id)
  cmp('y su condición de pago', '30 días', o1.payment_terms)
  cmp('y su moneda', 'USD', o1.currency_code)
  cmp('no la tarifa nueva del cliente', true, o1.price_list_id !== listaUsdB.id)

  // ── 4 · Duplicar conserva el snapshot ────────────────────────────────────
  seccion('4 · Duplicar copia el documento, no la ficha del cliente')

  // Duplicar en la aplicación es leer el documento y volver a crear con esos
  // valores: acá se hace igual, para probar el invariante de la base.
  const q2 = ok(await admin.c.rpc('crear_cotizacion', {
    p_company: A,
    p_cabecera: {
      customer_id: c1b.customer_id, currency_code: c1b.currency_code,
      price_list_id: c1b.price_list_id, salesperson_id: c1b.salesperson_id,
      payment_terms: c1b.payment_terms,
    },
    p_lineas: [LINEA],
  }), 'duplicar cotización')
  const c2 = await cotizacion(q2.id)
  cmp('la copia repite la tarifa del original', listaUsdA.id, c2.price_list_id)
  cmp('no la del cliente de hoy', true, c2.price_list_id !== listaUsdB.id)

  // ── 5 · Validaciones que ya existían y siguen ────────────────────────────
  seccion('5 · El servidor sigue validando, sugiera lo que sugiera la pantalla')

  rechaza('una tarifa en otra moneda que la del documento',
    await admin.c.rpc('crear_cotizacion', {
      p_company: A,
      p_cabecera: { customer_id: clienteD.id, currency_code: 'USD', price_list_id: listaArs.id },
      p_lineas: [LINEA],
    }), 'TARIFA_OTRA_MONEDA')

  rechaza('un vendedor que no es de la empresa',
    await admin.c.rpc('crear_cotizacion', {
      p_company: A,
      p_cabecera: { customer_id: clienteC.id, currency_code: 'USD', salesperson_id: randomUUID() },
      p_lineas: [LINEA],
    }), 'VENDEDOR_INVALIDO')

  const q3 = ok(await admin.c.rpc('crear_cotizacion', {
    p_company: A, p_cabecera: { customer_id: clienteC.id, currency_code: 'USD' }, p_lineas: [LINEA],
  }), 'cotización sin defaults')
  const c3 = await cotizacion(q3.id)
  cmp('un cliente sin defaults cotiza igual, con los campos vacíos', 'null/null/null',
    `${c3.price_list_id}/${c3.salesperson_id}/${c3.payment_terms}`)

  // ── 6 · Nada de esto tocó a los históricos ───────────────────────────────
  seccion('6 · Limpieza e invariantes')

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
