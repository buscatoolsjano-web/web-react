import { Badge } from '@/components/ui/Badge'
import {
  etiquetaDeEstadoFactura,
  etiquetaDeEstadoPedido,
  etiquetaDeRecepcion,
} from '../lib/estados'

export interface ChipEstadoProps {
  estado: string
}

/**
 * Estados de Compras como `Badge` (Fase 13). Etiquetas y códigos son los de
 * `lib/estados`; sólo cambia la presentación. Siempre texto, nunca sólo color.
 */

/** El estado comercial: lo decide una persona. */
export function ChipEstado({ estado }: ChipEstadoProps) {
  const etiqueta = etiquetaDeEstadoPedido(estado)
  if (estado === 'confirmed') return <Badge tone="brand">{etiqueta}</Badge>
  if (estado === 'cancelled') return <Badge tone="danger" outline>{etiqueta}</Badge>
  return <Badge tone="neutral">{etiqueta}</Badge>
}

/**
 * El estado logístico: lo deriva la base mirando todas las líneas.
 *
 * Va en un chip aparte y con otro color a propósito. En el legacy había un
 * solo estado y no se distinguía «lo confirmé» de «me llegó».
 */
export function ChipRecepcion({ estado }: ChipEstadoProps) {
  const etiqueta = etiquetaDeRecepcion(estado)
  if (estado === 'received') return <Badge tone="success">{etiqueta}</Badge>
  if (estado === 'partially_received') return <Badge tone="warning" dot>{etiqueta}</Badge>
  return <Badge tone="neutral" outline>{etiqueta}</Badge>
}

/**
 * El estado de la recepción: `draft` o `confirmed`, los dos del CHECK.
 *
 * No hay más, y no se agregan por simetría con otros documentos. Una
 * recepción confirmada movió stock y no vuelve atrás: revertirla sería un
 * contramovimiento explícito, y eso no está en v1.
 */
export function ChipRecepcionDoc({ estado }: ChipEstadoProps) {
  return estado === 'confirmed' ? <Badge tone="success">Confirmada</Badge> : <Badge tone="neutral">Borrador</Badge>
}

/** El estado de la factura de proveedor: borrador, registrada o anulada. */
export function ChipFactura({ estado }: ChipEstadoProps) {
  const etiqueta = etiquetaDeEstadoFactura(estado)
  if (estado === 'registered') return <Badge tone="success">{etiqueta}</Badge>
  if (estado === 'cancelled') return <Badge tone="danger" outline>{etiqueta}</Badge>
  return <Badge tone="neutral">{etiqueta}</Badge>
}
