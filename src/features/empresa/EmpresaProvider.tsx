import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { listarMembresias, type Membresia } from '@/services/empresa/memberships'
import { useAuth } from '@/features/auth/useAuth'
import { EmpresaContext, type EmpresaContextValue } from './empresaContext'
import { guardarEmpresaPreferida, leerEmpresaPreferida } from './preferencia'





/**
 * Empresa activa del usuario.
 *
 * SEGURIDAD: esto es contexto de interfaz, no un permiso. El id guardado en
 * localStorage se valida SIEMPRE contra las membresías reales que devuelve
 * el servidor; si no coincide con ninguna, se descarta. Y aunque alguien lo
 * edite a mano, RLS devuelve cero filas para una empresa que no es suya.
 * Escribir un company_id no otorga acceso a nada.
 */
export function EmpresaProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const queryClient = useQueryClient()
  const [elegida, setElegida] = useState<string | null>(() => leerEmpresaPreferida())

  const userId = session?.user.id ?? null

  const {
    data: membresias = [],
    isPending,
    error,
  } = useQuery({
    queryKey: ['empresa', 'membresias', userId],
    queryFn: () => listarMembresias(userId!),
    enabled: userId !== null,
    staleTime: 5 * 60_000,
  })

  // La preferencia guardada sólo vale si sigue siendo una membresía real.
  const activa = useMemo<Membresia | null>(() => {
    if (membresias.length === 0) return null
    return membresias.find((m) => m.companyId === elegida) ?? membresias[0] ?? null
  }, [membresias, elegida])

  // No hace falta "corregir" la preferencia guardada cuando es inválida: se
  // valida contra las membresías reales en cada render, y el useMemo de
  // arriba ya cae en la primera membresía. Escribirla desde un efecto sólo
  // agregaría un render en cascada.

  const cambiarEmpresa = useCallback(
    (companyId: string) => {
      if (companyId === activa?.companyId) return

      // removeQueries y NO invalidateQueries: invalidar deja los datos de la
      // empresa anterior en pantalla mientras se refetchea. Mostrar productos
      // de Buscatools bajo el cartel de Torquetools, aunque sean 300 ms, es
      // exactamente lo que hay que evitar. `remove` los borra al instante y
      // los componentes vuelven al estado de carga.
      queryClient.removeQueries({ queryKey: ['catalogo'] })

      setElegida(companyId)
      guardarEmpresaPreferida(companyId)
    },
    [activa, queryClient],
  )

  const valor = useMemo<EmpresaContextValue>(
    () => ({
      membresias,
      activa,
      cargando: userId !== null && isPending,
      error: error instanceof Error ? error : null,
      cambiarEmpresa,
    }),
    [membresias, activa, userId, isPending, error, cambiarEmpresa],
  )

  return <EmpresaContext.Provider value={valor}>{children}</EmpresaContext.Provider>
}
