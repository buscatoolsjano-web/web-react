import { Button } from '@/components/ui/Button'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { formatearFechaCorta } from '../lib/movimientos'
import type { DocumentoHistorial, TipoDocHistorial } from '../services/historialDocumentos'
import styles from './HistorialStock.module.css'

const ETIQUETA_TIPO: Record<TipoDocHistorial, string> = {
  cotizacion: 'Cotización',
  pedido: 'Pedido',
  entrega: 'Entrega',
}

function importe(moneda: string | null, n: number | null): string {
  if (n === null) return '—'
  const num = n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return moneda ? `${moneda} ${num}` : num
}

/**
 * El histórico comercial del producto (Fase 113): dónde aparece —cotizaciones,
 * pedidos y notas de entrega—, con la cantidad y el precio de cada una. **Sólo
 * lectura.** Arranca plegado y se pide al abrirlo, como el historial de stock:
 * mirar diez productos no puede ser diez consultas que nadie miró.
 */
export function HistorialDocumentos({
  documentos,
  abierto,
  cargando,
  onAbrir,
}: {
  documentos: readonly DocumentoHistorial[]
  abierto: boolean
  cargando: boolean
  onAbrir: () => void
}) {
  if (!abierto) {
    return (
      <div className={styles.plegado}>
        <Button variant="secondary" size="sm" onClick={onAbrir}>
          Ver historial comercial
        </Button>
        <span className={styles.nota}>Cotizaciones, pedidos y entregas. Se consulta al abrirlo.</span>
      </div>
    )
  }

  if (cargando && documentos.length === 0) {
    return <SkeletonRows rows={4} columns={5} label="Cargando el historial…" />
  }

  if (documentos.length === 0) {
    return <p className={styles.vacio}>Este producto no aparece en ningún documento todavía.</p>
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.scroll}>
        <table className={styles.tabla}>
          <thead>
            <tr>
              <th scope="col">Fecha</th>
              <th scope="col">Documento</th>
              <th scope="col">Cliente</th>
              <th scope="col" className={styles.num}>Cantidad</th>
              <th scope="col" className={styles.num}>Precio</th>
            </tr>
          </thead>
          <tbody>
            {documentos.map((d, i) => (
              <tr key={`${d.docId}-${i}`}>
                <td className={styles.fecha}>{d.fecha ? formatearFechaCorta(d.fecha) : '—'}</td>
                <td>
                  <span className={styles.tipo}>{ETIQUETA_TIPO[d.tipo]}</span>
                  <span className={styles.notas}>{d.numero}</span>
                </td>
                <td>{d.cliente ?? '—'}</td>
                <td className={styles.num}>{d.cantidad}</td>
                <td className={styles.num}>{importe(d.moneda, d.precioUnitario)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.pie}>
        {documentos.length} {documentos.length === 1 ? 'aparición' : 'apariciones'} en documentos.
      </p>
    </div>
  )
}
