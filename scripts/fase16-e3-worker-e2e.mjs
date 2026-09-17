/**
 * Fase 16 · WhatsApp — Entrega 3: prueba de punta a punta del scheduler.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase16-e3-worker-e2e.mjs
 *
 * pg_cron → pg_net → Edge Function `whatsapp-ai-worker` (desplegada) → cola.
 *
 * SIN llamar a ningún proveedor: la empresa de fixture tiene los DOS límites
 * diarios ya alcanzados antes de que exista el trabajo. El worker real tiene que
 * tomarlo, pasar por las guardas y dejarlo en `limit_reached` con una corrida
 * `omitido`, sin mensajes enviados. Si algo de eso no pasa, la prueba falla.
 *
 * También: el endpoint rechaza tokens inventados y métodos que no son POST.
 */
import { createClient } from '@supabase/supabase-js'

const BASE = process.env.VITE_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !SECRET) { console.error('✗ Faltan variables de entorno'); process.exit(1) }

const s = createClient(BASE, SECRET, { auth: { persistSession: false } })
const MARCA = 'zz-w16e3e2e'
const WABA = '1499762661645319'
let fallos = 0
const cmp = (t, esperado, real) => {
  if (String(esperado) === String(real)) console.log(`    PASS  ${t} — ${real}`)
  else { fallos++; console.log(`    FAIL  ${t} — esperaba ${esperado}, dio ${real}`) }
}
const ok = (r, q) => { if (r.error) throw new Error(`${q}: ${r.error.message}`); return r.data }
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

const limpiar = async () => {
  const { data } = await s.from('companies').select('id').like('slug', `${MARCA}-%`)
  const ids = (data ?? []).map((x) => x.id)
  if (!ids.length) return
  for (const t of ['whatsapp_ai_analysis_queue', 'whatsapp_ai_settings', 'whatsapp_ai_runs', 'whatsapp_ai_items',
    'whatsapp_conversation_ai_summary', 'whatsapp_messages', 'whatsapp_conversations', 'whatsapp_accounts']) {
    await s.from(t).delete().in('company_id', ids)
  }
  await s.from('companies').delete().in('id', ids)
}

async function main() {
  console.log('='.repeat(78))
  console.log('  FASE 16 · WhatsApp E3 — scheduler + worker de punta a punta (sin proveedor)')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(78))
  await limpiar()

  const url = `${BASE}/functions/v1/whatsapp-ai-worker`
  cmp('GET al worker: 405', 405, (await fetch(url)).status)
  cmp('POST sin token: 401', 401, (await fetch(url, { method: 'POST', body: '{}' })).status)
  cmp('POST con token inventado: 401', 401, (await fetch(url, { method: 'POST', headers: { 'x-worker-token': 'zz-inventado' }, body: '{}' })).status)

  const sello = Date.now()
  const empresa = ok(await s.from('companies').insert({
    slug: `${MARCA}-${sello}`, name: 'ZZ W16E3 E2E', legal_name: 'ZZ W16E3 E2E SA', default_currency: 'ARS',
  }).select('id').single(), 'empresa')
  const phone = `${MARCA}-${sello}`
  ok(await s.from('whatsapp_accounts').insert({
    company_id: empresa.id, waba_id: WABA, phone_number_id: phone,
    display_phone_number: '+54 9 11 0000-0009', display_name: 'ZZ E2E', active: true,
  }), 'cuenta')
  // Primero la IA habilitada SIN automática: el primer mensaje no encola.
  ok(await s.from('whatsapp_ai_settings').insert({
    company_id: empresa.id, enabled: true, auto_analyze: false, analysis_debounce_seconds: 30,
    max_daily_analyses: 1, max_daily_cost_usd: 0.0001,
  }), 'settings')
  const entrante = async (n, texto) => ok(await s.rpc('registrar_entrante_whatsapp', {
    p_phone_number_id: phone, p_waba_id: WABA, p_wa_id: '5491100000999', p_profile_name: 'ZZ E2E',
    p_provider_message_id: `wamid.${MARCA}.${sello}.${n}`, p_tipo: 'text', p_texto: texto,
    p_caption: null, p_reply_to: null, p_timestamp: new Date().toISOString(), p_media: null,
  }), `entrante ${n}`)
  const conv = (await entrante(1, 'ZZ prueba de scheduler, no analizar')).conversation_id
  // Los dos límites alcanzados ANTES de que haya trabajo.
  ok(await s.from('whatsapp_ai_runs').insert({
    company_id: empresa.id, conversation_id: conv, status: 'error', error_code: 'zz_limite_e2e',
    model: 'zz', provider: 'zz', messages_sent: 1, estimated_cost_usd: 0.001,
  }), 'corrida de límite')
  const uso = ok(await s.rpc('verificar_uso_ia_whatsapp', { p_conversacion: conv }), 'uso')
  cmp('guarda previa: no permitido', 'false', String(uso.permitido))
  ok(await s.from('whatsapp_ai_settings').update({ auto_analyze: true }).eq('company_id', empresa.id), 'automática')
  await entrante(2, 'ZZ segundo mensaje de la prueba')
  const t0 = (await s.from('whatsapp_ai_analysis_queue').select('*').eq('conversation_id', conv).single()).data
  cmp('trabajo encolado con debounce de 30 s', 'pending', t0.status)
  console.log(`    esperando al cron (not_before ${t0.not_before})…`)

  let t = t0
  const limite = Date.now() + 6 * 60_000
  while (Date.now() < limite) {
    await esperar(15_000)
    t = (await s.from('whatsapp_ai_analysis_queue').select('*').eq('conversation_id', conv).single()).data
    if (t.last_error === 'limit_reached' || t.status === 'failed' || t.status === 'done') break
  }
  cmp('el worker real tomó el trabajo y lo dejó en límite', 'pending:limit_reached', `${t.status}:${t.last_error}`)
  const { data: corridas } = await s.from('whatsapp_ai_runs').select('status, error_code, messages_sent, provider').eq('conversation_id', conv).order('created_at')
  cmp('una corrida omitida del worker (sin persona)', true, corridas.some((c) => c.status === 'omitido' && c.error_code?.startsWith('limite_')))
  cmp('NINGUNA corrida del worker envió mensajes a un proveedor', 0, corridas.filter((c) => c.error_code !== 'zz_limite_e2e' && c.messages_sent > 0).length)
  cmp('el proveedor configurado quedó registrado en la corrida omitida', true, corridas.some((c) => c.status === 'omitido' && c.provider === 'openai'))

  await limpiar()
  cmp('limpieza', 0, (await s.from('companies').select('id').like('slug', `${MARCA}-%`)).data.length)
}

main()
  .catch(async (e) => { fallos++; console.log(`\n  EXCEPCIÓN: ${e.message}`); await limpiar().catch(() => {}) })
  .finally(() => {
    console.log('\n' + '='.repeat(78))
    console.log(`  RESULTADO: ${fallos} FALLOS`)
    console.log('='.repeat(78))
    process.exit(fallos ? 1 : 0)
  })
