/**
 * Fase 9 · Emails — entrega 4: egress y tiempos de la bandeja con sesión real.
 *
 * SÓLO LECTURAS sobre producción: listado, filtros, búsqueda, cuentas,
 * sugerencias. Las escrituras (marcar leído, asignar, vincular) se miden sobre
 * una empresa temporal `ZZ-E4M`, para no dejar un solo evento en los hilos
 * reales.
 *
 * Bytes = cuerpo de la respuesta de PostgREST, sin comprimir. Mediana de 5.
 *
 *   set -a; source .env; source .env.migration; source .env.rls.txt; set +a
 *   node scripts/fase9-emails-entrega4-medicion.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET || !process.env.BT_PW_JANO) { console.error('✗ Faltan variables'); process.exit(1) }

const s = createClient(BASE, SECRET, { auth: { persistSession: false } })
const c = createClient(BASE, PUB, { auth: { persistSession: false } })
const { data: login, error: eL } = await c.auth.signInWithPassword({ email: 'buscatools.jano@gmail.com', password: process.env.BT_PW_JANO })
if (eL) { console.error('✗ login: ' + eL.message); process.exit(1) }
const JWT = login.session.access_token
const BT = (await s.from('companies').select('id').eq('slug', 'buscatools').single()).data.id
const cuenta = (await s.from('email_accounts').select('id').eq('company_id', BT).single()).data.id

const mediana = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const medir = async (nombre, ruta, init = {}, jwt = JWT) => {
  const tiempos = []
  let bytes = 0
  let filas = 0
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now()
    const r = await fetch(`${BASE}/rest/v1${ruta}`, {
      ...init,
      headers: { apikey: PUB, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    })
    const cuerpo = await r.text()
    tiempos.push(performance.now() - t0)
    if (!r.ok) { console.log(`    ✗ ${nombre}: HTTP ${r.status} ${cuerpo.slice(0, 120)}`); return }
    bytes = Buffer.byteLength(cuerpo)
    try { const j = JSON.parse(cuerpo); filas = Array.isArray(j) ? j.length : 1 } catch { filas = 0 }
  }
  console.log(`    ${nombre.padEnd(46)} ${String(Math.round(mediana(tiempos))).padStart(5)} ms  ${(bytes / 1024).toFixed(1).padStart(7)} kB  ${filas} filas`)
  return { bytes, ms: mediana(tiempos) }
}
const rpc = (nombre, args) => [`/rpc/${nombre}`, { method: 'POST', body: JSON.stringify(args) }]

console.log('\n  LECTURAS · producción, sesión real de un admin\n  ' + '-'.repeat(72))
const inicial = await medir('bandeja · página 1 de 25', ...rpc('listar_bandeja_email', { p_company: BT, p_limite: 25 }))
await medir('bandeja · página 1 de 50', ...rpc('listar_bandeja_email', { p_company: BT, p_limite: 50 }))
await medir('bandeja · página 3 de 25', ...rpc('listar_bandeja_email', { p_company: BT, p_limite: 25, p_offset: 50 }))
await medir('filtro · sólo sin leer', ...rpc('listar_bandeja_email', { p_company: BT, p_sin_leer: true }))
await medir('filtro · con adjuntos', ...rpc('listar_bandeja_email', { p_company: BT, p_adjuntos: true }))
await medir('filtro · pendiente + sin asignar', ...rpc('listar_bandeja_email', { p_company: BT, p_estado: 'pendiente', p_asignado: 'nadie' }))
await medir('búsqueda · "factura"', ...rpc('listar_bandeja_email', { p_company: BT, p_q: 'factura' }))
await medir('búsqueda · "gmail.com"', ...rpc('listar_bandeja_email', { p_company: BT, p_q: 'gmail.com' }))
const cuentas = await medir('cuentas de correo', `/email_accounts?select=id,email_address,display_name,sync_error,sync_error_at,last_synced_at&company_id=eq.${BT}&active=eq.true`)
await medir('usuarios asignables', ...rpc('usuarios_asignables_email', { p_company: BT }))
const { data: unHilo } = await s.from('email_threads').select('id, gmail_thread_id').eq('account_id', cuenta)
  .order('last_message_at', { ascending: false }).limit(1).single()
await medir('índice de un hilo (detalle)', `/email_threads?select=id,account_id,gmail_thread_id,subject,participants,last_message_at,message_count,has_attachments&id=eq.${unHilo.id}`)
await medir('estado de un hilo (detalle)', `/email_thread_state?select=workflow_status,assigned_to,customer_id,customer_contact_id,vinculo_origen&account_id=eq.${cuenta}&gmail_thread_id=eq.${unHilo.gmail_thread_id}`)
await medir('sugerencias CRM de un hilo', ...rpc('sugerencias_cliente_email', { p_account: cuenta, p_thread: unHilo.gmail_thread_id }))

// Sugerencias sobre los 200 hilos reales: cuántos tendrían match (sólo lectura).
{
  const { data: hilos } = await s.from('email_threads').select('gmail_thread_id').eq('account_id', cuenta)
  const clases = { exacto: 0, sugerido_dominio: 0, ambiguo: 0, ninguna: 0 }
  for (const h of hilos) {
    const { data } = await c.rpc('sugerencias_cliente_email', { p_account: cuenta, p_thread: h.gmail_thread_id })
    const set = new Set((data ?? []).map((x) => x.clase))
    if (set.has('exacto')) clases.exacto++
    else if (set.has('sugerido_dominio')) clases.sugerido_dominio++
    else if (set.has('ambiguo')) clases.ambiguo++
    else clases.ninguna++
  }
  console.log(`\n    CRM sobre los ${hilos.length} hilos reales (mejor clase por hilo): ${JSON.stringify(clases)}`)
}

console.log('\n  ESCRITURAS · empresa temporal ZZ-E4M\n  ' + '-'.repeat(72))
const emp = (await s.from('companies').insert({ slug: `zz-e4m-${Date.now()}`, name: 'ZZ-E4M', default_currency: 'ARS' }).select('id').single()).data.id
const email = `zz-e4m-${Date.now()}@buscatools.test`, password = `Zz${randomUUID()}!`
const u = (await s.auth.admin.createUser({ email, password, email_confirm: true })).data.user
await s.from('company_memberships').insert({ company_id: emp, user_id: u.id, role: 'admin', status: 'active' })
const cta = (await s.from('email_accounts').insert({ company_id: emp, email_address: `zz-e4m-${Date.now()}@m.test` }).select('id').single()).data.id
const cli = (await s.from('customers').insert({ company_id: emp, legal_name: 'ZZ-E4M cliente' }).select('id').single()).data.id
await s.from('email_threads').insert({ company_id: emp, account_id: cta, gmail_thread_id: 'e4m1', last_message_at: new Date().toISOString() })
const cu = createClient(BASE, PUB, { auth: { persistSession: false } })
const jwtU = (await cu.auth.signInWithPassword({ email, password })).data.session.access_token
try {
  {
    const [ruta, init] = rpc('marcar_hilo_leido_email', { p_account: cta, p_thread: 'e4m1' })
    await medir('marcar leído (ERP, por usuario)', ruta, init, jwtU)
  }
  let alterna = 0
  const t = []
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now()
    await cu.rpc('cambiar_estado_email', { p_account: cta, p_thread: 'e4m1', p_estado: alterna++ % 2 ? 'pendiente' : 'en_proceso' })
    t.push(performance.now() - t0)
  }
  console.log(`    ${'cambiar estado'.padEnd(46)} ${String(Math.round(mediana(t))).padStart(5)} ms`)
  const t2 = []
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now()
    await cu.rpc('asignar_hilo_email', { p_account: cta, p_thread: 'e4m1', p_usuario: i % 2 ? null : u.id })
    t2.push(performance.now() - t0)
  }
  console.log(`    ${'asignar / desasignar'.padEnd(46)} ${String(Math.round(mediana(t2))).padStart(5)} ms`)
  const t3 = []
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now()
    await cu.rpc('vincular_cliente_email', { p_account: cta, p_thread: 'e4m1', p_customer: i % 2 ? null : cli, p_origen: 'manual' })
    t3.push(performance.now() - t0)
  }
  console.log(`    ${'vincular / desvincular cliente'.padEnd(46)} ${String(Math.round(mediana(t3))).padStart(5)} ms`)
} finally {
  for (const t of ['email_thread_reads', 'email_events', 'email_thread_state', 'email_threads']) await s.from(t).delete().eq('account_id', cta)
  await s.from('email_accounts').delete().eq('id', cta)
  await s.from('customers').delete().eq('id', cli)
  await s.from('company_memberships').delete().eq('user_id', u.id)
  await s.auth.admin.deleteUser(u.id)
  await s.from('companies').delete().eq('id', emp)
}

console.log('\n  EGRESS contra el legacy\n  ' + '-'.repeat(72))
const legacyPorMinuto = 766 * 1024
const aperturaBandeja = inicial.bytes + cuentas.bytes
console.log(`    legacy: 766 kB por request, cada 60 s por usuario`)
console.log(`    nuevo: abrir la bandeja = ${(aperturaBandeja / 1024).toFixed(1)} kB una vez; después, Realtime (0 polling)`)
console.log(`    relación contra UN minuto del legacy: ${(legacyPorMinuto / aperturaBandeja).toFixed(0)} a 1`)
process.exit(0)
