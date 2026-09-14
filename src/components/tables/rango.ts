export interface Sustantivo {
  singular: string
  plural: string
}

const numero = new Intl.NumberFormat('es-AR')

/** «1 evento», «0 eventos», «1.234 pedidos». */
export function contar(n: number, s: Sustantivo): string {
  return `${numero.format(n)} ${n === 1 ? s.singular : s.plural}`
}

/** «1–50 de 1.234 pedidos» · «1–1 de 1 evento» · «0 pedidos». */
export function rangoTexto(offset: number, pageSize: number, total: number, s: Sustantivo): string {
  if (total <= 0) return contar(0, s)
  const desde = Math.min(offset + 1, total)
  const hasta = Math.min(offset + pageSize, total)
  return `${numero.format(desde)}–${numero.format(hasta)} de ${contar(total, s)}`
}
