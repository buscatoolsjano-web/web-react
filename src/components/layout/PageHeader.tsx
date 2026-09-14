import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cx } from '@/utils/cx'
import { Icon } from '@/components/icons/Icon'
import styles from './PageHeader.module.css'

export interface Miga {
  label: string
  /** Sin `to`: es la página actual. */
  to?: string | undefined
}

export interface PageHeaderProps {
  /** Único h1 de la página. */
  title: ReactNode
  subtitle?: ReactNode | undefined
  /** Enlace de vuelta («← Pedidos»). Excluyente con `breadcrumbs`. */
  back?: { to: string; label: string } | undefined
  breadcrumbs?: Miga[] | undefined
  /** Estado junto al título (p. ej. un `Badge`). */
  status?: ReactNode | undefined
  /** Acciones: como máximo una primaria y dos secundarias visibles. */
  actions?: ReactNode | undefined
  className?: string | undefined
}

/**
 * Encabezado de página del sistema: contexto (volver o migas), título, estado,
 * subtítulo y acciones. En mobile las acciones bajan debajo del título.
 */
export function PageHeader({ title, subtitle, back, breadcrumbs, status, actions, className }: PageHeaderProps) {
  return (
    <header className={cx(styles.header, className)}>
      {back ? (
        <Link to={back.to} className={styles.volver}>
          <Icon name="arrow-left" size={16} />
          {back.label}
        </Link>
      ) : (
        breadcrumbs &&
        breadcrumbs.length > 0 && (
          <nav aria-label="Ruta" className={styles.migas}>
            <ol>
              {breadcrumbs.map((m, i) => (
                <li key={`${m.label}-${i}`}>
                  {i > 0 && <Icon name="chevron-right" size={16} className={styles.separador} />}
                  {m.to ? (
                    <Link to={m.to}>{m.label}</Link>
                  ) : (
                    <span aria-current="page">{m.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        )
      )}
      <div className={styles.fila}>
        <div className={styles.titulos}>
          <div className={styles.tituloLinea}>
            <h1 className={styles.titulo}>{title}</h1>
            {status}
          </div>
          {subtitle && <p className={styles.subtitulo}>{subtitle}</p>}
        </div>
        {actions && <div className={styles.acciones}>{actions}</div>}
      </div>
    </header>
  )
}
