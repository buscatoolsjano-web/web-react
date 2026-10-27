// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { DefinicionAtributo } from '../types'

// El modal arrastra el servicio de edición → cliente de Supabase. En CI corre
// sin secretos, así que se stubea (no se usa en estos tests).
vi.mock('@/services/supabase/client', () => ({ supabase: {} }))

// Facetas de la categoría común: los tipos (subtipos) y los valores por atributo
// que ya existen. Es de donde el modal saca las opciones (Fase 188).
const FACETAS = {
  total: 0,
  totalCatalogo: 0,
  marcas: [],
  categorias: [],
  series: [],
  subtipos: [
    { valor: 'Phillips', etiqueta: 'Phillips', cantidad: 3 },
    { valor: 'Torx', etiqueta: 'Torx', cantidad: 2 },
  ],
  atributos: [
    { key: 'encastre', label: 'Encastre', unidad: null, clase: 'enum', min: null, max: null, opciones: [{ valor: '1/4 HEX', etiqueta: '1/4 HEX', cantidad: 5 }] },
  ],
}

vi.mock('../hooks/useCatalogoFacetas', () => ({
  useMarcas: () => ({ data: [] }),
  useCategorias: () => ({ data: [{ id: 'c1', nombre: 'Atornilladores', slug: 'atornilladores' }] }),
  // Sólo devuelve facetas cuando hay empresa (o sea, cuando hay categoría común).
  useFacetas: (companyId: string | null) => (companyId ? { data: FACETAS } : { data: undefined }),
}))

vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({ activa: { companyId: 'emp1' } }),
}))

const { ModalEdicionMasiva } = await import('./ModalEdicionMasiva')

const defs: DefinicionAtributo[] = [
  { key: 'encastre', label: 'Encastre', unidad: null, tipo: 'text', filtrable: true, posicion: 1, enumerada: true, rango: null, opciones: ['1/4 HEX', '3/8 HEX'], enFicha: true },
]

function montar(categoriaComun: string | null) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ModalEdicionMasiva ids={['p1', 'p2']} categoriaComun={categoriaComun} definiciones={defs} onCerrar={() => {}} onAplicado={() => {}} />
    </QueryClientProvider>,
  )
}

describe('ModalEdicionMasiva · opciones por categoría', () => {
  it('con categoría común, el Tipo se elige de la lista de esa categoría', () => {
    montar('c1')
    fireEvent.click(screen.getByRole('button', { name: 'Tipo' }))
    const select = screen.getByRole('combobox')
    expect(within(select).getByRole('option', { name: 'Torx' })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: 'Phillips' })).toBeInTheDocument()
  })

  it('sin categoría común (productos de varias), el Tipo cae a texto libre', () => {
    montar(null)
    fireEvent.click(screen.getByRole('button', { name: 'Tipo' }))
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByPlaceholderText(/Dejalo vacío para borrar el dato/)).toBeInTheDocument()
  })

  it('una característica de lista ofrece sus valores existentes', () => {
    montar('c1')
    fireEvent.click(screen.getByRole('button', { name: 'Una característica…' }))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'encastre' } })
    expect(screen.getByRole('option', { name: '1/4 HEX' })).toBeInTheDocument()
  })

  it('«Otro…» deja escribir un valor que no está en la lista', () => {
    montar('c1')
    fireEvent.click(screen.getByRole('button', { name: 'Tipo' }))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '\u0000otro' } })
    expect(screen.getByPlaceholderText('Escribí el valor nuevo')).toBeInTheDocument()
  })
})
