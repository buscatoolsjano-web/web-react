import { presentarAtributos, valorConUnidad } from '../lib/formato'
import type { DefinicionAtributo } from '../types'
import styles from './ListaAtributos.module.css'

/**
 * Atributos del producto, con etiqueta legible y unidad.
 *
 * NUNCA se muestra el jsonb crudo. Cada clave se cruza con
 * product_attribute_definitions para obtener su `label` y su `unit`:
 * `{"torq_max": 250}` se ve como "Torque máximo · 250 Nm".
 *
 * Las claves sin definición no se pintan (ver presentarAtributos).
 */
export function ListaAtributos({
  atributos,
  definiciones,
}: {
  atributos: Record<string, unknown>
  definiciones: readonly DefinicionAtributo[]
}) {
  const items = presentarAtributos(atributos, definiciones)
  if (items.length === 0) {
    return <p className={styles.vacio}>Este producto no tiene características cargadas.</p>
  }

  return (
    <dl className={styles.lista}>
      {items.map((a) => (
        <div key={a.key} className={styles.item}>
          <dt className={styles.etiqueta}>{a.label}</dt>
          <dd className={styles.valor}>{valorConUnidad(a)}</dd>
        </div>
      ))}
    </dl>
  )
}
