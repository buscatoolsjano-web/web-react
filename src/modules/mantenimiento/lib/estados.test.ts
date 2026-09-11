import { describe, expect, it } from 'vitest'
import {
  editabilidadDe,
  etapaSiguiente,
  etapasAnteriores,
  etapasRequeridas,
  etiquetaDeEstado,
  etiquetaDeEtapa,
  etiquetaDeResultado,
  etiquetaDeServicio,
  etiquetaDeSituacion,
  situacionDeEtapa,
  MOTIVOS_INGRESO,
} from './estados'

describe('etapasRequeridas', () => {
  it('con todo requerido son las cinco, en orden', () => {
    expect(etapasRequeridas(true, true)).toEqual([
      'diagnosis',
      'quotation',
      'repair',
      'torque',
      'closing',
    ])
  })

  it('sin reparación saltea reparación y nada más', () => {
    expect(etapasRequeridas(false, true)).toEqual([
      'diagnosis',
      'quotation',
      'torque',
      'closing',
    ])
  })

  it('sin torque saltea torque', () => {
    expect(etapasRequeridas(true, false)).toEqual([
      'diagnosis',
      'quotation',
      'repair',
      'closing',
    ])
  })

  it('sin ninguna de las dos quedan las tres que no se saltean', () => {
    expect(etapasRequeridas(false, false)).toEqual(['diagnosis', 'quotation', 'closing'])
  })
})

describe('etapaSiguiente', () => {
  it('avanza de a una', () => {
    expect(etapaSiguiente('diagnosis', true, true)).toBe('quotation')
    expect(etapaSiguiente('quotation', true, true)).toBe('repair')
  })

  it('saltea la etapa no requerida, sin saltear dos de una', () => {
    expect(etapaSiguiente('quotation', false, true)).toBe('torque')
    expect(etapaSiguiente('quotation', false, false)).toBe('closing')
  })

  it('en la última no hay siguiente', () => {
    expect(etapaSiguiente('closing', true, true)).toBeNull()
  })

  it('una etapa que dejó de ser requerida no tiene siguiente calculable', () => {
    // `repair` no está en la secuencia si no se requiere: la salida de ese
    // estado la resuelve el servidor, no esta función.
    expect(etapaSiguiente('repair', false, true)).toBeNull()
  })
})

describe('etapasAnteriores', () => {
  it('son todas las previas de la secuencia', () => {
    expect(etapasAnteriores('repair', true, true)).toEqual(['diagnosis', 'quotation'])
  })

  it('no incluyen las salteadas', () => {
    expect(etapasAnteriores('closing', false, false)).toEqual(['diagnosis', 'quotation'])
  })

  it('desde la primera no se vuelve a ningún lado', () => {
    expect(etapasAnteriores('diagnosis', true, true)).toEqual([])
  })
})

describe('situacionDeEtapa', () => {
  it('distingue las tres situaciones, que es el punto', () => {
    expect(situacionDeEtapa(true, null)).toBe('pendiente')
    expect(situacionDeEtapa(true, '2026-09-10T10:00:00Z')).toBe('completada')
    expect(situacionDeEtapa(false, null)).toBe('no-requerida')
  })

  it('no requerida gana aunque hubiera fecha: el CHECK impide ese estado', () => {
    expect(situacionDeEtapa(false, '2026-09-10T10:00:00Z')).toBe('no-requerida')
  })

  it('cada situación tiene su etiqueta', () => {
    expect(etiquetaDeSituacion('pendiente')).toBe('Pendiente')
    expect(etiquetaDeSituacion('completada')).toBe('Completada')
    expect(etiquetaDeSituacion('no-requerida')).toBe('No requerida')
  })
})

describe('editabilidadDe', () => {
  it('una orden abierta se puede tocar entera', () => {
    expect(editabilidadDe('open')).toEqual({
      cabecera: true,
      etapa: true,
      checks: true,
      cancelar: true,
    })
  })

  it('cerrada o cancelada, nada', () => {
    for (const estado of ['closed', 'cancelled'] as const) {
      expect(editabilidadDe(estado)).toEqual({
        cabecera: false,
        etapa: false,
        checks: false,
        cancelar: false,
      })
    }
  })
})

describe('etiquetas', () => {
  it('traducen los valores del schema', () => {
    expect(etiquetaDeEstado('open')).toBe('Abierta')
    expect(etiquetaDeEtapa('torque')).toBe('Torque')
    expect(etiquetaDeServicio('general_review')).toBe('Revisión general')
    expect(etiquetaDeResultado('nok')).toBe('NOK')
  })

  it('un valor desconocido se muestra crudo en vez de desaparecer', () => {
    expect(etiquetaDeEstado('lo_que_sea')).toBe('lo_que_sea')
    expect(etiquetaDeEtapa('lo_que_sea')).toBe('lo_que_sea')
    expect(etiquetaDeServicio('lo_que_sea')).toBe('lo_que_sea')
    expect(etiquetaDeResultado('lo_que_sea')).toBe('lo_que_sea')
  })
})

describe('MOTIVOS_INGRESO', () => {
  it('son los ocho del sistema anterior y no se inventó ninguno', () => {
    expect(MOTIVOS_INGRESO).toHaveLength(8)
    expect(MOTIVOS_INGRESO).toContain('FALLA DE CORTE')
    expect(MOTIVOS_INGRESO).toContain('CALIBRACIÓN TORQUE')
  })
})
