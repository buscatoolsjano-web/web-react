import { Badge, type BadgeTone } from '@/components/ui/Badge'
import type { EstadoPresentable, TonoEstado } from '../lib/estados'

/** Tono de negocio (lib/estados) → tono visual. El mapeo de estados no cambia. */
const TONO: Record<TonoEstado, BadgeTone> = {
  neutro: 'neutral',
  info: 'info',
  ok: 'success',
  alerta: 'warning',
  error: 'danger',
}

export function ChipEstado({ estado }: { estado: EstadoPresentable }) {
  // Cancelado/rechazado va con contorno: se distingue también en B/N.
  return (
    <Badge tone={TONO[estado.tono]} outline={estado.tono === 'error'}>
      {estado.etiqueta}
    </Badge>
  )
}
