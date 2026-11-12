import { describe, expect, it } from 'vitest'
import { FILTROS_FACTURAS_VENTA, facturasVentaACsv, filtrarFacturas } from './facturasListado'
import type { FacturaListada } from '../services/facturas'

const f = (p: Partial<FacturaListada>): FacturaListada => ({
  id: p.numero ?? 'x',
  numero: 'FAC00001',
  fecha: '2026-11-01',
  clienteId: null,
  cliente: 'Nordex',
  moneda: 'EUR',
  total: 100,
  estado: 'issued',
  numeroExterno: null,
  pedidoId: null,
  pedidoNumero: null,
  ...p,
})

const filas = [
  f({ numero: 'FAC00001', fecha: '2026-10-01', cliente: 'Nordex', total: 300, estado: 'paid' }),
  f({ numero: 'FAC00002', fecha: '2026-11-05', cliente: 'Ñandú SA', total: 50, pedidoNumero: 'PDV00010' }),
  f({ numero: 'FAC00003', fecha: '2026-11-10', cliente: 'Nordex', total: 120 }),
]

describe('filtrarFacturas', () => {
  it('por defecto, de la más nueva a la más vieja', () => {
    expect(filtrarFacturas(filas, FILTROS_FACTURAS_VENTA).map((x) => x.numero)).toEqual(['FAC00003', 'FAC00002', 'FAC00001'])
  })

  it('busca por número de pedido y por cliente sin tildes', () => {
    expect(filtrarFacturas(filas, { ...FILTROS_FACTURAS_VENTA, q: 'pdv00010' }).map((x) => x.numero)).toEqual(['FAC00002'])
    expect(filtrarFacturas(filas, { ...FILTROS_FACTURAS_VENTA, q: 'nandu' }).map((x) => x.numero)).toEqual(['FAC00002'])
  })

  it('filtra por cliente, estado y fechas', () => {
    const r = filtrarFacturas(filas, { ...FILTROS_FACTURAS_VENTA, cliente: 'Nordex', estado: 'issued', desde: '2026-11-01' })
    expect(r.map((x) => x.numero)).toEqual(['FAC00003'])
  })

  it('ordena por total', () => {
    const r = filtrarFacturas(filas, { ...FILTROS_FACTURAS_VENTA, orden: 'total', direccion: 'asc' })
    expect(r.map((x) => x.total)).toEqual([50, 120, 300])
  })
})

describe('facturasVentaACsv', () => {
  it('una fila por factura, con el estado en castellano y punto decimal', () => {
    const csv = facturasVentaACsv([filas[0]!])
    expect(csv.split('\r\n')[1]).toBe('FAC00001;Nordex;2026-10-01;;;Cobrada;EUR;300.00')
  })
})
