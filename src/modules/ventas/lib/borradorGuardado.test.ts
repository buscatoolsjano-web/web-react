// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { borradorNuevo } from './borrador'
import { borrarBorradorGuardado, guardarBorrador, leerBorradorGuardado } from './borradorGuardado'

describe('borrador guardado en el navegador', () => {
  beforeEach(() => window.localStorage.clear())

  it('guarda y recupera por empresa y tipo', () => {
    const b = borradorNuevo('2026-11-18')
    b.cabecera.titulo = 'A medio armar'
    guardarBorrador('e1', 'cotizacion', b)
    expect(leerBorradorGuardado('e1', 'cotizacion')?.borrador.cabecera.titulo).toBe('A medio armar')
    // Otra empresa u otro tipo no lo ven.
    expect(leerBorradorGuardado('e2', 'cotizacion')).toBeNull()
    expect(leerBorradorGuardado('e1', 'pedido')).toBeNull()
  })

  it('se borra al crear o descartar', () => {
    guardarBorrador('e1', 'cotizacion', borradorNuevo('2026-11-18'))
    borrarBorradorGuardado('e1', 'cotizacion')
    expect(leerBorradorGuardado('e1', 'cotizacion')).toBeNull()
  })

  it('no ofrece uno abandonado hace más de una semana', () => {
    guardarBorrador('e1', 'cotizacion', borradorNuevo('2026-11-18'))
    const enDiezDias = Date.now() + 10 * 24 * 60 * 60_000
    expect(leerBorradorGuardado('e1', 'cotizacion', enDiezDias)).toBeNull()
  })

  it('ignora basura en el almacenamiento', () => {
    window.localStorage.setItem('erp:alta-en-curso:e1:cotizacion', '{no es json')
    expect(leerBorradorGuardado('e1', 'cotizacion')).toBeNull()
  })
})
