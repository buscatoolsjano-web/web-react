/**
 * Cliente de Gmail, server-side.
 *
 * La lógica de sincronización habla con esta interfaz y nunca con `fetch`. Eso
 * es lo que permite probar el algoritmo entero —incluidos el 404 de historial,
 * los eventos fuera de orden y el resync completo— sin tocar `info@`.
 *
 * Durante el sync NO se piden cuerpos. `format=metadata` con una lista corta de
 * headers alcanza para la bandeja, y es la diferencia entre traer 766 kB por
 * request y traer unos pocos KB.
 */

export interface MensajeGmail {
  id: string
  threadId: string
  labelIds: string[]
  snippet: string
  /** Epoch en milisegundos, como string. Gmail lo llama internalDate. */
  internalDate: string
  sizeEstimate?: number | undefined
  headers: Record<string, string>
  tieneAdjuntos: boolean
}

export interface HiloGmail {
  id: string
  historyId: string
  mensajes: MensajeGmail[]
}

export interface PaginaHistorial {
  /** Ids de hilo tocados en esta página. */
  hilosTocados: string[]
  /** El historyId más alto visto. */
  historyId: string | null
  siguientePagina: string | null
}

export interface PaginaHilos {
  hilos: string[]
  siguientePagina: string | null
}

export interface RespuestaWatch {
  historyId: string
  /** Epoch en milisegundos, como string. */
  expiration: string
}

/** El error que distingue «historial vencido» de cualquier otro fallo. */
export class HistorialVencido extends Error {
  constructor(historyId: string) {
    super(`El historial de Gmail venció para historyId=${historyId}`)
    this.name = 'HistorialVencido'
  }
}

export class ErrorGmail extends Error {
  constructor(
    readonly status: number,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'ErrorGmail'
  }

  /**
   * ¿Vale la pena reintentar?
   *
   * 429 y 5xx sí. 401 y 403 no: o el token se rompió o falta la autorización de
   * DWD, y reintentar en loop no lo arregla — hay que mirar.
   */
  get reintentable(): boolean {
    return this.status === 429 || this.status >= 500
  }
}

export interface ClienteGmail {
  /** Prueba de vida que no lee ni muta nada. La primera llamada real usa ésta. */
  perfil(buzon: string): Promise<{ emailAddress: string; historyId: string; messagesTotal: number }>

  listarHistorial(
    buzon: string,
    desdeHistoryId: string,
    pagina?: string,
  ): Promise<PaginaHistorial>

  /** Para el resync completo. Sólo ids: los metadatos se piden por hilo. */
  listarHilos(buzon: string, pagina?: string): Promise<PaginaHilos>

  /** Metadata del hilo, SIN cuerpos. */
  hiloMetadata(buzon: string, hiloId: string): Promise<HiloGmail | null>

  /** El hilo completo, con cuerpos. Sólo bajo demanda, al abrirlo. */
  hiloCompleto(buzon: string, hiloId: string): Promise<unknown>

  adjunto(buzon: string, mensajeId: string, adjuntoId: string): Promise<{ data: string; size: number }>

  iniciarWatch(buzon: string, topic: string): Promise<RespuestaWatch>
}

const API = 'https://gmail.googleapis.com/gmail/v1/users'

/** Los únicos headers que necesita la bandeja. Pedir más es traer de más. */
const HEADERS_BANDEJA = ['From', 'To', 'Cc', 'Subject', 'Date', 'Message-ID']

function aplanarHeaders(payload: unknown): Record<string, string> {
  const salida: Record<string, string> = {}
  const p = payload as { headers?: Array<{ name?: string; value?: string }> } | undefined
  for (const h of p?.headers ?? []) {
    if (h.name) salida[h.name.toLowerCase()] = h.value ?? ''
  }
  return salida
}

/** Recorre las partes buscando un adjunto de verdad, no una parte de texto. */
function detectarAdjuntos(payload: unknown): boolean {
  const p = payload as
    | { filename?: string; body?: { attachmentId?: string }; parts?: unknown[] }
    | undefined
  if (!p) return false
  if (p.filename && p.filename.length > 0 && p.body?.attachmentId) return true
  for (const parte of p.parts ?? []) {
    if (detectarAdjuntos(parte)) return true
  }
  return false
}

export class ClienteGmailReal implements ClienteGmail {
  constructor(private readonly token: (buzon: string) => Promise<string>) {}

