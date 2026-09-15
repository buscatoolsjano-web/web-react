// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ListaPrecios, Marca } from '../lib/maestros'

const estado = vi.hoisted(() => ({ rol: 'admin', movil: false }))

vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({ activa: { companyId: 'c1', companyName: 'ZZ', rol: estado.rol, esInterno: true }, cargando: false }),
}))
vi.mock('@/hooks/useMediaQuery', () => ({ useIsMobile: () => estado.movil, useMediaQuery: () => estado.movil }))
// Las páginas sólo usan la clase de error del servicio. Sin este mock, el test
// importaría el cliente de Supabase y exigiría `.env` (test:isolated / CI).
vi.mock('../services/maestros', () => ({
  ErrorMaestro: class ErrorMaestro extends Error {
    constructor(readonly codigo: string) {
      super(codigo)
    }
  },
}))

const MARCAS: Marca[] = [
  { id: 'm1', nombre: 'SPEEDRILL', activa: true, productos: 4928, equipos: 0 },
  { id: 'm2', nombre: 'ZZ Libre', activa: true, productos: 0, equipos: 0 },
  { id: 'm3', nombre: 'Vieja', activa: false, productos: 2, equipos: 0 },
]
const LISTA: ListaPrecios = { id: 'l1', nombre: 'Lista base', moneda: 'USD', porDefecto: true, items: 120, itemsVigentes: 120, preciosCero: 0, vigenciaDesde: '2026-01-01', vigenciaHasta: null, clientes: 1 }

const mutacion = () => ({ isPending: false, mutateAsync: vi.fn().mockResolvedValue({ id: 'x', nombre: 'x', cambiado: true, productos: 0 }) })
const acciones = {
  crearMarca: mutacion(),
  estadoMarca: mutacion(),
  eliminarMarca: mutacion(),
  crearCategoria: mutacion(),
  renombrarCategoria: mutacion(),
  eliminarCategoria: mutacion(),
}
const items = vi.fn()

vi.mock('../hooks/useMaestros', () => ({
  useMarcas: () => ({ data: { filas: MARCAS, puedeEditar: estado.rol === 'admin' }, isPending: false, isError: false }),
  useAccionesMaestros: () => acciones,
  useListasPrecios: () => ({ data: [LISTA], isPending: false, isError: false }),
  useClientesDeLista: () => ({ data: { filas: [{ id: 'k1', nombre: 'Otro Cliente S.A.' }], total: 1 }, isPending: false, isError: false }),
  useItemsDeLista: (_id: string, q: { desplazamiento: number }) => {
    items(q)
    return {
      data: { total: 120, filas: [{ id: `p${q.desplazamiento}`, productoId: 'x', sku: 'SKU-1', nombre: 'Punta', marca: 'APEX', importe: 0, desde: '2026-01-01', hasta: null, vigencia: 'vigente', estadoProducto: 'active' }] },
      isPending: false,
      isError: false,
      isFetching: false,
    }
  },
}))

const { MarcasPage } = await import('./MarcasPage')
const { ListaPreciosDetallePage } = await import('./ListaPreciosDetallePage')
const { ListasPreciosPage } = await import('./ListasPreciosPage')

beforeEach(() => {
  estado.rol = 'admin'
  estado.movil = false
  items.mockClear()
})

