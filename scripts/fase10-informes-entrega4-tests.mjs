/**
 * Fase 10 · Informes — entrega 4: stock físico, movimientos y kardex, contra la base real.
 *
 * Prueba, con JWT reales:
 *
 *   · las cinco funciones sólo para admin y employee (salesperson, technician,
 *     customer, distributor, admin ajeno, anon y empresa nula no reciben nada);
 *   · validación de parámetros;
 *   · stock actual: positivo, cero, negativo, reservado sin movimientos
 *     (saldo con on_hand 0 ≠ «sin saldo»), disponible negativo, por depósito,
 *     búsqueda literal (% y _ no son comodines), filtros y paginación estable;
 *   · resumen: conteos por depósito y total, productos sin movimientos, último
 *     movimiento, movimientos del mes (entradas/salidas por SIGNO), por tipo y
 *     por origen, sin documento origen;
 *   · límites del mes en hora de Argentina (23:30 del último día del mes
 *     anterior NO cuenta; 00:30 del día 1 SÍ);
 *   · kardex: saldo corrido por depósito en orden (created_at, id), igual al
 *     saldo actual; si el saldo guardado no coincide, el saldo no se muestra;
 *   · paridad Buscatools: Σ movimientos = on_hand y Σ reservas = reserved en
 *     TODOS los pares; cada fila del resumen, del stock actual y de los
 *     movimientos contra un cálculo en JS sobre las filas crudas;
 *   · multiempresa: nada de la empresa ajena;
 *   · base intacta: stock_movements, stock_balances y stock_reservations de las
 *     empresas reales con la misma huella antes y después; sin zz-inf4.
 *
 * Fixtures en empresas zz-inf4-*; se borran al final.
 *
 *   set -a; source .env; source .env.migration; source .env.rls.txt; set +a
 *   node scripts/fase10-informes-entrega4-tests.mjs
 *
 * NO correrla en paralelo con otra suite de base.
 */
import { createClient } from '@supabase/supabase-js'
import { createHash, randomUUID } from 'node:crypto'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET || !process.env.BT_PW_JANO) { console.error('✗ Faltan variables'); process.exit(1) }

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(72)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const INFO = (t, d = '') => console.log(`    INFO  ${t}${d ? ' — ' + d : ''}`)
const cmp = (t, esp, real) => (JSON.stringify(esp) === JSON.stringify(real) ? PASS(t, String(JSON.stringify(real)).slice(0, 120)) : FAIL(t, `esperaba ${JSON.stringify(esp)}, dio ${JSON.stringify(real)}`))

const s = createClient(BASE, SECRET, { auth: { persistSession: false } })
const MARCA = 'zz-inf4'
const cmpC = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

const hoyAR = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
const [HY, HM, HD] = hoyAR.split('-').map(Number)
const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10)
const ultimoDia = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const M1 = (() => { const d = new Date(Date.UTC(HY, HM - 2, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 } })()
const diaAR = (tsIso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(tsIso))
const dias = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000)

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
    q = filtro(q.range(desde, desde + 999))
    const { data, error } = await q
    if (error) throw new Error(`${tabla}: ${error.message}`)
    filas.push(...data)
    if (data.length < 1000) return filas
  }
}
async function paginas(llamar) {
  const todas = []
  for (let off = 0; off < 20000; off += 500) {
    const { data, error } = await llamar(500, off)
    if (error) throw new Error(error.message)
    todas.push(...data)
    if (data.length < 500) break
  }
  return todas
}

// ── la regla, en JS, sobre filas crudas ─────────────────────────────────────
async function leerEmpresa(company) {
  const f = (q) => q.eq('company_id', company)
  const d = {
    warehouses: await leerTodo('warehouses', 'id, code, name, is_active', f),
    balances: await leerTodo('stock_balances', 'product_id, warehouse_id, on_hand, reserved', f, 'product_id,warehouse_id'),
    movements: await leerTodo('stock_movements', 'id, product_id, warehouse_id, movement_type, quantity, source_type, source_id, created_at', f),
    reservations: await leerTodo('stock_reservations', 'id, product_id, warehouse_id, quantity', f),
  }
  const pids = [...new Set([...d.balances.map((b) => b.product_id), ...d.movements.map((m) => m.product_id)])]
  d.products = new Map()
  for (let i = 0; i < pids.length; i += 200) {
    const { data } = await s.from('products').select('id, sku, name, status, deleted_at').in('id', pids.slice(i, i + 200))
    for (const p of data) d.products.set(p.id, p)
  }
  return d
}

