/** Los tres documentos que mide la actividad comercial. */
export type TipoActividad = 'entregas' | 'pedidos' | 'cotizaciones'

/** Una moneda del documento, o `SIN MONEDA`. Nunca una conversión. */
export type Moneda = string

export const SIN_MONEDA = 'SIN MONEDA'

/** Una fila tal cual la devuelve `informe_actividad_comercial`. */
export interface FilaActividad {
  /** 'mes' · 'actual' · 'anterior' · 'rango_actual' · 'rango_anterior' */
  periodo: string
  tipo: string | null
  mes: string
  desde: string | null
  hasta: string | null
  moneda: string | null
  documentos: number
  importe: number
  en_revision: number
}

export interface Cifra {
  documentos: number
  importe: number
  enRevision: number
}

export interface Tramo {
  desde: string
  hasta: string
  /** El tramo no cubre el mes entero (mes en curso). */
  parcial: boolean
}

export interface KpiMoneda {
  moneda: Moneda
  actual: Cifra
  anterior: Cifra
  /** Variación porcentual del importe. `null` si el anterior es 0: no hay base. */
  variacion: number | null
}

export interface KpiActividad {
  tipo: TipoActividad
  documentosActual: number
  documentosAnterior: number
  enRevisionActual: number
  /** De los `enRevisionActual`, cuántos no tienen moneda. */
  sinMonedaEnRevisionActual: number
  monedas: KpiMoneda[]
}

export interface MesSerie {
  /** `YYYY-MM-01` */
  mes: string
  porMoneda: Record<Moneda, Cifra>
}

export interface SerieActividad {
  tipo: TipoActividad
  meses: MesSerie[]
  monedas: Moneda[]
}

export interface ActividadComercial {
  actual: Tramo
  anterior: Tramo
  kpis: KpiActividad[]
  series: SerieActividad[]
}

// ── Entrega 2 · pipeline, conversión, cumplimiento y ticket ─────────────────

/** Una fila tal cual la devuelve `informe_pipeline_comercial`. */
export interface FilaPipeline {
  /** rango_actual · rango_anterior · rango_12m · cotizaciones_abiertas · conversion · cumplimiento · pedidos_pendientes · inconsistencias */
  seccion: string
  /** actual · anterior · 12m · hoy · todos */
  periodo: string
  desde: string | null
  hasta: string | null
  categoria: string | null
  moneda: string | null
  documentos: number
  importe: number | null
  convertidas: number | null
  importe_convertido: number | null
  abiertas: number | null
  aceptadas: number | null
}

/** Los tres tramos que comparan conversión, cumplimiento y ticket. */
export type PeriodoCohorte = 'actual' | 'anterior' | '12m'

export const PERIODOS_COHORTE: readonly PeriodoCohorte[] = ['actual', 'anterior', '12m']

export type Antiguedad = 'hasta_30' | '31_90' | 'mas_90'

export const ANTIGUEDADES: readonly Antiguedad[] = ['hasta_30', '31_90', 'mas_90']

export interface CotizacionesAbiertasMoneda {
  moneda: Moneda
  documentos: number
  importe: number
  /** Cuántas de ellas están aceptadas, pero sin pedido. */
  aceptadas: number
  porAntiguedad: Record<Antiguedad, number>
}

export interface ConversionFila {
  /** Una moneda, o `TODAS` (sólo cantidades: los importes no se suman entre monedas). */
  moneda: Moneda
  elegibles: number
  convertidas: number
  /** Enviadas o aceptadas que todavía no tienen pedido. */
  abiertas: number
  aceptadas: number
  /** `null` en `TODAS`. */
  importeElegible: number | null
  importeConvertido: number | null
  /** convertidas / elegibles × 100; `null` sin elegibles. */
  tasa: number | null
}

export interface ConversionPeriodo {
  todas: ConversionFila
  monedas: ConversionFila[]
}

export type CategoriaCumplimiento =
  | 'completo'
  | 'parcial'
  | 'sin_entrega'
  | 'sobreentregado'
  | 'no_consta_entrega'
  | 'detalle_no_reconstruido'
  | 'sin_lineas'

/** Las que se pueden afirmar con evidencia por línea. */
export const CATEGORIAS_DETERMINABLES: readonly CategoriaCumplimiento[] = ['completo', 'parcial', 'sin_entrega', 'sobreentregado']

/** Las que NO: no se convierten en «0 % entregado». */
export const CATEGORIAS_NO_DETERMINABLES: readonly CategoriaCumplimiento[] = ['no_consta_entrega', 'detalle_no_reconstruido', 'sin_lineas']

export interface CumplimientoPeriodo {
  porCategoria: Record<CategoriaCumplimiento, number>
  total: number
  determinables: number
  noDeterminables: number
  /** Completos (incluye sobreentregados) sobre determinables × 100; `null` sin determinables. */
  tasaCompletos: number | null
}

export interface PendienteMoneda {
  moneda: Moneda
  sinEntrega: { documentos: number; importe: number }
  parcial: { documentos: number; importe: number }
}

export interface PipelineComercial {
  tramos: Record<PeriodoCohorte, Tramo>
  abiertas: CotizacionesAbiertasMoneda[]
  conversion: Record<PeriodoCohorte, ConversionPeriodo>
  cumplimiento: Record<PeriodoCohorte | 'todos', CumplimientoPeriodo>
  pendientes: PendienteMoneda[]
  inconsistencias: { monedaDistinta: number; convertidaDesdeBorrador: number }
}

export interface TicketCifra {
  documentos: number
  importe: number
  /** importe / documentos; `null` sin documentos. */
  promedio: number | null
}

export interface TicketMoneda {
  moneda: Moneda
  porPeriodo: Record<PeriodoCohorte, TicketCifra>
}

// ── Entrega 3 · rankings ────────────────────────────────────────────────────

export type DimensionRanking = 'clientes' | 'productos'
export type FuenteRanking = 'entregado' | 'pedido' | 'cotizado'
export type MedidaRanking = 'importe' | 'cantidad'
export type PeriodoRanking = 'mes' | '12m'

export interface ParametrosRanking {
  dimension: DimensionRanking
  fuente: FuenteRanking
  medida: MedidaRanking
  periodo: PeriodoRanking
  /** Obligatoria con importe; `null` con cantidad (lo físico no tiene moneda). */
  moneda: Moneda | null
}

/** Una fila tal cual la devuelve `informe_rankings_comerciales`. */
export interface FilaRanking {
  posicion: number
  total_filas: number
  clave: string
  cliente_id: string | null
  producto_id: string | null
  etiqueta: string
  codigo: string | null
  moneda: string | null
  importe: number | null
  cantidad: number | null
  documentos: number
  lineas_atipicas: number | null
  cantidad_atipica: number | null
  vinculado: boolean
  activo: boolean | null
  desde: string
  hasta: string
}
