import type {
  ActividadComercial,
  DimensionRanking,
  FilaRanking,
  FuenteRanking,
  MedidaRanking,
  Moneda,
  ParametrosRanking,
  PeriodoRanking,
  TipoActividad,
} from '../types'
import { nombreArchivo } from './csv'

/**
 * Reglas de la pantalla de rankings. El servidor valida lo mismo
 * (`parametro_invalido`, `sin_importe`); acá se evita pedir combinaciones que
 * no existen.
 */

export const TOP_N = 10

/** Lo que se ve al entrar: clientes por lo entregado en el mes elegido. */
export const RANKING_INICIAL: ParametrosRanking = { dimension: 'clientes', fuente: 'entregado', medida: 'importe', periodo: 'mes', moneda: null }

export const FUENTE_A_TIPO: Record<FuenteRanking, TipoActividad> = {
  entregado: 'entregas',
  pedido: 'pedidos',
  cotizado: 'cotizaciones',
}

export const ETIQUETA_FUENTE: Record<FuenteRanking, { titulo: string; documentos: string }> = {
  entregado: { titulo: 'Entregado', documentos: 'Remitos' },
  pedido: { titulo: 'Pedido confirmado', documentos: 'Pedidos' },
  cotizado: { titulo: 'Cotizado', documentos: 'Cotizaciones' },
}

/** Clientes: sólo importe. Productos entregados: sólo cantidad (los remitos no tienen precio). */
export function medidasPosibles(dimension: DimensionRanking, fuente: FuenteRanking): MedidaRanking[] {
  if (dimension === 'clientes') return ['importe']
  if (fuente === 'entregado') return ['cantidad']
  return ['importe', 'cantidad']
}

/**
 * Las monedas con documentos de esa fuente en el período, sacadas de los
 * agregados de la actividad (Entrega 1): mes → tramo actual; 12 meses → serie.
 */
export function monedasDisponibles(actividad: ActividadComercial, fuente: FuenteRanking, periodo: PeriodoRanking): Moneda[] {
  const tipo = FUENTE_A_TIPO[fuente]
  if (periodo === 'mes') {
    return actividad.kpis.find((k) => k.tipo === tipo)?.monedas.filter((m) => m.actual.documentos > 0).map((m) => m.moneda) ?? []
  }
  const serie = actividad.series.find((s) => s.tipo === tipo)
  return serie?.monedas.filter((m) => serie.meses.some((x) => (x.porMoneda[m]?.documentos ?? 0) > 0)) ?? []
}

/**
 * Deja los parámetros en una combinación válida: la medida posible, y una
 * moneda existente sólo si la medida es importe. Nunca «todas las monedas».
 */
export function normalizarParametros(p: ParametrosRanking, monedas: readonly Moneda[]): ParametrosRanking {
  const medidas = medidasPosibles(p.dimension, p.fuente)
  const medida = medidas.includes(p.medida) ? p.medida : medidas[0]!
  const moneda = medida === 'cantidad' ? null : p.moneda && monedas.includes(p.moneda) ? p.moneda : (monedas[0] ?? null)
  return { ...p, medida, moneda }
}

/**
 * Dato atípico: la fila tiene líneas con cantidad muy alta e importe 0 (regla
 * del servidor: cantidad >= 1000 y precio 0). Se muestra marcado, no se oculta.
 */
export function esAtipica(f: Pick<FilaRanking, 'lineas_atipicas'>): boolean {
  return (f.lineas_atipicas ?? 0) > 0
}

/** Enlace a la ficha por id real: cliente por UUID, producto por el SKU del catálogo (no el snapshot). */
export function enlaceFicha(f: Pick<FilaRanking, 'cliente_id' | 'producto_id' | 'codigo' | 'vinculado'>): string | null {
  if (f.cliente_id) return `/clientes/${f.cliente_id}`
  if (f.producto_id && f.vinculado && f.codigo) return `/catalogo/${encodeURIComponent(f.codigo)}`
  return null
}

/** `informe-clientes-entregado-USD-mes-2026-09.csv` */
export function archivoRanking(p: ParametrosRanking, mes: string): string {
  return nombreArchivo([p.dimension, p.fuente, p.medida === 'cantidad' ? 'cantidad' : p.moneda, p.periodo, mes])
}

/**
 * Qué ficha abre una fila del ranking, si abre alguna.
 *
 * Es el par de `enlaceFicha`: ésa dice adónde ir, ésta dice qué mostrar
 * encima. Las dos miran lo mismo, así que una fila enlazable es siempre una
 * fila abrible —y las que no lo son (un cliente sin vincular, una línea
 * histórica sin producto del catálogo) no son ni una cosa ni la otra: no hay
 * ficha que abrir.
 */
export function fichaDeFila(
  f: Pick<FilaRanking, 'cliente_id' | 'producto_id' | 'codigo' | 'vinculado'>,
): { tipo: 'cliente' | 'producto'; id: string } | null {
  if (f.cliente_id) return { tipo: 'cliente', id: f.cliente_id }
  if (f.producto_id && f.vinculado && f.codigo) return { tipo: 'producto', id: f.producto_id }
  return null
}
