/**
 * Fase 16 · WhatsApp — Entrega 3: automatización controlada.
 * Las reglas que sólo se pueden probar contra la base.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node --experimental-strip-types scripts/fase16-e3-whatsapp-automatizacion-tests.mjs
 *
 * El worker se ejecuta con el MISMO código que la Edge Function (`lote.ts` +
 * `analisis.ts`) y proveedores FALSOS armados acá. Ni un byte sale a un tercero.
 *
 * Seguridad de la suite frente al worker REAL (pg_cron cada 2 min): las empresas
 * de fixture usan debounce de 3600 s y el reloj de la cola se mueve SÓLO para
 * ellas (`p_ahora` + `p_empresa`). Ningún trabajo de fixture queda listo en
 * tiempo real, salvo tras «Reintentar», que se prueba con el límite diario ya
 * alcanzado: si el worker real lo tomara, no llamaría a ningún proveedor.
 *
 * Qué prueba, medido por EFECTO:
 *   1. default apagado: producción intacta, empresa sin fila = desactivada
 *   2. configuración: roles, validación, versión, RLS, nadie escribe directo
 *   3. cola: A (1 mensaje), B (ráfaga de 10), empresa apagada, archivada, fallido
 *   4. worker: lote, una llamada por conversación, sin trabajo = sin llamadas
 *   5. concurrencia: dos workers a la vez no analizan dos veces
 *   6. C: mensaje nuevo DURANTE el análisis → checkpoint hasta el anterior y pending
 *   7. D/E: 429 y 500 con espera creciente hasta failed; 401 sin reintentos; reintentar
 *   8. locks vencidos (worker muerto)
 *   9. F: límites diarios de análisis y de costo — manual y automático
 *  10. G: kill switch
 *  11. idempotencia: resueltos y descartados no reaparecen, sin huellas duplicadas
 *  12. H/I: informes diario y semanal, idempotentes, sin IA; «mensajes enviados»
 *  13. métricas del panel
 *  14. privacidad del payload
 *  15. aislamiento entre empresas
 *  16. limpieza e invariantes
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const { analizarConversacion } = await import('../supabase/functions/whatsapp-ai-analyze/analisis.ts')
const { proveedorFalso, FalloProveedor, proveedorOpenAI, construirEntradaUsuario } = await import('../supabase/functions/whatsapp-ai-analyze/logica.ts')
const { procesarLote } = await import('../supabase/functions/whatsapp-ai-worker/lote.ts')

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

const MARCA = 'zz-w16e3'
const WABA = '1499762661645319'
const creados = { usuarios: [], empresas: [] }
const cuenta = async (t, filtro = (q) => q) => (await filtro(s.from(t).select('*', { count: 'exact', head: true }))).count
const ok = (r, q) => { if (r.error) throw new Error(`${q}: ${r.error.message}`); return r.data }
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

const usuarioTemporal = async (companyId, rol) => {
  const email = `${MARCA}-${rol}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@buscatools.test`
  const password = `Zz${randomUUID()}!`
  const { data, error } = await s.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`crear ${rol}: ${error.message}`)
  creados.usuarios.push(data.user.id)
  ok(await s.from('company_memberships').insert({ company_id: companyId, user_id: data.user.id, role: rol, status: 'active' }), `membresía ${rol}`)
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
  for (const t of ['whatsapp_ai_analysis_queue', 'whatsapp_ai_reports', 'whatsapp_ai_settings',
    'whatsapp_ai_runs', 'whatsapp_ai_items', 'whatsapp_conversation_ai_summary',
    'whatsapp_media', 'whatsapp_messages', 'whatsapp_conversations', 'whatsapp_accounts',
    'company_memberships', 'customer_contacts', 'customers']) {
    const r = await s.from(t).delete().in('company_id', ids)
    if (r.error) console.log(`    aviso ${t}: ${r.error.message.slice(0, 120)}`)
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

/** Proveedor falso que cuenta llamadas y guarda lo que recibió. */
const espia = (extra = {}) => {
  const p = {
    nombre: 'falso',
    llamadas: 0,
    entradas: [],
    async analizar(e) {
      p.llamadas++
      p.entradas.push(e)
      if (extra.antes) await extra.antes(e)
      if (extra.demora) await esperar(extra.demora)
      if (extra.falla) throw extra.falla()
      return proveedorFalso.analizar(e)
    },
  }
  return p
}

const PRODUCCION = ['buscatools', 'torquetools']

