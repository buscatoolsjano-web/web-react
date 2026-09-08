import { useState, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { crearQueryClient } from '@/lib/queryClient'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { EmpresaProvider } from '@/features/empresa/EmpresaProvider'

/**
 * Proveedores globales.
 *
 * El orden importa: QueryClient primero (AuthProvider limpia la caché al
 * cerrar sesión), después Auth, y Empresa al final porque las membresías
 * dependen de que haya sesión.
 */
export function Providers({ children }: { children: ReactNode }) {
  // useState y no una constante de módulo: un cliente por árbol de React,
  // así los tests no comparten caché entre casos.
  const [queryClient] = useState(crearQueryClient)

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <EmpresaProvider>{children}</EmpresaProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
