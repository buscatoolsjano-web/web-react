import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Qué producto tiene el modal abierto, en la URL.
 *
 * Vive en la query (`/catalogo?producto=<uuid>`) y no en un `useState` porque
 * de ahí salen cuatro cosas que el estado de React no da: **atrás** cierra el
 * producto en vez de salir del catálogo, **recargar** lo deja abierto, el link
 * se puede pasar por chat con la búsqueda y los filtros puestos, y el resto
 * del estado del catálogo —búsqueda, facetas, página— sigue en la misma URL
 * sin tocarse.
 *
 * Abrir empuja una entrada, para que «atrás» cierre. Saltar a un relacionado
 * **también empuja**: es lo que hace que «atrás» vuelva al producto desde el
 * que se saltó, en vez de cerrar todo.
 */
export function useProductoSeleccionado() {
  const [params, setParams] = useSearchParams()
  const seleccionado = params.get('producto')

  const abrir = useCallback(
    (id: string) => {
      if (id === params.get('producto')) return
      const siguientes = new URLSearchParams(params)
      siguientes.set('producto', id)
      setParams(siguientes)
    },
    [params, setParams],
  )

  const cerrar = useCallback(() => {
    if (!params.has('producto')) return
    const siguientes = new URLSearchParams(params)
    siguientes.delete('producto')
    // Reemplaza: si empujara, «atrás» volvería a abrir el producto que se
    // acaba de cerrar.
    setParams(siguientes, { replace: true })
  }, [params, setParams])

  return { seleccionado, abrir, cerrar }
}
