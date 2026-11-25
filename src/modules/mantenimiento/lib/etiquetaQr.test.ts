import { describe, expect, it } from 'vitest'
import { matrizQr, modeloDeEtiqueta, urlDeEquipo } from './etiquetaQr'

describe('etiqueta QR', () => {
  it('arma el link a la ficha del equipo', () => {
    expect(urlDeEquipo('https://app.buscatools.com/', 'abc')).toBe('https://app.buscatools.com/mantenimiento/activos/abc')
  })

  it('la matriz es cuadrada y tiene las tres marcas de posición', () => {
    const m = matrizQr('https://app.buscatools.com/mantenimiento/activos/0d6c1e4e-1b8f-4c55-9a43-6f1d2a7e9b10')
    const n = m.length
    expect(n).toBeGreaterThanOrEqual(21)
    expect(m.every((f) => f.length === n)).toBe(true)
    // Las esquinas de los tres cuadrados de posición son oscuras.
    expect([m[0]![0], m[0]![n - 1], m[n - 1]![0]]).toEqual([true, true, true])
  })

  it('no repite la marca en el modelo', () => {
    expect(modeloDeEtiqueta('Chicago Pneumatic', 'CP7406')).toBe('Chicago Pneumatic CP7406')
    expect(modeloDeEtiqueta('Tecna', 'Tecna 9354')).toBe('Tecna 9354')
    expect(modeloDeEtiqueta(null, null)).toBeNull()
  })
})
