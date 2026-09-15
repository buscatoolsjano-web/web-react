import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import doc from '@/components/document/Document.module.css'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Button } from '@/components/ui/Button'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/ui/Spinner'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { BadgeEstado } from '../components/BadgeEstado'
import { SinAccesoEmails } from '../components/SinAccesoEmails'
import { Composer } from '../components/Composer'
import { MensajeEmail } from '../components/MensajeEmail'
import { PanelCliente } from '../components/PanelCliente'
import { PanelTrabajo } from '../components/PanelTrabajo'
import {
  claves,
  useCuentas,
  useContenidoHilo,
  useEstadoHilo,
  useHiloIndice,
  useMarcarLeido,
} from '../hooks/useEmails'
import { useParamsUrl } from '../hooks/useParamsUrl'
import { useRealtimeEmails } from '../hooks/useRealtimeEmails'
import { ErrorContenido, mensajeDeError } from '../lib/errores'
import { puedeUsarEmails } from '../lib/permisos'
import { listarBorradores } from '../services/redactar'
import type { OpcionesComposer } from '../hooks/useComposer'
import type { ModoRedaccion } from '../types'
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
  if (!puedeUsarEmails(activa?.rol)) return <SinAccesoEmails titulo="Emails" />
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
  const qc = useQueryClient()
  const cuentas = useCuentas()
  const [params, cambiarUrl] = useParamsUrl()
  useRealtimeEmails()

  // ── Composer: su estado vive en la URL, así un refresh lo recupera ───────
  const componer = params.get('componer') as ModoRedaccion | null
  const modoValido = componer === 'responder' || componer === 'responder_todos' || componer === 'reenviar' ? componer : null
  const mensajeRef = params.get('mensaje')
  const [ignorarBorradores, setIgnorarBorradores] = useState(false)
  // Con qué borrador y qué envío se ABRIÓ el composer. El autoguardado escribe
  // `borrador=` en la URL; si eso lo reiniciara, se perdería lo escrito. Sólo
  // cambia al abrir (acción, «Seguir el borrador», refresh) o al cerrar.
  const [apertura, setApertura] = useState(() => ({ borrador: params.get('borrador'), envio: params.get('envio') }))
  // El último mensaje que el índice tenía al enviar: cuando cambie, el sync ya
  // indexó la respuesta y el hilo queda leído para quien respondió (sólo él).
  const esperandoIndice = useRef<string | null>(null)

  const cerrarComposer = useCallback(() => {
    setIgnorarBorradores(false)
    setApertura({ borrador: null, envio: null })
    cambiarUrl({ componer: null, mensaje: null, borrador: null, envio: null })
  }, [cambiarUrl])

  const propia = (cuentas.data ?? []).find((c) => c.id === hilo?.accountId)?.direccion ?? ''
  const mensajesDisponibles = contenido.data?.hilo.mensajes
  const refMensaje = useMemo(
    () => (mensajesDisponibles ?? []).find((m) => m.id === mensajeRef) ?? mensajesDisponibles?.at(-1) ?? null,
    [mensajesDisponibles, mensajeRef],
  )

  const claveComposer = modoValido ? `${modoValido}|${mensajeRef ?? ''}|${apertura.borrador ?? 'nuevo'}` : null

  // Borradores de Gmail en este hilo: al abrir el composer sin uno, se ofrece
  // seguirlo. Se consulta UNA vez por apertura: lo que el propio composer guarde
  // después no tiene que volver a ofrecerse ni esconder el composer.
  const borradoresHilo = useQuery({
    queryKey: ['emails-borradores', hilo?.accountId, hilo?.gmailThreadId, claveComposer],
    queryFn: () => listarBorradores(hilo!.accountId, hilo!.gmailThreadId),
    enabled: !!hilo && !!modoValido && !apertura.borrador && !ignorarBorradores,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  })

  // Sólo se ofrece seguir un borrador del mismo tipo: una respuesta no se retoma como reenvío.
  const borradoresDelModo = (borradoresHilo.data ?? []).filter((b) => b.modo === modoValido)
  const hayRef = !!refMensaje
  const opciones = useMemo<OpcionesComposer | null>(() => {
    if (!hilo || !modoValido || !propia) return null
    if (!apertura.borrador && !refMensaje) return null
    return {
      accountId: hilo.accountId,
      propia,
      modo: modoValido,
      threadId: hilo.gmailThreadId,
      refMensaje,
      draftId: apertura.borrador,
      clientRequestId: apertura.envio,
      alCambiarUrl: cambiarUrl,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveComposer, hilo?.id, propia, hayRef, apertura])

  const alEnviar = useCallback(() => {
    if (!hilo) return
    cerrarComposer()
    // El mensaje enviado ya está en Gmail: el contenido se vuelve a pedir.
    void qc.invalidateQueries({ queryKey: claves.contenido(hilo.accountId, hilo.gmailThreadId) })
    // Cuando el sync lo indexe, el hilo queda leído para quien respondió (sólo él).
    esperandoIndice.current = hilo.ultimoMensajeEn ?? ''
  }, [hilo, cerrarComposer, qc])

  // Una vez por hilo abierto, y recién cuando se sabe que existe.
  const marcado = useRef<string | null>(null)
  const { mutate: marcarLeido } = marcar
  useEffect(() => {
    if (!hilo || marcado.current === hilo.id) return
    marcado.current = hilo.id
    marcarLeido(hilo)
  }, [hilo, marcarLeido])

  useEffect(() => {
    if (!hilo || esperandoIndice.current === null) return
    if ((hilo.ultimoMensajeEn ?? '') !== esperandoIndice.current) {
      esperandoIndice.current = null
      marcarLeido(hilo)
    }
  }, [hilo, marcarLeido])

  const volver = { to: `/emails${desde}`, label: 'Bandeja' }

  if (indice.isPending) {
    return (
      <div className={doc.pagina}>
        <PageHeader title="Hilo" back={volver} />
        <div className={styles.lista}>
          <SkeletonRows rows={4} columns={2} label="Cargando el hilo…" />
        </div>
      </div>
    )
  }
  if (indice.error) {
    return (
      <div className={doc.pagina}>
        <PageHeader title="Hilo" back={volver} />
        <ErrorState
          title="No se pudo leer el hilo."
          description={indice.error.message}
          onRetry={() => void indice.refetch()}
          retrying={indice.isFetching}
        />
      </div>
    )
  }
  if (!hilo) {
    return (
      <div className={doc.pagina}>
        <PageHeader title="Hilo" back={volver} />
        <EmptyState icon="mail" title="Este hilo no está disponible" description="No existe o no pertenece a la empresa activa." />
      </div>
    )
  }

  const errorContenido = contenido.error
  const codigo = errorContenido instanceof ErrorContenido ? errorContenido.codigo : 'desconocido'
  const reintentable = errorContenido instanceof ErrorContenido ? errorContenido.reintentable : true
  const mensajes = contenido.data?.hilo.mensajes ?? []

  return (
    <div className={doc.pagina}>
      <PageHeader
        back={volver}
        title={hilo.asunto?.trim() || '(sin asunto)'}
        subtitle={`${hilo.cantidadMensajes} ${hilo.cantidadMensajes === 1 ? 'mensaje' : 'mensajes'} · ${hilo.participantes.join(', ')}`}
        status={estado.data ? <BadgeEstado estado={estado.data.estado} /> : undefined}
      />

      <div className={styles.detalle}>
        <aside className={styles.lateral} aria-label="Trabajo y cliente">
          <PanelTrabajo hilo={hilo} estado={estado.data} />
          <PanelCliente hilo={hilo} estado={estado.data} />
        </aside>

        <section className={styles.mensajes} aria-label="Mensajes" aria-busy={contenido.isFetching}>
          {contenido.isPending && !errorContenido ? (
            // El contenido viene de Gmail al abrir y puede tardar (arranque en frío
            // del servicio): se dice qué se está esperando, no sólo un spinner.
            <div className={styles.cargandoContenido} role="status">
              <span className={styles.cargandoTexto}>
                <Spinner size={16} />
                Trayendo el hilo desde Gmail…
              </span>
              <SkeletonRows rows={3} columns={1} />
            </div>
          ) : errorContenido ? (
            <ErrorState
              title={mensajeDeError(codigo)}
              onRetry={reintentable ? () => void contenido.refetch() : undefined}
              retrying={contenido.isFetching}
            />
          ) : mensajes.length === 0 ? (
            <EmptyState icon="inbox" title="Sin mensajes" description="Gmail no devolvió mensajes para este hilo." compact />
          ) : (
            mensajes.map((m, i) => (
              <MensajeEmail
                key={m.id}
                hilo={hilo}
                mensaje={m}
                // Con pocos mensajes se ven todos; con muchos, sólo el último.
                abiertoInicial={mensajes.length <= 3 || i === mensajes.length - 1}
                onAccion={(modo, id) => {
                  setApertura({ borrador: null, envio: null })
                  cambiarUrl({ componer: modo, mensaje: id, borrador: null, envio: null })
                }}
              />
            ))
          )}

          {modoValido && !apertura.borrador && !ignorarBorradores && borradoresDelModo.length > 0 ? (
            <Alert
              tone="info"
              role="status"
              title={`Este hilo tiene ${borradoresDelModo.length === 1 ? 'un borrador guardado' : `${borradoresDelModo.length} borradores guardados`} en Gmail`}
              action={
                <span className={styles.accionesAviso}>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      const id = borradoresDelModo[0]!.draft_id
                      setApertura({ borrador: id, envio: null })
                      cambiarUrl({ borrador: id })
                    }}
                  >
                    Seguir el borrador
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setIgnorarBorradores(true)}>
                    Empezar uno nuevo
                  </Button>
                </span>
              }
            />
          ) : null}

          {opciones && (apertura.borrador || ignorarBorradores || borradoresHilo.isError || (borradoresHilo.isSuccess && borradoresDelModo.length === 0)) ? (
            <Composer
              key={claveComposer}
              opciones={opciones}
              titulo={modoValido === 'reenviar' ? 'Reenviar' : modoValido === 'responder_todos' ? 'Responder a todos' : 'Responder'}
              onCerrar={cerrarComposer}
              onEnviado={alEnviar}
            />
          ) : modoValido && borradoresHilo.isPending && !apertura.borrador && !ignorarBorradores ? (
            <p className={styles.cargandoTexto} role="status">
              <Spinner size={16} />
              Buscando borradores de este hilo en Gmail…
            </p>
          ) : null}
        </section>
      </div>
    </div>
  )
}
