/**
 * Fase 9 · Emails — entrega 4: la bandeja, contra la base real.
 *
 * Lo que prueba, con JWT reales de siete identidades:
 *
 *   · la RPC de la bandeja (RLS, paginación estable, cada filtro, la búsqueda)
 *   · el no leído POR USUARIO
 *   · asignación y estado: por RPC, con evento sólo cuando algo cambia
 *   · `assigned_to` NO da acceso
 *   · el CRM: sugerencias exacto / dominio / ambiguo, y el vínculo cruzado rechazado
 *   · las RPC endurecidas: un hilo inexistente ya no crea estado
 *   · Realtime: el admin recibe, el vendedor no
 *   · el servicio de contenido (si `EMAILS_API_URL` está definido): cada rol
 *   · el DRY RUN de los 91 estados legacy — sin aplicar nada
 *
 * Mide EFECTOS, no códigos: con PostgREST una operación prohibida puede volver
 * con 200 y cero filas.
 *
 * Se limpia sola: prefijo `ZZ-E4`. No toca datos productivos: el índice de
 * info@ se mide antes y después.
 *
 *   set -a; source .env; source .env.migration; source .env.rls.txt; set +a
 *   node scripts/fase9-emails-entrega4-tests.mjs
 *
 * NO canalizar por `head` y NO correrla en paralelo con otra suite de base.
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
const API = process.env.EMAILS_API_URL ?? null
const BACKUP_ESTADOS =
  process.env.BACKUP_ESTADOS ?? 'C:/Users/janog/backups-legacy/emails-2026-09-11/estados-de-trabajo.json'
if (!BASE || !PUB || !SECRET) { console.error('✗ Faltan variables de entorno'); process.exit(1) }

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(72)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const INFO = (t, d = '') => console.log(`    INFO  ${t}${d ? ' — ' + d : ''}`)
const cmp = (t, esperado, real) =>
  JSON.stringify(esperado) === JSON.stringify(real) ? PASS(t, JSON.stringify(real).slice(0, 90))
    : FAIL(t, `esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`)
const rechaza = (t, r) => r.error ? PASS(t, r.error.code ?? String(r.error.message).slice(0, 56))
                                  : FAIL(`SE PERMITIÓ: ${t}`)
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

const sesion = () => createClient(BASE, PUB, { auth: { persistSession: false } })
const s = createClient(BASE, SECRET, { auth: { persistSession: false } })

const MARCA = 'ZZ-E4'
const PROD_ACCOUNT = '053b871c-a451-497c-bd4a-c7678f7b697b'
const TABLAS = ['email_accounts', 'email_threads', 'email_thread_state', 'email_thread_reads', 'email_events', 'email_sync_log']
const creados = { usuarios: [], empresas: [], cuentas: [], clientes: [] }
const q = async (t, filtro) => {
  let consulta = s.from(t).select('*', { count: 'exact', head: true })
  if (filtro) consulta = filtro(consulta)
  return (await consulta).count
}

const usuarioTemporal = async (companyId, rol, nombre, customerId = null) => {
  const email = `zz-e4-${rol}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@buscatools.test`
  const password = `Zz${randomUUID()}!`
  const { data, error } = await s.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`crear ${rol}: ${error.message}`)
  creados.usuarios.push(data.user.id)
  await s.from('profiles').update({ full_name: `${MARCA} ${nombre}` }).eq('id', data.user.id)
  const fila = { company_id: companyId, user_id: data.user.id, role: rol, status: 'active' }
  if (customerId) fila.customer_id = customerId
  const { error: eM } = await s.from('company_memberships').insert(fila)
  if (eM) throw new Error(`membresía ${rol}: ${eM.message}`)
  const c = sesion()
  const { data: sesionData, error: eL } = await c.auth.signInWithPassword({ email, password })
  if (eL) throw new Error(`login ${rol}: ${eL.message}`)
  return { id: data.user.id, c, jwt: sesionData.session.access_token }
}

const barrer = async () => {
  const { data: viejas } = await s.from('companies').select('id').like('slug', 'zz-e4-%')
  const idsEmp = (viejas ?? []).map((x) => x.id)
  const { data: cuentas } = await s.from('email_accounts').select('id').like('email_address', 'zz-e4-%')
  for (const c of cuentas ?? []) {
    for (const t of ['email_thread_reads', 'email_events', 'email_sync_log', 'email_thread_state', 'email_threads']) {
      await s.from(t).delete().eq('account_id', c.id)
    }
    await s.from('email_accounts').delete().eq('id', c.id)
  }
  const { data: us } = await s.auth.admin.listUsers({ perPage: 1000 })
  for (const u of us?.users ?? []) {
    if (u.email?.startsWith('zz-e4-')) {
      await s.from('company_memberships').delete().eq('user_id', u.id)
      await s.auth.admin.deleteUser(u.id)
    }
  }
  if (idsEmp.length) {
    await s.from('company_memberships').delete().in('company_id', idsEmp)
    await s.from('customer_contacts').delete().in('company_id', idsEmp)
    await s.from('customers').delete().in('company_id', idsEmp)
    await s.from('companies').delete().in('id', idsEmp)
    console.log(`  (se barrieron ${idsEmp.length} empresa(s) de una corrida anterior)`)
  }
}

const bandeja = async (cli, companyId, args = {}) => {
  const { data, error } = await cli.rpc('listar_bandeja_email', { p_company: companyId, ...args })
  if (error) return { error, filas: [] }
  return { filas: data ?? [], total: Number(data?.[0]?.total ?? 0), sinLeer: Number(data?.[0]?.total_sin_leer ?? 0) }
}
const ids = (r) => r.filas.map((f) => f.gmail_thread_id)

const main = async () => {
  await barrer()
  const antes = {}
  for (const t of TABLAS) antes[t] = await q(t)
  const prodAntes = {
    hilos: await q('email_threads', (c) => c.eq('account_id', PROD_ACCOUNT)),
    estados: await q('email_thread_state', (c) => c.eq('account_id', PROD_ACCOUNT)),
    eventos: await q('email_events', (c) => c.eq('account_id', PROD_ACCOUNT)),
  }
  const clientesAntes = await q('customers')

  // ══════════════════════════════════════════════════════════════════════
  seccion('1 · Fixtures: dos empresas, ocho identidades, doce hilos')
  const nuevaEmpresa = async (suf) => {
    const { data, error } = await s.from('companies')
      .insert({ slug: `zz-e4-${suf}-${Date.now()}`, name: `${MARCA} ${suf}`, default_currency: 'ARS' })
      .select('id').single()
    if (error) throw new Error(`empresa ${suf}: ${error.message}`)
    creados.empresas.push(data.id)
    return data.id
  }
  const ZZ = await nuevaEmpresa('propia')
  const ZZ2 = await nuevaEmpresa('ajena')

  const cliente = async (companyId, legal, extra = {}) => {
    const { data, error } = await s.from('customers')
      .insert({ company_id: companyId, legal_name: legal, ...extra }).select('id').single()
    if (error) throw new Error(`cliente ${legal}: ${error.message}`)
    creados.clientes.push(data.id)
    return data.id
  }
  const cliExacto = await cliente(ZZ, `${MARCA} Acme Exacto`, { emails: ['compras@acme-e4.test'] })
  const cliContacto = await cliente(ZZ, `${MARCA} Contacto SA`)
  const cliDominio = await cliente(ZZ, `${MARCA} Dominio Único`, { email_domains: ['unico-e4.test'] })
  const cliComp1 = await cliente(ZZ, `${MARCA} Compartido Uno`, { email_domains: ['compartido-e4.test'] })
  const cliComp2 = await cliente(ZZ, `${MARCA} Compartido Dos`, { email_domains: ['compartido-e4.test'] })
  const cliGmail = await cliente(ZZ, `${MARCA} Usa Gmail`, { email_domains: ['gmail.com'] })
  const cliAjeno = await cliente(ZZ2, `${MARCA} Cliente Ajeno`, { emails: ['compras@acme-e4.test'], email_domains: ['unico-e4.test'] })
  const { data: ctc } = await s.from('customer_contacts')
    .insert({ company_id: ZZ, customer_id: cliContacto, full_name: `${MARCA} Laura`, email: 'Laura@Contacto-E4.test' })
    .select('id').single()
  const { data: ctcOtro } = await s.from('customer_contacts')
    .insert({ company_id: ZZ, customer_id: cliExacto, full_name: `${MARCA} Otro`, email: 'otro@acme-e4.test' })
    .select('id').single()

  const admin = await usuarioTemporal(ZZ, 'admin', 'Admin')
  const empleado = await usuarioTemporal(ZZ, 'employee', 'Juan')
  const empleado2 = await usuarioTemporal(ZZ, 'employee', 'Facundo')
  const vendedor = await usuarioTemporal(ZZ, 'salesperson', 'Vendedor')
  const tecnico = await usuarioTemporal(ZZ, 'technician', 'Tecnico')
  const clienteU = await usuarioTemporal(ZZ, 'customer', 'Cliente', cliExacto)
  const distrib = await usuarioTemporal(ZZ, 'distributor', 'Distribuidor', cliExacto)
  const adminAjeno = await usuarioTemporal(ZZ2, 'admin', 'Admin ajeno')
  const anon = sesion()

  const cuenta = async (companyId, suf) => {
    const { data, error } = await s.from('email_accounts').insert({
      company_id: companyId, email_address: `zz-e4-${suf}-${Date.now()}@buzon-e4.test`, last_history_id: '1000',
    }).select('*').single()
    if (error) throw new Error(`cuenta ${suf}: ${error.message}`)
    creados.cuentas.push(data.id)
    return data
  }
  const cta = await cuenta(ZZ, 'propia')
  const cta2 = await cuenta(ZZ, 'segunda')
  const ctaAjena = await cuenta(ZZ2, 'ajena')

  const T0 = Date.parse('2026-09-01T12:00:00Z')
  const hilo = async (c, tid, minutos, extra = {}) => {
    const { data, error } = await s.from('email_threads').insert({
      company_id: c.company_id, account_id: c.id, gmail_thread_id: tid,
      subject: `${MARCA} asunto ${tid}`, snippet: `extracto ${tid}`,
      last_message_at: new Date(T0 + minutos * 60_000).toISOString(),
      last_message_from: 'alguien@prueba-e4.test', last_message_dir: 'in',
      participants: ['alguien@prueba-e4.test', c.email_address], message_count: 1, ...extra,
    }).select('*').single()
    if (error) throw new Error(`hilo ${tid}: ${error.message}`)
    return data
  }
  // Dos hilos con el MISMO instante (e4a01, e4a02): el desempate tiene que ser estable.
  const h = {
    a01: await hilo(cta, 'e4a01', 10),
    a02: await hilo(cta, 'e4a02', 10),
    a03: await hilo(cta, 'e4a03', 20, { has_attachments: true }),
    a04: await hilo(cta, 'e4a04', 30, { subject: `${MARCA} Cotización 100% urgente`, participants: ['compras@acme-e4.test', cta.email_address] }),
    a05: await hilo(cta, 'e4a05', 40, { participants: ['laura@contacto-e4.test'], snippet: 'pedido de precios' }),
    a06: await hilo(cta, 'e4a06', 50, { participants: ['ventas@unico-e4.test'] }),
    a07: await hilo(cta, 'e4a07', 60, { participants: ['x@compartido-e4.test'] }),
    a08: await hilo(cta, 'e4a08', 70, { participants: ['alguien@gmail.com', 'colega@buzon-e4.test'] }),
    a09: await hilo(cta, 'e4a09', 80),
    a10: await hilo(cta, 'e4a10', 90),
    b01: await hilo(cta2, 'e4b01', 5),
    x01: await hilo(ctaAjena, 'e4x01', 100),
  }
  PASS('fixtures creados', `${Object.keys(h).length} hilos en 3 cuentas`)

  // ══════════════════════════════════════════════════════════════════════
  seccion('2 · La bandeja: RLS por identidad, con ids exactos')
  const propios = ['e4a10', 'e4a09', 'e4a08', 'e4a07', 'e4a06', 'e4a05', 'e4a04', 'e4a03']
  {
    const r = await bandeja(admin.c, ZZ, { p_limite: 100 })
    cmp('ADMIN ve los 11 hilos de su empresa', 11, r.total)
    cmp('ADMIN nunca ve el hilo de la otra empresa', false, ids(r).includes('e4x01'))
    const e = await bandeja(empleado.c, ZZ, { p_limite: 100 })
    cmp('EMPLOYEE ve los mismos 11', ids(r), ids(e))
  }
  for (const [nombre, u] of [['SALESPERSON', vendedor], ['TECHNICIAN', tecnico], ['CUSTOMER', clienteU], ['DISTRIBUTOR', distrib]]) {
    cmp(`${nombre} ve 0 hilos`, 0, (await bandeja(u.c, ZZ, { p_limite: 100 })).filas.length)
  }
  cmp('ADMIN de otra empresa pidiendo ESTA empresa: 0', 0, (await bandeja(adminAjeno.c, ZZ)).filas.length)
  cmp('ADMIN de otra empresa ve lo suyo', ['e4x01'], ids(await bandeja(adminAjeno.c, ZZ2)))
  rechaza('ANON no puede ejecutar la RPC de la bandeja', await anon.rpc('listar_bandeja_email', { p_company: ZZ }))
  for (const [nombre, u] of [['SALESPERSON', vendedor], ['CUSTOMER', clienteU], ['DISTRIBUTOR', distrib], ['TECHNICIAN', tecnico]]) {
    const { data: est } = await u.c.from('email_thread_state').select('id')
    const { data: rd } = await u.c.from('email_thread_reads').select('user_id')
    const { data: ev } = await u.c.from('email_events').select('id')
    const { data: ac } = await u.c.from('email_accounts').select('id')
    cmp(`${nombre}: 0 cuentas, estados, lecturas y eventos`, [0, 0, 0, 0],
      [(ac ?? []).length, (est ?? []).length, (rd ?? []).length, (ev ?? []).length])
  }
  {
    const { data } = await vendedor.c.from('email_threads').select('id').eq('id', h.a01.id)
    cmp('SALESPERSON pidiendo el id EXACTO de un hilo: 0 filas', 0, (data ?? []).length)
  }

  // ══════════════════════════════════════════════════════════════════════
  seccion('3 · Paginación en el servidor, con desempate estable')
  {
    const p1 = await bandeja(admin.c, ZZ, { p_limite: 4, p_offset: 0 })
    const p2 = await bandeja(admin.c, ZZ, { p_limite: 4, p_offset: 4 })
    const p3 = await bandeja(admin.c, ZZ, { p_limite: 4, p_offset: 8 })
    cmp('página 1 trae 4 y el total es 11', [4, 11], [p1.filas.length, p1.total])
    cmp('orden: último mensaje primero', ['e4a10', 'e4a09', 'e4a08', 'e4a07'], ids(p1))
    const todas = [...ids(p1), ...ids(p2), ...ids(p3)]
    cmp('las tres páginas cubren los 11 sin repetir', 11, new Set(todas).size)
    const empate = todas.filter((t) => t === 'e4a01' || t === 'e4a02')
    const otra = [...ids(await bandeja(admin.c, ZZ, { p_limite: 4, p_offset: 8 }))].filter((t) => t === 'e4a01' || t === 'e4a02')
    cmp('dos hilos con el mismo instante salen siempre en el mismo orden', empate, otra)
    cmp('el límite se acota a 100 aunque pidan 5000', 11, (await bandeja(admin.c, ZZ, { p_limite: 5000 })).filas.length)
    const r = await bandeja(admin.c, ZZ, { p_limite: 1 })
    const cols = Object.keys(r.filas[0] ?? {})
    cmp('la fila NO trae cuerpo, ni html, ni raw', false, cols.some((c) => /body|html|raw|text$/.test(c)))
  }

  // ══════════════════════════════════════════════════════════════════════
  seccion('4 · Filtros y búsqueda')
  cmp('cuenta: sólo la segunda', ['e4b01'], ids(await bandeja(admin.c, ZZ, { p_account: cta2.id })))
  cmp('adjuntos', ['e4a03'], ids(await bandeja(admin.c, ZZ, { p_adjuntos: true })))
  cmp('búsqueda por asunto, sin importar mayúsculas', ['e4a04'], ids(await bandeja(admin.c, ZZ, { p_q: 'cotización' })))
  cmp('búsqueda con % literal no es comodín', ['e4a04'], ids(await bandeja(admin.c, ZZ, { p_q: '100%' })))
  cmp('búsqueda con _ literal no es comodín', [], ids(await bandeja(admin.c, ZZ, { p_q: 'e4a_1' })))
  cmp('búsqueda por extracto', ['e4a05'], ids(await bandeja(admin.c, ZZ, { p_q: 'pedido de precios' })))
  cmp('búsqueda por participante', ['e4a06'], ids(await bandeja(admin.c, ZZ, { p_q: 'unico-e4' })))
  cmp('búsqueda vacía o de espacios = sin filtro', 11, (await bandeja(admin.c, ZZ, { p_q: '   ', p_limite: 100 })).total)
  cmp('la búsqueda no cruza empresas', [], ids(await bandeja(admin.c, ZZ, { p_q: 'e4x01' })))

  // ══════════════════════════════════════════════════════════════════════
  seccion('5 · No leído POR USUARIO — Juan abre, Facundo sigue sin leer')
  {
    const sinLeer = async (u, tid) => (await bandeja(u.c, ZZ, { p_limite: 100 })).filas.find((f) => f.gmail_thread_id === tid)?.sin_leer
    cmp('Juan arranca con e4a10 sin leer', true, await sinLeer(empleado, 'e4a10'))
    cmp('Facundo también', true, await sinLeer(empleado2, 'e4a10'))
    const { error } = await empleado.c.rpc('marcar_hilo_leido_email', { p_account: cta.id, p_thread: 'e4a10' })
    error ? FAIL('Juan abre e4a10', error.message) : PASS('Juan abre e4a10')
    cmp('para Juan pasa a leído', false, await sinLeer(empleado, 'e4a10'))
    cmp('para FACUNDO SIGUE SIN LEER', true, await sinLeer(empleado2, 'e4a10'))
    cmp('el total sin leer de Juan bajó en 1', 10, (await bandeja(empleado.c, ZZ, { p_limite: 1 })).sinLeer)
    cmp('el de Facundo no', 11, (await bandeja(empleado2.c, ZZ, { p_limite: 1 })).sinLeer)
    cmp('filtro «sólo sin leer» de Juan no trae e4a10', false,
      ids(await bandeja(empleado.c, ZZ, { p_sin_leer: true, p_limite: 100 })).includes('e4a10'))

    // Llega un mensaje nuevo: el hilo vuelve a estar sin leer para Juan.
    await esperar(50)
    await s.from('email_threads').update({ last_message_at: new Date(Date.now() + 60_000).toISOString() }).eq('id', h.a10.id)
    cmp('un mensaje nuevo lo vuelve a poner sin leer para Juan', true, await sinLeer(empleado, 'e4a10'))

    await vendedor.c.rpc('marcar_hilo_leido_email', { p_account: cta.id, p_thread: 'e4a09' })
    cmp('el vendedor «marca leído» un hilo que no ve: 0 filas', 0,
      await q('email_thread_reads', (c) => c.eq('account_id', cta.id).eq('user_id', vendedor.id)))
    await empleado.c.rpc('marcar_hilo_leido_email', { p_account: cta.id, p_thread: 'no-existe-e4' })
    cmp('marcar leído un hilo inexistente no deja fila', 0,
      await q('email_thread_reads', (c) => c.eq('account_id', cta.id).eq('gmail_thread_id', 'no-existe-e4')))
    await adminAjeno.c.rpc('marcar_hilo_leido_email', { p_account: cta.id, p_thread: 'e4a09' })
    cmp('el admin de otra empresa tampoco deja fila', 0,
      await q('email_thread_reads', (c) => c.eq('account_id', cta.id).eq('user_id', adminAjeno.id)))
  }

  // ══════════════════════════════════════════════════════════════════════
  seccion('6 · Asignación — y assigned_to NO da acceso')
  {
    const evs = async (accion) => q('email_events', (c) => c.eq('account_id', cta.id).eq('action', accion))
    const { error } = await empleado.c.rpc('asignar_hilo_email', { p_account: cta.id, p_thread: 'e4a09', p_usuario: empleado2.id })
    error ? FAIL('Juan asigna e4a09 a Facundo', error.message) : PASS('Juan asigna e4a09 a Facundo')
    const fila = (r) => r.filas.find((f) => f.gmail_thread_id === 'e4a09')
    cmp('el admin lo ve asignado, con nombre', [empleado2.id, `${MARCA} Facundo`],
      [fila(await bandeja(admin.c, ZZ, { p_limite: 100 }))?.assigned_to, fila(await bandeja(admin.c, ZZ, { p_limite: 100 }))?.assigned_name])
    cmp('Facundo lo ve con «asignados a mí»', ['e4a09'], ids(await bandeja(empleado2.c, ZZ, { p_asignado: 'yo' })))
    cmp('filtro por uuid del asignado', ['e4a09'], ids(await bandeja(admin.c, ZZ, { p_asignado: empleado2.id })))
    cmp('«sin asignar» ya no lo trae', false, ids(await bandeja(admin.c, ZZ, { p_asignado: 'nadie', p_limite: 100 })).includes('e4a09'))
    cmp('quedó 1 evento «asignado»', 1, await evs('asignado'))

    await empleado.c.rpc('asignar_hilo_email', { p_account: cta.id, p_thread: 'e4a09', p_usuario: empleado2.id })
    cmp('reasignar a la MISMA persona no deja otro evento', 1, await evs('asignado'))

    rechaza('asignar a un vendedor (no puede usar Emails)',
      await admin.c.rpc('asignar_hilo_email', { p_account: cta.id, p_thread: 'e4a08', p_usuario: vendedor.id }))
    rechaza('asignar a un usuario de otra empresa',
      await admin.c.rpc('asignar_hilo_email', { p_account: cta.id, p_thread: 'e4a08', p_usuario: adminAjeno.id }))
    rechaza('el vendedor intenta asignar',
      await vendedor.c.rpc('asignar_hilo_email', { p_account: cta.id, p_thread: 'e4a08', p_usuario: vendedor.id }))

    // Aunque assigned_to apuntara al vendedor —se fuerza con service_role,
    // saltando el trigger no se puede; se simula con una fila de estado que
    // lo tiene asignado ANTES de que perdiera el rol—, la RLS no mira assigned_to.
    const { error: eRol } = await s.from('company_memberships').update({ role: 'employee' }).eq('user_id', vendedor.id).eq('company_id', ZZ)
    if (eRol) FAIL('preparar: vendedor pasa a employee', eRol.message)
    await admin.c.rpc('asignar_hilo_email', { p_account: cta.id, p_thread: 'e4a08', p_usuario: vendedor.id })
    await s.from('company_memberships').update({ role: 'salesperson' }).eq('user_id', vendedor.id).eq('company_id', ZZ)
    cmp('preparado: e4a08 quedó asignado al (ahora) vendedor', vendedor.id,
      (await s.from('email_thread_state').select('assigned_to').eq('account_id', cta.id).eq('gmail_thread_id', 'e4a08').single()).data?.assigned_to)
    cmp('el VENDEDOR con un hilo asignado sigue viendo 0 hilos', 0, (await bandeja(vendedor.c, ZZ, { p_limite: 100 })).filas.length)
    {
      const { data } = await vendedor.c.from('email_threads').select('id').eq('id', h.a08.id)
      cmp('ni siquiera por id exacto', 0, (data ?? []).length)
    }

    await admin.c.rpc('asignar_hilo_email', { p_account: cta.id, p_thread: 'e4a09', p_usuario: null })
    const { data: ult } = await s.from('email_events').select('detalle').eq('account_id', cta.id)
      .eq('gmail_thread_id', 'e4a09').order('id', { ascending: false }).limit(1).single()
    cmp('desasignar deja evento con desasignado=true y el anterior', [true, empleado2.id], [ult.detalle.desasignado, ult.detalle.anterior])

    const { data: asg } = await empleado.c.rpc('usuarios_asignables_email', { p_company: ZZ })
    const nombres = (asg ?? []).map((u) => u.full_name).filter((n) => n.startsWith(MARCA)).sort()
    cmp('asignables para un EMPLOYEE: sólo admin y employee', [`${MARCA} Admin`, `${MARCA} Facundo`, `${MARCA} Juan`], nombres)
    cmp('asignables para el vendedor: nada', 0, ((await vendedor.c.rpc('usuarios_asignables_email', { p_company: ZZ })).data ?? []).length)
    cmp('asignables de ESTA empresa para un admin ajeno: nada', 0, ((await adminAjeno.c.rpc('usuarios_asignables_email', { p_company: ZZ })).data ?? []).length)
  }

  // ══════════════════════════════════════════════════════════════════════
  seccion('7 · Estado de trabajo')
  {
    const evs = () => q('email_events', (c) => c.eq('account_id', cta.id).eq('action', 'estado_cambiado'))
    rechaza('un estado inventado', await admin.c.rpc('cambiar_estado_email', { p_account: cta.id, p_thread: 'e4a07', p_estado: 'spam' }))
    await admin.c.rpc('cambiar_estado_email', { p_account: cta.id, p_thread: 'e4a07', p_estado: 'pendiente' })
    cmp('pasar a «pendiente» un hilo sin estado no crea fila ni evento', [0, 0],
      [await q('email_thread_state', (c) => c.eq('account_id', cta.id).eq('gmail_thread_id', 'e4a07')), await evs()])
    await admin.c.rpc('cambiar_estado_email', { p_account: cta.id, p_thread: 'e4a07', p_estado: 'en_proceso' })
    cmp('cambiar a en_proceso deja 1 evento', 1, await evs())
    cmp('filtro por estado', ['e4a07'], ids(await bandeja(empleado.c, ZZ, { p_estado: 'en_proceso' })))
    cmp('el resto sigue «pendiente» sin tener fila', 10, (await bandeja(empleado.c, ZZ, { p_estado: 'pendiente', p_limite: 100 })).total)
    rechaza('UPDATE directo sobre email_thread_state',
      await empleado.c.from('email_thread_state').update({ workflow_status: 'resuelto' }).eq('account_id', cta.id))
    cmp('y su efecto: sigue en_proceso', 'en_proceso',
      (await s.from('email_thread_state').select('workflow_status').eq('account_id', cta.id).eq('gmail_thread_id', 'e4a07').single()).data?.workflow_status)
  }

  // ══════════════════════════════════════════════════════════════════════
  seccion('8 · Endurecimiento: un hilo inexistente ya no crea estado')
  {
    for (const [rpc, args] of [
      ['asignar_hilo_email', { p_usuario: admin.id }],
      ['cambiar_estado_email', { p_estado: 'resuelto' }],
      ['vincular_cliente_email', { p_customer: cliExacto, p_origen: 'manual' }],
    ]) {
      rechaza(`${rpc} sobre un hilo que no existe`, await admin.c.rpc(rpc, { p_account: cta.id, p_thread: 'inventado-e4', ...args }))
    }
    cmp('ninguna dejó fila de estado', 0, await q('email_thread_state', (c) => c.eq('gmail_thread_id', 'inventado-e4')))
    rechaza('un hilo de OTRA cuenta con la cuenta propia',
      await admin.c.rpc('cambiar_estado_email', { p_account: cta.id, p_thread: 'e4x01', p_estado: 'resuelto' }))
  }

  // ══════════════════════════════════════════════════════════════════════
  seccion('9 · CRM: sugerencias, nunca aplicadas solas')
  {
    const sug = async (tid, u = admin) => {
      const { data, error } = await u.c.rpc('sugerencias_cliente_email', { p_account: cta.id, p_thread: tid })
      if (error) return `ERROR ${error.message}`
      return (data ?? []).map((x) => `${x.clase}:${x.customer_name}`).sort()
    }
    cmp('dirección exacta en customers.emails → exacto', [`exacto:${MARCA} Acme Exacto`], await sug('e4a04'))
    cmp('dirección de un contacto (sin importar mayúsculas) → exacto', [`exacto:${MARCA} Contacto SA`], await sug('e4a05'))
    cmp('dominio de un solo cliente → sugerido_dominio', [`sugerido_dominio:${MARCA} Dominio Único`], await sug('e4a06'))
    cmp('dominio compartido → ambiguo, los dos', [`ambiguo:${MARCA} Compartido Dos`, `ambiguo:${MARCA} Compartido Uno`], await sug('e4a07'))
    cmp('gmail.com y el dominio del propio buzón NUNCA sugieren', [], await sug('e4a08'))
    cmp('el cliente de OTRA empresa con el mismo email no aparece', false, (await sug('e4a04')).some((x) => x.includes('Ajeno')))
    cmp('el vendedor no recibe sugerencias', [], await sug('e4a04', vendedor))
    {
      const { data } = await admin.c.rpc('sugerencias_cliente_email', { p_account: cta.id, p_thread: 'e4a05' })
      cmp('la sugerencia por contacto trae el contacto', ctc.id, data?.[0]?.contact_id)
    }
    cmp('calcular sugerencias no escribió nada', 0,
      await q('email_thread_state', (c) => c.eq('account_id', cta.id).not('customer_id', 'is', null)))

    rechaza('vincular un cliente de OTRA empresa',
      await admin.c.rpc('vincular_cliente_email', { p_account: cta.id, p_thread: 'e4a04', p_customer: cliAjeno, p_origen: 'manual' }))
    rechaza('vincular un contacto que no es de ese cliente',
      await admin.c.rpc('vincular_cliente_email', { p_account: cta.id, p_thread: 'e4a04', p_customer: cliExacto, p_contacto: ctc.id, p_origen: 'manual' }))
    rechaza('un origen inventado',
      await admin.c.rpc('vincular_cliente_email', { p_account: cta.id, p_thread: 'e4a04', p_customer: cliExacto, p_origen: 'magia' }))
    rechaza('el vendedor vincula', await vendedor.c.rpc('vincular_cliente_email', { p_account: cta.id, p_thread: 'e4a04', p_customer: cliExacto }))

    const { error } = await empleado.c.rpc('vincular_cliente_email', {
      p_account: cta.id, p_thread: 'e4a04', p_customer: cliExacto, p_contacto: ctcOtro.id, p_origen: 'exacto' })
    error ? FAIL('Juan vincula e4a04 a Acme (sugerencia exacta)', error.message) : PASS('Juan vincula e4a04 a Acme (sugerencia exacta)')
    const fila = (await bandeja(admin.c, ZZ, { p_cliente: 'con' })).filas
    cmp('filtro «con cliente» lo trae, con nombre y origen', [['e4a04', `${MARCA} Acme Exacto`, 'exacto']],
      fila.map((f) => [f.gmail_thread_id, f.customer_name, f.vinculo_origen]))
    cmp('buscar por nombre del cliente lo encuentra', ['e4a04'], ids(await bandeja(admin.c, ZZ, { p_q: 'acme exacto' })))
    cmp('«sin cliente» ya no lo trae', false, ids(await bandeja(admin.c, ZZ, { p_cliente: 'sin', p_limite: 100 })).includes('e4a04'))
    cmp('ya vinculado: no hay sugerencias que ofrecer, pero la RPC sigue devolviendo (la UI no la llama)', true, (await sug('e4a04')).length >= 1)
    await empleado.c.rpc('vincular_cliente_email', { p_account: cta.id, p_thread: 'e4a04', p_customer: cliExacto, p_contacto: ctcOtro.id, p_origen: 'exacto' })
    cmp('vincular lo mismo otra vez no deja otro evento', 1,
      await q('email_events', (c) => c.eq('account_id', cta.id).eq('action', 'cliente_vinculado')))
    await empleado.c.rpc('vincular_cliente_email', { p_account: cta.id, p_thread: 'e4a04', p_customer: null })
    cmp('desvincular: evento cliente_desvinculado', 1,
      await q('email_events', (c) => c.eq('account_id', cta.id).eq('action', 'cliente_desvinculado')))
    cmp('y el estado quedó sin cliente ni origen', [null, null, null],
      Object.values((await s.from('email_thread_state').select('customer_id, customer_contact_id, vinculo_origen')
        .eq('account_id', cta.id).eq('gmail_thread_id', 'e4a04').single()).data ?? {}))
    void cliDominio; void cliComp1; void cliComp2; void cliGmail
  }

  // ══════════════════════════════════════════════════════════════════════
  seccion('10 · Eventos: sólo acciones humanas, visibles para admin y employee')
  {
    const acciones = (await s.from('email_events').select('action').eq('account_id', cta.id)).data.map((e) => e.action)
    cmp('sólo acciones de la lista', true, acciones.every((a) => ['asignado', 'estado_cambiado', 'cliente_vinculado', 'cliente_desvinculado'].includes(a)))
    cmp('marcar leído y listar NO dejan eventos', 0, acciones.filter((a) => !['asignado', 'estado_cambiado', 'cliente_vinculado', 'cliente_desvinculado'].includes(a)).length)
    const total = acciones.length
    cmp('el employee ve todos los eventos de su cuenta', total, ((await empleado.c.from('email_events').select('id').eq('account_id', cta.id)).data ?? []).length)
    cmp('el admin ajeno no ve ninguno', 0, ((await adminAjeno.c.from('email_events').select('id').eq('account_id', cta.id)).data ?? []).length)
  }

  // ══════════════════════════════════════════════════════════════════════
  seccion('11 · Realtime: el admin recibe, el vendedor no')
  {
    const escuchar = (u, tabla) => new Promise((resolver) => {
      const recibidos = []
      const canal = u.c.channel(`e4-${tabla}-${randomUUID()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: tabla, filter: `company_id=eq.${ZZ}` }, (p) => recibidos.push(p))
        .subscribe((estado) => {
          if (estado === 'SUBSCRIBED') resolver({ recibidos, canal, ok: true })
          else if (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT') resolver({ recibidos, canal, ok: false, estado })
        })
    })
    // De a uno: la sonda mostró que así entrega; con setAuth manual y cuatro
    // joins simultáneos no llegaba nada.
    const ra = await escuchar(admin, 'email_threads')
    const rv = await escuchar(vendedor, 'email_threads')
    const sa = await escuchar(admin, 'email_thread_state')
    const sv = await escuchar(vendedor, 'email_thread_state')
    if (!ra.ok || !rv.ok || !sa.ok || !sv.ok) {
      FAIL('suscripción Realtime', `admin=${ra.ok}/${sa.ok} vendedor=${rv.ok}/${sv.ok}`)
    } else {
      await esperar(3000)
      const nuevo = await hilo(cta, 'e4rt1', 200)
      await s.from('email_threads').update({ snippet: 'actualizado por realtime' }).eq('id', h.a03.id)
      await admin.c.rpc('cambiar_estado_email', { p_account: cta.id, p_thread: 'e4a03', p_estado: 'resuelto' })
      let t0 = Date.now()
      while (Date.now() - t0 < 8000 && (ra.recibidos.length < 2 || sa.recibidos.length < 1)) await esperar(200)
      // Un reintento, y queda ANOTADO: la intermitencia se reporta, no se esconde.
      if (ra.recibidos.length < 2) {
        INFO('Realtime: primer intento sin eventos del índice en 8 s', `recibidos ${ra.recibidos.length}; se reintenta una vez`)
        await esperar(1000)
        ra.recibidos.length = 0
        await hilo(cta, 'e4rt2', 201)
        await s.from('email_threads').update({ snippet: 'reintento realtime' }).eq('id', h.a03.id)
        t0 = Date.now()
        while (Date.now() - t0 < 8000 && ra.recibidos.length < 2) await esperar(200)
      }
      cmp('el admin recibió el INSERT y el UPDATE del índice', ['INSERT', 'UPDATE'], ra.recibidos.map((p) => p.eventType).sort())
      cmp('el admin recibió el cambio de estado', true, sa.recibidos.some((p) => p.new?.workflow_status === 'resuelto'))
      INFO('latencia medida hasta el último evento', `${Date.now() - t0} ms`)
      await esperar(1500)
      cmp('el VENDEDOR no recibió ningún evento del índice', 0, rv.recibidos.length)
      cmp('ni de estado', 0, sv.recibidos.length)
      void nuevo
    }
    for (const r of [ra, rv, sa, sv]) await r.canal?.unsubscribe()
  }

  // ══════════════════════════════════════════════════════════════════════
  seccion('12 · Servicio de contenido (Cloud Run)')
  if (!API) {
    INFO('EMAILS_API_URL no está definido', 'la sección se saltea; no se cuenta como PASS')
  } else {
    const pedir = (jwt, params) => fetch(`${API}/gmail/thread?${new URLSearchParams(params)}`,
      { headers: jwt ? { Authorization: `Bearer ${jwt}` } : {} })
    // Un id con FORMATO de Gmail (hexadecimal). Con 'e4a01' el servicio corta en la
    // validación de formato y devuelve 404 antes de consultar la base: los casos
    // de rol pasaban por la razón equivocada. Con este id cada pedido llega a
    // PostgREST y decide la RLS.
    const hex = await hilo(cta, 'e4f00000000000a1', 300)
    const params = { account_id: cta.id, thread_id: hex.gmail_thread_id }
    const cuerpo = async (r) => ({ status: r.status, texto: await r.text() })
    const sinContenido = (x) => /^{"error":"[a-z_]+"}$/.test(x.texto)
    {
      const x = await cuerpo(await pedir(null, params))
      cmp('sin token: 401 sin contenido', [401, true], [x.status, sinContenido(x)])
    }
    {
      const x = await cuerpo(await pedir('a.b.c', params))
      cmp('token basura con id válido: 401 (lo rechaza PostgREST)', [401, true], [x.status, sinContenido(x)])
    }
    for (const [nombre, u] of [['SALESPERSON', vendedor], ['TECHNICIAN', tecnico], ['CUSTOMER', clienteU], ['DISTRIBUTOR', distrib], ['ADMIN ajeno', adminAjeno]]) {
      const x = await cuerpo(await pedir(u.jwt, params))
      cmp(`${nombre}: 404 por RLS, sin contenido`, [404, true], [x.status, sinContenido(x)])
    }
    {
      // El admin propio SÍ ve el hilo en la base; lo frena la segunda barrera.
      const x = await cuerpo(await pedir(admin.jwt, params))
      cmp('ADMIN propio con id válido: la RLS lo deja, el allowlist lo frena (404)', [404, true], [x.status, sinContenido(x)])
    }
    {
      const x = await cuerpo(await pedir(admin.jwt, { account_id: cta.id, thread_id: '../profile' }))
      cmp('un thread id con forma inválida: 404 sin llegar a la base', 404, x.status)
    }
    const adj = await fetch(`${API}/gmail/attachment?${new URLSearchParams({ ...params, message_id: hex.gmail_thread_id, part_id: '1' })}`,
      { headers: { Authorization: `Bearer ${vendedor.jwt}` } })
    cmp('adjunto pedido por el vendedor: 404', 404, adj.status)
  }

  // ══════════════════════════════════════════════════════════════════════
  seccion('13 · DRY RUN de los 91 estados legacy — NO se aplica nada')
  if (!fs.existsSync(BACKUP_ESTADOS)) {
    INFO('no se encontró el export', BACKUP_ESTADOS)
  } else {
    const exp = JSON.parse(fs.readFileSync(BACKUP_ESTADOS, 'utf8'))
    const filas = exp.filas
    const decodificar = (b64) => {
      if (!b64) return null
      try {
        const t = Buffer.from(b64, 'base64').toString('utf8')
        return /^[0-9a-f]{10,20}$/i.test(t) ? t.toLowerCase() : null
      } catch { return null }
    }
    const { data: indice } = await s.from('email_threads').select('gmail_thread_id, last_message_at').eq('account_id', PROD_ACCOUNT)
    const enIndice = new Set((indice ?? []).map((x) => x.gmail_thread_id))
    const rango = (indice ?? []).map((x) => x.last_message_at).filter(Boolean).sort()
    const clase = (f) => {
      if (f.status === 'spam') return 'REVIEW'
      if (f.status === 'enviado' || !decodificar(f.thread_id)) return 'UNRESOLVED'
      return ['sin_responder', 'en_proceso', 'resuelto'].includes(f.status) ? 'AUTO' : 'UNRESOLVED'
    }
    const resumen = { AUTO: [], REVIEW: [], UNRESOLVED: [] }
    for (const f of filas) resumen[clase(f)].push(f)
    cmp('clasificación igual a la de la arquitectura (20 / 67 / 4)', [20, 67, 4],
      [resumen.AUTO.length, resumen.REVIEW.length, resumen.UNRESOLVED.length])
    const hilosAuto = new Set(resumen.AUTO.map((f) => decodificar(f.thread_id)))
    const hilosTodos = new Set(filas.map((f) => decodificar(f.thread_id)).filter(Boolean))
    const auto = [...hilosAuto]
    const autoEnIndice = auto.filter((t) => enIndice.has(t))
    const todosEnIndice = [...hilosTodos].filter((t) => enIndice.has(t))
    const fechas = filas.map((f) => f.date).filter(Boolean).sort()
    INFO('hilos distintos en el export', String(hilosTodos.size))
    INFO('AUTO: hilos distintos', String(auto.length))
    INFO('AUTO: ya presentes en el índice real', `${autoEnIndice.length} de ${auto.length}`)
    INFO('todas las clases: presentes en el índice real', `${todosEnIndice.length} de ${hilosTodos.size}`)
    INFO('fechas de los estados legacy', `${fechas[0]?.slice(0, 10)} → ${fechas.at(-1)?.slice(0, 10)}`)
    INFO('ventana del índice real', `${rango[0]?.slice(0, 10)} → ${rango.at(-1)?.slice(0, 10)}`)
    const conEstado = await q('email_thread_state', (c) => c.eq('account_id', PROD_ACCOUNT))
    cmp('el dry run no escribió estados productivos', prodAntes.estados, conEstado)
    const salida = {
      generado: new Date().toISOString(),
      aplicado: false,
      clases: { AUTO: resumen.AUTO.length, REVIEW: resumen.REVIEW.length, UNRESOLVED: resumen.UNRESOLVED.length },
      auto_hilos: auto.length,
      auto_en_indice: autoEnIndice.length,
      todas_en_indice: todosEnIndice.length,
      rango_estados: [fechas[0], fechas.at(-1)],
      rango_indice: [rango[0], rango.at(-1)],
    }
    console.log(`    DRYRUN ${JSON.stringify(salida)}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  seccion('14 · Limpieza e invariantes')
  {
    for (const id of creados.cuentas) {
      for (const t of ['email_thread_reads', 'email_events', 'email_sync_log', 'email_thread_state', 'email_threads']) {
        await s.from(t).delete().eq('account_id', id)
      }
      await s.from('email_accounts').delete().eq('id', id)
    }
    for (const id of creados.usuarios) {
      await s.from('company_memberships').delete().eq('user_id', id)
      await s.auth.admin.deleteUser(id)
    }
    await s.from('customer_contacts').delete().in('company_id', creados.empresas)
    await s.from('customers').delete().in('id', creados.clientes)
    for (const id of creados.empresas) await s.from('companies').delete().eq('id', id)

    for (const t of TABLAS) cmp(`${t} vuelve a su número`, antes[t], await q(t))
    cmp('los clientes vuelven a su número', clientesAntes, await q('customers'))
    cmp('índice productivo de info@ intacto', prodAntes.hilos >= 1, (await q('email_threads', (c) => c.eq('account_id', PROD_ACCOUNT))) >= prodAntes.hilos)
    cmp('estados productivos intactos', prodAntes.estados, await q('email_thread_state', (c) => c.eq('account_id', PROD_ACCOUNT)))
    cmp('eventos productivos intactos', prodAntes.eventos, await q('email_events', (c) => c.eq('account_id', PROD_ACCOUNT)))
    const { data: cuentaProd } = await s.from('email_accounts').select('watch_expiration').eq('id', PROD_ACCOUNT).single()
    cmp('el watch de info@ sigue vigente', true, new Date(cuentaProd.watch_expiration) > new Date())
  }

  console.log('\n' + '='.repeat(78))
  console.log(`  RESULTADO: ${fallos} fallo(s)`)
  console.log('='.repeat(78))
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('\n✗ La suite se cayó:', e.message)
  try { await barrer() } catch { /* se barre en la próxima corrida */ }
  process.exit(1)
})
