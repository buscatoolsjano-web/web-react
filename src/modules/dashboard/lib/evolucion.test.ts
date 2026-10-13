import { describe, expect, it } from 'vitest'
import {
  alternarSerie,
  escalaY,
  maximoDe,
  monedaPrincipal,
  monedasDisponibles,
  rangoDelMes,
  SERIES,
} from './evolucion'
import type { SerieActividad, TipoActividad } from '@/modules/informes/types'

describe('la escala del eje', () => {
  /*
   * ARRANCA EN CERO, SIEMPRE. Un eje cortado hace que una diferencia del 3 %
   * parezca del 300 %. En un gráfico de importes eso no es estilo: es decir
   * otra cosa.
   */
  it('la primera marca es siempre 0', () => {
    for (const max of [10, 537, 535540.89, 1_200_000]) {
      expect(escalaY(max).marcas[0]).toBe(0)
    }
  })

  it('el tope nunca deja una barra afuera', () => {
    for (const max of [1, 37, 999, 535540.89, 4_321_000]) {
      expect(escalaY(max).tope).toBeGreaterThanOrEqual(max)
    }
  })

  /* Las marcas llevan los valores que no se etiquetan uno por uno, así que
     tienen que poder leerse. 133.885,22 no se lee. */
  it('las marcas son números redondos', () => {
    const { marcas } = escalaY(535540.89)
    // El paso es el mismo entre todas, y es 1/2/2,5/5 por una potencia de 10.
    const paso = marcas[1]!
    const mantisa = paso / 10 ** Math.floor(Math.log10(paso))
    expect([1, 2, 2.5, 5]).toContain(Number(mantisa.toFixed(10)))
    for (let i = 1; i < marcas.length; i++) {
      expect(marcas[i]! - marcas[i - 1]!).toBeCloseTo(paso, 6)
    }
  })

  /*
   * Sumar el paso doce veces arrastra el error de coma flotante y la última
   * marca queda en 999.999,97 — que además se dibuja fuera del eje.
   */
  it('la última marca es exactamente el tope, sin arrastre de coma flotante', () => {
    for (const max of [0.3, 7, 535540.89, 1_000_000 / 3]) {
      const { tope, marcas } = escalaY(max)
      expect(marcas[marcas.length - 1]).toBe(tope)
    }
  })

  it('sin datos no hay escala que dibujar', () => {
    expect(escalaY(0)).toEqual({ tope: 0, marcas: [] })
    expect(escalaY(-5)).toEqual({ tope: 0, marcas: [] })
    expect(escalaY(Number.NaN)).toEqual({ tope: 0, marcas: [] })
  })

  it('un importe chiquísimo igual da una escala usable', () => {
    const { tope, marcas } = escalaY(0.4)
    expect(tope).toBeGreaterThanOrEqual(0.4)
    expect(marcas.length).toBeGreaterThan(1)
  })
})

// ── Series y monedas ────────────────────────────────────────────────────────

const cifra = (importe: number, documentos: number) => ({ importe, documentos, enRevision: 0 })

const serie = (tipo: TipoActividad, porMoneda: Record<string, ReturnType<typeof cifra>>): SerieActividad => ({
  tipo,
  monedas: Object.keys(porMoneda),
  meses: [{ mes: '2026-10-01', porMoneda }],
})

describe('qué moneda se mira', () => {
  /* Nunca dos monedas en el mismo gráfico; pero sí tres series en la MISMA
     moneda, que es lo que se pidió. Por eso la lista es la unión. */
  it('junta las monedas de todas las series visibles, sin repetir', () => {
    const r = monedasDisponibles([
      serie('cotizaciones', { USD: cifra(1, 1), ARS: cifra(1, 1) }),
      serie('pedidos', { USD: cifra(1, 1) }),
    ])
    expect(r).toEqual(['ARS', 'USD'])
  })

  it('por defecto, la que más documentos movió entre las visibles', () => {
    const r = monedaPrincipal([
      serie('cotizaciones', { USD: cifra(100, 2), ARS: cifra(5, 9) }),
      serie('pedidos', { USD: cifra(100, 3) }),
    ])
    // ARS 9 contra USD 5: gana ARS aunque el importe en USD sea mayor.
    expect(r).toBe('ARS')
  })

  it('sin series no hay moneda', () => {
    expect(monedaPrincipal([])).toBeNull()
    expect(monedasDisponibles([])).toEqual([])
  })
})

