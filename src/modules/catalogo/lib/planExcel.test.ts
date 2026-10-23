import { describe, expect, it } from 'vitest'
import { columnasDeHoja } from './planExcel'
import type { DefinicionAtributo, ProductoListado } from '../types'

const defs: DefinicionAtributo[] = [
  { key: 'min_kg', label: 'Min kg' } as DefinicionAtributo,
  { key: 'max_kg', label: 'Max kg' } as DefinicionAtributo,
  { key: 'medida', label: 'Medida' } as DefinicionAtributo,
]

const prod = (over: Partial<ProductoListado> = {}): ProductoListado =>
  ({
    id: 'uuid-1', sku: 'AP.1', nombre: 'Algo', marca: { id: 'm', nombre: 'APEX' },
    categoria: { id: 'c', nombre: 'Balanceadores', slug: 'bal' }, serie: '23', tipo: 'Punta',
    atributos: { min_kg: '1', max_kg: '5' }, precio: 10, stock: { real: 4, virtual: 3 }, enCatalogo: true,
    ...over,
  } as unknown as ProductoListado)

describe('columnasDeHoja (Fase 126)', () => {
  it('empieza por el ID interno y mete SIEMPRE las identificatorias', () => {
    const cols = columnasDeHoja(new Set(), false, [], defs)
    expect(cols[0]).toMatchObject({ clave: 'id', etiqueta: 'ID interno', rol: 'id' })
    expect(cols.map((c) => c.clave)).toEqual(['id', 'sku', 'marca', 'nombre', 'categoria', 'tipo'])
  })

  it('agrega los atributos PROPIOS de la categoría, en el orden de definiciones', () => {
    const cols = columnasDeHoja(new Set(), false, ['max_kg', 'min_kg'], defs)
    const attrs = cols.filter((c) => c.rol === 'atributo').map((c) => c.clave)
    // min_kg está antes que max_kg en `defs`, y así deben quedar.
    expect(attrs).toEqual(['min_kg', 'max_kg'])
  })

  it('el valor de cada columna es texto plano (sin escaping de CSV)', () => {
    const cols = columnasDeHoja(new Set(), false, ['min_kg'], defs)
    const ctx = { moneda: 'USD' as string | null }
    const porClave = Object.fromEntries(cols.map((c) => [c.clave, c.valor(prod(), ctx)]))
    expect(porClave['id']).toBe('uuid-1')
    expect(porClave['marca']).toBe('APEX')
    expect(porClave['categoria']).toBe('Balanceadores')
    expect(porClave['min_kg']).toBe('1')
  })

  it('stock y precio sólo si se eligen y el rol lo permite', () => {
    const externo = columnasDeHoja(new Set(['stock_real', 'precio']), false, [], defs)
    // Un externo no exporta stock aunque lo pida; el precio sí.
    expect(externo.some((c) => c.clave === 'stock_real')).toBe(false)
    expect(externo.some((c) => c.clave === 'precio')).toBe(true)

    const interno = columnasDeHoja(new Set(['stock_real']), true, [], defs)
    expect(interno.some((c) => c.clave === 'stock_real')).toBe(true)
  })
})
