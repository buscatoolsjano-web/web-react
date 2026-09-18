import type { BorradoObservado, EdicionObservada, MensajeObservado, ReferenciaDeMedia, TipoDeChat } from './tipos.js'

/**
 * De lo que manda WhatsApp a lo que entiende el listener.
 *
 * Todo este archivo son funciones puras y **no importa Baileys**. Es a
 * propósito: así se prueba con mensajes de mentira, sin teléfono, sin red y
 * sin sesión, que es la única forma de tener cobertura real de la parte más
 * frágil del sistema. La librería no oficial cambia de forma entre versiones;
 * cuando cambie, los tests de acá dicen exactamente qué se rompió.
 *
 * La forma de entrada se declara estructuralmente —no con los tipos de
 * Baileys— por la misma razón. Un `WAMessage` real encaja en `MensajeCrudo`.
 */

/** Lo que Baileys llama `WAMessageKey`, en lo que nos sirve. */
export interface LlaveCruda {
  remoteJid?: string | null
  fromMe?: boolean | null
  id?: string | null
  participant?: string | null
  /** Con direccionamiento LID, acá viene el jid de teléfono del participante. */
  participantAlt?: string | null
  remoteJidAlt?: string | null
  addressingMode?: string | null
}

/** Un `Long` de protobuf, un número o un texto. */
export type MarcaDeTiempo = number | string | { low: number; high?: number } | null | undefined

export interface MensajeCrudo {
  key: LlaveCruda
  messageTimestamp?: MarcaDeTiempo
  /** Cómo se llama HOY quien escribió. No es identidad. */
  pushName?: string | null
  message?: Record<string, unknown> | null
  /**
   * Por qué este «mensaje» no tiene contenido.
   *
   * WhatsApp usa la misma estructura para los mensajes y para los avisos del
   * sistema —«Fulano se unió», «cambió el código de seguridad»—, y también para
   * los que no se pudieron descifrar (`CIPHERTEXT`, el 2). Distinguirlos es la
   * diferencia entre «esto no era un mensaje» y «esto era un mensaje y lo
   * perdimos».
   */
  messageStubType?: number | string | null
}

export function aMilisegundos(t: MarcaDeTiempo): number | null {
  if (t === null || t === undefined) return null
  if (typeof t === 'number') return t > 1e12 ? t : t * 1000
  if (typeof t === 'string') {
    const n = Number(t)
    return Number.isFinite(n) ? (n > 1e12 ? n : n * 1000) : null
  }
  if (typeof t === 'object' && typeof t.low === 'number') {
    // Long de protobuf. Los segundos de WhatsApp entran holgados en `low`.
    return t.low > 1e12 ? t.low : t.low * 1000
  }
  return null
}

/**
 * `5491111111111:12@s.whatsapp.net` → `5491111111111@s.whatsapp.net`.
 *
 * El sufijo `:12` es el número de dispositivo: la misma persona escribiendo
 * desde el teléfono y desde la web llega con dos jid distintos. Sin sacarlo,
 * Juan sería dos personas.
 */
export function normalizarJid(jid: string | null | undefined): string | null {
  if (!jid) return null
  const limpio = jid.trim().toLowerCase()
  const arroba = limpio.indexOf('@')
  if (arroba < 0) return limpio
  const usuario = limpio.slice(0, arroba)
  const servidor = limpio.slice(arroba + 1)
  const dosPuntos = usuario.indexOf(':')
  return `${dosPuntos >= 0 ? usuario.slice(0, dosPuntos) : usuario}@${servidor}`
}

/** Sólo `@g.us` es un grupo. Todo lo demás —incluido `@broadcast`— no lo es. */
export function tipoDeChat(jid: string | null | undefined): TipoDeChat {
  return (jid ?? '').endsWith('@g.us') ? 'grupo' : 'directo'
}

/**
 * Quién escribió, con el jid más estable que haya.
 *
 * WhatsApp empezó a direccionar participantes por **LID** (`@lid`), un
 * identificador que oculta el teléfono. Cuando eso pasa, la llave trae además
 * el jid de teléfono en `participantAlt`, y ése es el que sirve: es el que se
 * puede mapear a un empleado. Si sólo hay LID, se guarda el LID —es estable
 * dentro del grupo— y el mapeo se hace después, a mano.
 */
