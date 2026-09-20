import { useLocation } from 'react-router-dom'
import { RUTA_DE, type TipoDocumento } from '../types'

/** Lo que la lista le pasa al detalle para que sepa a dónde volver. */
export interface EstadoDeVuelta {
  /** El query string del listado, tal cual estaba: `?estado=sent&page=4`. */
  volverA?: string
}

/**
 * El link de «volver» del detalle, con el listado como estaba.
 *
 * Hasta la Fase 19 · E2 los tres detalles volvían a una ruta fija
 * (`/ventas/cotizaciones`), así que filtrar, ir a la página 4, abrir un
 * documento y volver te dejaba en la página 1 sin filtros. El «atrás» del
 * navegador sí los conservaba —los filtros viven en la URL desde la Fase 15—,
 * con lo cual el botón de la pantalla era peor que el del navegador.
 *
 * Se resuelve con el `state` del router y no metiendo el query string en el
 * `href` del documento: la URL de una cotización tiene que seguir siendo
 * `/ventas/cotizaciones/<id>` y nada más, para que se pueda compartir.
 *
 * Quien llega por un link directo no trae `state`, y entonces vuelve al
 * listado sin filtros, que es lo correcto: nunca estuvo en uno.
 */
export function useVolverAlListado(tipo: TipoDocumento, etiqueta: string) {
  // `useLocation().state` es `any`: se estrecha acá y no se usa crudo.
  const ubicacion = useLocation()
  const estado = ubicacion.state as EstadoDeVuelta | null
  const guardado = estado?.volverA
  // Se valida antes de usarlo: el `state` lo controla quien navega, y no se
  // arma un destino con algo que no sea un query string.
  const sufijo = typeof guardado === 'string' && guardado.startsWith('?') ? guardado : ''
  return { to: `${RUTA_DE[tipo]}${sufijo}`, label: etiqueta }
}
