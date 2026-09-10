import { formatearFecha } from '../lib/formato'
import type { RelacionadosCliente } from '../types'
import styles from './PanelRelacionados.module.css'

export interface PanelRelacionadosProps {
  datos: RelacionadosCliente | undefined
  cargando: boolean
}

/**
 * Los candidatos de orden de compra que detectó la migración leyendo los
 * documentos. Ninguna OC se crea sola a partir de ellos.
 *
 * Las direcciones y los alias de producto salían de acá y hoy tienen cada uno
 * su pestaña, porque se editan.
 */
export function PanelRelacionados({ datos, cargando }: PanelRelacionadosProps) {
  if (cargando) return <p className={styles.nota}>Cargando…</p>
  if (!datos) return null

  if (datos.candidatosDeOc.length === 0) {
    return (
      <p className={styles.nota}>
        Este cliente no tiene candidatos de orden de compra detectados.
      </p>
    )
  }

  return (
    <div className={styles.wrap}>
      <section className={styles.seccion}>
        <h3 className={styles.h3}>
          Candidatos de orden de compra ({datos.candidatosDeOc.length})
        </h3>
        {datos.candidatosDeOc.length === 0 ? (
          <p className={styles.nota}>Sin candidatos detectados.</p>
        ) : (
          <ul className={styles.lista}>
            {datos.candidatosDeOc.map((c) => (
              <li key={c.id}>
                <span className={styles.etiqueta}>{c.archivo ?? '—'}</span>
                <span>
                  {c.estado ?? 'sin estado'} · {formatearFecha(c.detectadoEn)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
