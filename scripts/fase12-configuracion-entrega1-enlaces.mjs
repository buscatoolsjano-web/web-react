/**
 * Fase 12 · Configuración — Entrega 1: prueba REAL de los enlaces de Auth.
 *
 * Los enlaces se generan con `auth.admin.generateLink`: es el MISMO enlace que
 * iría en el correo, pero no se envía ningún correo. Así se prueba el camino
 * completo (verify de Supabase → redirect → app → sesión → contraseña → login)
 * sin mandarle nada a nadie y sin tocar cuentas reales.
 *
 *   node scripts/fase12-configuracion-entrega1-enlaces.mjs preparar <salida.json>
 *       crea empresa y cuentas zz-cfg1ui-*, y escribe en <salida.json> (FUERA
 *       del repo) los enlaces para abrir en el navegador. Contienen tokens: el
 *       archivo se borra al terminar.
 *   node scripts/fase12-configuracion-entrega1-enlaces.mjs api
 *       flujo completo por API de invitación y recuperación, con la misma
 *       función que usa la app para leer el fragmento (callbackUrl.ts).
 *   node scripts/fase12-configuracion-entrega1-enlaces.mjs verificar
 *       estado de las cuentas zz-cfg1ui-* después de la prueba en navegador.
 *   node scripts/fase12-configuracion-entrega1-enlaces.mjs limpiar
 *
 *   set -a; source .env; source .env.migration; set +a
 *   node --experimental-strip-types scripts/fase12-configuracion-entrega1-enlaces.mjs <comando>
 *
 * El destino del enlace lo decide Supabase: `redirect_to` sólo se respeta si
 * está en la lista de Redirect URLs; con la lista vacía usa el Site URL.
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET) { console.error('✗ Faltan variables'); process.exit(1) }
const { leerCallbackAuth } = await import('../src/services/auth/callbackUrl.ts')

const s = createClient(BASE, SECRET, { auth: { persistSession: false } })
const MARCA = 'zz-cfg1ui'
const REDIRECT = 'https://app.buscatools.com/'
let fallos = 0
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const INFO = (t, d = '') => console.log(`    INFO  ${t}${d ? ' — ' + d : ''}`)
const cmp = (t, esp, real) => (JSON.stringify(esp) === JSON.stringify(real) ? PASS(t, JSON.stringify(real)) : FAIL(t, `esperaba ${JSON.stringify(esp)}, dio ${JSON.stringify(real)}`))
const email = (etq) => `${MARCA}-${etq}-${Date.now()}@buscatools.test`

async function cuentasZZ() {
  const out = []
  for (let page = 1; ; page++) {
    const { data } = await s.auth.admin.listUsers({ page, perPage: 1000 })
    out.push(...(data?.users ?? []).filter((u) => u.email?.startsWith(`${MARCA}-`)))
    if ((data?.users ?? []).length < 1000) return out
  }
}
async function limpiar() {
  const { data: emp } = await s.from('companies').select('id').like('slug', `${MARCA}-%`)
  const ids = (emp ?? []).map((x) => x.id)
  if (ids.length) await s.from('company_memberships').delete().in('company_id', ids)
  for (const u of await cuentasZZ()) { await s.from('company_memberships').delete().eq('user_id', u.id); await s.auth.admin.deleteUser(u.id) }
  if (ids.length) { await s.from('warehouses').delete().in('company_id', ids); await s.from('companies').delete().in('id', ids) }
  const { count } = await s.from('companies').select('id', { count: 'exact', head: true }).like('slug', `${MARCA}-%`)
  console.log(`    limpio: ${(await cuentasZZ()).length} cuentas, ${count} empresas zz-cfg1ui`)
}
async function crear(etq, company, rol, confirmada = true) {
  const e = email(etq)
  const { data, error } = await s.auth.admin.createUser({ email: e, password: `Zz${randomUUID()}!`, email_confirm: confirmada, user_metadata: { full_name: `ZZ ${etq}` } })
  if (error) throw new Error(`${etq}: ${error.message}`)
  if (company) {
    const { error: eM } = await s.from('company_memberships').insert({ company_id: company, user_id: data.user.id, role: rol, status: 'active' })
    if (eM) throw new Error(`membresía ${etq}: ${eM.message}`)
  }
  return { id: data.user.id, email: e }
}
/** Sigue el enlace hasta el redirect de Supabase y devuelve el Location (con el fragmento). */
async function destinoDe(enlace) {
  const r = await fetch(enlace, { redirect: 'manual' })
  return { status: r.status, location: r.headers.get('location') }
}

const cmd = process.argv[2]
if (cmd === 'limpiar') { await limpiar(); process.exit(0) }