describe('Marcas', () => {
  it('admin: crear, desactivar; Eliminar sólo en la marca sin uso', () => {
    render(<MarcasPage />)
    expect(screen.getByRole('button', { name: 'Nueva marca' })).toBeInTheDocument()
    const filaUsada = screen.getByText('SPEEDRILL').closest('tr')!
    expect(within(filaUsada).getByRole('button', { name: 'Desactivar' })).toBeInTheDocument()
    expect(within(filaUsada).queryByRole('button', { name: 'Eliminar' })).toBeNull()
    const filaLibre = screen.getByText('ZZ Libre').closest('tr')!
    expect(within(filaLibre).getByRole('button', { name: 'Eliminar' })).toBeInTheDocument()
    expect(within(screen.getByText('Vieja').closest('tr')!).getByRole('button', { name: 'Reactivar' })).toBeInTheDocument()
    expect(screen.getByText(/El nombre de una marca no se edita/)).toBeInTheDocument()
  })

  it('desactivar muestra el impacto y llama con activa=false', async () => {
    render(<MarcasPage />)
    fireEvent.click(within(screen.getByText('SPEEDRILL').closest('tr')!).getByRole('button', { name: 'Desactivar' }))
    const dialogo = screen.getByRole('dialog')
    expect(dialogo).toHaveTextContent('4.928 productos la siguen teniendo como marca')
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Desactivar' }))
    await screen.findByText('Marca «SPEEDRILL» desactivada.')
    expect(acciones.estadoMarca.mutateAsync).toHaveBeenCalledWith({ id: 'm1', activa: false })
  })

  it('filtro por estado y búsqueda', () => {
    render(<MarcasPage />)
    fireEvent.change(screen.getByLabelText('Filtrar por estado'), { target: { value: 'inactivas' } })
    expect(screen.queryByText('SPEEDRILL')).toBeNull()
    expect(screen.getByText('Vieja')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Filtrar por estado'), { target: { value: 'todas' } })
    fireEvent.change(screen.getByLabelText('Buscar marca'), { target: { value: 'speed' } })
    expect(screen.getByText('1 de 3')).toBeInTheDocument()
  })

  it('employee: sólo lectura explicada, sin botones de escritura', () => {
    estado.rol = 'employee'
    render(<MarcasPage />)
    expect(screen.getByText('Sólo lectura')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nueva marca' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Desactivar|Eliminar|Reactivar/ })).toBeNull()
  })

  it('mobile: cards con acciones', () => {
    estado.movil = true
    render(<MarcasPage />)
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getAllByRole('article')).toHaveLength(3)
    expect(screen.getAllByRole('button', { name: 'Desactivar' })).toHaveLength(2)
  })
})

describe('Listas de precios', () => {
  const detalle = () =>
    render(
      <MemoryRouter initialEntries={['/configuracion/listas-precios/l1']}>
        <Routes>
          <Route path="/configuracion/listas-precios/:id" element={<ListaPreciosDetallePage />} />
        </Routes>
      </MemoryRouter>,
    )

  it('listado: sólo lectura, sin acciones de edición', () => {
    render(
      <MemoryRouter>
        <ListasPreciosPage />
      </MemoryRouter>,
    )
    expect(screen.getByText(/Sólo lectura: los precios no se administran desde el ERP/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Lista base' })).toHaveAttribute('href', '/configuracion/listas-precios/l1')
    expect(screen.queryByRole('button', { name: /editar|nueva|eliminar/i })).toBeNull()
  })

  it('detalle: precio 0 con moneda, clientes y paginación server-side de a 50', () => {
    detalle()
    expect(screen.getByText('USD 0,00')).toBeInTheDocument()
    expect(screen.getByText('Otro Cliente S.A.')).toBeInTheDocument()
    expect(screen.getByText('1–50 de 120 precios')).toBeInTheDocument()
    expect(items).toHaveBeenLastCalledWith({ busqueda: '', vigencia: 'todas', desplazamiento: 0, limite: 50 })
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(items).toHaveBeenLastCalledWith({ busqueda: '', vigencia: 'todas', desplazamiento: 50, limite: 50 })
    fireEvent.change(screen.getByLabelText('Filtrar por vigencia'), { target: { value: 'futura' } })
    expect(items).toHaveBeenLastCalledWith({ busqueda: '', vigencia: 'futura', desplazamiento: 0, limite: 50 })
    expect(screen.queryByRole('button', { name: /editar|guardar/i })).toBeNull()
  })

  it('detalle de una lista de otra empresa: no existe', () => {
    render(
      <MemoryRouter initialEntries={['/configuracion/listas-precios/otra']}>
        <Routes>
          <Route path="/configuracion/listas-precios/:id" element={<ListaPreciosDetallePage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('Esta lista no existe en la empresa activa.')).toBeInTheDocument()
  })
})
