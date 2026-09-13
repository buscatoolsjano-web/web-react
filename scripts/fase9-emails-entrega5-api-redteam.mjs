/**
 * Fase 9 · Emails — entrega 5: red team de las rutas de REDACCIÓN del servicio
 * público (buscatools-erp-email-api), SIN ENVIAR NI CREAR NADA EN GMAIL.
 *
 *   GET /gmail/drafts · GET|POST|DELETE /gmail/draft · POST /gmail/send
 *
 * Cómo se garantiza que nada llegue a Gmail:
 *
 *   · los ataques de identidad usan un cuerpo «trampa»: pasa la validación de
 *     forma, pero lleva un adjunto `original` en un mail NUEVO, que el servidor
 *     rechaza en `preparar()` ANTES de cualquier llamada a Gmail. Si una identidad
 *     sin permiso pasara la autorización por un bug, igual no saldría nada: se
 *     vería como una reserva (fila) y la suite falla.
 *   · los casos de validación (sin destinatarios, CR/LF, from, adjunto inválido…)
 *     se cortan antes de la base y de Gmail: no dejan fila.
 *   · el admin propio usa la trampa como control positivo: pasa la autorización,
 *     reserva, y termina 422 + fila «fallido» (0 Gmail). Las filas se borran.
 *   · las únicas llamadas a Gmail son LECTURAS del admin/employee (listar
 *     borradores, pedir un borrador inexistente). Nunca se imprime su contenido.
 *
 * Identidades con JWT real: admin real de Buscatools; employee, salesperson,
 * technician, customer y distributor TEMPORALES en Buscatools; admin temporal de
 * una empresa temporal ajena, con su cuenta y un hilo propio.
 *
 *   set -a; source .env; source .env.migration; source .env.rls.txt; set +a
 *   EMAILS_API_URL=https://… node scripts/fase9-emails-entrega5-api-redteam.mjs
 *
 * NO correrla en paralelo con otra suite de base.
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
const API = process.env.EMAILS_API_URL
if (!BASE || !PUB || !SECRET || !API || !process.env.BT_PW_JANO) { console.error('✗ Faltan variables'); process.exit(1) }

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(72)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const INFO = (t, d = '') => console.log(`    INFO  ${t}${d ? ' — ' + d : ''}`)
const s = createClient(BASE, SECRET, { auth: { persistSession: false } })
const MARCA = 'zz-e5rt'
const creados = { usuarios: [], empresas: [], cuentas: [], crids: [] }

const login = async (email, password) => {
  const c = createClient(BASE, PUB, { auth: { persistSession: false } })
  const { data, error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`login: ${error.message}`)
  return data.session.access_token
}
const temporal = async (companyId, rol, customerId = null) => {
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

/**
 * Pide y clasifica. `contenido` = cualquier cosa que no sea un error chico
 * ({"error":"…"} con, a lo sumo, "campo"). Un 404 con datos adentro es contenido.
 */
const pedir = async (metodo, ruta, { params = {}, cuerpo, jwt, headers = {} } = {}) => {
  const h = { ...headers }
  if (jwt) h.Authorization = `Bearer ${jwt}`
  if (cuerpo !== undefined) h['Content-Type'] = 'application/json'
  const qs = Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''
  const r = await fetch(`${API}${ruta}${qs}`, { method: metodo, headers: h, ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}) })
  const texto = await r.text()
  let json = null
  try { json = JSON.parse(texto) } catch { /* no JSON */ }
  const claves = json && typeof json === 'object' ? Object.keys(json).sort().join(',') : ''
  const esErrorChico = json && typeof json.error === 'string' && (claves === 'error' || claves === 'campo,error')
  return { status: r.status, bytes: texto.length, json, contenido: !esErrorChico }
}
const bloqueado = (t, r, esperados, campo = null) => {
  const okCampo = campo === null || r.json?.campo === campo
  if (esperados.includes(r.status) && !r.contenido && okCampo) PASS(t, `${r.status} ${r.json?.error}${r.json?.campo ? ':' + r.json.campo : ''} · sin contenido`)
  else FAIL(t, `status ${r.status}, error=${r.json?.error}, campo=${r.json?.campo}, contenido=${r.contenido}, ${r.bytes} B`)
}
const filasDe = async (crids) => (crids.length ? ((await s.from('email_send_requests').select('id,status,error_code,client_request_id').in('client_request_id', crids)).data ?? []) : [])
const totalPedidos = async () => (await s.from('email_send_requests').select('*', { count: 'exact', head: true })).count

