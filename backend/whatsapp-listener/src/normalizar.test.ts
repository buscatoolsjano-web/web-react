import { describe, expect, it } from 'vitest'
import {
  aMilisegundos,
  autorDe,
  contenidoDe,
  desenvolver,
  normalizarJid,
  normalizarMensaje,
  protocoloDe,
  tipoDeChat,
  type MensajeCrudo,
} from './normalizar.js'

/**
 * La traducción de lo que manda WhatsApp.
 *
 * Los mensajes de acá tienen la forma real de un `WAMessage` de Baileys, pero
 * son de mentira: no hay teléfono, ni sesión, ni red. Es la única parte del
 * adaptador que se puede probar de verdad, así que se prueba entera —incluido
 * lo que sale mal, que con un cliente no oficial es la mitad de los casos.
 */

const GRUPO = '120363000000000001@g.us'
const JUAN = '5491111111111@s.whatsapp.net'
const JANO = '5492222222222@s.whatsapp.net'
const CUENTA = '5491121866133@s.whatsapp.net'

const mensaje = (cambios: Partial<MensajeCrudo> = {}): MensajeCrudo => ({
  key: { remoteJid: GRUPO, fromMe: false, id: 'WAMSG1', participant: JUAN },
  messageTimestamp: 1789700000,
  pushName: 'Juan',
  message: { conversation: 'hola' },
  ...cambios,
})

const ctx = { jidDeLaCuenta: CUENTA }

describe('El jid', () => {
  it('le saca el dispositivo: la misma persona desde el teléfono y desde la web es UNA', () => {
    expect(normalizarJid('5491111111111:12@s.whatsapp.net')).toBe(JUAN)
    expect(normalizarJid('5491111111111:3@s.whatsapp.net')).toBe(JUAN)
  })

  it('no rompe con lo que no tiene arroba ni con vacío', () => {
    expect(normalizarJid('5491111111111')).toBe('5491111111111')
    expect(normalizarJid(null)).toBeNull()
    expect(normalizarJid('')).toBeNull()
  })

  it('sólo @g.us es grupo', () => {
    expect(tipoDeChat(GRUPO)).toBe('grupo')
    expect(tipoDeChat(JUAN)).toBe('directo')
    // Un estado o una difusión NO son un grupo: si lo fueran, entrarían por la
    // puerta de los grupos y la allowlist no los estaría mirando.
    expect(tipoDeChat('status@broadcast')).toBe('directo')
    expect(tipoDeChat('120363000@broadcast')).toBe('directo')
  })
})

describe('Quién escribió', () => {
  it('en un grupo, el participante', () => {
    expect(autorDe({ remoteJid: GRUPO, participant: JANO }, CUENTA)).toBe(JANO)
  })

  it('con direccionamiento LID prefiere el jid de teléfono, que es el que se puede mapear', () => {
    const llave = {
      remoteJid: GRUPO,
      participant: '183746372@lid',
      participantAlt: JANO,
      addressingMode: 'lid',
    }
    expect(autorDe(llave, CUENTA)).toBe(JANO)
  })

  it('si sólo hay LID, se guarda el LID: es estable, y el mapeo se hace a mano', () => {
    expect(autorDe({ remoteJid: GRUPO, participant: '183746372@lid' }, CUENTA)).toBe('183746372@lid')
  })

  it('un mensaje propio en un grupo es de la cuenta', () => {
    expect(autorDe({ remoteJid: GRUPO, fromMe: true, participant: null }, CUENTA)).toBe(CUENTA)
  })

  it('en un privado entrante, el autor es el otro', () => {
    expect(autorDe({ remoteJid: JUAN, fromMe: false }, CUENTA)).toBe(JUAN)
  })
})

describe('La marca de tiempo', () => {
  it('segundos, milisegundos, texto y Long de protobuf', () => {
    expect(aMilisegundos(1789700000)).toBe(1789700000000)
    expect(aMilisegundos(1789700000000)).toBe(1789700000000)
    expect(aMilisegundos('1789700000')).toBe(1789700000000)
    expect(aMilisegundos({ low: 1789700000, high: 0 })).toBe(1789700000000)
  })

  it('lo que no se entiende es null, no una fecha inventada', () => {
    expect(aMilisegundos(null)).toBeNull()
    expect(aMilisegundos('mañana')).toBeNull()
  })
})

