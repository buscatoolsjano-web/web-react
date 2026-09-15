// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DocumentoDetalle } from '../types'

const estado = vi.hoisted((): { rol: string; stel: boolean; doc: unknown } => ({ rol: 'admin', stel: false, doc: null }))
const servicios = vi.hoisted(() => ({
  borrar: vi.fn(() => Promise.resolve()),
  cancelar: vi.fn(() => Promise.resolve()),
  duplicar: vi.fn(() => Promise.resolve('nuevo')),
}))

vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({ activa: { companyId: 'c1', companyName: 'ZZ', rol: estado.rol, esInterno: true, customerId: null } }),
}))
vi.mock('../hooks/useAutoridadNumeracion', () => ({ useAutoridadNumeracion: () => ({ stel: () => estado.stel, cargando: false }) }))
vi.mock('../services/acciones', () => ({
  borrarDocumento: servicios.borrar,
  cancelarDocumento: servicios.cancelar,
  duplicarDocumento: servicios.duplicar,
}))
vi.mock('./ModalImpresion', () => ({ ModalImpresion: () => <div>vista previa</div> }))

const { useAccionesDocumento } = await import('./AccionesDocumento')

const pedido = { id: 'p1', tipo: 'pedido', numero: 'PED-00002', estado: 'confirmed', esHistorico: false } as unknown as DocumentoDetalle

function Barra() {
  const a = useAccionesDocumento((estado.doc as DocumentoDetalle | null) ?? pedido)
  return (
    <div id="root">
      {a.secundarias}
      {a.peligro}
      {a.motivo}
      {a.capas}
    </div>
  )
}

const montar = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Barra />
      </MemoryRouter>
    </QueryClientProvider>,
  )

beforeEach(() => {
  estado.rol = 'admin'
  estado.stel = false
  estado.doc = null
  vi.clearAllMocks()
})

describe('Acciones del documento (Fase 13)', () => {
  it('quien escribe ve Duplicar, Cancelar y Eliminar; todos ven Ver / Imprimir', () => {
    montar()
    for (const nombre of ['Ver / Imprimir', 'Duplicar', 'Cancelar pedido', 'Eliminar']) {
      expect(screen.getByRole('button', { name: nombre })).toBeInTheDocument()
    }
  })

  it.each(['salesperson', 'technician'])('%s sólo ve Ver / Imprimir (la base le rechaza escribir)', (rol) => {
    estado.rol = rol
    montar()
    expect(screen.getByRole('button', { name: 'Ver / Imprimir' })).toBeInTheDocument()
    for (const nombre of ['Duplicar', 'Cancelar pedido', 'Eliminar']) {
      expect(screen.queryByRole('button', { name: nombre })).toBeNull()
    }
  })

  it('Eliminar pide confirmación accesible con texto específico; nunca window.confirm', async () => {
    const nativo = vi.spyOn(window, 'confirm')
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }))
    const dialogo = screen.getByRole('alertdialog', { name: '¿Eliminar pedido PED-00002?' })
    expect(dialogo).toHaveAccessibleDescription('Se borra el documento y sus líneas. No se puede deshacer.')
    expect(screen.getByRole('button', { name: 'Volver' })).toHaveFocus()
    expect(servicios.borrar).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: 'Eliminar' }).at(-1)!)
    await waitFor(() => expect(servicios.borrar).toHaveBeenCalledWith('pedido', 'p1'))
    expect(nativo).not.toHaveBeenCalled()
  })

  it('Cancelar: «Volver» cierra sin ejecutar nada', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar pedido' }))
    expect(screen.getByRole('alertdialog', { name: '¿Cancelar pedido PED-00002?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(servicios.cancelar).not.toHaveBeenCalled()
  })

  it('STEL: Duplicar deshabilitado con su motivo visible', () => {
    estado.stel = true
    montar()
    const duplicar = screen.getByRole('button', { name: 'Duplicar' })
    expect(duplicar).toBeDisabled()
    expect(document.getElementById(duplicar.getAttribute('aria-describedby')!)).toHaveTextContent(/STEL numera los pedidos/)
  })

  it.each(['shipped', 'delivered'])('Fase 14 E3: remito %s no ofrece Cancelar y explica por qué', (est) => {
    estado.doc = { id: 'r1', tipo: 'entrega', numero: 'RT0000000001', estado: est, esHistorico: false }
    montar()
    expect(screen.queryByRole('button', { name: /Cancelar/ })).toBeNull()
    // Borrarlo tampoco: el trigger lo rechaza porque ya movió stock.
    expect(screen.queryByRole('button', { name: 'Eliminar' })).toBeNull()
    expect(screen.getByText('El remito ya generó movimiento de stock y no puede cancelarse directamente.')).toBeInTheDocument()
  })

  it('Fase 14 E3: remito en borrador sí se puede cancelar', () => {
    estado.doc = { id: 'r2', tipo: 'entrega', numero: 'RT0000000002', estado: 'draft', esHistorico: false }
    montar()
    expect(screen.getByRole('button', { name: /Cancelar/ })).toBeInTheDocument()
    expect(screen.queryByText(/ya generó movimiento de stock/)).toBeNull()
  })
})
