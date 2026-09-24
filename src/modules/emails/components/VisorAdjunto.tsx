import { useEffect, useState } from 'react'
import { Alert } from '@/components/feedback/Alert'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/modals/Dialog'
import { Icon } from '@/components/icons/Icon'
import { Spinner } from '@/components/ui/Spinner'
import { ErrorContenido, mensajeDeError } from '../lib/errores'
import { guardarEnDisco, traerAdjunto } from '../services/contenido'
import type { AdjuntoContenido, HiloIndice } from '../types'
import styles from './Emails.module.css'

export interface VisorAdjuntoProps {
  hilo: HiloIndice
  mensajeId: string
  adjunto: AdjuntoContenido
  onCerrar: () => void
}

/**
 * Mirar un adjunto sin bajarlo al disco (Fase 28 · E8).
 *
 * Los bytes llegan igual que para descargar: se los pide al servicio de Cloud
 * Run, que valida cuenta, hilo, mensaje y parte. El navegador nunca recibe una
 * URL de Gmail, y acá tampoco: lo que se abre es un `blob:` de esta pestaña,
 * que muere cuando se cierra la ventana.
 *
 * El blob se revoca SIEMPRE al desmontar. Sin eso, mirar veinte adjuntos deja
 * veinte archivos enteros en memoria hasta recargar la página.
 *
 * Un PDF se muestra en un `<iframe>` con el visor del navegador —el que la
 * persona ya sabe usar, con su búsqueda y su impresión—; una imagen, como
 * imagen. Cualquier otro tipo no se ofrece: un `<iframe>` con un .docx no
 * muestra nada o, peor, se lo baja solo.
 */
export function VisorAdjunto({ hilo, mensajeId, adjunto, onCerrar }: VisorAdjuntoProps) {
  const [url, setUrl] = useState<string | null>(null)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    let creada: string | null = null

    traerAdjunto(hilo.accountId, hilo.gmailThreadId, mensajeId, adjunto.partId)
      .then((b) => {
        if (!vivo) return
        creada = URL.createObjectURL(b)
        setBlob(b)
        setUrl(creada)
      })
      .catch((e: unknown) => {
        if (!vivo) return
        setError(mensajeDeError(e instanceof ErrorContenido ? e.codigo : 'desconocido'))
      })

    return () => {
      vivo = false
      if (creada) URL.revokeObjectURL(creada)
    }
  }, [hilo.accountId, hilo.gmailThreadId, mensajeId, adjunto.partId])

  return (
    <Dialog
      open
      onClose={onCerrar}
      title={adjunto.nombre}
      size="xl"
      footer={
        <>
          <Button
            variant="secondary"
            icon={<Icon name="download" size={16} />}
            disabled={blob === null}
            onClick={() => blob && guardarEnDisco(blob, adjunto.nombre)}
          >
            Descargar
          </Button>
          <Button variant="secondary" onClick={onCerrar}>
            Cerrar
          </Button>
        </>
      }
    >
      {error ? (
        <Alert tone="danger" role="alert" title="No se pudo abrir el adjunto">
          <p>{error}</p>
        </Alert>
      ) : url === null ? (
        <p className={styles.nota}>
          <Spinner size={16} /> Abriendo {adjunto.nombre}…
        </p>
      ) : adjunto.mime === 'application/pdf' ? (
        <iframe className={styles.visor} src={url} title={adjunto.nombre} />
      ) : (
        <img className={styles.visorImagen} src={url} alt={adjunto.nombre} />
      )}
    </Dialog>
  )
}
