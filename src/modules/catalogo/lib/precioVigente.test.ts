import { describe, expect, it } from 'vitest'
import { precioVigenteDe, type FilaDePrecio } from './precioVigente'

const HOY = '2026-10-08'

const fila = (over: Partial<FilaDePrecio> = {}): FilaDePrecio => ({
  amount: 100,
  valid_from: '2026-01-01',
  valid_to: null,
  ...over,
})

describe('el precio que rige hoy', () => {
  it('con una sola fila abierta, es esa', () => {
    expect(precioVigenteDe([fila()], HOY)).toEqual({
      monto: 100,
      desde: '2026-01-01',
      hasta: null,
    })
  })

  it('sin filas no hay precio', () => {
    expect(precioVigenteDe([], HOY)).toBeNull()
  })

  /*
   * El caso por el que existe esta función. El catálogo tomaba la primera fila
   * que devolvía PostgREST, y con historia cargada eso es cualquiera de las
   * dos: el precio mostrado quedaba a merced del orden del planner.
   */
  it('con historia, gana la más reciente que ya empezó', () => {
    const v = precioVigenteDe(
      [
        fila({ amount: 50, valid_from: '2026-01-01', valid_to: '2026-05-31' }),
        fila({ amount: 80, valid_from: '2026-06-01', valid_to: null }),
      ],
      HOY,
    )
    expect(v).toEqual({ monto: 80, desde: '2026-06-01', hasta: null })
  })

  it('no importa en qué orden lleguen las filas', () => {
    const nuevas = fila({ amount: 80, valid_from: '2026-06-01' })
    const viejas = fila({ amount: 50, valid_from: '2026-01-01', valid_to: '2026-05-31' })
    expect(precioVigenteDe([nuevas, viejas], HOY)?.monto).toBe(80)
    expect(precioVigenteDe([viejas, nuevas], HOY)?.monto).toBe(80)
  })

  /*
   * Una vigencia futura NO se muestra: todavía no rige. Mostrarla diría que el
   * producto ya cuesta eso, y se cotizaría a un precio que no existe aún.
   */
  it('una vigencia que todavía no empezó se ignora', () => {
    const v = precioVigenteDe(
      [
        fila({ amount: 80, valid_from: '2026-06-01', valid_to: null }),
        fila({ amount: 120, valid_from: '2027-01-01', valid_to: null }),
      ],
      HOY,
    )
    expect(v?.monto).toBe(80)
  })

  it('si sólo hay una futura, no hay precio vigente', () => {
    expect(precioVigenteDe([fila({ valid_from: '2027-01-01' })], HOY)).toBeNull()
  })

  /*
   * Si todas vencieron se devuelve la última. Un precio vencido es el último
   * que hubo; decir «sin precio» sería afirmar algo falso, y en pantalla
   * aparecería «Consultar» para un producto que tiene precio cargado.
   */
  it('si todas vencieron, la última que hubo', () => {
    const v = precioVigenteDe(
      [
        fila({ amount: 50, valid_from: '2025-01-01', valid_to: '2025-06-30' }),
        fila({ amount: 70, valid_from: '2025-07-01', valid_to: '2025-12-31' }),
      ],
      HOY,
    )
    expect(v).toEqual({ monto: 70, desde: '2025-07-01', hasta: '2025-12-31' })
  })

  // STEL manda los importes con cuatro decimales y PostgREST los puede
  // entregar como texto según el tipo de la columna.
  it('un importe en texto se convierte a número', () => {
    expect(precioVigenteDe([fila({ amount: '22.2000' })], HOY)?.monto).toBe(22.2)
  })

  // `valid_from` es NOT NULL en la tabla, pero el tipo embebido lo admite
  // nulo: una fila sin fecha se trata como «desde siempre», no se descarta.
  it('una fila sin fecha de inicio cuenta como ya vigente', () => {
    expect(precioVigenteDe([fila({ valid_from: null })], HOY)?.monto).toBe(100)
  })

  it('no modifica la lista que recibe', () => {
    const filas = [fila({ amount: 50, valid_from: '2026-01-01' }), fila({ amount: 80, valid_from: '2026-06-01' })]
    precioVigenteDe(filas, HOY)
    expect(filas.map((f) => f.amount)).toEqual([50, 80])
  })
})
