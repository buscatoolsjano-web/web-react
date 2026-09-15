import { DocSection } from '@/components/document/DocSection'
import { EmptyState } from '@/components/feedback/EmptyState'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Icon } from '@/components/icons/Icon'
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
  if (cargando) return <SkeletonRows rows={2} columns={2} label="Cargando…" />
  if (!datos) return null

  if (datos.candidatosDeOc.length === 0) {
    return (
      <EmptyState
        compact
        headingLevel={3}
        icon="inbox"
        title="Sin candidatos de orden de compra"
        description="La migración no detectó órdenes de compra de este cliente en sus documentos."
      />
    )
  }

  return (
    <DocSection title={`Candidatos de orden de compra (${datos.candidatosDeOc.length})`}>
      <ul className={styles.lista}>
        {datos.candidatosDeOc.map((c) => (
          <li key={c.id}>
            <Icon name="paperclip" size={16} className={styles.icono} />
            <span className={styles.etiqueta}>{c.archivo ?? '—'}</span>
            <span className={styles.meta}>
              {c.estado ?? 'Sin estado'} · {formatearFecha(c.detectadoEn)}
            </span>
          </li>
        ))}
      </ul>
    </DocSection>
  )
}
