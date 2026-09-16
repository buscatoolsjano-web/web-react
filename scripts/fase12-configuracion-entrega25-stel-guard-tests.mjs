/**
 * Fase 12 · Configuración — Entrega 2.5: guardrail de convivencia con STEL.
 * Pruebas REALES contra la base, con JWT reales.
 *
 *   1  configuración: filas reales (Buscatools ×3 STEL, Torquetools sin filas),
 *      valores válidos, tabla y bitácora cerradas a anon/authenticated, RPC de
 *      lectura por rol y entre empresas;
 *   2  numeración (ataque directo a `next_document_number`): matriz de roles
 *      × quote/sales_order/delivery, service role, entre empresas; secuencia intacta;
 *   3  documento (INSERT directo): usuarios, `imported_at` puesto por un usuario,
 *      service role sin marca de importación → bloqueado; importación → permitida
 *      y sin consumir la secuencia;
 *   4  transiciones de emisión (enviada/aceptada, confirmado, despachada/entregada)
 *      bloqueadas; editar borradores y cancelar siguen funcionando; mover un
 *      documento a una empresa STEL, bloqueado;
 *   5  despacho (`confirmar_entrega`): bloqueado ANTES de todo efecto — 0
 *      movimientos, 0 reservas tocadas, 0 eventos, saldo idéntico;
 *   6  idempotencia (5 intentos) y concurrencia (2 simultáneos, ambos bloqueados);
 *   7  control ERP: en una empresa sin autoridad STEL todo sigue funcionando
 *      (numerar, crear, enviar, confirmar, despachar con stock);
 *   8  cambio de autoridad: auditado (STEL→ERP→STEL), la emisión obedece a la
 *      tabla y los intentos bloqueados NO se registran;
 *   9  datos reales intactos: secuencias, documentos, stock, eventos y autoridad.
 *
 * Fixtures: empresas zz-e25-* y usuarios zz-e25-*@buscatools.test, borrados al
 * final. No usa sesiones de personas reales ni emite nada en empresas reales.
 *
 *   set -a; source .env; source .env.migration; source .env.rls.txt; set +a
 *   node scripts/fase12-configuracion-entrega25-stel-guard-tests.mjs
 *
 * NO correrla en paralelo con otra suite de base. NO canalizar por `head`.
 */
import { createClient } from '@supabase/supabase-js'
import { createHash, randomUUID } from 'node:crypto'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET) { console.error('✗ Faltan variables'); process.exit(1) }

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(72)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const INFO = (t, d = '') => console.log(`    INFO  ${t}${d ? ' — ' + d : ''}`)
const cmp = (t, esp, real) => (JSON.stringify(esp) === JSON.stringify(real) ? PASS(t, String(JSON.stringify(real)).slice(0, 140)) : FAIL(t, `esperaba ${JSON.stringify(esp)}, dio ${JSON.stringify(real)}`))

const s = createClient(BASE, SECRET, { auth: { persistSession: false } })
const anon = createClient(BASE, PUB, { auth: { persistSession: false } })
const MARCA = 'zz-e25'
const HOY = new Date().toISOString().slice(0, 10)
const MENSAJE = 'La numeración de este documento todavía está administrada por STEL. No se puede emitir desde el ERP hasta completar la migración.'
const TIPOS = ['quote', 'sales_order', 'delivery']

const login = async (email, password) => {
  const c = createClient(BASE, PUB, { auth: { persistSession: false } })
  const { data, error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`login: ${error.message}`)
  return { c, id: data.user.id }
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

/** Clasifica una respuesta: 'STEL' (guardrail), 'PERMISO', 'OK' u otro texto. */
const clase = (r) => {
  if (!r.error) return 'OK'
  const m = `${r.error.message ?? ''}`
  if (m === 'external_numbering_authority') return 'STEL'
  if (/permission denied|Sin permiso|sin_permiso|42501/i.test(`${m} ${r.error.code}`)) return 'PERMISO'
  return `OTRO(${r.error.code}: ${m.slice(0, 80)})`
}
const hash = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16)
const cuenta = async (tabla, filtro) => {
  let q = s.from(tabla).select('*', { count: 'exact', head: true })
  if (filtro) q = filtro(q)
  return (await q).count
}

const seqDe = async (companyId) => {
  const { data } = await s.from('document_sequences').select('doc_type, series_code, next_number').eq('company_id', companyId).order('doc_type')
  return Object.fromEntries((data ?? []).map((x) => [x.doc_type, Number(x.next_number)]))
}

