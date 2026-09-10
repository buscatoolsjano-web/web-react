import { describe, expect, it } from 'vitest'
import { aCsv, celda } from './csv'
import type { DocumentoListado } from '../types'

const fila = (p: Partial<DocumentoListado> = {}): DocumentoListado => ({
  id: 'd1',
  tipo: 'cotizacion',
  numero: 'COTI02251',
  fecha: '2026-01-06',
  clienteId: 'c1',
  clienteNombre: 'Grupo Mirgor',
  titulo: 'Balanceadores',
  moneda: 'USD',
  total: 1234.5,
  estado: 'sent',
  estadoSecundario: null,
  vendedor: null,
  serie: 'COTI',
  origen: null,
  necesitaRevision: false,
  motivosRevision: [],
  numeroFueraDeSerie: false,
  esHistorico: true,
  ...p,
})

describe('celda', () => {
  it('deja pasar lo que no rompe el formato', () => {
    expect(celda('COTI02251')).toBe('COTI02251')
  })

  it('entrecomilla lo que tiene punto y coma, coma o salto de línea', () => {
    expect(celda('Mirgor; S.A.')).toBe('"Mirgor; S.A."')
    expect(celda('a\nb')).toBe('"a\nb"')
  })

  it('duplica las comillas de adentro', () => {
    expect(celda('El "grande"')).toBe('"El ""grande"""')
  })

  it('null y undefined son celda vacía, no «null»', () => {
    expect(celda(null)).toBe('')
    expect(celda(undefined)).toBe('')
  })
})

describe('aCsv', () => {
  it('la moneda tiene su propia columna', () => {
    const csv = aCsv('cotizacion', [fila()])
    const [cabecera, primera] = csv.split('\r\n')
    expect(cabecera).toContain('Moneda;Total')
    expect(primera).toContain('USD;1234.50')
  })

  it('el estado va traducido', () => {
    expect(aCsv('cotizacion', [fila({ estado: 'accepted' })])).toContain('Cerrada')
  })

  it('un total nulo queda vacío, no en cero', () => {
    expect(aCsv('cotizacion', [fila({ total: null })]).split('\r\n')[1]).toContain(';;')
  })

  it('el importe va con punto decimal y sin separador de miles', () => {
    expect(aCsv('cotizacion', [fila({ total: 1234567.891 })])).toContain('1234567.89')
  })

  it('los motivos de revisión salen en una columna', () => {
    const csv = aCsv('cotizacion', [
      fila({ motivosRevision: ['NO_EXCHANGE_RATE', 'TOTALS_DO_NOT_CLOSE'] }),
    ])
    expect(csv).toContain('NO_EXCHANGE_RATE | TOTALS_DO_NOT_CLOSE')
  })

  it('sin filas devuelve sólo la cabecera', () => {
    expect(aCsv('pedido', []).split('\r\n')).toHaveLength(1)
  })
})
