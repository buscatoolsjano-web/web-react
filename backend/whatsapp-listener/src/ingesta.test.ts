import { describe, expect, it } from 'vitest'
import {
  FACUNDO,
  GRUPO_AJENO,
  GRUPO_AUTORIZADO,
  JANO,
  JUAN,
  borrado,
  edicion,
  mensaje,
  montar,
  politica,
} from './pruebas/escenario.js'

/**
 * El prototipo del listener de grupos (Fase 18 · E0).
 *
 * Todo corre contra un transporte y un repositorio de mentira: **no hay
 * WhatsApp, no hay número vinculado, no hay Supabase y no hay OpenAI**. Lo que
 * se prueba es lo que tiene que estar bien antes de conectar nada: qué entra,
 * qué no entra, y que lo que entra entre una sola vez.
 */

describe('Qué se guarda de un grupo autorizado', () => {
  it('guarda la conversación del grupo y el mensaje, con su autor', async () => {
    const e = await montar()
    await e.emitirMensaje(mensaje({ autor: JUAN, texto: 'Jano, mañana confirmá el pedido' }))

    expect(e.repositorio.mensajes.size).toBe(1)
    const [fila] = [...e.repositorio.mensajes.values()]
    expect(fila!.texto).toBe('Jano, mañana confirmá el pedido')
    expect(fila!.autorIdExterno).toBe(JUAN.idExterno)
    expect(fila!.autorNombre).toBe('Juan')
    expect(fila!.sentido).toBe('entrante')

    // Una conversación por grupo, con su nombre.
    expect(e.repositorio.conversaciones.size).toBe(1)
    expect(e.repositorio.conversaciones.get(GRUPO_AUTORIZADO)?.nombre).toBe('Importaciones')
  })

  it('la conversación del grupo es UNA, aunque escriban tres personas', async () => {
    const e = await montar()
    await e.emitirMensaje(mensaje({ autor: JUAN, texto: 'Jano, mañana confirmá el pedido' }))
    await e.emitirMensaje(mensaje({ autor: JANO, texto: 'Dale, lo confirmo' }))
    await e.emitirMensaje(mensaje({ autor: FACUNDO, texto: 'Falta revisar el stock' }))

    expect(e.repositorio.conversaciones.size).toBe(1)
    expect(e.repositorio.mensajes.size).toBe(3)
  })

  it('los tres autores quedan distintos, y no se confunden por el nombre', async () => {
    const e = await montar()
    await e.emitirMensaje(mensaje({ autor: JUAN }))
    await e.emitirMensaje(mensaje({ autor: JANO }))
    // Mismo nombre visible que Juan, otra persona: la identidad es el id.
    await e.emitirMensaje(mensaje({ autor: { ...FACUNDO, nombreVisible: 'Juan' } }))

    const autores = new Set([...e.repositorio.mensajes.values()].map((m) => m.autorIdExterno))
    expect(autores.size).toBe(3)
    expect(autores).toContain(JUAN.idExterno)
    expect(autores).toContain(JANO.idExterno)
    expect(autores).toContain(FACUNDO.idExterno)
  })

  it('un mensaje de la propia cuenta se guarda como saliente, con su autor igual', async () => {
    const e = await montar()
    await e.emitirMensaje(mensaje({ autor: JANO, sentido: 'saliente', texto: 'Lo confirmo' }))

    const [fila] = [...e.repositorio.mensajes.values()]
    expect(fila!.sentido).toBe('saliente')
    // `sentido` dice si salió de esta cuenta; NO alcanza para saber quién
    // escribió, y por eso el autor va igual.
    expect(fila!.autorIdExterno).toBe(JANO.idExterno)
  })

  it('el nombre del grupo se actualiza si cambia, pero la conversación es la misma', async () => {
    const e = await montar()
    await e.emitirMensaje(mensaje({ chat: { idExterno: GRUPO_AUTORIZADO, tipo: 'grupo', nombre: 'Importaciones' } }))
    const id = e.repositorio.conversaciones.get(GRUPO_AUTORIZADO)!.id

    await e.emitirMensaje(mensaje({ chat: { idExterno: GRUPO_AUTORIZADO, tipo: 'grupo', nombre: 'Importaciones 2026' } }))

    expect(e.repositorio.conversaciones.size).toBe(1)
    expect(e.repositorio.conversaciones.get(GRUPO_AUTORIZADO)!.id).toBe(id)
    expect(e.repositorio.conversaciones.get(GRUPO_AUTORIZADO)!.nombre).toBe('Importaciones 2026')
  })
})

