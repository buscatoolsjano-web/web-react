// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Membresia } from '@/services/empresa/memberships'

// El selector arrastra el modal → crearEmpresa → cliente de Supabase. En CI los
// tests corren sin secretos, así que se stubea el cliente (no se usa acá).
vi.mock('@/services/supabase/client', () => ({ supabase: {} }))

const cambiar = vi.fn()
const recargar = vi.fn(() => Promise.resolve())
const estado: { membresias: Membresia[]; general: boolean } = { membresias: [], general: false }

vi.mock('./useAdminGeneral', () => ({ useAdminGeneral: () => estado.general }))

vi.mock('./useEmpresa', () => ({
  useEmpresa: () => ({
    membresias: estado.membresias,
    activa: estado.membresias[0] ?? null,
    cargando: false,
    error: null,
    cambiarEmpresa: cambiar,
    reintentar: vi.fn(),
    recargar,
  }),
}))

const { EmpresaSelector } = await import('./EmpresaSelector')

function m(companyId: string, companyName: string, rol: string): Membresia {
  return {
    companyId,
    companyName,
    companySlug: '',
    companyLogoPath: null,
    rol,
    esInterno: true,
    catalogoPublico: false,
    customerId: null,
    listasDePrecios: [],
  }
}

beforeEach(() => {
  estado.membresias = []
  estado.general = false
  vi.clearAllMocks()
})

describe('EmpresaSelector', () => {
  it('una empresa y rol no-admin: texto fijo, sin desplegable ni «Agregar empresa»', () => {
    estado.membresias = [m('c0', 'Buscatools', 'salesperson')]
    render(<EmpresaSelector />)
    expect(screen.getByText('Buscatools')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Empresa activa/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Agregar empresa' })).toBeNull()
  })

  it('admin general: abre el panel, elige otra empresa y entra al alta', () => {
    estado.membresias = [m('c0', 'Buscatools', 'admin'), m('c1', 'Torquetools', 'salesperson')]
    estado.general = true
    render(<EmpresaSelector />)

    fireEvent.click(screen.getByRole('button', { name: /Empresa activa/ }))
    fireEvent.click(screen.getByRole('button', { name: /Torquetools/ }))
    expect(cambiar).toHaveBeenCalledWith('c1')

    fireEvent.click(screen.getByRole('button', { name: /Empresa activa/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Agregar empresa' }))
    expect(screen.getByRole('dialog', { name: 'Nueva empresa' })).toBeInTheDocument()
  })

  it('un admin general con una sola empresa igual puede agregar', () => {
    estado.membresias = [m('c0', 'Buscatools', 'admin')]
    estado.general = true
    render(<EmpresaSelector />)
    fireEvent.click(screen.getByRole('button', { name: /Empresa activa/ }))
    expect(screen.getByRole('button', { name: 'Agregar empresa' })).toBeInTheDocument()
  })

  it('el admin de un distribuidor (no general) no puede agregar empresas', () => {
    estado.membresias = [m('d0', 'Distribuidor', 'admin')]
    render(<EmpresaSelector />)
    expect(screen.queryByRole('button', { name: /Empresa activa/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Agregar empresa' })).toBeNull()
  })

  it('no-admin con dos empresas: desplegable para cambiar, pero sin «Agregar empresa»', () => {
    estado.membresias = [m('c0', 'Buscatools', 'salesperson'), m('c1', 'Torquetools', 'employee')]
    render(<EmpresaSelector />)
    fireEvent.click(screen.getByRole('button', { name: /Empresa activa/ }))
    expect(screen.getByRole('button', { name: /Torquetools/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Agregar empresa' })).toBeNull()
  })
})
