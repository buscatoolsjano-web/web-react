export type VistaInformes = 'comercial' | 'clientes' | 'stock'

/**
 * `?vista=stock` o `?vista=clientes` eligen la pestaña; cualquier otro valor
 * (o ninguno) es Comercial.
 */
export function leerVista(valor: string | null): VistaInformes {
  if (valor === 'stock') return 'stock'
  if (valor === 'clientes') return 'clientes'
  return 'comercial'
}
