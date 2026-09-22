// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FILTROS_INICIALES, type FiltrosCatalogo, type ProductoListado } from '../types'

const estado = vi.hoisted(() => ({
  filtros: null as unknown as FiltrosCatalogo,
  productos: [] as ProductoListado[],
  total: 0,
  error: null as Error | null,
  movil: false,
}))
const llamadas = vi.hoisted(() => ({ actualizar: vi.fn(), limpiar: vi.fn(), refetch: vi.fn() }))

vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({ activa: { companyId: 'c1', companyName: 'ZZ', rol: 'admin', esInterno: true, customerId: null } }),
}))
vi.mock('@/hooks/useMediaQuery', () => ({ useIsMobile: () => estado.movil, useMediaQuery: () => false }))
vi.mock('../hooks/useFiltrosCatalogo', () => ({
  useFiltrosCatalogo: () => ({ filtros: estado.filtros, actualizar: llamadas.actualizar, limpiar: llamadas.limpiar }),
}))
vi.mock('../hooks/useCatalogoFacetas', () => ({
  useListasDePrecios: () => ({ listas: [{ id: 'l1', nombre: 'Lista general', moneda: 'USD', esPorDefecto: true }], porDefecto: { id: 'l1', nombre: 'Lista general', moneda: 'USD', esPorDefecto: true }, puedeElegir: false, cargando: false }),
  useFacetas: () => ({ data: { total: estado.total, categorias: [], subtipos: [], marcas: [], atributos: [] }, isFetching: false }),
  // Fase 21 · E1: las etiquetas de los atributos, para el modal y la ficha
  // al vuelo. Acá no importa su contenido.
  useDefinicionesDeAtributos: () => ({ data: [] }),
}))
vi.mock('../hooks/useProductos', () => ({
  useProductos: () =>
    estado.error
      ? { data: undefined, isPending: false, isFetching: false, error: estado.error, refetch: llamadas.refetch }
      : { data: { productos: estado.productos, total: estado.total }, isPending: false, isFetching: false, error: null, refetch: llamadas.refetch },
  useDisponibilidad: () => ({ data: undefined }),
}))

const { CatalogoPage } = await import('./CatalogoPage')

const producto = (i: number): ProductoListado => ({
  id: `p${i}`,
  sku: `ZZ-${i}`,
  nombre: `ZZ Llave ${i}`,
  serie: null,
  tipo: null,
  esKit: i === 1,
  necesitaRevision: false,
  marca: { id: 'm', nombre: 'ZZ Torero' },
  categoria: { id: 'c', nombre: 'ZZ Llaves' },
  atributos: {},
  precio: i === 2 ? null : 100,
  stock: null,
  disponible: null,
  imagen: null,
  enCatalogo: true,
})

const montar = () =>
  render(
    <MemoryRouter>
      <CatalogoPage />
    </MemoryRouter>,
  )

beforeEach(() => {
  Object.assign(estado, { filtros: { ...FILTROS_INICIALES }, productos: [], total: 0, error: null, movil: false })
  vi.clearAllMocks()
})

describe('Catálogo (Fase 13 · E4)', () => {
  it('h1 único, subtítulo con singular/plural y lista de precios, paginación común con tamaño', () => {
    estado.productos = [producto(1)]
    estado.total = 1
    montar()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByText('1 producto · Lista general')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Paginación del catálogo' })).toHaveTextContent('1–1 de 1 producto')
    fireEvent.change(screen.getByLabelText('Por página'), { target: { value: '100' } })
    expect(llamadas.actualizar).toHaveBeenCalledWith({ porPagina: 100 })
  })

  it('resultados: estado con texto (Kit), «Consultar» sin precio y el nombre como enlace al detalle', () => {
    estado.productos = [producto(1), producto(2)]
    estado.total = 2
    montar()
    expect(screen.getByText('Kit')).toBeInTheDocument()
    expect(screen.getByText('Consultar')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ZZ Llave 1' })).toHaveAttribute('href', '/catalogo/ZZ-1')
  })

  it('0 productos en la empresa: vacío sin CTA de crear (React no tiene ABM de productos)', () => {
    montar()
    expect(screen.getByRole('heading', { name: 'Todavía no hay productos' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Limpiar filtros' })).toBeNull()
    expect(screen.queryByRole('link', { name: /Nuevo/ })).toBeNull()
  })

  it('0 resultados por filtros o búsqueda: «Limpiar filtros» limpia', () => {
    estado.filtros = { ...FILTROS_INICIALES, q: 'zzznada' }
    montar()
    expect(screen.getByRole('heading', { name: 'Ningún producto coincide' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    expect(llamadas.limpiar).toHaveBeenCalled()
  })

  it('error: ErrorState con Reintentar', () => {
    estado.error = new Error('red caída')
    montar()
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar el catálogo.')
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(llamadas.refetch).toHaveBeenCalled()
  })

  it('mobile: tarjetas enlazadas, búsqueda visible y facetas plegadas detrás de «Filtros»', () => {
    estado.movil = true
    estado.productos = [producto(1)]
    estado.total = 1
    montar()
    expect(screen.getByRole('link', { name: /ZZ-1/ })).toHaveAttribute('href', '/catalogo/ZZ-1')
    expect(screen.getByRole('searchbox', { name: 'Buscar productos' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Filtros/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('table')).toBeNull()
  })
})
