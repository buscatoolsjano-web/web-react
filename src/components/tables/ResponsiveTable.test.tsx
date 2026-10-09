// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { Column } from './types'

const estado = vi.hoisted(() => ({ movil: false }))
vi.mock('@/hooks/useMediaQuery', () => ({ useIsMobile: () => estado.movil, useMediaQuery: () => estado.movil }))

const { ResponsiveTable } = await import('./ResponsiveTable')

interface Fila {
  id: string
  tipo: string
  proximo: string
  autoridad: string
}

const COLUMNAS: Column<Fila>[] = [
  { key: 'tipo', header: 'Tipo', mobile: 'title' },
  { key: 'proximo', header: 'Próximo', hideBelow: 'xl' },
  { key: 'extra', header: 'Extra', hideBelow: 'lg', render: () => 'dato secundario' },
  { key: 'autoridad', header: 'Autoridad' },
]
const FILAS: Fila[] = [{ id: '1', tipo: 'Cotizaciones', proximo: 'QUO00005', autoridad: 'STEL' }]

beforeEach(() => {
  estado.movil = false
})

describe('<ResponsiveTable> con prioridad de columnas', () => {
  it('las secundarias llevan la clase que las oculta por ancho; las esenciales, no', () => {
    render(<ResponsiveTable columns={COLUMNAS} rows={FILAS} rowKey={(f) => f.id} />)
    const [tipo, proximo, extra, autoridad] = screen.getAllByRole('columnheader')
    expect(proximo!.className).toMatch(/ocultaBajoXl/)
    expect(extra!.className).toMatch(/ocultaBajoLg/)
    expect(tipo!.className).not.toMatch(/oculta/)
    // La autoridad (STEL) es esencial: nunca se oculta por ancho.
    expect(autoridad!.className).not.toMatch(/oculta/)
    const celdas = within(screen.getAllByRole('row')[1]!).getAllByRole('cell')
    expect(celdas[1]!.className).toMatch(/ocultaBajoXl/)
    expect(celdas[3]).toHaveTextContent('STEL')
    expect(celdas[3]!.className).not.toMatch(/oculta/)
  })

  it('en mobile la card muestra también las columnas secundarias', () => {
    estado.movil = true
    render(<ResponsiveTable columns={COLUMNAS} rows={FILAS} rowKey={(f) => f.id} />)
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('QUO00005')).toBeInTheDocument()
    expect(screen.getByText('dato secundario')).toBeInTheDocument()
    expect(screen.getByText('STEL')).toBeInTheDocument()
  })

  it('cargando con skeleton anunciado; vacío con su mensaje', () => {
    const { rerender } = render(<ResponsiveTable columns={COLUMNAS} rows={[]} rowKey={(f) => f.id} isLoading />)
    expect(screen.getByRole('status', { name: 'Cargando…' })).toBeInTheDocument()
    rerender(<ResponsiveTable columns={COLUMNAS} rows={[]} rowKey={(f) => f.id} emptyMessage="Sin secuencias." />)
    expect(screen.getByText('Sin secuencias.')).toBeInTheDocument()
  })
})

/*
 * ANCHOS AJUSTABLES (Fase 58 · E6).
 *
 * «Es importante que las columnas respeten su tamaño… pero también quiero yo
 * poder ir modificando el tamaño, tipo ir agarrando y ampliarlo, achicarlo».
 */
import { act, fireEvent } from '@testing-library/react'
import { leerAnchos, MIN_PX } from './anchoDeColumnas'

/** El ancho que el colgroup le está dando a una columna, en px. */
function anchoDe(indice: number): number {
  const col = document.querySelectorAll('colgroup col')[indice] as HTMLElement
  return Number.parseInt(col.style.width, 10)
}

const tirador = (header: string) => screen.getByRole('separator', { name: `Ancho de ${header}` })

/** Un arrastre completo: agarrar, mover, soltar. */
function arrastrar(header: string, deltaPx: number) {
  const t = tirador(header)
  act(() => {
    fireEvent.pointerDown(t, { clientX: 500 })
  })
  act(() => {
    fireEvent.pointerMove(window, { clientX: 500 + deltaPx })
  })
  act(() => {
    fireEvent.pointerUp(window, { clientX: 500 + deltaPx })
  })
}

