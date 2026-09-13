/**
 * Fase 10 · Informes — entrega 3: `informe_rankings_comerciales` y CSV, contra la base real.
 *
 * Prueba, con JWT reales:
 *
 *   · sólo admin y employee; salesperson, technician, customer, distributor,
 *     admin de otra empresa, anon y empresa nula no reciben nada;
 *   · validación de parámetros: clientes por cantidad, importe sin moneda,
 *     cantidad con moneda, productos entregados por importe, límites, mes futuro;
 *   · CADA combinación (dimensión · fuente · medida · período · moneda) contra
 *     una regla en JS calculada sobre las filas crudas de las tablas, fila por
 *     fila y en orden: agrupación por customer_id / product_id, líneas sin
 *     producto por SKU exacto (sin fusionar mayúsculas), cliente y producto dados
 *     de baja, precio 0, datos atípicos, monedas separadas, SIN MONEDA, empates;
 *   · Top N y paginación: LIMIT/OFFSET concatenados = ranking completo;
 *   · límites del período: día 1 del mes, último día del mes anterior, 12 meses;
 *   · paridad con Buscatools en todas las combinaciones del mes y de 12 meses;
 *   · GRAMPA.80-4T: aparece, no se excluye, importe 0, cantidad real, atípico;
 *   · CSV generado con la MISMA biblioteca de la app (src/modules/informes/lib/csv.ts)
 *     sobre filas reales del RPC: cabecera, moneda, SIN MONEDA, filas, acentos,
 *     comillas, inyección de fórmulas, BOM;
 *   · el histórico no se toca (conteos + huella); latencia.
 *
 * Fixtures en empresas zz-inf3-*; se borran al final.
 *
 *   set -a; source .env; source .env.migration; source .env.rls.txt; set +a
 *   node --experimental-strip-types scripts/fase10-informes-entrega3-tests.mjs
 *
 * NO correrla en paralelo con otra suite de base.
 */
import { createClient } from '@supabase/supabase-js'
import { createHash, randomUUID } from 'node:crypto'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET || !process.env.BT_PW_JANO) { console.error('✗ Faltan variables'); process.exit(1) }

const csvLib = await import('../src/modules/informes/lib/csv.ts').catch((e) => { console.error('✗ No se pudo importar lib/csv.ts (¿falta --experimental-strip-types?):', e.message); process.exit(1) })

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(72)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const INFO = (t, d = '') => console.log(`    INFO  ${t}${d ? ' — ' + d : ''}`)
const cmp = (t, esp, real) => (JSON.stringify(esp) === JSON.stringify(real) ? PASS(t, String(JSON.stringify(real)).slice(0, 110)) : FAIL(t, `esperaba ${JSON.stringify(esp)}, dio ${JSON.stringify(real)}`))

const s = createClient(BASE, SECRET, { auth: { persistSession: false } })

/**
 * Documentos migrados del legacy (imported_at): son un histórico congelado.
 * Las tablas siguen vivas: un número productivo sólo se afirma si todavía no
 * entró ningún documento nuevo; si entró, la paridad calculada es la prueba.
 */
const historicosCongelados = async (sc) => {
  // Sólo empresas reales: las fixtures zz-* de la propia suite no cuentan como documentos nuevos.
  const reales = ((await sc.from('companies').select('id').not('slug', 'like', 'zz-%')).data ?? []).map((c) => c.id)
  const nuevos = {}
  for (const t of ['sales_quotes', 'sales_orders', 'deliveries']) nuevos[t] = (await sc.from(t).select('id', { count: 'exact', head: true }).is('imported_at', null).in('company_id', reales)).count ?? 0
  const importados = {}
  for (const t of ['sales_quotes', 'sales_orders', 'deliveries']) importados[t] = (await sc.from(t).select('id', { count: 'exact', head: true }).not('imported_at', 'is', null)).count ?? 0
  return { soloHistorico: Object.values(nuevos).every((n) => n === 0), nuevos, importados }
}
const MARCA = 'zz-inf3'
const r4 = (v) => (v === null || v === undefined ? null : Math.round(Number(v) * 10000) / 10000)
const cmpC = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const trimSp = (x) => (x ?? '').replace(/^ +| +$/g, '')

