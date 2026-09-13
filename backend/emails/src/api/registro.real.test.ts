/**
 * Idempotencia y resultado incierto CONTRA LA BASE REAL, con Gmail FALSO.
 *
 * Lo que las pruebas en memoria no pueden garantizar: que las RPC firmadas de
 * Supabase, con JWT reales y concurrencia real, dejen UNA fila, UN evento y UN
 * envío. Gmail es el doble: no sale ningún correo.
 *
 * Se saltea salvo que se pida explícitamente (NO correr en paralelo con otra
 * suite de base):
 *
 *   set -a; source ../../.env; source ../../.env.migration; set +a
 *   E5_DB_REAL=1 npx vitest run src/api/registro.real.test.ts
 *
 * Fixtures con prefijo zz-e5r-; se borran al final y se verifica que
 * email_send_requests y email_events vuelvan a su número.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { GmailFalso } from '../pruebas/dobles.js'
import { AutorizadorSupabase } from './autorizacion.js'
import { enviar, type ContextoRedactar } from './redactar.js'
import { RegistroSupabase } from './registro.js'

const URL_SB = process.env['VITE_SUPABASE_URL'] ?? ''
const PUB = process.env['VITE_SUPABASE_ANON_KEY'] ?? ''
const SECRET = process.env['SUPABASE_SECRET_KEY'] ?? ''
const ACTIVA = process.env['E5_DB_REAL'] === '1' && !!URL_SB && !!PUB && !!SECRET

const svc = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' }

async function rest(metodo: string, ruta: string, cuerpo?: unknown, extra: Record<string, string> = {}): Promise<unknown> {
  const r = await fetch(`${URL_SB}${ruta}`, {
    method: metodo,
    headers: { ...svc, Prefer: 'return=representation', ...extra },
    ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
  })
  const txt = await r.text()
  if (!r.ok) throw new Error(`${metodo} ${ruta.split('?')[0]}: ${r.status}`)
  return txt ? JSON.parse(txt) : null
}

async function contar(tabla: string, filtro = ''): Promise<number> {
  const r = await fetch(`${URL_SB}/rest/v1/${tabla}?select=id${filtro}`, { method: 'HEAD', headers: { ...svc, Prefer: 'count=exact' } })
  return Number((r.headers.get('content-range') ?? '*/0').split('/')[1])
}

const creados = { usuarios: [] as string[], empresa: '', cuenta: '' }

