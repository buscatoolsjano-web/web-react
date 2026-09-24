import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/useAuth'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { dependeDelTrabajo } from '../lib/filtros'
import { suscribirBandeja, type EstadoCanal } from '../services/realtime'
import type { EstadoTrabajo, FilaBandeja, FiltrosEmails, PaginaBandeja } from '../types'
import { claves, parchearFilas } from './useEmails'

/**
 * La bandeja al día sin polling.
 *
 * Cada evento se aplica de la forma más barata que sea CORRECTA:
 *
 *  · Un cambio que no mueve la fila de lugar —asunto, extracto, estado de
 *    trabajo, lectura— se parchea en la caché. Cero requests.
 *  · Uno que sí puede moverla —un hilo nuevo, un mensaje nuevo que cambia el
 *    orden, un cambio de trabajo en una vista filtrada por trabajo— vuelve a
 *    pedir esa página, UNA vez por ráfaga de eventos.
 */
export function useRealtimeEmails(): { canal: EstadoCanal; reconectar: () => void } {
  const qc = useQueryClient()
  const companyId = useEmpresa().activa?.companyId ?? null
  const userId = useAuth().user?.id ?? null
  const [canal, setCanal] = useState<EstadoCanal>('conectando')
  const [intento, setIntento] = useState(0)
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refrescarPronto = useCallback(
    (soloDependientes: boolean) => {
      if (temporizador.current) clearTimeout(temporizador.current)
      temporizador.current = setTimeout(() => {
        temporizador.current = null
        if (!soloDependientes) {
          void qc.invalidateQueries({ queryKey: claves.bandeja(companyId) })
          return
        }
        for (const [clave] of qc.getQueriesData<PaginaBandeja>({ queryKey: claves.bandeja(companyId) })) {
          const filtros = clave[3] as FiltrosEmails | undefined
          if (filtros && dependeDelTrabajo(filtros)) void qc.invalidateQueries({ queryKey: clave, exact: true })
        }
      }, 400)
    },
    [qc, companyId],
  )

  useEffect(() => {
    if (!companyId || !userId) return
    const filasEnCache = (): FilaBandeja[] =>
      qc.getQueriesData<PaginaBandeja>({ queryKey: claves.bandeja(companyId) }).flatMap(([, p]) => p?.filas ?? [])

    const cancelar = suscribirBandeja(companyId, userId, {
      canal: setCanal,

      hilo: (c) => {
        if (c.eventType !== 'UPDATE') return refrescarPronto(false)
        const n = c.new
        void qc.invalidateQueries({ queryKey: claves.hilo(companyId, n.id) })
        const previa = filasEnCache().find((f) => f.id === n.id)
        const instante = (iso: string | null) => (iso ? new Date(iso).getTime() : null)
        // Un hilo que no está en pantalla, o un mensaje nuevo —que cambia el orden
        // y el no leído—: la página se rearma.
        if (!previa || instante(previa.ultimoMensajeEn) !== instante(n.last_message_at)) {
          return refrescarPronto(false)
        }
        parchearFilas(qc, companyId, (f) => f.id === n.id, {
          asunto: n.subject,
          extracto: n.snippet,
          ultimoRemitente: n.last_message_from,
          participantes: n.participants,
          cantidadMensajes: n.message_count,
          tieneAdjuntos: n.has_attachments,
        })
      },

      estado: (c) => {
        const fila = c.eventType === 'DELETE' ? null : c.new
        if (!fila) return refrescarPronto(false)
        void qc.invalidateQueries({ queryKey: claves.estado(companyId, fila.account_id, fila.gmail_thread_id) })
        const coincide = (f: FilaBandeja) =>
          f.accountId === fila.account_id && f.gmailThreadId === fila.gmail_thread_id
        const previa = filasEnCache().find(coincide)

        // Fase 28 · E2: `deleted_at` vive en esta misma tabla, y eliminar o
        // restaurar mueve el hilo de carpeta y cambia el total de TODAS. Eso
        // no se parchea: se vuelve a pedir la página.
        if (fila.deleted_at !== null || previa?.eliminado) return refrescarPronto(false)

        parchearFilas(qc, companyId, coincide, { estado: fila.workflow_status as EstadoTrabajo })
        // El nombre del asignado o del cliente no viene en el evento: si cambió,
        // se vuelve a pedir la página en vez de mostrar un id.
        const cambioNombres =
          !!previa && (previa.asignadoA !== fila.assigned_to || previa.clienteId !== fila.customer_id)
        if (cambioNombres) refrescarPronto(false)
        else refrescarPronto(true)
      },

      lectura: (c) => {
        if (c.eventType === 'DELETE') return
        const r = c.new
        parchearFilas(
          qc,
          companyId,
          (f) =>
            f.accountId === r.account_id &&
            f.gmailThreadId === r.gmail_thread_id &&
            (f.ultimoMensajeEn === null || new Date(r.last_read_at) >= new Date(f.ultimoMensajeEn)),
          { sinLeer: false },
        )
      },
    })
    return () => {
      cancelar()
      if (temporizador.current) clearTimeout(temporizador.current)
    }
  }, [qc, companyId, userId, intento, refrescarPronto])

  const reconectar = useCallback(() => {
    // Lo que pasó mientras el canal estuvo caído no llegó: se pide de nuevo.
    void qc.invalidateQueries({ queryKey: claves.todo(companyId) })
    setIntento((n) => n + 1)
  }, [qc, companyId])

  return { canal, reconectar }
}
