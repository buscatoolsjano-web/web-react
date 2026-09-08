import { createContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'

export interface AuthContextValue {
  session: Session | null
  user: User | null
  /** true hasta que sabemos si hay sesión o no. Evita el parpadeo al login. */
  cargando: boolean
  salir: () => Promise<void>
}

/**
 * En archivo aparte del provider a propósito: un módulo que exporta un
 * componente Y un valor rompe el Fast Refresh de Vite.
 */
export const AuthContext = createContext<AuthContextValue | null>(null)
