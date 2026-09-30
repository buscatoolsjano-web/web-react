import { CajonDerecho } from '@/components/modals/CajonDerecho'
import { ChatAsistente } from '@/modules/asistente/components/ChatAsistente'

/**
 * El asistente, en un panel a la derecha (Fase 33).
 *
 * Más ancho que el de notificaciones porque muestra conversación: una
 * respuesta con cuatro productos, su precio y su stock necesita renglón.
 */
export interface PanelAsistenteProps {
  onCerrar: () => void
}

export function PanelAsistente({ onCerrar }: PanelAsistenteProps) {
  return (
    <CajonDerecho titulo="Asistente" ancho="ancho" onCerrar={onCerrar}>
      <ChatAsistente />
    </CajonDerecho>
  )
}