// ── fechas ──────────────────────────────────────────────────────────────────
const hoyAR = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
const [HY, HM, HD] = hoyAR.split('-').map(Number)
const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10)
const ultimoDia = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const mesDesplazado = (k, base = { y: HY, m: HM }) => { const d = new Date(Date.UTC(base.y, base.m - 1 + k, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 } }
const M = mesDesplazado(0)
const M1 = mesDesplazado(-1)
const M11 = mesDesplazado(-11)
const M12 = mesDesplazado(-12)
const dia = (x, d) => iso(x.y, x.m, Math.min(d, ultimoDia(x.y, x.m)))

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

const rpc = (c, company, p, mes = null) => c.rpc('informe_rankings_comerciales', {
  p_company: company, p_mes: mes, p_dimension: p.dimension, p_fuente: p.fuente, p_medida: p.medida,
  p_periodo: p.periodo, p_moneda: p.moneda ?? null, p_limite: p.limite ?? 500, p_desplazamiento: p.desplazamiento ?? 0,
})
async function rankingCompleto(c, company, p, mes = null) {
  const todas = []
  for (let off = 0; off < 20000; off += 500) {
    const { data, error } = await rpc(c, company, { ...p, limite: 500, desplazamiento: off }, mes)
    if (error) throw new Error(`${JSON.stringify(p)}: ${error.message}`)
    todas.push(...data)
    if (data.length < 500) break
  }
  return todas
}

// ── la regla, en JS, sobre filas crudas ─────────────────────────────────────
function tramo(ref, periodo) {
  const esMesEnCurso = ref.y === M.y && ref.m === M.m
  const hasta = esMesEnCurso ? hoyAR : dia(ref, 31)
  const desde = periodo === 'mes' ? dia(ref, 1) : dia(mesDesplazado(-11, ref), 1)
  return [desde, hasta]
}

function esperado(d, p, ref) {
  const [desde, hasta] = tramo(ref, p.periodo)
  const en = (f) => f >= desde && f <= hasta
  const mon = (m) => m ?? 'SIN MONEDA'
  const cab = {
    cotizado: d.quotes.filter((h) => h.status !== 'draft' && en(h.quote_date)),
    pedido: d.orders.filter((h) => h.commercial_status === 'confirmed' && en(h.order_date)),
    entregado: d.deliveries.filter((h) => (h.status === 'shipped' || h.status === 'delivered') && en(h.delivery_date)),
  }[p.fuente]
  let filas
  if (p.dimension === 'clientes') {
    const g = new Map()
    for (const h of cab.filter((x) => mon(x.currency_code) === p.moneda)) {
      const k = h.customer_id ?? null
      const a = g.get(k) ?? { docs: 0, imp: 0 }
      a.docs++; a.imp += Number(h.total ?? 0); g.set(k, a)
    }
    filas = [...g].map(([cli, a]) => {
      const c = cli ? d.customers.get(cli) : null
      return {
        clave: cli ? `cliente:${cli}` : 'cliente:sin-vinculo', cliente_id: cli, producto_id: null,
        etiqueta: cli ? (trimSp(c?.trade_name) || trimSp(c?.legal_name) || 'Cliente no visible') : 'SIN CLIENTE VINCULADO',
        codigo: null, moneda: p.moneda, importe: r4(a.imp), cantidad: null, documentos: a.docs, lineas_atipicas: null, cantidad_atipica: null,
        vinculado: cli !== null, activo: cli === null ? null : !!(c && c.deleted_at === null && c.status === 'active'), _m: r4(a.imp),
      }
    })
  } else {
    const cabIds = new Map(cab.map((h) => [h.id, h]))
    const lineas = []
    if (p.fuente === 'cotizado') for (const l of d.quoteLines) { const h = cabIds.get(l.quote_id); if (h && l.line_type !== 'chapter') lineas.push({ doc: h.id, l, h, q: Number(l.quantity), imp: Number(l.quantity) * Number(l.unit_price) * (1 - Number(l.discount_pct) / 100) * (1 - Number(h.discount_pct ?? 0) / 100) * (1 + Number(l.tax_rate_snapshot) / 100), atip: Number(l.quantity) >= 1000 && Number(l.unit_price) === 0 }) }
    if (p.fuente === 'pedido') for (const l of d.orderLines) { const h = cabIds.get(l.order_id); if (h && l.line_type !== 'chapter') lineas.push({ doc: h.id, l, h, q: Number(l.quantity_ordered), imp: Number(l.quantity_ordered) * Number(l.unit_price) * (1 - Number(l.discount_pct) / 100) * (1 - Number(h.discount_pct ?? 0) / 100) * (1 + Number(l.tax_rate_snapshot) / 100), atip: Number(l.quantity_ordered) >= 1000 && Number(l.unit_price) === 0 }) }
    if (p.fuente === 'entregado') {
      const precioPedido = new Map(d.orderLines.map((l) => [l.id, Number(l.unit_price)]))
      for (const l of d.deliveryLines) {
        const h = cabIds.get(l.delivery_id); if (!h) continue
        const precio = l.unit_price !== null ? Number(l.unit_price) : l.order_line_id ? precioPedido.get(l.order_line_id) : undefined
        lineas.push({ doc: h.id, l, h, q: Number(l.quantity), imp: null, atip: Number(l.quantity) >= 1000 && precio === 0 })
      }
    }
    const g = new Map()
    for (const x of lineas) {
      if (p.medida === 'importe' && mon(x.h.currency_code) !== p.moneda) continue
      const k = x.l.product_id ? `p:${x.l.product_id}` : `s:${x.l.sku_snapshot}`
      const a = g.get(k) ?? { pid: x.l.product_id, skuSin: x.l.product_id ? null : x.l.sku_snapshot, docs: new Set(), cant: 0, imp: 0, latip: 0, catip: 0, nom: null, sku: null }
      a.docs.add(x.doc); a.cant += x.q; a.imp += x.imp ?? 0
      if (x.atip) { a.latip++; a.catip += x.q }
      if (x.l.name_snapshot !== null && (a.nom === null || cmpC(x.l.name_snapshot, a.nom) < 0)) a.nom = x.l.name_snapshot
      if (x.l.sku_snapshot !== null && (a.sku === null || cmpC(x.l.sku_snapshot, a.sku) < 0)) a.sku = x.l.sku_snapshot
      g.set(k, a)
    }
    filas = [...g.values()].map((a) => {
      const prod = a.pid ? d.products.get(a.pid) : null
      // admin y employee ven también los productos borrados (products_write es ALL
      // para quien escribe): la etiqueta sigue siendo la del catálogo.
      const visible = prod ?? null
      return {
        clave: a.pid ? `producto:${a.pid}` : a.skuSin !== null ? `sku:${a.skuSin}` : 'sin-sku', cliente_id: null, producto_id: a.pid,
        etiqueta: visible?.name ?? a.nom ?? a.sku ?? 'Línea sin producto ni SKU', codigo: visible?.sku ?? a.sku,
        moneda: p.medida === 'importe' ? p.moneda : null, importe: p.medida === 'importe' ? r4(a.imp) : null, cantidad: r4(a.cant),
        documentos: a.docs.size, lineas_atipicas: a.latip, cantidad_atipica: r4(a.catip),
        vinculado: a.pid !== null, activo: a.pid === null ? null : !!(visible && visible.deleted_at === null && visible.status === 'active'),
        _m: p.medida === 'importe' ? r4(a.imp) : r4(a.cant),
      }
    })
  }
  filas.sort((x, y) => (y._m - x._m) || (y.documentos - x.documentos) || cmpC(x.etiqueta, y.etiqueta) || cmpC(x.clave, y.clave))
  return filas.map(({ _m, ...f }, i) => ({ posicion: i + 1, total_filas: filas.length, ...f, desde, hasta }))
}

const normalizar = (f) => ({
  posicion: Number(f.posicion), total_filas: Number(f.total_filas), clave: f.clave, cliente_id: f.cliente_id, producto_id: f.producto_id,
  etiqueta: f.etiqueta, codigo: f.codigo, moneda: f.moneda, importe: r4(f.importe), cantidad: r4(f.cantidad), documentos: Number(f.documentos),
  lineas_atipicas: f.lineas_atipicas === null ? null : Number(f.lineas_atipicas), cantidad_atipica: r4(f.cantidad_atipica),
  vinculado: f.vinculado, activo: f.activo, desde: f.desde, hasta: f.hasta,
})
const igualesFila = (a, b) => a && b && Object.keys(a).every((k) => (typeof a[k] === 'number' && typeof b[k] === 'number' ? Math.abs(a[k] - b[k]) < 0.00011 : a[k] === b[k]))
function compararRanking(t, esp, real, silencioso = false) {
  const r = real.map(normalizar)
  const n = Math.max(esp.length, r.length)
  const malas = []
  for (let i = 0; i < n; i++) if (!igualesFila(esp[i], r[i])) malas.push([i, esp[i] ?? null, r[i] ?? null])
  if (malas.length === 0) { if (!silencioso) PASS(t, `${r.length} filas`); return true }
  FAIL(t, JSON.stringify(malas.slice(0, 2)).slice(0, 900)); return false
}

/** Todas las combinaciones válidas para las monedas presentes. */
function combinaciones(monedas) {
  const out = []
  for (const periodo of ['mes', '12m']) for (const fuente of ['entregado', 'pedido', 'cotizado']) {
    for (const moneda of monedas) out.push({ dimension: 'clientes', fuente, medida: 'importe', periodo, moneda })
    if (fuente !== 'entregado') for (const moneda of monedas) out.push({ dimension: 'productos', fuente, medida: 'importe', periodo, moneda })
    out.push({ dimension: 'productos', fuente, medida: 'cantidad', periodo, moneda: null })
  }
  return out
}

const barrer = async () => {
  const { data: emp } = await s.from('companies').select('id').like('slug', `${MARCA}-%`)
  const ids = (emp ?? []).map((x) => x.id)
  if (ids.length) {
    for (const t of ['delivery_lines', 'deliveries', 'sales_order_lines', 'sales_orders', 'sales_quote_lines', 'sales_quotes', 'sales_audit', 'stock_reservations', 'stock_movements']) await s.from(t).delete().in('company_id', ids)
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

async function leerTodo(tabla, columnas, filtro) {
  const filas = []
  for (let desde = 0; ; desde += 1000) {
    let q = s.from(tabla).select(columnas).order('id').range(desde, desde + 999)
    q = filtro(q)
    const { data, error } = await q
    if (error) throw new Error(`${tabla}: ${error.message}`)
    filas.push(...data)
    if (data.length < 1000) return filas
  }
}
const leerEmpresa = async (company) => {
  const f = (q) => q.eq('company_id', company)
  const customers = await leerTodo('customers', 'id, legal_name, trade_name, status, deleted_at', f)
  const d = {
    quotes: await leerTodo('sales_quotes', 'id, customer_id, quote_date, status, currency_code, total, discount_pct', f),
    quoteLines: await leerTodo('sales_quote_lines', 'id, quote_id, product_id, sku_snapshot, name_snapshot, quantity, unit_price, discount_pct, tax_rate_snapshot, line_type', f),
    orders: await leerTodo('sales_orders', 'id, customer_id, order_date, commercial_status, currency_code, total, discount_pct', f),
    orderLines: await leerTodo('sales_order_lines', 'id, order_id, product_id, sku_snapshot, name_snapshot, quantity_ordered, unit_price, discount_pct, tax_rate_snapshot, line_type', f),
    deliveries: await leerTodo('deliveries', 'id, customer_id, delivery_date, status, currency_code, total', f),
    deliveryLines: await leerTodo('delivery_lines', 'id, delivery_id, order_line_id, product_id, sku_snapshot, name_snapshot, quantity, unit_price', f),
    customers: new Map(customers.map((c) => [c.id, c])),
  }
  const pids = [...new Set([...d.quoteLines, ...d.orderLines, ...d.deliveryLines].map((l) => l.product_id).filter(Boolean))]
  const prods = []
  for (let i = 0; i < pids.length; i += 200) {
    const { data, error } = await s.from('products').select('id, sku, name, status, deleted_at, company_id').in('id', pids.slice(i, i + 200))
    if (error) throw new Error(error.message)
    prods.push(...data.filter((x) => x.company_id === company))
  }
  d.products = new Map(prods.map((x) => [x.id, x]))
  return d
}
const monedasDe = (d) => [...new Set([...d.quotes, ...d.orders, ...d.deliveries].map((h) => h.currency_code ?? 'SIN MONEDA'))].sort()

async function huella(company) {
  const h = {}
  for (const [t, cols] of [['sales_quotes', 'id, total, status, updated_at'], ['sales_orders', 'id, total, commercial_status, fulfillment_status, updated_at'], ['deliveries', 'id, total, status, updated_at'], ['sales_quote_lines', 'id, quantity, unit_price, product_id'], ['sales_order_lines', 'id, quantity_ordered, unit_price, product_id'], ['delivery_lines', 'id, quantity, order_line_id, product_id']]) {
    const filas = await leerTodo(t, cols, (q) => q.eq('company_id', company))
    h[t] = { n: filas.length, sha: createHash('sha256').update(JSON.stringify(filas)).digest('hex').slice(0, 16) }
  }
  return h
}

const main = async () => {
  await barrer()
  INFO('hoy en Argentina', hoyAR)
  const BT = (await s.from('companies').select('id').eq('slug', 'buscatools').single()).data.id
  const huellaAntes = await huella(BT)

  seccion('1 · Fixtures')
  const ins = async (tabla, fila) => {
    const r = await s.from(tabla).insert(fila).select('id').single()
    if (r.error) throw new Error(`${tabla}: ${r.error.message}`)
    return r.data.id
  }
  const empresa = async (suf) => ins('companies', { slug: `${MARCA}-${suf}-${Date.now()}`, name: `ZZ-INF3 ${suf}`, default_currency: 'ARS' })
  const ZZ = await empresa('propia')
  const ZZ2 = await empresa('ajena')
  let dep = (await s.from('warehouses').select('id').eq('company_id', ZZ).limit(1).maybeSingle()).data
  if (!dep) dep = { id: await ins('warehouses', { company_id: ZZ, code: 'ZZ3', name: 'ZZ-INF3' }) }
  const cat = await ins('product_categories', { company_id: ZZ, name: 'ZZ-INF3', slug: `zz-inf3-${Date.now()}` })

  const CA = await ins('customers', { company_id: ZZ, legal_name: 'Alfa Sociedad Anónima', trade_name: 'Alfa' })
  const CB = await ins('customers', { company_id: ZZ, legal_name: 'Beta Laminación S.A.I.C.' })
  const CI = await ins('customers', { company_id: ZZ, legal_name: '=HYPERLINK("http://x","clic")', trade_name: '  ' })
  const CD = await ins('customers', { company_id: ZZ, legal_name: 'Delta dado de baja' })
  const CX = await ins('customers', { company_id: ZZ2, legal_name: 'Ajeno' })

  const PA = await ins('products', { company_id: ZZ, category_id: cat, sku: 'ZZ3-A', name: 'Pinza «A» 4" (100mm)' })
  const PB = await ins('products', { company_id: ZZ, category_id: cat, sku: 'ZZ3-B', name: 'Broca B' })
  const PG = await ins('products', { company_id: ZZ, category_id: cat, sku: 'ZZ3-GRAMPA', name: 'Grampa atípica' })
  const PD = await ins('products', { company_id: ZZ, category_id: cat, sku: 'ZZ3-DISC', name: 'Discontinuado', status: 'discontinued' })
  const PX = await ins('products', { company_id: ZZ, category_id: cat, sku: 'ZZ3-BORRADO', name: 'Nombre actual oculto' })

  let n = 0
  const num = (p) => `${MARCA}-${p}-${++n}-${Date.now()}`
  let ln = 0
  // Las líneas sólo se cargan en cotizaciones abiertas (trigger de Ventas): se crean
  // como 'sent' y el estado final se pone al terminar. Con líneas, los triggers
  // recalculan el total desde ellas: los montos de abajo están pensados para eso.
  const cierres = []
  const cot = async (fecha, status, moneda, total, cli, company = ZZ) => {
    const cerrado = ['accepted', 'rejected', 'expired'].includes(status)
    const id = await ins('sales_quotes', { company_id: company, number: num('cot'), customer_id: cli, quote_date: fecha, status: cerrado ? 'sent' : status, currency_code: moneda, total })
    if (cerrado) cierres.push([id, status])
    return id
  }
  const qlin = (quoteId, pid, sku, nom, q, precio, dto = 0, iva = 21) => ins('sales_quote_lines', { company_id: ZZ, quote_id: quoteId, line_no: ++ln, product_id: pid, sku_snapshot: sku, name_snapshot: nom, quantity: q, unit_price: precio, discount_pct: dto, tax_rate_snapshot: iva })
  const ped = (fecha, status, moneda, total, cli, dto = null) => ins('sales_orders', { company_id: ZZ, number: num('ped'), customer_id: cli, order_date: fecha, commercial_status: status, currency_code: moneda, total, discount_pct: dto })
  const olin = (orderId, pid, sku, nom, q, precio, dto = 0, iva = 21) => ins('sales_order_lines', { company_id: ZZ, order_id: orderId, line_no: ++ln, product_id: pid, sku_snapshot: sku, name_snapshot: nom, quantity_ordered: q, unit_price: precio, discount_pct: dto, tax_rate_snapshot: iva })
  const rem = (fecha, status, moneda, total, cli, orderId = null) => ins('deliveries', { company_id: ZZ, number: num('rem'), customer_id: cli, delivery_date: fecha, status, currency_code: moneda, total, order_id: orderId })
  const rlin = (deliveryId, orderLineId, pid, sku, nom, q) => ins('delivery_lines', { company_id: ZZ, delivery_id: deliveryId, order_line_id: orderLineId, product_id: pid, sku_snapshot: sku, name_snapshot: nom, quantity: q, warehouse_id: dep.id })

  // Cotizaciones del mes (día 1 y hoy), empates, SIN MONEDA, borrador, límites
  const q1 = await cot(dia(M, 1), 'sent', 'USD', 100, CA)
  await qlin(q1, PA, 'ZZ3-A', 'Pinza A vieja', 2, 10, 50, 21)      // 2×10×0,5×1,21 = 12,1
  await qlin(q1, null, 'ZZ-SUELTO', 'Suelto uno', 3, 5, 0, 0)       // sin producto: 15
  const q2 = await cot(hoyAR, 'accepted', 'USD', 0, CB)               // total 27,10: empata con Alfa (27,10) en importe y documentos → Alfa primero
  await qlin(q2, PB, 'ZZ3-B', 'Broca', 1, 22.1, 0, 0)
  await qlin(q2, null, 'zz-suelto', 'Suelto minúscula', 1, 5, 0, 0) // otro SKU: no se fusiona con ZZ-SUELTO
  const q3 = await cot(dia(M, 1), 'sent', null, 300, CI)              // SIN MONEDA, cliente con nombre peligroso
  await qlin(q3, PG, 'ZZ3-GRAMPA', 'Grampa', 5000, 0, 0, 21)          // atípica: 5000 u. a precio 0
  await qlin(q3, PB, 'ZZ3-B', 'Broca', 1, 300, 0, 0)                  // total 300
  const q4 = await cot(dia(M, 1), 'draft', 'USD', 9999, CA)           // borrador: fuera
  await qlin(q4, PA, 'ZZ3-A', 'x', 999, 999)
  const q5 = await cot(dia(M1, ultimoDia(M1.y, M1.m)), 'rejected', 'USD', 40, CD) // fuera del mes, dentro de 12 meses; cliente de baja
  await qlin(q5, PX, 'ZZ3-BORRADO', 'Nombre histórico', 4, 10, 0, 0)  // producto que después se borra
  const q6 = await cot(dia(M11, 1), 'expired', 'ARS', 50, CB)         // primer mes de los 12
  await qlin(q6, PD, 'ZZ3-DISC', 'Disc', 1, 50, 0, 0)
  const q7 = await cot(dia(M12, ultimoDia(M12.y, M12.m)), 'sent', 'USD', 7777, CA) // fuera de 12 meses
  await qlin(q7, PA, 'ZZ3-A', 'x', 7777, 1)
  const q8 = await cot(hoyAR, 'sent', 'USD', 0, CI)                    // otro cliente: no rompe el empate Alfa/Beta
  await qlin(q8, null, 'ZZ-SUELTO', 'A-nombre menor', 2, 5, 0, 0)  // mismo SKU suelto, otro nombre: etiqueta = min
  await cot(hoyAR, 'sent', 'USD', 555, CX, ZZ2)                       // empresa ajena (sin líneas: conserva 555)
  for (const [id, status] of cierres) {
    const { error } = await s.from('sales_quotes').update({ status }).eq('id', id)
    if (error) throw new Error(`cerrar cotización: ${error.message}`)
  }

  // Pedidos
  const o1 = await ped(dia(M, 1), 'confirmed', 'USD', 500, CA, 10)
  const o1a = await olin(o1, PA, 'ZZ3-A', 'Pinza', 3, 100, 20, 21)  // 3×100×0,8×0,9×1,21 = 261,36
  const o1g = await olin(o1, PG, 'ZZ3-GRAMPA', 'Grampa', 2000, 0, 0, 21)
  const o2 = await ped(hoyAR, 'confirmed', 'ARS', 1000, CB)
  const o2b = await olin(o2, PB, 'ZZ3-B', 'Broca', 7, 10, 0, 10.5)
  await olin(o2, null, 'ZZ-SUELTO', 'Suelto', 1, 10, 0, 0)
  const o3 = await ped(dia(M, 1), 'draft', 'USD', 8888, CA)
  await olin(o3, PA, 'ZZ3-A', 'x', 888, 8)
  const o4 = await ped(dia(M, 1), 'cancelled', 'USD', 7777, CA)
  const o5 = await ped(dia(M1, ultimoDia(M1.y, M1.m)), 'confirmed', null, 60, CD)
  await olin(o5, PX, 'ZZ3-BORRADO', 'Nombre histórico', 6, 10, 0, 0)

  // Remitos (las líneas de pedido ya existen; el trigger bloquea cambios luego)
  const r1 = await rem(dia(M, 1), 'shipped', 'USD', 400, CA, o1)
  await rlin(r1, o1a, PA, 'ZZ3-A', 'Pinza', 3)
  await rlin(r1, o1g, PG, 'ZZ3-GRAMPA', 'Grampa', 2000)             // atípica: precio del pedido = 0
  const r2 = await rem(hoyAR, 'delivered', 'ARS', 70, CB, o2)
  await rlin(r2, o2b, PB, 'ZZ3-B', 'Broca', 7)
  const r3 = await rem(dia(M, 1), 'delivered', null, 30, CI)          // SIN MONEDA, sin pedido
  await rlin(r3, null, null, 'ZZ-SUELTO', 'Suelto remito', 4)
  await rlin(r3, null, null, 'ZZ-SIN-PRECIO', 'Sin precio', 3000)     // 3000 u. sin precio conocido: NO atípica
  const r4x = await rem(dia(M, 1), 'draft', 'USD', 9, CA)
  await rlin(r4x, null, PA, 'ZZ3-A', 'x', 99)
  const r5 = await rem(dia(M, 1), 'cancelled', 'USD', 9, CA)
  await rlin(r5, null, PA, 'ZZ3-A', 'x', 98)
  void o4

  // Bajas: cliente y producto borrados lógicamente DESPUÉS de tener historia
  { const { error } = await s.from('customers').update({ deleted_at: new Date().toISOString() }).eq('id', CD); if (error) throw new Error(`baja cliente: ${error.message}`) }
  { const { error } = await s.from('products').update({ deleted_at: new Date().toISOString() }).eq('id', PX); if (error) throw new Error(`baja producto: ${error.message}`) }

  const admin = await usuario(ZZ, 'admin')
  const empleado = await usuario(ZZ, 'employee')
  const vendedor = await usuario(ZZ, 'salesperson')
  const tecnico = await usuario(ZZ, 'technician')
  const clienteU = await usuario(ZZ, 'customer', CA)
  const distrib = await usuario(ZZ, 'distributor', CA)
  const adminAjeno = await usuario(ZZ2, 'admin')
  const anon = createClient(BASE, PUB, { auth: { persistSession: false } })
  PASS('fixtures', '2 empresas · 5 clientes · 5 productos · cotizaciones, pedidos y remitos de cada caso · 8 identidades')

  const P0 = { dimension: 'clientes', fuente: 'cotizado', medida: 'importe', periodo: 'mes', moneda: 'USD' }

  seccion('2 · Quién puede')
  for (const [nombre, c] of [['ADMIN', admin], ['EMPLOYEE', empleado]]) {
    const r = await rpc(c, ZZ, P0)
    r.error ? FAIL(`${nombre} lee el ranking`, r.error.message) : PASS(`${nombre} lee el ranking`, `${r.data.length} filas`)
  }
  for (const [nombre, c] of [['SALESPERSON', vendedor], ['TECHNICIAN', tecnico], ['CUSTOMER', clienteU], ['DISTRIBUTOR', distrib], ['ADMIN de otra empresa', adminAjeno]]) {
    const r = await rpc(c, ZZ, P0)
    r.error && /sin_permiso/.test(r.error.message) ? PASS(`${nombre} no puede`, r.error.message) : FAIL(`${nombre} no puede`, r.error?.message ?? `devolvió ${r.data?.length} filas`)
  }
  { const r = await rpc(anon, ZZ, P0); r.error ? PASS('ANON no puede ejecutar', r.error.code ?? r.error.message) : FAIL('ANON ejecutó') }
  { const r = await rpc(admin, null, P0); r.error && /sin_permiso/.test(r.error.message) ? PASS('empresa nula: rechazada', r.error.message) : FAIL('empresa nula aceptada') }
  { const r = await rpc(adminAjeno, ZZ2, P0); cmp('el admin ajeno ve SU empresa, sin datos de ésta', [['Ajeno', 555]], (r.data ?? []).map((x) => [x.etiqueta, Number(x.importe)])) }

  seccion('3 · Parámetros')
  for (const [t, p, err] of [
    ['clientes por cantidad', { ...P0, medida: 'cantidad', moneda: null }, 'parametro_invalido'],
    ['importe sin moneda', { ...P0, moneda: null }, 'parametro_invalido'],
    ['cantidad con moneda', { dimension: 'productos', fuente: 'pedido', medida: 'cantidad', periodo: 'mes', moneda: 'USD' }, 'parametro_invalido'],
    ['productos entregados por importe', { dimension: 'productos', fuente: 'entregado', medida: 'importe', periodo: 'mes', moneda: 'USD' }, 'sin_importe'],
    ['límite 0', { ...P0, limite: 0 }, 'parametro_invalido'],
    ['límite 501', { ...P0, limite: 501 }, 'parametro_invalido'],
    ['desplazamiento negativo', { ...P0, desplazamiento: -1 }, 'parametro_invalido'],
    ['dimensión desconocida', { ...P0, dimension: 'vendedores' }, 'parametro_invalido'],
  ]) {
    const r = await rpc(admin, ZZ, p)
    r.error && r.error.message.includes(err) ? PASS(`rechaza ${t}`, err) : FAIL(`rechaza ${t}`, r.error?.message ?? 'aceptó')
  }
  { const r = await rpc(admin, ZZ, P0, dia(mesDesplazado(1), 1)); r.error && /mes_futuro/.test(r.error.message) ? PASS('rechaza mes futuro', 'mes_futuro') : FAIL('mes futuro aceptado') }

  const zz = await leerEmpresa(ZZ)

  seccion('4 · Cada combinación contra la regla (fixtures)')
  {
    const combos = combinaciones(monedasDe(zz))
    let ok = 0
    for (const p of combos) if (compararRanking(`${p.dimension}·${p.fuente}·${p.medida}·${p.periodo}·${p.moneda ?? '-'}`, esperado(zz, p, M), await rankingCompleto(admin, ZZ, p), true)) ok++
    ok === combos.length ? PASS('todas las combinaciones del mes en curso, fila por fila y en orden', `${combos.length} rankings`) : FAIL('combinaciones', `${ok} de ${combos.length}`)
    let okP = 0
    for (const p of combos) if (compararRanking(`mes pasado ${p.dimension}·${p.fuente}·${p.medida}·${p.periodo}·${p.moneda ?? '-'}`, esperado(zz, p, M1), await rankingCompleto(empleado, ZZ, p, dia(M1, 9)), true)) okP++
    okP === combos.length ? PASS('ídem, mes pasado (tramos completos)', `${combos.length} rankings`) : FAIL('combinaciones mes pasado', `${okP} de ${combos.length}`)
  }

  seccion('5 · Casos puntuales')
  {
    const ver = async (p, mes = null) => (await rankingCompleto(admin, ZZ, p, mes)).map(normalizar)
    const cliUSD = await ver(P0)
    cmp('empate en importe y documentos: por nombre (Alfa antes que Beta)', [['Alfa', 27.1, 1], ['Beta Laminación S.A.I.C.', 27.1, 1]], cliUSD.filter((x) => x.importe === 27.1).map((x) => [x.etiqueta, x.importe, x.documentos]))
    cmp('agrupa por customer_id y muestra el nombre comercial (o la razón social si está vacío)', true, cliUSD.every((x) => x.cliente_id && x.clave === `cliente:${x.cliente_id}`))
    const cliSin = await ver({ ...P0, moneda: 'SIN MONEDA' })
    cmp('SIN MONEDA es su propio ranking; nombre con fórmula tal cual en el dato', [['=HYPERLINK("http://x","clic")', 300]], cliSin.map((x) => [x.etiqueta, x.importe]))
    const cli12 = await ver({ ...P0, periodo: '12m' })
    const delta = cli12.find((x) => x.etiqueta === 'Delta dado de baja')
    cmp('cliente dado de baja: sigue en el histórico, activo = false', { importe: 0, activo: false }, delta && { importe: delta.importe - 40, activo: delta.activo })
    cmp('el último día del mes anterior no entra en el mes, sí en 12 meses', [false, true], [cliUSD.some((x) => x.etiqueta === 'Delta dado de baja'), !!delta])
    cmp('fuera de los 12 meses no entra (7777)', false, cli12.some((x) => x.importe >= 7777))
    cmp('borrador no entra (9999)', false, cli12.some((x) => x.importe >= 9999))

    const prodCot = await ver({ dimension: 'productos', fuente: 'cotizado', medida: 'importe', periodo: 'mes', moneda: 'USD' })
    const prodPor = (arr, k) => arr.find((x) => x.clave === k)
    cmp('importe de línea = cantidad × precio × (1 − dto) × (1 + IVA)', 12.1, prodPor(prodCot, `producto:${PA}`)?.importe)
    cmp('línea sin producto agrupada por SKU exacto; nombre = el menor snapshot', { documentos: 2, cantidad: 5, importe: 25, etiqueta: 'A-nombre menor', vinculado: false, activo: null }, (({ documentos, cantidad, importe, etiqueta, vinculado, activo }) => ({ documentos, cantidad, importe, etiqueta, vinculado, activo }))(prodPor(prodCot, 'sku:ZZ-SUELTO') ?? {}))
    cmp('«zz-suelto» en minúscula NO se fusiona con «ZZ-SUELTO»', 1, prodPor(prodCot, 'sku:zz-suelto')?.documentos)
    const prodPed = await ver({ dimension: 'productos', fuente: 'pedido', medida: 'importe', periodo: 'mes', moneda: 'USD' })
    cmp('descuento de cabecera también: 3 × 100 × 0,8 × 0,9 × 1,21 = 261,36', 261.36, prodPor(prodPed, `producto:${PA}`)?.importe)
    cmp('precio 0: importe 0, cantidad real, atípica', { importe: 0, cantidad: 2000, lineas_atipicas: 1, cantidad_atipica: 2000 }, (({ importe, cantidad, lineas_atipicas, cantidad_atipica }) => ({ importe, cantidad, lineas_atipicas, cantidad_atipica }))(prodPor(prodPed, `producto:${PG}`) ?? {}))
    const entCant = await ver({ dimension: 'productos', fuente: 'entregado', medida: 'cantidad', periodo: 'mes', moneda: null })
    cmp('entregado por cantidad: GRAMPA primero, atípica por el precio 0 del pedido; sin moneda ni importe', { posicion: 2, lineas_atipicas: 1, moneda: null, importe: null }, (({ posicion, lineas_atipicas, moneda, importe }) => ({ posicion, lineas_atipicas, moneda, importe }))(prodPor(entCant, `producto:${PG}`) ?? {}))
    cmp('3000 u. SIN precio conocido: cantidad real, NO atípica (sin precio ≠ precio 0)', { posicion: 1, cantidad: 3000, lineas_atipicas: 0 }, (({ posicion, cantidad, lineas_atipicas }) => ({ posicion, cantidad, lineas_atipicas }))(prodPor(entCant, 'sku:ZZ-SIN-PRECIO') ?? {}))
    cmp('remitos en borrador o cancelados no suman (99, 98)', false, entCant.some((x) => x.cantidad === 99 || x.cantidad === 98 || x.cantidad === 102 || x.cantidad === 101))
    const cant12 = await ver({ dimension: 'productos', fuente: 'pedido', medida: 'cantidad', periodo: '12m', moneda: null })
    const borrado = prodPor(cant12, `producto:${PX}`)
    cmp('producto borrado: sigue en el histórico con su nombre del catálogo (admin lo ve), activo = false', { etiqueta: 'Nombre actual oculto', codigo: 'ZZ3-BORRADO', activo: false, vinculado: true }, borrado && { etiqueta: borrado.etiqueta, codigo: borrado.codigo, activo: borrado.activo, vinculado: borrado.vinculado })
    const cot12 = await ver({ dimension: 'productos', fuente: 'cotizado', medida: 'importe', periodo: '12m', moneda: 'ARS' })
    cmp('producto discontinuado: sigue, activo = false', { activo: false, importe: 50 }, (({ activo, importe }) => ({ activo, importe }))(prodPor(cot12, `producto:${PD}`) ?? {}))
    cmp('cantidad no se mezcla con moneda: la cantidad por producto junta USD, ARS y SIN MONEDA', 5000 + 0, prodPor(await ver({ dimension: 'productos', fuente: 'cotizado', medida: 'cantidad', periodo: 'mes', moneda: null }), `producto:${PG}`)?.cantidad)

    // Top N y paginación
    const completo = await ver({ dimension: 'productos', fuente: 'cotizado', medida: 'cantidad', periodo: '12m', moneda: null })
    const top2 = (await rpc(admin, ZZ, { dimension: 'productos', fuente: 'cotizado', medida: 'cantidad', periodo: '12m', limite: 2 })).data.map(normalizar)
    cmp('Top N = las primeras N del ranking completo, con total_filas del completo', completo.slice(0, 2).map((x) => [x.clave, x.total_filas]), top2.map((x) => [x.clave, x.total_filas]))
    const paginas = []
    for (let off = 0; off < completo.length; off += 2) paginas.push(...(await rpc(admin, ZZ, { dimension: 'productos', fuente: 'cotizado', medida: 'cantidad', periodo: '12m', limite: 2, desplazamiento: off })).data.map(normalizar))
    cmp('páginas de a 2 concatenadas = ranking completo (orden estable)', completo.map((x) => x.clave), paginas.map((x) => x.clave))
    const fuera = (await rpc(admin, ZZ, { dimension: 'productos', fuente: 'cotizado', medida: 'cantidad', periodo: '12m', limite: 10, desplazamiento: 1000 })).data
    cmp('desplazamiento más allá del final: vacío, sin error', 0, fuera.length)

    seccion('6 · CSV con la biblioteca de la app, sobre filas reales')
    const pCsv = { dimension: 'clientes', fuente: 'cotizado', medida: 'importe', periodo: 'mes', moneda: 'SIN MONEDA' }
    const csvCli = csvLib.rankingACsv(pCsv, await rankingCompleto(admin, ZZ, pCsv))
    const lineasCli = csvCli.split('\r\n')
    cmp('cabecera de clientes', 'Posicion;Cliente ID;Cliente;Activo;Fuente;Desde;Hasta;Moneda;Importe;Documentos', lineasCli[0])
    cmp('fórmula neutralizada y comillas escapadas; SIN MONEDA escrito; importe con punto', `1;${CI};"'=HYPERLINK(""http://x"",""clic"")";si;cotizado;${dia(M, 1)};${hoyAR};SIN MONEDA;300.00;1`, lineasCli[1])
    const pProd = { dimension: 'productos', fuente: 'pedido', medida: 'importe', periodo: 'mes', moneda: 'USD' }
    const filasProd = await rankingCompleto(admin, ZZ, pProd)
    const csvProd = csvLib.rankingACsv(pProd, filasProd)
    cmp('filas = ranking completo + cabecera', filasProd.length + 1, csvProd.split('\r\n').length)
    cmp('acentos, comillas y «» intactos en el nombre', true, csvProd.includes('"Pinza «A» 4"" (100mm)"'))
    cmp('precio 0 exportado como 0.00 y cantidad real', true, csvProd.split('\r\n').some((l) => l.includes('ZZ3-GRAMPA') && l.includes(';USD;0.00;2000;') && l.endsWith(';1;2000')))
    const pCant = { dimension: 'productos', fuente: 'entregado', medida: 'cantidad', periodo: 'mes', moneda: null }
    const csvCant = csvLib.rankingACsv(pCant, await rankingCompleto(admin, ZZ, pCant))
    cmp('ranking por cantidad: Moneda «no aplica», Importe vacío', true, csvCant.split('\r\n').slice(1).every((l) => l.includes(';no aplica;;')))
    const bytes = new TextEncoder().encode(csvLib.contenidoConBom(csvProd))
    cmp('UTF-8 con BOM', [0xef, 0xbb, 0xbf], [...bytes.slice(0, 3)])
    cmp('ningún campo de texto empieza con =, +, - o @ sin protección', 0, [csvCli, csvProd, csvCant].flatMap((c) => c.split('\r\n').slice(1)).flatMap((l) => l.split(';')).filter((c) => /^[=+@]/.test(c) || /^-[^0-9]/.test(c)).length)
    cmp('nombre de archivo', 'informe-clientes-cotizado-SIN-MONEDA-mes-2026-09.csv', csvLib.nombreArchivo(['clientes', 'cotizado', 'SIN MONEDA', 'mes', '2026-09']))
  }

  seccion('7 · Buscatools real: paridad, GRAMPA y latencia')
  {
    const jano = await login('buscatools.jano@gmail.com', process.env.BT_PW_JANO)
    const bt = await leerEmpresa(BT)
    const combos = combinaciones(monedasDe(bt))
    let ok = 0
    const tiempos = []
    for (const p of combos) {
      const t0 = Date.now()
      const real = await rankingCompleto(jano, BT, p)
      tiempos.push(Date.now() - t0)
      if (compararRanking(`BT ${p.dimension}·${p.fuente}·${p.medida}·${p.periodo}·${p.moneda ?? '-'}`, esperado(bt, p, M), real, true)) ok++
    }
    ok === combos.length ? PASS('cada ranking completo = regla en JS sobre las filas crudas', `${combos.length} rankings (${monedasDe(bt).join(', ')})`) : FAIL('paridad Buscatools', `${ok} de ${combos.length}`)

    const ent12 = (await rankingCompleto(jano, BT, { dimension: 'productos', fuente: 'entregado', medida: 'cantidad', periodo: '12m', moneda: null })).map(normalizar)
    const g = ent12.find((x) => x.codigo === 'GRAMPA.80-4T')
    const gEsp = esperado(bt, { dimension: 'productos', fuente: 'entregado', medida: 'cantidad', periodo: '12m', moneda: null }, M).find((x) => x.codigo === 'GRAMPA.80-4T')
    cmp('GRAMPA.80-4T entregado 12 meses: aparece, no excluido, cantidad real = regla, marcado atípico', { ...gEsp && { cantidad: gEsp.cantidad, lineas_atipicas: gEsp.lineas_atipicas, cantidad_atipica: gEsp.cantidad_atipica }, marcado: true }, g && { cantidad: g.cantidad, lineas_atipicas: g.lineas_atipicas, cantidad_atipica: g.cantidad_atipica, marcado: (g.lineas_atipicas ?? 0) > 0 })
    INFO('GRAMPA entregado 12m', JSON.stringify(g && { posicion: g.posicion, cantidad: g.cantidad, lineas_atipicas: g.lineas_atipicas }))
    const ped12 = (await rankingCompleto(jano, BT, { dimension: 'productos', fuente: 'pedido', medida: 'importe', periodo: '12m', moneda: 'USD' })).map(normalizar)
    const gi = ped12.find((x) => x.codigo === 'GRAMPA.80-4T')
    // Las líneas atípicas aportan 0; el importe del producto sale de sus otras líneas con precio.
    const lineasG = bt.orderLines.filter((l) => l.sku_snapshot === 'GRAMPA.80-4T' && l.product_id && bt.orders.some((o) => o.id === l.order_id && o.commercial_status === 'confirmed' && (o.currency_code ?? 'SIN MONEDA') === 'USD' && o.order_date >= tramo(M, '12m')[0] && o.order_date <= hoyAR))
    const impAtipicas = lineasG.filter((l) => Number(l.quantity_ordered) >= 1000).reduce((a, l) => a + Number(l.quantity_ordered) * Number(l.unit_price), 0)
    const impResto = r4(lineasG.filter((l) => Number(l.quantity_ordered) < 1000).reduce((a, l) => a + Number(l.quantity_ordered) * Number(l.unit_price) * (1 - Number(l.discount_pct) / 100) * (1 + Number(l.tax_rate_snapshot) / 100), 0))
    const giEsp = esperado(bt, { dimension: 'productos', fuente: 'pedido', medida: 'importe', periodo: '12m', moneda: 'USD' }, M).find((x) => x.codigo === 'GRAMPA.80-4T')
    cmp('GRAMPA.80-4T por importe USD: NO se excluye; las líneas atípicas aportan 0; el importe es el de sus otras líneas; cantidad real', { atipicas_importe: 0, importe: impResto, cantidad: giEsp?.cantidad, lineas_atipicas: giEsp?.lineas_atipicas }, gi && { atipicas_importe: impAtipicas, importe: gi.importe, cantidad: gi.cantidad, lineas_atipicas: gi.lineas_atipicas })
    INFO('GRAMPA por importe USD', `puesto ${gi?.posicion} de ${gi?.total_filas}`)
    const atipicosBT = [...new Set(combos.length ? ent12.filter((x) => (x.lineas_atipicas ?? 0) > 0).map((x) => x.codigo) : [])]
    const hc = await historicosCongelados(s)
    if (hc.soloHistorico) cmp('la regla de atípico sólo marca GRAMPA en el histórico congelado', ['GRAMPA.80-4T'], atipicosBT)
    else cmp('GRAMPA sigue marcado entre los atípicos (entraron documentos nuevos)', true, atipicosBT.includes('GRAMPA.80-4T'))

    const top = async (p) => (await rpc(jano, BT, { ...p, limite: 5 })).data.map((x) => `${x.posicion}. ${x.etiqueta} ${x.importe ?? x.cantidad} (${x.documentos})`)
    INFO('top 5 clientes · entregado · 12m · USD', JSON.stringify(await top({ dimension: 'clientes', fuente: 'entregado', medida: 'importe', periodo: '12m', moneda: 'USD' })))
    INFO('top 5 clientes · entregado · 12m · ARS', JSON.stringify(await top({ dimension: 'clientes', fuente: 'entregado', medida: 'importe', periodo: '12m', moneda: 'ARS' })))
    INFO('top 5 productos · pedido · 12m · USD', JSON.stringify(await top({ dimension: 'productos', fuente: 'pedido', medida: 'importe', periodo: '12m', moneda: 'USD' })))
    INFO('top 5 productos · entregado · 12m · cantidad', JSON.stringify(await top({ dimension: 'productos', fuente: 'entregado', medida: 'cantidad', periodo: '12m', moneda: null })))
    const sinVinculo = ent12.filter((x) => !x.vinculado).length
    INFO('líneas sin producto en el ranking entregado 12m', `${sinVinculo} SKU sueltos de ${ent12.length} filas`)

    const lat = []
    for (let i = 0; i < 7; i++) { const t0 = Date.now(); await rpc(jano, BT, { dimension: 'productos', fuente: 'pedido', medida: 'importe', periodo: '12m', moneda: 'USD', limite: 10 }); lat.push(Date.now() - t0) }
    const o = lat.slice().sort((a, b) => a - b)
    const oc = tiempos.slice().sort((a, b) => a - b)
    INFO('latencia Top 10 productos · pedido · 12m (7 llamadas, con red)', `mediana ${o[3]} ms · máx ${o[6]} ms`)
    INFO('latencia ranking completo por combinación (paginado de a 500)', `mediana ${oc[Math.floor(oc.length / 2)]} ms · máx ${oc[oc.length - 1]} ms · ${combos.length} combinaciones`)
    o[3] < 1500 ? PASS('mediana < 1,5 s') : FAIL('lento', `${o[3]} ms`)
  }

  seccion('8 · Limpieza y base intacta')
  await barrer()
  cmp('sin empresas zz-inf3', 0, (await s.from('companies').select('id', { count: 'exact', head: true }).like('slug', `${MARCA}-%`)).count)
  const { data: us } = await s.auth.admin.listUsers({ perPage: 1000 })
  cmp('sin usuarios zz-inf3', 0, (us?.users ?? []).filter((u) => u.email?.startsWith(`${MARCA}-`)).length)
  const huellaDespues = await huella(BT)
  const hcFin = await historicosCongelados(s)
  cmp('histórico migrado congelado: 288 / 166 / 182 documentos con imported_at', [288, 166, 182], [hcFin.importados.sales_quotes, hcFin.importados.sales_orders, hcFin.importados.deliveries])
  INFO('filas vivas de Buscatools (pueden crecer)', JSON.stringify(Object.fromEntries(Object.entries(huellaDespues).map(([k, v]) => [k, v.n]))))
  cmp('histórico sin tocar: misma huella antes y después', huellaAntes, huellaDespues)

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
