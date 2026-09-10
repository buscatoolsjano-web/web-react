import { useEffect, useState } from 'react'
import type { FiltrosProveedores as Filtros } from '../types'
import styles from './FiltrosProveedores.module.css'

export interface FiltrosProveedoresProps {
  filtros: Filtros
  hayFiltros: boolean
  onAplicar: (cambios: Partial<Filtros>) => void
  onLimpiar: () => void
}

/**
 * Filtros del listado de proveedores.
 *
 * Los que hay son los que tienen datos detrás. NO hay filtro por país aunque
 * el país exista: son cinco valores con 136 de 142 en el mismo, así que no
 * separa nada. Tampoco hay filtro por actividad: la columna existe y está
 * vacía en los 142.
 *
 * Todos van al servidor.
 */
export function FiltrosProveedores({
  filtros,
  hayFiltros,
  onAplicar,
  onLimpiar,
}: FiltrosProveedoresProps) {
  // Se escribe letra por letra: se espera a que la persona pare de tipear
  // antes de pedirle nada al servidor.
  const [texto, setTexto] = useState(filtros.q)

  // Si el filtro cambia desde afuera —«Limpiar», o el «atrás» del navegador—
  // hay que reflejarlo en el input. Se ajusta DURANTE el render (patrón
  // oficial de React para estado derivado) y no en un useEffect.
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
        placeholder="Razón social, nombre comercial, referencia o email…"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        aria-label="Buscar proveedor"
      />

      <select
        className={styles.select}
        value={filtros.estado}
        onChange={(e) => onAplicar({ estado: e.target.value })}
        aria-label="Estado"
      >
        <option value="">Todos los estados</option>
        <option value="active">Activos</option>
        <option value="inactive">Inactivos</option>
      </select>

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
