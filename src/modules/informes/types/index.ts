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