async function identidad(rol: string): Promise<{ id: string; jwt: string }> {
  const email = `zz-e5r-${rol}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@buscatools.test`
  const password = `Zz${randomUUID()}!`
  const u = (await rest('POST', '/auth/v1/admin/users', { email, password, email_confirm: true })) as { id: string }
  creados.usuarios.push(u.id)
  await rest('POST', '/rest/v1/company_memberships', { company_id: creados.empresa, user_id: u.id, role: rol, status: 'active' })
  const r = await fetch(`${URL_SB}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: PUB, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const s = (await r.json()) as { access_token?: string }
  if (!s.access_token) throw new Error(`login ${rol}`)
  return { id: u.id, jwt: s.access_token }
}

describe.skipIf(!ACTIVA)('registro de envíos contra la base real (Gmail falso)', () => {
  let ctx: ContextoRedactar
  let gmail: GmailFalso
  let empleado: { id: string; jwt: string }
  let buzon = ''
  let antes = { pedidos: 0, eventos: 0 }

  const cuerpo = (crid: string) => ({
    account_id: creados.cuenta,
    client_request_id: crid,
    modo: 'nuevo',
    para: ['destino@e5r.test'],
    cc: [],
    cco: [],
    asunto: 'zz-e5r',
    texto: 'no sale: Gmail es falso',
    adjuntos: [],
  })
  const filas = async (crid: string) =>
    (await rest('GET', `/rest/v1/email_send_requests?select=status,intentos,gmail_message_id&client_request_id=eq.${crid}`)) as Array<{ status: string; intentos: number; gmail_message_id: string | null }>

  beforeAll(async () => {
    antes = { pedidos: await contar('email_send_requests'), eventos: await contar('email_events') }
    const clave = (await rest('POST', '/rest/v1/rpc/clave_api_email_servicio', {})) as string
    if (!/^[0-9a-f]{64}$/.test(clave)) throw new Error('clave HMAC ilegible')
    const [emp] = (await rest('POST', '/rest/v1/companies', { slug: `zz-e5r-${Date.now()}`, name: 'ZZ-E5R', default_currency: 'ARS' })) as Array<{ id: string }>
    creados.empresa = emp!.id
    buzon = `zz-e5r-${Date.now()}@buzon-e5r.test`
    const [cta] = (await rest('POST', '/rest/v1/email_accounts', { company_id: creados.empresa, email_address: buzon, display_name: 'ZZ E5R' })) as Array<{ id: string }>
    creados.cuenta = cta!.id
    empleado = await identidad('employee')
    gmail = new GmailFalso()
    gmail.demoraEnvioMs = 300
    ctx = {
      buzones: new Set([buzon]),
      autorizador: new AutorizadorSupabase(URL_SB, PUB),
      registro: new RegistroSupabase(URL_SB, PUB, Buffer.from(clave, 'hex')),
      gmail,
    }
  }, 60_000)

  afterAll(async () => {
    if (creados.cuenta) {
      for (const t of ['email_send_requests', 'email_events']) await rest('DELETE', `/rest/v1/${t}?account_id=eq.${creados.cuenta}`)
      await rest('DELETE', `/rest/v1/email_accounts?id=eq.${creados.cuenta}`)
    }
    for (const id of creados.usuarios) {
      await rest('DELETE', `/rest/v1/company_memberships?user_id=eq.${id}`)
      await fetch(`${URL_SB}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: svc })
    }
    if (creados.empresa) await rest('DELETE', `/rest/v1/companies?id=eq.${creados.empresa}`)
    expect(await contar('email_send_requests')).toBe(antes.pedidos)
    expect(await contar('email_events')).toBe(antes.eventos)
  }, 60_000)

  it('DIEZ requests simultáneos, mismo client_request_id → 1 fila, 1 envío a Gmail, 1 evento', async () => {
    const crid = randomUUID()
    const rs = await Promise.allSettled(Array.from({ length: 10 }, () => enviar(ctx, empleado.jwt, cuerpo(crid))))
    const estados = rs.map((r) => (r.status === 'fulfilled' ? r.value.estado : `error:${(r.reason as Error).name}`))
    expect(estados.filter((e) => e.startsWith('error'))).toEqual([])
    expect(estados.filter((e) => e === 'enviado').length).toBeGreaterThanOrEqual(1)
    expect(gmail.conteo.enviarMensaje).toBe(1)
    const f = await filas(crid)
    expect(f).toHaveLength(1)
    expect(f[0]!.status).toBe('enviado')
    expect(await contar('email_events', `&account_id=eq.${creados.cuenta}&action=eq.email_enviado`)).toBe(1)

    // Reintentar después: el mismo resultado, sin volver a Gmail.
    const otra = await enviar(ctx, empleado.jwt, cuerpo(crid))
    expect(otra).toMatchObject({ estado: 'enviado', repetido: true })
    expect(gmail.conteo.enviarMensaje).toBe(1)
  }, 60_000)

  it('INCIERTO (Gmail aceptó, respuesta perdida; Message-ID REEMPLAZADO) → reintento RECONCILIA por X-BT-Request-Id, sin reenviar', async () => {
    const crid = randomUUID()
    const envios = gmail.conteo.enviarMensaje
    gmail.falloEnvio = 'aceptado_incierto'
    expect(gmail.reemplazaMessageId).toBe(true)
    expect(await enviar(ctx, empleado.jwt, cuerpo(crid))).toEqual({ estado: 'incierto', motivo: 'resultado_perdido' })
    expect((await filas(crid))[0]!.status).toBe('incierto')
    expect(await contar('email_events', `&account_id=eq.${creados.cuenta}&action=eq.email_enviado`)).toBe(1)

    const r = await enviar(ctx, empleado.jwt, cuerpo(crid))
    expect(r.estado).toBe('enviado')
    expect(gmail.conteo.enviarMensaje).toBe(envios + 1)
    expect(gmail.enviados).toHaveLength(2)
    expect((await filas(crid))[0]!.status).toBe('enviado')
    expect(await contar('email_events', `&account_id=eq.${creados.cuenta}&action=eq.email_enviado`)).toBe(2)
  }, 60_000)

  it('INCIERTO (el pedido se cortó antes de Gmail) → sigue incierto y NUNCA se reenvía solo', async () => {
    const crid = randomUUID()
    const envios = gmail.conteo.enviarMensaje
    gmail.falloEnvio = 'incierto_sin_envio'
    expect(await enviar(ctx, empleado.jwt, cuerpo(crid))).toEqual({ estado: 'incierto', motivo: 'resultado_perdido' })
    for (let i = 0; i < 3; i++) expect(await enviar(ctx, empleado.jwt, cuerpo(crid))).toEqual({ estado: 'incierto', motivo: 'sin_coincidencia' })
    expect(gmail.conteo.enviarMensaje).toBe(envios + 1)
    const f = await filas(crid)
    expect(f).toHaveLength(1)
    expect(f[0]!.status).toBe('incierto')
  }, 60_000)

  it('CONFLICTO real en la base: dos mensajes con el mismo request id → incierto, error_code registrado, 0 eventos', async () => {
    const crid = randomUUID()
    gmail.falloEnvio = 'aceptado_incierto'
    const eventos = await contar('email_events', `&account_id=eq.${creados.cuenta}`)
    await enviar(ctx, empleado.jwt, cuerpo(crid))
    gmail.duplicarEnviado(gmail.enviados.at(-1)!.id)
    expect(await enviar(ctx, empleado.jwt, cuerpo(crid))).toEqual({ estado: 'incierto', motivo: 'conflicto' })
    const [f] = (await rest('GET', `/rest/v1/email_send_requests?select=status,error_code,gmail_message_id,attempted_at,created_at&client_request_id=eq.${crid}`)) as Array<{ status: string; error_code: string; gmail_message_id: string | null; attempted_at: string; created_at: string }>
    expect(f).toMatchObject({ status: 'incierto', error_code: 'conflicto_request_id:2', gmail_message_id: null })
    expect(f!.attempted_at).toBeTruthy()
    expect(await contar('email_events', `&account_id=eq.${creados.cuenta}`)).toBe(eventos)
  }, 60_000)
})
