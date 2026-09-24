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
  /**
   * El h1 sigue existiendo pero no se ve (Fase 28 · E5).
   *
   * Para pantallas donde el título no dice nada que no esté a la vista —el
   * alta de un documento, que ya se anuncia en la hoja y en «Crear
   * cotización»— y ese renglón es alto que se le saca al formulario. No se
   * borra: sin h1 la página se queda sin encabezado para quien navega con
   * lector de pantalla o saltando por títulos.
   */
  hideTitle?: boolean | undefined
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
export function PageHeader({ title, hideTitle, subtitle, back, breadcrumbs, status, actions, className }: PageHeaderProps) {
  // Con el título oculto y sin estado ni acciones, la fila no dibuja nada:
  // dejarla puesta sería un renglón vacío, que es justo lo que se quería sacar.
  const filaVacia = hideTitle && !status && !subtitle && !actions

  return (
    <header className={cx(styles.header, hideTitle && styles.sinTitulo, className)}>
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
      {filaVacia ? (
        <h1 className="sr-only">{title}</h1>
      ) : (
        <div className={styles.fila}>
          <div className={styles.titulos}>
            <div className={styles.tituloLinea}>
              <h1 className={hideTitle ? 'sr-only' : styles.titulo}>{title}</h1>
              {status}
            </div>
            {subtitle && <p className={styles.subtitulo}>{subtitle}</p>}
          </div>
          {actions && <div className={styles.acciones}>{actions}</div>}
        </div>
      )}
    </header>
  )
}
