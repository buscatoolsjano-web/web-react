import { Badge } from '@/components/ui/Badge'
import {
  etiquetaDeCotizacion,
  etiquetaDeEstado,
  etiquetaDeEtapa,
  etiquetaDeResultado,
  etiquetaDeSituacion,
  etiquetaDeVeredicto,
  type SituacionEtapa,
} from '../lib/estados'

export interface ChipProps {
  estado: string
}

/**
 * Los tres ejes de una orden van en tres chips distintos y nunca en uno solo.
 *
 * El legacy tenía un único estado y no se distinguía «la orden está abierta»
 * de «el trabajo está en reparación» de «el presupuesto está aprobado». Son
 * tres cosas que cambian por separado.
 *
 * Ninguno se distingue sólo por color: cada chip lleva su texto.
 *
 * Fase 13 · E5: los mismos chips como `Badge` del sistema. Etiquetas y
 * códigos son los de `lib/estados`; sólo cambia la presentación.
 */
export function ChipEstadoOrden({ estado }: ChipProps) {
  const etiqueta = etiquetaDeEstado(estado)
  if (estado === 'closed') return <Badge tone="success">{etiqueta}</Badge>
  if (estado === 'cancelled') return <Badge tone="danger" outline>{etiqueta}</Badge>
  return <Badge tone="brand">{etiqueta}</Badge>
}

/** Dónde está el trabajo. Sin color propio: la etapa no es buena ni mala. */
export function ChipEtapa({ estado }: ChipProps) {
  return <Badge tone="neutral">{etiquetaDeEtapa(estado)}</Badge>
}

/**
 * El presupuesto.
 *
 * Lleva la palabra «Presupuesto» adelante y no sólo su estado: al lado del
 * chip de etapa —que puede decir «Cotización»— un chip suelto que dijera
 * «Pendiente» no dejaría claro pendiente de qué. Lo detectó la revisión
 * visual en la ficha de una orden en cotización.
 */
export function ChipCotizacion({ estado }: ChipProps) {
  const texto = `Presupuesto: ${etiquetaDeCotizacion(estado)}`
  if (estado === 'approved') return <Badge tone="success">{texto}</Badge>
  if (estado === 'rejected') return <Badge tone="danger" outline>{texto}</Badge>
  return <Badge tone="warning" dot>{texto}</Badge>
}

/** La espera es ortogonal a todo lo demás: sólo aparece cuando está activa. */
export function ChipEspera({ enEspera }: { enEspera: boolean }) {
  if (!enEspera) return null
  return (
    <Badge tone="warning" dot>
      En espera
    </Badge>
  )
}

/**
 * La situación de una etapa salteable.
 *
 * Las tres son visualmente distintas porque **«no requerida» no es «pendiente»**
 * y confundirlas era justo lo que había que evitar: una etapa que nunca va a
 * pasar no puede verse igual que una que todavía no pasó.
 */
export function ChipSituacion({
  situacion,
  femenina = true,
}: {
  situacion: SituacionEtapa
  femenina?: boolean
}) {
  const etiqueta = etiquetaDeSituacion(situacion, femenina)
  if (situacion === 'completada') return <Badge tone="success">{etiqueta}</Badge>
  if (situacion === 'no-requerida') return <Badge tone="neutral" outline>{etiqueta}</Badge>
  return <Badge tone="warning" dot>{etiqueta}</Badge>
}

/** El resultado de un punto de revisión: OK, NOK o N/A. */
export function ChipResultado({ estado }: ChipProps) {
  const etiqueta = etiquetaDeResultado(estado)
  if (estado === 'ok') return <Badge tone="success">{etiqueta}</Badge>
  if (estado === 'nok') return <Badge tone="danger">{etiqueta}</Badge>
  return <Badge tone="neutral" outline>{etiqueta}</Badge>
}

/**
 * El veredicto de capacidad del torque.
 *
 * Son los TRES que devuelve `capacidad_torque()` —capaz, aceptable,
 * no_capaz—, no dos: el umbral de 1,33 separa «capaz» de «aceptable» y el de
 * 1,00 separa «aceptable» de «no capaz». `null` no es un cuarto veredicto: es
 * que no se puede calcular, y se dice así.
 */
export function ChipVeredicto({ veredicto }: { veredicto: string | null }) {
  if (veredicto === null) return <Badge tone="neutral" outline>Sin veredicto</Badge>
  const etiqueta = etiquetaDeVeredicto(veredicto)
  if (veredicto === 'capaz') return <Badge tone="success">{etiqueta}</Badge>
  if (veredicto === 'aceptable') return <Badge tone="warning" dot>{etiqueta}</Badge>
  return <Badge tone="danger">{etiqueta}</Badge>
}

/** El equipo dado de baja. La baja es lógica: sus órdenes lo siguen nombrando. */
export function ChipBaja({ dadoDeBaja }: { dadoDeBaja: boolean }) {
  if (!dadoDeBaja) return null
  return (
    <Badge tone="danger" outline>
      Dado de baja
    </Badge>
  )
}
