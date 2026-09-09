import { describe, expect, it } from 'vitest'
import { debePropagarBusqueda } from './busquedaDiferida'

describe('debePropagarBusqueda', () => {
  it('EL BUG: la URL cambió por fuera y el debounce todavía no alcanzó', () => {
    // Alguien abre un link con ?q=balansiador. El input se sincroniza en el
    // acto, pero el valor diferido sigue vacío durante 300 ms.
    //
    // Si acá se propagara, se llamaría actualizar({ q: '' }) y la búsqueda
    // se borraría sola. Es exactamente lo que pasaba.
    expect(debePropagarBusqueda('balansiador', '', 'balansiador')).toBe(false)
  })

  it('EL BUG, al revés: se borra el filtro desde la URL', () => {
    // Botón atrás desde ?q=punta hacia el catálogo sin búsqueda.
    expect(debePropagarBusqueda('', 'punta', '')).toBe(false)
  })

  it('la persona está escribiendo: no se propaga hasta que el debounce alcance', () => {
    expect(debePropagarBusqueda('bala', 'bal', '')).toBe(false)
    expect(debePropagarBusqueda('balan', 'bala', '')).toBe(false)
  })

  it('el debounce alcanzó y difiere de la URL: se propaga', () => {
    expect(debePropagarBusqueda('balanceador', 'balanceador', '')).toBe(true)
  })

  it('el debounce alcanzó y coincide con la URL: no se propaga', () => {
    // Sin esto habría un ciclo infinito de actualizaciones.
    expect(debePropagarBusqueda('punta', 'punta', 'punta')).toBe(false)
  })

  it('los espacios no cuentan como diferencia', () => {
    // La URL guarda el texto recortado; el input puede tener espacios
    // mientras la persona escribe.
    expect(debePropagarBusqueda('punta ', 'punta ', 'punta')).toBe(false)
    expect(debePropagarBusqueda('  ', '  ', '')).toBe(false)
  })

  it('vaciar el buscador a mano sí se propaga', () => {
    expect(debePropagarBusqueda('', '', 'punta')).toBe(true)
  })
})
