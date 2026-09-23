import { useCallback, useState } from 'react'
import type { ProductoListado } from '../types'

/** El legacy avisa «Máximo 4 productos» al tildar el quinto. */
export const MAXIMO_COMPARAR = 4
/** Con menos de dos no hay nada que comparar; el botón queda apagado. */
export const MINIMO_COMPARAR = 2

/**
 * Los productos elegidos a mano para comparar (Fase 22 · paridad, #42).
 *
 * **Vive en memoria, no en la URL ni en `localStorage`**, y eso es a
 * propósito: el legacy la guarda en `state.catCompare` (app.js:17390), que es
 * memoria de la pestaña. Auditado contra el legacy:
 *
 *   · cambiar de filtro → **se conserva**
 *   · cambiar de página → **se conserva**
 *   · recargar (F5)     → **se pierde**
 *   · cerrar sesión     → se pierde
 *
 * Darle persistencia sería inventar comportamiento; y además volver al
 * catálogo al día siguiente con cuatro productos tildados de ayer confunde
 * más de lo que ayuda.
 *
 * Se guardan los productos enteros y no sólo los ids porque al comparar
 * pueden estar en páginas distintas: elegir uno, pasar de página y elegir
 * otro tiene que funcionar, y el segundo ya no tiene al primero en la lista.
 */
export function useSeleccionComparar() {
  const [elegidos, setElegidos] = useState<readonly ProductoListado[]>([])

  const alternar = useCallback((p: ProductoListado) => {
    setElegidos((actual) => {
      if (actual.some((x) => x.id === p.id)) return actual.filter((x) => x.id !== p.id)
      if (actual.length >= MAXIMO_COMPARAR) return actual
      return [...actual, p]
    })
  }, [])

  const quitar = useCallback((p: ProductoListado) => {
    setElegidos((actual) => actual.filter((x) => x.id !== p.id))
  }, [])

  const limpiar = useCallback(() => setElegidos([]), [])

  return {
    elegidos,
    ids: new Set(elegidos.map((p) => p.id)),
    lleno: elegidos.length >= MAXIMO_COMPARAR,
    puedeComparar: elegidos.length >= MINIMO_COMPARAR,
    alternar,
    quitar,
    limpiar,
  }
}
