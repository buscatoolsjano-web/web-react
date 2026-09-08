import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './useAuth'

/**
 * Puerta de entrada a las rutas privadas.
 *
 * Es una comodidad de navegación, NO un control de seguridad: lo que
 * protege los datos es RLS en Postgres. Alguien que saltee este componente
 * llega a una pantalla que no puede leer ninguna fila.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, cargando } = useAuth()
  const location = useLocation()

  if (cargando) {
    return (
      <p style={{ padding: 'var(--space-4)', color: 'var(--text-soft)' }} role="status">
        Verificando sesión…
      </p>
    )
  }

  if (!session) {
    // `next` permite volver a donde el usuario quería ir.
    const destino = `${location.pathname}${location.search}`
    return <Navigate to={`/auth/login?next=${encodeURIComponent(destino)}`} replace />
  }

  return <>{children}</>
}