describe('<ResponsiveTable> con anchos ajustables', () => {
  beforeEach(() => localStorage.clear())

  /* Sin la prop, las ~40 tablas de la app siguen exactamente como estaban:
     ni colgroup, ni table-layout fijo, ni tiradores. */
  it('sin la prop no cambia nada de lo que ya andaba', () => {
    render(<ResponsiveTable columns={COLUMNAS} rows={FILAS} rowKey={(f) => f.id} />)
    expect(document.querySelector('colgroup')).toBeNull()
    expect(screen.queryByRole('separator')).toBeNull()
    expect(screen.getByRole('table').className).not.toMatch(/anchoFijo/)
  })

  /* `table-layout: fixed` es lo que hace que los anchos SE CUMPLAN: con el
     `auto` de antes, el width era una sugerencia que el navegador ignoraba en
     cuanto el contenido era más ancho. */
  it('con la prop, la tabla pasa a ancho fijo y declara un ancho por columna', () => {
    render(<ResponsiveTable columns={COLUMNAS} rows={FILAS} rowKey={(f) => f.id} anchosAjustables="prueba" />)
    expect(screen.getByRole('table').className).toMatch(/anchoFijo/)
    expect(document.querySelectorAll('colgroup col')).toHaveLength(COLUMNAS.length)
    for (let i = 0; i < COLUMNAS.length; i++) expect(anchoDe(i)).toBeGreaterThanOrEqual(MIN_PX)
  })

  it('arrastrar a la derecha ensancha la columna, y sólo esa', () => {
    render(<ResponsiveTable columns={COLUMNAS} rows={FILAS} rowKey={(f) => f.id} anchosAjustables="prueba" />)
    const antes = anchoDe(0)
    const vecina = anchoDe(1)

    arrastrar('Tipo', 60)

    expect(anchoDe(0)).toBe(antes + 60)
    expect(anchoDe(1)).toBe(vecina)
  })

  it('arrastrar a la izquierda la angosta, sin pasar del mínimo legible', () => {
    render(<ResponsiveTable columns={COLUMNAS} rows={FILAS} rowKey={(f) => f.id} anchosAjustables="prueba" />)
    arrastrar('Tipo', -40)
    expect(anchoDe(0)).toBeLessThan(220)
    arrastrar('Tipo', -5000)
    expect(anchoDe(0)).toBe(MIN_PX)
  })

  /*
   * El ancho se guarda AL SOLTAR, no en cada píxel: un gesto dispara cientos
   * de `pointermove` y escribir en localStorage en cada uno lo golpearía
   * cientos de veces por arrastre.
   */
  it('se guarda al soltar, no mientras se mueve', () => {
    render(<ResponsiveTable columns={COLUMNAS} rows={FILAS} rowKey={(f) => f.id} anchosAjustables="prueba" />)
    const t = tirador('Tipo')
    act(() => {
      fireEvent.pointerDown(t, { clientX: 500 })
    })
    act(() => {
      fireEvent.pointerMove(window, { clientX: 560 })
    })
    expect(leerAnchos('prueba')).toEqual({})

    act(() => {
      fireEvent.pointerUp(window, { clientX: 560 })
    })
    expect(leerAnchos('prueba').tipo).toBe(anchoDe(0))
  })

  it('al volver, la tabla arranca con el ancho que se dejó', () => {
    const { unmount } = render(<ResponsiveTable columns={COLUMNAS} rows={FILAS} rowKey={(f) => f.id} anchosAjustables="prueba" />)
    arrastrar('Tipo', 80)
    const dejado = anchoDe(0)
    unmount()

    render(<ResponsiveTable columns={COLUMNAS} rows={FILAS} rowKey={(f) => f.id} anchosAjustables="prueba" />)
    expect(anchoDe(0)).toBe(dejado)
  })

  it('cada tabla recuerda lo suyo', () => {
    const { unmount } = render(<ResponsiveTable columns={COLUMNAS} rows={FILAS} rowKey={(f) => f.id} anchosAjustables="una" />)
    arrastrar('Tipo', 80)
    unmount()
    render(<ResponsiveTable columns={COLUMNAS} rows={FILAS} rowKey={(f) => f.id} anchosAjustables="otra" />)
    expect(leerAnchos('otra')).toEqual({})
  })

  /*
   * TAMBIÉN CON EL TECLADO. Un tirador que sólo funciona arrastrando el mouse
   * deja la función afuera para quien no puede hacer un arrastre preciso.
   */
  it('las flechas cambian el ancho, y Shift lo cambia más rápido', () => {
    render(<ResponsiveTable columns={COLUMNAS} rows={FILAS} rowKey={(f) => f.id} anchosAjustables="prueba" />)
    const antes = anchoDe(0)

    act(() => {
      fireEvent.keyDown(tirador('Tipo'), { key: 'ArrowRight' })
    })
    const unPaso = anchoDe(0) - antes
    expect(unPaso).toBeGreaterThan(0)

    act(() => {
      fireEvent.keyDown(tirador('Tipo'), { key: 'ArrowRight', shiftKey: true })
    })
    expect(anchoDe(0) - antes - unPaso).toBeGreaterThan(unPaso)

    act(() => {
      fireEvent.keyDown(tirador('Tipo'), { key: 'Home' })
    })
    expect(anchoDe(0)).toBe(MIN_PX)
  })

  it('el tirador dice su ancho, para que un lector de pantalla lo pueda leer', () => {
    render(<ResponsiveTable columns={COLUMNAS} rows={FILAS} rowKey={(f) => f.id} anchosAjustables="prueba" />)
    const t = tirador('Próximo')
    expect(t).toHaveAttribute('aria-valuenow', String(anchoDe(1)))
    expect(t).toHaveAttribute('aria-orientation', 'vertical')
    expect(t).toHaveAttribute('tabindex', '0')
  })

  /* Agarrar el borde no puede disparar el clic de la fila ni el de la cabecera. */
  it('el arrastre no cuenta como un clic', () => {
    const alTocar = vi.fn()
    render(<ResponsiveTable columns={COLUMNAS} rows={FILAS} rowKey={(f) => f.id} onRowClick={alTocar} anchosAjustables="prueba" />)
    act(() => {
      fireEvent.click(tirador('Tipo'))
    })
    expect(alTocar).not.toHaveBeenCalled()
  })

  it('en mobile no hay tiradores: las cards no tienen columnas', () => {
    estado.movil = true
    render(<ResponsiveTable columns={COLUMNAS} rows={FILAS} rowKey={(f) => f.id} anchosAjustables="prueba" />)
    expect(screen.queryByRole('separator')).toBeNull()
  })
})
