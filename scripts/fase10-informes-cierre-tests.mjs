/**
 * Fase 10 · Informes — cierre: invariantes del módulo, contra la base real.
 *
 * No repite las suites de cada entrega (se corren aparte, en serie). Verifica
 * lo que cierra el módulo:
 *
 *   1  inventario: exactamente las 8 RPC informe_* expuestas, con sus
 *      parámetros; ninguna tabla ni vista nueva con «inform»; la ruta, el menú
 *      y las dos pestañas en el código;
 *   2  permisos: las 8 RPC × admin, employee (leen) y salesperson, technician,
 *      customer, distributor, admin de otra empresa, anon y empresa nula
 *      (rechazados);
 *   3  reglas del legacy que NO se copiaron, con paridad calculada sobre filas
 *      crudas (no números fijos): sin moneda ≠ USD, vendido = entregado (no
 *      pedidos), conversión por quote_id (no «aceptada»), «TODAS» sin
 *      importes, ningún total entre monedas, cumplimiento sin evidencia fuera
 *      del porcentaje, «sin stock» no es el catálogo;
 *   4  sin valuación ni stock crítico: ninguna columna de costo/valor/crítico en
 *      las respuestas; la UI sólo nombra esas cifras para negarlas;
 *   5  stock: Σ movimientos = on_hand, Σ reservas = reserved, resumen = filas;
 *   6  CSV con la biblioteca de la app sobre filas reales: BOM, «;», Moneda,
 *      SIN MONEDA, sin «Total USD», fórmulas neutralizadas, números con signo;
 *   7  sin escrituras: huella de ventas y stock de las empresas reales igual
 *      antes y después de llamar las 8 RPC; histórico migrado congelado.
 *
 * Fixtures sólo para identidades (empresa zz-inf5-*), borradas al final.
 *
 *   set -a; source .env; source .env.migration; source .env.rls.txt; set +a
 *   node --experimental-strip-types scripts/fase10-informes-cierre-tests.mjs
 *
 * NO correrla en paralelo con otra suite de base.
 */
import { createClient } from '@supabase/supabase-js'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET || !process.env.BT_PW_JANO) { console.error('✗ Faltan variables'); process.exit(1) }
const csvLib = await import('../src/modules/informes/lib/csv.ts').catch((e) => { console.error('✗ lib/csv.ts (¿falta --experimental-strip-types?):', e.message); process.exit(1) })

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(72)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const INFO = (t, d = '') => console.log(`    INFO  ${t}${d ? ' — ' + d : ''}`)
const cmp = (t, esp, real) => (JSON.stringify(esp) === JSON.stringify(real) ? PASS(t, String(JSON.stringify(real)).slice(0, 120)) : FAIL(t, `esperaba ${JSON.stringify(esp)}, dio ${JSON.stringify(real)}`))

const s = createClient(BASE, SECRET, { auth: { persistSession: false } })
const MARCA = 'zz-inf5'
const r4 = (v) => Math.round(Number(v) * 10000) / 10000
const hoyAR = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
const [HY, HM] = hoyAR.split('-').map(Number)
const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10)
const serieIni = (() => { const d = new Date(Date.UTC(HY, HM - 12, 1)); return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) })()

