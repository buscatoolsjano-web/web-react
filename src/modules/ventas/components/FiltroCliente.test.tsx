// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

/**
 * El filtro de cliente del listado (Fase 40).
 *
 * Lo que se prueba es la diferencia con el `<select>` que reemplazó: que
 * pregunte al servidor en vez de pintar una lista fija —el maestro tiene 1.010
 * clientes y el desplegable mostraba los primeros 500 sin avisarlo—, y que el cliente
 * elegido se lea estando cerrado. Un filtro puesto que no se ve es peor que no
 * tener filtro: hace jurar que un documento no existe.
 */
const estado = vi.hoisted(() => ({
  busquedas: [] as string[],
  resultados: [
    { id: 'c-whirlpool', nombre: 'WHIRLPOOL ARGENTINA S.A.', dadoDeBaja: false, referencia: 'CLI00719' },
    { id: 'c-vieja', nombre: 'VIEJA S.R.L.', dadoDeBaja: true, referencia: null },
  ],
  elegido: null as { nombre: string; dadoDeBaja: boolean } | null,
}))

vi.mock('../hooks/useDocumentos', () => ({
  useNombreDeCliente: () => ({ data: estado.elegido, isPending: false }),
  useBuscarClientesParaFiltro: (texto: string, habilitado: boolean) => {
    if (habilitado && texto.trim().length >= 2) estado.busquedas.push(texto)
    return {
      data: habilitado && texto.trim().length >= 2 ? estado.resultados : [],
      isFetching: false,
      error: null,
    }
  },
}))

const { FiltroCliente } = await import('./FiltroCliente')

beforeEach(() => {
  estado.busquedas = []
  estado.elegido = null
})

/**
 * Abre el panel, escribe y adelanta el debounce de 300 ms.
 *
 * El `act` no es ceremonia: el timer dispara un setState, y sin él React no
 * vuelve a renderizar, así que la lista queda vacía y el test miente.
 */
function buscar(texto: string) {
  vi.useFakeTimers()
  try {
    fireEvent.click(screen.getByRole('button', { name: /filtrar por cliente/i }))
    fireEvent.change(screen.getByRole('searchbox', { name: /buscar cliente/i }), { target: { value: texto } })
    act(() => {
      vi.advanceTimersByTime(300)
    })
  } finally {
    vi.useRealTimers()
  }
}

describe('El filtro de cliente', () => {
  it('sin filtro dice «Todos los clientes» y no le pide nada al servidor', () => {
    render(<FiltroCliente valor={null} onElegir={() => {}} />)

    expect(screen.getByRole('button', { name: /filtrar por cliente/i })).toHaveTextContent('Todos los clientes')
    // Cerrado no hay caja de texto, y sobre todo no hay consulta: el listado
    // no puede pagar una búsqueda de clientes cada vez que se abre.
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(estado.busquedas).toEqual([])
  })

  it('busca contra el servidor y muestra la referencia del legacy', () => {
    render(<FiltroCliente valor={null} onElegir={() => {}} />)
    buscar('whirl')

    expect(estado.busquedas).toContain('whirl')
    const opcion = screen.getByRole('option', { name: /WHIRLPOOL/ })
    expect(opcion).toHaveTextContent('CLI00719')
  })

  /**
   * Un cliente dado de baja TIENE que ofrecerse acá, al revés que en el alta.
   * Sus documentos existen; si no se lo puede elegir, no hay forma de llegar a
   * ellos por cliente.
   */
  it('ofrece también los dados de baja, marcados', () => {
    render(<FiltroCliente valor={null} onElegir={() => {}} />)
    buscar('s.r.l')

    expect(screen.getByRole('option', { name: /VIEJA S.R.L/ })).toHaveTextContent('de baja')
  })

  it('al elegir avisa el id y cierra el panel', () => {
    const elegidos: (string | null)[] = []
    render(<FiltroCliente valor={null} onElegir={(id) => elegidos.push(id)} />)
    buscar('whirl')

    fireEvent.click(screen.getByRole('option', { name: /WHIRLPOOL/ }))
    expect(elegidos).toEqual(['c-whirlpool'])
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })

  it('«Todos los clientes» está siempre y limpia el filtro', () => {
    estado.elegido = { nombre: 'WHIRLPOOL ARGENTINA S.A.', dadoDeBaja: false }
    const elegidos: (string | null)[] = []
    render(<FiltroCliente valor="c-whirlpool" onElegir={(id) => elegidos.push(id)} />)

    // Cerrado se lee QUÉ cliente está filtrando, no un rótulo genérico.
    expect(screen.getByRole('button', { name: /cambiar el cliente/i })).toHaveTextContent('WHIRLPOOL')

    fireEvent.click(screen.getByRole('button', { name: /cambiar el cliente/i }))
    fireEvent.click(screen.getByRole('option', { name: 'Todos los clientes' }))
    expect(elegidos).toEqual([null])
  })
})
