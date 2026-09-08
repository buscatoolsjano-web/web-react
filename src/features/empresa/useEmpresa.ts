import { useContext } from 'react'
import { EmpresaContext, type EmpresaContextValue } from './empresaContext'

export function useEmpresa(): EmpresaContextValue {
  const ctx = useContext(EmpresaContext)
  if (!ctx) throw new Error('useEmpresa() requiere <EmpresaProvider> más arriba en el árbol.')
  return ctx
}
