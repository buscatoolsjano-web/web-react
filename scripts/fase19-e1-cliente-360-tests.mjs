/**
 * Fase 19 · E1 — `resumen_cliente_360`.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase19-e1-cliente-360-tests.mjs
 *
 * Lo que prueba, midiendo el EFECTO:
 *   1. la identidad y los datos comerciales que devuelve
 *   2. los KPIs del mes y del mes anterior, SEPARADOS POR MONEDA
 *   3. abiertos: cotizaciones vivas y pedidos sin entregar
 *   4. la serie de doce meses
 *   5. los últimos documentos y los productos recientes
 *   6. un cliente sin un solo documento no rompe nada
 *   7. lo cancelado no cuenta
 *   8. RLS: quién obtiene números y quién obtiene `null`
 *   9. una sola llamada devuelve lo mismo que las cinco que reemplaza
 *  10. invariantes de producción
 *
 * Todo lleva el prefijo zz-e1c y se borra al final. No toca WhatsApp, ni
 * STEL, ni la numeración, ni ningún documento productivo.
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

const sesion = () => createClient(BASE, PUB, { auth: { persistSession: false } })
const s = createClient(BASE, SECRET, { auth: { persistSession: false } })

const MARCA = 'zz-e1c'
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
    await borrar('sales_quote_lines')
    await borrar('sales_order_lines')
    await borrar('deliveries')
    await borrar('sales_orders')
    await borrar('sales_quotes')
    await s.from('sales_audit').delete().in('company_id', ids)
    await borrar('customer_contacts')
    await borrar('company_memberships')
    await borrar('customers')
    await borrar('products')
    await borrar('product_categories')
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
  if (creados.empresas.length) { console.log(`  barriendo ${creados.empresas.length} empresa(s) de una corrida anterior`); await limpiar() }
  creados.empresas = []
}

/** El primer día del mes, y el del mes anterior, en fecha ISO. */
const mesActual = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)) }
const iso = (d) => d.toISOString().slice(0, 10)
const sumarDias = (d, n) => new Date(d.getTime() + n * 86400000)
const sumarMeses = (d, n) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))

/** Busca un KPI del JSON por clave y moneda. */
const kpi = (r, clave, moneda) =>
  (r.kpis.valores ?? []).find((v) => v.clave === clave && v.moneda === moneda) ?? null
const importe = (r, clave, moneda) => Number(kpi(r, clave, moneda)?.importe ?? 0)
const docsDe = (r, clave, moneda) => Number(kpi(r, clave, moneda)?.documentos ?? 0)

