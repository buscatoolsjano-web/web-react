import { useCallback, useEffect } from 'react'
import { useBlocker, type BlockerFunction } from 'react-router-dom'

/**
 * Protección real contra perder un borrador al navegar.
 *
 * Hasta la Fase 15 · E2 el editor avisaba sólo al cerrar la pestaña
 * (`beforeunload`). Dentro de la aplicación no avisaba nada: tocar otra
 * cotización en el listado, el menú lateral o la flecha «atrás» del navegador
 * desmontaba el editor y lo escrito se perdía sin preguntar.
 *
 * Acá se usan las DOS barreras que existen, cada una para lo suyo:
 *
 *   · `useBlocker` del router (data router, React Router 7) para la navegación
 *     de la aplicación: enlaces, menú, breadcrumb, `navigate(...)` y también
 *     atrás/adelante del navegador, porque el router controla el history;
 *   · `beforeunload` para lo que el router no ve: cerrar la pestaña o recargar.
 *
 * No se toca `history` a mano: el router ya expone el bloqueo, y parchear
 * `pushState` rompe justo lo que hay que proteger.
 *
 * El bloqueo se arma SÓLO si hay cambios: un aviso permanente es ruido que la
 * gente aprende a ignorar. Cambiar de pestaña interna (`?tab=`) no navega a
 * otra ruta y no dispara nada; guardar o descartar apagan `sucio` y la
 * navegación sigue sola.
 */
export interface SalidaConCambios {
  /** Hay una navegación esperando una respuesta: mostrar el diálogo. */
  preguntando: boolean
  /** Descartar los cambios y seguir a donde se iba. */
  salir: () => void
  /** Quedarse donde está. */
  quedarse: () => void
}

export function useSalidaConCambios(sucio: boolean): SalidaConCambios {
  const bloquear = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) => sucio && currentLocation.pathname !== nextLocation.pathname,
    [sucio],
  )
  const blocker = useBlocker(bloquear)

  useEffect(() => {
    if (!sucio) return
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', avisar)
    return () => window.removeEventListener('beforeunload', avisar)
  }, [sucio])

  // Si los cambios desaparecen (guardado o descarte) con una navegación
  // frenada, se deja pasar: nadie tiene que volver a apretar el enlace.
  useEffect(() => {
    if (!sucio && blocker.state === 'blocked') blocker.proceed()
  }, [sucio, blocker])

  return {
    preguntando: blocker.state === 'blocked',
    salir: () => {
      if (blocker.state === 'blocked') blocker.proceed()
    },
    quedarse: () => {
      if (blocker.state === 'blocked') blocker.reset()
    },
  }
}
