import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/useAuth'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { listarConversaciones, obtenerConversacion } from '../services/conversaciones'
import { listarMensajes } from '../services/mensajes'
import { suscribirWhatsapp, type EstadoCanal } from '../services/realtime'
import {
  listarCorridasIA,
  listarItemsIA,
  obtenerInforme,
  obtenerInformeGuardado,
  obtenerResumenIA,
  senalesDeAtencion,
} from '../services/ia'
import { obtenerConfigIA, obtenerMetricasIA, obtenerModoIA } from '../services/configIA'
import type { FiltroBandeja } from '../types'

/**
 * Los datos de la bandeja.
 *
 * `companyId` es lo primero de cada clave de caché: dos empresas nunca
 * comparten entrada. Ninguna consulta tiene `refetchInterval` — lo que
 * refresca es Realtime.
 */

export function useConversaciones(filtro: FiltroBandeja) {
  const { activa } = useEmpresa()
  const usuarioId = useAuth().user?.id ?? null
  const companyId = activa?.companyId ?? null

  return useQuery({
    queryKey: ['whatsapp', companyId, 'conversaciones', filtro, usuarioId],
    queryFn: () => listarConversaciones(companyId!, filtro, usuarioId),
    enabled: companyId !== null,
    staleTime: 30_000,
  })
}

export function useConversacion(id: string | null) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery({
    queryKey: ['whatsapp', companyId, 'conversacion', id],
    queryFn: () => obtenerConversacion(companyId!, id!),
    enabled: companyId !== null && !!id,
    staleTime: 30_000,
  })
}

export function useMensajes(conversacionId: string | null) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery({
    queryKey: ['whatsapp', companyId, 'mensajes', conversacionId],
    queryFn: () => listarMensajes(conversacionId!),
    enabled: companyId !== null && !!conversacionId,
    staleTime: 30_000,
  })
}

/**
 * Mantiene la bandeja al día con Realtime.
 *
 * Al llegar un evento se invalida la consulta que corresponde en vez de
 * fabricar la fila con lo que trae el payload: el evento no pasa por los
 * embeds (cliente, asignado, adjunto) y armar la fila a mano deja la pantalla
 * mostrando algo que la base no dice.
 *
 * Invalidar es una consulta corta y acotada; el polling de dos segundos del
 * sistema anterior eran 43.200 por día por persona.
 */
export function useRealtimeWhatsapp(conversacionAbierta: string | null): EstadoCanal {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const queryClient = useQueryClient()
  const [estado, setEstado] = useState<EstadoCanal>('conectando')

  useEffect(() => {
    if (!companyId) return

    // Un mensaje nuevo cambia la bandeja Y sus señales de atención; las dos
    // se recalculan juntas, con una consulta cada una.
    const invalidarListado = () => {
      void queryClient.invalidateQueries({ queryKey: ['whatsapp', companyId, 'conversaciones'] })
      void queryClient.invalidateQueries({ queryKey: ['whatsapp', companyId, 'senales'] })
    }

    return suscribirWhatsapp(companyId, {
      mensaje: (c) => {
        const fila = (c.new ?? c.old) as { conversation_id?: string } | null
        invalidarListado()
        // El hilo sólo se refresca si es el que está abierto: los mensajes de
        // las otras conversaciones no se descargan por las dudas.
        if (fila?.conversation_id && fila.conversation_id === conversacionAbierta) {
          void queryClient.invalidateQueries({
            queryKey: ['whatsapp', companyId, 'mensajes', conversacionAbierta],
          })
        }
      },
      conversacion: (c) => {
        invalidarListado()
        const fila = (c.new ?? c.old) as { id?: string } | null
        if (fila?.id && fila.id === conversacionAbierta) {
          void queryClient.invalidateQueries({
            queryKey: ['whatsapp', companyId, 'conversacion', conversacionAbierta],
          })
        }
      },
      canal: setEstado,
    })
  }, [companyId, conversacionAbierta, queryClient])

  return estado
}

