// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { SecuenciaDiagnostico } from '../lib/numeracion'

const estado = vi.hoisted(() => ({ movil: false, filas: [] as unknown[], sync: [] as unknown[], series: [] as unknown[], seriesError: false }))

vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({ activa: { companyId: 'c1', companyName: 'ZZ STEL', rol: 'admin', esInterno: true }, cargando: false }),
}))
vi.mock('@/hooks/useMediaQuery', () => ({ useIsMobile: () => estado.movil, useMediaQuery: () => estado.movil }))
vi.mock('../hooks/useEmpresaConfig', () => ({
  useNumeracion: () => ({ data: estado.filas, isPending: false, isError: false }),
  // Fase 14 E4: el bloque de sync es aparte; acá se prueban las columnas de numeración.
  useSyncStel: () => ({ data: estado.sync, isPending: false, isError: false }),
  useAutoridadSeries: () => ({ data: estado.seriesError ? undefined : estado.series, isPending: false, isError: estado.seriesError }),
}))

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
  estado.sync = []
  estado.series = []
  estado.seriesError = false
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
      // Con «Grande» el chip puede partirse en dos renglones en vez de ensanchar la tabla.
      expect(within(fila).getByText('Emisión desde ERP bloqueada').parentElement!.className).toMatch(/chip/)
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

describe('Numeración: estado del sync con STEL (Fase 14 E4)', () => {
  it('sin datos (o sin permiso) la sección no aparece', () => {
    render(<NumeracionPage />)
    expect(screen.queryByText('Sincronización con STEL')).not.toBeInTheDocument()
  })

  it('con datos muestra estado, última corrida y punto de control, y el error si lo hay', () => {
    estado.sync = [
      { entidad: 'products', estado: 'finished', inicio: '2026-09-15T10:00:00Z', fin: '2026-09-15T10:00:05Z', checkpoint: '2026-09-15T09:00:00Z', ultimoVisto: '555001', llamadas: 2, error: null, bloqueado: false, resumen: {} },
      { entidad: 'documents', estado: 'failed', inicio: '2026-09-15T11:00:00Z', fin: '2026-09-15T11:00:02Z', checkpoint: null, ultimoVisto: null, llamadas: 17, error: 'sin checkpoint: pasar --desde', bloqueado: false, resumen: {} },
    ]
    render(<NumeracionPage />)
    expect(screen.getByText('Sincronización con STEL')).toBeInTheDocument()
    expect(screen.getByText(/Catálogo/)).toBeInTheDocument()
    expect(screen.getByText('Al día')).toBeInTheDocument()
    expect(screen.getByText('Con error')).toBeInTheDocument()
    expect(screen.getByText(/sin checkpoint/)).toBeInTheDocument()
    expect(screen.getByText(/2 llamadas a STEL/)).toBeInTheDocument()
    expect(screen.getByText(/sin punto de control todavía/)).toBeInTheDocument()
  })

  it('no muestra nada que se parezca a una clave de API', () => {
    estado.sync = [{ entidad: 'products', estado: 'finished', inicio: null, fin: null, checkpoint: null, ultimoVisto: null, llamadas: 0, error: null, bloqueado: false, resumen: {} }]
    render(<NumeracionPage />)
    expect(document.body.textContent?.toLowerCase()).not.toContain('apikey')
    expect(document.body.textContent?.toLowerCase()).not.toContain('stel_api_key')
  })
})

describe('Numeración: autoridad de emisión por serie (Fase 14 E5)', () => {
  const ventas = [
    sec({ docType: 'quote', serie: 'COTI', prefijo: 'COTI', padding: 5, proximo: 'COTI02630', autoridad: 'ERP', autoridadConfigurada: true }),
    sec({ docType: 'delivery', serie: 'RT', prefijo: 'RT', padding: 10, proximo: 'RT0000001433', autoridad: 'ERP', autoridadConfigurada: true }),
  ]

  it('ya no dice que la numeración «queda para el cutover»', () => {
    estado.filas = ventas
    render(<NumeracionPage />)
    expect(screen.queryByText(/queda para el cutover/i)).not.toBeInTheDocument()
    expect(screen.getByText(/La autoridad define desde qué sistema se emite/)).toBeInTheDocument()
    expect(screen.getByText(/próximo número reservado para emitir desde el ERP/)).toBeInTheDocument()
  })

  it('muestra una fila por serie con su autoridad real', () => {
    estado.filas = ventas
    render(<NumeracionPage />)
    const bloque = screen.getByRole('region', { name: 'Autoridad de emisión' })
    expect(within(bloque).getByText(/Cotizaciones · COTI/)).toBeInTheDocument()
    expect(within(bloque).getByText(/COTI02630/)).toBeInTheDocument()
    expect(within(bloque).getAllByText('ERP').length).toBe(2)
  })

  it('RT-ML se ve como excepción de serie, sin secuencia del ERP y sin alarma', () => {
    estado.filas = ventas
    estado.series = [{ docType: 'delivery', serie: 'RT-ML', autoridad: 'STEL', motivo: 'MercadoLibre sigue en STEL' }]
    render(<NumeracionPage />)
    const bloque = screen.getByRole('region', { name: 'Autoridad de emisión' })
    expect(within(bloque).getByText(/Remitos MercadoLibre · RT-ML/)).toBeInTheDocument()
    expect(within(bloque).getByText('STEL · Solo importación')).toBeInTheDocument()
    expect(within(bloque).getByText(/Secuencia del ERP: no aplica/)).toBeInTheDocument()
    // La serie normal sigue siendo del ERP.
    expect(within(bloque).getByText(/Notas de entrega .remitos. · RT$/)).toBeInTheDocument()
  })

  it('si la consulta de series falla, quedan las filas por tipo y se avisa', () => {
    estado.filas = ventas
    estado.seriesError = true
    render(<NumeracionPage />)
    const bloque = screen.getByRole('region', { name: 'Autoridad de emisión' })
    expect(within(bloque).getAllByText('ERP').length).toBe(2)
    expect(within(bloque).getByText(/No se pudieron leer las excepciones por serie/)).toBeInTheDocument()
  })

  it('refleja STEL si la autoridad vuelve a ser de STEL', () => {
    estado.filas = [sec({ docType: 'quote', serie: 'COTI', prefijo: 'COTI', padding: 5, proximo: 'COTI02630', autoridad: 'STEL', autoridadConfigurada: true })]
    render(<NumeracionPage />)
    const bloque = screen.getByRole('region', { name: 'Autoridad de emisión' })
    expect(within(bloque).getByText('STEL · Solo importación')).toBeInTheDocument()
    expect(within(bloque).queryByText('ERP')).not.toBeInTheDocument()
  })

  it('mobile: el bloque sigue visible y sin desbordar', () => {
    estado.movil = true
    estado.filas = ventas
    estado.series = [{ docType: 'delivery', serie: 'RT-ML', autoridad: 'STEL', motivo: 'x' }]
    render(<NumeracionPage />)
    const bloque = screen.getByRole('region', { name: 'Autoridad de emisión' })
    expect(within(bloque).getByText(/Remitos MercadoLibre · RT-ML/)).toBeInTheDocument()
    // La fila envuelve en vez de ensanchar: el chip baja debajo del texto.
    expect(bloque.querySelector('li')!.className).toMatch(/filaSync/)
  })
})
