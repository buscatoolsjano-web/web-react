import { Link } from 'react-router-dom'
import { Icon, type IconName } from '@/components/icons/Icon'
import styles from './Panel.module.css'

/** Un renglón: el número adelante y el sustantivo que le corresponde. */
export interface Linea {
  clave: string
  icono: IconName
  n: number
  singular: string
  plural: string
  destino?: string | undefined
}

/**
 * La lista de «lo que hay», que es la forma en que el tablero cuenta trabajo
 * (Fase 64, compartida en la 74).
 *
 * «4 correos sin responder» y no una celda con un 4 bajo un encabezado:
 * el renglón se lee solo, fuera de contexto, y no obliga a mirar arriba para
 * saber de qué habla.
 *
 * VIVE EN SU PROPIO ARCHIVO desde que la usan los dos bloques del tablero —el
 * mío y el del resto—. Que se vean igual no es una coincidencia que haya que
 * mantener a mano: es el mismo componente.
 *
 * Los ceros NO se listan: un cero no es trabajo pendiente, es ruido. Cuando no
 * queda ninguno se dice con una frase, que es lo que `vacio` trae.
 */
export function Lineas({ lineas, vacio }: { lineas: Linea[]; vacio: string }) {
  const hay = lineas.some((l) => l.n > 0)
  if (!hay) return <p className={styles.miVacio}>{vacio}</p>

  return (
    <ul className={styles.miLista}>
      {lineas
        .filter((l) => l.n > 0)
        .map((l) => {
          const palabra = l.n === 1 ? l.singular : l.plural
          return (
            <li key={l.clave} className={styles.miLinea}>
              {/* Decorativo —`Icon` ya es `aria-hidden`—: la línea se lee
                  «4 correos enviados» sin él. */}
              <Icon name={l.icono} size={16} />
              {l.destino ? (
                <Link to={l.destino} className={styles.miDato}>
                  <strong className={styles.miNumero}>{l.n}</strong> {palabra}
                </Link>
              ) : (
                <span className={styles.miDato}>
                  <strong className={styles.miNumero}>{l.n}</strong> {palabra}
                </span>
              )}
            </li>
          )
        })}
    </ul>
  )
}
