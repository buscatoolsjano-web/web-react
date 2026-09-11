import { useEffect, useState } from 'react'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useTiposDeActivo } from '../hooks/useActivos'
import type { FiltrosActivos as Filtros } from '../types'
import styles from './Filtros.module.css'

export interface FiltrosActivosProps {
  filtros: Filtros
  hayFiltros: boolean
  onAplicar: (cambios: Partial<Filtros>) => void
  onLimpiar: () => void
}

/**
 * Filtros del listado de equipos.
 *
 * Todos contra el servidor y todos en la URL. El de tipo ofrece **los tipos
 * que realmente se cargaron**, no una lista inventada: un filtro que no
 * devuelve nada no le sirve a nadie.
 *
 * No hay filtro de cliente en un `<select>`: son 1.010 y sería el desplegable
 * gigante que hubo que sacar de Ventas. Se filtra por cliente entrando desde
 * la ficha del cliente o del equipo, que es cuando hace falta.
 *
 * En mobile los controles se pliegan detrás de un botón que dice cuántos hay
 * puestos; el buscador queda siempre a la vista porque es el que más se usa.
 */

function contarActivos(f: Filtros): number {
  return [f.clienteId !== null, f.productoId !== null, f.tipo !== '', f.estado !== ''].filter(
    Boolean,
  ).length
}

export function FiltrosActivos({
  filtros,
  hayFiltros,
  onAplicar,
  onLimpiar,
}: FiltrosActivosProps) {
  const isMobile = useIsMobile()
  const [desplegado, setDesplegado] = useState(false)
  const tipos = useTiposDeActivo()

  const [texto, setTexto] = useState(filtros.q)

  // Si el filtro cambia desde afuera —«Limpiar», o el «atrás» del navegador—
  // hay que reflejarlo en el input. Se ajusta DURANTE el render, no en un
  // useEffect: llamar a setState dentro de un efecto provoca un render en
  // cascada.
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

  const activos = contarActivos(filtros)
  const mostrarTodos = !isMobile || desplegado

  return (
    <div className={styles.barra}>
      <input
        type="search"
        className={styles.buscador}
        placeholder="Serie, referencia EQ000… o etiqueta"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        aria-label="Buscar por serie, referencia o etiqueta"
      />

      {isMobile ? (
        <button
          type="button"
          className={styles.desplegar}
          aria-expanded={desplegado}
          onClick={() => setDesplegado((v) => !v)}
        >
          {desplegado ? 'Ocultar filtros' : 'Filtros'}
          {activos > 0 ? <span className={styles.contador}>{activos}</span> : null}
        </button>
      ) : null}

      {!mostrarTodos ? null : (
        <>
          <select
            className={styles.select}
            value={filtros.tipo}
            onChange={(e) => onAplicar({ tipo: e.target.value })}
            aria-label="Tipo de equipo"
          >
            <option value="">Todos los tipos</option>
            {(tipos.data ?? []).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <select
            className={styles.select}
            value={filtros.estado}
            onChange={(e) => onAplicar({ estado: e.target.value })}
            aria-label="Estado del equipo"
          >
            <option value="">Activos y dados de baja</option>
            <option value="activo">Sólo activos</option>
            <option value="baja">Sólo dados de baja</option>
          </select>

          {hayFiltros ? (
            <button type="button" className={styles.limpiar} onClick={onLimpiar}>
              Limpiar filtros
            </button>
          ) : null}
        </>
      )}
    </div>
  )
}
