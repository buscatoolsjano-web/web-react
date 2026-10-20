// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Oyentes } from '../lib/reconocedor'
import type * as ServicioCata from '../services/cata'
import type { TurnoParaCata } from '../services/cata'

/**
 * La llamada, cableada (Fase 85).
 *
 * Las reglas de la máquina de estados ya se prueban solas en
 * `lib/llamada.test.ts`. Acá se prueba el CABLE, que es donde estaban los dos
 * errores que importan: que la conversación entera viaje —sin eso, «¿y de ese
 * cuánto queda?» llega sin saber de qué— y que lo que se DICE no sea lo que se
 * MUESTRA, porque un asterisco se escucha «asterisco».
 *
 * El micrófono y el parlante están doblados: no existen en jsdom, y lo que
 * importa no es que suenen sino qué se les manda.
 */

const estado = vi.hoisted(() => ({
  /** Lo último que se le mandó a la función. */
  enviado: null as { companyId: string; turnos: readonly TurnoParaCata[] } | null,
  /** Cuántas consultas salieron. Contar es mejor que mirar si quedó en null:
      nulificar la propiedad le estrecha el tipo y lo de abajo no compila. */
  veces: 0,
  respuesta: { texto: 'tenés el VPPH1/70', pasos: [] as string[] },
  error: null as Error | null,
}))

const oido = vi.hoisted(() => ({
  oyentes: null as Oyentes | null,
  escuchando: false,
  cerrado: false,
  cuantasVeces: 0,
}))

/*
 * El parlante, doblado, y SIN resolver solo.
 *
 * Que `decir` resolviera en el acto parecía más simple y hacía pasar tests
 * que en la realidad fallan: la llamada volvía a «escuchando» antes de que
 * llegara nada por el micrófono, así que el filtro de eco nunca tenía contra
 * qué comparar y el caso que importa —oírse a sí misma mientras habla— no se
 * podía escribir. Acá la voz termina cuando el test lo dice, como la de
 * verdad.
 */
const voz = vi.hoisted(() => ({
  dicho: [] as string[],
  callada: 0,
  terminar: null as (() => void) | null,
}))

vi.mock('@/services/supabase/client', () => ({ supabase: {} }))
vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({
    activa: { companyId: 'c1', companyName: 'ZZ', rol: 'admin', esInterno: true, customerId: null },
  }),
}))

vi.mock('../lib/reconocedor', () => ({
  hayOido: () => true,
  abrirOido: (o: Oyentes) => {
    oido.oyentes = o
    oido.cuantasVeces += 1
    return {
      escuchar: () => {
        oido.escuchando = true
      },
      pausar: () => {
        oido.escuchando = false
      },
      cerrar: () => {
        oido.cerrado = true
      },
    }
  },
}))

vi.mock('../lib/voz', () => ({
  hayVoz: () => true,
  decir: (t: string) => {
    voz.dicho.push(t)
    return new Promise<void>((listo) => {
      voz.terminar = listo
    })
  },
  callar: () => {
    voz.callada += 1
    // Callar TERMINA la voz, igual que `speechSynthesis.cancel()`, que
    // dispara `onend`. Es lo que pasa cuando la interrumpen.
    voz.terminar?.()
  },
}))

/* El servicio se dobla pero `FalloCata` es la de verdad: el hook la distingue
   con `instanceof`, así que una copia de mentira haría pasar el test sin que
   el camino del fallo funcione. */
vi.mock('../services/cata', async (original) => {
  const real = await original<typeof ServicioCata>()
  return {
    ...real,
    hablarConCata: (p: { companyId: string; turnos: readonly TurnoParaCata[] }) => {
      estado.enviado = p
      estado.veces += 1
      if (estado.error) return Promise.reject(estado.error)
      return Promise.resolve(estado.respuesta)
    },
  }
})

const { Llamada } = await import('./Llamada')
const { FalloCata } = await import('../services/cata')

beforeEach(() => {
  estado.enviado = null
  estado.veces = 0
  estado.respuesta = { texto: 'tenés el VPPH1/70', pasos: [] }
  estado.error = null
  oido.oyentes = null
  oido.escuchando = false
  oido.cerrado = false
  oido.cuantasVeces = 0
  voz.dicho = []
  voz.callada = 0
  voz.terminar = null
})

/** La voz termina de decir lo suyo. */
const termineDeHablar = async () => {
  await act(async () => {
    voz.terminar?.()
    // El `await` es lo que hace que `act` espere a la cola de promesas: sin
    // él la consulta queda a medio camino y el test ve el estado de antes.
    await Promise.resolve()
  })
}

/** Atender, que es el punto de partida de todo lo demás. */
const atender = () => {
  render(<Llamada />)
  fireEvent.click(screen.getByRole('button', { name: /llamar a cata/i }))
}

