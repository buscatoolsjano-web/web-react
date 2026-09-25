import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/useAuth'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import {
  abrirChatDirecto,
  enviarMensaje,
  listarChats,
  marcarChatLeido,
  mensajesDeChat,
  usuariosParaChat,
} from '../services/chat'
import { suscribirChat, type EstadoCanal } from '../services/realtime'

/**
 * `companyId` va primero en cada clave, como en el resto de los módulos: dos
 * empresas nunca comparten caché, y cambiar de empresa no deja conversaciones
 * de la otra en pantalla.
 */
export const claves = {
  todo: (companyId: string | null) => ['chat', companyId] as const,
  lista: (companyId: string | null) => ['chat', companyId, 'conversaciones'] as const,
  usuarios: (companyId: string | null) => ['chat', companyId, 'usuarios'] as const,
  mensajes: (companyId: string | null, id: string | null) => ['chat', companyId, 'mensajes', id] as const,
  sinLeer: (companyId: string | null) => ['nav', companyId, 'sin-leer', 'chat'] as const,
}

function useCompany(): string | null {
  return useEmpresa().activa?.companyId ?? null
}

export function useConversaciones() {
  const companyId = useCompany()
  return useQuery({
    queryKey: claves.lista(companyId),
    queryFn: () => listarChats(companyId!),
    enabled: companyId !== null,
    // Realtime la mantiene al día: no hace falta volver a pedirla sola.
    staleTime: 5 * 60_000,
  })
}

export function useUsuariosParaChat() {
  const companyId = useCompany()
  return useQuery({
    queryKey: claves.usuarios(companyId),
    queryFn: () => usuariosParaChat(companyId!),
    enabled: companyId !== null,
    staleTime: 10 * 60_000,
  })
}

export function useMensajes(conversacionId: string | null) {
  const companyId = useCompany()
  const miId = useAuth().user?.id ?? ''
  return useQuery({
    queryKey: claves.mensajes(companyId, conversacionId),
    queryFn: () => mensajesDeChat(conversacionId!, miId),
    enabled: companyId !== null && conversacionId !== null && miId !== '',
    staleTime: 5 * 60_000,
  })
}

export function useAbrirChat() {
  const companyId = useCompany()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (otroUsuarioId: string) => abrirChatDirecto(companyId!, otroUsuarioId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: claves.lista(companyId) }),
  })
}

/**
 * Mandar un mensaje.
 *
 * No se parchea la caché con el mensaje propio: el `INSERT` vuelve por
 * realtime y lo trae con su id y su hora de servidor. Escribirlo dos veces
 * —una a mano y otra por el evento— era el camino corto al mensaje duplicado.
 */
export function useEnviarMensaje(conversacionId: string | null) {
  const companyId = useCompany()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (texto: string) => enviarMensaje(conversacionId!, texto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: claves.mensajes(companyId, conversacionId) })
      void qc.invalidateQueries({ queryKey: claves.lista(companyId) })
    },
  })
}

/**
 * Marcar leída la conversación abierta.
 *
 * Se dispara cuando la conversación cambia y cuando llegan mensajes nuevos
 * mientras está abierta: si la estás mirando, ya la leíste.
 */
export function useMarcarLeido(conversacionId: string | null, cuantosMensajes: number) {
  const companyId = useCompany()
  const qc = useQueryClient()

  useEffect(() => {
    if (conversacionId === null || cuantosMensajes === 0) return
    let vivo = true
    void marcarChatLeido(conversacionId)
      .then(() => {
        if (!vivo) return
        void qc.invalidateQueries({ queryKey: claves.lista(companyId) })
        void qc.invalidateQueries({ queryKey: claves.sinLeer(companyId) })
      })
      // Que falle marcar leído no puede romper la pantalla: lo peor que pasa
      // es que el globito siga mostrando un número de más.
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [conversacionId, cuantosMensajes, companyId, qc])
}

/** El canal en vivo, montado una sola vez por pantalla. */
export function useRealtimeChat(): { canal: EstadoCanal; reconectar: () => void } {
  const companyId = useCompany()
  const qc = useQueryClient()
  const [canal, setCanal] = useState<EstadoCanal>('conectando')
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    if (!companyId) return
    return suscribirChat(companyId, {
      canal: setCanal,
      mensaje: (c) => {
        const fila = c.new as { conversacion_id?: string } | null
        // La lista cambia de orden y de contador con cualquier mensaje; los
        // mensajes, sólo los de esa conversación.
        void qc.invalidateQueries({ queryKey: claves.lista(companyId) })
        void qc.invalidateQueries({ queryKey: claves.sinLeer(companyId) })
        if (fila?.conversacion_id) {
          void qc.invalidateQueries({ queryKey: claves.mensajes(companyId, fila.conversacion_id) })
        }
      },
    })
  }, [companyId, qc, intento])

  return {
    canal,
    reconectar: () => {
      void qc.invalidateQueries({ queryKey: claves.todo(companyId) })
      setIntento((n) => n + 1)
    },
  }
}
