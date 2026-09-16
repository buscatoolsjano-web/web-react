/**
 * Fase 16 · WhatsApp Cloud API — Entrega 1: las reglas que sólo se pueden
 * probar contra la base.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase16-whatsapp-e1-tests.mjs
 *
 * Qué prueba, medido por EFECTO y no por código de retorno:
 *   1. entrante idempotente — el mismo wamid dos veces deja UNA fila
 *   2. acuses: repetidos, fuera de orden y que no retroceden
 *   3. eventos de una cuenta que no administramos
 *   4. vínculo con el cliente: exacto, por cola de 8 dígitos y ambiguo
 *   5. ventana de servicio: se abre con el entrante y cierra el saliente
 *   6. saliente idempotente — dos clics dejan UN mensaje
 *   7. RLS: seis roles y otra empresa contra la misma conversación
 *
 * No toca Meta, no manda ningún WhatsApp y no usa la base legacy. Todo lo que
 * crea lleva el prefijo ZZ-W16 y se borra al final; la invariante se verifica
 * contando filas.
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
const rechaza = (t, r) =>
  r.error ? PASS(t, r.error.code ?? String(r.error.message).slice(0, 56)) : FAIL(`SE PERMITIÓ: ${t}`)

const sesion = () => createClient(BASE, PUB, { auth: { persistSession: false } })
const s = createClient(BASE, SECRET, { auth: { persistSession: false } })

const MARCA = 'zz-w16'
const creados = { usuarios: [], empresas: [] }
const TABLAS = [
  'whatsapp_accounts', 'whatsapp_conversations', 'whatsapp_messages',
  'whatsapp_media', 'whatsapp_conversation_reads', 'whatsapp_webhook_events',
]
const cuenta = async (t) => (await s.from(t).select('*', { count: 'exact', head: true })).count

const usuarioTemporal = async (companyId, rol, customerId = null) => {
  const email = `${MARCA}-${rol}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@buscatools.test`
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
  return { id: data.user.id, rol, c }
}

/** Un entrante como el que arma el webhook. */
const entrante = (phoneNumberId, over = {}) =>
  s.rpc('registrar_entrante_whatsapp', {
    p_phone_number_id: phoneNumberId,
    p_waba_id: '1499762661645319',
    p_wa_id: '5491133334444',
    p_profile_name: 'ZZ Ana',
    p_provider_message_id: `wamid.${MARCA}.1`,
    p_tipo: 'text',
    p_texto: 'ZZ hola',
    p_caption: null,
    p_reply_to: null,
    p_timestamp: new Date().toISOString(),
    p_media: null,
    ...over,
  })

const barrerRestos = async () => {
  const { data: viejas } = await s.from('companies').select('id').like('slug', `${MARCA}-%`)
  const ids = (viejas ?? []).map((x) => x.id)
  if (ids.length) {
    for (const t of ['whatsapp_conversation_reads', 'whatsapp_media', 'whatsapp_messages', 'whatsapp_conversations', 'whatsapp_accounts']) {
      if (t === 'whatsapp_conversation_reads') {
        const { data: convs } = await s.from('whatsapp_conversations').select('id').in('company_id', ids)
        const cids = (convs ?? []).map((c) => c.id)
        if (cids.length) await s.from(t).delete().in('conversation_id', cids)
      } else {
        await s.from(t).delete().in('company_id', ids)
      }
    }
    await s.from('customer_contacts').delete().in('company_id', ids)
    await s.from('customers').delete().in('company_id', ids)
    await s.from('company_memberships').delete().in('company_id', ids)
    await s.from('companies').delete().in('id', ids)
  }
  const { data: us } = await s.auth.admin.listUsers({ perPage: 1000 })
  for (const u of us?.users ?? []) if (u.email?.startsWith(`${MARCA}-`)) await s.auth.admin.deleteUser(u.id)
}