const main = async () => {
  const inicio = new Date().toISOString()
  const BT = (await s.from('companies').select('id').eq('slug', 'buscatools').single()).data.id
  const cuenta = (await s.from('email_accounts').select('id').eq('company_id', BT).single()).data.id
  const { data: hiloReal } = await s.from('email_threads').select('gmail_thread_id').eq('account_id', cuenta).order('last_message_at', { ascending: false }).limit(1).single()
  const cliente = (await s.from('customers').select('id').eq('company_id', BT).limit(1).single()).data.id
  const pedidosAntes = await totalPedidos()
  const eventosAntes = (await s.from('email_events').select('*', { count: 'exact', head: true })).count

  seccion('Identidades')
  const jwtAdmin = await login('buscatools.jano@gmail.com', process.env.BT_PW_JANO)
  const jwt = {
    employee: await temporal(BT, 'employee'),
    salesperson: await temporal(BT, 'salesperson'),
    technician: await temporal(BT, 'technician'),
    customer: await temporal(BT, 'customer', cliente),
    distributor: await temporal(BT, 'distributor', cliente),
  }
  const { data: empAjena } = await s.from('companies').insert({ slug: `${MARCA}-ajena-${Date.now()}`, name: 'ZZ-E5RT ajena', default_currency: 'ARS' }).select('id').single()
  creados.empresas.push(empAjena.id)
  const jwtAjeno = await temporal(empAjena.id, 'admin')
  const { data: ctaAjena } = await s.from('email_accounts').insert({ company_id: empAjena.id, email_address: `${MARCA}-${Date.now()}@ajena.test` }).select('id').single()
  creados.cuentas.push(ctaAjena.id)
  await s.from('email_threads').insert({ company_id: empAjena.id, account_id: ctaAjena.id, gmail_thread_id: 'aaaaaaaaaaaaaaaa' })
  const forjado = (() => {
    const cuerpo = JSON.parse(Buffer.from(jwtAdmin.split('.')[1], 'base64url').toString())
    return `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ ...cuerpo, role: 'service_role' })).toString('base64url')}.`
  })()
  PASS('identidades con JWT real', 'admin real + 5 roles temporales + admin de empresa ajena')

  // La trampa: forma válida, pero un adjunto `original` en un mail nuevo → 422 en preparar(), antes de Gmail.
  const crid = () => { const c = randomUUID(); creados.crids.push(c); return c }
  const trampa = (extra = {}) => ({
    account_id: cuenta, modo: 'nuevo', para: ['nadie@example.invalid'], cc: [], cco: [],
    asunto: 'zz-e5rt trampa', texto: 'no sale', adjuntos: [{ tipo: 'original', message_id: 'bbbbbbbbbbbbbbbb', part_id: '1' }], ...extra,
  })
  const responderTrampa = (threadId, extra = {}) => trampa({ modo: 'responder', thread_id: threadId, ref_message_id: 'cccccccccccccccc', adjuntos: [], ...extra })

  seccion('A–C · sin identidad válida (send, draft, drafts)')
  const sinId = [['sin JWT', null], ['JWT con firma alterada', jwtAdmin.slice(0, -6) + 'AAAAAA'], ['JWT basura', 'a.b.c'], ['alg=none + role=service_role', forjado], ['anon (clave publicable)', PUB]]
  for (const [n, token] of sinId) {
    bloqueado(`${n} · POST /gmail/send`, await pedir('POST', '/gmail/send', { cuerpo: { ...trampa(), client_request_id: crid() }, jwt: token }), [401, 404])
    bloqueado(`${n} · POST /gmail/draft`, await pedir('POST', '/gmail/draft', { cuerpo: trampa(), jwt: token }), [401, 404])
    bloqueado(`${n} · GET /gmail/drafts`, await pedir('GET', '/gmail/drafts', { params: { account_id: cuenta }, jwt: token }), [401, 404])
    bloqueado(`${n} · GET /gmail/draft`, await pedir('GET', '/gmail/draft', { params: { account_id: cuenta, draft_id: 'r1234567890' }, jwt: token }), [401, 404])
    bloqueado(`${n} · DELETE /gmail/draft`, await pedir('DELETE', '/gmail/draft', { params: { account_id: cuenta, draft_id: 'r1234567890' }, jwt: token }), [401, 404])
  }

  seccion('D–G · roles sin acceso a Emails (salesperson, technician, customer, distributor)')
  for (const rol of ['salesperson', 'technician', 'customer', 'distributor']) {
    bloqueado(`${rol} · send nuevo`, await pedir('POST', '/gmail/send', { cuerpo: { ...trampa(), client_request_id: crid() }, jwt: jwt[rol] }), [404])
    bloqueado(`${rol} · send respuesta en hilo real`, await pedir('POST', '/gmail/send', { cuerpo: { ...responderTrampa(hiloReal.gmail_thread_id), client_request_id: crid() }, jwt: jwt[rol] }), [404])
    bloqueado(`${rol} · crear borrador`, await pedir('POST', '/gmail/draft', { cuerpo: trampa(), jwt: jwt[rol] }), [404])
    bloqueado(`${rol} · listar borradores`, await pedir('GET', '/gmail/drafts', { params: { account_id: cuenta }, jwt: jwt[rol] }), [404])
    bloqueado(`${rol} · leer borrador`, await pedir('GET', '/gmail/draft', { params: { account_id: cuenta, draft_id: 'r1234567890' }, jwt: jwt[rol] }), [404])
    bloqueado(`${rol} · descartar borrador`, await pedir('DELETE', '/gmail/draft', { params: { account_id: cuenta, draft_id: 'r1234567890' }, jwt: jwt[rol] }), [404])
  }

  seccion('H–J · empresa, cuenta, hilo y borrador ajenos')
  bloqueado('admin ajeno · send sobre la cuenta de Buscatools', await pedir('POST', '/gmail/send', { cuerpo: { ...trampa(), client_request_id: crid() }, jwt: jwtAjeno }), [404])
  bloqueado('admin ajeno · borradores de Buscatools', await pedir('GET', '/gmail/drafts', { params: { account_id: cuenta }, jwt: jwtAjeno }), [404])
  bloqueado('admin ajeno · SU cuenta (fuera del allowlist) → send', await pedir('POST', '/gmail/send', { cuerpo: { ...trampa({ account_id: ctaAjena.id }), client_request_id: crid() }, jwt: jwtAjeno }), [404])
  bloqueado('admin ajeno · SU cuenta → leer borrador', await pedir('GET', '/gmail/draft', { params: { account_id: ctaAjena.id, draft_id: 'r1234567890' }, jwt: jwtAjeno }), [404])
  bloqueado('admin ajeno · SU hilo → responder', await pedir('POST', '/gmail/send', { cuerpo: { ...responderTrampa('aaaaaaaaaaaaaaaa', { account_id: ctaAjena.id }), client_request_id: crid() }, jwt: jwtAjeno }), [404])
  bloqueado('admin propio · cuenta AJENA → send', await pedir('POST', '/gmail/send', { cuerpo: { ...trampa({ account_id: ctaAjena.id }), client_request_id: crid() }, jwt: jwtAdmin }), [404])
  bloqueado('admin propio · cuenta AJENA → borradores', await pedir('GET', '/gmail/drafts', { params: { account_id: ctaAjena.id }, jwt: jwtAdmin }), [404])
  bloqueado('admin propio · hilo que no está en SU índice → responder', await pedir('POST', '/gmail/send', { cuerpo: { ...responderTrampa('aaaaaaaaaaaaaaaa'), client_request_id: crid() }, jwt: jwtAdmin }), [404])
  bloqueado('employee · cuenta inexistente', await pedir('POST', '/gmail/send', { cuerpo: { ...trampa({ account_id: randomUUID() }), client_request_id: crid() }, jwt: jwt.employee }), [404])
  const filasAtaques = await filasDe(creados.crids)
  filasAtaques.length === 0 ? PASS('ningún ataque de identidad dejó una reserva', `0 filas de ${creados.crids.length} client_request_id`) : FAIL('hay reservas de ataques', String(filasAtaques.length))

  seccion('K · admin y employee pasan la autorización (control, sin Gmail)')
  const cridAdmin = crid()
  bloqueado('admin · trampa → pasa autorización, reserva y corta en preparar()', await pedir('POST', '/gmail/send', { cuerpo: { ...trampa(), client_request_id: cridAdmin }, jwt: jwtAdmin }), [422], 'adjuntos')
  const cridEmp = crid()
  bloqueado('employee · trampa → idem', await pedir('POST', '/gmail/send', { cuerpo: { ...trampa(), client_request_id: cridEmp }, jwt: jwt.employee }), [422], 'adjuntos')
  {
    const f = await filasDe([cridAdmin, cridEmp])
    const ok = f.length === 2 && f.every((x) => x.status === 'fallido' && /adjuntos$/.test(x.error_code ?? ''))
    ok ? PASS('las dos reservas quedaron «fallido» (adjuntos): autorizadas, 0 Gmail') : FAIL('reservas de control', JSON.stringify(f.map((x) => [x.status, x.error_code])))
  }
  bloqueado('admin · borrador trampa → 422 antes de crear nada en Gmail', await pedir('POST', '/gmail/draft', { cuerpo: trampa(), jwt: jwtAdmin }), [422], 'adjuntos')
  {
    const r = await pedir('GET', '/gmail/drafts', { params: { account_id: cuenta }, jwt: jwt.employee })
    Array.isArray(r.json?.borradores) || Array.isArray(r.json)
      ? PASS('employee · listar borradores (lectura) → 200', `${(r.json.borradores ?? r.json).length} borrador(es); contenido no impreso`)
      : FAIL('employee · listar borradores', `status ${r.status}`)
  }
  bloqueado('admin · leer un borrador inexistente (lectura) → 404', await pedir('GET', '/gmail/draft', { params: { account_id: cuenta, draft_id: 'r0000000000000000000' }, jwt: jwtAdmin }), [404])

  seccion('L · send request AJENO (mismo client_request_id, otra persona)')
  bloqueado('employee reusa el client_request_id del admin → 404', await pedir('POST', '/gmail/send', { cuerpo: { ...trampa(), client_request_id: cridAdmin }, jwt: jwt.employee }), [404])
  {
    const f = await filasDe([cridAdmin])
    f.length === 1 && f[0].status === 'fallido' ? PASS('la fila del admin quedó intacta') : FAIL('fila del admin', JSON.stringify(f))
  }

  seccion('M · validación ANTES de la base y de Gmail (admin real, cuenta real)')
  const antesVal = await totalPedidos()
  const valido = (extra = {}) => ({ account_id: cuenta, modo: 'nuevo', para: ['nadie@example.invalid'], cc: [], cco: [], asunto: 'zz-e5rt', texto: 'no sale', adjuntos: [], client_request_id: crid(), ...extra })
  const casos = [
    ['sin destinatarios', valido({ para: [] }), 'destinatarios'],
    ['email inválido', valido({ para: ['no-es-un-email'] }), 'para'],
    ['CR/LF en el destinatario', valido({ para: ['a@b.test\r\nBcc: x@evil.test'] }), 'para'],
    ['coma en el destinatario (dos direcciones en una)', valido({ cc: ['a@b.test, x@evil.test'] }), 'cc'],
    ['CR/LF en el asunto', valido({ asunto: 'Hola\r\nBcc: x@evil.test' }), 'asunto'],
    ['LF solo en el asunto', valido({ asunto: 'Hola\nX-Evil: 1' }), 'asunto'],
    ['from arbitrario', valido({ from: 'ceo@otra.test' }), 'campo_desconocido'],
    ['de arbitrario', valido({ de: 'ceo@otra.test' }), 'campo_desconocido'],
    ['reply_to arbitrario', valido({ reply_to: 'x@evil.test' }), 'campo_desconocido'],
    ['headers arbitrarios', valido({ headers: { Bcc: 'x@evil.test' } }), 'campo_desconocido'],
    ['raw MIME del cliente', valido({ raw: 'RnJvbTogeEBldmlsLnRlc3Q=' }), 'campo_desconocido'],
    ['client_request_id mal formado', { ...valido(), client_request_id: 'no-es-uuid' }, 'client_request_id'],
    ['client_request_id ausente', (() => { const v = valido(); delete v.client_request_id; return v })(), 'client_request_id'],
    ['account_id mal formado', valido({ account_id: '1 OR 1=1' }), 'account_id'],
    ['modo inventado', valido({ modo: 'reenviar_a_todos' }), 'modo'],
    ['adjunto con base64 inválido', valido({ adjuntos: [{ tipo: 'nuevo', nombre: 'a.txt', mime: 'text/plain', datos: '<script>' }] }), 'adjuntos'],
    ['adjunto de tipo inventado', valido({ adjuntos: [{ tipo: 'url', href: 'https://evil.test/x' }] }), 'adjuntos'],
    ['adjunto con campo extra', valido({ adjuntos: [{ tipo: 'nuevo', nombre: 'a.txt', mime: 'text/plain', datos: 'aG9sYQ', headers: 'Bcc: x' }] }), 'adjuntos'],
    ['adjunto original con id mal formado', valido({ adjuntos: [{ tipo: 'original', message_id: '../../x', part_id: '1' }] }), 'adjuntos'],
    ['21 adjuntos', valido({ adjuntos: Array.from({ length: 21 }, () => ({ tipo: 'nuevo', nombre: 'a', mime: 'text/plain', datos: 'aA' })) }), 'adjuntos'],
    ['101 destinatarios', valido({ para: Array.from({ length: 101 }, (_, i) => `n${i}@example.invalid`) }), 'destinatarios'],
    ['respuesta sin thread_id', valido({ modo: 'responder' }), 'thread_id'],
  ]
  for (const [n, cuerpo, campo] of casos) bloqueado(`send · ${n}`, await pedir('POST', '/gmail/send', { cuerpo, jwt: jwtAdmin }), [422], campo)
  bloqueado('send · cuerpo que no es un objeto', await pedir('POST', '/gmail/send', { cuerpo: ['x'], jwt: jwtAdmin }), [422, 400])
  bloqueado('draft · from arbitrario', await pedir('POST', '/gmail/draft', { cuerpo: { ...valido({ from: 'ceo@otra.test' }), client_request_id: undefined }, jwt: jwtAdmin }), [422], 'campo_desconocido')
  bloqueado('draft · CR/LF en el asunto', await pedir('POST', '/gmail/draft', { cuerpo: { ...valido({ asunto: 'a\r\nBcc: x@evil.test' }), client_request_id: undefined }, jwt: jwtAdmin }), [422], 'asunto')
  {
    const despues = await totalPedidos()
    despues === antesVal ? PASS('ninguna validación dejó fila en email_send_requests', `${antesVal} → ${despues}`) : FAIL('validación dejó filas', `${antesVal} → ${despues}`)
  }

  seccion('N · CORS de las rutas nuevas')
  for (const [origen, espera] of [['https://app.buscatools.com', true], ['http://localhost:5173', true], ['https://evil.test', false], ['null', false]]) {
    const r = await fetch(`${API}/gmail/send`, { method: 'OPTIONS', headers: { Origin: origen, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } })
    const acao = r.headers.get('access-control-allow-origin')
    const ok = espera ? acao === origen : acao === null
    ok ? PASS(`preflight ${origen}`, `allow-origin=${acao ?? '(ninguno)'}`) : FAIL(`preflight ${origen}`, `allow-origin=${acao}`)
    if (acao === '*') FAIL('CORS con *')
  }

  seccion('O · Limpieza e invariantes')
  await s.from('email_send_requests').delete().in('client_request_id', creados.crids)
  for (const id of creados.cuentas) {
    for (const t of ['email_send_requests', 'email_events', 'email_thread_reads', 'email_thread_state', 'email_threads']) await s.from(t).delete().eq('account_id', id)
    await s.from('email_accounts').delete().eq('id', id)
  }
  for (const id of creados.usuarios) { await s.from('company_memberships').delete().eq('user_id', id); await s.auth.admin.deleteUser(id) }
  for (const id of creados.empresas) await s.from('companies').delete().eq('id', id)
  const pedidosDespues = await totalPedidos()
  const eventosDespues = (await s.from('email_events').select('*', { count: 'exact', head: true })).count
  pedidosDespues === pedidosAntes ? PASS('email_send_requests vuelve a su número', String(pedidosDespues)) : FAIL('email_send_requests', `${pedidosAntes} → ${pedidosDespues}`)
  eventosDespues === eventosAntes ? PASS('email_events sin cambios (0 eventos de envío)', String(eventosDespues)) : FAIL('email_events', `${eventosAntes} → ${eventosDespues}`)
  INFO('ventana para revisar logs', `desde ${inicio}`)

  console.log('\n' + '='.repeat(78))
  console.log(`  RESULTADO: ${fallos} fallo(s)`)
  console.log('='.repeat(78))
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('\n✗ La suite se cayó:', e.message)
  try {
    await s.from('email_send_requests').delete().in('client_request_id', creados.crids)
    for (const id of creados.cuentas) {
      for (const t of ['email_send_requests', 'email_events', 'email_threads']) await s.from(t).delete().eq('account_id', id)
      await s.from('email_accounts').delete().eq('id', id)
    }
    for (const id of creados.usuarios) { await s.from('company_memberships').delete().eq('user_id', id); await s.auth.admin.deleteUser(id) }
    for (const id of creados.empresas) await s.from('companies').delete().eq('id', id)
  } catch { /* se limpia en la próxima corrida */ }
  process.exit(1)
})
