import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { ETIQUETA_ESTADO } from '../lib/formato'
import type { EstadoTrabajo } from '../types'

const TONO: Record<EstadoTrabajo, BadgeTone> = {
  pendiente: 'neutral',
  en_proceso: 'info',
  resuelto: 'success',
}

/** Estado de trabajo del hilo como Badge: siempre con texto. */
export function BadgeEstado({ estado }: { estado: EstadoTrabajo }) {
  return <Badge tone={TONO[estado]}>{ETIQUETA_ESTADO[estado]}</Badge>
}
