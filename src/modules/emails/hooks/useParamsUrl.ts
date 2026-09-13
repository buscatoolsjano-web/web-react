import { useCallback, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

export type CambiosUrl = Record<string, string | null | undefined>

/**
 * Los query params de la URL, con un `cambiar` que compone cambios seguidos.
 *
 * `setSearchParams(fn)` le pasa a `fn` los params del ÚLTIMO RENDER, no los de la
 * URL: dos cambios antes de que la página vuelva a renderizar se pisan (el
 * autoguardado escribe `borrador=` y el envío `envio=`; el segundo borraba el
 * primero). Acá cada cambio parte del resultado del anterior.
 *
 * `undefined` no toca la clave; `null` o '' la borra.
 */
export function useParamsUrl() {
  const [params, setParams] = useSearchParams()
  const ultimos = useRef(params)
  const setRef = useRef(setParams)

  useEffect(() => {
    ultimos.current = params
    setRef.current = setParams
  }, [params, setParams])

  const cambiar = useCallback((cambios: CambiosUrl) => {
    const n = new URLSearchParams(ultimos.current)
    for (const [k, v] of Object.entries(cambios)) {
      if (v === undefined) continue
      if (v) n.set(k, v)
      else n.delete(k)
    }
    ultimos.current = n
    setRef.current(n, { replace: true })
  }, [])

  return [params, cambiar] as const
}
