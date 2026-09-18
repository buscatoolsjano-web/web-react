import { useState } from 'react'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { Button } from '@/components/ui/Button'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { useTrazabilidad } from '../hooks/useClientes'
import { presentarEvento } from '../lib/trazabilidad'
import { formatearMomento } from '../lib/formato'
import styles from './PanelTrazabilidad.module.css'

export interface PanelTrazabilidadProps {
  clienteId: string
}

const POR_PAGINA = 25

/**
 * Qué le pasó a este cliente (Fase 17 · E4).
 *
 * Lee `sales_audit`, la misma tabla que la trazabilidad de Ventas. Los eventos
 * los venían escribiendo E1 —alta, edición, baja, reactivación— y E3
 * —contactos y direcciones—; E4 sumó los adjuntos. **No se inventó ninguno**, y
 * tampoco se audita leer: un registro de quién miró qué sería vigilancia, y
 * además taparía los cambios, que es lo que hay que poder ver.
 *
 * La diferencia con «Actividad», que está arriba en la ficha: aquello es el
 * negocio —cuántas cotizaciones, cuánto se pidió, cuándo fue lo último—; esto
 * es quién tocó la ficha y qué cambió.
 */
export function PanelTrazabilidad({ clienteId }: PanelTrazabilidadProps) {
  const [pagina, setPagina] = useState(1)
  const consulta = useTrazabilidad(clienteId, {
    pagina,
    porPagina: POR_PAGINA,
    habilitado: true,
  })

  if (consulta.isPending) {
    return <SkeletonRows rows={4} columns={2} label="Cargando la trazabilidad…" />
  }

  if (consulta.error) {
    return (
      <Alert tone="danger" role="alert" title="No se pudo leer la trazabilidad">
        <p>{consulta.error.message}</p>
      </Alert>
    )
  }

  const eventos = consulta.data?.eventos ?? []

  if (eventos.length === 0 && pagina === 1) {
    return (
      <EmptyState
        compact
        headingLevel={3}
        icon="calendar"
        title="Sin cambios registrados"
        description="Acá aparece quién editó la ficha, agregó un contacto o una dirección, o adjuntó un archivo. Los clientes migrados del sistema anterior no traen historial de cambios: empieza el día que alguien toca la ficha."
      />
    )
  }

  return (
    <div className={styles.wrap}>
      <ol className={styles.linea}>
        {eventos.map((e) => {
          const v = presentarEvento(e)
          return (
            <li key={v.id} className={styles.item}>
              <p className={styles.titulo}>{v.titulo}</p>
              {v.detalles.length > 0 ? (
                <ul className={styles.detalles}>
                  {v.detalles.map((d, i) => (
                    <li key={`${v.id}-${i}`}>{d}</li>
                  ))}
                </ul>
              ) : null}
              <p className={styles.meta}>
                {formatearMomento(v.cuando)} · {v.quien}
              </p>
            </li>
          )
        })}
      </ol>

      {pagina > 1 || consulta.data?.hayMas ? (
        <div className={styles.paginas}>
          <Button
            variant="secondary"
            size="sm"
            disabled={pagina === 1 || consulta.isFetching}
            onClick={() => setPagina((p) => Math.max(1, p - 1))}
          >
            Más recientes
          </Button>
          <span className={styles.meta}>Página {pagina}</span>
          <Button
            variant="secondary"
            size="sm"
            disabled={!consulta.data?.hayMas || consulta.isFetching}
            onClick={() => setPagina((p) => p + 1)}
          >
            Más antiguos
          </Button>
        </div>
      ) : null}
    </div>
  )
}
