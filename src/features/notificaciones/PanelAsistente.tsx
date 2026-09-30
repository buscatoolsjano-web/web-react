import { useState } from 'react'
import { CajonDerecho } from '@/components/modals/CajonDerecho'
import { IconButton } from '@/components/ui/IconButton'
import { ChatAsistente } from '@/modules/asistente/components/ChatAsistente'

/**
 * El asistente, en un panel a la derecha (Fase 33, con el formato de la 35).
 *
 * Más ancho que el de notificaciones porque muestra conversación: una
 * respuesta con cuatro productos, su precio y su stock necesita renglón.
 */
export interface PanelAsistenteProps {
  onCerrar: () => void
}

export function PanelAsistente({ onCerrar }: PanelAsistenteProps) {
  /**
   * Empezar de cero se hace cambiando la `key`, que es la forma que React ya
   * tiene de reiniciar algo: el componente se desmonta y vuelve limpio.
   *
   * La alternativa —pasarle una función para que se vacíe— obliga a que el
   * chat exponga sus entrañas y a mantener sincronizado qué hay que limpiar.
   * Acá no hay nada que olvidarse de limpiar.
   *
   * Y hace falta de verdad: el hilo ENTERO viaja en cada consulta, así que una
   * charla larga sobre otro tema se vuelve contexto que confunde —y se paga—.
   */
  const [vuelta, setVuelta] = useState(0)

  return (
    <CajonDerecho
      titulo="Asistente Digital"
      subtitulo="Consulta el ERP en vivo"
      icono="sparkles"
      ancho="ancho"
      onCerrar={onCerrar}
      accion={
        <IconButton
          icon="refresh"
          aria-label="Empezar una conversación nueva"
          onClick={() => setVuelta((v) => v + 1)}
        />
      }
    >
      <ChatAsistente key={vuelta} />
    </CajonDerecho>
  )
}
