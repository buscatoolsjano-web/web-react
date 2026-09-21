import { Icon } from '@/components/icons/Icon'
import styles from './Listado.module.css'

export interface MiniaturaProps {
  url: string | null
  alt: string
}

/**
 * La foto del equipo en el listado.
 *
 * El hueco existe **siempre**, tenga foto o no: 329 de los 358 equipos tienen
 * y 29 no, y si la celda desapareciera en esos 29 las filas cambiarían de alto
 * y la columna se movería. Sin foto queda el ícono de herramienta.
 *
 * `alt` vacío a propósito cuando hay imagen: al lado está la referencia y el
 * nombre del equipo, así que el lector de pantalla ya lo dijo. Repetirlo en la
 * imagen sería leerlo dos veces.
 */
export function Miniatura({ url, alt }: MiniaturaProps) {
  return (
    <span className={styles.miniatura} title={alt}>
      {url ? (
        <img src={url} alt="" loading="lazy" className={styles.miniaturaImg} />
      ) : (
        <Icon name="wrench" size={16} className={styles.miniaturaVacia} />
      )}
    </span>
  )
}
