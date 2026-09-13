/**
 * Fase 10 · Informes — entrega 2: `informe_pipeline_comercial`, contra la base real.
 *
 * Prueba, con JWT reales:
 *
 *   · sólo admin y employee: salesperson, technician, customer, distributor, un
 *     admin de otra empresa, anon y empresa nula no reciben nada;
 *   · cotizaciones abiertas: sent/accepted sin pedido CONFIRMADO; un pedido en
 *     borrador o cancelado no las cierra; rechazadas y vencidas no son abiertas;
 *   · conversión por quote_id: denominador = no borradores del tramo (incluye
 *     rechazadas y vencidas); «aceptada» sin pedido NO es convertida; moneda de
 *     la cotización; conversión con moneda distinta y desde borrador reportadas;
 *   · cumplimiento contra remitos confirmados, con la regla de Stage 2.5:
 *     completo, parcial, sin entrega, sobreentregado, no consta entrega,
 *     detalle no reconstruido, sin líneas; un remito en borrador no cuenta ni
 *     como entrega ni como remito suelto del cliente;
 *   · importe pendiente neto a precio del pedido, sólo con evidencia;
 *   · tramos: día 1 en su mes, mismo tramo de días, mes pasado, mes futuro;
 *   · paridad: para Buscatools, cada fila = cálculo en JS sobre las filas
 *     crudas de las tablas (no la función contra sí misma);
 *   · los seis pedidos de Stage 2.5 en su categoría;
 *   · el histórico no se toca (conteos + huella de id/total/estado/updated_at);
 *   · latencia.
 *
 * Fixtures en empresas zz-inf2-*; se borran al final.
 *
 *   set -a; source .env; source .env.migration; source .env.rls.txt; set +a
 *   node scripts/fase10-informes-entrega2-tests.mjs
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
const cmp = (t, esp, real) => (JSON.stringify(esp) === JSON.stringify(real) ? PASS(t, String(JSON.stringify(real)).slice(0, 110)) : FAIL(t, `esperaba ${JSON.stringify(esp)}, dio ${JSON.stringify(real)}`))

const s = createClient(BASE, SECRET, { auth: { persistSession: false } })
const MARCA = 'zz-inf2'
const r4 = (v) => (v === null || v === undefined ? null : Math.round(Number(v) * 10000) / 10000)

// ── fechas: «hoy» en Argentina, como el servidor ───────────────────────────
const hoyAR = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
const [HY, HM, HD] = hoyAR.split('-').map(Number)
const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10)
const ultimoDia = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const mesDesplazado = (k, base = { y: HY, m: HM }) => { const d = new Date(Date.UTC(base.y, base.m - 1 + k, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 } }
const M = mesDesplazado(0)
const M1 = mesDesplazado(-1)
const M2 = mesDesplazado(-2)
const M11 = mesDesplazado(-11)
const M12 = mesDesplazado(-12)
const dia = (x, d) => iso(x.y, x.m, Math.min(d, ultimoDia(x.y, x.m)))
const dias = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000)

const login = async (email, password) => {
  const c = createClient(BASE, PUB, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`login: ${error.message}`)
  return c
}
const creadosUsuarios = []
const usuario = async (companyId, rol, customerId = null) => {
  const email = `${MARCA}-${rol}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@buscatools.test`
  const password = `Zz${randomUUID()}!`
  const { data, error } = await s.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`crear ${rol}: ${error.message}`)
  creadosUsuarios.push(data.user.id)
  const fila = { company_id: companyId, user_id: data.user.id, role: rol, status: 'active' }
  if (customerId) fila.customer_id = customerId
  const { error: eM } = await s.from('company_memberships').insert(fila)
  if (eM) throw new Error(`membresía ${rol}: ${eM.message}`)
  return login(email, password)
}
const informe = (c, company, mes = null) => c.rpc('informe_pipeline_comercial', { p_company: company, p_mes: mes })

// ── la regla, en JS, independiente del SQL ─────────────────────────────────
function tramosDe(ref) {
  const esMesEnCurso = ref.y === M.y && ref.m === M.m
  const ini = dia(ref, 1)
  const hasta = esMesEnCurso ? hoyAR : dia(ref, 31)
  const ant = mesDesplazado(-1, ref)
  const antHasta = esMesEnCurso ? dia(ant, HD) : dia(ant, 31)
  return { actual: [ini, hasta], anterior: [dia(ant, 1), antHasta], '12m': [dia(mesDesplazado(-11, ref), 1), hasta] }
}

/** Categoría de cumplimiento de cada pedido confirmado (Stage 2.5). */
function clasificar(d) {
  const entConf = new Map(d.deliveries.filter((x) => x.status === 'shipped' || x.status === 'delivered').map((x) => [x.id, x]))
  const entregado = new Map()
  for (const l of d.deliveryLines) {
    if (!entConf.has(l.delivery_id) || l.order_line_id === null) continue
    entregado.set(l.order_line_id, (entregado.get(l.order_line_id) ?? 0) + Number(l.quantity))
  }
  const huerfanos = new Set([...entConf.values()].filter((x) => x.order_id === null).map((x) => x.customer_id))
  const conEntrega = new Set([...entConf.values()].filter((x) => x.order_id !== null).map((x) => x.order_id))
  const sinEnlazar = new Set(d.deliveryLines.filter((l) => l.order_line_id === null && entConf.get(l.delivery_id)?.order_id).map((l) => entConf.get(l.delivery_id).order_id))
  const lineasPor = new Map()
  for (const l of d.orderLines) if (l.line_type !== 'chapter') (lineasPor.get(l.order_id) ?? lineasPor.set(l.order_id, []).get(l.order_id)).push({ ...l, e: entregado.get(l.id) ?? 0 })
  return d.orders.filter((o) => o.commercial_status === 'confirmed').map((o) => {
    const ls = lineasPor.get(o.id) ?? []
    let cat
    if (!conEntrega.has(o.id) && huerfanos.has(o.customer_id)) cat = 'no_consta_entrega'
    else if (sinEnlazar.has(o.id)) cat = 'detalle_no_reconstruido'
    else if (ls.length === 0) cat = 'sin_lineas'
    else if (!ls.some((l) => l.e > 0)) cat = 'sin_entrega'
    else if (!ls.some((l) => l.e < Number(l.quantity_ordered)) && ls.some((l) => l.e > Number(l.quantity_ordered))) cat = 'sobreentregado'
    else if (!ls.some((l) => l.e < Number(l.quantity_ordered))) cat = 'completo'
    else cat = 'parcial'
    const pendiente = ls.reduce((sum, l) => sum + Math.max(Number(l.quantity_ordered) - l.e, 0) * Number(l.unit_price) * (1 - Number(l.discount_pct ?? 0) / 100), 0) * (1 - Number(o.discount_pct ?? 0) / 100)
    return { ...o, cat, pendiente }
  })
}

