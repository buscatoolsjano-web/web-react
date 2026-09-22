import { describe, expect, it } from 'vitest'
import {
  avisoDeMesParcial,
  direccionDe,
  etiquetaDeTramo,
  mesLargo,
  monedaPorDefecto,
  monedasActivas,
  serieDeMoneda,
  textoDeVariacion,
} from './panel'
import type { KpiActividad, KpiMoneda, SerieActividad, Tramo } from '@/modules/informes/types'

/**
 * Las reglas del Dashboard (Fase 21 · E2).
 *
 * Lo que se prueba acá es lo que puede mentir sin que se note: un mes a medias
 * comparado contra uno entero, un +100 % inventado sobre un cero, o una moneda
 * en cero ocupando lugar.
 */
const tramo = (desde: string, hasta: string, parcial = false): Tramo => ({ desde, hasta, parcial })

const moneda = (p: Partial<KpiMoneda> = {}): KpiMoneda => ({
  moneda: 'USD',
  actual: { documentos: 27, importe: 90518.55, enRevision: 0 },
  anterior: { documentos: 17, importe: 63493.94, enRevision: 0 },
  variacion: 42.56,
  ...p,
})

describe('El período se dice completo', () => {
  it('el tramo se lee como lo diría una persona', () => {
    expect(etiquetaDeTramo(tramo('2026-09-01', '2026-09-22'))).toBe('1–22 de septiembre')
  })

  it('un tramo que cruza de mes nombra los dos', () => {
    expect(etiquetaDeTramo(tramo('2026-08-25', '2026-09-05'))).toBe('25 de agosto – 5 de septiembre')
  })

  it('un mes a medias lo dice; uno terminado no agrega ruido', () => {
    expect(avisoDeMesParcial(tramo('2026-09-01', '2026-09-22', true))).toBe('Datos al 22 de septiembre')
    expect(avisoDeMesParcial(tramo('2026-08-01', '2026-08-31', false))).toBeNull()
  })

  it('el mes largo sale con mayúscula', () => {
    expect(mesLargo('2026-09-01')).toBe('Septiembre 2026')
  })
})

describe('La comparación nunca inventa un porcentaje', () => {
  it('sube, baja e igual', () => {
    expect(direccionDe(moneda())).toBe('sube')
    expect(direccionDe(moneda({ variacion: -55.08 }))).toBe('baja')
    expect(direccionDe(moneda({ variacion: 0 }))).toBe('igual')
  })

  it('el período anterior en cero NO es +100 % ni infinito', () => {
    const sinBase = moneda({ anterior: { documentos: 0, importe: 0, enRevision: 0 }, variacion: null })
    expect(direccionDe(sinBase)).toBe('sin-base')
    expect(textoDeVariacion(sinBase, tramo('2026-08-01', '2026-08-22'))).toBe(
      'Sin base de comparación (1–22 de agosto sin movimiento)',
    )
  })

  it('aunque llegue una variación con el anterior en cero, no se muestra', () => {
    // Cinturón: si el servidor mandara un número con base cero, acá no se usa.
    const raro = moneda({ anterior: { documentos: 0, importe: 0, enRevision: 0 }, variacion: 100 })
    expect(direccionDe(raro)).toBe('sin-base')
  })

  it('el texto dice contra qué ventana se compara', () => {
    expect(textoDeVariacion(moneda(), tramo('2026-08-01', '2026-08-22'))).toBe('Subió 42,6 % vs 1–22 de agosto')
    expect(textoDeVariacion(moneda({ variacion: -55.08 }), tramo('2026-08-01', '2026-08-22'))).toBe(
      'Bajó 55,1 % vs 1–22 de agosto',
    )
  })
})

describe('Las monedas', () => {
  const kpi = (monedas: KpiMoneda[]): KpiActividad => ({
    tipo: 'cotizaciones',
    documentosActual: 30,
    documentosAnterior: 24,
    enRevisionActual: 0,
    sinMonedaEnRevisionActual: 0,
    monedas,
  })

  it('sólo se listan las que tuvieron movimiento en el período', () => {
    const activas = monedasActivas(
      kpi([
        moneda({ moneda: 'USD' }),
        moneda({ moneda: 'ARS', actual: { documentos: 3, importe: 3501735.15, enRevision: 0 } }),
        // El EUR existe en la historia y no en este mes: no ocupa una línea.
        moneda({ moneda: 'EUR', actual: { documentos: 0, importe: 0, enRevision: 0 } }),
      ]),
    )
    expect(activas.map((m) => m.moneda)).toEqual(['USD', 'ARS'])
  })

  it('sin kpi no revienta', () => {
    expect(monedasActivas(undefined)).toEqual([])
  })
})

describe('La serie de doce meses', () => {
  const serie: SerieActividad = {
    tipo: 'cotizaciones',
    monedas: ['USD', 'ARS'],
    meses: [
      { mes: '2026-08-01', porMoneda: { USD: { documentos: 17, importe: 63493.94, enRevision: 0 }, ARS: { documentos: 7, importe: 7795023.92, enRevision: 0 } } },
      { mes: '2026-09-01', porMoneda: { USD: { documentos: 27, importe: 90518.55, enRevision: 0 } } },
    ],
  }

  it('devuelve una moneda y sólo una: nunca las suma', () => {
    const usd = serieDeMoneda(serie, 'USD')
    expect(usd.map((p) => p.importe)).toEqual([63493.94, 90518.55])
    const ars = serieDeMoneda(serie, 'ARS')
    // Septiembre no tiene ARS: es cero, no el valor del dólar.
    expect(ars.map((p) => p.importe)).toEqual([7795023.92, 0])
  })

  it('un mes sin esa moneda cuenta cero documentos', () => {
    expect(serieDeMoneda(serie, 'ARS').map((p) => p.documentos)).toEqual([7, 0])
  })

  it('sin serie o sin moneda no hay puntos', () => {
    expect(serieDeMoneda(undefined, 'USD')).toEqual([])
    expect(serieDeMoneda(serie, null)).toEqual([])
  })

  it('la moneda por defecto es la de más documentos en los 12 meses', () => {
    expect(monedaPorDefecto(serie)).toBe('USD')
  })

  it('sin monedas, no hay default inventado', () => {
    expect(monedaPorDefecto({ tipo: 'pedidos', monedas: [], meses: [] })).toBeNull()
  })
})
