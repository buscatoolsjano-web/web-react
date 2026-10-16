// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useOpcionesDeHoja } from './useOpcionesDeHoja'
import { OPCIONES_INICIALES } from '../lib/impresion'

/**
 * La hoja del alta mide como el papel (Fase 80).
 *
 * EL PROBLEMA QUE CIERRA. Las fotos estaban forzadas en `true` mientras se
 * armaba el documento y la impresión arranca sin ellas. Como la foto reserva
 * un cuadro de 20 mm en cada renglón, la misma cotización se veía con
 * renglones de 28 mm en pantalla y salía con renglones de 12 en el papel:
 * «cuando estoy armando la cotización se nota que hay mucho más espacio que
 * cuando imprimo».
 *
 * Lo que se prueba acá es el invariante, no el valor: la hoja del alta arranca
 * con LO MISMO que la impresión. Si mañana la impresión cambia de opinión
 * sobre las fotos, esto sigue siendo cierto sin tocarlo, y si alguien vuelve a
 * forzar una opción de un solo lado, falla.
 */
describe('las opciones de la hoja del alta', () => {
  it('arrancan igual que las de imprimir', () => {
    const { result } = renderHook(() => useOpcionesDeHoja())
    expect(result.current.opciones).toEqual({
      formato: OPCIONES_INICIALES.formato,
      preciosConImpuestos: OPCIONES_INICIALES.preciosConImpuestos,
      papel: OPCIONES_INICIALES.papel,
      conFotos: OPCIONES_INICIALES.conFotos,
    })
  })

  /* Y se pueden cambiar: la foto no se fue, pasó a ser un interruptor —el
     mismo que ofrece el diálogo de imprimir—. */
  it('las fotos se prenden y se apagan', () => {
    const { result } = renderHook(() => useOpcionesDeHoja())
    expect(result.current.opciones.conFotos).toBe(false)

    act(() => result.current.controles.onFotos(true))
    expect(result.current.opciones.conFotos).toBe(true)
    expect(result.current.controles.conFotos).toBe(true)

    act(() => result.current.controles.onFotos(false))
    expect(result.current.opciones.conFotos).toBe(false)
  })

  it('el formato y los impuestos siguen andando', () => {
    const { result } = renderHook(() => useOpcionesDeHoja())
    act(() => result.current.controles.onFormato('ticket'))
    act(() => result.current.controles.onImpuestos(true))
    expect(result.current.opciones.formato).toBe('ticket')
    expect(result.current.opciones.preciosConImpuestos).toBe(true)
  })
})
