/**
 * Fase 8 · WhatsApp — entrega 1: la base estructural, contra la base real.
 *
 * Todavía no hay integración con Meta ni bandeja en React. Lo único que existe
 * son las seis tablas, sus reglas y la RLS — así que lo que se prueba acá es
 * que **las reglas existan de verdad**, no que el módulo funcione.
 *
 * Cada prohibición se prueba con un INTENTO REAL y se mide el EFECTO además
 * del código: con PostgREST una operación prohibida puede devolver «éxito» con
 * cero filas, y creerle al código de estado es cómo se firma un PASS falso.
 *
 * Lo que se mide y no se supone:
 *
 *   · la RLS del salesperson por ID exacto, no por conteo
 *   · los hijos siguiendo al padre, con un mensaje de un chat ajeno pedido por id
 *   · el no leído de dos usuarios a la vez
 *   · el claim con OCHO consumidores concurrentes de verdad
 *   · el reaper, que NO puede devolver nada a pending
 *   · Realtime con dos identidades: se cuenta lo que LLEGA, no que el canal
 *     acepte el join (eso ya nos hizo afirmar lo que no era en la entrega 0.5)
 *
 * Hacen falta siete identidades que no existen en la base: se crean usuarios
 * temporales con contraseña generada acá, se usan y se borran. No se toca
 * ningún usuario real ni ninguna empresa real.
 *
 * Se limpia sola: prefijo `ZZ-W1`.
 *
 *   set -a; source .env; source .env.migration; source .env.rls.txt; set +a
 *   node scripts/fase8-whatsapp-entrega1-tests.mjs
 *
 * NO canalizar por `head`: cierra el pipe y la limpieza no llega a correr.
 *
 * Y NO correrla en paralelo con otra suite de base: todas afirman invariantes
 * globales y dos a la vez se pisan.
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
  String(esperado) === String(real) ? PASS(t, String(real))
                                    : FAIL(t, `esperaba ${esperado}, dio ${real}`)
const rechaza = (t, r) => r.error ? PASS(t, r.error.code ?? String(r.error.message).slice(0, 56))
                                  : FAIL(`SE PERMITIÓ: ${t}`)

const sesion = () => createClient(BASE, PUB, { auth: { persistSession: false } })
const s = createClient(BASE, SECRET, { auth: { persistSession: false } })

const MARCA = 'ZZ-W1'
const BUCKET = 'whatsapp'
const creados = { usuarios: [], empresas: [], objetos: [] }
const TABLAS = [
  'whatsapp_accounts', 'whatsapp_conversations', 'whatsapp_messages',
  'whatsapp_media', 'whatsapp_conversation_reads', 'whatsapp_webhook_events',
]

const q = async (t) => (await s.from(t).select('*', { count: 'exact', head: true })).count

/** Un usuario temporal con su membresía. Se borra al final. */
const usuarioTemporal = async (companyId, rol, customerId = null) => {
  const email = `zz-w1-${rol}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@buscatools.test`
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
  return { id: data.user.id, email, password, c }
}

/** Los ids que una identidad ve de verdad, ordenados para poder compararlos. */
const idsVisibles = async (cli, tabla, columna = 'id') => {
  const { data } = await cli.from(tabla).select(columna)
  return (data ?? []).map((x) => x[columna]).sort()
}

const entrante = (conv, extra = {}) => ({
  company_id: conv.company_id, account_id: conv.account_id, conversation_id: conv.id,
  direction: 'in', message_type: 'text', status: 'received',
  text_body: `${MARCA} hola`, provider_timestamp: new Date().toISOString(),
  received_at: new Date().toISOString(), ...extra,
})
const saliente = (conv, extra = {}) => ({
  company_id: conv.company_id, account_id: conv.account_id, conversation_id: conv.id,
  direction: 'out', message_type: 'text', text_body: `${MARCA} respuesta`,
  client_request_id: randomUUID(), ...extra,
})

/**
 * Barre lo que haya quedado de una corrida anterior QUE SE CAYÓ.
 *
 * Hace falta porque el baseline se mide después: si quedan dos empresas
 * huérfanas de un run abortado, la invariante final las cuenta como propias y
 * el PASS es mentira. Sólo toca filas con el prefijo ZZ-W1.
 */
const barrerRestos = async () => {
  const { data: viejas } = await s.from('companies').select('id').like('slug', 'zz-w1-%')
  const ids = (viejas ?? []).map((x) => x.id)
  const { data: cuentas } = await s.from('whatsapp_accounts').select('id').like('waba_id', `${MARCA}%`)
  const idsCuenta = (cuentas ?? []).map((x) => x.id)
  if (idsCuenta.length) {
    const { data: convs } = await s.from('whatsapp_conversations').select('id').in('account_id', idsCuenta)
    const idsConv = (convs ?? []).map((x) => x.id)
    if (idsConv.length) {
      await s.from('whatsapp_messages').update({ media_id: null }).in('conversation_id', idsConv)
      await s.from('whatsapp_media').delete().in('conversation_id', idsConv)
      await s.from('whatsapp_messages').delete().in('conversation_id', idsConv)
      await s.from('whatsapp_conversation_reads').delete().in('conversation_id', idsConv)
      await s.from('whatsapp_conversations').delete().in('id', idsConv)
    }
    await s.from('whatsapp_accounts').delete().in('id', idsCuenta)
  }
  await s.from('whatsapp_webhook_events').delete().like('provider_event_id', `${MARCA}%`)
  const { data: usuarios } = await s.auth.admin.listUsers({ perPage: 1000 })
  for (const u of usuarios?.users ?? []) {
    if (u.email?.startsWith('zz-w1-')) {
      await s.from('company_memberships').delete().eq('user_id', u.id)
      await s.auth.admin.deleteUser(u.id)
    }
  }
  if (ids.length) {
    await s.from('company_memberships').delete().in('company_id', ids)
    await s.from('customer_contacts').delete().in('company_id', ids)
    await s.from('customers').delete().in('company_id', ids)
    await s.from('companies').delete().in('id', ids)
    console.log(`  (se barrieron ${ids.length} empresa(s) de una corrida anterior)`)
  }
}

