import { useState, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { crearQueryClient } from '@/lib/queryClient'

/**
 * Proveedores globales de la aplicación.
 *
 * En Fase 2.5 se suman acá AuthProvider y EmpresaProvider, en ese orden
 * (la empresa activa depende de la sesión).
 */
export function Providers({ children }: { children: ReactNode }) {
  // useState y no una constante de módulo: un cliente por árbol de React,
  // así los tests no comparten caché entre casos.
  const [queryClient] = useState(crearQueryClient)

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
