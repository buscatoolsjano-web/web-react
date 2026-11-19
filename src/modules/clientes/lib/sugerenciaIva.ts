/**
 * Una SUGERENCIA de condición frente al IVA a partir del CUIT, para la carga
 * masiva. Nunca se guarda sola: la persona la confirma.
 *
 * El prefijo del CUIT dice qué es el contribuyente, no su condición de IVA:
 *  · 30, 33 y 34 son personas jurídicas (sociedades). Casi siempre son
 *    Responsables Inscriptos; las excepciones (exentas, como fundaciones o
 *    cooperativas) se corrigen a mano.
 *  · 20, 23, 24 y 27 son personas humanas: pueden ser Responsables Inscriptos
 *    o monotributistas, y eso el CUIT no lo dice. No se sugiere nada.
 *  · Sin CUIT: no se sugiere nada.
 */
export function sugerirCondicionIva(cuit: string | null | undefined): 'responsable_inscripto' | null {
  const digitos = (cuit ?? '').replace(/\D/g, '')
  if (digitos.length !== 11) return null
  return ['30', '33', '34'].includes(digitos.slice(0, 2)) ? 'responsable_inscripto' : null
}
