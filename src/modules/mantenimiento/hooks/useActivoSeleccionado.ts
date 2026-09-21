import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Qué equipo tiene abierta la ficha rápida, en la URL.
 *
 * Vive en la query (`/mantenimiento/activos?activo=<uuid>`) por lo mismo que
 * en Clientes: **atrás** cierra el panel en vez de salir de la pantalla,
 * recargar lo deja abierto, y el link se puede pasar por chat —que en el
 * taller es cómo se pregunta «¿este equipo cuál era?».
 *
 * Abrir empuja una entrada; cambiar de equipo reemplaza, para que volver a la
 * lista sea un solo «atrás» y no ocho.
 */
export function useActivoSeleccionado() {
  const [params, setParams] = useSearchParams()
  const seleccionado = params.get('activo')

  const seleccionar = useCallback(
    (id: string) => {
      if (id === params.get('activo')) return
      const siguientes = new URLSearchParams(params)
      siguientes.set('activo', id)
      setParams(siguientes, { replace: params.has('activo') })
    },
    [params, setParams],
  )

  const cerrar = useCallback(() => {
    if (!params.has('activo')) return
    const siguientes = new URLSearchParams(params)
    siguientes.delete('activo')
    setParams(siguientes, { replace: true })
  }, [params, setParams])

  return { seleccionado, seleccionar, cerrar }
}
