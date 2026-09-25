import { useId, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { cx } from '@/utils/cx'
import { Icon } from '@/components/icons/Icon'
import { precargarRuta } from '@/app/precarga'
import { entradaActiva, type EntradaNav, type GrupoNav } from './navegacion'
import { useNoLeidos } from './useNoLeidos'
import styles from './Shell.module.css'

/**
 * Empezar a bajar la pantalla apenas el mouse toca el enlace (Fase 29 · E3).
 *
 * El hover da entre 200 y 800 ms antes del clic, que alcanza para tener el
 * chunk listo. `onFocus` hace lo mismo para quien navega con el teclado, que
 * si no se quedaría sin la ventaja.
 */
function precargaDe(to: string) {
  const precargar = () => precargarRuta(to)
  return { onPointerEnter: precargar, onFocus: precargar }
}

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
  const noLeidos = useNoLeidos()
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
                <Entrada
                  entrada={e}
                  abierta={abiertos.has(e.id)}
                  activa={entradaActiva(e, pathname)}
                  sinLeer={e.contador ? noLeidos[e.contador] : 0}
                  onAlternar={() => alternar(e.id)}
                  onNavegar={onNavegar}
                />
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
  sinLeer,
  onAlternar,
  onNavegar,
}: {
  entrada: EntradaNav
  abierta: boolean
  activa: boolean
  /** Cuántos sin leer. `0` no dibuja nada. */
  sinLeer: number
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
      <NavLink to={e.destino.to} end={e.destino.end ?? false} className={({ isActive }) => cx(styles.item, isActive && styles.itemActivo)} onClick={onNavegar} {...precargaDe(e.destino.to)}>
        <Icon name={e.icon} />
        <span className={styles.itemTexto}>{e.label}</span>
        <Sinleer cuantos={sinLeer} />
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
            <NavLink to={h.to} className={({ isActive }) => cx(styles.hijo, isActive && styles.itemActivo)} onClick={onNavegar} {...precargaDe(h.to)}>
              {h.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </>
  )
}

/**
 * El círculo rojo con los sin leer (Fase 27 · E3).
 *
 * Cero no dibuja nada: un círculo con un 0 adentro ocupa el mismo lugar y
 * dice que no hay nada, que es justo lo que no hace falta mirar.
 *
 * Arriba de 99 dice «99+»: el número exacto no cambia la decisión y tres
 * dígitos desarman el círculo.
 */
function Sinleer({ cuantos }: { cuantos: number }) {
  if (cuantos <= 0) return null
  return (
    <span className={styles.sinLeer}>
      <span aria-hidden="true">{cuantos > 99 ? '99+' : cuantos}</span>
      <span className="sr-only">{cuantos === 1 ? '1 sin leer' : `${cuantos} sin leer`}</span>
    </span>
  )
}
