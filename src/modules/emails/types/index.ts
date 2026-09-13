/**
 * Tipos del módulo de Emails.
 *
 * Dos orígenes, y no se mezclan:
 *
 *  · El ÍNDICE y el TRABAJO del ERP — Supabase: `email_threads`,
 *    `email_thread_state`, `email_thread_reads`. Nunca un cuerpo.
 *  · El CONTENIDO — Gmail, a través del servicio de Cloud Run, bajo demanda.
 *    Vive en memoria mientras el hilo está abierto y no se persiste.
 */

export const ESTADOS_TRABAJO = ['pendiente', 'en_proceso', 'resuelto'] as const
export type EstadoTrabajo = (typeof ESTADOS_TRABAJO)[number]

/** `yo`, `nadie` o el uuid de un usuario. */
export type FiltroAsignado = string
export type FiltroCliente = 'con' | 'sin'

export interface FiltrosEmails {
  q: string
  soloNoLeidos: boolean
  estado: EstadoTrabajo | null
  /** `yo`, `nadie` o el id de un usuario. */
  asignado: FiltroAsignado | null
  cliente: FiltroCliente | null
  soloConAdjuntos: boolean
  /** Sólo tiene sentido con más de una cuenta. */
  cuenta: string | null
  pagina: number
  porPagina: number
}

export const FILTROS_INICIALES: FiltrosEmails = {
  q: '',
  soloNoLeidos: false,
  estado: null,
  asignado: null,
  cliente: null,
  soloConAdjuntos: false,
  cuenta: null,
  pagina: 1,
  porPagina: 25,
}

/** Una fila de la bandeja. Sólo metadata. */
export interface FilaBandeja {
  id: string
  accountId: string
  gmailThreadId: string
  asunto: string | null
  extracto: string | null
  ultimoMensajeEn: string | null
  ultimoRemitente: string | null
  ultimaDireccion: 'in' | 'out' | null
  participantes: string[]
  cantidadMensajes: number
  tieneAdjuntos: boolean
  estado: EstadoTrabajo
  asignadoA: string | null
  asignadoNombre: string | null
  clienteId: string | null
  clienteNombre: string | null
  vinculoOrigen: string | null
  sinLeer: boolean
}

export interface PaginaBandeja {
  filas: FilaBandeja[]
  total: number
  totalSinLeer: number
}

export interface CuentaEmail {
  id: string
  direccion: string
  nombre: string | null
  errorSync: string | null
  errorSyncEn: string | null
  ultimaSync: string | null
}

/** El hilo en el índice, para la página de detalle. */
export interface HiloIndice {
  id: string
  accountId: string
  gmailThreadId: string
  asunto: string | null
  participantes: string[]
  ultimoMensajeEn: string | null
  cantidadMensajes: number
  tieneAdjuntos: boolean
}

export interface EstadoHilo {
  estado: EstadoTrabajo
  asignadoA: string | null
  clienteId: string | null
  contactoId: string | null
  vinculoOrigen: string | null
}

export interface UsuarioAsignable {
  id: string
  nombre: string
}

export type ClaseSugerencia = 'exacto' | 'sugerido_dominio' | 'ambiguo'

export interface SugerenciaCliente {
  clienteId: string
  clienteNombre: string
  contactoId: string | null
  contactoNombre: string | null
  direccion: string
  clase: ClaseSugerencia
}

export interface ClienteVinculado {
  id: string
  nombre: string
  referencia: string | null
  contactos: Array<{ id: string; nombre: string; email: string | null; telefono: string | null }>
}

// ── Contenido desde Cloud Run ────────────────────────────────────────────
// Espejo explícito de backend/emails/src/api/mensajes.ts. Son dos proyectos de
// TypeScript separados; si cambia uno, cambia el otro.

export interface AdjuntoContenido {
  partId: string
  nombre: string
  mime: string
  tamano: number
  contentId: string | null
  inline: boolean
}

export interface MensajeContenido {
  id: string
  fecha: number
  de: string
  para: string
  cc: string
  asunto: string
  noLeidoGmail: boolean
  html: string | null
  texto: string | null
  truncado: boolean
  adjuntos: AdjuntoContenido[]
}

export interface HiloContenido {
  id: string
  asunto: string
  mensajes: MensajeContenido[]
}

export type CodigoErrorContenido =
  | 'no_configurado'
  | 'sin_red'
  | 'sesion_invalida'
  | 'hilo_no_disponible'
  | 'adjunto_no_disponible'
  | 'gmail_ocupado'
  | 'demasiadas_solicitudes'
  | 'gmail_no_autorizado'
  | 'gmail_no_disponible'
  | 'indice_no_disponible'
  | 'desconocido'
