// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { FiltrosActivos, PanelFacetas } from './PanelFacetas'
import { FILTROS_INICIALES, type Facetas, type FiltrosCatalogo } from '../types'

const facetas: Facetas = {
  total: 30,
  categorias: [
    { valor: 'c1', etiqueta: 'Llaves de torque', cantidad: 22 },
    { valor: 'c2', etiqueta: 'Atornilladores', cantidad: 8 },
  ],
  subtipos: [],
  series: [],
  marcas: [
    { valor: 'm1', etiqueta: 'Torero', cantidad: 7 },
    { valor: 'm2', etiqueta: 'Atlas', cantidad: 5 },
  ],
  atributos: [],
}

const conCategoria: FiltrosCatalogo = { ...FILTROS_INICIALES, categoria: 'c1' }

describe('Facetas del catálogo (Fase 13 · E4)', () => {
  it('chips de categoría con estado (aria-pressed) y conteo; elegir otra descarta subtipos y atributos', () => {
    const onCambiar = vi.fn()
    render(<PanelFacetas filtros={conCategoria} facetas={facetas} cargando={false} onCambiar={onCambiar} />)
    const grupo = screen.getByRole('group', { name: 'Categoría' })
    expect(within(grupo).getByRole('button', { name: /Llaves de torque/ })).toHaveAttribute('aria-pressed', 'true')
    expect(within(grupo).getByRole('button', { name: /Todas/ })).toHaveAttribute('aria-pressed', 'false')
    expect(within(grupo).getByRole('button', { name: /Atornilladores/ })).toHaveTextContent('8')
    fireEvent.click(within(grupo).getByRole('button', { name: /Atornilladores/ }))
    expect(onCambiar).toHaveBeenCalledWith({ categoria: 'c2', subtipos: [], atributos: {}, rangos: {} })
  })

  /**
   * Fase 38: el filtro de «Filtrar por» es una lista desplegable común.
   *
   * Antes era un botón que abría un panel flotante con buscador y casillas.
   * Tenía dos problemas: era un control distinto al de los filtros de la
   * tabla —dos cosas para lo mismo— y la fila scrollea en horizontal, lo que
   * recorta cualquier cosa que flote: el panel terminaba dibujado DENTRO de
   * la fila, sin su botón.
   *
   * Un `select` lo dibuja el sistema operativo por encima de todo.
   */
  it('cada filtro es un desplegable con sus opciones y el conteo de cada una', () => {
    const onCambiar = vi.fn()
    render(<PanelFacetas filtros={conCategoria} facetas={facetas} cargando={false} onCambiar={onCambiar} />)

    const marca = screen.getByLabelText('Filtrar por Marca')
    expect(marca.tagName).toBe('SELECT')
    // La primera opción dice qué se está filtrando, para que el control se
    // entienda sin depender de un rótulo al lado.
    expect(marca).toHaveTextContent('Marca · Todos')
    expect(marca).toHaveTextContent('Torero')

    fireEvent.change(marca, { target: { value: 'm2' } })
    expect(onCambiar).toHaveBeenCalledWith({ marca: 'm2' })
  })

  it('volver a «Todos» limpia ese filtro en vez de mandar una cadena vacía', () => {
    const onCambiar = vi.fn()
    render(
      <PanelFacetas
        filtros={{ ...conCategoria, marca: 'm2' }}
        facetas={facetas}
        cargando={false}
        onCambiar={onCambiar}
      />,
    )
    fireEvent.change(screen.getByLabelText('Filtrar por Marca'), { target: { value: '' } })
    expect(onCambiar).toHaveBeenCalledWith({ marca: null })
  })

  it('filtros aplicados: cada uno se quita solo y «Limpiar filtros» limpia todo; sin filtros no se muestra', () => {
    const onCambiar = vi.fn()
    const onLimpiar = vi.fn()
    const { rerender } = render(
      <FiltrosActivos filtros={{ ...conCategoria, marca: 'm2' }} facetas={facetas} onCambiar={onCambiar} onLimpiar={onLimpiar} />,
    )
    const grupo = screen.getByRole('group', { name: 'Filtros aplicados' })
    fireEvent.click(within(grupo).getByRole('button', { name: 'Quitar filtro: Atlas' }))
    expect(onCambiar).toHaveBeenCalledWith({ marca: null })
    fireEvent.click(within(grupo).getByRole('button', { name: 'Limpiar filtros' }))
    expect(onLimpiar).toHaveBeenCalled()
    expect(grupo).not.toHaveTextContent('✕')
    rerender(<FiltrosActivos filtros={FILTROS_INICIALES} facetas={facetas} onCambiar={onCambiar} onLimpiar={onLimpiar} />)
    expect(screen.queryByRole('group', { name: 'Filtros aplicados' })).toBeNull()
  })
})
