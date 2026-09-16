import type { ReactNode } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import styles from './Document.module.css'

export interface DocumentHeaderProps {
  /** Enlace de vuelta al listado del tipo («← Cotizaciones»). */
  back: { to: string; label: string }
  /** El número del documento. Es el h1 de la página. */
  numero: ReactNode
  /** Chips de estado. Un documento puede tener más de uno (pedido: comercial + cumplimiento). */
  estados?: ReactNode | undefined
  /** De dónde salió el documento. Va en tono bajo: es contexto, no una alerta. */
  origen?: ReactNode | undefined
  /** Señal efímera junto al estado («Guardando…»). */
  aviso?: ReactNode | undefined
  cliente?: ReactNode | undefined
  fecha?: ReactNode | undefined
  /** El título comercial, en su propio renglón: suele ser largo. */
  titulo?: ReactNode | undefined
  /** Importe ya formateado con su moneda. */
  total?: ReactNode | undefined
  totalLabel?: string | undefined
}

/**
 * Identidad de un documento: qué es, de quién, cuándo, en qué estado y por
 * cuánto. Nada más.
 *
 * Es la primera de las tres piezas fijas del documento (identidad, acciones,
 * pestañas) y sirve igual para cotización, pedido y remito: lo que cambia es
 * qué se le pasa, no su forma.
 *
 * Se apoya en `PageHeader` en vez de repetir su marcado: así el enlace de
 * vuelta, el único h1 y el comportamiento en mobile son los mismos que en el
 * resto del sistema.
 */
export function DocumentHeader({
  back,
  numero,
  estados,
  origen,
  aviso,
  cliente,
  fecha,
  titulo,
  total,
  totalLabel = 'Total',
}: DocumentHeaderProps) {
  // Cliente y fecha son la misma línea; el título va abajo para que un
  // «2026 09 16 VENTA MERCADO LIBRE VARIOS» no empuje al cliente fuera de vista.
  const identidad = [cliente, fecha].filter(Boolean)

  return (
    <PageHeader
      back={back}
      title={numero}
      status={
        estados || origen || aviso ? (
          <>
            {estados}
            {origen}
            {aviso}
          </>
        ) : undefined
      }
      subtitle={
        identidad.length > 0 || titulo ? (
          <>
            {identidad.length > 0 ? (
              <span className={styles.identidad}>
                {identidad.map((parte, i) => (
                  <span key={i}>
                    {i > 0 ? <span aria-hidden="true"> · </span> : null}
                    {parte}
                  </span>
                ))}
              </span>
            ) : null}
            {titulo ? <span className={styles.tituloDoc}>{titulo}</span> : null}
          </>
        ) : undefined
      }
      actions={
        total !== undefined && total !== null ? (
          <div className={styles.importe}>
            <span className={styles.importeValor}>{total}</span>
            <span className={styles.importeLabel}>{totalLabel}</span>
          </div>
        ) : undefined
      }
    />
  )
}
