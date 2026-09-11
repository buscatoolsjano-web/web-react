import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import {
  actualizarLinea,
  aprobarCotizacion,
  borrarLinea,
  crearLinea,
  elegirMoneda,
  intercambiarPosicion,
  lineasDeCotizacion,
  rechazarCotizacion,
} from '../services/cotizacion'
import type { DatosLinea, LineaCotizacion } from '../types'

export function useLineasDeCotizacion(ordenId: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<LineaCotizacion[]>({
    queryKey: ['mantenimiento', companyId, 'cotizacion', ordenId],
    queryFn: () => lineasDeCotizacion(companyId!, ordenId!),
    enabled: companyId !== null && !!ordenId,
    staleTime: 30_000,
  })
}

/**
 * Las acciones sobre la cotización.
 *
 * Cada una invalida la orden además de las líneas: el total y el estado viven
 * en `maintenance_orders`, así que tocar una línea cambia la cabecera.
 */
export function useAccionesCotizacion(ordenId: string) {
  const { activa } = useEmpresa()
  const qc = useQueryClient()
  const companyId = activa?.companyId ?? null

  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: ['mantenimiento', companyId, 'cotizacion', ordenId] })
    void qc.invalidateQueries({ queryKey: ['mantenimiento', companyId, 'orden', ordenId] })
    void qc.invalidateQueries({ queryKey: ['mantenimiento', companyId, 'ordenes'] })
  }
  const invalidarConHistorial = () => {
    invalidar()
    void qc.invalidateQueries({ queryKey: ['mantenimiento', companyId, 'historial-orden', ordenId] })
  }

  return {
    crear: useMutation({
      mutationFn: (datos: DatosLinea) => crearLinea(companyId!, ordenId, datos),
      onSuccess: invalidar,
    }),
    actualizar: useMutation({
      mutationFn: ({ id, datos }: { id: string; datos: DatosLinea }) =>
        actualizarLinea(companyId!, id, datos),
      onSuccess: invalidar,
    }),
    borrar: useMutation({
      mutationFn: (id: string) => borrarLinea(companyId!, id),
      onSuccess: invalidar,
    }),
    mover: useMutation({
      mutationFn: ({ a, b }: { a: LineaCotizacion; b: LineaCotizacion }) =>
        intercambiarPosicion(companyId!, ordenId, a, b),
      onSuccess: invalidar,
    }),
    moneda: useMutation({
      mutationFn: (moneda: string | null) => elegirMoneda(companyId!, ordenId, moneda),
      onSuccess: invalidar,
    }),
    aprobar: useMutation({
      mutationFn: (por: string) => aprobarCotizacion(ordenId, por),
      onSuccess: invalidarConHistorial,
    }),
    rechazar: useMutation({
      mutationFn: (motivo: string) => rechazarCotizacion(ordenId, motivo),
      onSuccess: invalidarConHistorial,
    }),
  }
}
