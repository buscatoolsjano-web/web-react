import type { Config } from './config.js'
import type { GrupoAutorizado, Politica } from './politica.js'
import { sanearError, type Registro } from './registro.js'

/**
 * Qué grupos están autorizados, según la base y no según el `.env`.
 *
 * Hasta acá la allowlist vivía en una variable de entorno, así que habilitar un
 * grupo obligaba a reiniciar el proceso —y reiniciar un listener de WhatsApp no
 * es gratis: durante el reconnect los mensajes que llegan se pierden—. La tabla
 * `whatsapp_group_allowlist` ya era la fuente de verdad para la base, porque la
 * RPC la valida del lado del servidor; acá el proceso empieza a leer de la
 * misma fuente.
 *
 * El caché es corto y el default es NO.
 */

export interface FuenteDeAllowlist {
  /** Los grupos de ESTA cuenta. Falla si no se pudo leer: no devuelve vacío. */
  leer(): Promise<GrupoAutorizado[]>
}

export interface EstadoDeAllowlist {
  grupos: GrupoAutorizado[]
  /** Cuándo se leyó bien por última vez. `null` = nunca. */
  leidoEn: number | null
}

/**
 * Qué grupos valen ahora mismo.
 *
 * Acá está la decisión difícil de todo el archivo, y es un compromiso que
 * conviene ver escrito:
 *
 * - **si nunca se pudo leer, no hay nada autorizado.** Sin confirmación, no se
 *   ingiere. Eso no se negocia.
 * - **si se leyó bien alguna vez y ahora la base no contesta, la última lista
 *   buena sigue valiendo un rato.** El motivo es que un mensaje que se descarta
 *   NO vuelve: WhatsApp no reenvía a un dispositivo vinculado. Cortar la
 *   ingesta por un hipo de dos segundos de Supabase pierde conversación real y
 *   para siempre, mientras que seguir diez minutos con una lista que cambia una
 *   vez por mes no le hace daño a nadie.
 * - **pasada esa ventana, se deniega todo.** Una base caída media hora es un
 *   problema de verdad, y ahí sí conviene dejar de escribir.
 */
export function gruposVigentes(
  estado: EstadoDeAllowlist,
  ahora: number,
  maxAntiguedadMs: number,
): GrupoAutorizado[] {
  if (estado.leidoEn === null) return []
  if (ahora - estado.leidoEn > maxAntiguedadMs) return []
  return estado.grupos
}

export interface OpcionesPolitica {
  listenerHabilitado: boolean
  /** Cada cuánto se relee la tabla. */
  refrescoMs?: number
  /** Cuánto puede seguir valiendo la última lista buena si la base no contesta. */
  maxAntiguedadMs?: number
  /** Para los tests. */
  ahora?: () => number
}

export const REFRESCO_POR_DEFECTO_MS = 60_000
export const MAX_ANTIGUEDAD_POR_DEFECTO_MS = 10 * 60_000

/**
 * La política, viva: se refresca sola contra la base.
 *
 * `politica()` sigue siendo **síncrona** a propósito. La decisión de qué se
 * ingiere es una función pura y tiene que poder tomarse sin esperar a nadie:
 * si dependiera de una consulta, cada mensaje entrante esperaría a la red y un
 * problema de base se volvería un problema de orden de los mensajes.
 */
export class PoliticaViva {
  private estado: EstadoDeAllowlist = { grupos: [], leidoEn: null }
  private temporizador: ReturnType<typeof setInterval> | null = null
  private readonly refrescoMs: number
  private readonly maxAntiguedadMs: number
  private readonly ahora: () => number

  constructor(
    private readonly fuente: FuenteDeAllowlist,
    private readonly opciones: OpcionesPolitica,
    private readonly registro: Registro,
  ) {
    this.refrescoMs = opciones.refrescoMs ?? REFRESCO_POR_DEFECTO_MS
    this.maxAntiguedadMs = opciones.maxAntiguedadMs ?? MAX_ANTIGUEDAD_POR_DEFECTO_MS
    this.ahora = opciones.ahora ?? Date.now
  }