/** Lo que el micrófono oyó, como si lo hubiera oído. */
const decirle = async (texto: string) => {
  await act(async () => {
    oido.oyentes?.frase(texto)
    // El `await` es lo que hace que `act` espere a la cola de promesas: sin
    // él la consulta queda a medio camino y el test ve el estado de antes.
    await Promise.resolve()
  })
}

describe('antes de llamar', () => {
  it('dice qué sabe y qué no, para no prometer lo que no hace', () => {
    render(<Llamada />)

    expect(screen.getByText(/el catálogo por teléfono/i)).toBeInTheDocument()
    expect(screen.getByText(/de clientes y documentos no sabe nada/i)).toBeInTheDocument()
    expect(oido.escuchando).toBe(false)
  })

  it('no manda nada antes de que alguien hable', () => {
    render(<Llamada />)
    expect(estado.enviado).toBeNull()
  })
})

describe('atender', () => {
  it('abre el micrófono y saluda', () => {
    atender()

    expect(oido.escuchando).toBe(true)
    expect(voz.dicho[0]).toMatch(/soy Cata/)
  })

  it('el saludo es un turno SUYO, no algo que pasa por afuera', async () => {
    /*
     * Antes se decía por fuera del estado, para que no viajara al modelo.
     * Salió caro: sin estar en el estado, el filtro de eco no tenía contra
     * qué comparar, el micrófono transcribió el saludo como si lo hubiera
     * dicho la persona y Cata se contestó a sí misma.
     *
     * Como turno se ve del lado de ella, el eco se reconoce, y encima el
     * modelo sabe que ya saludó. Cuesta veinte tokens por consulta.
     */
    atender()
    expect(screen.getByText(/soy Cata/)).toBeInTheDocument()

    await decirle('punta ph1')
    expect(estado.enviado?.turnos[0]?.rol).toBe('agente')
    expect(estado.enviado?.turnos[1]).toEqual({ rol: 'usuario', texto: 'punta ph1' })
  })
})

describe('un turno', () => {
  it('se muestra lo que se va oyendo, antes de que viaje', () => {
    atender()
    act(() => {
      oido.oyentes?.parcial('tenés punta ph')
    })

    // Dos veces a propósito: en el cartel de arriba, que es donde se mira
    // mientras se habla, y en el hilo, como burbuja en borrador.
    expect(screen.getAllByText('tenés punta ph').length).toBeGreaterThan(0)
    expect(estado.enviado).toBeNull()
  })

  it('manda lo que se oyó y muestra lo que contestó', async () => {
    atender()
    await decirle('tenés punta ph1')

    expect(estado.enviado?.companyId).toBe('c1')
    await waitFor(() => expect(screen.getByText('tenés el VPPH1/70')).toBeInTheDocument())
  })

  it('lo que se DICE va sin asteriscos; lo que se MUESTRA va resaltado', async () => {
    // El modelo resalta con asteriscos aunque se le pida que no. En la voz se
    // los saca `textoParaDecir`; en pantalla se resalta, que es lo que quiso
    // decir. Verlos crudos parece un error.
    estado.respuesta = { texto: 'tenés el **VPPH1/70** a doce dólares', pasos: [] }
    atender()
    await decirle('punta ph1')

    await waitFor(() => expect(voz.dicho).toContain('tenés el VPPH1/70 a doce dólares'))

    const fuerte = await screen.findByText('VPPH1/70')
    expect(fuerte.tagName).toBe('STRONG')
    expect(screen.queryByText(/\*\*/)).toBeNull()
  })

  it('cuando termina de hablar vuelve a escuchar sola', async () => {
    atender()
    await decirle('punta ph1')
    await waitFor(() => expect(screen.getByText('tenés el VPPH1/70')).toBeInTheDocument())

    await termineDeHablar()

    // Lo que la hace una LLAMADA: nadie apretó nada.
    expect(screen.getByText('Te escucho…')).toBeInTheDocument()
    expect(oido.escuchando).toBe(true)
  })
})

describe('la conversación entera viaja', () => {
  it('el segundo turno lleva lo anterior', async () => {
    // Sin esto, «¿y de ese cuánto queda?» llega sin saber de qué producto, y
    // Cata pregunta de nuevo lo que ya le dijeron.
    atender()
    await decirle('punta ph1')
    await waitFor(() => expect(screen.getByText('tenés el VPPH1/70')).toBeInTheDocument())

    estado.respuesta = { texto: 'quedan 544', pasos: [] }
    await decirle('y cuánto queda')

    // El primero es el saludo; de ahí en adelante, la conversación entera.
    expect(estado.enviado?.turnos.slice(1)).toEqual([
      { rol: 'usuario', texto: 'punta ph1' },
      { rol: 'agente', texto: 'tenés el VPPH1/70' },
      { rol: 'usuario', texto: 'y cuánto queda' },
    ])
  })
})