export function autorDe(llave: LlaveCruda, jidDeLaCuenta: string | null): string | null {
  const esGrupo = tipoDeChat(llave.remoteJid) === 'grupo'
  if (!esGrupo) {
    return llave.fromMe ? normalizarJid(jidDeLaCuenta) : normalizarJid(llave.remoteJid)
  }
  const preferido = (llave.participantAlt ?? '').includes('@s.whatsapp.net')
    ? llave.participantAlt
    : llave.participant
  return normalizarJid(preferido ?? (llave.fromMe ? jidDeLaCuenta : null))
}

/**
 * ¿El mensaje trae este campo, de verdad?
 *
 * **`clave in objeto` no sirve acá.** Baileys entrega instancias de protobufjs,
 * y protobufjs declara TODOS los campos del mensaje en el prototipo con valor
 * `null`. Con `in`, un mensaje de texto común «tiene» `imageMessage`,
 * `protocolMessage` y todo lo demás, y el normalizador termina descartando
 * mensajes reales o tratando un texto como si fuera una foto.
 *
 * Se mira el VALOR. Es la diferencia entre «el campo está declarado» y «el
 * campo está puesto», y es toda la diferencia.
 */
function tiene(objeto: Record<string, unknown>, clave: string): boolean {
  const v = objeto[clave]
  return v !== null && v !== undefined
}

/** Envoltorios que WhatsApp pone alrededor del mensaje de verdad. */
const ENVOLTORIOS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'editedMessage',
] as const

/** Saca las capas hasta llegar al contenido. Un mensaje efímero con adjunto trae tres. */
export function desenvolver(
  contenido: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  let actual = contenido ?? null
  for (let i = 0; i < 5 && actual; i += 1) {
    const clave = ENVOLTORIOS.find((e) => tiene(actual!, e))
    if (!clave) break
    const adentro = (actual[clave] as { message?: Record<string, unknown> } | null)?.message
    if (!adentro) break
    actual = adentro
  }
  return actual
}

const MEDIA: Record<string, string> = {
  imageMessage: 'imagen',
  videoMessage: 'video',
  audioMessage: 'audio',
  documentMessage: 'documento',
  stickerMessage: 'sticker',
}

const TEXTO: Record<string, string> = {
  conversation: 'texto',
  extendedTextMessage: 'texto',
}

interface Contenido {
  tipo: string
  texto: string | null
  media: ReferenciaDeMedia | null
  respondeA: string | null
}

function comoNumero(v: unknown): number | null {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  if (typeof v === 'object' && v !== null && typeof (v as { low?: number }).low === 'number') {
    return (v as { low: number }).low
  }
  return null
}

