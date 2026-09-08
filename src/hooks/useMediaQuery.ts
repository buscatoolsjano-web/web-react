import { useCallback, useSyncExternalStore } from 'react'

/**
 * Debe coincidir con --bp-mobile en src/styles/tokens.css.
 */
export const MOBILE_BREAKPOINT = 768

/**
 * Suscripción a una media query.
 *
 * Con useSyncExternalStore en vez de useEffect + useState: sin parpadeo en
 * el primer render y sin listeners duplicados.
 *
 * `subscribe` y `getSnapshot` van memoizados por `query`. Sin eso React
 * recibe funciones nuevas en cada render y se desuscribe/resuscribe cada
 * vez — este hook lo usa toda lista de la app, así que la diferencia se
 * acumula.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    [query],
  )

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query])

  // Fallback para entornos sin `window` (SSR, tests de nodo): asumimos
  // escritorio, que es el layout más conservador.
  const getServerSnapshot = useCallback(() => false, [])

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/** true cuando el viewport es de celular (< 768px). */
export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
}
