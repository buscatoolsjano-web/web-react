import { lazy, Suspense, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/useAuth'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { Icon } from '@/components/icons/Icon'
import { misNotificaciones } from '@/features/notificaciones/servicio'
import { ROLES_CHAT } from '@/modules/chat/lib/permisos'
import { useNoLeidos } from './useNoLeidos'
import styles from './BotonesHeader.module.css'

/**
 * Los accesos del header: notificaciones, chat y asistente (Fase 33).
 *
 * El orden y la forma vienen de la web vieja, que es a lo que la gente de la
 * casa está acostumbrada: los dos íconos con globito primero y después el
 * asistente como PÍLDORA con su nombre escrito.
 *
 * Que el asistente no sea un ícono más es deliberado. Un ícono al lado de
 * otros dos se lee como «otra bandeja»; la píldora con texto dice qué es y se
 * encuentra sin tener que adivinar. Es lo que uno quiere descubrible.
 *
 * Y no es una sección del menú: se abre en un panel a la derecha y se puede
 * preguntar sin irse de la pantalla en la que uno está trabajando, que es
 * justamente el momento en que aparece la pregunta.
 */

const PanelNotificaciones = lazy(() =>
  import('@/features/notificaciones/PanelNotificaciones').then((m) => ({
    default: m.PanelNotificaciones,
  })),
)
const PanelAsistente = lazy(() =>
  import('@/features/notificaciones/PanelAsistente').then((m) => ({ default: m.PanelAsistente })),
)

/** Cada dos minutos, igual que los contadores del menú. */
const CADA = 2 * 60_000

/** El globito con cuántas hay. Más de nueve no dice más que «muchas». */
function Globo({ cuantas }: { cuantas: number }) {
  if (cuantas <= 0) return null
  // `aria-hidden`: el número ya va en el rótulo del botón. Un globito de color
  // no le dice nada a un lector de pantalla, y repetirlo lo diría dos veces.
  return (
    <span className={styles.globo} aria-hidden="true">
      {cuantas > 9 ? '9+' : cuantas}
    </span>
  )
}

export function BotonesHeader() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const rol = activa?.rol ?? ''
  const userId = useAuth().user?.id ?? null
  const [abierto, setAbierto] = useState<'nada' | 'notificaciones' | 'asistente'>('nada')

  /**
   * El contador de la campana.
   *
   * Comparte `queryKey` con el panel, así que abrirlo no vuelve a consultar y
   * cerrarlo deja el número ya actualizado. Con dos consultas distintas, el
   * globito podría decir 3 con el panel mostrando 2.
   */
  const q = useQuery({
    queryKey: ['notificaciones', companyId, userId],
    queryFn: () => misNotificaciones(companyId!, userId!),
    enabled: companyId !== null && userId !== null,
    refetchInterval: CADA,
    staleTime: CADA,
    retry: false,
  })
  const cuantas = q.data?.length ?? 0

  // El del chat ya existía para el menú: se reusa en vez de contar de nuevo.
  const sinLeerChat = useNoLeidos().chat
  const puedeChat = (ROLES_CHAT as readonly string[]).includes(rol)

  return (
    <>
      <button
        type="button"
        className={styles.boton}
        aria-label={cuantas === 0 ? 'Notificaciones' : `Notificaciones: ${cuantas} sin ver`}
        aria-haspopup="dialog"
        onClick={() => setAbierto('notificaciones')}
      >
        <Icon name="bell" size={20} />
        <Globo cuantas={cuantas} />
      </button>

      {/* El chat es un ATAJO, no un panel: lleva a su pantalla, que es donde
          se conversa de verdad. Sólo aparece si el rol puede usarlo. */}
      {puedeChat ? (
        <Link
          to="/chat"
          className={styles.boton}
          aria-label={
            sinLeerChat === 0 ? 'Chat interno' : `Chat interno: ${sinLeerChat} sin leer`
          }
        >
          <Icon name="message-circle" size={20} />
          <Globo cuantas={sinLeerChat} />
        </Link>
      ) : null}

      <button
        type="button"
        className={styles.pildora}
        aria-haspopup="dialog"
        onClick={() => setAbierto('asistente')}
      >
        <Icon name="sparkles" size={16} />
        <span className={styles.pildoraTexto}>Asistente Digital</span>
      </button>

      {/* Sin `fallback` visible: el cajón tarda un pestañeo y un cartel de
          «cargando» que aparece y desaparece molesta más que la espera. */}
      <Suspense fallback={null}>
        {abierto === 'notificaciones' ? (
          <PanelNotificaciones onCerrar={() => setAbierto('nada')} />
        ) : null}
        {abierto === 'asistente' ? <PanelAsistente onCerrar={() => setAbierto('nada')} /> : null}
      </Suspense>
    </>
  )
}
