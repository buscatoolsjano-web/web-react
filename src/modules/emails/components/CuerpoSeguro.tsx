import { useMemo } from 'react'
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
 * Las imágenes inline (`cid:`) viajan dentro del mensaje: hay que pedírselas a
 * Gmail una por una. Las remotas las carga el navegador solo, desde la Fase 59
 * y a pedido —ver la nota de `lib/htmlSeguro.ts` sobre por qué es una decisión
 * de privacidad y no de seguridad—.
 */
export function CuerpoSeguro({ hilo, mensaje }: CuerpoSeguroProps) {
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
    () => (mensaje.html ? prepararHtml(mensaje.html, inline.data ? { inline: inline.data } : {}) : null),
    [mensaje.html, inline.data],
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
      {mensaje.truncado ? (
        <p className={styles.nota}>El mensaje es muy largo y se muestra recortado.</p>
      ) : null}
      <iframe
        className={styles.iframe}
        title={`Cuerpo del mensaje: ${mensaje.asunto || 'sin asunto'}`}
        sandbox={SANDBOX_IFRAME}
        referrerPolicy="no-referrer"
        srcDoc={construirSrcdoc(preparado.html)}
      />
    </>
  )
}
