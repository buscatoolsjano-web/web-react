/* eslint-disable react-refresh/only-export-components --
   Este archivo es el manifiesto de rutas, no un módulo de componentes: su
   export principal es `routes`. Los `lazy()` viven acá a propósito, que es
   el patrón estándar de React Router para el code splitting por módulo. */
import { lazy, Suspense, type ReactNode } from 'react'
import type { RouteObject } from 'react-router-dom'
import { AppLayout } from '@/layouts/AppLayout'
import { AuthLayout } from '@/layouts/AuthLayout'
import { ProtectedRoute } from '@/features/auth/ProtectedRoute'

/**
 * Code splitting por módulo.
 *
 * Cada módulo entra con su propio chunk: nadie descarga Compras para mirar
 * el Catálogo.
 */
const DashboardPage = lazy(() =>
  import('@/modules/dashboard/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
)
const CatalogoPage = lazy(() =>
  import('@/modules/catalogo/pages/CatalogoPage').then((m) => ({ default: m.CatalogoPage })),
)
const ProductoDetallePage = lazy(() =>
  import('@/modules/catalogo/pages/ProductoDetallePage').then((m) => ({
    default: m.ProductoDetallePage,
  })),
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

/**
 * Ruta privada.
 *
 * ProtectedRoute es una comodidad de navegación, no el control de acceso:
 * lo que protege los datos es RLS. Alguien que saltee el guard llega a una
 * pantalla donde no puede leer ninguna fila.
 */
function privada(nodo: ReactNode): ReactNode {
  return <ProtectedRoute>{conSuspense(nodo)}</ProtectedRoute>
}

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: privada(<DashboardPage />) },
      { path: 'catalogo', element: privada(<CatalogoPage />) },
      // El identificador es el SKU y no el uuid: es legible, compartible y
      // mantiene la compatibilidad con las URLs del legacy
      // (#/producto/<sku>). Es único por empresa, así que la empresa activa
      // resuelve la ambigüedad.
      { path: 'catalogo/:sku', element: privada(<ProductoDetallePage />) },
    ],
  },
  {
    path: '/auth',
    element: <AuthLayout />,
    children: [{ path: 'login', element: conSuspense(<LoginPage />) }],
  },
  { path: '*', element: conSuspense(<NotFoundPage />) },
]
