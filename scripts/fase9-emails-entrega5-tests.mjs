/**
 * Fase 9 · Emails — entrega 5: el registro de envíos, contra la base real.
 *
 * Lo que prueba, con JWT reales:
 *
 *   · nadie lee ni escribe email_send_requests desde el cliente;
 *   · sin la firma HMAC del servicio, las RPC no hacen nada — ni con el JWT
 *     correcto; una firma de otro usuario tampoco sirve;
 *   · sólo admin y employee de la empresa de la cuenta pueden reservar;
 *   · DIEZ reservas simultáneas del mismo client_request_id → UNA nueva, contadas
 *     en la base y no en la respuesta;
 *   · las transiciones válidas e inválidas, y UN evento por envío;
 *   · el límite de seguridad por persona;
 *   · el autocompletado de destinatarios: fuentes, contexto de duplicados y roles;
 *   · el servicio público (si EMAILS_API_URL): los roles sin acceso no dejan fila.
 *
 * La clave HMAC se lee con la service key y NUNCA se imprime.
 *
 *   set -a; source .env; source .env.migration; source .env.rls.txt; set +a
 *   node scripts/fase9-emails-entrega5-tests.mjs
 *
 * NO correrla en paralelo con otra suite de base.
 */
import { createClient } from '@supabase/supabase-js'
import { createHmac, randomUUID } from 'node:crypto'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
const API = process.env.EMAILS_API_URL ?? null
if (!BASE || !PUB || !SECRET) { console.error('✗ Faltan variables'); process.exit(1) }

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(72)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const INFO = (t, d = '') => console.log(`    INFO  ${t}${d ? ' — ' + d : ''}`)
const cmp = (t, esp, real) =>
  JSON.stringify(esp) === JSON.stringify(real) ? PASS(t, JSON.stringify(real).slice(0, 80)) : FAIL(t, `esperaba ${JSON.stringify(esp)}, dio ${JSON.stringify(real)}`)
const rechaza = (t, r, patron) => {
  if (!r.error) return FAIL(`SE PERMITIÓ: ${t}`)
  if (patron && !patron.test(`${r.error.message} ${r.error.code}`)) return FAIL(t, `error inesperado: ${r.error.message}`)
  PASS(t, (r.error.message ?? r.error.code).slice(0, 50))
}

const sesion = () => createClient(BASE, PUB, { auth: { persistSession: false } })
const s = createClient(BASE, SECRET, { auth: { persistSession: false } })
const MARCA = 'ZZ-E5'
const creados = { usuarios: [], empresas: [], cuentas: [], clientes: [] }

let CLAVE = null
const firmar = (msg) => createHmac('sha256', CLAVE).update(msg, 'utf8').digest('hex')

const usuario = async (companyId, rol, customerId = null) => {
  const email = `zz-e5-${rol}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@buscatools.test`
  const password = `Zz${randomUUID()}!`
  const { data, error } = await s.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`crear ${rol}: ${error.message}`)
  creados.usuarios.push(data.user.id)
  const fila = { company_id: companyId, user_id: data.user.id, role: rol, status: 'active' }
  if (customerId) fila.customer_id = customerId
  const { error: eM } = await s.from('company_memberships').insert(fila)
  if (eM) throw new Error(`membresía ${rol}: ${eM.message}`)
  const c = sesion()
  const { data: ses, error: eL } = await c.auth.signInWithPassword({ email, password })
  if (eL) throw new Error(`login ${rol}: ${eL.message}`)
  return { id: data.user.id, c, jwt: ses.session.access_token }
}

const reservar = (u, cuenta, crid, op = 'nuevo', firmaDe = u.id) =>
  u.c.rpc('reservar_envio_email', { p_account: cuenta, p_client_request_id: crid, p_operacion: op, p_firma: firmar(`reservar|${cuenta}|${crid}|${op}|${firmaDe}`) })