const RPCS = {
  informe_actividad_comercial: ['p_company', 'p_mes'],
  informe_pipeline_comercial: ['p_company', 'p_mes'],
  informe_rankings_comerciales: ['p_company', 'p_mes', 'p_dimension', 'p_fuente', 'p_medida', 'p_periodo', 'p_moneda', 'p_limite', 'p_desplazamiento'],
  informe_stock_resumen: ['p_company', 'p_mes'],
  informe_stock_catalogo: ['p_company'],
  informe_stock_actual: ['p_company', 'p_busqueda', 'p_deposito', 'p_estado', 'p_limite', 'p_desplazamiento'],
  informe_movimientos_stock: ['p_company', 'p_mes', 'p_deposito', 'p_tipo', 'p_sentido', 'p_producto', 'p_limite', 'p_desplazamiento'],
  informe_kardex_producto: ['p_company', 'p_producto', 'p_deposito', 'p_orden', 'p_limite', 'p_desplazamiento'],
}
const ARGS = (company, extra = {}) => ({
  informe_actividad_comercial: { p_company: company },
  informe_pipeline_comercial: { p_company: company },
  informe_rankings_comerciales: { p_company: company, p_dimension: 'clientes', p_fuente: 'entregado', p_medida: 'importe', p_periodo: '12m', p_moneda: 'USD' },
  informe_stock_resumen: { p_company: company },
  informe_stock_catalogo: { p_company: company },
  informe_stock_actual: { p_company: company },
  informe_movimientos_stock: { p_company: company },
  informe_kardex_producto: { p_company: company, p_producto: extra.producto ?? '00000000-0000-0000-0000-000000000000' },
})

const login = async (email, password) => {
  const c = createClient(BASE, PUB, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`login: ${error.message}`)
  return c
}
const usuario = async (companyId, rol, customerId = null) => {
  const email = `${MARCA}-${rol}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@buscatools.test`
  const password = `Zz${randomUUID()}!`
  const { data, error } = await s.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`crear ${rol}: ${error.message}`)
  const fila = { company_id: companyId, user_id: data.user.id, role: rol, status: 'active' }
  if (customerId) fila.customer_id = customerId
  const { error: eM } = await s.from('company_memberships').insert(fila)
  if (eM) throw new Error(`membresía ${rol}: ${eM.message}`)
  return login(email, password)
}
async function leerTodo(tabla, columnas, filtro, orden = 'id') {
  const filas = []
  for (let desde = 0; ; desde += 1000) {
    let q = s.from(tabla).select(columnas)
    for (const o of orden.split(',')) q = q.order(o)
    const { data, error } = await filtro(q.range(desde, desde + 999))
    if (error) throw new Error(`${tabla}: ${error.message}`)
    filas.push(...data)
    if (data.length < 1000) return filas
  }
}
async function huella() {
  const { data: reales } = await s.from('companies').select('id, slug').not('slug', 'like', 'zz-%').order('slug')
  const h = {}
  const tablas = [
    ['sales_quotes', 'id, total, status, currency_code, updated_at', 'id'], ['sales_orders', 'id, total, commercial_status, fulfillment_status, updated_at', 'id'],
    ['deliveries', 'id, total, status, updated_at', 'id'], ['sales_order_lines', 'id, quantity_ordered, unit_price', 'id'], ['delivery_lines', 'id, quantity', 'id'],
    ['stock_movements', 'id, quantity, created_at', 'id'], ['stock_balances', 'product_id, warehouse_id, on_hand, reserved, updated_at', 'product_id,warehouse_id'], ['stock_reservations', 'id, quantity', 'id'],
  ]
  for (const c of reales) for (const [t, cols, orden] of tablas) {
    const filas = await leerTodo(t, cols, (q) => q.eq('company_id', c.id), orden)
    h[`${c.slug}.${t}`] = { n: filas.length, sha: createHash('sha256').update(JSON.stringify(filas)).digest('hex').slice(0, 16) }
  }
  return h
}
const barrer = async () => {
  const { data: emp } = await s.from('companies').select('id').like('slug', `${MARCA}-%`)
  const ids = (emp ?? []).map((x) => x.id)
  if (ids.length) {
    await s.from('company_memberships').delete().in('company_id', ids)
    await s.from('customers').delete().in('company_id', ids)
  }
  const { data: us } = await s.auth.admin.listUsers({ perPage: 1000 })
  for (const u of us?.users ?? []) if (u.email?.startsWith(`${MARCA}-`)) { await s.from('company_memberships').delete().eq('user_id', u.id); await s.auth.admin.deleteUser(u.id) }
  if (ids.length) {
    await s.from('warehouses').delete().in('company_id', ids)
    await s.from('companies').delete().in('id', ids)
  }
}
const fuentes = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? fuentes(join(dir, e.name)) : /\.(tsx?|css)$/.test(e.name) && !/\.test\./.test(e.name) ? [join(dir, e.name)] : []))

