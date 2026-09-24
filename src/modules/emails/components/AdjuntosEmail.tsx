import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { ErrorContenido, mensajeDeError } from '../lib/errores'
import { adjuntosVisibles, sePuedeVer, tamanoLegible } from '../lib/formato'
import { guardarEnDisco, traerAdjunto } from '../services/contenido'
import type { AdjuntoContenido, HiloIndice, MensajeContenido } from '../types'
import { VisorAdjunto } from './VisorAdjunto'
import styles from './Emails.module.css'

export interface AdjuntosEmailProps {
  hilo: HiloIndice
  mensaje: MensajeContenido
}

/**
 * Los adjuntos: metadata siempre, bytes sólo al pedirlos.
 *
 * Nada se baja por adelantado, nada se copia a Storage, y el navegador nunca
 * recibe una URL de Gmail: el botón pide los bytes al servicio de Cloud Run,
 * que valida cuenta, hilo, mensaje y parte antes de ir a buscarlos.
 */
export function AdjuntosEmail({ hilo, mensaje }: AdjuntosEmailProps) {
  const visibles = adjuntosVisibles(mensaje.adjuntos)
  if (visibles.length === 0) return null
  return (
    <section aria-label="Adjuntos">
      <ul className={styles.adjuntos}>
        {visibles.map((a) => (
          <Adjunto key={a.partId} hilo={hilo} mensajeId={mensaje.id} adjunto={a} />
        ))}
      </ul>
    </section>
  )
}

function Adjunto({ hilo, mensajeId, adjunto }: { hilo: HiloIndice; mensajeId: string; adjunto: AdjuntoContenido }) {
  const [viendo, setViendo] = useState(false)
  const bajar = useMutation({
    mutationFn: () => traerAdjunto(hilo.accountId, hilo.gmailThreadId, mensajeId, adjunto.partId),
    onSuccess: (blob) => guardarEnDisco(blob, adjunto.nombre),
  })
  const error = bajar.error
    ? mensajeDeError(bajar.error instanceof ErrorContenido ? bajar.error.codigo : 'desconocido')
    : null

  return (
    <li className={styles.adjunto}>
      <Icon name="paperclip" size={16} className={styles.adjuntoIcono} />
      <span className={styles.adjuntoTexto}>
        <span className={styles.adjuntoNombre}>{adjunto.nombre}</span>
        <span className={styles.nota}>
          {adjunto.mime} · {tamanoLegible(adjunto.tamano)}
        </span>
        {error ? (
          <span className={styles.errorTexto} role="alert">
            {error}
          </span>
        ) : null}
      </span>
      {/* Fase 28 · E8: un PDF o una imagen se miran sin bajarlos. Lo demás no
          se ofrece: un `<iframe>` con un .docx no muestra nada, o se lo baja
          solo, que es justo lo que se quería evitar. */}
      {sePuedeVer(adjunto.mime) ? (
        <Button
          variant="secondary"
          size="sm"
          icon={<Icon name="eye" size={16} />}
          onClick={() => setViendo(true)}
          aria-label={`Ver ${adjunto.nombre}`}
        >
          Ver
        </Button>
      ) : null}
      <Button
        variant="secondary"
        size="sm"
        icon={<Icon name="download" size={16} />}
        onClick={() => bajar.mutate()}
        loading={bajar.isPending}
        aria-label={`Descargar ${adjunto.nombre}`}
      >
        {bajar.isPending ? 'Descargando…' : 'Descargar'}
      </Button>

      {viendo ? (
        <VisorAdjunto hilo={hilo} mensajeId={mensajeId} adjunto={adjunto} onCerrar={() => setViendo(false)} />
      ) : null}
    </li>
  )
}
