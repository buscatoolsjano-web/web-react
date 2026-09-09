/**
 * Tratamientos de impuesto y su alícuota efectiva.
 *
 * Vive en `lib/` y no en `services/` a propósito: es un dato, no una llamada
 * a la base. Si estuviera en el service, cualquier componente que lo importe
 * arrastraría el cliente de Supabase —que lee las variables de entorno al
 * importarse— y los tests de componentes dejarían de correr sin `.env`. Ya
 * nos pasó una vez; para eso existe `npm run test:isolated`.
 *
 * La alícuota `null` de `other` significa «la escribe quien cotiza»: no hay
 * un valor por defecto que inventar.
 */
export interface Tratamiento {
  valor: string
  etiqueta: string
  tasa: number | null
}

export const TRATAMIENTOS: Tratamiento[] = [
  { valor: 'vat_21', etiqueta: 'IVA 21 %', tasa: 21 },
  { valor: 'vat_105', etiqueta: 'IVA 10,5 %', tasa: 10.5 },
  { valor: 'vat_0', etiqueta: 'IVA 0 %', tasa: 0 },
  { valor: 'exempt', etiqueta: 'Exento', tasa: 0 },
  { valor: 'not_taxed', etiqueta: 'No gravado', tasa: 0 },
  { valor: 'other', etiqueta: 'Otra alícuota', tasa: null },
]

/** La alícuota que corresponde a un tratamiento; `null` en «otra». */
export function tasaDe(tratamiento: string): number | null {
  return TRATAMIENTOS.find((t) => t.valor === tratamiento)?.tasa ?? null
}
