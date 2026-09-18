/**
 * La configuración del listener, toda del lado del servidor.
 *
 * Dos cosas que NO salen de acá:
 *
 * - **la empresa y la cuenta no vienen en el evento**. Un mensaje de WhatsApp
 *   es un dato de afuera; si el `company_id` viniera adentro, cualquiera que
 *   pudiera inyectar un evento escribiría en la empresa que quisiera. Vienen
 *   del entorno, se fijan al arrancar y no cambian.
 * - **el número de teléfono no se configura**. La cuenta se identifica por su
 *   uuid en `whatsapp_accounts`; qué número tiene vinculado es un dato de la
 *   base, no una constante del proceso.
 */

export interface Config {
  /**
   * Dónde se guarda lo que se observa.
   *
   * `memoria` es el default y no necesita ni Supabase ni cuenta: sirve para
   * vincular el teléfono y mirar qué llega **antes** de que exista una sola
   * fila en la base. Conectar un dispositivo y decidir dónde se guardan los
   * mensajes son dos cosas distintas, y pedir las cuatro variables para poder
   * escanear un QR obligaría a inventar valores de mentira.
   */
  repositorio: 'memoria' | 'supabase'
  supabaseUrl: string
  /** Sólo del lado del servidor. Nunca llega al navegador. */
  supabaseServiceRoleKey: string
  companyId: string
  accountId: string
  /** El kill switch: en `false` no se ingiere nada y la sesión no se toca. */
  listenerHabilitado: boolean
  /** Dónde vive el estado de sesión. Fuera del repo y fuera del entorno. */
  rutaDeSesion: string
  puertoDeSalud: number
}

export class ConfigInvalida extends Error {
  constructor(readonly faltantes: readonly string[]) {
    super(`Faltan variables de entorno: ${faltantes.join(', ')}`)
    this.name = 'ConfigInvalida'
  }
}

const OBLIGATORIAS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'INTERNAL_WHATSAPP_COMPANY_ID',
  'INTERNAL_WHATSAPP_ACCOUNT_ID',
] as const

/**
 * `LISTENER_ENABLED` arranca en `false` si no está.
 *
 * Un sistema que escucha conversaciones internas no se enciende por olvido: hay
 * que decirlo. Es la misma decisión que tomó la Fase 16 con la IA —«todo nace
 * apagado»— y por la misma razón.
 */
export function leerConfig(entorno: NodeJS.ProcessEnv = process.env): Config {
  const repositorio =
    (entorno['WHATSAPP_REPOSITORIO'] ?? 'memoria').trim() === 'supabase' ? 'supabase' : 'memoria'

  // Las cuatro variables son de la BASE, no de la conexión: se exigen cuando
  // se va a escribir de verdad, y no antes.
  const faltantes = repositorio === 'supabase' ? OBLIGATORIAS.filter((k) => !(entorno[k] ?? '').trim()) : []
  if (faltantes.length > 0) throw new ConfigInvalida(faltantes)

  return {
    repositorio,
    supabaseUrl: (entorno['SUPABASE_URL'] ?? '').trim(),
    supabaseServiceRoleKey: (entorno['SUPABASE_SERVICE_ROLE_KEY'] ?? '').trim(),
    companyId: (entorno['INTERNAL_WHATSAPP_COMPANY_ID'] ?? '').trim(),
    accountId: (entorno['INTERNAL_WHATSAPP_ACCOUNT_ID'] ?? '').trim(),
    listenerHabilitado: (entorno['LISTENER_ENABLED'] ?? '').trim().toLowerCase() === 'true',
    rutaDeSesion: (entorno['WHATSAPP_AUTH_DIR'] ?? '.whatsapp-auth').trim(),
    puertoDeSalud: Number((entorno['HEALTH_PORT'] ?? '8081').trim()) || 8081,
  }
}

/** La config, sin secretos, para poder loguearla al arrancar. */
export function configParaLog(c: Config): Record<string, string | number | boolean> {
  return {
    supabaseUrl: c.supabaseUrl === '' ? '(sin base)' : new URL(c.supabaseUrl).host,
    companyId: c.companyId === '' ? '(sin empresa)' : `${c.companyId.slice(0, 8)}…`,
    accountId: c.accountId === '' ? '(sin cuenta)' : `${c.accountId.slice(0, 8)}…`,
    listenerHabilitado: c.listenerHabilitado,
    puertoDeSalud: c.puertoDeSalud,
  }
}
