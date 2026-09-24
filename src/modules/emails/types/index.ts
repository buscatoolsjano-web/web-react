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

/**
 * Una etiqueta del ERP (Fase 28 · E8).
 *
 * NO son las de Gmail. `email_threads.gmail_labels` trae las de allá, y son de
 * sólo lectura: el navegador nunca habla con Gmail. Éstas —«Cotizar»,
 * «Reclamo»— se crean y se ponen acá, y por eso no se mezclan con aquéllas.
 *
 * El color es uno de los seis tonos del sistema, no un hex: un color inventado
 * se ve mal en modo oscuro y nadie lo mira hasta que ya está cargado.
 */
export const COLORES_ETIQUETA = ['neutral', 'info', 'brand', 'success', 'warning', 'danger'] as const
export type ColorEtiqueta = (typeof COLORES_ETIQUETA)[number]

export interface EtiquetaEmail {
  id: string
  nombre: string
  color: ColorEtiqueta
}

/** `yo`, `nadie` o el uuid de un usuario. */
export type FiltroAsignado = string
export type FiltroCliente = 'con' | 'sin'

/**
 * Las carpetas de la bandeja (Fase 28 · E2).
 *
 * `recibidos` y `enviados` son las etiquetas de Gmail (INBOX / SENT), no la
 * dirección del último mensaje: es lo que dice el buzón. Como un hilo puede no
 * estar en ninguna de las dos —archivado en Gmail, o con etiqueta propia—,
 * `todos` sigue siendo la carpeta por defecto y no esconde nada.
 */
export const CARPETAS_BANDEJA = ['todos', 'recibidos', 'enviados', 'eliminados'] as const
export type CarpetaBandeja = (typeof CARPETAS_BANDEJA)[number]

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
  /** Carpeta, no filtro: «Limpiar filtros» no te saca de Enviados. */
  carpeta: CarpetaBandeja
  /** id de una etiqueta del ERP, o null. */
  etiqueta: string | null
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
  carpeta: 'todos',
  etiqueta: null,
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
  /** Sacado de la bandeja del ERP. Sólo aparece en la carpeta «Eliminados». */
  eliminado: boolean
  /** Las etiquetas del ERP puestas en el hilo. */
  etiquetas: EtiquetaEmail[]
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
  /** Reply-To del mensaje, vacío si no lo trae. */
  responderA: string
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
  | 'datos_invalidos'
  | 'limite_envios'
  | 'demasiado_grande'
  | 'borrador_no_disponible'
  | 'envio_no_disponible'
  | 'envio_no_configurado'
  | 'desconocido'

// ── Redactar (entrega 5) ──────────────────────────────────────────────────
// Espejo de backend/emails/src/api/redactar.ts.

export type ModoRedaccion = 'nuevo' | 'responder' | 'responder_todos' | 'reenviar'

/** Un adjunto en el composer. `nuevo` lleva los bytes; los otros, una referencia. */
export type AdjuntoRedaccion =
  | { clave: string; tipo: 'nuevo'; nombre: string; mime: string; tamano: number; datos: string }
  | { clave: string; tipo: 'borrador'; nombre: string; mime: string; tamano: number; partId: string }
  | { clave: string; tipo: 'original'; nombre: string; mime: string; tamano: number; messageId: string; partId: string }

/** De dónde sacó el servidor el modo de un borrador (ver backend: redactar.ts). */
export type OrigenModoBorrador = 'cabecera' | 'in_reply_to' | 'contexto' | 'sin_datos'

export interface BorradorEditable {
  draft_id: string
  thread_id: string | null
  modo: ModoRedaccion
  modo_origen: OrigenModoBorrador
  ref_message_id: string | null
  para: string[]
  cc: string[]
  cco: string[]
  asunto: string
  texto: string
  adjuntos: Array<{ part_id: string; nombre: string; mime: string; tamano: number }>
}

export interface BorradorGuardado {
  draft_id: string
  thread_id: string
  recreado: boolean
  adjuntos: Array<{ part_id: string; nombre: string; mime: string; tamano: number }>
}

export interface ResumenBorradorGmail {
  draft_id: string
  thread_id: string
  asunto: string
  para: string[]
  fecha: string | null
  modo: ModoRedaccion | null
  modo_origen: OrigenModoBorrador
}

/** Por qué un envío sigue sin confirmar. Nunca se reenvía solo. */
export type MotivoIncierto = 'resultado_perdido' | 'sin_coincidencia' | 'conflicto' | 'busqueda_incompleta' | 'busqueda_fallida'

export type ResultadoEnvio =
  | { estado: 'enviado'; gmail_message_id: string; gmail_thread_id: string; repetido: boolean }
  | { estado: 'en_curso' }
  | { estado: 'incierto'; motivo: MotivoIncierto }
  | { estado: 'fallido'; error: string }

export interface SugerenciaDestinatario {
  direccion: string
  nombre: string | null
  clienteId: string | null
  clienteNombre: string | null
  fuente: 'contacto' | 'cliente' | 'historial'
  clientes: number
}
