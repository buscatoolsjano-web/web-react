import { useEffect, useState } from 'react'
import { Alert } from '@/components/feedback/Alert'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/modals/Dialog'
import { Icon } from '@/components/icons/Icon'
import { Spinner } from '@/components/ui/Spinner'
import { urlDeDescarga, type Adjunto } from '../services/adjuntos'
import styles from './PanelAdjuntos.module.css'

export interface VisorAdjuntoDocumentoProps {
  adjunto: Adjunto
  onCerrar: () => void
}

/**
 * Mirar un adjunto sin salir del documento (Fase 84).
 *
 * «Cuando se sube un adjunto quiero que se vea ahí la vista previa; si tocás,
 * que se abra desde ahí, no que se abra una pestaña nueva.»
 *
 * Abrir en otra pestaña obligaba a volver, y en el camino se pierde dónde
 * estabas: la OC del cliente se mira CONTRA la cotización, no en lugar de
 * ella. Acá el PDF queda al lado de lo que se está revisando.
 *
 * El archivo se pide igual que antes: una URL firmada de vida corta, que el
 * bucket es privado. La diferencia es dónde se la pone —un `iframe` del
 * diálogo en vez de una pestaña— y que se pide AL ABRIR el visor, no para los
 * cincuenta archivos de la lista que nadie va a mirar.
 *
 * Un PDF va en el visor del navegador, que es el que la persona ya sabe usar,
 * con su búsqueda y su impresión; una imagen, como imagen. Lo que el
 * navegador no sabe mostrar —una planilla, un .docx— no se ofrece acá: un
 * `iframe` con eso adentro no muestra nada o, peor, se lo baja solo. Para
 * esos queda el botón de descargar, que es lo que realmente hace falta.
 */
export function VisorAdjuntoDocumento({ adjunto, onCerrar }: VisorAdjuntoDocumentoProps) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    urlDeDescarga(adjunto.ruta)
      .then((u) => {
        if (vivo) setUrl(u)
      })
      .catch((e: unknown) => {
        if (vivo) setError(e instanceof Error ? e.message : 'No se pudo abrir el archivo.')
      })
    return () => {
      vivo = false
    }
  }, [adjunto.ruta])

  const esPdf = adjunto.tipoMime === 'application/pdf'

  return (
    <Dialog
      open
      onClose={onCerrar}
      title={adjunto.nombre}
      size="xl"
      footer={
        <>
          {/* Descargar sigue estando: la URL firmada dura cinco minutos y hay
              archivos que se necesitan en el disco, no en la pantalla. */}
          <Button
            variant="secondary"
            icon={<Icon name="download" size={16} />}
            disabled={url === null}
            onClick={() => url && window.open(url, '_blank', 'noopener,noreferrer')}
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
      ) : esPdf ? (
        <iframe className={styles.visor} src={url} title={adjunto.nombre} />
      ) : (
        <img className={styles.visorImagen} src={url} alt={adjunto.nombre} />
      )}
    </Dialog>
  )
}
