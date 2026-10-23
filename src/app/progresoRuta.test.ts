import { describe, expect, it, vi } from 'vitest'
import { iniciarCargaDeRuta, suscribirProgresoRuta, terminarCargaDeRuta } from './progresoRuta'

describe('progresoRuta', () => {
  it('avisa true al iniciar y false al terminar', () => {
    const visto: boolean[] = []
    const baja = suscribirProgresoRuta((c) => visto.push(c))

    iniciarCargaDeRuta()
    terminarCargaDeRuta()
    baja()

    expect(visto).toEqual([true, false])
  })

  it('con dos cargas superpuestas, recién termina cuando cierran las dos', () => {
    const visto: boolean[] = []
    const baja = suscribirProgresoRuta((c) => visto.push(c))

    iniciarCargaDeRuta() // true
    iniciarCargaDeRuta() // sigue true
    terminarCargaDeRuta() // sigue true: queda una abierta
    terminarCargaDeRuta() // ahora sí, false
    baja()

    expect(visto).toEqual([true, true, true, false])
  })

  it('no baja de cero: un terminar de más no rompe el próximo ciclo', () => {
    const visto: boolean[] = []
    const baja = suscribirProgresoRuta((c) => visto.push(c))

    terminarCargaDeRuta() // de más: sigue en false
    iniciarCargaDeRuta() // true, no "doble negativo"
    terminarCargaDeRuta() // false
    baja()

    expect(visto).toEqual([false, true, false])
  })

  it('dado de baja, ya no recibe avisos', () => {
    const oyente = vi.fn()
    const baja = suscribirProgresoRuta(oyente)
    baja()

    iniciarCargaDeRuta()
    terminarCargaDeRuta()

    expect(oyente).not.toHaveBeenCalled()
  })
})
