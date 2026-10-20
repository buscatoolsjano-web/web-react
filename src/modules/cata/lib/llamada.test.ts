import { describe, expect, it } from 'vitest'
import {
  enCurso,
  escucha,
  historial,
  type EventoLlamada,
  type Llamada,
  LLAMADA_INICIAL,
  siguiente,
} from './llamada'

/** Correr una tanda de eventos de una. Es como pasa en una llamada de verdad. */
const correr = (eventos: readonly EventoLlamada[], desde: Llamada = LLAMADA_INICIAL): Llamada =>
  eventos.reduce(siguiente, desde)

/** Una llamada atendida, escuchando, que es el punto de partida de casi todo. */
const atendida = () => siguiente(LLAMADA_INICIAL, { tipo: 'atender' })

describe('atender y colgar', () => {
  it('arranca colgada y sin nada', () => {
    expect(LLAMADA_INICIAL.estado).toBe('inactiva')
    expect(LLAMADA_INICIAL.turnos).toEqual([])
    expect(escucha(LLAMADA_INICIAL)).toBe(false)
  })

  it('atender abre el micrófono', () => {
    const l = atendida()
    expect(l.estado).toBe('escuchando')
    expect(escucha(l)).toBe(true)
  })

  it('atender dos veces no borra la conversación', () => {
    const l = correr([
      { tipo: 'atender' },
      { tipo: 'escuche', texto: 'hola' },
      { tipo: 'conteste', texto: 'hola, soy Cata' },
      { tipo: 'atender' },
    ])
    expect(l.turnos).toHaveLength(2)
  })

  it('colgar deja lo que se dijo a la vista', () => {
    const l = correr([
      { tipo: 'atender' },
      { tipo: 'escuche', texto: 'punta ph1' },
      { tipo: 'conteste', texto: 'tenés el VPPH1/70' },
      { tipo: 'colgar' },
    ])
    expect(l.estado).toBe('inactiva')
    expect(l.turnos).toHaveLength(2)
    expect(escucha(l)).toBe(false)
  })

  it('atender después de colgar sí empieza de cero', () => {
    const l = correr([
      { tipo: 'atender' },
      { tipo: 'escuche', texto: 'punta ph1' },
      { tipo: 'colgar' },
      { tipo: 'atender' },
    ])
    expect(l.turnos).toEqual([])
    expect(l.estado).toBe('escuchando')
  })
})

describe('un turno completo', () => {
  it('escuchar, pensar, hablar y volver a escuchar', () => {
    let l = atendida()

    l = siguiente(l, { tipo: 'oyendo', texto: 'tenés punta' })
    expect(l.parcial).toBe('tenés punta')
    expect(l.estado).toBe('escuchando')

    l = siguiente(l, { tipo: 'escuche', texto: 'tenés punta ph1' })
    expect(l.estado).toBe('pensando')
    expect(l.parcial).toBe('')
    expect(l.turnos).toEqual([{ rol: 'usuario', texto: 'tenés punta ph1' }])

    l = siguiente(l, { tipo: 'conteste', texto: 'sí, el VPPH1/70' })
    expect(l.estado).toBe('hablando')
    expect(l.turnos[1]).toEqual({ rol: 'cata', texto: 'sí, el VPPH1/70' })

    l = siguiente(l, { tipo: 'termine_de_hablar' })
    // Lo que la hace una LLAMADA: vuelve a escuchar sola.
    expect(l.estado).toBe('escuchando')
    expect(escucha(l)).toBe(true)
  })

  it('recorta los espacios de lo que se oyó', () => {
    const l = siguiente(atendida(), { tipo: 'escuche', texto: '  punta ph1  ' })
    expect(l.turnos[0]).toEqual({ rol: 'usuario', texto: 'punta ph1' })
  })
})

