import { describe, expect, it } from 'vitest'
import {
  MAX_LINEAS,
  OcInvalida,
  aNumero,
  normalizarCuit,
  normalizarFecha,
  validarOcExtraida,
} from './logica'

const oc = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    cliente: { nombre: 'METALÚRGICA ZZ S.A.', cuit: '30-71234567-9' },
    numero: 'OC-2026-00412',
    fecha: '2026-07-03',
    moneda: 'ARS',
    lineas: [{ codigo: 'SP.VPPH2/50', descripcion: 'PUNTA PHILLIPS', cantidad: 20, precio: 1500 }],
    ...over,
  })

describe('Los números como los escribe una OC argentina', () => {
  it('lee el formato con punto de miles y coma decimal', () => {
    expect(aNumero('1.234,56')).toBe(1234.56)
  })

  it('lee también el formato inglés, que aparece cuando el ERP del cliente es importado', () => {
    expect(aNumero('1,234.56')).toBe(1234.56)
  })

  /**
   * Con un solo separador hay que decidir, y la regla es la que acierta más
   * seguido en una OC: tres dígitos detrás son miles.
   */
  it('con un solo separador y tres dígitos detrás, son miles', () => {
    expect(aNumero('1.234')).toBe(1234)
    expect(aNumero('1,234')).toBe(1234)
  })

  it('con otra cantidad de dígitos, es decimal', () => {
    expect(aNumero('1,5')).toBe(1.5)
    expect(aNumero('12,75')).toBe(12.75)
  })

  it('un número ya numérico pasa igual', () => {
    expect(aNumero(20)).toBe(20)
  })

  it('lo que no es número da null en vez de NaN', () => {
    expect(aNumero('diez')).toBeNull()
    expect(aNumero(null)).toBeNull()
    expect(aNumero(Infinity)).toBeNull()
  })
})

describe('El CUIT y la fecha', () => {
  it('el CUIT queda en dígitos, venga como venga', () => {
    expect(normalizarCuit('30-71234567-9')).toBe('30712345679')
    expect(normalizarCuit('30.71234567.9')).toBe('30712345679')
  })

  it('un CUIT que no tiene 11 dígitos no es un CUIT', () => {
    expect(normalizarCuit('123')).toBeNull()
    expect(normalizarCuit('sin datos')).toBeNull()
  })

  /**
   * `new Date('2026-02-31')` NO falla: rueda al 3 de marzo. Sin comparar de
   * vuelta, una fecha imposible entraba como válida y la cotización salía con
   * otra fecha que la de la OC.
   */
  it('una fecha que no existe se rechaza en vez de rodar al mes siguiente', () => {
    expect(normalizarFecha('2026-02-31')).toBeNull()
    expect(normalizarFecha('2026-07-03')).toBe('2026-07-03')
  })

  it('un formato que no es ISO se descarta: la ambigüedad la resuelve el modelo, no acá', () => {
    expect(normalizarFecha('03/07/2026')).toBeNull()
  })
})

