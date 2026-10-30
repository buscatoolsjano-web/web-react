/**
 * El acceso a Supabase, detrás de una interfaz.
 *
 * La sincronización habla con `Almacen` y nunca con el cliente de Supabase
 * directamente. Eso permite probar el algoritmo entero contra una
 * implementación en memoria, sin base y sin red.
 *
 * El backend usa la **service key** sólo acá, y sólo para lo que no tiene un
 * usuario detrás: el sync y la renovación del watch. Para lo que sí tiene
 * usuario —abrir un hilo, asignar, cambiar estado— se usa el JWT de esa persona
 * y decide la RLS.
 */

export interface CuentaEmail {
  id: string
  company_id: string
  email_address: string
  provider: string
  auth_mode: 'dwd' | 'oauth_user'
  active: boolean
  last_history_id: string | null
  watch_expiration: string | null
  sync_lock_until: string | null
  sync_lock_owner: string | null
}

export interface FilaHilo {
  company_id: string
  account_id: string
  gmail_thread_id: string
  subject: string | null
  snippet: string | null
  last_message_at: string | null
  last_message_from: string | null
  last_message_dir: 'in' | 'out' | null
  participants: string[]
  gmail_labels: string[]
  message_count: number
  has_attachments: boolean
  size_estimate: number
}

export interface EntradaSync {
  account_id: string
  kind: 'push' | 'cron' | 'manual' | 'resync_completo' | 'watch_renovado'
  history_id_desde?: string | null
  history_id_hasta?: string | null
  threads_tocados?: number
  historial_vencido?: boolean
  error_details?: string | null
  duracion_ms?: number
}

/** Datos para vincular una casilla por OAuth (RPC email_vincular_oauth). */
export interface VinculoOAuth {
  company: string
  email: string
  display: string | null
  refreshToken: string
  scope: string
  /** El usuario que autorizó, sacado del `state` firmado del OAuth. */
  connectedBy: string
}

export interface Almacen {
  cuentaPorDireccion(direccion: string): Promise<CuentaEmail | null>
  cuentaPorId(id: string): Promise<CuentaEmail | null>
  cuentasActivas(): Promise<CuentaEmail[]>
  /** El refresh token OAuth descifrado (RPC email_leer_refresh). Sólo con service key. */
  leerRefresh(accountId: string): Promise<string | null>
  /** Vincula o rota una casilla OAuth (RPC email_vincular_oauth). Devuelve el accountId. */
  vincularOauth(datos: VinculoOAuth): Promise<string>
  /** Una sola sentencia. Sin fila = otro lo tiene. */
  tomarLease(cuenta: string, dueno: string): Promise<CuentaEmail | null>
  soltarLease(cuenta: string, dueno: string): Promise<void>
  /** Nunca retrocede el cursor. */
  avanzarHistory(cuenta: string, historyId: string, fullSync: boolean): Promise<void>
  upsertHilos(filas: FilaHilo[]): Promise<void>
  registrarSync(entrada: EntradaSync): Promise<void>
  /**
   * Sólo vencimiento y topic. NO toca el cursor: el historyId que devuelve el
   * watch es el del momento, y usarlo de cursor saltearía los cambios que
   * todavía no se sincronizaron. Ver `renovarWatch`.
   */
  guardarWatch(cuenta: string, expiration: string, topic: string): Promise<void>
  registrarError(cuenta: string, error: string): Promise<void>
}

/** Cliente REST de Supabase, sin SDK: son cinco llamadas y no vale la dependencia. */
export class AlmacenSupabase implements Almacen {
  private readonly headers: Record<string, string>