describe('Qué NO se guarda', () => {
  it('un grupo que no está en la allowlist no deja ni una fila', async () => {
    const e = await montar()
    await e.emitirMensaje(
      mensaje({ chat: { idExterno: GRUPO_AJENO, tipo: 'grupo', nombre: 'Asado del sábado' } }),
    )

    expect(e.repositorio.mensajes.size).toBe(0)
    expect(e.repositorio.conversaciones.size).toBe(0)
    expect(e.listener.contadores.descartados.grupo_no_autorizado).toBe(1)
  })

  it('un chat privado no se ingiere NUNCA, aunque la cuenta lo reciba', async () => {
    const e = await montar()
    await e.emitirMensaje(
      mensaje({ chat: { idExterno: JUAN.idExterno, tipo: 'directo', nombre: null } }),
    )

    expect(e.repositorio.mensajes.size).toBe(0)
    expect(e.listener.contadores.descartados.chat_directo).toBe(1)
  })

  it('un grupo deshabilitado deja de ingerir sin perder lo anterior', async () => {
    const p = politica()
    const e = await montar(p)
    await e.emitirMensaje(mensaje())
    expect(e.repositorio.mensajes.size).toBe(1)

    // Alguien lo apaga desde la allowlist.
    p.grupos = [{ idExterno: GRUPO_AUTORIZADO, habilitado: false, iaHabilitada: false }]
    await e.emitirMensaje(mensaje())

    expect(e.repositorio.mensajes.size).toBe(1)
    expect(e.listener.contadores.descartados.grupo_no_autorizado).toBe(1)
  })

  it('con el kill switch apagado no entra nada', async () => {
    const e = await montar(politica({ listenerHabilitado: false }))
    await e.emitirMensaje(mensaje())
    await e.emitir({ clase: 'edicion', datos: edicion() })

    expect(e.repositorio.mensajes.size).toBe(0)
    expect(e.listener.contadores.descartados.listener_apagado).toBe(2)
    expect(e.listener.estado()).toBe('apagado')
  })

  it('un mensaje sin texto ni adjunto no aporta nada y no se guarda', async () => {
    const e = await montar()
    await e.emitirMensaje(mensaje({ texto: null, media: null, tipoDeMensaje: 'reaccion' }))
    await e.emitirMensaje(mensaje({ texto: '   ', media: null }))

    expect(e.repositorio.mensajes.size).toBe(0)
    expect(e.listener.contadores.descartados.sin_texto_ni_media).toBe(2)
  })
})

describe('Idempotencia', () => {
  it('el mismo mensaje tres veces deja UNA fila', async () => {
    const e = await montar()
    const m = mensaje({ texto: 'Dale, lo confirmo' })
    await e.emitirMensaje(m)
    await e.emitirMensaje(m)
    await e.emitirMensaje(m)

    expect(e.repositorio.mensajes.size).toBe(1)
    expect(e.listener.contadores.guardados).toBe(1)
    expect(e.listener.contadores.duplicados).toBe(2)
  })

  it('una reconexión que reenvía lo ya visto no duplica', async () => {
    const e = await montar()
    const uno = mensaje({ texto: 'primero' })
    const dos = mensaje({ texto: 'segundo' })
    await e.emitirMensaje(uno)
    await e.emitirMensaje(dos)

    // Se cae y al volver el proveedor reenvía el buffer entero.
    e.transporte.caerse('network')
    await e.listener.iniciar()
    await e.emitirMensaje(uno)
    await e.emitirMensaje(dos)
    const tres = mensaje({ texto: 'tercero' })
    await e.emitirMensaje(tres)

    expect(e.repositorio.mensajes.size).toBe(3)
    expect(e.listener.contadores.duplicados).toBe(2)
  })

  it('una ráfaga de diez mensajes deja diez filas y una sola conversación', async () => {
    const e = await montar()
    for (let i = 0; i < 10; i += 1) {
      await e.emitirMensaje(mensaje({ texto: `mensaje ${i}` }))
    }

    expect(e.repositorio.mensajes.size).toBe(10)
    expect(e.repositorio.conversaciones.size).toBe(1)
    expect(e.listener.contadores.guardados).toBe(10)
    // El análisis lo encola la base con su debounce, no el listener: acá no hay
    // ni una llamada a la IA.
    expect(e.listener.contadores.errores).toBe(0)
  })
})

