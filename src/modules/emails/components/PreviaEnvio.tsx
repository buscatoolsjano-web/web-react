import { useEffect, useState } from 'react'
import { Icon } from '@/components/icons/Icon'
import { previsualizarEnvio } from '../services/redactar'
import styles from './Composer.module.css'

/**
 * Cómo va a salir el mail, mientras se escribe (Fase 41 · E3).
 *
 * El HTML lo arma el SERVICIO, con el mismo código que el envío. Rearmarlo acá
 * sería más rápido y sería otra implementación: coincidirían hasta el día que
 * alguien toque una sola, y ese día la previa miente.
 *
 * Se pliega, y arranca plegada: la mayoría de los mails se escriben sin mirar
 * el membrete, y una previa siempre abierta empuja el botón de enviar fuera de
 * la pantalla. Mientras está plegada no se pide nada.
 */
export function PreviaEnvio({ accountId, texto }: { accountId: string; texto: string }) {
  const [abierta, setAbierta] = useState(false)
  const [html, setHtml] = useState('')
  const [frenado, setFrenado] = useState(texto)

  // Sin freno, cada tecla sería un viaje; desde acá cada viaje cuesta ~220 ms.
  useEffect(() => {
    const reloj = setTimeout(() => setFrenado(texto), 500)
    return () => clearTimeout(reloj)
  }, [texto])

  useEffect(() => {
    if (!abierta) return
    let vivo = true
    void previsualizarEnvio(accountId, frenado)
      .then((h) => vivo && setHtml(h))
      .catch(() => vivo && setHtml(''))
    return () => {
      vivo = false
    }
  }, [abierta, accountId, frenado])

  return (
    <div className={styles.campo}>
      <button type="button" className={styles.previaBoton} onClick={() => setAbierta((a) => !a)} aria-expanded={abierta}>
        <Icon name={abierta ? 'chevron-down' : 'chevron-right'} size={16} />
        Ver cómo sale
      </button>
      {abierta && (
        /*
         * En un iframe sin permisos. El marco lo escribe un admin y el servidor
         * escapa lo que interpola, pero esto termina en un mail y un mail no
         * ejecuta nada: la previa no tiene por qué poder más que el destino.
         */
        <iframe className={styles.previaMarco} title="Cómo va a salir el mail" sandbox="" srcDoc={html} />
      )}
    </div>
  )
}
