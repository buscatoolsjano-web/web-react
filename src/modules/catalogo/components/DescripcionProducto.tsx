import { partirDescripcion } from '../lib/descripcion'
import styles from './DescripcionProducto.module.css'

/**
 * La descripción, con su link de catálogo si lo trae.
 *
 * El legacy mostraba el texto como párrafo y el link aparte, como botón con
 * «📄» delante (app.js:16511). Acá es lo mismo. El texto y la etiqueta salen
 * como hijos de JSX, así que React los escapa: no hay
 * `dangerouslySetInnerHTML` en ninguna parte, y no hace falta confiar en que
 * el dato esté limpio.
 */
export function DescripcionProducto({
  descripcion,
  className,
}: {
  descripcion: string | null | undefined
  className?: string | undefined
}) {
  const { texto, enlace } = partirDescripcion(descripcion)
  if (!texto && !enlace) return null

  return (
    <div className={className ? `${styles.caja} ${className}` : styles.caja}>
      {texto ? <p className={styles.texto}>{texto}</p> : null}
      {enlace ? (
        <a className={styles.enlace} href={enlace.url} target="_blank" rel="noopener noreferrer">
          <span aria-hidden="true">📄</span>
          {enlace.etiqueta}
        </a>
      ) : null}
    </div>
  )
}
