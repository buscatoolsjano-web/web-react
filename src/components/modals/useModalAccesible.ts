import { useEffect, useRef, type RefObject } from 'react'

const ENFOCABLES = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function enfocables(raiz: HTMLElement): HTMLElement[] {
  return [...raiz.querySelectorAll<HTMLElement>(ENFOCABLES)].filter((e) => !e.closest('[inert]') && e.getAttribute('aria-hidden') !== 'true')
}

// Pila de modales abiertos: sólo el de arriba responde a Escape y atrapa el
// foco; el bloqueo de scroll y el `inert` del fondo se liberan con el último.
const pila: symbol[] = []

export interface OpcionesModal {
  onClose: () => void
  /** Mientras es `true`, Escape no cierra. */
  busy?: boolean | undefined
  /** Elemento que recibe el foco al abrir; si falta, el primer control, o la caja. */
  initialFocus?: (() => HTMLElement | null | undefined) | undefined
}

/**
 * Comportamiento de modal accesible, para cualquier caja ya montada:
 * foco inicial adentro, Tab/Shift+Tab atrapados (también si el foco cae al
 * fondo), Escape cierra, `#root` queda `inert` y sin scroll, y al cerrar el
 * foco vuelve a quien abrió. Lo usan `Dialog` y los modales con layout propio
 * (vistas de impresión) que no pueden cambiar de estructura.
 */
export function useModalAccesible(caja: RefObject<HTMLElement | null>, { onClose, busy = false, initialFocus }: OpcionesModal) {
  const clave = useRef(Symbol('modal'))
  // Refs para que los efectos de montaje no se re-ejecuten con cada render.
  const cerrar = useRef(onClose)
  const ocupado = useRef(busy)
  const inicial = useRef(initialFocus)
  useEffect(() => {
    cerrar.current = onClose
    ocupado.current = busy
  })

  // Montaje: pila, foco inicial, inert + scroll lock, retorno del foco.
  useEffect(() => {
    const yo = clave.current
    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const raizApp = document.getElementById('root')
    const dentroDeRaiz = !!(raizApp && caja.current && raizApp.contains(caja.current))
    pila.push(yo)
    if (pila.length === 1) {
      // Un modal que se renderiza dentro de #root no puede volverlo inert
      // (se desactivaría a sí mismo): ahí alcanza con la trampa de foco.
      if (!dentroDeRaiz) raizApp?.setAttribute('inert', '')
      document.body.dataset.dialogScroll = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }

    const destino = inicial.current?.() ?? (caja.current && enfocables(caja.current)[0]) ?? caja.current
    destino?.focus()

    return () => {
      const i = pila.indexOf(yo)
      if (i >= 0) pila.splice(i, 1)
      if (pila.length === 0) {
        raizApp?.removeAttribute('inert')
        document.body.style.overflow = document.body.dataset.dialogScroll ?? ''
        delete document.body.dataset.dialogScroll
      }
      if (previo?.isConnected) previo.focus()
    }
  }, [caja])

  // Teclado a nivel documento: funciona aunque el foco haya caído en el fondo.
  useEffect(() => {
    const alTeclado = (e: KeyboardEvent) => {
      if (pila[pila.length - 1] !== clave.current || !caja.current) return
      if (e.key === 'Escape') {
        e.preventDefault()
        if (!ocupado.current) cerrar.current()
        return
      }
      if (e.key !== 'Tab') return
      const lista = enfocables(caja.current)
      const activo = document.activeElement
      if (lista.length === 0) {
        e.preventDefault()
        caja.current.focus()
        return
      }
      const primero = lista[0]!
      const ultimo = lista[lista.length - 1]!
      const fuera = !caja.current.contains(activo)
      if (e.shiftKey && (fuera || activo === primero || activo === caja.current)) {
        e.preventDefault()
        ultimo.focus()
      } else if (!e.shiftKey && (fuera || activo === ultimo)) {
        e.preventDefault()
        primero.focus()
      }
    }
    document.addEventListener('keydown', alTeclado)
    return () => document.removeEventListener('keydown', alTeclado)
  }, [caja])
}
