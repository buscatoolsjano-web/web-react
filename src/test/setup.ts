import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup, configure } from '@testing-library/react'

/**
 * Cuánto espera `findBy*` y `waitFor` antes de darse por vencido.
 *
 * EL PORQUÉ, que no es obvio: `testTimeout` (25 s en `vite.config.ts`) y este
 * número son DOS relojes distintos. El de vitest corta el test entero; éste es
 * de testing-library y corta cada espera, y su valor por defecto es **un
 * segundo**. Subir sólo el primero —que es lo que se había hecho— no toca el
 * segundo.
 *
 * Por eso la suite fallaba al azar: con 44 workers peleando por la CPU, un
 * `findByText('Cambios guardados')` que normalmente resuelve en 50 ms se
 * pasaba del segundo, y el error que salía era «Unable to find an element»
 * —que se lee como un bug de la pantalla— en vez de «se acabó el tiempo».
 * Siempre caían tests distintos, y todos pasaban corridos solos: la marca de
 * que el problema es la máquina y no el código.
 *
 * Diez segundos: muy por encima de la peor contención medida —el primer
 * render de una página jsdom pesada llegó a 5 s— y muy por debajo de los 25 s
 * de vitest, así que un elemento que de verdad no está sigue fallando como un
 * error claro de testing-library y no como un test colgado.
 *
 * Esto NO hace pasar un test roto: lo que no aparece nunca, sigue sin
 * aparecer. Sólo deja de castigar al que tarda porque la máquina está ocupada.
 */
configure({ asyncUtilTimeout: 10_000 })

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
