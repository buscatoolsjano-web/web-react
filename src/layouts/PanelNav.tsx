import { useId, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { cx } from '@/utils/cx'
import { Icon } from '@/components/icons/Icon'
import { entradaActiva, type EntradaNav, type GrupoNav } from './navegacion'
import styles from './Shell.module.css'

export interface PanelNavProps {
  grupos: GrupoNav[]
  /** Módulo que debe abrirse desplegado (al expandir desde la barra compacta). */
  abrir?: string | null | undefined
  /** Al elegir un destino (cierra el cajón en mobile/tablet). */
  onNavegar?: (() => void) | undefined
}

/** Navegación completa: grupos con título, módulos desplegables y hojas. */
export function PanelNav({ grupos, abrir, onNavegar }: PanelNavProps) {
  const { pathname } = useLocation()
  const activos = grupos.flatMap((g) => g.entradas).filter((e) => e.hijos && entradaActiva(e, pathname)).map((e) => e.id)
  const [abiertos, setAbiertos] = useState<Set<string>>(() => new Set([...activos, ...(abrir ? [abrir] : [])]))

  // Al navegar a otro módulo, se despliega el nuevo (sin cerrar los que el
  // usuario abrió). Ajuste durante el render, no en un efecto.
  const [rutaVista, setRutaVista] = useState(pathname)
  if (rutaVista !== pathname) {
    setRutaVista(pathname)
    if (activos.some((id) => !abiertos.has(id))) setAbiertos(new Set([...abiertos, ...activos]))
  }

  const alternar = (id: string) =>
    setAbiertos((prev) => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })

  return (
    <nav className={styles.panel} aria-label="Principal">
      {grupos.map((g) => (
        <div key={g.id} className={styles.grupo}>
          {g.label && <p className={styles.grupoTitulo}>{g.label}</p>}
          <ul className={styles.lista}>
            {g.entradas.map((e) => (
              <li key={e.id}>
                <Entrada entrada={e} abierta={abiertos.has(e.id)} activa={entradaActiva(e, pathname)} onAlternar={() => alternar(e.id)} onNavegar={onNavegar} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function Entrada({
  entrada: e,
  abierta,
  activa,
  onAlternar,
  onNavegar,
}: {
  entrada: EntradaNav
  abierta: boolean
  activa: boolean
  onAlternar: () => void
  onNavegar?: (() => void) | undefined
}) {
  const idHijos = useId()

  if (e.proximamente) {
    return (
      <span className={cx(styles.item, styles.itemProximamente)} aria-disabled="true">
        <Icon name={e.icon} />
        <span className={styles.itemTexto}>{e.label}</span>
        <span className={styles.pronto}>Pronto</span>
      </span>
    )
  }

  if (e.destino) {
    return (
      <NavLink to={e.destino.to} end={e.destino.end ?? false} className={({ isActive }) => cx(styles.item, isActive && styles.itemActivo)} onClick={onNavegar}>
        <Icon name={e.icon} />
        <span className={styles.itemTexto}>{e.label}</span>
      </NavLink>
    )
  }

  return (
    <>
      <button type="button" className={cx(styles.item, styles.itemPadre, activa && styles.itemPadreActivo)} aria-expanded={abierta} aria-controls={idHijos} onClick={onAlternar}>
        <Icon name={e.icon} />
        <span className={styles.itemTexto}>{e.label}</span>
        <Icon name="chevron-down" size={16} className={cx(styles.flecha, abierta && styles.flechaAbierta)} />
      </button>
      <ul id={idHijos} className={styles.hijos} hidden={!abierta}>
        {(e.hijos ?? []).map((h) => (
          <li key={h.to}>
            <NavLink to={h.to} className={({ isActive }) => cx(styles.hijo, isActive && styles.itemActivo)} onClick={onNavegar}>
              {h.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </>
  )
}
