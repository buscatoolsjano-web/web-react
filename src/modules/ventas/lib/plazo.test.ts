import { describe, expect, it } from 'vitest'
import { estadoDisponibilidad } from './plazo'

describe('disponibilidad de una línea', () => {
  it('con stock suficiente sugiere entrega inmediata', () => {
    expect(estadoDisponibilidad(5, { libre: 8, enCamino: 0, llegada: null })).toEqual({
      tono: 'ok',
      texto: 'En stock',
      sugerido: 'Inmediato',
    })
  })

  it('con stock parcial lo dice y no inventa un plazo', () => {
    const e = estadoDisponibilidad(5, { libre: 3, enCamino: 10, llegada: '2026-12-15' })
    expect(e.tono).toBe('parcial')
    expect(e.texto).toBe('Stock: 3 de 5')
    expect(e.sugerido).toBeNull()
  })

  it('sin stock pero pedido a proveedor muestra la llegada', () => {
    const e = estadoDisponibilidad(2, { libre: 0, enCamino: 4, llegada: '2026-12-15' })
    expect(e).toEqual({ tono: 'camino', texto: 'En camino · llega 15/12/26', sugerido: 'Aprox. 15/12/26' })
  })

  it('sin nada es «Sin stock»', () => {
    expect(estadoDisponibilidad(1, undefined).tono).toBe('sin')
  })
})
