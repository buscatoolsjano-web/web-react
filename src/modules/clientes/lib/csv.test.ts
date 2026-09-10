import { describe, expect, it } from 'vitest'
import { aCsv, celda } from './csv'
import type { ClienteListado } from '../types'

const cliente = (p: Partial<ClienteListado> = {}): ClienteListado => ({
  id: 'x',
  referencia: 'CLI00001',
  razonSocial: 'Acme S.A.',
  nombreComercial: 'Acme',
  cuit: '30-50328441-0',
  emails: ['compras@acme.com'],
  dominios: ['acme.com'],
  rubro: null,
  telefono: null,
  esHistorico: true,
  necesitaRevision: false,
  motivosRevision: [],
  dadoDeBaja: false,
  ...p,
})

describe('celda', () => {
  it('escapa el punto y coma, que es el separador', () => {
    expect(celda('Acme; S.A.')).toBe('"Acme; S.A."')
  })

  it('duplica las comillas y envuelve el campo', () => {
    expect(celda('El "grande"')).toBe('"El ""grande"""')
  })

  it('nulo es celda vacía, no la palabra null', () => {
    expect(celda(null)).toBe('')
    expect(celda(undefined)).toBe('')
  })
})

describe('aCsv', () => {
  it('la primera línea son los encabezados', () => {
    expect(aCsv([]).split('\r\n')[0]).toContain('Referencia;Nombre juridico')
  })

  it('vuelca TODOS los emails, no sólo el primero', () => {
    const csv = aCsv([cliente({ emails: ['a@acme.com', 'b@acme.com'] })])
    expect(csv).toContain('a@acme.com b@acme.com')
  })

  it('distingue el cliente migrado del nuevo', () => {
    expect(aCsv([cliente({ esHistorico: true })])).toContain('migrado')
    expect(aCsv([cliente({ esHistorico: false })])).toContain('nuevo')
  })

  it('lleva los motivos de revisión, para poder trabajarlos en una planilla', () => {
    const csv = aCsv([
      cliente({ necesitaRevision: true, motivosRevision: ['CUIT_REPETIDO_EN_LEGACY'] }),
    ])
    expect(csv).toContain('CUIT_REPETIDO_EN_LEGACY')
  })

  it('un cliente sin datos opcionales no rompe la fila', () => {
    const csv = aCsv([
      cliente({ referencia: null, nombreComercial: null, cuit: null, emails: [], dominios: [] }),
    ])
    const fila = csv.split('\r\n')[1]!
    expect(fila.split(';')).toHaveLength(10)
  })
})