describe('Los envoltorios', () => {
  it('un mensaje efímero trae el de verdad adentro', () => {
    const m = { ephemeralMessage: { message: { conversation: 'secreto' } } }
    expect(desenvolver(m)).toEqual({ conversation: 'secreto' })
  })

  it('y se pueden apilar', () => {
    const m = {
      ephemeralMessage: { message: { viewOnceMessageV2: { message: { conversation: 'uno' } } } },
    }
    expect(desenvolver(m)).toEqual({ conversation: 'uno' })
  })

  it('un documento con epígrafe está envuelto', () => {
    const m = { documentWithCaptionMessage: { message: { documentMessage: { mimetype: 'application/pdf' } } } }
    expect(desenvolver(m)).toHaveProperty('documentMessage')
  })
})

describe('Qué trae el mensaje', () => {
  it('texto simple', () => {
    const c = contenidoDe({ conversation: 'hola' }, 'WAMSG1')
    expect(c).toEqual({ tipo: 'texto', texto: 'hola', media: null, respondeA: null })
  })

  it('texto extendido, que es el que llega cuando hay link o respuesta', () => {
    const c = contenidoDe({ extendedTextMessage: { text: 'mirá esto' } }, 'WAMSG1')
    expect(c?.texto).toBe('mirá esto')
  })

  it('una respuesta apunta al mensaje citado', () => {
    const c = contenidoDe(
      { extendedTextMessage: { text: 'Sí', contextInfo: { stanzaId: 'WAMSG-ORIGINAL', participant: JUAN } } },
      'WAMSG2',
    )
    expect(c?.respondeA).toBe('WAMSG-ORIGINAL')
  })

  it('una imagen guarda la referencia, no el archivo', () => {
    const c = contenidoDe(
      { imageMessage: { mimetype: 'image/jpeg', fileLength: 48123, caption: 'el balanceador' } },
      'WAMSG3',
    )
    expect(c?.tipo).toBe('imagen')
    expect(c?.texto).toBe('el balanceador')
    expect(c?.media).toEqual({
      tipo: 'imagen',
      mime: 'image/jpeg',
      bytes: 48123,
      idExterno: 'WAMSG3',
      nombreArchivo: null,
    })
  })

  it('un PDF guarda su nombre y su tamaño', () => {
    const c = contenidoDe(
      { documentMessage: { mimetype: 'application/pdf', fileLength: { low: 210345 }, fileName: 'cotizacion.pdf' } },
      'WAMSG4',
    )
    expect(c?.media?.nombreArchivo).toBe('cotizacion.pdf')
    expect(c?.media?.bytes).toBe(210345)
    expect(c?.tipo).toBe('documento')
  })

  it('una imagen con respuesta conserva las dos cosas', () => {
    const c = contenidoDe(
      { imageMessage: { mimetype: 'image/png', contextInfo: { stanzaId: 'WAMSG-X' } } },
      'WAMSG5',
    )
    expect(c?.media?.tipo).toBe('imagen')
    expect(c?.respondeA).toBe('WAMSG-X')
  })

  it('lo que no es texto ni adjunto se reconoce pero queda sin contenido', () => {
    expect(contenidoDe({ locationMessage: { degreesLatitude: -34 } }, 'W')).toMatchObject({
      tipo: 'location',
      texto: null,
      media: null,
    })
    expect(contenidoDe({ reactionMessage: { text: '👍' } }, 'W')?.media).toBeNull()
  })
})