const main = async () => {
  await barrer()
  INFO('hoy en Argentina', hoyAR)
  const BT = (await s.from('companies').select('id').eq('slug', 'buscatools').single()).data.id
  const huellaAntes = await huella()

  seccion('1 · Inventario')
  {
    const r = await fetch(`${BASE}/rest/v1/`, { headers: { apikey: SECRET, Accept: 'application/openapi+json' } })
    const api = await r.json()
    const rutas = Object.keys(api.paths ?? {})
    const informes = rutas.filter((p) => /inform/i.test(p)).sort()
    cmp('exactamente las 8 RPC informe_* expuestas', Object.keys(RPCS).map((n) => `/rpc/${n}`).sort(), informes)
    const params = Object.fromEntries(Object.keys(RPCS).map((n) => {
      const post = api.paths[`/rpc/${n}`]?.post
      const esquema = post?.parameters?.find((p) => p.in === 'body')?.schema
      const props = esquema?.properties ?? (esquema?.$ref ? api.definitions?.[esquema.$ref.split('/').pop()]?.properties : null) ?? {}
      return [n, Object.keys(props).sort()]
    }))
    cmp('parámetros de cada RPC', Object.fromEntries(Object.entries(RPCS).map(([n, p]) => [n, p.slice().sort()])), params)
    cmp('ninguna tabla ni vista expuesta con «inform»', [], rutas.filter((p) => !p.startsWith('/rpc/') && /inform/i.test(p)))
    const rutasTsx = readFileSync('src/app/routes.tsx', 'utf8')
    const layout = readFileSync('src/layouts/AppLayout.tsx', 'utf8')
    const nav = readFileSync('src/modules/informes/components/NavegacionInformes.tsx', 'utf8')
    cmp('ruta /informes privada, menú con ROLES_INFORMES y pestañas Comercial/Stock', [true, true, true], [/path: 'informes', element: privada\(<InformesPage \/>\)/.test(rutasTsx), /to: '\/informes'[^}]*roles: ROLES_INFORMES/.test(layout), /'comercial', 'stock'/.test(nav)])
    const permisos = readFileSync('src/modules/informes/lib/permisos.ts', 'utf8')
    cmp('ROLES_INFORMES = admin y employee', true, /\['admin', 'employee'\]/.test(permisos))
  }

  seccion('2 · Permisos (8 RPC × identidades)')
  const { data: emp } = await s.from('companies').insert({ slug: `${MARCA}-propia-${Date.now()}`, name: 'ZZ-INF5', default_currency: 'ARS' }).select('id').single()
  const { data: empX } = await s.from('companies').insert({ slug: `${MARCA}-ajena-${Date.now()}`, name: 'ZZ-INF5 ajena', default_currency: 'ARS' }).select('id').single()
  const ZZ = emp.id
  const { data: cli } = await s.from('customers').insert({ company_id: ZZ, legal_name: 'ZZ-INF5 cliente' }).select('id').single()
  const ids = {
    admin: await usuario(ZZ, 'admin'), employee: await usuario(ZZ, 'employee'),
    salesperson: await usuario(ZZ, 'salesperson'), technician: await usuario(ZZ, 'technician'),
    customer: await usuario(ZZ, 'customer', cli.id), distributor: await usuario(ZZ, 'distributor', cli.id),
    'admin ajeno': await usuario(empX.id, 'admin'),
  }
  const anon = createClient(BASE, PUB, { auth: { persistSession: false } })
  for (const n of Object.keys(RPCS)) {
    const args = ARGS(ZZ)[n]
    const leen = []
    for (const rol of ['admin', 'employee']) { const r = await ids[rol].rpc(n, args); if (r.error) leen.push(`${rol}: ${r.error.message}`) }
    const noRechaza = []
    for (const rol of ['salesperson', 'technician', 'customer', 'distributor', 'admin ajeno']) { const r = await ids[rol].rpc(n, args); if (!(r.error && /sin_permiso/.test(r.error.message))) noRechaza.push(`${rol}: ${r.error?.message ?? 'leyó'}`) }
    const ra = await anon.rpc(n, args); if (!ra.error) noRechaza.push('anon leyó')
    const rn = await ids.admin.rpc(n, { ...args, p_company: null }); if (!(rn.error && /sin_permiso/.test(rn.error.message))) noRechaza.push('empresa nula')
    leen.length === 0 && noRechaza.length === 0 ? PASS(`${n}: sólo admin y employee`) : FAIL(`${n}`, [...leen, ...noRechaza].join(' · '))
  }

  const jano = await login('buscatools.jano@gmail.com', process.env.BT_PW_JANO)
  const f = { quotes: await leerTodo('sales_quotes', 'id, quote_date, status, currency_code, total', (q) => q.eq('company_id', BT)),
    orders: await leerTodo('sales_orders', 'id, quote_id, order_date, commercial_status, currency_code, total', (q) => q.eq('company_id', BT)),
    deliveries: await leerTodo('deliveries', 'id, delivery_date, status, currency_code, total', (q) => q.eq('company_id', BT)) }

  seccion('3 · Reglas del legacy que NO se copiaron (paridad calculada)')
  {
    const mon = (m) => m ?? 'SIN MONEDA'
    const act = (await jano.rpc('informe_actividad_comercial', { p_company: BT })).data
    const serie = (tipo, m) => act.filter((x) => x.periodo === 'mes' && x.tipo === tipo && x.moneda === m).reduce((a, x) => ({ n: a.n + Number(x.documentos), imp: r4(a.imp + Number(x.importe)) }), { n: 0, imp: 0 })
    const js = (docs, fecha, incluir, m) => docs.filter((d) => incluir(d) && d[fecha] >= serieIni && d[fecha] <= hoyAR && mon(d.currency_code) === m).reduce((a, d) => ({ n: a.n + 1, imp: r4(a.imp + Number(d.total ?? 0)) }), { n: 0, imp: 0 })
    const entregado = (d) => d.status === 'shipped' || d.status === 'delivered'
    cmp('SIN MONEDA no se suma a USD: remitos 12m USD y SIN MONEDA = filas crudas por separado', [js(f.deliveries, 'delivery_date', entregado, 'USD'), js(f.deliveries, 'delivery_date', entregado, 'SIN MONEDA')], [serie('entregas', 'USD'), serie('entregas', 'SIN MONEDA')])
    cmp('«Vendido» = entregado: la serie de entregas es la de remitos, no la de pedidos', js(f.deliveries, 'delivery_date', entregado, 'ARS'), serie('entregas', 'ARS'))
    cmp('ninguna fila de actividad sin moneda asignada (no hay total entre monedas)', 0, act.filter((x) => x.tipo !== null && (x.moneda === null || x.moneda === 'TODAS')).length)

    const pipe = (await jano.rpc('informe_pipeline_comercial', { p_company: BT })).data
    const conf = new Set(f.orders.filter((o) => o.commercial_status === 'confirmed' && o.quote_id).map((o) => o.quote_id))
    const elegibles = f.quotes.filter((q) => q.status !== 'draft' && q.quote_date >= serieIni && q.quote_date <= hoyAR)
    const todas = pipe.find((x) => x.seccion === 'conversion' && x.periodo === '12m' && x.moneda === 'TODAS')
    cmp('conversión por quote_id (no por «aceptada»): convertidas / elegibles = filas crudas', [elegibles.filter((q) => conf.has(q.id)).length, elegibles.length], [Number(todas.convertidas), Number(todas.documentos)])
    INFO('aceptadas vs convertidas (12m)', `${elegibles.filter((q) => q.status === 'accepted').length} aceptadas · ${elegibles.filter((q) => conf.has(q.id)).length} con pedido`)
    cmp('«TODAS» en conversión es sólo cantidades: importe e importe convertido nulos', 0, pipe.filter((x) => x.moneda === 'TODAS' && (x.importe !== null || x.importe_convertido !== null)).length)
    cmp('secciones con dinero siempre con moneda; cumplimiento e inconsistencias sin moneda', [0, 0], [pipe.filter((x) => ['cotizaciones_abiertas', 'pedidos_pendientes'].includes(x.seccion) && !x.moneda).length, pipe.filter((x) => ['cumplimiento', 'inconsistencias'].includes(x.seccion) && x.moneda !== null).length])
    const cumTodos = pipe.filter((x) => x.seccion === 'cumplimiento' && x.periodo === 'todos')
    cmp('cumplimiento cubre todos los pedidos confirmados (con y sin evidencia)', f.orders.filter((o) => o.commercial_status === 'confirmed').length, cumTodos.reduce((a, x) => a + Number(x.documentos), 0))
    const pct = readFileSync('src/modules/informes/lib/pipeline.ts', 'utf8')
    cmp('el porcentaje de completos usa sólo categorías con evidencia (código)', true, /tasa\(porCategoria\.completo \+ porCategoria\.sobreentregado, determinables\)/.test(pct) && /CATEGORIAS_DETERMINABLES\.reduce/.test(pct))

    const rk = await jano.rpc('informe_rankings_comerciales', { p_company: BT, p_dimension: 'clientes', p_fuente: 'entregado', p_medida: 'importe', p_periodo: '12m', p_moneda: null })
    cmp('ranking por importe sin moneda: rechazado (nunca «todas las monedas»)', true, !!rk.error && /parametro_invalido/.test(rk.error.message))
    const rkC = (await jano.rpc('informe_rankings_comerciales', { p_company: BT, p_dimension: 'productos', p_fuente: 'entregado', p_medida: 'cantidad', p_periodo: '12m', p_limite: 500 })).data
    cmp('ranking por cantidad sin moneda ni importe', 0, rkC.filter((x) => x.moneda !== null || x.importe !== null).length)

    const cat = Object.fromEntries((await jano.rpc('informe_stock_catalogo', { p_company: BT })).data.map((x) => [x.categoria, Number(x.cantidad)]))
    const res = (await jano.rpc('informe_stock_resumen', { p_company: BT })).data
    const enCero = Number(res.find((x) => x.seccion === 'estado' && x.warehouse_id === null && x.categoria === 'en_cero')?.cantidad)
    const bal = await leerTodo('stock_balances', 'product_id, warehouse_id, on_hand', (q) => q.eq('company_id', BT), 'product_id,warehouse_id')
    cmp('«en cero» cuenta saldos existentes en 0, no el catálogo (el legacy contaba 21.394 «sin stock»)', bal.filter((b) => Number(b.on_hand) === 0).length, enCero)
    INFO('catálogo sin movimientos (se muestra aparte, como «Sin movimientos registrados»)', JSON.stringify(cat))
  }

  seccion('4 · Sin valuación, costo ni stock crítico')
  {
    const prohibido = /(cost|costo|valor|valuat|valoriz|margin|margen|critic|crític|reorder|minimo|mínimo)/i
    const claves = new Set()
    for (const [n, args] of Object.entries(ARGS(BT))) {
      const r = await jano.rpc(n, { ...args, ...(n === 'informe_kardex_producto' ? { p_producto: (await s.from('stock_balances').select('product_id').eq('company_id', BT).limit(1).single()).data?.product_id } : {}) })
      if (r.error) { FAIL(`${n} con admin real`, r.error.message); continue }
      for (const fila of r.data.slice(0, 1)) for (const k of Object.keys(fila)) claves.add(`${n}.${k}`)
    }
    cmp('ninguna columna de costo, valor, margen, crítico o mínimo en las 8 respuestas', [], [...claves].filter((k) => prohibido.test(k.split('.')[1])))
    // Cada mención con la línea anterior: una negación puede quedar partida en un comentario.
    const lineas = fuentes('src/modules/informes').flatMap((p) => readFileSync(p, 'utf8').split('\n').map((l, i, todas) => [p, i + 1, l, `${todas[i - 1] ?? ''} ${l}`]))
    const menciones = lineas.filter(([, , l]) => /stock cr[ií]tico|valorizaci[oó]n|punto de pedido|\bcosto\b|\bmargen\b/i.test(l))
    const afirmativas = menciones.filter(([, , , ctx]) => !/(\bsin\b|\bni\b|\bno\b|nada de|ningún|ninguna|no hay)/i.test(ctx))
    cmp('la UI sólo nombra valorización, costo, margen o stock crítico para negarlos', [], afirmativas.map(([p, i, l]) => `${p}:${i}: ${l.trim().slice(0, 80)}`))
    INFO('menciones negadas encontradas', String(menciones.length))
  }

  seccion('5 · Stock: paridad')
  {
    const bal = await leerTodo('stock_balances', 'product_id, warehouse_id, on_hand, reserved', (q) => q.eq('company_id', BT), 'product_id,warehouse_id')
    const mov = await leerTodo('stock_movements', 'id, product_id, warehouse_id, quantity', (q) => q.eq('company_id', BT))
    const resv = await leerTodo('stock_reservations', 'id, product_id, warehouse_id, quantity', (q) => q.eq('company_id', BT))
    const suma = (rows) => rows.reduce((m, x) => m.set(`${x.product_id}|${x.warehouse_id}`, (m.get(`${x.product_id}|${x.warehouse_id}`) ?? 0) + Number(x.quantity)), new Map())
    const sm = suma(mov), sr = suma(resv)
    const claves = new Set(bal.map((b) => `${b.product_id}|${b.warehouse_id}`))
    cmp('Σ movimientos = on_hand y Σ reservas = reserved en todos los saldos; 0 movimientos sin saldo', { desfasados: 0, reservado: 0, huerfanos: 0 }, { desfasados: bal.filter((b) => (sm.get(`${b.product_id}|${b.warehouse_id}`) ?? 0) !== Number(b.on_hand)).length, reservado: bal.filter((b) => (sr.get(`${b.product_id}|${b.warehouse_id}`) ?? 0) !== Number(b.reserved)).length, huerfanos: [...sm.keys()].filter((k) => !claves.has(k)).length })
    const res = (await jano.rpc('informe_stock_resumen', { p_company: BT })).data
    const v = (c) => Number(res.find((x) => x.seccion === 'estado' && x.warehouse_id === null && x.categoria === c)?.cantidad)
    cmp('resumen de stock = filas crudas (saldos, negativos, disponible negativo, reservas)', [bal.length, bal.filter((b) => Number(b.on_hand) < 0).length, bal.filter((b) => Number(b.on_hand) - Number(b.reserved) < 0).length, bal.filter((b) => Number(b.reserved) > 0).length], [v('balances'), v('negativo'), v('disponible_negativo'), v('con_reservas')])
    const prueba = mov.filter((m) => [51, 52, 53].includes(Number(m.id)))
    cmp('los 3 movimientos de prueba preexistentes (51, 52, 53) siguen en la base y en el informe', [3, [100, -30, -5]], [prueba.length, prueba.sort((a, b) => a.id - b.id).map((m) => Number(m.quantity))])
    INFO('stock real', JSON.stringify({ saldos: bal.length, movimientos: mov.length, reservas: resv.length }))
  }

  seccion('6 · CSV con la biblioteca de la app, sobre filas reales')
  {
    const act = (await jano.rpc('informe_actividad_comercial', { p_company: BT })).data
    const pipe = (await jano.rpc('informe_pipeline_comercial', { p_company: BT })).data
    const rk = (await jano.rpc('informe_rankings_comerciales', { p_company: BT, p_dimension: 'productos', p_fuente: 'pedido', p_medida: 'importe', p_periodo: '12m', p_moneda: 'USD', p_limite: 500 })).data
    const csvA = csvLib.actividadACsv(act), csvP = csvLib.pipelineACsv(pipe), csvR = csvLib.rankingACsv({ dimension: 'productos', fuente: 'pedido', medida: 'importe', periodo: '12m', moneda: 'USD' }, rk)
    const todos = [csvA, csvP, csvR]
    cmp('cabeceras con columna Moneda y sin «Total USD»', [true, true, true, false], [...todos.map((c) => c.split('\r\n')[0].split(';').includes('Moneda')), todos.some((c) => /Total USD/i.test(c))])
    cmp('SIN MONEDA escrito, nunca vacío, en las filas con dinero', true, csvA.split('\r\n').slice(1).every((l) => l.split(';')[5] !== '') && (act.some((x) => x.moneda === null && x.tipo) ? csvA.includes(';SIN MONEDA;') : true))
    cmp('filas: actividad y pipeline = filas del RPC sin las de rango; ranking = completo', [act.filter((x) => x.tipo !== null).length, pipe.filter((x) => !x.seccion.startsWith('rango_')).length, rk.length], todos.map((c) => c.split('\r\n').length - 1))
    cmp('texto con fórmula neutralizado; negativo como número', ["'=cmd", '-5'], [csvLib.texto('=cmd'), csvLib.numero(-5)])
    cmp('BOM UTF-8 y acentos', [[0xef, 0xbb, 0xbf], true], [[...new TextEncoder().encode(csvLib.contenidoConBom('Depósito')).slice(0, 3)], csvLib.contenidoConBom('Depósito').endsWith('Depósito')])
    cmp('ningún campo de texto con =, +, @ o - no numérico al inicio, sin proteger', 0, todos.flatMap((c) => c.split('\r\n').slice(1)).flatMap((l) => l.split(';')).filter((x) => /^[=+@]/.test(x) || /^-[^0-9]/.test(x)).length)
  }

  seccion('7 · Sin escrituras e histórico congelado')
  {
    const escrituras = fuentes('src/modules/informes').flatMap((p) => readFileSync(p, 'utf8').split('\n').map((l, i) => [p, i + 1, l]))
      .filter(([, , l]) => /\.(insert|update|upsert|delete)\(|\.rpc\(\s*'(?!informe_)/.test(l) && !/URLSearchParams|params\.delete|\.delete\('(mes|vista)'\)/.test(l))
    cmp('el código de Informes no escribe: sin insert/update/upsert/delete ni RPC que no sea informe_*', [], escrituras.map(([p, i, l]) => `${p}:${i}: ${l.trim().slice(0, 80)}`))
    for (const [n, args] of Object.entries(ARGS(BT))) await jano.rpc(n, args)
    await barrer()
    cmp('sin empresas ni usuarios zz-inf5', [0, 0], [(await s.from('companies').select('id', { count: 'exact', head: true }).like('slug', `${MARCA}-%`)).count, ((await s.auth.admin.listUsers({ perPage: 1000 })).data?.users ?? []).filter((u) => u.email?.startsWith(`${MARCA}-`)).length])
    const huellaDespues = await huella()
    cmp('ventas y stock de las empresas reales: misma huella antes y después de llamar las 8 RPC', huellaAntes, huellaDespues)
    const imp = {}
    for (const t of ['sales_quotes', 'sales_orders', 'deliveries']) imp[t] = (await s.from(t).select('id', { count: 'exact', head: true }).not('imported_at', 'is', null)).count
    cmp('histórico migrado congelado: 288 / 166 / 182 documentos con imported_at', { sales_quotes: 288, sales_orders: 166, deliveries: 182 }, imp)
    INFO('filas vivas (pueden crecer)', JSON.stringify(Object.fromEntries(Object.entries(huellaDespues).map(([k, v]) => [k, v.n]))))
  }

  console.log('\n' + '='.repeat(78))
  console.log(`  RESULTADO: ${fallos} fallo(s)`)
  console.log('='.repeat(78))
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('\n✗ La suite se cayó:', e.message)
  try { await barrer() } catch { /* próxima corrida */ }
  process.exit(1)
})
