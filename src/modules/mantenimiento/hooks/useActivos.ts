import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import {
  actualizarActivo,
  crearActivo,
  darDeBajaActivo,
  duplicadosDeSerial,
  listarActivos,
  obtenerActivo,
  reactivarActivo,
  tiposUsados,
  type DatosActivo,
} from '../services/activos'
import { historialDe } from '../services/ordenes'
import type {
  ActivoDetalle,
  DuplicadoDeSerial,
  EventoDeMantenimiento,
  FiltrosActivos,
  PaginaDeActivos,
} from '../types'

/**
 * `companyId` es lo primero de cada clave, igual que en el resto de la app.
 * Dos empresas nunca comparten entrada, y `placeholderData` sólo conserva la
 * página anterior si es de la MISMA empresa.
 */
export function useActivos(filtros: FiltrosActivos) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<PaginaDeActivos>({
    queryKey: ['mantenimiento', companyId, 'activos', filtros],
    queryFn: () => listarActivos(companyId!, filtros),
    enabled: companyId !== null,
    placeholderData: (previa, consultaPrevia) => {
      const empresaPrevia = consultaPrevia?.queryKey[1]
      return empresaPrevia === companyId ? previa : undefined
    },
    staleTime: 30_000,
  })
}

export function useActivo(id: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<ActivoDetalle | null>({
    queryKey: ['mantenimiento', companyId, 'activo', id],
    queryFn: () => obtenerActivo(companyId!, id!),
    enabled: companyId !== null && !!id,
    staleTime: 30_000,
  })
}

export function useTiposDeActivo() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<string[]>({
    queryKey: ['mantenimiento', companyId, 'tipos-activo'],
    queryFn: () => tiposUsados(companyId!),
    enabled: companyId !== null,
    staleTime: 5 * 60_000,
  })
}

/**
 * Los otros equipos con el mismo serial.
 *
 * Se consulta mientras se escribe —debounceado en el formulario— y sólo para
 * **avisar**. No bloquea el alta: el serial nunca fue único en el legacy y
 * convertirlo en regla ahora sería inventar una que no existía.
 */
export function useDuplicadosDeSerial(serial: string, excluir: string | null = null) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const limpio = serial.trim()

  return useQuery<DuplicadoDeSerial[]>({
    queryKey: ['mantenimiento', companyId, 'duplicados-serial', limpio, excluir],
    queryFn: () => duplicadosDeSerial(companyId!, limpio, excluir),
    enabled: companyId !== null && limpio !== '',
    staleTime: 30_000,
  })
}

export function useHistorialDeActivo(id: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<EventoDeMantenimiento[]>({
    queryKey: ['mantenimiento', companyId, 'historial-activo', id],
    queryFn: () => historialDe(companyId!, 'maintenance_asset', id!),
    enabled: companyId !== null && !!id,
    staleTime: 30_000,
  })
}

// ── Mutaciones ─────────────────────────────────────────────────────────────

function claves(companyId: string | null, id?: string) {
  return {
    listado: ['mantenimiento', companyId, 'activos'] as const,
    detalle: ['mantenimiento', companyId, 'activo', id] as const,
    historial: ['mantenimiento', companyId, 'historial-activo', id] as const,
    tipos: ['mantenimiento', companyId, 'tipos-activo'] as const,
  }
}

export function useCrearActivo() {
  const { activa } = useEmpresa()
  const qc = useQueryClient()
  const companyId = activa?.companyId ?? null

  return useMutation({
    mutationFn: (datos: DatosActivo) => crearActivo(companyId!, datos),
    onSuccess: () => {
      const k = claves(companyId)
      void qc.invalidateQueries({ queryKey: k.listado })
      void qc.invalidateQueries({ queryKey: k.tipos })
    },
  })
}

/**
 * Guardar un equipo.
 *
 * Cambiar el dueño escribe `owner_changed` en la auditoría y **no toca ni una
 * orden**: `maintenance_orders.customer_id` es un snapshot congelado por
 * trigger. Por eso acá se invalida el historial del equipo pero no el de las
 * órdenes: no cambiaron.
 */
export function useGuardarActivo(id: string) {
  const { activa } = useEmpresa()
  const qc = useQueryClient()
  const companyId = activa?.companyId ?? null

  const invalidar = () => {
    const k = claves(companyId, id)
    void qc.invalidateQueries({ queryKey: k.detalle })
    void qc.invalidateQueries({ queryKey: k.listado })
    void qc.invalidateQueries({ queryKey: k.historial })
    void qc.invalidateQueries({ queryKey: k.tipos })
  }

  return {
    guardar: useMutation({
      mutationFn: (datos: DatosActivo) => actualizarActivo(companyId!, id, datos),
      onSuccess: invalidar,
    }),
    darDeBaja: useMutation({
      mutationFn: () => darDeBajaActivo(companyId!, id),
      onSuccess: invalidar,
    }),
    reactivar: useMutation({
      mutationFn: () => reactivarActivo(companyId!, id),
      onSuccess: invalidar,
    }),
  }
}
