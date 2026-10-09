import { useEffect, useRef, useState } from 'react'
import { cx } from '@/utils/cx'
import { acotar, MAX_PX, MIN_PX } from './anchoDeColumnas'
import styles from './anchosAjustables.module.css'

/**
 * El borde que se agarra para cambiar el ancho de una columna.
 *
 * TAMBIÉN CON EL TECLADO, con las flechas: un tirador que sólo funciona
 * arrastrando el mouse deja la función afuera para quien no puede hacer un
 * arrastre preciso. Es un `separator` con `aria-valuenow`, que es lo que un
 * lector de pantalla sabe leer como «ancho de columna, 220».
 *
 * `pointermove` en la VENTANA y no en el tirador: si el puntero se adelanta al
 * re-render —y en un arrastre rápido se adelanta siempre— los eventos dejarían
 * de llegar al elemento y el arrastre se cortaría solo a mitad de camino.
 */
export function TiradorDeAncho({
  clave,
  etiqueta,
  ancho,
  onArrastrar,
}: {
  clave: string
  etiqueta: string
  ancho: number
  onArrastrar: (clave: string, anchoAlEmpezar: number, deltaPx: number, final: boolean) => void
}) {
  const arrastre = useRef<{ x: number; ancho: number } | null>(null)
  const [activo, setActivo] = useState(false)

  useEffect(() => {
    if (!activo) return
    const mover = (e: PointerEvent) => {
      const a = arrastre.current
      if (a) onArrastrar(clave, a.ancho, e.clientX - a.x, false)
    }
    const soltar = (e: PointerEvent) => {
      const a = arrastre.current
      if (a) onArrastrar(clave, a.ancho, e.clientX - a.x, true)
      arrastre.current = null
      setActivo(false)
    }
    window.addEventListener('pointermove', mover)
    window.addEventListener('pointerup', soltar)
    window.addEventListener('pointercancel', soltar)
    return () => {
      window.removeEventListener('pointermove', mover)
      window.removeEventListener('pointerup', soltar)
      window.removeEventListener('pointercancel', soltar)
    }
  }, [activo, clave, onArrastrar])

  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Ancho de ${etiqueta}`}
      aria-valuenow={ancho}
      aria-valuemin={MIN_PX}
      aria-valuemax={MAX_PX}
      tabIndex={0}
      className={cx(styles.tirador, activo && styles.tiradorActivo)}
      onPointerDown={(e) => {
        // Sin esto el navegador arranca su propio arrastre de selección de
        // texto y el gesto queda peleado entre los dos.
        e.preventDefault()
        // La cabecera suele ser clickeable para ordenar: agarrar el borde no
        // es pedir otro orden.
        e.stopPropagation()
        arrastre.current = { x: e.clientX, ancho }
        setActivo(true)
      }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // 16px por flecha, 64 con Shift: 1px por pulsación obligaría a apretar
        // cien veces para un ajuste que se note.
        const paso = e.shiftKey ? 64 : 16
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          onArrastrar(clave, ancho, -paso, true)
        } else if (e.key === 'ArrowRight') {
          e.preventDefault()
          onArrastrar(clave, ancho, paso, true)
        } else if (e.key === 'Home') {
          e.preventDefault()
          onArrastrar(clave, MIN_PX, 0, true)
        } else if (e.key === 'End') {
          e.preventDefault()
          onArrastrar(clave, acotar(MAX_PX), 0, true)
        }
      }}
    />
  )
}
