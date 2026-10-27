import { createContext } from 'react'
import type { Membresia } from '@/services/empresa/memberships'

export interface EmpresaContextValue {
  membresias: Membresia[]
  activa: Membresia | null
  cargando: boolean
  error: Error | null
  cambiarEmpresa: (companyId: string) => void
  /** Vuelve a pedir las membresías (tras un error de red). */
  reintentar: () => void
  /** Como `reintentar`, pero esperable: se usa tras crear una empresa, para
      que la nueva membresía ya esté en la lista antes de saltar a ella. */
  recargar: () => Promise<void>
}

/**
 * En archivo aparte del provider a propósito: un módulo que exporta un
 * componente Y un valor rompe el Fast Refresh de Vite.
 */
export const EmpresaContext = createContext<EmpresaContextValue | null>(null)
