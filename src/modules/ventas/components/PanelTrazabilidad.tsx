import { useMemo } from 'react'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { Alert } from '@/components/feedback/Alert'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { useTrazabilidad } from '../hooks/useDocumentos'
import { presentarEvento } from '../lib/trazabilidad'
import { escribeVentas } from '../lib/permisos'
import type { TipoDocumento } from '../types'
import styles from './PanelTrazabilidad.module.css'

export interface PanelTrazabilidadProps {
  tipo: TipoDocumento
  documentoId: string
}

/**
 * Qué le pasó al documento, en orden.
 *
 * Lee `sales_audit` y nada más: no hay escritura nueva ni un registro nuevo.
 * Lo que se ve es lo que las funciones de negocio ya venían guardando desde
 * la Fase 4 y que hasta ahora no tenía pantalla.
 *
 * Lo que NO se muestra: ids, la función que lo escribió, el JSON crudo del
 * diff. Un registro de auditoría se lee para entender qué cambió, no para
 * depurar el sistema.
 *
 * El registro es visible para quien escribe en la empresa (admin y employee):
 * lo decide la policy `audit_select`, no este componente. Acá sólo se evita
 * pedir filas que la base no va a devolver, y se dice por qué.
 */
export function PanelTrazabilidad({ tipo, documentoId }: PanelTrazabilidadProps) {
  const { activa } = useEmpresa()
  const escribe = escribeVentas(activa?.rol)
  const eventos = useTrazabilidad(tipo, documentoId, escribe)

  const items = useMemo(
    () => (eventos.data ?? []).map((e) => presentarEvento(e, tipo)),
    [eventos.data, tipo],
  )

  if (!escribe) {
    return (
      <p className={styles.vacio}>
        El registro de cambios es visible para los perfiles de administración. Si necesitás
        consultarlo, pedíselo a quien administra Ventas.
      </p>
    )
  }

  if (eventos.isPending) return <SkeletonRows rows={3} />

  if (eventos.error) {
    return (
      <Alert tone="danger" role="alert" title="No se pudo leer la trazabilidad">
        <p>{eventos.error.message}</p>
      </Alert>
    )
  }

  if (items.length === 0) {
    return (
      <p className={styles.vacio}>
        Todavía no hay cambios registrados. Se registran los hechos comerciales —envío, aceptación,
        rechazo, cancelación y cambios de precio o cantidad en un documento ya enviado—, no cada
        guardado.
      </p>
    )
  }

  return (
    <ol className={styles.linea}>
      {items.map((e) => (
        <li key={e.id} className={styles.evento}>
          <div className={styles.punto} aria-hidden="true" />
          <div className={styles.contenido}>
            <p className={styles.titulo}>{e.titulo}</p>
            {e.detalle.length > 0 ? (
              <ul className={styles.detalle}>
                {e.detalle.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            ) : null}
            <p className={styles.pie}>
              {e.cuando} · {e.quien}
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}