describe('el máximo que fija la escala', () => {
  it('sale del mayor de TODAS las series visibles, no de la primera', () => {
    expect(maximoDe([
      [{ mes: 'm', importe: 10, documentos: 1 }],
      [{ mes: 'm', importe: 90, documentos: 1 }],
    ])).toBe(90)
  })

  it('sin datos, cero', () => {
    expect(maximoDe([])).toBe(0)
    expect(maximoDe([[]])).toBe(0)
  })
})

describe('prender y apagar series', () => {
  const TODAS: TipoActividad[] = ['cotizaciones', 'pedidos', 'entregas']

  it('apaga la que se toca', () => {
    expect(alternarSerie(TODAS, 'pedidos')).toEqual(['cotizaciones', 'entregas'])
  })

  /*
   * EL ORDEN NO DEPENDE DEL ORDEN EN QUE SE PRENDIERON. Si volviera al final,
   * las barras cambiarían de lugar dentro del grupo según el camino que
   * recorrió el lector, y «Pedidos» aparecería a veces a la izquierda y a
   * veces a la derecha.
   */
  it('al volver a prender, vuelve a SU lugar en el orden fijo', () => {
    const sinPedidos = alternarSerie(TODAS, 'pedidos')
    expect(alternarSerie(sinPedidos, 'pedidos')).toEqual(['cotizaciones', 'pedidos', 'entregas'])
  })

  /*
   * La última encendida no se apaga: un gráfico vacío no dice nada y deja al
   * lector sin una forma obvia de volver.
   */
  it('la última encendida no se puede apagar', () => {
    expect(alternarSerie(['entregas'], 'entregas')).toEqual(['entregas'])
  })

  it('el orden fijo es el del embudo: se cotiza, se pide, se entrega', () => {
    expect(SERIES.map((s) => s.tipo)).toEqual(['cotizaciones', 'pedidos', 'entregas'])
  })

  /* El color sigue a la serie, nunca a su posición en el array visible: si
     saliera del índice, apagar una repintaría a las otras. */
  it('cada serie tiene su slot de color fijo', () => {
    expect(SERIES.map((s) => s.slot)).toEqual([1, 2, 3])
  })
})

describe('el rango de un mes', () => {
  it('va del día 1 al último, sea cual sea', () => {
    expect(rangoDelMes('2026-05-01')).toEqual({ desde: '2026-05-01', hasta: '2026-05-31' })
    expect(rangoDelMes('2026-04-01')).toEqual({ desde: '2026-04-01', hasta: '2026-04-30' })
  })

  /* Febrero sin tener que saber si es bisiesto: el día 0 del mes siguiente. */
  it('febrero da 28, y 29 el año bisiesto', () => {
    expect(rangoDelMes('2026-02-01')?.hasta).toBe('2026-02-28')
    expect(rangoDelMes('2024-02-01')?.hasta).toBe('2024-02-29')
  })

  it('diciembre no se pasa al año siguiente', () => {
    expect(rangoDelMes('2026-12-01')).toEqual({ desde: '2026-12-01', hasta: '2026-12-31' })
  })

  /*
   * EL DESFASAJE QUE YA MORDIÓ ANTES. `new Date('2026-05-01')` es medianoche
   * UTC, que en Argentina son las 21:00 del 30 de abril: el rango arrancaría
   * un día antes y el desglose traería documentos de otro mes.
   */
  it('no se corre un día por el huso horario', () => {
    for (const mes of ['2026-01-01', '2026-05-01', '2026-09-01', '2026-12-01']) {
      expect(rangoDelMes(mes)?.desde).toBe(mes)
    }
  })

  it('una entrada que no es un mes no devuelve un rango inventado', () => {
    for (const malo of ['', 'mayo', '2026', '2026-13-01', '2026-00-01']) {
      expect(rangoDelMes(malo)).toBeNull()
    }
  })

  it('acepta el día que venga: lo que importa es el mes', () => {
    expect(rangoDelMes('2026-05-17')).toEqual({ desde: '2026-05-01', hasta: '2026-05-31' })
  })
})