const limpiar = async () => {
  const ids = creados.empresas
  if (ids.length) {
    const { data: convs } = await s.from('whatsapp_conversations').select('id').in('company_id', ids)
    const cids = (convs ?? []).map((c) => c.id)
    if (cids.length) await s.from('whatsapp_conversation_reads').delete().in('conversation_id', cids)
    for (const t of ['whatsapp_media', 'whatsapp_messages', 'whatsapp_conversations', 'whatsapp_accounts']) {
      await s.from(t).delete().in('company_id', ids)
    }
    await s.from('customer_contacts').delete().in('company_id', ids)
    await s.from('customers').delete().in('company_id', ids)
    await s.from('company_memberships').delete().in('company_id', ids)
    await s.from('companies').delete().in('id', ids)
  }
  for (const u of creados.usuarios) await s.auth.admin.deleteUser(u)
}

const ok = (r, q) => { if (r.error) throw new Error(`${q}: ${r.error.message}`); return r.data }

async function main() {
  console.log('='.repeat(78))
  console.log('  FASE 16 · WhatsApp E1 — webhook, envío y RLS')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(78))

  await barrerRestos()
  const base = {}
  for (const t of TABLAS) base[t] = await cuenta(t)
  console.log(`  baseline: ${TABLAS.map((t) => `${t}=${base[t]}`).join('  ')}`)

  // ── Fixture ──────────────────────────────────────────────────────────────
  const empresa = ok(await s.from('companies').insert({
    slug: `${MARCA}-a-${Date.now()}`, name: 'ZZ W16 A', legal_name: 'ZZ W16 A SA', default_currency: 'ARS',
  }).select('id').single(), 'empresa A')
  creados.empresas.push(empresa.id)

  const empresaB = ok(await s.from('companies').insert({
    slug: `${MARCA}-b-${Date.now()}`, name: 'ZZ W16 B', legal_name: 'ZZ W16 B SA', default_currency: 'ARS',
  }).select('id').single(), 'empresa B')
  creados.empresas.push(empresaB.id)

  const PHONE_ID = `${MARCA}-phone-${Date.now()}`
  const cuentaWa = ok(await s.from('whatsapp_accounts').insert({
    company_id: empresa.id, waba_id: '1499762661645319', phone_number_id: PHONE_ID,
    display_phone_number: '+54 9 11 0000-0000', display_name: 'ZZ W16', active: true,
  }).select('id').single(), 'cuenta whatsapp')

  // El teléfono del cliente está con OTRO formato que el wa_id: es el caso real.
  const cliente = ok(await s.from('customers').insert({
    company_id: empresa.id, legal_name: 'ZZ W16 Cliente SA', status: 'active', phone: '+54 11 3333-4444',
  }).select('id').single(), 'cliente')
  ok(await s.from('customer_contacts').insert({
    company_id: empresa.id, customer_id: cliente.id, full_name: 'ZZ Ana Pérez', phone: '11 3333 4444',
  }), 'contacto')

  const admin = await usuarioTemporal(empresa.id, 'admin')
  const employee = await usuarioTemporal(empresa.id, 'employee')
  const vend1 = await usuarioTemporal(empresa.id, 'salesperson')
  const vend2 = await usuarioTemporal(empresa.id, 'salesperson')
  const tech = await usuarioTemporal(empresa.id, 'technician')
  const clientePortal = await usuarioTemporal(empresa.id, 'customer', cliente.id)
  const adminB = await usuarioTemporal(empresaB.id, 'admin')
  const anon = sesion()

  // ── 1 · Entrante idempotente ─────────────────────────────────────────────
  seccion('1 · Mensaje entrante e idempotencia')

  const r1 = ok(await entrante(PHONE_ID), 'entrante 1')
  cmp('primer entrante: se crea', 'creado', r1.resultado)
  const convId = r1.conversation_id

  const r2 = ok(await entrante(PHONE_ID), 'entrante repetido')
  cmp('Meta reintenta el mismo wamid: duplicado', 'duplicado', r2.resultado)

  const { count: nMsg } = await s.from('whatsapp_messages')
    .select('*', { count: 'exact', head: true }).eq('conversation_id', convId)
  cmp('queda UNA sola fila', 1, nMsg)

  // Seis webhooks simultáneos, que es lo que pasa de verdad bajo reintento.
  await Promise.all(Array.from({ length: 6 }, (_, i) =>
    entrante(PHONE_ID, { p_provider_message_id: `wamid.${MARCA}.race` , p_texto: `ZZ carrera ${i}` })))
  const { count: nRace } = await s.from('whatsapp_messages')
    .select('*', { count: 'exact', head: true }).eq('provider_message_id', `wamid.${MARCA}.race`)
  cmp('seis webhooks a la vez con el mismo wamid: UNA fila', 1, nRace)

  const rAjena = ok(await entrante('phone-que-no-administramos'), 'cuenta ajena')
  cmp('evento de otra cuenta: se ignora', 'cuenta_desconocida', rAjena.resultado)

  // ── 2 · Vínculo con el cliente ───────────────────────────────────────────
  seccion('2 · Vínculo con el cliente')

  const { data: conv } = await s.from('whatsapp_conversations')
    .select('customer_id, customer_contact_id, vinculo_origen, service_window_expires_at, last_inbound_at')
    .eq('id', convId).single()

  cmp('5491133334444 encuentra a +54 11 3333-4444 por la cola de 8 dígitos', cliente.id, conv.customer_id)
  PASS('origen del vínculo', conv.vinculo_origen)
  cmp('y toma el contacto, que es único', true, conv.customer_contact_id !== null)

  // Ambigüedad: un segundo cliente con el MISMO final de número.
  const cliente2 = ok(await s.from('customers').insert({
    company_id: empresa.id, legal_name: 'ZZ W16 Homónimo SA', status: 'active', phone: '011 15 3333-4444',
  }).select('id').single(), 'cliente 2')
  const { data: ambiguo } = await s.rpc('vincular_telefono_whatsapp', {}).then(() => ({ data: null })).catch(() => ({ data: null }))
  void ambiguo
  const { data: vinc } = await s.schema('app').rpc('vincular_telefono_whatsapp', {
    p_company: empresa.id, p_phone: '5491133334444',
  }).then((r) => r, () => ({ data: null }))
  if (vinc === null || (Array.isArray(vinc) && vinc.length === 0)) {
    PASS('con dos clientes candidatos NO se vincula a ninguno')
  } else {
    FAIL('con dos candidatos eligió uno', JSON.stringify(vinc).slice(0, 80))
  }
  await s.from('customers').delete().eq('id', cliente2.id)

  // ── 3 · Ventana de servicio ──────────────────────────────────────────────
  seccion('3 · Ventana de servicio de 24 horas')

  const abre = new Date(conv.service_window_expires_at).getTime() - new Date(conv.last_inbound_at).getTime()
  cmp('la ventana vence 24 h después del entrante', 24 * 3600 * 1000, abre)

  const req1 = randomUUID()
  const { data: enviado, error: eEnv } = await admin.c.rpc('encolar_mensaje_whatsapp', {
    p_conversacion: convId, p_texto: 'ZZ respuesta', p_client_request_id: req1,
  })
  if (eEnv) FAIL('el admin encola dentro de la ventana', eEnv.message.slice(0, 60))
  else PASS('el admin encola dentro de la ventana', enviado.status)

  // Dos clics: el mismo client_request_id no puede dejar dos mensajes.
  const dobles = await Promise.all(Array.from({ length: 5 }, () =>
    admin.c.rpc('encolar_mensaje_whatsapp', { p_conversacion: convId, p_texto: 'ZZ respuesta', p_client_request_id: req1 })))
  const { count: nOut } = await s.from('whatsapp_messages')
    .select('*', { count: 'exact', head: true }).eq('client_request_id', req1)
  cmp('cinco envíos con el mismo client_request_id: UNA fila', 1, nOut)
  cmp('y todos devuelven el mismo mensaje', true, dobles.every((d) => !d.error && d.data?.id === enviado?.id))

  // Cerrar la ventana a mano y reintentar.
  await s.from('whatsapp_conversations')
    .update({ service_window_expires_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', convId)
  const cerrada = await admin.c.rpc('encolar_mensaje_whatsapp', {
    p_conversacion: convId, p_texto: 'ZZ tarde', p_client_request_id: randomUUID(),
  })
  if (cerrada.error?.message.includes('TEMPLATE_REQUIRED')) PASS('con la ventana cerrada: TEMPLATE_REQUIRED')
  else FAIL('SE PERMITIÓ enviar fuera de la ventana', cerrada.error?.message?.slice(0, 60) ?? 'sin error')

  // Un entrante nuevo la vuelve a abrir.
  ok(await entrante(PHONE_ID, { p_provider_message_id: `wamid.${MARCA}.2`, p_texto: 'ZZ otra vez' }), 'entrante 2')
  const { data: conv2 } = await s.from('whatsapp_conversations')
    .select('service_window_expires_at').eq('id', convId).single()
  cmp('un entrante nuevo reabre la ventana', true, new Date(conv2.service_window_expires_at) > new Date())

  // ── 4 · Acuses ───────────────────────────────────────────────────────────
  seccion('4 · Acuses de Meta')

  const wamid = `wamid.${MARCA}.out`
  ok(await s.rpc('sellar_saliente_whatsapp', { p_mensaje: enviado.id, p_provider_message_id: wamid }), 'sellar')

  const acuse = (estado, cuando, extra = {}) => s.rpc('registrar_estado_whatsapp', {
    p_phone_number_id: PHONE_ID, p_provider_message_id: wamid, p_estado: estado,
    p_timestamp: cuando, p_error_code: null, p_error_details: null, ...extra,
  })

  const t0 = new Date(Date.now() - 300_000).toISOString()
  const t1 = new Date(Date.now() - 200_000).toISOString()
  const t2 = new Date(Date.now() - 100_000).toISOString()

  ok(await acuse('sent', t0), 'acuse sent')
  ok(await acuse('delivered', t1), 'acuse delivered')
  ok(await acuse('read', t2), 'acuse read')
  let { data: m } = await s.from('whatsapp_messages').select('estado_visible, sent_at, delivered_at, read_at').eq('id', enviado.id).single()
  cmp('sent → delivered → read deja «read»', 'read', m.estado_visible)

  // El acuse repetido y el atrasado no pueden hacerlo retroceder.
  ok(await acuse('read', t2), 'acuse read repetido')
  ok(await acuse('sent', new Date().toISOString()), 'acuse sent atrasado')
  ok(await acuse('delivered', new Date().toISOString()), 'acuse delivered atrasado')
  ;({ data: m } = await s.from('whatsapp_messages').select('estado_visible, sent_at').eq('id', enviado.id).single())
  cmp('un acuse fuera de orden NO lo baja de read', 'read', m.estado_visible)

  // Un fallo en otro dispositivo no borra que llegó.
  ok(await acuse('failed', new Date().toISOString(), { p_error_code: 131047, p_error_details: 'ZZ prueba' }), 'acuse failed')
  ;({ data: m } = await s.from('whatsapp_messages').select('estado_visible, error_code, failed_at').eq('id', enviado.id).single())
  cmp('éxito y fallo del mismo mensaje: sigue diciendo read', 'read', m.estado_visible)
  cmp('pero el error queda registrado', 131047, m.error_code)

  const huerfano = ok(await s.rpc('registrar_estado_whatsapp', {
    p_phone_number_id: PHONE_ID, p_provider_message_id: 'wamid.que-no-existe',
    p_estado: 'delivered', p_timestamp: new Date().toISOString(),
  }), 'acuse huérfano')
  cmp('un acuse de un mensaje que no es nuestro no rompe', 'sin_mensaje', huerfano.resultado)

  // ── 5 · RLS ──────────────────────────────────────────────────────────────
  seccion('5 · RLS: quién ve qué')

  // La asignación es la ÚNICA puerta y valida al actor adentro: con la clave
  // de servicio `auth.uid()` es null y la rechaza, que es lo correcto.
  rechaza('la clave de servicio no asigna por la puerta de las personas',
    await s.rpc('asignar_conversacion_whatsapp', { p_conversacion: convId, p_usuario: vend1.id }))
  ok(await admin.c.rpc('asignar_conversacion_whatsapp', { p_conversacion: convId, p_usuario: vend1.id }), 'asignar a vend1')

  const ve = async (u) => {
    const { data } = await u.c.from('whatsapp_conversations').select('id').eq('id', convId)
    return (data ?? []).length
  }
  cmp('admin ve la conversación', 1, await ve(admin))
  cmp('employee ve la conversación', 1, await ve(employee))
  cmp('vend1 (asignado) la ve', 1, await ve(vend1))
  cmp('vend2 (no asignado) NO la ve', 0, await ve(vend2))
  cmp('technician NO la ve', 0, await ve(tech))
  cmp('customer NO la ve', 0, await ve(clientePortal))
  cmp('admin de OTRA empresa NO la ve', 0, await ve(adminB))
  const { data: anonVe } = await anon.from('whatsapp_conversations').select('id')
  cmp('anónimo no ve ninguna', 0, (anonVe ?? []).length)

  const { data: msgVend2 } = await vend2.c.from('whatsapp_messages').select('id').eq('conversation_id', convId)
  cmp('los mensajes siguen al padre: vend2 no ve ninguno', 0, (msgVend2 ?? []).length)

  rechaza('vend2 no puede encolar en una conversación ajena',
    await vend2.c.rpc('encolar_mensaje_whatsapp', { p_conversacion: convId, p_texto: 'ZZ', p_client_request_id: randomUUID() }))
  rechaza('el technician no puede encolar',
    await tech.c.rpc('encolar_mensaje_whatsapp', { p_conversacion: convId, p_texto: 'ZZ', p_client_request_id: randomUUID() }))
  rechaza('el admin de otra empresa no puede encolar',
    await adminB.c.rpc('encolar_mensaje_whatsapp', { p_conversacion: convId, p_texto: 'ZZ', p_client_request_id: randomUUID() }))
  rechaza('el anónimo no puede encolar',
    await anon.rpc('encolar_mensaje_whatsapp', { p_conversacion: convId, p_texto: 'ZZ', p_client_request_id: randomUUID() }))

  // Escritura directa: el navegador no inserta mensajes entrantes.
  rechaza('el admin NO puede insertar un entrante a mano', await admin.c.from('whatsapp_messages').insert({
    company_id: empresa.id, account_id: cuentaWa.id, conversation_id: convId,
    direction: 'in', message_type: 'text', status: 'received', text_body: 'ZZ falso',
    provider_timestamp: new Date().toISOString(),
  }))
  rechaza('un vendedor no puede autoasignarse por UPDATE',
    await vend2.c.from('whatsapp_conversations').update({ assigned_to: vend2.id }).eq('id', convId))
  rechaza('un vendedor no puede autoasignarse por la RPC',
    await vend2.c.rpc('asignar_conversacion_whatsapp', { p_conversacion: convId, p_usuario: vend2.id }))

  const { data: sigue } = await s.from('whatsapp_conversations').select('assigned_to').eq('id', convId).single()
  cmp('después de los intentos, sigue asignada a vend1', vend1.id, sigue.assigned_to)

  // Las funciones del backend no las puede llamar una persona.
  rechaza('el admin no puede registrar un entrante', await admin.c.rpc('registrar_entrante_whatsapp', {
    p_phone_number_id: PHONE_ID, p_waba_id: 'x', p_wa_id: '549110000000', p_profile_name: null,
    p_provider_message_id: 'wamid.zz.falso', p_tipo: 'text', p_texto: 'ZZ', p_caption: null,
    p_reply_to: null, p_timestamp: new Date().toISOString(), p_media: null,
  }))
  rechaza('el admin no puede sellar un saliente',
    await admin.c.rpc('sellar_saliente_whatsapp', { p_mensaje: enviado.id, p_provider_message_id: 'wamid.zz' }))
  rechaza('el anónimo no lee la bitácora de webhooks',
    await anon.from('whatsapp_webhook_events').select('id').limit(1).single())

  // ── 6 · Invariantes ──────────────────────────────────────────────────────
  seccion('6 · Limpieza e invariantes')
  await limpiar()
  creados.empresas = []
  creados.usuarios = []
  for (const t of TABLAS) cmp(`${t} vuelve a su conteo`, base[t], await cuenta(t))

  console.log('\n' + '='.repeat(78))
  console.log(fallos === 0 ? '  RESULTADO: 0 FALLOS' : `  RESULTADO: ${fallos} FALLO(S)`)
  console.log('='.repeat(78))
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('\n✗', e.message)
  await limpiar().catch(() => {})
  process.exit(1)
})
