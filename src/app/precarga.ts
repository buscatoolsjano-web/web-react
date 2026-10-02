import type { ComponentType } from 'react'

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

/**
 * La marca de «ya recargué una vez por un chunk que no estaba».
 *
 * Vive acá y no en `routes.tsx` porque ahora hay DOS caminos que pueden bajar
 * un chunk con éxito —la precarga y el `lazy()`— y los dos tienen que poder
 * limpiarla. Si sólo la limpiara el `lazy()`, una precarga exitosa dejaría la
 * marca puesta y el próximo deploy se quedaría sin su reintento.
 */
export const CLAVE_RECARGA = 'bt-chunk-recargado'

/** Un importador de pantalla que se acuerda del componente que ya resolvió. */
export interface ImportadorDePantalla {
  (): Promise<{ default: ComponentType }>
  /**
   * El componente, cuando el chunk ya llegó.
   *
   * Es lo que deja que `routes.tsx` lo renderice SIN suspender, y de ahí sale
   * la diferencia más grande que medimos en toda la Fase 39. Ver `recordando`.
   */
  resuelto?: ComponentType
  /** Marca para distinguir un importador YA envuelto de uno crudo. */
  recuerda?: true
}

/**
 * Envuelve un importador para que recuerde lo que resolvió.
 *
 * Esto existe por un número: **263 ms**.
 *
 * `React.lazy` suspende SIEMPRE la primera vez que se renderiza, aunque el
 * módulo ya esté en memoria, porque su promesa resuelve en un turno aparte.
 * React pinta entonces el fallback de `<Suspense>` y, para que no parpadee,
 * **retrasa a propósito** el reemplazo por el contenido real, en escalones de
 * 0/120/280/560 ms.
 *
 * Medido con marcas de rendimiento en el build de producción: la pantalla
 * renderiza a los 414 ms con su `enabled` ya en true, y el `queryFn` recién
 * corre a los 677. No hay red ni tareas largas en el medio: son 263 ms de
 * React esperando. Con la misma ruta importada de forma estática, ese tramo
 * baja a 23 ms y los datos completos pasan de ~967 ms a 763.
 *
 * La precarga ya baja el chunk de la pantalla pedida a los ~127 ms, así que
 * para cuando el guard abre el módulo está hace rato en memoria. Lo único que
 * faltaba era que `lazy` se enterara, y de eso se trata `resuelto`.
 */
function recordando(importar: () => Promise<{ default: ComponentType }>): ImportadorDePantalla {
  const f: ImportadorDePantalla = () =>
    importar().then((m) => {
      f.resuelto = m.default
      try {
        sessionStorage.removeItem(CLAVE_RECARGA)
      } catch {
        /* storage bloqueado: no cambia nada */
      }
      return m
    })
  f.recuerda = true
  return f
}

export const importarDashboard = recordando(() =>
  import('@/modules/dashboard/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
)

export const importarCatalogo = recordando(() =>
  import('@/modules/catalogo/pages/CatalogoPage').then((m) => ({ default: m.CatalogoPage })),
)

export const importarCotizaciones = recordando(() =>
  import('@/modules/ventas/pages/CotizacionesPage').then((m) => ({ default: m.CotizacionesPage })),
)

export const importarClientes = recordando(() =>
  import('@/modules/clientes/pages/ClientesPage').then((m) => ({ default: m.ClientesPage })),
)

export const importarEmails = recordando(() =>
  import('@/modules/emails/pages/EmailsPage').then((m) => ({ default: m.EmailsPage })),
)

/** Para las pantallas que no se precargan: después de la primera visita, sus
 *  remontajes tampoco suspenden. */
export const perezoso = recordando

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
