/**
 * Fase 19 · E4 — Serie explícita en el pedido: alta manual y conversión.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase19-e4-pedido-serie-tests.mjs
 *
 * Todo lo que ESCRIBE pasa en empresas fixture `zz-e4p`, nunca en Buscatools.
 * De producción sólo se leen invariantes.
 *
 * ALTA MANUAL
 * A · sin serie → la conducta de siempre (serie por defecto)
 * B · serie de STEL explícita → bloqueada
 * C · serie del ERP explícita → permitida
 * D · serie inexistente → SERIE_INVALIDA
 * E · serie de otra empresa → SERIE_INVALIDA
 * F · serie de otro doc_type → SERIE_INVALIDA
 * G · anónimo → rechazado
 * H · roles: salesperson no, employee y admin sí
 * I · dos altas concurrentes → dos números distintos, sin huecos
 * J · la serie por defecto no se mueve al emitir en otra
 * K · la autoridad no cambia por crear
 * L · un insert directo con serie STEL lo sigue frenando el trigger
 *
 * CONVERSIÓN
 * M · la función vieja se sigue comportando igual
 * N · la nueva con la serie de STEL → bloqueada
 * O · la nueva con la serie del ERP → permitida
 * P · serie inexistente → SERIE_INVALIDA
 * Q · serie de otra empresa → SERIE_INVALIDA
 * R · dos conversiones simultáneas → UN solo pedido
 * S · el snapshot aprobado se conserva exacto
 * T · cambiar la tarifa después NO toca el pedido
 * U · la cotización no queda modificada
 * V · stock_movements = 0
 * W · stock_reservations = 0
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET) { console.error('✗ Faltan variables de entorno'); process.exit(1) }

const BUSCATOOLS = 'bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c'

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(70)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const cmp = (t, esperado, real) =>
  String(esperado) === String(real) ? PASS(t, String(real)) : FAIL(t, `esperaba ${esperado}, dio ${real}`)
const contiene = (t, texto, aguja) =>
  String(texto).includes(aguja) ? PASS(t, aguja) : FAIL(t, `esperaba «${aguja}», dio «${texto}»`)

const s = createClient(BASE, SECRET, { auth: { persistSession: false } })
const sesion = () => createClient(BASE, PUB, { auth: { persistSession: false } })
const ok = (r, q) => { if (r.error) throw new Error(`${q}: ${r.error.message}`); return r.data }

const MARCA = 'zz-e4p'
const creados = { usuarios: [], empresas: [] }

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
    const pedidos = (await s.from('sales_orders').select('id').in('company_id', ids)).data ?? []
    if (pedidos.length) await s.from('sales_order_lines').delete().in('order_id', pedidos.map((x) => x.id))
    const cotis = (await s.from('sales_quotes').select('id').in('company_id', ids)).data ?? []
    if (cotis.length) await s.from('sales_quote_lines').delete().in('quote_id', cotis.map((x) => x.id))
    for (const t of ['sales_audit', 'sales_orders', 'sales_quotes', 'product_prices', 'products',
                     'product_categories', 'price_lists',
                     'document_numbering_authority_series', 'document_numbering_authority',
                     'document_sequences', 'company_memberships', 'customers']) {
      const r = await s.from(t).delete().in('company_id', ids)
      if (r.error) console.log(`    aviso ${t}: ${r.error.message.slice(0, 110)}`)
    }
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
  if (creados.empresas.length) {
    console.log(`  barriendo ${creados.empresas.length} empresa(s) de una corrida anterior`)
    await limpiar()
  }
  creados.empresas = []
}

/** Alta manual de pedido; devuelve `{ ok, codigo | datos }` sin romper. */
const crearPedido = async (cliente, companyId, cabecera, lineas = [{ quantity: 1, unit_price: 10 }]) => {
  const r = await cliente.rpc('crear_pedido', { p_company: companyId, p_cabecera: cabecera, p_lineas: lineas })
  return r.error ? { ok: false, codigo: r.error.message } : { ok: true, datos: r.data }
}
const convertirVieja = async (cliente, quote) => {
  const r = await cliente.rpc('convertir_cotizacion_en_pedido', { p_quote: quote, p_esperado: null })
  return r.error ? { ok: false, codigo: r.error.message } : { ok: true, datos: r.data }
}
const convertirEnSerie = async (cliente, quote, serie) => {
  const r = await cliente.rpc('convertir_cotizacion_en_pedido_en_serie', {
    p_quote: quote, p_esperado: null, p_serie: serie,
  })
  return r.error ? { ok: false, codigo: r.error.message } : { ok: true, datos: r.data }
}
const secuencia = async (companyId, serie) =>
  (ok(await s.from('document_sequences').select('next_number')
    .eq('company_id', companyId).eq('doc_type', 'sales_order').eq('series_code', serie).single(), 'secuencia')).next_number

