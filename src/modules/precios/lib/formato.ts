/**
 * Formato de la sección de precios (Fase 56).
 *
 * Vivía suelto dentro de `ListasDePreciosPage` como dos funciones locales, y
 * con el diálogo de desglose pasó a hacer falta en dos lugares. Una segunda
 * definición es una que se va a separar de la primera.
 */

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/**
 * `2026-10-05` → `05 oct 26`. Para los encabezados de columna, que son
 * angostos: con diez listas al lado, cada carácter cuenta.
 *
 * SE ARMA A MANO y no con `toLocaleDateString`. El formato corto de `es-AR`
 * devuelve «05 de oct de 26» —quince caracteres— y esos dos «de» no aportan
 * nada en un encabezado que compite por ancho con nueve columnas más.
 *
 * El `T12:00:00` NO es decorativo: `new Date('2026-10-05')` es medianoche UTC,
 * que en Argentina son las 21:00 del día ANTERIOR, y la columna mostraría la
 * fecha corrida un día respecto de la lista que representa.
 */
export function fechaCorta(iso: string): string {
  const soloFecha = iso.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(soloFecha)) return iso
  const d = new Date(`${soloFecha}T12:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  const dia = String(d.getDate()).padStart(2, '0')
  return `${dia} ${MESES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`
}

/** `2026-10-05` → `5 de octubre de 2026`. Para el desglose, donde hay lugar. */
export function fechaLarga(iso: string): string {
  const soloFecha = iso.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(soloFecha)) return iso
  const d = new Date(`${soloFecha}T12:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
}

/**
 * Un importe con dos decimales, sin símbolo de moneda.
 *
 * Sin símbolo a propósito: en esta pantalla conviven EUR —el costo de las
 * listas— y USD o ARS —lo que se vendió—, y la moneda se escribe aparte para
 * que no se pueda perder al lado del número.
 */
export function formatearImporte(n: number | null | undefined, _moneda?: string | null): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
