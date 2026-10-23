import { useEffect } from 'react'
import { tocarPresencia } from '../services/chat'

/**
 * El latido de presencia (Fase 145).
 *
 * Mientras alguien tiene el ERP abierto y a la vista, cada tanto le avisa al
 * servidor «sigo acá», para que el chat pueda mostrar la «última conexión» de
 * cada persona, como WhatsApp. Sólo late cuando la pestaña está visible: una
 * pestaña de fondo no es estar conectado, y latir igual mentiría el estado.
 */
const CADA = 2 * 60_000

export function usePresencia(activo: boolean): void {
  useEffect(() => {
    if (!activo) return
    const latir = () => {
      if (document.visibilityState === 'visible') void tocarPresencia()
    }
    latir()
    const id = window.setInterval(latir, CADA)
    document.addEventListener('visibilitychange', latir)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', latir)
    }
  }, [activo])
}