/** Huella de TODO lo real (empresas que no son zz-*). */
async function huellaReal() {
  const { data: c } = await s.from('companies').select('id, slug').not('slug', 'like', 'zz-%').order('slug')
  const ids = c.map((x) => x.id)
  const seq = (await s.from('document_sequences').select('*').in('company_id', ids).order('company_id').order('doc_type').order('series_code')).data
  const aut = (await s.from('document_numbering_authority').select('*').in('company_id', ids).order('company_id').order('doc_type')).data
  const bal = (await s.from('stock_balances').select('*').in('company_id', ids).order('product_id').order('warehouse_id')).data
  const f = (q) => q.in('company_id', ids)
  return {
    seq: hash(seq),
    autoridad: hash(aut),
    saldos: hash(bal),
    movimientos: await cuenta('stock_movements', f),
    reservas: await cuenta('stock_reservations', f),
    eventos: await cuenta('sales_audit', f),
    cotizaciones: await cuenta('sales_quotes', f),
    pedidos: await cuenta('sales_orders', f),
    remitos: await cuenta('deliveries', f),
    bitacoraAutoridad: await cuenta('document_numbering_authority_audit', f),
  }
}

const barrer = async () => {
  const { data: emp } = await s.from('companies').select('id').like('slug', `${MARCA}-%`)
  const ids = (emp ?? []).map((x) => x.id)
  if (ids.length) {
    // Los fixtures importados no se borran (trigger de históricos): se les quita
    // la marca antes. Sólo en empresas zz-e25-*.
    for (const t of ['deliveries', 'sales_orders', 'sales_quotes']) {
      await s.from(t).update({ imported_at: null }).in('company_id', ids).not('imported_at', 'is', null)
    }
    await s.from('stock_reservations').delete().in('company_id', ids)
    await s.from('stock_movements').delete().in('company_id', ids)
    await s.from('stock_balances').delete().in('company_id', ids)
    const { data: dels } = await s.from('deliveries').select('id').in('company_id', ids)
    for (const d of dels ?? []) await s.from('delivery_lines').delete().eq('delivery_id', d.id)
    await s.from('deliveries').delete().in('company_id', ids)
    await s.from('sales_order_lines').delete().in('company_id', ids)
    await s.from('sales_orders').delete().in('company_id', ids)
    await s.from('sales_quote_lines').delete().in('company_id', ids)
    await s.from('sales_quotes').delete().in('company_id', ids)
    await s.from('sales_audit').delete().in('company_id', ids)
    await s.from('company_memberships').delete().in('company_id', ids)
    await s.from('products').delete().in('company_id', ids)
    await s.from('product_categories').delete().in('company_id', ids)
    await s.from('customers').delete().in('company_id', ids)
    await s.from('warehouses').delete().in('company_id', ids)
    await s.from('document_numbering_authority').delete().in('company_id', ids)
    await s.from('document_numbering_authority_audit').delete().in('company_id', ids)
  }
  for (let page = 1; ; page++) {
    const { data: us } = await s.auth.admin.listUsers({ page, perPage: 1000 })
    for (const u of us?.users ?? []) if (u.email?.startsWith(`${MARCA}-`)) { await s.from('company_memberships').delete().eq('user_id', u.id); await s.auth.admin.deleteUser(u.id) }
    if ((us?.users ?? []).length < 1000) break
  }
  if (ids.length) {
    await s.from('document_sequences').delete().in('company_id', ids)
    await s.from('companies').delete().in('id', ids)
  }
}

/** Empresa fixture completa: secuencias, cliente, rubro, producto, depósito y stock. */
async function empresa(etiqueta) {
  const { data: emp, error } = await s.from('companies').insert({ slug: `${MARCA}-${etiqueta}-${Date.now()}`, name: `ZZ E25 ${etiqueta}`, default_currency: 'ARS' }).select('id').single()
  if (error) throw new Error(`empresa ${etiqueta}: ${error.message}`)
  const id = emp.id
  const { error: eS } = await s.from('document_sequences').insert([
    { company_id: id, doc_type: 'quote', prefix: 'ZQ', padding: 5, next_number: 100, is_default: true },
    { company_id: id, doc_type: 'sales_order', prefix: 'ZP', padding: 5, next_number: 200, is_default: true },
    { company_id: id, doc_type: 'delivery', prefix: 'ZR', padding: 5, next_number: 300, is_default: true },
    { company_id: id, doc_type: 'customer', prefix: 'ZC', padding: 5, next_number: 400, is_default: true },
  ])
  if (eS) throw new Error(`secuencias ${etiqueta}: ${eS.message}`)
  const { data: cli } = await s.from('customers').insert({ company_id: id, legal_name: `ZZ E25 cliente ${etiqueta}` }).select('id').single()
  const { data: rubro } = await s.from('product_categories').insert({ company_id: id, name: 'ZZ E25 rubro', slug: `${MARCA}-rubro` }).select('id').single()
  const { data: prod, error: eP } = await s.from('products').insert({ company_id: id, category_id: rubro.id, sku: `${MARCA}-${etiqueta}`, name: `ZZ E25 producto ${etiqueta}` }).select('id').single()
  if (eP) throw new Error(`producto ${etiqueta}: ${eP.message}`)
  const { data: dep } = await s.from('warehouses').insert({ company_id: id, code: `ZZ${etiqueta}`.slice(0, 10), name: `ZZ E25 depósito ${etiqueta}` }).select('id').single()
  const { error: eM } = await s.from('stock_movements').insert({ company_id: id, product_id: prod.id, warehouse_id: dep.id, movement_type: 'adjustment', quantity: 50, source_type: MARCA, notes: 'ZZ E25 stock inicial' })
  if (eM) throw new Error(`stock ${etiqueta}: ${eM.message}`)
  return { id, cliente: cli.id, producto: prod.id, deposito: dep.id }
}