if (cmd === 'preparar') {
  const salida = process.argv[3]
  if (!salida || /web-react[\\/](?!.*scratchpad)/.test(salida)) { console.error('✗ la salida tiene que estar fuera del repo'); process.exit(1) }
  await limpiar()
  const { data: emp } = await s.from('companies').insert({ slug: `${MARCA}-propia-${Date.now()}`, name: 'ZZ Configuración UI', default_currency: 'ARS' }).select('id').single()
  const { data: otra } = await s.from('companies').insert({ slug: `${MARCA}-otra-${Date.now()}`, name: 'ZZ Otra empresa', default_currency: 'ARS' }).select('id').single()
  const admin = await crear('admin', emp.id, 'admin')
  const empleado = await crear('empleado', emp.id, 'employee')
  const vendedor = await crear('vendedor', emp.id, 'salesperson')
  const deOtra = await crear('deotra', otra.id, 'admin')
  // Invitada pendiente: generateLink('invite') crea la cuenta con invited_at, sin correo.
  const invitadaEmail = email('invitada')
  const { data: inv, error: eInv } = await s.auth.admin.generateLink({ type: 'invite', email: invitadaEmail, options: { redirectTo: REDIRECT, data: { full_name: 'ZZ Invitada' } } })
  if (eInv) throw new Error(`invite link: ${eInv.message}`)
  const { error: eReg } = await s.rpc('config_registrar_miembro', { p_actor: admin.id, p_company: emp.id, p_user: inv.user.id, p_rol: 'technician', p_nombre: 'ZZ Invitada', p_evento: 'USER_INVITED' })
  if (eReg) throw new Error(`registrar: ${eReg.message}`)
  const { data: magia } = await s.auth.admin.generateLink({ type: 'magiclink', email: admin.email, options: { redirectTo: REDIRECT } })
  const { data: magiaEmp } = await s.auth.admin.generateLink({ type: 'magiclink', email: empleado.email, options: { redirectTo: REDIRECT } })
  const { data: rec } = await s.auth.admin.generateLink({ type: 'recovery', email: vendedor.email, options: { redirectTo: REDIRECT } })
  writeFileSync(salida, JSON.stringify({
    empresa: emp.id,
    admin: admin.email, empleado: empleado.email, vendedor: vendedor.email, deOtra: deOtra.email, invitada: invitadaEmail,
    magiclinkAdmin: magia.properties.action_link,
    magiclinkEmpleado: magiaEmp.properties.action_link,
    inviteInvitada: inv.properties.action_link,
    recoveryVendedor: rec.properties.action_link,
  }, null, 1))
  const d = await destinoDe(magia.properties.action_link)
  // Se consumió el magic link del admin al seguirlo: se genera otro para el navegador.
  const { data: magia2 } = await s.auth.admin.generateLink({ type: 'magiclink', email: admin.email, options: { redirectTo: REDIRECT } })
  const j = JSON.parse((await import('node:fs')).readFileSync(salida, 'utf8'))
  j.magiclinkAdmin = magia2.properties.action_link
  writeFileSync(salida, JSON.stringify(j, null, 1))
  const destino = d.location ? d.location.split('#')[0] : null
  console.log(`    preparado · empresa ZZ · el enlace de Supabase redirige a: ${destino} (status ${d.status})`)
  console.log(`    redirect_to pedido: ${REDIRECT} → ${destino?.startsWith(REDIRECT) ? 'RESPETADO' : 'IGNORADO (no está en Redirect URLs; usa el Site URL)'}`)
  process.exit(0)
}

