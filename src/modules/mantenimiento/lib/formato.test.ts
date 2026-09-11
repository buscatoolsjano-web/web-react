import { describe, expect, it } from 'vitest'
import {
  etiquetaDeAccion,
  formatearFecha,
  formatearFechaHora,
  formatearImporte,
  formatearNumero,
  indicadorDeCapacidad,
  nombreDeEquipo,
  rangoVisible,
  totalDePaginas,
} from './formato'

describe('formatearImporte', () => {
  it('siempre lleva la moneda al lado', () => {
    expect(formatearImporte(1234.5, 'USD')).toBe('USD 1.234,50')
    expect(formatearImporte(1234.5, 'ARS')).toBe('ARS 1.234,50')
  })

  it('sin moneda va el número solo, sin guion delante', () => {
    expect(formatearImporte(0, null)).toBe('0,00')
  })

  it('un monto que no existe es un guion, no un cero', () => {
    expect(formatearImporte(null, 'USD')).toBe('—')
  })
})

describe('formatearFecha', () => {
  it('pasa de ISO a día/mes/año', () => {
    expect(formatearFecha('2026-09-10')).toBe('10/09/2026')
    expect(formatearFecha('2026-09-10T13:45:00Z')).toBe('10/09/2026')
  })

  it('null es un guion', () => {
    expect(formatearFecha(null)).toBe('—')
  })

  it('lo que no tiene forma de fecha se muestra tal cual', () => {
    expect(formatearFecha('ayer')).toBe('ayer')
  })
})

describe('formatearFechaHora', () => {
  it('agrega la hora cuando está', () => {
    expect(formatearFechaHora('2026-09-10T13:45:00Z')).toBe('10/09/2026 13:45')
  })

  it('sin hora queda sólo la fecha', () => {
    expect(formatearFechaHora('2026-09-10')).toBe('10/09/2026')
  })
})

describe('etiquetaDeAccion', () => {
  it('traduce las acciones que escriben los triggers', () => {
    expect(etiquetaDeAccion('create')).toBe('Alta')
    expect(etiquetaDeAccion('owner_changed')).toBe('Cambio de dueño')
    expect(etiquetaDeAccion('stage_marked_not_required')).toBe('Etapa marcada no requerida')
    expect(etiquetaDeAccion('order_put_on_hold')).toBe('Puesta en espera')
    expect(etiquetaDeAccion('order_resumed')).toBe('Reanudada')
  })

  it('una acción desconocida se muestra cruda: un evento invisible es peor', () => {
    expect(etiquetaDeAccion('algo_nuevo')).toBe('algo_nuevo')
  })
})

describe('nombreDeEquipo', () => {
  it('la referencia titula, el modelo acompaña', () => {
    expect(nombreDeEquipo('EQ00001', 'ASCD 12-150')).toBe('EQ00001 · ASCD 12-150')
  })

  it('sin modelo queda la referencia sola', () => {
    expect(nombreDeEquipo('EQ00001', null)).toBe('EQ00001')
    expect(nombreDeEquipo('EQ00001', '   ')).toBe('EQ00001')
  })
})

describe('rangoVisible y totalDePaginas', () => {
  it('dicen qué se está viendo', () => {
    expect(rangoVisible(1, 25, 60)).toBe('1–25 de 60')
    expect(rangoVisible(3, 25, 60)).toBe('51–60 de 60')
  })

  it('sin resultados lo dice con palabras', () => {
    expect(rangoVisible(1, 25, 0)).toBe('0 resultados')
  })

  it('siempre hay al menos una página', () => {
    expect(totalDePaginas(0, 25)).toBe(1)
    expect(totalDePaginas(60, 25)).toBe(3)
  })
})

describe('formatearNumero', () => {
  it('sin decimales cuando es entero', () => {
    expect(formatearNumero(30)).toBe('30')
  })

  it('con decimales cuando los tiene', () => {
    expect(formatearNumero(30.5)).toBe('30,5')
  })

  it('null es un guion', () => {
    expect(formatearNumero(null)).toBe('—')
  })
})

describe('indicadorDeCapacidad', () => {
  it('un indicador que no existe es «N/D», no «0»', () => {
    // Con una sola medición no hay desvío muestral: Cp, Cpk y CV no existen.
    // Mostrar «0» diría que el proceso es pésimo en vez de que no hay datos.
    expect(indicadorDeCapacidad(null)).toBe('N/D')
  })

  it('un cero real sí es un cero', () => {
    expect(indicadorDeCapacidad(0)).toBe('0')
  })

  it('formatea como el resto del módulo', () => {
    expect(indicadorDeCapacidad(4.2164)).toBe('4,2164')
    expect(indicadorDeCapacidad(-0.0487)).toBe('-0,0487')
  })

  it('el CV lleva su sufijo, porque es un porcentaje', () => {
    expect(indicadorDeCapacidad(0.7906, ' %')).toBe('0,7906 %')
    expect(indicadorDeCapacidad(null, ' %')).toBe('N/D')
  })
})
