import { useEffect, useRef } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { MensajeEmail } from '../components/MensajeEmail'
import { PanelCliente } from '../components/PanelCliente'
import { PanelTrabajo } from '../components/PanelTrabajo'
import {
  useContenidoHilo,
  useEstadoHilo,
  useHiloIndice,
  useMarcarLeido,
} from '../hooks/useEmails'
import { useRealtimeEmails } from '../hooks/useRealtimeEmails'
import { ErrorContenido, mensajeDeError } from '../lib/errores'
import { puedeUsarEmails } from '../lib/permisos'
import styles from '../components/Emails.module.css'

/**
 * Un hilo.
 *
 * El índice y el trabajo vienen de Supabase; el contenido, de Gmail a través de
 * Cloud Run, al abrir. Abrirlo lo marca leído EN EL ERP y SÓLO para esta
 * persona: Gmail no se toca.
 */
export function EmailHiloPage() {
  const { activa } = useEmpresa()
  if (!puedeUsarEmails(activa?.rol)) {
    return (
      <div className={styles.page}>
        <h1 className={styles.titulo}>Emails</h1>
        <p className={styles.vacio}>Tu rol en esta empresa no tiene acceso a la bandeja de correo.</p>
      </div>
    )
  }
  return <Hilo />
}

function Hilo() {
  const { threadId } = useParams()
  const location = useLocation()
  const desde = (location.state as { desde?: string } | null)?.desde ?? ''
  const indice = useHiloIndice(threadId)
  const hilo = indice.data ?? null
  const estado = useEstadoHilo(hilo)
  const contenido = useContenidoHilo(hilo)
  const marcar = useMarcarLeido()
  useRealtimeEmails()

  // Una vez por hilo abierto, y recién cuando se sabe que existe.
  const marcado = useRef<string | null>(null)
  const { mutate: marcarLeido } = marcar
  useEffect(() => {
    if (!hilo || marcado.current === hilo.id) return
    marcado.current = hilo.id
    marcarLeido(hilo)
  }, [hilo, marcarLeido])

  const volver = (
    <Link to={`/emails${desde}`} className={styles.volver}>
      ← Volver a la bandeja
    </Link>
  )

  if (indice.isPending) {
    return (
      <div className={styles.page}>
        {volver}
        <p className={styles.nota}>Cargando…</p>
      </div>
    )
  }
  if (indice.error) {
    return (
      <div className={styles.page}>
        {volver}
        <div className={styles.error} role="alert">
          <span>No se pudo leer el hilo: {indice.error.message}</span>
          <button type="button" className={styles.boton} onClick={() => void indice.refetch()}>
            Reintentar
          </button>
        </div>
      </div>
    )
  }
  if (!hilo) {
    return (
      <div className={styles.page}>
        {volver}
        <div className={styles.vacio}>
          <p>Este hilo no existe o no pertenece a la empresa activa.</p>
        </div>
      </div>
    )
  }

  const errorContenido = contenido.error
  const codigo = errorContenido instanceof ErrorContenido ? errorContenido.codigo : 'desconocido'
  const reintentable = errorContenido instanceof ErrorContenido ? errorContenido.reintentable : true
  const mensajes = contenido.data?.hilo.mensajes ?? []

  return (
    <div className={styles.page}>
      {volver}
      <header>
        <h1 className={styles.titulo}>{hilo.asunto?.trim() || '(sin asunto)'}</h1>
        <p className={styles.subtitulo}>
          {hilo.cantidadMensajes} {hilo.cantidadMensajes === 1 ? 'mensaje' : 'mensajes'} ·{' '}
          {hilo.participantes.join(', ')}
        </p>
      </header>

      <div className={styles.detalle}>
        <aside className={styles.lateral} aria-label="Trabajo y cliente">
          <PanelTrabajo hilo={hilo} estado={estado.data} />
          <PanelCliente hilo={hilo} estado={estado.data} />
        </aside>

        <section className={styles.mensajes} aria-label="Mensajes" aria-busy={contenido.isFetching}>
          {contenido.isPending && !errorContenido ? (
            <p className={styles.nota} role="status">
              Trayendo el hilo desde Gmail…
            </p>
          ) : errorContenido ? (
            <div className={styles.error} role="alert">
              <span>{mensajeDeError(codigo)}</span>
              {reintentable ? (
                <button
                  type="button"
                  className={styles.boton}
                  disabled={contenido.isFetching}
                  onClick={() => void contenido.refetch()}
                >
                  {contenido.isFetching ? 'Reintentando…' : 'Reintentar'}
                </button>
              ) : null}
            </div>
          ) : mensajes.length === 0 ? (
            <div className={styles.vacio}>
              <p>Gmail no devolvió mensajes para este hilo.</p>
            </div>
          ) : (
            mensajes.map((m, i) => (
              <MensajeEmail
                key={m.id}
                hilo={hilo}
                mensaje={m}
                // Con pocos mensajes se ven todos; con muchos, sólo el último.
                abiertoInicial={mensajes.length <= 3 || i === mensajes.length - 1}
              />
            ))
          )}
        </section>
      </div>
    </div>
  )
}