  politica(): Politica {
    return {
      listenerHabilitado: this.opciones.listenerHabilitado,
      grupos: gruposVigentes(this.estado, this.ahora(), this.maxAntiguedadMs),
    }
  }

  /** Cuántos grupos valen ahora. Para `/health`. */
  get autorizados(): number {
    return this.politica().grupos.filter((g) => g.habilitado).length
  }

  /** Cuándo se leyó bien la tabla por última vez. Para `/health`. */
  get leidoEn(): string | null {
    return this.estado.leidoEn === null ? null : new Date(this.estado.leidoEn).toISOString()
  }

  async refrescar(): Promise<void> {
    try {
      const grupos = await this.fuente.leer()
      const antes = this.estado.grupos
      this.estado = { grupos, leidoEn: this.ahora() }
      // Sólo se registra cuando CAMBIA: un log por minuto de «sigue igual» es
      // ruido que tapa lo que importa.
      if (resumen(antes) !== resumen(grupos)) {
        this.registro.evento('info', 'allowlist_actualizada', {
          autorizados: grupos.filter((g) => g.habilitado).length,
          conIa: grupos.filter((g) => g.iaHabilitada).length,
          total: grupos.length,
        })
      }
    } catch (e) {
      const vigentes = gruposVigentes(this.estado, this.ahora(), this.maxAntiguedadMs).length
      this.registro.evento('aviso', 'allowlist_no_leida', {
        detalle: sanearError(e),
        // Si esto llega a 0, dejó de ingerirse todo: es lo que hay que ver.
        siguenVigentes: vigentes,
      })
    }
  }

  async iniciar(): Promise<void> {
    await this.refrescar()
    this.temporizador = setInterval(() => void this.refrescar(), this.refrescoMs)
    // Que un temporizador no mantenga vivo el proceso al cerrarlo.
    this.temporizador.unref?.()
  }

  detener(): void {
    if (this.temporizador) clearInterval(this.temporizador)
    this.temporizador = null
  }
}

function resumen(grupos: readonly GrupoAutorizado[]): string {
  return [...grupos]
    .map((g) => `${g.idExterno}:${g.habilitado ? 1 : 0}${g.iaHabilitada ? 1 : 0}`)
    .sort()
    .join(',')
}

/**
 * La tabla, por REST.
 *
 * Sin el cliente de Supabase: `fetch` alcanza, y así el listener sigue sin una
 * sola dependencia de runtime más que la librería de WhatsApp.
 */
export class AllowlistSupabase implements FuenteDeAllowlist {
  constructor(private readonly config: Config) {}

  async leer(): Promise<GrupoAutorizado[]> {
    const url = new URL(`${this.config.supabaseUrl}/rest/v1/whatsapp_group_allowlist`)
    url.searchParams.set('select', 'provider_group_id,enabled,ai_enabled')
    url.searchParams.set('account_id', `eq.${this.config.accountId}`)

    const r = await fetch(url, {
      headers: {
        apikey: this.config.supabaseServiceRoleKey,
        Authorization: `Bearer ${this.config.supabaseServiceRoleKey}`,
      },
    })
    if (!r.ok) throw new Error(`allowlist respondió ${r.status}`)

    const filas = (await r.json()) as {
      provider_group_id?: unknown
      enabled?: unknown
      ai_enabled?: unknown
    }[]
    if (!Array.isArray(filas)) throw new Error('allowlist: la respuesta no es una lista')

    return filas
      .filter((f) => typeof f.provider_group_id === 'string' && f.provider_group_id !== '')
      .map((f) => ({
        idExterno: f.provider_group_id as string,
        habilitado: f.enabled === true,
        iaHabilitada: f.ai_enabled === true,
      }))
  }
}
