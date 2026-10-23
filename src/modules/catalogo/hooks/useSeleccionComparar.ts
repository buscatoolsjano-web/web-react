import { useCallback, useMemo, useState } from 'react'
import type { ProductoListado } from '../types'

/** Comparar es de 2 a 4: más de 4 columnas no entran ni se leen. */
export const MAXIMO_COMPARAR = 4
/** Con menos de dos no hay nada que comparar; el botón queda apagado. */
export const MINIMO_COMPARAR = 2
/**
 * Tope de la selección para EXPORTAR (Fase 125). Comparar sigue topado en 4,
 * pero marcar sirve además para exportar los elegidos, y ahí 4 es poco: con
 * «marcar todos los visibles» se juntan de a una página. El tope es una red de
 * seguridad —se guardan los productos enteros en memoria—, no un límite que se
 * espere tocar: para exportar miles está «Todo el catálogo».
 */
export const MAXIMO_SELECCION = 1000

/**
 * Los productos elegidos a mano (Fase 22 · #42; ampliado en Fase 125).
 *
 * Nacieron para COMPARAR (tope 4). Ahora también sirven para EXPORTAR sólo los
 * elegidos, así que se puede marcar más de 4: comparar sigue pidiendo entre 2 y
 * 4, pero por encima de eso la selección se mantiene para exportarla.
 *
 * **Vive en memoria, no en la URL ni en `localStorage`**, a propósito (igual que
 * el legacy, `state.catCompare`): se conserva al filtrar y al paginar, y se
 * pierde al recargar (F5) o cerrar sesión. Se guardan los productos enteros y no
 * sólo los ids porque al comparar/exportar pueden estar en páginas distintas.
 */
export function useSeleccionComparar() {
  const [elegidos, setElegidos] = useState<readonly ProductoListado[]>([])

  const alternar = useCallback((p: ProductoListado) => {
    setElegidos((actual) => {
      if (actual.some((x) => x.id === p.id)) return actual.filter((x) => x.id !== p.id)
      if (actual.length >= MAXIMO_SELECCION) return actual
      return [...actual, p]
    })
  }, [])

  /**
   * Marcar/desmarcar TODOS los de la página visible de un saque (el tilde del
   * encabezado). Si ya están todos elegidos, los saca; si no, agrega los que
   * falten —respetando el tope—.
   */
  const alternarTodos = useCallback((visibles: readonly ProductoListado[]) => {
    setElegidos((actual) => {
      const ids = new Set(actual.map((x) => x.id))
      const todosEstan = visibles.length > 0 && visibles.every((p) => ids.has(p.id))
      if (todosEstan) {
        const quitarIds = new Set(visibles.map((p) => p.id))
        return actual.filter((x) => !quitarIds.has(x.id))
      }
      const faltan = visibles.filter((p) => !ids.has(p.id))
      const cupo = Math.max(0, MAXIMO_SELECCION - actual.length)
      return [...actual, ...faltan.slice(0, cupo)]
    })
  }, [])

  const quitar = useCallback((p: ProductoListado) => {
    setElegidos((actual) => actual.filter((x) => x.id !== p.id))
  }, [])

  const limpiar = useCallback(() => setElegidos([]), [])

  const ids = useMemo(() => new Set(elegidos.map((p) => p.id)), [elegidos])

  return {
    elegidos,
    ids,
    /** Se llegó al tope de selección: los no elegidos se deshabilitan. */
    lleno: elegidos.length >= MAXIMO_SELECCION,
    /** Comparar sólo con 2 a 4. */
    puedeComparar: elegidos.length >= MINIMO_COMPARAR && elegidos.length <= MAXIMO_COMPARAR,
    /** Hay más de 4: se puede exportar, pero no comparar. */
    demasiadosParaComparar: elegidos.length > MAXIMO_COMPARAR,
    alternar,
    alternarTodos,
    quitar,
    limpiar,
  }
}
