/**
 * Fase 9 · Emails — entrega 4: red team del servicio PÚBLICO de la bandeja.
 *
 *   buscatools-erp-email-api  (Cloud Run, invocable sin IAM por diseño)
 *
 * Cada caso mide si SALE CONTENIDO, no sólo el status: un 200 vacío o un 404
 * con el hilo adentro serían igual de graves.
 *
 * Identidades con JWT real:
 *   · admin real de Buscatools (el de las suites)
 *   · employee, salesperson, technician, customer y distributor TEMPORALES en
 *     Buscatools — se crean acá y se borran al final
 *   · admin temporal de una empresa temporal ajena
 *
 * El contenido real que se baja NO se imprime: sólo tamaños, cantidades y un
 * hash del adjunto.
 *
 *   set -a; source .env; source .env.migration; source .env.rls.txt; set +a
 *   EMAILS_API_URL=https://… node scripts/fase9-emails-entrega4-api-redteam.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { createHash, randomUUID } from 'node:crypto'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
const API = process.env.EMAILS_API_URL
if (!BASE || !PUB || !SECRET || !API || !process.env.BT_PW_JANO) { console.error('✗ Faltan variables'); process.exit(1) }

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(72)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const s = createClient(BASE, SECRET, { auth: { persistSession: false } })
const MARCA = 'zz-e4rt'
const creados = { usuarios: [], empresas: [], cuentas: [] }

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

/** Pide y clasifica. `contenido` = el cuerpo trae mensajes, bytes de adjunto o algo que no es un error chico. */
const pedir = async (ruta, params, jwt, extraHeaders = {}) => {
  const headers = { ...extraHeaders }
  if (jwt) headers.Authorization = `Bearer ${jwt}`
  const r = await fetch(`${API}${ruta}?${new URLSearchParams(params)}`, { headers })
  const buf = Buffer.from(await r.arrayBuffer())
  const texto = buf.toString('utf8')
  let json = null
  try { json = JSON.parse(texto) } catch { /* binario */ }
  const esErrorChico = json && typeof json.error === 'string' && Object.keys(json).length === 1
  return { status: r.status, bytes: buf.length, buf, json, contenido: !esErrorChico, headers: r.headers }
}
const bloqueado = (t, r, esperados) => {
  const okStatus = esperados.includes(r.status)
  if (okStatus && !r.contenido) PASS(t, `${r.status} ${r.json?.error} · ${r.bytes} B, sin contenido`)
  else FAIL(t, `status ${r.status}, contenido=${r.contenido}, ${r.bytes} B`)
}