function esperado(d, ref) {
  const T = tramosDe(ref)
  const en = (f, t) => f >= T[t][0] && f <= T[t][1]
  const mon = (m) => m ?? 'SIN MONEDA'
  const out = {}
  const fila = (k, base) => (out[k] ??= base)
  const confPorCot = new Map()
  for (const o of d.orders) if (o.commercial_status === 'confirmed' && o.quote_id) (confPorCot.get(o.quote_id) ?? confPorCot.set(o.quote_id, []).get(o.quote_id)).push(o)
  const conv = (q) => confPorCot.has(q.id)

  for (const q of d.quotes) {
    if ((q.status === 'sent' || q.status === 'accepted') && !conv(q)) {
      const edad = dias(hoyAR, q.quote_date)
      const b = edad <= 30 ? 'hasta_30' : edad <= 90 ? '31_90' : 'mas_90'
      const f = fila(`cotizaciones_abiertas|hoy|${b}|${mon(q.currency_code)}`, { documentos: 0, importe: 0, convertidas: null, importe_convertido: null, abiertas: null, aceptadas: 0 })
      f.documentos++; f.importe = r4(f.importe + Number(q.total)); f.aceptadas += q.status === 'accepted' ? 1 : 0
    }
  }
  for (const t of ['actual', 'anterior', '12m']) {
    fila(`conversion|${t}||TODAS`, { documentos: 0, importe: null, convertidas: 0, importe_convertido: null, abiertas: 0, aceptadas: 0 })
    for (const q of d.quotes.filter((x) => x.status !== 'draft' && en(x.quote_date, t))) {
      const c = conv(q)
      for (const k of [mon(q.currency_code), 'TODAS']) {
        const f = fila(`conversion|${t}||${k}`, { documentos: 0, importe: 0, convertidas: 0, importe_convertido: 0, abiertas: 0, aceptadas: 0 })
        f.documentos++
        f.convertidas += c ? 1 : 0
        f.abiertas += !c && (q.status === 'sent' || q.status === 'accepted') ? 1 : 0
        f.aceptadas += q.status === 'accepted' ? 1 : 0
        if (k !== 'TODAS') { f.importe = r4(f.importe + Number(q.total)); f.importe_convertido = r4(f.importe_convertido + (c ? Number(q.total) : 0)) }
      }
    }
  }
  const nulos = { importe: null, convertidas: null, importe_convertido: null, abiertas: null, aceptadas: null }
  out['inconsistencias|todos|moneda_distinta|'] = { documentos: d.quotes.filter((q) => conv(q) && confPorCot.get(q.id).some((o) => mon(o.currency_code) !== mon(q.currency_code))).length, ...nulos }
  out['inconsistencias|todos|convertida_desde_borrador|'] = { documentos: d.quotes.filter((q) => conv(q) && q.status === 'draft').length, ...nulos }

  const clas = clasificar(d)
  for (const o of clas) {
    for (const t of ['actual', 'anterior', '12m', 'todos']) {
      if (t !== 'todos' && !en(o.order_date, t)) continue
      fila(`cumplimiento|${t}|${o.cat}|`, { documentos: 0, ...nulos }).documentos++
    }
    if (o.cat === 'sin_entrega' || o.cat === 'parcial') {
      const f = fila(`pedidos_pendientes|todos|${o.cat}|${mon(o.currency_code)}`, { documentos: 0, importe: 0, convertidas: null, importe_convertido: null, abiertas: null, aceptadas: null })
      f.documentos++; f.importe += o.pendiente
    }
  }
  for (const [k, f] of Object.entries(out)) if (k.startsWith('pedidos_pendientes')) f.importe = r4(f.importe)
  return { filas: out, tramos: T, clas }
}

