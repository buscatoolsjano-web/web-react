import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/icons/Icon'
import styles from './TablaProductos.module.css'

/**
 * La miniatura de la fila, que se AMPLÍA al pasar el mouse (Fase 139).
 *
 * «Cuando paso el mouse por la foto quiero que se amplíe, como en el ERP, y
 * abajo el nombre del modelo. Sin comparativos.» Es sólo eso: la misma foto más
 * grande y el modelo debajo, nada de la tabla comparativa del ERP.
 *
 * El globo va por PORTAL al `body` y posicionado con coordenadas fijas, no como
 * hijo absoluto de la celda: la tabla tiene scroll horizontal (`overflow`), y
 * un hijo absoluto quedaría recortado por ese borde. Anclado al rectángulo real
 * de la miniatura, aparece al costado y flota por encima de todo.
 */
export function CeldaFoto({
  foto,
  modelo,
  ruta,
}: {
  foto: string | null
  modelo: string | null
  ruta: string
}) {
  const ancla = useRef<HTMLAnchorElement>(null)
  const [caja, setCaja] = useState<DOMRect | null>(null)

  const mostrar = () => {
    if (foto) setCaja(ancla.current?.getBoundingClientRect() ?? null)
  }
  const ocultar = () => setCaja(null)

  // A la derecha de la miniatura; si no entra, a la izquierda. El alto se ancla
  // al tope de la fila y se recorta para no salirse por abajo de la pantalla.
  const ANCHO = 240
  const estilo: React.CSSProperties | undefined = caja
    ? (() => {
        const derecha = caja.right + 12 + ANCHO <= window.innerWidth
        const top = Math.min(caja.top, window.innerHeight - ANCHO - 48)
        return {
          top: Math.max(8, top),
          left: derecha ? caja.right + 12 : undefined,
          right: derecha ? undefined : window.innerWidth - caja.left + 12,
        }
      })()
    : undefined

  return (
    <Link
      ref={ancla}
      to={ruta}
      className={styles.foto}
      tabIndex={-1}
      aria-hidden="true"
      onMouseEnter={mostrar}
      onMouseLeave={ocultar}
    >
      {foto ? (
        <img src={foto} alt="" loading="lazy" decoding="async" width={44} height={44} />
      ) : (
        <span className={styles.sinFoto} aria-hidden="true">
          <Icon name="image" size={16} />
        </span>
      )}

      {caja && foto
        ? createPortal(
            <div className={styles.zoom} style={estilo} aria-hidden="true">
              <img src={foto} alt="" width={ANCHO} height={ANCHO} className={styles.zoomImagen} />
              {modelo ? <span className={styles.zoomModelo}>{modelo}</span> : null}
            </div>,
            document.body,
          )
        : null}
    </Link>
  )
}
