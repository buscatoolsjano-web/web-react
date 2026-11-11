import type { ReactNode } from 'react'
import styles from './Pendientes.module.css'
import { fmt, type Tono } from './util'

/** Las piezas visuales de las dos pantallas de pendientes (Fase 238). */

export function Chips<T extends string | number | null>({
  etiqueta,
  opciones,
  valor,
  onCambiar,
}: {
  etiqueta: string
  opciones: readonly { valor: T; texto: string }[]
  valor: T
  onCambiar: (v: T) => void
}) {
  return (
    <div className={styles.grupoChips} role="group" aria-label={etiqueta}>
      {opciones.map((o) => (
        <button
          key={String(o.valor)}
          type="button"
          className={styles.chip}
          aria-pressed={o.valor === valor}
          onClick={() => onCambiar(o.valor)}
        >
          {o.texto}
        </button>
      ))}
    </div>
  )
}

/** Una tarjeta de total. Si tiene `onClick`, filtra la lista (y se marca). */
export function Kpi({
  tono,
  valor,
  texto,
  activo,
  onClick,
}: {
  tono: Tono
  valor: ReactNode
  texto: string
  activo?: boolean
  onClick?: () => void
}) {
  const cuerpo = (
    <>
      <span className={styles.kpiValor}>{valor}</span>
      <span className={styles.kpiTexto}>{texto}</span>
    </>
  )
  return onClick ? (
    <button type="button" className={`${styles.kpi} ${styles[tono]}`} aria-pressed={activo ?? false} onClick={onClick}>
      {cuerpo}
    </button>
  ) : (
    <div className={`${styles.kpi} ${styles[tono]}`}>{cuerpo}</div>
  )
}

export function Leyenda({ items }: { items: readonly { tono: Tono; texto: string }[] }) {
  return (
    <ul className={styles.leyenda} aria-label="Referencias de colores">
      {items.map((i) => (
        <li key={i.texto} className={styles[i.tono]}>
          <span className={styles.punto} aria-hidden="true" />
          {i.texto}
        </li>
      ))}
    </ul>
  )
}

/** La barra apilada: cada tramo del ancho de su parte sobre el total. */
export function Barra({ tramos, total }: { tramos: readonly { tono: Tono; valor: number; texto: string }[]; total: number }) {
  const t = total > 0 ? total : 1
  return (
    <div className={styles.barra} role="img" aria-label={tramos.filter((x) => x.valor > 0).map((x) => `${x.texto}: ${fmt(x.valor)}`).join(', ')}>
      {tramos
        .filter((x) => x.valor > 0)
        .map((x) => (
          <span key={x.texto} className={`${styles.tramo} ${styles[x.tono]}`} style={{ width: `${(x.valor / t) * 100}%` }} />
        ))}
    </div>
  )
}

export function Estado({ tono, children }: { tono: Tono; children: ReactNode }) {
  return <span className={`${styles.estado} ${styles[tono]}`}>{children}</span>
}

