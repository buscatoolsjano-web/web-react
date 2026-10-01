import type { ChangeEvent } from 'react'
import type { FacetaAtributo, OpcionFaceta, RangoNumerico } from '../types'
import styles from './SelectorFaceta.module.css'

/**
 * El control de filtro del catálogo: una lista desplegable y nada más.
 *
 * Es el MISMO control arriba («Filtrar por») y abajo, en el encabezado de la
 * tabla. Antes arriba había un botón que abría un panel flotante con buscador
 * y casillas, y abajo un `select` común: dos cosas distintas para el mismo
 * filtro, y encima la de arriba se rompía —el panel quedaba dibujado dentro de
 * la fila, sin su botón— porque la fila scrollea en horizontal y eso recorta
 * cualquier cosa que flote.
 *
 * Un desplegable común no tiene ese problema: lo dibuja el sistema operativo
 * por encima de todo, se abre con el teclado, y en cada opción se ve cuántos
 * productos hay.
 */

/** Cuánto se deja crecer al texto de una opción; el ancho mínimo del
 *  desplegable lo fija su opción más larga, y eso se le suma a la columna. */
const MAXIMO = 22

const recortar = (t: string) => (t.length <= MAXIMO ? t : `${t.slice(0, MAXIMO - 1)}…`)

export interface SelectorFacetaProps {
  /** Lo que se lee cuando no hay nada elegido: «Marca», «Medida»… */
  etiqueta: string
  valor: string
  opciones: readonly OpcionFaceta[]
  onElegir: (valor: string) => void
  /** Texto de la opción vacía. Por defecto «Todos». */
  todos?: string
  className?: string | undefined
  /**
   * Mostrar cuántos productos hay en cada opción.
   *
   * Arriba sí: ayuda a elegir. En el encabezado de la tabla no, porque ahí el
   * ancho lo manda la columna —61 px en «Marca»— y «1/2 SQ (2.253)» no entra
   * ni de casualidad: se leía «1/2 S…».
   */
  conConteo?: boolean
  /** La opción vacía repite el nombre del filtro. En la tabla no hace falta:
   *  el título de la columna está justo arriba. */
  conNombre?: boolean
}

export function SelectorFaceta({
  etiqueta,
  valor,
  opciones,
  onElegir,
  todos = 'Todos',
  className,
  conConteo = true,
  conNombre = true,
}: SelectorFacetaProps) {
  // Sin opciones no se dibuja: un desplegable con un solo ítem que dice
  // «Todos» ocupa lugar y no filtra nada.
  if (opciones.length === 0) return null
  return (
    <select
      className={className ?? styles.control}
      aria-label={`Filtrar por ${etiqueta}`}
      value={valor}
      onChange={(e: ChangeEvent<HTMLSelectElement>) => onElegir(e.target.value)}
    >
      <option value="">{conNombre ? `${etiqueta} · ${todos}` : todos}</option>
      {opciones.map((o) => (
        <option key={o.valor} value={o.valor} title={o.etiqueta}>
          {recortar(o.etiqueta)}
          {conConteo ? ` (${o.cantidad.toLocaleString('es-AR')})` : ''}
        </option>
      ))}
    </select>
  )
}

const aNumero = (v: string): number | null => {
  const n = Number(v.trim().replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/**
 * Un atributo numérico de muchos valores: dos desplegables, «desde» y «hasta».
 *
 * `hasta` sólo ofrece valores mayores o iguales al `desde` elegido. No es
 * cosmético: si elegís torque mínimo 6 y la lista del máximo sigue ofreciendo
 * 3, ese 3 no existe en el catálogo y el filtro devolvería cero sin explicar
 * por qué.
 */
export function SelectorRango({
  faceta,
  valor,
  onCambiar,
  className,
}: {
  faceta: FacetaAtributo
  valor: RangoNumerico
  onCambiar: (r: RangoNumerico) => void
  className?: string | undefined
}) {
  const desde = valor.min
  const hasta = valor.max

  const opcionesHasta = faceta.opciones.filter((o) => {
    if (desde === null) return true
    const n = aNumero(o.valor)
    return n === null || n >= desde
  })

  const unidad = faceta.unidad ? ` (${faceta.unidad})` : ''

  return (
    <>
      <SelectorFaceta
        etiqueta={`${faceta.label}${unidad} desde`}
        todos="cualquiera"
        valor={desde === null ? '' : String(desde)}
        opciones={faceta.opciones}
        className={className ?? styles.control}
        onElegir={(v) => {
          const n = v === '' ? null : aNumero(v)
          // Si el nuevo «desde» deja al «hasta» por debajo, se limpia: un
          // rango invertido no devuelve nada y parece que no hay productos.
          const max = hasta !== null && n !== null && hasta < n ? null : hasta
          onCambiar({ min: n, max })
        }}
      />
      <SelectorFaceta
        etiqueta={`${faceta.label}${unidad} hasta`}
        todos="cualquiera"
        valor={hasta === null ? '' : String(hasta)}
        opciones={opcionesHasta}
        className={className ?? styles.control}
        onElegir={(v) => onCambiar({ min: desde, max: v === '' ? null : aNumero(v) })}
      />
    </>
  )
}
