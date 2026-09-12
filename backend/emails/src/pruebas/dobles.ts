/**
 * Dobles de prueba: un Gmail falso y un almacén en memoria.
 *
 * Existen para que el algoritmo de sincronización se pruebe entero —incluidos
 * el 404 de historial, los eventos fuera de orden, el lease y el resync— **sin
 * tocar `info@buscatools.com.ar` ni una sola vez**.
 *
 * Ningún dato de acá sale de correo real: los hilos son inventados.
 */
import type {
  ClienteGmail,
  HiloGmail,
  PaginaHilos,
  PaginaHistorial,
  RespuestaWatch,
} from '../google/gmail.js'
import { HistorialVencido } from '../google/gmail.js'
import type { Almacen, CuentaEmail, EntradaSync, FilaHilo } from '../almacen.js'

export interface HiloFalso {
  id: string
  historyId: string
  asunto: string
  de: string
  para: string
  cuando: number
  etiquetas?: string[]
  adjuntos?: boolean
}

export function hilo(h: HiloFalso): HiloGmail {
  return {
    id: h.id,
    historyId: h.historyId,
    mensajes: [
      {
        id: `${h.id}-m1`,
        threadId: h.id,
        labelIds: h.etiquetas ?? ['INBOX'],
        snippet: `extracto de ${h.asunto}`,
        internalDate: String(h.cuando),
        sizeEstimate: 2048,
        headers: { from: h.de, to: h.para, subject: h.asunto },
        tieneAdjuntos: h.adjuntos ?? false,
      },
    ],
  }
}

export class GmailFalso implements ClienteGmail {
  /** Historial: historyId → ids de hilo tocados. */
  readonly historial = new Map<string, string[]>()
  readonly hilos = new Map<string, HiloGmail>()
  historyIdActual = '1000'
  /** Si se prende, `listarHistorial` tira HistorialVencido. */
  vencerHistorial = false
  readonly llamadas: string[] = []

  agregar(h: HiloGmail, enHistoryId: string): void {
    this.hilos.set(h.id, h)
    const previos = this.historial.get(enHistoryId) ?? []
    this.historial.set(enHistoryId, [...previos, h.id])
    if (BigInt(enHistoryId) > BigInt(this.historyIdActual)) this.historyIdActual = enHistoryId
  }

  async perfil(buzon: string) {
    this.llamadas.push('perfil')
    return { emailAddress: buzon, historyId: this.historyIdActual, messagesTotal: this.hilos.size }
  }

  async listarHistorial(_buzon: string, desde: string): Promise<PaginaHistorial> {
    this.llamadas.push(`historial:${desde}`)
    if (this.vencerHistorial) throw new HistorialVencido(desde)
    const tocados = new Set<string>()
    for (const [hid, ids] of this.historial) {
      if (BigInt(hid) > BigInt(desde)) for (const id of ids) tocados.add(id)
    }
    return { hilosTocados: [...tocados], historyId: this.historyIdActual, siguientePagina: null }
  }

  async listarHilos(_buzon?: string, _pagina?: string, consulta?: string): Promise<PaginaHilos> {
    this.llamadas.push(`listarHilos${consulta ? ':' + consulta : ''}`)
    return { hilos: [...this.hilos.keys()], siguientePagina: null }
  }

  async hiloMetadata(_buzon: string, id: string): Promise<HiloGmail | null> {
    this.llamadas.push(`hilo:${id}`)
    return this.hilos.get(id) ?? null
  }

  /** Ids que el falso reporta como «con adjunto». La suite los fija. */
  conAdjunto = new Set<string>()

  async hilosConAdjunto(_buzon: string, consulta: string): Promise<Set<string>> {
    this.llamadas.push(`conAdjunto:${consulta}`)
    return new Set(this.conAdjunto)
  }

  async hiloCompleto(_buzon: string, id: string): Promise<unknown> {
    this.llamadas.push(`hiloCompleto:${id}`)
    return this.hilos.get(id) ?? null
  }

