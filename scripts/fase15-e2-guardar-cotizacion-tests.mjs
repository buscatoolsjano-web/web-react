/**
 * Fase 15 · E2 — el guardado atómico de la cotización, contra la base.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase15-e2-guardar-cotizacion-tests.mjs
 *
 * Lo que prueba, midiendo el EFECTO y no el código de retorno:
 *   1. cabecera sola, líneas solas, y las dos juntas
 *   2. agregar, modificar y borrar líneas en la misma llamada
 *   3. el contacto tiene que ser del cliente elegido
 *   4. la tarifa tiene que ser de la empresa y de la misma moneda
 *   5. concurrencia optimista: dos ediciones en paralelo, una gana
 *   6. estado no editable, rol sin permiso, otra empresa
 *   7. campos inyectados (company_id, number, status, imported_at…)
 *   8. rollback: si una línea es inválida NO queda nada guardado
 *   9. la auditoría guarda el valor ANTERIOR y el nuevo
 *
 * No toca documentos productivos: todo lleva el prefijo zz-e2 y se borra al
 * final, con la invariante verificada.
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
/** Rechaza con el código esperado. Sin error, o con otro código, es FAIL. */
const rechaza = (t, r, codigo) => {
  if (!r.error) return FAIL(`SE PERMITIÓ: ${t}`)
  if (codigo && !String(r.error.message).includes(codigo)) {
    return FAIL(t, `esperaba ${codigo}, dio «${String(r.error.message).slice(0, 60)}»`)
  }
  PASS(t, codigo ?? String(r.error.message).slice(0, 50))
}

const sesion = () => createClient(BASE, PUB, { auth: { persistSession: false } })
const s = createClient(BASE, SECRET, { auth: { persistSession: false } })

const MARCA = 'zz-e2'
const creados = { usuarios: [], empresas: [] }
const ok = (r, q) => { if (r.error) throw new Error(`${q}: ${r.error.message}`); return r.data }

const usuarioTemporal = async (companyId, rol) => {
  const email = `${MARCA}-${rol}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@buscatools.test`
  const password = `Zz${randomUUID()}!`
  const { data, error } = await s.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`crear ${rol}: ${error.message}`)
  creados.usuarios.push(data.user.id)
  ok(await s.from('company_memberships').insert({ company_id: companyId, user_id: data.user.id, role: rol, status: 'active' }), `membresía ${rol}`)
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
    // Las líneas caen por cascada al borrar la cotización; borrarlas sueltas
    // choca con el guard de cotización cerrada.
    await borrar('sales_quotes')
    await borrar('product_prices')
    await borrar('price_lists')
    await borrar('products')
    await borrar('product_categories')
    // Las membresías ANTES que los clientes y los productos.
    await borrar('company_memberships')
    await borrar('customer_contacts')
    await borrar('customers')
    for (const u of creados.usuarios) await s.auth.admin.deleteUser(u)
    creados.usuarios = []
    const r = await s.from('companies').delete().in('id', ids)
    if (r.error) console.log(`    aviso companies: ${r.error.message.slice(0, 120)}`)
  }
  for (const u of creados.usuarios) await s.auth.admin.deleteUser(u)
}

const barrerRestos = async () => {
  const { data: viejas } = await s.from('companies').select('id').like('slug', `${MARCA}-%`)
  creados.empresas = (viejas ?? []).map((x) => x.id)
  const { data: us } = await s.auth.admin.listUsers({ perPage: 1000 })
  creados.usuarios = (us?.users ?? []).filter((u) => u.email?.startsWith(`${MARCA}-`)).map((u) => u.id)
  if (creados.empresas.length || creados.usuarios.length) await limpiar()
  creados.empresas = []
  creados.usuarios = []
}

/** Lee la cotización como la ve el servidor. */
const leer = async (id) => (await s.from('sales_quotes').select('*').eq('id', id).single()).data
const lineas = async (id) =>
  (await s.from('sales_quote_lines').select('*').eq('quote_id', id).order('line_no')).data ?? []