// ── IA (Fase 16 · E2) ─────────────────────────────────────────────────────
//
// Ninguna de estas consultas se repite por intervalo ni se recalcula por
// render: el resumen y los ítems se leen al abrir la conversación y se
// invalidan cuando alguien pide un análisis o resuelve una sugerencia.

export function useResumenIA(conversacionId: string | null) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  return useQuery({
    queryKey: ['whatsapp', companyId, 'ia', 'resumen', conversacionId],
    queryFn: () => obtenerResumenIA(conversacionId!),
    enabled: companyId !== null && !!conversacionId,
    staleTime: 5 * 60_000,
  })
}

export function useItemsIA(conversacionId: string | null) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  return useQuery({
    queryKey: ['whatsapp', companyId, 'ia', 'items', conversacionId],
    queryFn: () => listarItemsIA(conversacionId!),
    enabled: companyId !== null && !!conversacionId,
    staleTime: 5 * 60_000,
  })
}

export function useCorridasIA(conversacionId: string | null, habilitado: boolean) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  return useQuery({
    queryKey: ['whatsapp', companyId, 'ia', 'corridas', conversacionId],
    queryFn: () => listarCorridasIA(conversacionId!),
    enabled: habilitado && companyId !== null && !!conversacionId,
    staleTime: 60_000,
  })
}

/** Señales de toda la bandeja visible en UNA consulta. */
export function useSenales(conversaciones: readonly string[]) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const clave = [...conversaciones].sort().join(',')
  return useQuery({
    queryKey: ['whatsapp', companyId, 'senales', clave],
    queryFn: () => senalesDeAtencion(conversaciones),
    enabled: companyId !== null && conversaciones.length > 0,
    staleTime: 60_000,
  })
}

export function useInformeWhatsapp(desde: string, hasta: string, habilitado = true) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  return useQuery({
    queryKey: ['whatsapp', companyId, 'informe', desde, hasta],
    queryFn: () => obtenerInforme(companyId!, desde, hasta),
    enabled: habilitado && companyId !== null,
    staleTime: 60_000,
  })
}

/**
 * El snapshot guardado de un período (sólo administración). `habilitado` es
 * false para otros roles: no tiene sentido pedir lo que la RLS no les muestra.
 */
export function useInformeGuardado(tipo: 'daily' | 'weekly', desde: string, hasta: string, habilitado: boolean) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  return useQuery({
    queryKey: ['whatsapp', companyId, 'informe-guardado', tipo, desde, hasta],
    queryFn: () => obtenerInformeGuardado(companyId!, tipo, desde, hasta),
    enabled: habilitado && companyId !== null,
    staleTime: 5 * 60_000,
  })
}

// ── Configuración de la IA (Fase 16 · E3) ─────────────────────────────────

export const clavesIA = {
  config: (companyId: string | null) => ['whatsapp', companyId, 'config-ia'] as const,
  metricas: (companyId: string | null) => ['whatsapp', companyId, 'metricas-ia'] as const,
  modo: (companyId: string | null) => ['whatsapp', companyId, 'modo-ia'] as const,
}

export function useConfigIA(habilitado: boolean) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  return useQuery({
    queryKey: clavesIA.config(companyId),
    queryFn: () => obtenerConfigIA(companyId!),
    enabled: habilitado && companyId !== null,
    staleTime: 60_000,
  })
}

/** Sin intervalo: se lee al entrar y con «Actualizar». */
export function useMetricasIA(habilitado: boolean) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  return useQuery({
    queryKey: clavesIA.metricas(companyId),
    queryFn: () => obtenerMetricasIA(companyId!),
    enabled: habilitado && companyId !== null,
    staleTime: 60_000,
  })
}

export function useModoIA() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  return useQuery({
    queryKey: clavesIA.modo(companyId),
    queryFn: () => obtenerModoIA(companyId!),
    enabled: companyId !== null,
    staleTime: 5 * 60_000,
  })
}
