import { useEffect, useState } from 'react'
import { ImagenProducto } from '@/modules/catalogo/components/ImagenProducto'
import type { ImagenProducto as Imagen } from '@/modules/catalogo/types'
import { ubicar } from '../lib/ubicarZoom'
import styles from './ZoomDeFoto.module.css'

export interface ZoomDeFotoProps {
  imagen: Imagen | null
  /** Qué producto es, para que la foto ampliada no quede anónima. */
  titulo: string
  /** El rectángulo de la miniatura, en coordenadas de la ventana. */
  ancla: DOMRect
}

/**
 * La foto ampliada al pasar el mouse por la miniatura (Fase 54).
 *
 * POR QUÉ NO ES UN `position: absolute` dentro de la celda. La planilla vive en
 * un contenedor con scroll horizontal —tiene una columna por fecha—, y
 * cualquier cosa posicionada dentro de la tabla la recorta ese contenedor: la
 * foto ampliada aparecía cortada por la mitad. Así que la tarjeta se renderiza
 * FUERA de la tabla, en `position: fixed`, anclada al rectángulo de la
 * miniatura. Es el mismo camino que ya usaba la ficha al vuelo del catálogo.
 *
 * Y es sólo la foto, a propósito: la ficha del catálogo trae un comparador con
 * enlaces a otros productos, y eso es recorrer el catálogo, no mirar un precio.
 * Acá lo que se pidió es ver la foto más grande.
 */
export function ZoomDeFoto({ imagen, titulo, ancla }: ZoomDeFotoProps) {
  /*
   * La posición se CALCULA EN EL RENDER, no en un efecto.
   *
   * Sale entera del ancla, que es una prop, así que no es estado: guardarla con
   * `useState` desde un `useLayoutEffect` pintaba una vez sin posición y otra
   * con, que es el parpadeo que se quería evitar. Derivada, sale bien en el
   * primer pintado.
   *
   * A la derecha de la miniatura si entra, y si no a la izquierda: en la
   * planilla la columna de la foto es la primera, así que casi siempre entra a
   * la derecha, pero con la ventana angosta no.
   */
  const pos = ubicar(ancla)

  /* Si se scrollea con la tarjeta abierta, el ancla ya no vale: se cierra sola
     por el `onMouseLeave` de la celda, pero el scroll con rueda no dispara ese
     evento. Esto evita que quede flotando en el aire. */
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const irse = () => setVisible(false)
    window.addEventListener('scroll', irse, { passive: true, capture: true })
    return () => window.removeEventListener('scroll', irse, { capture: true })
  }, [])

  if (!visible) return null

  return (
    <div
      className={styles.tarjeta}
      style={{ left: pos.left, top: pos.top }}
      /* Decorativa: no se puede tocar y no interrumpe a un lector de pantalla,
         que ya tiene la referencia y la descripción en la fila. */
      aria-hidden="true"
    >
      <ImagenProducto imagen={imagen} alt="" tamano="full" prioridad="eager" />
      <span className={styles.pie}>{titulo}</span>
    </div>
  )
}
