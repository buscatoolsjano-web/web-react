import { NavLink, useLocation } from 'react-router-dom'
import { cx } from '@/utils/cx'
import { Icon } from '@/components/icons/Icon'
import { entradaActiva, type GrupoNav } from './navegacion'
import styles from './Shell.module.css'

export interface BarraCompactaProps {
  grupos: GrupoNav[]
  /** Abre el panel completo; con `id`, desplegando ese módulo. */
  onExpandir: (id: string | null) => void
  expandida: boolean
}

/**
 * Barra de 64px para 768–1023px: sólo íconos. Las hojas navegan directo; los
 * módulos con subsecciones abren el panel completo con ese módulo desplegado.
 * Cada control tiene nombre accesible (texto oculto) y `title` como tooltip.
 */
export function BarraCompacta({ grupos, onExpandir, expandida }: BarraCompactaProps) {
  const { pathname } = useLocation()
  return (
    <nav className={styles.compacta} aria-label="Principal">
      <button type="button" className={styles.compactaItem} onClick={() => onExpandir(null)} aria-expanded={expandida} title="Expandir menú">
        <Icon name="menu" />
        <span className="sr-only">Expandir menú</span>
      </button>
      <ul className={styles.compactaLista}>
        {grupos.flatMap((g, i) => [
          ...(i > 0 ? [<li key={`sep-${g.id}`} className={styles.compactaSeparador} aria-hidden="true" />] : []),
          ...g.entradas.map((e) => (
            <li key={e.id}>
              {e.proximamente ? (
                <span className={cx(styles.compactaItem, styles.itemProximamente)} aria-disabled="true" title={`${e.label} (próximamente)`}>
                  <Icon name={e.icon} />
                  <span className="sr-only">{e.label} (próximamente)</span>
                </span>
              ) : e.destino ? (
                <NavLink to={e.destino.to} end={e.destino.end ?? false} className={({ isActive }) => cx(styles.compactaItem, isActive && styles.compactaActivo)} title={e.label}>
                  <Icon name={e.icon} />
                  <span className="sr-only">{e.label}</span>
                </NavLink>
              ) : (
                <button
                  type="button"
                  className={cx(styles.compactaItem, entradaActiva(e, pathname) && styles.compactaActivo)}
                  onClick={() => onExpandir(e.id)}
                  aria-haspopup="true"
                  title={e.label}
                  aria-current={entradaActiva(e, pathname) ? 'page' : undefined}
                >
                  <Icon name={e.icon} />
                  <span className="sr-only">{e.label}</span>
                </button>
              )}
            </li>
          )),
        ])}
      </ul>
    </nav>
  )
}