  async adjunto(): Promise<{ data: string; size: number }> {
    this.llamadas.push('adjunto')
    return { data: '', size: 0 }
  }

  async iniciarWatch(): Promise<RespuestaWatch> {
    this.llamadas.push('watch')
    return {
      historyId: this.historyIdActual,
      expiration: String(Date.now() + 7 * 24 * 3600 * 1000),
    }
  }
}

export class AlmacenMemoria implements Almacen {
  readonly cuentas = new Map<string, CuentaEmail>()
  readonly hilos = new Map<string, FilaHilo>()
  /** Simula email_thread_state: la suite comprueba que NUNCA se toque. */
  readonly estados = new Map<string, { workflow_status: string; assigned_to: string | null }>()
  readonly logs: EntradaSync[] = []
  readonly errores: string[] = []

  constructor(cuenta: CuentaEmail) {
    this.cuentas.set(cuenta.id, { ...cuenta })
  }

  private clave(f: { account_id: string; gmail_thread_id: string }): string {
    return `${f.account_id}|${f.gmail_thread_id}`
  }

  async cuentaPorDireccion(d: string): Promise<CuentaEmail | null> {
    for (const c of this.cuentas.values()) if (c.email_address === d && c.active) return { ...c }
    return null
  }

  async cuentaPorId(id: string): Promise<CuentaEmail | null> {
    const c = this.cuentas.get(id)
    return c ? { ...c } : null
  }

  async cuentasActivas(): Promise<CuentaEmail[]> {
    return [...this.cuentas.values()].filter((c) => c.active).map((c) => ({ ...c }))
  }

  async tomarLease(id: string, dueno: string): Promise<CuentaEmail | null> {
    const c = this.cuentas.get(id)
    if (!c || !c.active) return null
    const tomado = c.sync_lock_until && new Date(c.sync_lock_until).getTime() > Date.now()
    if (tomado) return null
    c.sync_lock_until = new Date(Date.now() + 5 * 60_000).toISOString()
    c.sync_lock_owner = dueno
    return { ...c }
  }

  async soltarLease(id: string, dueno: string): Promise<void> {
    const c = this.cuentas.get(id)
    if (c && c.sync_lock_owner === dueno) {
      c.sync_lock_until = null
      c.sync_lock_owner = null
    }
  }

  async avanzarHistory(id: string, historyId: string, full: boolean): Promise<void> {
    const c = this.cuentas.get(id)
    if (!c) return
    // Igual que la RPC: comparación numérica, y nunca hacia atrás.
    if (c.last_history_id === null || BigInt(historyId) > BigInt(c.last_history_id)) {
      c.last_history_id = historyId
    }
    if (full) c.watch_expiration = c.watch_expiration ?? null
  }

  async upsertHilos(filas: FilaHilo[]): Promise<void> {
    for (const f of filas) this.hilos.set(this.clave(f), { ...f })
  }

  async registrarSync(e: EntradaSync): Promise<void> {
    this.logs.push(e)
  }

  async guardarWatch(id: string, historyId: string, expiration: string): Promise<void> {
    const c = this.cuentas.get(id)
    if (!c) return
    c.watch_expiration = new Date(Number(expiration)).toISOString()
    await this.avanzarHistory(id, historyId, false)
  }

  async registrarError(_id: string, error: string): Promise<void> {
    this.errores.push(error)
  }
}

export function cuentaDePrueba(sobreescribir: Partial<CuentaEmail> = {}): CuentaEmail {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    company_id: '22222222-2222-2222-2222-222222222222',
    email_address: 'buzon@prueba.invalid',
    provider: 'gmail',
    auth_mode: 'dwd',
    active: true,
    last_history_id: '1000',
    watch_expiration: null,
    sync_lock_until: null,
    sync_lock_owner: null,
    ...sobreescribir,
  }
}