async function main() {
  console.log('\n═══ Fase 19 · E4 — Serie explícita en el pedido ═══')
  await barrerRestos()

  const sello = Date.now()
  const empresa = async (letra, nombre) => {
    const id = ok(await s.from('companies').insert({
      slug: `${MARCA}-${letra}-${sello}`, name: nombre, legal_name: `${nombre} SA`, default_currency: 'USD',
    }).select('id').single(), `empresa ${letra}`).id
    creados.empresas.push(id)
    return id
  }
  // A imita a Buscatools: pedidos en STEL, con una serie piloto en ERP.
  const A = await empresa('a', 'ZZ E4P Alfa')
  // C es una empresa sin STEL: ahí la serie por defecto sí emite.
  const C = await empresa('c', 'ZZ E4P Charlie')
  // B sólo existe para prestar una serie ajena.
  const B = await empresa('b', 'ZZ E4P Beta')

  ok(await s.from('document_sequences').insert([
    { company_id: A, doc_type: 'sales_order', series_code: 'ZZDEF', prefix: 'ZZDEF', padding: 5, next_number: 1, is_default: true },
    { company_id: A, doc_type: 'sales_order', series_code: 'ZZERP', prefix: 'ZZERP', padding: 5, next_number: 1, is_default: false },
    { company_id: A, doc_type: 'quote', series_code: 'ZZQ', prefix: 'ZZQ', padding: 5, next_number: 1, is_default: true },
    { company_id: C, doc_type: 'sales_order', series_code: 'ZZCDEF', prefix: 'ZZCDEF', padding: 5, next_number: 1, is_default: true },
    { company_id: C, doc_type: 'quote', series_code: 'ZZCQ', prefix: 'ZZCQ', padding: 5, next_number: 1, is_default: true },
    { company_id: B, doc_type: 'sales_order', series_code: 'ZZOTRA', prefix: 'ZZOTRA', padding: 5, next_number: 1, is_default: true },
  ]), 'secuencias')
  ok(await s.from('document_numbering_authority').insert(
    { company_id: A, doc_type: 'sales_order', authority: 'STEL', reason: 'fixture zz-e4p: pedidos en STEL' },
  ), 'autoridad general A')
  ok(await s.from('document_numbering_authority_series').insert(
    { company_id: A, doc_type: 'sales_order', series_code: 'ZZERP', authority: 'ERP', reason: 'fixture zz-e4p: serie piloto' },
  ), 'autoridad de serie A')

  const clienteA = ok(await s.from('customers').insert({ company_id: A, legal_name: 'ZZ E4P Cliente A' }).select('id').single(), 'cliente A').id
  const clienteC = ok(await s.from('customers').insert({ company_id: C, legal_name: 'ZZ E4P Cliente C' }).select('id').single(), 'cliente C').id

  const admin = await usuarioTemporal(A, 'admin')
  const empleado = await usuarioTemporal(A, 'employee')
  const vendedor = await usuarioTemporal(A, 'salesperson')
  const adminC = await usuarioTemporal(C, 'admin')

  // ── ALTA MANUAL ─────────────────────────────────────────────────────────
  seccion('A–F · el alta manual y la serie')
  const sinSerie = await crearPedido(adminC.c, C, { customer_id: clienteC, currency_code: 'USD' })
  cmp('A · sin serie crea con la de por defecto', true, sinSerie.ok)
  if (sinSerie.ok) cmp('A · y el número sale de ella', 'ZZCDEF00001', sinSerie.datos.number)

  const conDefStel = await crearPedido(admin.c, A, { customer_id: clienteA, currency_code: 'USD', series_code: 'ZZDEF' })
  cmp('B · la serie de STEL explícita queda bloqueada', false, conDefStel.ok)
  if (!conDefStel.ok) contiene('B · y lo dice la autoridad', conDefStel.codigo, 'external_numbering_authority')

  const conErp = await crearPedido(admin.c, A, { customer_id: clienteA, currency_code: 'USD', series_code: 'ZZERP' })
  cmp('C · la serie del ERP explícita se permite', true, conErp.ok)
  if (conErp.ok) cmp('C · y numera en ella', 'ZZERP00001', conErp.datos.number)

  const inexistente = await crearPedido(admin.c, A, { customer_id: clienteA, currency_code: 'USD', series_code: 'NO-EXISTE' })
  cmp('D · serie inexistente', false, inexistente.ok)
  if (!inexistente.ok) contiene('D · SERIE_INVALIDA', inexistente.codigo, 'SERIE_INVALIDA')

  const ajena = await crearPedido(admin.c, A, { customer_id: clienteA, currency_code: 'USD', series_code: 'ZZOTRA' })
  cmp('E · serie de otra empresa', false, ajena.ok)
  if (!ajena.ok) contiene('E · SERIE_INVALIDA', ajena.codigo, 'SERIE_INVALIDA')

  const otroTipo = await crearPedido(admin.c, A, { customer_id: clienteA, currency_code: 'USD', series_code: 'ZZQ' })
  cmp('F · serie de otro tipo de documento', false, otroTipo.ok)
  if (!otroTipo.ok) contiene('F · SERIE_INVALIDA', otroTipo.codigo, 'SERIE_INVALIDA')

  seccion('G–H · quién puede')
  const anon = await crearPedido(sesion(), A, { customer_id: clienteA, currency_code: 'USD', series_code: 'ZZERP' })
  cmp('G · anónimo rechazado', false, anon.ok)

  const comoVendedor = await crearPedido(vendedor.c, A, { customer_id: clienteA, currency_code: 'USD', series_code: 'ZZERP' })
  cmp('H · salesperson no puede', false, comoVendedor.ok)
  if (!comoVendedor.ok) contiene('H · SIN_PERMISO', comoVendedor.codigo, 'SIN_PERMISO')
  const comoEmpleado = await crearPedido(empleado.c, A, { customer_id: clienteA, currency_code: 'USD', series_code: 'ZZERP' })
  cmp('H · employee sí puede', true, comoEmpleado.ok)

  seccion('I–L · numeración y barreras')
  const antesErp = await secuencia(A, 'ZZERP')
  const [c1, c2] = await Promise.all([
    crearPedido(admin.c, A, { customer_id: clienteA, currency_code: 'USD', series_code: 'ZZERP' }),
    crearPedido(admin.c, A, { customer_id: clienteA, currency_code: 'USD', series_code: 'ZZERP' }),
  ])
  cmp('I · las dos altas concurrentes entran', true, c1.ok && c2.ok)
  if (c1.ok && c2.ok) {
    cmp('I · con números distintos', true, c1.datos.number !== c2.datos.number)
    cmp('I · y sin huecos', antesErp + 2, await secuencia(A, 'ZZERP'))
  }
  cmp('J · la serie por defecto no se movió', 1, await secuencia(A, 'ZZDEF'))
  cmp('K · la autoridad general sigue igual', 'STEL',
    (ok(await s.from('document_numbering_authority').select('authority')
      .eq('company_id', A).eq('doc_type', 'sales_order').single(), 'autoridad')).authority)

  const directo = await s.from('sales_orders').insert({
    company_id: A, number: 'ZZDEF99999', series_code: 'ZZDEF', customer_id: clienteA,
    order_date: new Date().toISOString().slice(0, 10), currency_code: 'USD',
  })
  cmp('L · un insert directo en la serie de STEL lo frena el trigger', true, directo.error !== null)

  // ── CONVERSIÓN ──────────────────────────────────────────────────────────
  seccion('M–Q · la conversión y la serie')
  const LINEA = {
    quantity: 3, unit_price: 77.5, discount_pct: 10, tax_treatment: 'vat_21', tax_rate_snapshot: 21,
    sku_snapshot: 'ZZ-SKU-1', name_snapshot: 'Producto de prueba',
  }
  const cotizar = async (cliente, companyId, customer, extra = {}) => {
    const r = await cliente.rpc('crear_cotizacion', {
      p_company: companyId,
      p_cabecera: { customer_id: customer, currency_code: 'USD', ...extra },
      p_lineas: [LINEA],
    })
    if (r.error) throw new Error(`cotizar: ${r.error.message}`)
    return r.data
  }

  const qC = await cotizar(adminC.c, C, clienteC)
  const vieja = await convertirVieja(adminC.c, qC.id)
  cmp('M · la función vieja sigue convirtiendo', true, vieja.ok)
  if (vieja.ok) cmp('M · con la serie por defecto de siempre', 'ZZCDEF00002', vieja.datos.number)

  const qA1 = await cotizar(admin.c, A, clienteA)
  const conStel = await convertirEnSerie(admin.c, qA1.id, 'ZZDEF')
  cmp('N · la nueva con la serie de STEL queda bloqueada', false, conStel.ok)
  if (!conStel.ok) contiene('N · y lo dice la autoridad', conStel.codigo, 'external_numbering_authority')

  const conErpConv = await convertirEnSerie(admin.c, qA1.id, 'ZZERP')
  cmp('O · la nueva con la serie del ERP convierte', true, conErpConv.ok)
  if (conErpConv.ok) contiene('O · y numera en ella', conErpConv.datos.number, 'ZZERP')

  const qA2 = await cotizar(admin.c, A, clienteA)
  const convInexistente = await convertirEnSerie(admin.c, qA2.id, 'NO-EXISTE')
  cmp('P · serie inexistente', false, convInexistente.ok)
  if (!convInexistente.ok) contiene('P · SERIE_INVALIDA', convInexistente.codigo, 'SERIE_INVALIDA')

  const convAjena = await convertirEnSerie(admin.c, qA2.id, 'ZZOTRA')
  cmp('Q · serie de otra empresa', false, convAjena.ok)
  if (!convAjena.ok) contiene('Q · SERIE_INVALIDA', convAjena.codigo, 'SERIE_INVALIDA')

  const sinSerieEnLaNueva = await convertirEnSerie(admin.c, qA2.id, '   ')
  cmp('Q · la nueva EXIGE serie: no adivina', false, sinSerieEnLaNueva.ok)
  if (!sinSerieEnLaNueva.ok) contiene('Q · SERIE_REQUERIDA', sinSerieEnLaNueva.codigo, 'SERIE_REQUERIDA')

  seccion('R · dos conversiones a la vez')
  const qA3 = await cotizar(admin.c, A, clienteA)
  const [r1, r2] = await Promise.all([
    convertirEnSerie(admin.c, qA3.id, 'ZZERP'),
    convertirEnSerie(admin.c, qA3.id, 'ZZERP'),
  ])
  cmp('R · una sola gana', 1, [r1.ok, r2.ok].filter(Boolean).length)
  cmp('R · y queda UN pedido para esa cotización', 1,
    (ok(await s.from('sales_orders').select('id').eq('quote_id', qA3.id), 'pedidos de qA3')).length)
  const perdedora = [r1, r2].find((x) => !x.ok)
  if (perdedora) contiene('R · la otra recibe PEDIDO_YA_EXISTE', perdedora.codigo, 'PEDIDO_YA_EXISTE')

  seccion('S–U · el snapshot aprobado')
  const pedidoConv = ok(await s.from('sales_orders').select('*').eq('quote_id', qA1.id).single(), 'pedido de qA1')
  const lineaCot = ok(await s.from('sales_quote_lines').select('*').eq('quote_id', qA1.id).single(), 'línea de qA1')
  const lineaPed = ok(await s.from('sales_order_lines').select('*').eq('order_id', pedidoConv.id).single(), 'línea del pedido')
  cmp('S · precio', String(lineaCot.unit_price), String(lineaPed.unit_price))
  cmp('S · cantidad', String(lineaCot.quantity), String(lineaPed.quantity_ordered))
  cmp('S · descuento', String(lineaCot.discount_pct), String(lineaPed.discount_pct))
  cmp('S · impuesto', `${lineaCot.tax_treatment}/${lineaCot.tax_rate_snapshot}`,
    `${lineaPed.tax_treatment}/${lineaPed.tax_rate_snapshot}`)
  cmp('S · el vínculo con la línea de la cotización', lineaCot.id, lineaPed.quote_line_id)
  cmp('S · la tarifa de la cotización', String(pedidoConv.price_list_id), String(
    (ok(await s.from('sales_quotes').select('price_list_id').eq('id', qA1.id).single(), 'tarifa de qA1')).price_list_id))

  // T · una tarifa que cambia DESPUÉS no puede tocar el pedido.
  const tarifa = ok(await s.from('price_lists').insert({
    company_id: A, name: 'ZZ E4P Tarifa', currency_code: 'USD',
  }).select('id').single(), 'tarifa').id
  const rubro = ok(await s.from('product_categories').insert({
    company_id: A, name: 'ZZ E4P Rubro', slug: `zz-e4p-rubro-${sello}`,
  }).select('id').single(), 'rubro').id
  const producto = ok(await s.from('products').insert({
    company_id: A, sku: `ZZ-E4P-${sello}`, name: 'ZZ E4P Producto', category_id: rubro,
  }).select('id').single(), 'producto').id
  const precio = ok(await s.from('product_prices').insert({
    company_id: A, price_list_id: tarifa, product_id: producto, amount: 1000,
  }).select('id').single(), 'precio').id

  const qA4 = await cotizar(admin.c, A, clienteA, { price_list_id: tarifa })
  const conv4 = await convertirEnSerie(admin.c, qA4.id, 'ZZERP')
  cmp('T · convierte con tarifa', true, conv4.ok)
  const antesDeTocar = ok(await s.from('sales_order_lines').select('unit_price')
    .eq('order_id', conv4.datos.id).single(), 'línea antes')
  cmp('T · el precio es el COTIZADO, no el de la tarifa', 77.5, Number(antesDeTocar.unit_price))
  ok(await s.from('product_prices').update({ amount: 2500 }).eq('id', precio), 'mover la tarifa')
  const despuesDeTocar = ok(await s.from('sales_order_lines').select('unit_price')
    .eq('order_id', conv4.datos.id).single(), 'línea después')
  cmp('T · y mover la tarifa no lo cambia', String(antesDeTocar.unit_price), String(despuesDeTocar.unit_price))

  const cotDespues = ok(await s.from('sales_quotes').select('status, updated_at, total').eq('id', qA1.id).single(), 'cot después')
  cmp('U · la cotización sigue en su estado', 'draft', cotDespues.status)

  seccion('V–W · el pedido no toca stock')
  for (const [nombre, tabla] of [['V · movimientos de stock', 'stock_movements'], ['W · reservas', 'stock_reservations']]) {
    const r = ok(await s.from(tabla).select('id').in('company_id', creados.empresas), tabla)
    cmp(nombre, 0, r.length)
  }

  seccion('Producción (sólo lectura)')
  const prod = {
    pedidos: (await s.from('sales_orders').select('id', { count: 'exact', head: true }).eq('company_id', BUSCATOOLS)).count,
    remitos: (await s.from('deliveries').select('id', { count: 'exact', head: true }).eq('company_id', BUSCATOOLS)).count,
    stock: (await s.from('stock_movements').select('id', { count: 'exact', head: true }).eq('company_id', BUSCATOOLS)).count,
    reservas: (await s.from('stock_reservations').select('id', { count: 'exact', head: true }).eq('company_id', BUSCATOOLS)).count,
  }
  console.log(`    pedidos ${prod.pedidos} · remitos ${prod.remitos} · stock ${prod.stock} · reservas ${prod.reservas}`)
  const pdv = (ok(await s.from('document_sequences').select('next_number, is_default')
    .eq('company_id', BUSCATOOLS).eq('doc_type', 'sales_order').eq('series_code', 'PDV').single(), 'PDV'))
  const pdvErp = (ok(await s.from('document_sequences').select('next_number, is_default')
    .eq('company_id', BUSCATOOLS).eq('doc_type', 'sales_order').eq('series_code', 'PDV-ERP').single(), 'PDV-ERP'))
  cmp('PDV sigue por defecto', true, pdv.is_default)
  cmp('PDV-ERP NO es la de por defecto', false, pdvErp.is_default)
  console.log(`    PDV next ${pdv.next_number} · PDV-ERP next ${pdvErp.next_number}`)

  seccion('Limpieza')
  await limpiar()
  const quedan = ok(await s.from('companies').select('id').like('slug', `${MARCA}-%`), 'restos')
  cmp('no quedó nada del fixture', 0, quedan.length)

  console.log(`\n${fallos === 0 ? '  ✓ TODO EN VERDE' : `  ✗ ${fallos} FALLO(S)`}\n`)
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('\n✗ error:', e.message)
  await limpiar().catch(() => {})
  process.exit(1)
})
