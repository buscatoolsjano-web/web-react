import type { ConversionCliente, ParametrosConversion } from '../types'
import { armar, importe, numero, texto } from './csv'

/**
 * CSV de la comparativa cotizaciones ↔ pedidos (Fase 40).
 *
 * Las mismas convenciones que el resto de Informes: separador `;`, CRLF, la
 * moneda en su propia columna y nunca sumada, importes con punto decimal.
 *
 * Las filas son EXACTAMENTE las de la pantalla —mismo período, mismo orden,
 * misma moneda—, bajadas de a 500 con los mismos parámetros. Un export que no
 * coincide con lo que se está mirando es peor que no tenerlo: nadie lo revisa
 * contra la pantalla antes de mandarlo.
 */
export function conversionClientesACsv(
  filas: readonly ConversionCliente[],
  p: ParametrosConversion,
): string {
  const columnas = [
    'Cliente',
    'Referencia',
    'Cotizaciones',
    'Con pedido',
    'Abiertas',
    'Conversion',
    'Moneda',
    'Importe cotizado',
    'Importe con pedido',
    'Ultima cotizacion',
    'Ultimo pedido',
  ]

  const filasCsv = filas.map((f) => [
    texto(f.cliente),
    texto(f.referencia),
    numero(f.cotizaciones),
    numero(f.convertidas),
    numero(f.abiertas),
    // La tasa va como número entre 0 y 1: una planilla la formatea como
    // porcentaje sola, y «46 %» como texto no se puede promediar.
    f.tasa === null ? '' : numero(Math.round(f.tasa * 10_000) / 10_000),
    texto(p.moneda),
    importe(f.importe_cotizado),
    importe(f.importe_convertido),
    texto(f.ultima_cotizacion),
    texto(f.ultimo_pedido),
  ])

  return armar(columnas, filasCsv)
}
