import { useMutation } from '@tanstack/react-query'
import { ErrorContenido, mensajeDeError } from '../lib/errores'
import { adjuntosVisibles, tamanoLegible } from '../lib/formato'
import { guardarEnDisco, traerAdjunto } from '../services/contenido'
import type { AdjuntoContenido, HiloIndice, MensajeContenido } from '../types'
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
  const bajar = useMutation({
    mutationFn: () => traerAdjunto(hilo.accountId, hilo.gmailThreadId, mensajeId, adjunto.partId),
    onSuccess: (blob) => guardarEnDisco(blob, adjunto.nombre),
  })
  const error = bajar.error
    ? mensajeDeError(bajar.error instanceof ErrorContenido ? bajar.error.codigo : 'desconocido')
    : null

  return (
    <li className={styles.adjunto}>
      <span className={styles.adjuntoTexto}>
        <span>{adjunto.nombre}</span>
        <span className={styles.nota}>
          {adjunto.mime} · {tamanoLegible(adjunto.tamano)}
        </span>
        {error ? (
          <span className={styles.nota} role="alert">
            {error}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        className={styles.boton}
        onClick={() => bajar.mutate()}
        disabled={bajar.isPending}
        aria-label={`Descargar ${adjunto.nombre}`}
      >
        {bajar.isPending ? 'Descargando…' : 'Descargar'}
      </button>
    </li>
  )
}
