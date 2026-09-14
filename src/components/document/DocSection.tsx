import { useId, type ReactNode } from 'react'
import { cx } from '@/utils/cx'
import styles from './Document.module.css'

export interface DocSectionProps {
  title?: ReactNode | undefined
  /** Acciones de la sección (p. ej. «Añadir producto»). */
  actions?: ReactNode | undefined
  children: ReactNode
  /** Sin padding interno: para tablas que llegan al borde. */
  flush?: boolean | undefined
  className?: string | undefined
}

/** Sección de un documento: tarjeta con su h2 y, opcionalmente, acciones. */
export function DocSection({ title, actions, children, flush = false, className }: DocSectionProps) {
  const id = useId()
  return (
    <section className={cx(styles.seccion, flush && styles.seccionFlush, className)} aria-labelledby={title ? id : undefined}>
      {(title || actions) && (
        <div className={styles.seccionCabecera}>
          {title && (
            <h2 id={id} className={styles.seccionTitulo}>
              {title}
            </h2>
          )}
          {actions && <div className={styles.seccionAcciones}>{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export interface MetaItem {
  label: string
  value: ReactNode
  /** Ocupa toda la fila (notas, direcciones largas). */
  wide?: boolean | undefined
}

/** Datos de sólo lectura como lista de definiciones: no parecen campos editables. */
export function MetaList({ items, className }: { items: (MetaItem | null | false)[]; className?: string | undefined }) {
  return (
    <dl className={cx(styles.meta, className)}>
      {items.filter((i): i is MetaItem => Boolean(i)).map((i) => (
        <div key={i.label} className={cx(styles.metaItem, i.wide && styles.metaAncho)}>
          <dt className={styles.metaLabel}>{i.label}</dt>
          <dd className={styles.metaValor}>{i.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Un dato que falta se muestra como faltante, no como vacío. */
export function Missing({ children = 'Sin registrar' }: { children?: ReactNode }) {
  return <span className={styles.falta}>{children}</span>
}

export interface TotalRow {
  label: string
  value: ReactNode
  strong?: boolean | undefined
}

/** Bloque de totales: números alineados a la derecha, total final destacado. */
export function Totals({ rows, note, className }: { rows: TotalRow[]; note?: ReactNode; className?: string | undefined }) {
  return (
    <div className={cx(styles.totales, className)}>
      <dl className={styles.totalesLista}>
        {rows.map((r) => (
          <div key={r.label} className={cx(styles.totalFila, r.strong && styles.totalFinal)}>
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
      {note && <p className={styles.totalesNota}>{note}</p>}
    </div>
  )
}
