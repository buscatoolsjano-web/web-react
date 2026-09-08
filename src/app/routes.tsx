/* eslint-disable react-refresh/only-export-components --
   Este archivo es el manifiesto de rutas, no un módulo de componentes: su
   export principal es `routes`. Los `lazy()` viven acá a propósito, que es
   el patrón estándar de React Router para el code splitting por módulo. */
import { lazy, Suspense, type ReactNode } from 'react'
import type { RouteObject } from 'react-router-dom'
import { AppLayout } from '@/layouts/AppLayout'
import { AuthLayout } from '@/layouts/AuthLayout'

/**
 * Code splitting por módulo.
 *
 * Cada módulo entra con su propio chunk: nadie descarga Compras para mirar
 * el Catálogo. En Fase 1 solo Dashboard existe; los demás se van sumando
 * acá con el mismo patrón.
 */
const DashboardPage = lazy(() =>
  import('@/modules/dashboard/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
)
const LoginPage = lazy(() =>
  import('@/features/auth/pages/LoginPage').then((m) => ({ default: m.LoginPage })),
)
const NotFoundPage = lazy(() =>
  import('@/app/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
)

function conSuspense(nodo: ReactNode): ReactNode {
  return <Suspense fallback={<p style={{ padding: '1rem' }}>Cargando…</p>}>{nodo}</Suspense>
}

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    children: [{ index: true, element: conSuspense(<DashboardPage />) }],
  },
  {
    path: '/auth',
    element: <AuthLayout />,
    children: [{ path: 'login', element: conSuspense(<LoginPage />) }],
  },
  { path: '*', element: conSuspense(<NotFoundPage />) },
]
