import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { cerrarSesion, obtenerSesion, suscribirCambiosDeSesion } from '@/services/auth/session'
import { AuthContext, type AuthContextValue } from './authContext'


/**
 * Sesión real de Supabase Auth.
 *
 * `cargando` arranca en true porque recuperar la sesión persistida es
 * asíncrono. Sin ese estado, en el primer render no hay sesión todavía y
 * ProtectedRoute mandaría al login a alguien que sí está autenticado — el
 * clásico parpadeo al refrescar.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [cargando, setCargando] = useState(true)
  const queryClient = useQueryClient()

  useEffect(() => {
    let vivo = true

    // 1. Sesión persistida (refresco de página, pestaña nueva).
    void obtenerSesion().then((s) => {
      if (!vivo) return
      setSession(s)
      setCargando(false)
    })

    // 2. Cambios posteriores: login, logout, refresh del token.
    const desuscribir = suscribirCambiosDeSesion((evento, s) => {
      if (!vivo) return
      setSession(s)
      setCargando(false)

      // Al cerrar sesión, la caché se vacía entera. Si no, volver atrás
      // con el navegador muestra los datos del usuario anterior.
      if (evento === 'SIGNED_OUT') queryClient.clear()
    })

    return () => {
      vivo = false
      desuscribir()
    }
  }, [queryClient])

  const valor = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      cargando,
      salir: async () => {
        await cerrarSesion()
        queryClient.clear()
      },
    }),
    [session, cargando, queryClient],
  )

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>
}
