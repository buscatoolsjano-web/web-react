import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { Navigate, type RouteObject } from 'react-router-dom'
import { AppLayout } from '@/layouts/AppLayout'
import { AuthLayout } from '@/layouts/AuthLayout'
import { ProtectedRoute } from '@/features/auth/ProtectedRoute'
import { ErrorPage } from '@/app/ErrorPage'

const CLAVE_RECARGA = 'bt-chunk-recargado'

/**
 * `lazy()` que sobrevive a un deploy.
 *
 * Vite le pone un hash al nombre de cada chunk. Si alguien tiene la app
 * abierta cuando se publica una versión nueva, los archivos del build
 * viejo dejan de existir: al navegar a una ruta que todavía no cargó, el
 * import dinámico falla con un 404 y React Router muestra un stack trace.
 *
 * Pasó de verdad probando en producción: con la app abierta se desplegó
 * una versión y el botón "Salir" tiró
 * "Failed to fetch dynamically imported module".
 *
 * La solución estándar es recargar UNA vez —así el navegador pide el
 * index.html nuevo con los hashes nuevos— y sólo una, para que un fallo
 * real de red no deje la página en un bucle de recargas.
 */
function lazyConRecarga(importar: () => Promise<{ default: ComponentType }>) {
  return lazy(async () => {
    try {
      const modulo = await importar()
      // Cargó bien: se limpia la marca para que un futuro deploy vuelva a
      // tener su reintento disponible.
      try {
        sessionStorage.removeItem(CLAVE_RECARGA)
      } catch {
        /* storage bloqueado: no cambia nada */
      }
      return modulo
    } catch (error) {
      let yaSeIntento = true
      try {
        yaSeIntento = sessionStorage.getItem(CLAVE_RECARGA) !== null
        if (!yaSeIntento) sessionStorage.setItem(CLAVE_RECARGA, '1')
      } catch {
        /* sin storage no se puede saber; se prefiere no recargar en bucle */
      }

      if (yaSeIntento) throw error

      window.location.reload()
      // La página se está recargando: esta promesa no tiene que resolver
      // nunca, o React pintaría un error a medio camino.
      return new Promise<never>(() => {})
    }
  })
}

/**
 * Code splitting por módulo.
 *
 * Cada módulo entra con su propio chunk: nadie descarga Compras para mirar
 * el Catálogo.
 */
const DashboardPage = lazyConRecarga(() =>
  import('@/modules/dashboard/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
)
const CatalogoPage = lazyConRecarga(() =>
  import('@/modules/catalogo/pages/CatalogoPage').then((m) => ({ default: m.CatalogoPage })),
)
const ProductoDetallePage = lazyConRecarga(() =>
  import('@/modules/catalogo/pages/ProductoDetallePage').then((m) => ({
    default: m.ProductoDetallePage,
  })),
)
const CotizacionesPage = lazyConRecarga(() =>
  import('@/modules/ventas/pages/CotizacionesPage').then((m) => ({ default: m.CotizacionesPage })),
)
const CotizacionNuevaPage = lazyConRecarga(() =>
  import('@/modules/ventas/pages/CotizacionNuevaPage').then((m) => ({
    default: m.CotizacionNuevaPage,
  })),
)
const CotizacionDetallePage = lazyConRecarga(() =>
  import('@/modules/ventas/pages/CotizacionDetallePage').then((m) => ({
    default: m.CotizacionDetallePage,
  })),
)
const PedidosPage = lazyConRecarga(() =>
  import('@/modules/ventas/pages/PedidosPage').then((m) => ({ default: m.PedidosPage })),
)
const PedidoNuevoPage = lazyConRecarga(() =>
  import('@/modules/ventas/pages/PedidoNuevoPage').then((m) => ({ default: m.PedidoNuevoPage })),
)
const PedidoDetallePage = lazyConRecarga(() =>
  import('@/modules/ventas/pages/PedidoDetallePage').then((m) => ({
    default: m.PedidoDetallePage,
  })),
)
const EntregasPage = lazyConRecarga(() =>
  import('@/modules/ventas/pages/EntregasPage').then((m) => ({ default: m.EntregasPage })),
)
const EntregaDetallePage = lazyConRecarga(() =>
  import('@/modules/ventas/pages/EntregaDetallePage').then((m) => ({
    default: m.EntregaDetallePage,
  })),
)
const LoginPage = lazyConRecarga(() =>
  import('@/features/auth/pages/LoginPage').then((m) => ({ default: m.LoginPage })),
)
const NotFoundPage = lazyConRecarga(() =>
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
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: privada(<DashboardPage />) },
      { path: 'catalogo', element: privada(<CatalogoPage />) },
      // El identificador es el SKU y no el uuid: es legible, compartible y
      // mantiene la compatibilidad con las URLs del legacy
      // (#/producto/<sku>). Es único por empresa, así que la empresa activa
      // resuelve la ambigüedad.
      { path: 'catalogo/:sku', element: privada(<ProductoDetallePage />) },

      // Ventas. `#/ventas` no tiene pantalla propia: un tablero de Ventas
      // sería una idea nueva y esto es una migración, así que redirige a la
      // primera subsección, igual que el legacy al entrar a la sección.
      { path: 'ventas', element: <Navigate to="/ventas/cotizaciones" replace /> },
      { path: 'ventas/cotizaciones', element: privada(<CotizacionesPage />) },
      // `nueva` antes que `:id`: si no, React Router la tomaría como un id.
      { path: 'ventas/cotizaciones/nueva', element: privada(<CotizacionNuevaPage />) },
      { path: 'ventas/cotizaciones/:id', element: privada(<CotizacionDetallePage />) },
      { path: 'ventas/pedidos', element: privada(<PedidosPage />) },
      { path: 'ventas/pedidos/nuevo', element: privada(<PedidoNuevoPage />) },
      { path: 'ventas/pedidos/:id', element: privada(<PedidoDetallePage />) },
      { path: 'ventas/entregas', element: privada(<EntregasPage />) },
      { path: 'ventas/entregas/:id', element: privada(<EntregaDetallePage />) },
    ],
  },
  {
    path: '/auth',
    element: <AuthLayout />,
    errorElement: <ErrorPage />,
    children: [{ path: 'login', element: conSuspense(<LoginPage />) }],
  },
  { path: '*', element: conSuspense(<NotFoundPage />), errorElement: <ErrorPage /> },
]
