import { Fragment, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { Alert } from '@/components/feedback/Alert'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { cx } from '@/utils/cx'
import { nombreDeTipo, presentarEstado, seDibuja } from '../lib/estados'
import { horaCorta, presentarVentana } from '../lib/ventana'
import { urlDeAdjunto } from '../services/mensajes'
import type { Mensaje } from '../types'
import styles from './Whatsapp.module.css'

export interface ChatProps {
  mensajes: readonly Mensaje[]
  cargando: boolean
  ventanaVenceEn: string | null
  puedeEnviar: boolean
  enviando: boolean
  errorEnvio: string | null
  /** Cuántos mensajes salieron bien. Al subir, el composer se limpia. */
  enviosOk: number
  onEnviar: (texto: string) => void
  onCerrarError: () => void
}

/** `lunes 16 de septiembre` para separar los días del hilo. */
function dia(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }).format(d)
}

/** Un adjunto ya descargado: el bucket es privado, así que se firma al abrir. */
function Adjunto({ m }: { m: Mensaje }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const a = m.adjunto

  useEffect(() => {
    if (!a?.rutaStorage || a.estado !== 'descargada') return
    let vivo = true
    urlDeAdjunto(a.rutaStorage)
      .then((u) => vivo && setUrl(u))
      .catch(() => vivo && setError(true))
    return () => {
      vivo = false
    }
  }, [a?.rutaStorage, a?.estado])

  if (!a) return null

  if (a.estado === 'pendiente') {
    return <p className={styles.adjuntoNota}>{nombreDeTipo(m.tipo)} · descargando…</p>
  }
  if (a.estado === 'fallida' || a.estado === 'vencida' || error) {
    return <p className={styles.adjuntoNota}>{nombreDeTipo(m.tipo)} · no se pudo descargar</p>
  }
  if (!url) return <p className={styles.adjuntoNota}>{nombreDeTipo(m.tipo)}</p>

  if (a.mime.startsWith('image/')) {
    return <img src={url} alt={m.caption ?? `${nombreDeTipo(m.tipo)} recibido`} className={styles.adjuntoImagen} />
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={styles.adjuntoEnlace}>
      <Icon name="paperclip" size={16} />
      {a.nombre ?? nombreDeTipo(m.tipo)}
    </a>
  )
}

function Burbuja({ m }: { m: Mensaje }) {
  const salida = m.direccion === 'out'
  const estado = presentarEstado(m.estadoVisible)

  return (
    <li className={cx(styles.burbujaFila, salida && styles.burbujaSalida)}>
      <div className={cx(styles.burbuja, salida ? styles.burbujaOut : styles.burbujaIn)}>
        {m.respondeA ? <p className={styles.respuesta}>En respuesta a un mensaje anterior</p> : null}

        {m.adjunto ? <Adjunto m={m} /> : null}

        {m.texto ? <p className={styles.burbujaTexto}>{m.texto}</p> : null}
        {m.caption && m.caption !== m.texto ? <p className={styles.burbujaTexto}>{m.caption}</p> : null}

        {/* Un tipo que todavía no se dibuja se NOMBRA: el modelo lo guardó bien
            aunque la pantalla no sepa mostrarlo. */}
        {!m.texto && !m.adjunto && !seDibuja(m.tipo) ? (
          <p className={styles.burbujaOtro}>{nombreDeTipo(m.tipo)}</p>
        ) : null}

        <p className={styles.burbujaPie}>
          <span>{horaCorta(m.ordenadoEn)}</span>
          {salida ? (
            <span className={cx(styles.estado, estado.esError && styles.estadoError)}>
              {/* El estado nunca va sólo por color ni sólo por ícono. */}
              {estado.etiqueta}
            </span>
          ) : null}
        </p>

        {estado.esError && m.errorDetalle ? <p className={styles.burbujaError}>{m.errorDetalle}</p> : null}
      </div>
    </li>
  )
}

export function Chat({
  mensajes,
  cargando,
  ventanaVenceEn,
  puedeEnviar,
  enviando,
  errorEnvio,
  enviosOk,
  onEnviar,
  onCerrarError,
}: ChatProps) {
  const [texto, setTexto] = useState('')
  const finDelHilo = useRef<HTMLDivElement>(null)
  const ventana = presentarVentana(ventanaVenceEn)

  // Al llegar un mensaje nuevo, el hilo baja solo. Sin animación: en un chat
  // de trabajo lo que importa es ver el último, no el viaje.
  useEffect(() => {
    finDelHilo.current?.scrollIntoView({ block: 'end' })
  }, [mensajes.length])

  const escribible = puedeEnviar && ventana.puedeEscribir

  // El texto se borra cuando el mensaje SALIÓ, no cuando se apretó Enviar. Si
  // se limpia antes, un envío fallido se lleva lo que la persona escribió.
  const enviadoOk = useRef(0)
  useEffect(() => {
    if (enviosOk > enviadoOk.current) {
      enviadoOk.current = enviosOk
      setTexto('')
    }
  }, [enviosOk])

  const enviar = () => {
    const limpio = texto.trim()
    if (limpio === '' || enviando || !escribible) return
    onEnviar(limpio)
  }

  return (
    <div className={styles.chat}>
      <div className={styles.hilo}>
        {cargando ? (
          <SkeletonRows rows={4} columns={1} label="Cargando mensajes…" />
        ) : mensajes.length === 0 ? (
          <p className={styles.hiloVacio}>Todavía no hay mensajes en esta conversación.</p>
        ) : (
          <ul className={styles.burbujas}>
            {mensajes.map((m, i) => {
              const anterior = mensajes[i - 1]
              const nuevoDia = !anterior || dia(anterior.ordenadoEn) !== dia(m.ordenadoEn)
              return (
                // Fragment y no un div: dentro de un <ul> sólo pueden ir <li>.
                <Fragment key={m.id}>
                  {nuevoDia ? (
                    <li className={styles.separadorDia}>
                      <span>{dia(m.ordenadoEn)}</span>
                    </li>
                  ) : null}
                  <Burbuja m={m} />
                </Fragment>
              )
            })}
          </ul>
        )}
        <div ref={finDelHilo} />
      </div>

      {errorEnvio ? (
        <Alert tone="danger" role="alert" title="No se pudo enviar" action={
          <Button variant="ghost" size="sm" onClick={onCerrarError}>Cerrar</Button>
        }>
          <p>{errorEnvio}</p>
        </Alert>
      ) : null}

      <div className={styles.composer}>
        <p
          className={cx(styles.ventana, ventana.estado === 'cerrada' && styles.ventanaCerrada)}
          id="ventana-servicio"
        >
          <Icon name={ventana.puedeEscribir ? 'info' : 'alert-triangle'} size={16} />
          {ventana.texto}
        </p>

        <div className={styles.composerFila}>
          <label htmlFor="mensaje-whatsapp" className="sr-only">
            Escribir un mensaje
          </label>
          <textarea
            id="mensaje-whatsapp"
            className={styles.entrada}
            rows={2}
            value={texto}
            disabled={!escribible || enviando}
            aria-describedby="ventana-servicio"
            placeholder={escribible ? 'Escribí un mensaje…' : 'No se puede escribir en esta conversación'}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              // Enter manda, Shift+Enter hace un salto de línea.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                enviar()
              }
            }}
          />
          <Button
            icon={<Icon name="arrow-right" size={16} />}
            loading={enviando}
            disabled={!escribible || texto.trim() === ''}
            onClick={enviar}
          >
            Enviar
          </Button>
        </div>
      </div>
    </div>
  )
}