describe('Validar lo que devolvió la IA', () => {
  it('una OC bien leída pasa entera', () => {
    const r = validarOcExtraida(oc())
    expect(r.numero).toBe('OC-2026-00412')
    expect(r.cliente.cuit).toBe('30712345679')
    expect(r.fecha).toBe('2026-07-03')
    expect(r.moneda).toBe('ARS')
    expect(r.lineas).toEqual([
      { codigo: 'SP.VPPH2/50', descripcion: 'PUNTA PHILLIPS', cantidad: 20, precio: 1500 },
    ])
  })

  it('lo que no es JSON se rechaza con su motivo', () => {
    expect(() => validarOcExtraida('lo siento, no pude leer el PDF')).toThrow(OcInvalida)
    try {
      validarOcExtraida('{')
    } catch (e) {
      expect((e as OcInvalida).motivo).toBe('json_invalido')
    }
  })

  /** Sin número de OC no hay nada que registrar: es la referencia del cliente. */
  it('sin número de orden se rechaza', () => {
    try {
      validarOcExtraida(oc({ numero: '   ' }))
      expect.unreachable('tendría que haber fallado')
    } catch (e) {
      expect((e as OcInvalida).motivo).toBe('sin_numero')
    }
  })

  it('sin líneas se rechaza: no es una OC', () => {
    try {
      validarOcExtraida(oc({ lineas: [] }))
      expect.unreachable('tendría que haber fallado')
    } catch (e) {
      expect((e as OcInvalida).motivo).toBe('sin_lineas')
    }
  })

  /**
   * Los renglones en blanco de la grilla del PDF: la IA los arrastra y no son
   * un error de nadie. Se descartan sin ruido.
   */
  it('descarta los renglones sin código ni descripción, y conserva el resto', () => {
    const r = validarOcExtraida(
      oc({
        lineas: [
          { codigo: null, descripcion: null, cantidad: 1, precio: null },
          { codigo: 'SP.553', descripcion: 'TUBO IMAN', cantidad: 4, precio: 900 },
        ],
      }),
    )
    expect(r.lineas).toHaveLength(1)
    expect(r.lineas[0]?.codigo).toBe('SP.553')
  })

  it('pero si después de descartarlos no queda ninguno, eso sí se rechaza', () => {
    try {
      validarOcExtraida(oc({ lineas: [{ codigo: null, descripcion: '  ', cantidad: 1, precio: 1 }] }))
      expect.unreachable('tendría que haber fallado')
    } catch (e) {
      expect((e as OcInvalida).motivo).toBe('sin_lineas')
    }
  })

  /**
   * Una cantidad ilegible NO se arregla poniendo 1: eso sería inventar cuánto
   * pidió el cliente. Se frena la importación entera.
   */
  it.each([['cero', 0], ['negativa', -5], ['texto', 'varias']])(
    'una cantidad %s frena la importación',
    (_caso, cantidad) => {
      try {
        validarOcExtraida(oc({ lineas: [{ codigo: 'X', descripcion: 'Y', cantidad, precio: 1 }] }))
        expect.unreachable('tendría que haber fallado')
      } catch (e) {
        expect((e as OcInvalida).motivo).toBe('cantidad_invalida')
      }
    },
  )

  it('una cantidad escrita con coma se entiende', () => {
    const r = validarOcExtraida(oc({ lineas: [{ codigo: 'X', descripcion: 'Y', cantidad: '2,5', precio: '1.234,56' }] }))
    expect(r.lineas[0]).toMatchObject({ cantidad: 2.5, precio: 1234.56 })
  })

  /** Un precio negativo es un error de lectura, no un descuento. */
  it('un precio negativo se descarta y la línea queda sin precio', () => {
    const r = validarOcExtraida(oc({ lineas: [{ codigo: 'X', descripcion: 'Y', cantidad: 1, precio: -100 }] }))
    expect(r.lineas[0]?.precio).toBeNull()
  })

  it('una OC gigante se frena antes de emparejar doscientas líneas', () => {
    const muchas = Array.from({ length: MAX_LINEAS + 1 }, (_, i) => ({
      codigo: `C${i}`, descripcion: 'x', cantidad: 1, precio: 1,
    }))
    try {
      validarOcExtraida(oc({ lineas: muchas }))
      expect.unreachable('tendría que haber fallado')
    } catch (e) {
      expect((e as OcInvalida).motivo).toBe('demasiadas_lineas')
    }
  })

  /** Datos que no se pudieron leer quedan en null, no inventados. */
  it('lo que no se leyó queda en null', () => {
    const r = validarOcExtraida(
      oc({ cliente: { nombre: null, cuit: null }, fecha: 'el martes', moneda: 'PESOS' }),
    )
    expect(r.cliente).toEqual({ nombre: null, cuit: null })
    expect(r.fecha).toBeNull()
    expect(r.moneda).toBeNull()
  })
})
