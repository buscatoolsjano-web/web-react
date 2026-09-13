import { useId, useState } from 'react'
import { fechaCompleta } from '../lib/formato'
import type { HiloIndice, MensajeContenido } from '../types'
import { AdjuntosEmail } from './AdjuntosEmail'
import { CuerpoSeguro } from './CuerpoSeguro'
import styles from './Emails.module.css'

export interface MensajeEmailProps {
  hilo: HiloIndice
  mensaje: MensajeContenido
  abiertoInicial: boolean
}

/** Un mensaje del hilo. Plegado sólo en la cabecera: el cuerpo no se dibuja hasta abrirlo. */
export function MensajeEmail({ hilo, mensaje, abiertoInicial }: MensajeEmailProps) {
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
        <span className={styles.mensajeDe}>{mensaje.de || '(sin remitente)'}</span>
        <span className={styles.mensajeFecha}>
          {cantidadAdjuntos > 0 ? `📎 ${cantidadAdjuntos} · ` : ''}
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
        </div>
      ) : null}
    </article>
  )
}