describe('El mensaje entero', () => {
  it('un mensaje de grupo trae chat, autor, sentido y fecha', () => {
    const m = normalizarMensaje(mensaje(), { ...ctx, nombreDeGrupo: 'ZZ Buscatools IA Test' })
    expect(m).toMatchObject({
      idExterno: 'WAMSG1',
      chat: { idExterno: GRUPO, tipo: 'grupo', nombre: 'ZZ Buscatools IA Test' },
      autor: { idExterno: JUAN, nombreVisible: 'Juan' },
      sentido: 'entrante',
      tipoDeMensaje: 'texto',
      texto: 'hola',
    })
    expect(m?.enviadoEn.toISOString()).toBe(new Date(1789700000000).toISOString())
  })

  it('un mensaje propio es saliente', () => {
    const m = normalizarMensaje(
      mensaje({ key: { remoteJid: GRUPO, fromMe: true, id: 'WAMSG9', participant: CUENTA } }),
      ctx,
    )
    expect(m?.sentido).toBe('saliente')
    expect(m?.autor.idExterno).toBe(CUENTA)
  })

  it('un privado se normaliza igual: lo que decide si entra es la política, no esto', () => {
    const m = normalizarMensaje(
      mensaje({ key: { remoteJid: JUAN, fromMe: false, id: 'WAMSG10' } }),
      ctx,
    )
    expect(m?.chat.tipo).toBe('directo')
  })

  it('sin id o sin chat no hay mensaje', () => {
    expect(normalizarMensaje(mensaje({ key: { remoteJid: GRUPO, id: null } }), ctx)).toBeNull()
    expect(normalizarMensaje(mensaje({ key: { remoteJid: null, id: 'X' } }), ctx)).toBeNull()
  })

  it('sin contenido tampoco', () => {
    expect(normalizarMensaje(mensaje({ message: null }), ctx)).toBeNull()
  })

  it('un intercambio de claves no es un mensaje', () => {
    const m = mensaje({ message: { senderKeyDistributionMessage: { groupId: GRUPO } } })
    expect(normalizarMensaje(m, ctx)).toBeNull()
  })

  it('un evento de protocolo no se confunde con un mensaje', () => {
    const m = mensaje({ message: { protocolMessage: { type: 0, key: { id: 'WAMSG1' } } } })
    expect(normalizarMensaje(m, ctx)).toBeNull()
  })

  it('el nombre visible viaja, pero NO es la identidad', () => {
    const m = normalizarMensaje(mensaje({ pushName: 'Juancito 🔧' }), ctx)
    expect(m?.autor.nombreVisible).toBe('Juancito 🔧')
    expect(m?.autor.idExterno).toBe(JUAN)
  })

  it('sin fecha usa la de ahora en vez de romper', () => {
    const m = normalizarMensaje(mensaje({ messageTimestamp: null }), ctx)
    expect(m?.enviadoEn).toBeInstanceOf(Date)
  })
})

/**
 * Los mensajes REALES no son objetos literales.
 *
 * Baileys entrega instancias de protobufjs, y protobufjs declara **todos** los
 * campos del mensaje en el PROTOTIPO con valor `null`. O sea: `'imageMessage'
 * in mensaje` da `true` para un mensaje de texto, y `'protocolMessage' in
 * mensaje` también.
 *
 * Esto costó tres mensajes de prueba reales: el evento llegaba, la llave estaba
 * completa, y el normalizador lo descartaba en silencio. Los tests de arriba
 * pasaban porque un objeto literal no tiene ese prototipo — el mock no tenía
 * justo la propiedad del objeto real que importaba.
 */
const CAMPOS_DEL_PROTO = [
  'conversation', 'extendedTextMessage', 'imageMessage', 'videoMessage', 'audioMessage',
  'documentMessage', 'stickerMessage', 'protocolMessage', 'ephemeralMessage',
  'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension',
  'documentWithCaptionMessage', 'editedMessage', 'senderKeyDistributionMessage',
  'messageContextInfo', 'reactionMessage', 'locationMessage', 'contactMessage',
]

/** Un mensaje con la forma real: los campos sin usar viven en el prototipo, en null. */
function comoProtobuf(campos: Record<string, unknown>): Record<string, unknown> {
  const prototipo: Record<string, unknown> = {}
  for (const c of CAMPOS_DEL_PROTO) prototipo[c] = null
  return Object.assign(Object.create(prototipo) as Record<string, unknown>, campos)
}

