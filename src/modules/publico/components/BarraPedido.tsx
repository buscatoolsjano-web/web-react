import { Link, useLocation } from 'react-router-dom'
import type { CarritoEnUso } from '../hooks/useCarritoPublico'
import styles from './BarraPedido.module.css'

/**
 * La barra flotante del pedido, abajo a la derecha (Fase 87 · E3b).
 *
 * «Que cuando agregás cosas al carrito te aparezca ahí abajo a la derecha:
 * cuántos ítems vas, ver pedido y vaciar.»
 *
 * ── POR QUÉ FLOTANTE Y NO EN EL ENCABEZADO ──────────────────────────────────
 *
 * Porque el carrito se arma MIRANDO la tabla, no el encabezado: uno recorre
 * filas apretando «+», y la confirmación de que algo pasó tiene que estar
 * cerca de donde está la vista, no arriba de todo. El globito del encabezado
 * se queda —es el ancla fija— pero esto es lo que se ve de reojo mientras se
 * agrega.
 *
 * ── SIN PESO NI PRECIO, A PROPÓSITO ─────────────────────────────────────────
 *
 * La web de referencia muestra peso, cajas y total. Acá no: no hay precio
 * publicado y el peso no está cargado para todo el catálogo. Mostrar «0 kg» o
 * un total vacío es peor que no mostrarlo. Queda lo único que es verdad:
 * cuántos ítems, ver el pedido, vaciar.
 */
export function BarraPedido({ carrito }: { carrito: CarritoEnUso }) {
  const { pathname } = useLocation()

  // No aparece sin nada adentro, ni en la propia página del pedido —ahí la
  // lista entera ya está a la vista, la barra sería una sombra de sí misma—.
  if (carrito.unidades === 0 || pathname === '/cotizar') return null

  return (
    <div className={styles.barra} role="region" aria-label="Tu pedido">
      <div className={styles.dato}>
        <span className={styles.rotulo}>Ítems</span>
        <span className={styles.valor}>{carrito.unidades.toLocaleString('es-AR')}</span>
      </div>

      <div className={styles.acciones}>
        <button type="button" className={styles.vaciar} onClick={carrito.vaciar}>
          Vaciar
        </button>
        <Link to="/cotizar" className={styles.ver}>
          Ver pedido
        </Link>
      </div>
    </div>
  )
}