describe('el eco y la interrupción', () => {
  it('el micrófono sigue abierto mientras ella habla', async () => {
    atender()
    await decirle('punta ph1')

    // Es lo que permite cortarla. Cerrarlo era la forma obvia de no oírse a
    // sí misma, y es la que impide interrumpirla.
    expect(oido.escuchando).toBe(true)
  })

  it('oírse a sí misma no manda nada, y cortarla sí', async () => {
    // Cata está diciendo esto; el micrófono lo devuelve transcripto.
    estado.respuesta = { texto: 'tenés el VPPH1 a doce dólares, quedan quinientos', pasos: [] }
    atender()
    await decirle('punta ph1')
    await waitFor(() => expect(estado.enviado?.turnos).toHaveLength(2))

    const antes = estado.veces
    await decirle('tenés el VPPH1 a doce dólares')
    expect(estado.veces, 'el eco no tiene que viajar').toBe(antes)

    // Y alguien hablando sí la corta.
    await decirle('no, mejor la del tres')
    expect(estado.veces).toBe(antes + 1)
    expect(estado.enviado?.turnos.at(-1)).toEqual({
      rol: 'usuario',
      texto: 'no, mejor la del tres',
    })
  })

  it('al cortarla, la voz se calla en el acto', async () => {
    estado.respuesta = { texto: 'tenés el VPPH1 a doce dólares, quedan quinientos', pasos: [] }
    atender()
    await decirle('punta ph1')

    const antes = voz.callada
    await decirle('no, mejor la del tres')

    expect(voz.callada).toBeGreaterThan(antes)
  })

  it('del saludo oído por el parlante, se queda sólo con la pregunta', async () => {
    // El caso real, de punta a punta: el reconocedor manda el saludo entero
    // con la pregunta pegada al final.
    atender()
    await decirle(
      'Pregúntame por cualquier producto Del catálogo si lo tenemos A cuánto está ese ariestón',
    )

    expect(estado.enviado?.turnos.at(-1)).toEqual({ rol: 'usuario', texto: 'ese ariestón' })
  })
})

describe('colgar', () => {
  it('cierra el micrófono, calla la voz y deja la transcripción', async () => {
    atender()
    await decirle('punta ph1')
    await waitFor(() => expect(screen.getByText('tenés el VPPH1/70')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /colgar/i }))

    expect(oido.escuchando).toBe(false)
    expect(voz.callada).toBeGreaterThan(0)
    // El SKU dictado se anota DESPUÉS de colgar: por eso no se borra.
    expect(screen.getByText('tenés el VPPH1/70')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /llamar a cata/i })).toBeInTheDocument()
  })

  it('al desmontar se cierra el oído, pase lo que pase', () => {
    const { unmount } = render(<Llamada />)
    fireEvent.click(screen.getByRole('button', { name: /llamar a cata/i }))
    unmount()

    expect(oido.cerrado).toBe(true)
  })
})

describe('cuando falla', () => {
  it('uno que no corta se dice y se sigue escuchando', async () => {
    estado.error = new FalloCata('error', 'Se cayó la red', false, 'Se me cortó, ¿me lo repetís?')
    atender()
    await decirle('punta ph1')

    await waitFor(() => expect(voz.dicho).toContain('Se me cortó, ¿me lo repetís?'))
    await termineDeHablar()
    expect(screen.getByText('Te escucho…')).toBeInTheDocument()
  })

  it('uno que corta termina la llamada y MUESTRA el motivo de verdad', async () => {
    // Lo que se dice por el parlante es «avisale a sistemas»; lo que hay que
    // LEER para arreglarlo es que falta desplegar la función.
    estado.error = new FalloCata(
      'sin_desplegar',
      'Falta desplegar la función «cata».',
      true,
      'Todavía no estoy disponible. Avisale a sistemas.',
    )
    atender()
    await decirle('punta ph1')

    await waitFor(() => expect(screen.getByText('Se cortó la llamada')).toBeInTheDocument())
    expect(screen.getByText(/falta desplegar/i)).toBeInTheDocument()
    expect(voz.dicho).toContain('Todavía no estoy disponible. Avisale a sistemas.')
    expect(oido.escuchando).toBe(false)
  })

  it('sin micrófono ni permiso, lo dice y no insiste', async () => {
    atender()
    await act(async () => {
      oido.oyentes?.fallo('No encuentro ningún micrófono conectado.', true)
      // El `await` es lo que hace que `act` espere a la cola de promesas: sin
      // él la consulta queda a medio camino y el test ve el estado de antes.
      await Promise.resolve()
    })

    expect(screen.getByText('Se cortó la llamada')).toBeInTheDocument()
    expect(screen.getByText(/no encuentro ningún micrófono/i)).toBeInTheDocument()
  })
})
