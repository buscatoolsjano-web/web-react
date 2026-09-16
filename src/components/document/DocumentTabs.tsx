import type { ReactNode } from 'react'
import { TabPanel, Tabs, type TabItem } from '@/components/ui/Tabs'
import styles from './Document.module.css'

export interface DocumentTabsProps<K extends string> {
  /** Base de ids: la pestaña y su panel se nombran entre sí a partir de esto. */
  id: string
  items: readonly TabItem<K>[]
  value: K
  onChange: (clave: K) => void
  label: string
  /** Sólo el contenido de la pestaña activa: cada panel paga sus consultas al abrirse. */
  children: ReactNode
}

/**
 * Las pestañas de un documento y el panel de la que está abierta.
 *
 * Tercera pieza fija del documento, después de la identidad y las acciones.
 * No decide cuáles son las pestañas —eso es de cada tipo— ni carga nada: monta
 * el contenido que le pasan, así el que no se ve no consulta.
 */
export function DocumentTabs<K extends string>({ id, items, value, onChange, label, children }: DocumentTabsProps<K>) {
  return (
    <div className={styles.pestanas}>
      <Tabs id={id} items={items} value={value} onChange={onChange} label={label} />
      <TabPanel tabsId={id} tabKey={value}>
        {children}
      </TabPanel>
    </div>
  )
}
