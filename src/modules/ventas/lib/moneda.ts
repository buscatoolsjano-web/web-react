/**
 * Moneda de los documentos de venta (Fase 14 E3).
 *
 * No hay moneda por defecto: una cotización sin moneda no se guarda, y un
 * pedido o un remito conservan la moneda de su documento de origen. La base lo
 * impone con `app.exigir_moneda_documento` (DOCUMENT_CURRENCY_REQUIRED /
 * DOCUMENT_CURRENCY_MISMATCH); esto lo anticipa ANTES de pedir un número, para
 * no quemar uno de la serie en un guardado que va a fallar.
 *
 * FX_POLICY = UNDEFINED: no se convierte entre monedas. Un precio de lista en
 * otra moneda no se sugiere (ver `precioSugerido`).
 */

/** Las monedas de `public.currencies`. */
export const MONEDAS_DOCUMENTO = ['USD', 'ARS', 'EUR'] as const

export const CODIGO_MONEDA_REQUERIDA = 'DOCUMENT_CURRENCY_REQUIRED'

/** Devuelve la moneda o corta con el código estable. Nunca completa un valor. */
export function exigirMoneda(moneda: string | null | undefined): string {
  const m = (moneda ?? '').trim()
  if (!m) throw new Error(CODIGO_MONEDA_REQUERIDA)
  return m
}
