// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { FilaBandeja } from '../types'

/**
 * Elegir varios hilos con casillas y hacerles algo a todos (Fase 59 · E3).
 *
 * «Quiero poder ir cliqueando, tipo marcando con cuadraditos X los mails que
 * quiera, para poder hacer acciones rápidas con varios. Por ejemplo, marcar
 * como leído, como pasa en Gmail».
 */

const lote = vi.hoisted(() => ({
  leidos: [] as string[][],
  eliminados: [] as { ids: string[]; eliminar: boolean }[],
  fallan: [] as string[],
  trabajando: false,
}))

vi.mock('../hooks/useEmails', () => ({
  useAccionesEnLote: () => ({
    marcarLeidos: {
      isPending: lote.trabajando,
      mutateAsync: (filas: FilaBandeja[]) => {
        lote.leidos.push(filas.map((f) => f.id))
        return Promise.resolve(filas.filter((f) => lote.fallan.includes(f.id)))
      },
    },
    eliminar: {
      isPending: lote.trabajando,
      mutateAsync: ({ filas, eliminar }: { filas: FilaBandeja[]; eliminar: boolean }) => {
        lote.eliminados.push({ ids: filas.map((f) => f.id), eliminar })
        return Promise.resolve(filas.filter((f) => lote.fallan.includes(f.id)))
      },
    },
  }),
}))

const { ListadoEmails } = await import('./ListadoEmails')

const fila = (p: Partial<FilaBandeja> = {}): FilaBandeja => ({
  id: 'h1',
  accountId: 'a1',
  gmailThreadId: 'g1',
  asunto: 'Pedido de cotización',
  extracto: '',
  ultimoMensajeEn: '2026-09-14T15:00:00Z',
  ultimoRemitente: 'Cliente Uno',
  ultimaDireccion: 'in',
  participantes: [],
  cantidadMensajes: 1,
  tieneAdjuntos: false,
  estado: 'pendiente',
  asignadoA: null,
  asignadoNombre: null,
  clienteId: null,
  clienteNombre: null,
  vinculoOrigen: null,
  sinLeer: true,
  eliminado: false,
  etiquetas: [],
  ...p,
})

const TRES = [
  fila({ id: 'h1', asunto: 'Uno', sinLeer: true }),
  fila({ id: 'h2', asunto: 'Dos', sinLeer: false }),
  fila({ id: 'h3', asunto: 'Tres', sinLeer: true }),
]

const montar = (filas: FilaBandeja[] = TRES) =>
  render(
    <MemoryRouter>
      <ListadoEmails filas={filas} buzones={new Map()} />
    </MemoryRouter>,
  )

const casillaDe = (asunto: string) => screen.getByLabelText(`Elegir: ${asunto}`)
const maestra = () => screen.getByLabelText<HTMLInputElement>('Elegir todos los hilos de esta página')

async function clic(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el)
    await Promise.resolve()
  })
}

beforeEach(() => {
  lote.leidos = []
  lote.eliminados = []
  lote.fallan = []
  lote.trabajando = false
})

describe('elegir hilos', () => {
  it('cada fila tiene su casilla, nombrada por su asunto', () => {
    montar()
    for (const a of ['Uno', 'Dos', 'Tres']) expect(casillaDe(a)).toBeInTheDocument()
  })

  /* Un control dentro de un `<a>` no es HTML válido y el teclado no llega a
     los dos: la casilla va al lado del enlace, como las demás acciones. */
  it('la casilla no está adentro del enlace de la fila', () => {
    montar()
    expect(casillaDe('Uno').closest('a')).toBeNull()
  })

  it('sin nada elegido no hay barra de acciones', () => {
    montar()
    expect(screen.queryByText(/hilos? elegidos?/)).toBeNull()
  })

  it('al marcar aparece la barra y dice cuántos', async () => {
    montar()
    await clic(casillaDe('Uno'))
    expect(screen.getByText('1 hilo elegido')).toBeInTheDocument()
    await clic(casillaDe('Dos'))
    expect(screen.getByText('2 hilos elegidos')).toBeInTheDocument()
  })

  it('«Quitar la selección» deja la lista como estaba', async () => {
    montar()
    await clic(casillaDe('Uno'))
    await clic(screen.getByRole('button', { name: 'Quitar la selección' }))
    expect(screen.queryByText(/hilos? elegidos?/)).toBeNull()
    expect(casillaDe('Uno')).not.toBeChecked()
  })
})

describe('la casilla de arriba', () => {
  it('marca y desmarca todas', async () => {
    montar()
    await clic(maestra())
    for (const a of ['Uno', 'Dos', 'Tres']) expect(casillaDe(a)).toBeChecked()
    await clic(maestra())
    for (const a of ['Uno', 'Dos', 'Tres']) expect(casillaDe(a)).not.toBeChecked()
  })

  /* «A medias» no es un tercer estado del checkbox en HTML: es una propiedad
     del DOM. Si no se pusiera, con dos de tres marcadas la casilla de arriba
     se vería vacía y parecería que no hay nada elegido. */
  it('queda a medias cuando hay algunas, y llena cuando están todas', async () => {
    montar()
    await clic(casillaDe('Uno'))
    expect(maestra().indeterminate).toBe(true)
    expect(maestra().checked).toBe(false)

    await clic(casillaDe('Dos'))
    await clic(casillaDe('Tres'))
    expect(maestra().indeterminate).toBe(false)
    expect(maestra().checked).toBe(true)
  })
})

