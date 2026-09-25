/**
 * Precarga de las pantallas de todos los días (Fase 29 · E3).
 *
 * Medido en el build de producción: entre que la sesión queda resuelta y la
 * pantalla dispara su primera consulta pasaban ~330 ms en los que no se ve
 * nada. No es la base: es el chunk de la ruta bajando y parseándose, y eso
 * recién empieza cuando uno hace clic.
 *
 * Así que se baja antes: al pasar el mouse por el menú —que da entre 200 y
 * 800 ms de ventaja sobre el clic— y, si no, cuando el navegador está
 * ocioso. Cuando el clic llega, el módulo ya está en memoria.
 *
 * Sólo estas cinco: son las que se abren todos los días. Precargar las veinte
 * sería bajar el ERP entero de una, que es justo lo que el code splitting
 * evita.
 *
 * Este módulo NO importa `routes.tsx`, y es a propósito: routes importa el
 * layout, el layout importa el menú, y el menú importa esto. Si además
 * esto importara routes, el ciclo quedaría cerrado. Los importadores viven
 * acá y `routes.tsx` los toma de acá, así hay UNA sola definición de cada
 * pantalla y no dos listas de rutas que se puedan desincronizar.
 */

export const importarDashboard = () =>
  import('@/modules/dashboard/pages/DashboardPage').then((m) => ({ default: m.DashboardPage }))

export const importarCatalogo = () =>
  import('@/modules/catalogo/pages/CatalogoPage').then((m) => ({ default: m.CatalogoPage }))

export const importarCotizaciones = () =>
  import('@/modules/ventas/pages/CotizacionesPage').then((m) => ({ default: m.CotizacionesPage }))

export const importarClientes = () =>
  import('@/modules/clientes/pages/ClientesPage').then((m) => ({ default: m.ClientesPage }))

export const importarEmails = () =>
  import('@/modules/emails/pages/EmailsPage').then((m) => ({ default: m.EmailsPage }))

const PRECARGABLES: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
  ['/catalogo', importarCatalogo],
  ['/ventas/cotizaciones', importarCotizaciones],
  ['/clientes', importarClientes],
  ['/emails', importarEmails],
  ['/', importarDashboard],
]

/** Las que ya se pidieron: el import se dispara UNA vez por sesión. */
const yaPedidas = new Set<string>()

function pedir(ruta: string, importar: () => Promise<unknown>): void {
  if (yaPedidas.has(ruta)) return
  yaPedidas.add(ruta)
  // Si falla no se avisa: es una precarga. Cuando el usuario navegue de
  // verdad, el `lazy()` de la ruta vuelve a intentar y ahí sí maneja el error
  // —incluido el caso del deploy nuevo, que recarga la página una vez.
  void importar().catch(() => {})
}

/**
 * Cuál de las precargables cubre a `to`, si alguna.
 *
 * Gana la MÁS LARGA que sea prefijo, para que `/ventas/cotizaciones/nueva`
 * encuentre a `/ventas/cotizaciones` y no a `/`. La raíz es un caso aparte:
 * sólo coincide exacta, porque `/` es prefijo de absolutamente todo y si no
 * el Dashboard se precargaría al pasar por cualquier enlace.
 *
 * Va separada y exportada para poder probarla sola: llamar a `precargarRuta`
 * en un test dispararía los `import()` de verdad.
 */
export function rutaQueCubre(to: string, rutas: readonly string[]): string | null {
  let mejor: string | null = null
  for (const ruta of rutas) {
    const coincide = ruta === '/' ? to === '/' : to === ruta || to.startsWith(`${ruta}/`)
    if (coincide && (mejor === null || ruta.length > mejor.length)) mejor = ruta
  }
  return mejor
}

/**
 * Precargar la pantalla de un destino del menú.
 *
 * Un destino que no está en la lista no hace nada.
 */
export function precargarRuta(to: string): void {
  const ruta = rutaQueCubre(
    to,
    PRECARGABLES.map(([r]) => r),
  )
  if (ruta === null) return
  const entrada = PRECARGABLES.find(([r]) => r === ruta)
  if (entrada) pedir(entrada[0], entrada[1])
}

/**
 * Precargar todo lo precargable cuando el navegador no tenga nada que hacer.
 *
 * `requestIdleCallback` no existe en Safari viejo; ahí va un `setTimeout`
 * largo, que llega igual de tarde y no compite con el primer pintado.
 */
export function precargarAlDescansar(): void {
  const correr = () => {
    for (const [ruta, importar] of PRECARGABLES) pedir(ruta, importar)
  }
  const w = window as Window & { requestIdleCallback?: (cb: () => void) => void }
  if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(correr)
  else window.setTimeout(correr, 2_000)
}