  private async pedir(buzon: string, ruta: string, init?: RequestInit): Promise<unknown> {
    const t = await this.token(buzon)
    const r = await fetch(`${API}/${encodeURIComponent(buzon)}${ruta}`, {
      ...init,
      headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${t}` },
    })
    if (!r.ok) {
      const detalle = await r.text().catch(() => '')
      throw new ErrorGmail(r.status, detalle.slice(0, 300))
    }
    return r.json()
  }

  async perfil(buzon: string) {
    const j = (await this.pedir(buzon, '/profile')) as {
      emailAddress: string
      historyId: string
      messagesTotal: number
    }
    return j
  }

  async listarHistorial(buzon: string, desdeHistoryId: string, pagina?: string): Promise<PaginaHistorial> {
    const q = new URLSearchParams({ startHistoryId: desdeHistoryId })
    if (pagina) q.set('pageToken', pagina)
    let j: {
      history?: Array<{ id?: string; messages?: Array<{ threadId?: string }> }>
      historyId?: string
      nextPageToken?: string
    }
    try {
      j = (await this.pedir(buzon, `/history?${q}`)) as typeof j
    } catch (e) {
      // Google: «If the startHistoryId supplied by your client is outside the
      // available range of history records, the Gmail API returns an HTTP 404».
      if (e instanceof ErrorGmail && e.status === 404) throw new HistorialVencido(desdeHistoryId)
      throw e
    }
    const hilos = new Set<string>()
    for (const h of j.history ?? []) {
      for (const m of h.messages ?? []) {
        if (m.threadId) hilos.add(m.threadId)
      }
    }
    return {
      hilosTocados: [...hilos],
      historyId: j.historyId ?? null,
      siguientePagina: j.nextPageToken ?? null,
    }
  }

  async listarHilos(buzon: string, pagina?: string): Promise<PaginaHilos> {
    const q = new URLSearchParams({ maxResults: '100' })
    if (pagina) q.set('pageToken', pagina)
    const j = (await this.pedir(buzon, `/threads?${q}`)) as {
      threads?: Array<{ id?: string }>
      nextPageToken?: string
    }
    return {
      hilos: (j.threads ?? []).map((t) => t.id).filter((x): x is string => !!x),
      siguientePagina: j.nextPageToken ?? null,
    }
  }

  async hiloMetadata(buzon: string, hiloId: string): Promise<HiloGmail | null> {
    const q = new URLSearchParams({ format: 'metadata' })
    for (const h of HEADERS_BANDEJA) q.append('metadataHeaders', h)
    let j: {
      id?: string
      historyId?: string
      messages?: Array<{
        id?: string
        threadId?: string
        labelIds?: string[]
        snippet?: string
        internalDate?: string
        sizeEstimate?: number
        payload?: unknown
      }>
    }
    try {
      j = (await this.pedir(buzon, `/threads/${encodeURIComponent(hiloId)}?${q}`)) as typeof j
    } catch (e) {
      // El hilo se borró entre el evento y la lectura. No es un error.
      if (e instanceof ErrorGmail && e.status === 404) return null
      throw e
    }
    return {
      id: j.id ?? hiloId,
      historyId: j.historyId ?? '',
      mensajes: (j.messages ?? []).map((m) => ({
        id: m.id ?? '',
        threadId: m.threadId ?? hiloId,
        labelIds: m.labelIds ?? [],
        snippet: m.snippet ?? '',
        internalDate: m.internalDate ?? '0',
        sizeEstimate: m.sizeEstimate,
        headers: aplanarHeaders(m.payload),
        tieneAdjuntos: detectarAdjuntos(m.payload),
      })),
    }
  }

  async hiloCompleto(buzon: string, hiloId: string): Promise<unknown> {
    return this.pedir(buzon, `/threads/${encodeURIComponent(hiloId)}?format=full`)
  }

  async adjunto(buzon: string, mensajeId: string, adjuntoId: string) {
    const j = (await this.pedir(
      buzon,
      `/messages/${encodeURIComponent(mensajeId)}/attachments/${encodeURIComponent(adjuntoId)}`,
    )) as { data?: string; size?: number }
    return { data: j.data ?? '', size: j.size ?? 0 }
  }

  async iniciarWatch(buzon: string, topic: string): Promise<RespuestaWatch> {
    const j = (await this.pedir(buzon, '/watch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topicName: topic, labelIds: ['INBOX'], labelFilterBehavior: 'INCLUDE' }),
    })) as { historyId?: string; expiration?: string }
    if (!j.historyId || !j.expiration) throw new Error('watch no devolvió historyId/expiration')
    return { historyId: j.historyId, expiration: j.expiration }
  }
}
