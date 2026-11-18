import { describe, expect, it } from 'vitest'
import { avisosDePrecio, variacionDeLista, type ListaDelProducto } from './avisosDePrecio'

const lista = (x: Partial<ListaDelProducto> = {}): ListaDelProducto => ({
  fuente: 'TECNA',
  fecha: '2026-11-16',
  costo: 40,
  monedaCosto: 'EUR',
  venta: 100,
  monedaVenta: 'EUR',
  ancla: 100,
  moneda: 'EUR',
  fechaAnterior: null,
  ventaAnterior: null,
  anclaAnterior: null,
  ...x,
})

describe('avisosDePrecio', () => {
  it('avisa cuando el precio está por debajo del costo', () => {
    const a = avisosDePrecio(30, 'EUR', [lista()])
    expect(a[0]?.gravedad).toBe('peligro')
    expect(a[0]?.texto).toMatch(/debajo del costo/)
  })

  it('avisa cuando está por debajo de la venta de la lista', () => {
    const a = avisosDePrecio(90, 'EUR', [lista()])
    expect(a.map((x) => x.gravedad)).toEqual(['atencion'])
  })

  it('no compara monedas distintas', () => {
    expect(avisosDePrecio(10, 'USD', [lista()])).toEqual([])
  })

  it('no avisa si el precio está bien', () => {
    expect(avisosDePrecio(120, 'EUR', [lista()])).toEqual([])
  })

  it('dice cuánto subió la lista', () => {
    const l = lista({ ventaAnterior: 80, fechaAnterior: '2026-05-12' })
    expect(variacionDeLista(l)).toBe(25)
    expect(avisosDePrecio(120, 'EUR', [l]).map((x) => x.gravedad)).toEqual(['info'])
  })
})
