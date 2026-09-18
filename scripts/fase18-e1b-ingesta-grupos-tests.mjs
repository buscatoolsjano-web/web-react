/**
 * Fase 18 · E1B — las RPC de ingesta de grupos.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase18-e1b-ingesta-grupos-tests.mjs
 *
 * Lo que prueba, midiendo el EFECTO:
 *   1. la allowlist se aplica EN EL SERVIDOR, no sólo en el listener
 *   2. idempotencia: el mismo provider_message_id dos veces deja UNA fila
 *   3. el saliente observado entra sin client_request_id
 *   4. ediciones y borrados apuntan al mensaje original
 *   5. los participantes se registran por escribir
 *   6. una cuenta que no existe no escribe nada
 *   7. la IA no se encola si el grupo no tiene ai_enabled
 *   8. producción intacta
 *
 * Usa una empresa y una cuenta zz- propias: NO toca el grupo piloto real ni
 * la cuenta del 2186. Todo se borra al final.
 */
import { createClient } from '@supabase/supabase-js'

const BASE = process.env.VITE_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !SECRET) { console.error('✗ Faltan variables de entorno'); process.exit(1) }

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(70)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const cmp = (t, esperado, real) =>
  String(esperado) === String(real) ? PASS(t, String(real)) : FAIL(t, `esperaba ${esperado}, dio ${real}`)

const s = createClient(BASE, SECRET, { auth: { persistSession: false } })
const ok = (r, q) => { if (r.error) throw new Error(`${q}: ${r.error.message}`); return r.data }

const MARCA = 'zz-e1b'
const creados = { empresas: [] }
const GRUPO = '120363999999999999@g.us'
const JUAN = '5491111111111@s.whatsapp.net'
const JANO = '5492222222222@s.whatsapp.net'

const limpiar = async () => {
  const ids = creados.empresas
  if (!ids.length) return
  const borrar = async (t) => {
    const r = await s.from(t).delete().in('company_id', ids)
    if (r.error) console.log(`    aviso ${t}: ${r.error.message.slice(0, 110)}`)
  }
  await borrar('whatsapp_ai_analysis_queue')
  await borrar('whatsapp_messages')
  await borrar('whatsapp_media')
  await borrar('whatsapp_conversation_participants')
  await borrar('whatsapp_conversations')
  await borrar('whatsapp_group_allowlist')
  await borrar('whatsapp_accounts')
  await borrar('whatsapp_ai_settings')
  const r = await s.from('companies').delete().in('id', ids)
  if (r.error) console.log(`    aviso companies: ${r.error.message.slice(0, 120)}`)
}

const barrerRestos = async () => {
  const { data } = await s.from('companies').select('id').like('slug', `${MARCA}-%`)
  creados.empresas = (data ?? []).map((x) => x.id)
  if (creados.empresas.length) { console.log(`  barriendo ${creados.empresas.length} empresa(s) anterior(es)`); await limpiar() }
  creados.empresas = []
}

