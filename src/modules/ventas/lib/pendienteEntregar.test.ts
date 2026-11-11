import { describe, expect, it } from 'vitest'
import { estadoDeEntrega, tramosDeEntrega } from './pendienteEntregar'

const p = (over: Partial<Parameters<typeof estadoDeEntrega>[0]> = {}) => ({
  productoId: 'p', sku: 'X', nombre: 'X', pedido: 10, entregado: 2, pendiente: 8,
  stock: 0, enCamino: 0, faltaPedir: 8, documentos: [], ...over,
})

describe('pendiente de entregar (Fase 238)', () => {
  it('lo pendiente se cubre primero con stock, después con lo que viene en camino', () => {
    expect(tramosDeEntrega(p({ stock: 3, enCamino: 4 }))).toEqual({ entregado: 2, conStock: 3, enCamino: 4, falta: 1 })
    expect(tramosDeEntrega(p({ stock: 50, enCamino: 4 }))).toEqual({ entregado: 2, conStock: 8, enCamino: 0, falta: 0 })
  })

  it('el estado es lo más urgente: falta pedir, en camino o con stock', () => {
    expect(estadoDeEntrega(p()).texto).toBe('Falta pedir')
    expect(estadoDeEntrega(p({ enCamino: 8 })).filtro).toBe('camino')
    expect(estadoDeEntrega(p({ stock: 8 })).filtro).toBe('stock')
  })
})
