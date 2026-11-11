import { BuscadorProductoLinea, type BuscadorProductoLineaProps } from './BuscadorProductoLinea'
import styles from './VistaImpresion.module.css'

/**
 * El nombre de una línea libre en la hoja, con búsqueda de productos (Fase 232).
 *
 * Es el MISMO buscador que la tabla de líneas, con la caja de la hoja: escribir
 * busca en el catálogo («los que contengan eso») y elegir rellena la línea con
 * el producto, su referencia y su precio. Si no se elige nada, lo escrito
 * queda como nombre, igual que antes.
 */
export function BuscadorNombreHoja(props: Omit<BuscadorProductoLineaProps, 'claseInput'>) {
  return <BuscadorProductoLinea {...props} claseInput={styles.nombreEditable} />
}
