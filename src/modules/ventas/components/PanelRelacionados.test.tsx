// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PanelRelacionados } from './PanelRelacionados'
import type { DocumentoRelacionado, Relacionados, TipoDocumento } from '../types'

/**
 * La cadena del documento (Fase 19 · E4).
 *
 * Lo que se prueba acá es qué secciones aparecen. Que un documento NO tenga
 * pedido es información y se muestra; que una cotización no esté relacionada
 * consigo misma no lo es.
 */
const vacio: Relacionados = { cotizaciones: [], pedidos: [], entregas: [], facturas: [], pagos: [] }

const doc = (p: Partial<DocumentoRelacionado> = {}): DocumentoRelacionado => ({
  tipo: 'cotizacion',
  id: 'otro',
  numero: 'COTI02100',
  fecha: '2026-09-01',
  estado: 'sent',
  moneda: 'USD',
  total: 100,
  ...p,
})

const montar = (relacionados: Relacionados, tipoActual: TipoDocumento, idActual = 'actual') =>
  render(
    <MemoryRouter>
      <PanelRelacionados relacionados={relacionados} cargando={false} idActual={idActual} tipoActual={tipoActual} />
    </MemoryRouter>,
  )

describe('PanelRelacionados', () => {
  it('una cotización no se muestra relacionada consigo misma', () => {
    montar(vacio, 'cotizacion')
    expect(screen.queryByRole('heading', { name: 'Cotización' })).toBeNull()
    // Lo que sí sigue estando: la cadena hacia adelante, aunque esté vacía.
    expect(screen.getByRole('heading', { name: 'Pedido' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Entregas' })).toBeInTheDocument()
  })

  it('la misma regla para el pedido y para el remito', () => {
    const { unmount } = montar(vacio, 'pedido')
    expect(screen.queryByRole('heading', { name: 'Pedido' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Cotización' })).toBeInTheDocument()
    unmount()

    montar(vacio, 'entrega')
    expect(screen.queryByRole('heading', { name: 'Entregas' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Pedido' })).toBeInTheDocument()
  })

  it('si hay OTRO documento del mismo tipo, la sección aparece', () => {
    montar({ ...vacio, cotizaciones: [doc()] }, 'cotizacion')
    expect(screen.getByRole('heading', { name: 'Cotización' })).toBeInTheDocument()
    expect(screen.getByText('COTI02100')).toBeInTheDocument()
  })

  it('el propio documento nunca se lista, aunque venga en la respuesta', () => {
    montar({ ...vacio, cotizaciones: [doc({ id: 'actual', numero: 'COTI02558' })] }, 'cotizacion')
    expect(screen.queryByText('COTI02558')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Cotización' })).toBeNull()
  })

  it('facturas y cobranzas siguen sin aparecer vacías: todavía no existen', () => {
    montar(vacio, 'cotizacion')
    expect(screen.queryByRole('heading', { name: 'Facturas' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Cobranzas' })).toBeNull()
  })
})
