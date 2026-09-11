import {
  etiquetaDeCotizacion,
  etiquetaDeEstado,
  etiquetaDeEtapa,
  etiquetaDeResultado,
  etiquetaDeSituacion,
  etiquetaDeVeredicto,
  type SituacionEtapa,
} from '../lib/estados'
import styles from './ChipEstado.module.css'

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
 */
export function ChipEstadoOrden({ estado }: ChipProps) {
  const clase =
    estado === 'closed' ? styles.recibido
    : estado === 'cancelled' ? styles.cancelado
    : styles.confirmado
  return <span className={clase}>{etiquetaDeEstado(estado)}</span>
}

/** Dónde está el trabajo. Sin color propio: la etapa no es buena ni mala. */
export function ChipEtapa({ estado }: ChipProps) {
  return <span className={styles.borrador}>{etiquetaDeEtapa(estado)}</span>
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
  const clase =
    estado === 'approved' ? styles.recibido
    : estado === 'rejected' ? styles.cancelado
    : styles.pendiente
  return <span className={clase}>Presupuesto: {etiquetaDeCotizacion(estado)}</span>
}

/** La espera es ortogonal a todo lo demás: sólo aparece cuando está activa. */
export function ChipEspera({ enEspera }: { enEspera: boolean }) {
  if (!enEspera) return null
  return <span className={styles.parcial}>En espera</span>
}

/**
 * La situación de una etapa salteable.
 *
 * Las tres son visualmente distintas porque **«no requerida» no es «pendiente»**
 * y confundirlas era justo lo que había que evitar: una etapa que nunca va a
 * pasar no puede verse igual que una que todavía no pasó.
 */
export function ChipSituacion({ situacion }: { situacion: SituacionEtapa }) {
  const clase =
    situacion === 'completada' ? styles.recibido
    : situacion === 'no-requerida' ? styles.borrador
    : styles.pendiente
  return <span className={clase}>{etiquetaDeSituacion(situacion)}</span>
}

/** El resultado de un punto de revisión: OK, NOK o N/A. */
export function ChipResultado({ estado }: ChipProps) {
  const clase =
    estado === 'ok' ? styles.recibido
    : estado === 'nok' ? styles.cancelado
    : styles.borrador
  return <span className={clase}>{etiquetaDeResultado(estado)}</span>
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
  if (veredicto === null) return <span className={styles.pendiente}>Sin veredicto</span>
  const clase =
    veredicto === 'capaz' ? styles.recibido
    : veredicto === 'aceptable' ? styles.parcial
    : styles.cancelado
  return <span className={clase}>{etiquetaDeVeredicto(veredicto)}</span>
}

/** El equipo dado de baja. La baja es lógica: sus órdenes lo siguen nombrando. */
export function ChipBaja({ dadoDeBaja }: { dadoDeBaja: boolean }) {
  if (!dadoDeBaja) return null
  return <span className={styles.cancelado}>Dado de baja</span>
}
