import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { ErrorContenido, mensajeDeError } from '../lib/errores'
import { adjuntosVisibles, puedeSerOrdenDeCompra, sePuedeVer, tamanoLegible } from '../lib/formato'
import { guardarEnDisco, traerAdjunto } from '../services/contenido'
import type { AdjuntoContenido, HiloIndice, MensajeContenido } from '../types'
import { VisorAdjunto } from './VisorAdjunto'
import styles from './Emails.module.css'

export interface AdjuntosEmailProps {
  hilo: HiloIndice
  mensaje: MensajeContenido
  /**
   * Mandar este adjunto al importador de órdenes de compra (Fase 40).
   *
   * Lo resuelve la PÁGINA y no este componente, por dos razones: el modal del
   * importador es de Ventas y pesa —se carga con `lazy`—, y la descarga de los
   * bytes tiene que sobrevivir a que este `<li>` se desmonte. Sin la función,
   * el botón no existe: así el permiso lo decide quien sabe el rol.
   */
  onImportarOc?: ((adjunto: AdjuntoContenido, mensajeId: string) => void) | undefined
  /** El adjunto que se está mandando ahora, para mostrarlo ocupado. */
  importando?: string | null | undefined
}

/**
 * Los adjuntos: metadata siempre, bytes sólo al pedirlos.
 *
 * Nada se baja por adelantado, nada se copia a Storage, y el navegador nunca
 * recibe una URL de Gmail: el botón pide los bytes al servicio de Cloud Run,
 * que valida cuenta, hilo, mensaje y parte antes de ir a buscarlos.
 */
export function AdjuntosEmail({ hilo, mensaje, onImportarOc, importando }: AdjuntosEmailProps) {
  const visibles = adjuntosVisibles(mensaje.adjuntos)
  if (visibles.length === 0) return null
  return (
    <section aria-label="Adjuntos">
      <ul className={styles.adjuntos}>
        {visibles.map((a) => (
          <Adjunto
            key={a.partId}
            hilo={hilo}
            mensajeId={mensaje.id}
            adjunto={a}
            onImportarOc={onImportarOc}
            importando={importando === a.partId}
          />
        ))}
      </ul>
    </section>
  )
}

function Adjunto({
  hilo,
  mensajeId,
  adjunto,
  onImportarOc,
  importando = false,
}: {
  hilo: HiloIndice
  mensajeId: string
  adjunto: AdjuntoContenido
  onImportarOc?: ((adjunto: AdjuntoContenido, mensajeId: string) => void) | undefined
  importando?: boolean
}) {
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
      {/*
        Fase 40: el PDF de una orden de compra pasa al importador sin salir del
        correo ni bajarlo a la máquina. Antes habia que descargarlo, ir a
        Ventas, abrir «Importar OC» y volver a elegirlo.

        Sólo en PDF —es lo único que el importador sabe leer— y sólo si la
        página pasó la función, que es donde se mira el rol: importar escribe
        una cotización, y eso es de admin y employee.
      */}
      {onImportarOc && puedeSerOrdenDeCompra(adjunto.mime) ? (
        <Button
          variant="secondary"
          size="sm"
          icon={<Icon name="upload" size={16} />}
          onClick={() => onImportarOc(adjunto, mensajeId)}
          loading={importando}
          aria-label={`Importar ${adjunto.nombre} como orden de compra`}
        >
          {importando ? 'Abriendo…' : 'Importar OC'}
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
