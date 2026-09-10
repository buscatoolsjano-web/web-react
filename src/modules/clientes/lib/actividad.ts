import type { ActividadMensual, TipoDeDocumento } from '../types'

/**
 * Armado de la serie del gráfico de doce meses.
 *
 * Función pura: la base devuelve sólo los meses que tienen documentos y acá se
 * completan los vacíos, se elige qué se está mirando y se filtra por moneda.
 *
 * La regla que no se negocia: **una serie es UN tipo de documento y UNA
 * moneda**. No hay una barra que sume cotizado con entregado, ni una que sume
 * USD con ARS. El panel del legacy hacía las dos cosas.
 */

export type Medida = 'documentos' | 'importe'

/** Las claves de mes `YYYY-MM-01` de los últimos `n` meses, la última primero. */
export function mesesHasta(hasta: Date, n: number): string[] {
  const meses: string[] = []
  for (let i = n - 1; i >= 0; i -= 1) {
    // Se construye en UTC para que no dependa de la zona horaria del navegador:
    // en Argentina (UTC−3), `new Date(a, m, 1)` de un primero de mes puede caer
    // en el mes anterior al pasarlo a ISO.
    const d = new Date(Date.UTC(hasta.getUTCFullYear(), hasta.getUTCMonth() - i, 1))
    meses.push(d.toISOString().slice(0, 10))
  }
  return meses
}

export interface PuntoDeSerie {
  mes: string
  valor: number
}

export interface OpcionesDeSerie {
  tipo: TipoDeDocumento
  /** `null` = los documentos que no dicen su moneda. */
  moneda: string | null
  medida: Medida
  meses: readonly string[]
}

export function serieDe(
  filas: readonly ActividadMensual[],
  opciones: OpcionesDeSerie,
): PuntoDeSerie[] {
  const porMes = new Map<string, number>()
  for (const f of filas) {
    if (f.tipo !== opciones.tipo) continue
    if ((f.moneda ?? null) !== opciones.moneda) continue
    const valor = opciones.medida === 'documentos' ? f.documentos : f.importe
    porMes.set(f.mes, (porMes.get(f.mes) ?? 0) + valor)
  }
  return opciones.meses.map((mes) => ({ mes, valor: porMes.get(mes) ?? 0 }))
}

/**
 * Las monedas que aparecen, ordenadas por cuántos documentos tienen.
 *
 * `null` —los que no dicen su moneda— va siempre último: es una ausencia de
 * dato, no una moneda.
 */
export function monedasDe(filas: readonly ActividadMensual[]): (string | null)[] {
  const cuenta = new Map<string, number>()
  for (const f of filas) {
    const k = f.moneda ?? ''
    cuenta.set(k, (cuenta.get(k) ?? 0) + f.documentos)
  }
  return [...cuenta.entries()]
    .sort((a, b) => {
      if (a[0] === '') return 1
      if (b[0] === '') return -1
      if (a[1] !== b[1]) return b[1] - a[1]
      return a[0].localeCompare(b[0])
    })
    .map(([m]) => (m === '' ? null : m))
}

/** `2026-01-01` → `ene 26`. Para el eje, que tiene poco lugar. */
export function etiquetaDeMes(mes: string): string {
  const partes = mes.split('-')
  const a = Number(partes[0])
  const m = Number(partes[1])
  if (!Number.isFinite(a) || !Number.isFinite(m)) return mes
  const NOMBRES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  return `${NOMBRES[m - 1] ?? '?'} ${String(a).slice(2)}`
}
