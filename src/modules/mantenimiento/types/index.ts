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
  /** Subtotal de la cotización. Sin impuestos: no existen en este modelo. */
  subtotal: number
  /** La fecha en que el cliente aprobó. Es `date`, no timestamp. */
  aprobadaEn: string | null
  /** El nombre escrito a mano de quien aprobó, del lado del CLIENTE. */
  quienAprobo: string | null
  notasCotizacion: string | null
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
  notasReparacion: string | null
  horasManoDeObra: number | null
  torqueLsl: number | null
  torqueNominal: number | null
  torqueUsl: number | null
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

// ── Cotización ─────────────────────────────────────────────────────────────

/** Los cinco tipos del CHECK de `maintenance_quote_lines.line_type`. */
export type TipoLineaCotizacion = 'labour' | 'part' | 'freight' | 'diagnosis' | 'other'

export interface LineaCotizacion {
  id: string
  /** Posición, única por orden. No es la identidad: la identidad es el uuid. */
  posicion: number
  tipo: TipoLineaCotizacion
  productoId: string | null
  sku: string | null
  descripcion: string | null
  cantidad: number
  precioUnitario: number
  /** Lo calcula el servidor. Acá sólo se muestra. */
  total: number
}

/** Lo que la pantalla manda al crear o editar una línea. */
export interface DatosLinea {
  posicion: number
  tipo: TipoLineaCotizacion
  productoId: string | null
  sku: string | null
  descripcion: string
  cantidad: number
  precioUnitario: number
}

// ── Repuestos ──────────────────────────────────────────────────────────────

export interface RepuestoDeOrden {
  id: string
  productoId: string
  sku: string | null
  nombre: string | null
  depositoId: string
  deposito: string | null
  cantidad: number
  /** Carga manual o nulo: no hay ninguna fuente de costo confiable. */
  costoUnitario: number | null
  monedaCosto: string | null
  consumidoEn: string | null
  movimientoId: number | null
  /** Saldo del producto en ese depósito. Se lee aparte. */
  stockActual: number | null
}

export interface DatosRepuesto {
  productoId: string
  sku: string | null
  nombre: string | null
  depositoId: string
  cantidad: number
  costoUnitario: number | null
  monedaCosto: string | null
}

export interface Deposito {
  id: string
  codigo: string
  nombre: string
  porDefecto: boolean
}

// ── Torque ─────────────────────────────────────────────────────────────────

/**
 * Una medición de torque.
 *
 * El alcance es el del sistema anterior y ni un campo más: no hay unidad, ni
 * instrumento, ni certificado, ni técnico por medición. `valor` es el que
 * cuenta —el que promedia `capacidad_torque()` y el que exige el cierre—;
 * `minimo` y `maximo` son contexto de la toma y no entran en el cálculo.
 */
export interface Medicion {
  id: string
  /** Posición, única por orden. La identidad es el uuid. */
  fila: number
  valor: number | null
  minimo: number | null
  maximo: number | null
}

export interface DatosMedicion {
  fila: number
  valor: number | null
  minimo: number | null
  maximo: number | null
}

/** Los límites de la especificación. Viven en la orden, no en la medición. */
export interface LimitesTorque {
  lsl: number | null
  nominal: number | null
  usl: number | null
}

export type VeredictoTorque = 'capaz' | 'aceptable' | 'no_capaz'

/**
 * Lo que devuelve `capacidad_torque()`.
 *
 * **Nada de esto se guarda**: se calcula en el servidor cada vez. Cualquier
 * indicador puede venir `null` —con menos de dos mediciones o con todas
 * iguales no hay desvío y Cp/Cpk/CV no existen— y la pantalla muestra «N/D»
 * en vez de inventar un número.
 */
export interface CapacidadTorque {
  mediciones: number
  promedio: number | null
  desvio: number | null
  promedioMin: number | null
  promedioMax: number | null
  cp: number | null
  cpk: number | null
  /** En PORCENTAJE: la función devuelve (sd / μ) × 100. */
  cv: number | null
  veredicto: VeredictoTorque | null
}

// ── Cierre ─────────────────────────────────────────────────────────────────

/**
 * El precheck del cierre.
 *
 * `bloqueos` sale de `app.bloqueos_de_cierre_mant()`, **la misma** función que
 * usa `cerrar_orden_mantenimiento()` para decidir si deja cerrar. No hay una
 * segunda copia de las reglas acá ni en el navegador.
 */
export interface PrecheckCierre {
  estado: EstadoOrden
  yaCerrada: boolean
  puedeCerrar: boolean
  bloqueos: string[]
  enEspera: boolean
  etapa: EtapaOrden
  diagnosticada: boolean
  cotizacion: EstadoCotizacion
  lineas: number
  requiereReparacion: boolean
  reparada: boolean
  requiereTorque: boolean
  torqueHecho: boolean
  mediciones: number
  repuestosPendientes: number
  repuestosConsumidos: number
  entregada: string | null
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
