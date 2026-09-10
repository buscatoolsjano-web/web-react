import { useEffect, useState } from 'react'
import { useRubros } from '../hooks/useClientes'
import type { FiltrosClientes as Filtros } from '../types'
import styles from './FiltrosClientes.module.css'

export interface FiltrosClientesProps {
  filtros: Filtros
  hayFiltros: boolean
  onAplicar: (cambios: Partial<Filtros>) => void
  onLimpiar: () => void
}

/**
 * Filtros del listado.
 *
 * El legacy tenía un filtro por columna en las seis primeras. Acá la búsqueda
 * libre cubre nombre, nombre comercial, referencia, CUIT, email y dominio en
 * un solo campo —es lo que la gente usa— y quedan aparte los dos que no son
 * texto: el rubro y la cola de revisión.
 *
 * Todos van al servidor.
 */
export function FiltrosClientes({
  filtros,
  hayFiltros,
  onAplicar,
  onLimpiar,
}: FiltrosClientesProps) {
  const rubros = useRubros()

  // Se escribe letra por letra: se espera a que la persona pare de tipear
  // antes de pedirle nada al servidor.
  const [texto, setTexto] = useState(filtros.q)

  // Si el filtro cambia desde afuera —«Limpiar», o el «atrás» del navegador—
  // hay que reflejarlo en el input. Se ajusta DURANTE el render (patrón
  // oficial de React para estado derivado) y no en un useEffect: llamar a
  // setState dentro de un efecto provoca un render en cascada.
  const [qPrevia, setQPrevia] = useState(filtros.q)
  if (qPrevia !== filtros.q) {
    setQPrevia(filtros.q)
    setTexto(filtros.q)
  }

  useEffect(() => {
    if (texto === filtros.q) return
    const id = setTimeout(() => onAplicar({ q: texto }), 300)
    return () => clearTimeout(id)
  }, [texto, filtros.q, onAplicar])

  return (
    <div className={styles.barra}>
      <input
        type="search"
        className={styles.buscador}
        placeholder="Nombre, referencia, CUIT, email o dominio…"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        aria-label="Buscar cliente"
      />

      {(rubros.data ?? []).length > 0 ? (
        <select
          className={styles.select}
          value={filtros.rubro ?? ''}
          onChange={(e) => onAplicar({ rubro: e.target.value || null })}
          aria-label="Rubro"
        >
          <option value="">Todos los rubros</option>
          {(rubros.data ?? []).map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      ) : null}

      <label className={styles.check}>
        <input
          type="checkbox"
          checked={filtros.soloRevision}
          onChange={(e) => onAplicar({ soloRevision: e.target.checked })}
        />
        Sólo los marcados para revisión
      </label>

      <label className={styles.check}>
        <input
          type="checkbox"
          checked={filtros.incluirBajas}
          onChange={(e) => onAplicar({ incluirBajas: e.target.checked })}
        />
        Incluir dados de baja
      </label>

      {hayFiltros ? (
        <button type="button" className={styles.limpiar} onClick={onLimpiar}>
          Limpiar
        </button>
      ) : null}
    </div>
  )
}
