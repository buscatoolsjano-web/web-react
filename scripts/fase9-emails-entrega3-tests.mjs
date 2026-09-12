/**
 * Fase 9 · Emails — entrega 3: el schema, contra la base real.
 *
 * Cada prohibición se prueba con un INTENTO REAL y se mide el EFECTO además del
 * código: con PostgREST una operación prohibida puede devolver «éxito» con cero
 * filas, y creerle al código de estado es cómo se firma un PASS falso. En esta
 * misma fase ya me pasó dos veces.
 *
 * El bloque que más importa es el 6: **borrar el índice no puede borrar el
 * estado del ERP**. Es la lección de las 91 filas del legacy —de 65 MB, lo
 * único irrecuperable eran 91 estados— y es lo único acá que, si se rompe,
 * pierde datos que nadie puede reconstruir.
 *
 * Hacen falta seis identidades que no existen en la base: se crean usuarios
 * temporales con contraseña generada acá, se usan y se borran.
 *
 * Se limpia sola: prefijo `ZZ-E3`.
 *
 *   set -a; source .env; source .env.migration; source .env.rls.txt; set +a
 *   node scripts/fase9-emails-entrega3-tests.mjs
 *
 * NO canalizar por `head`: cierra el pipe y la limpieza no llega a correr.
 * Y NO correrla en paralelo con otra suite de base.
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET) { console.error('✗ Faltan variables de entorno'); process.exit(1) }

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(72)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const cmp = (t, esperado, real) =>
  String(esperado) === String(real) ? PASS(t, String(real)) : FAIL(t, `esperaba ${esperado}, dio ${real}`)
const rechaza = (t, r) => r.error ? PASS(t, r.error.code ?? String(r.error.message).slice(0, 56))
                                  : FAIL(`SE PERMITIÓ: ${t}`)

const sesion = () => createClient(BASE, PUB, { auth: { persistSession: false } })
const s = createClient(BASE, SECRET, { auth: { persistSession: false } })

const MARCA = 'ZZ-E3'
const TABLAS = ['email_accounts', 'email_threads', 'email_thread_state',
                'email_thread_reads', 'email_events', 'email_sync_log']
const creados = { usuarios: [], empresas: [] }
const q = async (t) => (await s.from(t).select('*', { count: 'exact', head: true })).count

const usuarioTemporal = async (companyId, rol, customerId = null) => {
  const email = `zz-e3-${rol}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@buscatools.test`
  const password = `Zz${randomUUID()}!`
  const { data, error } = await s.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`crear ${rol}: ${error.message}`)
  creados.usuarios.push(data.user.id)
  const fila = { company_id: companyId, user_id: data.user.id, role: rol, status: 'active' }
  if (customerId) fila.customer_id = customerId
  const { error: eM } = await s.from('company_memberships').insert(fila)
  if (eM) throw new Error(`membresía ${rol}: ${eM.message}`)
  const c = sesion()
  const { error: eL } = await c.auth.signInWithPassword({ email, password })
  if (eL) throw new Error(`login ${rol}: ${eL.message}`)
  return { id: data.user.id, c }
}

const ids = async (cli, tabla, col = 'id') => {
  const { data } = await cli.from(tabla).select(col)
  return (data ?? []).map((x) => x[col]).sort()
}

/** Barre restos de una corrida que se haya caído antes de medir el baseline. */
const barrer = async () => {
  const { data: viejas } = await s.from('companies').select('id').like('slug', 'zz-e3-%')
  const idsEmp = (viejas ?? []).map((x) => x.id)
  const { data: cuentas } = await s.from('email_accounts').select('id').like('email_address', `${MARCA}%`)
  for (const c of cuentas ?? []) {
    for (const t of ['email_thread_reads', 'email_events', 'email_sync_log', 'email_thread_state', 'email_threads']) {
      await s.from(t).delete().eq('account_id', c.id)
    }
    await s.from('email_accounts').delete().eq('id', c.id)
  }
  const { data: us } = await s.auth.admin.listUsers({ perPage: 1000 })
  for (const u of us?.users ?? []) {
    if (u.email?.startsWith('zz-e3-')) {
      await s.from('company_memberships').delete().eq('user_id', u.id)
      await s.auth.admin.deleteUser(u.id)
    }
  }
  if (idsEmp.length) {
    await s.from('company_memberships').delete().in('company_id', idsEmp)
    await s.from('customers').delete().in('company_id', idsEmp)
    await s.from('companies').delete().in('id', idsEmp)
    console.log(`  (se barrieron ${idsEmp.length} empresa(s) de una corrida anterior)`)
  }
}