/** La forma de una línea tal como la manda el editor. */
const linea = (l) => ({
  id: l.id ?? null,
  line_no: l.line_no,
  line_type: l.line_type ?? 'item',
  product_id: l.product_id ?? null,
  sku_snapshot: l.sku_snapshot ?? null,
  name_snapshot: l.name_snapshot ?? null,
  description_snapshot: l.description_snapshot ?? null,
  quantity: l.quantity,
  unit_price: l.unit_price,
  discount_pct: l.discount_pct ?? 0,
  tax_treatment: l.tax_treatment ?? 'vat_21',
  tax_rate_snapshot: l.tax_rate_snapshot ?? 21,
})
const deLaBase = (l) => linea({ ...l })

async function main() {
  console.log('='.repeat(78))
  console.log('  FASE 15 · E2 — guardar_cotizacion')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(78))

  await barrerRestos()
  const cuentaGlobal = async (t) => (await s.from(t).select('*', { count: 'exact', head: true })).count
  const TABLAS = ['sales_quotes', 'sales_quote_lines', 'sales_orders', 'deliveries', 'products', 'price_lists', 'sales_audit']
  const base = {}
  for (const t of TABLAS) base[t] = await cuentaGlobal(t)
  console.log(`  baseline: ${TABLAS.map((t) => `${t}=${base[t]}`).join('  ')}`)

  // ── Fixture ──────────────────────────────────────────────────────────────
  const empresa = ok(await s.from('companies').insert({
    slug: `${MARCA}-a-${Date.now()}`, name: 'ZZ E2 A', legal_name: 'ZZ E2 A SA', default_currency: 'USD',
  }).select('id').single(), 'empresa A')
  creados.empresas.push(empresa.id)
  const empresaB = ok(await s.from('companies').insert({
    slug: `${MARCA}-b-${Date.now()}`, name: 'ZZ E2 B', legal_name: 'ZZ E2 B SA', default_currency: 'USD',
  }).select('id').single(), 'empresa B')
  creados.empresas.push(empresaB.id)

  const cli1 = ok(await s.from('customers').insert({ company_id: empresa.id, legal_name: 'ZZ E2 Cliente 1 SA', status: 'active' }).select('id').single(), 'cliente 1')
  const cli2 = ok(await s.from('customers').insert({ company_id: empresa.id, legal_name: 'ZZ E2 Cliente 2 SA', status: 'active' }).select('id').single(), 'cliente 2')
  const cont1 = ok(await s.from('customer_contacts').insert({ company_id: empresa.id, customer_id: cli1.id, full_name: 'ZZ Contacto de 1' }).select('id').single(), 'contacto 1')
  const cont2 = ok(await s.from('customer_contacts').insert({ company_id: empresa.id, customer_id: cli2.id, full_name: 'ZZ Contacto de 2' }).select('id').single(), 'contacto 2')

  const listaUsd = ok(await s.from('price_lists').insert({ company_id: empresa.id, name: 'ZZ E2 Lista USD', currency_code: 'USD' }).select('id').single(), 'lista USD')
  const listaArs = ok(await s.from('price_lists').insert({ company_id: empresa.id, name: 'ZZ E2 Lista ARS', currency_code: 'ARS' }).select('id').single(), 'lista ARS')
  const listaB = ok(await s.from('price_lists').insert({ company_id: empresaB.id, name: 'ZZ E2 Lista de B', currency_code: 'USD' }).select('id').single(), 'lista de B')

  // Los productos exigen categoría.
  const cat = ok(await s.from('product_categories').insert({ company_id: empresa.id, name: 'ZZ E2 Categoría', slug: 'zz-e2-cat', position: 1, needs_review: false }).select('id').single(), 'categoría')
  const catB = ok(await s.from('product_categories').insert({ company_id: empresaB.id, name: 'ZZ E2 Categoría B', slug: 'zz-e2-cat-b', position: 1, needs_review: false }).select('id').single(), 'categoría B')
  const prod = ok(await s.from('products').insert({ company_id: empresa.id, category_id: cat.id, sku: 'ZZE2-1', name: 'ZZ E2 Producto', status: 'active', attributes: {} }).select('id').single(), 'producto')
  const prodB = ok(await s.from('products').insert({ company_id: empresaB.id, category_id: catB.id, sku: 'ZZE2-B', name: 'ZZ E2 Producto de B', status: 'active', attributes: {} }).select('id').single(), 'producto de B')

  const admin = await usuarioTemporal(empresa.id, 'admin')
  const employee = await usuarioTemporal(empresa.id, 'employee')
  const vendedor = await usuarioTemporal(empresa.id, 'salesperson')
  const tecnico = await usuarioTemporal(empresa.id, 'technician')
  const adminB = await usuarioTemporal(empresaB.id, 'admin')
  const anon = sesion()

  /** Crea una cotización de prueba con dos líneas. */
  const nuevaCotizacion = async (over = {}) => {
    const q = ok(await s.from('sales_quotes').insert({
      company_id: empresa.id, customer_id: cli1.id, number: `ZZE2-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
      series_code: 'ZZE2', quote_date: '2026-09-01', currency_code: 'USD', title: 'ZZ título original',
      payment_terms: '30 días', status: 'draft', ...over,
    }).select('*').single(), 'cotización')
    ok(await s.from('sales_quote_lines').insert([
      { company_id: empresa.id, quote_id: q.id, line_no: 1, line_type: 'item', product_id: prod.id, sku_snapshot: 'ZZE2-1', name_snapshot: 'ZZ E2 Producto', quantity: 2, unit_price: 100, discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21 },
      { company_id: empresa.id, quote_id: q.id, line_no: 2, line_type: 'item', product_id: prod.id, sku_snapshot: 'ZZE2-1', name_snapshot: 'ZZ E2 Segunda', quantity: 1, unit_price: 50, discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21 },
    ]), 'líneas')
    return await leer(q.id)
  }

  const guardar = (cliente, q, cabecera, ls) =>
    cliente.rpc('guardar_cotizacion', {
      p_quote: q.id, p_esperado: q.updated_at, p_cabecera: cabecera, p_lineas: ls,
    })

  // ── 1 · Guardado ─────────────────────────────────────────────────────────
  seccion('1 · Cabecera, líneas y las dos juntas')

  let q = await nuevaCotizacion()
  let ls = await lineas(q.id)

  let r = await guardar(admin.c, q, { title: 'ZZ título nuevo', payment_terms: 'Contado' }, ls.map(deLaBase))
  if (r.error) FAIL('cabecera sola', r.error.message.slice(0, 80))
  else {
    const d = await leer(q.id)
    cmp('cabecera sola: cambia el título', 'ZZ título nuevo', d.title)
    cmp('y la forma de pago', 'Contado', d.payment_terms)
    cmp('sin tocar las líneas', 2, (await lineas(q.id)).length)
  }

  q = await leer(q.id)
  ls = await lineas(q.id)
  r = await guardar(admin.c, q, {}, [deLaBase({ ...ls[0], quantity: 5, unit_price: 110 }), deLaBase(ls[1])])
  if (r.error) FAIL('líneas solas', r.error.message.slice(0, 80))
  else {
    const l = await lineas(q.id)
    cmp('líneas solas: cantidad', 5, Number(l[0].quantity))
    cmp('líneas solas: precio', 110, Number(l[0].unit_price))
    cmp('el título no se movió', 'ZZ título nuevo', (await leer(q.id)).title)
  }

  // Agregar, modificar y borrar en la MISMA llamada.
  q = await leer(q.id)
  ls = await lineas(q.id)
  r = await guardar(admin.c, q, { notes: 'ZZ observación' }, [
    deLaBase({ ...ls[0], description_snapshot: 'ZZ descripción comercial' }),
    // ls[1] no va: se borra.
    linea({ line_no: 3, product_id: prod.id, sku_snapshot: 'ZZE2-1', name_snapshot: 'ZZ Tercera', quantity: 3, unit_price: 70 }),
  ])
  if (r.error) FAIL('agregar + modificar + borrar', r.error.message.slice(0, 80))
  else {
    const l = await lineas(q.id)
    cmp('quedan dos líneas', 2, l.length)
    cmp('la nueva entró', 'ZZ Tercera', l.find((x) => x.line_no === 3)?.name_snapshot)
    cmp('la descripción se guardó', 'ZZ descripción comercial', l.find((x) => x.line_no === 1)?.description_snapshot)
    cmp('la línea 2 se borró', true, !l.some((x) => x.line_no === 2))
    cmp('y la observación', 'ZZ observación', (await leer(q.id)).notes)
  }

  // Totales: los pone el servidor.
  const d = await leer(q.id)
  cmp('el servidor recalculó el subtotal', 760, Number(d.subtotal))

  // ── 2 · Tarifa ───────────────────────────────────────────────────────────
  seccion('2 · Tarifa y moneda')

  q = await leer(q.id)
  ls = await lineas(q.id)
  r = await guardar(admin.c, q, { price_list_id: listaUsd.id }, ls.map(deLaBase))
  if (r.error) FAIL('tarifa compatible', r.error.message.slice(0, 80))
  else cmp('tarifa en la misma moneda: se guarda', listaUsd.id, (await leer(q.id)).price_list_id)

  q = await leer(q.id)
  rechaza('una tarifa en ARS sobre un documento en USD', await guardar(admin.c, q, { price_list_id: listaArs.id }, ls.map(deLaBase)), 'TARIFA_OTRA_MONEDA')
  rechaza('una tarifa de otra empresa', await guardar(admin.c, q, { price_list_id: listaB.id }, ls.map(deLaBase)), 'TARIFA_INVALIDA')
  cmp('la tarifa buena sigue puesta', listaUsd.id, (await leer(q.id)).price_list_id)

  // Cambiar la tarifa NO reescribe los precios ya cargados.
  const preciosAntes = (await lineas(q.id)).map((l) => Number(l.unit_price)).sort()
  q = await leer(q.id)
  ls = await lineas(q.id)
  await guardar(admin.c, q, { price_list_id: null }, ls.map(deLaBase))
  const preciosDespues = (await lineas(q.id)).map((l) => Number(l.unit_price)).sort()
  cmp('sacar la tarifa NO cambia los precios de las líneas', JSON.stringify(preciosAntes), JSON.stringify(preciosDespues))

  // ── 3 · Cliente y contacto ───────────────────────────────────────────────
  seccion('3 · Cliente, contacto y vendedor')

  q = await leer(q.id)
  ls = await lineas(q.id)
  r = await guardar(admin.c, q, { customer_id: cli1.id, contact_id: cont1.id }, ls.map(deLaBase))
  if (r.error) FAIL('contacto del cliente correcto', r.error.message.slice(0, 80))
  else cmp('contacto del cliente correcto: se guarda', cont1.id, (await leer(q.id)).contact_id)

  q = await leer(q.id)
  rechaza('un contacto que es de OTRO cliente', await guardar(admin.c, q, { customer_id: cli1.id, contact_id: cont2.id }, ls.map(deLaBase)), 'CONTACTO_DE_OTRO_CLIENTE')
  cmp('el contacto bueno sigue puesto', cont1.id, (await leer(q.id)).contact_id)

  q = await leer(q.id)
  r = await guardar(admin.c, q, { salesperson_id: vendedor.id }, ls.map(deLaBase))
  if (r.error) FAIL('vendedor de la empresa', r.error.message.slice(0, 80))
  else cmp('vendedor de la empresa: se guarda', vendedor.id, (await leer(q.id)).salesperson_id)

  q = await leer(q.id)
  rechaza('un vendedor de otra empresa', await guardar(admin.c, q, { salesperson_id: adminB.id }, ls.map(deLaBase)), 'VENDEDOR_INVALIDO')

  // ── 4 · Payload cerrado ──────────────────────────────────────────────────
  seccion('4 · Campos inyectados')

  for (const campo of ['company_id', 'number', 'status', 'imported_at', 'external_id', 'created_by', 'subtotal', 'total']) {
    q = await leer(q.id)
    rechaza(`inyectar ${campo}`, await guardar(admin.c, q, { [campo]: 'x' }, ls.map(deLaBase)), 'CAMPO_NO_PERMITIDO')
  }

  q = await leer(q.id)
  rechaza('un producto de otra empresa', await guardar(admin.c, q, {}, [deLaBase({ ...ls[0], product_id: prodB.id })]), 'PRODUCTO_INVALIDO')
  rechaza('cantidad en cero', await guardar(admin.c, q, {}, [deLaBase({ ...ls[0], quantity: 0 })]), 'CANTIDAD_INVALIDA')
  rechaza('descuento del 150 %', await guardar(admin.c, q, {}, [deLaBase({ ...ls[0], discount_pct: 150 })]), 'DESCUENTO_INVALIDO')
  rechaza('precio negativo', await guardar(admin.c, q, {}, [deLaBase({ ...ls[0], unit_price: -5 })]), 'PRECIO_INVALIDO')

  // Una línea de OTRA cotización no se puede tocar desde acá.
  const otra = await nuevaCotizacion()
  const lineaAjena = (await lineas(otra.id))[0]
  q = await leer(q.id)
  rechaza('editar una línea de otra cotización', await guardar(admin.c, q, {}, [deLaBase({ ...lineaAjena, quantity: 9 })]), 'LINEA_AJENA')

  // ── 5 · Rollback ─────────────────────────────────────────────────────────
  seccion('5 · Rollback: o entra todo o no entra nada')

  q = await leer(q.id)
  ls = await lineas(q.id)
  const tituloAntes = q.title
  const cantAntes = ls.map((l) => Number(l.quantity))
  // La cabecera es válida y la SEGUNDA línea no: nada tiene que quedar.
  r = await guardar(admin.c, q, { title: 'ZZ NO DEBE QUEDAR' }, [
    deLaBase({ ...ls[0], quantity: 99 }),
    deLaBase({ ...ls[1], quantity: 0 }),
  ])
  rechaza('una línea inválida corta el guardado entero', r, 'CANTIDAD_INVALIDA')
  cmp('el título NO cambió', tituloAntes, (await leer(q.id)).title)
  cmp('las cantidades NO cambiaron', JSON.stringify(cantAntes), JSON.stringify((await lineas(q.id)).map((l) => Number(l.quantity))))

  // ── 6 · Concurrencia ─────────────────────────────────────────────────────
  seccion('6 · Concurrencia optimista')

  q = await leer(q.id)
  ls = await lineas(q.id)
  const viejo = { ...q }
  r = await guardar(admin.c, q, { title: 'ZZ primera edición' }, ls.map(deLaBase))
  if (r.error) FAIL('la primera edición guarda', r.error.message.slice(0, 80))
  else PASS('la primera edición guarda')
  rechaza('la segunda, con el snapshot viejo, NO pisa', await guardar(employee.c, viejo, { title: 'ZZ segunda edición' }, ls.map(deLaBase)), 'CONFLICTO_DE_EDICION')
  cmp('gana la primera', 'ZZ primera edición', (await leer(q.id)).title)

  // Doble submit del mismo snapshot: el segundo es un conflicto, no un duplicado.
  q = await leer(q.id)
  ls = await lineas(q.id)
  const eventos6 = async () =>
    (await s.from('sales_audit').select('*', { count: 'exact', head: true }).eq('entity_id', q.id)).count
  const eventosAntes = await eventos6()
  const arranque = Date.now()
  const dobles = await Promise.all([
    guardar(admin.c, q, { title: 'ZZ doble' }, ls.map(deLaBase)),
    guardar(admin.c, q, { title: 'ZZ doble' }, ls.map(deLaBase)),
  ])
  const tardanza = Date.now() - arranque
  cmp('doble submit: exactamente uno entra', 1, dobles.filter((x) => !x.error).length)
  rechaza('el que pierde recibe CONFLICTO_DE_EDICION', dobles.find((x) => x.error) ?? {}, 'CONFLICTO_DE_EDICION')
  // El conflicto tiene que volver enseguida. Con `errcode = '40001'` PostgREST
  // lo tomaba por transitorio y reintentaba 125 segundos hasta el timeout del
  // gateway; con el P0001 por defecto contesta 400 al instante. El umbral es
  // generoso a propósito: no mide performance, detecta el reintento.
  if (tardanza < 10_000) PASS('el conflicto vuelve sin reintento largo', `${tardanza} ms`)
  else FAIL('el conflicto vuelve sin reintento largo', `tardó ${tardanza} ms`)
  cmp('y no se duplicaron líneas', ls.length, (await lineas(q.id)).length)
  cmp('el documento quedó con lo del ganador', 'ZZ doble', (await leer(q.id)).title)
  cmp('la auditoría sumó UN solo evento', eventosAntes + 1, await eventos6())

  // ── 7 · Estado y roles ───────────────────────────────────────────────────
  seccion('7 · Estado y roles')

  const enviada = await nuevaCotizacion({ status: 'draft' })
  ok(await s.from('sales_quotes').update({ status: 'sent' }).eq('id', enviada.id), 'enviar')
  let qe = await leer(enviada.id)
  r = await guardar(admin.c, qe, { title: 'ZZ enviada editable' }, (await lineas(qe.id)).map(deLaBase))
  if (r.error) FAIL('una cotización enviada se edita', r.error.message.slice(0, 80))
  else PASS('una cotización enviada se edita')

  ok(await s.from('sales_quotes').update({ status: 'accepted' }).eq('id', enviada.id), 'aceptar')
  qe = await leer(enviada.id)
  rechaza('una cotización aceptada NO', await guardar(admin.c, qe, { title: 'ZZ no' }, (await lineas(qe.id)).map(deLaBase)), 'ESTADO_NO_EDITABLE')

  q = await leer(q.id)
  ls = await lineas(q.id)
  r = await guardar(employee.c, q, { title: 'ZZ employee' }, ls.map(deLaBase))
  if (r.error) FAIL('el employee edita', r.error.message.slice(0, 80))
  else PASS('el employee edita')

  q = await leer(q.id)
  rechaza('el vendedor NO edita cotizaciones', await guardar(vendedor.c, q, { title: 'ZZ v' }, ls.map(deLaBase)), 'SIN_PERMISO')
  rechaza('el técnico tampoco', await guardar(tecnico.c, q, { title: 'ZZ t' }, ls.map(deLaBase)), 'SIN_PERMISO')
  rechaza('un admin de otra empresa tampoco', await guardar(adminB.c, q, { title: 'ZZ b' }, ls.map(deLaBase)), 'SIN_PERMISO')
  rechaza('el anónimo tampoco', await anon.rpc('guardar_cotizacion', { p_quote: q.id, p_esperado: q.updated_at, p_cabecera: {}, p_lineas: [] }), null)
  cmp('después de los intentos el título sigue siendo el del employee', 'ZZ employee', (await leer(q.id)).title)

  // ── 8 · Auditoría ────────────────────────────────────────────────────────
  seccion('8 · Auditoría con el valor anterior')

  const audit = await nuevaCotizacion()
  let qa = await leer(audit.id)
  let la = await lineas(qa.id)
  ok(await s.from('sales_audit').delete().eq('entity_id', qa.id), 'limpiar auditoría')

  r = await guardar(admin.c, qa, { payment_terms: 'Contado' }, [
    deLaBase({ ...la[0], unit_price: 110, quantity: 3 }),
    deLaBase(la[1]),
  ])
  if (r.error) FAIL('guardar para auditar', r.error.message.slice(0, 80))

  const { data: eventos } = await s.from('sales_audit').select('*').eq('entity_id', qa.id)
  cmp('se registró UN evento', 1, (eventos ?? []).length)
  const diff = eventos?.[0]?.diff ?? {}
  cmp('la forma de pago guarda el valor anterior', '30 días', diff.payment_terms?.from)
  cmp('y el nuevo', 'Contado', diff.payment_terms?.to)
  const modificada = (diff.lineas ?? []).find((x) => x.accion === 'modificada')
  cmp('el precio de la línea guarda el anterior', 100, Number(modificada?.cambios?.unit_price?.from))
  cmp('y el nuevo', 110, Number(modificada?.cambios?.unit_price?.to))
  cmp('la cantidad también', 2, Number(modificada?.cambios?.quantity?.from))
  cmp('el actor quedó registrado', admin.id, eventos?.[0]?.actor_id)

  // Guardar sin cambios no ensucia el historial.
  qa = await leer(qa.id)
  la = await lineas(qa.id)
  await guardar(admin.c, qa, {}, la.map(deLaBase))
  const { count: sinCambios } = await s.from('sales_audit').select('*', { count: 'exact', head: true }).eq('entity_id', qa.id)
  cmp('guardar sin cambios NO agrega evento', 1, sinCambios)

  // ── 9 · Invariantes ──────────────────────────────────────────────────────
  seccion('9 · Limpieza e invariantes')
  await limpiar()
  creados.empresas = []
  for (const t of TABLAS) cmp(`${t} vuelve a su conteo`, base[t], await cuentaGlobal(t))
  const { count: zz } = await s.from('companies').select('id', { count: 'exact', head: true }).like('slug', `${MARCA}-%`)
  cmp('no queda ninguna empresa de prueba', 0, zz)

  console.log('\n' + '='.repeat(78))
  console.log(fallos === 0 ? '  RESULTADO: 0 FALLOS' : `  RESULTADO: ${fallos} FALLO(S)`)
  console.log('='.repeat(78))
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('\n✗', e.message)
  await limpiar().catch(() => {})
  process.exit(1)
})