function stockEsperado(d, { busqueda = null, deposito = null, estado = null } = {}) {
  const dep = new Map(d.warehouses.map((w) => [w.id, w]))
  const q = busqueda?.trim().toLowerCase() || null
  const filas = d.balances.map((b) => {
    const p = d.products.get(b.product_id)
    const w = dep.get(b.warehouse_id)
    const oh = Number(b.on_hand), rs = Number(b.reserved)
    return { producto_id: b.product_id, sku: p.sku, producto: p.name, producto_activo: p.deleted_at === null && p.status === 'active', warehouse_id: b.warehouse_id, deposito_codigo: w.code, deposito: w.name, on_hand: oh, reserved: rs, available: oh - rs, estado: oh < 0 ? 'negativo' : oh === 0 ? 'cero' : 'con_stock', disponible_negativo: oh - rs < 0 }
  }).filter((f) => (!deposito || f.warehouse_id === deposito)
    && (!q || f.sku.toLowerCase().includes(q) || f.producto.toLowerCase().includes(q))
    && (!estado || (estado === 'con_stock' && f.on_hand > 0) || (estado === 'cero' && f.on_hand === 0) || (estado === 'negativo' && f.on_hand < 0)
        || (estado === 'disponible_negativo' && f.available < 0) || (estado === 'reservado' && f.reserved > 0)))
  filas.sort((a, b) => cmpC(a.sku, b.sku) || cmpC(a.deposito_codigo, b.deposito_codigo) || cmpC(a.producto_id, b.producto_id) || cmpC(a.warehouse_id, b.warehouse_id))
  return filas
}
const normStock = (r) => ({ producto_id: r.producto_id, sku: r.sku, producto: r.producto, producto_activo: r.producto_activo, warehouse_id: r.warehouse_id, deposito_codigo: r.deposito_codigo, deposito: r.deposito, on_hand: Number(r.on_hand), reserved: Number(r.reserved), available: Number(r.available), estado: r.estado, disponible_negativo: r.disponible_negativo })

function tramoMes(mesRef) {
  const esActual = mesRef.y === HY && mesRef.m === HM
  return [iso(mesRef.y, mesRef.m, 1), esActual ? hoyAR : iso(mesRef.y, mesRef.m, ultimoDia(mesRef.y, mesRef.m))]
}

function resumenEsperado(d, mesRef) {
  const [desde, hasta] = tramoMes(mesRef)
  const out = {}
  const put = (k, v) => { out[k] = v }
  put('rango||', 0)
  const cats = ['balances', 'con_stock', 'en_cero', 'negativo', 'disponible_negativo', 'con_reservas']
  const contar = (bs) => {
    const c = Object.fromEntries(cats.map((x) => [x, 0]))
    for (const b of bs) {
      const oh = Number(b.on_hand), rs = Number(b.reserved)
      c.balances++
      c[oh > 0 ? 'con_stock' : oh === 0 ? 'en_cero' : 'negativo']++
      if (oh - rs < 0) c.disponible_negativo++
      if (rs > 0) c.con_reservas++
    }
    return c
  }
  for (const w of d.warehouses) {
    const bs = d.balances.filter((b) => b.warehouse_id === w.id)
    put(`deposito|${w.id}|`, bs.length)
    for (const [k, v] of Object.entries(contar(bs))) put(`estado|${w.id}|${k}`, v)
  }
  for (const [k, v] of Object.entries(contar(d.balances))) put(`estado||${k}`, v)
  const movPorProd = new Map()
  for (const m of d.movements) { const dia = diaAR(m.created_at); const u = movPorProd.get(m.product_id); if (!u || dia > u) movPorProd.set(m.product_id, dia) }
  const balPorProd = new Map()
  for (const b of d.balances) (balPorProd.get(b.product_id) ?? balPorProd.set(b.product_id, []).get(b.product_id)).push(b)
  put('productos||con_balance', balPorProd.size)
  put('productos||con_movimientos', movPorProd.size)
  put('productos||movido_hoy_en_cero', [...balPorProd].filter(([pid, bs]) => movPorProd.has(pid) && bs.every((b) => Number(b.on_hand) === 0)).length)
  const tramo = (u) => { const x = dias(hoyAR, u); return x <= 30 ? '0_30' : x <= 90 ? '31_90' : x <= 180 ? '91_180' : x <= 365 ? '181_365' : 'mas_365' }
  for (const t of ['0_30', '31_90', '91_180', '181_365', 'mas_365']) put(`ultimo_movimiento||${t}`, [...movPorProd.values()].filter((u) => tramo(u) === t).length)
  const mes = d.movements.filter((m) => { const dia = diaAR(m.created_at); return dia >= desde && dia <= hasta })
  put('mes||movimientos', mes.length)
  put('mes||entradas', mes.filter((m) => Number(m.quantity) > 0).length)
  put('mes||salidas', mes.filter((m) => Number(m.quantity) < 0).length)
  put('mes||productos', new Set(mes.map((m) => m.product_id)).size)
  put('mes||depositos', new Set(mes.map((m) => m.warehouse_id)).size)
  put('mes||sin_documento', mes.filter((m) => m.source_id === null).length)
  for (const m of mes) { out[`mes_tipo||${m.movement_type}`] = (out[`mes_tipo||${m.movement_type}`] ?? 0) + 1; const o = m.source_type ?? 'sin_origen'; out[`mes_origen||${o}`] = (out[`mes_origen||${o}`] ?? 0) + 1 }
  return { filas: out, desde, hasta }
}
const mapaResumen = (rows) => Object.fromEntries(rows.map((r) => [`${r.seccion}|${r.warehouse_id ?? ''}|${r.categoria ?? ''}`, Number(r.cantidad)]))
function compararMapas(t, esp, real) {
  const claves = [...new Set([...Object.keys(esp), ...Object.keys(real)])].sort()
  const malas = claves.filter((k) => esp[k] !== real[k])
  malas.length === 0 ? PASS(t, `${claves.length} cifras`) : FAIL(t, JSON.stringify(malas.slice(0, 6).map((k) => [k, esp[k], real[k]])))
}

