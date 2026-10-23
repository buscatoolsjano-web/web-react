import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { del, get, set } from 'idb-keyval'

/**
 * Caché de TanStack Query que SOBREVIVE al cierre del navegador (Fase 122).
 *
 * Hasta acá la caché vivía sólo en memoria: recargar la página (F5) o volver al
 * otro día rebajaba todo de cero, con la pantalla en blanco los ~220 ms por
 * request que cuesta cada viaje a São Paulo. Ahora se guarda en IndexedDB y al
 * arrancar se re-hidrata: lo último que viste aparece al instante y recién
 * después se revalida en segundo plano.
 *
 * Tres recaudos, porque es dato del ERP quedando en el disco de la máquina:
 *
 *  1. SE BORRA EN EL LOGOUT. `limpiarCachePersistida` se llama donde ya se vacía
 *     la caché en memoria (AuthProvider), así que el próximo que entre en esta
 *     máquina no encuentra nada del anterior.
 *  2. `buster` POR BUILD. Cada deploy cambia `__BUILD_ID__`, así que una versión
 *     nueva descarta la caché vieja entera: nunca se re-hidrata con una forma de
 *     dato que el código nuevo ya no entiende.
 *  3. `maxAge` de 24 h (en persistOptions): nada se resucita más viejo que eso.
 *
 * IndexedDB y no localStorage porque la caché del catálogo sola ya se pasa del
 * tope de ~5 MB de localStorage; IndexedDB no tiene ese techo.
 */

/** La clave bajo la que vive el volcado de la caché en IndexedDB. */
export const CLAVE_CACHE = 'bt-rq-cache'

// Sin IndexedDB —jsdom en los tests, o una ventana privada con el storage
// bloqueado— el persister se vuelve un no-op silencioso: la app anda igual,
// sólo que sin caché persistida. Cada operación va envuelta por las dudas.
const hayIndexedDB = typeof indexedDB !== 'undefined'

/**
 * Carrera contra un timeout, con un valor de respaldo.
 *
 * La re-hidratación ESPERA a `getItem` antes de pintar nada: si IndexedDB se
 * cuelga —hay navegadores en modo privado donde `open()` no dispara ni éxito
 * ni error— sin esto la pantalla quedaría en blanco para siempre. Con el
 * timeout, a lo sumo se pierde la caché persistida y la app arranca igual.
 */
function conTimeout<T>(promesa: Promise<T>, ms: number, respaldo: T): Promise<T> {
  return new Promise<T>((resolver) => {
    let listo = false
    const reloj = setTimeout(() => {
      if (!listo) { listo = true; resolver(respaldo) }
    }, ms)
    promesa.then(
      (v) => { if (!listo) { listo = true; clearTimeout(reloj); resolver(v) } },
      () => { if (!listo) { listo = true; clearTimeout(reloj); resolver(respaldo) } },
    )
  })
}

const almacen = {
  getItem: async (clave: string): Promise<string | null> => {
    if (!hayIndexedDB) return null
    try {
      return await conTimeout(get<string>(clave).then((v) => v ?? null), 1_500, null)
    } catch {
      return null
    }
  },
  setItem: async (clave: string, valor: string): Promise<void> => {
    if (!hayIndexedDB) return
    try {
      await conTimeout(set(clave, valor), 3_000, undefined)
    } catch {
      /* cuota llena o storage bloqueado: la app no depende de esto */
    }
  },
  removeItem: async (clave: string): Promise<void> => {
    if (!hayIndexedDB) return
    try {
      await conTimeout(del(clave), 3_000, undefined)
    } catch {
      /* ídem */
    }
  },
}

export const persister = createAsyncStoragePersister({
  storage: almacen,
  key: CLAVE_CACHE,
  // No escribir en cada tecla: a lo sumo una vez por segundo.
  throttleTime: 1_000,
})

/** Borra el volcado persistido. Se llama al cerrar sesión. */
export async function limpiarCachePersistida(): Promise<void> {
  await almacen.removeItem(CLAVE_CACHE)
}
