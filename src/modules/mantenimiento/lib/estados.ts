import type {
  EstadoCotizacion,
  EstadoOrden,
  EtapaOrden,
  ResultadoCheck,
  TipoLineaCotizacion,
  TipoServicio,
} from '../types'

/**
 * Los tres ejes de estado de una orden, en castellano.
 *
 * Son independientes a propósito y no se mezclan en un solo `status`:
 *
 *   · `status` es el ciclo de vida del documento.
 *   · `stage` es dónde está el trabajo.
 *   · `quote_status` es del presupuesto.
 *
 * Un valor que no esté en la tabla se muestra crudo en vez de desaparecer.
 */

const ESTADOS: Record<EstadoOrden, string> = {
  open: 'Abierta',
  closed: 'Cerrada',
  cancelled: 'Cancelada',
}

/** Las cinco etapas del circuito real del legacy, en su orden. */
export const ETAPAS: { valor: EtapaOrden; etiqueta: string }[] = [
  { valor: 'diagnosis', etiqueta: 'Diagnóstico' },
  { valor: 'quotation', etiqueta: 'Cotización' },
  { valor: 'repair', etiqueta: 'Reparación' },
  { valor: 'torque', etiqueta: 'Torque' },
  { valor: 'closing', etiqueta: 'Cierre' },
]

const COTIZACION: Record<EstadoCotizacion, string> = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  rejected: 'Rechazada',
}

const SERVICIOS: Record<TipoServicio, string> = {
  corrective: 'Correctivo',
  preventive: 'Preventivo',
  general_review: 'Revisión general',
}

const RESULTADOS: Record<ResultadoCheck, string> = {
  ok: 'OK',
  nok: 'NOK',
  na: 'N/A',
}

export function etiquetaDeEstado(v: string): string {
  return ESTADOS[v as EstadoOrden] ?? v
}

export function etiquetaDeEtapa(v: string): string {
  return ETAPAS.find((e) => e.valor === v)?.etiqueta ?? v
}

export function etiquetaDeCotizacion(v: string): string {
  return COTIZACION[v as EstadoCotizacion] ?? v
}

export function etiquetaDeServicio(v: string): string {
  return SERVICIOS[v as TipoServicio] ?? v
}

export function etiquetaDeResultado(v: string): string {
  return RESULTADOS[v as ResultadoCheck] ?? v
}

export const OPCIONES_ESTADO = (Object.keys(ESTADOS) as EstadoOrden[])
  .map((v) => ({ valor: v, etiqueta: ESTADOS[v] }))
export const OPCIONES_COTIZACION = (Object.keys(COTIZACION) as EstadoCotizacion[])
  .map((v) => ({ valor: v, etiqueta: COTIZACION[v] }))
export const OPCIONES_SERVICIO = (Object.keys(SERVICIOS) as TipoServicio[])
  .map((v) => ({ valor: v, etiqueta: SERVICIOS[v] }))

/**
 * Los cinco tipos de línea del CHECK de `maintenance_quote_lines`.
 *
 * `labour` es el default de la base y es lo que más se cotiza en un taller:
 * la mano de obra. `part` es el repuesto que se le COBRA al cliente, que no
 * es lo mismo que el repuesto que se consume del depósito.
 */
const TIPOS_LINEA: Record<TipoLineaCotizacion, string> = {
  labour: 'Mano de obra',
  part: 'Repuesto',
  freight: 'Flete',
  diagnosis: 'Diagnóstico',
  other: 'Otro',
}

export function etiquetaDeTipoLinea(v: string): string {
  return TIPOS_LINEA[v as TipoLineaCotizacion] ?? v
}

export const OPCIONES_TIPO_LINEA = (Object.keys(TIPOS_LINEA) as TipoLineaCotizacion[])
  .map((v) => ({ valor: v, etiqueta: TIPOS_LINEA[v] }))

/**
 * Las tres monedas que existen en `currencies`.
 *
 * No se inventa ninguna: la columna tiene FK a esa tabla, así que una cuarta
 * la rechazaría la base.
 */
