import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { historialDeActivo } from '../services/historialServicio'

/**
 * El historial de servicio importado de STEL (Fase 20 · E2).
 *
 * Todo con `enabled`: el historial completo de un equipo se pide **cuando
 * alguien abre la pestaña**, no al entrar al listado. Bajar 76 documentos y
 * 263 líneas para dibujar una lista de equipos sería pagar por algo que nadie
 * está mirando.
 *
 * Es historia cerrada: no cambia salvo que se vuelva a importar, así que
 * aguanta un `staleTime` largo sin riesgo de mostrar algo viejo.
 */
const UNA_HORA = 60 * 60_000

export function useHistorialDeServicio(activoId: string | null, habilitado = true) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  return useQuery({
    queryKey: ['mantenimiento', companyId, 'historial-servicio', activoId],
    queryFn: () => historialDeActivo(companyId!, activoId!),
    enabled: companyId !== null && activoId !== null && habilitado,
    staleTime: UNA_HORA,
  })
}

