import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

/**
 * Setup común de los tests.
 *
 * `cleanup` desmonta lo que quedó montado entre un test y el siguiente. En
 * entorno `node` no hay nada que limpiar y la llamada es inofensiva, así que
 * el mismo archivo sirve para los dos entornos.
 */
afterEach(() => {
  cleanup()
})

/**
 * `ResizeObserver` no existe en jsdom.
 *
 * Lo usa la columna fija del listado de Mantenimiento para saber cuándo la
 * tabla desborda su caja. Sin este doble, montar ese listado en un test tira
 * `ResizeObserver is not defined` —no por un error del componente, sino
 * porque el entorno no tiene la API—. El doble no observa nada: los tests que
 * dependen del tamaño real de la tabla no viven acá, viven en el navegador.
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
