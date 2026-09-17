import { useId, type ReactNode } from 'react'
import { TabPanel, Tabs } from '@/components/ui/Tabs'
import styles from './Whatsapp.module.css'

export type PestanaContexto = 'contacto' | 'ia' | 'actividad'

export interface PanelContextoProps {
  pestana: PestanaContexto
  onPestana: (p: PestanaContexto) => void
  /** Sugerencias abiertas: el número junto a «IA». */
  abiertos: number
  /** Motivos de atención: el número junto a «Actividad». */
  senales: number
  contacto: ReactNode
  ia: ReactNode
  actividad: ReactNode
}

/**
 * El panel derecho con sus tres pestañas: Contacto, IA y Actividad.
 *
 * Sólo se monta la pestaña abierta: la IA no se pide hasta que alguien la mira,
 * y un cambio de pestaña no dispara ningún análisis.
 */
export function PanelContexto({ pestana, onPestana, abiertos, senales, contacto, ia, actividad }: PanelContextoProps) {
  const id = useId()
  return (
    <aside className={styles.contexto} aria-label="Contexto de la conversación">
      <Tabs
        id={id}
        label="Contexto de la conversación"
        className={styles.contextoPestanas}
        value={pestana}
        onChange={onPestana}
        items={[
          { key: 'contacto', label: 'Contacto' },
          { key: 'ia', label: 'IA', count: abiertos },
          { key: 'actividad', label: 'Actividad', count: senales },
        ]}
      />
      <TabPanel tabsId={id} tabKey={pestana} className={styles.contextoCuerpo}>
        {pestana === 'contacto' ? contacto : pestana === 'ia' ? ia : actividad}
      </TabPanel>
    </aside>
  )
}
