/**
 * La condición frente al IVA del cliente (`customers.tax_condition`).
 *
 * Decide si corresponde factura A o B, y sin ella no se factura: la base lo
 * exige en `crear_factura_desde_pedido`.
 */
export const CONDICIONES_IVA = [
  { valor: 'responsable_inscripto', etiqueta: 'Responsable Inscripto' },
  { valor: 'monotributo', etiqueta: 'Monotributista' },
  { valor: 'exento', etiqueta: 'IVA Exento' },
  { valor: 'consumidor_final', etiqueta: 'Consumidor Final' },
  { valor: 'no_responsable', etiqueta: 'No Responsable' },
  { valor: 'exterior', etiqueta: 'Cliente del exterior' },
] as const

export type CondicionIva = (typeof CONDICIONES_IVA)[number]['valor']

export function etiquetaCondicionIva(valor: string | null | undefined): string | null {
  if (!valor) return null
  return CONDICIONES_IVA.find((c) => c.valor === valor)?.etiqueta ?? valor
}

/** Sin CUIT sólo se puede facturar a un consumidor final o al exterior. */
export function pideCuit(valor: string | null | undefined): boolean {
  return valor !== 'consumidor_final' && valor !== 'exterior'
}