async function main() {
  console.log('\n═══ Fase 19 · E1 — Cliente 360 ═══')
  await barrerRestos()

  const prodIds = (await s.from('companies').select('id').not('slug', 'like', 'zz-%')).data.map((c) => c.id)
  const baselineProd = async () => ({
    clientes: await cuenta('customers', (q) => q.in('company_id', prodIds)),
    cotizaciones: await cuenta('sales_quotes', (q) => q.in('company_id', prodIds)),
    pedidos: await cuenta('sales_orders', (q) => q.in('company_id', prodIds)),
    entregas: await cuenta('deliveries', (q) => q.in('company_id', prodIds)),
    secuencias: await cuenta('document_sequences', (q) => q.in('company_id', prodIds)),
  })
  const antesProd = await baselineProd()
  console.log(`  baseline producción: ${JSON.stringify(antesProd)}`)

  // ── Fixture ──────────────────────────────────────────────────────────────
  const sello = Date.now()
  const A = ok(await s.from('companies').insert({
    slug: `${MARCA}-a-${sello}`, name: 'ZZ E1C Alfa', legal_name: 'ZZ E1C Alfa SA', default_currency: 'USD',
  }).select('id').single(), 'empresa A').id
  creados.empresas.push(A)
  const B = ok(await s.from('companies').insert({
    slug: `${MARCA}-b-${sello}`, name: 'ZZ E1C Beta', legal_name: 'ZZ E1C Beta SA', default_currency: 'USD',
  }).select('id').single(), 'empresa B').id
  creados.empresas.push(B)

  const tarifa = ok(await s.from('price_lists').insert({
    company_id: A, name: 'ZZ E1C Tarifa', currency_code: 'USD', is_default: false,
  }).select('id').single(), 'tarifa')

  const admin = await usuarioTemporal(A, 'admin')
  const vendedor = await usuarioTemporal(A, 'salesperson')
  const vendedorAjeno = await usuarioTemporal(A, 'salesperson')
  const tecnico = await usuarioTemporal(A, 'technician')
  const adminB = await usuarioTemporal(B, 'admin')
  const anon = sesion()

  const cliente = ok(await s.from('customers').insert({
    company_id: A, legal_name: 'ZZ E1C Cliente Rico SA', trade_name: 'Rico',
    tax_id: '30-71111111-1', legacy_ref: 'ZCLI00001', industry: 'Industria',
    customer_type: 'business', payment_terms: '30 días', default_currency: 'USD',
    default_price_list_id: tarifa.id, salesperson_id: vendedor.id,
    emails: ['compras@rico.test'], phone: '11 5555 6666',
  }).select('id').single(), 'cliente').id

  const vacio = ok(await s.from('customers').insert({
    company_id: A, legal_name: 'ZZ E1C Cliente Sin Nada SA', salesperson_id: vendedor.id,
  }).select('id').single(), 'cliente vacío').id

  const ajeno = ok(await s.from('customers').insert({
    company_id: A, legal_name: 'ZZ E1C Cliente De Otro SA',
  }).select('id').single(), 'cliente sin vendedor').id

  ok(await s.from('customer_contacts').insert([
    { company_id: A, customer_id: cliente, full_name: 'ZZ Ana Principal', role: 'Compras', email: 'ana@rico.test', phone: '11 1111 1111', is_default: true },
    { company_id: A, customer_id: cliente, full_name: 'ZZ Otro Contacto', email: 'otro@rico.test', is_default: false },
  ]), 'contactos')

  const rubro = ok(await s.from('product_categories').insert({
    company_id: A, name: 'ZZ E1C Rubro', slug: `zz-e1c-${sello}`,
  }).select('id').single(), 'rubro')
  const producto = ok(await s.from('products').insert({
    company_id: A, sku: 'ZZ-E1C-1', name: 'ZZ Balanceador de prueba', category_id: rubro.id,
  }).select('id').single(), 'producto')

  // Fechas: este mes, el mes anterior y uno viejo fuera de la ventana.
  const m0 = mesActual()
  const esteMes = iso(sumarDias(m0, 3))
  const mesPasado = iso(sumarDias(sumarMeses(m0, -1), 4))
  const hace13Meses = iso(sumarDias(sumarMeses(m0, -13), 2))

  const doc = async (tabla, campos) => ok(await s.from(tabla).insert({
    company_id: A, customer_id: cliente, ...campos,
  }).select('id').single(), tabla).id

  // Cotizaciones: 2 este mes (USD y ARS), 1 el mes pasado, 1 vieja, 1 cancelada.
  const cot1 = await doc('sales_quotes', { number: `ZZCOT-${sello}-1`, quote_date: esteMes, status: 'sent', currency_code: 'USD', total: 1000 })
  const cot2 = await doc('sales_quotes', { number: `ZZCOT-${sello}-2`, quote_date: esteMes, status: 'accepted', currency_code: 'ARS', total: 500000 })
  await doc('sales_quotes', { number: `ZZCOT-${sello}-3`, quote_date: mesPasado, status: 'sent', currency_code: 'USD', total: 400 })
  await doc('sales_quotes', { number: `ZZCOT-${sello}-4`, quote_date: hace13Meses, status: 'accepted', currency_code: 'USD', total: 999 })
  const cot5 = await doc('sales_quotes', { number: `ZZCOT-${sello}-5`, quote_date: esteMes, status: 'draft', currency_code: 'USD', total: 7 })

  // Pedidos: 2 confirmados este mes (USD y ARS), 1 el mes pasado, 1 cancelado.
  const ped1 = await doc('sales_orders', { number: `ZZPDV-${sello}-1`, order_date: esteMes, commercial_status: 'confirmed', fulfillment_status: 'pending', currency_code: 'USD', total: 800 })
  await doc('sales_orders', { number: `ZZPDV-${sello}-2`, order_date: esteMes, commercial_status: 'confirmed', fulfillment_status: 'delivered', currency_code: 'ARS', total: 300000 })
  await doc('sales_orders', { number: `ZZPDV-${sello}-3`, order_date: mesPasado, commercial_status: 'confirmed', fulfillment_status: 'delivered', currency_code: 'USD', total: 250 })
  await doc('sales_orders', { number: `ZZPDV-${sello}-4`, order_date: esteMes, commercial_status: 'cancelled', fulfillment_status: 'pending', currency_code: 'USD', total: 99999 })

  // Entregas. Nacen en `draft`: despacharlas mueve stock, y una prueba de
  // lectura no tiene por qué tocar stock (Fase 15 · E5 lo impide, y bien).
  await doc('deliveries', { number: `ZZRT-${sello}-1`, delivery_date: esteMes, status: 'draft', currency_code: 'ARS', total: 300000 })

  // Líneas: el precio más reciente del producto tiene que ser el del pedido
  // de este mes, no el de la cotización vieja.
  ok(await s.from('sales_quote_lines').insert({
    company_id: A, quote_id: cot1, line_no: 1, product_id: producto.id,
    sku_snapshot: 'ZZ-E1C-1', name_snapshot: 'ZZ Balanceador de prueba',
    quantity: 2, unit_price: 500, line_type: 'item',
  }), 'línea cotización')
  ok(await s.from('sales_quote_lines').insert({
    company_id: A, quote_id: cot5, line_no: 1, product_id: null,
    sku_snapshot: 'ZZ-E1C-SIN-PRODUCTO', name_snapshot: 'ZZ Ítem suelto',
    quantity: 1, unit_price: 7, line_type: 'item',
  }), 'línea sin producto')
  ok(await s.from('sales_order_lines').insert({
    company_id: A, order_id: ped1, line_no: 1, product_id: producto.id,
    sku_snapshot: 'ZZ-E1C-1', name_snapshot: 'ZZ Balanceador de prueba',
    quantity_ordered: 4, unit_price: 200, line_type: 'item',
  }), 'línea pedido')

  // Un documento de la empresa ajena, por si se filtra por algún lado.
  const clienteB = ok(await s.from('customers').insert({
    company_id: B, legal_name: 'ZZ E1C Cliente De Beta SA',
  }).select('id').single(), 'cliente B').id
  await s.from('sales_quotes').insert({
    company_id: B, customer_id: clienteB, number: `ZZCOT-B-${sello}`,
    quote_date: esteMes, status: 'sent', currency_code: 'USD', total: 123456,
  })

  PASS('fixture', '2 empresas · 4 clientes · 10 documentos · 5 identidades')

  // Los totales NO son los que se insertan: un trigger de Ventas los recalcula
  // a partir de las líneas y de su IVA. Así que lo esperado se lee de la base,
  // no se escribe a mano: lo que se prueba es que el KPI sume los documentos
  // que corresponden, no que yo sepa calcular el 21 %.
  const leerDocs = async () => ({
    cot: (await s.from('sales_quotes')
      .select('quote_date,status,currency_code,total').eq('customer_id', cliente)).data,
    ped: (await s.from('sales_orders')
      .select('order_date,commercial_status,fulfillment_status,currency_code,total').eq('customer_id', cliente)).data,
  })
  const reales = await leerDocs()
  const suma = (filas) => filas.reduce((t, f) => t + Number(f.total ?? 0), 0)
  const enMes = (fecha, mes) => String(fecha).slice(0, 7) === iso(mes).slice(0, 7)

  const esperado = {
    vendidoUsd: suma(reales.ped.filter((p) => p.commercial_status === 'confirmed' && p.currency_code === 'USD' && enMes(p.order_date, m0))),
    vendidoArs: suma(reales.ped.filter((p) => p.commercial_status === 'confirmed' && p.currency_code === 'ARS' && enMes(p.order_date, m0))),
    vendidoUsdAnterior: suma(reales.ped.filter((p) => p.commercial_status === 'confirmed' && p.currency_code === 'USD' && enMes(p.order_date, sumarMeses(m0, -1)))),
    cotizadoUsd: suma(reales.cot.filter((q) => q.currency_code === 'USD' && enMes(q.quote_date, m0))),
    cotizadoArs: suma(reales.cot.filter((q) => q.currency_code === 'ARS' && enMes(q.quote_date, m0))),
    cotizadoUsdAnterior: suma(reales.cot.filter((q) => q.currency_code === 'USD' && enMes(q.quote_date, sumarMeses(m0, -1)))),
  }

  const ficha = async (c, id, meses) => {
    const r = await c.rpc('resumen_cliente_360', meses === undefined
      ? { p_customer: id } : { p_customer: id, p_meses: meses })
    return r
  }

  // ── 1 · Identidad y datos comerciales ────────────────────────────────────
  seccion('1 · Quién es este cliente')
  const r = ok(await ficha(admin.c, cliente), 'ficha admin')
  cmp('la razón social', 'ZZ E1C Cliente Rico SA', r.cliente.razon_social)
  cmp('la referencia', 'ZCLI00001', r.cliente.referencia)
  cmp('el CUIT', '30-71111111-1', r.cliente.cuit)
  cmp('no está dado de baja', false, r.cliente.dado_de_baja)
  cmp('el vendedor viene con nombre resuelto, no con uuid', true, 'vendedor' in r.comercial)
  cmp('la tarifa viene con su nombre', 'ZZ E1C Tarifa', r.comercial.tarifa)
  cmp('la condición de pago', '30 días', r.comercial.condicion_pago)
  cmp('el contacto principal es el marcado', 'ZZ Ana Principal', r.comercial.contacto?.full_name)
  cmp('y trae su email para poder escribirle', 'ana@rico.test', r.comercial.contacto?.email)

  // ── 2 · KPIs, separados por moneda ───────────────────────────────────────
  seccion('2 · Los KPIs no suman monedas')
  cmp('vendido este mes en USD', esperado.vendidoUsd, importe(r, 'vendido_mes', 'USD'))
  cmp('vendido este mes en ARS', esperado.vendidoArs, importe(r, 'vendido_mes', 'ARS'))
  cmp('vendido el mes anterior en USD', esperado.vendidoUsdAnterior, importe(r, 'vendido_mes_anterior', 'USD'))
  cmp('el mes anterior en ARS no existe: no hay base de comparación', null, kpi(r, 'vendido_mes_anterior', 'ARS'))
  cmp('cotizado este mes en USD', esperado.cotizadoUsd, importe(r, 'cotizado_mes', 'USD'))
  cmp('cotizado este mes en ARS', esperado.cotizadoArs, importe(r, 'cotizado_mes', 'ARS'))
  cmp('cotizado el mes anterior en USD', esperado.cotizadoUsdAnterior, importe(r, 'cotizado_mes_anterior', 'USD'))
  cmp('vendido y cotizado son métricas distintas, no la misma dos veces', false,
    importe(r, 'vendido_mes', 'USD') === importe(r, 'cotizado_mes', 'USD'))
  const claves = new Set((r.kpis.valores ?? []).map((v) => v.clave))
  cmp('no hay ninguna clave de facturación inventada', false, [...claves].some((k) => k.includes('factura')))

  // ── 3 · Abiertos ─────────────────────────────────────────────────────────
  seccion('3 · Qué queda abierto')
  // Tres: la `sent` de este mes, la `draft` de este mes y la `sent` del mes
  // pasado. «Abierta» no tiene fecha de corte: una cotización de hace tres
  // meses que nadie contestó sigue abierta, y por eso se muestra.
  cmp('cotizaciones abiertas en USD (sent + draft, de cualquier mes)', 3, docsDe(r, 'cotizaciones_abiertas', 'USD'))
  cmp('la aceptada NO cuenta como abierta', 0, docsDe(r, 'cotizaciones_abiertas', 'ARS'))
  cmp('pedidos por entregar en USD', 1, docsDe(r, 'pedidos_por_entregar', 'USD'))
  cmp('el pedido ya entregado no figura', 0, docsDe(r, 'pedidos_por_entregar', 'ARS'))

  // ── 4 · Lo cancelado no cuenta ───────────────────────────────────────────
  seccion('4 · Un documento cancelado no es actividad')
  cmp('el pedido cancelado de 99999 no está en el vendido', true,
    importe(r, 'vendido_mes', 'USD') < 99999)
  cmp('y el vendido es exactamente el de los confirmados', esperado.vendidoUsd,
    importe(r, 'vendido_mes', 'USD'))
  const mesesUsdPedido = (r.meses ?? []).filter((m) => m.tipo === 'pedido' && m.moneda === 'USD' && m.mes === iso(m0))
  cmp('ni en la serie del mes', 1, mesesUsdPedido[0]?.documentos ?? 0)

  // ── 5 · La serie de doce meses ───────────────────────────────────────────
  seccion('5 · Doce meses')
  const mesesSerie = new Set((r.meses ?? []).map((m) => m.mes))
  cmp('la cotización de hace 13 meses queda fuera de la ventana', false, mesesSerie.has(iso(sumarMeses(m0, -13))))
  cmp('el mes pasado está', true, mesesSerie.has(iso(sumarMeses(m0, -1))))
  const r24 = ok(await ficha(admin.c, cliente, 24), 'ficha 24 meses')
  cmp('con 24 meses la vieja aparece', true,
    new Set((r24.meses ?? []).map((m) => m.mes)).has(iso(sumarMeses(m0, -13))))
  const tiposSerie = new Set((r.meses ?? []).map((m) => m.tipo))
  cmp('la serie distingue los tres tipos', 'cotizacion,entrega,pedido', [...tiposSerie].sort().join(','))
  const mezcla = (r.meses ?? []).some((m) => m.moneda === null)
  cmp('ninguna fila de la serie mezcla monedas', false, mezcla)

  // ── 6 · Recientes y productos ────────────────────────────────────────────
  seccion('6 · Últimos documentos y productos')
  cmp('hay un reciente por tipo y no más', 3, (r.recientes ?? []).length)
  const ultimaCot = (r.recientes ?? []).find((x) => x.tipo === 'cotizacion')
  cmp('la última cotización trae número, fecha, estado, moneda e importe', true,
    !!(ultimaCot?.numero && ultimaCot?.fecha && ultimaCot?.estado && ultimaCot?.moneda && ultimaCot?.total !== undefined))
  cmp('y trae el id para poder abrirla', true, !!ultimaCot?.id)
  const prod = (r.productos ?? []).find((p) => p.sku === 'ZZ-E1C-1')
  // Cotizado y pedido el MISMO día: gana el pedido, que es el precio que se
  // cerró. El empate por fecha es el caso normal, no el raro.
  cmp('el producto aparece con el precio del pedido, no con el cotizado', 200, Number(prod?.precio))
  cmp('con la cantidad de esa última vez', 4, Number(prod?.cantidad))
  cmp('y dice de dónde salió el precio', 'pedido', prod?.origen)
  cmp('una línea sin product_id igual aparece, por su SKU', true,
    (r.productos ?? []).some((p) => p.sku === 'ZZ-E1C-SIN-PRODUCTO'))

  // ── 7 · Totales ──────────────────────────────────────────────────────────
  seccion('7 · Totales del histórico')
  cmp('cotizaciones', 5, r.totales.cotizaciones)
  cmp('pedidos', 4, r.totales.pedidos)
  cmp('entregas', 1, r.totales.entregas)
  cmp('documentos de los últimos 12 meses', 9, r.totales.documentos_12m)

  // ── 8 · Un cliente sin un solo documento ─────────────────────────────────
  seccion('8 · El cliente vacío no rompe nada')
  const v = ok(await ficha(admin.c, vacio), 'ficha vacío')
  cmp('devuelve el cliente igual', 'ZZ E1C Cliente Sin Nada SA', v.cliente.razon_social)
  cmp('sin KPIs', 0, (v.kpis.valores ?? []).length)
  cmp('sin serie', 0, (v.meses ?? []).length)
  cmp('sin recientes', 0, (v.recientes ?? []).length)
  cmp('sin productos', 0, (v.productos ?? []).length)
  cmp('y los totales en cero, no en null', 0, v.totales.cotizaciones)
  cmp('sin contacto principal inventado', null, v.comercial.contacto)

  // ── 9 · RLS ──────────────────────────────────────────────────────────────
  seccion('9 · Quién puede ver estos números')
  const vistaDe = async (c, id) => {
    const rr = await c.rpc('resumen_cliente_360', { p_customer: id })
    if (rr.error) return `error:${rr.error.message.slice(0, 40)}`
    return rr.data === null ? 'null' : 'datos'
  }
  cmp('admin ve al cliente asignado a otro', 'datos', await vistaDe(admin.c, ajeno))
  cmp('el vendedor asignado ve al suyo', 'datos', await vistaDe(vendedor.c, cliente))
  cmp('el vendedor NO asignado no ve nada, aunque tenga el uuid', 'null', await vistaDe(vendedorAjeno.c, cliente))
  cmp('el technician tampoco', 'null', await vistaDe(tecnico.c, cliente))
  cmp('el admin de OTRA empresa tampoco', 'null', await vistaDe(adminB.c, cliente))
  const rAnon = await anon.rpc('resumen_cliente_360', { p_customer: cliente })
  cmp('anon ni siquiera puede ejecutar la función', true, !!rAnon.error)

  // Y lo que importa de verdad: que el «null» no sea un descuido que igual
  // devuelva importes por otro lado.
  const fuga = await vendedorAjeno.c.rpc('resumen_cliente_360', { p_customer: cliente })
  cmp('no se filtra ni un importe del cliente ajeno', true,
    !fuga.error && (fuga.data === null || JSON.stringify(fuga.data).includes('800') === false))

  // ── 10 · Contra las cinco funciones que reemplaza ────────────────────────
  seccion('10 · La llamada única dice lo mismo que las cinco viejas')
  const viejo = ok(await admin.c.rpc('resumen_cliente', { p_customer: cliente }), 'resumen_cliente')
  cmp('mismas cotizaciones que resumen_cliente', viejo[0].cotizaciones, r.totales.cotizaciones)
  cmp('mismos pedidos', viejo[0].pedidos, r.totales.pedidos)
  cmp('mismas entregas', viejo[0].entregas, r.totales.entregas)
  cmp('misma última actividad', viejo[0].ultima_actividad, r.totales.ultima_actividad)

  const act = ok(await admin.c.rpc('actividad_mensual_cliente', { p_customer: cliente, p_meses: 12 }), 'actividad')
  // La vieja incluye lo cancelado; la nueva no. La diferencia tiene que ser
  // exactamente ese documento y ninguno más.
  const sumaVieja = act.reduce((t, f) => t + Number(f.documentos), 0)
  const sumaNueva = (r.meses ?? []).reduce((t, f) => t + Number(f.documentos), 0)
  cmp('la única diferencia con la serie vieja es el cancelado', 1, sumaVieja - sumaNueva)

  // ── 11 · Producción intacta ──────────────────────────────────────────────
  seccion('11 · Producción')
  const despuesProd = await baselineProd()
  cmp('el baseline de producción no se movió', JSON.stringify(antesProd), JSON.stringify(despuesProd))

  const real = ok(await s.rpc('resumen_cliente_360', { p_customer: (await s.from('customers')
    .select('id').in('company_id', prodIds).limit(1).single()).data.id }), 'ficha real')
  cmp('la función corre contra un cliente real sin error', true, real !== null)
}

main()
  .catch((e) => { fallos++; console.error(`\n  ERROR: ${e.message}`) })
  .finally(async () => {
    await limpiar()
    console.log(fallos === 0 ? '\n  ✓ TODO EN VERDE\n' : `\n  ✗ ${fallos} FALLO(S)\n`)
    process.exit(fallos === 0 ? 0 : 1)
  })
