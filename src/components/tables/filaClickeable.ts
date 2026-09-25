import type { KeyboardEvent, MouseEvent } from 'react'

/**
 * Los controles que se manejan solos. Un click acá adentro es del control: el
 * enlace del número navega, el checkbox marca, el menú abre.
 */
const CONTROLES = 'a, button, input, select, textarea, label, [role="button"], [role="link"]'

/**
 * Toda la fila abre el registro, no sólo el enlace de una columna.
 *
 * Nació en el Catálogo (Fase 21 · E1) y vive acá desde la Fase 28 · E10, que
 * es cuando lo pidieron también para Ventas: «no quiero tener que tocar
 * solamente en el número, si no en cualquier parte de la fila». Una sola
 * definición, con las mismas cuatro salvedades, que son las que hacen que se
 * sienta bien y no como una trampa:
 *
 *  · **Ctrl, Cmd y Shift son del navegador**: abrir en otra pestaña y
 *    seleccionar tienen que seguir andando.
 *  · **Un click sobre un control es del control**, no de la fila.
 *  · **Seleccionar texto no abre nada**: copiar un número termina en un click
 *    sobre la fila, y abrir el documento ahí es exactamente lo contrario de
 *    lo que se quería.
 *  · **Enter y espacio** abren, porque la fila es enfocable y quien navega con
 *    teclado tiene que poder hacer lo mismo.
 *
 * La fila NO reemplaza al enlace: el número sigue siendo un `<a>` de verdad,
 * con su URL, para copiarla o abrirla en otra pestaña.
 */
export function filaClickeable<T extends HTMLElement>(abrir: () => void) {
  return {
    tabIndex: 0,
    onClick: (e: MouseEvent<T>) => {
      if (e.defaultPrevented || e.button !== 0) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      if ((e.target as HTMLElement).closest(CONTROLES)) return
      if ((window.getSelection()?.toString() ?? '') !== '') return
      e.currentTarget.focus()
      abrir()
    },
    onKeyDown: (e: KeyboardEvent<T>) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      if (e.target !== e.currentTarget) return
      e.preventDefault()
      abrir()
    },
  }
}
