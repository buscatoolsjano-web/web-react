import type {
  ConversionCliente,
  OrdenConversion,
  ParametrosConversion,
  PeriodoConversion,
} from '../types'

/**
 * Las reglas de pantalla de la comparativa cotizaciones ↔ pedidos (Fase 40).
 *
 * Lo que se calcula acá es presentación: textos, avisos y la lectura de la
 * URL. Los números los agrega el servidor y no se tocan.
 */

/** Cotizaciones mínimas para entrar al ranking de «piden mucho». */
export const MINIMO_COTIZACIONES = 3

export const CONVERSION_INICIAL: ParametrosConversion = {
  periodo: '12m',
  moneda: null,
  orden: 'piden_mucho',
  minimo: MINIMO_COTIZACIONES,
}

export const ORDENES: { valor: OrdenConversion; etiqueta: string; ayuda: string }[] = [
  {
    valor: 'piden_mucho',
    etiqueta: 'Piden mucho y compran poco',
    ayuda: `Peor conversión primero, entre los que pidieron al menos ${MINIMO_COTIZACIONES} cotizaciones.`,
  },
  {
    valor: 'cotizaciones',
    etiqueta: 'Los que más cotizan',
    ayuda: 'Más cotizaciones primero, conviertan o no.',
  },
  {
    valor: 'mejor_conversion',
    etiqueta: 'Los que más compran',
    ayuda: `Mejor conversión primero, con el mismo piso de ${MINIMO_COTIZACIONES} cotizaciones: «2 de 2» no es un buen cliente, es poca evidencia.`,
  },
  {
    valor: 'importe',
    etiqueta: 'Por importe cotizado',
    ayuda: 'Más plata cotizada primero. Necesita una moneda elegida.',
  },
]

export const PERIODOS: { valor: PeriodoConversion; etiqueta: string }[] = [
  { valor: '12m', etiqueta: 'Últimos 12 meses' },
  { valor: 'mes', etiqueta: 'Sólo el mes' },
]

/**
 * Por qué el mínimo no es un detalle.
 *
 * Ordenar por tasa de conversión sin un piso de cotizaciones da basura: el
 * primer puesto se lo lleva siempre alguien con UNA cotización y cero pedidos,
 * que no es un problema sino un cliente nuevo. El texto lo dice en pantalla
 * para que nadie lea el ranking como si fueran todos los clientes.
 */
export function explicacionDelOrden(orden: OrdenConversion): string {
  return ORDENES.find((o) => o.valor === orden)?.ayuda ?? ''
}

/** `0.1` → `10 %`. `null` cuando no hay denominador, y se dice, no se inventa. */
export function formatearTasa(tasa: number | null): string {
  if (tasa === null || tasa === undefined) return '—'
  return `${Math.round(tasa * 100)} %`
}

/** `2026-09-16` → `16/09/2026`. Vacío se muestra como «nunca». */
export function formatearFecha(iso: string | null): string {
  if (!iso) return 'nunca'
  const [a, m, d] = iso.split('-')
  return d && m && a ? `${d}/${m}/${a}` : iso
}

/**
 * El tono de la fila, para que el ojo encuentre el problema sin leer números.
 *
 * `alerta` es el caso del que pregunta: pidió varias veces y no compró casi
 * nada. `bien` es lo contrario. El resto no se pinta: si todo está marcado,
 * nada está marcado.
 */
export type TonoFila = 'alerta' | 'bien' | null

export function tonoDeFila(f: ConversionCliente): TonoFila {
  if (f.cotizaciones < MINIMO_COTIZACIONES || f.tasa === null) return null
  if (f.tasa <= 0.25) return 'alerta'
  if (f.tasa >= 0.75) return 'bien'
  return null
}

/**
 * Lo que la fila dice de más, en una frase.
 *
 * Las abiertas son la diferencia entre «nos dijo que no» y «todavía no
 * contestó»: sin eso, una conversión baja parece siempre una pérdida, y muchas
 * veces es trabajo sin terminar.
 */
export function detalleDeFila(f: ConversionCliente): string {
  const partes: string[] = []
  if (f.abiertas > 0) {
    partes.push(`${f.abiertas} ${f.abiertas === 1 ? 'abierta' : 'abiertas'} todavía`)
  }
  const perdidas = f.cotizaciones - f.convertidas - f.abiertas
  if (perdidas > 0) partes.push(`${perdidas} sin pedido`)
  return partes.join(' · ')
}

const ORDENES_VALIDOS = new Set<string>(ORDENES.map((o) => o.valor))
const PERIODOS_VALIDOS = new Set<string>(PERIODOS.map((p) => p.valor))

/** Lee los parámetros de la URL, cayendo a los iniciales si algo no es válido. */
export function leerParametros(params: URLSearchParams): ParametrosConversion {
  const orden = params.get('orden')
  const periodo = params.get('periodo')
  const moneda = params.get('moneda')
  return {
    orden: orden && ORDENES_VALIDOS.has(orden) ? (orden as OrdenConversion) : CONVERSION_INICIAL.orden,
    periodo:
      periodo && PERIODOS_VALIDOS.has(periodo)
        ? (periodo as PeriodoConversion)
        : CONVERSION_INICIAL.periodo,
    moneda: moneda && moneda.trim() !== '' ? moneda : null,
    minimo: MINIMO_COTIZACIONES,
  }
}

/**
 * Deja los parámetros en una combinación que el servidor acepta.
 *
 * Ordenar por importe sin moneda no significa nada —son pesos y dólares
 * sumados—, y el servidor lo rechaza con `sin_moneda`. Acá se evita pedirlo.
 */
export function normalizar(p: ParametrosConversion): ParametrosConversion {
  if (p.orden === 'importe' && p.moneda === null) return { ...p, orden: 'cotizaciones' }
  return p
}