const completar = (u, id, estado, msg, hilo, err = null, firmaDe = u.id) =>
  u.c.rpc('completar_envio_email', { p_request: id, p_estado: estado, p_message_id: msg, p_thread_id: hilo, p_error: err, p_firma: firmar(`completar|${id}|${estado}|${msg ?? ''}|${hilo ?? ''}|${err ?? ''}|${firmaDe}`) })
const filas = async (cuenta) => (await s.from('email_send_requests').select('*').eq('account_id', cuenta)).data ?? []
const eventos = async (cuenta, accion) => (await s.from('email_events').select('*', { count: 'exact', head: true }).eq('account_id', cuenta).eq('action', accion)).count

const barrer = async () => {
  const { data: cuentas } = await s.from('email_accounts').select('id').like('email_address', 'zz-e5-%')
  for (const c of cuentas ?? []) {
    for (const t of ['email_send_requests', 'email_events', 'email_thread_reads', 'email_thread_state', 'email_threads']) await s.from(t).delete().eq('account_id', c.id)
    await s.from('email_accounts').delete().eq('id', c.id)
  }
  const { data: us } = await s.auth.admin.listUsers({ perPage: 1000 })
  for (const u of us?.users ?? []) if (u.email?.startsWith('zz-e5-')) { await s.from('company_memberships').delete().eq('user_id', u.id); await s.auth.admin.deleteUser(u.id) }
  const { data: emp } = await s.from('companies').select('id').like('slug', 'zz-e5-%')
  const ids = (emp ?? []).map((x) => x.id)
  if (ids.length) {
    await s.from('company_memberships').delete().in('company_id', ids)
    await s.from('customer_contacts').delete().in('company_id', ids)
    await s.from('customers').delete().in('company_id', ids)
    await s.from('companies').delete().in('id', ids)
  }
}

