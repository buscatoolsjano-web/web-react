import type { FiltrosActivos, ResumenActivos } from '../types'
import styles from './ChipsDeActivos.module.css'

export interface ChipsDeActivosProps {
  filtros: FiltrosActivos
  resumen: ResumenActivos | undefined
  onAplicar: (cambios: Partial<FiltrosActivos>) => void
}

/**
 * Los atajos del listado, con el número de equipos que hay detrás de cada uno.
 *
 * Son los chips del panel anterior, pero **sólo los que dicen algo con los
 * datos reales**. El legacy tenía uno por modelo —serían 102— y «Mis fichas»,
 * que necesita órdenes asignadas y todavía no hay ninguna.
 *
 * Los que quedan contestan las tres preguntas que se hacen con un parque
 * recién importado: qué equipos no tienen dueño, cuáles entraron sin número
 * de serie, y volver a ver todo.
 */
export function ChipsDeActivos({ filtros, resumen, onAplicar }: ChipsDeActivosProps) {
  const sinFiltroDeSubconjunto = filtros.serie === '' && !filtros.sinCliente
  const chips = [
    {
      clave: 'todos',
      etiqueta: 'Todos',
      cuenta: resumen?.total,
      activo: sinFiltroDeSubconjunto,
      cambio: { serie: '', sinCliente: false },
    },
    {
      clave: 'con-serie',
      etiqueta: 'Con serie',
      cuenta: resumen ? resumen.total - resumen.sinSerie : undefined,
      activo: filtros.serie === 'con',
      cambio: { serie: 'con', sinCliente: false },
    },
    {
      clave: 'sin-serie',
      etiqueta: 'Sin serie',
      cuenta: resumen?.sinSerie,
      activo: filtros.serie === 'sin',
      cambio: { serie: 'sin', sinCliente: false },
    },
    {
      clave: 'sin-cliente',
      etiqueta: 'Sin cliente',
      cuenta: resumen?.sinCliente,
      activo: filtros.sinCliente,
      cambio: { serie: '', sinCliente: true, clienteId: null },
    },
  ] as const

  return (
    <div className={styles.fila} role="group" aria-label="Atajos del listado">
      {chips.map((c) => (
        <button
          key={c.clave}
          type="button"
          className={c.activo ? styles.chipActivo : styles.chip}
          aria-pressed={c.activo}
          onClick={() => onAplicar(c.cambio)}
        >
          {c.etiqueta}
          {c.cuenta === undefined ? null : <span className={styles.cuenta}>{c.cuenta}</span>}
        </button>
      ))}
    </div>
  )
}
