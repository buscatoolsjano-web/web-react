import { useCarrito } from '../hooks/useCarrito'
import type { ProductoListado } from '../types'
import styles from './CeldaCarrito.module.css'

/**
 * El `− [n] +` de cada fila (Fase 22 · paridad, #50).
 *
 * Es la columna «Carrito» del listado legacy (`app.js:15396`). Mismo
 * comportamiento: `+` suma uno, `−` resta hasta cero, y el número se puede
 * escribir a mano. Poner cero saca el producto — en el legacy tampoco existe
 * «está en el carrito con cantidad 0».
 *
 * Los tres controles frenan la propagación del click: la fila entera abre el
 * producto, y sumar una unidad no es abrirlo.
 */
export function CeldaCarrito({ producto }: { producto: ProductoListado }) {
  const { producto: enCarrito } = useCarrito()
  const p = { id: producto.id, sku: producto.sku, nombre: producto.nombre }
  const { cantidad, sumar, restar, poner } = enCarrito(p)

  const detener = (e: { stopPropagation: () => void }) => e.stopPropagation()

  return (
    <span className={styles.caja} onClick={detener} onKeyDown={detener} role="presentation">
      <button
        type="button"
        className={styles.boton}
        onClick={restar}
        disabled={cantidad === 0}
        aria-label={`Quitar una unidad de ${producto.sku}`}
      >
        −
      </button>
      <input
        type="number"
        min={0}
        inputMode="numeric"
        className={styles.cantidad}
        value={cantidad}
        onChange={(e) => poner(Number(e.target.value))}
        aria-label={`Unidades de ${producto.sku} en el carrito`}
        data-carrito-cantidad={producto.sku}
      />
      <button
        type="button"
        className={`${styles.boton} ${styles.sumar}`}
        onClick={sumar}
        aria-label={`Agregar una unidad de ${producto.sku}`}
      >
        +
      </button>
    </span>
  )
}
