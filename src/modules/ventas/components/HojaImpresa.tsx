import { useEffect, useState, type ReactNode } from 'react'
import { createPortal, flushSync } from 'react-dom'

export interface HojaImpresaProps {
  /**
   * Quién imprime. El modal de impresión gana sobre la hoja de la pantalla:
   * si los dos están montados, en el papel sale sólo la del modal.
   */
  prioridad: 'modal' | 'pagina'
  papel: 'A4' | 'carta'
  /** El ticket va en rollo de 80 mm, con el largo que pida el contenido. */
  ticket?: boolean
  /** La hoja a imprimir. Se arma recién al imprimir. */
  children: () => ReactNode
}

/**
 * La hoja que va al papel, sola (2026-11).
 *
 * Pedido: «que sea SOLO 1 hoja si es solo 1 hoja, que el total esté SIEMPRE
 * en el bottom de la hoja, y lo mismo cuando imprimo desde la cotización».
 *
 * Antes se imprimía la página entera con todo lo demás en `visibility:
 * hidden`. Invisible pero ocupando lugar: la cotización de fondo es larga, y
 * el navegador agregaba hojas por ese largo. Y con Ctrl+P desde la cotización
 * salía la vista previa del costado, escalada y con otro alto.
 *
 * Ahora, mientras el navegador imprime, la hoja se dibuja a tamaño real como
 * hija directa de `body`, y el CSS global saca de la composición (`display:
 * none`) todo lo demás. Sin nada que empuje, una hoja es una página, y el
 * relleno flexible de la hoja lleva los totales al pie.
 *
 * Se monta sólo entre `beforeprint` y `afterprint`: el resto del tiempo no
 * existe, así no hay una segunda hoja escondida en el DOM.
 */
export function HojaImpresa({ prioridad, papel, ticket = false, children }: HojaImpresaProps) {
  const [imprimiendo, setImprimiendo] = useState(false)

  useEffect(() => {
    // `flushSync`: el navegador compone el papel apenas vuelve del evento, así
    // que la hoja tiene que estar en el DOM antes de que termine.
    const antes = () => flushSync(() => setImprimiendo(true))
    const despues = () => setImprimiendo(false)
    window.addEventListener('beforeprint', antes)
    window.addEventListener('afterprint', despues)
    return () => {
      window.removeEventListener('beforeprint', antes)
      window.removeEventListener('afterprint', despues)
    }
  }, [])

  if (!imprimiendo) return null

  // Margen de página CERO (Fase 239): sin margen el navegador no tiene dónde
  // poner su encabezado y pie con la URL. El margen lo da el padding de la hoja.
  const tamano = ticket ? '80mm auto' : papel === 'carta' ? 'Letter' : 'A4'
  return createPortal(
    <div data-hoja-imprimir={prioridad}>
      <style>{`@page { size: ${tamano}; margin: 0; }`}</style>
      {children()}
    </div>,
    document.body,
  )
}

