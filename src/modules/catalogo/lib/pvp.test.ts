import { describe, expect, it } from 'vitest'
import { explicarPvp, margenSobreCosto, resolverPrecio, type PvpDeProducto } from './pvp'

const pvp = (over: Partial<PvpDeProducto> = {}): PvpDeProducto => ({
  productId: 'p1',
  reference: 'S3154C',
  costo: 13.54,
  monedaCosto: 'EUR',
  fechaCosto: '2026-10-05',
  multiplicador: 3,
  baseEsCosto: true,
  pvp: 40.62,
  ...over,
})

describe('qué precio manda', () => {
  /*
   * La fórmula le gana a la tarifa, con los números a la vista: reproduce la
   * planilla de SPEEDRILL en 3.627 renglones, y los 84 precios que STEL tenía
   * no siguen ninguna regla (×2,33 a ×6,73 sobre el mismo costo).
   */
  it('la fórmula le gana a la tarifa de STEL', () => {
    expect(resolverPrecio(pvp(), 83.37)).toEqual({ monto: 40.62, origen: 'formula' })
  })

  it('sin costo cargado sigue mandando la tarifa', () => {
    expect(resolverPrecio(undefined, 83.37)).toEqual({ monto: 83.37, origen: 'tarifa' })
  })

  /*
   * Sin ninguno de los dos, null y no cero: el catálogo muestra «Consultar».
   * Un cero se lee como un precio real y es peor que no mostrar nada.
   */
  it('sin fórmula y sin tarifa no hay precio, y no es cero', () => {
    expect(resolverPrecio(undefined, null)).toEqual({ monto: null, origen: 'ninguno' })
  })

  // El caso que llena las 3.543 referencias de SPEEDRILL que decían «Consultar».
  it('con fórmula y sin tarifa, hay precio donde antes no había', () => {
    expect(resolverPrecio(pvp(), null)).toEqual({ monto: 40.62, origen: 'formula' })
  })
})

describe('el margen sobre el costo', () => {
  it('un ×3 son 200 puntos sobre el costo', () => {
    expect(margenSobreCosto(pvp({ multiplicador: 3 }))).toBe(200)
  })

  it('un ×1,5 son 50 puntos', () => {
    expect(margenSobreCosto(pvp({ multiplicador: 1.5 }))).toBe(50)
  })

  /*
   * TECNA no trae costo: su base es la venta del proveedor. El «margen» contra
   * el precio de venta de otro no es un margen, y afirmarlo en la pantalla
   * donde se decide cuánto cobrar sería mentir.
   */
  it('si la base no es un costo, no hay margen que informar', () => {
    expect(margenSobreCosto(pvp({ baseEsCosto: false, multiplicador: 2.5 }))).toBeNull()
  })

  it('un multiplicador inservible no devuelve un margen inventado', () => {
    expect(margenSobreCosto(pvp({ multiplicador: 0 }))).toBeNull()
    expect(margenSobreCosto(pvp({ multiplicador: Number.NaN }))).toBeNull()
  })
})

describe('cómo se explica el precio', () => {
  const fmt = (n: number, m: string | null) => `${m ?? ''} ${n.toFixed(2)}`.trim()

  it('dice el costo y por cuánto se multiplicó', () => {
    expect(explicarPvp(pvp(), fmt)).toBe('costo EUR 13.54 × 3')
  })

  // Con TECNA no se puede decir «costo», porque no lo es.
  it('cuando la base no es un costo, no lo llama costo', () => {
    expect(explicarPvp(pvp({ baseEsCosto: false, costo: 36, multiplicador: 2.5 }), fmt)).toBe(
      'precio del proveedor EUR 36.00 × 2,5',
    )
  })
})
