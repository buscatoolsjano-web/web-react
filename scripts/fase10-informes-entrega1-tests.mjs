/**
 * Fase 10 · Informes — entrega 1: `informe_actividad_comercial`, contra la base real.
 *
 * Prueba, con JWT reales:
 *
 *   · sólo admin y employee: salesperson, technician, customer, distributor, un
 *     admin de otra empresa y anon no reciben nada;
 *   · qué entra: cotizaciones emitidas (no borrador), pedidos confirmados,
 *     entregas despachadas o entregadas (no borrador ni cancelada);
 *   · monedas separadas, SIN MONEDA aparte, nada convertido;
 *   · el mes por la FECHA DEL DOCUMENTO: el día 1 cae en su mes (el bug del legacy);
 *   · tramo actual (1 → hoy) contra el MISMO tramo del mes anterior;
 *   · serie de 12 meses exacta, mes pasado completo, mes futuro rechazado;
 *   · paridad con la base: para Buscatools, cada fila coincide con una suma
 *     directa sobre las tablas;
 *   · latencia.
 *
 * Las expectativas se calculan en JS con las mismas reglas, independientemente
 * del SQL. Fixtures en una empresa zz-inf1-*; se borran al final.
 *
 *   set -a; source .env; source .env.migration; source .env.rls.txt; set +a
 *   node scripts/fase10-informes-entrega1-tests.mjs
 *
 * NO correrla en paralelo con otra suite de base.
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET || !process.env.BT_PW_JANO) { console.error('✗ Faltan variables'); process.exit(1) }

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(72)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const INFO = (t, d = '') => console.log(`    INFO  ${t}${d ? ' — ' + d : ''}`)
const ordenado = (a, b) => { const ks = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].sort(); return [Object.fromEntries(ks.map((k) => [k, a?.[k]])), Object.fromEntries(ks.map((k) => [k, b?.[k]]))] }
const cmp = (t, esp, real) => (JSON.stringify(esp) === JSON.stringify(real) ? PASS(t, String(JSON.stringify(real)).slice(0, 110)) : FAIL(t, `esperaba ${JSON.stringify(esp)}, dio ${JSON.stringify(real)}`))

const s = createClient(BASE, SECRET, { auth: { persistSession: false } })
const MARCA = 'zz-inf1'
const creados = { usuarios: [], empresas: [], clientes: [], cot: [], ped: [], ent: [] }

// ── fechas: «hoy» en Argentina, como el servidor ───────────────────────────
const hoyAR = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
const [HY, HM, HD] = hoyAR.split('-').map(Number)
const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10)
const ultimoDia = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const mesDesplazado = (k) => { const d = new Date(Date.UTC(HY, HM - 1 + k, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 } }
const M = mesDesplazado(0)
const M1 = mesDesplazado(-1)
const M2 = mesDesplazado(-2)
const M11 = mesDesplazado(-11)
const M12 = mesDesplazado(-12)
const primero = (x) => iso(x.y, x.m, 1)

const login = async (email, password) => {
  const c = createClient(BASE, PUB, { auth: { persistSession: false } })
  const { data, error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`login: ${error.message}`)
  return c
}
const usuario = async (companyId, rol, customerId = null) => {
  const email = `${MARCA}-${rol}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@buscatools.test`
  const password = `Zz${randomUUID()}!`
  const { data, error } = await s.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`crear ${rol}: ${error.message}`)
  creados.usuarios.push(data.user.id)
  const fila = { company_id: companyId, user_id: data.user.id, role: rol, status: 'active' }
  if (customerId) fila.customer_id = customerId
  const { error: eM } = await s.from('company_memberships').insert(fila)
  if (eM) throw new Error(`membresía ${rol}: ${eM.message}`)
  return login(email, password)
}
const informe = (c, company, mes = null) => c.rpc('informe_actividad_comercial', { p_company: company, p_mes: mes })

// Normaliza las filas del RPC a un mapa comparable.
const clave = (r) => `${r.periodo}|${r.tipo}|${r.mes}|${r.moneda}`
const aMapa = (filas) => Object.fromEntries(filas.filter((r) => r.periodo !== 'rango_actual' && r.periodo !== 'rango_anterior')
  .map((r) => [clave(r), { documentos: Number(r.documentos), importe: Math.round(Number(r.importe) * 10000) / 10000, en_revision: Number(r.en_revision) }]))

// La regla, en JS, independiente del SQL.
function esperado(docs, mesRef) {
  const esMesEnCurso = mesRef.y === M.y && mesRef.m === M.m
  const mesIni = primero(mesRef)
  const actHasta = esMesEnCurso ? hoyAR : iso(mesRef.y, mesRef.m, ultimoDia(mesRef.y, mesRef.m))
  const ant = (() => { const d = new Date(Date.UTC(mesRef.y, mesRef.m - 2, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 } })()
  const antIni = primero(ant)
  const antHasta = esMesEnCurso ? iso(ant.y, ant.m, Math.min(HD, ultimoDia(ant.y, ant.m))) : iso(ant.y, ant.m, ultimoDia(ant.y, ant.m))
  const serieIni = (() => { const d = new Date(Date.UTC(mesRef.y, mesRef.m - 12, 1)); return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) })()
  const incluido = (d) =>
    (d.tipo === 'cotizaciones' && d.estado !== 'draft') ||
    (d.tipo === 'pedidos' && d.estado === 'confirmed') ||
    (d.tipo === 'entregas' && (d.estado === 'shipped' || d.estado === 'delivered'))
  const out = {}
  const sumar = (k, d) => {
    out[k] ??= { documentos: 0, importe: 0, en_revision: 0 }
    out[k].documentos++
    out[k].importe = Math.round((out[k].importe + d.total) * 10000) / 10000
    out[k].en_revision += d.revision ? 1 : 0
  }
  for (const d of docs.filter(incluido)) {
    if (d.fecha < serieIni || d.fecha > actHasta) continue
    const moneda = d.moneda ?? 'SIN MONEDA'
    sumar(`mes|${d.tipo}|${d.fecha.slice(0, 8)}01|${moneda}`, d)
    if (d.fecha >= mesIni && d.fecha <= actHasta) sumar(`actual|${d.tipo}|${mesIni}|${moneda}`, d)
    if (d.fecha >= antIni && d.fecha <= antHasta) sumar(`anterior|${d.tipo}|${antIni}|${moneda}`, d)
  }
  return { filas: out, rango: { actual: [mesIni, actHasta], anterior: [antIni, antHasta] } }
}

const barrer = async () => {
  const { data: emp } = await s.from('companies').select('id').like('slug', `${MARCA}-%`)
  const ids = (emp ?? []).map((x) => x.id)
  if (ids.length) {
    for (const t of ['delivery_lines', 'deliveries', 'sales_order_lines', 'sales_orders', 'sales_quote_lines', 'sales_quotes', 'sales_audit']) await s.from(t).delete().in('company_id', ids)
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

const main = async () => {
  await barrer()
  INFO('hoy en Argentina', hoyAR)

  seccion('1 · Fixtures')
  const empresa = async (suf) => {
    const { data, error } = await s.from('companies').insert({ slug: `${MARCA}-${suf}-${Date.now()}`, name: `ZZ-INF1 ${suf}`, default_currency: 'ARS' }).select('id').single()
    if (error) throw new Error(error.message)
    creados.empresas.push(data.id)
    return data.id
  }
  const ZZ = await empresa('propia')
  const ZZ2 = await empresa('ajena')
  const { data: cli, error: eCli } = await s.from('customers').insert({ company_id: ZZ, legal_name: 'ZZ-INF1 Cliente SA' }).select('id').single()
  if (eCli) throw new Error(eCli.message)
  const { data: cli2 } = await s.from('customers').insert({ company_id: ZZ2, legal_name: 'ZZ-INF1 Ajeno SA' }).select('id').single()

  // Documentos con fechas relativas a hoy. `total` va directo: los triggers de
  // totales sólo recalculan en UPDATE o al tocar líneas.
  const dia = (x, d) => iso(x.y, x.m, Math.min(d, ultimoDia(x.y, x.m)))
  const docs = [
    { tipo: 'cotizaciones', fecha: dia(M, 1), moneda: 'USD', total: 100, estado: 'sent' },
    { tipo: 'cotizaciones', fecha: hoyAR, moneda: 'ARS', total: 5000.5, estado: 'accepted' },
    { tipo: 'cotizaciones', fecha: dia(M, 1), moneda: null, total: 300, estado: 'sent', revision: true },
    { tipo: 'cotizaciones', fecha: dia(M, 1), moneda: 'EUR', total: 20, estado: 'expired' },
    { tipo: 'cotizaciones', fecha: dia(M, 1), moneda: 'USD', total: 999, estado: 'draft' },
    { tipo: 'cotizaciones', fecha: dia(M1, 1), moneda: 'USD', total: 40, estado: 'rejected' },
    { tipo: 'cotizaciones', fecha: dia(M1, HD + 1), moneda: 'USD', total: 70, estado: 'sent' },
    { tipo: 'cotizaciones', fecha: dia(M1, ultimoDia(M1.y, M1.m)), moneda: 'USD', total: 3, estado: 'sent' },
    { tipo: 'cotizaciones', fecha: dia(M2, 15), moneda: 'USD', total: 8, estado: 'sent' },
    { tipo: 'cotizaciones', fecha: dia(M11, 1), moneda: 'USD', total: 2, estado: 'sent' },
    { tipo: 'cotizaciones', fecha: dia(M12, ultimoDia(M12.y, M12.m)), moneda: 'USD', total: 1, estado: 'sent' },
    { tipo: 'pedidos', fecha: dia(M, 1), moneda: 'USD', total: 10, estado: 'confirmed' },
    { tipo: 'pedidos', fecha: dia(M, 1), moneda: 'USD', total: 99, estado: 'draft' },
    { tipo: 'pedidos', fecha: dia(M, 1), moneda: 'USD', total: 98, estado: 'cancelled' },
    { tipo: 'pedidos', fecha: dia(M1, 1), moneda: 'ARS', total: 7, estado: 'confirmed' },
    { tipo: 'pedidos', fecha: hoyAR, moneda: null, total: 11, estado: 'confirmed', revision: true },
    { tipo: 'entregas', fecha: dia(M, 1), moneda: 'USD', total: 50, estado: 'shipped' },
    { tipo: 'entregas', fecha: hoyAR, moneda: null, total: 13, estado: 'delivered', revision: true },
    { tipo: 'entregas', fecha: dia(M, 1), moneda: 'USD', total: 97, estado: 'draft' },
    { tipo: 'entregas', fecha: dia(M, 1), moneda: 'USD', total: 96, estado: 'cancelled' },
    { tipo: 'entregas', fecha: dia(M1, 1), moneda: 'USD', total: 5, estado: 'delivered' },
  ]
  // Un documento de MAÑANA, si mañana sigue siendo este mes: no puede entrar.
  if (HD < ultimoDia(M.y, M.m)) docs.push({ tipo: 'entregas', fecha: iso(M.y, M.m, HD + 1), moneda: 'USD', total: 1000, estado: 'shipped' })
  let n = 0
  for (const d of docs) {
    n++
    const comun = { company_id: ZZ, number: `${MARCA}-${d.tipo.slice(0, 3)}-${n}-${Date.now()}`, customer_id: cli.id, currency_code: d.moneda, total: d.total, needs_review: !!d.revision, review_reason: d.revision ? 'MISSING_CURRENCY' : null }
    let r
    if (d.tipo === 'cotizaciones') r = await s.from('sales_quotes').insert({ ...comun, quote_date: d.fecha, status: d.estado }).select('id').single()
    if (d.tipo === 'pedidos') r = await s.from('sales_orders').insert({ ...comun, order_date: d.fecha, commercial_status: d.estado }).select('id').single()
    if (d.tipo === 'entregas') r = await s.from('deliveries').insert({ ...comun, delivery_date: d.fecha, status: d.estado }).select('id').single()
    if (r.error) throw new Error(`${d.tipo} ${d.fecha} ${d.estado}: ${r.error.message}`)
    creados[d.tipo === 'cotizaciones' ? 'cot' : d.tipo === 'pedidos' ? 'ped' : 'ent'].push(r.data.id)
  }
  // Un documento de la empresa ajena, en el mismo mes: no puede aparecer.
  await s.from('sales_quotes').insert({ company_id: ZZ2, number: `${MARCA}-ajena-${Date.now()}`, customer_id: cli2.id, currency_code: 'USD', total: 777, quote_date: hoyAR, status: 'sent' })

  const admin = await usuario(ZZ, 'admin')
  const empleado = await usuario(ZZ, 'employee')
  const vendedor = await usuario(ZZ, 'salesperson')
  const tecnico = await usuario(ZZ, 'technician')
  const clienteU = await usuario(ZZ, 'customer', cli.id)
  const distrib = await usuario(ZZ, 'distributor', cli.id)
  const adminAjeno = await usuario(ZZ2, 'admin')
  const anon = createClient(BASE, PUB, { auth: { persistSession: false } })
  PASS('fixtures', `${docs.length} documentos · 2 empresas · 7 identidades`)

  seccion('2 · Quién puede')
  for (const [nombre, c] of [['ADMIN', admin], ['EMPLOYEE', empleado]]) {
    const r = await informe(c, ZZ)
    r.error ? FAIL(`${nombre} lee el informe`, r.error.message) : PASS(`${nombre} lee el informe`, `${r.data.length} filas`)
  }
  for (const [nombre, c] of [['SALESPERSON', vendedor], ['TECHNICIAN', tecnico], ['CUSTOMER', clienteU], ['DISTRIBUTOR', distrib]]) {
    const r = await informe(c, ZZ)
    r.error && /sin_permiso/.test(r.error.message) ? PASS(`${nombre} no puede`, r.error.message) : FAIL(`${nombre} no puede`, r.error?.message ?? `devolvió ${r.data?.length} filas`)
  }
  {
    const r = await informe(adminAjeno, ZZ)
    r.error && /sin_permiso/.test(r.error.message) ? PASS('ADMIN de otra empresa no lee esta', r.error.message) : FAIL('ADMIN de otra empresa', r.error?.message ?? 'devolvió filas')
    const r2 = await informe(anon, ZZ)
    r2.error ? PASS('ANON no puede ejecutar', r2.error.code ?? r2.error.message) : FAIL('ANON ejecutó')
    const r3 = await informe(admin, null)
    r3.error ? PASS('empresa nula: rechazada', r3.error.message) : FAIL('empresa nula aceptada')
  }

  seccion('3 · Qué entra y cómo se agrupa (mes en curso)')
  const r = await informe(admin, ZZ)
  const esp = esperado(docs, M)
  const real = aMapa(r.data)
  cmp('las filas coinciden EXACTO con la regla (tipo · mes · moneda · periodo)', ...ordenado(esp.filas, real))
  const rango = Object.fromEntries(r.data.filter((x) => x.periodo.startsWith('rango_')).map((x) => [x.periodo, [x.desde, x.hasta]]))
  cmp('tramo actual: del 1 a hoy', esp.rango.actual, rango.rango_actual)
  cmp('tramo anterior: el MISMO tramo de días del mes anterior', esp.rango.anterior, rango.rango_anterior)
  cmp('el día 1 queda en SU mes (no en el anterior, como en el legacy)', 100, real[`actual|cotizaciones|${primero(M)}|USD`]?.importe)
  cmp('SIN MONEDA aparte, con su marca de revisión', { documentos: 1, importe: 300, en_revision: 1 }, real[`actual|cotizaciones|${primero(M)}|SIN MONEDA`])
  cmp('ARS no se convierte ni se mezcla con USD', 5000.5, real[`actual|cotizaciones|${primero(M)}|ARS`]?.importe)
  cmp('borradores y cancelados fuera (ni un 99/98/97/96/999)', 0, r.data.filter((x) => [999, 99, 98, 97, 96].includes(Number(x.importe))).length)
  cmp('un remito despachado (shipped) cuenta como entregado', 50, real[`actual|entregas|${primero(M)}|USD`]?.importe)
  cmp('la empresa ajena no aparece', 0, r.data.filter((x) => Number(x.importe) === 777).length)
  cmp('nada de mañana', 0, r.data.filter((x) => Number(x.importe) === 1000).length)
  cmp('fuera de los 12 meses no entra', undefined, real[`mes|cotizaciones|${primero(M12)}|USD`])
  cmp('el primer mes de la serie sí', { documentos: 1, importe: 2, en_revision: 0 }, real[`mes|cotizaciones|${primero(M11)}|USD`])

  seccion('4 · Mes pasado y mes futuro')
  {
    const rp = await informe(empleado, ZZ, iso(M1.y, M1.m, 17))
    const ep = esperado(docs, M1)
    if (rp.error) FAIL('mes pasado', rp.error.message)
    else {
      const rr = aMapa(rp.data)
      cmp('mes pasado: filas exactas (mes completo vs mes anterior completo)', ...ordenado(ep.filas, rr))
      const rg = Object.fromEntries(rp.data.filter((x) => x.periodo.startsWith('rango_')).map((x) => [x.periodo, [x.desde, x.hasta]]))
      cmp('mes pasado: tramos completos', [ep.rango.actual, ep.rango.anterior], [rg.rango_actual, rg.rango_anterior])
    }
    const rf = await informe(admin, ZZ, iso(mesDesplazado(1).y, mesDesplazado(1).m, 1))
    rf.error && /mes_futuro/.test(rf.error.message) ? PASS('mes futuro: rechazado', rf.error.message) : FAIL('mes futuro aceptado')
  }

  seccion('5 · Paridad con la base: Buscatools real')
  {
    const BT = (await s.from('companies').select('id').eq('slug', 'buscatools').single()).data.id
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
      const leer = async (tabla, fecha, estado, valores) => {
        const { data, error } = await s.from(tabla).select(`${fecha}, currency_code, total, needs_review, ${estado}`).eq('company_id', BT).in(estado, valores).range(0, 9999)
        if (error) throw new Error(error.message)
        return data.map((d) => ({ fecha: d[fecha], moneda: d.currency_code, total: Number(d.total), revision: d.needs_review }))
      }
      const reales = [
        ...(await leer('sales_quotes', 'quote_date', 'status', ['sent', 'accepted', 'rejected', 'expired'])).map((d) => ({ ...d, tipo: 'cotizaciones', estado: 'sent' })),
        ...(await leer('sales_orders', 'order_date', 'commercial_status', ['confirmed'])).map((d) => ({ ...d, tipo: 'pedidos', estado: 'confirmed' })),
        ...(await leer('deliveries', 'delivery_date', 'status', ['shipped', 'delivered'])).map((d) => ({ ...d, tipo: 'entregas', estado: 'delivered' })),
      ]
      const eb = esperado(reales, M)
      const rbm = aMapa(rb.data)
      const claves = [...new Set([...Object.keys(eb.filas), ...Object.keys(rbm)])]
      const distintas = claves.filter((k) => JSON.stringify(eb.filas[k]) !== JSON.stringify(rbm[k]))
      distintas.length === 0 ? PASS('cada fila del informe = suma directa sobre las tablas', `${claves.length} filas`) : FAIL('filas distintas', JSON.stringify(distintas.slice(0, 5).map((k) => [k, eb.filas[k], rbm[k]])))
      const sep = (tipo, moneda) => rbm[`mes|${tipo}|2026-09-01|${moneda}`]
      if (HY === 2026 && HM === 9) {
        INFO('septiembre, entregas por moneda', JSON.stringify({ USD: sep('entregas', 'USD'), ARS: sep('entregas', 'ARS'), 'SIN MONEDA': sep('entregas', 'SIN MONEDA') }))
        cmp('las 15 NE sin moneda de septiembre quedan como SIN MONEDA, no como USD', { documentos: 15, importe: 12996570.72, en_revision: 15 }, sep('entregas', 'SIN MONEDA'))
      }
      const ordenados = tiempos.slice().sort((a, b) => a - b)
      INFO('latencia del RPC (5 llamadas, incluye red)', `mediana ${ordenados[2]} ms · máx ${ordenados[4]} ms · filas ${rb.data.length} · ${JSON.stringify(rb.data).length} B`)
      ordenados[2] < 1500 ? PASS('mediana < 1,5 s') : FAIL('lento', `${ordenados[2]} ms`)
    }
  }

  seccion('6 · Limpieza')
  await barrer()
  const quedan = (await s.from('companies').select('id', { count: 'exact', head: true }).like('slug', `${MARCA}-%`)).count
  cmp('sin empresas zz-inf1', 0, quedan)
  const { data: us } = await s.auth.admin.listUsers({ perPage: 1000 })
  cmp('sin usuarios zz-inf1', 0, (us?.users ?? []).filter((u) => u.email?.startsWith(`${MARCA}-`)).length)

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