describe('Mensajes con forma de protobuf (los de verdad)', () => {
  /** La llave real observada el 18/09: grupo, LID, con el jid de teléfono al lado. */
  const llaveReal = {
    remoteJid: GRUPO,
    remoteJidAlt: null,
    fromMe: false,
    id: 'ABCDEF0123456789ABCDEF',
    participant: '183746372@lid',
    participantAlt: JANO,
    addressingMode: 'lid',
  }

  it('el prototipo miente: los campos sin usar existen y valen null', () => {
    const m = comoProtobuf({ conversation: 'hola' })
    expect('imageMessage' in m).toBe(true)
    expect(m['imageMessage']).toBeNull()
    expect(Object.keys(m)).toEqual(['conversation'])
  })

  it('un texto de grupo se normaliza: NO se descarta', () => {
    const m = normalizarMensaje(
      { key: llaveReal, messageTimestamp: 1789700000, pushName: 'Jano',
        message: comoProtobuf({ conversation: 'mensaje antes de allowlist tres', messageContextInfo: {} }) },
      ctx,
    )
    expect(m).not.toBeNull()
    expect(m?.chat.tipo).toBe('grupo')
    expect(m?.autor.idExterno).toBe(JANO)
  })

  it('y es TEXTO, no una imagen', () => {
    const m = normalizarMensaje(
      { key: llaveReal, message: comoProtobuf({ conversation: 'hola', messageContextInfo: {} }) },
      ctx,
    )
    expect(m?.tipoDeMensaje).toBe('texto')
    expect(m?.texto).toBe('hola')
    expect(m?.media).toBeNull()
  })

  it('desenvolver no desenvuelve un envoltorio que vale null', () => {
    const m = comoProtobuf({ conversation: 'hola' })
    expect(desenvolver(m)).toBe(m)
  })

  it('contenidoDe no confunde el prototipo con un adjunto', () => {
    const c = contenidoDe(comoProtobuf({ conversation: 'hola' }), 'W1')
    expect(c?.tipo).toBe('texto')
    expect(c?.media).toBeNull()
    expect(c?.respondeA).toBeNull()
  })

  it('una imagen de verdad sigue siendo una imagen', () => {
    const c = contenidoDe(
      comoProtobuf({ imageMessage: { mimetype: 'image/jpeg', fileLength: 1234, caption: 'ojo' } }),
      'W2',
    )
    expect(c?.tipo).toBe('imagen')
    expect(c?.media?.mime).toBe('image/jpeg')
  })

  it('una respuesta con extendedTextMessage conserva a quién cita', () => {
    const c = contenidoDe(
      comoProtobuf({ extendedTextMessage: { text: 'Sí', contextInfo: { stanzaId: 'ORIGINAL' } } }),
      'W3',
    )
    expect(c?.texto).toBe('Sí')
    expect(c?.respondeA).toBe('ORIGINAL')
  })

  it('un borrado de verdad se sigue detectando', () => {
    const r = protocoloDe(
      { key: llaveReal, messageTimestamp: 1789700000,
        message: comoProtobuf({ protocolMessage: { type: 0, key: { id: 'ORIGINAL' } } }) },
      ctx,
    )
    expect(r?.clase).toBe('borrado')
    expect(r?.datos.idExterno).toBe('ORIGINAL')
  })

  it('un mensaje efímero de verdad sí se desenvuelve', () => {
    const m = comoProtobuf({
      ephemeralMessage: { message: comoProtobuf({ conversation: 'secreto' }) },
    })
    expect(contenidoDe(m, 'W4')?.texto).toBe('secreto')
  })
})

describe('Ediciones y borrados', () => {
  it('un borrado apunta al mensaje ORIGINAL, no al sobre', () => {
    const r = protocoloDe(
      mensaje({
        key: { remoteJid: GRUPO, id: 'SOBRE1', participant: JANO },
        message: { protocolMessage: { type: 0, key: { id: 'WAMSG-ORIGINAL' } } },
      }),
      ctx,
    )
    expect(r?.clase).toBe('borrado')
    expect(r?.datos.idExterno).toBe('WAMSG-ORIGINAL')
    expect(r?.clase === 'borrado' ? r.datos.borradoPor : null).toBe(JANO)
  })

  it('una edición trae el texto nuevo', () => {
    const r = protocoloDe(
      mensaje({
        message: {
          protocolMessage: {
            type: 14,
            key: { id: 'WAMSG-ORIGINAL' },
            editedMessage: { conversation: 'corregido' },
          },
        },
      }),
      ctx,
    )
    expect(r?.clase).toBe('edicion')
    expect(r?.clase === 'edicion' ? r.datos.textoNuevo : null).toBe('corregido')
    expect(r?.datos.idExterno).toBe('WAMSG-ORIGINAL')
  })

  it('otros tipos de protocolo se ignoran: no se inventa un borrado', () => {
    const r = protocoloDe(mensaje({ message: { protocolMessage: { type: 3, key: { id: 'X' } } } }), ctx)
    expect(r).toBeNull()
  })

  it('un mensaje normal no es un evento de protocolo', () => {
    expect(protocoloDe(mensaje(), ctx)).toBeNull()
  })
})
