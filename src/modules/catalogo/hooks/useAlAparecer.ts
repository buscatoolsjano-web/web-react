import { useEffect, useRef } from 'react'

/**
 * Llama a `onAparecer` la primera vez que el elemento entra en pantalla.
 *
 * Para los historiales del modal del producto (2026-11): «cuando toco un
 * producto y scrolleo tengo que poder ver el histórico». Se siguen pidiendo
 * recién cuando hacen falta —mirar diez productos no son diez consultas—, pero
 * «hacer falta» ahora es llegar con el scroll, no encontrar un botón.
 *
 * Sin `IntersectionObserver` (tests, navegadores viejos) no hace nada: queda
 * el botón.
 */
export function useAlAparecer<T extends Element>(activo: boolean, onAparecer: () => void) {
  const ref = useRef<T>(null)
  const callback = useRef(onAparecer)
  useEffect(() => {
    callback.current = onAparecer
  })

  useEffect(() => {
    const el = ref.current
    if (!activo || !el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) {
          io.disconnect()
          callback.current()
        }
      },
      // Un poco antes de que asome: cuando llega, ya está cargando.
      { rootMargin: '0px 0px 200px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [activo])

  return ref
}
