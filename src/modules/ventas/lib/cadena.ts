/**
 * Los tipos y el orden de la cadena de un documento (Fase 29 · E6).
 *
 * Vive separado de `services/cadena.ts` a propósito: ese archivo importa el
 * cliente de Supabase, y el componente que dibuja la barra sólo necesita los
 * tipos y el orden de los pasos. Si los tomara del servicio, cualquier test
 * del componente arrastraría el cliente entero — que es exactamente lo que
 * `npm run test:isolated` vigila, y lo que atrapó al escribir esto.
 */

/** Un eslabón de la cadena. `null` cuando ese documento todavía no existe. */
export interface EslabonCadena {
  id: string
  numero: string
  estado: string
  /**
   * Cuántos hay de ese tipo colgando del paso anterior.
   *
   * Hoy siempre es 1 —en los datos reales ninguna cotización tiene más de un
   * pedido ni un pedido más de un remito—, pero el esquema no lo impide. Se
   * muestra el primero y, si hay más, la pantalla lo dice en vez de mentir
   * enseñando uno solo como si fuera todo.
   */
  cuantos: number
}

/** La cadena completa de un documento, mire uno desde donde lo mire. */
export interface CadenaDocumento {
  cotizacion: EslabonCadena | null
  pedido: EslabonCadena | null
  entrega: EslabonCadena | null
  factura: EslabonCadena | null
}

/** Los cuatro pasos, en orden. El orden importa: es el de la barra. */
export const PASOS_CADENA = ['cotizacion', 'pedido', 'entrega', 'factura'] as const
export type PasoCadena = (typeof PASOS_CADENA)[number]
