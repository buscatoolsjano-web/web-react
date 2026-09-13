/**
 * Quién puede abrir un hilo: **lo decide la RLS de Supabase, con el JWT de la
 * persona**, no una copia de la regla escrita acá.
 *
 * El backend pregunta a PostgREST, en nombre del usuario, por la fila del hilo
 * y su cuenta. Si la RLS se la devuelve, puede verla; si no, no. Así la regla
 * «admin y employee de la empresa» vive en UN solo lugar —la policy— y un
 * cambio de roles no obliga a tocar el backend.
 *
 * - JWT inválido o vencido → PostgREST responde 401 → `NoAutenticado`.
 * - JWT válido de alguien sin acceso (vendedor, cliente, otra empresa, anon) →
 *   cero filas → `NoEncontrado`. 404 y no 403 a propósito: no se confirma que
 *   el hilo exista.
 * - Un `gmail_thread_id` que no está en el índice de ESA cuenta → 404. No se
 *   acepta un id arbitrario para ir a buscarlo a Gmail.
 *
 * Este backend público NO tiene la service key de Supabase: no la necesita.
 */

export class NoAutenticado extends Error {
  constructor(motivo: string) {
    super(motivo)
    this.name = 'NoAutenticado'
  }
}

export class NoEncontrado extends Error {
  constructor(motivo: string) {
    super(motivo)
    this.name = 'NoEncontrado'
  }
}

export class IndiceNoDisponible extends Error {
  constructor(motivo: string) {
    super(motivo)
    this.name = 'IndiceNoDisponible'
  }
}

export interface HiloAutorizado {
  accountId: string
  companyId: string
  buzon: string
  gmailThreadId: string
  /** `sub` del JWT, sólo para acotar el ritmo por persona. Nunca se loguea. */
  usuario: string
}

export interface Autorizador {
  autorizarHilo(jwt: string, accountId: string, gmailThreadId: string): Promise<HiloAutorizado>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Los ids de Gmail son hexadecimales. */
const ID_GMAIL = /^[0-9a-f]{6,40}$/i
const PART_ID = /^[0-9]{1,3}(\.[0-9]{1,3}){0,8}$/

export const validar = {
  uuid: (v: string | null): v is string => !!v && UUID.test(v),
  idGmail: (v: string | null): v is string => !!v && ID_GMAIL.test(v),
  partId: (v: string | null): v is string => !!v && PART_ID.test(v),
}

/** El `sub` del JWT, sin verificar la firma: la verificación ya la hizo PostgREST. */
export function subDelJwt(jwt: string): string {
  try {
    const cuerpo = jwt.split('.')[1] ?? ''
    const j = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8')) as { sub?: unknown }
    return typeof j.sub === 'string' ? j.sub : 'desconocido'
  } catch {
    return 'desconocido'
  }
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export class AutorizadorSupabase implements Autorizador {
  constructor(
    private readonly url: string,
    private readonly clavePublica: string,
    private readonly pedir: Fetch = fetch,
  ) {}

  async autorizarHilo(jwt: string, accountId: string, gmailThreadId: string): Promise<HiloAutorizado> {
    const q = new URLSearchParams({
      select: 'account_id,company_id,gmail_thread_id,email_accounts(email_address,active)',
      account_id: `eq.${accountId}`,
      gmail_thread_id: `eq.${gmailThreadId}`,
      limit: '1',
    })
    let r: Response
    try {
      r = await this.pedir(`${this.url}/rest/v1/email_threads?${q}`, {
        headers: { apikey: this.clavePublica, Authorization: `Bearer ${jwt}` },
      })
    } catch (e) {
      throw new IndiceNoDisponible((e as Error).message)
    }
    if (r.status === 401 || r.status === 403) throw new NoAutenticado(`PostgREST ${r.status}`)
    if (!r.ok) throw new IndiceNoDisponible(`PostgREST ${r.status}`)

    const filas = (await r.json()) as Array<{
      account_id: string
      company_id: string
      gmail_thread_id: string
      email_accounts: { email_address: string; active: boolean } | null
    }>
    const f = filas[0]
    if (!f || !f.email_accounts || !f.email_accounts.active) {
      throw new NoEncontrado('hilo no visible para este usuario')
    }
    return {
      accountId: f.account_id,
      companyId: f.company_id,
      buzon: f.email_accounts.email_address,
      gmailThreadId: f.gmail_thread_id,
      usuario: subDelJwt(jwt),
    }
  }
}
