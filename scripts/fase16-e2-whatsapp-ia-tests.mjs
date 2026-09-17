/**
 * Fase 16 · WhatsApp — Entrega 2: IA, informes y preparación para grupos.
 * Las reglas que sólo se pueden probar contra la base.
 *
 *   node --env-file=.env --env-file=.env.migration --experimental-strip-types \
 *     scripts/fase16-e2-whatsapp-ia-tests.mjs
 *
 * `--experimental-strip-types` porque el circuito del análisis se ejecuta con
 * el MISMO código que usa la Edge Function (`analisis.ts` + `logica.ts`).
 *
 * El proveedor es SIEMPRE el falso o uno de prueba armado acá: esta suite no
 * manda un solo mensaje a un tercero, ni real ni de fixture.
 *
 * Qué prueba, medido por EFECTO:
 *   1. grupos: las conversaciones actuales quedan individuales y el check cierra
 *   2. RLS de lectura: ocho actores contra el resumen, los ítems y las corridas
 *   3. nadie escribe directo, ni llama las RPC de servidor
 *   4. guardar_analisis: fuentes inventadas, ajenas, borradas, checkpoint, obsoleto
 *   5. idempotencia: reanalizar no duplica y no reabre lo resuelto
 *   6. el circuito completo con el fixture A–F, incremental y debounce
 *   7. fallos del proveedor: no destructivos
 *   8. resolver una sugerencia: quién puede y quién no
 *   9. señales de atención: reglas determinísticas y RLS
 *  10. informe: aislamiento, período, sin escrituras
 *  11. limpieza e invariantes
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const { analizarConversacion } = await import('../supabase/functions/whatsapp-ai-analyze/analisis.ts')
const { proveedorFalso, FalloProveedor } = await import('../supabase/functions/whatsapp-ai-analyze/logica.ts')

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
const rechaza = (t, r, codigo = null) => {
  if (!r.error) return FAIL(`SE PERMITIÓ: ${t}`)
  const msg = String(r.error.message)
  if (codigo && !msg.includes(codigo)) return FAIL(t, `esperaba ${codigo}, dio «${msg.slice(0, 70)}»`)
  PASS(t, codigo ?? (r.error.code ?? msg.slice(0, 50)))
}

const sesion = () => createClient(BASE, PUB, { auth: { persistSession: false } })
const s = createClient(BASE, SECRET, { auth: { persistSession: false } })

const MARCA = 'zz-w16e2'
const creados = { usuarios: [], empresas: [] }
const TABLAS = [
  'whatsapp_accounts', 'whatsapp_conversations', 'whatsapp_messages', 'whatsapp_media',
  'whatsapp_conversation_reads', 'whatsapp_webhook_events',
  'whatsapp_conversation_ai_summary', 'whatsapp_ai_items', 'whatsapp_ai_runs',
]
const cuenta = async (t) => (await s.from(t).select('*', { count: 'exact', head: true })).count
const ok = (r, q) => { if (r.error) throw new Error(`${q}: ${r.error.message}`); return r.data }

const usuarioTemporal = async (companyId, rol, customerId = null) => {
  const email = `${MARCA}-${rol}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@buscatools.test`
  const password = `Zz${randomUUID()}!`
  const { data, error } = await s.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`crear ${rol}: ${error.message}`)
  creados.usuarios.push(data.user.id)
  const fila = { company_id: companyId, user_id: data.user.id, role: rol, status: 'active' }
  if (customerId) fila.customer_id = customerId
  ok(await s.from('company_memberships').insert(fila), `membresía ${rol}`)
  const c = sesion()
  const { error: eL } = await c.auth.signInWithPassword({ email, password })
  if (eL) throw new Error(`login ${rol}: ${eL.message}`)
  return { id: data.user.id, rol, c }
}

const borrarEmpresas = async (ids) => {
  if (!ids.length) return
  const { data: convs } = await s.from('whatsapp_conversations').select('id').in('company_id', ids)
  const cids = (convs ?? []).map((c) => c.id)
  if (cids.length) await s.from('whatsapp_conversation_reads').delete().in('conversation_id', cids)
  const borrar = async (t) => {
    const r = await s.from(t).delete().in('company_id', ids)
    if (r.error) console.log(`    aviso ${t}: ${r.error.message.slice(0, 120)}`)
  }
  for (const t of ['whatsapp_ai_runs', 'whatsapp_ai_items', 'whatsapp_conversation_ai_summary',
    'whatsapp_media', 'whatsapp_messages', 'whatsapp_conversations', 'whatsapp_accounts',
    'company_memberships', 'customer_contacts', 'customers']) {
    await borrar(t)
  }
}

const limpiar = async () => {
  await borrarEmpresas(creados.empresas)
  for (const u of creados.usuarios) await s.auth.admin.deleteUser(u)
  creados.usuarios = []
  if (creados.empresas.length) {
    const r = await s.from('companies').delete().in('id', creados.empresas)
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

const hace = (horas) => new Date(Date.now() - horas * 3600_000).toISOString()

async function main() {
  console.log('='.repeat(78))
  console.log('  FASE 16 · WhatsApp E2 — IA, informes y grupos')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(78))

  await barrerRestos()
  const base = {}
  for (const t of TABLAS) base[t] = await cuenta(t)
  console.log(`  baseline: ${TABLAS.map((t) => `${t.replace('whatsapp_', '')}=${base[t]}`).join('  ')}`)

  // ── Fixture ──────────────────────────────────────────────────────────────
  const sello = Date.now()
  const empresa = ok(await s.from('companies').insert({
    slug: `${MARCA}-a-${sello}`, name: 'ZZ W16E2 A', legal_name: 'ZZ W16E2 A SA', default_currency: 'ARS',
  }).select('id').single(), 'empresa A')
  creados.empresas.push(empresa.id)
  const empresaB = ok(await s.from('companies').insert({
    slug: `${MARCA}-b-${sello}`, name: 'ZZ W16E2 B', legal_name: 'ZZ W16E2 B SA', default_currency: 'ARS',
  }).select('id').single(), 'empresa B')
  creados.empresas.push(empresaB.id)

  const PHONE_A = `${MARCA}-a-${sello}`
  const PHONE_B = `${MARCA}-b-${sello}`
  ok(await s.from('whatsapp_accounts').insert({
    company_id: empresa.id, waba_id: '1499762661645319', phone_number_id: PHONE_A,
    display_phone_number: '+54 9 11 0000-0001', display_name: 'ZZ A', active: true,
  }), 'cuenta A')
  ok(await s.from('whatsapp_accounts').insert({
    company_id: empresaB.id, waba_id: '1499762661645319', phone_number_id: PHONE_B,
    display_phone_number: '+54 9 11 0000-0002', display_name: 'ZZ B', active: true,
  }), 'cuenta B')

  const cliente = ok(await s.from('customers').insert({
    company_id: empresa.id, legal_name: 'ZZ W16E2 Cliente SA', status: 'active',
  }).select('id').single(), 'cliente')

  const admin = await usuarioTemporal(empresa.id, 'admin')
  const employee = await usuarioTemporal(empresa.id, 'employee')
  const vend1 = await usuarioTemporal(empresa.id, 'salesperson')
  const vend2 = await usuarioTemporal(empresa.id, 'salesperson')
  const tech = await usuarioTemporal(empresa.id, 'technician')
  const portal = await usuarioTemporal(empresa.id, 'customer', cliente.id)
  const adminB = await usuarioTemporal(empresaB.id, 'admin')
  const anon = sesion()

  let n = 0
  const entrante = async (phone, waId, texto, horas, perfil = 'ZZ Contacto') => {
    n++
    return ok(await s.rpc('registrar_entrante_whatsapp', {
      p_phone_number_id: phone, p_waba_id: '1499762661645319', p_wa_id: waId, p_profile_name: perfil,
      p_provider_message_id: `wamid.${MARCA}.${sello}.${n}`, p_tipo: 'text', p_texto: texto,
      p_caption: null, p_reply_to: null, p_timestamp: hace(horas), p_media: null,
    }), `entrante ${n}`)
  }
  const saliente = async (convId, texto, error = null) => {
    const m = ok(await admin.c.rpc('encolar_mensaje_whatsapp', {
      p_conversacion: convId, p_texto: texto, p_client_request_id: randomUUID(),
    }), 'encolar')
    ok(await s.rpc('sellar_saliente_whatsapp', {
      p_mensaje: m.id,
      p_provider_message_id: error ? null : `wamid.${MARCA}.out.${randomUUID()}`,
      p_error_code: error ? 131026 : null,
      p_error_details: error,
    }), 'sellar')
    return m.id
  }

  // A · simple   B · pregunta sin responder   C · compromiso con fecha
  // D · decisión confirmada   E · ruido   F · error de envío
  const A = (await entrante(PHONE_A, '5491100000001', 'Hola, buen día', 3, 'ZZ A Simple')).conversation_id
  await saliente(A, 'Hola, ¿en qué te ayudamos?')
  const B = (await entrante(PHONE_A, '5491100000002', '¿Tienen stock del torquímetro 3/8?', 6, 'ZZ B Pregunta')).conversation_id
  const C = (await entrante(PHONE_A, '5491100000003', 'Necesito cotización de 4 candados', 2, 'ZZ C Compromiso')).conversation_id
  await saliente(C, 'Perfecto, mañana te mando la cotización')
  const D = (await entrante(PHONE_A, '5491100000004', 'Dale, queda confirmado el pedido de 2 unidades', 1, 'ZZ D Decisión')).conversation_id
  const E = (await entrante(PHONE_A, '5491100000005', 'jaja ok', 1, 'ZZ E Ruido')).conversation_id
  await saliente(E, 'Saludos')
  const F = (await entrante(PHONE_A, '5491100000006', 'Hola', 1, 'ZZ F Error')).conversation_id
  await saliente(F, 'Te respondo', 'numero_no_valido')
  const XB = (await entrante(PHONE_B, '5491100000007', '¿Precio?', 1, 'ZZ Otra empresa')).conversation_id

  // El vendedor 1 tiene asignada sólo la B.
  ok(await admin.c.rpc('asignar_conversacion_whatsapp', { p_conversacion: B, p_usuario: vend1.id }), 'asignar B')

  // ── 1 · Grupos ───────────────────────────────────────────────────────────
  seccion('1 · Preparación para grupos')

  const { data: tipos } = await s.from('whatsapp_conversations').select('conversation_type, provider_group_id')
    .in('company_id', [empresa.id, empresaB.id])
  cmp('las conversaciones nuevas nacen individuales', true, tipos.every((t) => t.conversation_type === 'individual' && t.provider_group_id === null))
  const { count: noIndividuales } = await s.from('whatsapp_conversations').select('*', { count: 'exact', head: true })
    .neq('conversation_type', 'individual')
  cmp('ninguna conversación de producción cambió de tipo', 0, noIndividuales)

  rechaza('un grupo sin provider_group_id no entra',
    await s.from('whatsapp_conversations').update({ conversation_type: 'group' }).eq('id', A), 'chk_wa_conv_tipo')
  rechaza('una individual con provider_group_id no entra',
    await s.from('whatsapp_conversations').update({ provider_group_id: 'g1' }).eq('id', A), 'chk_wa_conv_tipo')
  rechaza('un grupo cuyo contacto no es group:<id> no entra',
    await s.from('whatsapp_conversations').update({ conversation_type: 'group', provider_group_id: 'g1' }).eq('id', A), 'chk_wa_conv_tipo')

  // ── 6 · Circuito completo (antes que RLS: hay que tener datos) ───────────
  seccion('6 · Circuito completo con el proveedor falso')

  let reloj = Date.now()
  const correr = (conv, extra = {}) => analizarConversacion({
    admin: s, proveedor: proveedorFalso, conversacionId: conv, completo: false,
    solicitadoPor: admin.id, ahora: () => reloj, ...extra,
  })

  const rA = await correr(A)
  cmp('A simple: analiza', 'ok', rA.estado)
  const rB = await correr(B)
  cmp('B pregunta: analiza', 'ok', rB.estado)
  const rC = await correr(C)
  const rD = await correr(D)
  const rE = await correr(E)
  const rF = await correr(F)
  cmp('C, D, E y F analizan', 'ok,ok,ok,ok', [rC, rD, rE, rF].map((r) => r.estado).join(','))

  // Un saliente fallido nunca le llegó al contacto: no es parte de la charla.
  cmp('F: el saliente fallido NO se cuenta como mensaje enviado al modelo', 1, rF.mensajesEnviados)
  let vistoPorModelo = null
  const espia = {
    nombre: 'prueba-espia',
    analizar: (e) => { vistoPorModelo = e.mensajes.map((m) => `${m.autor}:${m.texto}`); return proveedorFalso.analizar(e) },
  }
  // Un reloj propio para saltar el debounce de F sin mover el de las demás.
  await correr(F, { proveedor: espia, completo: true, ahora: () => reloj + 60_000 })
  cmp('F: el proveedor recibió sólo el entrante, no el texto del envío fallido', 'contacto:Hola', (vistoPorModelo ?? []).join('|'))

  const items = async (conv) => (await s.from('whatsapp_ai_items').select('*').eq('conversation_id', conv)).data ?? []
  const resumen = async (conv) => (await s.from('whatsapp_conversation_ai_summary').select('*').eq('conversation_id', conv).single()).data

  const iB = await items(B)
  cmp('B: un pendiente de responder, de la empresa', 'pending/company', iB.map((i) => `${i.type}/${i.actor}`).join(','))
  cmp('B: el resumen marca atención', true, (await resumen(B)).requires_attention)

  const iC = await items(C)
  const compromisoC = iC.find((i) => i.type === 'commitment')
  cmp('C: se detecta el compromiso de la empresa', 'company', compromisoC?.actor)
  const { data: msgC } = await s.from('whatsapp_messages').select('id, ordenado_en').eq('conversation_id', C).eq('direction', 'out').single()
  cmp('C: la fuente es el mensaje real que dice «mañana»', msgC.id, compromisoC?.source_message_ids?.[0])
  const mananaC = new Date(new Date(msgC.ordenado_en).getTime() + 24 * 3600_000)
  const fechaEsperada = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(mananaC)
  cmp('C: el vencimiento es el día siguiente al mensaje', fechaEsperada, compromisoC?.due_at?.slice(0, 10))

  const iD = await items(D)
  cmp('D: la decisión confirmada queda, sin vencimiento', 'decision/null', iD.map((i) => `${i.type}/${i.due_at}`).join(','))
  cmp('E: el ruido no genera ningún ítem', 0, (await items(E)).length)
  cmp('A: una conversación simple ya respondida no genera ítems', 0, (await items(A)).length)

  const sumB = await resumen(B)
  cmp('el checkpoint es el último mensaje analizado', true, sumB.last_analyzed_message_id !== null)
  const { data: runsA } = await s.from('whatsapp_ai_runs').select('status, messages_sent').eq('conversation_id', A)
  cmp('cada análisis deja una corrida medida', 'ok/2', runsA.map((r) => `${r.status}/${r.messages_sent}`).join(','))

  // Debounce e incremental.
  cmp('reanalizar enseguida: «reciente», no llama al proveedor', 'reciente', (await correr(B)).estado)
  reloj += 60_000
  cmp('sin mensajes nuevos: «sin_cambios»', 'sin_cambios', (await correr(B)).estado)
  await saliente(B, 'Sí, tenemos 3 unidades')
  reloj += 60_000
  const rB2 = await correr(B)
  cmp('con un mensaje nuevo: incremental, manda SÓLO ese mensaje', 'ok/1', `${rB2.estado}/${rB2.mensajesEnviados}`)
  cmp('reanalizar no duplicó el pendiente de B', 1, (await items(B)).filter((i) => i.type === 'pending').length)
  cmp('el resumen de B ya no marca atención', false, (await resumen(B)).requires_attention)

  // Un proveedor que inventa una fuente y una fecha.
  const alucina = {
    nombre: 'prueba-alucina',
    analizar: (e) => Promise.resolve({
      modelo: 'prueba-alucina',
      uso: { inputTokens: 10, outputTokens: 5 },
      texto: JSON.stringify({
        summary: 'Resumen de prueba', topics: ['Prueba'], conversation_state: 'en_curso', requires_attention: false,
        items: [
          { type: 'pending', description: 'Llamar al proveedor', actor: 'company', due_at: '2031-01-01', source_message_ids: [e.mensajes[0].alias], confidence: 0.9 },
          { type: 'decision', description: 'Precio aceptado', actor: 'contact', due_at: null, source_message_ids: ['m999'], confidence: 0.95 },
        ],
      }),
    }),
  }
  const rX = await correr(E, { proveedor: alucina, completo: true, ahora: () => (reloj += 60_000) })
  cmp('con una fuente inventada: se guarda lo válido y se descarta el resto', 'ok/1/1', `${rX.estado}/${rX.itemsNuevos}/${rX.itemsDescartados}`)
  const pendE = (await items(E)).find((i) => i.description === 'Llamar al proveedor')
  cmp('la fecha que no estaba escrita no llegó a la base', null, pendE?.due_at)
  cmp('la decisión inventada no llegó a la base', 0, (await items(E)).filter((i) => i.type === 'decision').length)

  // ── 7 · Fallos del proveedor ─────────────────────────────────────────────
  seccion('7 · Fallos del proveedor: no destructivos')

  const antes = await resumen(D)
  const caido = { nombre: 'prueba-caido', analizar: () => Promise.reject(new FalloProveedor('caido', 'x')) }
  await entrante(PHONE_A, '5491100000004', '¿Cuándo llega?', 0.5, 'ZZ D Decisión')
  const rCaido = await correr(D, { proveedor: caido, ahora: () => (reloj += 60_000) })
  cmp('proveedor caído: error con código', 'error/proveedor_caido', `${rCaido.estado}/${rCaido.codigo}`)
  let despues = await resumen(D)
  cmp('el resumen previo sigue intacto', antes.summary, despues.summary)
  cmp('el checkpoint no avanzó', antes.last_analyzed_message_id, despues.last_analyzed_message_id)
  cmp('el estado dice error, con el código', 'error/proveedor_caido', `${despues.status}/${despues.last_error}`)

  const basura = { nombre: 'prueba-basura', analizar: () => Promise.resolve({ texto: '{"summary": "a",', modelo: 'x', uso: { inputTokens: 1, outputTokens: 1 } }) }
  const rBasura = await correr(D, { proveedor: basura, ahora: () => (reloj += 60_000) })
  cmp('JSON malformado: error, sin tocar el resumen', 'error/salida_json_invalido', `${rBasura.estado}/${rBasura.codigo}`)
  cmp('después de dos fallos el resumen sigue siendo el primero', antes.summary, (await resumen(D)).summary)

  const rRecupera = await correr(D, { ahora: () => (reloj += 60_000) })
  cmp('el próximo análisis bueno recupera el mensaje que no se analizó', 'ok/1', `${rRecupera.estado}/${rRecupera.mensajesEnviados}`)
  cmp('y el estado vuelve a ok', 'ok', (await resumen(D)).status)
  const { data: runsD } = await s.from('whatsapp_ai_runs').select('status, error_code').eq('conversation_id', D).order('created_at')
  cmp('las corridas registran los dos fallos', 'ok,error,error,ok', runsD.map((r) => r.status).join(','))

  // ── 4 · guardar_analisis ─────────────────────────────────────────────────
  seccion('4 · guardar_analisis_whatsapp: validación en la base')

  const { data: msgsA } = await s.from('whatsapp_messages').select('id').eq('conversation_id', A).order('ordenado_en', { ascending: false })
  const { data: msgB } = await s.from('whatsapp_messages').select('id').eq('conversation_id', B).limit(1).single()
  const ultimoA = msgsA[0].id
  const guardar = (resultado, hasta = ultimoA, cliente_ = s) => cliente_.rpc('guardar_analisis_whatsapp', {
    p_conversacion: A, p_hasta_mensaje: hasta, p_resultado: resultado, p_modelo: 'prueba', p_metricas: {},
  })
  const itemCon = (fuentes, extra = {}) => ({
    summary: 'x', topics: [], conversation_state: 'en_curso', requires_attention: false,
    items: [{ type: 'pending', actor: 'company', description: 'ZZ prueba', source_message_ids: fuentes, confidence: 0.9, due_at: null, ...extra }],
  })

  rechaza('una fuente que no existe', await guardar(itemCon([randomUUID()])), 'FUENTE_INVALIDA')
  rechaza('una fuente de OTRA conversación', await guardar(itemCon([msgB.id])), 'FUENTE_INVALIDA')
  rechaza('un ítem sin fuentes', await guardar(itemCon([])), 'ITEM_SIN_FUENTE')
  rechaza('un tipo desconocido', await guardar(itemCon([ultimoA], { type: 'tarea' })), 'ITEM_INVALIDO')
  rechaza('una confianza fuera de rango', await guardar(itemCon([ultimoA], { confidence: 1.5 })), 'ITEM_INVALIDO')
  rechaza('un checkpoint de otra conversación', await guardar(itemCon([ultimoA]), msgB.id), 'CHECKPOINT_INVALIDO')
  rechaza('un estado de conversación inventado', await guardar({ summary: 'x', conversation_state: 'urgente', items: [] }), 'RESULTADO_INVALIDO')
  rechaza('un checkpoint ANTERIOR al último análisis', await guardar(itemCon([ultimoA]), msgsA[msgsA.length - 1].id), 'ANALISIS_OBSOLETO')

  // Un mensaje borrado ya no sirve de fuente.
  const borrable = (await entrante(PHONE_A, '5491100000001', 'ZZ mensaje que se borra', 0.1, 'ZZ A Simple')).message_id
    ?? (await s.from('whatsapp_messages').select('id').eq('conversation_id', A).order('ordenado_en', { ascending: false }).limit(1).single()).data.id
  ok(await s.from('whatsapp_messages').delete().eq('id', borrable), 'borrar mensaje')
  rechaza('una fuente de un mensaje borrado', await guardar(itemCon([borrable])), 'FUENTE_INVALIDA')
  const { count: itemsFantasma } = await s.from('whatsapp_ai_items').select('*', { count: 'exact', head: true }).eq('description', 'ZZ prueba')
  cmp('ninguno de los rechazos dejó un ítem a medias', 0, itemsFantasma)

  // ── 5 · Idempotencia ─────────────────────────────────────────────────────
  seccion('5 · Idempotencia y resolución')

  const valido = itemCon([ultimoA], { description: 'ZZ Llamar para confirmar' })
  const g1 = ok(await guardar(valido), 'guardar 1')
  const g2 = ok(await guardar(valido), 'guardar 2')
  cmp('primer guardado: un ítem nuevo', 1, g1.items_nuevos)
  cmp('segundo guardado igual: cero nuevos, uno repetido', '0/1', `${g2.items_nuevos}/${g2.items_repetidos}`)
  const g3 = ok(await guardar(itemCon([ultimoA], { description: '  zz LLAMAR para confirmar!! ' })), 'guardar 3')
  cmp('la misma descripción con otra puntuación y mayúsculas: repetido', 0, g3.items_nuevos)

  const { data: llamar } = await s.from('whatsapp_ai_items').select('id').eq('conversation_id', A).eq('description', 'ZZ Llamar para confirmar').single()
  ok(await admin.c.rpc('resolver_item_ia_whatsapp', { p_item: llamar.id, p_estado: 'resolved' }), 'resolver')
  ok(await guardar(valido), 'guardar 4')
  const { data: sigue } = await s.from('whatsapp_ai_items').select('status, resolved_by').eq('id', llamar.id).single()
  cmp('reanalizar NO reabre lo que una persona resolvió', 'resolved', sigue.status)
  cmp('y queda quién lo resolvió', admin.id, sigue.resolved_by)

  // ── 2 · RLS de lectura ───────────────────────────────────────────────────
  seccion('2 · RLS: quién lee lo que dijo la IA')

  const lee = async (u, tabla, conv) => ((await u.from(tabla).select('conversation_id').eq('conversation_id', conv)).data ?? []).length
  cmp('admin lee el resumen de B', 1, await lee(admin.c, 'whatsapp_conversation_ai_summary', B))
  cmp('employee lee el resumen de B', 1, await lee(employee.c, 'whatsapp_conversation_ai_summary', B))
  cmp('el vendedor ASIGNADO lee el resumen y los ítems de B', '1/true', `${await lee(vend1.c, 'whatsapp_conversation_ai_summary', B)}/${(await lee(vend1.c, 'whatsapp_ai_items', B)) > 0}`)
  cmp('el vendedor asignado NO lee la IA de C, que no es suya', '0/0', `${await lee(vend1.c, 'whatsapp_conversation_ai_summary', C)}/${await lee(vend1.c, 'whatsapp_ai_items', C)}`)
  cmp('un vendedor sin asignaciones no lee nada', '0/0', `${await lee(vend2.c, 'whatsapp_conversation_ai_summary', B)}/${await lee(vend2.c, 'whatsapp_ai_items', B)}`)
  cmp('el técnico no lee nada', '0/0', `${await lee(tech.c, 'whatsapp_conversation_ai_summary', B)}/${await lee(tech.c, 'whatsapp_ai_items', B)}`)
  cmp('el cliente del portal no lee nada', '0/0', `${await lee(portal.c, 'whatsapp_conversation_ai_summary', B)}/${await lee(portal.c, 'whatsapp_ai_items', B)}`)
  cmp('el admin de OTRA empresa no lee nada', '0/0', `${await lee(adminB.c, 'whatsapp_conversation_ai_summary', B)}/${await lee(adminB.c, 'whatsapp_ai_items', B)}`)
  const { data: anonLee, error: anonErr } = await anon.from('whatsapp_ai_items').select('id').limit(1)
  cmp('anon no lee nada', true, !!anonErr || (anonLee ?? []).length === 0)

  const corridas = async (u) => ((await u.from('whatsapp_ai_runs').select('id').eq('company_id', empresa.id)).data ?? []).length
  cmp('las corridas (costo) las ve el admin', true, (await corridas(admin.c)) > 0)
  cmp('el vendedor asignado NO ve las corridas', 0, await corridas(vend1.c))
  cmp('el admin de otra empresa NO ve las corridas', 0, await corridas(adminB.c))

  // ── 3 · Nadie escribe directo ────────────────────────────────────────────
  seccion('3 · Escrituras: sólo por RPC, y las de servidor sólo el servidor')

  rechaza('el admin NO inserta un ítem a mano', await admin.c.from('whatsapp_ai_items').insert({
    company_id: empresa.id, conversation_id: B, type: 'pending', description: 'x',
    source_message_ids: [msgB.id], confidence: 1, fingerprint: 'x',
  }))
  const upd = await admin.c.from('whatsapp_ai_items').update({ description: 'ZZ pisado' }).eq('conversation_id', B).select('id')
  cmp('el admin NO modifica un ítem a mano', true, !!upd.error || (upd.data ?? []).length === 0)
  const del = await admin.c.from('whatsapp_conversation_ai_summary').delete().eq('conversation_id', B).select('conversation_id')
  cmp('el admin NO borra un resumen a mano', true, !!del.error || (del.data ?? []).length === 0)
  cmp('el resumen de B sigue ahí', 1, await lee(s, 'whatsapp_conversation_ai_summary', B))

  rechaza('el admin NO llama guardar_analisis (es de servidor)', await guardar(valido, ultimoA, admin.c))
  rechaza('el admin NO llama registrar_corrida (es de servidor)', await admin.c.rpc('registrar_corrida_ia_whatsapp', {
    p_conversacion: B, p_estado: 'error', p_error_code: 'x', p_modelo: 'x', p_metricas: {},
  }))
  rechaza('anon NO llama guardar_analisis', await guardar(valido, ultimoA, anon))

  // ── 8 · Resolver ─────────────────────────────────────────────────────────
  seccion('8 · Resolver o descartar una sugerencia')

  const pendB = (await items(B)).find((i) => i.type === 'pending')
  const pendC = compromisoC
  rechaza('un estado inventado', await admin.c.rpc('resolver_item_ia_whatsapp', { p_item: pendB.id, p_estado: 'hecho' }), 'ESTADO_INVALIDO')
  rechaza('el vendedor NO resuelve un ítem de una conversación que no ve', await vend1.c.rpc('resolver_item_ia_whatsapp', { p_item: pendC.id, p_estado: 'dismissed' }), 'ITEM_INEXISTENTE')
  rechaza('el admin de otra empresa tampoco', await adminB.c.rpc('resolver_item_ia_whatsapp', { p_item: pendB.id, p_estado: 'dismissed' }), 'ITEM_INEXISTENTE')
  rechaza('un ítem que no existe da el MISMO error', await admin.c.rpc('resolver_item_ia_whatsapp', { p_item: randomUUID(), p_estado: 'resolved' }), 'ITEM_INEXISTENTE')
  rechaza('anon tampoco', await anon.rpc('resolver_item_ia_whatsapp', { p_item: pendB.id, p_estado: 'resolved' }))
  ok(await vend1.c.rpc('resolver_item_ia_whatsapp', { p_item: pendB.id, p_estado: 'dismissed' }), 'vend1 descarta')
  cmp('el vendedor asignado SÍ descarta lo de su conversación', 'dismissed', (await s.from('whatsapp_ai_items').select('status').eq('id', pendB.id).single()).data.status)
  ok(await vend1.c.rpc('resolver_item_ia_whatsapp', { p_item: pendB.id, p_estado: 'open' }), 'reabrir')
  const { data: reab } = await s.from('whatsapp_ai_items').select('status, resolved_at, resolved_by').eq('id', pendB.id).single()
  cmp('reabrir limpia la resolución', 'open/null/null', `${reab.status}/${reab.resolved_at}/${reab.resolved_by}`)
  const { data: cDespues } = await s.from('whatsapp_conversations').select('assigned_to, customer_id').eq('id', B).single()
  cmp('resolver no tocó la asignación ni el cliente de la conversación', `${vend1.id}/null`, `${cDespues.assigned_to}/${cDespues.customer_id}`)

  // ── 9 · Señales de atención ──────────────────────────────────────────────
  seccion('9 · Señales de atención: reglas + IA')

  // Una conversación nueva con una pregunta vieja, sin análisis: sólo reglas.
  const G = (await entrante(PHONE_A, '5491100000008', '¿Me pasan el precio?', 6, 'ZZ G Sin análisis')).conversation_id
  const senales = async (u, ids) => {
    const { data, error } = await u.rpc('senales_atencion_whatsapp', { p_conversaciones: ids, p_horas: 4 })
    if (error) return { error }
    return Object.fromEntries((data ?? []).map((r) => [r.conversation_id, [...r.motivos].sort().join(',')]))
  }
  const sAdmin = await senales(admin.c, [A, B, C, E, F, G])
  cmp('G: sin análisis, las reglas solas detectan pregunta, demora y sin respuesta', 'demora,pregunta,sin_respuesta', sAdmin[G])
  cmp('F: el envío fallido se marca', true, (sAdmin[F] ?? '').includes('error_envio'))
  cmp('C: el compromiso abierto de la empresa se marca', true, (sAdmin[C] ?? '').includes('pendiente_abierto'))
  cmp('B: respondida y con el pendiente abierto, queda sólo el pendiente', 'pendiente_abierto', sAdmin[B])
  cmp('A: respondida y sin pendientes, sin señales', '', sAdmin[A])
  const sVend = await senales(vend1.c, [A, B, C, G])
  cmp('el vendedor sólo recibe las señales de lo que ve', B, Object.keys(sVend).join(','))
  const sB = await senales(adminB.c, [A, B, C, G])
  cmp('el admin de otra empresa no recibe nada', 0, Object.keys(sB).length)

  // ── 10 · Informe ─────────────────────────────────────────────────────────
  seccion('10 · Informe por período')

  // Vencimientos: un día escrito vence cuando termina ESE día en Argentina,
  // no a medianoche UTC (las 21 h del día anterior).
  const diaAR = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(ms))
  ok(await guardar(itemCon([ultimoA], { type: 'commitment', description: 'ZZ vencía ayer', due_at: diaAR(Date.now() - 86_400_000) })), 'vence ayer')
  ok(await guardar(itemCon([ultimoA], { type: 'commitment', description: 'ZZ vence hoy', due_at: diaAR(Date.now()) })), 'vence hoy')

  const desde = hace(24)
  const hasta = new Date(Date.now() + 60_000).toISOString()
  const itemsAntes = await cuenta('whatsapp_ai_items')
  const runsAntes = await cuenta('whatsapp_ai_runs')

  const infAdmin = ok(await admin.c.rpc('informe_whatsapp', { p_company: empresa.id, p_desde: desde, p_hasta: hasta }), 'informe admin')
  cmp('el admin ve las 7 conversaciones activas de su empresa', 7, infAdmin.totales.conversaciones_activas)
  cmp('los errores de envío del período', 1, infAdmin.totales.errores_envio)
  cmp('una decisión en el período', 1, infAdmin.totales.decisiones)
  cmp('vencido sólo el de ayer: el de hoy y el de mañana todavía no', 1, infAdmin.totales.compromisos_vencidos)
  cmp('la conversación de otra empresa no aparece', false, infAdmin.conversaciones.some((c) => c.id === XB))
  cmp('todos los ítems son de su empresa', true, infAdmin.items.every((i) => [A, B, C, D, E, F, G].includes(i.conversation_id)))
  cmp('por asignado: sólo cuenta conversaciones, sin puntajes', true, infAdmin.por_asignado.every((p) => Object.keys(p).sort().join(',') === 'asignado,asignado_id,conversaciones'))

  const infVend = ok(await vend1.c.rpc('informe_whatsapp', { p_company: empresa.id, p_desde: desde, p_hasta: hasta }), 'informe vend1')
  cmp('el vendedor obtiene el informe de SU conversación, no el de la empresa', B, infVend.conversaciones.map((c) => c.id).join(','))
  cmp('y sus ítems son sólo de B', true, infVend.items.every((i) => i.conversation_id === B))

  rechaza('el admin de otra empresa no pide el informe de ésta', await adminB.c.rpc('informe_whatsapp', { p_company: empresa.id, p_desde: desde, p_hasta: hasta }), 'SIN_PERMISO')
  rechaza('el técnico no pide informes', await tech.c.rpc('informe_whatsapp', { p_company: empresa.id, p_desde: desde, p_hasta: hasta }), 'SIN_PERMISO')
  rechaza('el cliente del portal tampoco', await portal.c.rpc('informe_whatsapp', { p_company: empresa.id, p_desde: desde, p_hasta: hasta }), 'SIN_PERMISO')
  rechaza('anon tampoco', await anon.rpc('informe_whatsapp', { p_company: empresa.id, p_desde: desde, p_hasta: hasta }))
  rechaza('un período de más de 31 días', await admin.c.rpc('informe_whatsapp', { p_company: empresa.id, p_desde: hace(24 * 40), p_hasta: hasta }), 'PERIODO_INVALIDO')
  rechaza('un período al revés', await admin.c.rpc('informe_whatsapp', { p_company: empresa.id, p_desde: hasta, p_hasta: desde }), 'PERIODO_INVALIDO')

  ok(await admin.c.rpc('informe_whatsapp', { p_company: empresa.id, p_desde: desde, p_hasta: hasta }), 'informe repetido')
  cmp('pedir el informe no escribe ítems ni corridas', `${itemsAntes}/${runsAntes}`, `${await cuenta('whatsapp_ai_items')}/${await cuenta('whatsapp_ai_runs')}`)

  // ── 11 · Limpieza ────────────────────────────────────────────────────────
  seccion('11 · Limpieza e invariantes')
  await limpiar()
  creados.empresas = []
  for (const t of TABLAS) cmp(`${t} vuelve a su conteo`, base[t], await cuenta(t))
  const { count: zz } = await s.from('companies').select('id', { count: 'exact', head: true }).like('slug', `${MARCA}-%`)
  cmp('no queda ninguna empresa de prueba', 0, zz)
  const { data: us } = await s.auth.admin.listUsers({ perPage: 1000 })
  cmp('no queda ningún usuario de prueba', 0, (us?.users ?? []).filter((u) => u.email?.startsWith(`${MARCA}-`)).length)

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
