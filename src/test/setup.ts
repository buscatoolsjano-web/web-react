import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { act, cleanup, configure } from '@testing-library/react'
import { notifyManager } from '@tanstack/react-query'

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
 * Las notificaciones de react-query, por adentro de `act`.
 *
 * EL PORQUÉ: cuando una consulta termina, react-query no avisa en el momento.
 * Encola el aviso con `setTimeout(…, 0)` —`defaultScheduler` es
 * `systemSetTimeoutZero`— y el `setState` que repinta el componente ocurre
 * dentro de ese timer, o sea **afuera** de cualquier `act`. React lo detecta y
 * escribe «An update to X inside a test was not wrapped in act(...)».
 *
 * No es un bug de la pantalla ni del test: es que el aviso llega en un turno
 * del reloj que el test ya no controla. Por eso el warning aparecía y
 * desaparecía: según la carga de la máquina, el timer alcanzaba a dispararse
 * antes del `cleanup` o se lo comía el desmontaje.
 *
 * Y para encontrarlo hay un detalle del corredor que cuesta caro: con la
 * salida redirigida —CI, o cualquier cosa que no sea una terminal— vitest usa
 * el reporter mínimo, que **esconde la consola de los tests que pasan**. Los
 * avisos de act salen de un test que pasa. Para verlos hay que correr
 * `vitest run --reporter=default`.
 *
 * `setNotifyFunction` es el gancho que react-query expone para esto, con esta
 * misma intención escrita en su código: «can be used to for example wrap
 * notifications with React.act while running tests». No silencia nada ni
 * cambia cuándo llega el aviso: lo hace entrar por `act`, que es lo único que
 * React estaba reclamando.
 */
notifyManager.setNotifyFunction((aviso) => {
  // El `void`: `act` con una función sincrónica ya hizo todo cuando vuelve, y
  // lo que devuelve es un thenable que en este caso no hay que esperar.
  void act(aviso)
})

/**
 * Setup común de los tests.
 *
 * `cleanup` desmonta lo que quedó montado entre un test y el siguiente. En
 * entorno `node` no hay nada que limpiar y la llamada es inofensiva, así que
 * el mismo archivo sirve para los dos entornos.
 *
 * Acá NO se intenta además «dejar aterrizar» lo que quedó en vuelo: una
 * promesa ya resuelta corre en el microtask que sigue al cuerpo del test, o
 * sea antes de que este hook empiece. Para eso no hay gancho global que
 * sirva; el test tiene que esperar la consecuencia que él mismo disparó.
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
