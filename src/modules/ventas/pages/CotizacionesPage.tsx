import { ListadoPage } from './ListadoPage'

export function CotizacionesPage() {
  // Una cotización no tiene documento de origen: es el principio del circuito.
  return <ListadoPage tipo="cotizacion" titulo="Cotizaciones" etiquetaOrigen={null} />
}
