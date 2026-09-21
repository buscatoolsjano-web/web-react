import styles from './EsqueletoProducto.module.css'

/**
 * El esqueleto del modal, con la geometría del contenido real: foto cuadrada
 * a la izquierda, identidad y ficha a la derecha, y las secciones abajo.
 * Cuando llegan los datos no salta nada de lugar.
 */
export function EsqueletoProducto() {
  return (
    <div className={styles.wrap} aria-busy="true" aria-label="Cargando el producto…">
      <div className={styles.identidad}>
        <span className={`${styles.hueso} ${styles.foto}`} />
        <div className={styles.datos}>
          <span className={`${styles.hueso} ${styles.titulo}`} />
          <span className={`${styles.hueso} ${styles.linea}`} />
          <div className={styles.ficha}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <span key={i} className={`${styles.hueso} ${styles.campo}`} />
            ))}
          </div>
          <span className={`${styles.hueso} ${styles.precio}`} />
        </div>
      </div>
      {[0, 1].map((i) => (
        <span key={i} className={`${styles.hueso} ${styles.seccion}`} />
      ))}
    </div>
  )
}