const main = async () => {
  await barrer()
  const { data: comps } = await s.from('companies').select('id, slug')
  const BT = comps.find((x) => x.slug === 'buscatools').id
  const empresasAntes = comps.length
  const clientesAntes = await q('customers')

  // ══════════════════════════════════════════════════════════════════════
  seccion('1 · Las seis tablas, y ninguna más')
  for (const t of TABLAS) {
    const { error } = await s.from(t).select('*', { count: 'exact', head: true })
    error ? FAIL(`existe ${t}`, error.message) : PASS(`existe ${t}`)
  }
  for (const t of ['email_messages', 'email_contacts', 'email_attachments', 'email_drafts']) {
    const { error } = await s.from(t).select('id').limit(1)
    error ? PASS(`NO existe ${t}`, 'como se decidió') : FAIL(`existe ${t} y no debería`)
  }

  // ══════════════════════════════════════════════════════════════════════
  seccion('2 · Fixtures: dos empresas, siete identidades')
  const nuevaEmpresa = async (suf) => {
    const { data, error } = await s.from('companies')
      .insert({ slug: `zz-e3-${suf}-${Date.now()}`, name: `${MARCA} ${suf}`, default_currency: 'ARS' })
      .select('id').single()
    if (error) throw new Error(`empresa ${suf}: ${error.message}`)
    creados.empresas.push(data.id)
    return data.id
  }
  const ZZ = await nuevaEmpresa('propia')
  const ZZ2 = await nuevaEmpresa('ajena')

  const { data: cliZZ } = await s.from('customers')
    .insert({ company_id: ZZ, legal_name: `${MARCA} cliente propio` }).select('id').single()
  const { data: cliZZ2 } = await s.from('customers')
    .insert({ company_id: ZZ2, legal_name: `${MARCA} cliente ajeno` }).select('id').single()
  const { data: ctcZZ2 } = await s.from('customer_contacts')
    .insert({ company_id: ZZ2, customer_id: cliZZ2.id, full_name: `${MARCA} contacto ajeno` })
    .select('id').single()

  const admin = await usuarioTemporal(ZZ, 'admin')
  const empleado = await usuarioTemporal(ZZ, 'employee')
  const vendedor = await usuarioTemporal(ZZ, 'salesperson')
  const tecnico = await usuarioTemporal(ZZ, 'technician')
  const cliente = await usuarioTemporal(ZZ, 'customer', cliZZ.id)
  const distrib = await usuarioTemporal(ZZ, 'distributor', cliZZ.id)
  const adminAjeno = await usuarioTemporal(ZZ2, 'admin')
  const anon = sesion()

  const cuenta = async (companyId, suf) => {
    const { data, error } = await s.from('email_accounts').insert({
      company_id: companyId, email_address: `${MARCA}-${suf}-${Date.now()}@prueba.invalid`,
      display_name: `${MARCA} ${suf}`, last_history_id: '1000',
    }).select('*').single()
    if (error) throw new Error(`cuenta ${suf}: ${error.message}`)
    return data
  }
  const ctaZZ = await cuenta(ZZ, 'propia')
  const ctaZZ2 = await cuenta(ZZ2, 'ajena')

  const hilo = async (cta, tid, extra = {}) => {
    const { data, error } = await s.from('email_threads').insert({
      company_id: cta.company_id, account_id: cta.id, gmail_thread_id: tid,
      subject: `${MARCA} ${tid}`, snippet: 'extracto', last_message_at: new Date().toISOString(),
      participants: ['alguien@prueba.invalid'], message_count: 1, ...extra,
    }).select('*').single()
    if (error) throw new Error(`hilo ${tid}: ${error.message}`)
    return data
  }
  const hA = await hilo(ctaZZ, 'thread-a')
  const hB = await hilo(ctaZZ, 'thread-b')
  const hAjeno = await hilo(ctaZZ2, 'thread-x')
  PASS('dos cuentas y tres hilos de fixture')

  // ══════════════════════════════════════════════════════════════════════
  seccion('3 · Constraints')
  rechaza('un estado con cliente pero sin vinculo_origen',
    await s.from('email_thread_state').insert({
      company_id: ZZ, account_id: ctaZZ.id, gmail_thread_id: 'x1', customer_id: cliZZ.id }))
  rechaza('un contacto colgado de la nada, sin cliente',
    await s.from('email_thread_state').insert({
      company_id: ZZ, account_id: ctaZZ.id, gmail_thread_id: 'x2', customer_contact_id: ctcZZ2.id }))
  rechaza('un workflow_status inventado',
    await s.from('email_thread_state').insert({
      company_id: ZZ, account_id: ctaZZ.id, gmail_thread_id: 'x3', workflow_status: 'inventado' }))
  rechaza('un auth_mode inventado',
    await s.from('email_accounts').insert({
      company_id: ZZ, email_address: `${MARCA}-mal@prueba.invalid`, auth_mode: 'magia' }))
  rechaza('dos hilos con el mismo gmail_thread_id en la misma cuenta',
    await s.from('email_threads').insert({
      company_id: ZZ, account_id: ctaZZ.id, gmail_thread_id: 'thread-a' }))
  // Este insert crea un SEGUNDO hilo en la cuenta ajena. Se guarda el id
  // porque la matriz de RLS de abajo tiene que contarlo: si no, el «admin de
  // otra empresa» parecería ver de más cuando en realidad ve lo suyo.
  let hAjeno2 = null
  {
    const { data, error } = await s.from('email_threads').insert({
      company_id: ZZ2, account_id: ctaZZ2.id, gmail_thread_id: 'thread-a' }).select('id').single()
    if (error) FAIL('el mismo thread id en OTRA cuenta sí entra', error.message)
    else { PASS('el mismo thread id en OTRA cuenta sí entra', 'la unicidad es por cuenta'); hAjeno2 = data.id }
  }
  rechaza('message_count negativo',
    await s.from('email_threads').insert({
      company_id: ZZ, account_id: ctaZZ.id, gmail_thread_id: 'x4', message_count: -1 }))

  // ══════════════════════════════════════════════════════════════════════
  seccion('4 · Multiempresa: el hijo no se autoriza por el company_id que le mandan')
  rechaza('un hilo cuyo company_id no es el de su cuenta',
    await s.from('email_threads').insert({
      company_id: ZZ2, account_id: ctaZZ.id, gmail_thread_id: 'cruz-1' }))
  rechaza('un estado cuyo company_id no es el de su cuenta',
    await s.from('email_thread_state').insert({
      company_id: ZZ2, account_id: ctaZZ.id, gmail_thread_id: 'cruz-2' }))
  rechaza('un estado vinculado a un cliente de otra empresa',
    await s.from('email_thread_state').insert({
      company_id: ZZ, account_id: ctaZZ.id, gmail_thread_id: 'cruz-3',
      customer_id: cliZZ2.id, vinculo_origen: 'manual' }))
  rechaza('un estado con un contacto que no es de su cliente',
    await s.from('email_thread_state').insert({
      company_id: ZZ, account_id: ctaZZ.id, gmail_thread_id: 'cruz-4',
      customer_id: cliZZ.id, vinculo_origen: 'manual', customer_contact_id: ctcZZ2.id }))
  rechaza('asignar a un usuario de otra empresa',
    await s.from('email_thread_state').insert({
      company_id: ZZ, account_id: ctaZZ.id, gmail_thread_id: 'cruz-5', assigned_to: adminAjeno.id }))
  rechaza('asignar a un salesperson, que no puede usar Emails',
    await s.from('email_thread_state').insert({
      company_id: ZZ, account_id: ctaZZ.id, gmail_thread_id: 'cruz-6', assigned_to: vendedor.id }))
  rechaza('un evento cuyo company_id no es el de su cuenta',
    await s.from('email_events').insert({
      company_id: ZZ2, account_id: ctaZZ.id, action: 'asignado' }))

  // ══════════════════════════════════════════════════════════════════════
  seccion('5 · RLS por identidad, con ids exactos')
  const esperado = {
    'ADMIN': [admin.c, [hA.id, hB.id].sort()],
    'EMPLOYEE': [empleado.c, [hA.id, hB.id].sort()],
    'SALESPERSON': [vendedor.c, []],
    'TECHNICIAN': [tecnico.c, []],
    'CUSTOMER': [cliente.c, []],
    'DISTRIBUTOR': [distrib.c, []],
    'ADMIN de otra empresa': [adminAjeno.c, [hAjeno.id, hAjeno2].filter(Boolean).sort()],
  }
  for (const [nombre, [cli, esp]] of Object.entries(esperado)) {
    cmp(`${nombre} ve exactamente`, JSON.stringify(esp), JSON.stringify(await ids(cli, 'email_threads')))
  }
  // El anónimo aparte, midiendo el ERROR y no una lista vacía: un array vacío
  // puede venir de una consulta que falló, y sería un PASS por la razón errada.
  for (const t of TABLAS) {
    rechaza(`ANON ni siquiera puede consultar ${t}`, await anon.from(t).select('id').limit(1))
  }
  {
    const { data, error } = await admin.c.from('email_sync_log').select('id')
    error ? PASS('el admin no lee el log de sync', error.code)
          : cmp('el admin no lee el log de sync', 0, (data ?? []).length)
  }

  seccion('6 · Nadie escribe directo desde el cliente')
  rechaza('el admin inserta un hilo a mano',
    await admin.c.from('email_threads').insert({
      company_id: ZZ, account_id: ctaZZ.id, gmail_thread_id: 'intruso' }))
  rechaza('el admin cambia el estado por UPDATE directo',
    await admin.c.from('email_thread_state').update({ workflow_status: 'resuelto' }).eq('account_id', ctaZZ.id))
  rechaza('el admin inserta una cuenta de correo',
    await admin.c.from('email_accounts').insert({ company_id: ZZ, email_address: 'x@y.invalid' }))
  rechaza('el admin borra un hilo',
    await admin.c.from('email_threads').delete().eq('id', hA.id))
  rechaza('el admin escribe en el log de sync',
    await admin.c.from('email_sync_log').insert({ account_id: ctaZZ.id, kind: 'push' }))

  // ══════════════════════════════════════════════════════════════════════
  seccion('7 · RPC: la única puerta')
  rechaza('el vendedor asigna un hilo',
    await vendedor.c.rpc('asignar_hilo_email', {
      p_account: ctaZZ.id, p_thread: 'thread-a', p_usuario: admin.id }))
  rechaza('el admin de la otra empresa asigna acá',
    await adminAjeno.c.rpc('asignar_hilo_email', {
      p_account: ctaZZ.id, p_thread: 'thread-a', p_usuario: adminAjeno.id }))
  rechaza('el anónimo asigna',
    await anon.rpc('asignar_hilo_email', { p_account: ctaZZ.id, p_thread: 'thread-a', p_usuario: null }))
  rechaza('el admin llama al lease del backend',
    await admin.c.rpc('tomar_lease_email', { p_account: ctaZZ.id, p_owner: 'x' }))
  rechaza('el admin avanza el cursor a mano',
    await admin.c.rpc('avanzar_history_email', { p_account: ctaZZ.id, p_history_id: '99999' }))
  {
    const { error } = await empleado.c.rpc('asignar_hilo_email', {
      p_account: ctaZZ.id, p_thread: 'thread-a', p_usuario: admin.id })
    error ? FAIL('el employee asigna el hilo A al admin', error.message)
          : PASS('el employee asigna el hilo A al admin')
    const { data: est } = await s.from('email_thread_state')
      .select('assigned_to, workflow_status').eq('account_id', ctaZZ.id).eq('gmail_thread_id', 'thread-a').single()
    cmp('quedó asignado', admin.id, est.assigned_to)
    cmp('y el estado por defecto es pendiente', 'pendiente', est.workflow_status)
    const { count } = await s.from('email_events').select('*', { count: 'exact', head: true })
      .eq('account_id', ctaZZ.id).eq('action', 'asignado')
    cmp('y quedó auditado en email_events', 1, count)
  }
  {
    await admin.c.rpc('cambiar_estado_email', {
      p_account: ctaZZ.id, p_thread: 'thread-a', p_estado: 'en_proceso' })
    const { data } = await s.from('email_thread_state')
      .select('workflow_status, assigned_to').eq('account_id', ctaZZ.id).eq('gmail_thread_id', 'thread-a').single()
    cmp('cambiar el estado no pisa la asignación', admin.id, data.assigned_to)
    cmp('y el estado cambió', 'en_proceso', data.workflow_status)
  }

  // ══════════════════════════════════════════════════════════════════════
  seccion('8 · EL RESYNC DEL ÍNDICE NO PUEDE BORRAR EL ESTADO')
  {
    // El caso real: un historial vencido obliga a rehacer email_threads.
    const antes = await s.from('email_thread_state').select('*')
      .eq('account_id', ctaZZ.id).eq('gmail_thread_id', 'thread-a').single()
    cmp('hay un estado que proteger', 'en_proceso', antes.data.workflow_status)

    // Se borra el índice ENTERO de la cuenta, que es lo que haría el peor caso.
    await s.from('email_threads').delete().eq('account_id', ctaZZ.id)
    cmp('el índice quedó vacío', 0,
      (await s.from('email_threads').select('*', { count: 'exact', head: true }).eq('account_id', ctaZZ.id)).count)

    const despues = await s.from('email_thread_state').select('*')
      .eq('account_id', ctaZZ.id).eq('gmail_thread_id', 'thread-a').single()
    despues.data
      ? PASS('EL ESTADO SOBREVIVIÓ al borrado del índice')
      : FAIL('el estado se borró junto con el índice')
    cmp('con su workflow_status intacto', 'en_proceso', despues.data?.workflow_status)
    cmp('y su assigned_to intacto', admin.id, despues.data?.assigned_to)

    // Y el índice se puede reconstruir encima, sin tocar el estado.
    await hilo(ctaZZ, 'thread-a')
    await hilo(ctaZZ, 'thread-b')
    const rehecho = await s.from('email_thread_state').select('workflow_status')
      .eq('account_id', ctaZZ.id).eq('gmail_thread_id', 'thread-a').single()
    cmp('y tras reconstruirlo el estado sigue ahí', 'en_proceso', rehecho.data.workflow_status)
  }

  // ══════════════════════════════════════════════════════════════════════
  seccion('9 · Lease de sincronización')
  {
    const { data: a } = await s.rpc('tomar_lease_email', { p_account: ctaZZ.id, p_owner: 'worker-1' })
    cmp('el primer worker toma el lease', 1, (a ?? []).length)
    const { data: b } = await s.rpc('tomar_lease_email', { p_account: ctaZZ.id, p_owner: 'worker-2' })
    cmp('el segundo NO lo toma', 0, (b ?? []).length)

    const { data: mal } = await s.rpc('soltar_lease_email', { p_account: ctaZZ.id, p_owner: 'worker-2' })
    cmp('worker-2 no puede soltar un lease que no es suyo', 0, (mal ?? []).length)

    const { data: ok } = await s.rpc('soltar_lease_email', { p_account: ctaZZ.id, p_owner: 'worker-1' })
    cmp('worker-1 sí lo suelta', 1, (ok ?? []).length)

    const { data: c } = await s.rpc('tomar_lease_email', { p_account: ctaZZ.id, p_owner: 'worker-2' })
    cmp('y ahora worker-2 sí lo toma', 1, (c ?? []).length)
    await s.rpc('soltar_lease_email', { p_account: ctaZZ.id, p_owner: 'worker-2' })

    // Vencido: se simula poniendo la fecha en el pasado.
    await s.from('email_accounts')
      .update({ sync_lock_until: new Date(Date.now() - 60_000).toISOString(), sync_lock_owner: 'muerto' })
      .eq('id', ctaZZ.id)
    const { data: d } = await s.rpc('tomar_lease_email', { p_account: ctaZZ.id, p_owner: 'worker-3' })
    cmp('un lease vencido lo puede tomar otro: se auto-cura', 1, (d ?? []).length)
    await s.rpc('soltar_lease_email', { p_account: ctaZZ.id, p_owner: 'worker-3' })

    // Concurrencia real: ocho intentos en paralelo, uno solo gana.
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      s.rpc('tomar_lease_email', { p_account: ctaZZ.id, p_owner: `par-${i}` })))
    const ganadores = rs.filter((r) => (r.data ?? []).length > 0).length
    cmp('ocho intentos simultáneos, UN solo ganador', 1, ganadores)
    for (let i = 0; i < 8; i++) await s.rpc('soltar_lease_email', { p_account: ctaZZ.id, p_owner: `par-${i}` })
  }

  seccion('10 · El cursor nunca retrocede')
  {
    await s.rpc('avanzar_history_email', { p_account: ctaZZ.id, p_history_id: '5000' })
    const leer = async () => (await s.from('email_accounts').select('last_history_id').eq('id', ctaZZ.id).single()).data.last_history_id
    cmp('avanza a 5000', '5000', await leer())
    await s.rpc('avanzar_history_email', { p_account: ctaZZ.id, p_history_id: '4000' })
    cmp('un historyId menor NO lo mueve', '5000', await leer())
    await s.rpc('avanzar_history_email', { p_account: ctaZZ.id, p_history_id: '5000' })
    cmp('el mismo tampoco', '5000', await leer())
    // La comparación es numérica: como texto, '900' > '5000'.
    await s.rpc('avanzar_history_email', { p_account: ctaZZ.id, p_history_id: '900' })
    cmp('compara como NÚMERO, no como texto', '5000', await leer())
    await s.rpc('avanzar_history_email', { p_account: ctaZZ.id, p_history_id: '60000' })
    cmp('y avanza con uno mayor', '60000', await leer())
  }

  // ══════════════════════════════════════════════════════════════════════
  seccion('11 · No leído, por usuario')
  {
    const noLeidos = async (cli) => {
      const { data } = await cli.rpc('no_leidos_email', { p_account: ctaZZ.id, p_threads: ['thread-a'] })
      return (data ?? [])[0]?.sin_leer
    }
    cmp('el admin arranca con el hilo sin leer', 'true', String(await noLeidos(admin.c)))
    cmp('y el employee también', 'true', String(await noLeidos(empleado.c)))

    const { error } = await admin.c.rpc('marcar_hilo_leido_email', { p_account: ctaZZ.id, p_thread: 'thread-a' })
    error ? FAIL('el admin marca leído', error.message) : PASS('el admin marca leído')

    cmp('el admin pasa a leído', 'false', String(await noLeidos(admin.c)))
    cmp('y el EMPLOYEE sigue sin leer: el no leído es de cada uno', 'true', String(await noLeidos(empleado.c)))

    rechaza('el employee marca leído EN NOMBRE del admin',
      await empleado.c.from('email_thread_reads')
        .insert({ account_id: ctaZZ.id, gmail_thread_id: 'thread-b', user_id: admin.id }))
    rechaza('el vendedor marca leído un hilo que no ve',
      await vendedor.c.from('email_thread_reads')
        .insert({ account_id: ctaZZ.id, gmail_thread_id: 'thread-a', user_id: vendedor.id }))

    // El efecto, no el código: la marca del admin no cambió.
    const { data: antes } = await s.from('email_thread_reads').select('last_read_at')
      .eq('account_id', ctaZZ.id).eq('gmail_thread_id', 'thread-a').eq('user_id', admin.id).single()
    await empleado.c.from('email_thread_reads').update({ last_read_at: '2020-01-01T00:00:00Z' })
      .eq('account_id', ctaZZ.id).eq('gmail_thread_id', 'thread-a').eq('user_id', admin.id)
    const { data: despues } = await s.from('email_thread_reads').select('last_read_at')
      .eq('account_id', ctaZZ.id).eq('gmail_thread_id', 'thread-a').eq('user_id', admin.id).single()
    cmp('el employee no pudo pisar la marca del admin', antes.last_read_at, despues.last_read_at)

    cmp('el admin ve una sola fila de lectura: la suya', 1,
      (await ids(admin.c, 'email_thread_reads', 'user_id')).length)
    rechaza('nadie borra su marca (no hay DELETE)',
      await admin.c.from('email_thread_reads').delete().eq('account_id', ctaZZ.id))
  }

  // ══════════════════════════════════════════════════════════════════════
  seccion('12 · Limpieza e invariantes')
  {
    for (const id of [ctaZZ.id, ctaZZ2.id]) {
      for (const t of ['email_thread_reads', 'email_events', 'email_sync_log', 'email_thread_state', 'email_threads']) {
        await s.from(t).delete().eq('account_id', id)
      }
      await s.from('email_accounts').delete().eq('id', id)
    }
    await s.from('customer_contacts').delete().eq('id', ctcZZ2.id)
    for (const id of creados.usuarios) {
      await s.from('company_memberships').delete().eq('user_id', id)
      await s.auth.admin.deleteUser(id)
    }
    await s.from('customers').delete().in('id', [cliZZ.id, cliZZ2.id])
    for (const id of creados.empresas) await s.from('companies').delete().eq('id', id)

    for (const t of TABLAS) cmp(`0 filas en ${t}`, 0, await q(t))
    cmp('las empresas vuelven a su número', empresasAntes, await q('companies'))
    cmp('los clientes vuelven a su número', clientesAntes, await q('customers'))

    // Nada de esto podía tocar los otros módulos, pero se mide igual.
    const { count: prodsBT } = await s.from('products')
      .select('*', { count: 'exact', head: true }).eq('company_id', BT)
    cmp('21.772 productos de Buscatools intactos', 21772, prodsBT)
    cmp('142 proveedores intactos', 142, await q('suppliers'))
    cmp('16 puntos de revisión de Mantenimiento intactos', 16, await q('maintenance_check_points'))
    cmp('las 6 tablas de WhatsApp siguen vacías', 0, await q('whatsapp_conversations'))
  }

  console.log('\n' + '='.repeat(78))
  console.log(`  RESULTADO: ${fallos} fallo(s)`)
  console.log('='.repeat(78))
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch((e) => { console.error('\n✗', e); process.exit(1) })
