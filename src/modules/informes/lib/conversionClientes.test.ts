import { describe, expect, it } from 'vitest'
import {
  CONVERSION_INICIAL,
  detalleDeFila,
  formatearFecha,
  formatearTasa,
  leerParametros,
  MINIMO_COTIZACIONES,
  normalizar,
  tonoDeFila,
} from './conversionClientes'
import type { ConversionCliente } from '../types'

/**
 * Las reglas de pantalla de la comparativa cotizaciones ↔ pedidos (Fase 40).
 *
 * Los números los agrega el servidor. Lo que se prueba acá es lo que decide la
 * pantalla: qué se marca, qué se dice y qué combinaciones no se piden.
 */
function fila(p: Partial<ConversionCliente> = {}): ConversionCliente {
  return {
    customer_id: 'c1',
    cliente: 'ZZ Cliente',
    referencia: 'CLI00001',
    cotizaciones: 10,
    convertidas: 1,
    abiertas: 4,
    tasa: 0.1,
    importe_cotizado: null,
    importe_convertido: null,
    ultima_cotizacion: '2026-09-16',
    ultimo_pedido: null,
    total_filas: 1,
    ...p,
  }
}

describe('El tono de la fila', () => {
  it('marca en alerta al que pide mucho y compra poco', () => {
    expect(tonoDeFila(fila({ cotizaciones: 10, convertidas: 1, tasa: 0.1 }))).toBe('alerta')
  })

  it('y en verde al que compra casi todo lo que pide', () => {
    expect(tonoDeFila(fila({ cotizaciones: 8, convertidas: 7, tasa: 0.875 }))).toBe('bien')
  })

  /** Si todas las filas están pintadas, ninguna lo está. */
  it('el medio no se pinta', () => {
    expect(tonoDeFila(fila({ tasa: 0.5 }))).toBeNull()
  })

  /**
   * El caso que arruina cualquier ranking de conversión: una sola cotización
   * sin pedido da 0 % y parecería el peor cliente de todos. No es un problema,
   * es un cliente nuevo.
   */
  it('con pocas cotizaciones no se marca nada, aunque la tasa sea cero', () => {
    expect(tonoDeFila(fila({ cotizaciones: 1, convertidas: 0, tasa: 0 }))).toBeNull()
    expect(tonoDeFila(fila({ cotizaciones: MINIMO_COTIZACIONES, convertidas: 0, tasa: 0 }))).toBe('alerta')
  })

  it('sin tasa no se opina', () => {
    expect(tonoDeFila(fila({ tasa: null }))).toBeNull()
  })
})

describe('Lo que la fila dice de más', () => {
  /**
   * Las abiertas son la diferencia entre «nos dijo que no» y «todavía no
   * contestó». Sin ellas, una conversión baja parece siempre una pérdida.
   */
  it('separa las que siguen vivas de las que se perdieron', () => {
    expect(detalleDeFila(fila({ cotizaciones: 10, convertidas: 1, abiertas: 4 }))).toBe(
      '4 abiertas todavía · 5 sin pedido',
    )
  })

  it('una sola abierta se dice en singular', () => {
    expect(detalleDeFila(fila({ cotizaciones: 2, convertidas: 1, abiertas: 1 }))).toBe('1 abierta todavía')
  })

  it('si convirtió todo no hay nada que agregar', () => {
    expect(detalleDeFila(fila({ cotizaciones: 3, convertidas: 3, abiertas: 0 }))).toBe('')
  })
})

describe('Formatos', () => {
  it('la tasa se redondea a entero y el vacío se dice, no se inventa', () => {
    expect(formatearTasa(0.1)).toBe('10 %')
    expect(formatearTasa(0.875)).toBe('88 %')
    expect(formatearTasa(null)).toBe('—')
  })

  it('«nunca» y no una fecha vacía: es un dato, no un hueco', () => {
    expect(formatearFecha('2026-09-16')).toBe('16/09/2026')
    expect(formatearFecha(null)).toBe('nunca')
  })
})

describe('Los parámetros de la URL', () => {
  it('lo que no es válido cae a lo inicial, sin romper la pantalla', () => {
    const p = leerParametros(new URLSearchParams('orden=cualquiera&periodo=siglo'))
    expect(p.orden).toBe(CONVERSION_INICIAL.orden)
    expect(p.periodo).toBe(CONVERSION_INICIAL.periodo)
  })

  it('lo válido se respeta', () => {
    const p = leerParametros(new URLSearchParams('orden=mejor_conversion&periodo=mes&moneda=USD'))
    expect(p).toMatchObject({ orden: 'mejor_conversion', periodo: 'mes', moneda: 'USD' })
  })

  /**
   * Ordenar por importe sin moneda no significa nada —son pesos y dólares
   * sumados— y el servidor lo rechaza con `sin_moneda`. Se evita pedirlo.
   */
  it('ordenar por importe sin moneda no se pide', () => {
    expect(normalizar({ ...CONVERSION_INICIAL, orden: 'importe', moneda: null }).orden).toBe('cotizaciones')
    expect(normalizar({ ...CONVERSION_INICIAL, orden: 'importe', moneda: 'USD' }).orden).toBe('importe')
  })
})