function movimientosEsperados(d, mesRef, { deposito = null, tipo = null, sentido = null, producto = null } = {}) {
  const [desde, hasta] = tramoMes(mesRef)
  return d.movements.filter((m) => {
    const dia = diaAR(m.created_at)
    return dia >= desde && dia <= hasta && (!deposito || m.warehouse_id === deposito) && (!tipo || m.movement_type === tipo)
      && (!sentido || (sentido === 'entrada' ? Number(m.quantity) > 0 : Number(m.quantity) < 0)) && (!producto || m.product_id === producto)
  }).sort((a, b) => (Date.parse(b.created_at) - Date.parse(a.created_at)) || (Number(b.id) - Number(a.id)))
    .map((m) => ({ movimiento_id: Number(m.id), dia: diaAR(m.created_at), producto_id: m.product_id, warehouse_id: m.warehouse_id, movement_type: m.movement_type, sentido: Number(m.quantity) > 0 ? 'entrada' : 'salida', quantity: Number(m.quantity), source_type: m.source_type, source_id: m.source_id }))
}
const normMov = (r) => ({ movimiento_id: Number(r.movimiento_id), dia: r.dia, producto_id: r.producto_id, warehouse_id: r.warehouse_id, movement_type: r.movement_type, sentido: r.sentido, quantity: Number(r.quantity), source_type: r.source_type, source_id: r.source_id })

function kardexEsperado(d, producto, orden = 'desc', deposito = null) {
  const movs = d.movements.filter((m) => m.product_id === producto && (!deposito || m.warehouse_id === deposito))
    .sort((a, b) => (Date.parse(a.created_at) - Date.parse(b.created_at)) || (Number(a.id) - Number(b.id)))
  const acum = new Map(), total = new Map(), primero = new Map()
  for (const m of movs) total.set(m.warehouse_id, (total.get(m.warehouse_id) ?? 0) + Number(m.quantity))
  const filas = movs.map((m) => {
    const a = (acum.get(m.warehouse_id) ?? 0) + Number(m.quantity)
    acum.set(m.warehouse_id, a)
    if (!primero.has(m.warehouse_id)) primero.set(m.warehouse_id, m.movement_type)
    const bal = d.balances.find((b) => b.product_id === producto && b.warehouse_id === m.warehouse_id)
    const ok = !!bal && Number(bal.on_hand) === total.get(m.warehouse_id)
    return { movimiento_id: Number(m.id), warehouse_id: m.warehouse_id, quantity: Number(m.quantity), saldo: ok ? Math.round(a * 1000) / 1000 : null, saldo_verificado: ok, inicia_con_apertura: primero.get(m.warehouse_id) === 'opening_balance', saldo_actual: bal ? Number(bal.on_hand) : null }
  })
  return orden === 'desc' ? filas.reverse() : filas
}
const normKx = (r) => ({ movimiento_id: Number(r.movimiento_id), warehouse_id: r.warehouse_id, quantity: Number(r.quantity), saldo: r.saldo === null ? null : Math.round(Number(r.saldo) * 1000) / 1000, saldo_verificado: r.saldo_verificado, inicia_con_apertura: r.inicia_con_apertura, saldo_actual: r.saldo_actual === null ? null : Number(r.saldo_actual) })

const barrer = async () => {
  const { data: emp } = await s.from('companies').select('id').like('slug', `${MARCA}-%`)
  const ids = (emp ?? []).map((x) => x.id)
  if (ids.length) {
    await s.from('stock_reservations').delete().in('company_id', ids)
    await s.from('stock_movements').delete().in('company_id', ids)
    await s.from('stock_balances').delete().in('company_id', ids)
    await s.from('company_memberships').delete().in('company_id', ids)
    await s.from('customers').delete().in('company_id', ids)
    await s.from('products').delete().in('company_id', ids)
    await s.from('product_categories').delete().in('company_id', ids)
  }
  const { data: us } = await s.auth.admin.listUsers({ perPage: 1000 })
  for (const u of us?.users ?? []) if (u.email?.startsWith(`${MARCA}-`)) { await s.from('company_memberships').delete().eq('user_id', u.id); await s.auth.admin.deleteUser(u.id) }
  if (ids.length) {
    await s.from('warehouses').delete().in('company_id', ids)
    await s.from('companies').delete().in('id', ids)
  }
}

/** Huella del stock de las empresas reales (todas menos las zz-). */
async function huellaStock() {
  const { data: reales } = await s.from('companies').select('id, slug').not('slug', 'like', 'zz-%').order('slug')
  const h = {}
  for (const c of reales) {
    for (const [t, cols, orden] of [['stock_movements', 'id, product_id, warehouse_id, movement_type, quantity, source_type, source_id, created_at', 'id'], ['stock_balances', 'product_id, warehouse_id, on_hand, reserved, updated_at', 'product_id,warehouse_id'], ['stock_reservations', 'id, product_id, warehouse_id, quantity', 'id']]) {
      const filas = await leerTodo(t, cols, (q) => q.eq('company_id', c.id), orden)
      h[`${c.slug}.${t}`] = { n: filas.length, sha: createHash('sha256').update(JSON.stringify(filas)).digest('hex').slice(0, 16) }
    }
  }
  return h
}

