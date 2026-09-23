import { SkeletonRows } from '@/components/ui/Skeleton'
import { formatearPrecio } from '../lib/formato'
import { ImagenProducto } from './ImagenProducto'
import type { ProductoListado } from '../types'
import styles from './RelacionadosProducto.module.css'

export interface RelacionadosProductoProps {
  productos: readonly ProductoListado[]
  cargando: boolean
  moneda: string | null
  /** De dónde salió cada uno: curado a mano en el legacy, o calculado acá. */
  fuentes?: ReadonlyMap<string, 'legacy' | 'calculated'> | undefined
  onAbrir: (id: string) => void
}

/**
 * Los productos técnicamente parecidos a éste.
 *
 * Fase 22 · Etapa B: salen de `productos_similares`, la MISMA fuente que el
 * comparador del hover. Antes eran «misma marca, misma serie, mismo tipo», que
 * nunca proponía la alternativa de otra marca y devolvía vacío para los 12.637
 * productos sin datos técnicos.
 *
 * Al hacer click **no se cierra el modal**: se reemplaza el producto que hay
 * adentro. Saltar de la medida 8 a la 10 es comparar, no navegar, y cerrar
 * para volver a abrir perdería la comparación.
 *
 * Vienen ordenados por cercanía técnica, no alfabéticamente: el primero es el
 * que más atributos comparte con el que se está mirando.
 *
 * **Curadas y calculadas no son lo mismo, y se nota** (paridad con el legacy).
 * La ficha del legacy tenía DOS secciones separadas: «🔄 Productos similares
 * (equivalencias)», que eran las cargadas a mano y venían agrupadas por marca,
 * y «🔗 Productos relacionados», que las calculaba por atributos. Acá salen de
 * una sola consulta y en un solo orden —la curada siempre primero, porque
 * puntúa más— pero la que alguien escribió lleva su marca, como ya la lleva en
 * el comparador. Sin eso, una equivalencia verificada y un parecido calculado
 * se ven igual, y no lo son.
 */
export function RelacionadosProducto({
  productos,
  cargando,
  moneda,
  fuentes,
  onAbrir,
}: RelacionadosProductoProps) {
  if (cargando) return <SkeletonRows rows={2} columns={3} label="Buscando relacionados…" />

  if (productos.length === 0) {
    return (
      <p className={styles.vacio}>
        Sin productos similares. Se buscan por familia técnica: un balanceador contra
        balanceadores, una punta contra puntas, sin importar la marca.
      </p>
    )
  }

  return (
    <ul className={styles.grilla}>
      {productos.map((p) => (
        <li key={p.id}>
          <button type="button" className={styles.tarjeta} onClick={() => onAbrir(p.id)}>
            <span className={styles.foto}>
              <ImagenProducto imagen={p.imagen} alt="" tamano="thumb" />
            </span>
            <span className={styles.cuerpo}>
              <span className={styles.linea}>
                <code className={styles.sku}>{p.sku}</code>
                {fuentes?.get(p.id) === 'legacy' ? (
                  <span
                    className={styles.curada}
                    title="Equivalencia cargada a mano en el catálogo anterior"
                  >
                    Equivalente
                  </span>
                ) : null}
              </span>
              <span className={styles.meta}>
                {[p.tipo, p.atributos['medida'], p.atributos['encastre']]
                  .filter((x) => typeof x === 'string' && x !== '')
                  .join(' · ') || p.nombre}
              </span>
              <span className={styles.precio}>{formatearPrecio(p.precio, moneda)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
