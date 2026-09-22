import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  abrirOverlay,
  cerrarOverlay,
  escribirFiltrosInformes,
  leerFiltrosInformes,
  leerOverlay,
  type ClaveOverlay,
  type FiltrosInformes,
} from '../lib/filtrosInformes'

/**
 * El informe que se está mirando, en la URL (Fase 21 · E3).
 *
 * Todo lo que define qué informe es —vista, mes, moneda, métrica, estado,
 * serie, origen, dimensión, medida, período y página— vive acá y no en
 * `useState`. De ahí salen cuatro cosas que el estado de React no da:
 * recargar muestra el mismo informe, «atrás» deshace el último cambio en vez
 * de salir de la pantalla, el link se puede pasar por chat para discutir un
 * número con alguien, y la ficha que se abrió encima no borra los filtros.
 *
 * Cambiar un filtro **reemplaza** la entrada del historial salvo que se pida
 * lo contrario: mover el selector de moneda cinco veces no puede obligar a
 * apretar «atrás» cinco veces para salir.
 */
export function useFiltrosInformes() {
  const [params, setParams] = useSearchParams()

  const filtros = useMemo(() => leerFiltrosInformes(params), [params])
  const overlay = useMemo(() => leerOverlay(params), [params])

  const cambiar = useCallback(
    (cambios: Partial<FiltrosInformes>, empujar = false) => {
      setParams(
        (p) => {
          const actuales = leerFiltrosInformes(p)
          const siguientes = { ...actuales, ...cambios }
          // Cualquier cambio que no sea de página vuelve a la primera: la
          // página 7 de otro universo no significa nada.
          if (!('pagina' in cambios)) siguientes.pagina = 1
          return escribirFiltrosInformes(siguientes, p)
        },
        { replace: !empujar },
      )
    },
    [setParams],
  )

  /** Abrir una ficha SÍ empuja: «atrás» tiene que cerrarla. */
  const abrir = useCallback(
    (tipo: ClaveOverlay, id: string) => {
      setParams((p) => abrirOverlay(p, tipo, id))
    },
    [setParams],
  )

  /**
   * Cerrar reemplaza, si no «atrás» la volvería a abrir. Y conserva el resto
   * de la URL entero: los filtros no son de la ficha.
   */
  const cerrar = useCallback(() => {
    setParams((p) => cerrarOverlay(p), { replace: true })
  }, [setParams])

  return { filtros, overlay, cambiar, abrir, cerrar }
}