const main = async () => {
  await barrer()
  const { data: clave, error: eClave } = await s.rpc('clave_api_email_servicio')
  if (eClave || typeof clave !== 'string' || !/^[0-9a-f]{64}$/.test(clave)) throw new Error('no se pudo leer la clave HMAC')
  CLAVE = Buffer.from(clave, 'hex')
  const antesProd = (await s.from('email_send_requests').select('*', { count: 'exact', head: true })).count
  const eventosAntes = (await s.from('email_events').select('*', { count: 'exact', head: true })).count

  seccion('1 · Fixtures')
  const empresa = async (suf) => {
    const { data, error } = await s.from('companies').insert({ slug: `zz-e5-${suf}-${Date.now()}`, name: `${MARCA} ${suf}`, default_currency: 'ARS' }).select('id').single()
    if (error) throw new Error(error.message)
    creados.empresas.push(data.id)
    return data.id
  }
  const ZZ = await empresa('propia')
  const ZZ2 = await empresa('ajena')
  const { data: cli1 } = await s.from('customers').insert({ company_id: ZZ, legal_name: `${MARCA} Uno SA`, emails: ['compartida@e5.test', 'solo@uno-e5.test'] }).select('id').single()
  const { data: cli2 } = await s.from('customers').insert({ company_id: ZZ, legal_name: `${MARCA} Dos SA`, emails: ['compartida@e5.test'] }).select('id').single()
  await s.from('customer_contacts').insert({ company_id: ZZ, customer_id: cli1.id, full_name: `${MARCA} Laura Pérez`, email: 'laura@uno-e5.test' })
  const admin = await usuario(ZZ, 'admin')
  const empleado = await usuario(ZZ, 'employee')
  const vendedor = await usuario(ZZ, 'salesperson')
  const tecnico = await usuario(ZZ, 'technician')
  const clienteU = await usuario(ZZ, 'customer', cli1.id)
  const distrib = await usuario(ZZ, 'distributor', cli1.id)
  const adminAjeno = await usuario(ZZ2, 'admin')
  const anon = sesion()
  const { data: cta } = await s.from('email_accounts').insert({ company_id: ZZ, email_address: `zz-e5-${Date.now()}@buzon-e5.test` }).select('*').single()
  const { data: ctaAjena } = await s.from('email_accounts').insert({ company_id: ZZ2, email_address: `zz-e5-ajena-${Date.now()}@buzon-e5.test` }).select('*').single()
  creados.cuentas.push(cta.id, ctaAjena.id)
  await s.from('email_threads').insert({ company_id: ZZ, account_id: cta.id, gmail_thread_id: 'e5t1', participants: ['historial@e5.test', cta.email_address], last_message_at: new Date().toISOString() })
  PASS('fixtures', '2 empresas, 7 identidades, 2 cuentas')

  seccion('2 · Nadie toca email_send_requests desde el cliente')
  for (const [n, u] of [['ADMIN', admin], ['EMPLOYEE', empleado], ['ANON', { c: anon }]]) {
    rechaza(`${n} no puede leer la tabla`, await u.c.from('email_send_requests').select('id').limit(1))
    rechaza(`${n} no puede insertar`, await u.c.from('email_send_requests').insert({ company_id: ZZ, account_id: cta.id, user_id: admin.id, client_request_id: randomUUID(), operation: 'nuevo' }))
  }
  rechaza('ADMIN no puede leer la clave HMAC', await admin.c.rpc('clave_api_email_servicio'))
  rechaza('ANON no puede leer la clave HMAC', await anon.rpc('clave_api_email_servicio'))
  rechaza('ADMIN no ve el esquema app por REST', await admin.c.schema('app').from('email_api_secretos').select('*'))

  seccion('3 · La firma')
  {
    const crid = randomUUID()
    rechaza('sin firma', await empleado.c.rpc('reservar_envio_email', { p_account: cta.id, p_client_request_id: crid, p_operacion: 'nuevo', p_firma: '' }), /firma_invalida/)
    rechaza('firma inventada', await empleado.c.rpc('reservar_envio_email', { p_account: cta.id, p_client_request_id: crid, p_operacion: 'nuevo', p_firma: 'a'.repeat(64) }), /firma_invalida/)
    rechaza('firma válida, pero de OTRO usuario', await reservar(empleado, cta.id, crid, 'nuevo', admin.id), /firma_invalida/)
    rechaza('firma de otra operación', await empleado.c.rpc('reservar_envio_email', { p_account: cta.id, p_client_request_id: crid, p_operacion: 'reenviar', p_firma: firmar(`reservar|${cta.id}|${crid}|nuevo|${empleado.id}`) }), /firma_invalida/)
    cmp('ninguno dejó fila', 0, (await filas(cta.id)).length)
  }

  seccion('4 · Roles y empresa')
  for (const [n, u] of [['SALESPERSON', vendedor], ['TECHNICIAN', tecnico], ['CUSTOMER', clienteU], ['DISTRIBUTOR', distrib]]) {
    rechaza(`${n} con firma válida no puede reservar`, await reservar(u, cta.id, randomUUID()), /sin_permiso/)
  }
  rechaza('ADMIN de otra empresa no reserva sobre esta cuenta', await reservar(adminAjeno, cta.id, randomUUID()), /sin_permiso/)
  rechaza('ADMIN no reserva sobre la cuenta ajena', await reservar(admin, ctaAjena.id, randomUUID()), /sin_permiso/)
  rechaza('ANON no puede ejecutar', await anon.rpc('reservar_envio_email', { p_account: cta.id, p_client_request_id: randomUUID(), p_operacion: 'nuevo', p_firma: 'x' }))
  cmp('ninguno dejó fila', 0, (await filas(cta.id)).length)

  seccion('5 · DIEZ reservas simultáneas → UNA nueva')
  {
    const crid = randomUUID()
    const rs = await Promise.all(Array.from({ length: 10 }, () => reservar(empleado, cta.id, crid)))
    const errores = rs.filter((r) => r.error)
    cmp('ninguna falló', 0, errores.length)
    const nuevas = rs.filter((r) => r.data?.[0]?.nuevo === true)
    cmp('exactamente UNA nueva', 1, nuevas.length)
    cmp('todas apuntan a la misma fila', 1, new Set(rs.map((r) => r.data?.[0]?.id)).size)
    cmp('y en la base hay UNA fila', 1, (await filas(cta.id)).filter((f) => f.client_request_id === crid).length)
  }

  seccion('6 · Transiciones y eventos')
  {
    const crid = randomUUID()
    const r = await reservar(admin, cta.id, crid, 'responder')
    const id = r.data[0].id
    rechaza('completar con firma inventada', await admin.c.rpc('completar_envio_email', { p_request: id, p_estado: 'enviado', p_message_id: 'm1', p_thread_id: 't1', p_error: null, p_firma: 'b'.repeat(64) }), /firma_invalida/)
    rechaza('completar con la firma de OTRO usuario', await completar(empleado, id, 'enviado', 'm1', 't1', null, admin.id), /firma_invalida/)
    rechaza('otro usuario, con su propia firma, no completa la solicitud ajena', await completar(empleado, id, 'enviado', 'm1', 't1'), /solicitud_inexistente/)
    cmp('la fila sigue reservada', 'reservado', (await filas(cta.id)).find((f) => f.id === id).status)
    rechaza('«enviado» sin message id viola la regla', await completar(admin, id, 'enviado', null, 't1'))
    const ok = await completar(admin, id, 'enviado', '1a0e5000000000m1', '1a0e5000000000t1')
    ok.error ? FAIL('completar enviado', ok.error.message) : PASS('completar enviado')
    cmp('evento respuesta_enviada: 1', 1, await eventos(cta.id, 'respuesta_enviada'))
    const { data: ev } = await s.from('email_events').select('detalle, actor, gmail_thread_id').eq('account_id', cta.id).eq('action', 'respuesta_enviada').single()
    cmp('el evento guarda message id, actor e hilo, y NADA de cuerpo', ['1a0e5000000000m1', admin.id, '1a0e5000000000t1', ['client_request_id', 'gmail_message_id', 'intentos']],
      [ev.detalle.gmail_message_id, ev.actor, ev.gmail_thread_id, Object.keys(ev.detalle).sort()])
    const rep = await completar(admin, id, 'enviado', '1a0e5000000000m1', '1a0e5000000000t1')
    rep.error ? FAIL('repetir enviado con el mismo id', rep.error.message) : PASS('repetir enviado con el mismo id es inocuo')
    cmp('y NO deja un segundo evento', 1, await eventos(cta.id, 'respuesta_enviada'))
    rechaza('enviado → fallido', await completar(admin, id, 'fallido', null, null, 'x'), /transicion_invalida/)
    const r2 = await reservar(admin, cta.id, crid, 'responder')
    cmp('reservar de nuevo algo enviado devuelve el resultado, no una nueva', [false, 'enviado', '1a0e5000000000m1'], [r2.data[0].nuevo, r2.data[0].status, r2.data[0].gmail_message_id])
    rechaza('mismo client_request_id con otra operación', await reservar(admin, cta.id, crid, 'reenviar'), /operacion_distinta/)
    rechaza('mismo client_request_id, otra persona', await reservar(empleado, cta.id, crid, 'responder'), /solicitud_de_otro_usuario/)
  }
  {
    const crid = randomUUID()
    const id = (await reservar(empleado, cta.id, crid, 'reenviar')).data[0].id
    await completar(empleado, id, 'incierto', null, null, 'TimeoutError')
    cmp('incierto: sin evento', 0, await eventos(cta.id, 'reenvio_enviado'))
    const r = await reservar(empleado, cta.id, crid, 'reenviar')
    cmp('un incierto NO se vuelve a reservar como nuevo', [false, 'incierto'], [r.data[0].nuevo, r.data[0].status])
    await completar(empleado, id, 'enviado', '1a0e5000000000m2', '1a0e5000000000t2')
    cmp('incierto → enviado (reconciliado): 1 evento', 1, await eventos(cta.id, 'reenvio_enviado'))
  }
  {
    const crid = randomUUID()
    const id = (await reservar(empleado, cta.id, crid)).data[0].id
    await completar(empleado, id, 'fallido', null, null, 'gmail_429')
    const r = await reservar(empleado, cta.id, crid)
    cmp('fallido → se puede volver a reservar, intento 2', [true, 'reservado', 2], [r.data[0].nuevo, r.data[0].status, r.data[0].intentos])
    const antesAt = (await s.from('email_send_requests').select('created_at, attempted_at').eq('id', id).single()).data
    cmp('la re-reserva mueve attempted_at (último intento) y conserva created_at', [true, true], [Date.parse(r.data[0].attempted_at) > Date.parse(r.data[0].created_at), antesAt.created_at === r.data[0].created_at || Date.parse(antesAt.created_at) === Date.parse(r.data[0].created_at)])
    cmp('la RPC devuelve attempted_at', true, typeof r.data[0].attempted_at === 'string')
  }

  seccion('7 · Descarte de borrador')
  {
    rechaza('descartar sin firma válida', await empleado.c.rpc('registrar_descarte_borrador_email', { p_account: cta.id, p_thread: 'e5t1', p_firma: 'c'.repeat(64) }), /firma_invalida/)
    rechaza('el vendedor, con firma, no registra', await vendedor.c.rpc('registrar_descarte_borrador_email', { p_account: cta.id, p_thread: 'e5t1', p_firma: firmar(`descartar|${cta.id}|e5t1|${vendedor.id}`) }), /sin_permiso/)
    const r = await empleado.c.rpc('registrar_descarte_borrador_email', { p_account: cta.id, p_thread: 'e5t1', p_firma: firmar(`descartar|${cta.id}|e5t1|${empleado.id}`) })
    r.error ? FAIL('el employee registra el descarte', r.error.message) : PASS('el employee registra el descarte')
    cmp('evento borrador_descartado: 1', 1, await eventos(cta.id, 'borrador_descartado'))
    rechaza('una acción inventada no entra en email_events', await s.from('email_events').insert({ company_id: ZZ, account_id: cta.id, action: 'borrador_autoguardado' }))
  }

  seccion('8 · Límite de seguridad por persona')
  {
    const lote = Array.from({ length: 30 }, () => ({ company_id: ZZ, account_id: cta.id, user_id: tecnico.id, client_request_id: randomUUID(), operation: 'nuevo' }))
    // El técnico no puede reservar; se usa su id sólo para llenar su cupo sin
    // mezclar con el de las pruebas de arriba. Se prueba con un employee nuevo.
    const lleno = await usuario(ZZ, 'employee')
    await s.from('email_send_requests').insert(lote.map((f) => ({ ...f, user_id: lleno.id })))
    rechaza('con 30 envíos en la última hora, el 31 se rechaza', await reservar(lleno, cta.id, randomUUID()), /limite_envios_usuario/)
    await s.from('email_send_requests').update({ status: 'fallido' }).eq('user_id', lleno.id)
    const r = await reservar(lleno, cta.id, randomUUID())
    r.error ? FAIL('los fallidos no cuentan para el límite', r.error.message) : PASS('los fallidos no cuentan para el límite')
  }

  seccion('9 · Autocompletar destinatarios')
  {
    const ac = async (u, q) => (await u.c.rpc('autocompletar_destinatarios_email', { p_company: ZZ, p_q: q })).data ?? []
    const r1 = await ac(empleado, 'uno-e5')
    cmp('contacto y email de cliente, con su fuente', [['laura@uno-e5.test', 'contacto'], ['solo@uno-e5.test', 'cliente']], r1.map((x) => [x.direccion, x.fuente]))
    const comp = (await ac(empleado, 'compartida')).find((x) => x.direccion === 'compartida@e5.test')
    cmp('una dirección en dos clientes trae ese contexto', 2, comp?.clientes)
    cmp('del historial del índice', 'historial', (await ac(empleado, 'historial@')).find((x) => x.direccion === 'historial@e5.test')?.fuente)
    cmp('menos de 2 letras: nada', 0, (await ac(empleado, 'a')).length)
    cmp('el vendedor no recibe direcciones del historial', 0, (await ac(vendedor, 'historial@')).length)
    cmp('el admin ajeno no recibe nada de esta empresa', 0, (await adminAjeno.c.rpc('autocompletar_destinatarios_email', { p_company: ZZ, p_q: 'uno-e5' })).data?.length ?? 0)
    rechaza('ANON no puede ejecutar', await anon.rpc('autocompletar_destinatarios_email', { p_company: ZZ, p_q: 'uno' }))
  }

  seccion('10 · Servicio público (si EMAILS_API_URL)')
  if (!API) INFO('EMAILS_API_URL no definido', 'se saltea')
  else {
    const antes = (await filas(cta.id)).length
    const enviarApi = (jwt, cuerpo) => fetch(`${API}/gmail/send`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(cuerpo) })
    const cuerpo = { account_id: cta.id, client_request_id: randomUUID(), modo: 'nuevo', para: ['destino@e5.test'], cc: [], cco: [], asunto: 'x', texto: 'x', adjuntos: [] }
    const sinContenido = async (r) => ({ status: r.status, ok: /^\{"error":"[a-z_]+"(,"campo":"[a-z_:]+")?\}$/.test(await r.text()) })
    cmp('sin JWT: 401 sin contenido', { status: 401, ok: true }, await sinContenido(await enviarApi(null, cuerpo)))
    for (const [n, u] of [['SALESPERSON', vendedor], ['CUSTOMER', clienteU], ['DISTRIBUTOR', distrib], ['TECHNICIAN', tecnico], ['ADMIN ajeno', adminAjeno]]) {
      cmp(`${n}: 404 sin contenido`, { status: 404, ok: true }, await sinContenido(await enviarApi(u.jwt, { ...cuerpo, client_request_id: randomUUID() })))
    }
    cmp('ADMIN propio, buzón fuera del allowlist: 404', { status: 404, ok: true }, await sinContenido(await enviarApi(admin.jwt, { ...cuerpo, client_request_id: randomUUID() })))
    cmp('un intento de inyección en el destinatario: 422', 422, (await enviarApi(admin.jwt, { ...cuerpo, para: ['a@b.test\r\nBcc: x@evil.test'] })).status)
    cmp('ninguno dejó una reserva', antes, (await filas(cta.id)).length)
    const borr = await fetch(`${API}/gmail/draft`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${vendedor.jwt}` }, body: JSON.stringify({ ...cuerpo }) })
    cmp('borrador del vendedor: 404', 404, borr.status)
  }

  seccion('11 · Limpieza e invariantes')
  for (const id of creados.cuentas) {
    for (const t of ['email_send_requests', 'email_events', 'email_thread_reads', 'email_thread_state', 'email_threads']) await s.from(t).delete().eq('account_id', id)
    await s.from('email_accounts').delete().eq('id', id)
  }
  for (const id of creados.usuarios) { await s.from('company_memberships').delete().eq('user_id', id); await s.auth.admin.deleteUser(id) }
  await s.from('customer_contacts').delete().in('company_id', creados.empresas)
  await s.from('customers').delete().in('company_id', creados.empresas)
  for (const id of creados.empresas) await s.from('companies').delete().eq('id', id)
  cmp('email_send_requests vuelve a su número', antesProd, (await s.from('email_send_requests').select('*', { count: 'exact', head: true })).count)
  cmp('email_events vuelve a su número', eventosAntes, (await s.from('email_events').select('*', { count: 'exact', head: true })).count)

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