const main = async () => {
  await barrerRestos()
  const { data: comps } = await s.from('companies').select('id, slug')
  const BT = comps.find((x) => x.slug === 'buscatools').id
  const empresasAntes = comps.length
  const clientesAntes = await q('customers')

  // ══════════════════════════════════════════════════════════════════════
  seccion('1 · Las seis tablas existen y ninguna más')
  for (const t of TABLAS) {
    const { error } = await s.from(t).select('*', { count: 'exact', head: true })
    error ? FAIL(`existe ${t}`, error.message) : PASS(`existe ${t}`)
  }
  // Con `head: true` PostgREST contesta 200 aunque la tabla no exista: hay que
  // pedir filas de verdad para que el 404 llegue como error.
  for (const t of ['whatsapp_outbox', 'whatsapp_templates', 'whatsapp_contacts']) {
    const { error } = await s.from(t).select('id').limit(1)
    error ? PASS(`NO existe ${t}`, 'como se decidió') : FAIL(`existe ${t} y no debería`)
  }

  // ══════════════════════════════════════════════════════════════════════
  seccion('2 · Fixtures: dos empresas, ocho identidades, tres chats')

  const nuevaEmpresa = async (sufijo) => {
    const { data, error } = await s.from('companies')
      .insert({ slug: `zz-w1-${sufijo}-${Date.now()}`, name: `${MARCA} ${sufijo}`, default_currency: 'ARS' })
      .select('id').single()
    if (error) throw new Error(`empresa ${sufijo}: ${error.message}`)
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
  const vend1 = await usuarioTemporal(ZZ, 'salesperson')
  const vend2 = await usuarioTemporal(ZZ, 'salesperson')
  const tecnico = await usuarioTemporal(ZZ, 'technician')
  const cliente = await usuarioTemporal(ZZ, 'customer', cliZZ.id)
  const distrib = await usuarioTemporal(ZZ, 'distributor', cliZZ.id)
  const adminAjeno = await usuarioTemporal(ZZ2, 'admin')
  const anon = sesion()

  const cuenta = async (companyId, sufijo) => {
    const { data, error } = await s.from('whatsapp_accounts').insert({
      company_id: companyId, waba_id: `${MARCA}-waba-${sufijo}`,
      phone_number_id: `${MARCA}-pn-${sufijo}-${Date.now()}`,
      display_phone_number: `+5491100000${sufijo}`, display_name: `${MARCA} ${sufijo}`,
    }).select('*').single()
    if (error) throw new Error(`cuenta ${sufijo}: ${error.message}`)
    return data
  }
  const ctaZZ = await cuenta(ZZ, '1')
  const ctaZZ2 = await cuenta(ZZ2, '2')

  const conversacion = async (cta, sufijo, asignado) => {
    const { data, error } = await s.from('whatsapp_conversations').insert({
      company_id: cta.company_id, account_id: cta.id,
      provider_contact_id: `5491133${sufijo}${Date.now()}`,
      phone_raw: `5491133${sufijo}0000`, profile_name: `${MARCA} contacto ${sufijo}`,
      assigned_to: asignado,
    }).select('*').single()
    if (error) throw new Error(`conversación ${sufijo}: ${error.message}`)
    return data
  }
  const chatA = await conversacion(ctaZZ, 'A', vend1.id)
  const chatB = await conversacion(ctaZZ, 'B', vend2.id)
  const chatC = await conversacion(ctaZZ, 'C', null)
  const chatAjeno = await conversacion(ctaZZ2, 'X', null)
  PASS('tres chats en la empresa propia', 'A→vend1, B→vend2, C sin asignar')

  const { data: msgsA } = await s.from('whatsapp_messages')
    .insert([entrante(chatA), entrante(chatA)]).select('*')
  const { data: msgsB } = await s.from('whatsapp_messages').insert([entrante(chatB)]).select('*')
  const { data: msgsC } = await s.from('whatsapp_messages').insert([entrante(chatC)]).select('*')
  const { data: mediaA } = await s.from('whatsapp_media').insert({
    company_id: ZZ, conversation_id: chatA.id, message_id: msgsA[0].id,
    mime_type: 'image/jpeg', file_name: `${MARCA}-a.jpg`, provider_media_id: `${MARCA}-m-a`,
  }).select('*').single()
  const { data: mediaB } = await s.from('whatsapp_media').insert({
    company_id: ZZ, conversation_id: chatB.id, message_id: msgsB[0].id,
    mime_type: 'image/jpeg', file_name: `${MARCA}-b.jpg`, provider_media_id: `${MARCA}-m-b`,
  }).select('*').single()
  PASS('mensajes y adjuntos de fixture', `A:${msgsA.length} B:${msgsB.length} C:${msgsC.length}`)

  // ══════════════════════════════════════════════════════════════════════
  seccion('3 · Constraints: cada regla con un intento real')
  rechaza('un entrante sin provider_timestamp',
    await s.from('whatsapp_messages').insert(entrante(chatA, { provider_timestamp: null })))
  rechaza('un entrante metido en la cola de salida (status pending)',
    await s.from('whatsapp_messages').insert(entrante(chatA, { status: 'pending' })))
  rechaza('un entrante con client_request_id',
    await s.from('whatsapp_messages').insert(entrante(chatA, { client_request_id: randomUUID() })))
  rechaza('un saliente sin client_request_id',
    await s.from('whatsapp_messages').insert(saliente(chatA, { client_request_id: null })))
  rechaza('un saliente con un status que no es de la cola',
    await s.from('whatsapp_messages').insert(saliente(chatA, { status: 'received' })))
  rechaza('attempts negativo',
    await s.from('whatsapp_messages').insert(saliente(chatA, { attempts: -1 })))
  rechaza('una conversación con cliente pero sin vinculo_origen',
    await s.from('whatsapp_conversations').update({ customer_id: cliZZ.id }).eq('id', chatC.id))
  rechaza('un contacto colgado de la nada, sin cliente',
    await s.from('whatsapp_conversations')
      .update({ customer_contact_id: ctcZZ2.id }).eq('id', chatC.id))
  rechaza('media descargada sin storage_path',
    await s.from('whatsapp_media').update({ status: 'descargada' }).eq('id', mediaA.id))
  rechaza('un payload de webhook de 300 KB (nadie vuelca base64 acá)',
    await s.from('whatsapp_webhook_events').insert({
      provider_event_id: `${MARCA}-grande`, payload: { b: 'x'.repeat(300_000) }, signature_ok: true }))

  {
    const { data } = await s.from('whatsapp_conversations')
      .update({ customer_id: cliZZ.id, vinculo_origen: 'manual' }).eq('id', chatC.id).select('id')
    cmp('un cliente CON vinculo_origen sí entra', 1, (data ?? []).length)
    await s.from('whatsapp_conversations')
      .update({ customer_id: null, vinculo_origen: null }).eq('id', chatC.id)
  }

  // ══════════════════════════════════════════════════════════════════════
  seccion('4 · estado_visible: Meta no garantiza una progresión monotónica')
  {
    const { data: m } = await s.from('whatsapp_messages').insert(saliente(chatA)).select('*').single()
    cmp('nace en pending', 'pending', m.estado_visible)
    const paso = async (campos) => (await s.from('whatsapp_messages')
      .update(campos).eq('id', m.id).select('estado_visible').single()).data.estado_visible
    cmp('con sent_at → sent', 'sent', await paso({ sent_at: new Date().toISOString(), status: 'sent' }))
    cmp('con delivered_at → delivered', 'delivered', await paso({ delivered_at: new Date().toISOString() }))
    cmp('y si DESPUÉS llega un fallo de otro dispositivo, sigue delivered',
      'delivered', await paso({ failed_at: new Date().toISOString() }))

    const { data: m2 } = await s.from('whatsapp_messages').insert(saliente(chatA)).select('*').single()
    await s.from('whatsapp_messages').update({ sent_at: new Date().toISOString(), status: 'sent' }).eq('id', m2.id)
    const { data: m2b } = await s.from('whatsapp_messages')
      .update({ failed_at: new Date().toISOString(), status: 'failed' }).eq('id', m2.id)
      .select('estado_visible').single()
    cmp('enviado y fallado sin entrega → failed', 'failed', m2b.estado_visible)
    cmp('un entrante siempre es received', 'received', msgsA[0].estado_visible)
    await s.from('whatsapp_messages').delete().in('id', [m.id, m2.id])
  }

  // ══════════════════════════════════════════════════════════════════════
  seccion('5 · Multiempresa: el hijo no se autoriza por el company_id que le mandan')
  rechaza('conversación cuyo company_id no es el de su cuenta',
    await s.from('whatsapp_conversations').insert({
      company_id: ZZ2, account_id: ctaZZ.id, provider_contact_id: `${MARCA}-cruz-1` }))
  rechaza('conversación vinculada a un cliente de otra empresa',
    await s.from('whatsapp_conversations').update({
      customer_id: cliZZ2.id, vinculo_origen: 'manual' }).eq('id', chatC.id))
  rechaza('conversación con un contacto que no es de su cliente',
    await s.from('whatsapp_conversations').update({
      customer_id: cliZZ.id, vinculo_origen: 'manual', customer_contact_id: ctcZZ2.id }).eq('id', chatC.id))
  rechaza('conversación asignada a un usuario de otra empresa',
    await s.from('whatsapp_conversations').update({ assigned_to: adminAjeno.id }).eq('id', chatC.id))
  rechaza('conversación asignada a un technician (no puede usar WhatsApp)',
    await s.from('whatsapp_conversations').update({ assigned_to: tecnico.id }).eq('id', chatC.id))
  rechaza('mensaje con company_id distinto al de su conversación',
    await s.from('whatsapp_messages').insert(entrante(chatA, { company_id: ZZ2 })))
  rechaza('mensaje con una cuenta que no es la de su conversación',
    await s.from('whatsapp_messages').insert(entrante(chatA, { account_id: ctaZZ2.id })))
  rechaza('adjunto con company_id distinto al de su conversación',
    await s.from('whatsapp_media').insert({
      company_id: ZZ2, conversation_id: chatA.id, mime_type: 'image/png' }))
  rechaza('adjunto colgado de un mensaje de otra conversación',
    await s.from('whatsapp_media').insert({
      company_id: ZZ, conversation_id: chatA.id, message_id: msgsB[0].id, mime_type: 'image/png' }))

  // ══════════════════════════════════════════════════════════════════════
  seccion('6 · RLS por identidad, con ids exactos (no conteos)')
  const esperado = {
    'ADMIN': [admin.c, [chatA.id, chatB.id, chatC.id].sort()],
    'EMPLOYEE': [empleado.c, [chatA.id, chatB.id, chatC.id].sort()],
    'SALESPERSON (vend1)': [vend1.c, [chatA.id]],
    'SALESPERSON (vend2)': [vend2.c, [chatB.id]],
    'TECHNICIAN': [tecnico.c, []],
    'CUSTOMER': [cliente.c, []],
    'DISTRIBUTOR': [distrib.c, []],
    'ADMIN de otra empresa': [adminAjeno.c, [chatAjeno.id]],
  }
  for (const [nombre, [cli, ids]] of Object.entries(esperado)) {
    const ve = await idsVisibles(cli, 'whatsapp_conversations')
    cmp(`${nombre} ve exactamente`, JSON.stringify(ids), JSON.stringify(ve))
  }
  // El anónimo aparte, y midiendo el ERROR y no una lista vacía: un array vacío
  // puede venir de una consulta que falló, y eso sería un PASS por la razón
  // equivocada. Su barrera es el privilegio, antes que cualquier policy.
  for (const t of TABLAS) {
    rechaza(`ANON ni siquiera puede consultar ${t}`, await anon.from(t).select('id').limit(1))
  }

  seccion('7 · Los hijos siguen al padre')
  {
    const msgA = msgsA.map((m) => m.id).sort()
    cmp('vend1 ve sólo los mensajes de A', JSON.stringify(msgA),
      JSON.stringify(await idsVisibles(vend1.c, 'whatsapp_messages')))
    const { data: espia } = await vend1.c.from('whatsapp_messages').select('id').eq('id', msgsB[0].id)
    cmp('y pidiendo POR ID el mensaje de B no obtiene nada', 0, (espia ?? []).length)
    cmp('vend1 ve sólo el adjunto de A', JSON.stringify([mediaA.id]),
      JSON.stringify(await idsVisibles(vend1.c, 'whatsapp_media')))
    const { data: espiaM } = await vend1.c.from('whatsapp_media').select('id').eq('id', mediaB.id)
    cmp('y el adjunto de B tampoco', 0, (espiaM ?? []).length)
    cmp('el admin ve los cuatro mensajes de su empresa', 4,
      (await idsVisibles(admin.c, 'whatsapp_messages')).length)
    cmp('el technician no ve ningún mensaje', 0,
      (await idsVisibles(tecnico.c, 'whatsapp_messages')).length)
    cmp('ni ningún adjunto', 0, (await idsVisibles(tecnico.c, 'whatsapp_media')).length)
    cmp('vend1 ve la cuenta desde la que le hablan', 1,
      (await idsVisibles(vend1.c, 'whatsapp_accounts')).length)
    cmp('vend2 también, la suya', 1, (await idsVisibles(vend2.c, 'whatsapp_accounts')).length)
    cmp('el technician no ve ninguna cuenta', 0,
      (await idsVisibles(tecnico.c, 'whatsapp_accounts')).length)
  }

  seccion('8 · Nadie escribe directo desde el cliente')
  rechaza('vend1 se autoasigna el chat C por UPDATE directo',
    await vend1.c.from('whatsapp_conversations').update({ assigned_to: vend1.id }).eq('id', chatC.id))
  rechaza('vend1 se roba el chat B',
    await vend1.c.from('whatsapp_conversations').update({ assigned_to: vend1.id }).eq('id', chatB.id))
  rechaza('ni siquiera el ADMIN puede hacer UPDATE directo',
    await admin.c.from('whatsapp_conversations').update({ archived_at: new Date().toISOString() }).eq('id', chatA.id))
  rechaza('el admin inserta un mensaje a mano',
    await admin.c.from('whatsapp_messages').insert(saliente(chatA)))
  rechaza('el admin inserta una cuenta',
    await admin.c.from('whatsapp_accounts').insert({
      company_id: ZZ, waba_id: 'x', phone_number_id: `x-${Date.now()}`, display_phone_number: '+1' }))
  rechaza('el admin borra un adjunto',
    await admin.c.from('whatsapp_media').delete().eq('id', mediaA.id))
  {
    const { data, error } = await admin.c.from('whatsapp_webhook_events').select('id')
    error ? PASS('el admin no lee los eventos crudos', error.code)
          : cmp('el admin no lee los eventos crudos', 0, (data ?? []).length)
    rechaza('ni los escribe', await admin.c.from('whatsapp_webhook_events')
      .insert({ provider_event_id: `${MARCA}-x`, payload: {}, signature_ok: true }))
    const { data: anonVe } = await anon.from('whatsapp_webhook_events').select('id')
    cmp('y el anónimo tampoco', 0, (anonVe ?? []).length)
  }
  {
    // El efecto, no sólo el código: la conversación tiene que seguir intacta.
    const { data: c } = await s.from('whatsapp_conversations')
      .select('assigned_to, archived_at').eq('id', chatC.id).single()
    cmp('el chat C sigue sin asignar después de los intentos', 'null', String(c.assigned_to))
    const { data: a } = await s.from('whatsapp_conversations')
      .select('archived_at').eq('id', chatA.id).single()
    cmp('y el chat A sin archivar', 'null', String(a.archived_at))
  }

  // ══════════════════════════════════════════════════════════════════════
  seccion('9 · Asignación: la única puerta')
  rechaza('vend1 se autoasigna por la RPC',
    await vend1.c.rpc('asignar_conversacion_whatsapp', { p_conversacion: chatC.id, p_usuario: vend1.id }))
  rechaza('el admin de la otra empresa asigna el chat A',
    await adminAjeno.c.rpc('asignar_conversacion_whatsapp', { p_conversacion: chatA.id, p_usuario: adminAjeno.id }))
  rechaza('el anónimo asigna',
    await anon.rpc('asignar_conversacion_whatsapp', { p_conversacion: chatC.id, p_usuario: vend1.id }))
  rechaza('asignar a un technician',
    await admin.c.rpc('asignar_conversacion_whatsapp', { p_conversacion: chatC.id, p_usuario: tecnico.id }))
  rechaza('asignar a alguien de otra empresa',
    await admin.c.rpc('asignar_conversacion_whatsapp', { p_conversacion: chatC.id, p_usuario: adminAjeno.id }))
  {
    const { error } = await empleado.c.rpc('asignar_conversacion_whatsapp',
      { p_conversacion: chatC.id, p_usuario: vend1.id })
    error ? FAIL('el employee asigna el chat C a vend1', error.message)
          : PASS('el employee asigna el chat C a vend1')
    cmp('y ahora vend1 ve DOS chats', JSON.stringify([chatA.id, chatC.id].sort()),
      JSON.stringify(await idsVisibles(vend1.c, 'whatsapp_conversations')))
    cmp('y también el mensaje de C', 3, (await idsVisibles(vend1.c, 'whatsapp_messages')).length)

    await admin.c.rpc('asignar_conversacion_whatsapp', { p_conversacion: chatC.id, p_usuario: null })
    cmp('el admin lo desasigna y vend1 vuelve a ver uno', JSON.stringify([chatA.id]),
      JSON.stringify(await idsVisibles(vend1.c, 'whatsapp_conversations')))

    // Dos admins reasignando a la vez: no importa quién gane, importa que la
    // fila quede consistente y con uno de los dos valores.
    const [r1, r2] = await Promise.all([
      admin.c.rpc('asignar_conversacion_whatsapp', { p_conversacion: chatC.id, p_usuario: vend1.id }),
      empleado.c.rpc('asignar_conversacion_whatsapp', { p_conversacion: chatC.id, p_usuario: vend2.id }),
    ])
    const { data: final } = await s.from('whatsapp_conversations')
      .select('assigned_to').eq('id', chatC.id).single()
    const ok = final.assigned_to === vend1.id || final.assigned_to === vend2.id
    ok ? PASS('dos admins asignando a la vez dejan un estado consistente',
              final.assigned_to === vend1.id ? 'ganó vend1' : 'ganó vend2')
       : FAIL('dos admins asignando a la vez', `quedó ${final.assigned_to}`)
    cmp('ninguna de las dos llamadas rompió', 'false',
      String(Boolean(r1.error && r2.error)))
    await s.from('whatsapp_conversations').update({ assigned_to: null }).eq('id', chatC.id)
  }

  // ══════════════════════════════════════════════════════════════════════
  seccion('10 · No leídos: Juan lee, Facundo sigue sin leer')
  {
    const noLeidos = async (cli, conv) => {
      const { data } = await cli.rpc('no_leidos_whatsapp', { p_conversaciones: [conv] })
      return (data ?? []).find((x) => x.conversation_id === conv)?.no_leidos ?? 'sin fila'
    }
    cmp('vend1 arranca con 2 sin leer en A', 2, await noLeidos(vend1.c, chatA.id))
    cmp('el admin también', 2, await noLeidos(admin.c, chatA.id))

    const { error } = await vend1.c.rpc('marcar_conversacion_leida_whatsapp', { p_conversacion: chatA.id })
    error ? FAIL('vend1 marca A como leída', error.message) : PASS('vend1 marca A como leída')

    cmp('vend1 queda en 0', 0, await noLeidos(vend1.c, chatA.id))
    cmp('y el ADMIN sigue en 2: el no leído es de cada uno', 2, await noLeidos(admin.c, chatA.id))

    await s.from('whatsapp_messages').insert(entrante(chatA))
    cmp('llega uno nuevo y vend1 vuelve a 1', 1, await noLeidos(vend1.c, chatA.id))
    cmp('y el admin pasa a 3', 3, await noLeidos(admin.c, chatA.id))

    rechaza('vend1 marca leída una conversación que no ve (B)',
      await vend1.c.from('whatsapp_conversation_reads')
        .insert({ conversation_id: chatB.id, user_id: vend1.id }))
    rechaza('vend1 marca leído EN NOMBRE del admin',
      await vend1.c.from('whatsapp_conversation_reads')
        .insert({ conversation_id: chatA.id, user_id: admin.id }))

    await admin.c.rpc('marcar_conversacion_leida_whatsapp', { p_conversacion: chatA.id })
    cmp('el admin marca leída y queda en 0', 0, await noLeidos(admin.c, chatA.id))
    cmp('y vend1 NO se ve afectado, sigue en 1', 1, await noLeidos(vend1.c, chatA.id))

    // Acá NO alcanza con mirar el código: la policy esconde la fila del admin,
    // así que PostgREST contesta 200 con cero filas tocadas. Lo que hay que
    // medir es si el valor del admin cambió. Se intenta con una fecha VIEJA,
    // que es el ataque que importa: resucitarle los no leídos a otro.
    const { data: antesAdmin } = await s.from('whatsapp_conversation_reads')
      .select('last_read_at').eq('conversation_id', chatA.id).eq('user_id', admin.id).single()
    await vend1.c.from('whatsapp_conversation_reads')
      .update({ last_read_at: '2020-01-01T00:00:00Z' })
      .eq('conversation_id', chatA.id).eq('user_id', admin.id)
    const { data: despuesAdmin } = await s.from('whatsapp_conversation_reads')
      .select('last_read_at').eq('conversation_id', chatA.id).eq('user_id', admin.id).single()
    cmp('vend1 no pudo pisar la marca del admin', antesAdmin.last_read_at, despuesAdmin.last_read_at)
    cmp('y el admin sigue en 0 sin leer', 0, await noLeidos(admin.c, chatA.id))
    cmp('vend1 sólo ve su propia fila de lectura', 1,
      (await idsVisibles(vend1.c, 'whatsapp_conversation_reads', 'user_id')).length)
    rechaza('vend1 borra su marca (no hay DELETE para nadie)',
      await vend1.c.from('whatsapp_conversation_reads').delete().eq('conversation_id', chatA.id))
  }

  // ══════════════════════════════════════════════════════════════════════
  seccion('11 · Idempotencia entrante: Meta reintenta 36 horas')
  {
    const wamid = `wamid.${MARCA}.${Date.now()}`
    const { error: e1 } = await s.from('whatsapp_messages')
      .insert(entrante(chatA, { provider_message_id: wamid }))
    e1 ? FAIL('el primer webhook entra', e1.message) : PASS('el primer webhook entra')
    rechaza('el mismo wamid repetido', await s.from('whatsapp_messages')
      .insert(entrante(chatA, { provider_message_id: wamid })))

    // Acotado POR CUENTA: Meta no publica garantía de unicidad entre cuentas.
    const { error: e3 } = await s.from('whatsapp_messages')
      .insert(entrante(chatAjeno, { provider_message_id: wamid }))
    e3 ? FAIL('el mismo wamid en OTRA cuenta sí entra', e3.message)
       : PASS('el mismo wamid en OTRA cuenta sí entra', 'la unicidad es por account_id')

    const wamid2 = `wamid.${MARCA}.conc.${Date.now()}`
    const rs = await Promise.all(Array.from({ length: 6 }, () =>
      s.from('whatsapp_messages').insert(entrante(chatA, { provider_message_id: wamid2 }))))
    const { count } = await s.from('whatsapp_messages')
      .select('*', { count: 'exact', head: true }).eq('provider_message_id', wamid2)
    cmp('seis webhooks simultáneos con el mismo wamid → 1 fila', 1, count)
    cmp('y cinco fueron rechazados', 5, rs.filter((r) => r.error).length)
  }

  seccion('12 · Idempotencia saliente: dos pestañas, un mensaje')
  {
    const crid = randomUUID()
    const rs = await Promise.all(Array.from({ length: 6 }, () =>
      s.from('whatsapp_messages').insert(saliente(chatA, { client_request_id: crid }))))
    const { count } = await s.from('whatsapp_messages')
      .select('*', { count: 'exact', head: true }).eq('client_request_id', crid)
    cmp('seis envíos simultáneos con el mismo client_request_id → 1 fila', 1, count)
    cmp('y cinco fueron rechazados', 5, rs.filter((r) => r.error).length)
    await s.from('whatsapp_messages').delete().eq('client_request_id', crid)
  }

  // ══════════════════════════════════════════════════════════════════════
  seccion('13 · Claim: ocho consumidores concurrentes')
  {
    rechaza('el admin ejecuta el claim', await admin.c.rpc('tomar_mensajes_whatsapp', { p_limite: 5 }))
    rechaza('el anónimo ejecuta el claim', await anon.rpc('tomar_mensajes_whatsapp', { p_limite: 5 }))

    const pendientes = Array.from({ length: 40 }, () => saliente(chatA))
    const { data: creadosMsg, error: eIns } = await s.from('whatsapp_messages')
      .insert(pendientes).select('id')
    if (eIns) throw new Error(`cola: ${eIns.message}`)
    const idsCola = new Set(creadosMsg.map((m) => m.id))
    cmp('40 mensajes en la cola', 40, idsCola.size)

    const lotes = await Promise.all(Array.from({ length: 8 }, () =>
      s.rpc('tomar_mensajes_whatsapp', { p_limite: 6 })))
    const errores = lotes.filter((l) => l.error)
    cmp('ningún consumidor falló', 0, errores.length)

    const vistos = new Map()
    let duplicados = 0
    let reclamados = 0
    for (const [i, lote] of lotes.entries()) {
      for (const m of lote.data ?? []) {
        if (!idsCola.has(m.id)) continue
        reclamados++
        if (vistos.has(m.id)) duplicados++
        else vistos.set(m.id, i)
      }
    }
    cmp('ningún id apareció en dos lotes a la vez', 0, duplicados)
    cmp('se reclamaron 48 cupos sobre 40 mensajes → 40', 40, reclamados)
    cmp('y son 40 ids distintos', 40, vistos.size)

    const { data: tomados } = await s.from('whatsapp_messages')
      .select('id, status, attempts, claimed_at').in('id', [...idsCola])
    cmp('los 40 quedaron en sending', 40, tomados.filter((m) => m.status === 'sending').length)
    cmp('todos con attempts = 1', 40, tomados.filter((m) => m.attempts === 1).length)
    cmp('todos con claimed_at', 40, tomados.filter((m) => m.claimed_at !== null).length)

    // Y lo que no se reclama se queda quieto.
    const { data: sobrantes } = await s.from('whatsapp_messages')
      .insert(Array.from({ length: 5 }, () => saliente(chatA))).select('id')
    await s.rpc('tomar_mensajes_whatsapp', { p_limite: 2 })
    const { data: est } = await s.from('whatsapp_messages')
      .select('id, status, attempts').in('id', sobrantes.map((x) => x.id))
    cmp('de 5 nuevos sólo se reclaman 2', 2, est.filter((m) => m.status === 'sending').length)
    cmp('y los otros 3 siguen pending con attempts 0', 3,
      est.filter((m) => m.status === 'pending' && m.attempts === 0).length)
    for (const x of sobrantes) idsCola.add(x.id)

    // ══════════════════════════════════════════════════════════════════
    seccion('14 · Reaper: sending trabado → failed, NUNCA → pending')
    const viejos = [...idsCola].slice(0, 3)
    const antesCount = await q('whatsapp_messages')
    const { data: antes } = await s.from('whatsapp_messages')
      .select('id, client_request_id').in('id', viejos)
    await s.from('whatsapp_messages')
      .update({ claimed_at: new Date(Date.now() - 10 * 60_000).toISOString() }).in('id', viejos)

    const { data: reciclados, error: eR } = await s.rpc('reciclar_mensajes_whatsapp', {})
    eR ? FAIL('el reaper corre', eR.message) : PASS('el reaper corre', `${(reciclados ?? []).length} fila(s)`)
    const { data: despues } = await s.from('whatsapp_messages')
      .select('id, status, failed_at, client_request_id').in('id', viejos)
    cmp('los tres trabados quedaron en failed', 3, despues.filter((m) => m.status === 'failed').length)
    cmp('NINGUNO volvió a pending', 0, despues.filter((m) => m.status === 'pending').length)
    cmp('todos con failed_at', 3, despues.filter((m) => m.failed_at !== null).length)
    cmp('no se creó ninguna fila nueva', antesCount, await q('whatsapp_messages'))
    const mismos = antes.every((a) =>
      despues.find((d) => d.id === a.id).client_request_id === a.client_request_id)
    cmp('el client_request_id no cambió', 'true', String(mismos))
    const { data: recien } = await s.from('whatsapp_messages')
      .select('id, status').in('id', [...idsCola]).eq('status', 'sending')
    const quedan = (recien ?? []).length
    quedan > 0 ? PASS('los reclamados recién NO los toca', `${quedan} siguen en sending`)
               : FAIL('el reaper se llevó también los recientes')
    rechaza('el admin ejecuta el reaper', await admin.c.rpc('reciclar_mensajes_whatsapp', {}))
  }

  // ══════════════════════════════════════════════════════════════════════
  seccion('15 · Storage: bucket privado y policy atada a la conversación')
  {
    const { data: buckets } = await s.storage.listBuckets()
    const b = (buckets ?? []).find((x) => x.id === BUCKET)
    b ? PASS('existe el bucket whatsapp') : FAIL('falta el bucket whatsapp')
    cmp('es privado', 'false', String(b?.public))

    // Un archivo de prueba, no media real: 12 bytes de texto.
    const rutaA = `${ZZ}/${ctaZZ.id}/${chatA.id}/${msgsA[0].id}/${MARCA}.txt`
    const rutaB = `${ZZ}/${ctaZZ.id}/${chatB.id}/${msgsB[0].id}/${MARCA}.txt`
    for (const r of [rutaA, rutaB]) {
      const { error } = await s.storage.from(BUCKET).upload(r, new Blob([`${MARCA} prueba`]))
      if (error) FAIL(`subir fixture ${r}`, error.message)
      else creados.objetos.push(r)
    }
    const leeA = await vend1.c.storage.from(BUCKET).download(rutaA)
    leeA.error ? FAIL('vend1 baja el archivo de SU conversación', leeA.error.message)
               : PASS('vend1 baja el archivo de SU conversación')
    const leeB = await vend1.c.storage.from(BUCKET).download(rutaB)
    leeB.error ? PASS('y el de la conversación ajena NO', String(leeB.error.message).slice(0, 40))
               : FAIL('SE PERMITIÓ: vend1 bajó el archivo del chat B')
    const leeAnon = await anon.storage.from(BUCKET).download(rutaA)
    leeAnon.error ? PASS('el anónimo tampoco') : FAIL('SE PERMITIÓ: el anónimo bajó media')
    const sube = await vend1.c.storage.from(BUCKET).upload(
      `${ZZ}/${ctaZZ.id}/${chatA.id}/x/${MARCA}-intruso.txt`, new Blob(['x']))
    sube.error ? PASS('y nadie sube desde el navegador', String(sube.error.message).slice(0, 40))
               : FAIL('SE PERMITIÓ: vend1 subió un archivo al bucket')
  }

  seccion('16 · Media: vencimiento a 180 días desde el día 1')
  {
    const { data: m } = await s.from('whatsapp_media').insert({
      company_id: ZZ, conversation_id: chatC.id, mime_type: 'audio/ogg',
      provider_media_id: `${MARCA}-ret`,
    }).select('*').single()
    const dias = Math.round((new Date(m.media_expires_at) - new Date(m.created_at)) / 86_400_000)
    cmp('una media nueva ya sabe cuándo vence', 180, dias)
    const { data: m2 } = await s.from('whatsapp_media')
      .update({ status: 'descargada', storage_path: `${ZZ}/x` }).eq('id', m.id).select('*').single()
    const dias2 = Math.round((new Date(m2.media_expires_at) - new Date(m2.downloaded_at)) / 86_400_000)
    cmp('y al descargarse se recuenta desde la descarga', 180, dias2)
    m2.downloaded_at ? PASS('downloaded_at se completó solo') : FAIL('downloaded_at quedó vacío')
    await s.from('whatsapp_media').delete().eq('id', m.id)
  }

  // ══════════════════════════════════════════════════════════════════════
  seccion('17 · Realtime: se cuenta lo que LLEGA, no que el canal acepte el join')
  {
    const escuchar = (cli, etiqueta) => new Promise((resolve) => {
      const recibidos = []
      const ch = cli.channel(`${MARCA}-${etiqueta}-${randomUUID()}`)
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'whatsapp_messages' },
          (p) => recibidos.push(p.new?.id))
        .subscribe((estado) => {
          if (estado !== 'SUBSCRIBED') return
          setTimeout(async () => {
            await s.from('whatsapp_messages').insert(entrante(chatB, { text_body: `${MARCA} rt` }))
            setTimeout(async () => { await cli.removeChannel(ch); resolve(recibidos) }, 3500)
          }, 500)
        })
      setTimeout(async () => { await cli.removeChannel(ch); resolve(recibidos) }, 12_000)
    })

    const recibeVend1 = await escuchar(vend1.c, 'vend1')
    cmp('vend1 NO recibe el mensaje de una conversación que no ve', 0, recibeVend1.length)
    const recibeAdmin = await escuchar(admin.c, 'admin')
    recibeAdmin.length > 0
      ? PASS('el admin sí lo recibe', `${recibeAdmin.length} evento(s)`)
      : FAIL('el admin no recibió nada: Realtime no está entregando')
  }

  // ══════════════════════════════════════════════════════════════════════
  seccion('18 · Limpieza e invariantes')
  {
    for (const r of creados.objetos) await s.storage.from(BUCKET).remove([r])
    const idsConv = [chatA.id, chatB.id, chatC.id, chatAjeno.id]
    await s.from('whatsapp_messages').update({ media_id: null }).in('conversation_id', idsConv)
    await s.from('whatsapp_media').delete().in('conversation_id', idsConv)
    await s.from('whatsapp_messages').delete().in('conversation_id', idsConv)
    await s.from('whatsapp_conversation_reads').delete().in('conversation_id', idsConv)
    await s.from('whatsapp_conversations').delete().in('id', idsConv)
    await s.from('whatsapp_accounts').delete().in('id', [ctaZZ.id, ctaZZ2.id])
    await s.from('whatsapp_webhook_events').delete().like('provider_event_id', `${MARCA}%`)
    await s.from('customer_contacts').delete().eq('id', ctcZZ2.id)
    for (const id of creados.usuarios) {
      await s.from('company_memberships').delete().eq('user_id', id)
      await s.auth.admin.deleteUser(id)
    }
    await s.from('customers').delete().in('id', [cliZZ.id, cliZZ2.id])
    for (const id of creados.empresas) await s.from('companies').delete().eq('id', id)

    for (const t of TABLAS) cmp(`0 filas en ${t}`, 0, await q(t))
    const { data: quedan } = await s.storage.from(BUCKET).list(ZZ)
    cmp('sin objetos sueltos en el bucket', 0, (quedan ?? []).length)
    cmp('las empresas vuelven a su número', empresasAntes, await q('companies'))
    cmp('los clientes vuelven a su número', clientesAntes, await q('customers'))

    // Nada de esto podía tocar los otros módulos, pero se mide igual.
    const { count: prodsBT } = await s.from('products')
      .select('*', { count: 'exact', head: true }).eq('company_id', BT)
    cmp('21.772 productos de Buscatools intactos', 21772, prodsBT)
    cmp('142 proveedores intactos', 142, await q('suppliers'))
    cmp('16 puntos de revisión de Mantenimiento intactos', 16, await q('maintenance_check_points'))
  }

  console.log('\n' + '='.repeat(74))
  console.log(`  RESULTADO: ${fallos} fallo(s)`)
  console.log('='.repeat(74))
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch((e) => { console.error('\n✗', e); process.exit(1) })
