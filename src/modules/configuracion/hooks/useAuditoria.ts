import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import type { FiltrosAuditoria } from '../lib/auditoria'
import { ErrorAuditoria, listarActoresAuditoria, listarAuditoria } from '../services/auditoria'

const sinReintento = (intentos: number, error: Error) =>
  !(error instanceof ErrorAuditoria && ['sin_permiso', 'datos_invalidos'].includes(error.codigo)) && intentos < 1

export function useAuditoria(filtros: FiltrosAuditoria, desplazamiento: number, limite: number) {
  const c = useEmpresa().activa?.companyId ?? null
  return useQuery({
    queryKey: ['configuracion', c, 'auditoria', filtros, desplazamiento, limite],
    queryFn: () => listarAuditoria(c!, filtros, desplazamiento, limite),
    enabled: c !== null,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: sinReintento,
  })
}

export function useActoresAuditoria() {
  const c = useEmpresa().activa?.companyId ?? null
  return useQuery({
    queryKey: ['configuracion', c, 'auditoria', 'actores'],
    queryFn: () => listarActoresAuditoria(c!),
    enabled: c !== null,
    staleTime: 60_000,
    retry: sinReintento,
  })
}