const huellaEmpresa = async (id) => ({
  seq: await seqDe(id),
  movimientos: await cuenta('stock_movements', (q) => q.eq('company_id', id)),
  saldos: hash((await s.from('stock_balances').select('product_id, warehouse_id, on_hand, reserved').eq('company_id', id).order('product_id')).data),
  reservas: hash((await s.from('stock_reservations').select('id, quantity').eq('company_id', id).order('id')).data),
  eventos: await cuenta('sales_audit', (q) => q.eq('company_id', id)),
  cotizaciones: await cuenta('sales_quotes', (q) => q.eq('company_id', id)),
  pedidos: await cuenta('sales_orders', (q) => q.eq('company_id', id)),
  remitos: await cuenta('deliveries', (q) => q.eq('company_id', id)),
  bitacoraAutoridad: await cuenta('document_numbering_authority_audit', (q) => q.eq('company_id', id)),
})

const main = async () => {
  await barrer()
  const huellaAntes = await huellaReal()
  INFO('huella real antes', JSON.stringify(huellaAntes))

  const STEL = await empresa('stel')
  const ERP = await empresa('erp')
  const { error: eA } = await s.from('document_numbering_authority').insert(TIPOS.map((t) => ({ company_id: STEL.id, doc_type: t, authority: 'STEL', reason: 'ZZ E25 fixture: STEL numera' })))
  if (eA) throw new Error(`autoridad fixture: ${eA.message}`)

  const { data: cliExt } = await s.from('customers').insert({ company_id: STEL.id, legal_name: 'ZZ E25 cliente externo' }).select('id').single()
  const id = {
    admin: await usuario(STEL.id, 'admin'),
    employee: await usuario(STEL.id, 'employee'),
    salesperson: await usuario(STEL.id, 'salesperson'),
    technician: await usuario(STEL.id, 'technician'),
    customer: await usuario(STEL.id, 'customer', cliExt.id),
    distributor: await usuario(STEL.id, 'distributor', cliExt.id),
    adminErp: await usuario(ERP.id, 'admin'),
  }
  const ROLES = ['admin', 'employee', 'salesperson', 'technician', 'customer', 'distributor']

  // Documentos importados de STEL en la empresa STEL (vía de importación: service role + imported_at).
  const AHORA = new Date().toISOString()
  const impQ = await s.from('sales_quotes').insert({ company_id: STEL.id, number: 'COTI-STEL-1', customer_id: STEL.cliente, quote_date: HOY, status: 'draft', imported_at: AHORA, legacy_source: MARCA }).select('id').single()
  const impO = await s.from('sales_orders').insert({ company_id: STEL.id, number: 'PDV-STEL-1', customer_id: STEL.cliente, order_date: HOY, commercial_status: 'draft', imported_at: AHORA, legacy_source: MARCA }).select('id').single()
  const impD = await s.from('deliveries').insert({ company_id: STEL.id, number: 'RT-STEL-1', customer_id: STEL.cliente, order_id: impO.data?.id, delivery_date: HOY, status: 'draft', imported_at: AHORA, legacy_source: MARCA }).select('id').single()
  if (impQ.error || impO.error || impD.error) throw new Error(`importados: ${impQ.error?.message ?? impO.error?.message ?? impD.error?.message}`)
  const { error: eL } = await s.from('delivery_lines').insert({ company_id: STEL.id, delivery_id: impD.data.id, product_id: STEL.producto, warehouse_id: STEL.deposito, quantity: 3 })
  if (eL) throw new Error(`línea importada: ${eL.message}`)
  const { error: eR } = await s.from('stock_reservations').insert({ company_id: STEL.id, product_id: STEL.producto, warehouse_id: STEL.deposito, quantity: 3, source_type: 'sales_order', source_id: impO.data.id, notes: 'ZZ E25 reserva importada' })
  if (eR) throw new Error(`reserva: ${eR.message}`)

  const huellaStel0 = await huellaEmpresa(STEL.id)
  INFO('empresa STEL (fixture) antes', JSON.stringify(huellaStel0))

  seccion('1 · Configuración de autoridad')
  {
    const { data: reales } = await s.from('document_numbering_authority').select('doc_type, authority, companies!inner(slug)').not('companies.slug', 'like', 'zz-%').order('doc_type')
    // Después del cutover de Fase 14, Buscatools emite desde el ERP. Lo que este
    // test cuida no es qué valor tiene, sino que sólo Buscatools tenga filas y
    // que la serie RT-ML siga siendo la única excepción.
    cmp('Buscatools: quote/sales_order/delivery → ERP (y nada más en empresas reales)',
      [['buscatools', 'delivery', 'ERP'], ['buscatools', 'quote', 'ERP'], ['buscatools', 'sales_order', 'ERP']],
      (reales ?? []).map((x) => [x.companies.slug, x.doc_type, x.authority]).sort())
    const { data: seriesReales } = await s.from('document_numbering_authority_series').select('doc_type, series_code, authority, companies!inner(slug)').not('companies.slug', 'like', 'zz-%')
    cmp('única excepción por serie en empresas reales: RT-ML → STEL',
      [['buscatools', 'delivery', 'RT-ML', 'STEL']],
      (seriesReales ?? []).map((x) => [x.companies.slug, x.doc_type, x.series_code, x.authority]).sort())
    const { data: tt } = await s.from('companies').select('id').eq('slug', 'torquetools').single()
    cmp('Torquetools: sin filas (no se asumió autoridad)', 0, await cuenta('document_numbering_authority', (q) => q.eq('company_id', tt.id)))
    const malos = []
    for (const v of ['stel', 'true', '', 'OTRO']) malos.push(clase(await s.from('document_numbering_authority').insert({ company_id: ERP.id, doc_type: 'supplier', authority: v, reason: 'ZZ E25 inválido' })))
    cmp('CHECK: sólo STEL/ERP (ni minúsculas, ni booleano, ni vacío)', true, malos.every((m) => m.startsWith('OTRO(23514')))
    cmp('0 filas creadas con valores inválidos', 0, await cuenta('document_numbering_authority', (q) => q.eq('company_id', ERP.id)))

    const directos = []
    for (const r of ['admin', 'employee']) {
      directos.push([`${r} SELECT`, (await id[r].c.from('document_numbering_authority').select('*')).error ? 'PERMISO' : 'LEE'])
      directos.push([`${r} UPDATE`, clase(await id[r].c.from('document_numbering_authority').update({ authority: 'ERP' }).eq('company_id', STEL.id).select('doc_type'))])
      directos.push([`${r} INSERT`, clase(await id[r].c.from('document_numbering_authority').insert({ company_id: STEL.id, doc_type: 'customer', authority: 'ERP', reason: 'intruso' }))])
      directos.push([`${r} DELETE`, clase(await id[r].c.from('document_numbering_authority').delete().eq('company_id', STEL.id).select('doc_type'))])
      directos.push([`${r} SELECT bitácora`, (await id[r].c.from('document_numbering_authority_audit').select('*')).error ? 'PERMISO' : 'LEE'])
    }
    directos.push(['anon SELECT', (await anon.from('document_numbering_authority').select('*')).error ? 'PERMISO' : 'LEE'])
    directos.push(['anon UPDATE', clase(await anon.from('document_numbering_authority').update({ authority: 'ERP' }).eq('company_id', STEL.id).select('doc_type'))])
    cmp('tabla y bitácora: sin acceso directo para admin, employee ni anon', true, directos.every(([, v]) => v === 'PERMISO'))
    if (!directos.every(([, v]) => v === 'PERMISO')) INFO('detalle', JSON.stringify(directos))
    cmp('la autoridad sigue STEL ×3 tras los ataques', ['STEL', 'STEL', 'STEL'], ((await s.from('document_numbering_authority').select('authority').eq('company_id', STEL.id)).data ?? []).map((x) => x.authority))

    const lectura = {}
    for (const r of ROLES) {
      const x = await id[r].c.rpc('autoridad_numeracion_empresa', { p_company: STEL.id })
      lectura[r] = x.error ? clase(x) : x.data.map((f) => `${f.doc_type}:${f.authority}`).join(',')
    }
    lectura.anon = clase(await anon.rpc('autoridad_numeracion_empresa', { p_company: STEL.id }))
    lectura.adminOtraEmpresa = clase(await id.adminErp.c.rpc('autoridad_numeracion_empresa', { p_company: STEL.id }))
    const todo = 'delivery:STEL,quote:STEL,sales_order:STEL'
    cmp('RPC de lectura: internos ven; customer, distributor, anon y otra empresa no', {
      admin: todo, employee: todo, salesperson: todo, technician: todo, customer: 'PERMISO', distributor: 'PERMISO', anon: 'PERMISO', adminOtraEmpresa: 'PERMISO',
    }, lectura)
    const diag = await id.admin.c.rpc('config_numeracion_diagnostico', { p_company: STEL.id })
    cmp('diagnóstico de Numeración: autoridad desde la tabla', [['customer', 'ERP', false], ['delivery', 'STEL', true], ['quote', 'STEL', true], ['sales_order', 'STEL', true]],
      (diag.data ?? []).map((f) => [f.doc_type, f.autoridad, f.autoridad_configurada]).sort())
    const diagErp = await id.adminErp.c.rpc('config_numeracion_diagnostico', { p_company: ERP.id })
    cmp('diagnóstico en empresa sin filas: todo ERP', true, (diagErp.data ?? []).length === 4 && diagErp.data.every((f) => f.autoridad === 'ERP' && f.autoridad_configurada === false))
  }

  seccion('2 · Numeración: ataque directo a next_document_number')
  {
    const seq0 = await seqDe(STEL.id)
    const matriz = {}
    for (const r of ROLES) matriz[r] = TIPOS.map((t) => t)
    for (const r of ROLES) {
      const fila = []
      for (const t of TIPOS) fila.push(clase(await id[r].c.rpc('next_document_number', { p_company: STEL.id, p_doc_type: t })))
      matriz[r] = fila.join('/')
    }
    const anonFila = []
    for (const t of TIPOS) anonFila.push(clase(await anon.rpc('next_document_number', { p_company: STEL.id, p_doc_type: t })))
    matriz.anon = anonFila.join('/')
    const srvFila = []
    for (const t of TIPOS) srvFila.push(clase(await s.rpc('next_document_number', { p_company: STEL.id, p_doc_type: t })))
    matriz.service_role = srvFila.join('/')
    const serie = []
    for (const t of TIPOS) serie.push(clase(await id.admin.c.rpc('next_document_number', { p_company: STEL.id, p_doc_type: t, p_series: 'ZQ' })))
    matriz.adminConSerie = serie.join('/')
    const otra = []
    for (const t of TIPOS) otra.push(clase(await id.adminErp.c.rpc('next_document_number', { p_company: STEL.id, p_doc_type: t })))
    matriz.adminOtraEmpresa = otra.join('/')
    const B = 'STEL/STEL/STEL'
    const P = 'PERMISO/PERMISO/PERMISO'
    cmp('matriz (quote/sales_order/delivery)', {
      admin: B, employee: B, salesperson: P, technician: P, customer: P, distributor: P, anon: P, service_role: B, adminConSerie: B, adminOtraEmpresa: P,
    }, matriz)

    const r = await id.admin.c.rpc('next_document_number', { p_company: STEL.id, p_doc_type: 'quote' })
    cmp('código estable y mensaje exacto', ['external_numbering_authority', MENSAJE, 'quote'], [r.error?.message, r.error?.details, r.error?.hint])
    cmp('tipo no configurado (customer) en la misma empresa sigue numerando', 'OK', clase(await id.admin.c.rpc('next_document_number', { p_company: STEL.id, p_doc_type: 'customer' })))
    const seq1 = await seqDe(STEL.id)
    cmp('secuencias quote/sales_order/delivery idénticas (sólo customer avanzó 1)', { ...seq0, customer: seq0.customer + 1 }, seq1)
  }

  seccion('3 · Documento: INSERT directo e importación')
  {
    const fila = (t, extra = {}) => {
      const base = { company_id: STEL.id, customer_id: STEL.cliente, ...extra }
      if (t === 'sales_quotes') return { ...base, number: `ZQ-X-${randomUUID().slice(0, 6)}`, quote_date: HOY }
      if (t === 'sales_orders') return { ...base, number: `ZP-X-${randomUUID().slice(0, 6)}`, order_date: HOY }
      return { ...base, number: `ZR-X-${randomUUID().slice(0, 6)}`, delivery_date: HOY }
    }
    const res = {}
    for (const t of ['sales_quotes', 'sales_orders', 'deliveries']) {
      res[t] = [
        clase(await id.admin.c.from(t).insert(fila(t)).select('id')),
        clase(await id.employee.c.from(t).insert(fila(t)).select('id')),
        clase(await id.admin.c.from(t).insert(fila(t, { imported_at: AHORA, legacy_source: 'erp_store' })).select('id')),
        clase(await id.salesperson.c.from(t).insert(fila(t)).select('id')),
        clase(await s.from(t).insert(fila(t)).select('id')),
        clase(await id.adminErp.c.from(t).insert(fila(t)).select('id')),
        clase(await id.customer.c.from(t).insert(fila(t)).select('id')),
        clase(await anon.from(t).insert(fila(t)).select('id')),
      ].join('/')
    }
    // Fase 14 E2: el admin que finge una importación ya no llega al guard de autoridad:
    // lo frena antes app.proteger_campos_importacion (imported_at/legacy_source sólo server-side).
    const M = 'STEL/STEL/PERMISO/PERMISO/STEL/PERMISO/PERMISO/PERMISO'
    cmp('admin / employee / admin fingiendo importación / salesperson / service role sin marca / admin de otra empresa / customer / anon', {
      sales_quotes: M, sales_orders: M, deliveries: M,
    }, res)

    const seq0 = await seqDe(STEL.id)
    const imp = await s.from('sales_quotes').insert(fila('sales_quotes', { number: 'COTI-STEL-2', imported_at: AHORA, legacy_source: 'erp_store', status: 'accepted' })).select('id').single()
    const impPed = await s.from('sales_orders').insert(fila('sales_orders', { number: 'PDV-STEL-2', imported_at: AHORA, legacy_source: 'erp_store', commercial_status: 'confirmed' })).select('id').single()
    const impRt = await s.from('deliveries').insert(fila('deliveries', { number: 'RT-STEL-2', imported_at: AHORA, legacy_source: 'erp_store', status: 'delivered' })).select('id').single()
    cmp('importación (service role + imported_at) de documentos ya emitidos por STEL: permitida', ['OK', 'OK', 'OK'], [clase(imp), clase(impPed), clase(impRt)])
    const impBorrador = await s.from('sales_quotes').insert(fila('sales_quotes', { number: 'COTI-STEL-3', imported_at: AHORA, legacy_source: 'erp_store' })).select('id').single()
    cmp('re-sincronización del importador (borrador importado → enviada → aceptada): permitida', ['OK', 'OK', 'OK'], [
      clase(impBorrador),
      clase(await s.from('sales_quotes').update({ status: 'sent' }).eq('id', impBorrador.data?.id).select('id')),
      clase(await s.from('sales_quotes').update({ status: 'accepted' }).eq('id', impBorrador.data?.id).select('id')),
    ])
    cmp('importar no consume la secuencia', seq0, await seqDe(STEL.id))
    const conteo = await huellaEmpresa(STEL.id)
    cmp('documentos en empresa STEL: sólo los importados', [3, 2, 2], [conteo.cotizaciones, conteo.pedidos, conteo.remitos])
  }

  seccion('4 · Transiciones de emisión y edición de borradores')
  {
    const q = impQ.data.id
    const o = impO.data.id
    const d = impD.data.id
    const t = {}
    t.cotizacionEnviar = clase(await id.admin.c.from('sales_quotes').update({ status: 'sent' }).eq('id', q).select('id'))
    t.cotizacionAceptar = clase(await id.employee.c.from('sales_quotes').update({ status: 'accepted' }).eq('id', q).select('id'))
    t.pedidoConfirmar = clase(await id.admin.c.from('sales_orders').update({ commercial_status: 'confirmed' }).eq('id', o).select('id'))
    t.remitoDespachar = clase(await id.admin.c.from('deliveries').update({ status: 'shipped' }).eq('id', d).select('id'))
    t.remitoEntregar = clase(await id.employee.c.from('deliveries').update({ status: 'delivered' }).eq('id', d).select('id'))
    t.serviceRoleNoImportador = clase(await s.from('sales_quotes').update({ status: 'sent', imported_at: null }).eq('id', q).select('id'))
    cmp('enviar / aceptar / confirmar / despachar / entregar / service role quitando la marca', {
      cotizacionEnviar: 'STEL', cotizacionAceptar: 'STEL', pedidoConfirmar: 'STEL', remitoDespachar: 'STEL', remitoEntregar: 'STEL', serviceRoleNoImportador: 'STEL',
    }, t)
    const estados = [
      (await s.from('sales_quotes').select('status, imported_at').eq('id', q).single()).data,
      (await s.from('sales_orders').select('commercial_status').eq('id', o).single()).data.commercial_status,
      (await s.from('deliveries').select('status').eq('id', d).single()).data.status,
    ]
    cmp('estados sin cambios (borrador, marca de importación intacta)', ['draft', true, 'draft', 'draft'], [estados[0].status, estados[0].imported_at !== null, estados[1], estados[2]])

    const e = {}
    const eq = await id.admin.c.from('sales_quotes').update({ title: 'ZZ E25 borrador editado' }).eq('id', q).select('id')
    e.editarCotizacion = eq.error ? clase(eq) : String(eq.data.length)
    const eo = await id.employee.c.from('sales_orders').update({ notes: 'ZZ E25 nota' }).eq('id', o).select('id')
    e.editarPedido = eo.error ? clase(eo) : String(eo.data.length)
    const el = await id.admin.c.from('delivery_lines').update({ notes: 'ZZ E25' }).eq('delivery_id', d).select('id')
    e.editarLineaRemito = el.error ? clase(el) : String(el.data.length)
    cmp('editar borradores (sin consumir numeración) sigue funcionando', { editarCotizacion: '1', editarPedido: '1', editarLineaRemito: '1' }, e)

    // Mover un documento de la empresa ERP a la STEL (sólo lo intenta el service role).
    const { data: nq } = await s.from('sales_quotes').insert({ company_id: ERP.id, number: 'ZQ-MOVER', customer_id: ERP.cliente, quote_date: HOY, currency_code: 'ARS' }).select('id').single()
    cmp('mover un documento a una empresa con autoridad STEL: bloqueado', 'STEL', clase(await s.from('sales_quotes').update({ company_id: STEL.id, customer_id: STEL.cliente }).eq('id', nq.id).select('id')))
    await s.from('sales_quotes').delete().eq('id', nq.id)
  }

  seccion('5 · Despacho: confirmar_entrega bloqueado antes de todo efecto')
  {
    const antes = await huellaEmpresa(STEL.id)
    const r1 = await id.admin.c.rpc('confirmar_entrega', { p_delivery: impD.data.id })
    cmp('admin: external_numbering_authority con el mensaje', ['STEL', MENSAJE], [clase(r1), r1.error?.details])
    cmp('service role: bloqueado igual', 'STEL', clase(await s.rpc('confirmar_entrega', { p_delivery: impD.data.id })))
    const matriz = {}
    for (const r of ['employee', 'salesperson', 'technician', 'customer', 'distributor']) matriz[r] = clase(await id[r].c.rpc('confirmar_entrega', { p_delivery: impD.data.id }))
    matriz.anon = clase(await anon.rpc('confirmar_entrega', { p_delivery: impD.data.id }))
    matriz.adminOtraEmpresa = clase(await id.adminErp.c.rpc('confirmar_entrega', { p_delivery: impD.data.id }))
    cmp('matriz de roles', { employee: 'STEL', salesperson: 'PERMISO', technician: 'PERMISO', customer: 'PERMISO', distributor: 'PERMISO', anon: 'PERMISO', adminOtraEmpresa: 'PERMISO' }, matriz)
    const despues = await huellaEmpresa(STEL.id)
    cmp('0 movimientos, saldo y reservas idénticos, 0 eventos, remito en borrador', { ...antes, estado: 'draft' }, { ...despues, estado: (await s.from('deliveries').select('status').eq('id', impD.data.id).single()).data.status })
  }

  seccion('6 · Idempotencia y concurrencia')
  {
    const antes = await huellaEmpresa(STEL.id)
    const cinco = []
    for (let i = 0; i < 5; i++) cinco.push(clase(await id.admin.c.rpc('confirmar_entrega', { p_delivery: impD.data.id })))
    cmp('5 intentos de despacho: los 5 bloqueados', ['STEL', 'STEL', 'STEL', 'STEL', 'STEL'], cinco)
    const cincoNum = []
    for (let i = 0; i < 5; i++) cincoNum.push(clase(await id.employee.c.rpc('next_document_number', { p_company: STEL.id, p_doc_type: 'delivery' })))
    cmp('5 intentos de numerar: los 5 bloqueados', ['STEL', 'STEL', 'STEL', 'STEL', 'STEL'], cincoNum)
    const dos = await Promise.all([
      id.admin.c.rpc('confirmar_entrega', { p_delivery: impD.data.id }),
      id.employee.c.rpc('confirmar_entrega', { p_delivery: impD.data.id }),
    ])
    cmp('2 despachos simultáneos: ambos bloqueados', ['STEL', 'STEL'], dos.map(clase))
    const dosNum = await Promise.all([
      id.admin.c.rpc('next_document_number', { p_company: STEL.id, p_doc_type: 'quote' }),
      id.employee.c.rpc('next_document_number', { p_company: STEL.id, p_doc_type: 'quote' }),
    ])
    cmp('2 numeraciones simultáneas: ambas bloqueadas', ['STEL', 'STEL'], dosNum.map(clase))
    cmp('huella de la empresa STEL idéntica (secuencias, stock, reservas, eventos, documentos)', antes, await huellaEmpresa(STEL.id))
  }

  seccion('7 · Control: empresa sin autoridad STEL (ERP) sigue emitiendo')
  {
    const c = id.adminErp.c
    const seq0 = await seqDe(ERP.id)
    const nQ = await c.rpc('next_document_number', { p_company: ERP.id, p_doc_type: 'quote' })
    const q = await c.from('sales_quotes').insert({ company_id: ERP.id, number: nQ.data, customer_id: ERP.cliente, quote_date: HOY, currency_code: 'ARS' }).select('id').single()
    const qs = await c.from('sales_quotes').update({ status: 'sent' }).eq('id', q.data?.id).select('id')
    const nO = await c.rpc('next_document_number', { p_company: ERP.id, p_doc_type: 'sales_order' })
    const o = await c.from('sales_orders').insert({ company_id: ERP.id, number: nO.data, customer_id: ERP.cliente, order_date: HOY, currency_code: 'ARS' }).select('id').single()
    const oc = await c.from('sales_orders').update({ commercial_status: 'confirmed' }).eq('id', o.data?.id).select('id')
    const nD = await c.rpc('next_document_number', { p_company: ERP.id, p_doc_type: 'delivery' })
    const d = await c.from('deliveries').insert({ company_id: ERP.id, number: nD.data, customer_id: ERP.cliente, order_id: o.data?.id, delivery_date: HOY, currency_code: 'ARS' }).select('id').single()
    const dl = await c.from('delivery_lines').insert({ company_id: ERP.id, delivery_id: d.data?.id, product_id: ERP.producto, warehouse_id: ERP.deposito, quantity: 2 })
    const conf = await c.rpc('confirmar_entrega', { p_delivery: d.data?.id })
    cmp('numerar, crear, enviar, confirmar, remito y despacho', ['OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'OK'], [nQ, q, qs, nO, o, oc, nD, d, dl, conf].map(clase))
    cmp('números del servidor', ['ZQ00100', 'ZP00200', 'ZR00300'], [nQ.data, nO.data, nD.data])
    cmp('despacho con efecto: 1 movimiento', 1, conf.data?.movimientos)
    cmp('saldo: 50 − 2 = 48', 48, Number((await s.from('stock_balances').select('on_hand').eq('product_id', ERP.producto).single()).data?.on_hand))
    cmp('secuencias ERP avanzaron 1 cada una', { ...seq0, quote: seq0.quote + 1, sales_order: seq0.sales_order + 1, delivery: seq0.delivery + 1 }, await seqDe(ERP.id))
  }

  seccion('8 · Cambio de autoridad: auditado y obedecido')
  {
    const bit0 = await cuenta('document_numbering_authority_audit', (q) => q.eq('company_id', STEL.id))
    cmp('los intentos bloqueados no dejaron filas en la bitácora (sólo las 3 del alta)', 3, bit0)
    const seq0 = await seqDe(STEL.id)
    await s.from('document_numbering_authority').update({ authority: 'ERP', reason: 'ZZ E25 cutover de prueba' }).eq('company_id', STEL.id).eq('doc_type', 'quote')
    const n = await id.admin.c.rpc('next_document_number', { p_company: STEL.id, p_doc_type: 'quote' })
    cmp('con quote → ERP, el admin numera cotizaciones', ['OK', 'ZQ00100'], [clase(n), n.data])
    cmp('sales_order y delivery siguen bloqueados', ['STEL', 'STEL'], [
      clase(await id.admin.c.rpc('next_document_number', { p_company: STEL.id, p_doc_type: 'sales_order' })),
      clase(await id.admin.c.rpc('next_document_number', { p_company: STEL.id, p_doc_type: 'delivery' })),
    ])
    await s.from('document_numbering_authority').update({ authority: 'STEL', reason: 'ZZ E25 vuelta a STEL' }).eq('company_id', STEL.id).eq('doc_type', 'quote')
    cmp('de vuelta a STEL: bloqueado otra vez', 'STEL', clase(await id.admin.c.rpc('next_document_number', { p_company: STEL.id, p_doc_type: 'quote' })))
    const { data: bit } = await s.from('document_numbering_authority_audit').select('operation, doc_type, old_authority, new_authority, jwt_role, db_role').eq('company_id', STEL.id).eq('operation', 'UPDATE').order('id')
    cmp('bitácora: STEL→ERP y ERP→STEL, con rol', [
      ['UPDATE', 'quote', 'STEL', 'ERP', 'service_role'], ['UPDATE', 'quote', 'ERP', 'STEL', 'service_role'],
    ], (bit ?? []).map((x) => [x.operation, x.doc_type, x.old_authority, x.new_authority, x.jwt_role]))
    const upd = await s.from('document_numbering_authority').update({ reason: 'ZZ E25 vuelta a STEL' }).eq('company_id', STEL.id).eq('doc_type', 'quote')
    cmp('UPDATE sin cambios no ensucia la bitácora', [null, 5], [upd.error, await cuenta('document_numbering_authority_audit', (q) => q.eq('company_id', STEL.id))])
    cmp('secuencia: sólo el número emitido durante la ventana ERP', { ...seq0, quote: seq0.quote + 1 }, await seqDe(STEL.id))
  }

  seccion('9 · Limpieza y datos reales intactos')
  await barrer()
  cmp('0 empresas zz-e25 residuales', 0, await cuenta('companies', (q) => q.like('slug', `${MARCA}-%`)))
  let residuales = 0
  for (let page = 1; ; page++) {
    const { data: us } = await s.auth.admin.listUsers({ page, perPage: 1000 })
    residuales += (us?.users ?? []).filter((u) => u.email?.startsWith(`${MARCA}-`)).length
    if ((us?.users ?? []).length < 1000) break
  }
  cmp('0 usuarios zz-e25 residuales', 0, residuales)
  const huellaDespues = await huellaReal()
  cmp('secuencias, autoridad, saldos, movimientos, reservas, eventos y documentos reales idénticos', huellaAntes, huellaDespues)

  console.log(`\n  ${fallos === 0 ? '✓ TODO PASA' : `✗ ${fallos} FALLO(S)`}\n`)
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('\n✗ Error inesperado:', e.message)
  try { await barrer() } catch { /* ya informado */ }
  process.exit(1)
})
