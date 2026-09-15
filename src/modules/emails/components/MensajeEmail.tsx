import { useId, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { fechaCompleta } from '../lib/formato'
import type { HiloIndice, MensajeContenido } from '../types'
import { AdjuntosEmail } from './AdjuntosEmail'
import { CuerpoSeguro } from './CuerpoSeguro'
import styles from './Emails.module.css'

export interface MensajeEmailProps {
  hilo: HiloIndice
  mensaje: MensajeContenido
  abiertoInicial: boolean
  /** Responder, responder a todos y reenviar ESTE mensaje. */
  onAccion?: (modo: 'responder' | 'responder_todos' | 'reenviar', mensajeId: string) => void
}

/**
 * Un mensaje del hilo. Plegado sólo en la cabecera: el cuerpo no se dibuja
 * hasta abrirlo (y `CuerpoSeguro` sigue siendo el único que lo pinta).
 */
export function MensajeEmail({ hilo, mensaje, abiertoInicial, onAccion }: MensajeEmailProps) {
  const [abierto, setAbierto] = useState(abiertoInicial)
  const id = useId()
  const cantidadAdjuntos = mensaje.adjuntos.filter((a) => !a.inline).length

  return (
    <article className={styles.mensaje} aria-label={`Mensaje de ${mensaje.de || 'remitente desconocido'}`}>
      <button
        type="button"
        className={styles.mensajeCabecera}
        aria-expanded={abierto}
        aria-controls={id}
        onClick={() => setAbierto((v) => !v)}
      >
        <Icon name="chevron-down" size={16} className={abierto ? styles.flechaAbierta : styles.flecha} />
        <span className={styles.mensajeDe}>{mensaje.de || '(sin remitente)'}</span>
        <span className={styles.mensajeFecha}>
          {cantidadAdjuntos > 0 ? (
            <span className={styles.clip}>
              <Icon name="paperclip" size={16} />
              {cantidadAdjuntos}
              <span className="sr-only"> {cantidadAdjuntos === 1 ? 'adjunto' : 'adjuntos'}</span>
            </span>
          ) : null}
          {fechaCompleta(mensaje.fecha)}
        </span>
      </button>

      {abierto ? (
        <div id={id} className={styles.mensajeCuerpo}>
          <p className={styles.destinatarios}>
            Para: {mensaje.para || '—'}
            {mensaje.cc ? ` · CC: ${mensaje.cc}` : ''}
          </p>
          <CuerpoSeguro hilo={hilo} mensaje={mensaje} />
          <AdjuntosEmail hilo={hilo} mensaje={mensaje} />
          {onAccion ? (
            <div className={styles.accionesMensaje} role="group" aria-label="Acciones del mensaje">
              <Button variant="secondary" size="sm" icon={<Icon name="arrow-left" size={16} />} onClick={() => onAccion('responder', mensaje.id)}>
                Responder
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onAccion('responder_todos', mensaje.id)}>
                Responder a todos
              </Button>
              <Button variant="ghost" size="sm" icon={<Icon name="arrow-right" size={16} />} onClick={() => onAccion('reenviar', mensaje.id)}>
                Reenviar
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}
