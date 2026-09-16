import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * La pestaña abierta, guardada en la URL (`?tab=lineas`).
 *
 * Que esté en la URL es lo que hace compartible «mirá la trazabilidad de
 * COTI02558»: sin eso el enlace siempre abre en Líneas. Va con `replace` para
 * que el botón Atrás vuelva al listado y no recorra pestaña por pestaña.
 *
 * Un valor desconocido —enlace viejo, pestaña que ya no existe— cae en la de
 * por defecto en vez de dejar la página sin panel.
 */
export function useTabDeUrl<K extends string>(
  claves: readonly K[],
  porDefecto: K,
  parametro = 'tab',
): [K, (clave: K) => void] {
  const [params, setParams] = useSearchParams()
  const enUrl = params.get(parametro)
  const actual = claves.includes(enUrl as K) ? (enUrl as K) : porDefecto

  const cambiar = useCallback(
    (clave: K) => {
      setParams(
        (previos) => {
          const siguientes = new URLSearchParams(previos)
          if (clave === porDefecto) siguientes.delete(parametro)
          else siguientes.set(parametro, clave)
          return siguientes
        },
        { replace: true },
      )
    },
    [setParams, porDefecto, parametro],
  )

  return [actual, cambiar]
}
