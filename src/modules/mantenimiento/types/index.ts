/**
 * Los tipos de Mantenimiento.
 *
 * Salen del schema de la entrega 1 y **no se inventa ninguno**: si un campo no
 * está en el DDL aprobado, no está acá.
 */

// ── Equipos ────────────────────────────────────────────────────────────────

export interface ActivoListado {
  id: string
  referencia: string
  identificador: string | null
  serie: string | null
  /** Normalizado por la base: mayúsculas sin espacios ni guiones. */
  serieNormalizada: string | null
  duenoId: string | null
  dueno: string | null
  productoId: string | null
  productoSku: string | null
  marca: string | null
  modelo: string | null
  tipo: string | null
  ciudad: string | null
  bajoContrato: boolean
  dadoDeBaja: boolean
  /** Cuántas órdenes tiene. Se deriva contando, no con un contador guardado. */
  ordenes: number
  creadoEn: string
}

export interface ActivoDetalle extends ActivoListado {
  provincia: string | null
  garantiaDesde: string | null
  garantiaHasta: string | null
  notas: string | null
  entregaSerialId: string | null
  /** La procedencia, si el equipo salió de una entrega nuestra. */
  procedencia: {
    serial: string
    fecha: string
    entregaNumero: string | null
  } | null
  autor: string | null
  actualizadoEn: string
}

export interface PaginaDeActivos {
  filas: ActivoListado[]
  total: number
}

export type OrdenActivos = 'referencia' | 'serie' | 'cliente' | 'modelo' | 'alta'

export interface FiltrosActivos {
  /** Serie, referencia o identificador. */
  q: string
  clienteId: string | null
  productoId: string | null
  tipo: string
  /** `''` todos · `activo` · `baja`. */
  estado: string
  pagina: number
  porPagina: number
  orden: OrdenActivos
  direccion: 'asc' | 'desc'
}

export const FILTROS_ACTIVOS_INICIALES: FiltrosActivos = {
  q: '',
  clienteId: null,
  productoId: null,
  tipo: '',
  estado: '',
  pagina: 1,
  porPagina: 25,
  orden: 'alta',
  direccion: 'desc',
}

/** Otro equipo con el mismo serial normalizado. Se avisa, no se bloquea. */
export interface DuplicadoDeSerial {
  id: string
  referencia: string
  modelo: string | null
  serie: string | null
  duenoId: string | null
  creadoEn: string
}

// ── Órdenes ────────────────────────────────────────────────────────────────

export type EstadoOrden = 'open' | 'closed' | 'cancelled'
export type EtapaOrden = 'diagnosis' | 'quotation' | 'repair' | 'torque' | 'closing'
export type EstadoCotizacion = 'pending' | 'approved' | 'rejected'
export type TipoServicio = 'corrective' | 'preventive' | 'general_review'

export interface OrdenListado {
  id: string
  numero: string
  activoId: string
  activoReferencia: string
  activoSerie: string | null
  clienteId: string
  cliente: string
  estado: EstadoOrden
  etapa: EtapaOrden
  enEspera: boolean
  tipoServicio: TipoServicio
  motivoIngreso: string | null
  tecnicoId: string | null
  tecnico: string | null
  fechaIngreso: string
  fechaEntrega: string | null
  estadoCotizacion: EstadoCotizacion
  moneda: string | null
  total: number
}

export interface OrdenDetalle extends OrdenListado {
  serie: string
  activoModelo: string | null
  recibidaPorId: string | null
  recibidaPor: string | null
  condicionVisual: string | null
  notasDiagnostico: string | null
  diagnosticadaEn: string | null
  diagnosticadaPorId: string | null
  requiereReparacion: boolean
  requiereTorque: boolean
  reparadaEn: string | null
  torqueEn: string | null
  enEsperaDesde: string | null
  notasCierre: string | null
  cerradaEn: string | null
  autor: string | null
  creadoEn: string
  actualizadoEn: string
}

export interface PaginaDeOrdenes {
  filas: OrdenListado[]
  total: number
}

export type OrdenDeOrdenes = 'numero' | 'fecha' | 'cliente' | 'etapa'

export interface FiltrosOrdenes {
  /** Número de orden. */
  q: string
  clienteId: string | null
  activoId: string | null
  estado: string
  etapa: string
  tecnicoId: string | null
  enEspera: string
  desde: string
  hasta: string
  pagina: number
  porPagina: number
  orden: OrdenDeOrdenes
  direccion: 'asc' | 'desc'
}

export const FILTROS_ORDENES_INICIALES: FiltrosOrdenes = {
  q: '',
  clienteId: null,
  activoId: null,
  estado: '',
  etapa: '',
  tecnicoId: null,
  enEspera: '',
  desde: '',
  hasta: '',
  pagina: 1,
  porPagina: 25,
  orden: 'fecha',
  direccion: 'desc',
}

// ── Puntos de revisión y checks ────────────────────────────────────────────

export interface PuntoDeRevision {
  id: string
  clave: string
  etiqueta: string
  posicion: number
  activo: boolean
}

export type FaseCheck = 'diagnosis' | 'repair'
export type ResultadoCheck = 'ok' | 'nok' | 'na'

export interface CheckDeOrden {
  id: string
  puntoId: string
  clave: string
  etiqueta: string
  posicion: number
  fase: FaseCheck
  resultado: ResultadoCheck
}

// ── Auditoría ──────────────────────────────────────────────────────────────

export interface EventoDeMantenimiento {
  id: number
  entidad: string
  accion: string
  estadoAnterior: string | null
  estadoNuevo: string | null
  autor: string | null
  fecha: string
  diff: Record<string, unknown> | null
}

// ── Auxiliares ─────────────────────────────────────────────────────────────

/** Un técnico posible: un miembro interno de la empresa. */
export interface Tecnico {
  id: string
  nombre: string
}
