import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SANDBOX_IFRAME, cidsReferenciados, construirSrcdoc, prepararHtml } from '../lib/htmlSeguro'
import { imagenInline } from '../services/contenido'
import type { HiloIndice, MensajeContenido } from '../types'
import styles from './Emails.module.css'

export interface CuerpoSeguroProps {
  hilo: HiloIndice
  mensaje: MensajeContenido
}

/** Como mucho diez imágenes inline por mensaje: cada una es una llamada a Gmail. */
const MAX_INLINE = 10

/**
 * El cuerpo de un mensaje. Ver `lib/htmlSeguro.ts` para las tres capas.
 *
 * Las imágenes inline (`cid:`) son parte del mensaje, no seguimiento: se piden
 * al backend y se muestran. Las remotas quedan bloqueadas hasta que la persona
 * las pida, para este mensaje.
 */
export function CuerpoSeguro({ hilo, mensaje }: CuerpoSeguroProps) {
  const [remotas, setRemotas] = useState(false)

  const inlineNecesarias = useMemo(() => {
    if (!mensaje.html) return []
    const cids = new Set(cidsReferenciados(mensaje.html))
    return mensaje.adjuntos.filter((a) => a.contentId && cids.has(a.contentId)).slice(0, MAX_INLINE)
  }, [mensaje])

  const inline = useQuery({
    queryKey: ['emails-inline', hilo.accountId, hilo.gmailThreadId, mensaje.id],
    queryFn: async ({ signal }) => {
      const mapa = new Map<string, string>()
      for (const a of inlineNecesarias) {
        const dato = await imagenInline(hilo.accountId, hilo.gmailThreadId, mensaje.id, a.partId, a.mime, signal).catch(
          () => null,
        )
        if (dato && a.contentId) mapa.set(a.contentId, dato)
      }
      return mapa
    },
    enabled: inlineNecesarias.length > 0,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  })

  const preparado = useMemo(
    () => (mensaje.html ? prepararHtml(mensaje.html, { remotas, ...(inline.data ? { inline: inline.data } : {}) }) : null),
    [mensaje.html, remotas, inline.data],
  )

  if (!preparado) {
    return mensaje.texto ? (
      <pre className={styles.texto}>{mensaje.texto}</pre>
    ) : (
      <p className={styles.nota}>Este mensaje no tiene cuerpo de texto.</p>
    )
  }

  return (
    <>
      {preparado.hayRemotas && !remotas ? (
        <div className={styles.aviso} role="note">
          <span>
            Este mensaje tiene imágenes remotas. Están bloqueadas para que el remitente no sepa que lo abriste.
          </span>
          <button type="button" className={styles.boton} onClick={() => setRemotas(true)}>
            Cargar imágenes remotas
          </button>
        </div>
      ) : null}
      {mensaje.truncado ? (
        <p className={styles.nota}>El mensaje es muy largo y se muestra recortado.</p>
      ) : null}
      <iframe
        // El key fuerza un iframe nuevo al permitir remotas: la CSP de un
        // documento no se afloja una vez cargado.
        key={remotas ? 'con-remotas' : 'sin-remotas'}
        className={styles.iframe}
        title={`Cuerpo del mensaje: ${mensaje.asunto || 'sin asunto'}`}
        sandbox={SANDBOX_IFRAME}
        referrerPolicy="no-referrer"
        srcDoc={construirSrcdoc(preparado.html, remotas)}
      />
    </>
  )
}
