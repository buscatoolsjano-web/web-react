/**
 * Fase 15 · E3 — el alta atómica de la cotización, contra la base.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase15-e3-crear-cotizacion-tests.mjs
 *
 * Lo que prueba, midiendo el EFECTO:
 *   1. crear: número, estado, líneas renumeradas, totales del servidor y auditoría
 *   2. rollback: una línea inválida no deja NADA, ni siquiera el número consumido
 *   3. validaciones: cliente, contacto, vendedor, tarifa, moneda, producto, cantidad…
 *   4. campos inyectados: company_id, number, status, totales, created_by…
 *   5. permisos: anon, vendedor, técnico, cliente del portal y admin de otra empresa
 *   6. autoridad de numeración: con STEL no se crea y no se consume número
 *   7. la tarifa queda registrada y su moneda tiene que coincidir
 *   8. las mismas reglas que `guardar_cotizacion`, con los mismos códigos
 *
 * Todo lleva el prefijo zz-e3 y se borra al final. No toca WhatsApp ni ningún
 * documento productivo: la empresa es de fixture y tiene su propia serie.
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

const MARCA = 'zz-e3'
const creados = { usuarios: [], empresas: [] }
const ok = (r, q) => { if (r.error) throw new Error(`${q}: ${r.error.message}`); return r.data }
const cuenta = async (t, filtro = (q) => q) => (await filtro(s.from(t).select('*', { count: 'exact', head: true }))).count

const usuarioTemporal = async (companyId, rol, customerId = null) => {
  const email = `${MARCA}-${rol}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@buscatools.test`
  const password = `Zz${randomUUID()}!`
  const { data, error } = await s.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`crear ${rol}: ${error.message}`)
  creados.usuarios.push(data.user.id)
  const fila = { company_id: companyId, user_id: data.user.id, role: rol, status: 'active' }
  if (customerId) fila.customer_id = customerId
  ok(await s.from('company_memberships').insert(fila), `membresía ${rol}`)
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
    await borrar('sales_quotes')
    await borrar('product_prices')
    await borrar('price_lists')
    await borrar('products')
    await borrar('product_categories')
    await borrar('document_numbering_authority')
    await borrar('document_sequences')
    await borrar('company_memberships')
    await borrar('customer_contacts')
    await borrar('customers')
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
  console.log('  FASE 15 · VENTAS E3 — alta atómica de la cotización')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(78))

  await barrerRestos()

  const { data: prodEmpresas } = await s.from('companies').select('id, slug').in('slug', PRODUCCION)
  const prodIds = prodEmpresas.map((e) => e.id)
  const baseProd = {
    quotes: await cuenta('sales_quotes', (q) => q.in('company_id', prodIds)),
    lineas: await cuenta('sales_quote_lines', (q) => q.in('company_id', prodIds)),
    pedidos: await cuenta('sales_orders', (q) => q.in('company_id', prodIds)),
    entregas: await cuenta('deliveries', (q) => q.in('company_id', prodIds)),
    auditoria: await cuenta('sales_audit', (q) => q.in('company_id', prodIds)),
    stock: await cuenta('stock_movements', (q) => q.in('company_id', prodIds)),
    secuencias: (await s.from('document_sequences').select('next_number').in('company_id', prodIds)).data?.map((x) => x.next_number).join(',') ?? '',
    autoridad: (await s.from('document_numbering_authority').select('doc_type, authority').in('company_id', prodIds)).data?.map((x) => `${x.doc_type}:${x.authority}`).sort().join(',') ?? '',
  }
  console.log(`  baseline producción: ${JSON.stringify(baseProd)}`)

  // ── Fixture ──────────────────────────────────────────────────────────────
  const sello = Date.now()
  const empresa = async (k, nombre) => {
    const e = ok(await s.from('companies').insert({
      slug: `${MARCA}-${k}-${sello}`, name: nombre, legal_name: `${nombre} SA`, default_currency: 'USD',
    }).select('id').single(), `empresa ${k}`)
    creados.empresas.push(e.id)
    ok(await s.from('document_sequences').insert({
      company_id: e.id, doc_type: 'quote', series_code: `ZZ${k.toUpperCase()}`, prefix: `ZZ${k.toUpperCase()}`,
      padding: 5, next_number: 1, is_default: true,
    }), `secuencia ${k}`)
    return e.id
  }
  const A = await empresa('a', 'ZZ E3 Alfa')
  const B = await empresa('b', 'ZZ E3 Beta')

  const listaBase = ok(await s.from('price_lists').insert({
    company_id: A, name: 'ZZ Base', currency_code: 'USD', is_default: true, valid_from: '2026-01-01',
  }).select('id').single(), 'lista base')
  const listaMayorista = ok(await s.from('price_lists').insert({
    company_id: A, name: 'ZZ Mayorista', currency_code: 'USD', is_default: false, valid_from: '2026-01-01',
  }).select('id').single(), 'lista mayorista')
  const listaPesos = ok(await s.from('price_lists').insert({
    company_id: A, name: 'ZZ Pesos', currency_code: 'ARS', is_default: false, valid_from: '2026-01-01',
  }).select('id').single(), 'lista pesos')
  const listaB = ok(await s.from('price_lists').insert({
    company_id: B, name: 'ZZ Otra empresa', currency_code: 'USD', is_default: true, valid_from: '2026-01-01',
  }).select('id').single(), 'lista B')

  const categoria = ok(await s.from('product_categories').insert({
    company_id: A, name: 'ZZ E3 Categoría', slug: `${MARCA}-cat-${sello}`, position: 1, needs_review: false,
  }).select('id').single(), 'categoría A')
  const categoriaB = ok(await s.from('product_categories').insert({
    company_id: B, name: 'ZZ E3 Categoría B', slug: `${MARCA}-cat-b-${sello}`, position: 1, needs_review: false,
  }).select('id').single(), 'categoría B')
  const producto = ok(await s.from('products').insert({
    company_id: A, category_id: categoria.id, sku: `${MARCA}-P1-${sello}`, name: 'ZZ Balanceador', status: 'active', attributes: {},
  }).select('id').single(), 'producto A')
  const productoB = ok(await s.from('products').insert({
    company_id: B, category_id: categoriaB.id, sku: `${MARCA}-PB-${sello}`, name: 'ZZ Producto de B', status: 'active', attributes: {},
  }).select('id').single(), 'producto B')
  ok(await s.from('product_prices').insert([
    { company_id: A, price_list_id: listaBase.id, product_id: producto.id, amount: 100, valid_from: '2026-01-01' },
    { company_id: A, price_list_id: listaMayorista.id, product_id: producto.id, amount: 80, valid_from: '2026-01-01' },
  ]), 'precios')

  const cliente = ok(await s.from('customers').insert({
    company_id: A, legal_name: 'ZZ E3 Cliente SA', status: 'active',
  }).select('id').single(), 'cliente')
  const otroCliente = ok(await s.from('customers').insert({
    company_id: A, legal_name: 'ZZ E3 Otro Cliente SA', status: 'active',
  }).select('id').single(), 'otro cliente')
  const clienteB = ok(await s.from('customers').insert({
    company_id: B, legal_name: 'ZZ E3 Cliente de B SA', status: 'active',
  }).select('id').single(), 'cliente B')
  const contacto = ok(await s.from('customer_contacts').insert({
    company_id: A, customer_id: cliente.id, full_name: 'ZZ Contacto', role: 'Compras',
  }).select('id').single(), 'contacto')
  const contactoAjeno = ok(await s.from('customer_contacts').insert({
    company_id: A, customer_id: otroCliente.id, full_name: 'ZZ Contacto ajeno', role: 'Compras',
  }).select('id').single(), 'contacto ajeno')

  const admin = await usuarioTemporal(A, 'admin')
  const employee = await usuarioTemporal(A, 'employee')
  const vendedor = await usuarioTemporal(A, 'salesperson')
  const tecnico = await usuarioTemporal(A, 'technician')
  const portal = await usuarioTemporal(A, 'customer', cliente.id)
  const adminB = await usuarioTemporal(B, 'admin')
  const anon = sesion()

  const crear = (c, cabecera, lineas = [], empresaId = A) =>
    c.rpc('crear_cotizacion', { p_company: empresaId, p_cabecera: cabecera, p_lineas: lineas })
  const CABECERA = { customer_id: cliente.id, currency_code: 'USD' }
  const LINEA = {
    line_type: 'item', product_id: producto.id, sku_snapshot: 'ZZ-1', name_snapshot: 'ZZ Balanceador',
    quantity: 2, unit_price: 100, discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21,
  }
  const secuencia = async () => (await s.from('document_sequences').select('next_number').eq('company_id', A).eq('doc_type', 'quote').single()).data.next_number

  // ── 1 · Crear ────────────────────────────────────────────────────────────
  seccion('1 · Crear: número, líneas, totales y auditoría')

  const antesNum = await secuencia()
  const r1 = ok(await crear(admin.c, {
    ...CABECERA, contact_id: contacto.id, salesperson_id: employee.id, price_list_id: listaMayorista.id,
    title: 'ZZ Primera', payment_terms: '30 días', notes: 'ZZ nota', discount_pct: 0, perception_pct: 0,
    quote_date: '2026-09-17', valid_until: '2026-09-30',
  }, [
    LINEA,
    { ...LINEA, sku_snapshot: 'ZZ-2', quantity: 1, unit_price: 50, discount_pct: 10 },
    { line_type: 'chapter', name_snapshot: 'ZZ Capítulo', quantity: 1, unit_price: 0, tax_treatment: 'not_taxed', tax_rate_snapshot: 0 },
  ]), 'crear')
  cmp('devuelve id, número y total', true, !!r1.id && typeof r1.number === 'string' && Number(r1.total) > 0)
  cmp('el número sale de la serie de la empresa', `ZZA${String(antesNum).padStart(5, '0')}`, r1.number)
  cmp('la secuencia avanzó UNA vez', antesNum + 1, await secuencia())

  const q1 = ok(await s.from('sales_quotes').select('*').eq('id', r1.id).single(), 'leer q1')
  cmp('nace en borrador', 'draft', q1.status)
  cmp('la empresa la pone el servidor', A, q1.company_id)
  cmp('serie del servidor', 'ZZA', q1.series_code)
  cmp('guarda cliente, contacto, vendedor y tarifa', `${cliente.id}/${contacto.id}/${employee.id}/${listaMayorista.id}`,
    `${q1.customer_id}/${q1.contact_id}/${q1.salesperson_id}/${q1.price_list_id}`)
  cmp('sin external_id ni imported_at', 'null/null', `${q1.external_id}/${q1.imported_at}`)
  cmp('created_by es quien creó', admin.id, q1.created_by)

  const lineas1 = ok(await s.from('sales_quote_lines').select('*').eq('quote_id', r1.id).order('line_no'), 'líneas')
  cmp('tres líneas, renumeradas 1..3', '1,2,3', lineas1.map((l) => l.line_no).join(','))
  // 2×100 + 1×50×0,9 = 245; el capítulo no suma.
  cmp('subtotal calculado por el servidor', '245.00', Number(q1.subtotal).toFixed(2))
  cmp('impuesto calculado por el servidor', '51.45', Number(q1.tax_amount).toFixed(2))
  cmp('total calculado por el servidor', '296.45', Number(q1.total).toFixed(2))

  const audit = ok(await s.from('sales_audit').select('*').eq('entity_id', r1.id), 'auditoría')
  cmp('un solo evento de creación', 1, audit.length)
  cmp('el evento es «created», con actor y estado', 'created/draft', `${audit[0].action}/${audit[0].to_status}`)
  cmp('el actor es quien creó', admin.id, audit[0].actor_id)
  cmp('la auditoría guarda las líneas y el total', true,
    Array.isArray(audit[0].diff.lineas) && audit[0].diff.lineas.length === 3 && Number(audit[0].diff.total) === Number(q1.total))
  cmp('la auditoría guarda el número', r1.number, audit[0].diff.numero)

  const r2 = ok(await crear(employee.c, CABECERA, [LINEA]), 'crear employee')
  cmp('un employee también crea, con el número siguiente', `ZZA${String(antesNum + 1).padStart(5, '0')}`, r2.number)
  cmp('sin líneas también se puede crear', true, !!ok(await crear(admin.c, CABECERA, []), 'sin líneas').id)

  // ── 2 · Rollback ─────────────────────────────────────────────────────────
  seccion('2 · Rollback: o queda todo, o no queda nada')

  const antesRollback = { quotes: await cuenta('sales_quotes', (q) => q.eq('company_id', A)), num: await secuencia() }
  rechaza('una línea con cantidad 0 tira todo abajo',
    await crear(admin.c, CABECERA, [LINEA, { ...LINEA, quantity: 0 }]), 'CANTIDAD_INVALIDA')
  cmp('no quedó ninguna cotización a medias', antesRollback.quotes, await cuenta('sales_quotes', (q) => q.eq('company_id', A)))
  cmp('tampoco se consumió el número', antesRollback.num, await secuencia())

  rechaza('descuento fuera de rango', await crear(admin.c, CABECERA, [{ ...LINEA, discount_pct: 150 }]), 'DESCUENTO_INVALIDO')
  rechaza('precio negativo', await crear(admin.c, CABECERA, [{ ...LINEA, unit_price: -1 }]), 'PRECIO_INVALIDO')
  rechaza('producto de otra empresa', await crear(admin.c, CABECERA, [{ ...LINEA, product_id: productoB.id }]), 'PRODUCTO_INVALIDO')
  rechaza('tratamiento impositivo inventado', await crear(admin.c, CABECERA, [{ ...LINEA, tax_treatment: 'zz_inventado' }]))
  rechaza('tipo de línea inventado', await crear(admin.c, CABECERA, [{ ...LINEA, line_type: 'zz' }]))
  rechaza('las líneas tienen que ser una lista', await crear(admin.c, CABECERA, { linea: 1 }), 'LINEAS_INVALIDAS')
  cmp('después de todos los rechazos, nada creado y número intacto',
    `${antesRollback.quotes}/${antesRollback.num}`,
    `${await cuenta('sales_quotes', (q) => q.eq('company_id', A))}/${await secuencia()}`)

  // ── 3 · Validaciones de negocio ──────────────────────────────────────────
  seccion('3 · Validaciones: las mismas que el guardado de E2')

  rechaza('sin cliente', await crear(admin.c, { currency_code: 'USD' }), 'CLIENTE_REQUERIDO')
  rechaza('sin moneda (no hay USD por defecto)', await crear(admin.c, { customer_id: cliente.id }), 'DOCUMENT_CURRENCY_REQUIRED')
  rechaza('cliente de otra empresa', await crear(admin.c, { customer_id: clienteB.id, currency_code: 'USD' }), 'CLIENTE_INVALIDO')
  rechaza('contacto de otro cliente', await crear(admin.c, { ...CABECERA, contact_id: contactoAjeno.id }), 'CONTACTO_DE_OTRO_CLIENTE')
  rechaza('vendedor que no es de la empresa', await crear(admin.c, { ...CABECERA, salesperson_id: adminB.id }), 'VENDEDOR_INVALIDO')
  rechaza('tarifa de otra empresa', await crear(admin.c, { ...CABECERA, price_list_id: listaB.id }), 'TARIFA_INVALIDA')
  rechaza('tarifa en otra moneda', await crear(admin.c, { ...CABECERA, price_list_id: listaPesos.id }), 'TARIFA_OTRA_MONEDA')
  const conPesos = ok(await crear(admin.c, { customer_id: cliente.id, currency_code: 'ARS', price_list_id: listaPesos.id }), 'ARS')
  cmp('la misma tarifa SÍ entra si el documento está en su moneda', listaPesos.id,
    (await s.from('sales_quotes').select('price_list_id').eq('id', conPesos.id).single()).data.price_list_id)

  // ── 4 · Campos inyectados ────────────────────────────────────────────────
  seccion('4 · Campos que el cliente no puede mandar')

  for (const [campo, valor] of [
    ['company_id', B], ['number', 'ZZ-INYECTADO'], ['series_code', 'ZZX'], ['status', 'accepted'],
    ['created_by', adminB.id], ['external_id', 'zz-externo'], ['imported_at', '2020-01-01T00:00:00Z'],
    ['subtotal', 1], ['tax_amount', 1], ['total', 999999], ['needs_review', true], ['approved_by', adminB.id],
  ]) {
    rechaza(`cabecera con ${campo}`, await crear(admin.c, { ...CABECERA, [campo]: valor }), 'CAMPO_NO_PERMITIDO')
  }
  const { data: inyectadas } = await s.from('sales_quotes').select('id').eq('company_id', A).eq('status', 'accepted')
  cmp('ninguna cotización quedó en un estado inyectado', 0, inyectadas.length)

  // ── 5 · Permisos ─────────────────────────────────────────────────────────
  seccion('5 · Quién puede crear')

  rechaza('anon no crea', await crear(anon, CABECERA))
  rechaza('un vendedor no crea', await crear(vendedor.c, CABECERA), 'SIN_PERMISO')
  rechaza('un técnico no crea', await crear(tecnico.c, CABECERA), 'SIN_PERMISO')
  rechaza('un cliente del portal no crea', await crear(portal.c, CABECERA), 'SIN_PERMISO')
  rechaza('el admin de otra empresa no crea acá', await crear(adminB.c, CABECERA), 'SIN_PERMISO')
  rechaza('ni mandando su propia empresa con un cliente ajeno',
    await crear(adminB.c, { customer_id: cliente.id, currency_code: 'USD' }, [], B), 'CLIENTE_INVALIDO')
  rechaza('sin empresa', await crear(admin.c, CABECERA, [], null), 'EMPRESA_REQUERIDA')

  // ── 6 · Autoridad de numeración ──────────────────────────────────────────
  seccion('6 · Autoridad: si numera STEL, no se crea')

  ok(await s.from('document_numbering_authority').insert({
    company_id: A, doc_type: 'quote', authority: 'STEL', reason: 'ZZ E3 prueba',
  }), 'autoridad STEL')
  const antesStel = { quotes: await cuenta('sales_quotes', (q) => q.eq('company_id', A)), num: await secuencia() }
  rechaza('con autoridad STEL el alta se rechaza', await crear(admin.c, CABECERA, [LINEA]), 'external_numbering_authority')
  cmp('no se creó nada ni se consumió número',
    `${antesStel.quotes}/${antesStel.num}`,
    `${await cuenta('sales_quotes', (q) => q.eq('company_id', A))}/${await secuencia()}`)
  ok(await s.from('document_numbering_authority').delete().eq('company_id', A).eq('doc_type', 'quote'), 'quitar autoridad')
  cmp('vuelta a ERP: se puede crear de nuevo', true, !!ok(await crear(admin.c, CABECERA, [LINEA]), 'crear tras ERP').id)

  // ── 7 · Dos altas seguidas ───────────────────────────────────────────────
  seccion('7 · Dos altas seguidas: dos documentos, dos números')

  const [a1, a2] = await Promise.all([crear(admin.c, CABECERA, [LINEA]), crear(admin.c, CABECERA, [LINEA])])
  const n1 = ok(a1, 'alta paralela 1'), n2 = ok(a2, 'alta paralela 2')
  cmp('ids distintos', true, n1.id !== n2.id)
  cmp('números distintos: la serie no repite', true, n1.number !== n2.number)

  // ── 8 · Invariantes ──────────────────────────────────────────────────────
  seccion('8 · Limpieza e invariantes')

  const { data: todas } = await s.from('sales_quotes').select('id, status, company_id').eq('company_id', A)
  cmp('todas las creadas son borradores de la empresa de fixture', true,
    todas.every((q) => q.status === 'draft' && q.company_id === A))

  await limpiar()
  creados.empresas = []
  cmp('sin empresas de fixture', 0, await cuenta('companies', (q) => q.like('slug', `${MARCA}-%`)))

  const despues = {
    quotes: await cuenta('sales_quotes', (q) => q.in('company_id', prodIds)),
    lineas: await cuenta('sales_quote_lines', (q) => q.in('company_id', prodIds)),
    pedidos: await cuenta('sales_orders', (q) => q.in('company_id', prodIds)),
    entregas: await cuenta('deliveries', (q) => q.in('company_id', prodIds)),
    auditoria: await cuenta('sales_audit', (q) => q.in('company_id', prodIds)),
    stock: await cuenta('stock_movements', (q) => q.in('company_id', prodIds)),
    secuencias: (await s.from('document_sequences').select('next_number').in('company_id', prodIds)).data?.map((x) => x.next_number).join(',') ?? '',
    autoridad: (await s.from('document_numbering_authority').select('doc_type, authority').in('company_id', prodIds)).data?.map((x) => `${x.doc_type}:${x.authority}`).sort().join(',') ?? '',
  }
  cmp('producción idéntica al baseline', JSON.stringify(baseProd), JSON.stringify(despues))
}

main()
  .catch(async (e) => {
    fallos++
    console.log(`\n  EXCEPCIÓN: ${e.message}`)
    await limpiar().catch(() => {})
  })
  .finally(() => {
    console.log('\n' + '='.repeat(78))
    console.log(`  RESULTADO: ${fallos} FALLOS`)
    console.log('='.repeat(78))
    process.exit(fallos ? 1 : 0)
  })