const main = async () => {
  const BT = (await s.from('companies').select('id').eq('slug', 'buscatools').single()).data.id
  const cuenta = (await s.from('email_accounts').select('id').eq('company_id', BT).single()).data.id
  const { data: conAdj } = await s.from('email_threads').select('gmail_thread_id')
    .eq('account_id', cuenta).eq('has_attachments', true).order('last_message_at', { ascending: false }).limit(1).single()
  const { data: otroHilo } = await s.from('email_threads').select('gmail_thread_id')
    .eq('account_id', cuenta).eq('has_attachments', false).order('last_message_at', { ascending: false }).limit(1).single()
  const hilo = { account_id: cuenta, thread_id: conAdj.gmail_thread_id }
  const hilo2 = { account_id: cuenta, thread_id: otroHilo.gmail_thread_id }
  const cliente = (await s.from('customers').select('id').eq('company_id', BT).limit(1).single()).data.id

  seccion('Identidades')
  const jwtAdmin = await login('buscatools.jano@gmail.com', process.env.BT_PW_JANO)
  const jwt = {
    employee: await temporal(BT, 'employee'),
    salesperson: await temporal(BT, 'salesperson'),
    technician: await temporal(BT, 'technician'),
    customer: await temporal(BT, 'customer', cliente),
    distributor: await temporal(BT, 'distributor', cliente),
  }
  const { data: empAjena } = await s.from('companies')
    .insert({ slug: `${MARCA}-ajena-${Date.now()}`, name: 'ZZ-E4RT ajena', default_currency: 'ARS' }).select('id').single()
  creados.empresas.push(empAjena.id)
  const jwtAjeno = await temporal(empAjena.id, 'admin')
  const { data: ctaAjena } = await s.from('email_accounts')
    .insert({ company_id: empAjena.id, email_address: `${MARCA}-${Date.now()}@ajena.test` }).select('id').single()
  creados.cuentas.push(ctaAjena.id)
  await s.from('email_threads').insert({ company_id: empAjena.id, account_id: ctaAjena.id, gmail_thread_id: conAdj.gmail_thread_id })
  PASS('7 identidades con JWT real', 'admin real + 5 roles temporales en Buscatools + admin de empresa ajena')

  seccion('A–C · sin identidad')
  bloqueado('A · sin JWT', await pedir('/gmail/thread', hilo, null), [401, 403])
  bloqueado('B · JWT con firma alterada', await pedir('/gmail/thread', hilo, jwtAdmin.slice(0, -6) + 'AAAAAA'), [401])
  bloqueado('B · JWT basura con 3 partes', await pedir('/gmail/thread', hilo, 'a.b.c'), [401])
  {
    const [h, p] = jwtAdmin.split('.')
    const cuerpo = JSON.parse(Buffer.from(p, 'base64url').toString())
    const forjado = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ ...cuerpo, role: 'service_role' })).toString('base64url')}.`
    bloqueado('B · JWT alg=none con role=service_role', await pedir('/gmail/thread', hilo, forjado), [401])
    void h
  }
  bloqueado('C · la clave publicable como Bearer (anon)', await pedir('/gmail/thread', hilo, PUB), [401, 404])
  {
    const r = await pedir('/gmail/thread', hilo, null, { Authorization: `Bearer ${PUB}` })
    bloqueado('C · anon, otra forma del header', r, [401, 404])
  }

  seccion('D–G · roles internos y externos sin acceso a Emails')
  for (const rol of ['salesperson', 'technician', 'customer', 'distributor']) {
    bloqueado(`${rol} · hilo`, await pedir('/gmail/thread', hilo, jwt[rol]), [404, 403])
  }

  seccion('H–I · admin y employee obtienen contenido')
  let payload = null
  for (const [nombre, token] of [['H · admin', jwtAdmin], ['I · employee', jwt.employee]]) {
    const r = await pedir('/gmail/thread', hilo, token)
    const n = r.json?.mensajes?.length ?? 0
    if (r.status === 200 && n > 0) {
      PASS(`${nombre} recibe el hilo`, `${n} mensaje(s) · ${(r.bytes / 1024).toFixed(1)} kB · cache-control=${r.headers.get('cache-control')}`)
      payload = payload ?? r.json
    } else FAIL(`${nombre} recibe el hilo`, `status ${r.status}`)
  }

  seccion('J · empresa ajena')
  bloqueado('J · admin ajeno pide el hilo de Buscatools', await pedir('/gmail/thread', hilo, jwtAjeno), [404])
  bloqueado('J · admin ajeno pide SU cuenta con un gmail_thread_id real de Buscatools',
    await pedir('/gmail/thread', { account_id: ctaAjena.id, thread_id: conAdj.gmail_thread_id }, jwtAjeno), [404])
  bloqueado('J · admin de Buscatools pide la cuenta ajena', await pedir('/gmail/thread', { account_id: ctaAjena.id, thread_id: conAdj.gmail_thread_id }, jwtAdmin), [404])

  seccion('K · hilo inexistente, arbitrario o malformado')
  bloqueado('K · id hexadecimal que no está en el índice', await pedir('/gmail/thread', { account_id: cuenta, thread_id: '1a0000000000beef' }, jwtAdmin), [404])
  bloqueado('K · path traversal', await pedir('/gmail/thread', { account_id: cuenta, thread_id: '../../profile' }, jwtAdmin), [404])
  bloqueado('K · account_id inválido', await pedir('/gmail/thread', { account_id: 'x', thread_id: conAdj.gmail_thread_id }, jwtAdmin), [404])

  seccion('L · adjuntos')
  const mensajes = payload?.mensajes ?? []
  const conAdjunto = mensajes.find((m) => m.adjuntos.some((a) => !a.inline))
  if (!conAdjunto) {
    FAIL('el hilo con has_attachments trae un adjunto no inline', 'no se encontró')
  } else {
    const adj = conAdjunto.adjuntos.find((a) => !a.inline)
    const params = { ...hilo, message_id: conAdjunto.id, part_id: adj.partId }
    const ok = await pedir('/gmail/attachment', params, jwtAdmin)
    if (ok.status === 200 && ok.bytes > 0) {
      PASS('admin baja el adjunto', `${ok.bytes} B · sha256 ${createHash('sha256').update(ok.buf).digest('hex').slice(0, 16)}… · ${ok.headers.get('content-type')} · metadata decía ${adj.tamano} B`)
      Math.abs(ok.bytes - adj.tamano) <= Math.max(16, adj.tamano * 0.02)
        ? PASS('el tamaño bajado coincide con la metadata') : FAIL('tamaño distinto a la metadata', `${ok.bytes} vs ${adj.tamano}`)
      ok.headers.get('cache-control') === 'private, no-store' ? PASS('adjunto sin caché') : FAIL('adjunto cacheable')
      const cuerpoTxt = ok.buf.toString('latin1')
      ;/ya29\.|eyJhbGciOi|Bearer /.test(cuerpoTxt) || /ya29\.|eyJ/.test(JSON.stringify([...ok.headers]))
        ? FAIL('la respuesta expone un token') : PASS('la respuesta no expone tokens de Gmail ni JWT')
    } else FAIL('admin baja el adjunto', `status ${ok.status}`)

    for (const rol of ['salesperson', 'customer']) {
      bloqueado(`L · ${rol} pide el adjunto`, await pedir('/gmail/attachment', params, jwt[rol]), [404])
    }
    bloqueado('L · admin ajeno pide el adjunto', await pedir('/gmail/attachment', params, jwtAjeno), [404])
    bloqueado('L · sin JWT', await pedir('/gmail/attachment', params, null), [401])
    bloqueado('L · message_id de OTRO hilo con este thread_id', await pedir('/gmail/attachment', { ...hilo, message_id: otroHilo.gmail_thread_id, part_id: adj.partId }, jwtAdmin), [404])
    bloqueado('L · el mensaje correcto pedido bajo OTRO hilo visible', await pedir('/gmail/attachment', { ...hilo2, message_id: conAdjunto.id, part_id: adj.partId }, jwtAdmin), [404])
    bloqueado('L · part_id inexistente', await pedir('/gmail/attachment', { ...params, part_id: '99' }, jwtAdmin), [404])
    bloqueado('L · part_id malformado', await pedir('/gmail/attachment', { ...params, part_id: '1;rm' }, jwtAdmin), [404])
    const inyectado = await pedir('/gmail/attachment', { ...params, part_id: '99', attachment_id: 'ANGjdJ_arbitrario' }, jwtAdmin)
    bloqueado('L · attachment_id arbitrario en el request no se usa', inyectado, [404])
  }

  seccion('Limpieza')
  for (const id of creados.cuentas) {
    await s.from('email_threads').delete().eq('account_id', id)
    await s.from('email_accounts').delete().eq('id', id)
  }
  for (const id of creados.usuarios) {
    await s.from('company_memberships').delete().eq('user_id', id)
    await s.auth.admin.deleteUser(id)
  }
  for (const id of creados.empresas) await s.from('companies').delete().eq('id', id)
  const { count: restos } = await s.from('company_memberships').select('*', { count: 'exact', head: true }).eq('company_id', BT)
    .in('user_id', creados.usuarios)
  restos === 0 ? PASS('0 membresías temporales en Buscatools') : FAIL('quedaron membresías temporales', String(restos))

  console.log('\n' + '='.repeat(78))
  console.log(`  RESULTADO: ${fallos} fallo(s)`)
  console.log('='.repeat(78))
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('✗ se cayó:', e.message)
  for (const id of creados.cuentas) { await s.from('email_threads').delete().eq('account_id', id); await s.from('email_accounts').delete().eq('id', id) }
  for (const id of creados.usuarios) { await s.from('company_memberships').delete().eq('user_id', id); await s.auth.admin.deleteUser(id) }
  for (const id of creados.empresas) await s.from('companies').delete().eq('id', id)
  process.exit(1)
})