  constructor(
    private readonly url: string,
    serviceKey: string,
  ) {
    this.headers = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    }
  }

  private async rest(ruta: string, init?: RequestInit): Promise<unknown> {
    const r = await fetch(`${this.url}/rest/v1${ruta}`, {
      ...init,
      headers: { ...this.headers, ...(init?.headers ?? {}) },
    })
    if (!r.ok) {
      const detalle = await r.text().catch(() => '')
      throw new Error(`supabase ${ruta}: HTTP ${r.status} ${detalle.slice(0, 200)}`)
    }
    const txt = await r.text()
    return txt ? JSON.parse(txt) : null
  }

  private async rpc(nombre: string, cuerpo: unknown): Promise<unknown> {
    return this.rest(`/rpc/${nombre}`, { method: 'POST', body: JSON.stringify(cuerpo) })
  }

  async cuentaPorDireccion(direccion: string): Promise<CuentaEmail | null> {
    const q = new URLSearchParams({
      select: '*',
      email_address: `eq.${direccion}`,
      active: 'is.true',
      limit: '1',
    })
    const filas = (await this.rest(`/email_accounts?${q}`)) as CuentaEmail[]
    return filas[0] ?? null
  }

  async cuentaPorId(id: string): Promise<CuentaEmail | null> {
    const q = new URLSearchParams({ select: '*', id: `eq.${id}`, limit: '1' })
    const filas = (await this.rest(`/email_accounts?${q}`)) as CuentaEmail[]
    return filas[0] ?? null
  }

  async cuentasActivas(): Promise<CuentaEmail[]> {
    const q = new URLSearchParams({ select: '*', active: 'is.true' })
    return (await this.rest(`/email_accounts?${q}`)) as CuentaEmail[]
  }

  async leerRefresh(accountId: string): Promise<string | null> {
    const r = (await this.rpc('email_leer_refresh', { p_account: accountId })) as string | null
    return r && r.length > 0 ? r : null
  }

  async vincularOauth(d: VinculoOAuth): Promise<string> {
    return (await this.rpc('email_vincular_oauth', {
      p_company: d.company,
      p_email: d.email,
      p_display: d.display,
      p_refresh_token: d.refreshToken,
      p_scope: d.scope,
      p_connected_by: d.connectedBy,
    })) as string
  }

  async tomarLease(cuenta: string, dueno: string): Promise<CuentaEmail | null> {
    const filas = (await this.rpc('tomar_lease_email', {
      p_account: cuenta,
      p_owner: dueno,
      p_minutos: 5,
    })) as CuentaEmail[]
    return filas?.[0] ?? null
  }

  async soltarLease(cuenta: string, dueno: string): Promise<void> {
    await this.rpc('soltar_lease_email', { p_account: cuenta, p_owner: dueno })
  }

  async avanzarHistory(cuenta: string, historyId: string, fullSync: boolean): Promise<void> {
    await this.rpc('avanzar_history_email', {
      p_account: cuenta,
      p_history_id: historyId,
      p_full_sync: fullSync,
    })
  }

  async upsertHilos(filas: FilaHilo[]): Promise<void> {
    if (filas.length === 0) return
    // De a lotes: un upsert de miles de filas en un request es frágil.
    for (let i = 0; i < filas.length; i += 100) {
      const lote = filas.slice(i, i + 100).map((f) => ({ ...f, synced_at: new Date().toISOString() }))
      await this.rest('/email_threads?on_conflict=account_id,gmail_thread_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(lote),
      })
    }
  }

  async registrarSync(entrada: EntradaSync): Promise<void> {
    await this.rest('/email_sync_log', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(entrada),
    })
  }

  async guardarWatch(cuenta: string, expiration: string, topic: string): Promise<void> {
    await this.rest(`/email_accounts?id=eq.${cuenta}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        watch_expiration: new Date(Number(expiration)).toISOString(),
        watch_topic: topic,
      }),
    })
  }

  async registrarError(cuenta: string, error: string): Promise<void> {
    await this.rest(`/email_accounts?id=eq.${cuenta}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ sync_error: error.slice(0, 500), sync_error_at: new Date().toISOString() }),
    })
  }
}
