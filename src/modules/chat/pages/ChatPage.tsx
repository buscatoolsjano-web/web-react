import { useEffect, useRef, useState } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import doc from '@/components/document/Document.module.css'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/forms/Field'
import { Select } from '@/components/forms/controls'
import { Icon } from '@/components/icons/Icon'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { fechaBandeja } from '@/modules/emails/lib/formato'
import { puedeUsarChat } from '../lib/permisos'
import {
  useAbrirChat,
  useConversaciones,
  useEnviarMensaje,
  useMarcarLeido,
  useMensajes,
  useRealtimeChat,
  useUsuariosParaChat,
} from '../hooks/useChat'
import styles from './ChatPage.module.css'

/**
 * El chat interno (Fase 28 · E15).
 *
 * La tercera pieza de Comunicación, y la única que no habla con afuera: las
 * personas de la empresa entre ellas. Dos columnas —las conversaciones y la
 * abierta—, que es la forma que ya conoce cualquiera que usó un chat.
 *
 * Sin polling: los mensajes llegan por realtime. Y sin borrar ni editar a
 * propósito: un chat de trabajo que se puede reescribir hacia atrás no sirve
 * para acordar nada.
 */
export function ChatPage() {
  const { activa } = useEmpresa()
  if (!puedeUsarChat(activa?.rol)) {
    return (
      <div className={doc.listado}>
        <PageHeader title="Chat" />
        <EmptyState
          icon="message-circle"
          title="Tu rol no usa el chat interno"
          description="El chat es para las personas que trabajan en la empresa."
        />
      </div>
    )
  }
  return <Chat />
}

function Chat() {
  const [abierta, setAbierta] = useState<string | null>(null)
  const [texto, setTexto] = useState('')

  const conversaciones = useConversaciones()
  const usuarios = useUsuariosParaChat()
  const mensajes = useMensajes(abierta)
  const abrir = useAbrirChat()
  const enviar = useEnviarMensaje(abierta)
  const { canal, reconectar } = useRealtimeChat()

  const lista = conversaciones.data ?? []
  const conversacion = lista.find((c) => c.id === abierta) ?? null
  const charla = mensajes.data ?? []

  useMarcarLeido(abierta, charla.length)

  // Al final de la charla, siempre: un chat que abre arriba obliga a bajar
  // para leer lo último, que es justo lo que se quiere leer.
  const fondo = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (fondo.current) fondo.current.scrollTop = fondo.current.scrollHeight
  }, [abierta, charla.length])

  const mandar = () => {
    const limpio = texto.trim()
    if (limpio === '' || abierta === null) return
    enviar.mutate(limpio, { onSuccess: () => setTexto('') })
  }

  return (
    <div className={doc.listado}>
      <PageHeader
        title="Chat"
        subtitle={`${lista.length} ${lista.length === 1 ? 'conversación' : 'conversaciones'}`}
        actions={
          <Field label="Hablar con" hideLabel>
            <Select
              value=""
              disabled={(usuarios.data ?? []).length === 0 || abrir.isPending}
              onChange={(e) => {
                if (e.target.value === '') return
                abrir.mutate(e.target.value, { onSuccess: (id) => setAbierta(id) })
              }}
            >
              <option value="">Hablar con…</option>
              {(usuarios.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                </option>
              ))}
            </Select>
          </Field>
        }
      />

      {canal === 'caido' ? (
        <Alert
          tone="warning"
          role="status"
          title="La actualización en vivo se desconectó"
          action={
            <Button variant="secondary" size="sm" onClick={reconectar}>
              Reconectar
            </Button>
          }
        >
          <p>Los mensajes nuevos no van a aparecer solos.</p>
        </Alert>
      ) : null}

      {abrir.error ? (
        <Alert tone="danger" role="alert" title="No se pudo abrir la conversación">
          <p>{abrir.error.message}</p>
        </Alert>
      ) : null}

      {conversaciones.error ? (
        <ErrorState
          title="No se pudieron leer las conversaciones."
          description={conversaciones.error.message}
          onRetry={() => void conversaciones.refetch()}
          retrying={conversaciones.isFetching}
        />
      ) : (
        <div className={styles.columnas}>
          <aside className={styles.lista} aria-label="Conversaciones">
            {conversaciones.isPending ? (
              <SkeletonRows rows={4} columns={1} label="Cargando las conversaciones…" />
            ) : lista.length === 0 ? (
              <p className={styles.nota}>
                Todavía no hablaste con nadie. Elegí a alguien en «Hablar con…».
              </p>
            ) : (
              <ul className={styles.conversaciones}>
                {lista.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={`${styles.conversacion} ${c.id === abierta ? styles.activa : ''}`}
                      aria-current={c.id === abierta ? 'true' : undefined}
                      onClick={() => setAbierta(c.id)}
                    >
                      <span className={styles.quien}>{c.conQuien}</span>
                      {c.sinLeer > 0 ? (
                        <span className={styles.sinLeer}>
                          {c.sinLeer}
                          <span className="sr-only"> sin leer</span>
                        </span>
                      ) : null}
                      <span className={styles.previa}>{c.ultimoMensaje ?? 'Sin mensajes'}</span>
                      <time className={styles.cuando} dateTime={c.ultimoMensajeEn ?? undefined}>
                        {fechaBandeja(c.ultimoMensajeEn)}
                      </time>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <section className={styles.charla} aria-label="Conversación abierta">
            {conversacion === null ? (
              <EmptyState
                icon="message-circle"
                title="Elegí una conversación"
                description="O empezá una nueva con «Hablar con…»."
              />
            ) : (
              <>
                <h2 className={styles.titulo}>{conversacion.conQuien}</h2>

                <div className={styles.mensajes} ref={fondo} role="log" aria-label="Mensajes">
                  {mensajes.isPending ? (
                    <p className={styles.nota}>Cargando…</p>
                  ) : charla.length === 0 ? (
                    <p className={styles.nota}>Todavía no hay mensajes. Escribí el primero.</p>
                  ) : (
                    charla.map((m) => (
                      <article key={m.id} className={`${styles.burbuja} ${m.esMio ? styles.mia : ''}`}>
                        {/* Quién habló va SIEMPRE, no sólo el color: en un
                            grupo el color no alcanza, y en dos personas quien
                            no distingue colores queda sin saber. */}
                        <span className={styles.autor}>{m.esMio ? 'Vos' : m.autorNombre}</span>
                        <p className={styles.texto}>{m.texto}</p>
                        <time className={styles.hora} dateTime={m.creadoEn}>
                          {fechaBandeja(m.creadoEn)}
                        </time>
                      </article>
                    ))
                  )}
                </div>

                {enviar.error ? (
                  <Alert tone="danger" role="alert" title="No se pudo enviar">
                    <p>{enviar.error.message}</p>
                  </Alert>
                ) : null}

                <form
                  className={styles.redactar}
                  onSubmit={(e) => {
                    e.preventDefault()
                    mandar()
                  }}
                >
                  <textarea
                      className={styles.campo}
                      aria-label="Escribí un mensaje"
                      value={texto}
                      rows={2}
                      maxLength={4000}
                      placeholder="Escribí un mensaje…"
                      onChange={(e) => setTexto(e.target.value)}
                      // Enter manda, Shift+Enter hace un renglón: es lo que
                      // espera cualquiera que usó un chat.
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          mandar()
                        }
                      }}
                  />
                  <Button
                    type="submit"
                    icon={<Icon name="arrow-right" size={16} />}
                    disabled={texto.trim() === ''}
                    loading={enviar.isPending}
                  >
                    Enviar
                  </Button>
                </form>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
