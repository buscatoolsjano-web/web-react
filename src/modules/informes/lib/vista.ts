export type VistaInformes = 'comercial' | 'stock'

/** `?vista=stock` elige la pestaña; cualquier otro valor (o ninguno) es Comercial. */
export function leerVista(valor: string | null): VistaInformes {
  return valor === 'stock' ? 'stock' : 'comercial'
}
