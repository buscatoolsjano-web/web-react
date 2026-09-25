// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { DocumentoListado } from '../types'

vi.mock('@/hooks/useMediaQuery', () => ({ useIsMobile: () => false, useMediaQuery: () => true }))

const { ListadoDocumentos } = await import('./ListadoDocumentos')

const doc = (p: Partial<DocumentoListado> = {}): DocumentoListado =>
  ({
    id: 'q1',
    tipo: 'cotizacion',
    numero: 'COTI02558',
    clienteNombre: 'El Gitano',
    fecha: '2026-09-20',
    total: 157.91,
    moneda: 'USD',
    titulo: 'PRUEBA PILOTO',
    estado: 'draft',
    estadoSecundario: null,
    origen: null,
    vendedor: null,
    necesitaRevision: false,
    motivosRevision: [],
    ...p,
  }) as DocumentoListado

/** Dice en qué ruta terminó la navegación, para no depender del DOM del detalle. */
function Destino() {
  const { pathname } = useLocation()
  return <p>estoy en {pathname}</p>
}

function montar(filas: DocumentoListado[] = [doc()], props: Record<string, unknown> = {}) {
  render(
    <MemoryRouter initialEntries={['/ventas/cotizaciones?page=3']}>
      <Routes>
        <Route
          path="/ventas/cotizaciones"
          element={
            <ListadoDocumentos
              filas={filas}
              orden="fecha"
              direccion="desc"
              onOrdenar={() => {}}
              etiquetaOrigen={null}
              cargando={false}
              {...props}
            />
          }
        />
        <Route path="*" element={<Destino />} />
      </Routes>
    </MemoryRouter>,
  )
}

const fila = () => screen.getAllByRole('row')[1]!

describe('el listado de documentos de venta', () => {
  /**
   * Fase 28 · E10: «no quiero tener que tocar solamente en el número, si no en
   * cualquier parte de la fila poder abrirlo».
   */
  it('tocar cualquier parte de la fila abre el documento', () => {
    montar()
    fireEvent.click(within(fila()).getByText('El Gitano'))
    expect(screen.getByText('estoy en /ventas/cotizaciones/q1')).toBeInTheDocument()
  })

  it('con el teclado también: la fila se enfoca y Enter abre', () => {
    montar()
    fireEvent.keyDown(fila(), { key: 'Enter', target: fila() })
    expect(screen.getByText('estoy en /ventas/cotizaciones/q1')).toBeInTheDocument()
  })

  // El número sigue siendo un enlace de verdad: se puede copiar la URL o
  // abrirla en otra pestaña, que es lo que la fila sola no da.
  it('el número sigue siendo un enlace con su URL', () => {
    montar()
    expect(screen.getByRole('link', { name: 'COTI02558' })).toHaveAttribute(
      'href',
      '/ventas/cotizaciones/q1',
    )
  })

  it('marcar la casilla NO abre el documento', () => {
    const onSeleccionar = vi.fn()
    montar([doc()], { seleccionados: new Set<string>(), onSeleccionar, onSeleccionarTodos: () => {} })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar COTI02558' }))
    expect(onSeleccionar).toHaveBeenCalledWith('q1', true)
    expect(screen.queryByText(/estoy en/)).toBeNull()
  })

  // Copiar un número termina en un click sobre la fila, y abrir el documento
  // ahí es exactamente lo contrario de lo que se quería.
  it('seleccionar texto no abre nada', () => {
    montar()
    const espia = vi
      .spyOn(window, 'getSelection')
      .mockReturnValue({ toString: () => 'COTI02' } as unknown as Selection)
    fireEvent.click(within(fila()).getByText('El Gitano'))
    espia.mockRestore()
    expect(screen.queryByText(/estoy en/)).toBeNull()
  })

  it('con Ctrl no navega: eso es «abrir en otra pestaña» del navegador', () => {
    montar()
    fireEvent.click(within(fila()).getByText('El Gitano'), { ctrlKey: true })
    expect(screen.queryByText(/estoy en/)).toBeNull()
  })
})