function comoTexto(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

/**
 * Qué trae el mensaje: tipo, texto, adjunto y a quién responde.
 *
 * Del adjunto se guarda **la referencia, no el archivo**: tipo, mime, tamaño y
 * nombre. Descargar media es decidir dónde vive, cuánto dura y quién la ve, y
 * eso es otra entrega. `idExterno` guarda el id del mensaje, que es el handle
 * con el que se pediría el archivo el día que se descargue.
 */
export function contenidoDe(
  contenidoCrudo: Record<string, unknown> | null | undefined,
  idDelMensaje: string | null,
): Contenido | null {
  const m = desenvolver(contenidoCrudo)
  if (!m) return null

  const claveMedia = Object.keys(MEDIA).find((k) => tiene(m, k))
  const claveTexto = Object.keys(TEXTO).find((k) => tiene(m, k))

  let contexto: Record<string, unknown> | null = null
  if (claveMedia) contexto = (m[claveMedia] as Record<string, unknown>)['contextInfo'] as Record<string, unknown> | null
  if (!contexto && tiene(m, 'extendedTextMessage')) {
    contexto = (m['extendedTextMessage'] as Record<string, unknown>)['contextInfo'] as Record<string, unknown> | null
  }
  const respondeA = comoTexto(contexto?.['stanzaId'])

  if (claveMedia) {
    const cuerpo = m[claveMedia] as Record<string, unknown>
    const media: ReferenciaDeMedia = {
      tipo: MEDIA[claveMedia]!,
      mime: comoTexto(cuerpo['mimetype']),
      bytes: comoNumero(cuerpo['fileLength']),
      idExterno: idDelMensaje,
      nombreArchivo: comoTexto(cuerpo['fileName']),
    }
    return { tipo: MEDIA[claveMedia]!, texto: comoTexto(cuerpo['caption']), media, respondeA }
  }

  if (claveTexto) {
    const texto =
      claveTexto === 'conversation'
        ? comoTexto(m['conversation'])
        : comoTexto((m['extendedTextMessage'] as Record<string, unknown>)['text'])
    return { tipo: 'texto', texto, media: null, respondeA }
  }

  // Ubicación, contacto, encuesta, reacción, llamada… Se reconoce el tipo para
  // poder contarlo, pero sin texto ni adjunto la política lo va a descartar.
  //  y no el prototipo: sólo los campos realmente puestos.
  const clave = Object.keys(m).find((k) => k.endsWith('Message') && tiene(m, k)) ?? 'desconocido'
  return { tipo: clave.replace(/Message$/, '').toLowerCase(), texto: null, media: null, respondeA }
}

export interface ContextoDeNormalizacion {
  /** El jid de la cuenta vinculada, para resolver los mensajes propios. */
  jidDeLaCuenta: string | null
  /** El nombre del grupo, si ya se conoce por la metadata. */
  nombreDeGrupo?: string | null
}

/**
 * Un mensaje de WhatsApp → `MensajeObservado`.
 *
 * Devuelve `null` cuando no hay nada que observar: sin id, sin chat, o cuando
 * el «mensaje» es en realidad un evento de protocolo (una edición, un borrado,
 * un intercambio de claves). Ésos los resuelve `protocoloDe`.
 */
export function normalizarMensaje(
  crudo: MensajeCrudo,
  contexto: ContextoDeNormalizacion,
): MensajeObservado | null {
  const idExterno = comoTexto(crudo.key.id)
  const chatId = normalizarJid(crudo.key.remoteJid)
  if (!idExterno || !chatId) return null

  const desenvuelto = desenvolver(crudo.message)
  if (!desenvuelto) return null
  // Los eventos de protocolo no son mensajes: tienen su propia función.
  if (tiene(desenvuelto, 'protocolMessage')) return null
  if (tiene(desenvuelto, 'senderKeyDistributionMessage') && Object.keys(desenvuelto).length === 1) return null

  const contenido = contenidoDe(crudo.message, idExterno)
  if (!contenido) return null

  const ms = aMilisegundos(crudo.messageTimestamp)
  return {
    idExterno,
    chat: {
      idExterno: chatId,
      tipo: tipoDeChat(chatId),
      nombre: contexto.nombreDeGrupo ?? null,
    },
    autor: {
      idExterno: autorDe(crudo.key, contexto.jidDeLaCuenta) ?? chatId,
      nombreVisible: comoTexto(crudo.pushName),
    },
    sentido: crudo.key.fromMe ? 'saliente' : 'entrante',
    enviadoEn: ms === null ? new Date() : new Date(ms),
    tipoDeMensaje: contenido.tipo,
    texto: contenido.texto,
    respondeA: contenido.respondeA,
    media: contenido.media,
  }
}

/** Los códigos de `protocolMessage.type` que nos interesan. */
const REVOKE = 0
const MESSAGE_EDIT = 14

/**
 * Una edición o un borrado.
 *
 * Los dos llegan como «mensajes» con un `protocolMessage` adentro que apunta
 * al mensaje original. El id que importa es el de ADENTRO, no el del sobre.
 */
export function protocoloDe(
  crudo: MensajeCrudo,
  contexto: ContextoDeNormalizacion,
): { clase: 'edicion'; datos: EdicionObservada } | { clase: 'borrado'; datos: BorradoObservado } | null {
  const desenvuelto = desenvolver(crudo.message)
  const protocolo = desenvuelto?.['protocolMessage'] as Record<string, unknown> | undefined
  if (!protocolo) return null

  const llave = protocolo['key'] as LlaveCruda | undefined
  const idOriginal = comoTexto(llave?.id)
  const chatId = normalizarJid(crudo.key.remoteJid)
  if (!idOriginal || !chatId) return null

  const tipo = comoNumero(protocolo['type'])
  const ms = aMilisegundos(crudo.messageTimestamp)
  const cuando = ms === null ? new Date() : new Date(ms)
  const chat = { idExterno: chatId, tipo: tipoDeChat(chatId) }

  if (tipo === MESSAGE_EDIT) {
    const editado = desenvolver(protocolo['editedMessage'] as Record<string, unknown> | null)
    const contenido = contenidoDe(editado, idOriginal)
    return {
      clase: 'edicion',
      datos: { idExterno: idOriginal, chat, textoNuevo: contenido?.texto ?? null, editadoEn: cuando },
    }
  }

  if (tipo === REVOKE) {
    return {
      clase: 'borrado',
      datos: {
        idExterno: idOriginal,
        chat,
        borradoPor: autorDe(crudo.key, contexto.jidDeLaCuenta),
        borradoEn: cuando,
      },
    }
  }

  return null
}
