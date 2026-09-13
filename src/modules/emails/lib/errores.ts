import type { CodigoErrorContenido } from '../types'

/** Un error del servicio de contenido, ya clasificado. Nunca el texto crudo de Google. */
export class ErrorContenido extends Error {
  constructor(
    readonly codigo: CodigoErrorContenido,
    readonly status: number | null = null,
    readonly reintentarEnSegundos: number | null = null,
    /** El cuerpo JSON de la respuesta, si lo hubo (p. ej. el campo inválido). */
    readonly detalle: unknown = null,
  ) {
    super(codigo)
    this.name = 'ErrorContenido'
  }

  /** ¿Tiene sentido ofrecer «Reintentar»? */
  get reintentable(): boolean {
    return (
      this.codigo === 'sin_red' ||
      this.codigo === 'gmail_ocupado' ||
      this.codigo === 'demasiadas_solicitudes' ||
      this.codigo === 'gmail_no_disponible' ||
      this.codigo === 'indice_no_disponible' ||
      this.codigo === 'desconocido'
    )
  }
}

const CONOCIDOS: readonly CodigoErrorContenido[] = [
  'datos_invalidos',
  'limite_envios',
  'demasiado_grande',
  'borrador_no_disponible',
  'envio_no_disponible',
  'envio_no_configurado',
  'sesion_invalida',
  'hilo_no_disponible',
  'adjunto_no_disponible',
  'gmail_ocupado',
  'demasiadas_solicitudes',
  'gmail_no_autorizado',
  'gmail_no_disponible',
  'indice_no_disponible',
]

/** Del status y el cuerpo JSON del servicio a un código propio. */
export function clasificarRespuesta(status: number, cuerpo: unknown): CodigoErrorContenido {
  const codigo = (cuerpo as { error?: unknown } | null)?.error
  if (typeof codigo === 'string' && (CONOCIDOS as readonly string[]).includes(codigo)) {
    return codigo as CodigoErrorContenido
  }
  if (status === 401) return 'sesion_invalida'
  if (status === 404) return 'hilo_no_disponible'
  if (status === 429) return 'gmail_ocupado'
  if (status >= 500) return 'gmail_no_disponible'
  return 'desconocido'
}

export function mensajeDeError(codigo: CodigoErrorContenido): string {
  switch (codigo) {
    case 'no_configurado':
      return 'El servicio de correo no está configurado en este entorno.'
    case 'sin_red':
      return 'No se pudo contactar al servicio de correo. Revisá la conexión.'
    case 'sesion_invalida':
      return 'Tu sesión venció. Volvé a iniciar sesión.'
    case 'hilo_no_disponible':
      return 'Este hilo no está disponible: puede haberse borrado en Gmail o no tenés acceso.'
    case 'adjunto_no_disponible':
      return 'Ese adjunto no está disponible.'
    case 'gmail_ocupado':
    case 'demasiadas_solicitudes':
      return 'Gmail está limitando las consultas. Probá de nuevo en unos segundos.'
    case 'gmail_no_autorizado':
      return 'El ERP perdió el acceso a Gmail. Avisale a un administrador.'
    case 'indice_no_disponible':
      return 'La base no respondió. Probá de nuevo en unos segundos.'
    case 'gmail_no_disponible':
      return 'Gmail no respondió. Probá de nuevo en unos segundos.'
    case 'datos_invalidos':
      return 'Hay datos inválidos: revisá los destinatarios, el asunto y los adjuntos.'
    case 'limite_envios':
      return 'Se alcanzó el límite de envíos de seguridad. Esperá unos minutos.'
    case 'demasiado_grande':
      return 'El mensaje es demasiado grande. Los adjuntos suman más de 10 MB.'
    case 'borrador_no_disponible':
      return 'Ese borrador ya no existe en Gmail.'
    case 'envio_no_disponible':
      return 'No se pudo enviar: el hilo o la cuenta no están disponibles.'
    case 'envio_no_configurado':
      return 'El envío no está habilitado en este entorno.'
    default:
      return 'No se pudo cargar el contenido.'
  }
}
