/**
 * Tratamientos de impuesto y su alícuota efectiva.
 *
 * Los seis del CHECK de `purchase_order_lines.tax_treatment`. Es la misma
 * lista que usa Ventas y está repetida a propósito: importarla desde Ventas
 * ataría dos secciones que no tienen por qué moverse juntas. Si alguna vez se
 * agrega un tratamiento hay que tocar los dos lados, y por eso el que no
 * figura acá se muestra crudo en vez de desaparecer.
 *
 * Vive en `lib/` y no en `services/`: es un dato, no una llamada a la base.
 * Si estuviera en el service, cualquier componente que lo importe arrastraría
 * el cliente de Supabase y los tests de componentes dejarían de correr sin
 * `.env`. Para eso existe `npm run test:isolated`.
 *
 * **El bug del 1 % del legacy no se puede reproducir**: la alícuota no se
 * escribe a mano salvo en `other`, y la que vale es la que pone
 * `app.tasa_de_tratamiento()` del lado del servidor. La lista de acá es para
 * mostrar la etiqueta y previsualizar el neto mientras se escribe.
 */
export interface Tratamiento {
  valor: string
  etiqueta: string
  /** `null` en `other`: la escribe quien carga el pedido. */
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

export function etiquetaDeTratamiento(tratamiento: string): string {
  return TRATAMIENTOS.find((t) => t.valor === tratamiento)?.etiqueta ?? tratamiento
}
