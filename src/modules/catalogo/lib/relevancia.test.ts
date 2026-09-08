import { describe, expect, it } from 'vitest'
import { ordenarPorRelevancia } from './relevancia'

const ranking = [
  { id: 'c', rank_position: 1 },
  { id: 'a', rank_position: 2 },
  { id: 'b', rank_position: 3 },
]

describe('ordenarPorRelevancia', () => {
  it('reconstruye el orden del ranking aunque .in() devuelva otro', () => {
    // PostgREST devuelve las filas en el orden que le conviene al
    // planificador, no en el de los ids pedidos. Sin esta función el score
    // que calculó Postgres se pierde.
    const filas = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(ordenarPorRelevancia(filas, ranking).map((f) => f.id)).toEqual(['c', 'a', 'b'])
  })

  it('no muta el array original', () => {
    const filas = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    ordenarPorRelevancia(filas, ranking)
    expect(filas.map((f) => f.id)).toEqual(['a', 'b', 'c'])
  })

  it('manda al final lo que no está en el ranking, sin perderlo', () => {
    const filas = [{ id: 'x' }, { id: 'a' }, { id: 'c' }]
    const r = ordenarPorRelevancia(filas, ranking)
    expect(r.map((f) => f.id)).toEqual(['c', 'a', 'x'])
    expect(r).toHaveLength(3)
  })

  it('es determinista con varias filas fuera del ranking', () => {
    const filas = [{ id: 'y' }, { id: 'x' }, { id: 'c' }]
    expect(ordenarPorRelevancia(filas, ranking).map((f) => f.id)).toEqual(['c', 'y', 'x'])
  })

  it('con ranking vacío conserva el orden recibido', () => {
    const filas = [{ id: 'a' }, { id: 'b' }]
    expect(ordenarPorRelevancia(filas, []).map((f) => f.id)).toEqual(['a', 'b'])
  })
})
