import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { useCarrito } from '../hooks/useCarrito'
import { formatearPrecio } from '../lib/formato'
import styles from './BarraCarrito.module.css'

/**
 * La barra flotante del carrito (Fase 22 · paridad, #50).
 *
 * El legacy la pone abajo a la derecha, con «Ítems», «Total venta», «Ver
 * cotización» y «Vaciar», y la esconde cuando el carrito está vacío
 * (`app.js:15590`, `display: none` si no hay ítems). Acá es lo mismo: si no
 * hay nada, no hay barra.
 *
 * **«Ver cotización» no crea la cotización.** El legacy abre un modal, pide
 * el cliente y escribe la cotización ahí mismo — con su propia copia de la
 * lógica de totales. En React lleva a «Nueva cotización», que es el único
 * lugar donde nace un documento de venta: la misma pantalla, el mismo
 * borrador, la misma autoridad de numeración. Lo que llega es la selección,
 * no un documento armado en otro lado.
 *
 * El total se calcula con los precios de la lista que está mirando el
 * catálogo. Es una referencia: el precio definitivo lo resuelve la cotización
 * con SU tarifa, que puede ser otra.
 */
export function BarraCarrito({
  moneda,
  precios,
}: {
  moneda: string | null
  /** Precio por producto en la lista visible, para el total de referencia. */
  precios: ReadonlyMap<string, number | null>
}) {
  const navigate = useNavigate()
  const { carrito, unidades, vaciar } = useCarrito()

  if (carrito.length === 0) return null

  const conocidos = carrito.filter((i) => typeof precios.get(i.productId) === 'number')
  const total = conocidos.reduce((s, i) => s + (precios.get(i.productId) ?? 0) * i.cantidad, 0)
  const faltan = carrito.length - conocidos.length

  return (
    <aside className={styles.barra} aria-label="Carrito del catálogo">
      <div className={styles.numeros}>
        <div>
          <span className={styles.etiqueta}>Productos</span>
          <strong className={styles.valor}>{carrito.length}</strong>
        </div>
        <div>
          <span className={styles.etiqueta}>Unidades</span>
          <strong className={styles.valor}>{unidades}</strong>
        </div>
        <div>
          <span className={styles.etiqueta}>Total estimado</span>
          <strong className={styles.valor}>{formatearPrecio(total, moneda)}</strong>
          {/* Sin esto, un total que ignora tres productos sin precio parece
              el total de todo. */}
          {faltan > 0 ? (
            <span className={styles.aclaracion}>
              {faltan === 1 ? 'sin 1 producto sin precio' : `sin ${faltan} productos sin precio`}
            </span>
          ) : null}
        </div>
      </div>
      <div className={styles.acciones}>
        <Button variant="ghost" size="sm" onClick={vaciar}>
          Vaciar
        </Button>
        <Button size="sm" onClick={() => void navigate('/ventas/cotizaciones/nueva?desde=catalogo')}>
          Ver cotización
        </Button>
      </div>
    </aside>
  )
}
