import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from '@/utils/cx'
import styles from './Tabs.module.css'

export interface TabItem<K extends string> {
  key: K
  label: string
  /** Cantidad opcional junto a la etiqueta («Contactos 2»). */
  count?: number | undefined
}

export interface TabsProps<K extends string> {
  /** Base de ids compartida con los `TabPanel` (p. ej. un `useId()` de la página). */
  id: string
  items: readonly TabItem<K>[]
  value: K
  onChange: (key: K) => void
  label: string
  className?: string | undefined
}

const tabId = (base: string, key: string) => `${base}-tab-${key}`
const panelId = (base: string, key: string) => `${base}-panel-${key}`

/**
 * Pestañas accesibles (patrón ARIA «tabs»): `role="tablist"`, foco itinerante
 * y ← → Inicio Fin, que seleccionan al moverse.
 *
 * Usar sólo cuando cada panel tiene contenido propio suficiente; no para
 * decorar un formulario corto.
 */
export function Tabs<K extends string>({ id, items, value, onChange, label, className }: TabsProps<K>) {
  const refs = useRef(new Map<string, HTMLButtonElement>())

  const mover = (e: KeyboardEvent<HTMLButtonElement>, indice: number) => {
    const ultimo = items.length - 1
    const destino =
      e.key === 'ArrowRight' ? (indice === ultimo ? 0 : indice + 1)
      : e.key === 'ArrowLeft' ? (indice === 0 ? ultimo : indice - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? ultimo
      : null
    if (destino === null) return
    e.preventDefault()
    const item = items[destino]
    if (!item) return
    onChange(item.key)
    refs.current.get(item.key)?.focus()
  }

  return (
    <div className={cx(styles.lista, className)} role="tablist" aria-label={label}>
      {items.map((t, i) => {
        const activa = t.key === value
        return (
          <button
            key={t.key}
            ref={(el) => {
              if (el) refs.current.set(t.key, el)
              else refs.current.delete(t.key)
            }}
            type="button"
            role="tab"
            id={tabId(id, t.key)}
            aria-selected={activa}
            aria-controls={panelId(id, t.key)}
            tabIndex={activa ? 0 : -1}
            className={cx(styles.tab, activa && styles.activa)}
            onClick={() => onChange(t.key)}
            onKeyDown={(e) => mover(e, i)}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 ? <span className={styles.cuenta}>{t.count}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

export interface TabPanelProps {
  /** El mismo `id` que se pasó a `Tabs`. */
  tabsId: string
  tabKey: string
  children: ReactNode
  className?: string | undefined
}

/** Panel de la pestaña activa: `role="tabpanel"`, enfocable y nombrado por su pestaña. */
export function TabPanel({ tabsId, tabKey, children, className }: TabPanelProps) {
  return (
    <div role="tabpanel" id={panelId(tabsId, tabKey)} aria-labelledby={tabId(tabsId, tabKey)} tabIndex={0} className={cx(styles.panel, className)}>
      {children}
    </div>
  )
}
