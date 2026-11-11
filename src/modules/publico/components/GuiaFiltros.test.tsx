// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { GuiaFiltros } from './GuiaFiltros'
import type { FacetasPublicas } from '../services/catalogoPublico'

const facetas: FacetasPublicas = {
  total: 10,
  marcas: [],
  categorias: [],
  series: [],
  tipos: [],
  atributos: [
    {
      key: 'encastre',
      label: 'Encastre',
      unidad: null,
      cubiertos: 10,
      opciones: [
        { valor: '1/4', cuantos: 6 },
        { valor: 'Allen', cuantos: 4 },
      ],
    },
  ],
}

const guia = (cargando: boolean, onFiltrar = vi.fn()) => (
  <GuiaFiltros
    categoria="puntas-y-tubos"
    categorias={[]}
    facetas={facetas}
    tipo=""
    atributos={{}}
    total={10}
    cargando={cargando}
    onFiltrar={onFiltrar}
    onCategoria={vi.fn()}
  />
)

describe('GuiaFiltros', () => {
  it('mientras llegan los filtros nuevos, las opciones de antes no se pueden tocar', () => {
    // El bug: tocando rápido se elegía una opción de los filtros VIEJOS (el
    // placeholder) que ya no existía con lo recién elegido → 0 productos.
    const onFiltrar = vi.fn()
    render(guia(true, onFiltrar))
    const allen = screen.getByRole('button', { name: /Allen/ })
    expect(allen).toBeDisabled()
    fireEvent.click(allen)
    expect(onFiltrar).not.toHaveBeenCalled()
  })

  it('con los filtros al día, elegir filtra', () => {
    const onFiltrar = vi.fn()
    render(guia(false, onFiltrar))
    fireEvent.click(screen.getByRole('button', { name: /Allen/ }))
    expect(onFiltrar).toHaveBeenCalledWith('a.encastre', 'Allen')
  })
})
