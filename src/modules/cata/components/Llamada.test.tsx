// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Oyentes } from '../lib/reconocedor'
import type { RespuestaDeCata, TurnoParaCata } from '../services/cata'

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
  respuesta: { texto: 'tenés el VPPH1/70', pasos: [] } as RespuestaDeCata,
  error: null as Error | null,
}))

const oido = vi.hoisted(() => ({
  oyentes: null as Oyentes | null,
  escuchando: false,
  cerrado: false,
  cuantasVeces: 0,
}))

const voz = vi.hoisted(() => ({ dicho: [] as string[], callada: 0 }))

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
    return Promise.resolve()
  },
  callar: () => {
    voz.callada += 1
  },
}))

/* El servicio se dobla pero `FalloCata` es la de verdad: el hook la distingue
   con `instanceof`, así que una copia de mentira haría pasar el test sin que
   el camino del fallo funcione. */
vi.mock('../services/cata', async (original) => {
  const real = await original<typeof import('../services/cata')>()
  return {
    ...real,
    hablarConCata: (p: { companyId: string; turnos: readonly TurnoParaCata[] }) => {
      estado.enviado = p
      if (estado.error) return Promise.reject(estado.error)
      return Promise.resolve(estado.respuesta)
    },
  }
})

const { Llamada } = await import('./Llamada')
const { FalloCata } = await import('../services/cata')

beforeEach(() => {
  estado.enviado = null
  estado.respuesta = { texto: 'tenés el VPPH1/70', pasos: [] }
  estado.error = null
  oido.oyentes = null
  oido.escuchando = false
  oido.cerrado = false
  oido.cuantasVeces = 0
  voz.dicho = []
  voz.callada = 0
})

/** Atender, que es el punto de partida de todo lo demás. */
const atender = () => {
  render(<Llamada />)
  fireEvent.click(screen.getByRole('button', { name: /llamar a cata/i }))
}

/** Lo que el micrófono oyó, como si lo hubiera oído. */
const decirle = async (texto: string) => {
  await act(async () => {
    oido.oyentes?.frase(texto)
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

    expect(screen.getByText('Te escucho…')).toBeInTheDocument()
    expect(oido.escuchando).toBe(true)
    expect(voz.dicho[0]).toMatch(/soy Cata/)
  })

  it('el saludo NO viaja como contexto al modelo', async () => {
    // Es lo que paga de más: el saludo no es respuesta a nada y repetirlo en
    // cada consulta sería contexto inútil en todas.
    atender()
    await decirle('punta ph1')

    expect(estado.enviado?.turnos).toEqual([{ rol: 'usuario', texto: 'punta ph1' }])
  })
})

describe('un turno', () => {
  it('se muestra lo que se va oyendo, antes de que viaje', () => {
    atender()
    act(() => {
      oido.oyentes?.parcial('tenés punta ph')
    })

    expect(screen.getByText('tenés punta ph')).toBeInTheDocument()
    expect(estado.enviado).toBeNull()
  })

  it('manda lo que se oyó y muestra lo que contestó', async () => {
    atender()
    await decirle('tenés punta ph1')

    expect(estado.enviado?.companyId).toBe('c1')
    await waitFor(() => expect(screen.getByText('tenés el VPPH1/70')).toBeInTheDocument())
  })

  it('lo que se DICE va sin asteriscos; lo que se MUESTRA va tal cual', async () => {
    estado.respuesta = { texto: 'tenés el **VPPH1/70** a doce dólares', pasos: [] }
    atender()
    await decirle('punta ph1')

    await waitFor(() =>
      expect(voz.dicho).toContain('tenés el VPPH1/70 a doce dólares'),
    )
    expect(screen.getByText('tenés el **VPPH1/70** a doce dólares')).toBeInTheDocument()
  })

  it('cuando termina de hablar vuelve a escuchar sola', async () => {
    atender()
    await decirle('punta ph1')

    await waitFor(() => expect(screen.getByText('Te escucho…')).toBeInTheDocument())
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

    expect(estado.enviado?.turnos).toEqual([
      { rol: 'usuario', texto: 'punta ph1' },
      { rol: 'agente', texto: 'tenés el VPPH1/70' },
      { rol: 'usuario', texto: 'y cuánto queda' },
    ])
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
    await waitFor(() => expect(screen.getByText('Te escucho…')).toBeInTheDocument())
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
    })

    expect(screen.getByText('Se cortó la llamada')).toBeInTheDocument()
    expect(screen.getByText(/no encuentro ningún micrófono/i)).toBeInTheDocument()
  })
})