const aMapa = (filas) => Object.fromEntries(filas.filter((r) => !r.seccion.startsWith('rango_')).map((r) => [
  `${r.seccion}|${r.periodo}|${r.categoria ?? ''}|${r.moneda ?? ''}`,
  { documentos: Number(r.documentos), importe: r4(r.importe), convertidas: r.convertidas === null ? null : Number(r.convertidas), importe_convertido: r4(r.importe_convertido), abiertas: r.abiertas === null ? null : Number(r.abiertas), aceptadas: r.aceptadas === null ? null : Number(r.aceptadas) },
]))
const iguales = (a, b) => a && b && Object.keys(a).every((k) => (a[k] === null || b[k] === null ? a[k] === b[k] : Math.abs(a[k] - b[k]) < 0.00011))
function compararMapas(t, esp, real) {
  const claves = [...new Set([...Object.keys(esp), ...Object.keys(real)])].sort()
  const distintas = claves.filter((k) => !iguales(esp[k], real[k]))
  distintas.length === 0 ? PASS(t, `${claves.length} filas`) : FAIL(t, JSON.stringify(distintas.slice(0, 6).map((k) => [k, esp[k] ?? null, real[k] ?? null])))
}

const barrer = async () => {
  const { data: emp } = await s.from('companies').select('id').like('slug', `${MARCA}-%`)
  const ids = (emp ?? []).map((x) => x.id)
  if (ids.length) {
    for (const t of ['delivery_lines', 'deliveries', 'sales_order_lines', 'sales_orders', 'sales_quote_lines', 'sales_quotes', 'sales_audit', 'stock_reservations', 'stock_movements']) await s.from(t).delete().in('company_id', ids)
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

/** Filas crudas de una empresa, paginadas. */
async function leerTodo(tabla, columnas, company) {
  const filas = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await s.from(tabla).select(columnas).eq('company_id', company).order('id').range(desde, desde + 999)
    if (error) throw new Error(`${tabla}: ${error.message}`)
    filas.push(...data)
    if (data.length < 1000) return filas
  }
}
const leerEmpresa = async (company) => ({
  quotes: await leerTodo('sales_quotes', 'id, quote_date, status, currency_code, total', company),
  orders: await leerTodo('sales_orders', 'id, original_number, quote_id, order_date, commercial_status, fulfillment_status, currency_code, customer_id, discount_pct, total', company),
  orderLines: await leerTodo('sales_order_lines', 'id, order_id, quantity_ordered, unit_price, discount_pct, line_type', company),
  deliveries: await leerTodo('deliveries', 'id, order_id, customer_id, status', company),
  deliveryLines: await leerTodo('delivery_lines', 'id, delivery_id, order_line_id, quantity', company),
})

/** Huella del histórico: conteos y hash de id/total/estado/updated_at. */
async function huella(company) {
  const h = {}
  for (const [t, cols] of [['sales_quotes', 'id, total, status, updated_at'], ['sales_orders', 'id, total, commercial_status, fulfillment_status, updated_at'], ['deliveries', 'id, total, status, updated_at'], ['sales_order_lines', 'id, quantity_ordered, unit_price'], ['delivery_lines', 'id, quantity, order_line_id']]) {
    const filas = await leerTodo(t, cols, company)
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
  const empresa = async (suf) => {
    const { data, error } = await s.from('companies').insert({ slug: `${MARCA}-${suf}-${Date.now()}`, name: `ZZ-INF2 ${suf}`, default_currency: 'ARS' }).select('id').single()
    if (error) throw new Error(error.message)
    return data.id
  }
  const ZZ = await empresa('propia')
  const ZZ2 = await empresa('ajena')
  let { data: dep } = await s.from('warehouses').select('id').eq('company_id', ZZ).limit(1).maybeSingle()
  if (!dep) dep = (await s.from('warehouses').insert({ company_id: ZZ, code: 'ZZ', name: 'ZZ-INF2' }).select('id').single()).data
  const cliente = async (company, nombre) => (await s.from('customers').insert({ company_id: company, legal_name: nombre }).select('id').single()).data.id
  const C1 = await cliente(ZZ, 'ZZ-INF2 con remito suelto')
  const C2 = await cliente(ZZ, 'ZZ-INF2 limpio')
  const C3 = await cliente(ZZ, 'ZZ-INF2 con remito suelto en borrador')
  const CA = await cliente(ZZ2, 'ZZ-INF2 ajeno')

  let n = 0
  const num = (p) => `${MARCA}-${p}-${++n}-${Date.now()}`
  const ins = async (tabla, fila) => {
    const r = await s.from(tabla).insert(fila).select('id').single()
    if (r.error) throw new Error(`${tabla}: ${r.error.message}`)
    return r.data.id
  }
  const cot = (fecha, status, moneda, total, company = ZZ, cli = C2) => ins('sales_quotes', { company_id: company, number: num('cot'), customer_id: cli, quote_date: fecha, status, currency_code: moneda, total })
  const ped = (fecha, status, moneda, cli, quoteId = null, dto = null, company = ZZ) => ins('sales_orders', { company_id: company, number: num('ped'), customer_id: cli, order_date: fecha, commercial_status: status, currency_code: moneda, quote_id: quoteId, discount_pct: dto })
  let lineNo = 0
  const lin = (orderId, q, precio, dto = 0) => ins('sales_order_lines', { company_id: ZZ, order_id: orderId, line_no: ++lineNo, quantity_ordered: q, unit_price: precio, discount_pct: dto })
  const rem = (fecha, status, cli, orderId = null) => ins('deliveries', { company_id: ZZ, number: num('rem'), customer_id: cli, delivery_date: fecha, status, order_id: orderId })
  const remLin = (deliveryId, orderLineId, q) => ins('delivery_lines', { company_id: ZZ, delivery_id: deliveryId, order_line_id: orderLineId, quantity: q, warehouse_id: dep.id })

  // Cotizaciones
  const q1 = await cot(dia(M, 1), 'sent', 'USD', 100)          // → pedido confirmado: convertida (día 1 en su mes)
  await cot(dia(M, 1), 'accepted', 'USD', 200)                  // aceptada SIN pedido: abierta, no convertida
  const q3 = await cot(hoyAR, 'sent', 'ARS', 300)               // → pedido en USD: convertida con moneda distinta
  await cot(dia(M, 1), 'rejected', 'USD', 50)                   // en el denominador, no abierta
  await cot(dia(M1, 1), 'expired', 'USD', 60)                   // denominador del tramo anterior
  const q6 = await cot(dia(M, 1), 'draft', 'USD', 999)          // borrador con pedido: fuera del denominador, inconsistencia
  await cot(dia(M2, 15), 'sent', null, 70)                      // SIN MONEDA, abierta
  const q8 = await cot(dia(M, 1), 'sent', 'USD', 80)            // pedido en borrador: sigue abierta
  const q9 = await cot(dia(M, 1), 'sent', 'USD', 90)            // pedido cancelado: sigue abierta
  await cot(dia(M12, ultimoDia(M12.y, M12.m)), 'sent', 'USD', 5) // fuera de los 12 meses, pero abierta hoy
  await cot(dia(M11, 1), 'sent', 'EUR', 11)                     // primer mes de los 12
  const hayFueraDeTramo = HD + 1 <= ultimoDia(M1.y, M1.m)
  if (hayFueraDeTramo) await cot(dia(M1, HD + 1), 'sent', 'USD', 7) // mes anterior, fuera del mismo tramo de días
  await cot(hoyAR, 'sent', 'USD', 777, ZZ2, CA)                 // empresa ajena

  // Pedidos, líneas y remitos. Las líneas van ANTES de los remitos: después el trigger las bloquea.
  const o1 = await ped(dia(M, 1), 'confirmed', 'USD', C2, q1, 10) // parcial, con descuento de cabecera
  const o1a = await lin(o1, 2, 10)
  const o1b = await lin(o1, 3, 20, 50)
  const o3 = await ped(hoyAR, 'confirmed', 'USD', C2, q3)          // completo
  const o3a = await lin(o3, 1, 7)
  const o6 = await ped(dia(M, 1), 'confirmed', 'USD', C2, q6)      // sin entrega (cliente limpio)
  await lin(o6, 1, 5)
  await ped(dia(M, 1), 'draft', 'USD', C2, q8)
  await ped(dia(M, 1), 'cancelled', 'USD', C2, q9)
  const oA = await ped(dia(M, 1), 'confirmed', 'USD', C1)          // no consta entrega (C1 tiene remito suelto)
  await lin(oA, 4, 3)
  const oB = await ped(dia(M, 1), 'confirmed', null, C2)           // detalle no reconstruido
  const oBa = await lin(oB, 1, 9)
  const oC = await ped(dia(M, 1), 'confirmed', 'ARS', C2)          // sobreentregado
  const oCa = await lin(oC, 1, 100)
  const oD = await ped(dia(M, 1), 'confirmed', 'USD', C2)          // remito en borrador: no cuenta → sin entrega
  const oDa = await lin(oD, 5, 2)
  const oE = await ped(dia(M11, 1), 'confirmed', 'USD', C3)        // C3 sólo tiene un remito suelto en BORRADOR → sin entrega
  await lin(oE, 1, 4)
  const oF = await ped(dia(M1, 1), 'confirmed', 'USD', C2)         // completo, tramo anterior
  const oFa = await lin(oF, 2, 1)
  await ped(dia(M, 1), 'confirmed', 'USD', C2)                     // sin líneas
  await ped(hoyAR, 'confirmed', 'USD', CA, null, null, ZZ2)        // empresa ajena

  const d1 = await rem(dia(M, 1), 'shipped', C2, o1); await remLin(d1, o1a, 2); await remLin(d1, o1b, 1)
  const d3 = await rem(hoyAR, 'delivered', C2, o3); await remLin(d3, o3a, 1)
  const dB = await rem(dia(M, 1), 'shipped', C2, oB); await remLin(dB, oBa, 1); await remLin(dB, null, 1)
  // Sobreentrega: el trigger impide entregar de más en remitos nuevos no cancelados.
  // Se carga en un remito cancelado, otro despachado, y después se reactiva el primero.
  const dC1 = await rem(dia(M, 1), 'cancelled', C2, oC); await remLin(dC1, oCa, 1)
  const dC2 = await rem(dia(M, 1), 'shipped', C2, oC); await remLin(dC2, oCa, 1)
  { const { error } = await s.from('deliveries').update({ status: 'shipped' }).eq('id', dC1); if (error) throw new Error(`reactivar: ${error.message}`) }
  const dD = await rem(dia(M, 1), 'draft', C2, oD); await remLin(dD, oDa, 5)
  const dF = await rem(dia(M1, 1), 'delivered', C2, oF); await remLin(dF, oFa, 2)
  await rem(dia(M1, 1), 'delivered', C1)   // remito suelto confirmado de C1
  await rem(dia(M, 1), 'draft', C3)        // remito suelto en BORRADOR de C3
  await rem(dia(M, 1), 'cancelled', C2)    // remito suelto cancelado de C2: no convierte a C2 en dudoso

  const admin = await usuario(ZZ, 'admin')
  const empleado = await usuario(ZZ, 'employee')
  const vendedor = await usuario(ZZ, 'salesperson')
  const tecnico = await usuario(ZZ, 'technician')
  const clienteU = await usuario(ZZ, 'customer', C2)
  const distrib = await usuario(ZZ, 'distributor', C2)
  const adminAjeno = await usuario(ZZ2, 'admin')
  const anon = createClient(BASE, PUB, { auth: { persistSession: false } })
  PASS('fixtures', '2 empresas · 4 clientes · cotizaciones, pedidos y remitos de cada caso · 7 identidades')

  seccion('2 · Quién puede')
  for (const [nombre, c] of [['ADMIN', admin], ['EMPLOYEE', empleado]]) {
    const r = await informe(c, ZZ)
    r.error ? FAIL(`${nombre} lee el informe`, r.error.message) : PASS(`${nombre} lee el informe`, `${r.data.length} filas`)
  }
  for (const [nombre, c] of [['SALESPERSON', vendedor], ['TECHNICIAN', tecnico], ['CUSTOMER', clienteU], ['DISTRIBUTOR', distrib], ['ADMIN de otra empresa', adminAjeno]]) {
    const r = await informe(c, ZZ)
    r.error && /sin_permiso/.test(r.error.message) ? PASS(`${nombre} no puede`, r.error.message) : FAIL(`${nombre} no puede`, r.error?.message ?? `devolvió ${r.data?.length} filas`)
  }
  {
    const r2 = await informe(anon, ZZ)
    r2.error ? PASS('ANON no puede ejecutar', r2.error.code ?? r2.error.message) : FAIL('ANON ejecutó')
    const r3 = await informe(admin, null)
    r3.error ? PASS('empresa nula: rechazada', r3.error.message) : FAIL('empresa nula aceptada')
    const r4b = await informe(adminAjeno, ZZ2)
    const ajenas = (r4b.data ?? []).filter((x) => x.seccion === 'cotizaciones_abiertas')
    cmp('el admin ajeno ve SU empresa, sin datos de ésta', [{ moneda: 'USD', documentos: 1, importe: 777 }], ajenas.map((x) => ({ moneda: x.moneda, documentos: Number(x.documentos), importe: Number(x.importe) })))
  }

  const zz = await leerEmpresa(ZZ)

  seccion('3 · Mes en curso: cada fila contra la regla')
  const r = await informe(admin, ZZ)
  if (r.error) throw new Error(r.error.message)
  const esp = esperado(zz, M)
  const real = aMapa(r.data)
  compararMapas('todas las filas coinciden con la regla en JS (sección · período · categoría · moneda)', esp.filas, real)
  const rango = Object.fromEntries(r.data.filter((x) => x.seccion.startsWith('rango_')).map((x) => [x.seccion, [x.desde, x.hasta]]))
  cmp('tramos: actual, mismo tramo de días del anterior, 12 meses', [esp.tramos.actual, esp.tramos.anterior, esp.tramos['12m']], [rango.rango_actual, rango.rango_anterior, rango.rango_12m])

  const conv = (t, m) => real[`conversion|${t}||${m}`]
  cmp('conversión: la del día 1 cuenta en su mes; aceptada sin pedido NO convierte; borrador fuera', { elegibles: 5, convertidas: 1 }, { elegibles: conv('actual', 'USD')?.documentos, convertidas: conv('actual', 'USD')?.convertidas })
  cmp('conversión: rechazada en el denominador, no abierta; pedido borrador/cancelado dejan abierta', 3, conv('actual', 'USD')?.abiertas)
  cmp('conversión con moneda distinta: cuenta en la moneda de la cotización (ARS)', { documentos: 1, convertidas: 1, importe_convertido: 300 }, { documentos: conv('actual', 'ARS')?.documentos, convertidas: conv('actual', 'ARS')?.convertidas, importe_convertido: conv('actual', 'ARS')?.importe_convertido })
  cmp('inconsistencias reportadas, no escondidas', [1, 1], [real['inconsistencias|todos|moneda_distinta|']?.documentos, real['inconsistencias|todos|convertida_desde_borrador|']?.documentos])
  cmp('vencida del mes anterior en el denominador del tramo anterior', { documentos: 1, convertidas: 0, abiertas: 0 }, (({ documentos, convertidas, abiertas }) => ({ documentos, convertidas, abiertas }))(conv('anterior', 'USD') ?? {}))
  cmp('fuera de los 12 meses: no está en la conversión, sí en abiertas (más de 90 días)', true, (conv('12m', 'USD')?.documentos ?? 0) === (hayFueraDeTramo ? 7 : 6) && (real['cotizaciones_abiertas|hoy|mas_90|USD']?.documentos ?? 0) >= 1)
  cmp('abiertas: la aceptada sin pedido se cuenta como aceptada', 1, Object.entries(real).filter(([k]) => k.startsWith('cotizaciones_abiertas|')).reduce((sum, [, v]) => sum + v.aceptadas, 0))
  cmp('la empresa ajena no aparece', 0, r.data.filter((x) => Number(x.importe) === 777).length)

  const catDe = (id) => esp.clas.find((o) => o.id === id)?.cat
  cmp('categorías por pedido (regla JS)', ['parcial', 'completo', 'sin_entrega', 'no_consta_entrega', 'detalle_no_reconstruido', 'sobreentregado', 'sin_entrega', 'sin_entrega', 'completo'], [o1, o3, o6, oA, oB, oC, oD, oE, oF].map(catDe))
  const cum = (t, c) => real[`cumplimiento|${t}|${c}|`]?.documentos ?? 0
  cmp('cumplimiento hoy (todos): cada categoría', { completo: 2, parcial: 1, sin_entrega: 3, sobreentregado: 1, no_consta_entrega: 1, detalle_no_reconstruido: 1, sin_lineas: 1 },
    Object.fromEntries(['completo', 'parcial', 'sin_entrega', 'sobreentregado', 'no_consta_entrega', 'detalle_no_reconstruido', 'sin_lineas'].map((c) => [c, cum('todos', c)])))
  cmp('un remito en BORRADOR no es entrega (oD sin entrega) ni remito suelto (oE sin entrega)', ['sin_entrega', 'sin_entrega'], [catDe(oD), catDe(oE)])
  cmp('no consta entrega NO suma importe pendiente', undefined, Object.keys(real).find((k) => k.startsWith('pedidos_pendientes|todos|no_consta_entrega')))
  // o1: (3−1) × 20 × (1 − 50 %) × (1 − 10 %) = 18 · o6: 5 · oD: 10 · oE: 4 (USD, sin entrega)
  cmp('pendiente neto USD: parcial 18 (dto línea y cabecera) · sin entrega 5 + 10 + 4', [18, 19], [real['pedidos_pendientes|todos|parcial|USD']?.importe, real['pedidos_pendientes|todos|sin_entrega|USD']?.importe])
  cmp('cohorte del tramo anterior: el completo del mes pasado', 1, cum('anterior', 'completo'))

  seccion('4 · Mes pasado y mes futuro')
  {
    const rp = await informe(empleado, ZZ, dia(M1, 17))
    if (rp.error) FAIL('mes pasado', rp.error.message)
    else {
      const ep = esperado(zz, M1)
      compararMapas('mes pasado: filas exactas (tramos completos)', ep.filas, aMapa(rp.data))
      const rg = Object.fromEntries(rp.data.filter((x) => x.seccion.startsWith('rango_')).map((x) => [x.seccion, [x.desde, x.hasta]]))
      cmp('mes pasado: tramos', [ep.tramos.actual, ep.tramos.anterior, ep.tramos['12m']], [rg.rango_actual, rg.rango_anterior, rg.rango_12m])
    }
    const rf = await informe(admin, ZZ, dia(mesDesplazado(1), 1))
    rf.error && /mes_futuro/.test(rf.error.message) ? PASS('mes futuro: rechazado', rf.error.message) : FAIL('mes futuro aceptado')
  }

  seccion('5 · Paridad con la base: Buscatools real')
  {
    const jano = await login('buscatools.jano@gmail.com', process.env.BT_PW_JANO)
    const tiempos = []
    let rb
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now()
      rb = await informe(jano, BT)
      tiempos.push(Date.now() - t0)
      if (rb.error) break
    }
    if (rb.error) FAIL('Buscatools', rb.error.message)
    else {
      const bt = await leerEmpresa(BT)
      const eb = esperado(bt, M)
      const rbm = aMapa(rb.data)
      compararMapas('cada fila del informe = cálculo en JS sobre las filas crudas de las tablas', eb.filas, rbm)
      const rbp = await informe(jano, BT, dia(M1, 1))
      compararMapas('ídem, mes anterior', esperado(bt, M1).filas, aMapa(rbp.data ?? []))

      const porNumero = Object.fromEntries(eb.clas.map((o) => [o.original_number, o.cat]))
      for (const [numero, cat, nota] of [
        ['PDV01151', 'completo', 'uno de los 126 reconstruidos'],
        ['PDV01264', 'sin_entrega', 'sin entrega y sin remito suelto'],
        ['PDV01193', 'no_consta_entrega', 'uno de los 21 dudosos'],
        ['PDV01182', 'detalle_no_reconstruido', 'uno de los 14'],
        ['PDV01181', 'sobreentregado', 'pidió 1, entregó 2'],
        ['PDV01238', 'sobreentregado', 'pidió 4, entregó 7'],
      ]) cmp(`Stage 2.5 · ${numero} (${nota})`, cat, porNumero[numero])

      const cumTodos = Object.fromEntries(['completo', 'parcial', 'sin_entrega', 'sobreentregado', 'no_consta_entrega', 'detalle_no_reconstruido', 'sin_lineas'].map((c) => [c, rbm[`cumplimiento|todos|${c}|`]?.documentos ?? 0]))
      INFO('cumplimiento de los 166 pedidos (RPC)', JSON.stringify(cumTodos))
      cmp('reconstruidos = 126 de Stage 2.5 (completo + parcial + sobreentregado + los 5 sin entrega = 131 con evidencia)', [126, 5, 21, 14], [cumTodos.completo + cumTodos.parcial + cumTodos.sobreentregado, cumTodos.sin_entrega, cumTodos.no_consta_entrega, cumTodos.detalle_no_reconstruido])
      const c12 = rbm['conversion|12m||TODAS']
      INFO('conversión 12 meses (RPC)', JSON.stringify(c12))
      INFO('inconsistencias (RPC)', JSON.stringify({ moneda_distinta: rbm['inconsistencias|todos|moneda_distinta|']?.documentos, desde_borrador: rbm['inconsistencias|todos|convertida_desde_borrador|']?.documentos }))
      INFO('pendiente neto (RPC)', JSON.stringify(Object.entries(rbm).filter(([k]) => k.startsWith('pedidos_pendientes')).map(([k, v]) => [k.split('|').slice(2).join(' '), v.documentos, v.importe])))
      const conFecha = eb.clas.filter((o) => o.cat === 'parcial')
      INFO('parciales con fulfillment_status del histórico', JSON.stringify(Object.entries(conFecha.reduce((a, o) => { a[o.fulfillment_status ?? '—'] = (a[o.fulfillment_status ?? '—'] ?? 0) + 1; return a }, {}))))
      const ordenados = tiempos.slice().sort((a, b) => a - b)
      INFO('latencia del RPC (5 llamadas, incluye red)', `mediana ${ordenados[2]} ms · máx ${ordenados[4]} ms · filas ${rb.data.length} · ${JSON.stringify(rb.data).length} B`)
      ordenados[2] < 1500 ? PASS('mediana < 1,5 s') : FAIL('lento', `${ordenados[2]} ms`)
    }
  }

  seccion('6 · Limpieza y base intacta')
  await barrer()
  const quedan = (await s.from('companies').select('id', { count: 'exact', head: true }).like('slug', `${MARCA}-%`)).count
  cmp('sin empresas zz-inf2', 0, quedan)
  const { data: us } = await s.auth.admin.listUsers({ perPage: 1000 })
  cmp('sin usuarios zz-inf2', 0, (us?.users ?? []).filter((u) => u.email?.startsWith(`${MARCA}-`)).length)
  const huellaDespues = await huella(BT)
  cmp('Buscatools: 288 cotizaciones · 166 pedidos · 182 remitos · 593 y 600 líneas', [288, 166, 182, 593, 600], [huellaDespues.sales_quotes.n, huellaDespues.sales_orders.n, huellaDespues.deliveries.n, huellaDespues.sales_order_lines.n, huellaDespues.delivery_lines.n])
  cmp('histórico sin tocar: misma huella antes y después (id, total, estados, updated_at)', huellaAntes, huellaDespues)

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