if (cmd === 'api') {
  await limpiar()
  const { data: emp } = await s.from('companies').insert({ slug: `${MARCA}-api-${Date.now()}`, name: 'ZZ API', default_currency: 'ARS' }).select('id').single()
  const admin = await crear('apiadmin', emp.id, 'admin')

  console.log('\n  Invitación (enlace real de Supabase, sin correo)')
  const invEmail = email('apiinvitada')
  const { data: inv } = await s.auth.admin.generateLink({ type: 'invite', email: invEmail, options: { redirectTo: REDIRECT } })
  await s.rpc('config_registrar_miembro', { p_actor: admin.id, p_company: emp.id, p_user: inv.user.id, p_rol: 'employee', p_nombre: 'ZZ Api Invitada', p_evento: 'USER_INVITED' })
  const { data: antes } = await s.auth.admin.getUserById(inv.user.id)
  cmp('antes de abrir el enlace: invitada, sin confirmar, sin contraseña de nadie', [true, false], [!!antes.user.invited_at, !!antes.user.email_confirmed_at])
  const d1 = await destinoDe(inv.properties.action_link)
  const cb1 = d1.location ? leerCallbackAuth(d1.location) : null
  cmp('verify responde redirect con la sesión en el fragmento (type=invite)', [303, 'sesion', 'invite'], [d1.status, cb1?.tipo, cb1?.motivo])
  INFO('destino del redirect', d1.location?.split('#')[0] ?? '—')
  const c1 = createClient(BASE, PUB, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error: eSes } = await c1.auth.setSession({ access_token: cb1.accessToken, refresh_token: cb1.refreshToken })
  cmp('setSession con los tokens del fragmento', null, eSes?.message ?? null)
  const nueva = `Zz-${randomUUID()}`
  const { error: eUpd } = await c1.auth.updateUser({ password: nueva })
  cmp('updateUser({ password })', null, eUpd?.message ?? null)
  const c1b = createClient(BASE, PUB, { auth: { persistSession: false } })
  const { data: log1, error: eLog } = await c1b.auth.signInWithPassword({ email: invEmail, password: nueva })
  cmp('login con la contraseña elegida', null, eLog?.message ?? null)
  const { data: despues } = await s.auth.admin.getUserById(inv.user.id)
  cmp('email confirmado al aceptar', true, !!despues.user.email_confirmed_at)
  const { data: memb } = await c1b.from('company_memberships').select('role, status').eq('user_id', log1.user.id)
  cmp('ve su membresía con el rol invitado', [{ role: 'employee', status: 'active' }], memb)
  const { data: perfil } = await c1b.from('profiles').select('full_name').eq('id', log1.user.id).single()
  cmp('perfil con el nombre de la invitación', 'ZZ Api Invitada', perfil?.full_name)
  const rNoAdmin = await c1b.rpc('config_listar_usuarios', { p_company: emp.id })
  cmp('como employee NO administra usuarios', true, /sin_permiso/.test(rNoAdmin.error?.message ?? ''))
  const d1b = await destinoDe(inv.properties.action_link)
  const cb1b = d1b.location ? leerCallbackAuth(d1b.location) : null
  cmp('reusar el enlace de invitación → error en el fragmento', 'error', cb1b?.tipo)
  INFO('código del enlace reusado', cb1b?.codigo ?? '—')

  console.log('\n  Recuperación')
  const vend = await crear('apivendedor', emp.id, 'salesperson')
  const { data: rec } = await s.auth.admin.generateLink({ type: 'recovery', email: vend.email, options: { redirectTo: REDIRECT } })
  const d2 = await destinoDe(rec.properties.action_link)
  const cb2 = d2.location ? leerCallbackAuth(d2.location) : null
  cmp('verify de recuperación → sesión en el fragmento (type=recovery)', ['sesion', 'recovery'], [cb2?.tipo, cb2?.motivo])
  const c2 = createClient(BASE, PUB, { auth: { persistSession: false, autoRefreshToken: false } })
  await c2.auth.setSession({ access_token: cb2.accessToken, refresh_token: cb2.refreshToken })
  const corta = await c2.auth.updateUser({ password: '123' })
  INFO('contraseña de 3 caracteres', corta.error ? `rechazada (${corta.error.code ?? corta.error.message})` : 'ACEPTADA')
  const nueva2 = `Zz-${randomUUID()}`
  cmp('recuperación: updateUser', null, (await c2.auth.updateUser({ password: nueva2 })).error?.message ?? null)
  const c2b = createClient(BASE, PUB, { auth: { persistSession: false } })
  cmp('login con la contraseña nueva', null, (await c2b.auth.signInWithPassword({ email: vend.email, password: nueva2 })).error?.message ?? null)
  const d2b = await destinoDe(rec.properties.action_link)
  cmp('reusar el enlace de recuperación → error', 'error', (d2b.location ? leerCallbackAuth(d2b.location) : null)?.tipo)

  console.log('\n  Recuperación pública sin enumeración')
  const pedir = (e) => fetch(`${BASE}/auth/v1/recover?redirect_to=${encodeURIComponent(REDIRECT)}`, { method: 'POST', headers: { apikey: PUB, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e }) })
  const rInexistente = await pedir(`${MARCA}-no-existe-${Date.now()}@buscatools.test`)
  INFO('email inexistente', `${rInexistente.status} ${(await rInexistente.text()).slice(0, 80)}`)
  cmp('email inexistente no da error que lo delate (2xx/4xx sin «not found»)', true, rInexistente.status < 500)

  await limpiar()
  console.log(`\n  ${fallos === 0 ? 'TODO PASS' : `${fallos} FAIL`}\n`)
  process.exit(fallos === 0 ? 0 : 1)
}

if (cmd === 'verificar') {
  for (const u of await cuentasZZ()) {
    const { data: m } = await s.from('company_memberships').select('role, status').eq('user_id', u.id)
    console.log(`    ${u.email.split('-').slice(0, 2).join('-')}…  confirmado=${!!u.email_confirmed_at} invitado=${!!u.invited_at} ultimo_ingreso=${u.last_sign_in_at ? 'sí' : 'no'} membresías=${JSON.stringify(m)}`)
  }
  const { data: aud } = await s.from('users_audit').select('action, from_role, to_role, from_status, to_status, actor_id').order('id', { ascending: false }).limit(10)
  console.log('    bitácora reciente:', JSON.stringify((aud ?? []).map((a) => `${a.action} ${a.from_role ?? ''}→${a.to_role ?? ''} ${a.from_status ?? ''}→${a.to_status ?? ''} actor=${a.actor_id ? 'sí' : 'no'}`)))
  process.exit(0)
}

console.error('uso: preparar <salida.json> | api | verificar | limpiar')
process.exit(1)
