import { CajonDerecho } from '@/components/modals/CajonDerecho'
import { Llamada } from './Llamada'

/**
 * Cata, en un panel a la derecha (Fase 85).
 *
 * El mismo cajón que el Asistente Digital, y a propósito: es la misma clase de
 * cosa —se abre sin irse de la pantalla en la que uno está trabajando, que es
 * cuando aparece la pregunta—. Pero es OTRO panel, con otro nombre y otro
 * botón, porque es otra cosa: una sabe de todo y se escribe, la otra sabe del
 * catálogo y se habla.
 *
 * Angosto y no «ancho» como el del asistente: acá no hay tarjetas de producto
 * ni tablas que necesiten renglón. Hay un botón grande y una transcripción.
 */
export interface PanelCataProps {
  onCerrar: () => void
}

export function PanelCata({ onCerrar }: PanelCataProps) {
  return (
    <CajonDerecho
      titulo="Cata"
      subtitulo="El catálogo, por teléfono"
      icono="phone"
      onCerrar={onCerrar}
    >
      <Llamada />
    </CajonDerecho>
  )
}