describe('marcar como leído en lote', () => {
  /*
   * EL BOTÓN DICE CUÁNTOS VA A TOCAR, no cuántos hay elegidos. De los tres,
   * «Dos» ya está leído: marcar los tres cambiaría dos.
   */
  it('con tres elegidos y uno ya leído, ofrece marcar los dos', async () => {
    montar()
    await clic(maestra())
    expect(screen.getByRole('button', { name: /Marcar los 2 como leídos/ })).toBeInTheDocument()
  })

  it('manda sólo los que están sin leer', async () => {
    montar()
    await clic(maestra())
    await clic(screen.getByRole('button', { name: /Marcar los 2 como leídos/ }))
    expect(lote.leidos).toEqual([['h1', 'h3']])
  })

  /* Si ya están todos leídos, el botón no se dibuja: mandaría llamadas para
     no cambiar nada. */
  it('con todos leídos, el botón no aparece', async () => {
    montar([fila({ id: 'h1', asunto: 'Uno', sinLeer: false })])
    await clic(casillaDe('Uno'))
    expect(screen.queryByRole('button', { name: /como leído/ })).toBeNull()
  })

  it('al terminar dice cuántos se marcaron y limpia la selección', async () => {
    montar()
    await clic(casillaDe('Uno'))
    await clic(screen.getByRole('button', { name: /Marcar 1 como leído/ }))
    expect(screen.getByText('1 hilo marcados como leídos.')).toBeInTheDocument()
    expect(casillaDe('Uno')).not.toBeChecked()
  })

  /*
   * LOS QUE FALLARON QUEDAN ELEGIDOS. Así se puede reintentar sin volver a
   * buscarlos uno por uno, y el mensaje dice cuántos sí salieron en vez de
   * fingir que salió todo bien.
   */
  it('si alguno falla, lo dice y lo deja elegido para reintentar', async () => {
    lote.fallan = ['h3']
    montar()
    await clic(maestra())
    await clic(screen.getByRole('button', { name: /Marcar los 2 como leídos/ }))

    expect(screen.getByText(/1 de 2 marcados como leídos/)).toBeInTheDocument()
    expect(casillaDe('Tres')).toBeChecked()
    expect(casillaDe('Uno')).not.toBeChecked()
  })
})

describe('eliminar y restaurar en lote', () => {
  it('elimina los elegidos', async () => {
    montar()
    await clic(casillaDe('Uno'))
    await clic(casillaDe('Dos'))
    await clic(screen.getByRole('button', { name: 'Eliminar' }))
    expect(lote.eliminados).toEqual([{ ids: ['h1', 'h2'], eliminar: true }])
  })

  /*
   * EN ELIMINADOS SE RESTAURA. Y sale de la fila, no de qué carpeta se está
   * mirando: una cosa menos que puede quedar desincronizada.
   */
  it('en un hilo eliminado ofrece restaurar, no eliminar', async () => {
    montar([fila({ id: 'h9', asunto: 'Borrado', eliminado: true, sinLeer: false })])
    await clic(casillaDe('Borrado'))
    expect(screen.queryByRole('button', { name: /^Eliminar/ })).toBeNull()
    await clic(screen.getByRole('button', { name: /^Restaurar/ }))
    expect(lote.eliminados).toEqual([{ ids: ['h9'], eliminar: false }])
  })

  /* Con una selección mezclada, cada botón toca SU parte: eliminar no
     restaura de paso. */
  it('con una selección mezclada, cada botón actúa sobre lo suyo', async () => {
    montar([
      fila({ id: 'h1', asunto: 'Uno', sinLeer: false }),
      fila({ id: 'h9', asunto: 'Borrado', eliminado: true, sinLeer: false }),
    ])
    await clic(maestra())
    await clic(screen.getByRole('button', { name: /^Eliminar/ }))
    expect(lote.eliminados).toEqual([{ ids: ['h1'], eliminar: true }])
  })
})

describe('mientras el lote está en curso', () => {
  it('las casillas y los botones quedan bloqueados', async () => {
    lote.trabajando = true
    montar()
    await clic(casillaDe('Uno'))
    // Con `isPending` en true ya arranca bloqueado: no hay forma de elegir
    // más mientras una tanda está yendo y viniendo.
    expect(casillaDe('Uno')).toBeDisabled()
    expect(maestra()).toBeDisabled()
  })
})

describe('al cambiar lo que se está mirando', () => {
  /*
   * Lo elegido en una carpeta no sigue elegido en otra: una acción en lote
   * sobre hilos que ya no se ven sería a ciegas.
   */
  it('cambiar de lista limpia la selección', async () => {
    const { rerender } = montar()
    await clic(casillaDe('Uno'))
    expect(screen.getByText('1 hilo elegido')).toBeInTheDocument()

    await act(async () => {
      rerender(
        <MemoryRouter>
          <ListadoEmails filas={[fila({ id: 'otro', asunto: 'De otra carpeta' })]} buzones={new Map()} />
        </MemoryRouter>,
      )
      await Promise.resolve()
    })
    expect(screen.queryByText(/hilos? elegidos?/)).toBeNull()
  })

  it('un re-render con las mismas filas no borra lo elegido', async () => {
    const { rerender } = montar()
    await clic(casillaDe('Uno'))
    await act(async () => {
      rerender(
        <MemoryRouter>
          <ListadoEmails filas={TRES} buzones={new Map()} />
        </MemoryRouter>,
      )
      await Promise.resolve()
    })
    expect(screen.getByText('1 hilo elegido')).toBeInTheDocument()
  })
})

describe('se puede apagar', () => {
  it('sin selección no hay casillas ni cabecera', () => {
    render(
      <MemoryRouter>
        <ListadoEmails filas={TRES} buzones={new Map()} conSeleccion={false} />
      </MemoryRouter>,
    )
    expect(screen.queryByLabelText('Elegir todos los hilos de esta página')).toBeNull()
    expect(within(screen.getByRole('list', { name: 'Hilos de correo' })).queryAllByRole('checkbox')).toHaveLength(0)
  })
})
