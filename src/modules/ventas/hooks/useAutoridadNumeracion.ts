import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import type { DocTypeVentas } from '../lib/autoridad'
import { leerAutoridadNumeracion } from '../services/autoridad'

export interface AutoridadVentas {
  /** STEL numera este tipo: la emisión desde el ERP está bloqueada. */
  stel: (docType: DocTypeVentas) => boolean
  /** Todavía no se sabe: las acciones de emisión se muestran deshabilitadas, sin motivo. */
  cargando: boolean
}

/**
 * Anticipa en pantalla el bloqueo que impone la base. Si la lectura falla, no
 * se inventa un bloqueo: la acción se intenta y la base decide.
 */
export function useAutoridadNumeracion(): AutoridadVentas {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const habilitada = companyId !== null && (activa?.esInterno ?? false)

  const q = useQuery({
    queryKey: ['ventas', companyId, 'autoridad-numeracion'],
    queryFn: () => leerAutoridadNumeracion(companyId!),
    enabled: habilitada,
    staleTime: 5 * 60_000,
  })

  return {
    stel: (docType) => q.data?.[docType] === 'STEL',
    cargando: habilitada && q.isPending,
  }
}
