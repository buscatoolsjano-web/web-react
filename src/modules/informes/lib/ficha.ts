/**
 * Abrir encima sin quedarse con el click del navegador (Fase 21 · E3).
 *
 * Vive acá y no en el componente porque es una regla, no una vista, y porque
 * la comparten el ranking y cualquier otra tabla del informe que quiera abrir
 * una ficha.
 */

export interface FichaAbierta {
  tipo: 'cliente' | 'producto'
  id: string
}

/**
 * Decide si un click es «abrir encima» o un click del navegador.
 *
 * Ctrl, Cmd, Shift y Alt son del navegador: pestaña nueva, ventana, selección.
 * Quedárselos convierte un enlace en un botón disfrazado, y el que quería
 * abrir el cliente al lado para comparar se queda sin poder hacerlo.
 */
export function clickDeFicha(abrir: () => void) {
  return (e: React.MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0) return
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    // Seleccionar un nombre para copiarlo también termina en un click.
    if ((window.getSelection()?.toString() ?? '') !== '') return
    e.preventDefault()
    abrir()
  }
}
