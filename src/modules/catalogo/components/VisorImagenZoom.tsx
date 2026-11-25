import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useModalAccesible } from '@/components/modals/useModalAccesible'
import { IconButton } from '@/components/ui/IconButton'
import { Button } from '@/components/ui/Button'
import styles from './VisorImagenZoom.module.css'

export interface VisorImagenZoomProps {
  src: string
  alt: string
  titulo: string
  onCerrar: () => void
}

const MIN = 1
const MAX = 6

interface Vista {
  zoom: number
  x: number
  y: number
}

const INICIAL: Vista = { zoom: 1, x: 0, y: 0 }

function acotar(z: number) {
  return Math.min(MAX, Math.max(MIN, z))
}

/**
 * Una imagen grande, ahí mismo, con zoom (2026-11).
 *
 * Pedido: «cuando toco no quiero que se me abra otra pestaña con la imagen,
 * sino que se abra ahí y que pueda hacerle zoom». Es para la hoja escaneada
 * del catálogo: una página entera, con letra chica, que hay que poder leer.
 *
 * Rueda del mouse o pellizco para acercar (hacia donde está el puntero),
 * arrastrar para moverse, doble clic para alternar entre la página entera y
 * de cerca, y los botones − / + / Ajustar para quien no use nada de eso.
 * Cierra con Escape, la X o tocando afuera de la imagen.
 */
export function VisorImagenZoom({ src, alt, titulo, onCerrar }: VisorImagenZoomProps) {
  const caja = useRef<HTMLDivElement>(null)
  const lienzo = useRef<HTMLDivElement>(null)
  const cerrarRef = useRef<HTMLButtonElement>(null)
  const [vista, setVista] = useState<Vista>(INICIAL)
  // Punteros activos: uno arrastra, dos pellizcan.
  const punteros = useRef(new Map<number, { x: number; y: number }>())
  const pellizco = useRef<{ distancia: number; zoom: number } | null>(null)
  const movido = useRef(false)

  useModalAccesible(caja, { onClose: onCerrar, initialFocus: () => cerrarRef.current })

  /** Zoom hacia un punto de la pantalla: lo que está bajo el puntero se queda ahí. */
  const zoomHacia = (nuevo: number, cx: number, cy: number) => {
    const el = lienzo.current
    setVista((v) => {
      const z = acotar(nuevo)
      if (!el || z === MIN) return { zoom: z, x: 0, y: 0 }
      const r = el.getBoundingClientRect()
      // Punto relativo al centro del lienzo.
      const px = cx - (r.left + r.width / 2)
      const py = cy - (r.top + r.height / 2)
      const k = z / v.zoom
      return { zoom: z, x: px - (px - v.x) * k, y: py - (py - v.y) * k }
    })
  }

  const zoomCentro = (factor: number) => {
    const el = lienzo.current
    if (!el) return
    const r = el.getBoundingClientRect()
    zoomHacia(vista.zoom * factor, r.left + r.width / 2, r.top + r.height / 2)
  }

  // La rueda va con `passive: false`: si no, no se puede frenar el scroll de
  // la página de atrás. Por eso se engancha a mano y no con `onWheel`.
  useEffect(() => {
    const el = lienzo.current
    if (!el) return
    const alRodar = (e: WheelEvent) => {
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * 0.0015)
      setVista((v) => {
        const z = acotar(v.zoom * factor)
        if (z === MIN) return INICIAL
        const r = el.getBoundingClientRect()
        const px = e.clientX - (r.left + r.width / 2)
        const py = e.clientY - (r.top + r.height / 2)
        const k = z / v.zoom
        return { zoom: z, x: px - (px - v.x) * k, y: py - (py - v.y) * k }
      })
    }
    el.addEventListener('wheel', alRodar, { passive: false })
    return () => el.removeEventListener('wheel', alRodar)
  }, [])

  const alBajar = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    punteros.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    movido.current = false
    if (punteros.current.size === 2) {
      const [a, b] = [...punteros.current.values()]
      if (a && b) pellizco.current = { distancia: Math.hypot(a.x - b.x, a.y - b.y), zoom: vista.zoom }
    }
  }

  const alMover = (e: ReactPointerEvent<HTMLDivElement>) => {
    const previo = punteros.current.get(e.pointerId)
    if (!previo) return
    punteros.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (punteros.current.size === 2 && pellizco.current) {
      const [a, b] = [...punteros.current.values()]
      if (!a || !b) return
      const distancia = Math.hypot(a.x - b.x, a.y - b.y)
      movido.current = true
      zoomHacia(pellizco.current.zoom * (distancia / pellizco.current.distancia), (a.x + b.x) / 2, (a.y + b.y) / 2)
      return
    }

    const dx = e.clientX - previo.x
    const dy = e.clientY - previo.y
    if (Math.abs(dx) + Math.abs(dy) > 2) movido.current = true
    setVista((v) => (v.zoom === MIN ? v : { ...v, x: v.x + dx, y: v.y + dy }))
  }

  const alSoltar = (e: ReactPointerEvent<HTMLDivElement>) => {
    punteros.current.delete(e.pointerId)
    if (punteros.current.size < 2) pellizco.current = null
  }

  return createPortal(
    <div className={styles.fondo}>
      <div ref={caja} className={styles.caja} role="dialog" aria-modal="true" aria-label={titulo}>
        <header className={styles.barra}>
          <span className={styles.titulo}>{titulo}</span>
          <div className={styles.controles}>
            <IconButton icon="minus" aria-label="Alejar" onClick={() => zoomCentro(1 / 1.5)} disabled={vista.zoom <= MIN} />
            <span className={styles.escala}>{Math.round(vista.zoom * 100)}%</span>
            <IconButton icon="plus" aria-label="Acercar" onClick={() => zoomCentro(1.5)} disabled={vista.zoom >= MAX} />
            <Button variant="ghost" size="sm" onClick={() => setVista(INICIAL)}>
              Ajustar
            </Button>
            <IconButton ref={cerrarRef} icon="x" aria-label="Cerrar" onClick={onCerrar} />
          </div>
        </header>

        <div
          ref={lienzo}
          className={vista.zoom > MIN ? `${styles.lienzo} ${styles.acercado}` : styles.lienzo}
          onPointerDown={alBajar}
          onPointerMove={alMover}
          onPointerUp={alSoltar}
          onPointerCancel={alSoltar}
          onDoubleClick={(e) => (vista.zoom > MIN ? setVista(INICIAL) : zoomHacia(2.5, e.clientX, e.clientY))}
          onClick={(e) => {
            // Tocar el fondo (no la imagen) cierra, salvo que se haya arrastrado.
            if (e.target === e.currentTarget && !movido.current && vista.zoom === MIN) onCerrar()
          }}
        >
          <img
            src={src}
            alt={alt}
            className={styles.imagen}
            draggable={false}
            style={{ transform: `translate(${vista.x}px, ${vista.y}px) scale(${vista.zoom})` }}
          />
        </div>
        <p className={styles.ayuda}>Rueda o pellizco para acercar · arrastrá para moverte · doble clic alterna</p>
      </div>
    </div>,
    document.body,
  )
}
