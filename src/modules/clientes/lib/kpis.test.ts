import { describe, expect, it } from 'vitest'
import {
  comparar,
  documentosDe,
  formatearVariacion,
  nombreDelMes,
  porMoneda,
  variacion,
} from './kpis'
import type { ValorKpi } from '../types'

const v = (clave: ValorKpi['clave'], moneda: string | null, importe: number, documentos = 1): ValorKpi => ({
  clave,
  moneda,
  importe,
  documentos,
})

describe('Los importes se separan por moneda', () => {
  it('devuelve una fila por moneda, de mayor a menor', () => {
    const r = porMoneda([v('vendido_mes', 'ARS', 1_240_000), v('vendido_mes', 'USD', 6_606)], 'vendido_mes')
    expect(r.map((x) => x.moneda)).toEqual(['ARS', 'USD'])
  })

  it('una sola moneda devuelve una sola fila', () => {
    expect(porMoneda([v('vendido_mes', 'USD', 100)], 'vendido_mes')).toHaveLength(1)
  })

  it('la moneda desconocida va última: es una ausencia de dato', () => {
    const r = porMoneda([v('vendido_mes', null, 999_999), v('vendido_mes', 'USD', 1)], 'vendido_mes')
    expect(r[r.length - 1]?.moneda).toBeNull()
  })

  it('no mezcla claves', () => {
    const valores = [v('vendido_mes', 'USD', 100), v('cotizado_mes', 'USD', 500)]
    expect(porMoneda(valores, 'vendido_mes')).toEqual([{ moneda: 'USD', documentos: 1, importe: 100 }])
  })

  it('contar documentos SÍ cruza monedas: son documentos, no plata', () => {
    const valores = [v('cotizaciones_abiertas', 'USD', 10, 3), v('cotizaciones_abiertas', 'ARS', 20, 2)]
    expect(documentosDe(valores, 'cotizaciones_abiertas')).toBe(5)
  })
})

describe('La comparación contra el mes anterior', () => {
  it('sube', () => {
    const r = variacion(118.2, 100)
    expect(r.clase).toBe('sube')
    expect(formatearVariacion(r)).toBe('+18,2 %')
  })

  it('baja', () => {
    const r = variacion(64.5, 100)
    expect(r.clase).toBe('baja')
    expect(formatearVariacion(r)).toBe('−35,5 %')
  })

  it('el mes anterior en cero NO es infinito ni +100 %', () => {
    expect(variacion(5000, 0)).toEqual({ clase: 'sin_base' })
    expect(formatearVariacion(variacion(5000, 0))).toBe('Sin base de comparación')
  })

  it('los dos meses en cero no es una caída del 100 %', () => {
    expect(variacion(0, 0)).toEqual({ clase: 'sin_datos' })
  })

  it('caer a cero sí es una caída del 100 %', () => {
    expect(formatearVariacion(variacion(0, 800))).toBe('−100 %')
  })

  it('una diferencia despreciable no se anuncia como cambio', () => {
    expect(variacion(1000.0001, 1000).clase).toBe('igual')
  })
})

describe('Comparar moneda por moneda', () => {
  const valores = [
    v('vendido_mes', 'USD', 1200, 2),
    v('vendido_mes', 'ARS', 500_000, 1),
    v('vendido_mes_anterior', 'USD', 1000, 1),
  ]

  it('empareja cada moneda con la suya', () => {
    const r = comparar(valores, 'vendido_mes', 'vendido_mes_anterior')
    const usd = r.find((x) => x.moneda === 'USD')
    expect(usd?.actual).toBe(1200)
    expect(usd?.anterior).toBe(1000)
    expect(usd?.variacion.clase).toBe('sube')
  })

  it('una moneda nueva este mes sale sin base, no con un porcentaje inventado', () => {
    const r = comparar(valores, 'vendido_mes', 'vendido_mes_anterior')
    expect(r.find((x) => x.moneda === 'ARS')?.variacion).toEqual({ clase: 'sin_base' })
  })

  it('una moneda que dejó de usarse aparece igual, en cero', () => {
    const r = comparar(
      [v('vendido_mes', 'USD', 10), v('vendido_mes_anterior', 'ARS', 900_000)],
      'vendido_mes',
      'vendido_mes_anterior',
    )
    const ars = r.find((x) => x.moneda === 'ARS')
    expect(ars?.actual).toBe(0)
    expect(ars?.variacion.clase).toBe('baja')
  })

  it('sin datos de ninguna moneda no devuelve filas', () => {
    expect(comparar([], 'vendido_mes', 'vendido_mes_anterior')).toEqual([])
  })

  it('nunca junta dos monedas en una sola fila', () => {
    const r = comparar(valores, 'vendido_mes', 'vendido_mes_anterior')
    expect(new Set(r.map((x) => x.moneda)).size).toBe(r.length)
  })
})

describe('El nombre del mes', () => {
  it('traduce la fecha del KPI', () => {
    expect(nombreDelMes('2026-09-01')).toBe('septiembre')
    expect(nombreDelMes('2026-01-01')).toBe('enero')
  })
})
