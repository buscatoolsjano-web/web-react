import { describe, expect, it } from 'vitest'
import { catalogoACsv } from './exportar'
import type { ProductoListado } from '../types'

const prod = (id: string, sku: string, nombre: string) =>
  ({ id, sku, nombre, marca: null, categoria: null, serie: null, tipo: null, atributos: {}, precio: null, stock: null, enCatalogo: true } as unknown as ProductoListado)

describe('catalogoACsv · ID interno (Fase 125)', () => {
  it('antepone SIEMPRE la columna «ID interno» con el uuid, aunque no esté entre las elegidas', () => {
    const csv = catalogoACsv([prod('uuid-1', 'AP.1', 'Punta corta')], new Set(['sku', 'nombre']), {
      esInterno: false,
      moneda: null,
    })
    const [cabecera, fila1] = csv.split('\r\n')
    expect(cabecera).toBe('ID interno;Referencia;Descripción')
    expect(fila1).toBe('uuid-1;AP.1;Punta corta')
  })

  it('el ID interno va primero incluso con una sola columna elegida', () => {
    const csv = catalogoACsv([prod('uuid-9', 'X.9', 'Algo')], new Set(['sku']), { esInterno: false, moneda: null })
    expect(csv.split('\r\n')[0]).toBe('ID interno;Referencia')
    expect(csv.split('\r\n')[1]).toBe('uuid-9;X.9')
  })
})
