import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Qué cliente tiene abierta la ficha rápida, en la URL.
 *
 * Vive en la query (`/clientes?cliente=<uuid>`) y no en un `useState` porque
 * de ahí salen cuatro cosas que un estado de React no da: **atrás** cierra el
 * panel en vez de salir de la pantalla, **recargar** lo deja abierto, el link
 * se puede pasar por chat, y la misma ficha se va a poder abrir desde una
 * cotización o desde WhatsApp con sólo armar la URL.
 *
 * El manejo del historial es deliberado y son dos reglas:
 *
 * - **abrir** empuja una entrada, para que «atrás» cierre el panel;
 * - **cambiar de cliente** reemplaza. Mirar ocho clientes seguidos y tener que
 *   apretar «atrás» ocho veces para volver a la lista es peor que no tener
 *   historial.
 */
export function useClienteSeleccionado() {
  const [params, setParams] = useSearchParams()
  const seleccionado = params.get('cliente')

  const seleccionar = useCallback(
    (id: string) => {
      if (id === params.get('cliente')) return
      const siguientes = new URLSearchParams(params)
      siguientes.set('cliente', id)
      setParams(siguientes, { replace: params.has('cliente') })
    },
    [params, setParams],
  )

  const cerrar = useCallback(() => {
    if (!params.has('cliente')) return
    const siguientes = new URLSearchParams(params)
    siguientes.delete('cliente')
    // Reemplaza: si empujara, «atrás» volvería a abrir el panel que se acaba
    // de cerrar, que es justo lo contrario de lo que espera cualquiera.
    setParams(siguientes, { replace: true })
  }, [params, setParams])

  return { seleccionado, seleccionar, cerrar }
}
