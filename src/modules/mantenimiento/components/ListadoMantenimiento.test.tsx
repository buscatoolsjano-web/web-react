// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { OrdenListado } from '../types'

const estado = vi.hoisted(() => ({ movil: false }))
vi.mock('@/hooks/useMediaQuery', () => ({ useIsMobile: () => estado.movil, useMediaQuery: () => estado.movil }))

const { ChipCotizacion, ChipEspera, ChipEstadoOrden, ChipEtapa, ChipResultado, ChipSituacion, ChipVeredicto } = await import('./ChipEstado')
const { ListadoOrdenes } = await import('./ListadoOrdenes')
const { Paginador } = await import('./Paginador')

const orden = (p: Partial<OrdenListado> = {}): OrdenListado => ({
  id: 'o1',
  numero: 'OS-00004',
  activoId: 'a1',
  activoReferencia: 'ZZ-EQ-4',
  activoSerie: 'ZZSN1003',
  clienteId: 'c1',
  cliente: 'ZZ Cliente 04',
  estado: 'open',
  etapa: 'diagnosis',
  enEspera: true,
  tipoServicio: 'preventive',
  motivoIngreso: null,
  tecnicoId: null,
  tecnico: null,
  fechaIngreso: '2026-09-14',
  fechaEntrega: null,
  estadoCotizacion: 'pending',
  moneda: 'USD',
  total: 0,
  ...p,
})

// Flechas, tildes y círculos sueltos: lo que la Fase 13 reemplazó por íconos.
const GLIFOS = /[↑↓←→✓○●×]/

beforeEach(() => {
  estado.movil = false
})

describe('Estados de Mantenimiento como Badge (mismas etiquetas)', () => {
  it('los tres ejes de la orden van en chips separados, siempre con texto', () => {
    const { container } = render(
      <>
        <ChipEstadoOrden estado="open" />
        <ChipEtapa estado="diagnosis" />
        <ChipEspera enEspera />
        <ChipEspera enEspera={false} />
        <ChipCotizacion estado="pending" />
        <ChipSituacion situacion="no-requerida" />
        <ChipResultado estado="nok" />
        <ChipVeredicto veredicto={null} />
      </>,
    )
    expect(screen.getByText('En espera')).toBeInTheDocument()
    expect(screen.getAllByText('En espera')).toHaveLength(1)
    expect(screen.getByText(/^Presupuesto: /)).toBeInTheDocument()
    expect(screen.getByText('Sin veredicto')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(GLIFOS)
  })
})

describe('Listado de órdenes', () => {
  const montar = (props: Partial<Parameters<typeof ListadoOrdenes>[0]> = {}) =>
    render(
      <MemoryRouter>
        <ListadoOrdenes filas={[orden()]} orden="fecha" direccion="desc" cargando={false} {...props} />
      </MemoryRouter>,
    )

  it('escritorio: orden anunciado con aria-sort e ícono, sin flechas unicode', () => {
    const onOrdenar = vi.fn()
    montar({ onOrdenar })
    const tabla = screen.getByRole('table')
    expect(within(tabla).getByRole('columnheader', { name: 'Ingreso' })).toHaveAttribute('aria-sort', 'descending')
    expect(within(tabla).getByRole('columnheader', { name: 'Número' })).toHaveAttribute('aria-sort', 'none')
    expect(tabla.textContent).not.toMatch(GLIFOS)
    fireEvent.click(within(tabla).getByRole('button', { name: 'Cliente' }))
    expect(onOrdenar).toHaveBeenCalledWith('cliente')
    // «sin asignar» sigue siendo un dato visible, no un hueco.
    expect(within(tabla).getByText('sin asignar')).toBeInTheDocument()
  })

  it('sublista de la ficha del equipo: sin botones de orden', () => {
    montar()
    expect(screen.queryByRole('button', { name: 'Cliente' })).toBeNull()
  })

  it('mobile: tarjetas con estado, etapa y espera', () => {
    estado.movil = true
    montar()
    expect(screen.queryByRole('table')).toBeNull()
    const tarjeta = screen.getByRole('link', { name: /OS-00004/ })
    expect(tarjeta).toHaveAttribute('href', '/mantenimiento/ordenes/o1')
    expect(within(tarjeta).getByText('En espera')).toBeInTheDocument()
    expect(within(tarjeta).getByText(/sin técnico asignado/)).toBeInTheDocument()
  })

  it('cargando sin filas: skeleton accesible; vacío: nada (la página muestra el EmptyState)', () => {
    const { rerender } = montar({ filas: [], cargando: true })
    expect(screen.getByRole('status', { name: 'Cargando órdenes…' })).toBeInTheDocument()
    rerender(
      <MemoryRouter>
        <ListadoOrdenes filas={[]} orden="fecha" direccion="desc" cargando={false} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('Paginador de Mantenimiento sobre Pagination', () => {
  it('página 1-based, singular y plural', () => {
    const onIr = vi.fn()
    const { rerender } = render(<Paginador pagina={1} porPagina={25} total={1} onIr={onIr} onTamano={vi.fn()} sustantivo={{ singular: 'orden', plural: 'órdenes' }} />)
    expect(screen.getByText('1–1 de 1 orden')).toBeInTheDocument()
    rerender(<Paginador pagina={1} porPagina={25} total={30} onIr={onIr} onTamano={vi.fn()} sustantivo={{ singular: 'orden', plural: 'órdenes' }} />)
    expect(screen.getByText('1–25 de 30 órdenes')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(onIr).toHaveBeenCalledWith(2)
  })
})
