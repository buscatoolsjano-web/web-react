import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/components/icons/Icon'
import { PLAZOS_HABITUALES } from '../lib/plazo'
import styles from './SelectorPlazo.module.css'

export interface SelectorPlazoProps {
  valor: string
  /** El plazo que sugiere la disponibilidad («Inmediato», «Aprox. 15/12/26»). */
  sugerido: string | null
  onCambiar: (valor: string | null) => void
}

/**
 * El plazo de entrega de una línea: una lista desplegable con TODOS los plazos
 * habituales, y además se puede escribir uno a mano (2026-11).
 *
 * Antes era un `<datalist>` del navegador, que filtra por lo escrito: con
 * «Inmediato» ya cargado, la lista mostraba sólo «Inmediato» y no había forma
 * de ver las otras opciones para cambiarlo. Esta lista no filtra.
 *
 * Va en un portal con posición fija porque la tabla de líneas tiene su propio
 * scroll y recortaría una lista absoluta.
 */
export function SelectorPlazo({ valor, sugerido, onCambiar }: SelectorPlazoProps) {
  const [abierto, setAbierto] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const caja = useRef<HTMLSpanElement>(null)
  const idLista = useId()

  const opciones = sugerido && !(PLAZOS_HABITUALES as readonly string[]).includes(sugerido)
    ? [sugerido, ...PLAZOS_HABITUALES]
    : [...PLAZOS_HABITUALES]

  // Se mide en el evento que abre, no en el render (regla del lint del repo).
  const abrir = () => {
    const r = caja.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 2, left: r.left, width: Math.max(r.width, 180) })
    setAbierto(true)
  }

  // Al scrollear o redimensionar se cierra: reposicionar en vivo dentro de una
  // tabla con scroll propio es más frágil que volver a abrir.
  useEffect(() => {
    if (!abierto) return
    const cerrar = () => setAbierto(false)
    window.addEventListener('scroll', cerrar, true)
    window.addEventListener('resize', cerrar)
    return () => {
      window.removeEventListener('scroll', cerrar, true)
      window.removeEventListener('resize', cerrar)
    }
  }, [abierto])

  const elegir = (v: string) => {
    onCambiar(v)
    setAbierto(false)
  }

  return (
    <span ref={caja} className={styles.caja}>
      <input
        className={styles.input}
        value={valor}
        placeholder="Plazo de entrega"
        aria-label="Plazo de entrega"
        role="combobox"
        aria-expanded={abierto}
        aria-controls={abierto ? idLista : undefined}
        autoComplete="off"
        onChange={(e) => onCambiar(e.target.value || null)}
        onFocus={abrir}
        onClick={abrir}
        onBlur={() => window.setTimeout(() => setAbierto(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === 'Enter') setAbierto(false)
        }}
      />
      <button
        type="button"
        className={styles.flecha}
        tabIndex={-1}
        aria-label="Ver plazos habituales"
        onMouseDown={(e) => {
          e.preventDefault()
          if (abierto) setAbierto(false)
          else abrir()
        }}
      >
        <Icon name="chevron-down" size={16} />
      </button>
      {abierto && pos
        ? createPortal(
            <ul
              id={idLista}
              role="listbox"
              className={styles.lista}
              style={{ top: pos.top, left: pos.left, minWidth: pos.width }}
            >
              {opciones.map((o) => (
                <li key={o} role="option" aria-selected={o === valor}>
                  <button
                    type="button"
                    className={o === valor ? `${styles.opcion} ${styles.elegida}` : styles.opcion}
                    // Antes del blur, así el click elige en vez de cerrar.
                    onMouseDown={(e) => {
                      e.preventDefault()
                      elegir(o)
                    }}
                  >
                    {o}
                    {o === sugerido ? <span className={styles.nota}>sugerido</span> : null}
                  </button>
                </li>
              ))}
              {valor !== '' ? (
                <li role="option" aria-selected={false}>
                  <button
                    type="button"
                    className={`${styles.opcion} ${styles.quitar}`}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      onCambiar(null)
                      setAbierto(false)
                    }}
                  >
                    Sin plazo
                  </button>
                </li>
              ) : null}
            </ul>,
            document.body,
          )
        : null}
    </span>
  )
}
