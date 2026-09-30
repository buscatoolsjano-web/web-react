import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/features/auth/useAuth'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { CajonDerecho } from '@/components/modals/CajonDerecho'
import { Icon } from '@/components/icons/Icon'
import { misNotificaciones, type Notificacion } from './servicio'
import styles from './PanelNotificaciones.module.css'

/**
 * Las notificaciones (Fase 33 · E1).
 *
 * Dos cosas avisan: que me asignen un correo y que alguien me escriba en el
 * chat. Las dos se DERIVAN de la base, no de una tabla de notificaciones — ver
 * `servicio.ts` para por qué—, así que leer el correo desde la bandeja hace
 * desaparecer el aviso solo.
 */

/** «hace 5 min», «ayer». Un reloj exacto no dice nada acá. */
function hace(iso: string | null): string {
  if (iso === null) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  return d === 1 ? 'ayer' : `hace ${d} días`
}

/** Qué ícono y qué color le toca a cada clase de aviso. */
const icono = {
  alerta: { nombre: 'alert-triangle', clase: 'iconoAlerta' },
  email:  { nombre: 'mail',           clase: 'iconoMail' },
  chat:   { nombre: 'message-circle', clase: 'iconoChat' },
} as const

export interface PanelNotificacionesProps {
  onCerrar: () => void
}

export function PanelNotificaciones({ onCerrar }: PanelNotificacionesProps) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const userId = useAuth().user?.id ?? null
  const navegar = useNavigate()

  const q = useQuery({
    queryKey: ['notificaciones', companyId, userId],
    queryFn: () => misNotificaciones(companyId!, userId!),
    enabled: companyId !== null && userId !== null,
  })

  const ir = (n: Notificacion) => {
    onCerrar()
    void navegar(n.destino)
  }

  return (
    <CajonDerecho titulo="Notificaciones" onCerrar={onCerrar}>
      {q.isPending ? (
        <p className={styles.aviso}>Buscando…</p>
      ) : (q.data ?? []).length === 0 ? (
        /* Que quede claro QUÉ avisa, no sólo que no hay nada. Un «no tenés
           notificaciones» a secas deja pensando si esto funciona. */
        <div className={styles.vacio}>
          <p className={styles.vacioTitulo}>No tenés nada pendiente.</p>
          <p className={styles.vacioAyuda}>
            Acá te avisamos cuando te asignen un correo o cuando alguien te escriba por el chat.
          </p>
        </div>
      ) : (
        <ul className={styles.lista}>
          {(q.data ?? []).map((n) => (
            <li key={n.id}>
              <button type="button" className={styles.item} onClick={() => ir(n)}>
                {/* La alerta se distingue por FORMA además de por color: un
                    triángulo no se confunde con un sobre aunque no se vean
                    los colores. */}
                <span className={styles[icono[n.tipo].clase]}>
                  <Icon name={icono[n.tipo].nombre} size={16} />
                </span>
                <span className={styles.texto}>
                  <span className={styles.linea1}>
                    <strong className={styles.de}>{n.de}</strong>
                    <span className={styles.cuando}>{hace(n.cuando)}</span>
                  </span>
                  <span className={styles.titulo}>{n.titulo}</span>
                  {n.detalle !== null && n.detalle !== '' ? (
                    <span className={styles.detalle}>{n.detalle}</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </CajonDerecho>
  )
}
