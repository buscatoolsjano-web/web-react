// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DefinicionAtributo, ProductoDetalle } from '../types'

/*
 * El botón «Editar» dentro del modal (Fase 136).
 *
 * Lo que se prueba es el enganche nuevo: que el botón aparezca sólo para quien
 * puede escribir y que abra el MISMO editor de la ficha. El guardado y la
 * validación ya los cubre `edicionProducto.test.ts`, así que acá no se repiten.
 *
 * Los mocks NO importan el módulo real: hacerlo arrastra `services/supabase`,
 * que exige variables de entorno y tira la suite aislada de CI. Se declara sólo
 * lo que el modal usa.
 */
const estado = vi.hoisted((): { rol: string } => ({ rol: 'admin' }))

vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({
    activa: { companyId: 'empresa-1', esInterno: true, rol: estado.rol },
  }),
}))

const producto: ProductoDetalle = {
  id: 'p1',
  sku: 'SP.2520/8B',
  nombre: 'SPEEDRILL 2520/8B ADAPTADOR',
  modelo: '2520/8B',
  serie: 'Adaptador',
  tipo: 'Adaptador',
  esKit: false,
  necesitaRevision: false,
  marca: { id: 'm1', nombre: 'SPEEDRILL' },
  categoria: { id: 'c1', nombre: 'Puntas y tubos', slug: 'punta' },
  atributos: { encastre: '1/4 HEX', largo: '200', medida: '8' },
  precio: 83.37,
  precioDesde: null,
  precioOrigen: 'tarifa',
  precioTarifa: 83.37,
  stock: { real: 16, virtual: 16 },
  disponible: null,
  imagen: null,
  enCatalogo: true,
  motivoFueraDelCatalogo: null,
  imagenes: [],
  descripcion: 'Adaptador SPEEDRILL',
  descripcionLarga: null,
  origen: null,
  ncm: null,
  pesoG: null,
  volumenCm3: null,
  notasPrivadas: null,
  linksDeCompra: null,
}

vi.mock('../hooks/useProductos', () => ({
  useProductoPorId: () => ({ data: producto, isPending: false, error: null }),
  useSimilares: () => ({ data: { productos: [], fuentes: new Map() }, isPending: false }),
  useMovimientos: () => ({ data: undefined, isFetching: false }),
}))
vi.mock('../hooks/useHistorialDocumentos', () => ({
  useHistorialDocumentos: () => ({ data: undefined, isFetching: false }),
}))
vi.mock('../hooks/useCatalogoFacetas', () => ({
  useMarcas: () => ({ data: [{ id: 'm1', nombre: 'SPEEDRILL' }] }),
  useCategorias: () => ({ data: [{ id: 'c1', nombre: 'Puntas y tubos' }] }),
  useAtributosPorCategoria: () => ({ data: new Map() }),
}))
const guardarProducto = vi.fn(() => Promise.resolve())
vi.mock('../services/edicionProducto', () => ({ guardarProducto }))

const { ModalProducto } = await import('./ModalProducto')

const definiciones: DefinicionAtributo[] = [
  { key: 'encastre', label: 'Encastre', unidad: null, tipo: 'text', filtrable: true, posicion: 1, enumerada: false, rango: null, opciones: [], enFicha: true },
]

const montar = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ModalProducto
          productoId="p1"
          priceListId="lista-1"
          listaResuelta
          moneda="USD"
          definiciones={definiciones}
          onCerrar={vi.fn()}
          onAbrirOtro={vi.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  )

describe('ModalProducto · botón Editar (Fase 136)', () => {
  beforeEach(() => {
    estado.rol = 'admin'
    guardarProducto.mockClear()
    // jsdom no implementa `scrollTo`; el modal lo llama al abrir para subir el
    // scroll. No es parte de lo que se prueba, así que se stubea.
    Element.prototype.scrollTo = vi.fn()
  })

  it('un admin ve el botón Editar', () => {
    montar()
    expect(screen.getByRole('button', { name: 'Editar' })).toBeTruthy()
  })

  it('un externo NO ve el botón Editar', () => {
    estado.rol = 'external'
    montar()
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull()
  })

  it('al tocar Editar aparece el editor con los datos del producto', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    // El editor es el mismo de la ficha: su botón de guardar y el nombre cargado.
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeTruthy()
    expect(screen.getByDisplayValue('SPEEDRILL 2520/8B ADAPTADOR')).toBeTruthy()
    // Y el botón Editar ya no está: se está editando.
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull()
  })
})
