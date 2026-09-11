import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import {
  actualizarOrden,
  borrarCheck,
  cancelarOrden,
  checksDeOrden,
  crearOrden,
  historialDe,
  listarOrdenes,
  marcarCheck,
  moverEtapa,
  obtenerOrden,
  ponerEnEspera,
  tecnicosDe,
  type CambiosOrden,
  type DatosOrden,
} from '../services/ordenes'
import type {
  CheckDeOrden,
  EtapaOrden,
  EventoDeMantenimiento,
  FiltrosOrdenes,
  OrdenDetalle,
  PaginaDeOrdenes,
  ResultadoCheck,
  Tecnico,
} from '../types'

export function useOrdenes(filtros: FiltrosOrdenes) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<PaginaDeOrdenes>({
    queryKey: ['mantenimiento', companyId, 'ordenes', filtros],
    queryFn: () => listarOrdenes(companyId!, filtros),
    enabled: companyId !== null,
    placeholderData: (previa, consultaPrevia) => {
      const empresaPrevia = consultaPrevia?.queryKey[1]
      return empresaPrevia === companyId ? previa : undefined
    },
    staleTime: 30_000,
  })
}

export function useOrden(id: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<OrdenDetalle | null>({
    queryKey: ['mantenimiento', companyId, 'orden', id],
    queryFn: () => obtenerOrden(companyId!, id!),
    enabled: companyId !== null && !!id,
    staleTime: 30_000,
  })
}

export function useTecnicos() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<Tecnico[]>({
    queryKey: ['mantenimiento', companyId, 'tecnicos'],
    queryFn: () => tecnicosDe(companyId!),
    enabled: companyId !== null,
    staleTime: 5 * 60_000,
  })
}

export function useChecksDeOrden(id: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<CheckDeOrden[]>({
    queryKey: ['mantenimiento', companyId, 'checks-orden', id],
    queryFn: () => checksDeOrden(companyId!, id!),
    enabled: companyId !== null && !!id,
    staleTime: 30_000,
  })
}

export function useHistorialDeOrden(id: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<EventoDeMantenimiento[]>({
    queryKey: ['mantenimiento', companyId, 'historial-orden', id],
    queryFn: () => historialDe(companyId!, 'maintenance_order', id!),
    enabled: companyId !== null && !!id,
    staleTime: 30_000,
  })
}

// ── Mutaciones ─────────────────────────────────────────────────────────────

function claves(companyId: string | null, id?: string) {
  return {
    listado: ['mantenimiento', companyId, 'ordenes'] as const,
    detalle: ['mantenimiento', companyId, 'orden', id] as const,
    checks: ['mantenimiento', companyId, 'checks-orden', id] as const,
    historial: ['mantenimiento', companyId, 'historial-orden', id] as const,
  }
}

export function useCrearOrden() {
  const { activa } = useEmpresa()
  const qc = useQueryClient()
  const companyId = activa?.companyId ?? null

  return useMutation({
    mutationFn: (datos: DatosOrden) => crearOrden(companyId!, datos),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: claves(companyId).listado })
      // El listado de equipos muestra cuántas órdenes tiene cada uno.
      void qc.invalidateQueries({ queryKey: ['mantenimiento', companyId, 'activos'] })
    },
  })
}

/**
 * Las acciones sobre una orden abierta.
 *
 * Ninguna decide nada: mover de etapa lo valida
 * `app.validar_etapa_mantenimiento()` y cancelar es una RPC con su marcador de
 * transacción. Acá sólo se pide, y si el servidor dice que no, se muestra su
 * mensaje tal cual.
 */
export function useAccionesOrden(id: string) {
  const { activa } = useEmpresa()
  const qc = useQueryClient()
  const companyId = activa?.companyId ?? null

  const invalidar = () => {
    const k = claves(companyId, id)
    void qc.invalidateQueries({ queryKey: k.detalle })
    void qc.invalidateQueries({ queryKey: k.listado })
    void qc.invalidateQueries({ queryKey: k.historial })
  }

  return {
    guardar: useMutation({
      mutationFn: (cambios: CambiosOrden) => actualizarOrden(companyId!, id, cambios),
      onSuccess: invalidar,
    }),
    mover: useMutation({
      mutationFn: (etapa: EtapaOrden) => moverEtapa(companyId!, id, etapa),
      onSuccess: invalidar,
    }),
    espera: useMutation({
      mutationFn: (enEspera: boolean) => ponerEnEspera(companyId!, id, enEspera),
      onSuccess: invalidar,
    }),
    cancelar: useMutation({
      mutationFn: (motivo: string) => cancelarOrden(id, motivo),
      onSuccess: invalidar,
    }),
  }
}

export function useChecks(ordenId: string) {
  const { activa } = useEmpresa()
  const qc = useQueryClient()
  const companyId = activa?.companyId ?? null

  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: claves(companyId, ordenId).checks })
  }

  return {
    marcar: useMutation({
      mutationFn: ({
        puntoId,
        fase,
        resultado,
      }: {
        puntoId: string
        fase: string
        resultado: ResultadoCheck
      }) => marcarCheck(companyId!, ordenId, puntoId, fase, resultado),
      onSuccess: invalidar,
    }),
    borrar: useMutation({
      mutationFn: (id: string) => borrarCheck(companyId!, id),
      onSuccess: invalidar,
    }),
  }
}
