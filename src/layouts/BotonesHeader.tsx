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
/**
 * Cata, la llamada del catálogo (Fase 85).
 *
 * `lazy` como los otros dos, y acá importa más: trae el reconocedor de voz y
 * el sintetizador, que no los usa nadie que no llame.
 */
const PanelCata = lazy(() =>
  import('@/modules/cata/components/PanelCata').then((m) => ({ default: m.PanelCata })),
)

/** Cada dos minutos, igual que los contadores del menú. */
const CADA = 2 * 60_000

/**
 * Hasta cuándo ya se vieron las notificaciones (Fase 134).
 *
 * Las notificaciones se DERIVAN de lo que falta atender (una consulta nueva, un
 * correo asignado), así que no hay un «leído» que escribir en la base: la
 * consulta sigue nueva hasta que alguien la contacta. Pero abrir el panel SÍ es
 * «ya las vi». Se guarda por navegador —como la última visita— cuándo fue la
 * última vez que se abrió, y el globito cuenta sólo lo posterior a eso. Así,
 * abrir el panel baja el globito, y una notificación nueva lo vuelve a subir.
 */
const LLAVE_VISTO = 'bt-notif-visto'
const leerVisto = (companyId: string | null, userId: string | null): string => {
  try {
    return localStorage.getItem(`${LLAVE_VISTO}:${companyId}:${userId}`) ?? ''
  } catch {
    return ''
  }
}
const guardarVisto = (companyId: string | null, userId: string | null, cuando: string): void => {
  try {
    localStorage.setItem(`${LLAVE_VISTO}:${companyId}:${userId}`, cuando)
  } catch {
    /* sin storage no se recuerda; el globito sigue andando igual */
  }
}

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
  const [abierto, setAbierto] = useState<'nada' | 'notificaciones' | 'asistente' | 'cata'>('nada')
  /*
   * `visto` se LEE en cada render, con la empresa y el usuario REALES (Fase 161).
   *
   * Antes vivía en estado con un inicializador —`useState(() => leerVisto(...))`—
   * que corre UNA sola vez, en el primer render. Y en ese primer render la
   * empresa y el usuario todavía son `null` (se cargan asíncronos), así que leía
   * la clave equivocada (`:null:null` → vacío) y nunca la volvía a leer para los
   * valores de verdad. Resultado: abrías el panel, el globito bajaba, pero al
   * recargar volvía a aparecer, porque el `visto` guardado nunca se releía.
   *
   * Leerlo en el render lo arregla: cuando empresa y usuario llegan, el próximo
   * render lee la clave correcta de localStorage y el globito queda bajo. Es una
   * lectura barata y protegida con try/catch; `misNotificaciones` recién corre
   * cuando los dos están, así que `cuantas` siempre compara contra el `visto`
   * bueno.
   */
  const visto = leerVisto(companyId, userId)

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
  // Sólo las que llegaron DESPUÉS de la última vez que se abrió el panel: así
  // abrir baja el globito y una nueva lo vuelve a subir. Las alertas sin fecha
  // (ej. «el correo dejó de entrar») se ven en el panel pero no mueven el
  // globito —no tienen un «cuándo» contra el cual decidir si son nuevas—.
  const cuantas = (q.data ?? []).filter((n) => n.cuando !== null && n.cuando > visto).length

  /** Abrir el panel es «ya las vi»: se marca hasta ahora y el globito baja.
      Se persiste en localStorage y el re-render de `setAbierto` vuelve a leer
      ese `visto`, así que el globito baja ahora Y sigue bajo al recargar. */
  const abrirNotificaciones = () => {
    guardarVisto(companyId, userId, new Date().toISOString())
    setAbierto('notificaciones')
  }

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
        onClick={abrirNotificaciones}
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

      {/* Cata, que es una LLAMADA y no un chat: entra voz y sale voz, y sabe
          sólo del catálogo. Botón propio y no un modo del asistente porque es
          otra cosa, y porque el límite de lo que sabe está en la puerta —ver
          `supabase/functions/cata/logica.ts`—, no en un parámetro. */}
      <button
        type="button"
        className={`${styles.pildora} ${styles.pildoraCata}`}
        aria-haspopup="dialog"
        onClick={() => setAbierto('cata')}
      >
        <Icon name="phone" size={16} />
        <span className={styles.pildoraTexto}>Cata</span>
      </button>

      {/* Sin `fallback` visible: el cajón tarda un pestañeo y un cartel de
          «cargando» que aparece y desaparece molesta más que la espera. */}
      <Suspense fallback={null}>
        {abierto === 'notificaciones' ? (
          <PanelNotificaciones onCerrar={() => setAbierto('nada')} />
        ) : null}
        {abierto === 'asistente' ? <PanelAsistente onCerrar={() => setAbierto('nada')} /> : null}
        {abierto === 'cata' ? <PanelCata onCerrar={() => setAbierto('nada')} /> : null}
      </Suspense>
    </>
  )
}
