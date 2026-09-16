/**
 * Lógica pura de `whatsapp-send-message`: qué pedido es válido, qué error de
 * Meta es cuál y qué se le cuenta a la persona.
 *
 * Sin Deno ni red, para testearla desde vitest.
 */

export const ORIGENES_PERMITIDOS = [
  'https://app.buscatools.com',
  'http://localhost:5173',
  'http://localhost:3000',
] as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Meta corta el texto en 4096 caracteres. Se valida acá y en la base. */
export const MAX_TEXTO = 4096

export interface Pedido {
  conversationId: string
  texto: string
  clientRequestId: string
}

export type ErrorPedido = {
  error: 'datos_invalidos' | 'campos_no_permitidos' | 'texto_vacio' | 'texto_largo'
  campo?: string
}

const CAMPOS = ['conversation_id', 'texto', 'client_request_id'] as const

/**
 * Valida el cuerpo tal como llega. Cualquier campo de más se rechaza.
 *
 * Lo que NO se acepta nunca, y por eso no está en la lista: `phone_number_id`,
 * `waba_id`, `to`, `access_token`. El destinatario y la cuenta salen de la
 * conversación, resueltos server-side. Si el cliente pudiera elegirlos, el
 * primero que consiga un JWT manda WhatsApp a cualquier número con nuestro
 * número de empresa.
 */
export function validarPedido(cuerpo: unknown): Pedido | ErrorPedido {
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) return { error: 'datos_invalidos' }
  const c = cuerpo as Record<string, unknown>

  for (const clave of Object.keys(c)) {
    if (!(CAMPOS as readonly string[]).includes(clave)) return { error: 'campos_no_permitidos', campo: clave }
  }

  const conversationId = c.conversation_id
  const clientRequestId = c.client_request_id
  const texto = c.texto

  if (typeof conversationId !== 'string' || !UUID.test(conversationId)) {
    return { error: 'datos_invalidos', campo: 'conversation_id' }
  }
  if (typeof clientRequestId !== 'string' || !UUID.test(clientRequestId)) {
    return { error: 'datos_invalidos', campo: 'client_request_id' }
  }
  if (typeof texto !== 'string') return { error: 'datos_invalidos', campo: 'texto' }
  if (texto.trim() === '') return { error: 'texto_vacio' }
  if (texto.length > MAX_TEXTO) return { error: 'texto_largo' }

  return { conversationId, texto, clientRequestId }
}

// ── Errores ────────────────────────────────────────────────────────────────

/** Los códigos que puede levantar `encolar_mensaje_whatsapp`, con su status. */
export const CODIGOS_BASE: Record<string, number> = {
  CONVERSACION_INEXISTENTE: 404,
  SIN_ACCESO: 403,
  SIN_PERMISO: 403,
  CUENTA_INACTIVA: 409,
  TEMPLATE_REQUIRED: 409,
  TEXTO_VACIO: 400,
  TEXTO_DEMASIADO_LARGO: 400,
  CLIENT_REQUEST_ID_REQUERIDO: 400,
}

/** Del mensaje crudo de Postgres al código estable. Nunca se devuelve el crudo. */
export function codigoDeErrorBase(mensaje: string | undefined): string | null {
  if (!mensaje) return null
  return Object.keys(CODIGOS_BASE).find((c) => mensaje.includes(c)) ?? null
}

export interface ErrorMeta {
  /** Status HTTP de Graph. */
  status: number
  code: number | null
  subcode: number | null
  /** Texto acotado y sin datos sensibles, apto para guardar y mostrar. */
  detalle: string
  /** `true` si reintentar más tarde tiene sentido (429 y 5xx). */
  reintentable: boolean
}

/**
 * Respuesta de error de Graph → algo que se puede guardar y mostrar.
 *
 * Nunca se propaga el cuerpo crudo: Meta devuelve `fbtrace_id` y a veces
 * repite parte del pedido, y el pedido lleva el teléfono del cliente.
 *
 * La lógica va sobre `code` y `error_subcode`, no sobre el título: Meta avisó
 * que los títulos se deprecan.
 */
export function interpretarErrorMeta(status: number, cuerpo: unknown): ErrorMeta {
  const raiz = cuerpo && typeof cuerpo === 'object' ? (cuerpo as Record<string, unknown>) : {}
  const e = raiz.error && typeof raiz.error === 'object' ? (raiz.error as Record<string, unknown>) : {}

  const code = typeof e.code === 'number' ? e.code : null
  const subcode = typeof e.error_subcode === 'number' ? e.error_subcode : null
  const datos = e.error_data && typeof e.error_data === 'object' ? (e.error_data as Record<string, unknown>) : {}
  const detalle =
    (typeof datos.details === 'string' && datos.details) ||
    (typeof e.message === 'string' && e.message) ||
    `Meta respondió ${status}`

  return {
    status,
    code,
    subcode,
    detalle: detalle.slice(0, 500),
    reintentable: status === 429 || status >= 500,
  }
}

/** Qué le decimos a la persona. Corto, en castellano y sin jerga de Graph. */
export function mensajeParaLaPersona(e: ErrorMeta): string {
  if (e.status === 401 || e.status === 403) {
    return 'WhatsApp rechazó la credencial del servidor. Avisale a quien administra la integración.'
  }
  if (e.status === 429) return 'WhatsApp está limitando los envíos. Probá de nuevo en un rato.'
  if (e.status >= 500) return 'WhatsApp no está respondiendo. El mensaje no se envió; probá de nuevo.'
  // 131047 y 131051 son «fuera de la ventana» y «tipo no soportado».
  if (e.code === 131047) return 'Pasaron más de 24 horas desde el último mensaje del cliente: hace falta una plantilla aprobada.'
  if (e.code === 131026) return 'El número no tiene WhatsApp o no puede recibir mensajes.'
  return 'WhatsApp rechazó el mensaje. Revisá el número y el contenido.'
}

/** El cuerpo que espera Graph para un texto. */
export function cuerpoDeTexto(destino: string, texto: string): Record<string, unknown> {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: destino,
    type: 'text',
    // `preview_url` en false: un enlace del catálogo no tiene que disparar una
    // previsualización que Meta va a buscar por su cuenta.
    text: { preview_url: false, body: texto },
  }
}
