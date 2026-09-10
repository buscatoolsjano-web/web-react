import { etiquetaDeAccion, formatearFechaHora } from '../lib/formato'
import type { EventoDeProveedor } from '../types'
import styles from './PanelHistorial.module.css'

export interface PanelHistorialProps {
  eventos: readonly EventoDeProveedor[]
  cargando: boolean
  /** `true` si el proveedor vino de la migración del maestro legacy. */
  esHistorico: boolean
}

/**
 * El historial del proveedor: lo que dice `purchases_audit`.
 *
 * Los 142 proveedores migrados no tienen eventos, y no se les inventó uno de
 * alta: el script de migración escribió las filas con la clave de servicio,
 * sin un usuario detrás. Un «Alta — sistema — 10/09/2026» sería falso en la
 * parte que importa, que es quién y cuándo lo dio de alta de verdad. La fecha
 * real está en la ficha, como «Alta».
 */
export function PanelHistorial({ eventos, cargando, esHistorico }: PanelHistorialProps) {
  if (cargando) return <p className={styles.nota}>Cargando historial…</p>

  if (eventos.length === 0) {
    return (
      <p className={styles.nota}>
        {esHistorico
          ? 'Sin movimientos registrados. Este proveedor vino del sistema anterior: la migración no dejó eventos de auditoría porque no hubo una persona que lo diera de alta acá. A partir de la primera edición, todo queda registrado.'
          : 'Sin movimientos registrados todavía.'}
      </p>
    )
  }

  return (
    <ol className={styles.linea}>
      {eventos.map((e) => (
        <li key={e.id} className={styles.evento}>
          <span className={styles.accion}>{etiquetaDeAccion(e.accion)}</span>
          {e.estadoAnterior || e.estadoNuevo ? (
            <span className={styles.estados}>
              {e.estadoAnterior ?? '—'} → {e.estadoNuevo ?? '—'}
            </span>
          ) : null}
          <span className={styles.meta}>
            {formatearFechaHora(e.fecha)}
            {e.autor ? ` · ${e.autor}` : ''}
          </span>
        </li>
      ))}
    </ol>
  )
}
