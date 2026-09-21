import styles from './EsqueletoFicha.module.css'

export interface EsqueletoFichaProps {
  tituloId?: string | undefined
}

/**
 * El esqueleto de la ficha rápida, **con la misma geometría que la ficha**.
 *
 * No es decoración: el panel se abre al hacer click en una fila y los datos
 * tardan lo que tarda la consulta. Con un spinner centrado, cuando llegan los
 * datos salta todo de lugar; con las cajas en su sitio, lo único que cambia
 * es que se llenan. Eso es lo que hace que se sienta rápido, más allá de los
 * milisegundos que tarde.
 *
 * Cambiar de cliente rápido NO muestra los números del anterior: la clave del
 * caché incluye el id, así que acá se ve esto y no el importe de otro (ver
 * `useCliente360`).
 */
export function EsqueletoFicha({ tituloId }: EsqueletoFichaProps) {
  return (
    <div
      className={styles.ficha}
      aria-busy="true"
      aria-live="polite"
      aria-label="Cargando la ficha del cliente…"
    >
      {/* El panel usa este id en su `aria-labelledby`: mientras carga, el
          cajón tiene que tener nombre igual. */}
      <span className="sr-only" id={tituloId}>
        Cargando la ficha del cliente…
      </span>

      <div className={styles.cabecera}>
        <span className={`${styles.hueso} ${styles.avatar}`} />
        <div className={styles.identidad}>
          <span className={`${styles.hueso} ${styles.nombre}`} />
          <span className={`${styles.hueso} ${styles.meta}`} />
        </div>
      </div>

      <div className={styles.contacto}>
        <span className={`${styles.hueso} ${styles.linea}`} />
        <span className={`${styles.hueso} ${styles.linea}`} />
        <span className={`${styles.hueso} ${styles.linea}`} />
      </div>

      <div className={styles.kpi}>
        <span className={`${styles.hueso} ${styles.kpiTitulo}`} />
        <span className={`${styles.hueso} ${styles.kpiImporte}`} />
        <span className={`${styles.hueso} ${styles.kpiVariacion}`} />
      </div>

      <div className={styles.tarjetas}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`${styles.hueso} ${styles.tarjeta}`} />
        ))}
      </div>

      <span className={`${styles.hueso} ${styles.grafico}`} />

      <div className={styles.historico}>
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className={`${styles.hueso} ${styles.fila}`} />
        ))}
      </div>
    </div>
  )
}
