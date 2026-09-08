import { useSyncExternalStore } from 'react'

/**
 * Debe coincidir con --bp-mobile en src/styles/tokens.css.
 */
export const MOBILE_BREAKPOINT = 768

/**
 * Suscripción a una media query.
 *
 * Con useSyncExternalStore en vez de useEffect + useState: sin parpadeo en
 * el primer render y sin listeners duplicados.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false, // fallback del servidor / entorno sin window: asumimos desktop
  )
}

/** true cuando el viewport es de celular (< 768px). */
export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
}
