/**
 * Fase 17 · E5 — alta atómica, duplicados y cola de revisión.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase17-e5-clientes-cierre-tests.mjs
 *
 * Lo que prueba, midiendo el EFECTO:
 *   1. el alta crea el cliente solo, o con contacto, o con dirección, o los tres
 *   2. si algo del alta falla, NO queda nada —ni el cliente, ni la referencia—
 *   3. el CUIT repetido se rechaza, y dos altas simultáneas dejan UNA
 *   4. la whitelist: no se puede inyectar company_id, legacy_ref, needs_review…
 *   5. quién puede dar de alta, y en qué empresa
 *   6. los duplicados se PROPONEN: CUIT, email, teléfono, nombre parecido
 *   7. la búsqueda de duplicados no revela clientes que el actor no ve
 *   8. resolver una revisión deja rastro y no toca la identidad importada
 *   9. limpieza e invariantes de producción
 *
 * Todo lleva el prefijo zz-e5c y se borra al final. No toca WhatsApp.
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

const MARCA = 'zz-e5c'
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
    await s.from('sales_audit').delete().in('company_id', ids)
    await borrar('customer_addresses')
    await borrar('customer_contacts')
    await borrar('company_memberships')
    await borrar('customers')
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
  const { data: us } = await s.auth.admin.listUsers({ perPage: 1000 })
  creados.usuarios = (us?.users ?? []).filter((u) => u.email?.startsWith(`${MARCA}-`)).map((u) => u.id)
  await limpiar()
  creados.empresas = []
}

const PRODUCCION = ['buscatools', 'torquetools']

async function main() {
  console.log('='.repeat(78))
  console.log('  FASE 17 · CLIENTES E5 — alta atómica, duplicados y revisión')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(78))

  await barrerRestos()

  const { data: prodEmpresas } = await s.from('companies').select('id, slug').in('slug', PRODUCCION)
  const prodIds = prodEmpresas.map((e) => e.id)
  const baselineProd = async () => ({
    clientes: await cuenta('customers', (q) => q.in('company_id', prodIds)),
    paraRevisar: await cuenta('customers', (q) => q.in('company_id', prodIds).eq('needs_review', true)),
    contactos: await cuenta('customer_contacts', (q) => q.in('company_id', prodIds)),
    direcciones: await cuenta('customer_addresses', (q) => q.in('company_id', prodIds)),
    cotizaciones: await cuenta('sales_quotes', (q) => q.in('company_id', prodIds)),
    pedidos: await cuenta('sales_orders', (q) => q.in('company_id', prodIds)),
    adjuntos: await cuenta('attachments', (q) => q.in('company_id', prodIds)),
    auditoria: await cuenta('sales_audit', (q) => q.in('company_id', prodIds)),
  })
  const antesProd = await baselineProd()
  console.log(`  baseline producción: ${JSON.stringify(antesProd)}`)

  // ── Fixture ──────────────────────────────────────────────────────────────
  const sello = Date.now()
  const A = ok(await s.from('companies').insert({
    slug: `${MARCA}-a-${sello}`, name: 'ZZ E5C Alfa', legal_name: 'ZZ E5C Alfa SA', default_currency: 'USD',
  }).select('id').single(), 'empresa').id
  creados.empresas.push(A)
  const B = ok(await s.from('companies').insert({
    slug: `${MARCA}-b-${sello}`, name: 'ZZ E5C Beta', legal_name: 'ZZ E5C Beta SA', default_currency: 'USD',
  }).select('id').single(), 'empresa B').id
  creados.empresas.push(B)

  for (const empresa of [A, B]) {
    ok(await s.from('document_sequences').insert({
      company_id: empresa, doc_type: 'customer', series_code: 'ZC', prefix: 'ZCLI',
      padding: 5, next_number: 1, is_default: true,
    }), 'secuencia de clientes')
  }
  const tarifa = ok(await s.from('price_lists').insert({
    company_id: A, name: 'ZZ E5C Tarifa', currency_code: 'USD', is_default: false,
  }).select('id').single(), 'tarifa')

  const admin = await usuarioTemporal(A, 'admin')
  const vendedor = await usuarioTemporal(A, 'salesperson')
  const tecnico = await usuarioTemporal(A, 'technician')
  const adminB = await usuarioTemporal(B, 'admin')
  const anon = sesion()

  const alta = (c, empresa, datos, contacto = null, direccion = null) =>
    c.rpc('crear_cliente', {
      p_company: empresa, p_datos: datos, p_contacto: contacto, p_direccion: direccion,
    })

  const numeroActual = async (empresa) =>
    (await s.from('document_sequences').select('next_number')
      .eq('company_id', empresa).eq('doc_type', 'customer').single()).data.next_number

  // ── 1 · El alta progresiva ───────────────────────────────────────────────
  seccion('1 · Sólo el cliente, o con contacto, o con dirección, o los tres')

  const solo = ok(await alta(admin.c, A, { legal_name: 'ZZ Alfa Solo SA' }), 'sólo cliente')
  cmp('se crea el cliente solo', true, !!solo.id)
  cmp('con la referencia que da el servidor', 'ZCLI00001', solo.referencia)
  cmp('sin contacto ni dirección', 'null/null', `${solo.contacto_id}/${solo.direccion_id}`)

  const conContacto = ok(await alta(admin.c, A,
    { legal_name: 'ZZ Alfa Con Contacto SA' },
    { full_name: 'ZZ Ana Pérez', role: 'Compras', email: 'ANA@zz.test' },
  ), 'cliente + contacto')
  const k = (await s.from('customer_contacts').select('*').eq('id', conContacto.contacto_id).single()).data
  cmp('el contacto entra con el cliente', 'ZZ Ana Pérez/Compras/ana@zz.test',
    `${k.full_name}/${k.role}/${k.email}`)
  cmp('y nace principal, porque es el primero', true, k.is_default)

  const conDireccion = ok(await alta(admin.c, A,
    { legal_name: 'ZZ Alfa Con Dirección SA' },
    null,
    { kind: 'shipping', street: 'Av. Siempreviva 742', city: 'Springfield', country_code: 'ar' },
  ), 'cliente + dirección')
  const d = (await s.from('customer_addresses').select('*').eq('id', conDireccion.direccion_id).single()).data
  cmp('la dirección entra con el cliente', 'shipping/Av. Siempreviva 742/AR',
    `${d.kind}/${d.street}/${d.country_code}`)
  cmp('y nace principal de su tipo', true, d.is_default)

  const completo = ok(await alta(admin.c, A,
    {
      legal_name: 'ZZ Alfa Completo SA', trade_name: 'Alfa', tax_id: '30-71234567-4',
      emails: ['COMPRAS@alfa.test'], email_domains: ['alfa.test'], phone: '11 4444 5555',
      customer_type: 'business', payment_terms: '30 días', default_currency: 'USD',
      salesperson_id: vendedor.id, default_price_list_id: tarifa.id, notes: 'ZZ nota',
    },
    { full_name: 'ZZ Beto Gómez' },
    { kind: 'billing', street: 'Calle Falsa 123' },
  ), 'los tres')
  const cli = (await s.from('customers').select('*').eq('id', completo.id).single()).data
  cmp('los defaults comerciales quedan puestos desde el alta', `${vendedor.id}/${tarifa.id}`,
    `${cli.salesperson_id}/${cli.default_price_list_id}`)
  cmp('los emails se normalizan a minúscula', 'compras@alfa.test', cli.emails?.[0])
  cmp('el estado nace activo', 'active', cli.status)
  cmp('y no queda marcado para revisión', false, cli.needs_review)

  // ── 2 · O entra todo, o no entra nada ────────────────────────────────────
  seccion('2 · Si algo falla, no queda nada: ni el cliente, ni el número')

  const antesNumero = await numeroActual(A)
  const antesClientes = await cuenta('customers', (q) => q.eq('company_id', A))

  rechaza('un contacto sin nombre',
    await alta(admin.c, A, { legal_name: 'ZZ No Debe Quedar 1' }, { role: 'Compras' }),
    'NOMBRE_REQUERIDO')
  rechaza('una dirección sin calle',
    await alta(admin.c, A, { legal_name: 'ZZ No Debe Quedar 2' }, null, { kind: 'shipping' }),
    'CALLE_REQUERIDA')
  rechaza('una dirección con un tipo inventado',
    await alta(admin.c, A, { legal_name: 'ZZ No Debe Quedar 3' }, null, { kind: 'galpon', street: 'x' }),
    'TIPO_INVALIDO')
  rechaza('un cliente sin razón social',
    await alta(admin.c, A, { trade_name: 'ZZ sin razón' }), 'RAZON_SOCIAL_REQUERIDA')
  rechaza('un CUIT de diez dígitos',
    await alta(admin.c, A, { legal_name: 'ZZ No Debe Quedar 4', tax_id: '3071234567' }), 'CUIT_INVALIDO')
  rechaza('un vendedor que no es de la empresa',
    await alta(admin.c, A, { legal_name: 'ZZ No Debe Quedar 5', salesperson_id: adminB.id }),
    'VENDEDOR_INVALIDO')

  cmp('ninguno de los seis dejó un cliente', antesClientes,
    await cuenta('customers', (q) => q.eq('company_id', A)))
  cmp('ni consumió una referencia', antesNumero, await numeroActual(A))
  cmp('ni dejó contactos sueltos', 2, await cuenta('customer_contacts', (q) => q.eq('company_id', A)))
  cmp('ni direcciones sueltas', 2, await cuenta('customer_addresses', (q) => q.eq('company_id', A)))

  // ── 3 · CUIT repetido ────────────────────────────────────────────────────
  seccion('3 · Dos clientes no tienen el mismo CUIT')

  rechaza('el mismo CUIT, escrito igual',
    await alta(admin.c, A, { legal_name: 'ZZ Repetido 1', tax_id: '30-71234567-4' }),
    'CLIENTE_DUPLICADO')
  rechaza('el mismo CUIT, escrito sin guiones',
    await alta(admin.c, A, { legal_name: 'ZZ Repetido 2', tax_id: '30712345674' }),
    'CLIENTE_DUPLICADO')

  // Dos altas simultáneas: una gana, la otra recibe el mensaje en castellano.
  const cuitCarrera = '30-71999888-7'
  const carrera = await Promise.allSettled([
    alta(admin.c, A, { legal_name: 'ZZ Carrera 1', tax_id: cuitCarrera }),
    alta(admin.c, A, { legal_name: 'ZZ Carrera 2', tax_id: cuitCarrera }),
  ])
  const exitosas = carrera.filter((r) => r.status === 'fulfilled' && !r.value.error)
  const fallidas = carrera.filter((r) => r.status === 'fulfilled' && r.value.error)
  cmp('de dos altas simultáneas con el mismo CUIT, entra UNA', 1, exitosas.length)
  cmp('y la otra falla', 1, fallidas.length)
  cmp('con el mensaje traducido, no con el error crudo de Postgres', true,
    String(fallidas[0]?.value?.error?.message ?? '').includes('CLIENTE_DUPLICADO'))
  cmp('en la base quedó uno solo', 1,
    await cuenta('customers', (q) => q.eq('company_id', A).eq('tax_id', cuitCarrera)))

  // Un cliente SIN CUIT es válido, y dos sin CUIT conviven.
  ok(await alta(admin.c, A, { legal_name: 'ZZ Sin CUIT uno' }), 'sin cuit 1')
  ok(await alta(admin.c, A, { legal_name: 'ZZ Sin CUIT dos' }), 'sin cuit 2')
  cmp('dos clientes sin CUIT conviven', 2,
    await cuenta('customers', (q) => q.eq('company_id', A).like('legal_name', 'ZZ Sin CUIT%')))

  // ── 4 · Whitelist ────────────────────────────────────────────────────────
  seccion('4 · Lo que el alta no deja inyectar')

  for (const [campo, valor] of [
    ['company_id', B], ['id', randomUUID()], ['legacy_ref', 'ZCLI99999'],
    ['needs_review', true], ['review_reason', 'INVENTADO'], ['imported_at', '2020-01-01'],
    ['legacy_source', 'maestro_clientes'], ['status', 'inactive'], ['deleted_at', '2020-01-01'],
    ['created_at', '2020-01-01'], ['updated_at', '2020-01-01'], ['created_by', adminB.id],
    ['discount_pct', 10], ['credit_limit', 1000],
  ]) {
    rechaza(`inyectar ${campo}`,
      await alta(admin.c, A, { legal_name: 'ZZ Inyección', [campo]: valor }), 'CAMPO_NO_EDITABLE')
  }
  rechaza('inyectar un campo en el contacto',
    await alta(admin.c, A, { legal_name: 'ZZ Inyección' }, { full_name: 'x', is_default: false }),
    'CAMPO_NO_EDITABLE')
  rechaza('inyectar un campo en la dirección',
    await alta(admin.c, A, { legal_name: 'ZZ Inyección' }, null, { kind: 'other', street: 'x', active: false }),
    'CAMPO_NO_EDITABLE')

  // ── 5 · Permisos ─────────────────────────────────────────────────────────
  seccion('5 · Quién da de alta')

  const delVendedor = await alta(vendedor.c, A, { legal_name: 'ZZ Del vendedor' })
  cmp('el vendedor da de alta', true, !delVendedor.error)
  rechaza('el técnico no', await alta(tecnico.c, A, { legal_name: 'ZZ Del técnico' }), 'SIN_PERMISO')
  rechaza('el admin de otra empresa, tampoco',
    await alta(adminB.c, A, { legal_name: 'ZZ De otra empresa' }), 'SIN_PERMISO')
  rechaza('anónimo', await alta(anon, A, { legal_name: 'ZZ Anónimo' }))
  cmp('la empresa B sigue vacía', 0, await cuenta('customers', (q) => q.eq('company_id', B)))

  // ── 6 · Duplicados: proponer, no decidir ─────────────────────────────────
  seccion('6 · Los duplicados se proponen')

  const similares = (c, args) => c.rpc('clientes_similares', { p_company: A, p_limite: 10, ...args })

  const porCuit = ok(await similares(admin.c, { p_cuit: '30712345674' }), 'por cuit')
  cmp('el mismo CUIT es una coincidencia fuerte', 'fuerte', porCuit[0]?.fuerza)
  cmp('y señala al cliente que ya existe', completo.id, porCuit[0]?.id)

  const porEmail = ok(await similares(admin.c, { p_email: 'compras@alfa.test' }), 'por email')
  cmp('el mismo email es una coincidencia media', 'media', porEmail[0]?.fuerza)
  cmp('con su motivo', 'EMAIL', porEmail[0]?.motivo)

  const porTel = ok(await similares(admin.c, { p_telefono: '1144445555' }), 'por teléfono')
  cmp('el teléfono se compara por sus dígitos', 'TELEFONO', porTel[0]?.motivo)

  const porNombre = ok(await similares(admin.c, { p_nombre: 'ZZ Alfa Completo S.A.' }), 'por nombre')
  cmp('un nombre parecido es una coincidencia débil', 'debil',
    porNombre.find((x) => x.id === completo.id)?.fuerza)

  cmp('un nombre que no se parece a nada no devuelve nada', 0,
    (ok(await similares(admin.c, { p_nombre: 'Panadería Los Tilos' }), 'sin parecido')).length)
  cmp('dos letras no alcanzan para buscar por nombre', 0,
    (ok(await similares(admin.c, { p_nombre: 'ZZ' }), 'muy corto')).length)
  cmp('un cliente no es candidato a duplicado de sí mismo', 0,
    (ok(await similares(admin.c, { p_cuit: '30712345674', p_excluir: completo.id }), 'excluir')).length)

  const porTodo = ok(await similares(admin.c, {
    p_cuit: '30712345674', p_email: 'compras@alfa.test', p_nombre: 'ZZ Alfa Completo SA',
  }), 'todas las señales')
  cmp('un cliente que coincide por tres señales aparece UNA vez', 1,
    porTodo.filter((x) => x.id === completo.id).length)
  cmp('y con el motivo más fuerte', 'CUIT', porTodo.find((x) => x.id === completo.id)?.motivo)

  // ── 7 · La búsqueda no revela lo que no se puede ver ─────────────────────
  seccion('7 · Buscar duplicados no es una puerta trasera')

  // El cliente «completo» tiene a este vendedor asignado, así que verlo es lo
  // correcto: es suyo. El aislamiento se prueba con uno que no lo es.
  const ajeno = ok(await alta(admin.c, A, {
    legal_name: 'ZZ De nadie SA', tax_id: '30-71777666-5',
  }), 'cliente de nadie')
  cmp('el vendedor SÍ ve el cliente que tiene asignado', 1,
    (ok(await similares(vendedor.c, { p_cuit: '30712345674' }), 'suyo por cuit')).length)
  cmp('pero NO ve por CUIT uno que no es suyo', 0,
    (ok(await similares(vendedor.c, { p_cuit: '30717776665' }), 'ajeno')).length)
  cmp('ni por email', 0,
    (ok(await similares(vendedor.c, { p_email: 'compras@alfa.test', p_excluir: completo.id }), 'ajeno email')).length)
  cmp('y el admin sí lo ve', 1,
    (ok(await similares(admin.c, { p_cuit: '30717776665' }), 'admin ve')).length)
  void ajeno

  const suyo = (await s.from('customers').select('id, tax_id').eq('legal_name', 'ZZ Del vendedor').single()).data
  ok(await s.from('customers').update({ tax_id: '30-71555444-3' }).eq('id', suyo.id), 'cuit al suyo')
  cmp('pero sí el suyo', 1,
    (ok(await similares(vendedor.c, { p_cuit: '30715554443' }), 'suyo')).length)

  cmp('el técnico no ve ninguno', 0,
    (ok(await similares(tecnico.c, { p_cuit: '30712345674' }), 'técnico')).length)
  cmp('tampoco el de nadie', 0,
    (ok(await similares(tecnico.c, { p_cuit: '30717776665' }), 'técnico 2')).length)
  cmp('el admin de otra empresa, tampoco', 0,
    (ok(await adminB.c.rpc('clientes_similares', { p_company: A, p_cuit: '30712345674' }), 'otra empresa')).length)
  rechaza('anónimo ni puede llamarla', await anon.rpc('clientes_similares', { p_company: A, p_cuit: '30712345674' }))

  // ── 8 · Resolver una revisión ────────────────────────────────────────────
  seccion('8 · Dar por revisado deja rastro')

  const marcado = ok(await alta(admin.c, A, { legal_name: 'ZZ Para revisar SA' }), 'cliente a marcar')
  // Marcar es cosa del importador: se hace con la clave de servicio, que es la
  // única que puede escribir la marca directamente.
  ok(await s.from('customers').update({
    needs_review: true, review_reason: 'VARIOS_LEGACY_AL_MISMO_CLIENTE | SOLO_EN_CONTACTOS',
    imported_at: new Date().toISOString(), legacy_source: 'maestro_clientes', legacy_ref: 'ZCLI-LEGACY',
  }).eq('id', marcado.id), 'marcar')

  const r1 = ok(await admin.c.rpc('resolver_revision_cliente', {
    p_customer: marcado.id, p_motivos: ['SOLO_EN_CONTACTOS'],
  }), 'resolver uno')
  cmp('resolver un motivo deja el otro', 'VARIOS_LEGACY_AL_MISMO_CLIENTE', r1.motivos_restantes?.[0])
  cmp('y el cliente sigue marcado', true,
    (await s.from('customers').select('needs_review').eq('id', marcado.id).single()).data.needs_review)

  const evento = (await s.from('sales_audit').select('*')
    .eq('entity_id', marcado.id).eq('action', 'review_resolved').single()).data
  cmp('queda un evento de auditoría', true, !!evento)
  cmp('que dice QUÉ motivo se resolvió', 'SOLO_EN_CONTACTOS', evento?.diff?.resueltos?.[0])
  cmp('y quién lo resolvió', admin.id, evento?.actor_id)

  const r2 = ok(await admin.c.rpc('resolver_revision_cliente', { p_customer: marcado.id }), 'resolver todo')
  cmp('sin motivos se resuelven todos', 0, (r2.motivos_restantes ?? []).length)
  const yaNo = (await s.from('customers').select('needs_review, review_reason, legacy_ref, legacy_source, imported_at')
    .eq('id', marcado.id).single()).data
  cmp('el cliente deja de estar marcado', 'false/null', `${yaNo.needs_review}/${yaNo.review_reason}`)
  cmp('y su identidad importada NO se tocó', 'ZCLI-LEGACY/maestro_clientes/true',
    `${yaNo.legacy_ref}/${yaNo.legacy_source}/${yaNo.imported_at !== null}`)

  const r3 = ok(await admin.c.rpc('resolver_revision_cliente', { p_customer: marcado.id }), 'resolver de nuevo')
  cmp('resolver lo ya resuelto no es un cambio', true, r3.sin_cambios)
  // Dos resoluciones reales dejaron dos eventos; la tercera, que no resolvió
  // nada, no dejó ninguno.
  cmp('quedan dos eventos, uno por cada resolución real', 2,
    await cuenta('sales_audit', (q) => q.eq('entity_id', marcado.id).eq('action', 'review_resolved')))

  rechaza('el vendedor no resuelve revisiones',
    await vendedor.c.rpc('resolver_revision_cliente', { p_customer: marcado.id }), 'permiso')
  rechaza('el admin de otra empresa, tampoco',
    await adminB.c.rpc('resolver_revision_cliente', { p_customer: marcado.id }), 'permiso')

  // ── 9 · Limpieza e invariantes ───────────────────────────────────────────
  seccion('9 · Limpieza e invariantes')

  await limpiar()
  cmp('sin empresas de fixture', 0,
    (await s.from('companies').select('id', { count: 'exact', head: true }).like('slug', `${MARCA}-%`)).count)

  const despues = await baselineProd()
  cmp('producción idéntica al baseline', JSON.stringify(antesProd), JSON.stringify(despues))

  console.log('\n' + '='.repeat(78))
  console.log(`  RESULTADO: ${fallos === 0 ? '0 FALLOS' : fallos + ' FALLO(S)'}`)
  console.log('='.repeat(78))
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('\n✗ ERROR:', e.message)
  try { await limpiar() } catch (x) { console.error('  y la limpieza falló:', x.message) }
  process.exit(1)
})
