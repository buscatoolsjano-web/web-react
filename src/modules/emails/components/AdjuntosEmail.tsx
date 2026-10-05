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
   * Mandar un adjunto al importador de órdenes de compra (Fase 40).
   *
   * Recibe el `File` YA ARMADO, no el adjunto: así los dos caminos que llevan
   * al importador —el botón de la fila y el del visor— le entregan lo mismo, y
   * el que ya tiene los bytes en pantalla no vuelve a pedirlos.
   *
   * Quién abre el modal es la PÁGINA: es de Ventas, pesa, y se carga con
   * `lazy`. Sin la función no hay botón, así que el permiso lo decide quien
   * conoce el rol.
   */
  onImportarOc?: ((archivo: File) => void) | undefined
}

/**
 * Los adjuntos: metadata siempre, bytes sólo al pedirlos.
 *
 * Nada se baja por adelantado, nada se copia a Storage, y el navegador nunca
 * recibe una URL de Gmail: el botón pide los bytes al servicio de Cloud Run,
 * que valida cuenta, hilo, mensaje y parte antes de ir a buscarlos.
 */
export function AdjuntosEmail({ hilo, mensaje, onImportarOc }: AdjuntosEmailProps) {
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
}: {
  hilo: HiloIndice
  mensajeId: string
  adjunto: AdjuntoContenido
  onImportarOc?: ((archivo: File) => void) | undefined
}) {
  const [viendo, setViendo] = useState(false)
  const bajar = useMutation({
    mutationFn: () => traerAdjunto(hilo.accountId, hilo.gmailThreadId, mensajeId, adjunto.partId),
    onSuccess: (blob) => guardarEnDisco(blob, adjunto.nombre),
  })

  /*
   * El atajo de la fila: para quien ya sabe que ese PDF es una OC y no
   * necesita mirarlo. Baja los bytes y arma el `File` acá mismo.
   *
   * `File` y no `Blob`: la función de edge valida `archivo instanceof File` y
   * mira el nombre. El tipo se fuerza porque Gmail a veces devuelve
   * `application/octet-stream` para un PDF válido, y la función igual
   * comprueba la firma de los bytes antes de leerlo.
   */
  const importar = useMutation({
    mutationFn: () => traerAdjunto(hilo.accountId, hilo.gmailThreadId, mensajeId, adjunto.partId),
    onSuccess: (blob) =>
      onImportarOc?.(new File([blob], adjunto.nombre, { type: 'application/pdf' })),
  })

  const fallo = bajar.error ?? importar.error
  const error = fallo
    ? mensajeDeError(fallo instanceof ErrorContenido ? fallo.codigo : 'desconocido')
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
          onClick={() => importar.mutate()}
          loading={importar.isPending}
          aria-label={`Importar ${adjunto.nombre} como orden de compra`}
        >
          {importar.isPending ? 'Abriendo…' : 'Importar OC'}
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
        <VisorAdjunto
          hilo={hilo}
          mensajeId={mensajeId}
          adjunto={adjunto}
          /* Desde el visor, importar también CIERRA el visor: el importador se
             abre con el mismo PDF a la vista, y dos ventanas apiladas mostrando
             el mismo documento confunden más de lo que ayudan. */
          onImportarOc={
            onImportarOc
              ? (archivo) => {
                  setViendo(false)
                  onImportarOc(archivo)
                }
              : undefined
          }
          onCerrar={() => setViendo(false)}
        />
      ) : null}
    </li>
  )
}