describe('lo que el micrófono manda de más', () => {
  it('el silencio no es un turno', () => {
    const l = siguiente(atendida(), { tipo: 'escuche', texto: '   ' })
    expect(l.estado).toBe('escuchando')
    expect(l.turnos).toEqual([])
  })

  it('el silencio limpia el parcial, para que no quede un borrador colgado', () => {
    const l = correr([{ tipo: 'oyendo', texto: 'eh' }, { tipo: 'escuche', texto: '' }], atendida())
    expect(l.parcial).toBe('')
  })

  it('NO oye a Cata por el parlante mientras habla', () => {
    // El caso que justifica la máquina entera: `SpeechRecognition` sigue
    // abierto mientras `speechSynthesis` habla y transcribe la propia voz de
    // Cata. Si eso contara como turno, la llamada se contestaría a sí misma
    // en un bucle que además se paga.
    const hablando = correr([
      { tipo: 'atender' },
      { tipo: 'escuche', texto: 'punta ph1' },
      { tipo: 'conteste', texto: 'tenés el VPPH1/70 a doce dólares' },
    ])
    expect(hablando.estado).toBe('hablando')

    const l = siguiente(hablando, { tipo: 'escuche', texto: 'tenés el VPPH1 a doce dólares' })

    expect(l).toBe(hablando)
    expect(l.turnos).toHaveLength(2)
  })

  it('tampoco mientras el modelo piensa', () => {
    const pensando = correr([{ tipo: 'atender' }, { tipo: 'escuche', texto: 'punta ph1' }])
    const l = siguiente(pensando, { tipo: 'escuche', texto: 'y de la otra' })

    expect(l).toBe(pensando)
    expect(l.turnos).toHaveLength(1)
  })

  it('un parcial que llega tarde no se muestra', () => {
    const pensando = correr([{ tipo: 'atender' }, { tipo: 'escuche', texto: 'punta ph1' }])
    expect(siguiente(pensando, { tipo: 'oyendo', texto: 'ehh' }).parcial).toBe('')
  })

  it('nada de esto pasa con la llamada colgada', () => {
    for (const e of [
      { tipo: 'oyendo', texto: 'hola' },
      { tipo: 'escuche', texto: 'hola' },
      { tipo: 'conteste', texto: 'hola' },
      { tipo: 'termine_de_hablar' },
    ] as const satisfies readonly EventoLlamada[]) {
      expect(siguiente(LLAMADA_INICIAL, e)).toBe(LLAMADA_INICIAL)
    }
  })
})

describe('la respuesta', () => {
  it('una respuesta vacía no se dice, pero se sigue escuchando', () => {
    const l = correr([
      { tipo: 'atender' },
      { tipo: 'escuche', texto: 'hola' },
      { tipo: 'conteste', texto: '  ' },
    ])
    expect(l.estado).toBe('escuchando')
    expect(l.turnos).toHaveLength(1)
  })

  it('si ya se colgó, lo que venía en camino no se dice', () => {
    // Apretar «Colgar» es pedir que se calle: una respuesta que llega después
    // no puede volver a abrir la voz.
    const l = correr([
      { tipo: 'atender' },
      { tipo: 'escuche', texto: 'hola' },
      { tipo: 'colgar' },
      { tipo: 'conteste', texto: 'tenés el VPPH1/70' },
    ])
    expect(l.estado).toBe('inactiva')
    expect(l.turnos).toHaveLength(1)
  })
})

describe('los fallos', () => {
  it('uno que no corta se dice y la llamada sigue', () => {
    const l = correr([
      { tipo: 'atender' },
      { tipo: 'escuche', texto: 'hola' },
      { tipo: 'fallo', mensaje: 'Se me cortó, repetime.' },
    ])
    expect(l.estado).toBe('hablando')
    expect(l.turnos[1]).toEqual({ rol: 'cata', texto: 'Se me cortó, repetime.' })

    // Y después de decirlo vuelve a escuchar, como cualquier respuesta.
    expect(siguiente(l, { tipo: 'termine_de_hablar' }).estado).toBe('escuchando')
  })

  it('uno que corta termina la llamada y deja el motivo', () => {
    const l = correr([
      { tipo: 'atender' },
      { tipo: 'fallo', mensaje: 'No hay micrófono.', cortada: true },
    ])
    expect(l.estado).toBe('cortada')
    expect(l.error).toBe('No hay micrófono.')
    expect(escucha(l)).toBe(false)
    expect(enCurso(l)).toBe(false)
  })

  it('un fallo con la llamada colgada no la revive', () => {
    expect(siguiente(LLAMADA_INICIAL, { tipo: 'fallo', mensaje: 'algo' })).toBe(LLAMADA_INICIAL)
  })

  it('el error se limpia al atender de nuevo', () => {
    const l = correr([
      { tipo: 'atender' },
      { tipo: 'fallo', mensaje: 'No hay micrófono.', cortada: true },
      { tipo: 'atender' },
    ])
    expect(l.error).toBe('')
    expect(l.estado).toBe('escuchando')
  })
})

describe('historial', () => {
  it('traduce los roles a los que entiende la función', () => {
    const l = correr([
      { tipo: 'atender' },
      { tipo: 'escuche', texto: 'punta ph1' },
      { tipo: 'conteste', texto: 'el VPPH1/70' },
      { tipo: 'termine_de_hablar' },
      { tipo: 'escuche', texto: 'y cuánto queda' },
    ])

    expect(historial(l)).toEqual([
      { rol: 'usuario', texto: 'punta ph1' },
      { rol: 'agente', texto: 'el VPPH1/70' },
      { rol: 'usuario', texto: 'y cuánto queda' },
    ])
  })

  it('va entero, porque «¿y de ese cuánto queda?» no se entiende solo', () => {
    const l = correr([
      { tipo: 'atender' },
      { tipo: 'escuche', texto: 'uno' },
      { tipo: 'conteste', texto: 'dos' },
      { tipo: 'termine_de_hablar' },
      { tipo: 'escuche', texto: 'tres' },
    ])
    expect(historial(l)).toHaveLength(3)
  })
})
