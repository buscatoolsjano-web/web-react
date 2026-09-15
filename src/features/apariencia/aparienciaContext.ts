import { createContext } from 'react'
import type { Apariencia } from './opciones'

export interface AparienciaContextValue {
  /** Lo que se ve ahora (incluye el cambio optimista mientras se guarda). */
  apariencia: Apariencia
  /** Cambia una o más opciones: se aplica al instante y se guarda en el servidor. */
  cambiar: (cambios: Partial<Omit<Apariencia, 'version'>>) => void
  /** Vuelve al original Buscatools. */
  restaurar: () => void
  guardando: boolean
  /** Último error al guardar; el cambio ya se revirtió. */
  error: string | null
  /** Hay sesión: se puede guardar. */
  disponible: boolean
}

/** En archivo aparte del provider para no romper el Fast Refresh de Vite. */
export const AparienciaContext = createContext<AparienciaContextValue | null>(null)
