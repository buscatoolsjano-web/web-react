import { describe, expect, it } from 'vitest'
import {
  EN_CAMINO_MAX_MIN,
  INSTRUCCIONES,
  cortarEnSalienteEnCamino,
  resultadoParaCola,
} from '../../../../supabase/functions/whatsapp-ai-analyze/logica'

/**
 * Piezas puras del análisis automático (Fase 16 · E3). Lo que depende de la
 * base —cola, locks, reintentos, límites— lo prueba la suite contra la base.
 */

const AHORA = Date.parse('2026-09-17T15:00:00Z')
const hace = (min: number) => new Date(AHORA - min * 60_000).toISOString()
const fila = (direction: string, status: string, min: number) => ({ direction, status, ordenado_en: hace(min) })

describe('saliente en camino', () => {
  it('corta justo antes del primer saliente pending/sending: ni él ni lo posterior', () => {
    const filas = [
      fila('in', 'received', 5),
      fila('out', 'sent', 4),
      fila('out', 'sending', 3),
      fila('in', 'received', 2),
    ]
    expect(filas.filter(cortarEnSalienteEnCamino(AHORA))).toEqual(filas.slice(0, 2))
  })

  it('sin salientes en camino no corta nada', () => {
    const filas = [fila('in', 'received', 5), fila('out', 'failed', 4), fila('out', 'sent', 3)]
    expect(filas.filter(cortarEnSalienteEnCamino(AHORA))).toEqual(filas)
  })

  it(`uno trabado hace más de ${EN_CAMINO_MAX_MIN} minutos no bloquea el análisis para siempre`, () => {
    const filas = [fila('out', 'pending', EN_CAMINO_MAX_MIN + 1), fila('in', 'received', 1)]
    expect(filas.filter(cortarEnSalienteEnCamino(AHORA))).toEqual(filas)
  })
})

describe('resultado del análisis → cola', () => {
  it('cada estado del análisis tiene su resultado de cola', () => {
    expect(resultadoParaCola({ estado: 'ok' })).toEqual({ resultado: 'ok', codigo: null })
    expect(resultadoParaCola({ estado: 'reciente' })).toEqual({ resultado: 'reciente', codigo: null })
    expect(resultadoParaCola({ estado: 'limite', codigo: 'limite_costo' })).toEqual({ resultado: 'limite', codigo: 'limite_costo' })
    expect(resultadoParaCola({ estado: 'desactivada', codigo: 'ia_desactivada' })).toEqual({ resultado: 'desactivada', codigo: 'ia_desactivada' })
    expect(resultadoParaCola({ estado: 'error', codigo: 'proveedor_limite' })).toEqual({ resultado: 'error', codigo: 'proveedor_limite' })
  })

  it('un error sin código se reintenta como excepción del worker, no se pierde', () => {
    expect(resultadoParaCola({ estado: 'error' })).toEqual({ resultado: 'error', codigo: 'worker_excepcion' })
  })
})

describe('resumen incremental', () => {
  it('las instrucciones piden conservar lo vigente del resumen previo', () => {
    expect(INSTRUCCIONES).toMatch(/el summary nuevo lo REEMPLAZA/)
    expect(INSTRUCCIONES).toMatch(/conservá lo que sigue vigente del previo/)
  })
})