async function main() {
  console.log('='.repeat(78))
  console.log('  FASE 16 · WhatsApp E3 — automatización controlada')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(78))

  await barrerRestos()

  // Baseline de producción: nada de esta suite puede tocarla.
  const { data: prodEmpresas } = await s.from('companies').select('id, slug').in('slug', PRODUCCION)
  const prodIds = prodEmpresas.map((e) => e.id)
  const baseProd = {
    runs: await cuenta('whatsapp_ai_runs', (q) => q.in('company_id', prodIds)),
    items: await cuenta('whatsapp_ai_items', (q) => q.in('company_id', prodIds)),
    resumenes: await cuenta('whatsapp_conversation_ai_summary', (q) => q.in('company_id', prodIds)),
    cola: await cuenta('whatsapp_ai_analysis_queue', (q) => q.in('company_id', prodIds)),
    informes: await cuenta('whatsapp_ai_reports', (q) => q.in('company_id', prodIds)),
    mensajes: await cuenta('whatsapp_messages', (q) => q.in('company_id', prodIds)),
  }
  console.log(`  baseline producción: ${JSON.stringify(baseProd)}`)

  // ── 1 · Default apagado ─────────────────────────────────────────────────
  seccion('1 · Default seguro')

  const { data: prodSet } = await s.from('whatsapp_ai_settings').select('*').in('company_id', prodIds)
  cmp('las empresas de producción tienen su fila de configuración', prodIds.length, prodSet.length)

  /**
   * Acá había dos afirmaciones que dejaron de ser ciertas, y no por un error:
   * «producción: IA, automática e informes apagados» y «producción: nada en la
   * cola». El piloto real con OpenAI (Fase 16 · E2.5, 2026-09-17) encendió la
   * IA de Buscatools a propósito y dejó su trabajo `done` en la cola.
   *
   * Lo que este test tiene que proteger NO es que producción esté apagada
   * —eso es una decisión del negocio, y cambió— sino que **esta corrida no la
   * toque**. Así que se guarda el estado real al empezar y se compara al
   * terminar. Bajar el `enabled` de producción para que el test pase sería
   * arreglar el termómetro en vez del paciente.
   *
   * El default seguro sigue probado donde corresponde: en la comprobación de
   * abajo, sobre una empresa nueva.
   */
  const configProdAntes = JSON.stringify(
    [...prodSet].sort((a, b) => a.company_id.localeCompare(b.company_id)),
  )

  // Y una invariante que sí vale siempre: que no haya trabajos trabados.
  const { count: trabados } = await s
    .from('whatsapp_ai_analysis_queue')
    .select('*', { count: 'exact', head: true })
    .in('company_id', prodIds)
    .eq('status', 'processing')
    .lt('locked_at', new Date(Date.now() - 10 * 60_000).toISOString())
  cmp('producción: ningún trabajo trabado en la cola', 0, trabados ?? 0)

  // ── Fixture ──────────────────────────────────────────────────────────────
  const sello = Date.now()
  const nuevaEmpresa = async (k) => {
    const e = ok(await s.from('companies').insert({
      slug: `${MARCA}-${k}-${sello}`, name: `ZZ W16E3 ${k.toUpperCase()}`, legal_name: `ZZ W16E3 ${k.toUpperCase()} SA`, default_currency: 'ARS',
    }).select('id').single(), `empresa ${k}`)
    creados.empresas.push(e.id)
    ok(await s.from('whatsapp_accounts').insert({
      company_id: e.id, waba_id: WABA, phone_number_id: `${MARCA}-${k}-${sello}`,
      display_phone_number: '+54 9 11 0000-0003', display_name: `ZZ ${k}`, active: true,
    }), `cuenta ${k}`)
    return e.id
  }
  const Z = await nuevaEmpresa('z')
  const Y = await nuevaEmpresa('y')

  const { data: sinFila } = await s.from('whatsapp_ai_settings').select('company_id').eq('company_id', Z)
  cmp('una empresa nueva no tiene fila (= apagada)', 0, sinFila.length)

  const admin = await usuarioTemporal(Z, 'admin')
  const employee = await usuarioTemporal(Z, 'employee')
  const vend = await usuarioTemporal(Z, 'salesperson')
  const tech = await usuarioTemporal(Z, 'technician')
  const adminY = await usuarioTemporal(Y, 'admin')
  const anon = sesion()

  const estado0 = ok(await admin.c.rpc('config_ia_whatsapp', { p_company: Z }), 'config Z')
  cmp('empresa sin fila: modo desactivada', 'desactivada', estado0.modo)

  let n = 0
  const entrante = async (empresaKey, waId, texto, perfil = 'ZZ Contacto', ts = new Date()) => {
    n++
    return ok(await s.rpc('registrar_entrante_whatsapp', {
      p_phone_number_id: `${MARCA}-${empresaKey}-${sello}`, p_waba_id: WABA, p_wa_id: waId, p_profile_name: perfil,
      p_provider_message_id: `wamid.${MARCA}.${sello}.${n}`, p_tipo: 'text', p_texto: texto,
      p_caption: null, p_reply_to: null, p_timestamp: ts.toISOString(), p_media: null,
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
  const trabajo = async (conv) => (await s.from('whatsapp_ai_analysis_queue').select('*').eq('conversation_id', conv).maybeSingle()).data
  const resumenDe = async (conv) => (await s.from('whatsapp_conversation_ai_summary').select('*').eq('conversation_id', conv).maybeSingle()).data

  // Reloj de la cola: SIEMPRE en el futuro y SIEMPRE acotado a una empresa.
  let relojMs = Date.now() + 2 * 3600_000
  const reloj = (empresa = Z) => ({ ahora: new Date(relojMs).toISOString(), empresa })
  const avanzar = (min) => { relojMs += min * 60_000 }
  const lote = (proveedor, extra = {}) => procesarLote({
    admin: s, proveedor, worker: `suite-${extra.nombre ?? 'a'}`, limite: 20, reloj: reloj(extra.empresa), ahora: () => relojMs, ...extra.opciones,
  })

  // ── 2 · Configuración ───────────────────────────────────────────────────
  seccion('2 · Configuración: roles, validación, versión y RLS')

  let cfg = ok(await admin.c.rpc('guardar_config_ia_whatsapp', {
    p_company: Z, p_version: null,
    p_config: { enabled: true, auto_analyze: true, analysis_debounce_seconds: 3600 },
  }), 'admin guarda')
  cmp('el admin enciende IA automática (debounce 3600 s)', 'automatica/3600', `${cfg.modo}/${cfg.analysis_debounce_seconds}`)
  rechaza('employee no guarda configuración', await employee.c.rpc('guardar_config_ia_whatsapp', { p_company: Z, p_version: null, p_config: { enabled: false } }), 'SIN_PERMISO')
  rechaza('vendedor no guarda', await vend.c.rpc('guardar_config_ia_whatsapp', { p_company: Z, p_version: null, p_config: { enabled: false } }), 'SIN_PERMISO')
  rechaza('el admin de otra empresa no guarda', await adminY.c.rpc('guardar_config_ia_whatsapp', { p_company: Z, p_version: null, p_config: { enabled: false } }), 'SIN_PERMISO')
  rechaza('anon no guarda', await anon.rpc('guardar_config_ia_whatsapp', { p_company: Z, p_version: null, p_config: { enabled: false } }))
  rechaza('employee no lee la configuración completa', await employee.c.rpc('config_ia_whatsapp', { p_company: Z }), 'SIN_PERMISO')
  rechaza('la zona horaria no se edita', await admin.c.rpc('guardar_config_ia_whatsapp', { p_company: Z, p_version: null, p_config: { timezone: 'UTC' } }), 'CAMPO_NO_EDITABLE')
  rechaza('ni el modelo', await admin.c.rpc('guardar_config_ia_whatsapp', { p_company: Z, p_version: null, p_config: { model: 'gpt-5.6-terra' } }), 'CAMPO_NO_EDITABLE')
  rechaza('debounce de 10 s', await admin.c.rpc('guardar_config_ia_whatsapp', { p_company: Z, p_version: null, p_config: { analysis_debounce_seconds: 10 } }), 'CONFIG_INVALIDA')
  rechaza('límite de costo negativo', await admin.c.rpc('guardar_config_ia_whatsapp', { p_company: Z, p_version: null, p_config: { max_daily_cost_usd: -1 } }), 'CONFIG_INVALIDA')
  rechaza('informe diario sin hora', await admin.c.rpc('guardar_config_ia_whatsapp', { p_company: Z, p_version: null, p_config: { daily_report_enabled: true } }), 'CONFIG_INVALIDA')
  rechaza('día de la semana 8', await admin.c.rpc('guardar_config_ia_whatsapp', { p_company: Z, p_version: null, p_config: { weekly_report_day: 8 } }), 'CONFIG_INVALIDA')
  rechaza('hora con formato inválido', await admin.c.rpc('guardar_config_ia_whatsapp', { p_company: Z, p_version: null, p_config: { daily_report_time: '25:99' } }), 'CONFIG_INVALIDA')
  rechaza('versión vieja: no pisa a otro admin', await admin.c.rpc('guardar_config_ia_whatsapp', {
    p_company: Z, p_version: '2020-01-01T00:00:00Z', p_config: { enabled: false },
  }), 'CONFLICTO_VERSION')
  cfg = ok(await admin.c.rpc('config_ia_whatsapp', { p_company: Z }), 'releer')
  cmp('después de los rechazos sigue automática', 'automatica', cfg.modo)

  cmp('vendedor ve el modo (sin detalles)', 'automatica', JSON.stringify(ok(await vend.c.rpc('estado_ia_whatsapp', { p_company: Z }), 'estado vend')).includes('automatica') ? 'automatica' : 'no')
  rechaza('técnico no ve el modo', await tech.c.rpc('estado_ia_whatsapp', { p_company: Z }), 'SIN_PERMISO')
  rechaza('admin de otra empresa no ve el modo', await adminY.c.rpc('estado_ia_whatsapp', { p_company: Z }), 'SIN_PERMISO')

  cmp('RLS: admin ve la fila de su empresa', 1, (await admin.c.from('whatsapp_ai_settings').select('company_id').eq('company_id', Z)).data.length)
  cmp('RLS: employee también (lectura)', 1, (await employee.c.from('whatsapp_ai_settings').select('company_id').eq('company_id', Z)).data.length)
  cmp('RLS: vendedor no', 0, (await vend.c.from('whatsapp_ai_settings').select('company_id')).data?.length ?? 0)
  cmp('RLS: admin de otra empresa no', 0, (await adminY.c.from('whatsapp_ai_settings').select('company_id').eq('company_id', Z)).data.length)
  rechaza('nadie actualiza la tabla directo', await admin.c.from('whatsapp_ai_settings').update({ enabled: false }).eq('company_id', Z))
  rechaza('nadie inserta en la cola directo', await admin.c.from('whatsapp_ai_analysis_queue').insert({ conversation_id: randomUUID(), company_id: Z }))
  rechaza('nadie escribe informes directo', await admin.c.from('whatsapp_ai_reports').insert({ company_id: Z, type: 'daily', period_start: new Date().toISOString(), period_end: new Date(Date.now() + 86400_000).toISOString(), source_cutoff: new Date().toISOString(), payload: {} }))
  for (const [rpc, args] of [
    ['reclamar_analisis_whatsapp', { p_limite: 5, p_worker: 'x' }],
    ['completar_analisis_whatsapp', { p_conversacion: randomUUID(), p_locked_at: new Date().toISOString(), p_resultado: 'ok' }],
    ['verificar_uso_ia_whatsapp', { p_conversacion: randomUUID() }],
    ['generar_informe_whatsapp', { p_company: Z, p_tipo: 'daily', p_desde: new Date().toISOString(), p_hasta: new Date().toISOString() }],
    ['generar_informes_programados_whatsapp', {}],
    ['validar_token_worker_ia_whatsapp', { p_token: 'x' }],
  ]) {
    rechaza(`un admin no llama ${rpc}`, await admin.c.rpc(rpc, args))
  }
  cmp('un token de worker inventado no valida', false, ok(await s.rpc('validar_token_worker_ia_whatsapp', { p_token: 'zz-inventado' }), 'token'))
  rechaza('mover el reloj de la cola exige acotar la empresa', await s.rpc('reclamar_analisis_whatsapp', { p_limite: 1, p_worker: 'x', p_ahora: new Date().toISOString() }), 'RELOJ_SIN_EMPRESA')

  // ── 3 · Cola ────────────────────────────────────────────────────────────
  seccion('3 · Cola: un trabajo por conversación, debounce y exclusiones')

  const antesA = Date.now()
  const A = (await entrante('z', '5491100000101', 'Hola, ¿me pasás precio del candado?', 'ZZ A')).conversation_id
  let tA = await trabajo(A)
  cmp('A: un mensaje crea UN trabajo pending', 'pending', tA?.status)
  const esperaA = (new Date(tA.not_before).getTime() - antesA) / 1000
  cmp('A: not_before = ahora + debounce (≈3600 s)', true, esperaA > 3590 && esperaA < 3700)

  const B = (await entrante('z', '5491100000102', 'Mensaje 1 de la ráfaga', 'ZZ B')).conversation_id
  const nbB1 = (await trabajo(B)).not_before
  for (let i = 2; i <= 10; i++) await entrante('z', '5491100000102', `Mensaje ${i} de la ráfaga, ¿cotizás 3 candados?`, 'ZZ B')
  cmp('B: ráfaga de 10 mensajes = UNA fila en la cola', 1, await cuenta('whatsapp_ai_analysis_queue', (q) => q.eq('conversation_id', B)))
  const tB = await trabajo(B)
  cmp('B: cada mensaje corrió el not_before hacia adelante', true, new Date(tB.not_before) > new Date(nbB1))

  const YC = (await entrante('y', '5491100000201', 'Hola', 'ZZ Y')).conversation_id
  cmp('empresa con IA apagada: el mensaje entra y NO encola', 'mensaje:1/cola:0',
    `mensaje:${await cuenta('whatsapp_messages', (q) => q.eq('conversation_id', YC))}/cola:${await cuenta('whatsapp_ai_analysis_queue', (q) => q.eq('conversation_id', YC))}`)

  const ARCH = (await entrante('z', '5491100000103', 'Hola', 'ZZ Archivada')).conversation_id
  ok(await s.from('whatsapp_ai_analysis_queue').delete().eq('conversation_id', ARCH), 'limpiar cola archivada')
  ok(await s.from('whatsapp_conversations').update({ archived_at: new Date().toISOString() }).eq('id', ARCH), 'archivar')
  await entrante('z', '5491100000103', '¿Siguen ahí?', 'ZZ Archivada')
  cmp('conversación archivada: no se encola', 0, await cuenta('whatsapp_ai_analysis_queue', (q) => q.eq('conversation_id', ARCH)))

  // Un saliente fallido no pide análisis; uno enviado sí.
  const pedidoA1 = (await trabajo(A)).requested_at
  await esperar(20)
  await saliente(A, 'No sale', 'numero_no_valido')
  cmp('un saliente fallido no toca la cola', pedidoA1, (await trabajo(A)).requested_at)
  await saliente(A, 'Mañana te paso el precio')
  cmp('un saliente enviado sí la actualiza', true, (await trabajo(A)).requested_at !== pedidoA1)

  // ── 4 · Worker ──────────────────────────────────────────────────────────
  seccion('4 · Worker: lote con el proveedor falso')

  const p1 = espia()
  const nada = await procesarLote({ admin: s, proveedor: p1, worker: 'suite', reloj: { ahora: new Date().toISOString(), empresa: Z } })
  cmp('en tiempo real, con debounce pendiente, no reclama nada', '0/0', `${nada.reclamados}/${p1.llamadas}`)

  const r1 = await lote(p1)
  cmp('con el reloj pasado el debounce: reclama A y B', 2, r1.reclamados)
  cmp('una llamada al proveedor por conversación', 2, p1.llamadas)
  const entradaB = p1.entradas.find((e) => e.contacto === 'ZZ B')
  cmp('B: la ráfaga fue en UNA llamada con los 10 mensajes', 10, entradaB?.mensajes.length)
  cmp('A: el saliente fallido no viajó', false, p1.entradas.find((e) => e.contacto === 'ZZ A')?.mensajes.some((m) => m.texto === 'No sale'))
  cmp('A y B quedan done', 'done,done', [(await trabajo(A)).status, (await trabajo(B)).status].join(','))
  const { data: ultA } = await s.from('whatsapp_messages').select('id').eq('conversation_id', A).eq('status', 'sent').order('ordenado_en', { ascending: false }).limit(1).single()
  cmp('A: checkpoint en el último mensaje enviado', ultA.id, (await resumenDe(A)).last_analyzed_message_id)
  cmp('A: la cola recuerda hasta dónde procesó', ultA.id, (await trabajo(A)).last_processed_message_id)
  const { data: runsAuto } = await s.from('whatsapp_ai_runs').select('requested_by').in('conversation_id', [A, B])
  cmp('las corridas automáticas no tienen persona', true, runsAuto.every((x) => x.requested_by === null))

  const r2 = await lote(p1)
  cmp('sin trabajo listo: 0 reclamados, 0 llamadas nuevas', '0/2', `${r2.reclamados}/${p1.llamadas}`)

  // ── 5 · Concurrencia ────────────────────────────────────────────────────
  seccion('5 · Concurrencia: dos workers a la vez')

  const K = []
  for (let i = 0; i < 4; i++) K.push((await entrante('z', `54911000003${i}0`, `¿Precio del producto ${i}?`, `ZZ K${i}`)).conversation_id)
  const lento = espia({ demora: 250 })
  const [w1, w2] = await Promise.all([
    lote(lento, { nombre: 'w1', opciones: { limite: 3 } }),
    lote(lento, { nombre: 'w2', opciones: { limite: 3 } }),
  ])
  cmp('entre los dos reclamaron exactamente 4 trabajos', 4, w1.reclamados + w2.reclamados)
  cmp('4 llamadas: ninguna conversación se analizó dos veces', 4, lento.llamadas)
  cmp('ningún lock perdido', 0, w1.lockPerdido + w2.lockPerdido)
  cmp('una corrida ok por conversación', 4, await cuenta('whatsapp_ai_runs', (q) => q.in('conversation_id', K).eq('status', 'ok')))

  // ── 6 · Mensaje nuevo durante el análisis ───────────────────────────────
  seccion('6 · C: un mensaje llega MIENTRAS el worker analiza')

  const C = (await entrante('z', '5491100000104', 'Necesito 5 candados, ¿precio?', 'ZZ C')).conversation_id
  const { data: m20 } = await s.from('whatsapp_messages').select('id').eq('conversation_id', C).single()
  let insertado = false
  const intruso = espia({
    antes: async () => {
      if (insertado) return
      insertado = true
      await esperar(20)
      await entrante('z', '5491100000104', 'Ah, y también 2 cadenas', 'ZZ C')
    },
  })
  const rc = await lote(intruso)
  cmp('C: el lote analizó con lo que había (1 mensaje)', '1/1', `${rc.reclamados}/${intruso.entradas[0]?.mensajes.length}`)
  cmp('C: el checkpoint avanzó SÓLO hasta m20', m20.id, (await resumenDe(C)).last_analyzed_message_id)
  cmp('C: el trabajo vuelve a pending, no queda done', 'pending', (await trabajo(C)).status)
  avanzar(61)
  const rc2 = await lote(intruso)
  cmp('C: la siguiente corrida manda SÓLO m21, con el resumen previo', '1/1/true',
    `${rc2.reclamados}/${intruso.entradas[1]?.mensajes.length}/${intruso.entradas[1]?.resumenPrevio !== null}`)
  cmp('C: m21 era «2 cadenas»', true, intruso.entradas[1]?.mensajes[0]?.texto.includes('cadenas'))
  cmp('C: ahora sí done', 'done', (await trabajo(C)).status)

  // ── 7 · Reintentos ──────────────────────────────────────────────────────
  seccion('7 · D/E: errores del proveedor y reintentos')

  const D = (await entrante('z', '5491100000105', '¿Tienen stock?', 'ZZ D 429')).conversation_id
  const p429 = espia({ falla: () => new FalloProveedor('limite', '429') })
  avanzar(61)
  const esperas = []
  for (const minutos of [0, 3, 11, 61]) {
    avanzar(minutos)
    const antes = relojMs
    await lote(p429)
    const t = await trabajo(D)
    esperas.push(`${t.status}:${t.attempts}:${t.status === 'pending' ? Math.round((new Date(t.not_before).getTime() - antes) / 60_000) : '-'}`)
  }
  cmp('D 429: +2, +10, +60 min y después failed', 'pending:1:2,pending:2:10,pending:3:60,failed:4:-', esperas.join(','))
  cmp('D: 4 intentos = 4 llamadas, ninguna más', 4, p429.llamadas)
  avanzar(120)
  await lote(p429)
  cmp('D failed: no hay más reintentos automáticos', 4, p429.llamadas)
  cmp('D: el error queda registrado', 'proveedor_limite', (await trabajo(D)).last_error)

  const E = (await entrante('z', '5491100000106', 'Hola', 'ZZ E 500')).conversation_id
  const p500 = espia({ falla: () => new FalloProveedor('caido', '500') })
  avanzar(61)
  await lote(p500)
  const tE = await trabajo(E)
  cmp('E 500: reintento con espera', 'pending:1:proveedor_caido', `${tE.status}:${tE.attempts}:${tE.last_error}`)

  const AU = (await entrante('z', '5491100000107', 'Hola', 'ZZ 401')).conversation_id
  const p401 = espia({ falla: () => new FalloProveedor('auth', '401') })
  avanzar(61)
  await lote(p401)
  const tAU = await trabajo(AU)
  cmp('401: failed al primer intento, sin reintentos', 'failed:1:proveedor_auth', `${tAU.status}:${tAU.attempts}:${tAU.last_error}`)

  const RF = (await entrante('z', '5491100000108', 'Hola', 'ZZ refusal')).conversation_id
  avanzar(61)
  await lote(espia({ falla: () => new FalloProveedor('refusal', 'no') }))
  cmp('negativa del modelo: failed, requiere revisión', 'failed', (await trabajo(RF)).status)

  const nuevoEnFailed = (await trabajo(AU)).requested_at
  await entrante('z', '5491100000107', 'Sigo esperando', 'ZZ 401')
  const tAU2 = await trabajo(AU)
  cmp('un mensaje nuevo NO reabre un failed (evita llamadas que fallan igual)', 'failed', tAU2.status)
  cmp('pero anota que hubo actividad', true, tAU2.requested_at !== nuevoEnFailed)

  // ── 8 · Lock vencido ────────────────────────────────────────────────────
  seccion('8 · Worker muerto: lock vencido')

  const L = (await entrante('z', '5491100000109', 'Hola', 'ZZ Lock')).conversation_id
  avanzar(61)
  const tomado = ok(await s.rpc('reclamar_analisis_whatsapp', { p_limite: 1, p_worker: 'muerto', ...{ p_ahora: new Date(relojMs).toISOString(), p_empresa: Z } }), 'reclamar')
  const lockViejo = tomado.find((x) => x.conversation_id === L)?.locked_at
  cmp('el worker «muerto» tomó L', true, !!lockViejo)
  avanzar(5)
  ok(await s.rpc('reclamar_analisis_whatsapp', { p_limite: 1, p_worker: 'otro', p_ahora: new Date(relojMs).toISOString(), p_empresa: Z }), 'reclamar 5 min')
  cmp('a los 5 min el lock sigue siendo del primero', 'processing', (await trabajo(L)).status)
  avanzar(11)
  ok(await s.rpc('reclamar_analisis_whatsapp', { p_limite: 0, p_worker: 'otro', p_ahora: new Date(relojMs).toISOString(), p_empresa: Z }), 'reclamar 16 min')
  const tL = await trabajo(L)
  cmp('a los 10+ min se recupera: pending, un intento, lock_vencido', 'pending:1:lock_vencido', `${tL.status}:${tL.attempts}:${tL.last_error}`)
  cmp('el worker muerto no puede completarlo tarde', 'lock_perdido',
    ok(await s.rpc('completar_analisis_whatsapp', { p_conversacion: L, p_locked_at: lockViejo, p_resultado: 'ok' }), 'completar tarde'))
  avanzar(3)
  const rl = await lote(espia())
  cmp('otro worker lo retoma y termina', 'done', (await trabajo(L)).status)
  cmp('…con una sola llamada', 1, rl.llamadasProveedor)

  // ── 9 · Límites ─────────────────────────────────────────────────────────
  seccion('9 · F: límites diarios')

  const { count: llamadasHoy } = await s.from('whatsapp_ai_runs').select('*', { count: 'exact', head: true }).eq('company_id', Z).gt('messages_sent', 0)
  let version = ok(await admin.c.rpc('config_ia_whatsapp', { p_company: Z }), 'cfg').updated_at
  cfg = ok(await admin.c.rpc('guardar_config_ia_whatsapp', { p_company: Z, p_version: version, p_config: { max_daily_analyses: llamadasHoy } }), 'límite análisis')
  cmp('límite de análisis = lo ya usado hoy', llamadasHoy, cfg.max_daily_analyses)

  const F = (await entrante('z', '5491100000110', '¿Precio?', 'ZZ F Límite')).conversation_id
  const pF = espia()
  avanzar(61)
  await lote(pF)
  const tF = await trabajo(F)
  cmp('límite alcanzado: NO se llama al proveedor', 0, pF.llamadas)
  cmp('el trabajo espera al día siguiente con limit_reached', 'pending:limit_reached', `${tF.status}:${tF.last_error}`)
  const zona = 'America/Argentina/Buenos_Aires'
  const diaReloj = new Intl.DateTimeFormat('en-CA', { timeZone: zona }).format(new Date(relojMs))
  const diaEspera = new Intl.DateTimeFormat('en-CA', { timeZone: zona }).format(new Date(tF.not_before))
  cmp('not_before es el inicio del día siguiente (hora AR)', true, diaEspera > diaReloj && new Date(tF.not_before).toISOString().endsWith('03:00:00.000Z'))
  const { data: omit } = await s.from('whatsapp_ai_runs').select('status, error_code, messages_sent').eq('conversation_id', F)
  cmp('queda una corrida omitido/limite_analisis sin mensajes enviados', 'omitido:limite_analisis:0', omit.map((x) => `${x.status}:${x.error_code}:${x.messages_sent}`).join(','))
  cmp('una corrida omitida no marca error en la conversación', true, (await resumenDe(F)) === null)

  const manual = await analizarConversacion({ admin: s, proveedor: pF, conversacionId: F, completo: false, solicitadoPor: admin.id })
  cmp('el análisis MANUAL también respeta el límite', 'limite/0', `${manual.estado}/${pF.llamadas}`)

  version = ok(await admin.c.rpc('config_ia_whatsapp', { p_company: Z }), 'cfg').updated_at
  ok(await admin.c.rpc('guardar_config_ia_whatsapp', { p_company: Z, p_version: version, p_config: { max_daily_analyses: null, max_daily_cost_usd: 0.001 } }), 'límite costo')
  ok(await s.from('whatsapp_ai_runs').insert({
    company_id: Z, conversation_id: F, status: 'ok', model: 'zz-costo', messages_sent: 1, provider: 'falso', estimated_cost_usd: 0.002,
  }), 'corrida con costo')
  const usoCosto = ok(await s.rpc('verificar_uso_ia_whatsapp', { p_conversacion: F }), 'uso')
  cmp('límite de costo: USD de hoy ≥ tope → no permitido', 'false:limite_costo', `${usoCosto.permitido}:${usoCosto.motivo}`)
  const manual2 = await analizarConversacion({ admin: s, proveedor: pF, conversacionId: F, completo: false, solicitadoPor: admin.id, ahora: () => relojMs })
  cmp('manual con límite de costo: no llama', 'limite/limite_costo/0', `${manual2.estado}/${manual2.codigo}/${pF.llamadas}`)
  cmp('WhatsApp sigue recibiendo con el límite alcanzado', 'ok', (await entrante('z', '5491100000110', 'Sigo acá', 'ZZ F Límite')).conversation_id === F ? 'ok' : 'no')

  // Reintentar a mano: se prueba CON el límite alcanzado (ver cabecera).
  cmp('admin: «Reintentar» un failed', 'pending', ok(await admin.c.rpc('reintentar_analisis_whatsapp', { p_conversacion: AU }), 'reintentar'))
  const tAU3 = await trabajo(AU)
  cmp('reintentar pone intentos en 0', '0:null', `${tAU3.attempts}:${tAU3.last_error}`)
  rechaza('employee no reintenta', await employee.c.rpc('reintentar_analisis_whatsapp', { p_conversacion: RF }), 'SIN_PERMISO')
  rechaza('un trabajo pending no se «reintenta»', await admin.c.rpc('reintentar_analisis_whatsapp', { p_conversacion: AU }), 'NO_REINTENTABLE')
  // Lo toma la suite con el reloj: con el límite de costo alcanzado no hay llamada.
  const pAU = espia()
  await lote(pAU)
  cmp('el reintentado con límite alcanzado no llama al proveedor', 0, pAU.llamadas)

  version = ok(await admin.c.rpc('config_ia_whatsapp', { p_company: Z }), 'cfg').updated_at
  ok(await admin.c.rpc('guardar_config_ia_whatsapp', { p_company: Z, p_version: version, p_config: { max_daily_cost_usd: null } }), 'sin límites')

  // ── 10 · Kill switch ────────────────────────────────────────────────────
  seccion('10 · G: kill switch')

  const G = (await entrante('z', '5491100000111', '¿Precio del candado?', 'ZZ G')).conversation_id
  avanzar(61)
  await lote(espia())
  const itemsAntesG = await cuenta('whatsapp_ai_items', (q) => q.eq('company_id', Z))
  const resumenesAntesG = await cuenta('whatsapp_conversation_ai_summary', (q) => q.eq('company_id', Z))
  await entrante('z', '5491100000111', 'Y también cadenas', 'ZZ G')
  cmp('G: hay un trabajo pendiente antes de apagar', 'pending', (await trabajo(G)).status)

  version = ok(await admin.c.rpc('config_ia_whatsapp', { p_company: Z }), 'cfg').updated_at
  const apagado = ok(await admin.c.rpc('guardar_config_ia_whatsapp', { p_company: Z, p_version: version, p_config: { enabled: false } }), 'apagar')
  cmp('apagar: modo desactivada y trabajos cancelados', true, apagado.modo === 'desactivada' && apagado.trabajos_cancelados >= 1)
  cmp('G: el trabajo quedó cancelled', 'cancelled', (await trabajo(G)).status)
  const pG = espia()
  avanzar(61)
  const rG = await lote(pG)
  cmp('con IA apagada el worker no reclama ni llama', '0/0', `${rG.reclamados}/${pG.llamadas}`)
  const manualG = await analizarConversacion({ admin: s, proveedor: pG, conversacionId: G, completo: false, solicitadoPor: admin.id, ahora: () => relojMs })
  cmp('manual con IA apagada: desactivada, sin llamada', 'desactivada/0', `${manualG.estado}/${pG.llamadas}`)
  cmp('los resúmenes siguen ahí', resumenesAntesG, await cuenta('whatsapp_conversation_ai_summary', (q) => q.eq('company_id', Z)))
  cmp('los ítems siguen ahí', itemsAntesG, await cuenta('whatsapp_ai_items', (q) => q.eq('company_id', Z)))
  await entrante('z', '5491100000111', '¿Hola?', 'ZZ G')
  cmp('WhatsApp sigue recibiendo y la cola no revive', 'cancelled', (await trabajo(G)).status)
  rechaza('con la IA automática apagada no se reintenta', await admin.c.rpc('reintentar_analisis_whatsapp', { p_conversacion: G }), 'IA_AUTOMATICA_APAGADA')

  // Un trabajo en processing cuando se apaga: termina sin llamar.
  version = ok(await admin.c.rpc('config_ia_whatsapp', { p_company: Z }), 'cfg').updated_at
  ok(await admin.c.rpc('guardar_config_ia_whatsapp', { p_company: Z, p_version: version, p_config: { enabled: true } }), 'prender')
  const P = (await entrante('z', '5491100000112', '¿Precio?', 'ZZ P')).conversation_id
  avanzar(61)
  const pP = espia({
    // Se apaga la IA justo antes de que el análisis verifique las guardas.
    antes: async () => {},
  })
  const tomadoP = ok(await s.rpc('reclamar_analisis_whatsapp', { p_limite: 20, p_worker: 'p', p_ahora: new Date(relojMs).toISOString(), p_empresa: Z }), 'reclamar P')
  version = ok(await admin.c.rpc('config_ia_whatsapp', { p_company: Z }), 'cfg').updated_at
  ok(await admin.c.rpc('guardar_config_ia_whatsapp', { p_company: Z, p_version: version, p_config: { enabled: false } }), 'apagar con P tomado')
  const rP = await analizarConversacion({ admin: s, proveedor: pP, conversacionId: P, completo: false, solicitadoPor: null })
  const finP = ok(await s.rpc('completar_analisis_whatsapp', {
    p_conversacion: P, p_locked_at: tomadoP.find((x) => x.conversation_id === P).locked_at, p_resultado: rP.estado,
  }), 'completar P')
  cmp('apagada con el trabajo en curso: no llama y queda cancelled', 'desactivada/0/cancelled', `${rP.estado}/${pP.llamadas}/${finP}`)

  version = ok(await admin.c.rpc('config_ia_whatsapp', { p_company: Z }), 'cfg').updated_at
  ok(await admin.c.rpc('guardar_config_ia_whatsapp', { p_company: Z, p_version: version, p_config: { enabled: true } }), 'prender de nuevo')

  // ── 11 · Idempotencia ───────────────────────────────────────────────────
  seccion('11 · Idempotencia: resueltos y descartados no reaparecen')

  const I = (await entrante('z', '5491100000113', 'Mañana te mando el pago, falta la factura', 'ZZ I')).conversation_id
  avanzar(61)
  await lote(espia())
  const { data: itemsI } = await s.from('whatsapp_ai_items').select('id, type, fingerprint').eq('conversation_id', I)
  cmp('I: el análisis dejó ítems', true, itemsI.length >= 1)
  ok(await admin.c.rpc('resolver_item_ia_whatsapp', { p_item: itemsI[0].id, p_estado: 'resolved' }), 'resolver')
  if (itemsI[1]) ok(await admin.c.rpc('resolver_item_ia_whatsapp', { p_item: itemsI[1].id, p_estado: 'dismissed' }), 'descartar')
  // Reanálisis COMPLETO desde cero (mismos mensajes): el peor caso.
  const pI = espia()
  const completo = await analizarConversacion({ admin: s, proveedor: pI, conversacionId: I, completo: true, solicitadoPor: admin.id, ahora: () => relojMs + 3600_000 })
  cmp('reanálisis completo con los mismos mensajes', 'ok', completo.estado)
  const { data: itemsI2 } = await s.from('whatsapp_ai_items').select('id, status, fingerprint').eq('conversation_id', I)
  cmp('mismos mensajes → 0 ítems nuevos', itemsI.length, itemsI2.length)
  cmp('el resuelto sigue resuelto', 'resolved', itemsI2.find((x) => x.id === itemsI[0].id)?.status)
  if (itemsI[1]) cmp('el descartado sigue descartado', 'dismissed', itemsI2.find((x) => x.id === itemsI[1].id)?.status)
  const huellas = itemsI2.map((x) => x.fingerprint)
  cmp('sin huellas duplicadas', huellas.length, new Set(huellas).size)
  avanzar(61)
  const rI = await lote(espia())
  cmp('la cola sin mensajes nuevos no reclama I', 0, rI.reclamados)

  // ── 12 · Informes ───────────────────────────────────────────────────────
  seccion('12 · H/I: informes diario y semanal')

  const runsAntesInf = await cuenta('whatsapp_ai_runs', (q) => q.eq('company_id', Z))
  // «Mensajes enviados»: A tiene 1 enviado y 1 fallido; se suma un pendiente sin sellar.
  ok(await admin.c.rpc('encolar_mensaje_whatsapp', { p_conversacion: A, p_texto: 'Queda en cola', p_client_request_id: randomUUID() }), 'pendiente')
  const desdeVivo = new Date(Date.now() - 3600_000).toISOString()
  const hastaVivo = new Date(Date.now() + 60_000).toISOString()
  const vivo = ok(await admin.c.rpc('informe_whatsapp', { p_company: Z, p_desde: desdeVivo, p_hasta: hastaVivo }), 'informe vivo')
  const { data: salReal } = await s.from('whatsapp_messages').select('status').eq('company_id', Z).eq('direction', 'out')
    .gte('ordenado_en', desdeVivo).lt('ordenado_en', hastaVivo)
  const cuentaEstado = (e) => salReal.filter((x) => x.status === e).length
  cmp('hay salientes sent, failed y pending en el período', true, cuentaEstado('sent') > 0 && cuentaEstado('failed') > 0 && cuentaEstado('pending') > 0)
  cmp('«mensajes enviados» = sólo sent (sin failed ni pending)', cuentaEstado('sent'), vivo.totales.mensajes_salientes)
  cmp('«errores de envío» = failed', cuentaEstado('failed'), vivo.totales.errores_envio)

  const hoyAR = new Intl.DateTimeFormat('en-CA', { timeZone: zona }).format(new Date())
  const inicioDia = new Date(`${hoyAR}T03:00:00.000Z`)
  const finDia = new Date(inicioDia.getTime() + 86400_000)
  const d1 = ok(await s.rpc('generar_informe_whatsapp', { p_company: Z, p_tipo: 'daily', p_desde: inicioDia.toISOString(), p_hasta: finDia.toISOString() }), 'diario')
  const d2 = ok(await s.rpc('generar_informe_whatsapp', { p_company: Z, p_tipo: 'daily', p_desde: inicioDia.toISOString(), p_hasta: finDia.toISOString() }), 'diario 2')
  cmp('diario: la primera vez crea, la segunda actualiza', 'true/false', `${d1.creado}/${d2.creado}`)
  cmp('diario: un solo snapshot por período', 1, await cuenta('whatsapp_ai_reports', (q) => q.eq('company_id', Z).eq('type', 'daily')))
  cmp('mismo id al regenerar', d1.id, d2.id)
  const { data: snap } = await s.from('whatsapp_ai_reports').select('payload, source_cutoff, version').eq('id', d1.id).single()
  const vivoDia = ok(await admin.c.rpc('informe_whatsapp', { p_company: Z, p_desde: inicioDia.toISOString(), p_hasta: finDia.toISOString() }), 'vivo día')
  cmp('el snapshot del admin coincide con el informe en vivo del admin', JSON.stringify(vivoDia.totales), JSON.stringify(snap.payload.totales))
  cmp('snapshot con corte y versión', true, !!snap.source_cutoff && snap.version === 1)

  const lunes = new Date(inicioDia)
  const dow = new Date(`${hoyAR}T12:00:00Z`).getUTCDay() || 7
  lunes.setUTCDate(lunes.getUTCDate() - (dow - 1))
  const w1r = ok(await s.rpc('generar_informe_whatsapp', { p_company: Z, p_tipo: 'weekly', p_desde: lunes.toISOString(), p_hasta: new Date(lunes.getTime() + 7 * 86400_000).toISOString() }), 'semanal')
  cmp('semanal: crea el snapshot de la semana', true, w1r.creado)
  rechaza('un semanal de 6 días no es un semanal', await s.rpc('generar_informe_whatsapp', { p_company: Z, p_tipo: 'weekly', p_desde: lunes.toISOString(), p_hasta: new Date(lunes.getTime() + 6 * 86400_000).toISOString() }), 'PERIODO_INVALIDO')

  // Programados: con informes apagados no genera nada; prendidos, genera AYER y la semana cerrada, una sola vez.
  const antesProg = await cuenta('whatsapp_ai_reports')
  cmp('programados con todo apagado: 0 informes', 0, ok(await s.rpc('generar_informes_programados_whatsapp', {}), 'prog 0'))
  cmp('…y no tocó ninguna empresa', antesProg, await cuenta('whatsapp_ai_reports'))
  version = ok(await admin.c.rpc('config_ia_whatsapp', { p_company: Z }), 'cfg').updated_at
  ok(await admin.c.rpc('guardar_config_ia_whatsapp', {
    p_company: Z, p_version: version,
    p_config: { daily_report_enabled: true, daily_report_time: '08:00', weekly_report_enabled: true, weekly_report_day: dow, weekly_report_time: '08:00' },
  }), 'prender informes Z')
  const a2359 = new Date(`${hoyAR}T02:59:00.000Z`)
  a2359.setUTCDate(a2359.getUTCDate() + 1) // 23:59 AR de hoy
  const g1 = ok(await s.rpc('generar_informes_programados_whatsapp', { p_ahora: a2359.toISOString() }), 'prog 1')
  const g2 = ok(await s.rpc('generar_informes_programados_whatsapp', { p_ahora: a2359.toISOString() }), 'prog 2')
  cmp('programados: diario de ayer + semana cerrada; repetir no duplica', '2/0', `${g1}/${g2}`)
  const ayer = new Date(inicioDia.getTime() - 86400_000).toISOString()
  cmp('el diario programado es el día cerrado de AYER', 1, await cuenta('whatsapp_ai_reports', (q) => q.eq('company_id', Z).eq('type', 'daily').eq('period_start', ayer)))
  const lunesAnterior = new Date(lunes.getTime() - 7 * 86400_000).toISOString()
  cmp('el semanal programado es la semana cerrada anterior', 1, await cuenta('whatsapp_ai_reports', (q) => q.eq('company_id', Z).eq('type', 'weekly').eq('period_start', lunesAnterior)))
  const a0759 = new Date(`${hoyAR}T10:59:00.000Z`)
  const antesHora = await cuenta('whatsapp_ai_reports', (q) => q.eq('company_id', Z))
  ok(await s.from('whatsapp_ai_reports').delete().eq('company_id', Z).eq('type', 'daily').eq('period_start', ayer), 'borrar ayer')
  cmp('antes de la hora configurada no genera', 0, ok(await s.rpc('generar_informes_programados_whatsapp', { p_ahora: a0759.toISOString() }), 'prog 07:59') - 0)
  cmp('(control)', antesHora - 1, await cuenta('whatsapp_ai_reports', (q) => q.eq('company_id', Z)))
  cmp('ninguna empresa de producción recibió informes', baseProd.informes, await cuenta('whatsapp_ai_reports', (q) => q.in('company_id', prodIds)))

  cmp('informes vivos, snapshots y programados: 0 corridas de IA', runsAntesInf, await cuenta('whatsapp_ai_runs', (q) => q.eq('company_id', Z)))

  cmp('RLS informes: admin los ve', true, (await admin.c.from('whatsapp_ai_reports').select('id').eq('company_id', Z)).data.length > 0)
  cmp('RLS informes: employee los ve', true, (await employee.c.from('whatsapp_ai_reports').select('id').eq('company_id', Z)).data.length > 0)
  cmp('RLS informes: vendedor no (son de toda la empresa)', 0, (await vend.c.from('whatsapp_ai_reports').select('id')).data?.length ?? 0)
  cmp('RLS informes: admin de otra empresa no', 0, (await adminY.c.from('whatsapp_ai_reports').select('id').eq('company_id', Z)).data.length)

  // ── 13 · Métricas ───────────────────────────────────────────────────────
  seccion('13 · Métricas del panel')

  const met = ok(await admin.c.rpc('metricas_ia_whatsapp', { p_company: Z }), 'métricas')
  const { data: runsHoy } = await s.from('whatsapp_ai_runs').select('status, messages_sent, estimated_cost_usd').eq('company_id', Z)
  cmp('hoy: llamadas = corridas con mensajes enviados', runsHoy.filter((x) => x.messages_sent > 0).length, met.periodos.hoy.llamadas)
  cmp('hoy: errores', runsHoy.filter((x) => x.status === 'error').length, met.periodos.hoy.errores)
  cmp('hoy: omitidas', runsHoy.filter((x) => x.status === 'omitido').length, met.periodos.hoy.omitidas)
  cmp('hoy: costo', runsHoy.reduce((a, x) => a + Number(x.estimated_cost_usd ?? 0), 0).toFixed(6), Number(met.periodos.hoy.costo_usd).toFixed(6))
  cmp('7 días y mes incluyen hoy', true, met.periodos.ultimos_7_dias.corridas >= met.periodos.hoy.corridas && met.periodos.mes.corridas >= met.periodos.hoy.corridas)
  const fallidosDb = await cuenta('whatsapp_ai_analysis_queue', (q) => q.eq('company_id', Z).eq('status', 'failed'))
  cmp('cola: fallidos = los failed de la base (D, RF y los que siguieron)', fallidosDb, met.cola.fallidos)
  cmp('fallidos listados con contacto y error, sin texto de mensajes', true,
    met.fallidos.length === Math.min(fallidosDb, 20) && fallidosDb >= 2 && met.fallidos.every((f) => Object.keys(f).sort().join(',') === 'actualizado_en,contacto,conversation_id,error,intentos'))
  cmp('proveedor no disponible: último error de proveedor posterior al último ok', false, met.proveedor.no_disponible)
  rechaza('employee no ve métricas', await employee.c.rpc('metricas_ia_whatsapp', { p_company: Z }), 'SIN_PERMISO')
  rechaza('admin de otra empresa no ve métricas', await adminY.c.rpc('metricas_ia_whatsapp', { p_company: Z }), 'SIN_PERMISO')

  // ── 14 · Privacidad ─────────────────────────────────────────────────────
  seccion('14 · Privacidad del payload')

  const cliente = ok(await s.from('customers').insert({
    company_id: Z, legal_name: 'ZZ Privado SA', tax_id: '30-71234567-9', emails: ['privado@zz.test'], status: 'active',
  }).select('id').single(), 'cliente privado')
  const PR = (await entrante('z', '5491155554444', 'Hola, ¿precio de la llave?', 'ZZ Privacidad')).conversation_id
  ok(await s.from('whatsapp_conversations').update({ customer_id: cliente.id, vinculo_origen: 'manual' }).eq('id', PR), 'vincular')
  let pedidoOpenAI = null
  const clienteMock = {
    models: { retrieve: async () => ({ id: 'gpt-5.6-luna' }) },
    responses: {
      create: async (params) => {
        pedidoOpenAI = JSON.stringify(params)
        return {
          model: 'gpt-5.6-luna', status: 'completed', incomplete_details: null,
          output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ summary: 'ZZ', topics: [], conversation_state: 'en_curso', requires_attention: false, items: [] }) }] }],
          usage: { input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
        }
      },
    },
  }
  avanzar(61)
  await lote(proveedorOpenAI(clienteMock, { modelo: 'gpt-5.6-luna', esfuerzo: 'low' }))
  cmp('el worker armó el pedido a OpenAI (mock)', true, !!pedidoOpenAI)
  const pedido = pedidoOpenAI ?? ''
  const { data: msgsPR } = await s.from('whatsapp_messages').select('id').eq('conversation_id', PR)
  const prohibidos = {
    'teléfono': ['5491155554444', '+5491155554444', '11 5555-4444'],
    'company_id': [Z],
    'customer_id': [cliente.id],
    'conversation_id': [PR],
    'ids de mensajes': msgsPR.map((m) => m.id),
    'CUIT': ['30-71234567-9', '30712345679'],
    'email': ['privado@zz.test'],
  }
  for (const [que, valores] of Object.entries(prohibidos)) {
    cmp(`el pedido NO contiene ${que}`, false, valores.some((v) => pedido.includes(v)))
  }
  cmp('el pedido no contiene NINGÚN uuid', false, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(pedido))
  cmp('store: false, reasoning low, max 4000, modelo luna', true,
    /"store":false/.test(pedido) && /"effort":"low"/.test(pedido) && /"max_output_tokens":4000/.test(pedido) && /"model":"gpt-5.6-luna"/.test(pedido))
  const texto = construirEntradaUsuario({ contacto: 'X', resumenPrevio: 'R', abiertosPrevios: [], mensajes: [], zonaHoraria: zona })
  cmp('la entrada sólo tiene contacto, zona, resumen, abiertos y mensajes', 'Contacto|Zona horaria|Resumen previo|Items ya abiertos|Mensajes nuevos',
    texto.split('\n').map((l) => l.split(':')[0]).join('|'))

  // ── 15 · Aislamiento ────────────────────────────────────────────────────
  seccion('15 · Aislamiento entre empresas')

  ok(await adminY.c.rpc('guardar_config_ia_whatsapp', { p_company: Y, p_version: null, p_config: { enabled: true, auto_analyze: true, analysis_debounce_seconds: 3600 } }), 'Y automática')
  await entrante('y', '5491100000201', '¿Precio?', 'ZZ Y')
  cmp('Y: ahora sí encola', 'pending', (await trabajo(YC)).status)
  avanzar(61)
  const rZ = await lote(espia())
  cmp('el lote acotado a Z no toca el trabajo de Y', 'pending', (await trabajo(YC)).status)
  cmp('…ni lo cuenta', true, rZ.reclamados === 0 || !(await s.from('whatsapp_ai_runs').select('id').eq('conversation_id', YC)).data.length)
  cmp('el admin de Z no ve la cola de Y', 0, (await admin.c.from('whatsapp_ai_analysis_queue').select('conversation_id').eq('company_id', Y)).data.length)
  cmp('el admin de Y no ve la cola de Z', 0, (await adminY.c.from('whatsapp_ai_analysis_queue').select('conversation_id').eq('company_id', Z)).data.length)
  cmp('vendedor no ve la cola', 0, (await vend.c.from('whatsapp_ai_analysis_queue').select('conversation_id')).data?.length ?? 0)

  // ── 16 · Limpieza e invariantes ─────────────────────────────────────────
  seccion('16 · Limpieza e invariantes')

  await limpiar()
  creados.empresas = []
  cmp('sin empresas de fixture', 0, await cuenta('companies', (q) => q.like('slug', `${MARCA}-%`)))
  cmp('sin trabajos de fixture en la cola', 0, await cuenta('whatsapp_ai_analysis_queue', (q) => q.in('company_id', [Z, Y])))
  const despues = {
    runs: await cuenta('whatsapp_ai_runs', (q) => q.in('company_id', prodIds)),
    items: await cuenta('whatsapp_ai_items', (q) => q.in('company_id', prodIds)),
    resumenes: await cuenta('whatsapp_conversation_ai_summary', (q) => q.in('company_id', prodIds)),
    cola: await cuenta('whatsapp_ai_analysis_queue', (q) => q.in('company_id', prodIds)),
    informes: await cuenta('whatsapp_ai_reports', (q) => q.in('company_id', prodIds)),
    mensajes: await cuenta('whatsapp_messages', (q) => q.in('company_id', prodIds)),
  }
  cmp('producción idéntica al baseline', JSON.stringify(baseProd), JSON.stringify(despues))
  const { data: prodSet2 } = await s.from('whatsapp_ai_settings').select('*').in('company_id', prodIds)
  // No «sigue apagada» —puede estar encendida por decisión de negocio— sino
  // «sigue exactamente como estaba antes de esta corrida».
  cmp('la configuración de producción quedó intacta', configProdAntes,
    JSON.stringify([...prodSet2].sort((a, b) => a.company_id.localeCompare(b.company_id))))
}

main()
  .catch(async (e) => {
    fallos++
    console.log(`\n  EXCEPCIÓN: ${e.message}`)
    await limpiar().catch(() => {})
  })
  .finally(() => {
    console.log('\n' + '='.repeat(78))
    console.log(`  RESULTADO: ${fallos} FALLOS`)
    console.log('='.repeat(78))
    process.exit(fallos ? 1 : 0)
  })
