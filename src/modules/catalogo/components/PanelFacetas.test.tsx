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

  it('desplegable de marca: aria-expanded, panel asociado, Escape cierra y devuelve el foco', () => {
    render(<PanelFacetas filtros={conCategoria} facetas={facetas} cargando={false} onCambiar={vi.fn()} />)
    const boton = screen.getByRole('button', { name: /Marca/ })
    expect(boton).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(boton)
    expect(boton).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById(boton.getAttribute('aria-controls')!)).toHaveAccessibleName('Marca')
    expect(screen.getByRole('radio', { name: /Torero/ })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(boton).toHaveAttribute('aria-expanded', 'false')
    expect(boton).toHaveFocus()
  })

  it('el ícono del desplegable es un SVG decorativo, no un glifo unicode', () => {
    const { container } = render(<PanelFacetas filtros={conCategoria} facetas={facetas} cargando={false} onCambiar={vi.fn()} />)
    expect(container).not.toHaveTextContent('▾')
    expect(screen.getByRole('button', { name: /Marca/ }).querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
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
