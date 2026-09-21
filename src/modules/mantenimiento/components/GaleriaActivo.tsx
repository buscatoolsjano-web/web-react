import { EmptyState } from '@/components/feedback/EmptyState'
import styles from './GaleriaActivo.module.css'

export interface GaleriaActivoProps {
  imagenes: { id: string; url: string }[]
}

/**
 * Las fotos del equipo.
 *
 * Son las que sacó el taller: el equipo como llegó, la chapa con el número de
 * serie, el detalle de lo que estaba roto. Por eso se ven grandes y se abren
 * en pestaña nueva a tamaño completo —en una miniatura no se lee un serial
 * grabado.
 *
 * Hoy viven en el servidor del sistema anterior y se muestran desde ahí; la
 * copia a nuestro almacenamiento está prevista y no cambia esta pantalla.
 */
export function GaleriaActivo({ imagenes }: GaleriaActivoProps) {
  if (imagenes.length === 0) {
    return (
      <EmptyState
        compact
        headingLevel={3}
        icon="image"
        title="Sin imágenes"
        description="Este equipo no tiene fotos cargadas."
      />
    )
  }

  return (
    <ul className={styles.galeria}>
      {imagenes.map((img, i) => (
        <li key={img.id}>
          <a href={img.url} target="_blank" rel="noreferrer" className={styles.enlace}>
            <img src={img.url} alt={`Foto ${i + 1} del equipo`} loading="lazy" className={styles.foto} />
          </a>
        </li>
      ))}
    </ul>
  )
}