export const MONEDAS = ['ARS', 'USD', 'EUR'] as const

/**
 * Qué se puede hacer con la cotización según su estado.
 *
 * `approved` y `rejected` son FINALES. Lo impone el servidor; acá sólo se
 * deja de ofrecer lo que iba a ser rechazado.
 */
export function editabilidadDeCotizacion(
  estadoCotizacion: string,
  estadoOrden: EstadoOrden,
): { lineas: boolean; moneda: boolean; resolver: boolean } {
  const abierta = estadoOrden === 'open'
  const pendiente = estadoCotizacion === 'pending'
  return {
    lineas: abierta && pendiente,
    moneda: abierta && pendiente,
    resolver: abierta && pendiente,
  }
}

/**
 * Los ocho motivos de ingreso del legacy. Lista abierta: el schema no tiene
 * CHECK sobre `entry_reason`, así que se puede escribir otro.
 */
export const MOTIVOS_INGRESO = [
  'FALLA DE CORTE',
  'FALLA ELECTRICA',
  'GOLPE/CAIDA',
  'ACTUALIZACIÓN FIRMWARE',
  'MANTENIMIENTO PREVENTIVO',
  'REVISIÓN GENERAL',
  'CALIBRACIÓN TORQUE',
  'OTRO',
] as const

/**
 * La secuencia de etapas que corresponde a una orden, salteando las que están
 * marcadas como no requeridas.
 *
 * Es la misma cuenta que hace `app.etapas_requeridas()` del lado del servidor.
 * Acá existe para no ofrecer un botón que el servidor va a rechazar; **la que
 * manda es la del servidor**.
 */
export function etapasRequeridas(
  requiereReparacion: boolean,
  requiereTorque: boolean,
): EtapaOrden[] {
  const todas: (EtapaOrden | null)[] = [
    'diagnosis',
    'quotation',
    requiereReparacion ? 'repair' : null,
    requiereTorque ? 'torque' : null,
    'closing',
  ]
  return todas.filter((e): e is EtapaOrden => e !== null)
}

/** La etapa siguiente, o `null` si ya está en la última. */
export function etapaSiguiente(
  actual: EtapaOrden,
  requiereReparacion: boolean,
  requiereTorque: boolean,
): EtapaOrden | null {
  const seq = etapasRequeridas(requiereReparacion, requiereTorque)
  const i = seq.indexOf(actual)
  return i >= 0 && i < seq.length - 1 ? (seq[i + 1] ?? null) : null
}

/** Las etapas anteriores a la actual: a cualquiera de ellas se puede volver. */
export function etapasAnteriores(
  actual: EtapaOrden,
  requiereReparacion: boolean,
  requiereTorque: boolean,
): EtapaOrden[] {
  const seq = etapasRequeridas(requiereReparacion, requiereTorque)
  const i = seq.indexOf(actual)
  return i > 0 ? seq.slice(0, i) : []
}

/**
 * Las tres situaciones de una etapa salteable, sin ambigüedad.
 *
 * Es la lectura de los dos campos que el schema garantiza con un CHECK:
 * «no requerida y completada» no existe.
 */
export type SituacionEtapa = 'pendiente' | 'completada' | 'no-requerida'

export function situacionDeEtapa(requerida: boolean, completadaEn: string | null): SituacionEtapa {
  if (!requerida) return 'no-requerida'
  return completadaEn === null ? 'pendiente' : 'completada'
}

export function etiquetaDeSituacion(s: SituacionEtapa): string {
  return { pendiente: 'Pendiente', completada: 'Completada', 'no-requerida': 'No requerida' }[s]
}

/** Qué se puede tocar según el estado. Lo impone el servidor; acá no se ofrece. */
export function editabilidadDe(estado: EstadoOrden): {
  cabecera: boolean
  etapa: boolean
  checks: boolean
  cancelar: boolean
} {
  const abierta = estado === 'open'
  return { cabecera: abierta, etapa: abierta, checks: abierta, cancelar: abierta }
}