const main = async () => {
  await barrer()
  INFO('hoy en Argentina', hoyAR)
  const BT = (await s.from('companies').select('id').eq('slug', 'buscatools').single()).data.id
  const huellaAntes = await huellaStock()

  seccion('1 · Fixtures')
  const ins = async (tabla, fila) => {
    const r = await s.from(tabla).insert(fila).select('*').single()
    if (r.error) throw new Error(`${tabla}: ${r.error.message}`)
    return r.data
  }
  const ZZ = (await ins('companies', { slug: `${MARCA}-propia-${Date.now()}`, name: 'ZZ-INF4 propia', default_currency: 'ARS' })).id
  const ZZ2 = (await ins('companies', { slug: `${MARCA}-ajena-${Date.now()}`, name: 'ZZ-INF4 ajena', default_currency: 'ARS' })).id
  const existentes = (await s.from('warehouses').select('id').eq('company_id', ZZ)).data ?? []
  const W1 = existentes[0]?.id ?? (await ins('warehouses', { company_id: ZZ, code: 'ZZA', name: 'Depósito A', is_default: true })).id
  const W2 = (await ins('warehouses', { company_id: ZZ, code: 'ZZB', name: 'Depósito B' })).id
  const WX = (await s.from('warehouses').select('id').eq('company_id', ZZ2).limit(1).maybeSingle()).data?.id ?? (await ins('warehouses', { company_id: ZZ2, code: 'ZZX', name: 'Ajeno' })).id
  const cat = (await ins('product_categories', { company_id: ZZ, name: 'ZZ-INF4', slug: `zz-inf4-${Date.now()}` })).id
  const catX = (await ins('product_categories', { company_id: ZZ2, name: 'ZZ-INF4 X', slug: `zz-inf4-x-${Date.now()}` })).id
  const prod = async (sku, name, extra = {}, company = ZZ, c = cat) => (await ins('products', { company_id: company, category_id: c, sku, name, ...extra })).id
  const PP = await prod('ZZ4-POS', 'Positivo en dos depósitos')
  const PC = await prod('ZZ4-CERO', 'Movido y hoy en cero')
  const PN = await prod('ZZ4-NEG', 'Stock negativo')
  const PR = await prod('ZZ4-RES', 'Reservado de más')
  const PS = await prod('ZZ4-SOLO-RESERVA', 'Reserva sin movimientos')
  const PD = await prod('ZZ4-DISC', 'Discontinuado con historia', { status: 'discontinued' })
  const PQ = await prod('ZZ4-100%_X', 'Con comodines en el SKU')
  const PK = await prod('ZZ4-KDX', 'Saldo desalineado')
  const PV = await prod('ZZ4-VIRGEN', 'Nunca se movió')
  const PA = await prod('ZZ4-AJENO', 'Producto ajeno', {}, ZZ2, catX)

  // Movimientos con fechas explícitas. Hora argentina = UTC − 3.
  const ahora = Date.now()
  const ts = (msAtras) => new Date(ahora - msAtras).toISOString()
  const primeroMesUTC = new Date(Date.UTC(HY, HM - 1, 1, 3, 30)).toISOString()                                  // 00:30 del día 1 en AR
  const ultimoMesAntUTC = new Date(Date.UTC(M1.y, M1.m - 1, ultimoDia(M1.y, M1.m), 2, 30) + 86400000).toISOString() // 23:30 del último día del mes anterior en AR
  const mov = (pid, wid, tipo, q, created_at, company = ZZ, extra = {}) => ins('stock_movements', { company_id: company, product_id: pid, warehouse_id: wid, movement_type: tipo, quantity: q, created_at, ...extra })
  await mov(PP, W1, 'opening_balance', 10, ultimoMesAntUTC)
  await mov(PP, W2, 'opening_balance', 4, primeroMesUTC)
  await mov(PP, W1, 'sale_delivery', -3, ts(60_000))
  await mov(PC, W1, 'purchase_receipt', 10, ts(50_000))
  await mov(PC, W1, 'adjustment', -10, ts(40_000))
  await mov(PN, W1, 'service_consumption', -3, ts(30_000))
  await mov(PR, W1, 'return_in', 5, ts(20_000))
  await mov(PD, W2, 'transfer_in', 2, ts(15_000))
  await mov(PQ, W1, 'opening_balance', 1, ts(12_000))
  await mov(PK, W1, 'opening_balance', 7, ts(10_000))
  // Mismo instante: el orden lo decide el id.
  const mismo = ts(5_000)
  await mov(PK, W1, 'transfer_out', -2, mismo)
  await mov(PK, W1, 'return_out', -1, mismo)
  await mov(PA, WX, 'opening_balance', 99, ts(1_000), ZZ2)
  await ins('stock_reservations', { company_id: ZZ, product_id: PR, warehouse_id: W1, quantity: 8, source_type: 'sales_order' })
  await ins('stock_reservations', { company_id: ZZ, product_id: PS, warehouse_id: W2, quantity: 2, source_type: 'sales_order' })
  // Desalineo a propósito un saldo (sólo del fixture) para el kardex no verificable.
  { const { error } = await s.from('stock_balances').update({ on_hand: 5 }).eq('product_id', PK).eq('warehouse_id', W1); if (error) throw new Error(`desalinear: ${error.message}`) }

  const admin = await usuario(ZZ, 'admin')
  const empleado = await usuario(ZZ, 'employee')
  const vendedor = await usuario(ZZ, 'salesperson')
  const tecnico = await usuario(ZZ, 'technician')
  const cli = await ins('customers', { company_id: ZZ, legal_name: 'ZZ-INF4 cliente' })
  const clienteU = await usuario(ZZ, 'customer', cli.id)
  const distrib = await usuario(ZZ, 'distributor', cli.id)
  const adminAjeno = await usuario(ZZ2, 'admin')
  const anon = createClient(BASE, PUB, { auth: { persistSession: false } })
  PASS('fixtures', '2 empresas · 3 depósitos · 10 productos · 13 movimientos · 2 reservas · 8 identidades')

  const F = {
    resumen: (c, co = ZZ, extra = {}) => c.rpc('informe_stock_resumen', { p_company: co, ...extra }),
    catalogo: (c, co = ZZ) => c.rpc('informe_stock_catalogo', { p_company: co }),
    stock: (c, co = ZZ, extra = {}) => c.rpc('informe_stock_actual', { p_company: co, ...extra }),
    movs: (c, co = ZZ, extra = {}) => c.rpc('informe_movimientos_stock', { p_company: co, ...extra }),
    kardex: (c, co = ZZ, extra = { p_producto: PP }) => c.rpc('informe_kardex_producto', { p_company: co, ...extra }),
  }

  seccion('2 · Quién puede (las cinco funciones)')
  for (const [nombre, fn] of Object.entries(F)) {
    const okA = await fn(admin), okE = await fn(empleado)
    okA.error || okE.error ? FAIL(`${nombre}: admin y employee leen`, okA.error?.message ?? okE.error?.message) : PASS(`${nombre}: admin y employee leen`)
    const rechazos = []
    for (const [rol, c] of [['salesperson', vendedor], ['technician', tecnico], ['customer', clienteU], ['distributor', distrib], ['admin ajeno', adminAjeno]]) {
      const r = await fn(c)
      if (!(r.error && /sin_permiso/.test(r.error.message))) rechazos.push(`${rol}: ${r.error?.message ?? 'leyó'}`)
    }
    const a = await fn(anon)
    if (!a.error) rechazos.push('anon leyó')
    const nula = await fn(admin, null)
    if (!(nula.error && /sin_permiso/.test(nula.error.message))) rechazos.push('empresa nula aceptada')
    rechazos.length === 0 ? PASS(`${nombre}: salesperson, technician, customer, distributor, admin ajeno, anon y empresa nula rechazados`) : FAIL(`${nombre}: rechazos`, rechazos.join(' · '))
  }
  {
    const r = await F.stock(adminAjeno, ZZ2)
    cmp('multiempresa: el admin ajeno ve sólo su stock', [['ZZ4-AJENO', 99]], (r.data ?? []).map((x) => [x.sku, Number(x.on_hand)]))
  }

  seccion('3 · Parámetros')
  for (const [t, fn, err] of [
    ['estado desconocido', () => F.stock(admin, ZZ, { p_estado: 'critico' }), 'parametro_invalido'],
    ['límite 0', () => F.stock(admin, ZZ, { p_limite: 0 }), 'parametro_invalido'],
    ['límite 501', () => F.movs(admin, ZZ, { p_limite: 501 }), 'parametro_invalido'],
    ['desplazamiento negativo', () => F.kardex(admin, ZZ, { p_producto: PP, p_desplazamiento: -1 }), 'parametro_invalido'],
    ['búsqueda de más de 100', () => F.stock(admin, ZZ, { p_busqueda: 'x'.repeat(101) }), 'parametro_invalido'],
    ['tipo de movimiento desconocido', () => F.movs(admin, ZZ, { p_tipo: 'robo' }), 'parametro_invalido'],
    ['sentido desconocido', () => F.movs(admin, ZZ, { p_sentido: 'neutro' }), 'parametro_invalido'],
    ['kardex sin producto', () => F.kardex(admin, ZZ, { p_producto: null }), 'parametro_invalido'],
    ['orden desconocido', () => F.kardex(admin, ZZ, { p_producto: PP, p_orden: 'random' }), 'parametro_invalido'],
    ['mes futuro (resumen)', () => F.resumen(admin, ZZ, { p_mes: iso(HY, HM + 1, 1) }), 'mes_futuro'],
    ['mes futuro (movimientos)', () => F.movs(admin, ZZ, { p_mes: iso(HY, HM + 1, 1) }), 'mes_futuro'],
  ]) {
    const r = await fn()
    r.error && r.error.message.includes(err) ? PASS(`rechaza ${t}`, err) : FAIL(`rechaza ${t}`, r.error?.message ?? 'aceptó')
  }

  const zz = await leerEmpresa(ZZ)

  seccion('4 · Stock actual (fixtures)')
  {
    const todo = (await paginas((l, o) => F.stock(admin, ZZ, { p_limite: l, p_desplazamiento: o }))).map(normStock)
    cmp('todas las filas y en orden (SKU, depósito) = regla en JS', stockEsperado(zz), todo)
    const fila = (sku, cod) => todo.find((x) => x.sku === sku && x.deposito_codigo === cod)
    cmp('positivo por depósito, sin sumar depósitos', [[7, 'con_stock'], [4, 'con_stock']], [fila('ZZ4-POS', 'ZZA'), fila('ZZ4-POS', 'ZZB')].map((x) => x && [x.on_hand, x.estado]))
    cmp('movido y hoy en cero', { on_hand: 0, estado: 'cero', disponible_negativo: false }, (({ on_hand, estado, disponible_negativo }) => ({ on_hand, estado, disponible_negativo }))(fila('ZZ4-CERO', 'ZZA') ?? {}))
    cmp('stock negativo visible, no corregido', { on_hand: -3, estado: 'negativo', available: -3 }, (({ on_hand, estado, available }) => ({ on_hand, estado, available }))(fila('ZZ4-NEG', 'ZZA') ?? {}))
    cmp('disponible negativo por reservas (stock positivo)', { on_hand: 5, reserved: 8, available: -3, estado: 'con_stock', disponible_negativo: true }, (({ on_hand, reserved, available, estado, disponible_negativo }) => ({ on_hand, reserved, available, estado, disponible_negativo }))(fila('ZZ4-RES', 'ZZA') ?? {}))
    cmp('reserva sin movimientos: saldo existente con on_hand 0 (≠ sin saldo)', { on_hand: 0, reserved: 2, estado: 'cero', disponible_negativo: true }, (({ on_hand, reserved, estado, disponible_negativo }) => ({ on_hand, reserved, estado, disponible_negativo }))(fila('ZZ4-SOLO-RESERVA', 'ZZB') ?? {}))
    cmp('producto discontinuado: sigue, marcado inactivo', false, fila('ZZ4-DISC', 'ZZB')?.producto_activo)
    cmp('producto nunca movido: sin fila de saldo', false, todo.some((x) => x.sku === 'ZZ4-VIRGEN'))
    cmp('la empresa ajena no aparece', false, todo.some((x) => x.sku === 'ZZ4-AJENO'))
    for (const estado of ['con_stock', 'cero', 'negativo', 'disponible_negativo', 'reservado']) {
      const r = (await paginas((l, o) => F.stock(admin, ZZ, { p_estado: estado, p_limite: l, p_desplazamiento: o }))).map(normStock)
      cmp(`filtro estado = ${estado}`, stockEsperado(zz, { estado }).map((x) => `${x.sku}@${x.deposito_codigo}`), r.map((x) => `${x.sku}@${x.deposito_codigo}`))
    }
    const porDep = (await F.stock(admin, ZZ, { p_deposito: W2, p_limite: 500 })).data.map(normStock)
    cmp('filtro depósito', stockEsperado(zz, { deposito: W2 }).map((x) => x.sku), porDep.map((x) => x.sku))
    cmp('búsqueda literal: «%» y «_» no son comodines', ['ZZ4-100%_X'], (await F.stock(admin, ZZ, { p_busqueda: '%_' })).data.map((x) => x.sku))
    cmp('búsqueda por nombre, sin distinguir mayúsculas', ['ZZ4-NEG'], (await F.stock(admin, ZZ, { p_busqueda: 'stock NEGATIVO' })).data.map((x) => x.sku))
    const dos = []
    for (let o = 0; o < todo.length; o += 2) dos.push(...(await F.stock(admin, ZZ, { p_limite: 2, p_desplazamiento: o })).data.map(normStock))
    cmp('paginación de a 2 concatenada = completo; total_filas constante', todo.map((x) => `${x.sku}@${x.deposito_codigo}`), dos.map((x) => `${x.sku}@${x.deposito_codigo}`))
  }

  seccion('5 · Resumen, catálogo y movimientos del mes (fixtures)')
  {
    const M = { y: HY, m: HM }
    const r = await F.resumen(admin)
    const esp = resumenEsperado(zz, M)
    compararMapas('resumen del mes en curso: cada cifra = regla en JS', esp.filas, mapaResumen(r.data))
    const real = mapaResumen(r.data)
    cmp('total: con stock 6 · cero 2 · negativo 1 · disponible negativo 3 (negativo, reserva de más, reserva sin stock) · con reservas 2', [6, 2, 1, 3, 2], ['con_stock', 'en_cero', 'negativo', 'disponible_negativo', 'con_reservas'].map((k) => real[`estado||${k}`]))
    cmp('23:30 del último día del mes anterior (AR) NO cuenta en el mes; 00:30 del día 1 SÍ (11 movimientos, 3 aperturas)', [11, 3], [real['mes||movimientos'], real['mes_tipo||opening_balance']])
    cmp('entradas/salidas por signo (6 / 5)', [6, 5], [real['mes||entradas'], real['mes||salidas']])
    const rp = await F.resumen(empleado, ZZ, { p_mes: iso(M1.y, M1.m, 20) })
    compararMapas('resumen del mes anterior', resumenEsperado(zz, M1).filas, mapaResumen(rp.data))
    cmp('mes anterior: sólo la apertura de las 23:30', 1, mapaResumen(rp.data)['mes||movimientos'])
    const cat = Object.fromEntries((await F.catalogo(admin)).data.map((x) => [x.categoria, Number(x.cantidad)]))
    cmp('catálogo: 9 productos · 2 sin movimientos (el virgen y el de sólo reserva) · 1 sin saldo', { catalogo: 9, sin_movimientos: 2, sin_balance: 1, sin_movimientos_con_balance: 1 }, cat)
    const todos = (await paginas((l, o) => F.movs(admin, ZZ, { p_limite: l, p_desplazamiento: o }))).map(normMov)
    cmp('movimientos del mes: filas y orden (más reciente primero, id desc) = regla', movimientosEsperados(zz, M), todos)
    for (const [t, f] of [['tipo', { p_tipo: 'opening_balance' }], ['sentido salida', { p_sentido: 'salida' }], ['sentido entrada', { p_sentido: 'entrada' }], ['depósito', { p_deposito: W2 }], ['producto', { p_producto: PK }]]) {
      const esperados = movimientosEsperados(zz, M, { tipo: f.p_tipo, sentido: f.p_sentido, deposito: f.p_deposito, producto: f.p_producto })
      cmp(`filtro ${t}`, esperados.map((x) => x.movimiento_id), (await F.movs(admin, ZZ, { ...f, p_limite: 500 })).data.map((x) => Number(x.movimiento_id)))
    }
    const uno = (await F.movs(admin, ZZ, { p_producto: PC, p_limite: 5 })).data
    cmp('movimiento sin documento: source_id null y referencia null', [null, null], [uno[0]?.source_id, uno[0]?.referencia])
  }

  seccion('6 · Kardex (fixtures)')
  {
    for (const [t, pid, orden, dep] of [['dos depósitos, desc', PP, 'desc', null], ['dos depósitos, asc', PP, 'asc', null], ['un depósito', PP, 'asc', W2], ['movido y hoy en cero', PC, 'asc', null], ['negativo sin apertura', PN, 'asc', null]]) {
      cmp(`kardex ${t} = regla`, kardexEsperado(zz, pid, orden, dep), (await F.kardex(admin, ZZ, { p_producto: pid, p_orden: orden, p_deposito: dep, p_limite: 500 })).data.map(normKx))
    }
    const pp = (await F.kardex(admin, ZZ, { p_producto: PP, p_orden: 'asc', p_deposito: W1 })).data.map(normKx)
    cmp('saldo corrido termina en el saldo actual (10 − 3 = 7), empieza con apertura', [[10, 7], true, true], [pp.map((x) => x.saldo), pp.at(-1)?.saldo === pp.at(-1)?.saldo_actual, pp[0]?.inicia_con_apertura])
    const kx = (await F.kardex(admin, ZZ, { p_producto: PK, p_orden: 'asc' })).data.map(normKx)
    cmp('mismo instante: el orden lo decide el id (−2 antes que −1)', [7, -2, -1], kx.map((x) => x.quantity))
    cmp('saldo guardado desalineado: NO se muestra saldo corrido, se marca no verificable', { saldos: [null, null, null], verificado: false, actual: 5 }, { saldos: kx.map((x) => x.saldo), verificado: kx[0]?.saldo_verificado, actual: kx[0]?.saldo_actual })
    const pn = (await F.kardex(admin, ZZ, { p_producto: PN })).data.map(normKx)
    cmp('negativo: saldo −3 verificado, sin apertura', [[-3], true, false], [pn.map((x) => x.saldo), pn[0]?.saldo_verificado, pn[0]?.inicia_con_apertura])
    cmp('producto nunca movido: kardex vacío', 0, (await F.kardex(admin, ZZ, { p_producto: PV })).data.length)
    cmp('producto de otra empresa: kardex vacío', 0, (await F.kardex(admin, ZZ, { p_producto: PA })).data.length)
    const pag = []
    for (let o = 0; o < 3; o++) pag.push(...(await F.kardex(admin, ZZ, { p_producto: PK, p_orden: 'asc', p_limite: 1, p_desplazamiento: o })).data.map((x) => Number(x.movimiento_id)))
    cmp('paginación del kardex', kx.map((x) => x.movimiento_id), pag)
  }

  seccion('7 · Buscatools real: paridad y latencia')
  {
    const jano = await login('buscatools.jano@gmail.com', process.env.BT_PW_JANO)
    const bt = await leerEmpresa(BT)
    const suma = new Map()
    for (const m of bt.movements) { const k = `${m.product_id}|${m.warehouse_id}`; suma.set(k, (suma.get(k) ?? 0) + Number(m.quantity)) }
    const res = new Map()
    for (const x of bt.reservations) { const k = `${x.product_id}|${x.warehouse_id}`; res.set(k, (res.get(k) ?? 0) + Number(x.quantity)) }
    const keysBal = new Set(bt.balances.map((b) => `${b.product_id}|${b.warehouse_id}`))
    const desfasados = bt.balances.filter((b) => (suma.get(`${b.product_id}|${b.warehouse_id}`) ?? 0) !== Number(b.on_hand))
    const huerfanos = [...suma.keys()].filter((k) => !keysBal.has(k))
    const resMal = bt.balances.filter((b) => (res.get(`${b.product_id}|${b.warehouse_id}`) ?? 0) !== Number(b.reserved))
    cmp('Σ movimientos = on_hand en TODOS los saldos; 0 movimientos sin saldo; Σ reservas = reserved', { saldos: bt.balances.length, desfasados: 0, huerfanos: 0, reservado_mal: 0 }, { saldos: bt.balances.length, desfasados: desfasados.length, huerfanos: huerfanos.length, reservado_mal: resMal.length })
    const t0 = Date.now()
    const rr = await F.resumen(jano, BT)
    const tRes = Date.now() - t0
    compararMapas('resumen Buscatools = regla en JS sobre filas crudas', resumenEsperado(bt, { y: HY, m: HM }).filas, mapaResumen(rr.data))
    const stockReal = (await paginas((l, o) => F.stock(jano, BT, { p_limite: l, p_desplazamiento: o }))).map(normStock)
    cmp('stock actual Buscatools: todas las filas y en orden', stockEsperado(bt).length, stockReal.length)
    const malas = stockEsperado(bt).filter((x, i) => JSON.stringify(x) !== JSON.stringify(stockReal[i]))
    malas.length === 0 ? PASS('stock actual Buscatools: cada fila = regla', `${stockReal.length} filas`) : FAIL('stock actual Buscatools', JSON.stringify(malas.slice(0, 2)))
    const movReal = (await paginas((l, o) => F.movs(jano, BT, { p_limite: l, p_desplazamiento: o }))).map(normMov)
    cmp('movimientos del mes Buscatools: cada fila y orden = regla', movimientosEsperados(bt, { y: HY, m: HM }).map((x) => JSON.stringify(x)), movReal.map((x) => JSON.stringify(x)))
    const sp = bt.movements.find((m) => m.source_type === 'test')?.product_id
    if (sp) {
      const kr = (await F.kardex(jano, BT, { p_producto: sp, p_orden: 'asc' })).data
      cmp('kardex SP.S23-BH6: 100 → 70 → 65 = saldo actual, verificado', kardexEsperado(bt, sp, 'asc'), kr.map(normKx))
      INFO('kardex SP.S23-BH6', JSON.stringify(kr.map((x) => [x.movement_type, Number(x.quantity), Number(x.saldo)])))
    }
    let kxOk = 0
    const muestra = [...new Set(bt.movements.map((m) => m.product_id))].slice(0, 40)
    for (const pid of muestra) if (JSON.stringify(kardexEsperado(bt, pid, 'desc')) === JSON.stringify((await F.kardex(jano, BT, { p_producto: pid })).data.map(normKx))) kxOk++
    cmp('kardex de 40 productos reales = regla (saldo verificado en todos)', muestra.length, kxOk)
    const cat = Object.fromEntries((await F.catalogo(jano, BT)).data.map((x) => [x.categoria, Number(x.cantidad)]))
    INFO('catálogo Buscatools', JSON.stringify(cat))
    const real = mapaResumen(rr.data)
    INFO('stock Buscatools', JSON.stringify({ saldos: real['estado||balances'], con_stock: real['estado||con_stock'], en_cero: real['estado||en_cero'], negativo: real['estado||negativo'], disponible_negativo: real['estado||disponible_negativo'], con_reservas: real['estado||con_reservas'] }))
    INFO('movimientos por tipo/origen (mes)', JSON.stringify(Object.fromEntries(Object.entries(real).filter(([k]) => k.startsWith('mes_')))))
    const lat = {}
    for (const [n, fn] of [['resumen', () => F.resumen(jano, BT)], ['catalogo', () => F.catalogo(jano, BT)], ['stock 50', () => F.stock(jano, BT)], ['movs 50', () => F.movs(jano, BT)], ['kardex', () => F.kardex(jano, BT, { p_producto: sp })]]) {
      const t = []
      for (let i = 0; i < 5; i++) { const a = Date.now(); await fn(); t.push(Date.now() - a) }
      t.sort((a, b) => a - b); lat[n] = `mediana ${t[2]} · máx ${t[4]}`
    }
    INFO('latencia (5 llamadas, con red, ms)', JSON.stringify({ ...lat, primera_resumen: tRes }))
  }

  seccion('8 · Limpieza y base intacta')
  await barrer()
  cmp('sin empresas zz-inf4', 0, (await s.from('companies').select('id', { count: 'exact', head: true }).like('slug', `${MARCA}-%`)).count)
  const { data: us } = await s.auth.admin.listUsers({ perPage: 1000 })
  cmp('sin usuarios zz-inf4', 0, (us?.users ?? []).filter((u) => u.email?.startsWith(`${MARCA}-`)).length)
  const huellaDespues = await huellaStock()
  cmp('stock_movements, stock_balances y stock_reservations de las empresas reales: misma huella', huellaAntes, huellaDespues)
  INFO('conteos reales', JSON.stringify(Object.fromEntries(Object.entries(huellaDespues).map(([k, v]) => [k, v.n]))))

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