/** Un mensaje de grupo, con los valores por defecto del listener. */
const ingresar = (cuenta, cambios = {}) =>
  s.rpc('ingresar_mensaje_grupo_whatsapp', {
    p_account: cuenta,
    p_group_id: GRUPO,
    p_group_name: 'ZZ Grupo De Prueba',
    p_provider_message_id: `ZZMSG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    p_sender_wa_id: JUAN,
    p_sender_name: 'ZZ Juan',
    p_direction: 'in',
    p_sent_at: new Date().toISOString(),
    p_message_type: 'texto',
    p_text: 'zz texto de prueba',
    p_reply_to: null,
    p_media: null,
    ...cambios,
  })

async function main() {
  console.log('\n═══ Fase 18 · E1B — ingesta de grupos ═══')
  await barrerRestos()

  const prodIds = (await s.from('companies').select('id').not('slug', 'like', 'zz-%')).data.map((c) => c.id)
  const cuenta = async (t) => (await s.from(t).select('*', { count: 'exact', head: true }).in('company_id', prodIds)).count
  const antes = {
    mensajes: await cuenta('whatsapp_messages'),
    conversaciones: await cuenta('whatsapp_conversations'),
    allowlist: await cuenta('whatsapp_group_allowlist'),
  }
  console.log(`  baseline producción: ${JSON.stringify(antes)}`)

  // ── Fixture ──────────────────────────────────────────────────────────────
  const sello = Date.now()
  const empresa = ok(await s.from('companies').insert({
    slug: `${MARCA}-${sello}`, name: 'ZZ E1B', legal_name: 'ZZ E1B SA', default_currency: 'USD',
  }).select('id').single(), 'empresa').id
  creados.empresas.push(empresa)

  const cta = ok(await s.from('whatsapp_accounts').insert({
    company_id: empresa, provider: 'whatsapp_multidevice',
    display_phone_number: '+54 9 11 0000-0000', display_name: 'ZZ Listener', active: true,
  }).select('id').single(), 'cuenta').id

  const filas = async (t, filtro = (q) => q) =>
    (await filtro(s.from(t).select('*', { count: 'exact', head: true }).eq('company_id', empresa))).count

  // ── 1 · La allowlist, del lado del servidor ──────────────────────────────
  seccion('1 · Sin allowlist no entra nada, aunque el listener lo pida')
  const sinPermiso = ok(await ingresar(cta), 'sin allowlist')
  cmp('la RPC lo rechaza', 'grupo_no_autorizado', sinPermiso.estado)
  cmp('y no deja ni una fila', 0, await filas('whatsapp_messages'))
  cmp('ni una conversación', 0, await filas('whatsapp_conversations'))

  ok(await s.from('whatsapp_group_allowlist').insert({
    company_id: empresa, account_id: cta, provider_group_id: GRUPO,
    group_name: 'ZZ Grupo De Prueba', enabled: true, ai_enabled: false,
  }), 'allowlist')

  // ── 2 · Idempotencia ─────────────────────────────────────────────────────
  seccion('2 · El mismo mensaje dos veces deja UNA fila')
  const id = `ZZMSG-IDEM-${sello}`
  const primera = ok(await ingresar(cta, { p_provider_message_id: id }), 'primera')
  const segunda = ok(await ingresar(cta, { p_provider_message_id: id }), 'segunda')
  cmp('la primera guarda', 'guardado', primera.estado)
  cmp('la segunda dice duplicado', 'duplicado', segunda.estado)
  cmp('y hay UNA sola fila', 1, await filas('whatsapp_messages'))
  cmp('la conversación es la misma', primera.conversacion_id, segunda.conversacion_id)

  // Diez veces en paralelo, que es lo que pasa en un reconnect.
  const rafaga = `ZZMSG-RAFAGA-${sello}`
  await Promise.all(Array.from({ length: 10 }, () => ingresar(cta, { p_provider_message_id: rafaga })))
  cmp('diez llamadas simultáneas del mismo mensaje dejan una fila', 2, await filas('whatsapp_messages'))

  // ── 3 · El saliente observado ────────────────────────────────────────────
  seccion('3 · Un mensaje propio observado entra sin client_request_id')
  const propio = ok(await ingresar(cta, {
    p_provider_message_id: `ZZMSG-OUT-${sello}`, p_direction: 'out', p_sender_wa_id: '5490000000000@s.whatsapp.net',
  }), 'saliente')
  cmp('se guarda', 'guardado', propio.estado)
  const fOut = ok(await s.from('whatsapp_messages').select('direction, client_request_id, status, sent_at')
    .eq('id', propio.mensaje_id).single(), 'leer saliente')
  cmp('queda como out', 'out', fOut.direction)
  cmp('sin client_request_id', true, fOut.client_request_id === null)
  cmp('con estado sent y sello de envío', true, fOut.status === 'sent' && fOut.sent_at !== null)

  // ── 4 · Respuestas, ediciones y borrados ─────────────────────────────────
  seccion('4 · Responder, editar y borrar')
  const original = `ZZMSG-ORIG-${sello}`
  ok(await ingresar(cta, { p_provider_message_id: original, p_text: 'zz original' }), 'original')
  const respuesta = ok(await ingresar(cta, {
    p_provider_message_id: `ZZMSG-RESP-${sello}`, p_reply_to: original, p_sender_wa_id: JANO, p_sender_name: 'ZZ Jano',
  }), 'respuesta')
  const fResp = ok(await s.from('whatsapp_messages').select('reply_to_provider_id').eq('id', respuesta.mensaje_id).single(), 'leer respuesta')
  cmp('la respuesta apunta al original', original, fResp.reply_to_provider_id)

  const edicion = ok(await s.rpc('editar_mensaje_grupo_whatsapp', {
    p_account: cta, p_provider_message_id: original,
    p_text: 'zz corregido', p_edited_at: new Date().toISOString(),
  }), 'editar')
  cmp('la edición se aplica', 'aplicada', edicion.estado)
  const fEdit = ok(await s.from('whatsapp_messages').select('text_body, edited_at').eq('provider_message_id', original).single(), 'leer editado')
  cmp('cambió el texto del mismo mensaje', 'zz corregido', fEdit.text_body)
  cmp('y quedó el sello de edición', true, fEdit.edited_at !== null)

  const fantasma = ok(await s.rpc('editar_mensaje_grupo_whatsapp', {
    p_account: cta, p_provider_message_id: 'ZZMSG-QUE-NO-EXISTE',
    p_text: 'zz', p_edited_at: new Date().toISOString(),
  }), 'editar inexistente')
  cmp('editar algo que nunca entró no crea nada', 'sin_efecto', fantasma.estado)

  const borrado = ok(await s.rpc('borrar_mensaje_grupo_whatsapp', {
    p_account: cta, p_provider_message_id: original,
    p_deleted_by: JUAN, p_deleted_at: new Date().toISOString(),
  }), 'borrar')
  cmp('el borrado se aplica', 'aplicada', borrado.estado)
  const fBorr = ok(await s.from('whatsapp_messages').select('deleted_at, deleted_by_wa_id, text_body')
    .eq('provider_message_id', original).single(), 'leer borrado')
  cmp('se MARCA, no se borra la fila', true, fBorr.deleted_at !== null)
  cmp('y el texto sigue ahí: ocultarlo es decisión de la pantalla', 'zz corregido', fBorr.text_body)
  cmp('con quién lo borró', JUAN, fBorr.deleted_by_wa_id)

  const reBorrado = ok(await s.rpc('borrar_mensaje_grupo_whatsapp', {
    p_account: cta, p_provider_message_id: original, p_deleted_by: JUAN, p_deleted_at: new Date().toISOString(),
  }), 'reborrar')
  cmp('borrar dos veces no vuelve a marcar', 'sin_efecto', reBorrado.estado)

  // ── 5 · Participantes ────────────────────────────────────────────────────
  seccion('5 · Quiénes escribieron')
  // Tres, no dos: Juan, Jano y LA PROPIA CUENTA, que escribió el saliente del
  // § 3. La cuenta vinculada es un participante más del grupo, y registrarla
  // es lo correcto: sus mensajes también tienen autor.
  cmp('hay un participante por autor, incluida la cuenta propia', 3,
    await filas('whatsapp_conversation_participants'))
  const p = ok(await s.from('whatsapp_conversation_participants').select('wa_id, display_name')
    .eq('company_id', empresa).eq('wa_id', JANO).single(), 'participante')
  cmp('con su nombre visible como snapshot', 'ZZ Jano', p.display_name)

  // ── 6 · Una cuenta que no existe ─────────────────────────────────────────
  seccion('6 · Cuenta desconocida')
  const ajena = ok(await ingresar('00000000-0000-0000-0000-000000000000'), 'cuenta inventada')
  cmp('la RPC lo rechaza', 'cuenta_desconocida', ajena.estado)

  // ── 7 · La IA no se encola sin permiso ───────────────────────────────────
  seccion('7 · Guardar y analizar son dos permisos distintos')
  ok(await s.from('whatsapp_ai_settings').insert({
    company_id: empresa, enabled: true, auto_analyze: true, analysis_debounce_seconds: 60,
  }), 'settings')
  ok(await ingresar(cta, { p_provider_message_id: `ZZMSG-IA1-${sello}` }), 'mensaje con IA encendida')
  cmp('con ai_enabled=false NO se encola', 0, await filas('whatsapp_ai_analysis_queue'))

  ok(await s.from('whatsapp_group_allowlist').update({ ai_enabled: true })
    .eq('company_id', empresa).eq('provider_group_id', GRUPO), 'habilitar ia')
  ok(await ingresar(cta, { p_provider_message_id: `ZZMSG-IA2-${sello}` }), 'mensaje con grupo ai_enabled')
  cmp('con ai_enabled=true SÍ se encola', 1, await filas('whatsapp_ai_analysis_queue'))

  // Y el debounce: diez mensajes seguidos siguen siendo UN trabajo.
  for (let i = 0; i < 10; i += 1) {
    ok(await ingresar(cta, { p_provider_message_id: `ZZMSG-DEB-${sello}-${i}` }), `rafaga ${i}`)
  }
  cmp('diez mensajes seguidos siguen siendo UN trabajo', 1, await filas('whatsapp_ai_analysis_queue'))

  // ── 8 · Producción ───────────────────────────────────────────────────────
  seccion('8 · Producción')
  const despues = {
    mensajes: await cuenta('whatsapp_messages'),
    conversaciones: await cuenta('whatsapp_conversations'),
    allowlist: await cuenta('whatsapp_group_allowlist'),
  }
  cmp('el baseline de producción no se movió', JSON.stringify(antes), JSON.stringify(despues))
}

main()
  .catch((e) => { fallos++; console.error(`\n  ERROR: ${e.message}`) })
  .finally(async () => {
    await limpiar()
    console.log(fallos === 0 ? '\n  ✓ TODO EN VERDE\n' : `\n  ✗ ${fallos} FALLO(S)\n`)
    process.exit(fallos === 0 ? 0 : 1)
  })