describe('Respuestas, adjuntos, ediciones y borrados', () => {
  it('una respuesta guarda a qué mensaje contesta', async () => {
    const e = await montar()
    const pregunta = mensaje({ autor: JUAN, texto: '¿Lo confirmamos?' })
    await e.emitirMensaje(pregunta)
    await e.emitirMensaje(mensaje({ autor: JANO, texto: 'Sí', respondeA: pregunta.idExterno }))

    const respuesta = [...e.repositorio.mensajes.values()].find((m) => m.texto === 'Sí')
    expect(respuesta!.respondeA).toBe(pregunta.idExterno)
    // Sin esto, «Sí» es una palabra suelta y la IA no puede saber a qué.
  })

  it('de un adjunto se guarda la metadata y NO se descarga el archivo', async () => {
    const e = await montar()
    await e.emitirMensaje(
      mensaje({
        tipoDeMensaje: 'imagen',
        texto: null,
        media: {
          tipo: 'imagen',
          mime: 'image/jpeg',
          bytes: 184_320,
          idExterno: 'MEDIA-1',
          nombreArchivo: 'remito.jpg',
        },
      }),
    )

    const [fila] = [...e.repositorio.mensajes.values()]
    expect(fila!.media).toEqual({
      tipo: 'imagen',
      mime: 'image/jpeg',
      bytes: 184_320,
      idExterno: 'MEDIA-1',
      nombreArchivo: 'remito.jpg',
    })
    // El contenido del archivo no está en ningún lado: se baja cuando alguien
    // lo pida, no porque haya pasado por el grupo.
    expect(JSON.stringify(fila)).not.toContain('base64')
  })

  it('un PDF también entra, aunque no tenga texto', async () => {
    const e = await montar()
    await e.emitirMensaje(
      mensaje({
        tipoDeMensaje: 'documento',
        texto: null,
        media: { tipo: 'documento', mime: 'application/pdf', bytes: 51_200, idExterno: 'MEDIA-2', nombreArchivo: 'oc.pdf' },
      }),
    )
    expect(e.repositorio.mensajes.size).toBe(1)
  })

  it('una edición cambia el mensaje que ya existe, no crea otro', async () => {
    const e = await montar()
    const m = mensaje({ texto: 'lo confrimo' })
    await e.emitirMensaje(m)
    await e.emitir({ clase: 'edicion', datos: edicion({ idExterno: m.idExterno, textoNuevo: 'lo confirmo' }) })

    expect(e.repositorio.mensajes.size).toBe(1)
    const [fila] = [...e.repositorio.mensajes.values()]
    expect(fila!.texto).toBe('lo confirmo')
    expect(fila!.editadoEn).not.toBeNull()
  })

  it('un borrado marca el mensaje y NO lo borra de la base', async () => {
    const e = await montar()
    const m = mensaje({ texto: 'esto no iba acá' })
    await e.emitirMensaje(m)
    await e.emitir({ clase: 'borrado', datos: borrado({ idExterno: m.idExterno }) })

    expect(e.repositorio.mensajes.size).toBe(1)
    const [fila] = [...e.repositorio.mensajes.values()]
    expect(fila!.borradoEn).not.toBeNull()
    expect(fila!.borradoPor).toBe(JUAN.idExterno)
    // El texto se conserva: que el mensaje existió es parte de la historia, y
    // reemplazarlo por «mensaje eliminado» sería perder el dato.
    expect(fila!.texto).toBe('esto no iba acá')
  })

  it('editar o borrar algo que nunca entró no crea nada', async () => {
    const e = await montar()
    await e.emitir({ clase: 'edicion', datos: edicion({ idExterno: 'NO-EXISTE' }) })
    await e.emitir({ clase: 'borrado', datos: borrado({ idExterno: 'NO-EXISTE' }) })

    expect(e.repositorio.mensajes.size).toBe(0)
    expect(e.listener.contadores.ediciones).toBe(0)
    expect(e.listener.contadores.borrados).toBe(0)
  })

  it('la metadata del grupo guarda a los participantes', async () => {
    const e = await montar()
    await e.emitir({
      clase: 'grupo',
      datos: { idExterno: GRUPO_AUTORIZADO, nombre: 'Importaciones', participantes: [JUAN, JANO, FACUNDO] },
    })

    expect(e.repositorio.participantes.get(GRUPO_AUTORIZADO)?.size).toBe(3)
    expect(e.repositorio.participantes.get(GRUPO_AUTORIZADO)?.get(JUAN.idExterno)).toBe('Juan')
  })
})

describe('Los logs no filtran la conversación', () => {
  it('no sale el texto, ni el número, ni el nombre del grupo', async () => {
    const e = await montar()
    await e.emitirMensaje(mensaje({ autor: JUAN, texto: 'Jano, mañana confirmá el pedido de Nordex' }))
    await e.emitirMensaje(
      mensaje({ chat: { idExterno: GRUPO_AJENO, tipo: 'grupo', nombre: 'Asado del sábado' } }),
    )
    await e.emitirMensaje(mensaje({ chat: { idExterno: JUAN.idExterno, tipo: 'directo', nombre: null } }))

    const log = e.registro.texto
    expect(log).not.toContain('Nordex')
    expect(log).not.toContain('confirmá')
    expect(log).not.toContain('Asado del sábado')
    expect(log).not.toContain('Importaciones')
    expect(log).not.toContain('5491111111111')
    // Y sin embargo sirve: dice qué pasó y en qué chat, ofuscado.
    expect(log).toContain('mensaje_guardado')
    expect(log).toContain('grupo_no_autorizado')
    expect(log).toContain('chat_directo')
  })
})
