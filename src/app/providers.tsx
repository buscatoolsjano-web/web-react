import { useState, type ReactNode } from 'react'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { crearQueryClient } from '@/lib/queryClient'
import { persister } from '@/lib/persistCache'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { EmpresaProvider } from '@/features/empresa/EmpresaProvider'
import { AparienciaProvider } from '@/features/apariencia/AparienciaProvider'

/** Día entero: nada persistido se re-hidrata más viejo que esto. */
const VEINTICUATRO_HORAS = 24 * 60 * 60 * 1_000

/**
 * Proveedores globales.
 *
 * El orden importa: QueryClient primero (AuthProvider limpia la caché al
 * cerrar sesión), después Auth, y Empresa al final porque las membresías
 * dependen de que haya sesión. La apariencia (Fase 14) también cuelga de la
 * sesión: sin usuario, siempre el original.
 *
 * `PersistQueryClientProvider` (Fase 122) re-hidrata la caché guardada en
 * IndexedDB al arrancar: recargar o reabrir muestra lo último al instante y
 * revalida en segundo plano. Ver `persistCache.ts`. Sólo se persisten las
 * consultas que terminaron bien —un error no se guarda ni se resucita—.
 */
export function Providers({ children }: { children: ReactNode }) {
  // useState y no una constante de módulo: un cliente por árbol de React,
  // así los tests no comparten caché entre casos.
  const [queryClient] = useState(crearQueryClient)

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: VEINTICUATRO_HORAS,
        buster: __BUILD_ID__,
        dehydrateOptions: {
          shouldDehydrateQuery: (query) => query.state.status === 'success',
        },
      }}
    >
      <AuthProvider>
        <AparienciaProvider>
          <EmpresaProvider>{children}</EmpresaProvider>
        </AparienciaProvider>
      </AuthProvider>
    </PersistQueryClientProvider>
  )
}
