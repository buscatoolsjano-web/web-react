// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { SecuenciaDiagnostico } from '../lib/numeracion'

const estado = vi.hoisted(() => ({ movil: false, filas: [] as unknown[] }))

vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({ activa: { companyId: 'c1', companyName: 'ZZ STEL', rol: 'admin', esInterno: true }, cargando: false }),
}))
vi.mock('@/hooks/useMediaQuery', () => ({ useIsMobile: () => estado.movil, useMediaQuery: () => estado.movil }))
vi.mock('../hooks/useEmpresaConfig', () => ({ useNumeracion: () => ({ data: estado.filas, isPending: false, isError: false }) }))

const { NumeracionPage } = await import('./NumeracionPage')

const sec = (p: Partial<SecuenciaDiagnostico>): SecuenciaDiagnostico => ({
  docType: 'quote',
  serie: 'QUO',
  prefijo: 'QUO',
  padding: 5,
  esDefault: true,
  proximo: 'QUO00005',
  proximoNumero: 5,
  documentos: 1,
  fueraPatron: 0,
  maxNumero: null,
  maxSinAtipicos: null,
  atipicosPorEncima: 0,
  estado: 'SIN_DOCUMENTOS',
  autoridad: 'STEL',
  autoridadConfigurada: true,
  ...p,
})

beforeEach(() => {
  estado.movil = false
  estado.filas = [sec({}), sec({ docType: 'delivery', serie: 'DEL', prefijo: 'DEL', proximo: 'DEL00005', documentos: 0 })]
})

describe('Numeración: STEL siempre visible al adaptar columnas', () => {
  it('tabla: la columna Autoridad no se oculta y muestra STEL y la emisión bloqueada en cada fila', () => {
    render(<NumeracionPage />)
    const cabeceras = screen.getAllByRole('columnheader')
    const autoridad = cabeceras.find((c) => c.textContent === 'Autoridad')!
    expect(autoridad.className).not.toMatch(/oculta/)
    expect(cabeceras.find((c) => c.textContent === 'Documentos')!.className).toMatch(/ocultaBajoXl/)
    for (const fila of screen.getAllByRole('row').slice(1)) {
      expect(within(fila).getByText('STEL')).toBeInTheDocument()
      expect(within(fila).getByText('Emisión desde ERP bloqueada')).toBeInTheDocument()
    }
    // El dato de las columnas ocultas se repite bajo el tipo (en tablet), con singular y plural.
    expect(screen.getByText(/1 documento$/)).toBeInTheDocument()
    expect(screen.getByText(/0 documentos$/)).toBeInTheDocument()
    expect(screen.getByText(/STEL es la autoridad/)).toBeInTheDocument()
  })

  it('mobile: cada card mantiene autoridad y emisión', () => {
    estado.movil = true
    render(<NumeracionPage />)
    const cards = screen.getAllByRole('article')
    expect(cards).toHaveLength(2)
    for (const c of cards) {
      expect(within(c).getByText('STEL')).toBeInTheDocument()
      expect(within(c).getByText('Emisión desde ERP bloqueada')).toBeInTheDocument()
    }
  })
})
