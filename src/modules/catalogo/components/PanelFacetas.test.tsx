// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { FiltrosActivos, PanelFacetas } from './PanelFacetas'
import { FILTROS_INICIALES, type FacetaAtributo, type Facetas, type FiltrosCatalogo } from '../types'

const facetas: Facetas = {
  total: 30, totalCatalogo: 30,
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

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * Fase 60 — que los filtros estén completos y no engañen.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const faceta = (key: string, label: string, vals: string[]): FacetaAtributo => ({
  key,
  label,
  unidad: null,
  clase: 'enum',
  opciones: vals.map((v) => ({ valor: v, etiqueta: v, cantidad: 1 })),
  min: null,
  max: null,
})

describe('el chip «Todas» dice a dónde lleva', () => {
  /*
   * EL PEDIDO. «Si pongo Puntas y tubos, el de TODAS tiene que seguir
   * diciendo 21.802, no 8.600». «Todas» es el botón para QUITAR el filtro de
   * categoría: tiene que decir a cuántos se vuelve, no cuántos hay ahora.
   */
  it('con una categoría puesta muestra el total del catálogo, no el filtrado', () => {
    render(
      <PanelFacetas
        filtros={conCategoria}
        facetas={{ ...facetas, total: 8600, totalCatalogo: 21802 }}
        cargando={false}
        onCambiar={vi.fn()}
      />,
    )
    const todas = within(screen.getByRole('group', { name: 'Categoría' })).getByRole('button', { name: /Todas/ })
    expect(todas).toHaveTextContent('21.802')
    expect(todas).not.toHaveTextContent('8.600')
  })
})

describe('las categorías están siempre', () => {
  /*
   * «Pongo torque mínimo 2 y de la nada dejan de aparecer las categorías
   * arriba. Eso tiene que estar siempre». El servidor ya no las recorta con
   * los otros filtros (Fase 60), así que acá se verifica que la pantalla las
   * dibuje todas aunque haya un rango puesto.
   */
  it('con un rango de atributo aplicado siguen todas las categorías', () => {
    render(
      <PanelFacetas
        filtros={{ ...conCategoria, rangos: { torq_min: { min: 2, max: null } } }}
        facetas={facetas}
        cargando={false}
        onCambiar={vi.fn()}
      />,
    )
    const grupo = screen.getByRole('group', { name: 'Categoría' })
    expect(within(grupo).getByRole('button', { name: /Llaves de torque/ })).toBeInTheDocument()
    expect(within(grupo).getByRole('button', { name: /Atornilladores/ })).toBeInTheDocument()
  })
})

describe('un filtro con una sola opción no se ofrece', () => {
  /* «Si es sólo uno, ¿qué vas a filtrar si es sólo eso?» */
  it('el atributo con un único valor no aparece; el de dos sí', () => {
    render(
      <PanelFacetas
        filtros={conCategoria}
        facetas={{
          ...facetas,
          atributos: [faceta('carcasa', 'Carcasa', ['Aluminio']), faceta('encastre', 'Encastre', ['1/4', '1/2'])],
        }}
        cargando={false}
        onCambiar={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText('Filtrar por Carcasa')).toBeNull()
    expect(screen.getByLabelText('Filtrar por Encastre')).toBeInTheDocument()
  })

  /* Pero el que ya está elegido se muestra igual: si desapareciera, el filtro
     quedaría puesto sin ningún lugar desde donde soltarlo. */
  it('el que está elegido se muestra aunque le quede una sola opción', () => {
    render(
      <PanelFacetas
        filtros={{ ...conCategoria, atributos: { carcasa: ['Aluminio'] } }}
        facetas={{ ...facetas, atributos: [faceta('carcasa', 'Carcasa', ['Aluminio'])] }}
        cargando={false}
        onCambiar={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('Filtrar por Carcasa')).toBeInTheDocument()
  })

  it('con una sola marca tampoco se ofrece el desplegable', () => {
    render(
      <PanelFacetas
        filtros={conCategoria}
        facetas={{ ...facetas, marcas: [{ valor: 'm1', etiqueta: 'Torero', cantidad: 7 }] }}
        cargando={false}
        onCambiar={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText('Filtrar por Marca')).toBeNull()
  })
})

describe('el botón de la derecha no se come las categorías', () => {
  /*
   * «El botón de limpiar siempre tiene que estar al margen derecho, porque si
   * pongo Puntas y tubos me aparece y no leo Llaves dinamométricas y Otros».
   *
   * Reservaba 24rem fijos —de cuando ahí vivía el buscador— y se los sacaba a
   * la fila de chips, que scrollea. El test mira el contrato que importa:
   * está en la fila, pegado a la derecha y FUERA del contenedor que scrollea.
   */
  it('va al final de la fila y fuera del carrusel de chips', () => {
    render(
      <PanelFacetas
        filtros={conCategoria}
        facetas={facetas}
        cargando={false}
        onCambiar={vi.fn()}
        extra={<button type="button">Limpiar filtros</button>}
      />,
    )
    const limpiar = screen.getByRole('button', { name: 'Limpiar filtros' })
    const grupo = screen.getByRole('group', { name: 'Categoría' })
    expect(grupo.contains(limpiar)).toBe(false)
    expect(limpiar.parentElement?.className).toMatch(/extra/)
  })
})
